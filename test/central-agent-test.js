/* central-agent-test.js — node, no dependencies.
   The central agent (js/central-agent.js): one delegator for the
   whole warehouse. Proves, with three simulated workers on the
   seeded building: each input is DISPATCHED (receive returns a
   dispatch, never an answer) to the expected sub-agent; each answer
   carries the right facts and is byte-identical to that sub-agent's
   own output — the delegator never wraps or re-words it; interleaved
   questions all read the same digest revision; a sub-agent cannot
   mutate what it is given; tells come back as record entries and
   change nothing; a state change is picked up through the ontology
   module's refresh; the module is LIVE (flag on, its one importer
   the agent surface — William's call, 2026-11-04); and the
   building's slang flows: vocabulary rides in ask context, the
   ask-don't-guess rule rides in ask prompts, and the recorder
   classifies quoted teaching tells.
   Run: node test/central-agent-test.js   (exit 0 = all pass) */
'use strict';

var fs = require('fs');
var path = require('path');
var W = require('../js/wms.js');
var O = require('../js/ontology.js');
var CA = require('../js/central-agent.js');

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
function isDeepFrozen(x) {
  if (!x || typeof x !== 'object') return true;
  if (!Object.isFrozen(x)) return false;
  return Object.keys(x).every(function (k) { return isDeepFrozen(x[k]); });
}
function clock() { var n = 0; return function () { n++; return '2026-11-04T20:00:0' + n + 'Z'; }; }

var MARCUS = 'Marcus Reed', TOMMY = 'Tommy Nguyen', PRIYA = 'Priya Shah';

/* The endpoint: what a pair of glasses would do with a dispatch.
   It hands the dispatch to the named sub-agent and shows the
   worker whatever comes back. The delegator is not in this path. */
function deliver(dispatch, inbox) {
  var response = CA.SUB_AGENTS[dispatch.agent].respond(dispatch);
  (inbox[dispatch.to] = inbox[dispatch.to] || []).push(response);
  return response;
}

/* ---------- 0. the seed workers exist --------------------------- */
var s0 = W.seed();
check('the three simulated workers are seed labor', [MARCUS, TOMMY, PRIYA].every(function (n) {
  return s0.labor.some(function (u) { return u.name === n && u.role === 'worker'; });
}));

/* ---------- 1. the simulated shift: three workers, one agent ----- */
var state = W.seed();
var callerDigest = O.buildDigest(state);
var callerDigestJson = JSON.stringify(callerDigest);
var stateJson = JSON.stringify(state);
var agent = CA.createCentralAgent({ state: state, digest: callerDigest, now: clock() });
var digestBefore = JSON.stringify(agent.digest());
var inbox = {};

var script = [
  { from: MARCUS, text: "What's in bin A-05?", agent: 'locator', about: 'place' },
  { from: TOMMY, text: 'Where are the canned peaches?', agent: 'locator', about: 'item' },
  { from: PRIYA, text: 'What needs eyes?', agent: 'status', about: 'task' },
  { from: MARCUS, text: "What's the status of t-putaway-STG-3?", agent: 'status', about: 'task' },
  { from: TOMMY, text: 'What should I do next?', agent: 'planner', about: 'task' },
  { from: PRIYA, text: 'Pallet STG-4 has a torn wrap on the north side', agent: 'recorder', about: 'tell' },
  { from: MARCUS, text: 'Is bin B-04 on hold?', agent: 'status', about: 'place' },
  { from: PRIYA, text: 'What should I do next?', agent: 'planner', about: 'task' }
];

var dispatches = [], responses = [];
script.forEach(function (line) {
  var d = agent.receive({ from: line.from, text: line.text, kind: 'voice' });
  dispatches.push(d);
  responses.push(deliver(d, inbox));
});

script.forEach(function (line, i) {
  check('dispatch ' + (i + 1) + ' ("' + line.text + '") goes to the ' + line.agent + ', about ' + line.about,
    dispatches[i].agent === line.agent && dispatches[i].about === line.about);
});

check('receive() returns a dispatch: agent, prompt, context — and no answer', dispatches.every(function (d) {
  return typeof d.agent === 'string' && typeof d.prompt === 'string' && d.prompt.length > 0 &&
    d.context && typeof d.context === 'object' && !('answer' in d) && !('facts' in d) && !('response' in d);
}));
check('each dispatch is addressed back to the worker who spoke', dispatches.every(function (d, i) {
  return d.to === script[i].from && d.from === script[i].from;
}));
check('the prompt names the sub-agent and the worker it answers', dispatches.every(function (d) {
  return d.prompt.indexOf(d.agent) !== -1 && d.prompt.indexOf(d.to) !== -1;
}));

/* the facts */
var r = responses;
check('locator: A-05 holds 25 × Dog food — bags, and says it is on hold',
  deepEq(r[0].facts, [{ place: 'bin', id: 'A-05', desc: 'Dog food — bags', qty: 25 }]) &&
  /Bin A-05 holds 25 × Dog food — bags/.test(r[0].answer) && /on hold/.test(r[0].answer));
check('locator: the peaches are in A-01 (40), B-01 (12), B-09 (16), C-01 (9) and on pallet STG-3 (15)', (function () {
  var got = r[1].facts.map(function (f) { return f.id + ':' + f.qty; }).sort();
  return deepEq(got, ['A-01:40', 'B-01:12', 'B-09:16', 'C-01:9', 'STG-3:15']) && /pallet STG-3 at Inbound Door 1/.test(r[1].answer);
})());
check('status: the needs-eyes list is the held bin and the two standing flags',
  r[2].facts.length === 3 && r[2].facts[0].id === 'A-05' && /3 things need eyes: Bin A-05 on hold; Flag FLG-001 awaiting a decision; Flag FLG-002 awaiting a decision/.test(r[2].answer));
check('status: the peaches putaway is open, going to A-03, unassigned',
  r[3].facts[0].task === 't-putaway-STG-3' && r[3].facts[0].destination === 'A-03' &&
  /to A-03 is open, unassigned/.test(r[3].answer));
/* Job assignment (briefs/claude-brief-job-assignment.md): the seed
   deals Tommy (Putaway) the oldest putaway job, STG-2, and Priya
   (Picking) the oldest picking job, ORD-501. The planner reads their
   own queued work — never a pool task in their zone. */
check('planner: Tommy gets his own job\'s task — the STG-2 putaway into A-03, queued for him',
  r[4].facts[0].task === 't-putaway-STG-2' && r[4].facts[0].destination === 'A-03' &&
  r[4].facts[0].why === 'queued' && /^Next for you/.test(r[4].answer));
check('recorder: Priya\'s tell comes back as a record entry { from, text, at }',
  deepEq(r[5].record, { from: PRIYA, text: 'Pallet STG-4 has a torn wrap on the north side', at: dispatches[5].at }) &&
  deepEq(Object.keys(r[5].record).sort(), ['at', 'from', 'text']));
check('status: B-04 is a status and nothing else ("Bin B-04 is ok.")', r[6].answer === 'Bin B-04 is ok.');
check('planner: Priya gets her own job\'s first task — the ORD-501 pick at B-04',
  r[7].facts[0].task === 't-pick-ORD-501-B-04' && r[7].facts[0].destination === 'B-04' && r[7].facts[0].why === 'queued');
check('each worker\'s inbox holds only their own answers', inbox[MARCUS].length === 3 && inbox[TOMMY].length === 2 && inbox[PRIYA].length === 3);

/* byte-identical: the answer the worker got is the sub-agent's own
   output — computed again, from an unfrozen copy of the dispatch,
   with the delegator nowhere near it. */
check('every answer is byte-identical to the sub-agent\'s own output', responses.every(function (resp, i) {
  var own = CA.SUB_AGENTS[dispatches[i].agent].respond(JSON.parse(JSON.stringify(dispatches[i])));
  return JSON.stringify(resp) === JSON.stringify(own);
}));
check('no answer text ever appears in what the delegator recorded', (function () {
  var logged = JSON.stringify(agent.dispatches());
  return agent.dispatches().length === script.length && responses.every(function (resp) { return logged.indexOf(resp.answer) === -1; });
})());
check('the delegator has no path that takes an answer back (no respond / deliver / relay)', deepEq(
  Object.keys(agent).sort(), ['agents', 'digest', 'dispatches', 'receive', 'revision']) &&
  !('respond' in agent) && !('deliver' in agent) && !('relay' in agent));
check('the response object is the sub-agent\'s shape: answer, facts, rev (+ record for a tell)', responses.every(function (resp, i) {
  var keys = Object.keys(resp).sort();
  return dispatches[i].agent === 'recorder' ? deepEq(keys, ['answer', 'facts', 'rev', 'record'].sort()) : deepEq(keys, ['answer', 'facts', 'rev']);
}));

/* ---------- 2. consistency: interleaved inputs, one revision ----- */
check('every answer in the shift reflects the same digest revision (0)', responses.every(function (resp) { return resp.rev === 0; }) &&
  dispatches.every(function (d) { return d.rev === 0 && d.context.asOf.rev === 0; }));
function runOrder(order) {
  var st = W.seed();
  var ag = CA.createCentralAgent({ state: st, now: function () { return 'T'; } });
  var out = {};
  order.forEach(function (i) {
    var d = ag.receive({ from: script[i].from, text: script[i].text });
    out[i] = { rev: d.rev, resp: JSON.stringify(CA.SUB_AGENTS[d.agent].respond(d)) };
  });
  return out;
}
var forward = runOrder([0, 1, 2, 3, 4, 5, 6, 7]);
var shuffled = runOrder([7, 2, 5, 0, 4, 1, 6, 3]);
var byWorker = runOrder([0, 3, 6, 1, 4, 2, 5, 7]);
check('three interleavings of the same inputs give identical answers', [0, 1, 2, 3, 4, 5, 6, 7].every(function (i) {
  return forward[i].resp === shuffled[i].resp && forward[i].resp === byWorker[i].resp;
}));
check('…and every one of them read the same revision', [forward, shuffled, byWorker].every(function (run) {
  return Object.keys(run).every(function (k) { return run[k].rev === 0; });
}));

/* ---------- 3. single writer: nothing in the shift wrote --------- */
check('the shift changed nothing in state', JSON.stringify(state) === stateJson);
check('the shift changed nothing in the delegator\'s digest', JSON.stringify(agent.digest()) === digestBefore);
check('the caller\'s digest was neither mutated nor frozen in place', JSON.stringify(callerDigest) === callerDigestJson && !Object.isFrozen(callerDigest));
check('every dispatch (context included) is deep-frozen', dispatches.every(isDeepFrozen));
check('the delegator\'s digest is deep-frozen', isDeepFrozen(agent.digest()));
check('the sub-agents themselves are frozen', Object.isFrozen(CA.SUB_AGENTS) && Object.keys(CA.SUB_AGENTS).every(function (k) { return Object.isFrozen(CA.SUB_AGENTS[k]); }));

/* a rogue sub-agent tries to write; it cannot */
var rogue = agent.receive({ from: MARCUS, text: "What's in bin A-05?" });
var digestNow = JSON.stringify(agent.digest());
var threw = false;
try { rogue.context.places[0].status = 'ok'; } catch (e) { threw = e instanceof TypeError; }
var threw2 = false;
try { rogue.context.places.push({ kind: 'bin', id: 'Z-99' }); } catch (e) { threw2 = e instanceof TypeError; }
check('a sub-agent writing to its context is refused (TypeError, strict mode)', threw && threw2);
check('…and the digest deep-equals what it was before the attempt', JSON.stringify(agent.digest()) === digestNow &&
  agent.digest().places.filter(function (p) { return p.id === 'A-05'; })[0].status === 'hold');

/* ---------- 4. tells pass through and mutate nothing ------------- */
var s4 = W.seed();
var s4Json = JSON.stringify(s4);
var a4 = CA.createCentralAgent({ state: s4, now: function () { return '2026-11-04T21:00:00Z'; } });
var d4before = JSON.stringify(a4.digest());
var tell = a4.receive({ from: TOMMY, text: 'Rice in B-04 looks wet on the bottom bags', kind: 'voice' });
var tr = CA.SUB_AGENTS[tell.agent].respond(tell);
check('a statement is read as a tell and goes to the recorder', tell.about === 'tell' && tell.agent === 'recorder');
check('the record entry is exactly { from, text, at }, in the speaker\'s words', deepEq(tr.record,
  { from: TOMMY, text: 'Rice in B-04 looks wet on the bottom bags', at: '2026-11-04T21:00:00Z' }));
var forced = a4.receive({ from: TOMMY, text: 'Is this a question', kind: 'tell' });
check('kind: "tell" forces the recorder even on question-shaped words', forced.agent === 'recorder');
var asked = a4.receive({ from: TOMMY, text: 'B-04 status', kind: 'question' });
check('kind: "question" forces a question reading', asked.agent === 'status');
check('tells changed nothing in state or digest', JSON.stringify(s4) === s4Json && JSON.stringify(a4.digest()) === d4before);

/* ---------- 5. state moves: the delegator refreshes, alone ------- */
var s5 = W.seed();
var a5 = CA.createCentralAgent({ state: s5, now: function () { return 'T'; } });
var r5a = CA.SUB_AGENTS.status.respond(a5.receive({ from: MARCUS, text: 'Is bin B-04 on hold?' }));
W.hold(s5, { binId: 'B-04' }, 'u-sam', 'recount needed');
s5.wmsRev = 1; /* what the store's save stamps */
var d5 = a5.receive({ from: MARCUS, text: 'Is bin B-04 on hold?' });
var r5b = CA.SUB_AGENTS[d5.agent].respond(d5);
check('before the change: B-04 is ok at rev 0', r5a.rev === 0 && r5a.answer === 'Bin B-04 is ok.');
check('after the change: the delegator refreshed to rev 1 and B-04 reads on hold', r5b.rev === 1 && d5.rev === 1 &&
  /^Bin B-04 is on hold \(recount needed\)\.$/.test(r5b.answer));
check('the refreshed digest equals the ontology module\'s own rebuild', deepEq(JSON.parse(JSON.stringify(a5.digest())), O.buildDigest(s5)));
var eyes = CA.SUB_AGENTS.status.respond(a5.receive({ from: PRIYA, text: 'What needs eyes?' }));
check('needs-eyes now lists both held bins and the standing flags', eyes.facts.length === 4 && eyes.rev === 1);

/* ---------- 6. live by William's call: the flag and the repo ---- */
var src = fs.readFileSync(path.join(__dirname, '..', 'js', 'central-agent.js'), 'utf8');
check('the source carries CENTRAL_AGENT_LIVE = true', /var CENTRAL_AGENT_LIVE = true;/.test(src) && CA.CENTRAL_AGENT_LIVE === true);
check('the reason is written beside the flag', /THE FLAG\.[\s\S]{0,1600}var CENTRAL_AGENT_LIVE = true;/.test(src) &&
  /William's call, 2026-11-04/.test(src) && /wms-agent\.js/.test(src) && /never worse/.test(src));
check('the module source has no fetch call', !/fetch\s*\(/.test(src));
check('the module source has no XMLHttpRequest, WebSocket or beacon', !/XMLHttpRequest|WebSocket|sendBeacon/.test(src));
check('the module source names no URL', !/https?:\/\//.test(src) && src.indexOf('workers.dev') === -1);
check('the module source starts no timer (no polling, no proactive push)', !/setInterval|setTimeout/.test(src));
var root = path.join(__dirname, '..');
var importers = [];
fs.readdirSync(path.join(root, 'js')).forEach(function (f) {
  if (f === 'central-agent.js' || !/\.js$/.test(f)) return;
  if (fs.readFileSync(path.join(root, 'js', f), 'utf8').indexOf('central-agent') !== -1) importers.push('js/' + f);
});
var htmlLoaders = [];
fs.readdirSync(root).forEach(function (f) {
  if (/\.html$/.test(f) && fs.readFileSync(path.join(root, f), 'utf8').indexOf('central-agent') !== -1) htmlLoaders.push(f);
});
var wmsHtmlTags = (fs.readFileSync(path.join(root, 'wms.html'), 'utf8').match(/src="js\/central-agent\.js"/g) || []).length;
fs.readdirSync(path.join(root, 'worker')).forEach(function (f) {
  var p = path.join(root, 'worker', f);
  if (fs.statSync(p).isFile() && fs.readFileSync(p, 'utf8').indexOf('central-agent') !== -1) importers.push('worker/' + f);
});
check('exactly one JS file consumes the module: the live agent surface', deepEq(importers, ['js/wms-agent.js']));
check('exactly one page loads the module, exactly once: the console that hosts the agent', deepEq(htmlLoaders, ['wms.html']) && wmsHtmlTags === 1);

/* ---------- 7. the building's slang: vocabulary + teaching ------ */
var s7 = W.seed();
check('the seed state carries no vocabulary key (it is learned, never seeded)', !('vocabulary' in s7));
var s7b = O.learnTerm(s7, { term: 'sweating', means: 'condensation wet on the bottom bags', from: 'Rosa Flores', at: '2026-11-04T21:05:00Z' });
var a7 = CA.createCentralAgent({ state: s7b, now: function () { return 'T'; } });
var d7 = a7.receive({ from: MARCUS, text: "What's in bin A-05?" });
check('the digest carries the vocabulary the building has learned', deepEq(a7.digest().vocabulary,
  [{ term: 'sweating', means: 'condensation wet on the bottom bags', taughtBy: 'Rosa Flores' }]));
check('an ask dispatch carries the vocabulary in its context', deepEq(d7.context.vocabulary, a7.digest().vocabulary));
check('the ask prompt carries the ask-don\'t-guess rule', /ask them what it means — never guess a meaning/.test(d7.prompt) &&
  /If they teach you a word, use it/.test(d7.prompt));
check('the ask prompt carries the topicality standard (the answerer\'s own judgment)', /isn\'t related to warehouse process/.test(d7.prompt));
check('the rule text lives in the prompt builder\'s source', /never guess a meaning/.test(src) && /related to warehouse process/.test(src));
var dTeach = a7.receive({ from: 'Rosa Flores', text: "'grip' means the forklift clamp attachment", kind: 'tell' });
var rTeach = CA.SUB_AGENTS.recorder.respond(dTeach);
check('a quoted teaching tell is classified as a teach, the lesson on the record',
  dTeach.agent === 'recorder' && rTeach.record.kind === 'teach' && rTeach.record.term === 'grip' &&
  rTeach.record.means === 'the forklift clamp attachment' && rTeach.record.from === 'Rosa Flores' &&
  rTeach.record.text === "'grip' means the forklift clamp attachment" && rTeach.record.at === 'T' &&
  deepEq(Object.keys(rTeach.record).sort(), ['at', 'from', 'kind', 'means', 'term', 'text']));
var dCalled = a7.receive({ from: 'Rosa Flores', text: "When condensation wets the bottom bags, that's called 'sweating'.", kind: 'tell' });
var rCalled = CA.SUB_AGENTS.recorder.respond(dCalled);
check('"that\'s called" teaches too — the description just given is the meaning',
  rCalled.record.kind === 'teach' && rCalled.record.term === 'sweating' &&
  rCalled.record.means === 'When condensation wets the bottom bags');
var dPlain = a7.receive({ from: 'Rosa Flores', text: 'This means the truck waits at the door', kind: 'tell' });
var rPlain = CA.SUB_AGENTS.recorder.respond(dPlain);
check('an ordinary tell containing "means" unquoted is NOT a teaching', !('kind' in rPlain.record) &&
  deepEq(Object.keys(rPlain.record).sort(), ['at', 'from', 'text']));

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
