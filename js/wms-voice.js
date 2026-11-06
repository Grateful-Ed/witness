/* =====================================================================
   wms-voice.js — work the live task queue by voice (the full-flow
   voice brief, 2026-11-05).

   William's direction: "Every task: assignable, completable by voice
   ('done — what's next?'), and visible." Walk the Shift proved the
   law on a practice copy (js/wms-game.js + wms-ai.js's gameTurn);
   this module carries the same envelope to the console's REAL task
   queues, on the live desk record:

     - The model (wms-ai.js workTurn) only NAMES an intent. Code here
       resolves it against the live state and decides what happens.
     - Every state-changing act STAGES and asks (the confirmation law,
       briefs/claude-brief-completion-confirm.md, carried to every act
       this build adds): a completion, filing a flag. Only the NEXT heard turn's yes runs it. Anything else
       clears the stage — a staged act never lingers past one turn.
     - A run executes through js/wms.js's own paths (W.complete — the
       clicks' path — and W.flag) with the engine's validation,
       re-checked on the fresh state. A refusal returns the honest
       reason; success words are only ever built from the result.
     - Questions, repeats and asks mutate nothing. "What's next" is a
       question too (William, 2026-11-05: tasks are ASSIGNED, not
       pulled): it names the next task on the worker's own assigned
       list and never assigns or pulls anything. Pull semantics live
       only in Walk the Shift.
     - Ambiguity asks, never guesses: a completion whose words name a
       different bin, pallet or order than the task in hand — or that
       the model cannot tie to the task in hand — asks which task.
     - Receiving posts and load / ship confirm are human-signature
       acts: voice brings the worker to the screen where they sign,
       and never performs them.

   The stage lives with the caller (wms-ui.js keeps one per page, per
   worker) — never in the saved state, so a reload forgets it and the
   record only ever shows confirmed acts.

   Pure: no DOM, no network. Loads in the browser
   (window.WitnessWmsVoice) and in node (module.exports).
   ===================================================================== */
(function (root) {
  'use strict';

  var W = root.WitnessWms || null;
  if (!W && typeof require === 'function') {
    try { W = require('./wms.js'); } catch (e) { W = null; }
  }
  var O = root.WitnessOntology || null;
  if (!O && typeof require === 'function') {
    try { O = require('./ontology.js'); } catch (e) { O = null; }
  }

  /* The translation layer (interpretation instances 1 + 2; notes 34,
     37, 39, 40). Every heard turn passes ASR → the AI's translation →
     code. The AI renders the words into the code's shapes — a CLAIM
     for a completion (qty / bin / cartons), a PLACE for a problem —
     read against the ontology digest's own surfaces (places, settled
     vocabulary, the task's numbers): the same surface a host
     adapter will supply, so nothing here leans on the dummy WMS's
     internals for the reading. Code is the double checker: parseQty
     / parseBin / zonesFromWords cross-check the AI's reading, and a
     stark disagreement goes back to the worker as a clarification —
     nothing is staged on an unclarified ambiguity. The code's read
     alone never stages a number, and never an act: when the model
     does not answer, the door says exactly OUTAGE and does nothing
     (note 40) — a stage caught by an outage dies unrun. */
  var OUTAGE = 'AI is currently down.';
  var PF = 'Is this a partial or full completion?';

  /* ---------- the words, locally ----------------------------------- */
  /* The yes / no that runs or drops a staged act is decided HERE, from
     the words, never by the model alone: the same sets as converse.js's
     completion confirm. Deny is read before confirm ("no, go ahead"
     leaves it open). A problem beats everything: "yes, but the case is
     crushed" files nothing until asked, and closes nothing. */
  var CONFIRM = /\b(yes|yeah|yep|confirm|confirmed|do it|that'?s right|go ahead)\b/;
  var DENY = /\b(no|nope|wait|cancel|not yet|never mind|nevermind)\b/;
  var NOT_A_PROBLEM = /\b(no|not a|not any|without any?) (problems?|issues?|trouble)\b/g;
  var PROBLEM = /\b(problem|problems|issue|issues|broken|broke|damage|damaged|spill|spilled|spilt|leak|leaking|leaks|can'?t|cannot|missing|wrong|stuck|blocked|hurt|injured|crushed|torn|collapsed|report)\b/;
  var SHORT = /\bshort\b/;
  var NOT_DONE = /\b(not|isn'?t|aren'?t|ain'?t|haven'?t|hasn'?t|wasn'?t|not yet|almost|nearly|never|not quite) (yet )?(done|finished|complete|completed)\b|\bhaven'?t (finished|completed)\b|\bnot (finished|done) yet\b/g;
  var DONE = /\b(done|finished|finish|complete|completed|all set|wrapped up|picked|counted|put away|placed|dropped|packed|moved|replenished)\b/;
  var NEXT = /\b(what'?s (up )?next|what is (up )?next|next task|next one|give me (the )?next|next)\b/;
  var REPEAT = /\b(repeat|say (that|it) again|again|come again|what was (that|it)|what'?s my task|what am i (on|doing)|what do i have)\b/;

  function norm(text) {
    return String(text == null ? '' : text).toLowerCase()
      .replace(/[’‘]/g, "'").replace(/[^a-z0-9' -]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /* The offline intent (and the safety read under the model's): one of
     'problem' | 'deny' | 'confirm' | 'complete' | 'next' | 'repeat' |
     'none'. confirm / deny only read as such while a stage is pending.
     "short" counts as a problem only when no pick is in hand ("picked
     eight, two short" is a short pick, which the pick path records). */
  function localIntent(words, opts) {
    opts = opts || {};
    var t = norm(words);
    if (!t) return 'none';
    var p = t.replace(NOT_A_PROBLEM, ' ');
    if (!opts.pickInHand && SHORT.test(p)) return 'problem';
    if (PROBLEM.test(p)) return 'problem';
    if (opts.pending) {
      if (DENY.test(t)) return 'deny';
      if (CONFIRM.test(t)) return 'confirm';
    }
    var d = p.replace(NOT_DONE, ' ');
    if (DONE.test(d)) return 'complete';
    if (REPEAT.test(d)) return 'repeat';
    if (NEXT.test(d)) return 'next';
    if (!opts.pending && CONFIRM.test(t)) return 'confirm';
    if (!opts.pending && DENY.test(t)) return 'deny';
    return 'none';
  }

  /* ---------- reading the queue (never writes) ----------------------- */

  function find(list, pred) {
    var l = list || [];
    for (var i = 0; i < l.length; i++) if (pred(l[i])) return l[i];
    return null;
  }
  function taskById(state, id) { return find(state.tasks, function (t) { return t.id === id; }); }
  function unitById(state, id) { return find(state.labor, function (u) { return u.id === id; }); }

  /* The worker's own ASSIGNED list (William, 2026-11-05: tasks are
     assigned, not pulled — the WMS assigns work to each user ahead of
     time). Read only: the task in hand, then the tasks assigned to
     this worker and waiting (queued for them). Never the unassigned
     pool; nothing here assigns anything. */
  function assignedList(state, unitId) {
    var cur = W ? W.currentOf(state, unitId) : null;
    var waiting = (state.tasks || []).filter(function (t) {
      if (cur && t.id === cur.id) return false;
      if (t.status === 'assigned' && t.assignee === unitId) return true;
      return t.status === 'open' && t.queuedFor === unitId;
    });
    return { inHand: cur, waiting: waiting };
  }

  /* "What's next" answered from that list: the one after the task in
     hand, or the first assigned task when the hands are empty. */
  function nextAssigned(state, unitId) {
    var a = assignedList(state, unitId);
    return a.waiting.length ? a.waiting[0] : null;
  }

  /* A task as the program offers it: the work and its destination
     (the bin law: a destination reads "Stage: Bin #"). */
  function offerLine(state, t) {
    if (!t) return '';
    if (t.type === 'putaway') {
      var p = find(state.staging, function (x) { return x.id === t.stagingId; });
      return 'Put away pallet ' + t.stagingId + (p ? ' (' + p.qty + ' × ' + p.desc + ')' : '') + ' — Stage: Bin ' + (t.toBinId || '?') + '.';
    }
    if (t.type === 'pick') return 'Pick ' + t.qty + ' × ' + t.desc + ' from Bin ' + t.binId + ' for ' + t.orderId + '.';
    if (t.type === 'count') return 'Cycle count Bin ' + t.binId + ' — say the count.';
    if (t.type === 'replen') return 'Replenish ' + t.qty + ' × ' + t.desc + ' from Bin ' + t.fromBinId + ' — Stage: Bin ' + t.toBinId + '.';
    if (t.type === 'move') return 'Move ' + t.qty + ' × ' + t.desc + ' from Bin ' + t.fromBinId + ' — Stage: Bin ' + t.toBinId + '.';
    if (t.type === 'pack') return 'Pack ' + t.orderId + ' at Pack 1.';
    if (t.type === 'load') return 'Load ' + t.orderId + ' — sign it on the Pack & Ship screen.';
    if (t.type === 'receive') return t.title + ' — count it and post it on the Receiving screen.';
    return t.title + '.';
  }

  /* The ontology the AI reads against: the digest's places (ids +
     zones) and its settled vocabulary. The caller may hand in the
     digest it already holds (the console keeps one); otherwise it is
     derived from the state — pure, the same derivation. */
  function digestOf(state, digest) {
    if (digest) return digest;
    var o = O || root.WitnessOntology;
    return o ? o.buildDigest(state) : { places: [], vocabulary: [] };
  }
  function placesFor(digest) {
    return (digest.places || []).filter(function (p) { return p && p.id && p.zone; })
      .map(function (p) { return { id: String(p.id), kind: p.kind, zone: p.zone }; });
  }
  function vocabularyFor(digest) {
    return (digest.vocabulary || []).filter(function (v) { return v && v.term && v.means; })
      .map(function (v) { return { term: v.term, means: v.means }; });
  }

  /* The task's own numbers, plainly, so the AI can tell a claimed
     count from the task's. */
  function taskNumbers(t) {
    if (!t) return null;
    var out = [];
    if (t.qty != null) out.push('task quantity ' + t.qty);
    if (t.binId) out.push('bin ' + t.binId);
    if (t.fromBinId) out.push('from bin ' + t.fromBinId);
    if (t.toBinId) out.push('suggested destination bin ' + t.toBinId);
    if (t.type === 'count') out.push('a cycle count: the counted quantity is the work product');
    return out.length ? out.join('; ') : null;
  }

  /* What the model is told: the live queue and the ontology it reads
     against, nothing more. */
  function context(state, unitId, pending, digest) {
    var u = unitById(state, unitId);
    var cur = W ? W.currentOf(state, unitId) : null;
    var dg = digestOf(state, digest);
    var clar = pending && (pending.kind === 'clarify' || pending.kind === 'flagzone');
    return {
      worker: u ? u.name : null,
      zone: u ? u.zone : null,
      inHand: cur ? offerLine(state, cur) : null,
      taskNumbers: taskNumbers(cur),
      pending: pending && !clar ? pending.question : null,
      clarify: clar ? { words: pending.words, question: pending.question } : null,
      nextUp: assignedList(state, unitId).waiting.slice(0, 3).map(function (t) { return offerLine(state, t); }),
      places: placesFor(dg),
      vocabulary: vocabularyFor(dg)
    };
  }

  /* A place reading validated against the digest's list — the same
     list the AI read against. The zone comes from that list, never
     from the AI's say-so; an unknown or invented place is null. */
  function resolvePlace(places, id) {
    if (id == null) return null;
    var raw = String(id).trim(), k = raw.toLowerCase();
    if (!k) return null;
    var hit = find(places, function (p) { return p.id.toLowerCase() === k; });
    if (!hit) {
      var z = /^zone\s+(.+)$/.exec(k);
      if (z) hit = find(places, function (p) { return p.kind === 'zone' && p.id.toLowerCase() === z[1]; });
    }
    if (!hit && W && W.parseBin) {
      var b = W.parseBin(raw);
      if (b) hit = find(places, function (p) { return p.kind === 'bin' && p.id === b; });
    }
    return hit ? { id: hit.id, zone: hit.zone } : null;
  }

  /* ---------- naming: is the completion about the task in hand? ---- */
  /* The places the words name — bins, pallets, orders — read from the
     building itself. A completion whose words name a place the task in
     hand does not touch is about some other task: ask, never guess. */
  function named(state, words) {
    var t = String(words || '').toLowerCase(), out = { bins: [], pallets: [], orders: [] };
    function hit(id) {
      var s = String(id).toLowerCase(), at = t.indexOf(s);
      while (at !== -1) {
        var b = t.charAt(at - 1), a = t.charAt(at + s.length);
        if (!/[a-z0-9-]/.test(b) && !/[a-z0-9-]/.test(a)) return true;
        at = t.indexOf(s, at + 1);
      }
      return false;
    }
    (state.bins || []).forEach(function (b) { if (hit(b.id)) out.bins.push(b.id); });
    var spoken = W && W.parseBin ? W.parseBin(words) : null;
    if (spoken && out.bins.indexOf(spoken) === -1) out.bins.push(spoken);
    (state.staging || []).forEach(function (p) { if (hit(p.id)) out.pallets.push(p.id); });
    (state.outbound || []).forEach(function (o) { if (hit(o.id)) out.orders.push(o.id); });
    return out;
  }

  function namesOther(state, t, words) {
    var n = named(state, words);
    var bins = [t.binId, t.fromBinId, t.toBinId].filter(Boolean);
    /* a putaway may land in a different bin than suggested — that is
       the putaway's own override, recorded as suggested vs actual */
    if (t.type !== 'putaway' && n.bins.some(function (b) { return bins.indexOf(b) === -1; })) return true;
    if (n.pallets.some(function (p) { return p !== t.stagingId; })) return true;
    if (n.orders.some(function (o) { return o !== t.orderId; })) return true;
    return false;
  }

  /* ---------- the act's parameters: the claim, cross-checked ------- */
  /* Every number a worker says aloud (the cross-check's wider read:
     parseQty reads the FIRST quantity; this reads them all). */
  function numbersIn(words) {
    var text = String(words || ''), out = [];
    function add(q) { if (q != null && out.indexOf(q) === -1) out.push(q); }
    /* digits (a bin id is not a number) … */
    (text.replace(/\b[abc] ?-? ?0?[1-8]\b/gi, ' ').match(/\b\d{1,4}\b/g) || []).forEach(function (d) { add(parseInt(d, 10)); });
    /* … and number words, read from each word on (digits aside, so
       parseQty's digits-first read cannot hide them) */
    var w = text.replace(/\d+/g, ' ').split(/\s+/);
    for (var i = 0; i < w.length; i++) add(W.parseQty(w.slice(i).join(' ')));
    return out;
  }
  function normBin(b) {
    if (b == null) return null;
    return (W.parseBin(b) || String(b).trim().toUpperCase()) || null;
  }
  var NO_CLAIM = { qty: null, bin: null, cartons: null };

  /* completionPlan(state, t, words, claim) consumes the AI's CLAIM —
     what the worker's words claim — and cross-checks it with the
     code's own read of the same words (parseQty / parseBin):
       - claim and parser agree → the plan (the confirmation law
         still owns the close);
       - nothing claimed and nothing read → the words translated
         cleanly (a known completion phrase, note 33): the FULL task
         is assumed complete (note 39) — except a count, where the
         number is the work product and the count is asked;
       - any disagreement — including the pronoun case, nothing
         claimed but the parser reads "one" — → { clarify }, nothing
         staged; the parser's number is never named and never staged;
       - a claim above the task's quantity → today's guard (an ask).
     Returns { plan, detail } | { ask } | { clarify: { field,
     question } }. No model decides a quantity alone; neither does
     the parser. */
  function completionPlan(state, t, words, claim) {
    claim = claim || NO_CLAIM;
    var plan = { intent: 'confirm', task: t, heard: String(words || '').trim() };
    if (t.type === 'pick') {
      var q = W.parseQty(words), cq = claim.qty;
      if (cq != null && cq > t.qty) return { ask: 'That is more than the order line wants (' + t.qty + '). Say the count you picked. Nothing was closed.' };
      if (cq == null && q == null) return pickPlan(plan, t, t.qty);
      if (cq != null && q === cq) return pickPlan(plan, t, cq);
      return { clarify: { field: 'qty', question: PF } };
    }
    if (t.type === 'putaway') {
      var b = W.parseBin(words), cb = normBin(claim.bin);
      if (b !== cb) return { clarify: { field: 'bin', question: binAsk(t) } };
      return putawayPlan(plan, t, b || t.toBinId);
    }
    if (t.type === 'count') {
      var bin = find(state.bins, function (x) { return x.id === t.binId; });
      if (bin && bin.contents.length > 1) return { ask: 'Bin ' + t.binId + ' holds more than one item — enter each count on the Cycle Counts screen. Nothing was posted.' };
      var c = W.parseQty(words), cc = claim.qty;
      if (c == null && cc == null) return { ask: 'Say the count for Bin ' + t.binId + ' — the number you see. Nothing was posted.' };
      if (c !== cc) return { clarify: { field: 'count', question: countAsk(t) } };
      return countPlan(state, plan, t, c);
    }
    if (t.type === 'pack') {
      var ct = W.parseQty(words), ck = claim.cartons;
      if (ct !== ck) return { clarify: { field: 'cartons', question: cartonsAsk(t) } };
      return cartonsPlan(plan, ct);
    }
    return { plan: plan, detail: null };
  }

  function pickPlan(plan, t, q) {
    plan.qty = q;
    return { plan: plan, detail: q === t.qty ? q + ' picked' : q + ' of ' + t.qty + ' picked — ' + (t.qty - q) + ' short' };
  }
  function putawayPlan(plan, t, binId) {
    plan.binId = binId;
    return { plan: plan, detail: binId === t.toBinId ? 'in Bin ' + binId : 'in Bin ' + binId + ' (suggested ' + t.toBinId + ')' };
  }
  function countPlan(state, plan, t, c) {
    var bin = find(state.bins, function (x) { return x.id === t.binId; });
    var counts = {};
    if (bin && bin.contents.length) counts[bin.contents[0].desc] = c;
    else if (c > 0) return { ask: 'Bin ' + t.binId + ' should be empty by the system — enter what you found on the Cycle Counts screen. Nothing was posted.' };
    plan.counts = counts;
    return { plan: plan, detail: 'count ' + c + (bin && bin.contents.length ? ' × ' + bin.contents[0].desc : '') };
  }
  function cartonsPlan(plan, ct) {
    if (ct != null) plan.cartons = ct;
    return { plan: plan, detail: ct != null ? ct + ' carton' + (ct === 1 ? '' : 's') : null };
  }
  function binAsk(t) { return 'Which bin did it go in? Say just the bin — for example "in Bin ' + t.toBinId + '". Nothing was closed.'; }
  function countAsk(t) { return 'Say the count for Bin ' + t.binId + ' — just the number you see. Nothing was posted.'; }
  function cartonsAsk() { return 'How many cartons? Say just the number. Nothing was closed.'; }
  function pickCountAsk(t) { return 'How many did you pick? Say just the number, ' + t.qty + ' or fewer. Nothing was closed.'; }
  function giveUp(t) { return 'I still can\'t tell. Close "' + t.title + '" on the RF screen, or say it again from the start. Nothing was closed.'; }

  /* ---------- the clarification loop --------------------------------- */
  /* The pending clarification is carried exactly one turn, by the
     same module-memory pattern as the confirmation stage (the caller
     holds it; never persisted). The answer is read TOGETHER with the
     initial words and both readings before anything is asked again;
     if it still cannot resolve, the next ask is narrower — the same
     question is never asked twice:
       qty:   "partial or full?" → "how many?" → give up (RF screen)
       count / cartons / bin: the narrow ask → give up. */
  var FULL = /\b(full|fully|all|everything|whole|entire|complete|completely)\b/;
  var PARTIAL = /\b(partial|partially|partly|part|short|not all|some of)\b/;

  function clarifyStage(u, cur, words, r, claim, level) {
    var w = String(words || '').trim();
    return {
      kind: 'clarify', unitId: u.id, taskId: cur.id, title: cur.title, field: r.clarify.field, level: level || 1,
      words: w, claim: claim || NO_CLAIM, question: r.clarify.question,
      leftOpen: 'Left open: "' + cur.title + '".'
    };
  }

  function answerClarify(state, u, cur, words, env, pending, out) {
    if (!cur || cur.id !== pending.taskId) {
      out.say = '"' + pending.title + '" is no longer in your hands — nothing was closed.';
      return out;
    }
    var a = String(words || '').trim();
    var both = pending.words + ' | ' + a;
    var claim1 = (env && env.claim) || NO_CLAIM;
    var t = cur, plan = { intent: 'confirm', task: t, heard: both }, r = null;
    var na = norm(a);
    if (pending.field === 'qty') {
      var p1 = W.parseQty(a), n1 = (p1 != null && claim1.qty === p1) ? p1 : null;
      var partial = PARTIAL.test(na), full = !partial && FULL.test(na);
      if (p1 != null && n1 == null) r = null;            /* the answer itself reads two ways */
      else if (n1 != null) r = n1 > t.qty ? { ask: 'That is more than the order line wants (' + t.qty + '). ' + giveUp(t) } : pickPlan(plan, t, n1);
      else if (full) r = pickPlan(plan, t, t.qty);
      else if (partial) {
        /* the combined reading: "partial" with a count the initial
           words carried — claimed by the AI and present among the
           numbers the worker actually said */
        var cand = claim1.qty != null ? claim1.qty : pending.claim.qty;
        if (cand != null && cand < t.qty && numbersIn(both).indexOf(cand) !== -1) r = pickPlan(plan, t, cand);
        else if (pending.level === 1) r = { clarify: { field: 'qty', question: pickCountAsk(t) } };
      }
    } else if (pending.field === 'count' || pending.field === 'cartons') {
      var c1 = W.parseQty(a), k1 = pending.field === 'count' ? claim1.qty : claim1.cartons;
      if (c1 != null && c1 === k1) r = pending.field === 'count' ? countPlan(state, plan, t, c1) : cartonsPlan(plan, c1);
    } else if (pending.field === 'bin') {
      var b1 = W.parseBin(a), cb1 = normBin(claim1.bin);
      if (b1 && b1 === cb1) r = putawayPlan(plan, t, b1);
    }
    if (r && r.plan) return stagePlan(cur, u, both, r, out);
    if (r && r.ask) { out.say = r.ask; out.asked = true; return out; }
    if (r && r.clarify) {
      out.stage = clarifyStage(u, cur, pending.words, r, pending.claim, pending.level + 1);
      out.say = r.clarify.question;
      out.asked = true;
      return out;
    }
    /* unresolved: narrower than the last ask, never the same one */
    if (pending.field === 'qty' && pending.level === 1) {
      out.stage = clarifyStage(u, cur, pending.words, { clarify: { field: 'qty', question: pickCountAsk(t) } }, pending.claim, 2);
      out.say = out.stage.question;
    } else {
      out.say = giveUp(t);
    }
    out.asked = true;
    return out;
  }

  /* ---------- one heard turn ----------------------------------------- */
  /* decide(state, unitId, words, env, pending, opts) → a decision:
       { say, stage, run, note, guide, asked, outage }
     say    — the line for the worker (for a run: shown only after the
              act resolves, built from the result — see run()).
     stage  — the new pending act or clarification, or null (the old
              one is always consumed: it lives for one turn).
     run    — the pending act to run now (the worker said yes).
     note   — "left open" when a stage died with the topic change.
     guide  — { href, label, shipmentId? } for a human-signature act.
     env is the model's envelope ({ intent, about, say, claim?,
     place? }) or null. Null means the model was not reached: the door
     says exactly OUTAGE and nothing is staged or run (note 40) — a
     pending stage dies unrun. A completion envelope without a claim
     is the same as no answer. localIntent stays the code-side nudge
     it always was (a problem in the words, a local no / yes to a
     pending stage); it never decides an act on its own.
     opts.digest — the ontology digest the context was built from
     (the place list a flag's place reading is validated against).
     Pure: reads state, never writes it. */
  function decide(state, unitId, words, env, pending, opts) {
    opts = opts || {};
    var u = unitById(state, unitId);
    if (!u) return { say: 'Pick who is working first. Nothing was done.', stage: null };
    var out = { say: '', stage: null, run: null, note: null, guide: null };
    if (!env || (env.intent === 'complete' && !env.claim)) {
      out.say = OUTAGE;
      out.outage = true;
      if (pending) out.note = pending.leftOpen;
      return out;
    }
    var cur = W.currentOf(state, unitId);
    var loc = localIntent(words, { pending: !!pending, pickInHand: !!cur && cur.type === 'pick' });
    var intent = env.intent;
    /* Safety under the model: a problem the words carry is a problem;
       a yes / no to a pending stage is read from the words. */
    if (loc === 'problem') intent = 'problem';

    if (pending && pending.kind === 'clarify') {
      if (loc === 'deny') { out.say = pending.leftOpen; out.denied = true; return out; }
      if (intent === 'next' || intent === 'repeat' || intent === 'problem') {
        out.note = pending.leftOpen;
      } else {
        return answerClarify(state, u, cur, words, env, pending, out);
      }
    } else if (pending && pending.kind === 'flagzone') {
      if (loc === 'deny') { out.say = pending.leftOpen; out.denied = true; return out; }
      var zA = answeredZone(state, words, env, opts);
      if (zA) return stageFlagAt(u, cur, pending.words, zA, null, out);
      if (intent === 'problem' || intent === 'complete') {
        out.note = pending.leftOpen;   /* the new turn stages its own act: one stage at a time */
      } else {
        return unansweredFlag(state, u, cur, words, env, pending, intent, out);
      }
    } else if (pending) {
      if (loc === 'deny' || (intent === 'deny' && loc !== 'confirm')) {
        out.say = pending.leftOpen;
        out.denied = true;
        return out;
      }
      if (loc === 'confirm' || (intent === 'confirm' && loc === 'none')) {
        out.run = pending;
        return out;
      }
      /* anything else: the stage dies with the topic change */
      out.note = pending.leftOpen;
    } else if (intent === 'confirm' || intent === 'deny') {
      out.say = 'Nothing is waiting for a yes or no — nothing was done.';
      return out;
    }

    if (intent === 'problem') return stageFlag(state, u, cur, words, env, out, opts);
    if (intent === 'complete') {
      if (!env.claim) { out.say = OUTAGE; out.outage = true; return out; }
      return stageComplete(state, u, cur, words, env, out);
    }
    if (intent === 'next') { out.say = nextLine(state, u.id, cur); return out; }
    if (intent === 'repeat') { out.say = repeatLine(state, u.id, cur); return out; }
    if (intent === 'answer' || intent === 'none') {
      out.say = env.say;
      out.asked = intent === 'none';
      return out;
    }
    out.say = 'Didn\'t catch an instruction. Nothing was done.';
    out.asked = true;
    return out;
  }

  function repeatLine(state, unitId, cur) {
    return cur ? 'In hand: ' + offerLine(state, cur) : nextLine(state, unitId, null);
  }

  function stagePlan(cur, u, words, r, out) {
    var q = 'Mark "' + cur.title + '" complete' + (r.detail ? ' — ' + r.detail : '') + '? Say yes to close it, or no to leave it open.';
    out.stage = {
      kind: 'complete', unitId: u.id, taskId: cur.id, title: cur.title, words: String(words || '').trim(),
      plan: { qty: r.plan.qty, binId: r.plan.binId, counts: r.plan.counts, cartons: r.plan.cartons },
      question: q, leftOpen: 'Left open: "' + cur.title + '".'
    };
    out.say = q;
    return out;
  }

  function stageComplete(state, u, cur, words, env, out) {
    if (!cur) {
      out.say = 'Nothing is in your hands to complete. Nothing was done.';
      return out;
    }
    if (cur.type === 'receive') {
      var sh = cur.shipmentId;
      out.say = 'Receiving is a signed act — count ' + sh + ' against the BOL and post it on the Receiving screen. Voice does not post it. Nothing was done.';
      out.guide = { href: '#/receiving', label: 'Open Receiving for ' + sh, shipmentId: sh };
      return out;
    }
    if (cur.type === 'load') {
      out.say = 'Loading is a signed act — confirm ' + cur.orderId + ' loaded on the Pack & Ship screen. Voice does not sign it. Nothing was done.';
      out.guide = { href: '#/ship', label: 'Open Pack & Ship' };
      return out;
    }
    var why = W.blocked(state, cur);
    if (why) { out.say = 'That task is blocked: ' + why + ' Nothing was closed.'; return out; }
    if ((env && env.about && env.about !== 'current') || namesOther(state, cur, words)) {
      out.say = 'Which task do you mean? In your hands: ' + offerLine(state, cur) + ' Say "done" for that one. Nothing was closed.';
      out.asked = true;
      return out;
    }
    var r = completionPlan(state, cur, words, env.claim);
    if (r.ask) { out.say = r.ask; out.asked = true; return out; }
    if (r.clarify) {
      out.stage = clarifyStage(u, cur, words, r, env.claim, 1);
      out.say = r.clarify.question;
      out.asked = true;
      return out;
    }
    return stagePlan(cur, u, words, r, out);
  }

  /* "What's next" is a question (William, 2026-11-05): a pure answer
     from the worker's own assigned list. Never staged, never assigned,
     never pulled from the unassigned pool. */
  function nextLine(state, unitId, cur) {
    var nx = nextAssigned(state, unitId);
    if (cur) return nx ? 'After this one: ' + offerLine(state, nx) : 'In hand: ' + offerLine(state, cur) + ' Nothing else is assigned to you after it.';
    return nx ? 'Your first assigned task: ' + offerLine(state, nx) : 'Nothing is assigned to you right now.';
  }

  /* ---------- the flag's zone (interpretation instance 2) ------------ */
  /* A spoken report files a flag the way the console's flag path does
     (W.flag, label from the model, words verbatim). Its zone is where
     the words say the problem is (the flag-zone law). The AI reads
     the place against the digest's places; code validates it (the
     place must be on that list; its zone is read from the list) and
     cross-checks with the token read (zonesFromWords):
       - they agree, or the token read finds nothing and the AI's
         place validates → that zone;
       - the token read finds two zones → nothing resolves (honesty),
         whatever the AI read;
       - they point at different zones → a clarification before
         filing, carried one turn;
       - nothing resolves → the task's zone; with no task in hand the
         reporter's own zone would be the only fallback — so the
         surface asks for the place instead. */
  function stageFlag(state, u, cur, words, env, out, opts) {
    var w = String(words || '').trim();
    var places = placesFor(digestOf(state, opts && opts.digest));
    var toks = W.zonesFromWords(state, w);
    var ai = resolvePlace(places, env ? env.place : null);
    var said = null;
    if (toks.length === 1) {
      if (ai && ai.zone !== toks[0]) {
        var q = 'Which zone is it in — Zone ' + ai.zone + ' (' + ai.id + ') or Zone ' + toks[0] + '? Nothing was filed yet.';
        out.stage = { kind: 'flagzone', unitId: u.id, words: w, taskId: cur ? cur.id : null, readings: { ai: ai, token: toks[0] },
          question: q, leftOpen: 'Not filed: "' + w + '".' };
        out.say = q;
        out.asked = true;
        return out;
      }
      said = toks[0];
    } else if (toks.length === 0 && ai) {
      said = ai.zone;
    }
    if (!said && !cur) {
      out.say = 'Where is it? Say it again with the bin, door or zone, so the flag lands where the problem is. Nothing was filed.';
      out.asked = true;
      return out;
    }
    return stageFlagAt(u, cur, w, said, null, out);
  }

  /* said: the words' zone (null → W.flag falls back to the task's,
     then the reporter's). zoneNote: a reading left unresolved. */
  function stageFlagAt(u, cur, w, said, zoneNote, out, prefix) {
    var zone = said || (cur ? cur.zone : u.zone);
    var q = (prefix || '') + 'File a flag with your words: "' + w + '"? Say yes to file it, or no to drop it.';
    out.stage = { kind: 'flag', unitId: u.id, words: w, taskId: cur ? cur.id : null, zone: zone, said: said || null,
      question: q, leftOpen: 'Not filed: "' + w + '".' };
    if (zoneNote) out.stage.zoneNote = zoneNote;
    out.say = q;
    return out;
  }

  /* The answer to "which zone?": a zone the answer names, read by
     both the token read and (when given) the AI's place reading of
     the answer against the pending flag's words. Both must point at
     one zone; otherwise it did not answer. */
  function answeredZone(state, words, env, opts) {
    var t = norm(words), zones = state.zones || [];
    var toks = W.zonesFromWords(state, words);
    var bare = /^(?:it'?s |in )?(?:zone )?([a-z])$/.exec(t);
    if (bare) {
      var z = bare[1].toUpperCase();
      if (zones.indexOf(z) !== -1 && toks.indexOf(z) === -1) toks = toks.concat([z]);
    }
    var ai = env && env.place ? resolvePlace(placesFor(digestOf(state, opts && opts.digest)), env.place) : null;
    if (toks.length > 1) return null;
    if (toks.length === 1) return ai && ai.zone !== toks[0] ? null : toks[0];
    return ai ? ai.zone : null;
  }

  /* Unanswered (the next utterance was anything else): the flag
     stages at the fallback with the disagreement noted — still under
     the confirmation law, so it files only on the next yes. A
     question asked instead ("what's next") is answered first. */
  function unansweredFlag(state, u, cur, words, env, pending, intent, out) {
    var rd = pending.readings || {};
    var note = 'Zone unresolved: the words read as Zone ' + (rd.ai ? rd.ai.zone + ' (' + rd.ai.id + ')' : '?') +
      ' and as Zone ' + (rd.token || '?') + '; the worker did not say which.';
    var lead = intent === 'next' ? nextLine(state, u.id, cur) + ' '
      : intent === 'repeat' ? repeatLine(state, u.id, cur) + ' '
      : (intent === 'answer' || intent === 'none') && env.say ? env.say + ' ' : '';
    var fz = cur ? cur.zone : u.zone;
    return stageFlagAt(u, cur, pending.words, null, note, out,
      lead + 'The zone is still unclear — it would file at Zone ' + fz + ', with both readings noted. ');
  }

  /* ---------- running a confirmed act --------------------------------- */
  /* run(state, stage, opts) on the FRESH state (inside the store's
     mutate): re-checks the stage still holds, then acts through the
     WMS layer's own paths. opts.label is the flag label (fetched by
     the caller before the run, the console's flag path). Returns
     { ok, text, next } or { ok:false, reason } — reason is the honest
     note; on a refusal nothing has changed. */
  function run(state, stage, opts) {
    opts = opts || {};
    if (!stage || !W) return { ok: false, reason: 'Nothing is waiting to run.' };
    var uid = stage.unitId;
    if (stage.kind === 'complete') {
      var cur = W.currentOf(state, uid);
      if (!cur || cur.id !== stage.taskId) return { ok: false, reason: '"' + stage.title + '" is no longer in your hands — nothing was closed.' };
      if (cur.type === 'receive' || cur.type === 'load') return { ok: false, reason: 'That is a signed act — voice does not perform it. Nothing was closed.' };
      var mark = state.records.length;
      var p = stage.plan || {};
      /* the click's own path: W.complete, with the same engine
         validation — and no pull afterwards (tasks are assigned, not
         pulled; what is next is only named, from the assigned list) */
      var r = W.complete(state, cur.id, { by: uid, qty: p.qty, binId: p.binId, counts: p.counts, cartons: p.cartons, words: stage.words });
      if (!r.ok) return { ok: false, reason: r.reason + ' Nothing was closed.' };
      attribute(state, stage.taskId, mark, stage.words);
      var nx = nextAssigned(state, uid);
      return { ok: true, text: r.text + (nx ? ' Next on your list: ' + offerLine(state, nx) : ' Nothing else is assigned to you.'), next: nx };
    }
    if (stage.kind === 'flag') {
      var fo = { unitId: uid, words: stage.words, label: opts.label, source: 'voice' };
      if ('said' in stage) fo.zone = stage.said;
      if (stage.zoneNote) fo.zoneNote = stage.zoneNote;
      var f = W.flag(state, fo);
      if (!f.ok) return { ok: false, reason: f.reason + ' Nothing was filed.' };
      return { ok: true, text: 'Flagged "' + f.flag.label + '" with your words (Zone ' + f.flag.zone + '). Nothing was closed.', flag: f.flag };
    }
    return { ok: false, reason: 'Nothing is waiting to run.' };
  }

  /* A spoken completion is attributed exactly as a clicked one (the
     WMS layer writes who and when), plus that it arrived by voice and
     the words that confirmed it — on the task and on the completion
     records this act wrote. */
  function attribute(state, taskId, mark, words) {
    var t = taskById(state, taskId);
    if (t) { t.via = 'voice'; if (words) t.heard = words; }
    for (var i = mark; i < state.records.length; i++) {
      var r = state.records[i];
      if (r.taskId === taskId && r.kind === 'complete') { r.via = 'voice'; if (words) r.heard = words; }
    }
  }

  var api = {
    localIntent: localIntent,
    assignedList: assignedList,
    nextAssigned: nextAssigned,
    offerLine: offerLine,
    context: context,
    named: named,
    namesOther: namesOther,
    completionPlan: completionPlan,
    resolvePlace: resolvePlace,
    numbersIn: numbersIn,
    OUTAGE: OUTAGE,
    PARTIAL_OR_FULL: PF,
    decide: decide,
    run: run
  };
  root.WitnessWmsVoice = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
