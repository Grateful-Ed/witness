/* converse-test.js — node, no dependencies.
   The conversational layer against the real engine and the seed
   world: the intent matcher, the worker's turn, the state summary,
   the problem report, and the manager's ask with fetch stubbed at
   the boundary (no live network in tests).
   Run: node test/converse-test.js   (exit 0 = all pass) */
'use strict';

var E = require('../js/engine.js');
var C = require('../js/converse.js');

var failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
  if (!cond) failures++;
}
function fresh() { var s = E.seedWorld(); E.generateTasks(s); return s; }
/* Put an unsigned task of the unit's zone in its hand — the engine's
   own three writes (work is assigned; converse never pulls). A receive
   or a load is a signed act and is left out here (the signature is
   pinned in test/converse-read-test.js). */
function give(world, u) {
  var t = world.tasks.filter(function (x) {
    return x.status === 'open' && x.type !== 'receive' && x.type !== 'load' && x.zone === u.zone && !E.blockedBy(world, x);
  })[0];
  t.status = 'assigned'; t.assignee = u.id; u.currentTaskId = t.id;
  return t;
}
function intentOf(t) { return C.matchIntent(t).intent; }
/* A model-formed match (the converse model step): the code's read with
   a model reading that agrees — what readWorker hands workerTurn on
   agreement. workerTurn refuses any match without one (note 40). */
function M(t) { var m = C.matchIntent(t); m.model = { intent: m.intent, startText: m.startText || '' }; return m; }

/* --- intent matcher ---------------------------------------------- */
check('William\'s line → done', intentOf("Hey Muse, what's up next? I just got done with my task.") === 'done');
check('"done" → done', intentOf('done') === 'done');
check('"finished that putaway" → done', intentOf('Finished that putaway') === 'done');
check('"all set" → done', intentOf('ok muse all set') === 'done');
check('"what\'s next" → next', intentOf("What's next?") === 'next');
check('"what is up next" → next', intentOf('what is up next') === 'next');
check('curly apostrophe "what’s next" → next', intentOf('what’s next') === 'next');
check('"what do I do" → next', intentOf('Hey Muse, what do I do') === 'next');
check('"there\'s a problem" → problem', intentOf("There's a problem, the shrink wrap is torn") === 'problem');
check('"pallet is damaged" → problem', intentOf('this pallet is damaged on the left side') === 'problem');
check('"bin is blocked" → problem', intentOf('A-03 is blocked by a forklift') === 'problem');
check('problem beats done', intentOf("I'm done but two cases are crushed") === 'problem');
check('"no problem, done" → done', intentOf('No problem, done') === 'done');
check('"not done yet" is not done', intentOf('not done yet') !== 'done');
check('"almost done" is not done', intentOf('almost done') !== 'done');
check('"I haven\'t finished, what\'s next" → next', intentOf("I haven't finished, what's next") === 'next');
check('"start" → start', intentOf('start') === 'start');
check('"start groceries putaway" → start', intentOf('start groceries putaway') === 'start');
check('"start the job" → start', intentOf('start the job') === 'start');
check('"begin" → start', intentOf('begin') === 'start');
check('"hey muse, start with the peanut butter" → start, words after kept',
  (function () { var m = C.matchIntent('hey muse, start with the peanut butter'); return m.intent === 'start' && m.startText === 'with the peanut butter'; })());
check('start does not swallow a problem', intentOf('start, the pallet is damaged') === 'problem');
check('small talk → unknown', intentOf('how about that game last night') === 'unknown');
check('empty → unknown', intentOf('') === 'unknown' && intentOf('   ') === 'unknown');
check('wake word alone → unknown', intentOf('Hey Muse') === 'unknown');
check('matcher keeps the words as heard', C.matchIntent('  Done.  ').heard === 'Done.');

/* --- worker turn: done asks; yes closes; nothing is pulled ---------- */
var s = fresh();
var marcus = E.unitById(s, 'u-marcus');
var first = give(s, marcus);
var askSnap = JSON.stringify(s);
var ask = C.workerTurn(E, s, marcus, M("what's up next? I just got done"));
check('confirm: done asks the question', JSON.stringify(ask.lines) ===
  JSON.stringify(['Mark "' + first.title + '" complete? Say yes to close it, or no to leave it open.']));
check('confirm: the spoken ask is the minimum form', JSON.stringify(ask.spoken) === JSON.stringify(['Mark it complete?']));
check('confirm: done mutates nothing — task open, state unchanged, acted false',
  first.status === 'assigned' && marcus.currentTaskId === first.id && JSON.stringify(s) === askSnap &&
  ask.acted === false && ask.closed === null && ask.staged && ask.staged.id === first.id);
check('confirm: the stage is never written into the saved state', JSON.stringify(s).indexOf('stage') === askSnap.indexOf('stage') &&
  !!C.pendingStage('u-marcus') && C.pendingStage('u-marcus').taskId === first.id);
var turn = C.workerTurn(E, s, marcus, M('yes'));
check('confirm: the stage clears once yes runs', C.pendingStage('u-marcus') === null);
check('done closes the task in hand', first.status === 'done' && turn.closed && turn.closed.id === first.id);
check('the close pulls nothing: no next task, empty hands (work is assigned, never pulled)',
  !turn.next && !marcus.currentTaskId && s.tasks.filter(function (t) { return t.assignee === 'u-marcus' && t.status === 'assigned'; }).length === 0);
check('the close says what closed, then that nothing is assigned',
  JSON.stringify(turn.lines) === JSON.stringify(['Closed: ' + first.title + '.', 'Nothing is assigned to you right now.']));
check('the close speaks the minimum: exactly "Nothing is assigned to you right now."',
  JSON.stringify(turn.spoken) === JSON.stringify(['Nothing is assigned to you right now.']));
give(s, marcus); /* the desk assigns Marcus his next task */

/* --- worker turn: next with a task in hand changes nothing -------- */
var held = marcus.currentTaskId;
var recs = s.records.length;
var t2 = C.workerTurn(E, s, marcus, M("what's next"));
check('"what\'s next" with a task in hand keeps it', marcus.currentTaskId === held && !t2.acted);
check('"what\'s next" with a task in hand completes nothing', s.records.length === recs);

/* --- worker turn: next with empty hands is a question, never a pull -- */
var dee = E.unitById(s, 'u-dee');
var snap3 = JSON.stringify(s);
var t3 = C.workerTurn(E, s, dee, M("what's next"));
check('"what\'s next" with empty hands answers exactly "Nothing is assigned to you right now."',
  JSON.stringify(t3.lines) === JSON.stringify(['Nothing is assigned to you right now.']));
check('"what\'s next" with empty hands moves nothing: no task changes hands', !t3.next && !t3.acted && !dee.currentTaskId && JSON.stringify(s) === snap3);

/* --- worker turn: unknown does nothing --------------------------- */
var snap = JSON.stringify(s);
var t4 = C.workerTurn(E, s, marcus, M('how about that game'));
check('unknown takes no action and changes no state', !t4.acted && JSON.stringify(s) === snap);

/* --- worker turn: problem notes, logs, completes nothing ---------- */
var taskBefore = E.taskById(s, marcus.currentTaskId);
var binsBefore = JSON.stringify(s.bins) + JSON.stringify(s.staging);
recs = s.records.length;
var t5 = C.workerTurn(E, s, marcus, M('Problem: two cases crushed on the bottom layer'));
check('problem pins the note to the task in hand',
  taskBefore.notes && taskBefore.notes.length === 1 &&
  taskBefore.notes[0].text === 'Problem: two cases crushed on the bottom layer' && taskBefore.notes[0].by === 'u-marcus');
check('problem leaves the task with the worker', taskBefore.status === 'assigned' && marcus.currentTaskId === taskBefore.id);
check('problem logs one record quoting the worker', s.records.length === recs + 1 &&
  s.records[s.records.length - 1].text.indexOf('two cases crushed') !== -1);
check('problem moves no freight', JSON.stringify(s.bins) + JSON.stringify(s.staging) === binsBefore);

var priya = E.unitById(s, 'u-priya');
recs = s.records.length;
var t6 = C.workerTurn(E, s, priya, M('there is a spill in aisle C'));
check('problem with empty hands still logs', t6.acted && s.records.length === recs + 1 && !priya.currentTaskId);
check('reportProblem refuses an empty note', E.reportProblem(s, 'u-priya', '   ') === null);

/* --- worker turn: done with empty hands pulls nothing ------------- */
var tommy = E.unitById(s, 'u-tommy');
var snap7 = JSON.stringify(s);
var t7 = C.workerTurn(E, s, tommy, M('done'));
check('done with empty hands closes nothing and pulls nothing', !t7.closed && !t7.next && !tommy.currentTaskId && JSON.stringify(s) === snap7);
check('done with empty hands says so, and that nothing is assigned',
  JSON.stringify(t7.lines) === JSON.stringify(['Nothing was in hand to close.', 'Nothing is assigned to you right now.']) &&
  JSON.stringify(t7.spoken) === JSON.stringify(['Nothing is assigned to you right now.']));

/* --- worker turn: start in the warehouse (no created job) pulls nothing */
var rosa = E.unitById(s, 'u-rosa');
var snap9 = JSON.stringify(s);
var t9 = C.workerTurn(E, s, rosa, M('start'));
check('"start" with no created job: "Nothing is assigned to you right now.", no task moves',
  !t9.next && !rosa.currentTaskId && JSON.stringify(t9.lines) === JSON.stringify(['Nothing is assigned to you right now.']) && JSON.stringify(s) === snap9);

/* --- worker turn: caught-up building ------------------------------ */
var empty = fresh();
empty.tasks.forEach(function (t) { t.status = 'done'; });
var jay = E.unitById(empty, 'u-jay');
var t8 = C.workerTurn(E, empty, jay, M("what's next"));
check('caught-up building: nothing is assigned, nothing moves', !t8.next && t8.lines[0] === 'Nothing is assigned to you right now.');

/* --- note 40: a match with no model reading runs nothing ---------- */
var ow40 = fresh(), om40 = E.unitById(ow40, 'u-marcus'), ot40 = give(ow40, om40);
C.workerTurn(E, ow40, om40, M('done')); /* staged */
var o40Snap = JSON.stringify(ow40);
var o40 = C.workerTurn(E, ow40, om40, C.matchIntent('yes')); /* the code's read alone */
check('no model reading: a code-only yes runs nothing — "AI is currently down."',
  JSON.stringify(o40.lines) === JSON.stringify(['AI is currently down.']) && !o40.acted && ot40.status === 'assigned' && JSON.stringify(ow40) === o40Snap);
check('no model reading: the pending stage died unrun', C.pendingStage('u-marcus') === null);
C.clearStages();

/* --- completion takes a confirmation: the next turn decides ------- */
C.clearStages();
function staged(world, unitId) {
  var u = E.unitById(world, unitId);
  var t = give(world, u);
  var a = C.workerTurn(E, world, u, M('done'));
  return { u: u, t: t, a: a };
}

/* every confirm word closes */
['yes', 'yeah', 'yep', 'confirm', 'do it', "that's right", 'go ahead', 'Hey Muse, yes'].forEach(function (w) {
  var cw = fresh(), st = staged(cw, 'u-marcus');
  var r = C.workerTurn(E, cw, st.u, M(w));
  check('confirm word "' + w + '" closes the staged task', st.t.status === 'done' && r.acted && r.closed && r.closed.id === st.t.id);
});

/* every deny word leaves it open, and the next turn is as if nothing was staged */
['no', 'nope', 'wait', 'cancel', 'not yet', 'never mind'].forEach(function (w) {
  var dw = fresh(), st = staged(dw, 'u-marcus');
  var snapD = JSON.stringify(dw);
  var r = C.workerTurn(E, dw, st.u, M(w));
  check('deny word "' + w + '" closes nothing and says Left open',
    !r.acted && st.t.status === 'assigned' && JSON.stringify(dw) === snapD &&
    JSON.stringify(r.lines) === JSON.stringify(['Left open: "' + st.t.title + '".']));
  check('after "' + w + '", no stage remains', C.pendingStage('u-marcus') === null);
});
var nw = fresh(), nst = staged(nw, 'u-marcus');
C.workerTurn(E, nw, nst.u, M('no'));
var nSnap = JSON.stringify(nw);
var nYes = C.workerTurn(E, nw, nst.u, M('yes'));
check('deny: a yes after the no acts on nothing (as if no stage ever existed)',
  !nYes.acted && nst.t.status === 'assigned' && JSON.stringify(nw) === nSnap && /no action taken/.test(nYes.lines.join(' ')));

/* a question as the next turn: stage cleared, no close, one added line */
var qw = fresh(), qst = staged(qw, 'u-marcus');
var q = C.workerTurn(E, qw, qst.u, M("what's next"));
check('question next: no close, the task stays in hand', qst.t.status === 'assigned' && qst.u.currentTaskId === qst.t.id && !q.closed);
check('question next: one added line notes the staged completion was left open',
  q.lines[0] === 'Left open: "' + qst.t.title + '" — not marked complete.' && q.lines[1].indexOf('Still yours: ') === 0);
check('question next: the stage is cleared', C.pendingStage('u-marcus') === null);
var q2 = C.workerTurn(E, qw, qst.u, M('yes'));
check('question next: a later yes closes nothing', !q2.acted && qst.t.status === 'assigned');

/* small talk as the next turn: today's unknown, plus the note */
var uw = fresh(), ust = staged(uw, 'u-marcus');
var uSnap = JSON.stringify(uw);
var ut = C.workerTurn(E, uw, ust.u, M('how about that game'));
check('unknown next: stage cleared, nothing acts, note added',
  !ut.acted && JSON.stringify(uw) === uSnap && ut.lines[0].indexOf('Left open: ') === 0 && /no action taken/.test(ut.lines.join(' ')) &&
  C.pendingStage('u-marcus') === null);

/* a problem as the next turn: filed as today, stage cleared, no close */
var pw = fresh(), pst = staged(pw, 'u-marcus');
var precs = pw.records.length;
var pr = C.workerTurn(E, pw, pst.u, M('no wait, two cases are crushed'));
check('problem next: filed on the task as today', pr.intent === 'problem' && pr.acted && pw.records.length === precs + 1 &&
  pst.t.notes && pst.t.notes[0].text === 'no wait, two cases are crushed');
check('problem next: no close, stage cleared', pst.t.status === 'assigned' && !pr.closed && C.pendingStage('u-marcus') === null);
check('problem next: lines are exactly today\'s problem lines', pr.lines[0] === 'Problem noted on your task. It\'s logged for the manager.');
check('problem beats confirm: "yes but the pallet is damaged" is a problem', (function () {
  var bw = fresh(); staged(bw, 'u-marcus');
  return C.matchIntent('yes but the pallet is damaged').intent === 'problem';
})());
C.clearStages();

/* a fresh completion word as the next turn: clears, then stages anew, with the note */
var fw = fresh(), fst = staged(fw, 'u-marcus');
var fr = C.workerTurn(E, fw, fst.u, M('done'));
check('done again: closes nothing, notes the old stage, asks again',
  fst.t.status === 'assigned' && !fr.acted && fr.lines[0].indexOf('Left open: ') === 0 &&
  /^Mark ".*" complete\?/.test(fr.lines[1]) && C.pendingStage('u-marcus').taskId === fst.t.id);
C.clearStages();

/* confirm with no stage pending: nothing acts */
var cw0 = fresh(), cm0 = E.unitById(cw0, 'u-marcus');
var ct0 = give(cw0, cm0);
var c0Snap = JSON.stringify(cw0);
['yes', 'no', 'go ahead', 'cancel'].forEach(function (w) {
  check('no stage pending: "' + w + '" is unknown', intentOf(w) === 'unknown');
  var r = C.workerTurn(E, cw0, cm0, M(w));
  check('no stage pending: "' + w + '" acts on nothing', !r.acted && JSON.stringify(cw0) === c0Snap && ct0.status === 'assigned');
});
check('no stage pending: a hand-built confirm acts on nothing', (function () {
  var r = C.workerTurn(E, cw0, cm0, { intent: 'confirm', heard: 'yes', model: { intent: 'confirm' } });
  return !r.acted && JSON.stringify(cw0) === c0Snap && /no action taken/.test(r.lines.join(' '));
})());

/* the stage belongs to its unit: someone else's yes closes nothing */
var ow = fresh(), ost = staged(ow, 'u-marcus');
var odee = E.unitById(ow, 'u-dee');
var oSnap = JSON.stringify(ow);
var or1 = C.workerTurn(E, ow, odee, M('yes'));
check('another unit\'s yes closes nothing of Marcus\'s stage', !or1.acted && JSON.stringify(ow) === oSnap && ost.t.status === 'assigned');
C.clearStages();

/* the staged task closed elsewhere first: honest refusal, stage cleared */
var ew = fresh(), est = staged(ew, 'u-marcus');
E.completeTask(ew, est.t.id); /* the desk closed it between the turns */
var eDone = ew.tasks.filter(function (t) { return t.status === 'done'; }).length;
var er = C.workerTurn(E, ew, est.u, M('yes'));
check('closed elsewhere: yes refuses honestly, closes nothing more',
  !er.acted && !er.closed && ew.tasks.filter(function (t) { return t.status === 'done'; }).length === eDone &&
  er.lines[0] === 'Can\'t close "' + est.t.title + '" — it is no longer the task in your hand. Nothing was closed.');
check('closed elsewhere: stage cleared', C.pendingStage('u-marcus') === null);

/* held by the time of the yes: today's held answer, stage cleared.
   The engine's hold check is stubbed to say "held" — converse's job is
   to ask it again at the yes and answer as today. */
var heldE = Object.create(E);
var heldNow = false;
heldE.blockedBy = function (st, t) { return heldNow ? 'Pallet P-9 is on hold — QA check.' : null; };
var hw = fresh(), hm = E.unitById(hw, 'u-marcus');
var ht = give(hw, hm);
C.workerTurn(heldE, hw, hm, M('done'));
heldNow = true;
var hSnap = JSON.stringify(hw);
var hr = C.workerTurn(heldE, hw, hm, M('yes'));
check('held by the time of the yes: today\'s held answer, nothing closes, stage cleared',
  !hr.acted && ht.status === 'assigned' && JSON.stringify(hw) === hSnap &&
  hr.lines[0] === 'Can\'t close "' + ht.title + '" — Pallet P-9 is on hold — QA check.' && C.pendingStage('u-marcus') === null);

/* counts would not balance by the time of the yes: today's refusal lines */
var balE = Object.create(E);
balE.completeTask = function () { return false; };
var bw2 = fresh(), bm2 = E.unitById(bw2, 'u-marcus');
var bt2 = give(bw2, bm2);
C.workerTurn(balE, bw2, bm2, M('done'));
var br2 = C.workerTurn(balE, bw2, bm2, M('yes'));
check('counts off at the yes: today\'s refusal lines, stage cleared',
  !br2.acted && br2.lines[0] === 'Could not close "' + bt2.title + '" — the counts would not balance.' && C.pendingStage('u-marcus') === null);

/* blocked task: never reaches the question, today's answer exactly */
var kw = fresh(), km = E.unitById(kw, 'u-marcus');
var kt = give(kw, km);
heldNow = true;
var kr = C.workerTurn(heldE, kw, km, M('done'));
check('blocked: done keeps today\'s answer, no question, no stage',
  !kr.staged && kr.lines[0] === 'Can\'t close "' + kt.title + '" — Pallet P-9 is on hold — QA check.' && kr.lines[1] === 'Leave it be. Tell your manager.' &&
  kr.lines.length === 2 && C.pendingStage('u-marcus') === null);

/* the negation guard still stages nothing */
var gw = fresh(), gm = E.unitById(gw, 'u-marcus');
give(gw, gm);
['not done yet', 'almost done', "I haven't finished"].forEach(function (w) {
  var r = C.workerTurn(E, gw, gm, M(w));
  check('negation: "' + w + '" stages nothing', !r.staged && C.pendingStage('u-marcus') === null);
});

/* a stage lives one utterance only — even one a caller hands elsewhere (glasses' free ask) */
var lw = fresh(), lst = staged(lw, 'u-marcus');
C.matchIntent('what am I looking at'); /* heard, routed to META, never reaches workerTurn */
check('one utterance later a yes is no longer a confirm', intentOf('yes') === 'unknown' && C.pendingStage('u-marcus') === null);
var lr = C.workerTurn(E, lw, lst.u, M('yes'));
check('a yes two utterances later closes nothing', !lr.acted && lst.t.status === 'assigned');
C.clearStages();

/* --- state summary carries the real numbers ----------------------- */
var p = fresh();
var stats = E.zoneStats(p);
var sum = C.buildStateSummary(E, p);
['A', 'B', 'C'].forEach(function (z) {
  var line = sum.text.split('\n').filter(function (l) { return l.indexOf('Zone ' + z + ':') === 0; })[0] || '';
  check('summary zone ' + z + ' line has its real waiting count (' + stats[z].pending + ')',
    line.indexOf(stats[z].pending + ' tasks waiting') !== -1);
  check('summary zone ' + z + ' line has its real labor count (' + stats[z].workersPresent + ')',
    line.indexOf(stats[z].workersPresent + ' labor units') !== -1);
  check('summary zone ' + z + ' line has its real bins in use (' + stats[z].binsOccupied + ' of 10)',
    line.indexOf(stats[z].binsOccupied + ' of 10 bins in use') !== -1);
});
var bn = E.bottleneck(p);
check('summary carries the engine\'s bottleneck call',
  !!bn && sum.text.indexOf('Zone ' + bn.zone + ' is backing up: ' + bn.pending + ' waiting') !== -1 &&
  sum.text.indexOf(bn.suggestion.unitName) !== -1);
check('summary names every labor unit', p.labor.every(function (u) { return sum.text.indexOf(u.name) !== -1; }));
check('summary lists expected inbound (IN-1002, 10 pallets, Zone B)',
  /IN-1002 — Inbound Door 3 \(Zone B\) — 10 pallets — expected today/.test(sum.text));
var zb = sum.facts.zones.filter(function (z) { return z.zone === 'B'; })[0];
check('Zone B shows 26 pallets expected, not yet arrived', zb.incomingPallets === 26);
check('summary lists every open order', p.outbound.every(function (o) { return sum.text.indexOf(o.id) !== -1; }));
check('summary is compact (under 4,000 chars)', sum.text.length < 4000);

/* summary follows the live state: complete a task, the count drops */
var u = E.unitById(p, 'u-marcus');
var tk = E.nextTaskFor(p, u);
E.completeTask(p, tk.id);
var after = C.buildStateSummary(E, p);
var za = after.facts.zones.filter(function (z) { return z.zone === tk.zone; })[0];
check('summary follows the live state after a completion', za.done === 1 && za.waiting === stats[tk.zone].pending - 1);

/* --- numbers check ------------------------------------------------- */
var nc = C.checkNumbers('Zone B: 7 waiting, 2 units. Pull Dee. That makes 9.', 'Zone B: 7 tasks waiting; 2 labor units');
check('numbers check sorts found and not-found', nc.found.join(',') === '7,2' && nc.missing.join(',') === '9');
check('numbers check treats 3 and 3.0 as the same', C.checkNumbers('load 3', 'load 3.0').missing.length === 0);

/* --- manager ask, fetch stubbed ------------------------------------- */
function stubFetch(replies) {
  var calls = [];
  var fn = function (url, init) {
    calls.push({ url: url, body: JSON.parse(init.body) });
    var r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (r === 'throw') return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve({ ok: r.status === 200, status: r.status, json: function () { return Promise.resolve(r.body); } });
  };
  fn.calls = calls;
  return fn;
}
function ok(text, finish) { return { status: 200, body: { choices: [{ message: { content: text }, finish_reason: finish || 'stop' }] } }; }
var Q = "What's a bottleneck that's supposed to be coming up here soon, and how can I move around labor to help fix it?";

var pending = [];
var f1 = stubFetch([ok('Zone B is backing up: 5 waiting, 2 labor units.')]);
pending.push(C.askManager({ engine: E, state: fresh(), question: Q, fetch: f1 }).then(function (res) {
  check('ask: one call when the first reply has words', f1.calls.length === 1 && res.attempts === 1);
  check('ask: hits the Worker /chat route', f1.calls[0].url === 'https://witness.e-william-harris96.workers.dev/chat');
  check('ask: asks for 6,000 max_tokens', f1.calls[0].body.max_tokens === 6000);
  var sys = f1.calls[0].body.messages[0];
  check('ask: system prompt binds to the supplied state',
    sys.role === 'system' && /ONLY from the BUILDING STATE/.test(sys.content) && /Never invent/.test(sys.content) &&
    /manager decides/.test(sys.content));
  var user = f1.calls[0].body.messages[1].content;
  check('ask: user message carries the state and the question',
    user.indexOf('BUILDING STATE') === 0 && user.indexOf(Q) !== -1);
  check('ask: returns the answer plus the numbers it was given',
    res.answer.indexOf('Zone B') === 0 && res.summary.text.indexOf('BUILDING STATE') === 0 && !!res.check);
}));

var f2 = stubFetch([ok(''), ok('Zone B. 5 waiting.')]);
pending.push(C.askManager({ engine: E, state: fresh(), question: Q, fetch: f2 }).then(function (res) {
  check('ask: empty first reply → one retry, then the answer', f2.calls.length === 2 && res.attempts === 2);
}));

var f3 = stubFetch([ok(null, 'length'), ok(null, 'length'), ok('never reached')]);
pending.push(C.askManager({ engine: E, state: fresh(), question: Q, fetch: f3 }).then(function () {
  check('ask: two empties → honest error', false);
}, function (e) {
  check('ask: two empties → honest error, exactly two calls',
    f3.calls.length === 2 && e.message === 'empty' && /empty twice/.test(e.userMessage) && /ran out of room/.test(e.userMessage));
}));

var f4 = stubFetch([{ status: 429, body: {} }]);
pending.push(C.askManager({ engine: E, state: fresh(), question: Q, fetch: f4 }).then(function () {
  check('ask: 429 → cap message', false);
}, function (e) {
  check('ask: 429 → cap message, no retry', f4.calls.length === 1 && e.message === 'cap');
}));

var f5 = stubFetch(['throw']);
pending.push(C.askManager({ engine: E, state: fresh(), question: Q, fetch: f5 }).then(function () {
  check('ask: network failure → honest error', false);
}, function (e) {
  check('ask: network failure → honest error', e.message === 'network' && /could not be reached/.test(e.userMessage));
}));

var f6 = stubFetch([ok('x')]);
pending.push(C.askManager({ engine: E, state: fresh(), question: '   ', fetch: f6 }).then(function () {
  check('ask: blank question refused', false);
}, function (e) {
  check('ask: blank question refused without a call', e.message === 'no-question' && f6.calls.length === 0);
}));

/* --- reply / transcript shapes ------------------------------------- */
check('replyText reads content parts', C.replyText({ choices: [{ message: { content: [{ type: 'text', text: 'Zone A' }] } }] }) === 'Zone A');
check('extractTranscript reads {transcript}', C.extractTranscript({ transcript: ' done ' }) === 'done');
check('extractTranscript rebuilds from turns', C.extractTranscript({ turns: [{ text: "what's" }, { text: 'next' }] }) === "what's next");
check('extractTranscript gives "" for nothing', C.extractTranscript({}) === '');

Promise.all(pending).then(function () {
  console.log('---');
  console.log(failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
});
