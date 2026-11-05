/* engine-test.js — node, no dependencies.
   Exercises the exact engine the warehouse page runs, against the
   seed world, and checks the books balance: quantities are moved,
   never created or destroyed.
   Run: node test/engine-test.js   (exit 0 = all pass) */
'use strict';

var engine = require('../js/engine.js');

var failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
  if (!cond) failures++;
}
function itemTotal(state, desc) {
  var t = 0;
  state.bins.forEach(function (b) {
    b.contents.forEach(function (c) { if (c.desc === desc) t += c.qty; });
  });
  return t;
}
function binQty(state, binId, desc) {
  var bin = engine.binById(state, binId);
  if (!bin) return -1;
  var q = 0;
  bin.contents.forEach(function (c) { if (c.desc === desc) q += c.qty; });
  return q;
}

/* --- seed + generation ------------------------------------------- */
var state = engine.seedWorld();
engine.generateTasks(state);

var byType = {};
state.tasks.forEach(function (t) { byType[t.type] = (byType[t.type] || 0) + 1; });
console.log('tasks by type: ' + JSON.stringify(byType) + ' (total ' + state.tasks.length + ')');

check('generates at least one consolidate task', (byType.consolidate || 0) >= 1);
check('generates at least one breakdown task', (byType.breakdown || 0) >= 1);
check('generates at least one receive task', (byType.receive || 0) >= 1);
check('generates putaway for every staged pallet', (byType.putaway || 0) === state.staging.length);
check('generates a pick per open order line',
  (byType.pick || 0) === state.outbound.reduce(function (n, o) { return n + o.lines.length; }, 0));

var receive = state.tasks.filter(function (t) { return t.type === 'receive'; })[0];
check('receive task links to the cross-check (index.html)', receive && receive.link === 'index.html');

/* generation is idempotent — a second pass adds nothing */
var countBefore = state.tasks.length;
engine.generateTasks(state);
check('generateTasks is idempotent', state.tasks.length === countBefore);

/* --- putaway: staging -> bin, exact quantities -------------------- */
var put = state.tasks.filter(function (t) { return t.type === 'putaway'; })[0];
var pallet = state.staging.filter(function (p) { return p.id === put.stagingId; })[0];
var binBefore = binQty(state, put.toBinId, pallet.desc);
var stagingBefore = state.staging.length;
var recordsBefore = state.records.length;
check('putaway completes', engine.completeTask(state, put.id) === true);
check('bin qty rose by exactly the staged qty', binQty(state, put.toBinId, pallet.desc) === binBefore + pallet.qty);
check('staging pallet is gone', state.staging.length === stagingBefore - 1 &&
  !state.staging.some(function (p) { return p.id === pallet.id; }));
check('records grew on putaway completion', state.records.length === recordsBefore + 1);

/* --- consolidate: same total, one bin emptied ---------------------- */
var con = state.tasks.filter(function (t) { return t.type === 'consolidate'; })[0];
var totalBefore = itemTotal(state, con.desc);
check('consolidate completes', engine.completeTask(state, con.id) === true);
check('total qty of the item across bins is unchanged', itemTotal(state, con.desc) === totalBefore);
check('source bin emptied of the item', binQty(state, con.fromBinId, con.desc) === 0);
check('destination holds the combined pile', binQty(state, con.toBinId, con.desc) > 0);

/* --- breakdown: pallet becomes cartons, total unchanged ------------ */
var brk = state.tasks.filter(function (t) { return t.type === 'breakdown'; })[0];
var brkTotalBefore = itemTotal(state, brk.desc);
check('breakdown completes', engine.completeTask(state, brk.id) === true);
check('breakdown total qty unchanged', itemTotal(state, brk.desc) === brkTotalBefore);
check('breakdown source bin cleared of the pallet',
  binQty(state, brk.binId, brk.desc) === 0 &&
  engine.binById(state, brk.binId).needsBreakdown === false);

/* --- pick: bin decremented, order advances -------------------------- */
var pick = state.tasks.filter(function (t) { return t.type === 'pick'; })[0];
var pickBinBefore = binQty(state, pick.binId, pick.desc);
check('pick completes', engine.completeTask(state, pick.id) === true);
check('pick decremented the bin by the line qty', binQty(state, pick.binId, pick.desc) === pickBinBefore - pick.qty);

/* --- assignment ------------------------------------------------------ */
var fresh = engine.seedWorld();
engine.generateTasks(fresh);
var unit = fresh.labor.filter(function (u) { return u.role === 'worker' && u.zone === 'A'; })[0];
var task = engine.nextTaskFor(fresh, unit);
check('nextTaskFor assigns a task', !!task && task.status === 'assigned' && task.assignee === unit.id);
check('unit carries the current task', unit.currentTaskId === task.id);
check('nextTaskFor again returns the same in-hand task', engine.nextTaskFor(fresh, unit).id === task.id);
check('completing the assigned task frees the unit',
  engine.completeTask(fresh, task.id) === true && unit.currentTaskId === null && task.status === 'done');

/* --- bottleneck (on a pristine state — nothing completed yet) ------ */
var pristine = engine.seedWorld();
engine.generateTasks(pristine);
var b = engine.bottleneck(pristine);
check('bottleneck names a zone', !!b && typeof b.zone === 'string');
check('bottleneck suggests a move', !!b && !!b.suggestion && !!b.suggestion.unitName);
check('suggested move comes from a different, lighter zone',
  !!b && b.suggestion.fromZone !== b.zone && b.suggestion.toZone === b.zone &&
  pristine.labor.some(function (u) { return u.id === b.suggestion.unitId && u.zone === b.suggestion.fromZone; }));
console.log('bottleneck: zone ' + (b && b.zone) + ', ' + (b && b.pending) + ' waiting, move ' +
  (b && b.suggestion.unitName) + ' from ' + (b && b.suggestion.fromZone));

/* --- zone stats -------------------------------------------------------- */
var stats = engine.zoneStats(fresh);
check('zoneStats covers all zones with workers',
  stats.A.workersPresent === 3 && stats.B.workersPresent === 2 && stats.C.workersPresent === 3);

/* --- records ------------------------------------------------------------ */
check('records grew across completions', fresh.records.length >= 1 &&
  fresh.records.every(function (r) { return r.ts && typeof r.text === 'string' && r.text.length > 0; }));

/* --- fixed home locations (kitchen slice) ------------------------------ */
/* A staged item may name its home bin: it wins when free and not held;
   otherwise the emptiest-bin rule, unchanged. */
function homeWorld(home, binSetup) {
  var s = engine.seedWorld();
  s.staging = [{ id: 'STG-H', door: 'Inbound Door 3', desc: 'Test item', qty: 5, home: home }];
  s.tasks = [];
  if (binSetup) binSetup(s);
  engine.generateTasks(s);
  return engine.taskById(s, 't-putaway-STG-H');
}
var noHome = homeWorld(null);
check('home: an item without a home goes to the emptiest bin, as before', noHome && noHome.toBinId === 'B-03');
var homeFree = homeWorld('B-07', function (s) { engine.binById(s, 'B-07').contents = []; });
check('home: a free home bin is respected', homeFree && homeFree.toBinId === 'B-07');
var homeHeld = homeWorld('B-07', function (s) {
  var b = engine.binById(s, 'B-07'); b.contents = []; b.status = 'hold';
});
check('home: a held home bin falls back to the emptiest bin', homeHeld && homeHeld.toBinId === 'B-03');
var homeFull = homeWorld('B-07');
check('home: an occupied home bin falls back to the emptiest bin', homeFull && homeFull.toBinId === 'B-03');
var homeMixed = homeWorld('B-07', function (s) { engine.binById(s, 'B-07').mixed = true; });
check('home: a mixed bin (built to hold many items) is not "occupied"', homeMixed && homeMixed.toBinId === 'B-07');

console.log('---');
console.log(failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
