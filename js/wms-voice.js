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
       this build adds): a completion, taking the next task, filing a
       flag. Only the NEXT heard turn's yes runs it. Anything else
       clears the stage — a staged act never lingers past one turn.
     - A run executes through js/wms.js's own paths (W.act → W.complete
       → W.nextFor, W.nextFor, W.flag) with the engine's validation,
       re-checked on the fresh state. A refusal returns the honest
       reason; success words are only ever built from the result.
     - Questions, repeats and asks mutate nothing.
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
  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  /* The task the engine's queue logic would hand this worker next —
     found by running the real W.nextFor on a throwaway copy, so the
     offer is exactly what a yes would take, and nothing is assigned. */
  function peekNext(state, unitId) {
    if (!W) return null;
    var r = W.nextFor(copy(state), unitId);
    return r && r.ok && r.task && !r.already ? taskById(state, r.task.id) : null;
  }

  /* The next few in this worker's queue, read only (for the model). */
  function upcoming(state, unitId, n) {
    if (!W) return [];
    var c = copy(state), out = [];
    var cur = W.currentOf(c, unitId);
    for (var i = 0; i < (n || 3); i++) {
      if (cur) {
        /* step past the task in hand without touching the real state */
        cur.status = 'done';
        var u = unitById(c, unitId);
        if (u) u.currentTaskId = null;
      }
      var r = W.nextFor(c, unitId);
      if (!r || !r.task) break;
      out.push(r.task);
      cur = r.task;
    }
    return out;
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

  /* What the model is told: the live queue, nothing more. */
  function context(state, unitId, pending) {
    var u = unitById(state, unitId);
    var cur = W ? W.currentOf(state, unitId) : null;
    return {
      worker: u ? u.name : null,
      zone: u ? u.zone : null,
      inHand: cur ? offerLine(state, cur) : null,
      pending: pending ? pending.question : null,
      nextUp: upcoming(state, unitId, 3).map(function (t) { return offerLine(state, t); })
    };
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

  /* ---------- the act's parameters, from the words ------------------ */
  /* Returns { plan } (what W.act needs) or { ask } (a question; nothing
     is staged). Deterministic: no model decides a quantity. */
  function completionPlan(state, t, words) {
    var plan = { intent: 'confirm', task: t, heard: String(words || '').trim() };
    if (t.type === 'pick') {
      var q = W.parseQty(words);
      if (q == null) return { ask: 'Say the count you picked — for example "picked ' + t.qty + '". Nothing was closed.' };
      if (q > t.qty) return { ask: 'That is more than the order line wants (' + t.qty + '). Say the count you picked. Nothing was closed.' };
      plan.qty = q;
      return { plan: plan, detail: q === t.qty ? q + ' picked' : q + ' of ' + t.qty + ' picked — ' + (t.qty - q) + ' short' };
    }
    if (t.type === 'putaway') {
      var b = W.parseBin(words);
      plan.binId = b || t.toBinId;
      return { plan: plan, detail: plan.binId === t.toBinId ? 'in Bin ' + plan.binId : 'in Bin ' + plan.binId + ' (suggested ' + t.toBinId + ')' };
    }
    if (t.type === 'count') {
      var bin = find(state.bins, function (x) { return x.id === t.binId; });
      var c = W.parseQty(words);
      if (bin && bin.contents.length > 1) return { ask: 'Bin ' + t.binId + ' holds more than one item — enter each count on the Cycle Counts screen. Nothing was posted.' };
      if (c == null) return { ask: 'Say the count for Bin ' + t.binId + ' — the number you see. Nothing was posted.' };
      var counts = {};
      if (bin && bin.contents.length) counts[bin.contents[0].desc] = c;
      else if (c > 0) return { ask: 'Bin ' + t.binId + ' should be empty by the system — enter what you found on the Cycle Counts screen. Nothing was posted.' };
      plan.counts = counts;
      return { plan: plan, detail: 'count ' + c + (bin && bin.contents.length ? ' × ' + bin.contents[0].desc : '') };
    }
    if (t.type === 'pack') {
      var ct = W.parseQty(words);
      if (ct != null) plan.cartons = ct;
      return { plan: plan, detail: ct != null ? ct + ' carton' + (ct === 1 ? '' : 's') : null };
    }
    return { plan: plan, detail: null };
  }

  /* ---------- one heard turn ----------------------------------------- */
  /* decide(state, unitId, words, env, pending) → a decision:
       { say, stage, run, note, guide, asked }
     say    — the line for the worker (for a run: shown only after the
              act resolves, built from the result — see run()).
     stage  — the new pending act, or null (the old one is always
              consumed: a stage lives for one turn).
     run    — the pending act to run now (the worker said yes).
     note   — "left open" when a stage died with the topic change.
     guide  — { href, label, shipmentId? } for a human-signature act.
     env is the model's envelope ({ intent, about, say }) or null —
     null means the model was not reached, and the local words decide.
     Pure: reads state, never writes it. */
  function decide(state, unitId, words, env, pending) {
    var u = unitById(state, unitId);
    if (!u) return { say: 'Pick who is working first. Nothing was done.', stage: null };
    var cur = W.currentOf(state, unitId);
    var loc = localIntent(words, { pending: !!pending, pickInHand: !!cur && cur.type === 'pick' });
    var intent = env ? env.intent : loc;
    /* Safety under the model: a problem the words carry is a problem;
       a yes / no to a pending stage is read from the words. */
    if (loc === 'problem') intent = 'problem';
    var out = { say: '', stage: null, run: null, note: null, guide: null };

    if (pending) {
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

    if (intent === 'problem') return stageFlag(state, u, cur, words, out);
    if (intent === 'complete') return stageComplete(state, u, cur, words, env, out);
    if (intent === 'next') return stageNext(state, u, cur, out);
    if (intent === 'repeat') {
      if (cur) out.say = 'In hand: ' + offerLine(state, cur);
      else {
        var nx = peekNext(state, u.id);
        out.say = nx ? 'Nothing in hand. Next up: ' + offerLine(state, nx) + ' Say "what\'s next" to take it.' : 'Nothing in hand, and nothing waiting for you right now.';
      }
      return out;
    }
    if (env && (intent === 'answer' || intent === 'none')) {
      out.say = env.say;
      out.asked = intent === 'none';
      return out;
    }
    out.say = 'Didn\'t catch an instruction. Nothing was done.';
    out.asked = true;
    return out;
  }

  function stageComplete(state, u, cur, words, env, out) {
    if (!cur) {
      out.say = 'Nothing is in your hands to complete. Say "what\'s next" for your next task. Nothing was done.';
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
    var r = completionPlan(state, cur, words);
    if (r.ask) { out.say = r.ask; out.asked = true; return out; }
    var q = 'Mark "' + cur.title + '" complete' + (r.detail ? ' — ' + r.detail : '') + '? Say yes to close it, or no to leave it open.';
    out.stage = {
      kind: 'complete', unitId: u.id, taskId: cur.id, title: cur.title, words: String(words || '').trim(),
      plan: { qty: r.plan.qty, binId: r.plan.binId, counts: r.plan.counts, cartons: r.plan.cartons },
      question: q, leftOpen: 'Left open: "' + cur.title + '".'
    };
    out.say = q;
    return out;
  }

  function stageNext(state, u, cur, out) {
    if (cur) { out.say = 'Still in hand: ' + offerLine(state, cur) + ' Say "done" when it is finished.'; return out; }
    var t = peekNext(state, u.id);
    if (!t) { out.say = 'Nothing waiting for you right now.'; return out; }
    var q = 'Next up: ' + offerLine(state, t) + ' Take it? Say yes to take it, or no to leave it.';
    out.stage = { kind: 'take', unitId: u.id, taskId: t.id, title: t.title, question: q, leftOpen: 'Not taken: "' + t.title + '".' };
    out.say = q;
    return out;
  }

  /* A spoken report files a flag the way the console's flag path does
     (W.flag, label from the model, words verbatim). Its zone comes
     from the words (the flag-zone law); with no place in the words
     and no task in hand, the reporter's own zone would be the only
     fallback — so the surface asks for the place instead. */
  function stageFlag(state, u, cur, words, out) {
    var w = String(words || '').trim();
    var zone = W.zoneFromWords(state, w) || (cur ? cur.zone : null);
    if (!zone) {
      out.say = 'Where is it? Say it again with the bin, door or zone, so the flag lands where the problem is. Nothing was filed.';
      out.asked = true;
      return out;
    }
    var q = 'File a flag with your words: "' + w + '"? Say yes to file it, or no to drop it.';
    out.stage = { kind: 'flag', unitId: u.id, words: w, taskId: cur ? cur.id : null, zone: zone, question: q, leftOpen: 'Not filed: "' + w + '".' };
    out.say = q;
    return out;
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
      var r = W.act(state, uid, { intent: 'confirm', task: cur, qty: p.qty, binId: p.binId, counts: p.counts, cartons: p.cartons, heard: stage.words });
      if (!r.ok) return { ok: false, reason: r.reply + ' Nothing was closed.' };
      attribute(state, stage.taskId, mark, stage.words);
      return { ok: true, text: r.reply, next: r.next || null };
    }
    if (stage.kind === 'take') {
      if (W.currentOf(state, uid)) return { ok: false, reason: 'A task is already in your hands — nothing was taken.' };
      var peek = peekNext(state, uid);
      if (!peek || peek.id !== stage.taskId) {
        return { ok: false, reason: 'The queue moved — "' + stage.title + '" is no longer next. Nothing was taken. Say "what\'s next" again.' };
      }
      var n = W.nextFor(state, uid);
      if (!n.ok || !n.task || n.task.id !== stage.taskId) return { ok: false, reason: 'The task could not be handed over. Nothing was taken.' };
      n.task.takenVia = 'voice';
      return { ok: true, text: 'Taken: ' + offerLine(state, n.task), next: n.task };
    }
    if (stage.kind === 'flag') {
      var f = W.flag(state, { unitId: uid, words: stage.words, label: opts.label, source: 'voice' });
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
    peekNext: peekNext,
    upcoming: upcoming,
    offerLine: offerLine,
    context: context,
    named: named,
    namesOther: namesOther,
    completionPlan: completionPlan,
    decide: decide,
    run: run
  };
  root.WitnessWmsVoice = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
