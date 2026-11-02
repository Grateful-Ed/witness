/* summon-test.js — node, no dependencies.
   Segment 4, Part A: the BOL-summon scan (js/summon.js). A known BOL
   summons the right shipment, its task chain and its next open task;
   an unknown BOL creates nothing and saves nothing (state deep-equal
   before/after); a read that disagrees with the file copy flags in
   numbers through bol.js's matchBol; the kitchen world is unaffected.
   The whole flow is also run through bol.js's readBol with fetch
   stubbed, as the warehouse page does it.
   Run: node test/summon-test.js   (exit 0 = all pass) */
'use strict';

var fs = require('fs');
var path = require('path');
var E = require('../js/engine.js');
var B = require('../js/bol.js');
var S = require('../js/summon.js');
var L = require('../data/bol-loads.js');
var KSEED = require('../data/kitchen-world.js');

var failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
  if (!cond) failures++;
}
function copy(o) { return JSON.parse(JSON.stringify(o)); }
function world() { var s = E.seedWorld(); E.generateTasks(s); return s; }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function src(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }

/* The Test Load 001 BOL, read cleanly (what the printed page says). */
var CLEAN = {
  carrier: 'Blue Ridge Freight Lines', bol_number: 'BRFL-TL-001', shipper: 'Piedmont Janitorial Supply',
  consignee: 'Witness Demo Warehouse', pieces_claimed: 20, total_weight: '624 lb',
  line_items: [
    { description: 'All-purpose cleaner, 1 gal', pieces: 6, weight: '216 lb', un_number: null, hazmat_marks: null },
    { description: 'Aerosol air freshener', pieces: 4, weight: '88 lb', un_number: 'UN1950', hazmat_marks: 'Limited Quantity' },
    { description: 'Paper towels', pieces: 6, weight: '120 lb', un_number: null, hazmat_marks: null },
    { description: 'Dish soap', pieces: 4, weight: '200 lb', un_number: null, hazmat_marks: null }
  ]
};
function read(over) { var o = copy(CLEAN); Object.keys(over || {}).forEach(function (k) { o[k] = over[k]; }); return B.normaliseBol(o); }

/* ---------- the file copies are in the seed ---------- */
var s0 = world();
check('seed: every inbound shipment carries a BOL file copy',
  s0.inbound.every(function (x) { return x.bol && x.bol.bolNumber && Array.isArray(x.bol.lines); }));
var in4 = E.shipmentById(s0, 'IN-1004');
var tl = L.byId('TL-001');
check('seed: IN-1004 is Test Load 001 — file copy same as data/bol-loads.js',
  !!in4 && in4.bol.bolNumber === tl.onFile.bolNumber && in4.bol.carrier === tl.onFile.carrier &&
  in4.bol.shipper === tl.onFile.shipper && in4.bol.consignee === tl.onFile.consignee &&
  in4.bol.piecesClaimed === tl.onFile.piecesClaimed && in4.bol.totalWeightLb === tl.onFile.totalWeightLb &&
  in4.bol.lines.length === tl.lines.length &&
  in4.bol.lines.every(function (l, i) { return l.name === tl.lines[i].name && l.pieces === tl.lines[i].claimed && l.weightLb === tl.lines[i].weightLb; }));
check('seed: file copy line pieces add up to the claimed total, every shipment',
  s0.inbound.every(function (x) { return x.bol.lines.reduce(function (t, l) { return t + l.pieces; }, 0) === x.bol.piecesClaimed; }));
check('seed: the printed fixture page carries the same BOL number', src('test-data/bol-test-load-001.html').indexOf('BRFL-TL-001') !== -1);
check('seed: no two shipments share a BOL number',
  s0.inbound.map(function (x) { return x.bol.bolNumber; }).filter(function (n, i, a) { return a.indexOf(n) !== i; }).length === 0);

/* ---------- match: a known BOL summons ---------- */
var s = world();
var before = copy(s);
var r = S.summon(s, read());
check('match: BRFL-TL-001 summons IN-1004', r.status === 'match' && r.shipment.id === 'IN-1004');
check('match: the message names the BOL and the shipment', /BRFL-TL-001 is on file — IN-1004/.test(r.message));
check('match: the scan changed nothing (state deep-equal)', same(s, before));
check('match: clean read agrees with the file copy, nothing differs',
  r.compare.differ.length === 0 && r.compare.total.result === 'agree' &&
  r.compare.counts.every(function (c) { return c.result === 'agree'; }) &&
  r.compare.identity.every(function (x) { return x.result === 'agree'; }));
check('match: count lines are worded read vs file, not "on the pallet"',
  r.compare.counts.every(function (c) { return /read \d+, on file \d+/.test(c.line) && !/pallet/.test(c.line); }));
check('match: "compared with" names the file copy, never the pallet',
  r.compare.against === 'the BOL on file for IN-1004 (BRFL-TL-001)');
check('match: expected truck — chain is arrive, receive, put away, all waiting',
  r.chain.length === 3 && r.chain.every(function (x) { return x.key === 'waiting'; }));
check('match: expected truck — no receive task is made by the scan', !E.taskById(s, 't-receive-IN-1004'));
check('match: expected truck — next step is logging the truck, no task id',
  r.next.taskId === null && /Log the truck at Door 2/.test(r.next.title));
check('match: stage words come from the engine', r.stage.key === 'expected');

check('match: case and punctuation don\'t matter ("brfl tl 001")',
  S.summon(s, read({ bol_number: 'brfl tl 001' })).status === 'match');

/* A shipment at the door: the receive task is the next task. */
var r1 = S.summon(s, read({ bol_number: 'BRFL-1001' }));
check('match: BRFL-1001 summons IN-1001 at Door 1', r1.status === 'match' && r1.shipment.id === 'IN-1001');
check('match: IN-1001 next task is its receive task, open',
  r1.next.taskId === 't-receive-IN-1001' && /Open/.test(r1.next.words));
check('match: IN-1001 chain — arrived done, receive open',
  r1.chain[0].key === 'done' && r1.chain[1].taskId === 't-receive-IN-1001' && r1.chain[1].key === 'open');

/* Chain follows the work done through the existing paths. */
var w = world();
var u = E.unitById(w, 'u-marcus');
E.taskById(w, 't-receive-IN-1001').status = 'assigned';
E.taskById(w, 't-receive-IN-1001').assignee = 'u-marcus';
u.currentTaskId = 't-receive-IN-1001';
var r2 = S.summon(w, read({ bol_number: 'BRFL-1001' }));
check('chain: receive in hand names the worker', r2.next.taskId === 't-receive-IN-1001' && /In hand — Marcus Reed/.test(r2.next.words));
E.completeTask(w, 't-receive-IN-1001');
E.generateTasks(w);
var firstPut = w.tasks.filter(function (t) { return t.type === 'putaway' && /^STG-IN-1001-/.test(t.stagingId); })
  .sort(function (a, b) { return a.id < b.id ? -1 : 1; })[0];
E.completeTask(w, firstPut.id);
var wBefore = copy(w);
var r3 = S.summon(w, read({ bol_number: 'BRFL-1001' }));
check('chain: after receive, 6 putaway steps follow the receive step',
  r3.chain.length === 8 && r3.chain[1].key === 'done' &&
  r3.chain.slice(2).every(function (x) { return /^t-putaway-STG-IN-1001-/.test(x.taskId); }));
check('chain: a done putaway shows done; next is the first open putaway',
  r3.chain[2].key === 'done' && r3.next.taskId === r3.chain[3].taskId && r3.chain[3].key === 'open');
check('chain: summoning mid-work still changes nothing', same(w, wBefore));
var n = 0;
w.tasks.forEach(function (t) { if (/^t-putaway-STG-IN-1001-/.test(t.id) && t.status !== 'done') { t.status = 'done'; n++; } });
var r4 = S.summon(w, read({ bol_number: 'BRFL-1001' }));
check('chain: all done — "Nothing open"', n > 0 && r4.next.taskId === null && /Nothing open/.test(r4.next.title));

/* Held stock shows as blocked in the chain, still read-only. */
var h = world();
E.arriveShipment(h, 'IN-1004', 'u-sam');
E.generateTasks(h);
E.completeTask(h, 't-receive-IN-1004');
E.generateTasks(h);
E.placeHold(h, { stagingId: 'STG-IN-1004-1' }, 'u-sam', 'Leaning');
var hBefore = copy(h);
var rh = S.summon(h, read());
check('chain: a held pallet\'s putaway says it is blocked', /Blocked: Pallet STG-IN-1004-1 is on hold/.test(rh.next.words));
check('chain: held — still nothing changed', same(h, hBefore));

/* ---------- disagreement flags through the existing match ---------- */
var bad = read({
  shipper: 'Piedmont Janitorial',
  total_weight: '600 lb',
  pieces_claimed: 22,
  line_items: [
    { description: 'All-purpose cleaner', pieces: 8, weight: '216 lb' },
    { description: 'Aerosol air freshener', pieces: 4, weight: '88 lb' },
    { description: 'Paper towels', pieces: 6, weight: '120 lb' },
    { description: 'Dish soap', pieces: 4, weight: '200 lb' },
    { description: 'Floor wax', pieces: 1, weight: '30 lb' }
  ]
});
var rb = S.summon(world(), bad);
var cleaner = rb.compare.counts.filter(function (c) { return c.name === 'All-purpose cleaner'; })[0];
check('differ: still a match (the BOL number agrees)', rb.status === 'match' && rb.shipment.id === 'IN-1004');
check('differ: cleaner flagged in numbers — read 8, on file 6, differs by 2',
  cleaner.result === 'differ' && cleaner.diff === 2 && /read 8, on file 6\. Differs by 2 — the paper says 2 more/.test(cleaner.line));
check('differ: total flagged — read 22, on file 20', rb.compare.total.result === 'differ' && /read 22, on file 20/.test(rb.compare.total.line));
check('differ: weight flagged from matchBol identity', rb.compare.identity.some(function (x) { return x.field === 'totalWeight' && x.result === 'differ'; }));
check('differ: a line not on the file copy is named', rb.compare.extra.length === 1 && /Floor wax — on the paper \(pieces 1\), not on the file copy/.test(rb.compare.extra[0].line));
check('differ: summary counts the disagreements and leaves the call to a person',
  rb.compare.differ.length === 4 && /differs from the file copy in 4 places\. A person decides/.test(rb.compare.summary));
var fewer = S.summon(world(), read({ line_items: [{ description: 'Dish soap', pieces: 3 }] }));
check('differ: fewer on paper says "fewer"; missing lines say "not found in the read"',
  /Differs by 1 — the paper says 1 fewer/.test(fewer.compare.counts[3].line) &&
  fewer.compare.counts[0].result === 'not-in-read' && /not found in the read/.test(fewer.compare.counts[0].line));
var unread = S.summon(world(), read({ total_weight: null, pieces_claimed: null }));
check('differ: an unread field is "not read", never a disagreement',
  unread.compare.total.result === 'not-read' && unread.compare.differ.length === 0);

/* ---------- no match: says so, creates nothing ---------- */
var nm = world();
var nmBefore = copy(nm);
var rn = S.summon(nm, read({ bol_number: 'XYZ-999' }));
check('no match: status no-match', rn.status === 'no-match' && rn.bolNumber === 'XYZ-999');
check('no match: says plainly the BOL is not in the system', /^BOL XYZ-999 is not in the system\./.test(rn.message));
check('no match: says nothing was created', /Nothing was created — no shipment, no task, no record\./.test(rn.message));
check('no match: carries no shipment, chain or comparison', !rn.shipment && !rn.chain && !rn.compare && !rn.next);
check('no match: state deep-equal before/after', same(nm, nmBefore));
check('no match: no shipment, task or record added',
  nm.inbound.length === nmBefore.inbound.length && nm.tasks.length === nmBefore.tasks.length && nm.records.length === nmBefore.records.length);
var nr = S.summon(nm, read({ bol_number: null }));
check('not read: no BOL number — nothing looked up, nothing created',
  nr.status === 'not-read' && /could not be read/.test(nr.message) && /Nothing was created/.test(nr.message) && same(nm, nmBefore));
check('no match: a partial number does not match', S.summon(nm, read({ bol_number: 'BRFL' })).status === 'no-match');

/* No save on scan, ever: the logic has no path to storage or the network. */
var code = src('js/summon.js').replace(/\/\*[\s\S]*?\*\//g, '');
check('no save: summon.js never saves, posts or fetches',
  !/saveState|setItem|fetch\(|saveBol|SAVE_URL|\/save/.test(code));
var page = src('js/summon-page.js').replace(/\/\*[\s\S]*?\*\//g, '');
check('no save: the page reads fresh (loadState) and never saves',
  /E\.loadState\(\)/.test(page) && !/saveState|saveBol|setItem|resetState/.test(page));
check('no save: the page reads the fresh state inside the read, before summon',
  page.indexOf('E.loadState()') < page.indexOf('S.summon('));

/* ---------- the flow through bol.js, fetch stubbed ---------- */
function reply(obj) {
  return { ok: true, status: 200, json: function () { return Promise.resolve({ choices: [{ message: { content: JSON.stringify(obj) } }] }); } };
}
var flowState = world();
var flowBefore = copy(flowState);
var asyncDone = B.readBol(function () { return Promise.resolve(reply(CLEAN)); }, 'data:image/jpeg;base64,AAAA').then(function (res) {
  var fr = S.summon(flowState, res.bol);
  check('flow: readBol → summon finds IN-1004', fr.status === 'match' && fr.shipment.id === 'IN-1004');
  check('flow: nothing changed', same(flowState, flowBefore));
  var unknown = copy(CLEAN); unknown.bol_number = 'NOPE-1';
  return B.readBol(function () { return Promise.resolve(reply(unknown)); }, 'data:image/jpeg;base64,AAAA');
}).then(function (res) {
  check('flow: unknown BOL through readBol → no-match, state unchanged',
    S.summon(flowState, res.bol).status === 'no-match' && same(flowState, flowBefore));
});

/* ---------- old saved states, and the kitchen world ---------- */
var old = world();
old.inbound = old.inbound.filter(function (x) { return x.id !== 'IN-1004'; });
old.inbound.forEach(function (x) { delete x.bol; });
E.upgradeState(old);
check('upgrade: a saved state gets its BOL file copies by id', old.inbound.every(function (x) { return !!x.bol; }));
check('upgrade: a saved state gains IN-1004 from the seed', !!E.shipmentById(old, 'IN-1004'));
var oldTwice = copy(old);
E.upgradeState(old);
check('upgrade: running twice adds nothing more', same(old, oldTwice));

var k = copy(KSEED); E.generateTasks(k);
k.inbound.push({ id: 'IN-K1', desc: 'Groceries', status: 'received', door: 'Counter', lines: [] });
var kBefore = copy(k);
E.upgradeState(k);
check('kitchen: upgrade adds no warehouse shipments to a kitchen state', same(k, kBefore));
var kr = S.summon(k, read());
check('kitchen: a warehouse BOL finds nothing in the kitchen and creates nothing', kr.status === 'no-match' && same(k, kBefore));
check('kitchen: the panel hides itself in the kitchen world', /W\.current === 'kitchen'\) \{ box\.hidden = true; return; \}/.test(page));
var wh = src('warehouse.html');
check('kitchen: warehouse.html loads the summon panel after the engine and bol.js',
  wh.indexOf('id="summonBox"') !== -1 && wh.indexOf('js/engine.js') < wh.indexOf('js/summon.js') &&
  wh.indexOf('js/bol.js') < wh.indexOf('js/summon.js') && wh.indexOf('js/summon.js') < wh.indexOf('js/summon-page.js'));
check('glasses: glasses.html does not get the summon scan (segment on hold)', !/summon/.test(src('glasses.html')));
check('kitchen: kitchen.js is untouched by the summon (no reference)', !/summon/i.test(src('js/kitchen.js')));

asyncDone.then(function () {
  console.log('---');
  if (failures) { console.log(failures + ' CHECK(S) FAILED'); process.exit(1); }
  console.log('ALL CHECKS PASSED');
}, function (e) { console.log('FAIL  async flow threw: ' + e.message); process.exit(1); });
