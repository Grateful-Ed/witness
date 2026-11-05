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
   deriving a digest changes nothing in state; and the building's
   slang: learnTerm is pure and lazy, the digest lists the
   vocabulary, and applyChange announces a new word exactly once.
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
check('places: 12 doors, 3 zones, 30 bins, 8 pallets = 53', d.places.length === 53 &&
  byKind(d.places, 'door').length === 12 && byKind(d.places, 'zone').length === 3 &&
  byKind(d.places, 'bin').length === 30 && byKind(d.places, 'pallet').length === 8);
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

/* ---------- 6. the building's slang: learnTerm + the digest ----- */
var s6 = W.seed();
check('the seed state has no vocabulary key, and its digest vocabulary is empty', !('vocabulary' in s6) &&
  deepEq(O.buildDigest(s6).vocabulary, []));
var s6Before = JSON.stringify(s6);
var s6b = O.learnTerm(s6, { term: 'sweating', means: 'condensation wet on the bottom bags', from: 'Rosa Flores', at: '2026-11-04T21:05:00Z' });
check('learnTerm is pure: input untouched, a new state back, vocabulary created lazily',
  JSON.stringify(s6) === s6Before && s6b !== s6 && !('vocabulary' in s6) && !!s6b.vocabulary);
check('learnTerm writes the definition, attributed to its teacher, with its time', deepEq(s6b.vocabulary.sweating,
  { means: 'condensation wet on the bottom bags', taughtBy: 'Rosa Flores', at: '2026-11-04T21:05:00Z' }));
var s6c = O.learnTerm(s6, { term: 'the grip', means: 'the forklift clamp attachment', about: 'Inbound Door 2', from: 'Tommy Nguyen', at: '2026-11-04T21:06:00Z' });
check('learnTerm records what the word names, when it names something', s6c.vocabulary['the grip'].about === 'Inbound Door 2');
check('a term or a meaning missing teaches nothing (the state comes back as it was)',
  O.learnTerm(s6, { term: '', means: 'x' }) === s6 && O.learnTerm(s6, { term: 'x', means: '  ' }) === s6);
check('the digest lists the vocabulary as { term, means, taughtBy }', deepEq(O.buildDigest(s6b).vocabulary,
  [{ term: 'sweating', means: 'condensation wet on the bottom bags', taughtBy: 'Rosa Flores' }]));
var d6 = O.buildDigest(s6);
var d6b = O.applyChange(s6b, d6);
var vocabNotes = d6b.prep.filter(function (n) { return n.about === 'sweating'; });
check('applyChange announces a newly learned word exactly once, to the manager', vocabNotes.length === 1 &&
  vocabNotes[0].note === "New word in the building's vocabulary: 'sweating' — taught by Rosa Flores" &&
  vocabNotes[0]['for'] === 'Sam Whitaker' &&
  deepEq(Object.keys(vocabNotes[0]).sort(), ['about', 'for', 'fromChange', 'note']));
var d6c = O.applyChange(s6b, d6b);
check('the announcement is not repeated once the word is known',
  d6c.prep.filter(function (n) { return n.about === 'sweating'; }).length === 0);
check('a fresh rebuild carries no announcement (an emission, not a standing note)', O.buildDigest(s6b).prep.length === 0);

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
