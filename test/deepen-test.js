/* deepen-test.js — node, no dependencies.
   Slice 2 (deepen areas 2, 3, 4, 10) against the real engine and the
   seed world: inbound end to end, outbound end to end with
   allocation, holds, incident updates, the shift summary. Same style
   as engine-test.js: seed → act → assert totals. Quantities are moved,
   never created or destroyed.
   Run: node test/deepen-test.js   (exit 0 = all pass) */
'use strict';

var E = require('../js/engine.js');
var C = require('../js/converse.js');

var failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
  if (!cond) failures++;
}
function fresh() { var s = E.seedWorld(); E.generateTasks(s); return s; }
function itemTotal(state, desc) {
  var t = 0;
  state.bins.forEach(function (b) { b.contents.forEach(function (c) { if (c.desc === desc) t += c.qty; }); });
  return t;
}
function stagedTotal(state, desc) {
  var t = 0;
  state.staging.forEach(function (p) { if (p.desc === desc) t += p.qty; });
  return t;
}
function binQty(state, binId, desc) {
  var q = 0;
  E.binById(state, binId).contents.forEach(function (c) { if (c.desc === desc) q += c.qty; });
  return q;
}
function door(state, id) { return state.doors.filter(function (d) { return d.id === id; })[0]; }
function lastRecord(state) { return state.records[state.records.length - 1]; }
function assignTo(state, taskId, unitId) {
  var t = E.taskById(state, taskId), u = E.unitById(state, unitId);
  t.status = 'assigned'; t.assignee = u.id; u.currentTaskId = t.id;
  return t;
}
var PEACH = 'Canned peaches — cases';

/* ================= 1. INBOUND END TO END ========================== */
var s = fresh();
var in1 = E.shipmentById(s, 'IN-1001');
check('inbound: IN-1001 starts "arrived" (at the door, waiting)', E.inboundStage(s, in1).key === 'arrived');
check('inbound: IN-1002 starts "expected", words name the door',
  E.inboundStage(s, E.shipmentById(s, 'IN-1002')).words === 'Expected today — Inbound Door 3.');

assignTo(s, 't-receive-IN-1001', 'u-marcus');
check('inbound: receive task in hand → "receiving", names the unit',
  E.inboundStage(s, in1).key === 'receiving' && /Marcus Reed/.test(E.inboundStage(s, in1).words));

var peachBins = itemTotal(s, PEACH), peachStaged = stagedTotal(s, PEACH);
check('inbound: receive completes', E.completeTask(s, 't-receive-IN-1001') === true);
var fromTruck = s.staging.filter(function (p) { return p.shipmentId === 'IN-1001'; });
check('inbound: receiving stages one pallet per BOL pallet (6)', fromTruck.length === 6);
check('inbound: staged qty = BOL qty exactly (6 × 40 = 240)',
  stagedTotal(s, PEACH) === peachStaged + 240 && itemTotal(s, PEACH) === peachBins);
check('inbound: Inbound Door 1 is "staged", no longer holds the truck', door(s, 'Inbound Door 1').state === 'staged' && door(s, 'Inbound Door 1').shipmentId === null);
check('inbound: stage "putaway", 6 of 6 left', E.inboundStage(s, in1).key === 'putaway' && /6 of 6 pallets/.test(E.inboundStage(s, in1).words));
check('inbound: receive record says what was staged', /6 pallets \(240 cases\/bags\) staged at Inbound Door 1/.test(lastRecord(s).text));

E.generateTasks(s);
var truckPutaways = s.tasks.filter(function (t) { return t.type === 'putaway' && /^STG-IN-1001-/.test(t.stagingId); });
check('inbound: putaway generated from what was received (6, zone A)',
  truckPutaways.length === 6 && truckPutaways.every(function (t) { return t.zone === 'A'; }));
truckPutaways.forEach(function (t) { E.completeTask(s, t.id); });
check('inbound: all 240 cases in bins after putaway, none created or lost',
  itemTotal(s, PEACH) === peachBins + 240 && stagedTotal(s, PEACH) === peachStaged);
check('inbound: stage "closed"', E.inboundStage(s, in1).key === 'closed');
check('inbound: Inbound Door 1 still "staged" while the old STG-3 pallet waits', door(s, 'Inbound Door 1').state === 'staged');
E.completeTask(s, 't-putaway-STG-3');
check('inbound: Inbound Door 1 goes "empty" when its last pallet leaves', door(s, 'Inbound Door 1').state === 'empty');

var arr = E.arriveShipment(s, 'IN-1002', 'u-sam');
check('inbound: IN-1002 arrives at Inbound Door 3', arr.ok && door(s, 'Inbound Door 3').state === 'unloading' &&
  door(s, 'Inbound Door 3').shipmentId === 'IN-1002' && E.inboundStage(s, E.shipmentById(s, 'IN-1002')).key === 'arrived');
check('inbound: arrival is in the records with who', lastRecord(s).kind === 'arrive' && /Sam Whitaker/.test(lastRecord(s).text));
check('inbound: arriving twice is refused', E.arriveShipment(s, 'IN-1002', 'u-sam').ok === false);
E.generateTasks(s);
check('inbound: arrival generates the receive task', !!E.taskById(s, 't-receive-IN-1002'));
E.completeTask(s, 't-receive-IN-1002');
check('inbound: mixed BOL stages 4 + 6 pallets (120 detergent, 120 towels)',
  s.staging.filter(function (p) { return p.shipmentId === 'IN-1002'; }).length === 10 &&
  s.staging.filter(function (p) { return p.shipmentId === 'IN-1002' && /detergent/.test(p.desc); })
    .reduce(function (n, p) { return n + p.qty; }, 0) === 120);

var busy = fresh();
E.shipmentById(busy, 'IN-1003').door = 'Inbound Door 1'; /* Inbound Door 1 holds IN-1001 */
var refused = E.arriveShipment(busy, 'IN-1003', 'u-sam');
check('inbound: a door holding another truck refuses, plainly', !refused.ok && /Inbound Door 1 is busy with IN-1001/.test(refused.reason));
var wrongWall = fresh(); E.shipmentById(wrongWall, 'IN-1003').door = 'Outbound Door 1';
var ww = E.arriveShipment(wrongWall, 'IN-1003', 'u-sam');
check('inbound: a truck sent to an outbound door is refused, plainly', !ww.ok && /Outbound Door 1 is an outbound door/.test(ww.reason));

/* ================= 2. OUTBOUND END TO END ========================= */
var o = fresh();
check('outbound: seed orders allocate in full (every line reserved)',
  o.outbound.every(function (x) { return x.status === 'allocated' && x.lines.every(function (l) { return l.allocated; }); }));
check('outbound: stage words "Allocated — 2 lines reserved"',
  E.orderStage(o, E.orderById(o, 'ORD-501')).words === 'Allocated — 2 lines reserved, waiting to pick.');

/* Rice: B-04 holds 30, ORD-501 reserves 10 → 20 free. */
o.outbound.push({ id: 'ORD-900', status: 'open', door: 'Outbound Door 4', lines: [{ binId: 'B-04', desc: 'Rice — bags', qty: 25 }] });
o.outbound.push({ id: 'ORD-901', status: 'open', door: 'Outbound Door 4', lines: [{ binId: 'B-04', desc: 'Rice — bags', qty: 15 }] });
E.generateTasks(o);
var o900 = E.orderById(o, 'ORD-900');
check('outbound: a line bigger than free stock is short, not shorted',
  o900.status === 'allocating' && !o900.lines[0].allocated && o900.lines[0].short.want === 25 && o900.lines[0].short.free === 20);
check('outbound: short line says so plainly',
  /1 of 1 line short: wants 25 × Rice — bags, 20 free/.test(E.orderStage(o, o900).words));
check('outbound: short line gets no pick task', !o.tasks.some(function (t) { return t.orderId === 'ORD-900'; }));
check('outbound: a line that fits the free stock is reserved (15 of 20)',
  E.orderById(o, 'ORD-901').status === 'allocated' && !!E.taskById(o, 't-pick-ORD-901-B-04'));

o.outbound.push({ id: 'ORD-902', status: 'open', door: 'Outbound Door 4', lines: [{ binId: 'B-01', desc: PEACH, qty: 30 }] });
E.generateTasks(o);
check('outbound: own bin short → another usable bin fills the line (B-01 → A-01)',
  E.orderById(o, 'ORD-902').lines[0].binId === 'A-01' && E.orderById(o, 'ORD-902').lines[0].allocated === true);

var heldAlloc = fresh();
E.placeHold(heldAlloc, { binId: 'A-01' }, 'u-sam', 'water damage');
heldAlloc.outbound.push({ id: 'ORD-903', status: 'open', door: 'Outbound Door 4', lines: [{ binId: 'A-01', desc: PEACH, qty: 30 }] });
E.generateTasks(heldAlloc);
var o903 = E.orderById(heldAlloc, 'ORD-903').lines[0];
check('outbound: held stock is never allocated (A-01 held → best free bin is B-09, 16)',
  !o903.allocated && o903.short.want === 30 && o903.short.free === 16);

/* Held-bin confession: a line allocated from B-04, then B-04 held. */
var conf = fresh();
var riceLine = E.orderById(conf, 'ORD-501').lines.filter(function (l) { return l.binId === 'B-04'; })[0];
check('confession: allocated line reads plainly before any hold', riceLine.allocated && E.lineSource(conf, riceLine) === 'from B-04');
E.placeHold(conf, { binId: 'B-04' }, 'u-sam', 'pallet leaning');
check('confession: bin held after allocation → "from B-04 — bin on hold"', E.lineSource(conf, riceLine) === 'from B-04 — bin on hold');
check('confession: the reservation stands untouched', riceLine.allocated === true && riceLine.binId === 'B-04' && !!E.taskById(conf, 't-pick-ORD-501-B-04'));
check('confession: the manager summary carries it too', /Rice — bags from B-04 — bin on hold/.test(C.buildStateSummary(E, conf).text));
E.releaseHold(conf, { binId: 'B-04' }, 'u-sam');
check('confession: release → the confession goes', E.lineSource(conf, riceLine) === 'from B-04');

/* Pick ORD-501 through to shipped, counting every case. */
var rice0 = itemTotal(o, 'Rice — bags'), water0 = itemTotal(o, 'Bottled water — cases');
E.completeTask(o, 't-pick-ORD-501-B-04');
check('outbound: one line picked → "picking 1 of 2"', E.orderStage(o, E.orderById(o, 'ORD-501')).words === 'Picking — 1 of 2 lines picked.');
E.completeTask(o, 't-pick-ORD-501-A-08');
var o501 = E.orderById(o, 'ORD-501');
check('outbound: last pick → staged at Outbound Door 4', o501.status === 'staged at door' && o501.door === 'Outbound Door 4' &&
  E.orderStage(o, o501).key === 'staged');
check('outbound: bins dropped by exactly the picked qty', itemTotal(o, 'Rice — bags') === rice0 - 10 &&
  itemTotal(o, 'Bottled water — cases') === water0 - 12);
E.generateTasks(o);
var load = E.taskById(o, 't-load-ORD-501');
check('outbound: a load task is generated at the order\'s door (zone C)', !!load && load.type === 'load' && load.zone === 'C');
check('outbound: load completes', E.completeTask(o, 't-load-ORD-501') === true);
check('outbound: shipped, 22 loaded = 10 + 12 picked', o501.status === 'shipped' && o501.shippedQty === 22 &&
  E.orderStage(o, o501).words === 'Shipped from Outbound Door 4 — 22 loaded.');
check('outbound: shipping is a record entry', lastRecord(o).kind === 'complete' && lastRecord(o).type === 'load' &&
  /Shipped ORD-501 from Outbound Door 4 — 22 loaded/.test(lastRecord(o).text));
check('outbound: shipped + in bins = what we started with',
  itemTotal(o, 'Rice — bags') + 10 === rice0 && itemTotal(o, 'Bottled water — cases') + 12 === water0);
check('outbound: picking released the reservation (rice free = 30 − 10 picked − 15 reserved)',
  binQty(o, 'B-04', 'Rice — bags') === 20 && E.orderById(o, 'ORD-900').lines[0].short.free === 5);

/* ================= 3. HOLDS ======================================= */
var h = fresh();
var ricePick = assignTo(h, 't-pick-ORD-501-B-04', 'u-tommy');
var hold = E.placeHold(h, { binId: 'B-04' }, 'u-sam', 'pallet leaning');
check('holds: bin goes on hold, who/why kept', hold.ok && E.binById(h, 'B-04').status === 'hold' &&
  E.binById(h, 'B-04').hold.by === 'u-sam' && E.binById(h, 'B-04').hold.reason === 'pallet leaning');
check('holds: the worker on it is freed, task back to the queue',
  hold.freed.join() === 'Tommy Nguyen' && ricePick.status === 'open' && !E.unitById(h, 'u-tommy').currentTaskId);
check('holds: record says who, what, why', lastRecord(h).kind === 'hold' && lastRecord(h).by === 'u-sam' &&
  /Bin B-04 put on hold by Sam Whitaker: pallet leaning/.test(lastRecord(h).text) && !!lastRecord(h).ts);
check('holds: blocked task says why', E.blockedBy(h, ricePick) === 'Bin B-04 is on hold — pallet leaning.');
var b04 = binQty(h, 'B-04', 'Rice — bags');
check('holds: held task can\'t be completed; bin untouched', E.completeTask(h, ricePick.id) === false && binQty(h, 'B-04', 'Rice — bags') === b04);
var tommy = E.unitById(h, 'u-tommy');
var got = E.nextTaskFor(h, tommy);
check('holds: held work is never handed out', !got || got.id !== ricePick.id);
check('holds: holding twice is refused', E.placeHold(h, { binId: 'B-04' }, 'u-sam', 'x').ok === false);
var rel = E.releaseHold(h, { binId: 'B-04' }, 'u-sam');
check('holds: release clears it, recorded with who', rel.ok && E.binById(h, 'B-04').status === 'ok' &&
  lastRecord(h).kind === 'release' && /released from hold by Sam Whitaker/.test(lastRecord(h).text));
check('holds: released work can be completed again', E.blockedBy(h, ricePick) === null);
check('holds: releasing what isn\'t held is refused', E.releaseHold(h, { binId: 'B-04' }, 'u-sam').ok === false);

var hc = E.seedWorld();
E.placeHold(hc, { binId: 'B-01' }, 'u-sam', 'recount');
E.placeHold(hc, { binId: 'B-09' }, 'u-sam', 'recount');
E.placeHold(hc, { binId: 'A-06' }, 'u-sam', 'recount');
E.generateTasks(hc);
check('holds: held bin is not a consolidation candidate', hc.tasks.some(function (t) { return t.type === 'consolidate'; }) &&
  hc.tasks.filter(function (t) { return t.type === 'consolidate'; }).every(function (t) {
    return ['B-01', 'B-09', 'A-06'].indexOf(t.fromBinId) === -1 && ['B-01', 'B-09', 'A-06'].indexOf(t.toBinId) === -1;
  }));
check('holds: held bin is not a breakdown candidate', !hc.tasks.some(function (t) { return t.type === 'breakdown'; }));

var hp = E.seedWorld();
E.placeHold(hp, { stagingId: 'STG-1' }, 'u-sam', 'wrap torn');
E.generateTasks(hp);
check('holds: a held pallet gets no putaway', !E.taskById(hp, 't-putaway-STG-1'));
check('holds: current holds list the pallet with who', E.currentHolds(hp).some(function (x) {
  return x.target.stagingId === 'STG-1' && x.by === 'Sam Whitaker' && x.reason === 'wrap torn';
}));
E.releaseHold(hp, { stagingId: 'STG-1' }, 'u-sam');
E.generateTasks(hp);
check('holds: released pallet gets its putaway', !!E.taskById(hp, 't-putaway-STG-1'));

/* ================= 4. INCIDENT UPDATES ============================= */
var u = fresh();
var freight = JSON.stringify(u.bins) + JSON.stringify(u.staging) + JSON.stringify(u.outbound);
var r1 = E.addTaskUpdate(u, 't-putaway-STG-2', 'pallet spilled at Inbound Door 2', 'u-dee');
var t2 = E.taskById(u, 't-putaway-STG-2');
check('updates: addTaskUpdate(state, taskId, text, byUnit) returns the record entry',
  !!r1 && r1.kind === 'incident' && r1.taskId === 't-putaway-STG-2' && r1.by === 'u-dee' && r1 === lastRecord(u));
check('updates: the update rides the task', t2.notes.length === 1 && t2.notes[0].text === 'pallet spilled at Inbound Door 2' && t2.notes[0].by === 'u-dee');
check('updates: record names who and the task', /Update on "Put away 24 × Laundry detergent — cases" from Dee Carter: pallet spilled at Inbound Door 2/.test(r1.text));
check('updates: an update moves no freight and closes nothing',
  JSON.stringify(u.bins) + JSON.stringify(u.staging) + JSON.stringify(u.outbound) === freight && t2.status === 'open');
E.completeTask(u, 't-putaway-STG-2');
var r2 = E.addTaskUpdate(u, 't-putaway-STG-2', 'two cases found crushed after putaway', 'u-sam');
check('updates: records are never frozen — a done task takes an update', !!r2 && t2.notes.length === 2 && t2.status === 'done');
check('updates: blank words or no such task → null',
  E.addTaskUpdate(u, 't-putaway-STG-2', '  ', 'u-sam') === null && E.addTaskUpdate(u, 'nope', 'x', 'u-sam') === null);
assignTo(u, 't-putaway-STG-1', 'u-marcus');
var rp = E.reportProblem(u, 'u-marcus', 'forklift down in A');
check('updates: the voice problem intent lands through addTaskUpdate',
  rp.record.kind === 'incident' && rp.record.taskId === 't-putaway-STG-1' && rp.task.notes[0].text === 'forklift down in A');

/* ================= 5. SHIFT SUMMARY =============================== */
var w = fresh();
var marcus = E.unitById(w, 'u-marcus');
var dee = E.unitById(w, 'u-dee');
/* The shift is worked at the desk (the engine's own paths): a receive
   is a signed act and is never closed by voice (the converse model
   step), and converse no longer pulls work — so the summary's input is
   built here directly, the way the desk's Done/Next click builds it. */
function deskDone(u) { var t = E.taskById(w, u.currentTaskId); E.completeTask(w, t.id); E.generateTasks(w); E.nextTaskFor(w, u); }
E.nextTaskFor(w, marcus);                                             /* Marcus takes the receive */
deskDone(marcus);                                                     /* closes it, takes the next */
deskDone(marcus);
E.nextTaskFor(w, dee);
deskDone(dee);
E.reportProblem(w, 'u-dee', 'problem, shrink wrap torn');
var sum = E.shiftSummary(w);
var doneTasks = w.tasks.filter(function (t) { return t.status === 'done'; });
check('summary: tasks done = 3, computed from the tasks', sum.tasksDone === 3 && doneTasks.length === 3);
check('summary: per-unit counts (Marcus 2, Dee 1)', sum.perUnit.filter(function (p) { return p.name === 'Marcus Reed'; })[0].done === 2 &&
  sum.perUnit.filter(function (p) { return p.name === 'Dee Carter'; })[0].done === 1);
var typeSum = 0; Object.keys(sum.doneByType).forEach(function (k) { typeSum += sum.doneByType[k]; });
var zoneSum = 0; Object.keys(sum.doneByZone).forEach(function (k) { zoneSum += sum.doneByZone[k]; });
check('summary: by type and by zone both add up to tasks done', typeSum === 3 && zoneSum === 3 && sum.doneByType.receive === 1);
check('summary: incidents listed', sum.incidents.length === 1 && /shrink wrap torn/.test(sum.incidents[0].text));
check('summary: shipment received is counted', sum.shipmentsReceived.length === 1 && sum.shipmentsReceived[0].id === 'IN-1001');
check('summary: open bottleneck is the engine\'s own call', JSON.stringify(sum.bottleneck) === JSON.stringify(E.bottleneck(w)));
check('summary: shipped orders counted (from the outbound run above)',
  E.shiftSummary(o).ordersShipped.length === 1 && E.shiftSummary(o).ordersShipped[0].qty === 22);
check('summary: completed tasks stamp who did it', doneTasks.every(function (t) { return !!t.doneBy && !!t.doneAt; }));

/* ================= saved state from before this slice ============= */
var old = E.seedWorld();
old.inbound.forEach(function (x) { delete x.lines; });
old.outbound.forEach(function (x) { delete x.door; });
old.outbound[1].status = 'picked'; old.outbound[1].lines[0].done = true;
E.upgradeState(old);
check('upgrade: bills of lading filled from the seed', old.inbound.every(function (x) { return Array.isArray(x.lines); }));
check('upgrade: orders get the loading door; "picked" becomes staged', old.outbound.every(function (x) { return x.door === 'Outbound Door 4'; }) &&
  old.outbound[1].status === 'staged at door' && old.outbound[1].lines[0].pickedQty === 8);

/* ================= the manager's summary reads the stages ========== */
var ms = C.buildStateSummary(E, s).text;
check('converse summary carries inbound stages', /IN-1001 .* — stage: Closed — received, all 6 pallets in bins\./.test(ms));
check('converse summary carries order stages', /ORD-501 .* — stage: Allocated — 2 lines reserved/.test(ms));
check('converse summary lists holds', /HOLDS/.test(ms) && /Bin A-05 \(Zone A\) — on hold/.test(ms));

console.log('---');
console.log(failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
