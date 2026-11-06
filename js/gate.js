/* =====================================================================
   gate.js — the gate: one gated act path for the agent doors
   (briefs/claude-brief-gate.md, harness build 1 of 2).

   Before this build, each door that can change the building — console
   voice (js/wms-voice.js), converse (js/converse.js, the glasses and
   the phone), and the game's voice (js/wms-game.js) — carried its own
   copy of the permission laws. Now every act from those doors goes
   through ONE call:

     gate.act(state, { who, via, intent, target, params, confirmed }, opts)
       -> { ok: true, result }              the act landed (or, when it
                                            must be confirmed first,
                                            result.staged: the door
                                            holds the stage and asks)
        | { ok: false, reason }             a refusal, in plain words
        | { ok: false, clarify: <words> }   check 1's outcome: the door
                                            asks the worker; nothing is
                                            recorded

   SIX CHECKS, in this order; the first that fails answers:
     1. The act exists and its params are complete. The door's AI
        reading arrives in params (the claim); the gate cross-checks it
        against the deterministic parsers and the task. A disagreement
        is a clarification, not a refusal. An act from a door whose
        acts must be model-formed (note 40) and that is not, is the
        outage: "AI is currently down." — nothing staged or run.
     2. Signature class (note 30). A signed act — posting a receiving,
        confirming a load — is refused on every agent door, with the
        guidance to the screen where a human signs. Checked again at
        run time, so a forged stage is refused too.
     3. The confirmation law (notes 25; PRs #38/#40). An act the policy
        says must be confirmed is only STAGED (result.staged) until the
        door passes confirmed: true with the staged act's facts in
        params. The gate is stateless: each door keeps its own stage in
        its own memory, exactly as before.
     4. Ownership (the assignment law). An act on a task lands only for
        the task's holder.
     5. Run through the engine — its public paths only (js/wms.js,
        js/engine.js, the game's own step functions). The gate never
        mutates state itself; when the engine refuses, the refusal is
        said honestly. On the WMS world this is a SUBMISSION through
        the current host adapter (below).
     6. One attribution writer: who, via, and the exact words heard,
        written here, in one shape, for every door.

   The host adapter (briefs/claude-brief-adapter.md; note 38). The WMS
   world — the console voice door's — is ADAPTED: check 1 also reads
   the current adapter's declared verbs (an undeclared verb is refused
   in words that name the host: capability honesty), and check 5
   submits through the adapter (js/adapter.js) instead of calling the
   engine. The gate stays synchronous:
     - a sync adapter (the dummy WMS, the default) lands the act now —
       today's outcome, unchanged;
     - an async adapter answers SENT: { ok: true, result: { sent: true,
       key, host, entry, text } }. The act is recorded in
       state.sentActs ({ key, via, who, intent, target, params, words,
       ts, status: 'sent' }) with an idempotency key minted here from
       state.adapterSeq; the task stays open and in hand. The host's
       verdict arrives later through adapter.confirm(state, key,
       verdict), which lands the act once via settle() (below) or
       marks it refused with the host's reason.
   The engine and game worlds are the demo building's own and stay
   BUILT-IN: they run on their engines directly, not through an
   adapter.

   The confirmation and signature rules live in ONE policy object
   (POLICY, below) so the ontology's configuration layer can supply
   them later without surgery. In this build it holds today's law.

   Converse (the converse model step, 2026-11-06): converse's reader
   is now the model (js/wms-ai.js converseTurn; matchIntent is the
   cross-check), so its declared exceptions are closed —
   POLICY.modelFormed.converse and POLICY.signatureEnforced.converse
   are true, and pull is gone from every door: work is assigned,
   never pulled.

   Pure: no DOM, no network. Loads in the browser (window.WitnessGate)
   and in node (module.exports).
   ===================================================================== */
(function (root) {
  'use strict';

  function wms() {
    var W = root.WitnessWms || null;
    if (!W && typeof require === 'function') {
      try { W = require('./wms.js'); } catch (e) { W = null; }
    }
    return W;
  }

  /* The adapter seam (js/adapter.js) — read lazily, like the WMS
     layer: the page may load it after this file. */
  function adapters() {
    var A = root.WitnessAdapter || null;
    if (!A && typeof require === 'function') {
      try { A = require('./adapter.js'); } catch (e) { A = null; }
    }
    return A;
  }
  function adapterFor(opts) {
    if (opts && opts.adapter) return opts.adapter;
    var A = adapters();
    return A ? A.current() : null;
  }
  function copyPlan(pl) {
    pl = pl || {};
    return { qty: pl.qty, binId: pl.binId, counts: pl.counts, cartons: pl.cartons };
  }
  function plain(x) { return x == null ? null : JSON.parse(JSON.stringify(x)); }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

  var OUTAGE = 'AI is currently down.';
  var PF = 'Is this a partial or full completion?';

  /* ---------- the policy: today's law, in one place ----------------- */
  var POLICY = {
    outage: OUTAGE,
    /* The signature test (note 30, William's words): anything the
       company must confirm or update a customer or an outside third
       party on is a signed act. As built: posting a receiving and
       confirming a load. Voice can confirm; voice can never sign. */
    signedTaskTypes: { receive: 'post-receiving', load: 'confirm-load' },
    signedIntents: { 'post-receiving': true, 'confirm-load': true },
    /* The confirmation law, per door: which acts stage and ask. The
       game's own laws stand inside its practice world (its steps run
       on the word, as they always have). */
    confirm: {
      voice: { complete: true, flag: true },
      converse: { complete: true },
      game: {}
    },
    /* Note 40: an act reaches the gate only as a model-formed intent,
       on every door (converse since the converse model step). */
    modelFormed: { voice: true, game: true, converse: true },
    /* Doors on which the signature class refuses: every door. A
       spoken close of an engine-world receive or load task is
       refused with the guidance to the desk. */
    signatureEnforced: { voice: true, game: true, converse: true }
    /* Pull (taking unassigned work) is retired on every door (note 32;
       the assignment law): there is no pull entry and no pull intent. */
  };

  function find(list, pred) {
    var l = list || [];
    for (var i = 0; i < l.length; i++) if (pred(l[i])) return l[i];
    return null;
  }
  function no(reason, extra) {
    var o = { ok: false, reason: reason };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) o[k] = extra[k];
    return o;
  }

  /* ================================================================
     Check 1's cross-check for a spoken completion (moved here from
     js/wms-voice.js — interpretation instances 1 + 2). The AI's CLAIM
     is checked against the code's own read of the same words:
       - agree → the plan;
       - nothing claimed and nothing read → the full task (note 39),
         except a count, whose number is the work product (asked);
       - any disagreement → { clarify }, nothing staged;
       - a claim above the task's quantity → an ask.
     Returns { plan, detail } | { ask } | { clarify: { field, question } }.
     ================================================================ */
  var NO_CLAIM = { qty: null, bin: null, cartons: null };

  function normBin(b) {
    if (b == null) return null;
    var W = wms();
    return (W.parseBin(b) || String(b).trim().toUpperCase()) || null;
  }

  function completionPlan(state, t, words, claim) {
    var W = wms();
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

  /* ================================================================
     The worlds above the seam. Each world knows only its engine's
     public paths. The WMS world is adapted: the dummy WMS (js/wms.js)
     is simply the first adapter under the seam (js/adapter.js); the
     engine and game worlds are built-in.
     ================================================================ */

  /* ---------- console voice: the live desk record (js/wms.js) ------- */
  var WMS_WORLD = {
    intents: { complete: 1, flag: 1, 'post-receiving': 1, 'confirm-load': 1 },

    prepare: function (state, req) {
      var W = wms();
      if (!W) return no('The WMS layer is not loaded. Nothing was done.');
      var p = req.params || {};
      if (req.intent === 'flag') {
        var w = String(p.words || '').trim();
        if (!w) return no('Say what the problem is. Nothing was filed.');
        return { ok: true, words: w };
      }
      if (req.intent === 'post-receiving' || req.intent === 'confirm-load') return { ok: true, words: String(p.words || '').trim() };
      /* complete */
      var t = find(state.tasks, function (x) { return x.id === req.target; });
      var title = (t && t.title) || p.title || req.target;
      if (!t || t.status === 'done') return no('"' + title + '" is no longer in your hands — nothing was closed.');
      var words = String(p.words || '').trim();
      if (req.confirmed) return { ok: true, task: t, words: words, plan: p.plan || {} };
      if (p.plan) return { ok: true, task: t, words: words, plan: p.plan, detail: p.detail || null };
      var r = completionPlan(state, t, words, p.claim);
      if (r.clarify) return { ok: false, clarify: r.clarify.question, field: r.clarify.field };
      if (r.ask) return no(r.ask, { asked: true });
      var pl = r.plan;
      return { ok: true, task: t, words: words, plan: { qty: pl.qty, binId: pl.binId, counts: pl.counts, cartons: pl.cartons }, detail: r.detail };
    },

    signed: function (state, req, prep) {
      var sig = POLICY.signedIntents[req.intent] ? req.intent
        : prep.task ? POLICY.signedTaskTypes[prep.task.type] : null;
      if (!sig) return null;
      if (req.confirmed) return no('That is a signed act — voice does not perform it. Nothing was closed.');
      var t = prep.task;
      if (sig === 'post-receiving') {
        var sh = t ? t.shipmentId : (req.params && req.params.shipmentId) || '';
        return no('Receiving is a signed act — count ' + sh + ' against the BOL and post it on the Receiving screen. Voice does not post it. Nothing was done.',
          { signed: true, guide: { href: '#/receiving', label: 'Open Receiving for ' + sh, shipmentId: sh } });
      }
      var oid = t ? t.orderId : (req.params && req.params.orderId) || '';
      return no('Loading is a signed act — confirm ' + oid + ' loaded on the Pack & Ship screen. Voice does not sign it. Nothing was done.',
        { signed: true, guide: { href: '#/ship', label: 'Open Pack & Ship' } });
    },

    owns: function (state, req, prep) {
      if (req.intent !== 'complete') return null;
      var cur = wms().currentOf(state, req.who);
      if (!cur || cur.id !== prep.task.id) return no('"' + prep.task.title + '" is no longer in your hands — nothing was closed.');
      return null;
    },

    blocked: function (state, req, prep) {
      if (req.intent !== 'complete' || req.confirmed) return null;
      var why = wms().blocked(state, prep.task);
      return why ? no('That task is blocked: ' + why + ' Nothing was closed.') : null;
    },

    /* No run of its own: this world is ADAPTED. Check 5 submits the
       act below through the current adapter (js/adapter.js); the
       dummy adapter lands it through W.complete / W.flag exactly as
       this world's run did before the adapter build. */
    adapted: true,
    act: function (req, prep) {
      var p = req.params || {}, params = {};
      if (req.intent === 'complete') params.plan = copyPlan(prep.plan);
      else {
        if (p.label !== undefined) params.label = p.label;
        if ('zone' in p) params.zone = p.zone;
        if (p.zoneNote) params.zoneNote = p.zoneNote;
      }
      return { via: req.via, who: req.who, intent: req.intent,
        target: prep.task ? prep.task.id : null, params: params, words: prep.words || '' };
    },

    taskId: function (req, prep) { return prep.task ? prep.task.id : null; }
  };

  /* ---------- converse: the glasses / phone world (js/engine.js) ---- */
  /* Converse's law: complete stages and asks; a problem is noted on the
     task in hand at once; 'take' puts a named task of the worker's own
     created job in hand (the job's start, and its next task after a
     close). There is no pull: work is assigned, never pulled. */
  var ENGINE_WORLD = {
    intents: { complete: 1, 'note-problem': 1, take: 1, 'post-receiving': 1, 'confirm-load': 1 },

    prepare: function (state, req, opts) {
      var E = opts && opts.engine;
      if (!E) return no('The engine is not loaded. Nothing was done.');
      var p = req.params || {};
      var unit = E.unitById(state, req.who);
      if (!unit) return no('Pick your name first. Nothing was done.');
      var words = String(p.words || '').trim();
      if (req.intent === 'note-problem') {
        if (!words) return no('Nothing to note. No action taken.');
        return { ok: true, unit: unit, words: words };
      }
      if (req.intent === 'post-receiving' || req.intent === 'confirm-load') return { ok: true, unit: unit, words: words };
      var t = E.taskById(state, req.target);
      if (!t || t.status === 'done') return no('That task is no longer open. Nothing was done.');
      return { ok: true, unit: unit, task: t, words: words };
    },

    signed: function (state, req, prep) {
      var sig = POLICY.signedIntents[req.intent] ? req.intent
        : prep.task && req.intent === 'complete' ? POLICY.signedTaskTypes[prep.task.type] : null;
      if (!sig) return null;
      return no(sig === 'post-receiving'
        ? 'Receiving is a signed act — post it on the Receiving screen. Voice does not post it. Nothing was done.'
        : 'Loading is a signed act — confirm it on the desk screen. Voice does not sign it. Nothing was done.', { signed: true });
    },

    owns: function (state, req, prep) {
      if (req.intent === 'complete') {
        var cur = prep.unit.currentTaskId;
        if (cur !== prep.task.id || prep.task.status !== 'assigned') {
          return no('Can\'t close "' + ((req.params && req.params.title) || prep.task.title) + '" — it is no longer the task in your hand. Nothing was closed.');
        }
      }
      if (req.intent === 'take') {
        if (prep.task.status !== 'open') return no('That task is already in someone\'s hands. Nothing was done.');
      }
      return null;
    },

    blocked: function (state, req, prep, opts) {
      var E = opts.engine;
      if ((req.intent !== 'complete' && req.intent !== 'take') || !E.blockedBy) return null;
      var held = E.blockedBy(state, prep.task);
      if (!held) return null;
      return no('Can\'t close "' + prep.task.title + '" — ' + held, { held: held });
    },

    run: function (state, req, prep, opts) {
      var E = opts.engine;
      if (req.intent === 'complete') {
        if (!E.completeTask(state, prep.task.id)) return no('Could not close "' + prep.task.title + '" — the counts would not balance.', { unbalanced: true });
        return { ok: true, task: prep.task };
      }
      if (req.intent === 'note-problem') {
        var rep = E.reportProblem(state, prep.unit.id, prep.words);
        if (!rep) return no('Nothing to note. No action taken.');
        return { ok: true, report: rep, taskId: rep.task ? rep.task.id : null };
      }
      if (req.intent === 'take') {
        /* The engine's own assignment shape (nextTaskFor's three
           writes): the engine has no "assign this one" call. */
        prep.task.status = 'assigned';
        prep.task.assignee = prep.unit.id;
        prep.unit.currentTaskId = prep.task.id;
        return { ok: true, task: prep.task };
      }
      return no('The act did not go through. Nothing was done.');
    },

    taskId: function (req, prep, r) {
      if (r && r.taskId !== undefined) return r.taskId;
      if (r && r.task) return r.task.id;
      return prep.task ? prep.task.id : null;
    }
  };

  /* ---------- the game: Walk the Shift's own building -------------- */
  /* Acts land only in the game world (state.world === 'game'); the
     live record is never touched from this door. opts.engine is the
     game module's own step functions (begin, performStep, armCount,
     confirmCount). */
  var NOT_GAME = 'Walk the Shift acts only on its own practice building. Nothing was done.';
  var GAME_WORLD = {
    intents: { start: 1, step: 1, 'count-arm': 1, 'count-confirm': 1 },

    prepare: function (state, req, opts) {
      if (!state || state.world !== 'game') return no(NOT_GAME);
      var G = opts && opts.engine;
      if (!G) return no('The game is not loaded. Nothing was done.');
      var p = req.params || {};
      if (req.intent === 'start') return { ok: true, role: p.role || 'inbound', words: String(p.words || '').trim() };
      var chain = p.chain;
      var idx = req.target;
      var step = chain && chain.steps ? chain.steps[idx == null ? chain.steps.length - 1 : idx] : null;
      if (!step) return no('No such step. Nothing was done.');
      return { ok: true, chain: chain, idx: idx, step: step, words: String(p.words || '').trim() };
    },

    signed: function (state, req, prep) {
      if (req.intent === 'step' && prep.step && POLICY.signedTaskTypes[prep.step.kind] === 'confirm-load') {
        return no('Loading is a signed act — sign it with the panel\'s button. Voice does not sign it. Nothing was done.', { signed: true });
      }
      return null;
    },

    owns: function () { return null; },   /* the practice player holds the whole dealt chain */
    blocked: function () { return null; },

    run: function (state, req, prep, opts) {
      var G = opts.engine;
      if (req.intent === 'start') return G.begin(state, prep.role);
      if (req.intent === 'step') return G.performStep(state, prep.chain, prep.idx);
      if (req.intent === 'count-arm') return G.armCount(state, prep.chain, prep.idx);
      return G.confirmCount(state, prep.chain, prep.idx);
    },

    taskId: function (req, prep, r) {
      if (prep.step && prep.step.task) return prep.step.task;
      if (prep.step && prep.step.countTaskId) return prep.step.countTaskId;
      return null;
    }
  };

  var WORLDS = { voice: WMS_WORLD, converse: ENGINE_WORLD, game: GAME_WORLD };

  /* ---------- check 6: one attribution writer ------------------------ */
  /* Every landed act: who, via, and (when words were heard) the exact
     words — on the task the act touched and on every record the act
     wrote. One shape, every door. */
  function attribute(state, mark, req, taskId, words) {
    var tasks = state.tasks || [];
    var t = taskId ? find(tasks, function (x) { return x.id === taskId; }) : null;
    if (t) { t.via = req.via; if (words) t.heard = words; }
    var recs = state.records || [];
    for (var i = mark; i < recs.length; i++) {
      var r = recs[i];
      if (!r || typeof r !== 'object') continue;
      r.via = req.via;
      if (words) r.heard = words;
      if (r.by == null && req.who) r.by = req.who;
    }
  }

  /* ---------- the one call ------------------------------------------- */
  function act(state, req, opts) {
    req = req || {};
    opts = opts || {};
    var world = WORLDS[req.via];
    if (!state) return no('There is no building loaded. Nothing was done.');
    if (!world) return no('That door cannot act on the building. Nothing was done.');
    var p = req.params || {};

    /* 1. the act exists, model-formed, params complete (and cross-checked) */
    if (POLICY.modelFormed[req.via] && !p.model) return no(OUTAGE, { outage: true });
    if (!req.intent || !world.intents[req.intent]) return no('That is not something I can do — nothing was done.', { unknown: true });
    /* ... and the host takes it (capability honesty, note 38): on an
       adapted world, a verb the current adapter's profile does not
       declare is refused here, in words that name the host — before
       anything is staged, sent, or recorded. */
    var ad = null;
    if (world.adapted) {
      ad = adapterFor(opts);
      if (!ad) return no('The host adapter is not loaded. Nothing was done.');
      if (!ad.profile.verbs[req.intent]) {
        return no(cap(ad.profile.hostLabel) + ' doesn\'t take that from Witness — it has to be done there directly. Nothing was done.', { unsupported: true });
      }
    }
    var prep = world.prepare(state, req, opts);
    if (!prep.ok) {
      if (prep.clarify) return { ok: false, clarify: prep.clarify, field: prep.field };
      return prep;
    }

    /* 2. signature class */
    var sig = POLICY.signatureEnforced[req.via] || POLICY.signedIntents[req.intent] ? world.signed(state, req, prep, opts) : null;
    if (sig) return sig;

    /* 3. the confirmation law */
    var mustConfirm = !!(POLICY.confirm[req.via] && POLICY.confirm[req.via][req.intent]);
    var stageOnly = mustConfirm && !req.confirmed;

    /* 4. ownership */
    var mine = world.owns(state, req, prep, opts);
    if (mine) return mine;

    /* 5. run through the engine (or, unconfirmed, stage); on an adapted
       world, submit through the adapter */
    var held = world.blocked(state, req, prep, opts);
    if (held) return held;
    var async = ad && ad.profile.transport === 'async';
    var sentAlready = async ? pendingFor(state, req, prep, world) : null;
    if (sentAlready && sentAlready.key !== req.key) {
      return no('That is already sent to ' + ad.profile.hostLabel + ' — waiting on it to confirm. Nothing was sent again.', { pending: sentAlready.key });
    }
    if (stageOnly) {
      return { ok: true, result: { staged: true, act: {
        via: req.via, who: req.who, intent: req.intent, target: req.target,
        plan: prep.plan || null, detail: prep.detail || null, words: prep.words || ''
      } } };
    }
    var mark = (state.records || []).length;
    var a = null, r;
    if (ad) {
      a = world.act(req, prep);
      /* The idempotency key: minted once, here, from the state-held
         counter — door + counter, unique per act by construction. The
         key rides on the request object, so resubmitting the same act
         reuses it. The dummy is in-process (its landing IS the
         record's transaction) and is not keyed. */
      if (ad.profile.keyed || async) {
        if (!req.key) {
          state.adapterSeq = (state.adapterSeq || 0) + 1;
          req.key = req.via + '-' + state.adapterSeq;
        }
        a.key = req.key;
      }
      r = ad.submit(state, a);
    } else {
      r = world.run(state, req, prep, opts);
    }
    if (!r || r.ok === false) return no((r && r.reason) || 'The act did not go through. Nothing was done.', r && r.unbalanced ? { unbalanced: true } : null);

    /* 6. one attribution writer — a SENT act is recorded in
       state.sentActs, attributed exactly as a landed act is (who, via,
       the words heard) plus its key; it lands (and is attributed on
       the record) only when the host's verdict says so. */
    if (r.sent) {
      var entry = sentAlready || find(state.sentActs, function (e) { return e.key === a.key; });
      if (!entry) {
        entry = { key: a.key, via: req.via, who: req.who, intent: req.intent, target: a.target,
          params: plain(a.params), words: a.words, ts: nowTs(), status: 'sent' };
        if (!state.sentActs) state.sentActs = [];
        state.sentActs.push(entry);
      }
      return { ok: true, result: { sent: true, key: a.key, host: ad.profile.hostLabel, entry: entry,
        text: 'Sent to ' + ad.profile.hostLabel + ' — waiting on it to confirm.' } };
    }
    attribute(state, mark, req, world.taskId(req, prep, r), prep.words);
    return { ok: true, result: r };
  }

  /* A SENT act still waiting on the host for the same act on the same
     target: the task stays open and in hand, and a fresh act on it is
     not sent twice. A retry of the same act (same key) goes through. */
  function pendingFor(state, req, prep, world) {
    var tid = world.taskId(req, prep);
    if (!tid) {
      return req.key ? find(state.sentActs, function (e) { return e.key === req.key && e.status === 'sent'; }) : null;
    }
    return find(state.sentActs, function (e) { return e.status === 'sent' && e.intent === req.intent && e.target === tid; });
  }

  function nowTs() { var W = wms(); return W && W.now ? W.now() : new Date().toISOString(); }

  /* The host's 'landed' verdict on a SENT act (called by the adapter's
     confirmation handler): the act's effect lands through the one land
     path, and check 6 attributes it exactly as a sync landing is. */
  function settle(state, entry) {
    var A = adapters();
    if (!A) return no('The host adapter is not loaded. Nothing was done.');
    var mark = (state.records || []).length;
    var r = A.land(state, entry);
    if (!r || r.ok === false) return no((r && r.reason) || 'The act did not go through. Nothing was done.');
    attribute(state, mark, entry, entry.intent === 'complete' ? entry.target : null, entry.words);
    return r;
  }

  var api = {
    act: act,
    settle: settle,
    POLICY: POLICY,
    OUTAGE: OUTAGE,
    PARTIAL_OR_FULL: PF,
    completionPlan: completionPlan,
    plans: { pick: pickPlan, putaway: putawayPlan, count: countPlan, cartons: cartonsPlan },
    normBin: normBin
  };
  root.WitnessGate = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
