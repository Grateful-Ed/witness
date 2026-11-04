/* =====================================================================
   ontology.js — the dynamic ontology: a rolling, AI-shaped digest
   of the warehouse, plus predictive prep.

   William's addition (2026-11-03): today every AI answer is
   assembled by handing the model raw WMS state and letting it
   orient itself on the spot — slower, and the orientation work is
   repeated on every ask. The digest is the building's own standing
   summary — places, freight, work, people, what needs eyes —
   re-derived from state whenever the state changes, so the AI
   grabs it and goes.

   Hard rules, from the brief:
     - Derived data only. These functions read state; they never
       write back into it, and they make no network calls of any
       kind. A test scans this file's source to prove it.
     - Prep notes are composed and stashed on the digest. They are
       never delivered anywhere; there is no timer and no polling
       in this module.
     - Pure: the same state always yields the same digest,
       including the prep queue. applyChange only preserves the
       order notes were first seen in; it never invents a note,
       and never keeps one the state itself no longer produces.
       One disclosed exception, by William's slang law (below):
       the applyChange that first sees the vocabulary grow also
       emits one transient prep note announcing the new word. A
       fresh rebuild does not carry it — it is an announcement,
       not a standing condition.

   The building's slang (Brief C, William 2026-11-04): warehouse
   workers talk in their own words, and the ontology learns them.
   Learned definitions live in state.vocabulary as
   { term: { means, about?, taughtBy, at } }, created lazily by
   learnTerm — the seed carries no vocabulary key, and no other
   code writes one: this module is the single writer of
   definitions. learnTerm is pure like everything here: it
   returns a NEW state and leaves its input untouched; the caller
   applies the returned vocabulary to its working state. The
   digest carries the vocabulary as a plain list
   ({ term, means, taughtBy }) so anything answering for the
   building can be handed the words the workers taught it.

   Loads in the browser (window.WitnessOntology) and in node.
   ===================================================================== */(function (root) {
  'use strict';

  /* ---------- small pure helpers ---------------------------------- */

  function find(list, pred) {
    var l = list || [];
    for (var i = 0; i < l.length; i++) if (pred(l[i])) return l[i];
    return null;
  }
  function unitName(state, id) {
    var u = find(state.labor, function (x) { return x.id === id; });
    return u ? u.name : null;
  }
  function managerName(state) {
    var u = find(state.labor, function (x) { return x.role === 'manager'; });
    return u ? u.name : null;
  }
  function openTasks(state) {
    return (state.tasks || []).filter(function (t) { return t.status !== 'done'; });
  }
  function palletById(state, id) {
    return find(state.staging, function (p) { return p.id === id; });
  }
  function holdSuffix(h) { return h && h.reason ? ' (' + h.reason + ')' : ''; }
  function holdLine(h) { return 'on hold' + holdSuffix(h); }

  /* Who a note about a task belongs to: the worker holding it,
     the worker queued for it, else the manager. */
  function taskPerson(state, t) {
    if (t.assignee) return unitName(state, t.assignee);
    if (t.queuedFor) return unitName(state, t.queuedFor);
    return managerName(state);
  }
  function taskTouchesBin(t, binId) {
    return t.toBinId === binId || t.fromBinId === binId || t.binId === binId;
  }

  /* ---------- the digest sections --------------------------------- */

  function placesOf(state) {
    var out = [];
    (state.doors || []).forEach(function (d) {
      out.push({
        kind: 'door', id: d.id, direction: d.direction || null, zone: d.zone || null,
        status: d.state || null,
        contents: d.shipmentId ? [{ id: d.shipmentId }] : (d.loadId ? [{ id: d.loadId }] : []),
        holds: []
      });
    });
    (state.zones || []).forEach(function (z) {
      var held = (state.bins || []).filter(function (b) { return b.zone === z && b.status === 'hold'; });
      out.push({
        kind: 'zone', id: z, zone: z, status: held.length ? 'hold' : 'ok',
        contents: [],
        holds: held.map(function (b) { return 'Bin ' + b.id + ' on hold'; })
      });
    });
    (state.bins || []).forEach(function (b) {
      out.push({
        kind: 'bin', id: b.id, zone: b.zone || null, status: b.status || 'ok',
        contents: (b.contents || []).map(function (c) { return { desc: c.desc, qty: c.qty }; }),
        holds: b.status === 'hold' ? [holdLine(b.hold)] : []
      });
    });
    (state.staging || []).forEach(function (p) {
      var door = find(state.doors, function (d) { return d.id === p.door; });
      out.push({
        kind: 'pallet', id: p.id, zone: door ? door.zone : null, status: p.hold ? 'hold' : 'staged',
        at: p.door || null, shipmentId: p.shipmentId || null,
        contents: [{ desc: p.desc, qty: p.qty }],
        holds: p.hold ? [holdLine(p.hold)] : []
      });
    });
    return out;
  }

  function shipmentsOf(state) {
    return (state.inbound || []).map(function (s) {
      return { id: s.id, status: s.status || null, at: s.door || null, desc: s.desc || null };
    });
  }

  function ordersOf(state) {
    var out = (state.outbound || []).map(function (o) {
      return { id: o.id, status: o.status || null, at: o.door || null, customer: o.customer || null, flow: 'released' };
    });
    (((state.wms || {}).orders) || []).forEach(function (o) {
      out.push({ id: o.id, status: o.status || null, at: o.door || null, customer: o.customer || null, flow: 'entered' });
    });
    return out;
  }

  function taskItem(state, t) {
    if (t.desc) return t.desc;
    if (t.stagingId) { var p = palletById(state, t.stagingId); if (p) return p.desc; }
    return t.title || t.id;
  }
  function taskDestination(state, t) {
    if (t.toBinId) return t.toBinId;
    if (t.binId) return t.binId;
    if (t.stagingId) { var p = palletById(state, t.stagingId); if (p) return p.door; }
    if (t.orderId) {
      var o = find(state.outbound, function (x) { return x.id === t.orderId; });
      if (o) return o.door;
    }
    return null;
  }
  function tasksOf(state) {
    return openTasks(state).map(function (t) {
      return {
        id: t.id, kind: t.type || null, item: taskItem(state, t),
        destination: taskDestination(state, t),
        assignee: t.assignee ? unitName(state, t.assignee) : null,
        queuedFor: t.queuedFor ? unitName(state, t.queuedFor) : null,
        status: t.status || null
      };
    });
  }

  function peopleOf(state) {
    return (state.labor || []).map(function (u) {
      return { name: u.name, role: u.role || null, zone: u.zone || null, currentTask: u.currentTaskId || null };
    });
  }

  /* The building's learned slang, as a plain list for the digest.
     Reads state.vocabulary defensively: a state that predates the
     vocabulary (the seed included) simply has none. */
  function vocabularyOf(state) {
    var v = (state && state.vocabulary) || {};
    return Object.keys(v).sort().map(function (term) {
      var e = v[term] || {};
      return { term: term, means: e.means || null, taughtBy: e.taughtBy || null };
    });
  }

  /* The single writer of definitions. Pure: returns a NEW state
     with the word learned, the input untouched. The vocabulary is
     created lazily — a state with nothing taught yet has no
     vocabulary key, so the seed's shape never moves. A term or a
     meaning that isn't there teaches nothing: the input state
     comes back as it was. opts: { term, means, about?, from, at }. */
  function learnTerm(state, t) {
    var term = String((t && t.term) || '').trim();
    var means = String((t && t.means) || '').trim();
    if (!term || !means || !state) return state;
    var next = JSON.parse(JSON.stringify(state));
    next.vocabulary = next.vocabulary || {};
    var entry = { means: means };
    if (t.about) entry.about = t.about;
    entry.taughtBy = t.from || null;
    entry.at = t.at || null;
    next.vocabulary[term] = entry;
    return next;
  }

  /* The same urgency set the map flags derive from (js/wms-map.js
     flags()) — held bins, held pallets, open OS&D findings, open
     worker flags — re-derived here so the digest stands alone. */
  function needsEyesOf(state) {
    var out = [];
    (state.bins || []).forEach(function (b) {
      if (b.status === 'hold') out.push({ place: 'bin', id: b.id, reason: 'Bin ' + b.id + ' on hold' });
    });
    (state.staging || []).forEach(function (p) {
      if (p.hold) out.push({ place: 'pallet', id: p.id, reason: 'Pallet ' + p.id + ' on hold' });
    });
    var byShip = {}, shipOrder = [];
    (((state.wms || {}).osd) || []).forEach(function (f) {
      if (f.status !== 'open' || !f.shipmentId) return;
      if (!byShip[f.shipmentId]) { byShip[f.shipmentId] = []; shipOrder.push(f.shipmentId); }
      byShip[f.shipmentId].push('Shipment ' + f.shipmentId + ': ' + (f.type === 'photo' ? 'camera finding' : f.type) + ' awaiting a decision');
    });
    shipOrder.forEach(function (id) {
      out.push({ place: 'shipment', id: id, reason: byShip[id].join('; ') });
    });
    var byTask = {}, taskOrder = [], loose = [];
    (((state.wms || {}).flags) || []).forEach(function (f) {
      if (f.status !== 'open') return;
      var why = 'Flag ' + f.id + ' awaiting a decision';
      var t = f.taskId ? find(state.tasks, function (x) { return x.id === f.taskId; }) : null;
      if (!t) { loose.push({ place: 'flag', id: f.id, reason: why }); return; }
      if (!byTask[t.id]) { byTask[t.id] = []; taskOrder.push(t.id); }
      byTask[t.id].push(why);
    });
    taskOrder.forEach(function (id) {
      out.push({ place: 'task', id: id, reason: byTask[id].join('; ') });
    });
    return out.concat(loose);
  }

  /* ---------- predictive prep ------------------------------------- */
  /* Conditions a specific person needs to know about, detected from
     state alone, each composed into a short note and stashed. A
     note exists exactly while its condition holds: the hold is
     released, the finding closes, the task finishes — the note
     goes. Nothing here is sent anywhere. */

  function prepOf(state) {
    var notes = [];
    var tasks = openTasks(state);
    function push(forName, about, note, fromChange) {
      if (!forName) return;
      notes.push({ 'for': forName, about: about, note: note, fromChange: fromChange });
    }

    /* 1. A bin or pallet on hold, with open work touching it. */
    (state.bins || []).forEach(function (b) {
      if (b.status !== 'hold') return;
      tasks.forEach(function (t) {
        if (!taskTouchesBin(t, b.id)) return;
        var attached = !!(t.assignee || t.queuedFor);
        push(taskPerson(state, t), b.id,
          'Bin ' + b.id + ' is on hold' + holdSuffix(b.hold) + '. ' +
          (attached ? 'Your task ' : 'The open task ') + '"' + t.title + '"' +
          (attached ? '' : ' (unassigned)') + ' touches it and cannot finish until the hold is released.',
          'Bin ' + b.id + ' put on hold');
      });
    });
    (state.staging || []).forEach(function (p) {
      if (!p.hold) return;
      tasks.forEach(function (t) {
        if (t.stagingId !== p.id) return;
        var attached = !!(t.assignee || t.queuedFor);
        push(taskPerson(state, t), p.id,
          'Pallet ' + p.id + ' (' + p.desc + ') is on hold' + holdSuffix(p.hold) + '. ' +
          (attached ? 'Your task ' : 'The open task ') + '"' + t.title + '"' +
          (attached ? '' : ' (unassigned)') + ' cannot move it until the hold is released.',
          'Pallet ' + p.id + ' put on hold');
      });
    });

    /* 2. Open OS&D findings on a shipment someone is working. */
    var osdByShip = {}, osdOrder = [];
    (((state.wms || {}).osd) || []).forEach(function (f) {
      if (f.status !== 'open' || !f.shipmentId) return;
      if (!osdByShip[f.shipmentId]) { osdByShip[f.shipmentId] = []; osdOrder.push(f.shipmentId); }
      osdByShip[f.shipmentId].push(f);
    });
    osdOrder.forEach(function (shipId) {
      var fs = osdByShip[shipId];
      var workerTask = null;
      tasks.forEach(function (t) {
        if (workerTask || !(t.assignee || t.queuedFor)) return;
        var p = t.stagingId ? palletById(state, t.stagingId) : null;
        if ((p && p.shipmentId === shipId) || t.id === 't-receive-' + shipId || t.shipmentId === shipId) workerTask = t;
      });
      if (!workerTask) return;
      var types = fs.map(function (f) { return f.type; }).join(', ');
      push(taskPerson(state, workerTask), shipId,
        'Shipment ' + shipId + ' has ' + fs.length + ' open OS&D finding' + (fs.length === 1 ? '' : 's') +
        ' (' + types + ') awaiting a human decision. Your task "' + workerTask.title + '" works this shipment\'s freight.',
        'OS&D finding opened on ' + shipId);
    });

    /* 3. A task reassigned, or its destination corrected, while it
       is still open. The record of the change is in state.records;
       the newest entry of each kind, per task, is the live one. */
    var latest = {};
    (state.records || []).forEach(function (r) {
      if (r && r.taskId && (r.kind === 'reassign' || r.kind === 'correction')) latest[r.taskId + '|' + r.kind] = r;
    });
    Object.keys(latest).forEach(function (k) {
      var r = latest[k];
      var t = find(tasks, function (x) { return x.id === r.taskId; });
      if (!t) return;
      if (r.kind === 'reassign') {
        var attached = !!(t.assignee || t.queuedFor);
        push(taskPerson(state, t), t.id,
          '"' + t.title + '" was reassigned' +
          (attached ? ' to you — ' + (t.status === 'assigned' ? 'it is in your hands now.' : 'it is queued for you next.') : '.'),
          'Task ' + t.id + ' reassigned');
      } else {
        push(taskPerson(state, t), t.id,
          '"' + t.title + '" now goes to ' + (t.toBinId || 'a new spot') +
          ' — its destination was corrected after the task was made. Follow the task, not the original plan.',
          'Destination corrected on ' + t.id);
      }
    });

    return notes;
  }

  /* ---------- the digest itself ----------------------------------- */

  function buildDigest(state) {
    return {
      asOf: { rev: state.wmsRev || 0, savedAt: state.wmsSavedAt || null },
      places: placesOf(state),
      shipments: shipmentsOf(state),
      orders: ordersOf(state),
      tasks: tasksOf(state),
      people: peopleOf(state),
      needsEyes: needsEyesOf(state),
      vocabulary: vocabularyOf(state),
      prep: prepOf(state)
    };
  }

  function noteKey(n) { return n['for'] + '|' + n.about + '|' + n.fromChange; }

  /* The incremental path: re-derive from the new state, keeping
     the prep queue in the order its notes were first seen. The
     content is exactly buildDigest(state)'s — order of the prep
     queue is the only thing carried over — plus one transient
     exception: when the vocabulary has grown since the previous
     digest, this call (and only this call) appends one prep note
     per new word, announcing it. The next applyChange on the same
     state does not repeat it: the word is known by then. */
  function applyChange(state, prev) {
    var next = buildDigest(state);
    if (!prev || !Array.isArray(prev.prep)) return next;
    var fresh = {};
    next.prep.forEach(function (n) { fresh[noteKey(n)] = n; });
    var merged = [];
    prev.prep.forEach(function (n) {
      var k = noteKey(n);
      if (fresh[k]) { merged.push(fresh[k]); delete fresh[k]; }
    });
    next.prep.forEach(function (n) { if (fresh[noteKey(n)]) merged.push(n); });
    next.prep = merged;
    var known = {};
    (prev.vocabulary || []).forEach(function (v) { known[v.term] = true; });
    next.vocabulary.forEach(function (v) {
      if (known[v.term]) return;
      var forName = managerName(state) || v.taughtBy;
      if (!forName) return;
      next.prep.push({
        'for': forName, about: v.term,
        note: "New word in the building's vocabulary: '" + v.term + "' — taught by " + (v.taughtBy || 'not said who'),
        fromChange: "Vocabulary learned '" + v.term + "'"
      });
    });
    return next;
  }

  var api = { buildDigest: buildDigest, applyChange: applyChange, learnTerm: learnTerm, vocabularyOf: vocabularyOf };
  root.WitnessOntology = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
