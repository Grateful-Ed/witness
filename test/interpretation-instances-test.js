/* interpretation-instances-test.js — node, no dependencies.
   Interpretation instances 1 + 2 (briefs/claude-brief-interpretation-
   instances.md): the AI reads the worker's words into the code's
   shapes; the code is the double checker.
     Instance 1 — numbers claimed in speech: the work envelope's
       CLAIM ({ qty, bin, cartons }), cross-checked by parseQty /
       parseBin in completionPlan; a disagreement asks "Is this a
       partial or full completion?" and stages nothing; a clean
       no-count completion stages the full close (note 39); a model
       failure stages nothing and runs nothing — "AI is currently
       down." (note 40). The clarification loop: carried one turn,
       read together with the first words, narrower each time.
     Instance 2 — the flag's zone: the AI's place reading, validated
       against the digest's places, cross-checked by the token read;
       a disagreement asks before filing; an unanswered ask files at
       the fallback with the disagreement noted.
   Run: node test/interpretation-instances-test.js   (exit 0 = all pass) */
'use strict';

var E = require('../js/engine.js');
var W = require('../js/wms.js');
var V = require('../js/wms-voice.js');
var AI = require('../js/wms-ai.js');
var O = require('../js/ontology.js');

var failures = 0, passes = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (cond) passes++; else failures++; }

var t0 = Date.parse('2026-11-06T08:00:00Z'), tick = 0;
W.now = function () { return new Date(t0 + 60000 * (tick++)).toISOString(); };

function snap(s) { return JSON.stringify(s); }
function claim(qty, bin, cartons) { return { qty: qty == null ? null : qty, bin: bin || null, cartons: cartons == null ? null : cartons }; }
function done(c, say) { return { intent: 'complete', about: 'current', say: say || 'Got it.', claim: c }; }
function said(intent, extra) { var e = { intent: intent, about: 'current', say: 'OK.' }; Object.keys(extra || {}).forEach(function (k) { e[k] = extra[k]; }); return e; }
function problem(place) { return said('problem', { place: place === undefined ? null : place }); }
function turn(s, uid, words, env, pending, label) {
  var d = V.decide(s, uid, words, env, pending || null);
  if (d.run) d.result = V.run(s, d.run, { label: label || 'Leak' });
  return d;
}

var PRIYA = 'u-priya', JAY = 'u-jay', DEE = 'u-dee', GRACE = 'u-grace';
var PF = 'Is this a partial or full completion?';

function priya() {
  var s = W.seed();
  W.nextFor(s, PRIYA);
  return s;
}

(async function () {
  /* ================= Instance 1: the claim ================= */
  var s = priya(), cur = W.currentOf(s, PRIYA), before = snap(s), d;
  check('setup: Priya holds the pick of 10 × Rice from B-04', cur.id === 't-pick-ORD-501-B-04' && cur.qty === 10);

  d = turn(s, PRIYA, 'done with this one', done(claim(null)));
  check('pronoun: "done with this one" stages nothing and asks exactly "Is this a partial or full completion?"',
    d.say === PF && d.stage && d.stage.kind === 'clarify' && !d.run && snap(s) === before);
  check('pronoun: the parser\'s "one" is never named and never staged', !/\b1\b|\bone\b/.test(d.say) && d.stage.kind !== 'complete');

  d = turn(s, PRIYA, 'picked all 10', done(claim(10)));
  check('agree: "picked all 10" (claim 10, parser 10) stages the full count', d.stage && d.stage.kind === 'complete' && d.stage.plan.qty === 10 &&
    d.say === 'Mark "' + cur.title + '" complete — 10 picked? Say yes to close it, or no to leave it open.' && snap(s) === before);

  d = turn(s, PRIYA, 'picked eight, two short', done(claim(8)));
  check('agree: a claimed short count stages the short close with its detail line', d.stage && d.stage.plan.qty === 8 &&
    /— 8 of 10 picked — 2 short\?/.test(d.say) && snap(s) === before);

  d = turn(s, PRIYA, 'picked 8', done(claim(6)));
  check('disagree: claim 6, parser 8 → asks, stages nothing', d.say === PF && d.stage.kind === 'clarify' && snap(s) === before);
  d = turn(s, PRIYA, 'picked them', done(claim(9)));
  check('disagree: the AI claims a number the parser does not read → asks, stages nothing', d.say === PF && d.stage.kind === 'clarify');

  d = turn(s, PRIYA, 'picked 12', done(claim(12)));
  check('guard: a claim above the task\'s quantity asks, nothing staged', /more than the order line wants \(10\)/.test(d.say) && !d.stage && snap(s) === before);

  d = turn(s, PRIYA, 'done', done(claim(null)));
  check('bare "done" on a pick stages the full close', d.stage && d.stage.kind === 'complete' && d.stage.plan.qty === 10 && /— 10 picked\?/.test(d.say));

  /* model failure: nothing staged, nothing run, the outage named */
  d = turn(s, PRIYA, 'picked 10', null);
  check('outage: the model not answering stages nothing — "AI is currently down."', d.say === 'AI is currently down.' && !d.stage && !d.run && d.outage && snap(s) === before);
  d = turn(s, PRIYA, 'picked 10', { intent: 'complete', about: 'current', say: 'ok' });
  check('outage: a completion envelope with no claim stages nothing', d.say === 'AI is currently down.' && !d.stage);
  var st = turn(s, PRIYA, 'picked 10', done(claim(10))).stage;
  d = turn(s, PRIYA, 'yes', null, st);
  check('outage: a local "yes" to a staged close runs nothing — the stage dies unrun',
    d.say === 'AI is currently down.' && !d.run && !d.stage && /^Left open/.test(d.note) && snap(s) === before && W.currentOf(s, PRIYA).status === 'assigned');
  d = turn(s, PRIYA, 'there is a spill by B-03', null);
  check('outage: a spoken problem files nothing and stages nothing', d.say === 'AI is currently down.' && !d.stage && snap(s) === before);
  var threw = null;
  var noClaim = function () { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ choices: [{ message: { content: JSON.stringify({ intent: 'complete', about: 'current', say: 'ok' }) } }] }); } }); };
  try { await AI.workTurn(noClaim, {}, 'done'); } catch (e) { threw = e; }
  check('envelope: a completion with no claim is refused (the door treats it as no answer)', !!threw);
  check('envelope: a claim\'s shape is validated (numbers or null; a bin is a string or null)',
    AI.acceptClaim({ qty: 3, bin: 'B-04', cartons: null }).qty === 3 && AI.acceptClaim({ qty: '7', bin: null }).qty === 7 &&
    AI.acceptClaim({ qty: -1 }) === null && AI.acceptClaim({ qty: 2.5 }) === null && AI.acceptClaim({ bin: 4 }) === null && AI.acceptClaim('10') === null &&
    AI.acceptWork({ intent: 'complete', say: 'ok', claim: { qty: 'ten' } }) === null);
  check('envelope: a problem carries its place reading (string or null)', AI.acceptWork({ intent: 'problem', say: 'ok', place: 'B-03' }).place === 'B-03' &&
    AI.acceptWork({ intent: 'problem', say: 'ok', place: 7 }).place === null);

  /* count tasks: the number is the work product */
  var c = W.seed();
  W.cycleCount(c, ['B-04'], { by: 'u-sam' });
  W.nextFor(c, JAY);
  var cc = W.currentOf(c, JAY);
  d = turn(c, JAY, 'done', done(claim(null)));
  check('count task: bare "done" still asks for the count — nothing staged', cc.type === 'count' && /^Say the count for Bin B-04/.test(d.say) && !d.stage);
  d = turn(c, JAY, 'counted 38', done(claim(38)));
  check('count task: claim and parser agree → the count is staged', d.stage && d.stage.kind === 'complete' && /count 38/.test(d.say));
  d = turn(c, JAY, 'counted 38', done(claim(36)));
  check('count task: claim and parser disagree → the count is asked, nothing staged', d.stage && d.stage.kind === 'clarify' && /^Say the count for Bin B-04 — just the number/.test(d.say));
  var st2 = d.stage;
  d = turn(c, JAY, 'thirty eight', done(claim(38)), st2);
  check('count task: the answer stages the count, words heard together', d.stage && d.stage.kind === 'complete' && d.stage.plan.counts['Rice — bags'] === 38 && d.stage.words === 'counted 38 | thirty eight');

  /* putaway bin and pack cartons follow the same rules */
  var p = W.seed();
  W.nextFor(p, DEE);
  var pa = W.currentOf(p, DEE);
  d = turn(p, DEE, 'in ' + pa.toBinId, done(claim(null, pa.toBinId)));
  check('bin: claim and parser agree → staged destination', d.stage && d.stage.plan.binId === pa.toBinId);
  d = turn(p, DEE, 'put it in A-03', done(claim(null, 'A-05')));
  check('bin: a claimed bin the parser reads differently → asks, nothing staged', d.stage && d.stage.kind === 'clarify' && /^Which bin did it go in\?/.test(d.say));
  d = turn(p, DEE, 'put it away', done(claim(null, 'A-05')));
  check('bin: a claimed bin the parser does not read → asks', d.stage && d.stage.kind === 'clarify');
  d = turn(p, DEE, 'put away, done', done(claim(null)));
  check('bin: nothing claimed, nothing read → the suggested bin', d.stage && d.stage.kind === 'complete' && d.stage.plan.binId === pa.toBinId);
  var k = W.seed();
  W.complete(k, 't-pick-ORD-502-C-02', { by: GRACE, qty: 8 });
  W.nextFor(k, GRACE);
  var pk = W.currentOf(k, GRACE);
  d = turn(k, GRACE, 'packed this one', done(claim(null, null, null)));
  check('cartons: pronoun case (nothing claimed, parser reads one) → asks, nothing staged', pk.type === 'pack' && d.stage && d.stage.kind === 'clarify' && /How many cartons/.test(d.say));
  d = turn(k, GRACE, 'packed 3 cartons', done(claim(null, null, 3)));
  check('cartons: agree → staged with the cartons', d.stage && d.stage.plan.cartons === 3);

  /* ================= the clarification loop ================= */
  s = priya(); before = snap(s); cur = W.currentOf(s, PRIYA);
  var cl = turn(s, PRIYA, 'done with this one', done(claim(null))).stage;
  d = turn(s, PRIYA, 'full', done(claim(null)), cl);
  check('loop: "full" stages the full close', d.stage && d.stage.kind === 'complete' && d.stage.plan.qty === 10 && /— 10 picked\?/.test(d.say) && snap(s) === before);
  d = turn(s, PRIYA, 'yes', said('confirm'), d.stage);
  var tk = E.taskById(s, cur.id);
  check('loop: the yes closes it, with both utterances as the words heard', d.result && d.result.ok && tk.status === 'done' && tk.via === 'voice' && tk.heard === 'done with this one | full');

  s = priya(); before = snap(s);
  cl = turn(s, PRIYA, 'done with this one', done(claim(null))).stage;
  d = turn(s, PRIYA, 'partial', done(claim(null)), cl);
  check('loop: "partial" draws the count ask — nothing staged', d.stage && d.stage.kind === 'clarify' && /^How many did you pick\?/.test(d.say) && d.say !== PF && snap(s) === before);
  d = turn(s, PRIYA, 'seven', done(claim(7)), d.stage);
  check('loop: …and the count stages the short close', d.stage && d.stage.kind === 'complete' && d.stage.plan.qty === 7 && /7 of 10 picked — 3 short/.test(d.say));

  s = priya(); before = snap(s);
  d = turn(s, PRIYA, 'picked eight of the 10', done(claim(8)));
  check('loop: "picked eight of the 10" — claim 8, parser 10 → asks', d.say === PF && d.stage.kind === 'clarify');
  d = turn(s, PRIYA, 'partial', done(claim(null)), d.stage);
  check('loop: "partial" alone resolves only with the first words — the combined reading stages 8',
    d.stage && d.stage.kind === 'complete' && d.stage.plan.qty === 8 && /8 of 10 picked — 2 short/.test(d.say) && snap(s) === before);

  s = priya(); before = snap(s);
  cl = turn(s, PRIYA, 'done with this one', done(claim(null))).stage;
  d = turn(s, PRIYA, 'hmm, let me think', said('answer'), cl);
  var ask2 = d.say;
  check('loop: a second ambiguity narrows the ask instead of repeating it', d.stage && d.stage.kind === 'clarify' && ask2 !== PF && /^How many did you pick\?/.test(ask2));
  d = turn(s, PRIYA, 'not sure really', said('answer'), d.stage);
  check('loop: a third stays narrower still — no question is asked twice, nothing staged', !d.stage && d.say !== PF && d.say !== ask2 && /RF screen/.test(d.say) && snap(s) === before);

  s = priya();
  cl = turn(s, PRIYA, 'done with this one', done(claim(null))).stage;
  d = turn(s, PRIYA, "what's next", said('next'), cl);
  check('loop: a different question ends the clarification (one turn, noted)', !d.stage && /^Left open/.test(d.note) && /^After this one/.test(d.say));
  cl = turn(s, PRIYA, 'done with this one', done(claim(null))).stage;
  d = turn(s, PRIYA, 'no, leave it', said('deny'), cl);
  check('loop: "no" drops it — nothing staged', !d.stage && /^Left open/.test(d.say));
  cl = turn(s, PRIYA, 'done with this one', done(claim(null))).stage;
  d = turn(s, PRIYA, 'full', null, cl);
  check('loop: an outage mid-clarification stages nothing', d.say === 'AI is currently down.' && !d.stage);
  cl = turn(s, PRIYA, 'done with this one', done(claim(null))).stage;
  var ctx = V.context(s, PRIYA, cl);
  var body = JSON.parse(AI.workBody(ctx, 'full')).messages[1].content;
  check('loop: the model reads the answer with the first words (the context carries them)', ctx.clarify && ctx.clarify.words === 'done with this one' &&
    /The worker first said: "done with this one"/.test(body) && /The console asked: Is this a partial or full completion\?/.test(body));

  /* ================= Instance 2: the flag's zone ================= */
  var f = W.seed(); before = snap(f);
  d = turn(f, JAY, 'oil leaking by the dock door', problem('Inbound Door 3'));
  check('place: an AI place that validates lands its zone (from the digest, not the AI)', d.stage && d.stage.kind === 'flag' && d.stage.zone === 'B' && d.stage.said === 'B' && snap(f) === before);
  d = turn(f, JAY, 'yes', said('confirm'), d.stage, 'Oil leak');
  var fl = f.wms.flags[f.wms.flags.length - 1];
  check('place: the yes files it at that zone, words verbatim', d.result.ok && fl.zone === 'B' && fl.words === 'oil leaking by the dock door' && !fl.zoneNote);

  f = W.seed(); before = snap(f);
  d = turn(f, JAY, 'something is leaking over here', problem('Bay 99'));
  check('place: an invented place is discarded — no task in hand, so it asks where (files nothing)', /^Where is it\?/.test(d.say) && !d.stage && snap(f) === before);
  W.nextFor(f, PRIYA);
  d = turn(f, PRIYA, 'something is leaking over here', problem('Bay 99'));
  check('place: an invented place falls back to the task\'s zone', d.stage && d.stage.zone === 'B' && d.stage.said === null);
  d = turn(f, PRIYA, 'something is leaking over here', problem('A-01'));
  check('place: a real place with no token read lands (A-01 → Zone A)', d.stage && d.stage.said === 'A');

  f = W.seed(); W.nextFor(f, PRIYA);
  d = turn(f, PRIYA, 'leak between B-03 and A-01', problem('B-03'));
  check('two zones: the words name two zones → nothing resolves, whatever the AI read (task fallback)', d.stage && d.stage.said === null && d.stage.zone === 'B');
  d = turn(f, JAY, 'leak between B-03 and C-01', problem('C-01'));
  check('two zones: with no task in hand it asks where', /^Where is it\?/.test(d.say) && !d.stage);

  f = W.seed();
  d = turn(f, JAY, 'oil by B-03', problem('B-03'));
  check('agree: AI place and token read agree → that zone', d.stage && d.stage.said === 'B');

  f = W.seed(); before = snap(f);
  d = turn(f, JAY, 'oil by B-03', problem('A-01'));
  check('disagree: AI and token zones differ → asks before filing, naming both readings — nothing filed',
    d.stage && d.stage.kind === 'flagzone' && /Zone A \(A-01\)/.test(d.say) && /Zone B/.test(d.say) && snap(f) === before);
  d = turn(f, JAY, 'zone A', said('answer', { place: 'A' }), d.stage);
  check('disagree: the answer settles it — the flag stages at the answered zone', d.stage && d.stage.kind === 'flag' && d.stage.said === 'A' && d.stage.words === 'oil by B-03');
  d = turn(f, JAY, 'yes', said('confirm'), d.stage, 'Oil');
  fl = f.wms.flags[f.wms.flags.length - 1];
  check('disagree: the yes files at the answered zone', d.result.ok && fl.zone === 'A');

  f = W.seed(); before = snap(f);
  var fz = turn(f, JAY, 'oil by B-03', problem('A-01')).stage;
  d = turn(f, JAY, 'B', said('answer'), fz);
  check('disagree: a bare zone letter answers', d.stage && d.stage.kind === 'flag' && d.stage.said === 'B');
  d = turn(f, JAY, "what's next", said('next'), fz);
  check('unanswered: anything else → the flag stages at the fallback with the disagreement noted (the question answered first)',
    d.stage && d.stage.kind === 'flag' && d.stage.said === null && d.stage.zone === 'C' && /Zone A \(A-01\)/.test(d.stage.zoneNote) &&
    /^Nothing is assigned to you right now\./.test(d.say) && /File a flag with your words: "oil by B-03"\?/.test(d.say) && snap(f) === before);
  d = turn(f, JAY, 'yes', said('confirm'), d.stage, 'Oil');
  fl = f.wms.flags[f.wms.flags.length - 1];
  check('unanswered: the yes files at the fallback (reporter\'s zone) with the disagreement in its record', d.result.ok && fl.zone === 'C' && /Zone unresolved/.test(fl.zoneNote));
  f = W.seed(); before = snap(f);
  fz = turn(f, JAY, 'oil by B-03', problem('A-01')).stage;
  d = turn(f, JAY, 'never mind', said('deny'), fz);
  check('unanswered: "never mind" drops it — nothing filed', !d.stage && /^Not filed/.test(d.say) && snap(f) === before);

  /* callers without an AI reading keep today's behavior */
  f = W.seed();
  var tf = W.flag(f, { unitId: JAY, words: 'oil by B-03', label: 'Oil' });
  var tf2 = W.flag(f, { unitId: JAY, words: 'leak between B-03 and A-01', label: 'Leak' });
  check('typed flags: zoneFromWords still reads (B-03 → B; two zones → reporter\'s C)', tf.flag.zone === 'B' && tf2.flag.zone === 'C');
  var tf3 = W.flag(f, { unitId: JAY, words: 'oil', label: 'Oil', zone: 'Q' });
  check('W.flag: a zone the building does not have is ignored', tf3.flag.zone === 'C');
  check('zonesFromWords reports every zone touched', JSON.stringify(W.zonesFromWords(f, 'B-03 and A-01')) === '["A","B"]' && W.zonesFromWords(f, 'nothing here').length === 0);

  /* ================= the ontology the AI reads against ================= */
  var o = W.seed();
  o = O.learnTerm(o, { term: 'the pit', means: 'Inbound Door 3', from: 'Tommy' });
  W.nextFor(o, PRIYA);
  ctx = V.context(o, PRIYA, null);
  body = JSON.parse(AI.workBody(ctx, 'leak in the pit')).messages[1].content;
  check('context: the settled vocabulary rides the work context', /SETTLED VOCABULARY/.test(body) && /- the pit — Inbound Door 3/.test(body));
  check('context: the digest\'s places (ids + zones) ride the work context', /PLACES IN THIS BUILDING/.test(body) && /- B-03 — bin, Zone B/.test(body) && /- Inbound Door 3 — door, Zone B/.test(body));
  check('context: the task\'s numbers ride the work context', /Task numbers: task quantity 10; bin B-04/.test(body));
  var places = V.context(o, PRIYA, null).places;
  check('resolvePlace: exact, "Zone x", and a spoken bin resolve; an invented place does not',
    V.resolvePlace(places, 'b-03').zone === 'B' && V.resolvePlace(places, 'Zone a').zone === 'A' && V.resolvePlace(places, 'charlie two').id === 'C-02' &&
    V.resolvePlace(places, 'Bay 99') === null && V.resolvePlace(places, null) === null);
  check('prompt: the claim rule is stated plainly ("done with this one" claims no count)', /"done with this one" claim no count/.test(AI.WORK_PROMPT) && /"place"/.test(AI.WORK_PROMPT));

  console.log('\n' + passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})();
