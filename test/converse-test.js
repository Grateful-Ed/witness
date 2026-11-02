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
function intentOf(t) { return C.matchIntent(t).intent; }

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
check('small talk → unknown', intentOf('how about that game last night') === 'unknown');
check('empty → unknown', intentOf('') === 'unknown' && intentOf('   ') === 'unknown');
check('wake word alone → unknown', intentOf('Hey Muse') === 'unknown');
check('matcher keeps the words as heard', C.matchIntent('  Done.  ').heard === 'Done.');

/* --- worker turn: done closes + pulls ---------------------------- */
var s = fresh();
var marcus = E.unitById(s, 'u-marcus');
var first = E.nextTaskFor(s, marcus);
var turn = C.workerTurn(E, s, marcus, C.matchIntent("what's up next? I just got done"));
check('done closes the task in hand', first.status === 'done' && turn.closed && turn.closed.id === first.id);
check('done pulls the next task to the same unit',
  !!turn.next && turn.next.assignee === 'u-marcus' && marcus.currentTaskId === turn.next.id);
check('done says what closed and what is next',
  turn.lines.some(function (l) { return l.indexOf('Closed: ') === 0; }) &&
  turn.lines.some(function (l) { return l.indexOf('Next: ') === 0; }));

/* --- worker turn: next with a task in hand changes nothing -------- */
var held = marcus.currentTaskId;
var recs = s.records.length;
var t2 = C.workerTurn(E, s, marcus, C.matchIntent("what's next"));
check('"what\'s next" with a task in hand keeps it', marcus.currentTaskId === held && !t2.acted);
check('"what\'s next" with a task in hand completes nothing', s.records.length === recs);

/* --- worker turn: next with empty hands pulls one ----------------- */
var dee = E.unitById(s, 'u-dee');
var t3 = C.workerTurn(E, s, dee, C.matchIntent("what's next"));
check('"what\'s next" with empty hands assigns work', !!t3.next && dee.currentTaskId === t3.next.id);

/* --- worker turn: unknown does nothing --------------------------- */
var snap = JSON.stringify(s);
var t4 = C.workerTurn(E, s, marcus, C.matchIntent('how about that game'));
check('unknown takes no action and changes no state', !t4.acted && JSON.stringify(s) === snap);

/* --- worker turn: problem notes, logs, completes nothing ---------- */
var taskBefore = E.taskById(s, marcus.currentTaskId);
var binsBefore = JSON.stringify(s.bins) + JSON.stringify(s.staging);
recs = s.records.length;
var t5 = C.workerTurn(E, s, marcus, C.matchIntent('Problem: two cases crushed on the bottom layer'));
check('problem pins the note to the task in hand',
  taskBefore.notes && taskBefore.notes.length === 1 &&
  taskBefore.notes[0].text === 'Problem: two cases crushed on the bottom layer' && taskBefore.notes[0].by === 'u-marcus');
check('problem leaves the task with the worker', taskBefore.status === 'assigned' && marcus.currentTaskId === taskBefore.id);
check('problem logs one record quoting the worker', s.records.length === recs + 1 &&
  s.records[s.records.length - 1].text.indexOf('two cases crushed') !== -1);
check('problem moves no freight', JSON.stringify(s.bins) + JSON.stringify(s.staging) === binsBefore);

var priya = E.unitById(s, 'u-priya');
recs = s.records.length;
var t6 = C.workerTurn(E, s, priya, C.matchIntent('there is a spill in aisle C'));
check('problem with empty hands still logs', t6.acted && s.records.length === recs + 1 && !priya.currentTaskId);
check('reportProblem refuses an empty note', E.reportProblem(s, 'u-priya', '   ') === null);

/* --- worker turn: done with empty hands just pulls ---------------- */
var tommy = E.unitById(s, 'u-tommy');
var t7 = C.workerTurn(E, s, tommy, C.matchIntent('done'));
check('done with empty hands closes nothing, pulls next', !t7.closed && !!t7.next && tommy.currentTaskId === t7.next.id);

/* --- worker turn: caught-up building ------------------------------ */
var empty = fresh();
empty.tasks.forEach(function (t) { t.status = 'done'; });
var jay = E.unitById(empty, 'u-jay');
var t8 = C.workerTurn(E, empty, jay, C.matchIntent("what's next"));
check('caught-up building says so, assigns nothing', !t8.next && /caught up/.test(t8.lines.join(' ')));

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
  check('summary zone ' + z + ' line has its real bins in use (' + stats[z].binsOccupied + ' of 8)',
    line.indexOf(stats[z].binsOccupied + ' of 8 bins in use') !== -1);
});
var bn = E.bottleneck(p);
check('summary carries the engine\'s bottleneck call',
  !!bn && sum.text.indexOf('Zone ' + bn.zone + ' is backing up: ' + bn.pending + ' waiting') !== -1 &&
  sum.text.indexOf(bn.suggestion.unitName) !== -1);
check('summary names every labor unit', p.labor.every(function (u) { return sum.text.indexOf(u.name) !== -1; }));
check('summary lists expected inbound (IN-1002, 10 pallets, Zone B)',
  /IN-1002 — Inbound Door 3 \(Zone B\) — 10 pallets — expected today/.test(sum.text));
var zb = sum.facts.zones.filter(function (z) { return z.zone === 'B'; })[0];
check('Zone B shows 10 pallets expected, not yet arrived', zb.incomingPallets === 10);
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
