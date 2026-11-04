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
   the same step for hands that can't talk right now. Five set-up
   receiving tasks form one shift: check in at a dock, bring a
   pallet into the Receiving Bay, put it away, put a second pallet
   away, then spot-count the first bin. Every step performs the real
   operation on the state underneath (the putaway tasks are the
   console's own, completed through js/wms.js; the spot count is a
   real cycle count), so the map, the tables and the audit trail all
   update as the shift is worked. It is a shift, not an arcade: no
   score, no points — the finish is a shift summary.

   Voice rides the console's own mic plumbing (js/warehouse-mic.js →
   the Worker's /asr), wired by wms-ui.js to the panel's hold-to-talk
   button; voiceCommand() below is the whole vocabulary, a pure
   function: a transcript becomes one command or nothing. A voice
   command can only ever work the CURRENT offered task — the same
   honesty as the click path.

   Hard rule: the game runs ONLY on a practice copy (?practice=1,
   the in-memory state that is never saved). On the live desk record
   the panel just says so and links to a practice copy — the dummy
   tasks can never touch the real record.

   Shape of the module:
     - Pure logic (node-tested): buildChain reads a state and deals
       the five steps; direct() aims the two putaway tasks at the
       chosen bins; performStep / armCount / confirmCount mutate a
       state exactly the way the controller asks them to;
       voiceCommand() matches a transcript to a shift command.
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
    return { door: door, palletA: palletA.id, palletB: palletB.id, binA: binA, binB: binB,
      taskA: taskA.id, taskB: taskB.id, aptId: apt ? apt.id : null, steps: steps };
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

  /* Deal a shift onto a state: build, direct, and write the start
     onto the record. Returns { ok, chain } or { ok:false, reason }. */
  function begin(state) {
    var chain = buildChain(state);
    if (!chain) return no('Not enough staged freight or empty bins on this copy to deal a shift — reload the practice copy for a fresh building.');
    direct(state, chain);
    record(state, 'Walk the shift started — five receiving tasks on a practice copy.');
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
    return no('Step ' + (i + 1) + ' is worked from the panel, not performed directly.');
  }

  /* Step 5, first half: queue the real cycle count for the bin. */
  function armCount(state, chain) {
    if (!W) return no('The WMS layer is not loaded.');
    var step = chain.steps[TOTAL - 1];
    var r = W.cycleCount(state, [chain.binA], { reason: 'Walk the shift — spot count', by: null });
    if (!r.ok) return r;
    step.countTaskId = r.tasks[0];
    record(state, 'Spot count queued for bin ' + chain.binA + ' (Walk the shift, task 5 of 5).');
    return { ok: true, taskId: step.countTaskId };
  }

  /* What a counter standing at the bin would see, from the state. */
  function countContents(state, binId) {
    var b = binById(state, binId);
    var counts = {}, lines = [];
    if (b) b.contents.forEach(function (c) { counts[c.desc] = c.qty; lines.push({ desc: c.desc, qty: c.qty }); });
    return { counts: counts, lines: lines };
  }

  /* Step 5, second half: post the count the panel showed. Counted
     honestly — the player counted the pallet they put away — so a
     clean count lands as "matches", a real CC record either way. */
  function confirmCount(state, chain) {
    if (!W) return no('The WMS layer is not loaded.');
    var step = chain.steps[TOTAL - 1];
    if (!step.countTaskId) return no('The count has not been queued yet.');
    return W.complete(state, step.countTaskId, { counts: countContents(state, chain.binA).counts, by: null });
  }

  function elapsedText(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  /* ---------- voice commands (pure) -------------------------------- */
  /* The whole voice vocabulary of the shift, matched exactly on the
     normalised transcript — the utterance must BE the command, not
     merely contain it, so ordinary speech about the work ("completely
     wrong pallet, this one") can never fire a step. Returns one of
     'start' | 'complete' | 'confirm' | 'auto', or null when the words
     are not a shift command (nothing is done with them). */
  function voiceCommand(text) {
    var t = String(text == null ? '' : text).toLowerCase()
      .replace(/['’]/g, '').replace(/[.!?,;:""]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return null;
    if (/^(start|begin)( the)?( shift| job| work)?$/.test(t)) return 'start';
    if (/^auto ?run( on| off)?$/.test(t)) return 'auto';
    if (/^(confirm|confirmed|confirm count|confirm the count|count confirmed)$/.test(t)) return 'confirm';
    if (/^(complete|completed|done|finished|all done|done with this one|complete this one|task complete|that is done|thats done|i am done|im done)$/.test(t)) return 'complete';
    return null;
  }

  /* ==================================================================
     The DOM controller — browser only. Everything below reads the
     session and the capabilities wms-ui.js hands over in
     afterRender(); nothing here runs at load, and node never reaches
     it (the pure half above is the whole node surface).
     ================================================================== */

  var CTX = null;        /* { act, state, practice, base, render } — refreshed every render */
  var session = null;    /* the shift being played, or null */
  var voiceNote = null;  /* { text, did } — the last words heard, quoted, and what they did */
  var autoWanted = false;
  var cssDone = false;
  var autoTimer = null;

  function cur() { return session && !session.done ? session.chain.steps[session.i] : null; }
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
  function stageEl() { return document.querySelector('#main .wm-board'); }

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
    var chain = session.chain, idx = session.i;
    var chainP = Promise.resolve();
    if (step.from && !samePlace(step.from, session.at)) {
      session.at = step.from;
      glideInPlace(step.from);
      chainP = wait(GLIDE_MS + PAUSE_MS);
    }
    return chainP.then(function () {
      if (step.kind === 'count' && !session.countArmed) {
        session.glideTo = step.target;
        session.glidePx = cellPx(step.target.place, step.target.id);
        return CTX.act(function (s) { return armCount(s, chain); }, null).then(function (r) {
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
          if (session.i >= TOTAL) { finish(); return; }
          /* act() rendered while the session still pointed at the
             finished step; render again so the panel names the NEXT
             task (afterRender re-places the circle and the pulse). */
          if (CTX.render) CTX.render(); else mount();
          if (session.auto) scheduleAuto();
        }
      });
    }).catch(function () { session.busy = false; });
  }

  function confirm() {
    if (!session || !session.countArmed || !CTX) return Promise.resolve();
    var chain = session.chain;
    return CTX.act(function (s) { return confirmCount(s, chain); }, null).then(function (r) {
      if (r && r.ok) {
        session.i = TOTAL;
        session.at = { place: 'bin', id: chain.binA };
        finish();
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
    var step = cur();
    if (!step || step.target.place !== place || step.target.id !== id) return false;
    if (step.kind === 'count' && session.countArmed) return false; /* armed: the panel's Confirm is the action */
    doStep();
    return true;
  }

  /* The panel's buttons, by name. */
  function ui(name) {
    if (!CTX) return;
    if (name === 'auto') {
      if (session) session.auto = !session.auto; else autoWanted = !autoWanted;
      if (CTX.render) CTX.render();
      if (session && session.auto && !session.done) scheduleAuto();
      return;
    }
    if (name === 'start') {
      if (session && session.busy) return Promise.resolve();
      var wasAuto = session ? session.auto : autoWanted;
      return CTX.act(function (s) { return begin(s); }, null).then(function (r) {
        if (r && r.ok && r.chain) {
          session = { chain: r.chain, i: 0, at: { place: 'dock', id: r.chain.door }, px: null,
            auto: wasAuto, busy: false, countArmed: false, done: false, startedAt: Date.now(), finishedAt: 0, glideTo: null };
          if (CTX.render) CTX.render();
          if (session.auto) scheduleAuto();
        }
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
     here. The words are quoted in the panel with what they did —
     the app's record-keeping style — and a command can only ever
     work the CURRENT offered task: 'complete' on the count step,
     once the count is armed, confirms the count (that IS the pending
     action); 'confirm' anywhere else confirms nothing. Anything that
     is not a command is reported as such and changes nothing. */
  function note(text, did) {
    voiceNote = { text: text, did: did };
    if (CTX && CTX.render) CTX.render();
  }

  function hear(text) {
    var cmd = voiceCommand(text);
    if (!CTX || !CTX.practice || CTX.base !== 'dashboard') return;
    if (cmd === 'start') {
      if (session && !session.done) { note(text, 'the shift is already under way — nothing changed.'); return; }
      ui('start').then(function () {
        note(text, session ? 'shift started — the first task is offered below.' : 'this building could not deal a shift — nothing was done.');
      });
      return;
    }
    if (cmd === 'auto') {
      var on = session ? !session.auto : !autoWanted;
      voiceNote = { text: text, did: 'auto-run ' + (on ? 'on — the shift works itself.' : 'off.') };
      ui('auto'); /* renders */
      return;
    }
    if (cmd === 'confirm') {
      var st = cur();
      if (session && !session.done && st && st.kind === 'count' && session.countArmed) {
        ui('confirm').then(function () {
          note(text, session && session.done ? 'count confirmed and posted.' : 'the count did not post — nothing was done.');
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
          note(text, session && session.done ? 'count confirmed and posted.' : 'the count did not post — nothing was done.');
        });
        return;
      }
      var n = session.i + 1, wasArmed = session.countArmed;
      doStep().then(function () {
        if (session && session.done) note(text, 'task ' + n + ' of ' + TOTAL + ' worked — that finishes the shift.');
        else if (session && session.countArmed && !wasArmed) note(text, 'count queued for ' + session.chain.binA + ' — count what is there, then say "confirm".');
        else if (session && session.i >= n) note(text, 'task ' + n + ' of ' + TOTAL + ' worked.');
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
    return voiceNote ? '<p class="hint">Heard: &ldquo;' + esc(voiceNote.text) + '&rdquo; — ' + esc(voiceNote.did) + '</p>' : '';
  }

  function panelHtml(panel, state, practice) {
    if (!practice) {
      return panel('Walk the shift',
        '<p>The game runs on a practice copy, so the real record stays clean. ' +
        'Open one and work a five-task receiving shift on the warehouse map below — tasks are offered one at a time and confirmed by voice, and every move lands on the practice record as it happens.</p>' +
        '<div class="form-actions"><a class="btn primary" href="wms.html?practice=1#/dashboard">Open a practice copy</a></div>');
    }
    var autoOn = session ? session.auto : autoWanted;
    var autoBtn = '<button class="btn" data-act="game-auto">Auto-run: ' + (autoOn ? 'On' : 'Off') + '</button>';
    if (!session) {
      return panel('Walk the shift',
        '<p>Five receiving tasks on the map below. You are the circle. Work it the way the job works: ' +
        'a task is offered, you walk to it, and you confirm it done — by voice, like the glasses.</p>' +
        talkRow('Hold the button and say &ldquo;Start the shift&rdquo;, or press the button.') + heardLine() +
        '<div class="form-actions"><button class="btn primary" data-act="game-start">Start the shift</button>' + autoBtn + '</div>',
        'a game on the warehouse map');
    }
    if (session.done) {
      return panel('Walk the shift',
        '<p><b>Shift complete — 5 tasks, ' + esc(elapsedText(session.finishedAt - session.startedAt)) + '.</b> ' +
        'Every move updated the record as it happened: no clipboard, no end-of-shift typing.</p>' +
        talkRow('Hold the button and say &ldquo;Start the shift&rdquo; to work another.') + heardLine() +
        '<div class="form-actions"><button class="btn primary" data-act="game-start">Play again</button></div>',
        'shift complete');
    }
    var step = cur();
    var armed = step && step.kind === 'count' && session.countArmed;
    var body = '<p class="hint">Task ' + (session.i + 1) + ' of ' + TOTAL + '</p>' +
      '<p>Next task: <b>' + esc(step ? step.offer : '') + '</b></p>';
    if (armed) {
      var cc = countContents(state, session.chain.binA);
      body += '<p>You count in ' + esc(session.chain.binA) + ': ' +
        (cc.lines.length ? cc.lines.map(function (l) { return '<b>' + esc(l.qty) + ' × ' + esc(l.desc) + '</b>'; }).join(', ') : '<b>nothing — the bin is empty</b>') + '.</p>';
    }
    body += talkRow(armed ? 'Hold the button and say &ldquo;Confirm&rdquo; to post the count.'
                          : 'Hold the button and say &ldquo;Complete&rdquo; when the task is done.') + heardLine();
    if (armed) {
      body += '<div class="form-actions"><button class="btn primary" data-act="game-confirm">Confirm count</button>' + autoBtn +
        '<span class="hint">The buttons do the same step, for hands that can\'t talk.</span></div>';
    } else {
      var label = !step ? 'Do it' : step.kind === 'checkin' ? 'Check in' : step.kind === 'toBay' ? 'Move the pallet' :
        step.kind === 'putaway' ? 'Put it away' : 'Count the bin';
      body += '<div class="form-actions"><button class="btn primary" data-act="game-doit">' + label + '</button>' + autoBtn +
        '<span class="hint">…or click the glowing place on the map. The buttons do the same step, for hands that can\'t talk.</span></div>';
    }
    return panel('Walk the shift', body, 'task ' + (session.i + 1) + ' of ' + TOTAL);
  }

  var api = {
    buildChain: buildChain, direct: direct, begin: begin, performStep: performStep,
    armCount: armCount, confirmCount: confirmCount, countContents: countContents,
    elapsedText: elapsedText, voiceCommand: voiceCommand, TOTAL: TOTAL,
    afterRender: afterRender, cellClick: cellClick, ui: ui, hear: hear, panelHtml: panelHtml
  };
  root.WmsGame = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
