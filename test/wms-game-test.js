/* wms-game-test.js — node, no dependencies.
   "Walk the shift" (js/wms-game.js): the practice-only game on the
   warehouse map. Proves the pure logic: the chain is dealt from a
   seeded state as five tasks in the brief's order (check in, move
   to the bay, put away, second putaway, spot count); the working
   pallet is the one at the shipment's door; destination bins are
   chosen from the state's EMPTY bins at build time, never the same
   bin twice; directing aims the real putaway tasks at those bins;
   each step mutates the real state (the pallet leaves staging and
   lands in the bin's contents, its putaway task closes, the count
   posts as a real cycle-count record with no variance); the shift
   is not complete until the count posts; a building without two
   workable pallets or two empty bins deals no chain; every step
   carries an OFFER naming the work and its destination, and every
   step's target resolves to a cell of the warehouse map itself;
   the voice command matcher takes the completion family, the count
   confirm, start and auto-run — and nothing else, however close the
   words come; and the module's source makes no network calls
   (practice-only enforcement lives in the UI layer — the panel and
   the controller both check the practice flag before any mutation
   can be offered).
   Run: node test/wms-game-test.js   (exit 0 = all pass) */
'use strict';

var fs = require('fs');
var E = require('../js/engine.js');
var W = require('../js/wms.js');
var M = require('../js/wms-map.js');
var G = require('../js/wms-game.js');

var failures = 0, passes = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (cond) passes++; else failures++; }
function bin(state, id) { return E.binById(state, id); }
function pallet(state, id) { var p = null; state.staging.forEach(function (x) { if (x.id === id) p = x; }); return p; }
function task(state, id) { return E.taskById(state, id); }

/* ---------- the chain, dealt from a fresh seed -------------------- */

var s = W.seed();
var chain = G.buildChain(s);
check('a chain is dealt from the seeded building', !!chain);
check('the chain has five steps', !!chain && chain.steps.length === 5 && G.TOTAL === 5);
check('the steps run in the brief\u2019s order: check in, to the bay, put away, second putaway, count',
  !!chain && chain.steps.map(function (x) { return x.kind; }).join(',') === 'checkin,toBay,putaway,putaway,count');
check('the working pallet is the one staged at the shipment\u2019s door (STG-3, Inbound Door 1)',
  !!chain && chain.palletA === 'STG-3' && chain.door === 'Inbound Door 1');
check('the second pallet is a different staged pallet', !!chain && chain.palletB !== chain.palletA && !!pallet(s, chain.palletB));
check('both destination bins are empty in the state at build time',
  !!chain && bin(s, chain.binA).contents.length === 0 && bin(s, chain.binB).contents.length === 0);
check('the destination bins are not on hold, and are two different bins',
  !!chain && bin(s, chain.binA).status !== 'hold' && bin(s, chain.binB).status !== 'hold' && chain.binA !== chain.binB);
check('every step names its target place on the map',
  !!chain && chain.steps.every(function (x) { return x.target && x.target.place && x.target.id; }));

/* ---------- the offers, and the map they are played on ------------- */
/* The loop is the job loop: each step is OFFERED (work + destination,
   the way the program would say it) — never an instruction in how to
   click — and the stage is the warehouse map itself: every target
   the chain names must be a cell the real map renders. */
check('every step carries an offer naming the work, with no click language in it',
  !!chain && chain.steps.every(function (x) { return typeof x.offer === 'string' && x.offer.length > 0 && !/click/i.test(x.offer); }));
check('the putaway offers name their pallet and their Stage bin; the count offer names its bin',
  !!chain && chain.steps[2].offer.indexOf(chain.palletA) !== -1 && chain.steps[2].offer.indexOf('Stage: Bin ' + chain.binA) !== -1 &&
  chain.steps[3].offer.indexOf(chain.palletB) !== -1 && chain.steps[3].offer.indexOf('Stage: Bin ' + chain.binB) !== -1 &&
  chain.steps[4].offer.indexOf(chain.binA) !== -1);
var board = M.html(W.seed(), W);
check('every step target is a cell the warehouse map itself renders (place + id)',
  !!chain && chain.steps.every(function (x) {
    var re = new RegExp('data-place="' + x.target.place + '"[^>]*data-id="' + x.target.id.replace(/\//g, '\\/') + '"');
    return re.test(board);
  }));

/* ---------- voice commands: the whole vocabulary, matched exactly --- */

check('voice: "Complete" is the completion command', G.voiceCommand('Complete') === 'complete');
check('voice: the completion family — done, finished, done with this one, I\'m done (punctuation ignored)',
  G.voiceCommand('done.') === 'complete' && G.voiceCommand('Finished!') === 'complete' &&
  G.voiceCommand('done with this one') === 'complete' && G.voiceCommand('I\'m done') === 'complete' &&
  G.voiceCommand('all done') === 'complete');
check('voice: "confirm" and "confirm the count" are the count confirm',
  G.voiceCommand('confirm') === 'confirm' && G.voiceCommand('confirm the count') === 'confirm');
check('voice: "start the shift" (or just "start") starts; "auto run" toggles auto-run',
  G.voiceCommand('start the shift') === 'start' && G.voiceCommand('start') === 'start' && G.voiceCommand('auto run') === 'auto');
check('voice: empty words are no command', G.voiceCommand('') === null && G.voiceCommand(null) === null && G.voiceCommand('   ') === null);
check('voice: a question about the work is no command', G.voiceCommand('what\'s in bin A-03?') === null);
check('voice: near-miss words do not fire — "completely" is not "complete"',
  G.voiceCommand('completely wrong pallet, take it back') === null && G.voiceCommand('done deal on the peaches') === null);
check('voice: a problem report is no command (the agent\'s problem path owns those words)',
  G.voiceCommand('the pallet is damaged') === null);

/* buildChain is a read: the state is untouched by dealing. */
check('dealing the chain changes nothing in the state',
  task(s, chain.taskA).toBinId === bin(s, chain.taskA && task(s, chain.taskA).toBinId).id &&
  s.records.length === 0 && !!pallet(s, chain.palletA));

/* ---------- directing + beginning ---------------------------------- */

var s2 = W.seed();
var begun = G.begin(s2);
check('begin deals and reports ok', begun.ok === true && !!begun.chain);
var c2 = begun.chain;
check('directing aims both putaway tasks at the chosen bins',
  task(s2, c2.taskA).toBinId === c2.binA && task(s2, c2.taskB).toBinId === c2.binB);
check('begin writes the start onto the record', s2.records.some(function (r) { return /Walk the shift started/.test(r.text); }));

/* ---------- working the shift, step by step ------------------------ */

check('step 1 (check in) performs and lands on the record',
  G.performStep(s2, c2, 0).ok === true && s2.records.some(function (r) { return /Checked in/.test(r.text); }));
check('the shift is not complete after one step', !task(s2, c2.taskA).status || task(s2, c2.taskA).status !== 'done');

check('step 2 (to the bay) performs; the pallet is still staged, now marked in the bay',
  G.performStep(s2, c2, 1).ok === true && !!pallet(s2, c2.palletA) && pallet(s2, c2.palletA).atBay === true);

var before3 = bin(s2, c2.binA).contents.length;
check('step 3 (put away) performs through the real putaway task',
  G.performStep(s2, c2, 2).ok === true && task(s2, c2.taskA).status === 'done');
check('the pallet left staging and its goods are in the destination bin',
  !pallet(s2, c2.palletA) && bin(s2, c2.binA).contents.length === before3 + 1 &&
  bin(s2, c2.binA).contents.some(function (c) { return c.desc === 'Canned peaches — cases' && c.qty === 15; }));

check('step 4 (second putaway) performs; the second pallet lands in the second bin',
  G.performStep(s2, c2, 3).ok === true && task(s2, c2.taskB).status === 'done' && !pallet(s2, c2.palletB) &&
  bin(s2, c2.binB).contents.some(function (c) { return c.qty > 0; }));

check('no count exists before step 5 — the shift cannot be complete early',
  s2.wms.counts.length === 0);
var armed = G.armCount(s2, c2);
check('step 5 arms a real cycle count for the first bin', armed.ok === true && !!task(s2, armed.taskId) && task(s2, armed.taskId).type === 'count');
check('once armed, the count gives the bin a reason to appear in the Receiving slice (\u201cCount here\u201d)',
  (function () {
    var sl = M.slice(s2, W, 'in');
    var bays = sl.stages.filter(function (st) { return st.key === 'bays'; })[0];
    var hit = null;
    bays.zones.forEach(function (z) { z.bins.forEach(function (b) { if (b.id === c2.binA) hit = b; }); });
    return !!hit && hit.why.indexOf('Count here') !== -1;
  })());
check('the count confirm shows what the counter sees (the pallet just put away)',
  G.countContents(s2, c2.binA).counts['Canned peaches — cases'] === 15);
var confirmed = G.confirmCount(s2, c2);
check('step 5 confirms: the count posts and matches, with no variance',
  confirmed.ok === true && s2.wms.counts.length === 1 && s2.wms.counts[0].binId === c2.binA &&
  s2.wms.counts[0].lines.every(function (l) { return l.variance === 0; }) && task(s2, armed.taskId).status === 'done');

/* ---------- a second shift on the worked building ------------------- */
/* Two pallets and the first game's bins are gone/used; the dealer
   must re-scan the state as it now stands. */
var chain2 = G.buildChain(s2);
check('a second chain is dealt from the worked state, with fresh pallets and bins',
  !!chain2 && chain2.palletA !== c2.palletA && chain2.binA !== c2.binA && chain2.binB !== c2.binA && chain2.binA !== chain2.binB &&
  bin(s2, chain2.binA).contents.length === 0 && bin(s2, chain2.binB).contents.length === 0);

/* ---------- buildings that cannot deal a shift ---------------------- */

var s3 = W.seed();
s3.staging.splice(1); /* one pallet left */
check('fewer than two workable pallets deals no chain', G.buildChain(s3) === null);
var s4 = W.seed();
s4.bins.forEach(function (b) { if (!b.contents.length) b.contents.push({ desc: 'Rice — bags', qty: 1 }); });
check('fewer than two empty bins deals no chain', G.buildChain(s4) === null);
check('begin on an undealable building refuses with a reason',
  (function () { var r = G.begin(s4); return r.ok === false && !!r.reason; })());

/* ---------- the module makes no network calls ----------------------- */

var src = fs.readFileSync(__dirname + '/../js/wms-game.js', 'utf8');
check('the game module contains no fetch, XHR or Worker URL (mutations ride the console\u2019s own act path)',
  !/fetch\s*\(|XMLHttpRequest|workers\.dev/.test(src));

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
