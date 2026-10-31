/* =====================================================================
   engine.js — the warehouse's working logic. Pure: no DOM, no
   network, no clock-reading except stamping records. Loads in the
   browser (window.WitnessEngine) and in node (module.exports), so
   test/engine-test.js exercises exactly the code the page runs.

   The one law: the numbers must reconcile. Completing a task moves
   real quantities between staging, bins and orders — nothing is
   created, nothing vanishes. If the books would not balance, the
   completion refuses rather than inventing freight.
   ===================================================================== */
(function (root) {
  'use strict';

  var STORAGE_KEY = 'witness-warehouse-v1';

  /* A bin count below this is a partial pallet for consolidation
     purposes: two partials of the same item should marry up. */
  var FULL_PALLET_QTY = 40;

  /* What gets done first when a worker asks for work: freight at a
     door waits on nobody, orders have a truck behind them, putaway
     clears the dock, breakdowns and marriages are housekeeping. */
  var TYPE_PRIORITY = { receive: 0, pick: 1, putaway: 2, breakdown: 3, consolidate: 4 };

  var SEED = null;
  if (typeof root !== 'undefined' && root.WitnessWorldSeed) SEED = root.WitnessWorldSeed;
  if (!SEED && typeof require === 'function') {
    try { SEED = require('../data/world.js'); } catch (e) { SEED = null; }
  }

  /* ---------- state & storage ------------------------------------- */

  function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }

  function seedWorld() {
    if (!SEED) throw new Error('engine: world seed not loaded');
    return deepCopy(SEED);
  }

  var memoryFallback = (function () {
    var m = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; }
    };
  })();

  function defaultStorage() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
    } catch (e) { /* private mode etc. — fall through */ }
    return memoryFallback;
  }

  function loadState(store) {
    store = store || defaultStorage();
    try {
      var raw = store.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.bins || !parsed.labor) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function saveState(state, store) {
    store = store || defaultStorage();
    store.setItem(STORAGE_KEY, JSON.stringify(state));
    return state;
  }

  function resetState(store) {
    store = store || defaultStorage();
    try { store.removeItem(STORAGE_KEY); } catch (e) { /* nothing to clear */ }
    var fresh = seedWorld();
    generateTasks(fresh);
    saveState(fresh, store);
    return fresh;
  }

  /* ---------- lookups ---------------------------------------------- */

  function binById(state, id) {
    for (var i = 0; i < state.bins.length; i++) if (state.bins[i].id === id) return state.bins[i];
    return null;
  }
  function unitById(state, id) {
    for (var i = 0; i < state.labor.length; i++) if (state.labor[i].id === id) return state.labor[i];
    return null;
  }
  function taskById(state, id) {
    for (var i = 0; i < state.tasks.length; i++) if (state.tasks[i].id === id) return state.tasks[i];
    return null;
  }
  function doorById(state, id) {
    for (var i = 0; i < state.doors.length; i++) if (state.doors[i].id === id) return state.doors[i];
    return null;
  }
  function binTotal(bin) {
    var t = 0;
    bin.contents.forEach(function (c) { t += c.qty; });
    return t;
  }
  function addToBin(bin, desc, qty) {
    for (var i = 0; i < bin.contents.length; i++) {
      if (bin.contents[i].desc === desc) { bin.contents[i].qty += qty; return; }
    }
    bin.contents.push({ desc: desc, qty: qty });
  }
  function removeFromBin(bin, desc, qty) {
    for (var i = 0; i < bin.contents.length; i++) {
      if (bin.contents[i].desc === desc) {
        if (bin.contents[i].qty < qty) return false;
        bin.contents[i].qty -= qty;
        if (bin.contents[i].qty === 0) bin.contents.splice(i, 1);
        return true;
      }
    }
    return false;
  }
  function qtyInBin(bin, desc) {
    for (var i = 0; i < bin.contents.length; i++) {
      if (bin.contents[i].desc === desc) return bin.contents[i].qty;
    }
    return 0;
  }

  /* The emptiest usable bin in a zone: not on hold, lowest total
     count, lowest id on a tie. */
  function emptiestBin(state, zone, excludeIds) {
    var best = null;
    state.bins.forEach(function (b) {
      if (b.zone !== zone || b.status === 'hold') return;
      if (excludeIds && excludeIds.indexOf(b.id) !== -1) return;
      if (!best || binTotal(b) < binTotal(best) ||
          (binTotal(b) === binTotal(best) && b.id < best.id)) best = b;
    });
    return best;
  }

  function addRecord(state, text) {
    state.records.push({ ts: new Date().toISOString(), text: text });
  }

  /* ---------- task generation -------------------------------------- */
  /* Tasks are derived from the world, never typed in. A task's id is
     its natural key (putaway-STG-1, pick-ORD-501-B-04, …) so
     generating twice never duplicates, and a done task stays done. */

  function haveTask(state, id) { return !!taskById(state, id); }

  function generateTasks(state) {
    /* Putaway: every pallet staged at a door wants a bin in the
       door's zone — the emptiest usable one. */
    state.staging.forEach(function (p) {
      var id = 't-putaway-' + p.id;
      if (haveTask(state, id)) return;
      var door = doorById(state, p.door);
      var zone = door ? door.zone : null;
      var target = zone ? emptiestBin(state, zone, null) : null;
      state.tasks.push({
        id: id, type: 'putaway', zone: zone,
        title: 'Put away ' + p.qty + ' × ' + p.desc,
        detail: 'Staged at ' + p.door + (target ? ' — suggested bin ' + target.id : ''),
        stagingId: p.id, toBinId: target ? target.id : null,
        status: 'open', assignee: null
      });
    });

    /* Consolidate: the same item sitting partial in two or more
       bins. Smallest pile moves onto the biggest. */
    var byDesc = {};
    state.bins.forEach(function (b) {
      b.contents.forEach(function (c) {
        if (c.qty < FULL_PALLET_QTY) {
          (byDesc[c.desc] = byDesc[c.desc] || []).push({ binId: b.id, zone: b.zone, qty: c.qty });
        }
      });
    });
    Object.keys(byDesc).forEach(function (desc) {
      var spots = byDesc[desc];
      if (spots.length < 2) return;
      var id = 't-consolidate-' + desc;
      if (haveTask(state, id)) return;
      var sorted = spots.slice().sort(function (a, b2) { return a.qty - b2.qty; });
      var from = sorted[0];
      var to = sorted[sorted.length - 1];
      state.tasks.push({
        id: id, type: 'consolidate', zone: to.zone,
        title: 'Consolidate ' + desc,
        detail: 'Bring the ' + from.qty + ' in ' + from.binId + ' onto the ' + to.qty +
                ' in ' + to.binId + ' — one pile, one bin.',
        desc: desc, fromBinId: from.binId, toBinId: to.binId,
        status: 'open', assignee: null
      });
    });

    /* Breakdown: stored pallets flagged to come apart. */
    state.bins.forEach(function (b) {
      if (!b.needsBreakdown || !b.contents.length) return;
      var id = 't-breakdown-' + b.id;
      if (haveTask(state, id)) return;
      var c = b.contents[0];
      state.tasks.push({
        id: id, type: 'breakdown', zone: b.zone,
        title: 'Break down the pallet in ' + b.id,
        detail: c.qty + ' × ' + c.desc + ' — split into cartons across the emptiest bins in zone ' + b.zone + '.',
        binId: b.id, desc: c.desc,
        status: 'open', assignee: null
      });
    });

    /* Pick: one task per open order line. */
    state.outbound.forEach(function (o) {
      if (o.status === 'picked') return;
      o.lines.forEach(function (line) {
        if (line.done) return;
        var id = 't-pick-' + o.id + '-' + line.binId;
        if (haveTask(state, id)) return;
        var bin = binById(state, line.binId);
        state.tasks.push({
          id: id, type: 'pick', zone: bin ? bin.zone : null,
          title: 'Pick ' + line.qty + ' × ' + line.desc + ' for ' + o.id,
          detail: 'From bin ' + line.binId + '.',
          orderId: o.id, binId: line.binId, desc: line.desc, qty: line.qty,
          status: 'open', assignee: null
        });
      });
    });

    /* Receive: a shipment staged at a door gets a receiving task.
       The cross-check itself is module one — this task links there. */
    state.inbound.forEach(function (s) {
      if (s.status !== 'staged at door') return;
      var id = 't-receive-' + s.id;
      if (haveTask(state, id)) return;
      var door = doorById(state, s.door);
      state.tasks.push({
        id: id, type: 'receive', zone: door ? door.zone : null,
        title: 'Receive ' + s.id + ' at ' + s.door,
        detail: s.desc + ' — ' + s.pallets + ' pallets. Run the cross-check, then mark this done.',
        shipmentId: s.id, link: 'index.html',
        status: 'open', assignee: null
      });
    });

    return state.tasks;
  }

  /* ---------- assignment -------------------------------------------- */

  function nextTaskFor(state, unit) {
    if (!unit) return null;
    if (unit.currentTaskId) {
      var current = taskById(state, unit.currentTaskId);
      if (current && current.status === 'assigned') return current;
      unit.currentTaskId = null;
    }
    var open = state.tasks.filter(function (t) { return t.status === 'open'; });
    if (!open.length) return null;
    open.sort(function (a, b) {
      var az = a.zone === unit.zone ? 0 : 1;
      var bz = b.zone === unit.zone ? 0 : 1;
      if (az !== bz) return az - bz;
      var ap = TYPE_PRIORITY[a.type], bp = TYPE_PRIORITY[b.type];
      if (ap !== bp) return ap - bp;
      return a.id < b.id ? -1 : 1;
    });
    var task = open[0];
    task.status = 'assigned';
    task.assignee = unit.id;
    unit.currentTaskId = task.id;
    return task;
  }

  /* ---------- completion: the books must balance --------------------- */

  function completeTask(state, taskId) {
    var task = taskById(state, taskId);
    if (!task || task.status === 'done') return false;
    var text = null;

    if (task.type === 'putaway') {
      var idx = -1;
      for (var i = 0; i < state.staging.length; i++) {
        if (state.staging[i].id === task.stagingId) { idx = i; break; }
      }
      if (idx === -1 || !task.toBinId) return false;
      var pallet = state.staging[idx];
      var bin = binById(state, task.toBinId);
      if (!bin) return false;
      addToBin(bin, pallet.desc, pallet.qty);
      state.staging.splice(idx, 1);
      text = 'Put away ' + pallet.qty + ' × ' + pallet.desc + ' — ' + pallet.door + ' → bin ' + bin.id + '.';
    }

    else if (task.type === 'consolidate') {
      var fromBin = binById(state, task.fromBinId);
      var toBin = binById(state, task.toBinId);
      if (!fromBin || !toBin) return false;
      var qty = qtyInBin(fromBin, task.desc);
      if (qty === 0) return false;
      removeFromBin(fromBin, task.desc, qty);
      addToBin(toBin, task.desc, qty);
      text = 'Consolidated ' + task.desc + ' — moved ' + qty + ' from ' + fromBin.id +
             ' onto ' + toBin.id + ' (' + qtyInBin(toBin, task.desc) + ' there now).';
    }

    else if (task.type === 'breakdown') {
      var src = binById(state, task.binId);
      if (!src) return false;
      var total = qtyInBin(src, task.desc);
      if (total === 0) return false;
      /* Split evenly across the three emptiest other bins in the
         zone; the first bins take the remainder, one each. */
      var targets = state.bins
        .filter(function (b) { return b.zone === src.zone && b.id !== src.id && b.status !== 'hold'; })
        .sort(function (a, b) {
          var d = binTotal(a) - binTotal(b);
          return d !== 0 ? d : (a.id < b.id ? -1 : 1);
        })
        .slice(0, 3);
      if (!targets.length) return false;
      removeFromBin(src, task.desc, total);
      src.needsBreakdown = false;
      var base = Math.floor(total / targets.length);
      var rem = total - base * targets.length;
      var parts = [];
      targets.forEach(function (t, j) {
        var q = base + (j < rem ? 1 : 0);
        if (q > 0) { addToBin(t, task.desc, q); parts.push(q + ' → ' + t.id); }
      });
      text = 'Broke down the pallet in ' + src.id + ' — ' + total + ' × ' + task.desc +
             ' split: ' + parts.join(', ') + '.';
    }

    else if (task.type === 'pick') {
      var pbin = binById(state, task.binId);
      if (!pbin || qtyInBin(pbin, task.desc) < task.qty) return false;
      removeFromBin(pbin, task.desc, task.qty);
      var order = null;
      state.outbound.forEach(function (o) { if (o.id === task.orderId) order = o; });
      if (order) {
        order.lines.forEach(function (line) {
          if (line.binId === task.binId && line.desc === task.desc) line.done = true;
        });
        var allDone = order.lines.every(function (l) { return l.done; });
        order.status = allDone ? 'picked' : 'picking';
      }
      text = 'Picked ' + task.qty + ' × ' + task.desc + ' from ' + pbin.id + ' for ' + task.orderId +
             (order && order.status === 'picked' ? ' — order fully picked.' : '.');
    }

    else if (task.type === 'receive') {
      state.inbound.forEach(function (s) {
        if (s.id === task.shipmentId) s.status = 'received';
      });
      var door2 = doorById(state, (state.inbound.filter(function (s) {
        return s.id === task.shipmentId;
      })[0] || {}).door);
      if (door2 && door2.shipmentId === task.shipmentId) {
        door2.state = 'empty';
        door2.shipmentId = null;
      }
      text = 'Received ' + task.shipmentId + ' — cross-check run in the receiving app, freight accepted.';
    }

    else {
      return false;
    }

    task.status = 'done';
    if (task.assignee) {
      var unit = unitById(state, task.assignee);
      if (unit && unit.currentTaskId === task.id) unit.currentTaskId = null;
      task.assignee = null;
    }
    if (text) addRecord(state, text);
    return true;
  }

  /* ---------- the manager's numbers ---------------------------------- */

  function zoneStats(state) {
    var out = {};
    state.zones.forEach(function (z) {
      var pending = 0, done = 0, workers = 0;
      state.tasks.forEach(function (t) {
        if (t.zone !== z) return;
        if (t.status === 'done') done++;
        else pending++;
      });
      state.labor.forEach(function (u) {
        if (u.role === 'worker' && u.zone === z) workers++;
      });
      var occupied = 0;
      state.bins.forEach(function (b) {
        if (b.zone === z && b.contents.length) occupied++;
      });
      out[z] = { pending: pending, done: done, workersPresent: workers, binsOccupied: occupied };
    });
    return out;
  }

  /* Bottleneck: load per labor unit, by zone.
     Threshold choice (documented per the brief): a zone counts as
     backing up only when it holds at least 4 waiting tasks AND its
     load per worker is at least double the lightest zone's. Below
     that, ordinary unevenness is not a bottleneck and the honest
     answer is null — no move proposed. The suggested unit comes
     from the lightest-loaded zone, an idle unit if there is one. */
  function bottleneck(state) {
    var stats = zoneStats(state);
    var rows = state.zones.map(function (z) {
      var s = stats[z];
      var w = Math.max(s.workersPresent, 1);
      return { zone: z, pending: s.pending, workers: s.workersPresent, load: s.pending / w };
    });
    var worst = rows.slice().sort(function (a, b) {
      if (b.load !== a.load) return b.load - a.load;
      return b.pending - a.pending;
    })[0];
    var lightest = rows.slice().sort(function (a, b) {
      if (a.load !== b.load) return a.load - b.load;
      return a.pending - b.pending;
    })[0];
    if (!worst || worst.zone === lightest.zone) return null;
    if (worst.pending < 4) return null;
    if (worst.load < 2 * lightest.load) return null;
    if (lightest.workersPresent < 1) return null;

    var candidates = state.labor.filter(function (u) {
      return u.role === 'worker' && u.zone === lightest.zone;
    });
    var pick = null;
    candidates.forEach(function (u) { if (!pick && !u.currentTaskId) pick = u; });
    if (!pick) pick = candidates[0];
    if (!pick) return null;

    return {
      zone: worst.zone,
      pending: worst.pending,
      workers: worst.workers,
      loadPerWorker: worst.load,
      suggestion: {
        unitId: pick.id,
        unitName: pick.name,
        fromZone: lightest.zone,
        fromPending: lightest.pending,
        fromWorkers: lightest.workers,
        toZone: worst.zone
      }
    };
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    seedWorld: seedWorld,
    loadState: loadState,
    saveState: saveState,
    resetState: resetState,
    generateTasks: generateTasks,
    nextTaskFor: nextTaskFor,
    completeTask: completeTask,
    zoneStats: zoneStats,
    bottleneck: bottleneck,
    binById: binById,
    unitById: unitById,
    taskById: taskById
  };

  root.WitnessEngine = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
