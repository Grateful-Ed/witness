/* =====================================================================
   wms.js — the full WMS layer, built ON the warehouse engine.

   engine.js stays the building's working logic (tasks, putaway,
   picks, loads, holds, the books that must balance). This module
   adds what a complete WMS needs around it, end to end:

     dock appointments → check-in → receive against the BOL on file
     → OS&D on every discrepancy → putaway (directed, confirmed)
     → live stock, holds, cycle counts, moves, replenishment
     → customer orders → waves → allocation that respects holds
     → picks (voice-confirmed, short picks reconciled) → pack
     → load at a door → ship confirm closes the outbound load
     → per-worker queues, reassignment, labor proposals
     → flags (a label plus the speaker's exact words)
     → dashboard and shift summary computed from real state.

   Pure, like engine.js: no DOM, no network. Everything lives on the
   one state document (state.wms holds the WMS layer), so the desk
   record in the Worker's /state carries all of it. Every mutating
   function validates first and returns { ok:false, reason } without
   touching state when it refuses — so the caller saves only on ok.

   Loads in the browser (window.WitnessWms) and in node
   (module.exports). Needs engine.js and data/wms-seed.js.
   ===================================================================== */
(function (root) {
  'use strict';

  var E = root.WitnessEngine;
  var C = root.WitnessConverse;
  var SEED = root.WitnessWmsSeed;
  if (typeof require === 'function') {
    try { if (!E) E = require('./engine.js'); } catch (e) { /* browser */ }
    try { if (!C) C = require('./converse.js'); } catch (e) { /* optional */ }
    try { if (!SEED) SEED = require('../data/wms-seed.js'); } catch (e) { /* browser */ }
  }

  var WMS_VERSION = 1;

  /* What a worker gets first. Receiving and replenishment keep the
     dock and the pick faces moving; picks, packs and loads have a
     truck behind them; putaway clears the dock; the rest is
     housekeeping. High-priority orders break ties. */
  var PRIORITY = { receive: 0, replen: 1, pick: 2, pack: 2, load: 2, putaway: 3, move: 4, count: 4, breakdown: 5, consolidate: 6 };

  var ENGINE_TYPES = ['putaway', 'consolidate', 'breakdown', 'pick', 'receive', 'load'];

  var api = {};

  /* The clock. Tests replace it; the page leaves it alone. */
  api.now = function () { return new Date().toISOString(); };

  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function no(reason) { return { ok: false, reason: reason }; }
  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }
  function toInt(v) {
    if (typeof v === 'number') return isInt(v) ? v : NaN;
    if (typeof v === 'string' && /^\s*\d+\s*$/.test(v)) return parseInt(v, 10);
    return NaN;
  }

  /* ---------- small lookups ------------------------------------------ */

  function bin(state, id) { return E.binById(state, id); }
  function unit(state, id) { return id ? E.unitById(state, id) : null; }
  function task(state, id) { return E.taskById(state, id); }
  function door(state, id) {
    for (var i = 0; i < state.doors.length; i++) if (state.doors[i].id === id) return state.doors[i];
    return null;
  }
  function order(state, id) { return E.orderById(state, id); }
  function shipment(state, id) { return E.shipmentById(state, id); }
  function qtyIn(b, desc) {
    if (!b) return 0;
    for (var i = 0; i < b.contents.length; i++) if (b.contents[i].desc === desc) return b.contents[i].qty;
    return 0;
  }
  function binTotal(b) { var t = 0; b.contents.forEach(function (c) { t += c.qty; }); return t; }
  function addTo(b, desc, qty) {
    for (var i = 0; i < b.contents.length; i++) {
      if (b.contents[i].desc === desc) { b.contents[i].qty += qty; return; }
    }
    b.contents.push({ desc: desc, qty: qty });
  }
  function takeFrom(b, desc, qty) {
    for (var i = 0; i < b.contents.length; i++) {
      if (b.contents[i].desc === desc) {
        if (b.contents[i].qty < qty) return false;
        b.contents[i].qty -= qty;
        if (b.contents[i].qty === 0) b.contents.splice(i, 1);
        return true;
      }
    }
    return false;
  }
  function held(b) { return !!b && b.status === 'hold'; }
  function name(state, id) { var u = unit(state, id); return u ? u.name : 'the desk'; }
  function doorZone(state, id) { var d = door(state, id); return d ? d.zone : null; }

  function record(state, text, extra) {
    var r = { ts: api.now(), text: text };
    if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
    state.records.push(r);
    return r;
  }

  function nextId(state, key, prefix, pad) {
    var seq = state.wms.seq;
    var n = seq[key] || 1;
    seq[key] = n + 1;
    var s = String(n);
    while (s.length < (pad || 3)) s = '0' + s;
    return prefix + s;
  }

  function item(state, desc) {
    var it = state.wms && state.wms.items[desc];
    if (it) return it;
    return { sku: 'SKU-' + String(desc).replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase(), uom: 'case', caseLb: 20 };
  }
  api.item = item;

  /* What allocated, unpicked order lines are counting on in a bin. */
  function reserved(state, binId, desc) {
    var q = 0;
    state.outbound.forEach(function (o) {
      o.lines.forEach(function (l) {
        if (l.done || !l.allocated) return;
        if (l.binId === binId && l.desc === desc) q += l.qty;
      });
    });
    return q;
  }
  function freeIn(state, b, desc) {
    if (!b || held(b)) return 0;
    return Math.max(0, qtyIn(b, desc) - reserved(state, b.id, desc));
  }
  api.reserved = reserved;
  api.freeIn = freeIn;

  /* ---------- install: the WMS layer on a building ----------------- */
  /* Idempotent. Run on a fresh seed and on every state loaded from
     the desk record, so a state saved before a field existed gets
     it — nothing that happened is changed. */
  function install(state) {
    if (!state || !state.bins) return state;
    E.upgradeState(state);
    var S = SEED || { items: {}, appointments: [], bols: {}, slots: [], orders: [], customers: {} };
    var fresh = !state.wms;
    if (fresh) {
      state.wms = {
        version: WMS_VERSION,
        items: copy(S.items),
        appointments: copy(S.appointments),
        slots: copy(S.slots),
        orders: copy(S.orders).map(function (o) { o.status = 'new'; return o; }),
        waves: [{ id: 'W-000', orderIds: state.outbound.map(function (o) { return o.id; }), releasedAt: null, by: null, note: 'Released before this shift' }],
        receipts: [], osd: [], loads: [], flags: [], counts: [], decisions: [],
        seq: { apt: 104, rcv: 1, osd: 1, wave: 1, ord: 604, load: 1, flag: 1, count: 1, move: 1, replen: 1, trk: 100231, bol: 1, cnt: 1 }
      };
    }
    var w = state.wms;
    ['appointments', 'slots', 'orders', 'waves', 'receipts', 'osd', 'loads', 'flags', 'counts', 'decisions']
      .forEach(function (k) { if (!Array.isArray(w[k])) w[k] = []; });
    if (!w.items) w.items = copy(S.items);
    if (!w.seq) w.seq = {};
    /* BOL file copies: only where a shipment has none. */
    state.inbound.forEach(function (s) {
      if (!s.bol && S.bols && S.bols[s.id]) s.bol = copy(S.bols[s.id]);
    });
    /* Customer, priority and carrier on the outbound orders. */
    state.outbound.forEach(function (o) {
      var c = S.customers && S.customers[o.id];
      if (c) {
        if (!o.customer) o.customer = c.customer;
        if (!o.priority) o.priority = c.priority;
        if (!o.shipDate) o.shipDate = c.shipDate;
        if (!o.carrier) o.carrier = c.carrier;
      }
      if (!o.wave) o.wave = 'W-000';
    });
    return state;
  }
  api.install = install;

  /* A brand-new WMS building: the engine's seed world plus the WMS
     layer, with all derivable work generated. */
  api.seed = function () {
    var s = E.seedWorld();
    install(s);
    refresh(s);
    return s;
  };

  /* ---------- practice dressing (practice copies only) -------------- */
  /* The seed above is the live building's truth and never changes.
     A PRACTICE copy, though, is a demo building, and the seed's
     building reads bare — most bins hold a single line and six hold
     nothing. dressPractice stocks a practice state fuller, the way
     a worked-in building looks: extra lines in bins the seed already
     stocks, plus two of the seed's empty bins filled. Deterministic
     (the same table every load), and applied ONLY by the store when
     it seeds a practice copy (js/wms-store.js) — never to the seed,
     never to the desk record.
     Deliberately untouched: staging (no pallet moves, nothing new
     staged), holds and flags (none added), the bins the demo's
     fixtures lean on (A-01, A-05, B-01, C-01 keep exactly their seed
     contents), and four empty bins — A-07, B-06, C-03, C-06, at
     least one per zone — so directed work (the game's putaways)
     always has somewhere to go. The bottled water in A-02 and the
     rice in B-08 are reserve stock for the pick faces in A-08 and
     B-04: the live seed holds no reserve anywhere, so its
     replenishment generator can never fire there; a practice
     building can show that loop honestly.
     Idempotent: a line already in a bin is not added twice. */
  var PRACTICE_STOCK = {
    'A-03': [{ desc: 'Canned tomatoes — cases', qty: 24 }],
    'B-03': [{ desc: 'Canned beans — cases', qty: 28 }],
    'A-02': [{ desc: 'Bottled water — cases', qty: 18 }],
    'A-04': [{ desc: 'Paper towels — cases', qty: 12 }],
    'A-06': [{ desc: 'Cereal — cases', qty: 10 }],
    'A-08': [{ desc: 'Canned tomatoes — cases', qty: 14 }],
    'B-02': [{ desc: 'Pasta — cases', qty: 16 }],
    'B-04': [{ desc: 'Canned beans — cases', qty: 20 }],
    'B-05': [{ desc: 'Cooking oil — cases', qty: 9 }],
    'B-07': [{ desc: 'Coffee — cases', qty: 12 }],
    'B-08': [{ desc: 'Rice — bags', qty: 12 }],
    'C-02': [{ desc: 'Canned tomatoes — cases', qty: 18 }],
    'C-04': [{ desc: 'Laundry detergent — cases', qty: 8 }],
    'C-05': [{ desc: 'Cereal — cases', qty: 14 }]
  };
  api.dressPractice = function (state) {
    if (!state || !state.bins) return state;
    state.bins.forEach(function (b) {
      var lines = PRACTICE_STOCK[b.id];
      if (!lines || b.status === 'hold') return;
      lines.forEach(function (l) {
        var there = false;
        b.contents.forEach(function (c) { if (c.desc === l.desc) there = true; });
        if (!there) b.contents.push({ desc: l.desc, qty: l.qty });
      });
    });
    return state;
  };

  /* ---------- derived work -------------------------------------------- */

  function openTaskWhere(state, pred) {
    for (var i = 0; i < state.tasks.length; i++) {
      var t = state.tasks[i];
      if (t.status !== 'done' && pred(t)) return t;
    }
    return null;
  }

  function generateWmsTasks(state) {
    var w = state.wms;
    /* An open replenishment that no longer makes sense is withdrawn:
       the face is back at min, or its reserve was used up (another
       is chosen on the pass below). Nothing in a worker's hands is
       touched. */
    for (var i = state.tasks.length - 1; i >= 0; i--) {
      var rt = state.tasks[i];
      if (rt.type !== 'replen' || rt.status !== 'open') continue;
      var rslot = null;
      w.slots.forEach(function (x) { if (x.binId === rt.toBinId) rslot = x; });
      var stale = !rslot || qtyIn(bin(state, rt.toBinId), rt.desc) >= rslot.min || freeIn(state, bin(state, rt.fromBinId), rt.desc) < 1;
      if (stale) state.tasks.splice(i, 1);
    }
    /* Replenishment: a pick face below its min pulls from reserve. */
    w.slots.forEach(function (slot) {
      var face = bin(state, slot.binId);
      slot.exception = null;
      if (!face || held(face)) { slot.exception = face ? 'Pick face on hold' : 'No such bin'; return; }
      var cur = qtyIn(face, slot.desc);
      if (cur >= slot.min) return;
      if (openTaskWhere(state, function (t) { return t.type === 'replen' && t.toBinId === slot.binId; })) return;
      var best = null, bestFree = 0;
      state.bins.forEach(function (b) {
        if (b.id === slot.binId) return;
        var f = freeIn(state, b, slot.desc);
        if (f > bestFree || (f === bestFree && f > 0 && best && b.id < best.id)) { best = b; bestFree = f; }
      });
      if (!best) { slot.exception = 'Below min — no reserve stock to pull from'; return; }
      var qty = Math.min(slot.max - cur, bestFree);
      var id = 't-replen-' + nextId(state, 'replen', '', 3);
      state.tasks.push({
        id: id, type: 'replen', zone: face.zone,
        title: 'Replenish ' + slot.binId + ' with ' + qty + ' × ' + slot.desc,
        detail: 'Pick face is at ' + cur + ' (min ' + slot.min + ', max ' + slot.max + '). Bring ' + qty +
          ' from reserve bin ' + best.id + '.',
        desc: slot.desc, fromBinId: best.id, toBinId: slot.binId, qty: qty,
        status: 'open', assignee: null, createdAt: api.now()
      });
    });

    /* Pack: a fully picked order waits at its door to be packed. */
    state.outbound.forEach(function (o) {
      if (o.status !== 'staged at door' || o.packed) return;
      var id = 't-pack-' + o.id;
      if (task(state, id)) return;
      state.tasks.push({
        id: id, type: 'pack', zone: doorZone(state, o.door),
        title: 'Pack ' + o.id + (o.customer ? ' for ' + o.customer : ''),
        detail: o.lines.map(function (l) { return (l.pickedQty || 0) + ' × ' + l.desc; }).join(', ') +
          ' — pack, label, stage at ' + o.door + '.',
        orderId: o.id, status: 'open', assignee: null, createdAt: api.now()
      });
    });
  }

  /* After anything changes: the engine derives its work, then the
     WMS layer derives its own. */
  function refresh(state) {
    E.generateTasks(state);
    generateWmsTasks(state);
    state.tasks.forEach(function (t) { if (!t.createdAt) t.createdAt = api.now(); });
    return state;
  }
  api.refresh = refresh;

  /* ---------- what blocks a task ------------------------------------ */

  function blocked(state, t) {
    if (!t || t.status === 'done') return null;
    if (ENGINE_TYPES.indexOf(t.type) !== -1) {
      var b0 = E.blockedBy(state, t);
      if (b0) return b0;
    }
    if (t.type === 'move' || t.type === 'replen') {
      var ids = [t.fromBinId, t.toBinId];
      for (var i = 0; i < ids.length; i++) {
        var b = bin(state, ids[i]);
        if (held(b)) return 'Bin ' + b.id + ' is on hold' + (b.hold && b.hold.reason ? ' — ' + b.hold.reason : '') + '.';
      }
    }
    if (t.type === 'load') {
      var o = order(state, t.orderId);
      if (o && !o.packed) return 'Waiting on packing — ' + o.id + ' is picked but not packed yet.';
    }
    return null;
  }
  api.blocked = blocked;

  /* ---------- the worker's queue --------------------------------------- */

  function rank(state, u) {
    return function (a, b) {
      var aq = a.queuedFor === u.id ? 0 : 1, bq = b.queuedFor === u.id ? 0 : 1;
      if (aq !== bq) return aq - bq;
      var az = a.zone === u.zone ? 0 : 1, bz = b.zone === u.zone ? 0 : 1;
      if (az !== bz) return az - bz;
      var ap = PRIORITY[a.type] == null ? 9 : PRIORITY[a.type];
      var bp = PRIORITY[b.type] == null ? 9 : PRIORITY[b.type];
      if (ap !== bp) return ap - bp;
      var ah = orderPriority(state, a), bh = orderPriority(state, b);
      if (ah !== bh) return ah - bh;
      return a.id < b.id ? -1 : 1;
    };
  }
  function orderPriority(state, t) {
    if (!t.orderId) return 1;
    var o = order(state, t.orderId);
    return o && o.priority === 'High' ? 0 : 1;
  }

  function candidates(state, u) {
    return state.tasks.filter(function (t) {
      return t.status === 'open' && !blocked(state, t) && (!t.queuedFor || t.queuedFor === u.id);
    }).sort(rank(state, u));
  }

  function currentOf(state, u) {
    if (!u || !u.currentTaskId) return null;
    var t = task(state, u.currentTaskId);
    return t && t.status === 'assigned' ? t : null;
  }
  api.currentOf = function (state, unitId) { return currentOf(state, unit(state, unitId)); };

  /* Give a worker their next task (or the one in hand). */
  api.nextFor = function (state, unitId) {
    var u = unit(state, unitId);
    if (!u) return { ok: false, reason: 'No such labor unit.', task: null };
    var cur = currentOf(state, u);
    if (cur) return { ok: true, task: cur, already: true };
    u.currentTaskId = null;
    var list = candidates(state, u);
    if (!list.length) return { ok: true, task: null };
    var t = list[0];
    t.status = 'assigned';
    t.assignee = u.id;
    t.startedAt = api.now();
    delete t.queuedFor;
    u.currentTaskId = t.id;
    return { ok: true, task: t };
  };

  /* A worker's queue, without assigning anything. */
  api.queueFor = function (state, unitId) {
    var u = unit(state, unitId);
    if (!u) return null;
    var cur = currentOf(state, u);
    var queued = state.tasks.filter(function (t) { return t.status === 'open' && t.queuedFor === u.id; });
    var suggested = candidates(state, u).filter(function (t) { return t.queuedFor !== u.id; }).slice(0, 3);
    return { unit: u, current: cur, queued: queued, suggested: suggested };
  };

  /* Reassign a task. If the new worker's hands are free it goes
     straight to them; otherwise it is queued for them, ahead of
     anything else. */
  api.reassign = function (state, taskId, toUnitId, byUnit) {
    var t = task(state, taskId);
    var to = unit(state, toUnitId);
    if (!t || t.status === 'done') return no('That task is already closed.');
    if (!to || to.role !== 'worker') return no('Pick a worker to give it to.');
    if (t.assignee === to.id) return no(to.name + ' already has it.');
    var from = t.assignee ? unit(state, t.assignee) : null;
    if (from && from.currentTaskId === t.id) from.currentTaskId = null;
    t.status = 'open';
    t.assignee = null;
    delete t.queuedFor;
    var how;
    if (!currentOf(state, to) && !blocked(state, t)) {
      t.status = 'assigned';
      t.assignee = to.id;
      t.startedAt = api.now();
      to.currentTaskId = t.id;
      how = 'now in hand';
    } else {
      t.queuedFor = to.id;
      how = 'queued next';
    }
    record(state, 'Reassigned "' + t.title + '"' + (from ? ' from ' + from.name : '') + ' to ' + to.name +
      ' (' + how + ') by ' + name(state, byUnit) + '.', { kind: 'reassign', taskId: t.id, by: byUnit || null, zone: t.zone });
    return { ok: true, how: how };
  };

  /* ---------- completing work ------------------------------------------ */

  function closeTask(state, t, byUnit) {
    t.status = 'done';
    t.doneBy = t.assignee || byUnit || null;
    t.doneAt = api.now();
    if (t.assignee) {
      var u = unit(state, t.assignee);
      if (u && u.currentTaskId === t.id) u.currentTaskId = null;
      t.assignee = null;
    }
    delete t.queuedFor;
  }

  function moveStock(state, from, to, desc, qty) {
    if (!takeFrom(from, desc, qty)) return false;
    addTo(to, desc, qty);
    return true;
  }

  /* Unreserve order lines a bin can no longer cover (after a count
     adjusts it down). Their open picks are withdrawn; the next
     refresh re-allocates from wherever stock really is. */
  function reconcileReservations(state, binId) {
    var b = bin(state, binId);
    if (!b) return [];
    var touched = [];
    var byDesc = {};
    state.outbound.forEach(function (o) {
      o.lines.forEach(function (l) {
        if (l.done || !l.allocated || l.binId !== binId) return;
        (byDesc[l.desc] = byDesc[l.desc] || []).push({ o: o, l: l });
      });
    });
    Object.keys(byDesc).forEach(function (desc) {
      var have = qtyIn(b, desc);
      var list = byDesc[desc];
      var need = 0;
      list.forEach(function (x) { need += x.l.qty; });
      while (need > have && list.length) {
        var x = list.pop();
        need -= x.l.qty;
        x.l.allocated = false;
        var pid = 't-pick-' + x.o.id + '-' + binId;
        for (var i = state.tasks.length - 1; i >= 0; i--) {
          var t = state.tasks[i];
          if (t.id === pid && t.status !== 'done') {
            var u = t.assignee ? unit(state, t.assignee) : null;
            if (u && u.currentTaskId === t.id) u.currentTaskId = null;
            state.tasks.splice(i, 1);
          }
        }
        touched.push(x.o.id);
      }
    });
    return touched;
  }

  function shortPick(state, t, qty, opts) {
    var b = bin(state, t.binId);
    if (!b || qtyIn(b, t.desc) < qty) return no('Bin ' + t.binId + ' does not hold ' + qty + ' × ' + t.desc + ' by the system count.');
    var o = order(state, t.orderId);
    takeFrom(b, t.desc, qty);
    if (o) {
      o.lines.forEach(function (l) {
        if (l.binId === t.binId && l.desc === t.desc && !l.done) {
          l.done = true;
          l.pickedQty = qty;
          l.shortPicked = t.qty - qty;
        }
      });
      if (o.lines.every(function (l) { return l.done; })) {
        o.door = o.door || 'Outbound Door 4';
        o.status = 'staged at door';
      } else {
        o.status = 'picking';
      }
    }
    var by = t.assignee || opts.by || null;
    closeTask(state, t, opts.by);
    var words = String(opts.words || '').trim();
    record(state, 'Short pick: ' + qty + ' of ' + t.qty + ' × ' + t.desc + ' from ' + t.binId + ' for ' + t.orderId +
      ' — ' + (t.qty - qty) + ' short.' + (words ? ' Said: "' + words + '"' : ''),
      { kind: 'complete', shortPick: true, taskId: t.id, type: 'pick', zone: t.zone, by: by });
    /* The bin did not hold what the system thought: count it. */
    api.cycleCount(state, [t.binId], { by: by, reason: 'Short pick on ' + t.orderId });
    return { ok: true, text: 'Short pick recorded — ' + (t.qty - qty) + ' short. A cycle count of ' + t.binId + ' was queued.' };
  }

  function attachToLoad(state, o) {
    var w = state.wms;
    var ld = null;
    w.loads.forEach(function (l) { if (!ld && l.status === 'loading' && l.door === o.door) ld = l; });
    if (!ld) {
      var n = w.seq.load || 1;
      ld = { id: nextId(state, 'load', 'LD-', 3), door: o.door, carrier: o.carrier || 'Coastal Express',
        trailer: 'TRL-' + (400 + n), orderIds: [], status: 'loading', openedAt: api.now() };
      w.loads.push(ld);
    }
    if (ld.orderIds.indexOf(o.id) === -1) ld.orderIds.push(o.id);
    o.loadId = ld.id;
    var d = door(state, o.door);
    if (d) { d.state = 'loading'; d.loadId = ld.id; }
    return ld;
  }

  /* Complete a task. opts: { by, qty (pick), binId (putaway actual
     bin), counts (count), cartons (pack), words (what was said) }. */
  api.complete = function (state, taskId, opts) {
    opts = opts || {};
    var t = task(state, taskId);
    if (!t) return no('No such task.');
    if (t.status === 'done') return no('That task is already done.');
    var why = blocked(state, t);
    if (why) return no(why);
    var res;

    if (t.type === 'receive') {
      return no('Receive this in Receiving — count it against the BOL, then post the receipt.');
    }

    if (t.type === 'putaway') {
      var p = null;
      state.staging.forEach(function (x) { if (x.id === t.stagingId) p = x; });
      var target = opts.binId ? String(opts.binId).toUpperCase() : t.toBinId;
      var tb = bin(state, target);
      if (!tb) return no('No bin ' + target + ' in this building.');
      if (held(tb)) return no('Bin ' + tb.id + ' is on hold. Pick another bin.');
      var suggested = t.toBinId;
      t.toBinId = tb.id;
      if (!E.completeTask(state, t.id)) { t.toBinId = suggested; return no('The putaway would not balance — nothing moved.'); }
      if (suggested !== tb.id) {
        t.suggestedBinId = suggested;
        record(state, 'Putaway to a different bin: suggested ' + suggested + ', actual ' + tb.id + '.',
          { kind: 'putaway-override', taskId: t.id, by: t.doneBy, zone: t.zone });
      }
      if (p && p.shipmentId) {
        var sh = shipment(state, p.shipmentId);
        if (sh) sh.lastPutawayAt = api.now();
      }
      res = { ok: true, text: 'Put away in ' + tb.id + '.' };
    }

    else if (t.type === 'pick') {
      var q = opts.qty == null ? t.qty : toInt(opts.qty);
      if (!isInt(q) || q < 0) return no('Say or type how many you picked.');
      if (q > t.qty) return no('That is more than the order line wants (' + t.qty + '). Pick ' + t.qty + ' or fewer.');
      if (q === t.qty) {
        if (!E.completeTask(state, t.id)) return no('Bin ' + t.binId + ' does not hold ' + t.qty + ' × ' + t.desc + ' by the system count.');
        res = { ok: true, text: 'Picked ' + q + ' × ' + t.desc + '.' };
      } else {
        res = shortPick(state, t, q, opts);
        if (!res.ok) return res;
      }
    }

    else if (t.type === 'load') {
      var lo = order(state, t.orderId);
      if (!E.completeTask(state, t.id)) return no('That order is not staged to load.');
      var ld = attachToLoad(state, lo);
      res = { ok: true, text: lo.id + ' loaded on ' + ld.trailer + ' at ' + ld.door + ' (' + ld.id + ').' };
    }

    else if (t.type === 'consolidate' || t.type === 'breakdown') {
      if (!E.completeTask(state, t.id)) return no('The stock is not where the task says — nothing moved.');
      res = { ok: true, text: 'Done.' };
    }

    else if (t.type === 'pack') {
      var po = order(state, t.orderId);
      if (!po || po.status !== 'staged at door') return no('That order is not picked yet.');
      var cartons = opts.cartons == null ? po.lines.length : toInt(opts.cartons);
      if (!isInt(cartons) || cartons < 1) return no('Cartons must be a whole number, 1 or more.');
      var lb = 0;
      po.lines.forEach(function (l) { lb += (l.pickedQty || 0) * item(state, l.desc).caseLb; });
      po.packed = { cartons: cartons, weightLb: lb, tracking: 'WIT' + (state.wms.seq.trk = (state.wms.seq.trk || 100231) + 1),
        station: 'Pack 1', at: api.now(), by: t.assignee || opts.by || null };
      var pby = t.assignee || opts.by || null;
      closeTask(state, t, opts.by);
      record(state, 'Packed ' + po.id + ' — ' + cartons + ' carton' + (cartons === 1 ? '' : 's') + ', ' + lb + ' lb, label ' +
        po.packed.tracking + '. Staged at ' + po.door + '.', { kind: 'complete', taskId: t.id, type: 'pack', zone: t.zone, by: pby });
      res = { ok: true, text: 'Packed — label ' + po.packed.tracking + '.' };
    }

    else if (t.type === 'count') {
      res = completeCount(state, t, opts);
      if (!res.ok) return res;
    }

    else if (t.type === 'move' || t.type === 'replen') {
      var fb = bin(state, t.fromBinId), tb2 = bin(state, t.toBinId);
      if (!fb || !tb2) return no('A bin on this task no longer exists.');
      var mq = t.type === 'replen' ? Math.min(t.qty, freeIn(state, fb, t.desc)) : t.qty;
      if (t.type === 'move' && freeIn(state, fb, t.desc) < mq) return no('Bin ' + fb.id + ' no longer has ' + mq + ' free × ' + t.desc + '.');
      if (mq < 1) return no('Reserve bin ' + fb.id + ' has no free ' + t.desc + ' left.');
      moveStock(state, fb, tb2, t.desc, mq);
      var mby = t.assignee || opts.by || null;
      closeTask(state, t, opts.by);
      t.movedQty = mq;
      record(state, (t.type === 'replen' ? 'Replenished ' : 'Moved ') + mq + ' × ' + t.desc + ' — ' + fb.id + ' → ' + tb2.id +
        ' (' + qtyIn(tb2, t.desc) + ' there now).', { kind: 'complete', taskId: t.id, type: t.type, zone: t.zone, by: mby });
      res = { ok: true, text: (t.type === 'replen' ? 'Replenished ' : 'Moved ') + mq + '.' };
    }

    else {
      return no('This task type cannot be completed here.');
    }

    refresh(state);
    return res;
  };

  /* ---------- dock & yard ---------------------------------------------- */

  var HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

  api.schedule = function (state, a, byUnit) {
    a = a || {};
    var s = shipment(state, a.shipmentId);
    if (!s) return no('Pick an inbound shipment.');
    if (s.status === 'staged at door' || s.status === 'received') return no(s.id + ' is already here.');
    var d = door(state, a.door);
    if (!d) return no('Pick a dock door.');
    if (d.direction === 'out') return no(d.id + ' is an outbound door. Trucks coming in use an inbound door.');
    if (!HHMM.test(a.start || '') || !HHMM.test(a.end || '')) return no('Times are 24-hour HH:MM.');
    if (a.start >= a.end) return no('The window has to end after it starts.');
    var day = a.day === 'Tomorrow' ? 'Tomorrow' : 'Today';
    var clash = null;
    state.wms.appointments.forEach(function (x) {
      if (clash || x.shipmentId === s.id || x.door !== d.id || x.day !== day) return;
      if (x.status === 'complete' || x.status === 'cancelled') return;
      if (a.start < x.end && x.start < a.end) clash = x;
    });
    if (clash) return no(d.id + ' is booked ' + clash.start + '–' + clash.end + ' ' + day.toLowerCase() + ' for ' + clash.shipmentId + '.');
    var apt = null;
    state.wms.appointments.forEach(function (x) { if (x.shipmentId === s.id && x.status === 'scheduled') apt = x; });
    var was = apt ? apt.door + ' ' + apt.day + ' ' + apt.start : null;
    if (!apt) {
      apt = { id: nextId(state, 'apt', 'APT-', 3), shipmentId: s.id, status: 'scheduled' };
      state.wms.appointments.push(apt);
    }
    apt.door = d.id; apt.day = day; apt.start = a.start; apt.end = a.end;
    apt.carrier = a.carrier || apt.carrier || (s.bol && s.bol.carrier) || '';
    apt.trailer = a.trailer || apt.trailer || '';
    s.door = d.id;
    s.status = 'expected ' + day.toLowerCase();
    record(state, (was ? 'Rescheduled ' : 'Scheduled ') + s.id + ' at ' + d.id + ', ' + day.toLowerCase() + ' ' + a.start + '–' + a.end +
      (was ? ' (was ' + was + ')' : '') + ' by ' + name(state, byUnit) + '.', { kind: 'schedule', shipmentId: s.id, by: byUnit || null });
    return { ok: true, appointment: apt };
  };

  api.checkIn = function (state, aptId, byUnit) {
    var apt = null;
    state.wms.appointments.forEach(function (x) { if (x.id === aptId) apt = x; });
    if (!apt) return no('No such appointment.');
    if (apt.status !== 'scheduled') return no(apt.id + ' is already ' + apt.status + '.');
    var r = E.arriveShipment(state, apt.shipmentId, byUnit);
    if (!r.ok) return no(r.reason);
    apt.status = 'checked in';
    apt.checkInAt = api.now();
    refresh(state);
    return { ok: true };
  };

  /* ---------- receiving: count against the BOL on file --------------- */

  /* What the BOL on file expects, per item line. */
  api.expectedLines = function (s) {
    var out = [], idx = {};
    (s.lines || []).forEach(function (l) {
      if (idx[l.desc] == null) { idx[l.desc] = out.length; out.push({ desc: l.desc, expected: 0, perPallet: l.perPallet }); }
      out[idx[l.desc]].expected += l.pallets * l.perPallet;
    });
    return out;
  };

  /* Post a receipt. lines: [{ desc, received, damaged, quote }].
     The human enters (or confirms what the voice read filled in) the
     counts; nothing is posted without them. Good stock becomes
     pallets staged at the door (putaway follows); damaged stock is
     staged ON HOLD with the receiver's words as the reason; every
     shortage, overage and damage becomes an OS&D finding. */
  api.receive = function (state, shipmentId, lines, opts) {
    opts = opts || {};
    var s = shipment(state, shipmentId);
    if (!s) return no('No shipment ' + shipmentId + '.');
    if (s.status === 'received') return no(s.id + ' was already received.');
    if (s.status !== 'staged at door') return no(s.id + ' is not at a door yet — check it in first.');
    var exp = api.expectedLines(s);
    var given = {};
    (lines || []).forEach(function (l) { if (l && l.desc) given[l.desc] = l; });
    var rows = [];
    for (var i = 0; i < exp.length; i++) {
      var g = given[exp[i].desc] || {};
      var rec = toInt(g.received), dmg = g.damaged == null || g.damaged === '' ? 0 : toInt(g.damaged);
      if (!isInt(rec) || rec < 0) return no('Enter the count received for ' + exp[i].desc + '.');
      if (!isInt(dmg) || dmg < 0) return no('Damaged for ' + exp[i].desc + ' must be a whole number.');
      if (dmg > rec) return no('Damaged can\'t be more than received for ' + exp[i].desc + '.');
      rows.push({ desc: exp[i].desc, expected: exp[i].expected, perPallet: exp[i].perPallet, received: rec, damaged: dmg,
        quote: String(g.quote || '').trim() });
    }
    var by = opts.by || null;
    var ts = api.now();
    var rcvId = nextId(state, 'rcv', 'RCV-', 3);
    var staged = 0, osd = [];
    var n = 0;
    rows.forEach(function (r) {
      var good = r.received - r.damaged;
      while (good > 0) {
        var q = Math.min(r.perPallet || good, good);
        n++;
        state.staging.push({ id: 'STG-' + s.id + '-' + n, door: s.door, desc: r.desc, qty: q, shipmentId: s.id });
        good -= q; staged++;
      }
      if (r.damaged > 0) {
        n++;
        state.staging.push({ id: 'STG-' + s.id + '-' + n, door: s.door, desc: r.desc, qty: r.damaged, shipmentId: s.id, damaged: true,
          hold: { by: by, reason: r.quote ? 'Damaged on receipt: "' + r.quote + '"' : 'Damaged on receipt', ts: ts } });
        staged++;
      }
      var words = r.quote || '(typed count — no words recorded)';
      function finding(type, qty) {
        var f = { id: nextId(state, 'osd', 'OSD-', 3), shipmentId: s.id, receiptId: rcvId, desc: r.desc, type: type, qty: qty,
          expected: r.expected, received: r.received, words: words, by: by, ts: ts, status: 'open' };
        state.wms.osd.push(f); osd.push(f);
      }
      if (r.received < r.expected) finding('shortage', r.expected - r.received);
      if (r.received > r.expected) finding('overage', r.received - r.expected);
      if (r.damaged > 0) finding('damage', r.damaged);
    });
    (opts.photoFlags || []).forEach(function (pf) {
      if (!pf || !pf.label) return;
      var f = { id: nextId(state, 'osd', 'OSD-', 3), shipmentId: s.id, receiptId: rcvId, desc: null, type: 'photo', qty: null,
        label: String(pf.label), words: String(pf.detail || ''), source: 'photo', by: by, ts: ts, status: 'open' };
      state.wms.osd.push(f); osd.push(f);
    });
    s.status = 'received';
    s.receivedAt = ts;
    s.receiptId = rcvId;
    var d = door(state, s.door);
    if (d && d.shipmentId === s.id) { d.state = staged ? 'staged' : 'empty'; d.shipmentId = null; }
    var rt = task(state, 't-receive-' + s.id);
    if (rt && rt.status !== 'done') closeTask(state, rt, by);
    state.wms.appointments.forEach(function (x) { if (x.shipmentId === s.id && x.status !== 'cancelled') x.status = 'complete'; });
    state.wms.receipts.push({ id: rcvId, shipmentId: s.id, bolNumber: s.bol ? s.bol.bolNumber : null, lines: rows, by: by, ts: ts,
      transcript: opts.transcript || null, source: opts.source || 'typed', photoFlags: opts.photoFlags || [],
      osdIds: osd.map(function (f) { return f.id; }) });
    var units = 0; rows.forEach(function (r) { units += r.received; });
    record(state, 'Received ' + s.id + (s.bol ? ' (BOL ' + s.bol.bolNumber + ')' : '') + ' at ' + s.door + ' — ' + units +
      ' counted, ' + staged + ' pallet' + (staged === 1 ? '' : 's') + ' staged' +
      (osd.length ? ', ' + osd.length + ' OS&D finding' + (osd.length === 1 ? '' : 's') : ', no discrepancies') + '. ' + rcvId + '.',
      { kind: 'complete', taskId: 't-receive-' + s.id, type: 'receive', zone: d ? d.zone : null, by: by, receiptId: rcvId });
    refresh(state);
    return { ok: true, receiptId: rcvId, staged: staged, osd: osd };
  };

  api.resolveOsd = function (state, osdId, byUnit, note) {
    var f = null;
    state.wms.osd.forEach(function (x) { if (x.id === osdId) f = x; });
    if (!f) return no('No such finding.');
    if (f.status === 'closed') return no(f.id + ' is already closed.');
    f.status = 'closed'; f.closedBy = byUnit || null; f.closedAt = api.now(); f.note = String(note || '').trim();
    record(state, f.id + ' (' + f.type + ', ' + f.shipmentId + ') closed by ' + name(state, byUnit) + (f.note ? ': ' + f.note : '') + '.',
      { kind: 'osd-closed', by: byUnit || null });
    return { ok: true };
  };

  /* ---------- inventory control ------------------------------------- */

  api.hold = function (state, target, byUnit, reason) {
    var r = E.placeHold(state, target, byUnit, reason);
    if (!r.ok) return no(r.reason);
    /* WMS tasks touching held stock go back to the queue too. */
    state.tasks.forEach(function (t) {
      if (t.status !== 'assigned' || !blocked(state, t)) return;
      var u = unit(state, t.assignee);
      if (u && u.currentTaskId === t.id) { u.currentTaskId = null; r.freed.push(u.name); }
      t.status = 'open'; t.assignee = null;
    });
    refresh(state);
    return { ok: true, freed: r.freed };
  };

  api.release = function (state, target, byUnit) {
    var r = E.releaseHold(state, target, byUnit);
    if (!r.ok) return no(r.reason);
    refresh(state);
    return { ok: true };
  };

  /* Queue cycle counts. A bin already waiting on a count is skipped. */
  api.cycleCount = function (state, binIds, opts) {
    opts = opts || {};
    var made = [];
    (binIds || []).forEach(function (id) {
      var b = bin(state, id);
      if (!b) return;
      if (openTaskWhere(state, function (t) { return t.type === 'count' && t.binId === b.id; })) return;
      var tid = 't-count-' + nextId(state, 'count', '', 3);
      state.tasks.push({
        id: tid, type: 'count', zone: b.zone,
        title: 'Cycle count bin ' + b.id,
        detail: 'Count everything in ' + b.id + ' and say or type each item\'s count. Blind count — the system number is not shown.',
        binId: b.id, reason: opts.reason || 'Cycle count', status: 'open', assignee: null, createdAt: api.now()
      });
      made.push(tid);
    });
    if (made.length) {
      record(state, 'Cycle count queued for ' + made.length + ' bin' + (made.length === 1 ? '' : 's') + ' (' + (opts.reason || 'cycle count') +
        ') by ' + name(state, opts.by) + '.', { kind: 'count-queued', by: opts.by || null });
    }
    return { ok: !!made.length, reason: made.length ? null : 'Those bins already have a count waiting.', tasks: made };
  };

  function completeCount(state, t, opts) {
    var b = bin(state, t.binId);
    if (!b) return no('No such bin.');
    var counted = {};
    var src = opts.counts;
    if (Array.isArray(src)) src.forEach(function (c) { if (c && c.desc) counted[c.desc] = c.qty; });
    else if (src && typeof src === 'object') Object.keys(src).forEach(function (k) { counted[k] = src[k]; });
    else return no('Enter a count for each item in the bin.');
    var descs = [];
    b.contents.forEach(function (c) { descs.push(c.desc); });
    Object.keys(counted).forEach(function (k) { if (descs.indexOf(k) === -1) descs.push(k); });
    var lines = [];
    for (var i = 0; i < descs.length; i++) {
      var d = descs[i];
      var c = counted[d] == null || counted[d] === '' ? NaN : toInt(counted[d]);
      if (!isInt(c) || c < 0) return no('Enter a whole-number count for ' + d + ' (0 if none).');
      lines.push({ desc: d, system: qtyIn(b, d), counted: c, variance: c - qtyIn(b, d) });
    }
    if (!lines.length) lines.push({ desc: '(empty bin)', system: 0, counted: 0, variance: 0 });
    var by = t.assignee || opts.by || null;
    b.contents = lines.filter(function (l) { return l.counted > 0 && l.desc !== '(empty bin)'; })
      .map(function (l) { return { desc: l.desc, qty: l.counted }; });
    var off = lines.filter(function (l) { return l.variance !== 0; });
    var words = String(opts.words || '').trim();
    state.wms.counts.push({ id: nextId(state, 'cnt', 'CC-', 3), taskId: t.id, binId: b.id, lines: lines, by: by, ts: api.now(),
      words: words || null, reason: t.reason });
    closeTask(state, t, opts.by);
    t.variance = off.length;
    record(state, 'Cycle count ' + b.id + ': ' + (off.length
      ? off.map(function (l) { return l.desc + ' system ' + l.system + ', counted ' + l.counted + ' (' + (l.variance > 0 ? '+' : '') + l.variance + ')'; }).join('; ') + ' — adjusted.'
      : 'matches the system.') + (words ? ' Said: "' + words + '"' : ''),
      { kind: 'complete', adjust: off.length > 0, taskId: t.id, type: 'count', zone: t.zone, by: by });
    var unres = reconcileReservations(state, b.id);
    return { ok: true, text: off.length ? off.length + ' variance' + (off.length === 1 ? '' : 's') + ' — bin adjusted.' : 'Count matches.', variances: off, reallocated: unres };
  }

  /* A bin-to-bin move, as a task the floor carries out. */
  api.createMove = function (state, m, byUnit) {
    m = m || {};
    var f = bin(state, m.fromBinId), t = bin(state, m.toBinId);
    var qty = toInt(m.qty);
    if (!f || !t) return no('Pick both bins.');
    if (f.id === t.id) return no('From and to are the same bin.');
    if (held(f) || held(t)) return no('Held stock is not moved. Release the hold first.');
    if (!m.desc || !qtyIn(f, m.desc)) return no('Bin ' + f.id + ' holds no ' + (m.desc || 'item') + '.');
    if (!isInt(qty) || qty < 1) return no('Quantity must be a whole number, 1 or more.');
    var free = freeIn(state, f, m.desc);
    if (free < qty) return no('Only ' + free + ' free in ' + f.id + ' (the rest is reserved for orders).');
    var id = 't-move-' + nextId(state, 'move', '', 3);
    state.tasks.push({ id: id, type: 'move', zone: f.zone, title: 'Move ' + qty + ' × ' + m.desc + ' ' + f.id + ' → ' + t.id,
      detail: 'Bin-to-bin move requested by ' + name(state, byUnit) + '.', desc: m.desc, fromBinId: f.id, toBinId: t.id, qty: qty,
      status: 'open', assignee: null, createdAt: api.now() });
    record(state, 'Move requested: ' + qty + ' × ' + m.desc + ' ' + f.id + ' → ' + t.id + ' by ' + name(state, byUnit) + '.',
      { kind: 'move-requested', taskId: id, by: byUnit || null });
    return { ok: true, taskId: id };
  };

  /* Set a pick face's min/max (or add a new pick face). */
  api.setSlot = function (state, s, byUnit) {
    s = s || {};
    var b = bin(state, s.binId);
    var mn = toInt(s.min), mx = toInt(s.max);
    if (!b) return no('Pick a bin.');
    if (!s.desc) return no('Pick the item this face holds.');
    if (!isInt(mn) || !isInt(mx) || mn < 0 || mx < 1) return no('Min and max are whole numbers.');
    if (mn >= mx) return no('Min has to be below max.');
    var slot = null;
    state.wms.slots.forEach(function (x) { if (x.binId === b.id) slot = x; });
    if (!slot) { slot = { binId: b.id }; state.wms.slots.push(slot); }
    slot.desc = s.desc; slot.min = mn; slot.max = mx;
    record(state, 'Pick face ' + b.id + ' set: ' + s.desc + ', min ' + mn + ', max ' + mx + ' — by ' + name(state, byUnit) + '.',
      { kind: 'slot', by: byUnit || null });
    refresh(state);
    return { ok: true };
  };

  /* ---------- orders and waves ---------------------------------------- */

  api.createOrder = function (state, o, byUnit) {
    o = o || {};
    var customer = String(o.customer || '').trim();
    if (!customer) return no('Enter the customer.');
    var lines = [];
    var src = o.lines || [];
    for (var i = 0; i < src.length; i++) {
      var l = src[i];
      if (!l || !l.desc) continue;
      var q = toInt(l.qty);
      if (!isInt(q) || q < 1) return no('Quantity for ' + l.desc + ' must be a whole number, 1 or more.');
      lines.push({ desc: l.desc, qty: q });
    }
    if (!lines.length) return no('Add at least one line.');
    var d = door(state, o.door || 'Outbound Door 4') ? (o.door || 'Outbound Door 4') : 'Outbound Door 4';
    var rec = { id: nextId(state, 'ord', 'ORD-', 3), customer: customer, priority: o.priority === 'High' ? 'High' : 'Normal',
      shipDate: o.shipDate === 'Tomorrow' ? 'Tomorrow' : 'Today', door: d, carrier: o.carrier || 'Coastal Express',
      lines: lines, status: 'new', createdAt: api.now() };
    state.wms.orders.push(rec);
    record(state, 'Order ' + rec.id + ' entered for ' + customer + ' — ' + lines.length + ' line' + (lines.length === 1 ? '' : 's') +
      ' (' + rec.priority + ', ship ' + rec.shipDate.toLowerCase() + ') by ' + name(state, byUnit) + '.', { kind: 'order', by: byUnit || null });
    return { ok: true, order: rec };
  };

  /* Release a wave: the orders go to the floor. Allocation reserves
     real, unheld stock; a line no single bin can fill is marked short
     and gets no pick until stock is there. */
  api.releaseWave = function (state, orderIds, byUnit) {
    var ids = (orderIds || []).filter(function (id) {
      return state.wms.orders.some(function (o) { return o.id === id; });
    });
    if (!ids.length) return no('Pick at least one new order to release.');
    var waveId = 'W-' + (function () { var n = state.wms.seq.wave || 1; state.wms.seq.wave = n + 1; var s = String(n); while (s.length < 3) s = '0' + s; return s; })();
    ids.forEach(function (id) {
      var o = null, idx = -1;
      state.wms.orders.forEach(function (x, i) { if (x.id === id) { o = x; idx = i; } });
      state.wms.orders.splice(idx, 1);
      state.outbound.push({ id: o.id, status: 'open', door: o.door, customer: o.customer, priority: o.priority, shipDate: o.shipDate,
        carrier: o.carrier, wave: waveId, lines: o.lines.map(function (l) { return { binId: null, desc: l.desc, qty: l.qty }; }) });
    });
    state.wms.waves.push({ id: waveId, orderIds: ids, releasedAt: api.now(), by: byUnit || null });
    refresh(state);
    var summary = ids.map(function (id) {
      var o = order(state, id);
      var short = o.lines.filter(function (l) { return !l.allocated && !l.done; }).length;
      return { id: id, lines: o.lines.length, short: short };
    });
    var shortN = summary.filter(function (s) { return s.short; }).length;
    record(state, 'Wave ' + waveId + ' released by ' + name(state, byUnit) + ': ' + ids.join(', ') + '.' +
      (shortN ? ' ' + shortN + ' order' + (shortN === 1 ? '' : 's') + ' short on allocation.' : ' Fully allocated.'),
      { kind: 'wave', by: byUnit || null });
    return { ok: true, waveId: waveId, summary: summary };
  };

  /* Lines reserved on a bin that has since gone on hold: release the
     reservation so the next pass allocates from unheld stock. */
  api.reallocateHeld = function (state, byUnit) {
    var moved = [];
    state.outbound.forEach(function (o) {
      o.lines.forEach(function (l) {
        if (l.done || !l.allocated) return;
        var b = bin(state, l.binId);
        if (!held(b)) return;
        var pid = 't-pick-' + o.id + '-' + l.binId;
        for (var i = state.tasks.length - 1; i >= 0; i--) {
          var t = state.tasks[i];
          if (t.id === pid && t.status !== 'done') {
            var u = t.assignee ? unit(state, t.assignee) : null;
            if (u && u.currentTaskId === t.id) u.currentTaskId = null;
            state.tasks.splice(i, 1);
          }
        }
        moved.push(o.id + ' ' + l.desc + ' (was ' + l.binId + ')');
        l.allocated = false;
      });
    });
    if (!moved.length) return no('No reservations sit on held bins.');
    refresh(state);
    record(state, 'Re-allocated off held bins by ' + name(state, byUnit) + ': ' + moved.join('; ') + '.', { kind: 'reallocate', by: byUnit || null });
    return { ok: true, moved: moved };
  };

  /* ---------- shipping: close out the outbound load ------------------ */

  api.closeLoad = function (state, loadId, opts) {
    opts = opts || {};
    var ld = null;
    state.wms.loads.forEach(function (l) { if (l.id === loadId) ld = l; });
    if (!ld) return no('No such load.');
    if (ld.status !== 'loading') return no(ld.id + ' is already ' + ld.status + '.');
    if (!ld.orderIds.length) return no(ld.id + ' has nothing on it.');
    var units = 0, lb = 0, cartons = 0;
    ld.orderIds.forEach(function (id) {
      var o = order(state, id);
      if (!o) return;
      units += o.shippedQty || 0;
      if (o.packed) { lb += o.packed.weightLb; cartons += o.packed.cartons; }
    });
    ld.status = 'shipped';
    ld.bolNumber = 'WIT-OB-' + nextId(state, 'bol', '', 4);
    ld.seal = String(opts.seal || '').trim() || 'not recorded';
    ld.closedAt = api.now();
    ld.closedBy = opts.by || null;
    ld.totals = { orders: ld.orderIds.length, units: units, weightLb: lb, cartons: cartons };
    var d = door(state, ld.door);
    if (d && d.loadId === ld.id) {
      d.loadId = null;
      var busy = state.staging.some(function (p) { return p.door === d.id; });
      if (d.state === 'loading') d.state = busy ? 'staged' : 'empty';
    }
    record(state, 'Ship confirm ' + ld.id + ': ' + ld.trailer + ' left ' + ld.door + ' — ' + ld.orderIds.join(', ') + ', ' + units +
      ' units, ' + cartons + ' cartons, ' + lb + ' lb. BOL ' + ld.bolNumber + ', seal ' + ld.seal + '. Closed by ' + name(state, opts.by) + '.',
      { kind: 'ship', loadId: ld.id, by: opts.by || null });
    return { ok: true, load: ld };
  };

  /* ---------- flags: a label plus the speaker's exact words ----------- */

  /* words are stored exactly as said (trimmed, nothing else). The
     label is short and comes from the model or the person; there are
     no category fields. Pinned to the task in hand (or the one named)
     through the engine, so the task's record carries it too. */
  api.flag = function (state, f) {
    f = f || {};
    var u = unit(state, f.unitId);
    var words = String(f.words || '').trim();
    if (!u) return no('Pick who is reporting.');
    if (!words) return no('Say or type what happened.');
    var label = String(f.label || '').trim() || 'Unlabeled';
    var r, taskId = null;
    if (f.taskId) {
      if (!task(state, f.taskId)) return no('No such task.');
      r = E.addTaskUpdate(state, f.taskId, words, u.id);
      taskId = f.taskId;
    } else {
      r = E.reportProblem(state, u.id, words);
      taskId = r && r.task ? r.task.id : null;
    }
    var t = taskId ? task(state, taskId) : null;
    var flag = { id: nextId(state, 'flag', 'FLG-', 3), label: label, words: words, by: u.id, taskId: taskId,
      zone: t ? t.zone : u.zone, ts: api.now(), status: 'open', source: f.source || 'typed' };
    state.wms.flags.push(flag);
    return { ok: true, flag: flag };
  };

  api.closeFlag = function (state, flagId, byUnit, note) {
    var f = null;
    state.wms.flags.forEach(function (x) { if (x.id === flagId) f = x; });
    if (!f) return no('No such flag.');
    if (f.status === 'closed') return no(f.id + ' is already closed.');
    f.status = 'closed'; f.closedBy = byUnit || null; f.closedAt = api.now(); f.note = String(note || '').trim();
    record(state, f.id + ' "' + f.label + '" closed by ' + name(state, byUnit) + (f.note ? ': ' + f.note : '') + '.',
      { kind: 'flag-closed', by: byUnit || null });
    return { ok: true };
  };

  /* ---------- labor proposals: proposed, never auto-applied ----------- */

  api.proposals = function (state) {
    var out = [];
    var b = E.bottleneck(state);
    if (b && b.suggestion) {
      var s = b.suggestion;
      out.push({ key: 'bottleneck-' + s.unitId + '-' + s.toZone, unitId: s.unitId, unitName: s.unitName, fromZone: s.fromZone, toZone: s.toZone,
        why: 'Zone ' + b.zone + ' has ' + b.pending + ' tasks waiting for ' + b.workers + ' worker' + (b.workers === 1 ? '' : 's') +
          ' (' + (Math.round(b.loadPerWorker * 10) / 10) + ' each). Zone ' + s.fromZone + ' has ' + s.fromPending + ' for ' + s.fromWorkers + '.' });
    }
    /* Idle hands: a worker with nothing workable in their zone while
       another zone has open work. */
    var openBy = {};
    state.tasks.forEach(function (t) {
      if (t.status === 'open' && !blocked(state, t) && t.zone) openBy[t.zone] = (openBy[t.zone] || 0) + 1;
    });
    state.labor.forEach(function (u) {
      if (u.role !== 'worker' || currentOf(state, u) || openBy[u.zone]) return;
      var busiest = null;
      state.zones.forEach(function (z) { if (z !== u.zone && openBy[z] && (!busiest || openBy[z] > openBy[busiest])) busiest = z; });
      if (!busiest) return;
      if (out.some(function (p) { return p.unitId === u.id; })) return;
      out.push({ key: 'idle-' + u.id + '-' + busiest, unitId: u.id, unitName: u.name, fromZone: u.zone, toZone: busiest,
        why: u.name + ' has nothing workable in zone ' + u.zone + '. Zone ' + busiest + ' has ' + openBy[busiest] + ' open task' + (openBy[busiest] === 1 ? '' : 's') + '.' });
    });
    return out;
  };

  /* A human decides. Approving moves the worker's zone; declining
     only records the decision. */
  api.decide = function (state, p, approve, byUnit) {
    if (!p) return no('No proposal.');
    var u = unit(state, p.unitId);
    if (!u) return no('That worker is not on the labor list.');
    if (approve && u.zone !== p.fromZone) return no(u.name + ' is no longer in zone ' + p.fromZone + ' — the proposal is stale.');
    if (approve) u.zone = p.toZone;
    state.wms.decisions.push({ key: p.key, unitId: u.id, fromZone: p.fromZone, toZone: p.toZone, approved: !!approve,
      by: byUnit || null, ts: api.now(), why: p.why });
    record(state, (approve ? 'Approved' : 'Declined') + ' labor move: ' + u.name + ' zone ' + p.fromZone + ' → ' + p.toZone +
      ' — by ' + name(state, byUnit) + '. (' + p.why + ')', { kind: 'labor-move', by: byUnit || null, approved: !!approve });
    return { ok: true };
  };

  /* ---------- views: computed, never stored ---------------------------- */

  api.inventory = function (state) {
    var by = {};
    state.bins.forEach(function (b) {
      b.contents.forEach(function (c) {
        var r = by[c.desc] = by[c.desc] || { desc: c.desc, onHand: 0, held: 0, reserved: 0, available: 0, bins: [] };
        r.onHand += c.qty;
        if (held(b)) r.held += c.qty;
        r.reserved += reserved(state, b.id, c.desc);
        r.bins.push(b.id);
      });
    });
    Object.keys(by).forEach(function (k) {
      var r = by[k];
      r.available = Math.max(0, r.onHand - r.held - r.reserved);
      var it = item(state, k);
      r.sku = it.sku; r.uom = it.uom;
    });
    return Object.keys(by).sort().map(function (k) { return by[k]; });
  };

  api.slotStatus = function (state) {
    return state.wms.slots.map(function (s) {
      var b = bin(state, s.binId);
      var cur = qtyIn(b, s.desc);
      var t = openTaskWhere(state, function (x) { return x.type === 'replen' && x.toBinId === s.binId; });
      return { binId: s.binId, desc: s.desc, min: s.min, max: s.max, onHand: cur,
        state: s.exception ? 'exception' : (cur < s.min ? 'below min' : 'ok'), exception: s.exception || null, taskId: t ? t.id : null };
    });
  };

  /* The order's stage, in the words the work uses. */
  api.orderStatus = function (state, o) {
    if (o.status === 'new') return { key: 'new', words: 'New — not released' };
    if (o.status === 'shipped') {
      var ld = null;
      state.wms.loads.forEach(function (l) { if (l.id === o.loadId) ld = l; });
      if (ld && ld.status === 'shipped') return { key: 'shipped', words: 'Shipped — ' + ld.bolNumber };
      return { key: 'loaded', words: 'Loaded on ' + (ld ? ld.trailer : 'trailer') + ' at ' + o.door };
    }
    if (o.status === 'staged at door') {
      return o.packed ? { key: 'packed', words: 'Packed, staged at ' + o.door + ' — ready to load' }
        : { key: 'picked', words: 'Picked — waiting to pack' };
    }
    return E.orderStage(state, o);
  };

  api.allOrders = function (state) {
    return state.wms.orders.concat(state.outbound);
  };

  api.inboundStatus = function (state, s) {
    if (s.status === 'received') {
      var left = state.staging.filter(function (p) { return p.shipmentId === s.id; });
      var heldN = left.filter(function (p) { return p.hold; }).length;
      if (left.length) return { key: 'putaway', words: 'Received — ' + left.length + ' pallet' + (left.length === 1 ? '' : 's') + ' at ' + s.door + (heldN ? ' (' + heldN + ' on hold)' : '') };
      return { key: 'closed', words: 'Closed — all in bins' };
    }
    if (s.status === 'staged at door') return { key: 'arrived', words: 'At ' + s.door + ' — ready to receive' };
    return { key: 'expected', words: s.status.charAt(0).toUpperCase() + s.status.slice(1) + ' — ' + s.door };
  };

  function minutesBetween(a, b) { return Math.max(0, (Date.parse(b) - Date.parse(a)) / 60000); }

  api.dashboard = function (state) {
    var t = { open: 0, assigned: 0, done: 0, blocked: 0, byType: {} };
    state.tasks.forEach(function (x) {
      if (x.status === 'done') { t.done++; return; }
      if (x.status === 'assigned') t.assigned++; else t.open++;
      if (blocked(state, x)) t.blocked++;
      t.byType[x.type] = (t.byType[x.type] || 0) + 1;
    });
    var zs = E.zoneStats(state);
    var zones = state.zones.map(function (z) {
      var s = zs[z];
      return { zone: z, pending: s.pending, done: s.done, workers: s.workersPresent, load: s.pending / Math.max(s.workersPresent, 1), binsOccupied: s.binsOccupied };
    });
    var inv = { units: 0, occupied: 0, empty: 0, held: 0, bins: state.bins.length };
    state.bins.forEach(function (b) {
      var n = binTotal(b);
      inv.units += n;
      if (n) inv.occupied++; else inv.empty++;
      if (held(b)) inv.held++;
    });
    var counts = state.wms.counts;
    var exact = counts.filter(function (c) { return c.lines.every(function (l) { return l.variance === 0; }); }).length;
    var ordered = 0, picked = 0, shortPicks = 0;
    state.outbound.forEach(function (o) {
      o.lines.forEach(function (l) {
        if (!l.done) return;
        ordered += l.qty; picked += l.pickedQty || 0;
        if (l.shortPicked) shortPicks++;
      });
    });
    var d2s = [];
    state.inbound.forEach(function (s) {
      if (s.status !== 'received' || !s.receivedAt || !s.lastPutawayAt) return;
      if (state.staging.some(function (p) { return p.shipmentId === s.id; })) return;
      d2s.push(minutesBetween(s.receivedAt, s.lastPutawayAt));
    });
    var loadsShipped = state.wms.loads.filter(function (l) { return l.status === 'shipped'; });
    var unitsOut = 0;
    loadsShipped.forEach(function (l) { unitsOut += l.totals ? l.totals.units : 0; });
    var unitsIn = 0;
    state.wms.receipts.forEach(function (r) { r.lines.forEach(function (l) { unitsIn += l.received; }); });
    var bn = E.bottleneck(state);
    return {
      tasks: t,
      zones: zones,
      bottleneck: bn,
      flagsOpen: state.wms.flags.filter(function (f) { return f.status === 'open'; }).length,
      osdOpen: state.wms.osd.filter(function (f) { return f.status === 'open'; }).length,
      inventory: inv,
      accuracy: counts.length ? Math.round(100 * exact / counts.length) : null,
      countsDone: counts.length,
      fillRate: ordered ? Math.round(1000 * picked / ordered) / 10 : null,
      shortPicks: shortPicks,
      dockToStockMin: d2s.length ? Math.round(d2s.reduce(function (a, b) { return a + b; }, 0) / d2s.length) : null,
      inbound: {
        expected: state.inbound.filter(function (s) { return s.status !== 'received' && s.status !== 'staged at door'; }).length,
        atDoor: state.inbound.filter(function (s) { return s.status === 'staged at door'; }).length,
        received: state.inbound.filter(function (s) { return s.status === 'received'; }).length,
        unitsIn: unitsIn,
        palletsStaged: state.staging.length
      },
      outbound: {
        unreleased: state.wms.orders.length,
        inProgress: state.outbound.filter(function (o) { return o.status !== 'shipped' && o.status !== 'staged at door'; }).length,
        staged: state.outbound.filter(function (o) { return o.status === 'staged at door'; }).length,
        loaded: state.outbound.filter(function (o) { return o.status === 'shipped' && !loadsShipped.some(function (l) { return l.id === o.loadId; }); }).length,
        shipped: state.outbound.filter(function (o) { return o.status === 'shipped' && loadsShipped.some(function (l) { return l.id === o.loadId; }); }).length,
        loadsClosed: loadsShipped.length,
        unitsOut: unitsOut
      },
      replen: api.slotStatus(state).filter(function (s) { return s.state !== 'ok'; }).length,
      holds: E.currentHolds(state).length,
      proposals: api.proposals(state).length
    };
  };

  api.shiftSummary = function (state) {
    var base = E.shiftSummary(state);
    var d = api.dashboard(state);
    return {
      base: base,
      dash: d,
      flags: state.wms.flags.slice(),
      osd: state.wms.osd.slice(),
      loads: state.wms.loads.filter(function (l) { return l.status === 'shipped'; }),
      receipts: state.wms.receipts.slice(),
      counts: state.wms.counts.slice(),
      decisions: state.wms.decisions.slice()
    };
  };

  /* ---------- the spoken word, locally --------------------------------
     Voice reaches us as a transcript from Muse Voice Transcribe (the
     Worker's /asr). What a worker MEANT is decided here, locally and
     deterministically — no model decides whether a pick is confirmed. */

  var ONES = { zero: 0, oh: 0, no: 0, none: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  var TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

  function norm(text) {
    return String(text || '').toLowerCase().replace(/[’‘]/g, "'").replace(/-/g, ' ').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /* The first quantity said: digits, or number words up to 999. */
  api.parseQty = function (text) {
    var t = norm(text);
    var m = /\b(\d{1,4})\b/.exec(t.replace(/\b[abc] ?0?[1-8]\b/g, ' '));
    if (m) return parseInt(m[1], 10);
    /* Punctuation ends a number: "picked two, four short" is two. */
    var words = String(text || '').toLowerCase().replace(/[,.;:!?]/g, ' | ').replace(/-/g, ' ').replace(/[^a-z0-9|' ]+/g, ' ').split(/\s+/);
    var val = null, cur = 0, seen = false, last = null;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (ONES[w] != null && w !== 'no' && w !== 'oh' && last !== 'ones') { cur += ONES[w]; seen = true; last = 'ones'; }
      else if (TENS[w] != null && (!seen || last === 'hundred')) { cur += TENS[w]; seen = true; last = 'tens'; }
      else if (w === 'hundred' && seen && last !== 'hundred') { cur *= 100; last = 'hundred'; }
      else if (w === 'and' && seen) { continue; }
      else if (seen) { val = cur; break; }
    }
    if (val == null && seen) val = cur;
    return val;
  };

  var LETTER = { a: 'A', alpha: 'A', ay: 'A', b: 'B', bee: 'B', be: 'B', bravo: 'B', c: 'C', see: 'C', sea: 'C', charlie: 'C' };
  var DIGIT = { one: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5, six: 6, seven: 7, eight: 8 };

  /* A bin id said aloud: "A-03", "bin b 7", "charlie two". */
  api.parseBin = function (text) {
    var w = norm(text).split(' ');
    for (var i = 0; i < w.length; i++) {
      var tok = w[i];
      var m = /^([abc])0?([1-8])$/.exec(tok);
      if (m) return m[1].toUpperCase() + '-0' + m[2];
      var L = LETTER[tok];
      if (!L) continue;
      if (tok.length === 1 || tok === 'alpha' || tok === 'bravo' || tok === 'charlie' || tok === 'bee' || tok === 'sea' || tok === 'see') {
        var j = i + 1;
        if (w[j] === 'zero' || w[j] === 'oh' || w[j] === '0') j++;
        var nx = w[j];
        var n = nx && /^0?[1-8]$/.test(nx) ? parseInt(nx, 10) : DIGIT[nx];
        if (n >= 1 && n <= 8) return L + '-0' + n;
      }
    }
    return null;
  };

  /* Read what a worker said against the task in hand. Returns a plan
     the page carries out — or explains why nothing will happen:
       { intent: 'confirm'|'next'|'problem'|'unknown'|'need', ... } */
  api.interpret = function (state, unitId, transcript) {
    var u = unit(state, unitId);
    var heard = String(transcript || '').trim();
    var cur = currentOf(state, u);
    /* "picked eight, two short" is a short pick, not a problem report. */
    var forIntent = cur && cur.type === 'pick' ? heard.replace(/\bshort\b/ig, ' ') : heard;
    var base = C ? C.matchIntent(forIntent) : { intent: 'unknown' };
    if (base.intent === 'problem') return { intent: 'problem', heard: heard };
    var t = norm(heard);
    var confirmWords = /\b(done|finished|picked|got|have|took|grabbed|put|placed|dropped|confirm|confirmed|counted|count|packed|loaded|moved|yes)\b/.test(t);
    if (cur) {
      if (cur.type === 'pick') {
        var q = api.parseQty(heard);
        if (q != null && (confirmWords || /^\d+$/.test(t) || t.split(' ').length <= 3)) return { intent: 'confirm', task: cur, qty: q, heard: heard };
        if (base.intent === 'done') return { intent: 'need', task: cur, heard: heard, reply: 'Say the count you picked — for example "picked ' + cur.qty + '".' };
      }
      if (cur.type === 'putaway') {
        var b = api.parseBin(heard);
        if (b && (confirmWords || base.intent === 'done' || /\b(in|into|at|bin)\b/.test(t))) return { intent: 'confirm', task: cur, binId: b, heard: heard };
        if (base.intent === 'done') return { intent: 'confirm', task: cur, binId: cur.toBinId, heard: heard };
      }
      if (cur.type === 'count') {
        var b2 = bin(state, cur.binId);
        var cq = api.parseQty(heard);
        if (cq != null && b2 && b2.contents.length <= 1) {
          var counts = {};
          counts[b2.contents.length ? b2.contents[0].desc : '(nothing)'] = cq;
          if (!b2.contents.length && cq === 0) counts = {};
          return { intent: 'confirm', task: cur, counts: counts, heard: heard };
        }
        if (cq != null) return { intent: 'need', task: cur, heard: heard, reply: 'This bin holds more than one item — enter each count on the screen.' };
      }
      if (cur.type === 'pack') {
        var cartons = api.parseQty(heard);
        if (base.intent === 'done' || confirmWords) return { intent: 'confirm', task: cur, cartons: cartons == null ? undefined : cartons, heard: heard };
      }
      if (cur.type === 'receive') {
        if (base.intent === 'done') return { intent: 'need', task: cur, heard: heard, reply: 'Receiving is posted with counts on the Receiving screen.' };
      }
      if (base.intent === 'done' || (confirmWords && ['move', 'replen', 'load', 'consolidate', 'breakdown'].indexOf(cur.type) !== -1)) {
        return { intent: 'confirm', task: cur, heard: heard };
      }
    }
    if (base.intent === 'next' || base.intent === 'done') return { intent: 'next', heard: heard };
    return { intent: 'unknown', heard: heard };
  };

  /* Carry out a plan from interpret() on (fresh) state. A problem
     plan needs plan.label (from the model) and is filed as a flag. */
  api.act = function (state, unitId, plan) {
    var u = unit(state, unitId);
    if (!u) return { ok: false, reply: 'Pick who you are first.' };
    if (plan.intent === 'problem') {
      var r = api.flag(state, { unitId: u.id, words: plan.heard, label: plan.label, source: 'voice' });
      if (!r.ok) return { ok: false, reply: r.reason };
      return { ok: true, reply: 'Flagged "' + r.flag.label + '" with your words. Nothing was closed.', flag: r.flag };
    }
    if (plan.intent === 'confirm') {
      var cur = currentOf(state, u);
      if (!cur || cur.id !== plan.task.id) return { ok: false, reply: 'That task is no longer in your hands.' };
      var res = api.complete(state, cur.id, { by: u.id, qty: plan.qty, binId: plan.binId, counts: plan.counts, cartons: plan.cartons, words: plan.heard });
      if (!res.ok) return { ok: false, reply: res.reason };
      var nx = api.nextFor(state, u.id);
      return { ok: true, reply: res.text + (nx.task ? ' Next: ' + nx.task.title + '.' : ' Nothing else waiting.'), next: nx.task };
    }
    if (plan.intent === 'next') {
      var n = api.nextFor(state, u.id);
      if (!n.task) return { ok: true, reply: 'Nothing waiting for you right now.' };
      return { ok: true, reply: (n.already ? 'Still in hand: ' : 'Next: ') + n.task.title + '. ' + n.task.detail, next: n.task };
    }
    if (plan.intent === 'need') return { ok: false, reply: plan.reply };
    return { ok: false, reply: 'Didn\'t catch an instruction. Nothing was done.' };
  };

  api.PRIORITY = PRIORITY;
  api.VERSION = WMS_VERSION;

  root.WitnessWms = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
