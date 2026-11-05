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
   Added with the conversation build: the widened fallback
   vocabulary; the four shift types, each dealt and worked end to
   end through the real tasks (replenishment included — and its
   honest refusal on a building with no reserve); and hear() driven
   with a stubbed talk path —
   META's intents work steps, her answers change nothing, a failed
   call falls back to the matcher, a refused act discards her words,
   and switching shift type mid-shift re-deals.
   Since the game-data split (job build step 1) every fixture here is
   the game's OWN building (W.seedGame(), data/game-world.js) — the
   practice dressing of the live seed is gone; the game's world
   carries its own stock.
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

var s = W.seedGame();
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
var board = M.html(W.seedGame(), W);
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

var s2 = W.seedGame();
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

var s3 = W.seedGame();
s3.staging.splice(1); /* one pallet left */
check('fewer than two workable pallets deals no chain', G.buildChain(s3) === null);
var s4 = W.seedGame();
s4.bins.forEach(function (b) { if (!b.contents.length) b.contents.push({ desc: 'Rice — bags', qty: 1 }); });
check('fewer than two empty bins deals no chain', G.buildChain(s4) === null);
check('begin on an undealable building refuses with a reason',
  (function () { var r = G.begin(s4); return r.ok === false && !!r.reason; })());

/* ---------- the module makes no network calls ----------------------- */

var src = fs.readFileSync(__dirname + '/../js/wms-game.js', 'utf8');
check('the game module contains no fetch, XHR or Worker URL (mutations ride the console\u2019s own act path)',
  !/fetch\s*\(|XMLHttpRequest|workers\.dev/.test(src));

/* ---------- the widened fallback vocabulary -------------------------- */
/* META is the primary hearer now; the matcher is the offline
   fallback. It gained the natural phrasings a worker actually says
   — "Complete task." is the one William said to the live game —
   and kept its strictness: the utterance must BE the command. */

check('voice: "Complete task." — the words said to the live game — is the completion command',
  G.voiceCommand('Complete task.') === 'complete');
check('voice: the natural completion family — complete this task, complete it, mark it complete, task done, finish it',
  G.voiceCommand('complete this task') === 'complete' && G.voiceCommand('complete it') === 'complete' &&
  G.voiceCommand('mark it complete') === 'complete' && G.voiceCommand('mark complete') === 'complete' &&
  G.voiceCommand('task done') === 'complete' && G.voiceCommand('done task') === 'complete' &&
  G.voiceCommand('that\u2019s done') === 'complete' && G.voiceCommand('finish it') === 'complete' &&
  G.voiceCommand('finished it') === 'complete');
check('voice: questions are still no command (META answers those — the matcher must not fire on them)',
  G.voiceCommand('can you tell me what tasks I need to do') === null &&
  G.voiceCommand('what are the scores of the game') === null);

/* ---------- the game's own building (data/game-world.js) ------------ */
/* Job build step 1 (briefs/claude-brief-game-data-split.md): the game
   plays on its OWN world, never the live seed. */

function qtyIn(state, id, desc) {
  var q = 0;
  bin(state, id).contents.forEach(function (c) { if (c.desc === desc) q += c.qty; });
  return q;
}
var GW = require('../data/game-world.js');
var gameSeed = W.seedGame();
var liveSeed = W.seed();
check('game world: a fresh game state is tagged world: "game"; the live seed is not',
  gameSeed.world === 'game' && W.isGame(gameSeed) && !W.isGame(liveSeed) && liveSeed.world !== 'game');
check('game world: its own trucks, orders and crew — no id shared with the live seed',
  gameSeed.inbound.every(function (x) { return !liveSeed.inbound.some(function (y) { return y.id === x.id; }); }) &&
  gameSeed.outbound.every(function (x) { return !liveSeed.outbound.some(function (y) { return y.id === x.id; }); }) &&
  gameSeed.wms.orders.every(function (x) { return !liveSeed.wms.orders.some(function (y) { return y.id === x.id; }); }) &&
  gameSeed.labor.every(function (x) { return !liveSeed.labor.some(function (y) { return y.id === x.id || y.name === x.name; }); }) &&
  gameSeed.wms.appointments.every(function (x) { return !liveSeed.wms.appointments.some(function (y) { return y.id === x.id; }); }));
check('game world: no live shipment, order or BOL leaks into the game state (the engine back-fill skips it)',
  gameSeed.inbound.length === GW.building.inbound.length &&
  !/IN-100\d|ORD-50\d|ORD-60\d|BRFL-|Witness Demo Warehouse|u-sam|u-marcus/.test(JSON.stringify(gameSeed)));
check('game world: its tasks are its own work, generated from its own building',
  gameSeed.tasks.length > 0 && gameSeed.tasks.some(function (t) { return t.id === 't-pick-ORD-701-B-04'; }) &&
  !gameSeed.tasks.some(function (t) { return /ORD-50\d/.test(t.id); }));
check('game world: seven bins stay empty for the putaways — A-07, A-10, B-06, B-10, C-03, C-06, C-10',
  gameSeed.bins.filter(function (b) { return !b.contents.length; }).map(function (b) { return b.id; }).join(',') === 'A-07,A-10,B-06,B-10,C-03,C-06,C-10');
check('game world: every bin line is well-formed for the engine (a description and a positive count)',
  gameSeed.bins.every(function (b) {
    return b.contents.every(function (c) { return typeof c.desc === 'string' && c.desc.length > 0 && typeof c.qty === 'number' && c.qty > 0; });
  }));
check('game world: seeding is a deep copy — playing never changes the game data module',
  (function () {
    var before = JSON.stringify(GW);
    var g = W.seedGame(); g.bins[0].contents[0].qty = 1; g.labor[0].name = 'x';
    return JSON.stringify(GW) === before;
  })());
check('game world: the practice dressing is gone from the WMS layer (no live-seed derivation left)',
  typeof W.dressPractice === 'undefined');

/* ---------- shift types: every role deals and works ------------------ */

function workAll(st, chain) {
  var okAll = true;
  for (var i = 0; i < chain.steps.length; i++) {
    var stp = chain.steps[i];
    if (stp.kind === 'count') {
      if (!G.armCount(st, chain, i).ok) okAll = false;
      if (!G.confirmCount(st, chain, i).ok) okAll = false;
    } else if (!G.performStep(st, chain, i).ok) okAll = false;
  }
  return okAll;
}

check('the shift types are the four roles', G.ROLES.map(function (r) { return r.id; }).join(',') === 'inbound,outbound,replenishment,counter');

var dIn = G.buildShift(W.seedGame(), 'inbound');
check('game building: the inbound chain deals into two of the bins the game world leaves empty',
  !!dIn && ['A-07', 'A-10', 'B-06', 'B-10', 'C-03', 'C-06', 'C-10'].indexOf(dIn.binA) !== -1 &&
  ['A-07', 'A-10', 'B-06', 'B-10', 'C-03', 'C-06', 'C-10'].indexOf(dIn.binB) !== -1 && dIn.binA !== dIn.binB);

var oState = W.seedGame();
var oBegin = G.begin(oState, 'outbound');
check('outbound: deals pick, pick, pack, load, count for the first allocated order (ORD-701)',
  oBegin.ok === true && oBegin.chain.role === 'outbound' && oBegin.chain.orderId === 'ORD-701' &&
  oBegin.chain.steps.map(function (x) { return x.kind; }).join(',') === 'pick,pick,pack,load,count');
var oBoard = M.html(W.seedGame(), W);
check('outbound: every step target is a cell the warehouse map itself renders',
  oBegin.chain.steps.every(function (x) {
    var re = new RegExp('data-place="' + x.target.place + '"[^>]*data-id="' + x.target.id.replace(/\//g, '\\/') + '"');
    return re.test(oBoard);
  }));
check('outbound: every step performs through the real tasks, and the order ships',
  workAll(oState, oBegin.chain) &&
  oState.outbound.filter(function (o) { return o.id === 'ORD-701'; })[0].status === 'shipped');

var rState = W.seedGame();
var rBegin = G.begin(rState, 'replenishment');
check('replenishment: deals pick, replenish, count, count (face A-08, reserve A-02, on the game building)',
  rBegin.ok === true && rBegin.chain.faceBin === 'A-08' && rBegin.chain.reserveBin === 'A-02' &&
  rBegin.chain.steps.map(function (x) { return x.kind; }).join(',') === 'pick,replen,count,count');
check('replenishment: every step performs — the system deals the replenishment after the pick, and the face is refilled from reserve',
  workAll(rState, rBegin.chain) && qtyIn(rState, 'A-08', 'Bottled water — cases') === 41 &&
  qtyIn(rState, 'A-02', 'Bottled water — cases') === 0 &&
  rState.tasks.some(function (t) { return t.type === 'replen' && t.status === 'done'; }));
check('replenishment: a game building with no reserve cannot deal it — the role refuses honestly',
  (function () { var nr = W.seedGame(); nr.bins.forEach(function (b) { if (b.id === 'A-02' || b.id === 'B-08' || b.id === 'C-07') b.contents = []; }); return G.buildShift(nr, 'replenishment') === null; })());

var cState = W.seedGame();
var cBegin = G.begin(cState, 'counter');
check('cycle counter: deals four spot counts, fullest bins first',
  cBegin.ok === true && cBegin.chain.steps.length === 4 &&
  cBegin.chain.steps.every(function (x) { return x.kind === 'count'; }) &&
  cBegin.chain.steps.map(function (x) { return x.bin; }).join(',') === 'B-04,A-08,B-02,C-02');
check('cycle counter: every count posts through the arm-and-confirm flow, no variance',
  workAll(cState, cBegin.chain) && cState.wms.counts.length === 4 &&
  cState.wms.counts.every(function (c) { return c.lines.every(function (l) { return l.variance === 0; }); }));

/* ---------- talking to META: hear() with a stubbed talk path --------- */
/* The controller is driven the way wms-ui.js drives it: afterRender
   hands in act (the console's mutation path — here, applied
   directly to a state, resolving with the function's own result,
   exactly what wms-ui's act returns) and talk (the /chat read —
   here, stubbed META replies). The panel is read back through
   panelHtml with a pass-through panel builder. */

function panelStub(title, body) { return body; }
function gameCtx(state, talk, actFn) {
  return {
    practice: true, base: 'dashboard', state: state, render: function () {},
    act: actFn || function (fn) { return Promise.resolve(fn(state)); },
    talk: talk || null
  };
}
function flush() { return new Promise(function (res) { setTimeout(res, 0); }); }

(async function () {
  /* the context META is given */
  var xState = W.seedGame();
  G.afterRender(gameCtx(xState, null));
  await G.ui('start');
  var vc = G.voiceContext();
  check('context: META is told the offer verbatim, the step, what remains, and where the worker stands',
    vc.offer === 'Check in at Inbound Dock 1.' && vc.step === 1 && vc.total === 5 &&
    vc.remaining.length === 4 && vc.pending === 'step' && vc.at === 'Inbound Dock 1' && vc.role === 'inbound');

  /* a complete intent works the step; her words are the response */
  var hState = W.seedGame();
  G.afterRender(gameCtx(hState, function () {
    return Promise.resolve({ intent: 'complete', say: 'Done — that pallet is away.' });
  }));
  await G.ui('start');
  G.hear('Complete task.');
  await flush(); await flush();
  var hHtml = G.panelHtml(panelStub, hState, true);
  check('hear: META\u2019s complete intent works the step (the check-in lands on the record)',
    hState.records.some(function (r) { return /Checked in/.test(r.text); }));
  check('hear: the panel quotes the words, what they did, and META\u2019s line beneath',
    hHtml.indexOf('Complete task.') !== -1 && hHtml.indexOf('task 1 of 5 worked') !== -1 &&
    hHtml.indexOf('META: &ldquo;Done — that pallet is away.&rdquo;') !== -1);

  /* an answer changes nothing */
  var aState = W.seedGame();
  G.afterRender(gameCtx(aState, function () {
    return Promise.resolve({ intent: 'answer', say: 'Right now: check in at Inbound Dock 1. Then the pallet move, both putaways, and the spot count.' });
  }));
  await G.ui('start');
  var aSnap = JSON.stringify(aState.tasks.map(function (t) { return t.status; })) + '|' + aState.staging.length + '|' + aState.records.length;
  G.hear('Can you tell me what tasks I need to do?');
  await flush(); await flush();
  var aHtml = G.panelHtml(panelStub, aState, true);
  check('hear: a question is answered from the context and nothing is worked',
    JSON.stringify(aState.tasks.map(function (t) { return t.status; })) + '|' + aState.staging.length + '|' + aState.records.length === aSnap &&
    aHtml.indexOf('Right now: check in at Inbound Dock 1.') !== -1 && aHtml.indexOf('Task 1 of 5') !== -1);

  /* a problem report changes nothing */
  var pState = W.seedGame();
  G.afterRender(gameCtx(pState, function () {
    return Promise.resolve({ intent: 'answer', say: 'Set that one aside and flag it for the lead — I am not marking it done.' });
  }));
  await G.ui('start');
  var pSnap = JSON.stringify(pState.tasks.map(function (t) { return t.status; })) + '|' + pState.records.length;
  G.hear('This pallet is damaged, the wrap is torn.');
  await flush(); await flush();
  var pHtml = G.panelHtml(panelStub, pState, true);
  check('hear: a problem report is acknowledged, never completed — the shift is unchanged',
    JSON.stringify(pState.tasks.map(function (t) { return t.status; })) + '|' + pState.records.length === pSnap &&
    pHtml.indexOf('flag it for the lead') !== -1 && pHtml.indexOf('Task 1 of 5') !== -1);

  /* the /chat call fails → the matcher fallback hears "Complete task." */
  var fState = W.seedGame();
  G.afterRender(gameCtx(fState, function () { return Promise.reject(new Error('network')); }));
  await G.ui('start');
  G.hear('Complete task.');
  await flush(); await flush();
  var fHtml = G.panelHtml(panelStub, fState, true);
  check('hear: when META cannot be reached, the fallback matcher completes the step — and no META line is shown',
    fState.records.some(function (r) { return /Checked in/.test(r.text); }) &&
    fHtml.indexOf('task 1 of 5 worked') !== -1 && fHtml.indexOf('META:') === -1);

  /* the act refuses → her words are discarded for the honest note */
  var dState = W.seedGame();
  var dCalls = 0;
  G.afterRender(gameCtx(dState, function () {
    return Promise.resolve({ intent: 'complete', say: 'All wrapped up here.' });
  }, function (fn) {
    dCalls++;
    if (dCalls === 1) return Promise.resolve(fn(dState));   /* the begin goes through */
    return Promise.resolve({ ok: false, reason: 'refused' });
  }));
  await G.ui('start');
  G.hear('Complete task.');
  await flush(); await flush();
  var dHtml = G.panelHtml(panelStub, dState, true);
  check('hear: a refused act discards META\u2019s words — the panel shows the honest failure note instead',
    dHtml.indexOf('that step did not go through — nothing was done.') !== -1 &&
    dHtml.indexOf('All wrapped up here.') === -1 && dHtml.indexOf('Task 1 of 5') !== -1);

  /* switching shift type mid-shift re-deals and says so */
  var sState = W.seedGame();
  G.afterRender(gameCtx(sState, null));
  await G.ui('start');
  await G.ui('doit');   /* work the inbound check-in for real */
  await G.ui('role', 'outbound');
  var sHtml = G.panelHtml(panelStub, sState, true);
  check('switching: a fresh outbound chain is dealt, the finished inbound work stays on the record, and the panel says plainly what happened',
    G.voiceContext().role === 'outbound' && G.voiceContext().step === 1 &&
    sState.records.some(function (r) { return /Checked in/.test(r.text); }) &&
    sHtml.indexOf('Shift type changed to Outbound loader') !== -1 &&
    sHtml.indexOf('the tasks it finished stay on the record') !== -1);

  /* ---------- demo polish item 1: after a finished shift, the next
     start names the REQUESTED shift (briefs/claude-brief-demo-polish.md).
     A Cycle counter shift is worked to its end, then another type is
     picked and begun — by the button and by voice. The start line,
     META's context, the panel and the voice note all name the shift
     that was asked for; where the building cannot deal it, the line
     says so plainly, tells the player to reload the practice copy,
     and reads "an Inbound dock worker". */

  function primaryRole(html) { var m = /btn primary" data-act="game-role" data-role="(\w+)"/.exec(html); return m ? m[1] : null; }
  async function workToEnd() {
    for (var k = 0; k < 40; k++) {
      var vc = G.voiceContext();
      if (vc.done) return true;
      if (vc.pending === 'count') await G.ui('confirm');
      else { G.ui('doit'); await flush(); await flush(); }
    }
    return false;
  }
  function polishCtx(state, toasts, talk) {
    return gameCtx(state, talk || null, function (fn) {
      var r = fn(state);
      if (r && r.ok === false) toasts.push(r.reason);
      return Promise.resolve(r);
    });
  }
  function echoMeta(c) { return Promise.resolve({ intent: 'start', say: 'Starting your ' + c.roleLabel + ' shift.' }); }

  /* (a) the button path: a finished counter shift, then Outbound */
  G.reset();
  var nState = W.seedGame(), nToasts = [];
  G.afterRender(polishCtx(nState, nToasts));
  await G.ui('role', 'counter');
  await G.ui('start');
  var nDone = await workToEnd();
  await G.ui('role', 'outbound');
  var nPicked = G.panelHtml(panelStub, nState, true);
  check('polish: once a shift is finished, picking another type selects it — the panel and META’s context name the picked shift, not the finished one',
    nDone && primaryRole(nPicked) === 'outbound' && G.voiceContext().role === 'outbound' &&
    G.voiceContext().roleLabel === 'Outbound loader' && G.voiceContext().done === true &&
    nPicked.indexOf('Shift complete — 4 tasks') !== -1);
  var nR = await G.ui('start');
  var nLast = nState.records[nState.records.length - 1].text;
  check('polish: begin() after a finished Cycle counter shift deals the REQUESTED Outbound shift — the start line names it',
    nR && nR.ok === true && nR.chain.role === 'outbound' &&
    nLast === 'Walk the shift started — Outbound loader, 5 tasks on a practice copy.' &&
    !/Cycle counter/.test(nLast) && nToasts.length === 0);
  check('polish: the panel then offers the Outbound shift’s first task',
    G.voiceContext().role === 'outbound' && G.voiceContext().step === 1 &&
    primaryRole(G.panelHtml(panelStub, nState, true)) === 'outbound');

  /* (b) the voice path: META is told the picked shift, and the note
     names the shift that really started */
  G.reset();
  var vState = W.seedGame(), vToasts = [];
  G.afterRender(polishCtx(vState, vToasts, echoMeta));
  await G.ui('role', 'counter');
  await G.ui('start');
  await workToEnd();
  await G.ui('role', 'outbound');
  G.hear('Start the shift.');
  await flush(); await flush(); await flush();
  var vHtml = G.panelHtml(panelStub, vState, true);
  check('polish: by voice after a finished shift, META is told the picked shift and the note names it — never the finished one',
    vHtml.indexOf('Outbound loader shift started — the first task is offered below.') !== -1 &&
    vHtml.indexOf('META: &ldquo;Starting your Outbound loader shift.&rdquo;') !== -1 &&
    vHtml.indexOf('Cycle counter shift') === -1 &&
    vState.records[vState.records.length - 1].text === 'Walk the shift started — Outbound loader, 5 tasks on a practice copy.');

  /* (c) the cannot-deal line: every bin stocked, so a counter shift
     deals and an Inbound one cannot (no empty bins to put away to) */
  function stockedState() {
    var st = W.seedGame();
    st.bins.forEach(function (b) { if (!b.contents.length) b.contents.push({ desc: 'Rice — bags', qty: 1 }); });
    return st;
  }
  var CANNOT_INBOUND = 'This practice building cannot deal an Inbound dock worker shift — its work for that shift is spent. ' +
    'Reload the practice copy for a fresh building, or try another shift type.';
  G.reset();
  var kState = stockedState(), kToasts = [];
  G.afterRender(polishCtx(kState, kToasts));
  await G.ui('role', 'counter');
  await G.ui('start');
  var kDone = await workToEnd();
  var kRecs = kState.records.length;
  await G.ui('role', 'inbound');
  var kR = await G.ui('start');
  var kHtml = G.panelHtml(panelStub, kState, true);
  check('polish: begin() after a finished shift for a role this building cannot deal refuses with the requested role named, grammatical, and the reload told',
    kDone && kR && kR.ok === false && kR.reason === CANNOT_INBOUND &&
    kToasts.length === 1 && kToasts[0] === CANNOT_INBOUND && kState.records.length === kRecs);
  check('polish: the refused start never names the finished shift as starting — the panel keeps its summary, with Inbound the picked type',
    kHtml.indexOf('Shift complete') !== -1 && primaryRole(kHtml) === 'inbound' &&
    !/Walk the shift started/.test(kState.records[kState.records.length - 1].text));

  G.reset();
  var kvState = stockedState();
  G.afterRender(polishCtx(kvState, []));
  await G.ui('role', 'counter');
  await G.ui('start');
  await workToEnd();
  await G.ui('role', 'inbound');
  G.hear('Start the shift.');
  await flush(); await flush(); await flush();
  var kvHtml = G.panelHtml(panelStub, kvState, true);
  check('polish: by voice, the refused start says the cannot-deal line plainly — no "shift started", no finished shift named',
    kvHtml.indexOf(CANNOT_INBOUND + ' Nothing was done.') !== -1 &&
    kvHtml.indexOf('shift started') === -1 && kvHtml.indexOf('Cycle counter shift') === -1);

  check('polish: the article agrees with every role label in the cannot-deal line',
    G.begin(stockedState(), 'inbound').reason.indexOf('cannot deal an Inbound dock worker shift') !== -1 &&
    G.begin((function () { var nr = W.seedGame(); nr.bins.forEach(function (b) { if (b.id === 'A-02' || b.id === 'B-08' || b.id === 'C-07') b.contents = []; }); return nr; })(), 'replenishment').reason.indexOf('cannot deal a Replenishment shift') !== -1);
  G.reset();
  G.afterRender(polishCtx(W.seedGame(), []));
  await G.ui('role', 'outbound');
  check('polish: the panel intro reads "An Outbound loader shift" (article agrees)',
    G.panelHtml(panelStub, W.seedGame(), true).indexOf('<p>An Outbound loader shift on the map below.') !== -1);
  check('polish: no line in the game module builds "a Inbound" / "a Outbound"',
    !/\ba ' \+ roleLabel|\bA ' \+ esc\(roleLabel/.test(src));

  console.log('\n' + passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})();
