/* ontology-test.js — node, no dependencies.
   The dynamic ontology (js/ontology.js): a rolling, AI-shaped
   digest of the warehouse, plus predictive prep. Proves: the
   digest matches the seeded building; the incremental path
   (applyChange) and a fresh rebuild (buildDigest) agree on the
   same final state after a scripted series of real mutations;
   holding a bin with an open task mints exactly one prep note
   for the right person, never twice, and releasing the hold
   clears it; an OS&D finding preps the worker on that shipment;
   the module makes no network calls (its source is scanned);
   and deriving a digest changes nothing in state.
   Run: node test/ontology-test.js   (exit 0 = all pass) */
'use strict';

var fs = require('fs');
var E = require('../js/engine.js');
var W = require('../js/wms.js');
var O = require('../js/ontology.js');

var failures = 0, passes = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (cond) passes++; else failures++; }

function canon(x) {
  if (Array.isArray(x)) return x.map(canon);
  if (x && typeof x === 'object') {
    var o = {};
    Object.keys(x).sort().forEach(function (k) { o[k] = canon(x[k]); });
    return o;
  }
  return x;
}
function deepEq(a, b) { return JSON.stringify(canon(a)) === JSON.stringify(canon(b)); }
/* Digests are equal when every section matches and the prep queues
   hold the same notes (order of the queue is a presentation detail
   applyChange is allowed to preserve from earlier sightings). */
function digestEq(a, b) {
  var x = JSON.parse(JSON.stringify(a)), y = JSON.parse(JSON.stringify(b));
  var sk = function (n) { return n['for'] + '|' + n.about + '|' + n.fromChange; };
  x.prep.sort(function (p, q) { return sk(p) < sk(q) ? -1 : 1; });
  y.prep.sort(function (p, q) { return sk(p) < sk(q) ? -1 : 1; });
  return deepEq(x, y);
}
function byKind(list, kind) { return list.filter(function (p) { return p.kind === kind; }); }
function place(d, kind, id) { return d.places.filter(function (p) { return p.kind === kind && p.id === id; })[0]; }

/* ---------- 1. the seed world: the digest matches the building --- */
var s = W.seed();
var stateBefore = JSON.stringify(s);
var d = O.buildDigest(s);
check('deriving a digest changes nothing in state', JSON.stringify(s) === stateBefore);
check('asOf comes from the state itself (rev 0, no saved stamp yet)', d.asOf.rev === 0 && d.asOf.savedAt === null);
check('places: 8 doors, 3 zones, 24 bins, 4 pallets = 39', d.places.length === 39 &&
  byKind(d.places, 'door').length === 8 && byKind(d.places, 'zone').length === 3 &&
  byKind(d.places, 'bin').length === 24 && byKind(d.places, 'pallet').length === 4);
check('the held bin A-05 reads as held, with its stock and its hold', (function () {
  var b = place(d, 'bin', 'A-05');
  return !!b && b.status === 'hold' && deepEq(b.contents, [{ desc: 'Dog food — bags', qty: 25 }]) && /^on hold/.test(b.holds[0] || '');
})());
check('zone A carries the hold of its bin', (function () {
  var z = place(d, 'zone', 'A');
  return !!z && z.status === 'hold' && z.holds.indexOf('Bin A-05 on hold') !== -1;
})());
check('Inbound Door 1 holds IN-1001 and is unloading', (function () {
  var dr = place(d, 'door', 'Inbound Door 1');
  return !!dr && dr.status === 'unloading' && deepEq(dr.contents, [{ id: 'IN-1001' }]);
})());
check('shipments: all four, IN-1001 staged at its door', d.shipments.length === 4 &&
  d.shipments[0].id === 'IN-1001' && d.shipments[0].status === 'staged at door' && d.shipments[0].at === 'Inbound Door 1');
check('orders: 3 released + 3 entered = 6', d.orders.length === 6 &&
  d.orders.filter(function (o) { return o.flow === 'released'; }).length === 3 &&
  d.orders.filter(function (o) { return o.flow === 'entered'; }).length === 3);
check('people: 7 labor units, Sam the manager, nobody mid-task', d.people.length === 7 &&
  d.people.filter(function (p) { return p.name === 'Sam Whitaker' && p.role === 'manager'; }).length === 1 &&
  d.people.every(function (p) { return p.currentTask === null; }));
check('tasks: every open task in state, none done', d.tasks.length === s.tasks.filter(function (t) { return t.status !== 'done'; }).length &&
  d.tasks.every(function (t) { return t.status !== 'done'; }));
check('a putaway task carries its item and its destination bin', (function () {
  var t = s.tasks.filter(function (x) { return x.id === 't-putaway-STG-3'; })[0];
  var dt = d.tasks.filter(function (x) { return x.id === 't-putaway-STG-3'; })[0];
  return !!t && !!dt && dt.kind === 'putaway' && dt.item === 'Canned peaches — cases' && dt.destination === t.toBinId;
})());
check('needsEyes on the seed is exactly the held bin', d.needsEyes.length === 1 &&
  d.needsEyes[0].place === 'bin' && d.needsEyes[0].id === 'A-05' && /on hold/.test(d.needsEyes[0].reason));
check('prep on the seed is empty (no change has touched anyone\'s work)', d.prep.length === 0);
check('the digest is plain JSON — it round-trips whole', deepEq(JSON.parse(JSON.stringify(d)), d));

/* ---------- 2. incremental == rebuilt, across real mutations ----- */
var sc = W.seed();
var dc = O.buildDigest(sc);
function step(label) {
  dc = O.applyChange(sc, dc);
  check('incremental == rebuilt after ' + label, digestEq(dc, O.buildDigest(sc)));
}
W.checkIn(sc, 'APT-102', 'u-sam');
step('check-in of APT-102');
var rcv = W.receive(sc, 'IN-1002', [
  { desc: 'Laundry detergent — cases', received: 116, damaged: 4, quote: 'one sixteen cases, four crushed' },
  { desc: 'Paper towels — cases', received: 120, damaged: 0, quote: 'towels all six pallets' }
], { by: 'u-tommy', source: 'voice' });
check('setup: the receipt posted with findings', rcv.ok && rcv.osd.length >= 2);
step('receiving IN-1002 with damage');
var paTask = sc.tasks.filter(function (t) {
  var p = sc.staging.filter(function (x) { return x.id === t.stagingId; })[0];
  return t.type === 'putaway' && t.status === 'open' && p && p.shipmentId === 'IN-1002' && !p.hold;
})[0];
check('setup: a good IN-1002 pallet has an open putaway task', !!paTask);
var ra = W.reassign(sc, paTask.id, 'u-tommy', 'u-sam');
check('setup: the putaway was reassigned to Tommy', ra.ok === true);
step('reassigning a putaway to Tommy');
W.hold(sc, { binId: 'B-04' }, 'u-sam', 'recount needed');
step('holding bin B-04');
check('the running digest picked up the B-04 prep note', dc.prep.some(function (n) { return n.about === 'B-04'; }));
W.release(sc, { binId: 'B-04' }, 'u-sam');
step('releasing bin B-04');
check('the running digest dropped the B-04 prep note on release', !dc.prep.some(function (n) { return n.about === 'B-04'; }));
check('applyChange with no previous digest is a plain rebuild', digestEq(O.applyChange(sc, null), O.buildDigest(sc)) &&
  digestEq(O.applyChange(sc, {}), O.buildDigest(sc)));

/* ---------- 3. prep: a hold on a bin with an open task ----------- */
var s3 = W.seed();
var d3 = O.buildDigest(s3);
W.hold(s3, { binId: 'B-04' }, 'u-sam', 'recount needed');
d3 = O.applyChange(s3, d3);
check('holding B-04 mints exactly one prep note', d3.prep.length === 1);
check('the note is for the manager (the pick task it blocks is unassigned)', d3.prep.length === 1 && d3.prep[0]['for'] === 'Sam Whitaker');
check('the note is about the bin, says what changed, and names the blocked task', d3.prep.length === 1 &&
  d3.prep[0].about === 'B-04' && d3.prep[0].fromChange === 'Bin B-04 put on hold' &&
  /on hold/.test(d3.prep[0].note) && d3.prep[0].note.indexOf('ORD-501') !== -1);
check('a prep note carries exactly the brief\'s four fields', d3.prep.length === 1 &&
  deepEq(Object.keys(d3.prep[0]).sort(), ['about', 'for', 'fromChange', 'note']));
d3 = O.applyChange(s3, d3);
check('updating again on the same state mints no duplicate', d3.prep.length === 1);
check('a fresh rebuild of the same state holds the same single note', O.buildDigest(s3).prep.length === 1 &&
  digestEq(O.buildDigest(s3), d3));
W.release(s3, { binId: 'B-04' }, 'u-sam');
d3 = O.applyChange(s3, d3);
check('releasing the hold clears the note', d3.prep.length === 0);

/* ---------- 4. prep: an OS&D finding reaches its worker ---------- */
var s4 = W.seed();
W.checkIn(s4, 'APT-102', 'u-sam');
W.receive(s4, 'IN-1002', [
  { desc: 'Laundry detergent — cases', received: 116, damaged: 4, quote: 'four crushed' },
  { desc: 'Paper towels — cases', received: 120, damaged: 0, quote: 'towels all good' }
], { by: 'u-tommy', source: 'voice' });
var pa4 = s4.tasks.filter(function (t) {
  var p = s4.staging.filter(function (x) { return x.id === t.stagingId; })[0];
  return t.type === 'putaway' && t.status === 'open' && p && p.shipmentId === 'IN-1002' && !p.hold;
})[0];
W.reassign(s4, pa4.id, 'u-tommy', 'u-sam');
var d4 = O.buildDigest(s4);
check('the open findings prep the worker putting that shipment away', d4.prep.some(function (n) {
  return n.about === 'IN-1002' && n['for'] === 'Tommy Nguyen' && /OS&D/.test(n.note) && /awaiting a human decision/.test(n.note);
}));
check('the reassignment itself preps him too', d4.prep.some(function (n) {
  return n.about === pa4.id && n['for'] === 'Tommy Nguyen' && /reassigned/.test(n.fromChange);
}));
s4.wms.osd.forEach(function (f) { if (f.status === 'open') W.resolveOsd(s4, f.id, 'u-sam', 'carrier credit agreed'); });
check('closing the findings clears the OS&D prep note', !O.buildDigest(s4).prep.some(function (n) { return n.about === 'IN-1002'; }));

/* ---------- 5. no network, no timers, no delivery ---------------- */
var src = fs.readFileSync(__dirname + '/../js/ontology.js', 'utf8');
check('the module source has no fetch call', !/fetch\s*\(/.test(src));
check('the module source has no XMLHttpRequest', src.indexOf('XMLHttpRequest') === -1);
check('the module source names no Worker URL', src.indexOf('workers.dev') === -1 && !/https?:\/\//.test(src));
check('the module source starts no timer (no polling, ever)', !/setInterval|setTimeout/.test(src));

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
