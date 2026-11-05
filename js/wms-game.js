/* =====================================================================
   wms-game.js — "Walk the shift": a small game on the warehouse map
   (William, 2026-11-04 — submission day; moved onto the map itself
   and given a voice the same day, at his correction).

   The WMS needed something for a person to actually DO in it, beyond
   watching the glasses demo. The stage is the Warehouse Map — the
   whole building, not a slice: a circle marked YOU is the worker,
   and it travels the real map (inbound dock → Receiving Bay → bay
   location) as the shift is worked.

   The loop mimics directed work, the way a warehouse worker using
   this program actually works: the program OFFERS one task at a
   time (task + destination, in the panel, the way the glasses would
   say it), the worker walks to it, and confirms it done — by voice
   first ("Complete"), the way the real flow is confirmed. The next
   task is offered automatically; the worker never hunts for what to
   do next. Clicking the offered place, or the panel's button, does
   the same step for hands that can't talk right now.

   The panel offers a SHIFT TYPE (William, 2026-11-04): Inbound dock
   worker (the original shift — check in at a dock, bring a pallet
   into the Receiving Bay, put it away, put a second pallet away,
   then spot-count the first bin), Outbound loader (pick an allocated
   order's lines, pack it, load it at its outbound dock, verify-count
   the picked bins), Replenishment (pick the line that takes a pick
   face below its minimum, work the replenishment the system itself
   then deals from reserve, count the face and the reserve), and
   Cycle counter (spot-count the building's fullest bins). Each role
   deals its own chain from the state as it stands, out of the
   engine's real tasks only — nothing is invented to fill a chain,
   and a role this state cannot deal deals nothing. Every step
   performs the real operation on the state underneath (the tasks are
   the console's own, completed through js/wms.js; the spot counts
   are real cycle counts), so the map, the tables and the audit
   trail all update as the shift is worked. It is a shift, not an
   arcade: no score, no points — the finish is a shift summary.

   Voice rides the console's own mic plumbing (js/warehouse-mic.js →
   the Worker's /asr), wired by wms-ui.js to the panel's hold-to-talk
   button — and then the worker is TALKING TO META. The transcript
   goes, with the live shift context (the offered task, what is
   still to come, where the worker stands), through the console's
   /chat to Muse Spark (js/wms-ai.js's gameTurn, handed in here as
   a capability — this module still makes no network calls of its
   own). META answers in her own voice and, when the words work the
   shift, names the action as an intent; the game runs intents
   through the very same paths the buttons use, and her words are
   shown as the response only after the act has really resolved —
   a refused act discards them for the honest note. Questions and
   problem reports change nothing and are answered from the context;
   whether a request belongs to warehouse work at all is META's own
   judgment, in her prompt — no code here filters topics.
   voiceCommand() below remains as the offline fallback: a pure
   matcher, used when the /chat call fails, that takes a transcript
   to one command or nothing. Either way, a voice action can only
   ever work the CURRENT offered task — the same honesty as the
   click path.

   Hard rule: the game runs ONLY on a practice copy (?practice=1,
   the in-memory state that is never saved). On the live desk record
   the panel just says so and links to a practice copy — the dummy
   tasks can never touch the real record.

   Shape of the module:
     - Pure logic (node-tested): buildChain deals the inbound five;
       buildShift deals any role's chain from a state; direct() aims
       the inbound putaway tasks at the chosen bins; performStep /
       armCount / confirmCount mutate a state exactly the way the
       controller asks them to; voiceCommand() matches a transcript
       to a shift command; voiceContext() composes what META is told
       about the live shift.
     - The DOM controller (browser only) owns the circle, the pulse
       on the target cell, the panel's live state, the voice line
       and auto-run. wms-ui.js hands it capabilities (its act()
       mutation path, the current state, the practice flag, render)
       after every render; the game never reaches around it.
   Loads in the browser (window.WmsGame) and in node.
   ===================================================================== */
(function (root) {
  'use strict';

  var E = root.WitnessEngine || null;
  var W = root.WitnessWms || null;
  if (typeof require === 'function') {
    try { if (!E) E = require('./engine.js'); } catch (e) { /* browser */ }
    try { if (!W) W = require('./wms.js'); } catch (e) { /* browser */ }
  }

  var TOTAL = 5;
  var GLIDE_MS = 600;     /* the circle's walk between cells */
  var PAUSE_MS = 300;     /* a beat on arrival — auto-run's cadence is ~900 ms a leg */

  /* ---------- small pure helpers ----------------------------------- */

  function find(list, pred) {
    var l = list || [];
    for (var i = 0; i < l.length; i++) if (pred(l[i])) return l[i];
    return null;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function shortDesc(d) { return String(d || '').replace(/ — .*/, ''); }
  function doorNo(id) { var m = /(\d+)\s*$/.exec(String(id || '')); return m ? +m[1] : null; }
  function dockName(doorId) { return String(doorId || '').replace('Door', 'Dock'); }
  function laneName(doorId) { return 'Receiving Bay ' + (doorNo(doorId) || ''); }
  function binById(state, id) { return find(state.bins, function (b) { return b.id === id; }); }
  function palletById(state, id) { return find(state.staging, function (p) { return p.id === id; }); }
  function openPutawayFor(state, palletId) {
    return find(state.tasks, function (t) { return t.type === 'putaway' && t.stagingId === palletId && t.status !== 'done'; });
  }
  function emptyBins(state) {
    return (state.bins || []).filter(function (b) { return !b.contents.length && b.status !== 'hold'; })
      .slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; });
  }
  /* A record in the engine's own shape ({ts, text, kind…}) — the
     audit trail is real state, and the game's steps belong on it. */
  function record(state, text) {
    state.records = state.records || [];
    state.records.push({ ts: new Date().toISOString(), text: text, kind: 'game' });
  }
  function no(reason) { return { ok: false, reason: reason }; }

  /* ---------- the chain: five tasks, dealt from the state ---------- */
  /* Reads state only — never writes. The working pallet is a staged
     pallet whose door has a shipment at it (the truck you check in);
     failing that, the first staged pallet in id order. Destination
     bins are scanned from the state at build time: the putaway
     task's own directed bin when that bin is empty, else the first
     empty bin — never a hardcoded bin, never the same bin twice.
     Returns null when the building cannot deal a shift (fewer than
     two workable pallets, or fewer than two empty bins). */
  function buildChain(state) {
    if (!state || !state.staging || !state.bins) return null;
    var pallets = state.staging.filter(function (p) { return !p.hold && openPutawayFor(state, p.id); })
      .slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    if (pallets.length < 2) return null;
    var atShipDoor = pallets.filter(function (p) {
      return (state.inbound || []).some(function (s) { return s.door === p.door && s.status === 'staged at door'; });
    });
    var palletA = atShipDoor[0] || pallets[0];
    var palletB = pallets.filter(function (p) { return p.id !== palletA.id; })[0];
    var empties = emptyBins(state);
    if (empties.length < 2) return null;
    var taskA = openPutawayFor(state, palletA.id);
    var taskB = openPutawayFor(state, palletB.id);

    function choose(task, avoid) {
      if (task && task.toBinId && task.toBinId !== avoid) {
        var b = binById(state, task.toBinId);
        if (b && !b.contents.length && b.status !== 'hold') return b.id;
      }
      for (var i = 0; i < empties.length; i++) if (empties[i].id !== avoid) return empties[i].id;
      return null;
    }
    var binA = choose(taskA, null);
    var binB = choose(taskB, binA);
    if (!binA || !binB) return null;

    var door = palletA.door;
    var apts = ((state.wms && state.wms.appointments) || []).filter(function (a) {
      return a.door === door && a.status !== 'complete' && a.status !== 'cancelled';
    });
    var apt = find(apts, function (a) { return a.status === 'scheduled'; }) || apts[0] || null;

    /* Each step carries an OFFER: the task the way the program would
       offer it to a worker — the work and its destination, nothing
       about how to click. The panel presents it as "Next task: …". */
    var steps = [
      { kind: 'checkin', target: { place: 'dock', id: door },
        offer: 'Check in at ' + dockName(door) + '.' },
      { kind: 'toBay', pallet: palletA.id, from: { place: 'dock', id: door }, target: { place: 'receiving', id: door },
        offer: 'Move Pallet ' + palletA.id + ' to ' + laneName(door) + '.' },
      { kind: 'putaway', pallet: palletA.id, task: taskA.id, bin: binA, from: { place: 'receiving', id: door }, target: { place: 'bin', id: binA },
        offer: 'Put Pallet ' + palletA.id + ' away — Stage: Bin ' + binA + '.' },
      { kind: 'putaway', pallet: palletB.id, task: taskB.id, bin: binB, from: { place: 'receiving', id: palletB.door }, target: { place: 'bin', id: binB },
        offer: 'Put Pallet ' + palletB.id + ' away — Stage: Bin ' + binB + '.' },
      { kind: 'count', bin: binA, target: { place: 'bin', id: binA },
        offer: 'Spot count Bin ' + binA + '.' }
    ];
    return { role: 'inbound', door: door, palletA: palletA.id, palletB: palletB.id, binA: binA, binB: binB,
      taskA: taskA.id, taskB: taskB.id, aptId: apt ? apt.id : null,
      startAt: { place: 'dock', id: door }, steps: steps };
  }

  /* ---------- shift types ------------------------------------------ */
  /* Each role deals from the state as it stands, out of tasks the
     system itself has already dealt — a role whose work is not in
     the building deals null, and the panel says so plainly. */

  var ROLES = [
    { id: 'inbound', label: 'Inbound dock worker' },
    { id: 'outbound', label: 'Outbound loader' },
    { id: 'replenishment', label: 'Replenishment' },
    { id: 'counter', label: 'Cycle counter' }
  ];
  function roleLabel(id) {
    var r = find(ROLES, function (x) { return x.id === id; });
    return r ? r.label : ROLES[0].label;
  }
  /* The role label with its article, so the line reads right for
     every role: "an Inbound dock worker", "a Cycle counter". */
  function aRole(id) {
    var label = roleLabel(id);
    return (/^[aeiou]/i.test(label) ? 'an ' : 'a ') + label;
  }
  /* The one cannot-deal line: names the REQUESTED shift and says
     plainly that a fresh practice copy is what deals it again. */
  function cannotDeal(id) {
    return 'This practice building cannot deal ' + aRole(id) + ' shift — its work for that shift is spent. ' +
      'Reload the practice copy for a fresh building, or try another shift type.';
  }
  function openPicksFor(state, orderId) {
    return (state.tasks || []).filter(function (t) {
      return t.type === 'pick' && t.orderId === orderId && t.status !== 'done';
    }).slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; });
  }
  function qtyOf(binObj, desc) {
    var q = 0;
    (binObj ? binObj.contents : []).forEach(function (c) { if (c.desc === desc) q += c.qty; });
    return q;
  }

  /* Outbound loader: work one allocated order end to end — pick its
     lines (up to two), pack it at its door, load it, then verify the
     picked bins with spot counts. The pack and load tasks do not
     exist at deal time; the system deals them itself once the order
     is fully picked, and performStep resolves them by id then. */
  function buildOutbound(state) {
    if (!state || !state.outbound || !state.tasks) return null;
    var orders = state.outbound.filter(function (o) { return o.status === 'allocated'; })
      .slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    var order = null, picks = [];
    for (var i = 0; i < orders.length; i++) {
      var ps = openPicksFor(state, orders[i].id);
      if (ps.length) { order = orders[i]; picks = ps.slice(0, 2); break; }
    }
    if (!order) return null;
    var door = order.door || 'Outbound Door 4';
    var steps = picks.map(function (t) {
      return { kind: 'pick', task: t.id, orderId: order.id, bin: t.binId, desc: t.desc, qty: t.qty,
        target: { place: 'bin', id: t.binId },
        offer: 'Pick ' + t.qty + ' × ' + t.desc + ' from Bin ' + t.binId + ' for ' + order.id + '.' };
    });
    steps.push({ kind: 'pack', orderId: order.id, target: { place: 'staging', id: door },
      offer: 'Pack ' + order.id + ' and stage it at ' + dockName(door) + '.' });
    steps.push({ kind: 'load', orderId: order.id, target: { place: 'dock', id: door },
      offer: 'Load ' + order.id + ' at ' + dockName(door) + '.' });
    var counted = {};
    picks.forEach(function (t) {
      if (steps.length >= 5 || counted[t.binId]) return;
      counted[t.binId] = true;
      steps.push({ kind: 'count', bin: t.binId, target: { place: 'bin', id: t.binId },
        offer: 'Spot count Bin ' + t.binId + '.' });
    });
    if (steps.length < 5) {
      var rest = emptyStockedBins(state).filter(function (b) { return !counted[b.id]; });
      for (var j = 0; j < rest.length && steps.length < 5; j++) {
        counted[rest[j].id] = true;
        steps.push({ kind: 'count', bin: rest[j].id, target: { place: 'bin', id: rest[j].id },
          offer: 'Spot count Bin ' + rest[j].id + '.' });
      }
    }
    if (steps.length < 4) return null;
    return { role: 'outbound', orderId: order.id, door: door,
      startAt: { place: 'bin', id: picks[0].binId }, steps: steps };
  }
  function emptyStockedBins(state) {
    return (state.bins || []).filter(function (b) { return b.contents.length && b.status !== 'hold'; })
      .slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; });
  }

  /* Replenishment: the honest trigger. A pick face sits at or above
     its minimum; an open pick against that face would take it below;
     and another bin holds reserve the system's own generator can
     pull. The chain works the pick — the console's refresh then
     deals the real replenishment task itself — works that task, and
     counts the face and the reserve. If any leg of that is missing
     (no face near its min, no triggering pick, no reserve), the
     role cannot be dealt from this state and deals null. */
  function buildReplenishment(state) {
    if (!state || !state.wms || !state.wms.slots || !W) return null;
    var slots = state.wms.slots;
    for (var i = 0; i < slots.length; i++) {
      var slot = slots[i];
      var face = binById(state, slot.binId);
      if (!face || face.status === 'hold') continue;
      var cur = qtyOf(face, slot.desc);
      if (cur < slot.min) continue;   /* already short: the generator has dealt (or exceptioned) it — not this chain's trigger */
      var picks = (state.tasks || []).filter(function (t) {
        return t.type === 'pick' && t.status !== 'done' && t.binId === slot.binId &&
          t.desc === slot.desc && cur - t.qty < slot.min;
      }).slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; });
      if (!picks.length) continue;
      var reserve = null;
      state.bins.forEach(function (b) {
        if (reserve || b.id === slot.binId || b.status === 'hold') return;
        if (W.freeIn(state, b, slot.desc) > 0) reserve = b;
      });
      if (!reserve) continue;
      var p = picks[0];
      var steps = [
        { kind: 'pick', task: p.id, orderId: p.orderId, bin: p.binId, desc: p.desc, qty: p.qty,
          target: { place: 'bin', id: p.binId },
          offer: 'Pick ' + p.qty + ' × ' + p.desc + ' from Bin ' + p.binId + ' for ' + p.orderId + '.' },
        { kind: 'replen', faceBin: slot.binId, desc: slot.desc, reserveBin: reserve.id,
          from: { place: 'bin', id: reserve.id }, target: { place: 'bin', id: slot.binId },
          offer: 'Replenish Bin ' + slot.binId + ' — bring ' + slot.desc + ' from reserve Bin ' + reserve.id + '.' },
        { kind: 'count', bin: slot.binId, target: { place: 'bin', id: slot.binId },
          offer: 'Spot count Bin ' + slot.binId + '.' },
        { kind: 'count', bin: reserve.id, target: { place: 'bin', id: reserve.id },
          offer: 'Spot count Bin ' + reserve.id + '.' }
      ];
      return { role: 'replenishment', faceBin: slot.binId, reserveBin: reserve.id, desc: slot.desc,
        startAt: { place: 'bin', id: p.binId }, steps: steps };
    }
    return null;
  }

  /* Cycle counter: spot-count the building's fullest bins — the
     counts a counter is actually sent to verify. Four bins, each
     resolved through the same arm-and-confirm flow as the inbound
     shift's last step. */
  function buildCounter(state) {
    if (!state || !state.bins) return null;
    var stocked = (state.bins || []).filter(function (b) { return b.contents.length && b.status !== 'hold'; })
      .map(function (b) {
        return { bin: b, total: b.contents.reduce(function (n, c) { return n + c.qty; }, 0) };
      })
      .sort(function (a, b) { return (b.total - a.total) || (a.bin.id < b.bin.id ? -1 : 1); })
      .slice(0, 4);
    if (stocked.length < 4) return null;
    var steps = stocked.map(function (x) {
      return { kind: 'count', bin: x.bin.id, target: { place: 'bin', id: x.bin.id },
        offer: 'Spot count Bin ' + x.bin.id + '.' };
    });
    return { role: 'counter', startAt: { place: 'bin', id: stocked[0].bin.id }, steps: steps };
  }

  var BUILDERS = { inbound: buildChain, outbound: buildOutbound, replenishment: buildReplenishment, counter: buildCounter };
  function buildShift(state, role) {
    var b = BUILDERS[role] || buildChain;
    return b(state);
  }

  /* Aim the chain's two putaway tasks at the chosen bins, so the
     Receiving slice draws both bins (a bin shows when it has a
     reason) and the putaway table agrees with the game. */
  function direct(state, chain) {
    if (!chain) return chain;
    var tA = find(state.tasks, function (t) { return t.id === chain.taskA; });
    var tB = find(state.tasks, function (t) { return t.id === chain.taskB; });
    if (tA && tA.status !== 'done') tA.toBinId = chain.binA;
    if (tB && tB.status !== 'done') tB.toBinId = chain.binB;
    return chain;
  }

  /* Deal a shift onto a state: build for the role (inbound unless
     one is named), direct (the inbound chain's aim), and write the
     start onto the record. Returns { ok, chain } or
     { ok:false, reason }. */
  function begin(state, role) {
    role = role || 'inbound';
    var chain = buildShift(state, role);
    if (!chain) return no(cannotDeal(role));
    if (chain.role === 'inbound') direct(state, chain);
    record(state, chain.role === 'inbound'
      ? 'Walk the shift started — five receiving tasks on a practice copy.'
      : 'Walk the shift started — ' + roleLabel(chain.role) + ', ' + chain.steps.length + ' tasks on a practice copy.');
    return { ok: true, chain: chain };
  }

  /* ---------- performing the steps (pure mutations) ----------------- */

  function performStep(state, chain, i) {
    var step = chain && chain.steps[i];
    if (!step) return no('No such step.');
    if (step.kind === 'checkin') {
      var apt = chain.aptId ? find((state.wms && state.wms.appointments) || [], function (a) { return a.id === chain.aptId; }) : null;
      if (apt && apt.status === 'scheduled') {
        if (!W) return no('The WMS layer is not loaded.');
        var r = W.checkIn(state, apt.id, null);
        if (!r.ok) return r;
        record(state, 'Checked in ' + apt.shipmentId + ' at ' + chain.door + ' (Walk the shift, task 1 of 5).');
        return { ok: true };
      }
      var ship = find(state.inbound || [], function (s) { return s.door === chain.door && s.status === 'staged at door'; });
      record(state, 'Checked in at ' + chain.door + (ship ? ' — ' + ship.id + ' confirmed at the dock' : '') + ' (Walk the shift, task 1 of 5).');
      return { ok: true };
    }
    if (step.kind === 'toBay') {
      var p = palletById(state, step.pallet);
      if (!p) return no('Pallet ' + step.pallet + ' is no longer staged.');
      p.atBay = true;
      record(state, 'Moved Pallet ' + p.id + ' (' + p.qty + ' × ' + p.desc + ') from ' + p.door + ' into ' + laneName(p.door) + ' (Walk the shift, task 2 of 5).');
      return { ok: true };
    }
    if (step.kind === 'putaway') {
      if (!W) return no('The WMS layer is not loaded.');
      return W.complete(state, step.task, { binId: step.bin, by: null });
    }
    if (step.kind === 'pick') {
      if (!W) return no('The WMS layer is not loaded.');
      return W.complete(state, step.task, { qty: step.qty, by: null });
    }
    if (step.kind === 'pack') {
      if (!W) return no('The WMS layer is not loaded.');
      var pk = find(state.tasks, function (t) { return t.id === 't-pack-' + step.orderId && t.status !== 'done'; });
      if (!pk) return no('No pack task is waiting for ' + step.orderId + ' — the order is not fully picked yet.');
      return W.complete(state, pk.id, { by: null });
    }
    if (step.kind === 'load') {
      if (!W) return no('The WMS layer is not loaded.');
      var ld = find(state.tasks, function (t) { return t.id === 't-load-' + step.orderId && t.status !== 'done'; });
      if (!ld) return no('No load task is waiting for ' + step.orderId + ' — the order is not staged at its door yet.');
      return W.complete(state, ld.id, { by: null });
    }
    if (step.kind === 'replen') {
      if (!W) return no('The WMS layer is not loaded.');
      var rp = find(state.tasks, function (t) { return t.type === 'replen' && t.toBinId === step.faceBin && t.status !== 'done'; });
      if (!rp) return no('No replenishment task has been dealt for Bin ' + step.faceBin + ' — the pick that triggers it has not landed yet.');
      return W.complete(state, rp.id, { by: null });
    }
    return no('Step ' + (i + 1) + ' is worked from the panel, not performed directly.');
  }

  /* The count step an arm / confirm acts on: the step at idx, or —
     for the original callers — the chain's last step (the inbound
     shift's spot count). */
  function countStep(chain, idx) {
    var steps = (chain && chain.steps) || [];
    var i = idx == null ? steps.length - 1 : idx;
    return steps[i] && steps[i].kind === 'count' ? steps[i] : null;
  }

  /* Count step, first half: queue the real cycle count for the bin. */
  function armCount(state, chain, idx) {
    if (!W) return no('The WMS layer is not loaded.');
    var step = countStep(chain, idx);
    if (!step) return no('This step is not a count.');
    var r = W.cycleCount(state, [step.bin], { reason: 'Walk the shift — spot count', by: null });
    if (!r.ok) return r;
    step.countTaskId = r.tasks[0];
    var n = (idx == null ? chain.steps.length - 1 : idx) + 1;
    record(state, 'Spot count queued for bin ' + step.bin + ' (Walk the shift, task ' + n + ' of ' + chain.steps.length + ').');
    return { ok: true, taskId: step.countTaskId };
  }

  /* What a counter standing at the bin would see, from the state. */
  function countContents(state, binId) {
    var b = binById(state, binId);
    var counts = {}, lines = [];
    if (b) b.contents.forEach(function (c) { counts[c.desc] = c.qty; lines.push({ desc: c.desc, qty: c.qty }); });
    return { counts: counts, lines: lines };
  }

  /* Count step, second half: post the count the panel showed.
     Counted honestly — the player counted what is in the bin — so
     a clean count lands as "matches", a real CC record either way. */
  function confirmCount(state, chain, idx) {
    if (!W) return no('The WMS layer is not loaded.');
    var step = countStep(chain, idx);
    if (!step || !step.countTaskId) return no('The count has not been queued yet.');
    return W.complete(state, step.countTaskId, { counts: countContents(state, step.bin).counts, by: null });
  }

  function elapsedText(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  /* ---------- voice commands (pure) — the offline fallback ---------- */
  /* The fallback vocabulary of the shift, matched exactly on the
     normalised transcript — the utterance must BE the command, not
     merely contain it, so ordinary speech about the work ("completely
     wrong pallet, this one") can never fire a step. This matcher is
     what runs when META cannot be reached; when she can, she is the
     one who hears the worker (see hear() below). Returns one of
     'start' | 'complete' | 'confirm' | 'auto', or null when the words
     are not a shift command (nothing is done with them). */
  function voiceCommand(text) {
    var t = String(text == null ? '' : text).toLowerCase()
      .replace(/['’]/g, '').replace(/[.!?,;:""]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return null;
    if (/^(start|begin)( the)?( shift| job| work)?$/.test(t)) return 'start';
    if (/^auto ?run( on| off)?$/.test(t)) return 'auto';
    if (/^(confirm|confirmed|confirm count|confirm the count|count confirmed)$/.test(t)) return 'confirm';
    if (/^(complete|completed|done|finished|all done|done with this one|complete this one|complete task|complete this task|complete it|task complete|task done|done task|mark it complete|mark complete|finish it|finished it|that is done|thats done|i am done|im done)$/.test(t)) return 'complete';
    return null;
  }

  /* ==================================================================
     The DOM controller — browser only. Everything below reads the
     session and the capabilities wms-ui.js hands over in
     afterRender(); nothing here runs at load, and node never reaches
     it (the pure half above is the whole node surface).
     ================================================================== */

  var CTX = null;        /* { act, state, practice, base, render, talk } — refreshed every render */
  var session = null;    /* the shift being played, or null */
  var voiceNote = null;  /* { text, did, meta } — the last words heard, quoted, what they did, and META's line */
  var autoWanted = false;
  var roleWanted = 'inbound';  /* the Shift type the panel has selected */
  var cssDone = false;
  var autoTimer = null;

  function cur() { return session && !session.done ? session.chain.steps[session.i] : null; }
  /* The shift type in play: the running chain's own role while a
     shift runs; otherwise — no shift yet, or the last one finished —
     the type the panel has selected, which is the shift that starts
     next. A finished shift never names the next one. */
  function activeRole() { return session && !session.done ? session.chain.role : roleWanted; }
  function total() { return session ? session.chain.steps.length : TOTAL; }
  function samePlace(a, b) { return !!a && !!b && a.place === b.place && a.id === b.id; }
  function wait(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

  function injectCss() {
    if (cssDone || typeof document === 'undefined') return;
    cssDone = true;
    var st = document.createElement('style');
    st.id = 'wms-game-css';
    st.textContent =
      '.game-you{position:absolute;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;' +
      'background:#f2c94c;color:#1c2733;border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.45);' +
      'font:700 11px/40px system-ui,sans-serif;text-align:center;letter-spacing:.04em;z-index:30;pointer-events:none;' +
      'transition:left ' + GLIDE_MS + 'ms ease,top ' + GLIDE_MS + 'ms ease}' +
      '.game-target{outline:3px solid #f2c94c !important;outline-offset:-3px;animation:gamepulse 1.1s ease-in-out infinite}' +
      '@keyframes gamepulse{0%,100%{outline-color:rgba(242,201,76,.95)}50%{outline-color:rgba(242,201,76,.25)}}';
    document.head.appendChild(st);
  }

  /* The stage is the Warehouse Map board itself (js/wms-map.js):
     its cells already carry the data-place / data-id hooks the game
     aims at — the inbound dock, its Receiving Bay lane, the bin. */
  function stageEl() { return typeof document === 'undefined' ? null : document.querySelector('#main .wm-board'); }

  function cellEl(place, id) {
    var c = stageEl();
    if (!c) return null;
    return c.querySelector('[data-place="' + place + '"][data-id="' + String(id).replace(/"/g, '') + '"]');
  }

  function cellPx(place, id) {
    var c = stageEl(), cell = cellEl(place, id);
    if (!c || !cell) return null;
    var cr = c.getBoundingClientRect(), r = cell.getBoundingClientRect();
    return { x: r.left - cr.left + r.width / 2, y: r.top - cr.top + r.height / 2 };
  }

  function circleEl(create) {
    var c = stageEl();
    if (!c) return null;
    var el = c.querySelector('.game-you');
    if (!el && create) {
      el = document.createElement('div');
      el.className = 'game-you';
      el.textContent = 'YOU';
      el.setAttribute('aria-hidden', 'true');
      c.appendChild(el);
    }
    return el;
  }

  /* (Re)place the circle and the target pulse on the fresh DOM after
     a render. With session.glideTo set, the circle starts from its
     last pixel position and walks; otherwise it snaps to where the
     worker stands. */
  function mount() {
    if (!CTX || CTX.base !== 'dashboard' || !CTX.practice || !session) { removeCircle(); return; }
    var c = stageEl();
    if (!c) { removeCircle(); return; }
    injectCss();
    if (window.getComputedStyle(c).position === 'static') c.style.position = 'relative';
    var el = circleEl(true);
    if (!el) return;
    var step = cur();
    Array.prototype.forEach.call(c.querySelectorAll('.game-target'), function (x) { x.classList.remove('game-target'); });
    if (step) { var t = cellEl(step.target.place, step.target.id); if (t) t.classList.add('game-target'); }
    var dest = session.glideTo || session.at;
    var px = dest ? cellPx(dest.place, dest.id) : null;
    /* A cell can be re-drawn mid-glide (a worked pallet's chip
       leaves its lane the moment its task completes). Fall back to
       the pixel position the cell held when the step began, so the
       circle still walks to where the cell was. */
    if (!px && session.glideTo && session.glidePx) px = session.glidePx;
    if (!px) { el.style.display = 'none'; return; }
    el.style.display = '';
    if (session.glideTo && session.px) {
      el.style.transition = 'none';
      el.style.left = session.px.x + 'px'; el.style.top = session.px.y + 'px';
      void el.offsetWidth; /* settle, then walk */
      el.style.transition = '';
    }
    el.style.left = px.x + 'px'; el.style.top = px.y + 'px';
    session.px = px;
    session.glideTo = null;
    session.glidePx = null;
  }

  function removeCircle() {
    if (typeof document === 'undefined') return;
    Array.prototype.forEach.call(document.querySelectorAll('.game-you'), function (el) { el.remove(); });
  }

  /* Walk the circle on the CURRENT DOM (no state change yet) — the
     pick-up leg of a move, before the mutation re-renders. */
  function glideInPlace(place) {
    var el = circleEl(false), px = cellPx(place.place, place.id);
    if (!el || !px) return;
    el.style.left = px.x + 'px'; el.style.top = px.y + 'px';
    session.px = px;
  }

  function finish() {
    session.done = true;
    session.finishedAt = Date.now();
    session.auto = false;
    if (CTX && CTX.render) CTX.render();
  }

  function scheduleAuto() {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(function () {
      if (session && session.auto && !session.done && !session.busy) doStep();
    }, 80);
  }

  /* Work the current step: walk to the source if the step has one,
     mutate through the console's own act() (which re-renders; the
     circle's landing glide happens in mount() via glideTo), then
     settle and, under auto-run, queue the next step. */
  function doStep() {
    if (!session || session.busy || session.done || !CTX) return Promise.resolve();
    var step = cur();
    if (!step) return Promise.resolve();
    session.busy = true;
    var sess = session, chain = session.chain, idx = session.i;
    var chainP = Promise.resolve();
    if (step.from && !samePlace(step.from, session.at)) {
      session.at = step.from;
      glideInPlace(step.from);
      chainP = wait(GLIDE_MS + PAUSE_MS);
    }
    return chainP.then(function () {
      if (session !== sess) return; /* the shift was reset (practice switched) mid-walk */
      if (step.kind === 'count' && !session.countArmed) {
        session.glideTo = step.target;
        session.glidePx = cellPx(step.target.place, step.target.id);
        return CTX.act(function (s) { return armCount(s, chain, idx); }, null).then(function (r) {
          session.busy = false;
          if (r && r.ok) {
            session.countArmed = true;
            session.at = step.target;
            if (CTX.render) CTX.render(); else mount(); /* re-render: the panel now shows the count to confirm */
            if (session.auto) scheduleAuto();
          }
        });
      }
      if (step.kind === 'count') return confirm().then(function () { session.busy = false; });
      session.glideTo = step.target;
      session.glidePx = cellPx(step.target.place, step.target.id);
      return CTX.act(function (s) { return performStep(s, chain, idx); }, null).then(function (r) {
        session.busy = false;
        if (r && r.ok) {
          session.i++;
          session.at = step.target;
          if (session.i >= chain.steps.length) { finish(); return; }
          /* act() rendered while the session still pointed at the
             finished step; render again so the panel names the NEXT
             task (afterRender re-places the circle and the pulse). */
          if (CTX.render) CTX.render(); else mount();
          if (session.auto) scheduleAuto();
        }
      });
    }).catch(function () { sess.busy = false; });
  }

  function confirm() {
    if (!session || !session.countArmed || !CTX) return Promise.resolve();
    var chain = session.chain, idx = session.i, step = chain.steps[idx];
    return CTX.act(function (s) { return confirmCount(s, chain, idx); }, null).then(function (r) {
      if (r && r.ok) {
        session.countArmed = false;
        session.i = idx + 1;
        session.at = step.target;
        if (session.i >= chain.steps.length) { finish(); return; }
        /* a mid-chain count (the Cycle counter's whole shift): the
           panel now offers the next count */
        if (CTX.render) CTX.render(); else mount();
        if (session.auto) scheduleAuto();
      }
    });
  }

  /* ---------- the hooks wms-ui.js calls ----------------------------- */

  function afterRender(ctx) {
    CTX = ctx;
    mount();
    if (typeof window !== 'undefined' && !afterRender._rz) {
      afterRender._rz = true;
      window.addEventListener('resize', function () { if (session) { session.px = null; mount(); } });
    }
  }

  /* The console switched practice copy on or off in place (no page
     load): forget the shift exactly as a fresh page load would — no
     session, no voice line, the panel's selections back to their
     defaults, no circle on the board. */
  function reset() {
    clearTimeout(autoTimer);
    session = null;
    voiceNote = null;
    autoWanted = false;
    roleWanted = 'inbound';
    removeCircle();
  }

  /* A click on a cell of the warehouse map: true when the game took
     it (the clicked cell is the current task's target). */
  function cellClick(target) {
    if (!session || session.done || session.busy || !CTX || CTX.base !== 'dashboard' || !CTX.practice) return false;
    if (!target || !target.closest) return false;
    var cell = target.closest('[data-place]');
    if (!cell || !cell.closest('.wm-board')) return false;
    var place = cell.getAttribute('data-place'), id = cell.getAttribute('data-id');
    if (place === 'pallet') {
      var lane = cell.closest('[data-place="receiving"]');
      if (!lane) return false;
      place = 'receiving'; id = lane.getAttribute('data-id');
    }
    if (place === 'order') {
      /* an outbound order chip sits inside its staging lane — the
         lane is the place the pack step aims at */
      var slane = cell.closest('[data-place="staging"]');
      if (!slane) return false;
      place = 'staging'; id = slane.getAttribute('data-id');
    }
    var step = cur();
    if (!step || step.target.place !== place || step.target.id !== id) return false;
    if (step.kind === 'count' && session.countArmed) return false; /* armed: the panel's Confirm is the action */
    doStep();
    return true;
  }

  /* The panel's buttons, by name. */
  function ui(name, value) {
    if (!CTX) return;
    if (name === 'role') {
      var next = find(ROLES, function (x) { return x.id === value; }) ? value : 'inbound';
      if (session && !session.done && session.chain.role === next) { if (CTX.render) CTX.render(); return Promise.resolve(); }
      roleWanted = next;
      if (!session || session.done) { if (CTX.render) CTX.render(); return Promise.resolve(); }
      /* Mid-shift switch: the dealt chain is set aside — the tasks
         it already finished stay on the record, because they were
         real work — and a fresh chain for the new role is dealt.
         The circle starts again from the new chain's first place. */
      var prevLabel = roleLabel(session.chain.role);
      clearTimeout(autoTimer);
      session = null;
      return CTX.act(function (s) { return begin(s, next); }, null).then(function (r) {
        if (r && r.ok && r.chain) {
          session = { chain: r.chain, i: 0, at: r.chain.startAt || { place: 'dock', id: r.chain.door }, px: null,
            auto: false, busy: false, countArmed: false, done: false, startedAt: Date.now(), finishedAt: 0, glideTo: null };
          voiceNote = { text: '', did: 'Shift type changed to ' + roleLabel(next) + ' — the ' + prevLabel +
            ' shift was set aside; the tasks it finished stay on the record.', meta: null };
        } else {
          voiceNote = { text: '', did: 'Shift type changed to ' + roleLabel(next) + ', but ' + cannotDeal(next).charAt(0).toLowerCase() + cannotDeal(next).slice(1) +
            ' The ' + prevLabel + ' shift was set aside; the tasks it finished stay on the record.', meta: null };
        }
        if (CTX.render) CTX.render();
      });
    }
    if (name === 'auto') {
      if (session) session.auto = !session.auto; else autoWanted = !autoWanted;
      if (CTX.render) CTX.render();
      if (session && session.auto && !session.done) scheduleAuto();
      return;
    }
    if (name === 'start') {
      if (session && session.busy) return Promise.resolve();
      var wasAuto = session ? session.auto : autoWanted;
      return CTX.act(function (s) { return begin(s, roleWanted); }, null).then(function (r) {
        if (r && r.ok && r.chain) {
          session = { chain: r.chain, i: 0, at: r.chain.startAt || { place: 'dock', id: r.chain.door }, px: null,
            auto: wasAuto, busy: false, countArmed: false, done: false, startedAt: Date.now(), finishedAt: 0, glideTo: null };
          if (CTX.render) CTX.render();
          if (session.auto) scheduleAuto();
        }
        return r;
      });
    }
    if (name === 'doit') { doStep(); return; }
    if (name === 'confirm') {
      if (session && !session.busy) { session.busy = true; return confirm().then(function () { session.busy = false; }); }
      return Promise.resolve();
    }
  }

  /* ---------- voice in ---------------------------------------------- */
  /* wms-ui.js wires the panel's hold-to-talk button through the
     console's own mic (js/warehouse-mic.js) and hands each transcript
     here. The worker is talking to META: the transcript and the live
     shift context go through CTX.talk (the console's /chat path to
     Muse Spark, js/wms-ai.js's gameTurn), and META answers. Her
     action intents run through the same paths the buttons use
     (actOn, below); her words are shown as the response ONLY after
     the act has resolved — a refused or failed act discards them
     for the honest note, so she never gets to claim work that did
     not happen. Answers and clarifying questions change nothing and
     are shown as her line in the panel. If the call fails, the pure
     keyword matcher (voiceCommand) hears the words instead — the
     shift stays workable offline, with the same honesty: a voice
     action can only ever work the CURRENT offered task. 'Complete'
     on the count step, once the count is armed, confirms the count
     (that IS the pending action); 'confirm' anywhere else confirms
     nothing. */

  /* Where the worker stands, in words META (and the panel) can use. */
  function placeLabel(place) {
    if (!place) return null;
    if (place.place === 'dock') return dockName(place.id);
    if (place.place === 'receiving') return laneName(place.id);
    if (place.place === 'bin') return 'Bin ' + place.id;
    if (place.place === 'staging') return 'Outbound staging at ' + dockName(place.id);
    if (place.place === 'zone') return 'Zone ' + place.id;
    return String(place.id);
  }

  /* What META is told about the live shift: the active role's chain,
     the current offer verbatim, what is pending, every task still to
     come, and where the worker stands — enough to answer "what
     tasks do I need to do" truthfully, and nothing she could invent
     state from beyond it. Pure read of the session. */
  function voiceContext() {
    var role = activeRole();
    var ctx = { role: role, roleLabel: roleLabel(role), offer: null, step: 0, total: 0,
      pending: 'none', remaining: [], at: null, done: false };
    if (!session) return ctx;
    ctx.total = session.chain.steps.length;
    ctx.at = placeLabel(session.at);
    if (session.done) { ctx.done = true; return ctx; }
    var step = cur();
    if (!step) return ctx;
    ctx.offer = step.offer;
    ctx.step = session.i + 1;
    ctx.pending = step.kind === 'count' ? (session.countArmed ? 'count' : 'countStep') : 'step';
    ctx.remaining = session.chain.steps.slice(session.i + 1).map(function (s2) { return s2.offer; });
    return ctx;
  }

  function note(text, did, meta) {
    voiceNote = { text: text, did: did, meta: meta || null };
    if (CTX && CTX.render) CTX.render();
  }

  function hear(text) {
    if (!CTX || !CTX.practice || CTX.base !== 'dashboard') return;
    if (CTX.talk) {
      note(text, 'asking META…');
      var p = null;
      try { p = CTX.talk(voiceContext(), text); } catch (e) { p = null; }
      if (p && typeof p.then === 'function') {
        p.then(function (reply) {
          if (reply && reply.intent) applyReply(text, reply);
          else hearFallback(text);
        }, function () { hearFallback(text); });
        return;
      }
    }
    hearFallback(text);
  }

  /* META's reply, applied. 'answer' / 'none' touch nothing — her
     words are the response. An action intent goes to actOn with her
     words attached, to be shown only if the act lands. */
  function applyReply(text, reply) {
    if (reply.intent === 'answer') { note(text, 'META answered — the shift is unchanged.', reply.say); return; }
    if (reply.intent === 'none') { note(text, 'META could not tell what you meant — nothing was done.', reply.say); return; }
    actOn(reply.intent, text, reply.say);
  }

  /* The offline fallback: the keyword matcher hears the words. */
  function hearFallback(text) {
    actOn(voiceCommand(text), text, null);
  }

  /* One command, from META's intent or the matcher, worked through
     the panel's own paths. say is META's line (null from the
     fallback): it is attached to the note only on the branches where
     the act really happened. */
  function actOn(cmd, text, say) {
    if (cmd === 'start') {
      if (session && !session.done) { note(text, 'the shift is already under way — nothing changed.'); return; }
      var before = session;
      ui('start').then(function (r) {
        /* started only when a NEW chain was dealt — a finished shift
           still on the panel is not the one starting */
        if (session && session !== before) note(text, roleLabel(session.chain.role) + ' shift started — the first task is offered below.', say);
        else note(text, ((r && r.reason) || cannotDeal(roleWanted)) + ' Nothing was done.');
      });
      return;
    }
    if (cmd === 'auto') {
      var on = session ? !session.auto : !autoWanted;
      voiceNote = { text: text, did: 'auto-run ' + (on ? 'on — the shift works itself.' : 'off.'), meta: say || null };
      ui('auto'); /* renders */
      return;
    }
    if (cmd === 'confirm') {
      var st = cur();
      if (session && !session.done && st && st.kind === 'count' && session.countArmed) {
        ui('confirm').then(function () {
          if (session && (session.done || !session.countArmed)) note(text, 'count confirmed and posted.', say);
          else note(text, 'the count did not post — nothing was done.');
        });
        return;
      }
      note(text, 'nothing is waiting to be confirmed — nothing was done.');
      return;
    }
    if (cmd === 'complete') {
      var step = cur();
      if (!session) { note(text, 'no shift is dealt yet — say "start the shift" first. Nothing was done.'); return; }
      if (session.done) { note(text, 'the shift is already complete. Nothing was done.'); return; }
      if (session.busy) { note(text, 'the current task is still being worked. Nothing was done.'); return; }
      if (step && step.kind === 'count' && session.countArmed) {
        ui('confirm').then(function () {
          if (session && (session.done || !session.countArmed)) note(text, 'count confirmed and posted.', say);
          else note(text, 'the count did not post — nothing was done.');
        });
        return;
      }
      var n = session.i + 1, wasArmed = session.countArmed;
      doStep().then(function () {
        if (session && session.done) note(text, 'task ' + n + ' of ' + total() + ' worked — that finishes the shift.', say);
        else if (session && session.countArmed && !wasArmed) note(text, 'count queued for ' + ((cur() && cur().bin) || '') + ' — count what is there, then say "confirm".', say);
        else if (session && session.i >= n) note(text, 'task ' + n + ' of ' + total() + ' worked.', say);
        else note(text, 'that step did not go through — nothing was done.');
      });
      return;
    }
    note(text, 'that is not a shift command — nothing was done.');
  }

  /* Can this browser record at all? The same capability the mic
     module itself needs; where it is missing the panel says so
     plainly instead of offering a dead button. */
  function voiceOk() {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function' &&
      typeof MediaRecorder !== 'undefined';
  }

  /* ---------- the panel (Warehouse Map view only) ------------------- */
  /* panel is wms-ui.js's own panel() helper, handed in so the game
     panel is built exactly like every other console panel. state is
     the console's current state (the count confirm reads it).

     The panel presents the job loop: the current task is OFFERED
     ("Next task: …"), the hold-to-talk control leads (voice is how
     the work is confirmed), and the button / map click stand behind
     it as the fallback. What the voice heard is quoted back with
     what it did. */
  function talkRow(sayHint) {
    if (!voiceOk()) {
      return '<p class="hint">Voice needs a browser that can record audio — this one can\'t, so work the shift with the buttons and the map; they do the same steps.</p>';
    }
    return '<div class="form-actions"><button class="btn talk" id="gameTalk" type="button">🎙 Hold to talk</button>' +
      '<span class="hint" id="gameStatus"></span><span class="hint">' + sayHint + '</span></div>';
  }
  function heardLine() {
    if (!voiceNote) return '';
    var out = '';
    if (voiceNote.text) out += '<p class="hint">Heard: &ldquo;' + esc(voiceNote.text) + '&rdquo; — ' + esc(voiceNote.did) + '</p>';
    else if (voiceNote.did) out += '<p class="hint">' + esc(voiceNote.did) + '</p>';
    if (voiceNote.meta) out += '<p class="hint">META: &ldquo;' + esc(voiceNote.meta) + '&rdquo;</p>';
    return out;
  }

  /* The Shift type selector: the role the next shift is dealt as,
     or — mid-shift — the role switched to. The active role is the
     dealt chain's own while a shift runs. */
  function roleRow() {
    var active = activeRole();
    return '<p class="hint">Shift type</p><div class="form-actions">' + ROLES.map(function (r) {
      return '<button class="btn' + (r.id === active ? ' primary' : '') + '" data-act="game-role" data-role="' + r.id + '">' + esc(r.label) + '</button>';
    }).join('') + '</div>';
  }

  function panelHtml(panel, state, practice) {
    if (!practice) {
      return panel('Walk the shift',
        '<p>The game runs on a practice copy, so the real record stays clean. ' +
        'Open one and work a five-task receiving shift on the warehouse map below — tasks are offered one at a time and confirmed by voice, and every move lands on the practice record as it happens.</p>' +
        '<div class="form-actions"><a class="btn primary" href="wms.html?practice=1#/dashboard" data-act="enter-practice">Open a practice copy</a></div>');
    }
    var autoOn = session ? session.auto : autoWanted;
    var autoBtn = '<button class="btn" data-act="game-auto">Auto-run: ' + (autoOn ? 'On' : 'Off') + '</button>';
    if (!session) {
      var intro = roleWanted === 'inbound'
        ? '<p>Five receiving tasks on the map below. You are the circle. Work it the way the job works: ' +
          'a task is offered, you walk to it, and you confirm it done — by voice, like the glasses.</p>'
        : '<p>' + esc(aRole(roleWanted).charAt(0).toUpperCase() + aRole(roleWanted).slice(1)) + ' shift on the map below. You are the circle. Work it the way the job works: ' +
          'a task is offered, you walk to it, and you confirm it done — by voice, like the glasses.</p>';
      return panel('Walk the shift',
        roleRow() + intro +
        talkRow('Hold the button and say &ldquo;Start the shift&rdquo;, or press the button.') + heardLine() +
        '<div class="form-actions"><button class="btn primary" data-act="game-start">Start the shift</button>' + autoBtn + '</div>',
        'a game on the warehouse map');
    }
    if (session.done) {
      return panel('Walk the shift',
        roleRow() +
        '<p><b>Shift complete — ' + session.chain.steps.length + ' tasks, ' + esc(elapsedText(session.finishedAt - session.startedAt)) + '.</b> ' +
        'Every move updated the record as it happened: no clipboard, no end-of-shift typing.</p>' +
        talkRow('Hold the button and say &ldquo;Start the shift&rdquo; to work another.') + heardLine() +
        '<div class="form-actions"><button class="btn primary" data-act="game-start">Play again</button></div>',
        'shift complete');
    }
    var step = cur();
    var armed = step && step.kind === 'count' && session.countArmed;
    var body = roleRow() + '<p class="hint">Task ' + (session.i + 1) + ' of ' + total() + '</p>' +
      '<p>Next task: <b>' + esc(step ? step.offer : '') + '</b></p>';
    if (armed) {
      var cc = countContents(state, step.bin);
      body += '<p>You count in ' + esc(step.bin) + ': ' +
        (cc.lines.length ? cc.lines.map(function (l) { return '<b>' + esc(l.qty) + ' × ' + esc(l.desc) + '</b>'; }).join(', ') : '<b>nothing — the bin is empty</b>') + '.</p>';
    }
    body += talkRow(armed ? 'Hold the button and say &ldquo;Confirm&rdquo; to post the count.'
                          : 'Hold the button and say &ldquo;Complete&rdquo; when the task is done.') + heardLine();
    if (armed) {
      body += '<div class="form-actions"><button class="btn primary" data-act="game-confirm">Confirm count</button>' + autoBtn +
        '<span class="hint">The buttons do the same step, for hands that can\'t talk.</span></div>';
    } else {
      var label = !step ? 'Do it' : step.kind === 'checkin' ? 'Check in' : step.kind === 'toBay' ? 'Move the pallet' :
        step.kind === 'putaway' ? 'Put it away' : step.kind === 'pick' ? 'Pick it' :
        step.kind === 'pack' ? 'Pack it' : step.kind === 'load' ? 'Load it' :
        step.kind === 'replen' ? 'Replenish' : 'Count the bin';
      body += '<div class="form-actions"><button class="btn primary" data-act="game-doit">' + label + '</button>' + autoBtn +
        '<span class="hint">…or click the glowing place on the map. The buttons do the same step, for hands that can\'t talk.</span></div>';
    }
    return panel('Walk the shift', body, 'task ' + (session.i + 1) + ' of ' + total());
  }

  var api = {
    buildChain: buildChain, buildShift: buildShift, ROLES: ROLES, roleLabel: roleLabel,
    direct: direct, begin: begin, performStep: performStep,
    armCount: armCount, confirmCount: confirmCount, countContents: countContents,
    elapsedText: elapsedText, voiceCommand: voiceCommand, voiceContext: voiceContext, TOTAL: TOTAL,
    afterRender: afterRender, reset: reset, cellClick: cellClick, ui: ui, hear: hear, panelHtml: panelHtml
  };
  root.WmsGame = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
