/* gate-test.js — node, no dependencies.
   The gate (js/gate.js, briefs/claude-brief-gate.md): one gated act
   path for the agent doors — console voice, converse, game voice.
   Pins:
     - the six checks, in order: the act exists / params cross-checked
       (a disagreement is a clarification, nothing recorded) and the
       outage rule; the signature class (refused with the desk guidance
       on each door, and at run time — a forged stage is refused); the
       confirmation law (unconfirmed acts only stage, state untouched);
       ownership; the run through the engine (refusals said honestly);
       one attribution writer (who, via, the words heard);
     - the policy object holds today's law in one place;
     - the gate is stateless (no stage store of its own);
     - the game door lands only in the game world: the live state is
       byte-identical after any game exchange;
     - converse's acts run through the gate with today's behavior
       (William's ruling for this build, 2026-11-06).
   Run: node test/gate-test.js   (exit 0 = all pass) */
'use strict';

var E = require('../js/engine.js');
var W = require('../js/wms.js');
var Gt = require('../js/gate.js');
var V = require('../js/wms-voice.js');
var C = require('../js/converse.js');
var G = require('../js/wms-game.js');

var failures = 0, passes = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (cond) passes++; else failures++; }

var t0 = Date.parse('2026-11-06T08:00:00Z'), tick = 0;
W.now = function () { return new Date(t0 + 60000 * (tick++)).toISOString(); };

function snap(s) { return JSON.stringify(s); }
var MARCUS = 'u-marcus', GRACE = 'u-grace', PRIYA = 'u-priya';
function voiceAct(s, who, intent, target, params, confirmed) {
  return Gt.act(s, { who: who, via: 'voice', intent: intent, target: target, params: params, confirmed: confirmed });
}
function plainWords(r) { return typeof r === 'string' && r.length > 10 && !/[{}<>]|undefined|null|NaN/.test(r); }

/* ---------- the policy: one object, today's law ------------------- */
var P = Gt.POLICY;
check('policy: one object holds the signature and confirmation rules',
  P.signedTaskTypes.receive === 'post-receiving' && P.signedTaskTypes.load === 'confirm-load' &&
  P.confirm.voice.complete === true && P.confirm.voice.flag === true && P.confirm.converse.complete === true);
check('policy: the outage line is exactly "AI is currently down."', Gt.OUTAGE === 'AI is currently down.' && P.outage === Gt.OUTAGE);
check('policy: model-formed acts on console voice and the game; converse waits for its own brief (the ruling, named)',
  P.modelFormed.voice === true && P.modelFormed.game === true && P.modelFormed.converse === false);

/* ---------- check 1: unknown acts, the outage, the cross-check ---- */
var s = W.seed();
W.nextFor(s, PRIYA);
var cur = W.currentOf(s, PRIYA);
var before = snap(s);
var r = voiceAct(s, PRIYA, 'teleport', cur.id, { model: true, words: 'teleport it' });
check('check 1: an act the engine has no path for is refused as unknown, in plain words, nothing changed',
  r.ok === false && r.unknown === true && plainWords(r.reason) && snap(s) === before);
r = voiceAct(s, PRIYA, 'complete', cur.id, { words: 'done', claim: { qty: null, bin: null, cartons: null } });
check('check 1 (note 40): an act that is not model-formed is the outage — "AI is currently down.", nothing staged or run',
  r.ok === false && r.outage === true && r.reason === 'AI is currently down.' && snap(s) === before);
r = voiceAct(s, PRIYA, 'complete', cur.id, { model: true, words: 'done with this one', claim: { qty: null, bin: null, cartons: null } });
check('check 1: a claim the parser reads differently is a clarification — the partial-or-full ask — and nothing is recorded',
  r.ok === false && r.clarify === 'Is this a partial or full completion?' && !r.reason && snap(s) === before);
r = voiceAct(s, PRIYA, 'complete', cur.id, { model: true, words: 'picked ' + cur.qty, claim: { qty: cur.qty, bin: null, cartons: null } });
check('check 1 → 3: claim and parser agree → staged (the confirmation law), with the plan, and the state is byte-identical',
  r.ok === true && r.result.staged === true && r.result.act.plan.qty === cur.qty && snap(s) === before);

/* ---------- check 3: confirmed runs; check 6: attribution ---------- */
var mark = s.records.length;
var words = 'picked ' + cur.qty + ' | yes';
r = voiceAct(s, PRIYA, 'complete', cur.id, { model: true, words: words, title: cur.title, plan: { qty: cur.qty } }, true);
var t = E.taskById(s, cur.id);
var newRecs = s.records.slice(mark);
check('check 5: the confirmed act runs through the engine (W.complete) — the task is done',
  r.ok === true && t.status === 'done' && /picked|Picked/.test(r.result.text));
check('check 6: one attribution shape — the task carries via "voice" and the exact words heard',
  t.via === 'voice' && t.heard === words);
check('check 6: every record the act wrote carries via, the words heard, and who',
  newRecs.length > 0 && newRecs.every(function (x) { return x.via === 'voice' && x.heard === words && x.by === PRIYA; }));

/* ---------- check 4: ownership ------------------------------------- */
s = W.seed();
W.nextFor(s, PRIYA);
cur = W.currentOf(s, PRIYA);
before = snap(s);
r = voiceAct(s, GRACE, 'complete', cur.id, { model: true, words: 'done', title: cur.title, plan: { qty: cur.qty } }, true);
check('check 4: an act lands on a task only for its holder — another worker\'s yes is refused, nothing changed',
  r.ok === false && /no longer in your hands/.test(r.reason) && snap(s) === before);

/* ---------- check 2: signature class on each agent door ------------ */
/* console voice: a receiving in hand */
s = W.seed();
W.nextFor(s, MARCUS);
cur = W.currentOf(s, MARCUS);
before = snap(s);
r = voiceAct(s, MARCUS, 'complete', cur.id, { model: true, words: 'done', claim: { qty: null, bin: null, cartons: null } });
check('signature (voice): a receiving is refused with the guidance to the Receiving screen, nothing staged',
  cur.type === 'receive' && r.ok === false && r.signed === true && /signed act/.test(r.reason) &&
  r.guide && r.guide.href === '#/receiving' && snap(s) === before);
r = voiceAct(s, MARCUS, 'complete', cur.id, { model: true, words: 'yes', title: cur.title, plan: {} }, true);
check('signature (voice): a forged confirmed stage on the receiving is refused at run time, nothing changed',
  r.ok === false && /signed act/.test(r.reason) && snap(s) === before);
r = voiceAct(s, MARCUS, 'post-receiving', null, { model: true, words: 'post it' });
check('signature (voice): the signed intent itself is refused with the desk guidance', r.ok === false && r.signed && r.guide && snap(s) === before);
/* console voice: a load in hand, through the door's own run */
s = W.seed();
W.complete(s, 't-pick-ORD-502-C-02', { by: GRACE, qty: 8 });
W.complete(s, 't-pack-ORD-502', { by: GRACE });
W.nextFor(s, GRACE);
cur = W.currentOf(s, GRACE);
before = snap(s);
var vr = V.run(s, { kind: 'complete', unitId: GRACE, taskId: cur.id, title: cur.title, words: 'yes', plan: {} });
check('signature (voice door): a forged staged load is refused at run time through the door, nothing changed',
  cur.type === 'load' && vr.ok === false && /signed act/.test(vr.reason) && snap(s) === before);

/* converse: the signed intents through the gate */
var es = E.seedWorld(); E.generateTasks(es);
var marcus = E.unitById(es, 'u-marcus');
E.nextTaskFor(es, marcus);
before = snap(es);
r = Gt.act(es, { who: 'u-marcus', via: 'converse', intent: 'confirm-load', params: { words: 'load it' } }, { engine: E });
check('signature (converse): confirming a load is refused with the desk guidance, nothing changed',
  r.ok === false && r.signed && /desk screen/.test(r.reason) && snap(es) === before);
r = Gt.act(es, { who: 'u-marcus', via: 'converse', intent: 'post-receiving', params: { words: 'post it' } }, { engine: E });
check('signature (converse): posting a receiving is refused with the guidance to the Receiving screen',
  r.ok === false && r.signed && /Receiving screen/.test(r.reason) && snap(es) === before);
/* converse: a forged confirmed close of a task not in hand */
var other = es.tasks.filter(function (x) { return x.status === 'open'; })[0];
r = Gt.act(es, { who: 'u-marcus', via: 'converse', intent: 'complete', target: other.id, params: { words: 'yes' }, confirmed: true }, { engine: E });
check('converse: a forged confirmed close of a task not in hand is refused at run time, nothing changed',
  r.ok === false && /no longer the task in your hand/.test(r.reason) && snap(es) === before);

/* game: a load step by voice is refused; clicks are untouched */
function outboundChain(gs) { return G.buildShift(gs, 'outbound'); }
var gs = W.seedGame();
var ch = outboundChain(gs);
var li = ch ? ch.steps.map(function (x) { return x.kind; }).indexOf('load') : -1;
before = snap(gs);
r = Gt.act(gs, { who: null, via: 'game', intent: 'step', target: li, params: { model: true, chain: ch, words: 'load it' } },
  { engine: { begin: G.begin, performStep: G.performStep, armCount: G.armCount, confirmCount: G.confirmCount } });
check('signature (game): a load step by voice is refused — voice never signs — nothing changed',
  li !== -1 && r.ok === false && r.signed && /signed act/.test(r.reason) && snap(gs) === before);

/* ---------- the game door lands only in the game world ------------ */
var live = W.seed();
var liveBefore = snap(live);
var STEPS = { begin: G.begin, performStep: G.performStep, armCount: G.armCount, confirmCount: G.confirmCount };
r = Gt.act(live, { who: null, via: 'game', intent: 'start', params: { model: true, role: 'inbound', words: 'start the shift' } }, { engine: STEPS });
check('game: an act from the game door on the live record is refused, and the live state is byte-identical',
  r.ok === false && /practice building/.test(r.reason) && snap(live) === liveBefore);
gs = W.seedGame();
r = Gt.act(gs, { who: null, via: 'game', intent: 'start', params: { model: true, role: 'inbound', words: 'start the shift' } }, { engine: STEPS });
var chain = r.ok ? r.result.chain : null;
mark = gs.records.length;
var g2 = chain ? Gt.act(gs, { who: null, via: 'game', intent: 'step', target: 0, params: { model: true, chain: chain, words: 'Complete task.' } }, { engine: STEPS }) : null;
var gRecs = gs.records.slice(mark);
check('game: a start and a step land in the game world through the gate',
  r.ok === true && !!chain && g2 && g2.ok === true && gs.records.some(function (x) { return /Checked in/.test(x.text); }));
check('game: attribution is the same shape — via "game" and the words heard on every record the act wrote',
  gRecs.length > 0 && gRecs.every(function (x) { return x.via === 'game' && x.heard === 'Complete task.'; }));
r = Gt.act(gs, { who: null, via: 'game', intent: 'step', target: 1, params: { chain: chain, words: 'Complete task.' } }, { engine: STEPS });
check('game (note 40): an act without the model is the outage, nothing worked', r.ok === false && r.outage === true && r.reason === 'AI is currently down.');

/* ---------- converse: through the gate, today's behavior ---------- */
es = E.seedWorld(); E.generateTasks(es);
marcus = E.unitById(es, 'u-marcus');
var first = E.nextTaskFor(es, marcus);
C.clearStages();
before = snap(es);
var ask = C.workerTurn(E, es, marcus, C.matchIntent('done'));
check('converse: "done" still stages and asks; the state is byte-identical (the gate staged, the door holds the stage)',
  ask.acted === false && ask.staged && ask.staged.id === first.id && snap(es) === before);
var yes = C.workerTurn(E, es, marcus, C.matchIntent('yes'));
check('converse: the yes closes through the gate and the close is attributed — via "converse", the words heard',
  first.status === 'done' && yes.closed && first.via === 'converse' && first.heard === 'yes' &&
  es.records.some(function (x) { return x.via === 'converse' && x.heard === 'yes'; }));
var pr = C.workerTurn(E, es, marcus, C.matchIntent('this pallet is damaged'));
check('converse: a problem is noted through the gate, attributed with the words heard',
  pr.acted === true && es.records.some(function (x) { return x.via === 'converse' && x.heard === 'this pallet is damaged'; }));

/* ---------- the gate is stateless ---------------------------------- */
s = W.seed();
W.nextFor(s, PRIYA);
cur = W.currentOf(s, PRIYA);
var a1 = voiceAct(s, PRIYA, 'complete', cur.id, { model: true, words: 'picked ' + cur.qty, claim: { qty: cur.qty, bin: null, cartons: null } });
var keys = Object.keys(Gt).sort().join(',');
before = snap(s);
var a2 = voiceAct(s, PRIYA, 'complete', cur.id, { model: true, words: 'picked ' + cur.qty, claim: { qty: cur.qty, bin: null, cartons: null } });
check('stateless: staging twice gives the same answer, holds nothing, and the gate keeps no stage store',
  a1.ok && a2.ok && JSON.stringify(a1) === JSON.stringify(a2) && snap(s) === before &&
  !/stage/i.test(keys));

/* ---------- console voice: no envelope, no act -------------------- */
s = W.seed();
W.nextFor(s, PRIYA);
before = snap(s);
var d = V.decide(s, PRIYA, 'done', null, null);
check('voice door: with no model envelope nothing stages or runs — "AI is currently down."', d.say === 'AI is currently down.' && !d.stage && !d.run && snap(s) === before);

/* ---------- refusals are plain words ------------------------------- */
var refusals = [
  Gt.act(null, { via: 'voice' }),
  Gt.act(W.seed(), { via: 'fax' }),
  voiceAct(W.seed(), PRIYA, 'flag', null, { model: true, words: '   ' })
];
check('refusals are plain words a worker can act on (no codes, no blanks)',
  refusals.every(function (x) { return x.ok === false && plainWords(x.reason); }));

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
