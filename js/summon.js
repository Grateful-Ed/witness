/* =====================================================================
   summon.js — Segment 4, Part A: the BOL-summon scan. PURE LOGIC ONLY.

   The warehouse scan model (William, 2026-11-01): in the warehouse a
   BOL scan SUMMONS. The BOL arrived upstream (email/EDI) before the
   truck, so the shipment and its work are already in the system. The
   scan reads the paper, takes its BOL number, finds the shipment on
   file, and brings it up: the file copy beside the fresh read, the
   task chain as it stands, and the next open task.

   No match: the page says plainly the BOL is not in the system, and
   NOTHING is created — no shipment, no task, no draft. Creation by
   scan exists only in the kitchen world, and it stays there.

   Everything here only READS the state. Nothing is saved. The read
   itself comes from js/bol.js (reused, never forked); the comparison
   is bol.js's matchBol, with the count lines worded for "read against
   the file copy" instead of "against the pallet". Loaded in the
   browser (window.WitnessSummon) and in node (module.exports).
   ===================================================================== */
(function (root) {
  'use strict';

  var B = root.WitnessBol;
  var E = root.WitnessEngine;
  if ((!B || !E) && typeof require === 'function') {
    try { B = B || require('./bol.js'); E = E || require('./engine.js'); } catch (e) { /* browser */ }
  }

  var NOT_READ = B.NOT_READ;

  function alnum(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function show(v) { return v === NOT_READ ? 'not read' : String(v); }

  /* ---------- the lookup -------------------------------------------- */

  /* The inbound shipment whose BOL on file carries this number, or
     null. Punctuation and case don't matter ("brfl tl 001" finds
     "BRFL-TL-001"). */
  function findShipment(state, bolNumber) {
    if (!state || !Array.isArray(state.inbound) || bolNumber === NOT_READ || bolNumber == null) return null;
    var want = alnum(bolNumber);
    if (!want) return null;
    for (var i = 0; i < state.inbound.length; i++) {
      var s = state.inbound[i];
      if (s && s.bol && s.bol.bolNumber && alnum(s.bol.bolNumber) === want) return s;
    }
    return null;
  }

  /* ---------- the file copy beside the read --------------------------- */

  /* A shipment's file copy in the shape bol.js's matchBol takes.
     "present" is the file's own count — so each count row is the read
     against the file, never a claim about what is on the pallet. */
  function fileLoad(ship) {
    var b = ship.bol;
    return {
      label: ship.id + ' — the BOL on file (' + b.bolNumber + ')',
      onFile: { carrier: b.carrier, bolNumber: b.bolNumber, shipper: b.shipper, consignee: b.consignee,
        piecesClaimed: b.piecesClaimed, totalWeightLb: b.totalWeightLb },
      lines: (b.lines || []).map(function (l) { return { name: l.name, match: l.match, present: l.pieces }; })
    };
  }

  function countLine(row) {
    if (row.result === 'not-on-bol') return { result: 'not-in-read', line: row.name + ' — on file ' + row.present + '; not found in the read. Can\'t compare.' };
    if (row.result === 'not-read') return { result: 'not-read', line: row.name + ' — on file ' + row.present + '; the read count was not read. Can\'t compare.' };
    var head = row.name + ' — read ' + show(row.read) + ', on file ' + row.present + '. ';
    if (row.result === 'agree') return { result: 'agree', line: head + 'Agree.' };
    var more = row.result === 'short'; /* matchBol: read > present */
    return { result: 'differ', diff: row.diff,
      line: head + 'Differs by ' + row.diff + ' — the paper says ' + row.diff + (more ? ' more' : ' fewer') + ' than the file.' };
  }

  /* The fresh read against the file copy. identity: header fields
     (bol.js wording, already "read vs on file"). counts: each file
     line, then the total. extra: lines on the paper that are not on
     the file. differ: every disagreement, in numbers. */
  function compare(read, ship) {
    var m = B.matchBol(read, fileLoad(ship));
    var counts = m.counts.map(function (r) { var c = countLine(r); c.name = r.name; c.read = r.read; c.onFile = r.present; return c; });
    var total = countLine(m.total); total.name = 'Total pieces'; total.read = m.total.read; total.onFile = m.total.present;
    var extra = m.extra.map(function (x) {
      return { result: 'not-on-file', line: show(x.description) + ' — on the paper (pieces ' + show(x.pieces) + '), not on the file copy.' };
    });
    var differ = [];
    m.identity.forEach(function (r) { if (r.result === 'differ') differ.push(r.line); });
    counts.concat([total]).forEach(function (c) { if (c.result === 'differ') differ.push(c.line); });
    extra.forEach(function (x) { differ.push(x.line); });
    var summary = differ.length
      ? 'The paper differs from the file copy in ' + differ.length + ' place' + (differ.length === 1 ? '' : 's') + '. A person decides what that means.'
      : 'The paper agrees with the file copy wherever it could be read.';
    return { against: 'the BOL on file for ' + ship.id + ' (' + ship.bol.bolNumber + ')', identity: m.identity, counts: counts, total: total, extra: extra, differ: differ, summary: summary };
  }

  /* ---------- the task chain, as it stands ---------------------------- */

  function unitName(state, id) {
    var n = null;
    (state.labor || []).forEach(function (u) { if (u.id === id) n = u.name; });
    return n || 'someone';
  }

  function taskState(state, t) {
    if (t.status === 'done') return { key: 'done', words: 'Done' + (t.doneBy ? ' by ' + unitName(state, t.doneBy) : '') + '.' };
    var blocked = E.blockedBy(state, t);
    if (t.status === 'assigned') return { key: 'assigned', words: 'In hand — ' + unitName(state, t.assignee) + '.' + (blocked ? ' Blocked: ' + blocked : '') };
    return { key: 'open', words: 'Open — waiting for a worker in Zone ' + t.zone + '.' + (blocked ? ' Blocked: ' + blocked : ''), blocked: blocked };
  }

  /* The chain for an inbound shipment: arrive → receive → put away.
     Steps come from what already exists (status, tasks, staged
     pallets). A step whose task is not made yet says so — it is not
     made here. Returns { steps, next }. */
  function chain(state, ship) {
    var steps = [];
    var expected = ship.status !== 'staged at door' && ship.status !== 'received';
    steps.push({ step: 'Arrive at ' + ship.door, key: expected ? 'waiting' : 'done',
      words: expected ? 'Not here yet — ' + String(ship.status) + '.' : 'Arrived.' });

    var rt = E.taskById(state, 't-receive-' + ship.id);
    if (rt) steps.push({ step: rt.title, taskId: rt.id, key: taskState(state, rt).key, words: taskState(state, rt).words, task: rt });
    else steps.push({ step: 'Receive ' + ship.id + ' at ' + ship.door, key: ship.status === 'received' ? 'done' : 'waiting',
      words: ship.status === 'received' ? 'Done.' : 'No task yet — the receive task is made when the truck is logged.' });

    var prefix = 'STG-' + ship.id + '-';
    var puts = state.tasks.filter(function (t) { return t.type === 'putaway' && String(t.stagingId || '').indexOf(prefix) === 0; })
      .sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    var pallets = 0;
    (ship.lines || []).forEach(function (l) { pallets += l.pallets; });
    if (!puts.length) {
      steps.push({ step: 'Put away ' + pallets + ' pallet' + (pallets === 1 ? '' : 's'), key: 'waiting',
        words: 'No tasks yet — putaway is made from what is received.' });
    }
    puts.forEach(function (t) {
      var ts = taskState(state, t);
      steps.push({ step: t.title, taskId: t.id, key: ts.key, words: ts.words, task: t });
    });

    /* Next open task: the first step not done. A real task when one
       exists; otherwise the plain step that comes next. */
    var next = null;
    for (var i = 0; i < steps.length; i++) {
      if (steps[i].key === 'done') continue;
      var s = steps[i];
      if (s.task) next = { taskId: s.task.id, title: s.task.title, detail: s.task.detail || '', words: s.words };
      else if (i === 0) next = { taskId: null, title: 'Log the truck at ' + ship.door,
        detail: 'A manager taps "Truck\'s here" on ' + ship.id + ' when it backs in. The receive task is made then.', words: s.words };
      else next = { taskId: null, title: s.step, detail: '', words: s.words };
      break;
    }
    if (!next) next = { taskId: null, title: 'Nothing open', detail: 'Every step for ' + ship.id + ' is done.', words: '' };
    return { steps: steps, next: next };
  }

  /* ---------- the summon --------------------------------------------- */

  /* A BOL read (bol.js's normalised read) against the state. Reads
     only: the state is never touched. Returns one of
       { status: 'match', shipment, stage, compare, chain, next, message }
       { status: 'no-match', bolNumber, message }
       { status: 'not-read', message } */
  function summon(state, read) {
    if (!read || read.bolNumber === NOT_READ || !String(read.bolNumber).trim()) {
      return { status: 'not-read',
        message: 'The BOL number could not be read, so nothing was looked up. Nothing was created. Try a clearer photo of the BOL number.' };
    }
    var ship = findShipment(state, read.bolNumber);
    if (!ship) {
      return { status: 'no-match', bolNumber: read.bolNumber,
        message: 'BOL ' + read.bolNumber + ' is not in the system. Nothing was created — no shipment, no task, no record. ' +
          'Warehouse BOLs come in before the truck does; a dock scan only finds what is already on file.' };
    }
    var c = chain(state, ship);
    return {
      status: 'match',
      shipment: ship,
      stage: E.inboundStage(state, ship),
      compare: compare(read, ship),
      chain: c.steps,
      next: c.next,
      message: 'BOL ' + ship.bol.bolNumber + ' is on file — ' + ship.id + ', ' + ship.desc + '.'
    };
  }

  var api = { findShipment: findShipment, fileLoad: fileLoad, compare: compare, chain: chain, summon: summon };
  root.WitnessSummon = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
