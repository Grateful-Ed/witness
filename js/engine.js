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
  var TYPE_PRIORITY = { receive: 0, load: 1, pick: 1, putaway: 2, breakdown: 3, consolidate: 4 };

  /* Where picked freight waits for its truck when an order names no
     door: the building's loading door. */
  var DEFAULT_OUTBOUND_DOOR = 'Outbound Door 4';

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

  /* A record is {ts, text}, plus optional fields that say what kind
     of thing happened (kind: complete / incident / hold / release /
     arrive / ship) so the shift summary can count from the records
     instead of anyone writing it up by hand. */
  function addRecord(state, text, extra) {
    var r = { ts: new Date().toISOString(), text: text };
    if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
    state.records.push(r);
    return r;
  }

  function isHeldBin(bin) { return !!bin && bin.status === 'hold'; }
  function stagingById(state, id) {
    for (var i = 0; i < state.staging.length; i++) if (state.staging[i].id === id) return state.staging[i];
    return null;
  }
  function orderById(state, id) {
    for (var i = 0; i < state.outbound.length; i++) if (state.outbound[i].id === id) return state.outbound[i];
    return null;
  }
  function shipmentById(state, id) {
    for (var i = 0; i < state.inbound.length; i++) if (state.inbound[i].id === id) return state.inbound[i];
    return null;
  }
  function unitName(state, unitId) {
    var u = unitId ? unitById(state, unitId) : null;
    return u ? u.name : 'someone not on the labor list';
  }

  /* ---------- outbound allocation ------------------------------------ */
  /* A line is reserved against real bin quantities: what's in the bin
     minus what other unpicked, already-reserved lines are counting on.
     Held bins are never allocated from. The line's own bin is tried
     first, then any other usable bin holding enough of the item
     (lowest id first). A line is never split across bins and never
     silently shorted: if no single bin can fill it, it is marked short
     with the numbers, and tried again on the next pass. */
  function reservedQty(state, binId, desc, exceptLine) {
    var q = 0;
    state.outbound.forEach(function (o) {
      o.lines.forEach(function (l) {
        if (l === exceptLine || l.done || !l.allocated) return;
        if (l.binId === binId && l.desc === desc) q += l.qty;
      });
    });
    return q;
  }
  function freeQty(state, bin, desc, exceptLine) {
    if (!bin || isHeldBin(bin)) return 0;
    return Math.max(0, qtyInBin(bin, desc) - reservedQty(state, bin.id, desc, exceptLine));
  }

  function allocateOrders(state) {
    state.outbound.forEach(function (o) {
      if (o.status === 'staged at door' || o.status === 'shipped' || o.status === 'picked') return;
      o.lines.forEach(function (line) {
        if (line.done || line.allocated) return;
        var own = binById(state, line.binId);
        var pick = (own && freeQty(state, own, line.desc, line) >= line.qty) ? own : null;
        if (!pick) {
          state.bins.slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; }).forEach(function (b) {
            if (!pick && freeQty(state, b, line.desc, line) >= line.qty) pick = b;
          });
        }
        if (pick) {
          line.binId = pick.id;
          line.allocated = true;
          line.short = null;
        } else {
          var best = 0;
          state.bins.forEach(function (b) { best = Math.max(best, freeQty(state, b, line.desc, line)); });
          line.short = { want: line.qty, free: best };
        }
      });
      var anyDone = o.lines.some(function (l) { return l.done; });
      var anyShort = o.lines.some(function (l) { return !l.done && !l.allocated; });
      o.status = anyDone ? 'picking' : (anyShort ? 'allocating' : 'allocated');
    });
  }

  /* ---------- task generation -------------------------------------- */
  /* Tasks are derived from the world, never typed in. A task's id is
     its natural key (putaway-STG-1, pick-ORD-501-B-04, …) so
     generating twice never duplicates, and a done task stays done. */

  function haveTask(state, id) { return !!taskById(state, id); }

  /* Fixed home locations (dedicated storage, a real WMS concept): a
     staged item may name its home bin. The home wins when it exists,
     is not held, and is free — empty, or a mixed bin (one built to
     hold many different items, like a fridge). Otherwise null, and
     the caller falls back to the emptiest-bin rule unchanged. */
  function homeBinFor(state, p) {
    if (!p || !p.home) return null;
    var b = binById(state, p.home);
    if (!b || isHeldBin(b)) return null;
    if (b.contents.length && !b.mixed) return null;
    return b;
  }

  function generateTasks(state) {
    /* Putaway: every pallet staged at a door wants a bin in the
       door's zone — its home bin when that is free, else the
       emptiest usable one. */
    state.staging.forEach(function (p) {
      var id = 't-putaway-' + p.id;
      if (haveTask(state, id)) return;
      if (p.hold) return; /* a held pallet waits; released, it gets its task */
      var door = doorById(state, p.door);
      var zone = door ? door.zone : null;
      var target = homeBinFor(state, p) || (zone ? emptiestBin(state, zone, null) : null);
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
      if (isHeldBin(b)) return; /* held stock is not a consolidation candidate */
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
      if (!b.needsBreakdown || !b.contents.length || isHeldBin(b)) return;
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

    /* Pick: one task per order line that allocation could reserve.
       A short line gets no task until stock is there to pick. */
    allocateOrders(state);
    state.outbound.forEach(function (o) {
      if (o.status === 'picked' || o.status === 'staged at door' || o.status === 'shipped') return;
      o.lines.forEach(function (line) {
        if (line.done || !line.allocated) return;
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

    /* Load: a fully picked order staged at its door goes on the truck. */
    state.outbound.forEach(function (o) {
      if (o.status !== 'staged at door') return;
      var id = 't-load-' + o.id;
      if (haveTask(state, id)) return;
      var door = doorById(state, o.door || DEFAULT_OUTBOUND_DOOR);
      var total = 0;
      o.lines.forEach(function (l) { total += l.pickedQty || 0; });
      state.tasks.push({
        id: id, type: 'load', zone: door ? door.zone : null,
        title: 'Load ' + o.id + ' at ' + (door ? door.id : (o.door || DEFAULT_OUTBOUND_DOOR)),
        detail: total + ' picked: ' + o.lines.map(function (l) { return (l.pickedQty || 0) + ' × ' + l.desc; }).join(', ') + '.',
        orderId: o.id,
        status: 'open', assignee: null
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
    var open = state.tasks.filter(function (t) { return t.status === 'open' && !blockedBy(state, t); });
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

  /* ---------- holds block work ------------------------------------------ */
  /* The bins and pallets a task would touch. */
  function taskTouches(task) {
    var bins = [], pallets = [];
    if (task.type === 'putaway') { if (task.toBinId) bins.push(task.toBinId); pallets.push(task.stagingId); }
    else if (task.type === 'consolidate') { bins.push(task.fromBinId, task.toBinId); }
    else if (task.type === 'breakdown' || task.type === 'pick') { bins.push(task.binId); }
    return { bins: bins, pallets: pallets };
  }

  /* Why a task can't be worked right now, in plain words — or null. */
  function blockedBy(state, task) {
    if (!task || task.status === 'done') return null;
    var t = taskTouches(task);
    for (var i = 0; i < t.bins.length; i++) {
      var b = binById(state, t.bins[i]);
      if (isHeldBin(b)) return 'Bin ' + b.id + ' is on hold' + (b.hold && b.hold.reason ? ' — ' + b.hold.reason : '') + '.';
    }
    for (var j = 0; j < t.pallets.length; j++) {
      var p = stagingById(state, t.pallets[j]);
      if (p && p.hold) return 'Pallet ' + p.id + ' is on hold' + (p.hold.reason ? ' — ' + p.hold.reason : '') + '.';
    }
    return null;
  }

  /* ---------- completion: the books must balance --------------------- */

  function completeTask(state, taskId) {
    var task = taskById(state, taskId);
    if (!task || task.status === 'done') return false;
    if (blockedBy(state, task)) return false; /* held stock is not touched */
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
      var pdoor = doorById(state, pallet.door);
      if (pdoor && pdoor.state === 'staged' && !pdoor.shipmentId &&
          !state.staging.some(function (q) { return q.door === pdoor.id; })) pdoor.state = 'empty';
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
          if (line.binId === task.binId && line.desc === task.desc && !line.done) {
            line.done = true;
            line.pickedQty = task.qty;
          }
        });
        var allDone = order.lines.every(function (l) { return l.done; });
        if (allDone) {
          order.door = order.door || DEFAULT_OUTBOUND_DOOR;
          order.status = 'staged at door';
        } else {
          order.status = 'picking';
        }
      }
      text = 'Picked ' + task.qty + ' × ' + task.desc + ' from ' + pbin.id + ' for ' + task.orderId +
             (order && order.status === 'staged at door' ? ' — order fully picked, staged at ' + order.door + '.' : '.');
    }

    else if (task.type === 'receive') {
      var ship = shipmentById(state, task.shipmentId);
      if (ship) ship.status = 'received';
      /* What was received becomes staged pallets at the door — one per
         pallet on the bill of lading — and putaway is generated from
         those, never typed in. */
      var stagedNow = 0, casesNow = 0;
      if (ship && ship.lines) {
        ship.lines.forEach(function (line) {
          for (var n = 0; n < line.pallets; n++) {
            stagedNow++;
            casesNow += line.perPallet;
            state.staging.push({ id: 'STG-' + ship.id + '-' + stagedNow, door: ship.door, desc: line.desc,
              qty: line.perPallet, shipmentId: ship.id });
          }
        });
      }
      var door2 = doorById(state, ship ? ship.door : null);
      if (door2 && door2.shipmentId === task.shipmentId) {
        door2.state = stagedNow ? 'staged' : 'empty';
        door2.shipmentId = null;
      }
      text = 'Received ' + task.shipmentId + ' — cross-check run in the receiving app, freight accepted.' +
        (stagedNow ? ' ' + stagedNow + ' pallets (' + casesNow + ' cases/bags) staged at ' + ship.door + ' for putaway.' : '');
    }

    else if (task.type === 'load') {
      var lorder = orderById(state, task.orderId);
      if (!lorder || lorder.status !== 'staged at door') return false;
      lorder.status = 'shipped';
      var shippedQty = 0;
      lorder.lines.forEach(function (l) { shippedQty += l.pickedQty || 0; });
      lorder.shippedQty = shippedQty;
      text = 'Shipped ' + lorder.id + ' from ' + lorder.door + ' — ' + shippedQty + ' loaded: ' +
        lorder.lines.map(function (l) { return (l.pickedQty || 0) + ' × ' + l.desc; }).join(', ') + '.';
    }

    else {
      return false;
    }

    task.status = 'done';
    task.doneBy = task.assignee || null;
    task.doneAt = new Date().toISOString();
    if (task.assignee) {
      var unit = unitById(state, task.assignee);
      if (unit && unit.currentTaskId === task.id) unit.currentTaskId = null;
      task.assignee = null;
    }
    if (text) addRecord(state, text, { kind: 'complete', taskId: task.id, type: task.type, zone: task.zone, by: task.doneBy });
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

  /* ---------- incident updates: records are never frozen ------------- */
  /* William's standing design: a load fine at scan can go bad while it
     is moved, and the update rides the same record. Any task — open,
     in hand, or done — takes an update in plain words. It is pinned to
     the task (task.notes) and written to the records with who and
     when. It moves nothing and closes nothing. Returns the record
     entry, or null when there is no such task or no words. */
  function addTaskUpdate(state, taskId, text, byUnit) {
    var task = taskById(state, taskId);
    var words = String(text || '').trim();
    if (!task || !words) return null;
    var by = byUnit && unitById(state, byUnit) ? byUnit : null;
    var ts = new Date().toISOString();
    task.notes = task.notes || [];
    task.notes.push({ ts: ts, by: by, text: words });
    var r = addRecord(state, 'Update on "' + task.title + '" from ' + unitName(state, by) + ': ' + words,
      { kind: 'incident', taskId: task.id, zone: task.zone, by: by });
    r.ts = ts;
    return r;
  }

  /* ---------- problems reported mid-task ------------------------------ */
  /* The conversational layer's problem intent. A worker says something
     is wrong: with a task in hand, this is addTaskUpdate on that task.
     With no task in hand the report still lands in the records, so
     nothing said is lost. Returns { task, entry } or null. */
  function reportProblem(state, unitId, note) {
    var unit = unitById(state, unitId);
    var text = String(note || '').trim();
    if (!unit || !text) return null;
    var task = null;
    if (unit.currentTaskId) {
      var t = taskById(state, unit.currentTaskId);
      if (t && t.status === 'assigned') task = t;
    }
    if (task) {
      var r = addTaskUpdate(state, task.id, text, unit.id);
      return { task: task, entry: task.notes[task.notes.length - 1], record: r };
    }
    var rec = addRecord(state, 'Problem reported by ' + unit.name + ' (no task in hand): ' + text,
      { kind: 'incident', taskId: null, zone: unit.zone, by: unit.id });
    return { task: null, entry: { ts: rec.ts, by: unit.id, text: text }, record: rec };
  }

  /* ---------- inbound: the truck arrives -------------------------------- */
  /* An expected shipment arrives at its door. The door must not be
     holding another shipment. Returns { ok, reason }. */
  function arriveShipment(state, shipmentId, byUnit) {
    var ship = shipmentById(state, shipmentId);
    if (!ship) return { ok: false, reason: 'No shipment ' + shipmentId + '.' };
    if (ship.status === 'staged at door' || ship.status === 'received') {
      return { ok: false, reason: ship.id + ' is already here.' };
    }
    var door = doorById(state, ship.door);
    if (!door) return { ok: false, reason: ship.id + ' has no door assigned.' };
    if (door.direction === 'out') return { ok: false, reason: door.id + ' is an outbound door. ' + ship.id + ' comes in at an inbound door.' };
    if (door.shipmentId && door.shipmentId !== ship.id) {
      return { ok: false, reason: door.id + ' is busy with ' + door.shipmentId + '. Receive that one first.' };
    }
    ship.status = 'staged at door';
    door.state = 'unloading';
    door.shipmentId = ship.id;
    addRecord(state, ship.id + ' arrived at ' + door.id + ' — ' + ship.pallets + ' pallets. Logged by ' +
      unitName(state, byUnit) + '.', { kind: 'arrive', shipmentId: ship.id, by: byUnit || null });
    return { ok: true, reason: null };
  }

  /* ---------- holds --------------------------------------------------------- */
  /* A manager puts a bin or a staged pallet on hold, or releases it.
     target is { binId } or { stagingId }. A task someone has in hand
     that touches the held stock goes back to the queue (the worker is
     freed), and it can't be assigned or completed until release.
     Returns { ok, reason, freed: [unit names] }. */
  function holdTarget(state, target) {
    if (target && target.binId) {
      var b = binById(state, target.binId);
      return b ? { kind: 'bin', obj: b, label: 'Bin ' + b.id } : null;
    }
    if (target && target.stagingId) {
      var p = stagingById(state, target.stagingId);
      return p ? { kind: 'pallet', obj: p, label: 'Pallet ' + p.id + ' (' + p.qty + ' × ' + p.desc + ', ' + p.door + ')' } : null;
    }
    return null;
  }

  function placeHold(state, target, byUnit, reason) {
    var h = holdTarget(state, target);
    if (!h) return { ok: false, reason: 'Nothing like that to hold.', freed: [] };
    var already = h.kind === 'bin' ? h.obj.status === 'hold' : !!h.obj.hold;
    if (already) return { ok: false, reason: h.label + ' is already on hold.', freed: [] };
    var why = String(reason || '').trim();
    var info = { by: byUnit || null, reason: why, ts: new Date().toISOString() };
    if (h.kind === 'bin') { h.obj.status = 'hold'; h.obj.hold = info; }
    else { h.obj.hold = info; }
    var freed = [];
    state.tasks.forEach(function (t) {
      if (t.status !== 'assigned' || !blockedBy(state, t)) return;
      var u = unitById(state, t.assignee);
      if (u && u.currentTaskId === t.id) { u.currentTaskId = null; freed.push(u.name); }
      t.status = 'open';
      t.assignee = null;
    });
    addRecord(state, h.label + ' put on hold by ' + unitName(state, byUnit) + (why ? ': ' + why : '') + '.' +
      (freed.length ? ' Back to the queue from ' + freed.join(', ') + '.' : ''),
      { kind: 'hold', target: target, by: byUnit || null });
    return { ok: true, reason: null, freed: freed };
  }

  function releaseHold(state, target, byUnit) {
    var h = holdTarget(state, target);
    if (!h) return { ok: false, reason: 'Nothing like that to release.' };
    var held = h.kind === 'bin' ? h.obj.status === 'hold' : !!h.obj.hold;
    if (!held) return { ok: false, reason: h.label + ' is not on hold.' };
    if (h.kind === 'bin') h.obj.status = 'ok';
    delete h.obj.hold;
    addRecord(state, h.label + ' released from hold by ' + unitName(state, byUnit) + '.',
      { kind: 'release', target: target, by: byUnit || null });
    return { ok: true, reason: null };
  }

  function currentHolds(state) {
    var out = [];
    state.bins.forEach(function (b) {
      if (b.status === 'hold') out.push({ target: { binId: b.id }, label: 'Bin ' + b.id, zone: b.zone,
        reason: b.hold ? b.hold.reason : '', by: b.hold ? unitName(state, b.hold.by) : null,
        ts: b.hold ? b.hold.ts : null });
    });
    state.staging.forEach(function (p) {
      if (p.hold) out.push({ target: { stagingId: p.id }, label: 'Pallet ' + p.id + ' at ' + p.door,
        zone: (doorById(state, p.door) || {}).zone || null, reason: p.hold.reason, by: unitName(state, p.hold.by), ts: p.hold.ts });
    });
    return out;
  }

  /* ---------- stages, in the words the work uses ------------------------ */

  function inboundStage(state, ship) {
    if (ship.status === 'staged at door') {
      var rt = taskById(state, 't-receive-' + ship.id);
      if (rt && rt.status === 'assigned') {
        return { key: 'receiving', words: 'Being received at ' + ship.door + ' — ' + unitName(state, rt.assignee) + '.' };
      }
      return { key: 'arrived', words: 'At ' + ship.door + ' — waiting to be received.' };
    }
    if (ship.status === 'received') {
      var total = 0;
      (ship.lines || []).forEach(function (l) { total += l.pallets; });
      var left = state.staging.filter(function (p) { return p.shipmentId === ship.id; }).length;
      if (left) return { key: 'putaway', words: 'Received — putting away: ' + left + ' of ' + total + ' pallets still at ' + ship.door + '.' };
      return { key: 'closed', words: 'Closed — received, all ' + total + ' pallets in bins.' };
    }
    return { key: 'expected', words: 'Expected ' + String(ship.status).replace(/^expected\s*/, '') + ' — ' + ship.door + '.' };
  }

  function orderStage(state, o) {
    var n = o.lines.length;
    var picked = o.lines.filter(function (l) { return l.done; }).length;
    if (o.status === 'shipped') return { key: 'shipped', words: 'Shipped from ' + o.door + ' — ' + (o.shippedQty || 0) + ' loaded.' };
    if (o.status === 'staged at door' || o.status === 'picked') {
      var lt = taskById(state, 't-load-' + o.id);
      if (lt && lt.status === 'assigned') return { key: 'loading', words: 'Loading at ' + o.door + ' — ' + unitName(state, lt.assignee) + '.' };
      return { key: 'staged', words: 'Picked, staged at ' + (o.door || DEFAULT_OUTBOUND_DOOR) + ' — waiting to load.' };
    }
    var shorts = o.lines.filter(function (l) { return !l.done && !l.allocated; });
    if (shorts.length) {
      return { key: 'allocating', words: 'Allocating — ' + shorts.length + ' of ' + n + ' line' + (n === 1 ? '' : 's') + ' short: ' +
        shorts.map(function (l) {
          return 'wants ' + l.qty + ' × ' + l.desc + ', ' + (l.short ? l.short.free : 0) + ' free in any one usable bin';
        }).join('; ') + '.' };
    }
    if (picked) return { key: 'picking', words: 'Picking — ' + picked + ' of ' + n + ' lines picked.' };
    return { key: 'allocated', words: 'Allocated — ' + n + ' line' + (n === 1 ? '' : 's') + ' reserved, waiting to pick.' };
  }

  /* Where an allocated line picks from, as the page says it. If the
     source bin went on hold after the line was allocated, the words
     confess it. Display only: the reservation itself is untouched. */
  function lineSource(state, line) {
    return 'from ' + line.binId + (isHeldBin(binById(state, line.binId)) ? ' — bin on hold' : '');
  }

  /* ---------- shift summary: computed, never hand-written --------------- */

  function shiftSummary(state) {
    var byType = {}, byZone = {}, byUnit = {}, done = 0;
    state.tasks.forEach(function (t) {
      if (t.status !== 'done') return;
      done++;
      byType[t.type] = (byType[t.type] || 0) + 1;
      var z = t.zone || '—';
      byZone[z] = (byZone[z] || 0) + 1;
      var who = t.doneBy || '(not assigned)';
      byUnit[who] = (byUnit[who] || 0) + 1;
    });
    var perUnit = state.labor.filter(function (u) { return u.role === 'worker'; }).map(function (u) {
      return { id: u.id, name: u.name, zone: u.zone, done: byUnit[u.id] || 0 };
    });
    if (byUnit['(not assigned)']) perUnit.push({ id: null, name: 'Not assigned to anyone', zone: null, done: byUnit['(not assigned)'] });
    var incidents = state.records.filter(function (r) { return r.kind === 'incident'; });
    var holdEvents = state.records.filter(function (r) { return r.kind === 'hold' || r.kind === 'release'; });
    return {
      tasksDone: done,
      doneByType: byType,
      doneByZone: byZone,
      perUnit: perUnit,
      bottleneck: bottleneck(state),
      incidents: incidents,
      holdEvents: holdEvents,
      holdsNow: currentHolds(state),
      ordersShipped: state.outbound.filter(function (o) { return o.status === 'shipped'; })
        .map(function (o) { return { id: o.id, qty: o.shippedQty || 0, door: o.door }; }),
      shipmentsReceived: state.inbound.filter(function (s) { return s.status === 'received'; })
        .map(function (s) { return { id: s.id, pallets: s.pallets, door: s.door }; })
    };
  }

  /* ---------- saved state from before this slice ------------------------- */
  /* A browser that saved the warehouse before bills of lading and
     outbound doors existed gets them filled in from the seed, by id.
     Nothing that happened is changed. */
  function upgradeState(state) {
    if (!state || !SEED) return state;
    state.inbound.forEach(function (s) {
      if (s.lines) return;
      SEED.inbound.forEach(function (x) { if (x.id === s.id && x.lines) s.lines = deepCopy(x.lines); });
    });
    /* The file copy of each BOL (for the dock scan), filled by id; a
       seed shipment the saved state has never heard of joins as it
       is in the seed. Only within the same world. */
    var sameWorld = (state.world || 'warehouse') === (SEED.world || 'warehouse');
    (sameWorld ? SEED.inbound || [] : []).forEach(function (x) {
      var have = null;
      state.inbound.forEach(function (s) { if (s.id === x.id) have = s; });
      if (!have) state.inbound.push(deepCopy(x));
      else if (!have.bol && x.bol) have.bol = deepCopy(x.bol);
    });
    state.outbound.forEach(function (o) {
      if (!o.door) o.door = DEFAULT_OUTBOUND_DOOR;
      if (o.status === 'picked') o.status = 'staged at door';
      o.lines.forEach(function (l) { if (l.done && l.pickedQty == null) l.pickedQty = l.qty; });
    });
    return state;
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    reportProblem: reportProblem,
    addTaskUpdate: addTaskUpdate,
    arriveShipment: arriveShipment,
    placeHold: placeHold,
    releaseHold: releaseHold,
    currentHolds: currentHolds,
    blockedBy: blockedBy,
    inboundStage: inboundStage,
    orderStage: orderStage,
    lineSource: lineSource,
    shiftSummary: shiftSummary,
    upgradeState: upgradeState,
    orderById: orderById,
    shipmentById: shipmentById,
    seedWorld: seedWorld,
    loadState: loadState,
    saveState: saveState,
    resetState: resetState,
    generateTasks: generateTasks,
    homeBinFor: homeBinFor,
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
