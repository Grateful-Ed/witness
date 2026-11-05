/* wms-test.js — node, no dependencies.
   The full WMS layer (js/wms.js) against the real engine and the
   seed world, end to end: dock appointments → check-in → receive
   against the BOL → OS&D → putaway (directed and overridden) →
   holds → cycle counts → moves → replenishment → orders → waves →
   allocation that respects holds → picks (full and short) → pack →
   load → ship confirm → queues and reassignment → labor proposals →
   flags → dashboard and shift summary → the spoken word.
   Same law as the engine suite: quantities move; nothing is created
   or destroyed except by a posted receipt or a counted adjustment.
   Run: node test/wms-test.js   (exit 0 = all pass) */
'use strict';

var E = require('../js/engine.js');
var W = require('../js/wms.js');

var failures = 0, passes = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
  if (cond) passes++; else failures++;
}

/* A clock that moves one minute per call, so times are ordered. */
var t0 = Date.parse('2026-11-02T08:00:00Z'), tick = 0;
W.now = function () { return new Date(t0 + 60000 * (tick++)).toISOString(); };

function fresh() { return W.seed(); }
function binQty(s, id, desc) { var b = E.binById(s, id), q = 0; b.contents.forEach(function (c) { if (c.desc === desc) q += c.qty; }); return q; }
function itemTotal(s, desc) { var t = 0; s.bins.forEach(function (b) { b.contents.forEach(function (c) { if (c.desc === desc) t += c.qty; }); }); return t; }
function stagedTotal(s, desc) { var t = 0; s.staging.forEach(function (p) { if (p.desc === desc) t += p.qty; }); return t; }
function task(s, id) { return E.taskById(s, id); }
function find(s, pred) { for (var i = 0; i < s.tasks.length; i++) if (pred(s.tasks[i])) return s.tasks[i]; return null; }
function snapshot(s) { return JSON.stringify(s); }

/* ---------- seed & install ---------- */
var s = fresh();
check('seed: WMS layer installed (items, appointments, slots, orders)', !!s.wms && Object.keys(s.wms.items).length >= 16 &&
  s.wms.appointments.length === 3 && s.wms.slots.length === 3 && s.wms.orders.length === 3);
check('seed: BOL file copies filled on inbound', s.inbound.every(function (x) { return x.bol && x.bol.bolNumber; }));
check('seed: outbound orders carry customer and wave W-000', s.outbound.every(function (o) { return o.customer && o.wave === 'W-000'; }));
check('seed: engine tasks generated (putaway, picks, receive)', !!task(s, 't-putaway-STG-1') && !!task(s, 't-pick-ORD-501-B-04') && !!task(s, 't-receive-IN-1001'));
var before = snapshot(s);
W.install(s);
check('install is idempotent (a second install changes nothing)', snapshot(s) === before);
var raw = E.seedWorld(); E.generateTasks(raw);
W.install(raw);
check('install upgrades a plain engine state without touching its tasks', raw.tasks.length === 17 && !!raw.wms);

/* ---------- dock & yard ---------- */
s = fresh();
var r = W.schedule(s, { shipmentId: 'IN-1003', door: 'Inbound Door 3', day: 'Today', start: '10:30', end: '11:00' }, 'u-sam');
check('schedule: a clash on the same door and day is refused', !r.ok && /Inbound Door 3 is booked 10:00–11:30/.test(r.reason));
r = W.schedule(s, { shipmentId: 'IN-1003', door: 'Inbound Door 3', day: 'Today', start: '12:00', end: '13:00', trailer: 'BRF-9' }, 'u-sam');
check('schedule: a free window reschedules the shipment\'s appointment', r.ok && r.appointment.id === 'APT-103' && E.shipmentById(s, 'IN-1003').door === 'Inbound Door 3');
check('schedule: an outbound door is refused for a truck coming in', /Outbound Door 2 is an outbound door/.test(W.schedule(s, { shipmentId: 'IN-1003', door: 'Outbound Door 2', day: 'Today', start: '14:00', end: '15:00' }).reason || ''));
check('schedule: bad times refused', !W.schedule(s, { shipmentId: 'IN-1003', door: 'Inbound Door 3', day: 'Today', start: '14:00', end: '13:00' }).ok);
check('schedule: a shipment already at a door is refused', !W.schedule(s, { shipmentId: 'IN-1001', door: 'Inbound Door 3', day: 'Today', start: '15:00', end: '16:00' }).ok);
r = W.checkIn(s, 'APT-102', 'u-sam');
check('check-in: IN-1002 arrives at Inbound Door 3', r.ok && E.shipmentById(s, 'IN-1002').status === 'staged at door' && s.wms.appointments[1].status === 'checked in');
check('check-in: a receive task appears for IN-1002', !!task(s, 't-receive-IN-1002'));
check('check-in: twice is refused', !W.checkIn(s, 'APT-102', 'u-sam').ok);
r = W.checkIn(s, 'APT-103', 'u-sam');
check('check-in: a busy door refuses the second trailer', !r.ok && /busy with IN-1002/.test(r.reason));

/* ---------- receiving against the BOL ---------- */
var exp = W.expectedLines(E.shipmentById(s, 'IN-1002'));
check('expected lines come from the BOL on file (120 detergent, 120 towels)', exp.length === 2 && exp[0].expected === 120 && exp[1].expected === 120);
var snap = snapshot(s);
r = W.receive(s, 'IN-1002', [{ desc: 'Laundry detergent — cases', received: 116 }], { by: 'u-tommy' });
check('receive: a missing count is refused and nothing changes', !r.ok && snapshot(s) === snap);
r = W.receive(s, 'IN-1002', [{ desc: 'Laundry detergent — cases', received: 3, damaged: 4 }, { desc: 'Paper towels — cases', received: 120 }], {});
check('receive: damaged more than received is refused', !r.ok && snapshot(s) === snap);
check('receive: the generic task completion refuses a receive', !W.complete(s, 't-receive-IN-1002', {}).ok);

var detBefore = itemTotal(s, 'Laundry detergent — cases') + stagedTotal(s, 'Laundry detergent — cases');
r = W.receive(s, 'IN-1002', [
  { desc: 'Laundry detergent — cases', received: 116, damaged: 4, quote: 'four pallets, one sixteen, four crushed' },
  { desc: 'Paper towels — cases', received: 122, damaged: 0, quote: 'towels six pallets and two extra' }
], { by: 'u-tommy', photoFlags: [{ label: 'Torn wrap', detail: 'Wrap torn on the left side.' }] });
check('receive: posted', r.ok && E.shipmentById(s, 'IN-1002').status === 'received');
check('receive: received units enter staging exactly (116 detergent, 122 towels)',
  stagedTotal(s, 'Laundry detergent — cases') + itemTotal(s, 'Laundry detergent — cases') === detBefore + 116 &&
  s.staging.filter(function (p) { return p.shipmentId === 'IN-1002' && p.desc === 'Paper towels — cases'; }).reduce(function (a, p) { return a + p.qty; }, 0) === 122);
check('receive: good stock palletised by the BOL per-pallet count (112 detergent → 30+30+30+22)',
  s.staging.filter(function (p) { return p.shipmentId === 'IN-1002' && p.desc === 'Laundry detergent — cases' && !p.damaged; }).map(function (p) { return p.qty; }).join(',') === '30,30,30,22');
var dmg = s.staging.filter(function (p) { return p.damaged; })[0];
check('receive: damaged cases staged ON HOLD with the receiver\'s words', dmg && dmg.qty === 4 && dmg.hold && /"four pallets, one sixteen, four crushed"/.test(dmg.hold.reason));
check('receive: no putaway task for the held damaged pallet', !task(s, 't-putaway-' + dmg.id));
check('receive: putaway tasks generated for every good pallet', s.staging.filter(function (p) { return p.shipmentId === 'IN-1002' && !p.hold; }).every(function (p) { return !!task(s, 't-putaway-' + p.id); }));
var osd = s.wms.osd.filter(function (f) { return f.shipmentId === 'IN-1002'; });
check('OS&D: shortage 4, damage 4, overage 2, plus the photo flag', osd.length === 4 &&
  osd.some(function (f) { return f.type === 'shortage' && f.qty === 4; }) && osd.some(function (f) { return f.type === 'damage' && f.qty === 4; }) &&
  osd.some(function (f) { return f.type === 'overage' && f.qty === 2; }) && osd.some(function (f) { return f.type === 'photo' && f.label === 'Torn wrap'; }));
check('OS&D: findings quote the receiver\'s exact words', osd.filter(function (f) { return f.desc === 'Laundry detergent — cases'; }).every(function (f) { return f.words === 'four pallets, one sixteen, four crushed'; }));
check('receive: receive task closed, appointment complete, door freed', task(s, 't-receive-IN-1002').status === 'done' &&
  s.wms.appointments[1].status === 'complete' && E.binById(s, 'A-01') && s.doors[2].shipmentId === null && s.doors[2].state === 'staged');
check('receive: a second receipt is refused', !W.receive(s, 'IN-1002', [], {}).ok);
check('receipt kept with its lines and OS&D ids', s.wms.receipts.length === 1 && s.wms.receipts[0].osdIds.length === 4 && s.wms.receipts[0].bolNumber === 'SEL-1002');
r = W.resolveOsd(s, osd[0].id, 'u-sam', 'carrier credit agreed');
check('OS&D: a finding closes with a note; closing twice is refused', r.ok && osd[0].status === 'closed' && !W.resolveOsd(s, osd[0].id, 'u-sam', '').ok);
check('typed receipt records "(typed count — no words recorded)"', (function () {
  var x = fresh();
  W.receive(x, 'IN-1001', [{ desc: 'Canned peaches — cases', received: 240 }], { by: 'u-marcus' });
  return x.wms.osd.length === 0 && x.wms.receipts[0].lines[0].quote === '';
})());

/* ---------- putaway: directed, overridden, held ---------- */
var pa = find(s, function (t) { return t.type === 'putaway' && t.status === 'open' && /STG-IN-1002/.test(t.stagingId); });
var pallet = s.staging.filter(function (p) { return p.id === pa.stagingId; })[0];
var suggested = pa.toBinId;
r = W.complete(s, pa.id, { binId: 'A-05' });
check('putaway: to a held bin is refused', !r.ok && /hold/.test(r.reason));
r = W.complete(s, pa.id, { binId: 'Z-99' });
check('putaway: to a bin that does not exist is refused', !r.ok);
r = W.complete(s, pa.id, { binId: 'b-06', by: 'u-rosa' });
check('putaway: override bin accepted, suggested vs actual kept', r.ok && pa.toBinId === 'B-06' && pa.suggestedBinId === suggested && binQty(s, 'B-06', pallet.desc) === pallet.qty);
check('putaway: override recorded', s.records.some(function (x) { return x.kind === 'putaway-override' && /actual B-06/.test(x.text); }));
var pa2 = find(s, function (t) { return t.type === 'putaway' && t.status === 'open'; });
var dest = pa2.toBinId, p2 = s.staging.filter(function (p) { return p.id === pa2.stagingId; })[0], q0 = binQty(s, dest, p2.desc);
r = W.complete(s, pa2.id, {});
check('putaway: directed bin when none named', r.ok && binQty(s, dest, p2.desc) === q0 + p2.qty && !pa2.suggestedBinId);
r = W.release(s, { stagingId: dmg.id }, 'u-sam');
check('release the damaged pallet → its putaway task appears', r.ok && !!task(s, 't-putaway-' + dmg.id));

/* dock-to-stock: put away everything from IN-1002 */
var guard = 0;
while (s.staging.some(function (p) { return p.shipmentId === 'IN-1002'; }) && guard++ < 30) {
  var nxt = find(s, function (t) { return t.type === 'putaway' && t.status !== 'done' && /STG-IN-1002/.test(t.stagingId); });
  if (!nxt || !W.complete(s, nxt.id, {}).ok) break;
}
var d = W.dashboard(s);
check('dashboard: dock-to-stock computed once a receipt is fully binned', s.staging.every(function (p) { return p.shipmentId !== 'IN-1002'; }) && d.dockToStockMin > 0);
check('inbound status: closed — all in bins', W.inboundStatus(s, E.shipmentById(s, 'IN-1002')).key === 'closed');

/* ---------- holds, counts, moves ---------- */
s = fresh();
r = W.hold(s, { binId: 'B-04' }, 'u-sam', 'Leaning pallet');
check('hold: B-04 held; its pick task is blocked', r.ok && !!W.blocked(s, task(s, 't-pick-ORD-501-B-04')));
check('hold: held stock is excluded from available inventory', W.inventory(s).filter(function (x) { return x.desc === 'Rice — bags'; })[0].available === 0);
r = W.createMove(s, { fromBinId: 'B-04', toBinId: 'B-03', desc: 'Rice — bags', qty: 5 }, 'u-sam');
check('move: out of a held bin is refused', !r.ok);
r = W.reallocateHeld(s, 'u-sam');
check('re-allocate off held bins: the rice line loses its reservation (no other bin has 10)', r.ok && !E.orderById(s, 'ORD-501').lines[0].allocated && !task(s, 't-pick-ORD-501-B-04'));
W.release(s, { binId: 'B-04' }, 'u-sam');
check('release: the line re-allocates to B-04 and its pick returns', E.orderById(s, 'ORD-501').lines[0].allocated && !!task(s, 't-pick-ORD-501-B-04'));

r = W.createMove(s, { fromBinId: 'B-04', toBinId: 'B-03', desc: 'Rice — bags', qty: 25 }, 'u-sam');
check('move: reserved stock cannot be moved (30 on hand, 10 reserved)', !r.ok && /Only 20 free/.test(r.reason));
r = W.createMove(s, { fromBinId: 'B-04', toBinId: 'B-03', desc: 'Rice — bags', qty: 20 }, 'u-sam');
var mv = task(s, r.taskId);
check('move: a move task is created', r.ok && mv.type === 'move' && mv.status === 'open');
var rice0 = itemTotal(s, 'Rice — bags');
r = W.complete(s, mv.id, { by: 'u-tommy' });
check('move: completes, books balance', r.ok && binQty(s, 'B-04', 'Rice — bags') === 10 && binQty(s, 'B-03', 'Rice — bags') === 20 && itemTotal(s, 'Rice — bags') === rice0);

r = W.cycleCount(s, ['C-05', 'C-05', 'C-07'], { by: 'u-sam', reason: 'Spot check' });
check('cycle count: one task per bin, no duplicates', r.ok && r.tasks.length === 2 && !W.cycleCount(s, ['C-05'], {}).ok);
var cc = find(s, function (t) { return t.type === 'count' && t.binId === 'C-05'; });
check('cycle count: the task never shows the system number', !/11/.test(cc.detail + cc.title));
r = W.complete(s, cc.id, { counts: {} });
check('cycle count: a missing count is refused', !r.ok);
r = W.complete(s, cc.id, { counts: { 'Coffee — cases': 9 }, words: 'nine coffee', by: 'u-jay' });
check('cycle count: variance -2 adjusts the bin and is kept with the words', r.ok && binQty(s, 'C-05', 'Coffee — cases') === 9 &&
  s.wms.counts[0].lines[0].variance === -2 && s.wms.counts[0].words === 'nine coffee');
var cc2 = find(s, function (t) { return t.type === 'count' && t.binId === 'C-07' && t.status !== 'done'; });
W.complete(s, cc2.id, { counts: { 'Tea — cases': 15 } });
d = W.dashboard(s);
check('inventory accuracy = exact counts / counts (1 of 2 = 50%)', d.accuracy === 50 && d.countsDone === 2);

/* A count that drops a bin below its reservations unreserves the line. */
r = W.cycleCount(s, ['C-08'], {});
var cc3 = task(s, r.tasks[0]);
r = W.complete(s, cc3.id, { counts: { 'Cereal — cases': 4 } });
var l503 = E.orderById(s, 'ORD-503').lines[1];
check('count below reservation: the cereal line (wants 10, 4 counted) is no longer allocated', r.ok && !l503.allocated && !task(s, 't-pick-ORD-503-C-08'));

/* ---------- replenishment ---------- */
s = fresh();
var pickWater = task(s, 't-pick-ORD-501-A-08');
W.complete(s, pickWater.id, {});
check('pick water: A-08 drops to 23 (below min 30)', binQty(s, 'A-08', 'Bottled water — cases') === 23);
check('replen: no reserve stock yet → exception, no task', !find(s, function (t) { return t.type === 'replen'; }) &&
  W.slotStatus(s).filter(function (x) { return x.binId === 'A-08'; })[0].state === 'exception');
W.complete(s, 't-putaway-STG-4', {}); /* 30 water → emptiest C bin = reserve */
var rp = find(s, function (t) { return t.type === 'replen' && t.toBinId === 'A-08'; });
check('replen: reserve appears → task to bring A-08 toward max (37 wanted, 30 available)', rp && rp.qty === 30 && rp.fromBinId === 'C-03');
var water0 = itemTotal(s, 'Bottled water — cases');
r = W.complete(s, rp.id, { by: 'u-marcus' });
check('replen: completes; face back to 53; books balance', r.ok && binQty(s, 'A-08', 'Bottled water — cases') === 53 && itemTotal(s, 'Bottled water — cases') === water0);
check('replen: no second task once the face is above min', !find(s, function (t) { return t.type === 'replen' && t.status !== 'done'; }));
r = W.setSlot(s, { binId: 'C-04', desc: 'Sugar — bags', min: 30, max: 50 }, 'u-sam');
check('set a new pick face below min → exception (no reserve sugar)', r.ok && W.slotStatus(s).filter(function (x) { return x.binId === 'C-04'; })[0].state === 'exception');
check('setSlot: min must be below max', !W.setSlot(s, { binId: 'C-04', desc: 'Sugar — bags', min: 50, max: 50 }).ok);

/* ---------- orders, waves, allocation ---------- */
s = fresh();
r = W.createOrder(s, { customer: '', lines: [{ desc: 'Tea — cases', qty: 1 }] });
check('order: customer required', !r.ok);
r = W.createOrder(s, { customer: 'Test', lines: [{ desc: 'Tea — cases', qty: 0 }] });
check('order: quantity must be 1 or more', !r.ok);
r = W.createOrder(s, { customer: 'Corner Store', priority: 'High', lines: [{ desc: 'Sugar — bags', qty: 5 }] }, 'u-sam');
check('order: saved as New, not on the floor', r.ok && r.order.id === 'ORD-604' && !E.orderById(s, 'ORD-604') && !find(s, function (t) { return t.orderId === 'ORD-604'; }));
r = W.releaseWave(s, ['ORD-601', 'ORD-603', 'ORD-604'], 'u-sam');
check('wave: released as W-001', r.ok && r.waveId === 'W-001' && s.wms.orders.length === 1);
var o601 = E.orderById(s, 'ORD-601'), o603 = E.orderById(s, 'ORD-603');
check('allocation: peaches allocated from a bin that holds 20 (A-01)', o601.lines[0].allocated && o601.lines[0].binId === 'A-01');
check('allocation: held dog food is never allocated — line short with the numbers', !o603.lines[0].allocated && o603.lines[0].short && o603.lines[0].short.free === 0);
check('order status: allocating (short) in plain words', /short/.test(W.orderStatus(s, o603).words));
check('wave: pick tasks generated for allocated lines only', !!task(s, 't-pick-ORD-601-A-01') && !find(s, function (t) { return t.orderId === 'ORD-603'; }));
check('wave: releasing an unknown or released order is refused', !W.releaseWave(s, ['ORD-601'], 'u-sam').ok);
W.release(s, { binId: 'A-05' }, 'u-sam');
check('release the dog food hold → ORD-603 allocates', E.orderById(s, 'ORD-603').lines[0].allocated);

/* ---------- picking (full and short), pack, load, ship ---------- */
s = fresh();
var pk = task(s, 't-pick-ORD-503-B-02');
r = W.complete(s, pk.id, { qty: 7 });
check('pick: more than the line wants is refused', !r.ok);
var sauce0 = itemTotal(s, 'Tomato sauce — cases');
r = W.complete(s, pk.id, { qty: 4, words: 'only four there', by: 'u-tommy' });
var line = E.orderById(s, 'ORD-503').lines[0];
check('short pick: 4 of 6 picked, 2 short recorded on the line', r.ok && line.done && line.pickedQty === 4 && line.shortPicked === 2);
check('short pick: only what was picked left the bin', itemTotal(s, 'Tomato sauce — cases') === sauce0 - 4);
check('short pick: a cycle count of B-02 is queued', !!find(s, function (t) { return t.type === 'count' && t.binId === 'B-02' && t.status === 'open'; }));
W.complete(s, 't-pick-ORD-503-C-08', {});
var o503 = E.orderById(s, 'ORD-503');
check('order fully picked → staged, waiting to pack', o503.status === 'staged at door' && W.orderStatus(s, o503).key === 'picked');
check('pack task generated; load task blocked until packed', !!task(s, 't-pack-ORD-503') && /Waiting on packing/.test(W.blocked(s, task(s, 't-load-ORD-503'))));
check('load refused before pack', !W.complete(s, 't-load-ORD-503', {}).ok);
check('pack: cartons must be 1 or more', !W.complete(s, 't-pack-ORD-503', { cartons: 0 }).ok);
r = W.complete(s, 't-pack-ORD-503', { cartons: 2, by: 'u-jay' });
check('pack: label, weight from the item master (4×21 + 10×14 = 224 lb)', r.ok && o503.packed.cartons === 2 && o503.packed.weightLb === 224 && /^WIT\d+$/.test(o503.packed.tracking));
check('order status: packed, ready to load', W.orderStatus(s, o503).key === 'packed');
r = W.complete(s, 't-load-ORD-503', { by: 'u-jay' });
var ld = s.wms.loads[0];
check('load: order on a trailer at Outbound Door 4, load open', r.ok && ld && ld.status === 'loading' && ld.orderIds[0] === 'ORD-503' && s.doors.filter(function (d) { return d.id === 'Outbound Door 4'; })[0].loadId === ld.id);
check('order status: loaded (not yet shipped)', W.orderStatus(s, o503).key === 'loaded');
W.complete(s, 't-pick-ORD-502-C-02', {});
W.complete(s, 't-pack-ORD-502', {});
W.complete(s, 't-load-ORD-502', {});
check('a second order joins the same open load at the door', ld.orderIds.length === 2 && s.wms.loads.length === 1);
r = W.closeLoad(s, ld.id, { seal: 'SL-1', by: 'u-sam' });
check('ship confirm: load closed with BOL, seal and totals', r.ok && ld.status === 'shipped' && /^WIT-OB-\d{4}$/.test(ld.bolNumber) && ld.seal === 'SL-1' && ld.totals.units === 22 && ld.totals.orders === 2);
check('ship confirm: order status shipped; door freed', W.orderStatus(s, o503).key === 'shipped' && s.doors.filter(function (d) { return d.id === 'Outbound Door 4'; })[0].loadId === null);
check('ship confirm: closing twice is refused', !W.closeLoad(s, ld.id, {}).ok);
d = W.dashboard(s);
check('dashboard: fill rate counts the short pick (22 of 24 = 91.7%)', d.fillRate === 91.7 && d.shortPicks === 1);
check('dashboard: shipments out counted from closed loads', d.outbound.loadsClosed === 1 && d.outbound.shipped === 2 && d.outbound.unitsOut === 22);

/* ---------- queues, reassignment, priorities ---------- */
s = fresh();
var n = W.nextFor(s, 'u-marcus');
check('next: zone A worker gets zone A receiving first', n.task && n.task.id === 't-receive-IN-1001' && n.task.status === 'assigned');
check('next: asking again returns the same task in hand', W.nextFor(s, 'u-marcus').already === true);
r = W.reassign(s, 't-receive-IN-1001', 'u-dee', 'u-sam');
check('reassign: free hands → straight into Dee\'s hands', r.ok && r.how === 'now in hand' && task(s, 't-receive-IN-1001').assignee === 'u-dee' && !E.unitById(s, 'u-marcus').currentTaskId);
r = W.reassign(s, 't-pick-ORD-502-C-02', 'u-dee', 'u-sam');
check('reassign: busy hands → queued for Dee', r.ok && r.how === 'queued next' && task(s, 't-pick-ORD-502-C-02').queuedFor === 'u-dee');
check('queue: Dee\'s queue shows current + queued', (function () { var q = W.queueFor(s, 'u-dee'); return q.current.id === 't-receive-IN-1001' && q.queued[0].id === 't-pick-ORD-502-C-02'; })());
check('queue: a task queued for Dee is not handed to anyone else', W.nextFor(s, 'u-jay').task.id !== 't-pick-ORD-502-C-02');
check('reassign: a done task is refused', (function () { var x = fresh(); W.complete(x, 't-pick-ORD-502-C-02', {}); return !W.reassign(x, 't-pick-ORD-502-C-02', 'u-dee').ok; })());
check('priority: High-priority order picks come first within the same type', (function () {
  var x = fresh(); W.releaseWave(x, ['ORD-601', 'ORD-602'], 'u-sam');
  var u = E.unitById(x, 'u-marcus');
  x.tasks.forEach(function (t) { if (t.type !== 'pick') t.status = 'done'; });
  return W.nextFor(x, u.id).task.orderId !== 'ORD-602';
})());

/* ---------- labor proposals ---------- */
s = fresh();
var props = W.proposals(s);
check('proposals: zone B backing up (8 waiting) → move someone from a lighter zone', props.length >= 1 && props[0].toZone === 'B' && /Zone B has 8 tasks waiting/.test(props[0].why));
var u0 = E.unitById(s, props[0].unitId), z0 = u0.zone;
check('proposals change nothing on their own', u0.zone === z0 && s.wms.decisions.length === 0);
r = W.decide(s, props[0], false, 'u-sam');
check('decline: recorded, worker stays', r.ok && u0.zone === z0 && s.wms.decisions[0].approved === false);
r = W.decide(s, props[0], true, 'u-sam');
check('approve: the worker\'s zone moves', r.ok && u0.zone === 'B');
check('approve: a stale proposal is refused', !W.decide(s, props[0], true, 'u-sam').ok);

/* ---------- flags ---------- */
s = fresh();
W.nextFor(s, 'u-tommy');
var words = '  The forklift is leaking oil by B-03, it\'s slick!  ';
r = W.flag(s, { unitId: 'u-tommy', words: words, label: 'Forklift leaking oil' });
check('flag: label plus the exact words (trimmed only)', r.ok && r.flag.label === 'Forklift leaking oil' && r.flag.words === words.trim());
check('flag: pinned to the task in hand, which stays open', r.flag.taskId && task(s, r.flag.taskId).status === 'assigned' && task(s, r.flag.taskId).notes[0].text === words.trim());
check('flag: no category fields on the flag', Object.keys(r.flag).sort().join(',') === 'by,id,label,source,status,taskId,ts,words,zone');
r = W.flag(s, { unitId: 'u-rosa', words: 'Light out over aisle B' });
check('flag: no task in hand still lands; no label → "Unlabeled"', r.ok && r.flag.taskId === null && r.flag.label === 'Unlabeled');
check('flag: empty words refused', !W.flag(s, { unitId: 'u-rosa', words: '  ' }).ok);
r = W.closeFlag(s, s.wms.flags[0].id, 'u-sam', 'Cleaned up');
check('flag: closes with a note; dashboard counts open flags', r.ok && W.dashboard(s).flagsOpen === 1);

/* ---------- shift summary ---------- */
var sum = W.shiftSummary(s);
check('shift summary: computed from engine + WMS (flags, base counts)', sum.flags.length === 2 && typeof sum.base.tasksDone === 'number' && sum.dash.zones.length === 3);

/* ---------- the spoken word (local, deterministic) ---------- */
check('parseQty: digits', W.parseQty('picked 10') === 10);
check('parseQty: words', W.parseQty('picked twenty four cases') === 24 && W.parseQty('one hundred and twenty') === 120);
check('parseQty: a bin id is not a quantity', W.parseQty('in a 3') === null);
check('parseBin: "A-03", "bin b 7", "charlie two", "a03"', W.parseBin('put it in A-03') === 'A-03' && W.parseBin('bin b 7') === 'B-07' &&
  W.parseBin('charlie two') === 'C-02' && W.parseBin('a03') === 'A-03');
check('parseBin: nothing that looks like a bin → null', W.parseBin('done') === null);

s = fresh();
W.nextFor(s, 'u-tommy'); /* zone B: first B task */
var tk = W.currentOf(s, 'u-tommy');
check('voice setup: Tommy has a zone B pick in hand', tk && tk.type === 'pick');
var plan = W.interpret(s, 'u-tommy', 'picked ' + tk.qty);
check('interpret: "picked N" confirms the pick with N', plan.intent === 'confirm' && plan.qty === tk.qty);
plan = W.interpret(s, 'u-tommy', 'picked two, four short');
check('interpret: "picked two, four short" is a short pick, not a problem', plan.intent === 'confirm' && plan.qty === 2);
plan = W.interpret(s, 'u-tommy', 'done');
check('interpret: a bare "done" on a pick asks for the count', plan.intent === 'need');
plan = W.interpret(s, 'u-tommy', 'the case is crushed and leaking');
check('interpret: problem words → problem (nothing completes)', plan.intent === 'problem');
var out = W.act(s, 'u-tommy', W.interpret(s, 'u-tommy', 'picked ' + tk.qty));
check('act: confirm completes the pick and pulls the next task', out.ok && task(s, tk.id).status === 'done' && /Next:|Nothing else/.test(out.reply));
s = fresh();
W.nextFor(s, 'u-marcus');
W.complete; /* Marcus holds the receive; give him a putaway instead */
W.reassign(s, 't-receive-IN-1001', 'u-dee', 'u-sam');
W.reassign(s, 't-putaway-STG-1', 'u-marcus', 'u-sam');
plan = W.interpret(s, 'u-marcus', 'put it in alpha seven');
check('interpret: putaway "in alpha seven" → confirm to A-07', plan.intent === 'confirm' && plan.binId === 'A-07');
out = W.act(s, 'u-marcus', plan);
check('act: putaway lands in the bin that was said', out.ok && binQty(s, 'A-07', 'Paper towels — cases') === 18);
out = W.act(s, 'u-marcus', W.interpret(s, 'u-marcus', 'what\'s next'));
check('act: "what\'s next" pulls a task', out.ok && !!W.currentOf(s, 'u-marcus'));
out = W.act(s, 'u-marcus', { intent: 'problem', heard: 'Pallet is leaning badly', label: 'Leaning pallet' });
check('act: a problem plan files a flag with the words', out.ok && s.wms.flags[0].words === 'Pallet is leaning badly');

/* ---------- conservation across a whole shift ---------- */
s = fresh();
function grand(x) { var t = 0; x.bins.forEach(function (b) { b.contents.forEach(function (c) { t += c.qty; }); }); x.staging.forEach(function (p) { t += p.qty; }); return t; }
function shippedOut(x) { var t = 0; x.outbound.forEach(function (o) { o.lines.forEach(function (l) { t += l.pickedQty || 0; }); }); return t; }
var g0 = grand(s);
W.receive(s, 'IN-1001', [{ desc: 'Canned peaches — cases', received: 236, damaged: 6, quote: 'six crushed' }], { by: 'u-marcus' });
W.releaseWave(s, ['ORD-601', 'ORD-602', 'ORD-603'], 'u-sam');
var loops = 0, progressed = true;
while (progressed && loops++ < 200) {
  progressed = false;
  for (var i = 0; i < s.tasks.length; i++) {
    var t = s.tasks[i];
    if (t.status === 'done' || W.blocked(s, t) || t.type === 'receive') continue;
    var res = W.complete(s, t.id, t.type === 'count' ? { counts: (function () { var m = {}; E.binById(s, t.binId).contents.forEach(function (c) { m[c.desc] = c.qty; }); return m; })() } : {});
    if (res.ok) { progressed = true; break; }
  }
}
check('whole shift: every workable task completes', !s.tasks.some(function (t) { return t.status !== 'done' && !W.blocked(s, t) && t.type !== 'receive'; }));
check('whole shift: stock in the building = start + received − shipped/picked out (nothing invented)', grand(s) === g0 + 236 - shippedOut(s));
s.wms.loads.forEach(function (l) { if (l.status === 'loading') W.closeLoad(s, l.id, { by: 'u-sam' }); });
check('whole shift: every loaded order ends shipped on a closed load', s.outbound.filter(function (o) { return o.status === 'shipped'; }).every(function (o) { return W.orderStatus(s, o).key === 'shipped'; }));
check('whole shift: state fits the Worker\'s /state cap with room to spare', JSON.stringify(s).length < 200000);

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
