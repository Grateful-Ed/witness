/* wms-voice-test.js — node, no dependencies.
   Work by voice on the live task queues (js/wms-voice.js, the
   full-flow voice brief) against the real WMS layer and seed world,
   plus the model envelope (js/wms-ai.js workTurn) against a stubbed
   /chat:
     - intent resolution on a seeded state: complete / pull next /
       repeat / question;
     - the confirmation law: every state-changing act (completion,
       taking the next task, filing a flag) stages and asks with ZERO
       mutation; only the next turn's yes runs it; no leaves it; any
       other turn clears it (noted); a yes with nothing staged does
       nothing;
     - ambiguity asks, never acts;
     - an engine refusal gives the honest reason and changes nothing;
     - a voice completion is attributed like a click (who, when)
       plus that it arrived by voice;
     - receiving posts and load confirm stay human-signature acts;
     - Step 2: spoken counts, replenishment, bin-to-bin moves, and a
       spoken problem filed as a flag with the zone from the words.
   Run: node test/wms-voice-test.js   (exit 0 = all pass) */
'use strict';

var E = require('../js/engine.js');
var W = require('../js/wms.js');
var V = require('../js/wms-voice.js');
var AI = require('../js/wms-ai.js');

var failures = 0, passes = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (cond) passes++; else failures++; }

var t0 = Date.parse('2026-11-05T08:00:00Z'), tick = 0;
W.now = function () { return new Date(t0 + 60000 * (tick++)).toISOString(); };

function fresh() { return W.seed(); }
function snap(s) { return JSON.stringify(s); }
function env(intent, say, about) { return { intent: intent, say: say || 'OK.', about: about || 'current' }; }
function task(s, id) { return E.taskById(s, id); }
function binQty(s, id, desc) { var b = E.binById(s, id), q = 0; b.contents.forEach(function (c) { if (c.desc === desc) q += c.qty; }); return q; }

/* A worker's turn, the way the page runs it: decide on the state,
   and if the decision runs a staged act, run it on the state. */
function turn(s, uid, words, e, pending, label) {
  var d = V.decide(s, uid, words, e === undefined ? null : e, pending || null);
  if (d.run) d.result = V.run(s, d.run, { label: label || null });
  return d;
}

(async function () {
  var TOMMY = 'u-tommy';
  /* Job assignment (briefs/claude-brief-job-assignment.md): the seed
     deals each worker a job from their department's pool. Priya
     (Picking) holds ORD-501 (picks B-04 then A-08); Dee (Putaway)
     holds STG-1; Marcus (Inbound) holds IN-1001; Grace (Picking) holds
     ORD-502; Jay (Pack & Ship + Cycle Count) holds nothing — his pools
     are empty. Voice itself is unchanged: it reads the same assigned
     list (in hand, then queuedFor), which the job engine now writes. */
  var PRIYA = 'u-priya', JAY = 'u-jay', DEE = 'u-dee', GRACE = 'u-grace', ROSA = 'u-rosa';

  /* ---------- local words ---------- */
  check('local: "done" is a completion', V.localIntent('done') === 'complete');
  check('local: "not done yet" is not a completion', V.localIntent("it's not done yet") !== 'complete');
  check('local: "yes" only confirms while something is pending', V.localIntent('yes', { pending: true }) === 'confirm' && V.localIntent('yes') === 'confirm');
  check('local: "no, go ahead" with a stage pending is a deny', V.localIntent('no, go ahead', { pending: true }) === 'deny');
  check('local: a problem beats a yes ("yes but the case is crushed")', V.localIntent('yes but the case is crushed', { pending: true }) === 'problem');
  check('local: a problem beats done ("done, but the pallet is torn")', V.localIntent('done, but the pallet is torn') === 'problem');
  check('local: "picked eight, two short" with a pick in hand is a completion', V.localIntent('picked eight, two short', { pickInHand: true }) === 'complete');
  check('local: "what\'s next" asks next; "say that again" repeats', V.localIntent("what's next") === 'next' && V.localIntent('say that again') === 'repeat');

  /* ---------- "what's next" is a question: the assigned list ---------- */
  /* William, 2026-11-05: tasks are assigned, not pulled. The answer
     names the next task on the worker's OWN assigned list; nothing is
     staged, assigned, or pulled from the unassigned pool. */
  var s = fresh();
  var before = snap(s);
  var d = turn(s, JAY, "what's next", env('next'));
  check('next: nothing assigned → says so plainly — nothing staged, zero mutation', d.say === 'Nothing is assigned to you right now.' && !d.stage && !d.run && snap(s) === before);
  check('next: the pool is never offered (ORD-503 sits in the Picking pool, not Jay\'s)', !/ORD-503|Tomato/.test(d.say) && !W.currentOf(s, JAY));
  var ctx = V.context(s, JAY, null);
  check('context: worker, zone, nothing in hand, nothing assigned — and reading it changes nothing',
    ctx.worker === 'Jay Patel' && ctx.zone === 'C' && ctx.inHand === null && ctx.nextUp.length === 0 && snap(s) === before);
  var q = fresh();
  before = snap(q);
  d = turn(q, PRIYA, 'what is next', env('next'));
  check('next: empty hands → names the first task of her job, task + destination — zero mutation',
    d.say === 'Your first assigned task: Pick 10 × Rice — bags from Bin B-04 for ORD-501.' && !d.stage && snap(q) === before && !W.currentOf(q, PRIYA));
  d = turn(q, PRIYA, 'yes', null, null);
  check('next: a yes after the answer takes nothing (nothing was staged)', !d.run && snap(q) === before);
  /* the WMS puts the first task of Priya's job in her hands; the
     second waits behind it on her list */
  W.nextFor(s, PRIYA);
  var cur = W.currentOf(s, PRIYA);
  before = snap(s);
  d = turn(s, PRIYA, "what's next", env('next'));
  check('next: with a task in hand → names the one after it on her list — zero mutation',
    cur && cur.id === 't-pick-ORD-501-B-04' && d.say === 'After this one: Pick 12 × Bottled water — cases from Bin A-08 for ORD-501.' && !d.stage && snap(s) === before);
  check('offer line: task + destination (pick names the bin)', V.offerLine(s, cur) === 'Pick 10 × Rice — bags from Bin B-04 for ORD-501.');
  check('context: the next-up list is the assigned list only', V.context(s, PRIYA, null).nextUp.length === 1);

  /* ---------- repeat and question mutate nothing ---------- */
  before = snap(s);
  d = turn(s, PRIYA, 'say that again', env('repeat'));
  check('repeat: reads the task in hand back, nothing changes', /^In hand: Pick 10 × Rice/.test(d.say) && !d.stage && snap(s) === before);
  d = turn(s, PRIYA, 'how much does a bag weigh?', env('answer', 'I do not have bag weights in front of me.'));
  check('question: META\'s answer passes through, nothing staged, nothing changes', d.say === 'I do not have bag weights in front of me.' && !d.stage && snap(s) === before);
  d = turn(s, PRIYA, 'yes', null, null);
  check('a yes with nothing staged does nothing', /Nothing is waiting for a yes/.test(d.say) && !d.run && snap(s) === before);

  /* ---------- complete: stage, ask; yes closes and pulls next ---------- */
  d = turn(s, PRIYA, 'picked 10', env('complete'));
  check('complete: "picked 10" stages and asks with the task named — zero mutation',
    !!d.stage && d.stage.kind === 'complete' && d.stage.taskId === cur.id && d.say === 'Mark "' + cur.title + '" complete — 10 picked? Say yes to close it, or no to leave it open.' &&
    snap(s) === before && task(s, cur.id).status === 'assigned');
  var stage = d.stage;
  d = turn(s, PRIYA, 'nope', null, stage);
  check('complete: "no" leaves it open, nothing closes', /^Left open: "Pick 10/.test(d.say) && snap(s) === before);
  d = turn(s, PRIYA, "what's next", env('next'), stage);
  check('complete: any other turn clears the stage, with a left-open note, and is its own turn', /^Left open/.test(d.note) && /^After this one/.test(d.say) && !d.stage && snap(s) === before);
  d = turn(s, PRIYA, 'yes', null, null);
  check('…and the yes after it has nothing to run (the stage lived one turn)', !d.run && snap(s) === before);
  d = turn(s, PRIYA, 'picked 10', env('complete'));
  var rice = binQty(s, 'B-04', 'Rice — bags');
  d = turn(s, PRIYA, 'yes', null, d.stage);
  var done = task(s, cur.id);
  check('complete: "yes" closes through the WMS path — stock moved, task done', d.result.ok && done.status === 'done' && binQty(s, 'B-04', 'Rice — bags') === rice - 10);
  check('complete: nothing is pulled — the next assigned task is only named, words from the result',
    !W.currentOf(s, PRIYA) && task(s, 't-pick-ORD-501-A-08').status === 'open' && task(s, 't-pick-ORD-501-A-08').queuedFor === PRIYA &&
    d.result.text === 'Picked 10 × Rice — bags. Next on your list: Pick 12 × Bottled water — cases from Bin A-08 for ORD-501.');
  W.nextFor(s, PRIYA);   /* the WMS hands her her assigned task (assignment is not voice's job) */
  check('the assigned task goes in hand by the WMS, not by voice', W.currentOf(s, PRIYA).id === 't-pick-ORD-501-A-08');
  var rec = s.records.filter(function (r) { return r.taskId === cur.id && r.kind === 'complete'; })[0];
  check('attribution: who and when as a click, plus "by voice" and the words',
    done.doneBy === PRIYA && !!done.doneAt && done.via === 'voice' && done.heard === 'picked 10' && rec && rec.by === PRIYA && rec.via === 'voice' && rec.heard === 'picked 10');
  var clicked = fresh();
  W.nextFor(clicked, PRIYA);
  W.complete(clicked, cur.id, { by: PRIYA, qty: 10 });
  var crec = clicked.records.filter(function (r) { return r.taskId === cur.id && r.kind === 'complete'; })[0];
  check('attribution: a clicked completion carries no voice mark (only voice says voice)', !task(clicked, cur.id).via && crec && !crec.via && crec.by === PRIYA);

  /* ---------- ambiguity asks ---------- */
  before = snap(s);
  d = turn(s, PRIYA, 'done with C-08', env('complete'));
  check('ambiguity: words naming a different bin ask which task — nothing staged, nothing changes', /^Which task do you mean\?/.test(d.say) && !d.stage && snap(s) === before);
  d = turn(s, PRIYA, 'finished that one for ORD-502', env('complete'));
  check('ambiguity: words naming a different order ask', /^Which task/.test(d.say) && !d.stage);
  d = turn(s, PRIYA, 'that other one is done', env('complete', 'Done.', 'other'));
  check('ambiguity: the model saying "other" asks', /^Which task/.test(d.say) && !d.stage && snap(s) === before);
  d = turn(s, PRIYA, 'it is done I think', env('complete', 'Done.', 'unclear'));
  check('ambiguity: the model saying "unclear" asks', /^Which task/.test(d.say) && !d.stage);
  d = turn(s, PRIYA, 'done', env('complete'));
  check('a pick with no count asks for the count — nothing staged', /^Say the count you picked/.test(d.say) && !d.stage && snap(s) === before);

  /* ---------- engine refusal: honest words, zero mutation ---------- */
  var next = W.currentOf(s, PRIYA);
  d = turn(s, PRIYA, 'picked ' + next.qty, env('complete'));
  stage = d.stage;
  /* the bin is emptied underneath before the yes lands */
  E.binById(s, next.binId).contents = [];
  before = snap(s);
  d = turn(s, PRIYA, 'yes', null, stage);
  check('refusal: the engine refuses (bin no longer holds it) — honest reason, never a success line', d.result && d.result.ok === false &&
    /does not hold/.test(d.result.reason) && /Nothing was closed/.test(d.result.reason) && !d.result.text);
  check('refusal: zero mutation', snap(s) === before && task(s, next.id).status === 'assigned');
  /* the staged task closed elsewhere (a click) first */
  s = fresh();
  W.nextFor(s, PRIYA);
  cur = W.currentOf(s, PRIYA);
  d = turn(s, PRIYA, 'picked 10', env('complete'));
  stage = d.stage;
  W.complete(s, cur.id, { by: PRIYA, qty: 10 });
  before = snap(s);
  d = turn(s, PRIYA, 'yes', null, stage);
  check('refusal: the staged task was closed elsewhere first — honest note, nothing changes', d.result.ok === false && /no longer in your hands/.test(d.result.reason) && snap(s) === before);

  /* ---------- short pick rides the pick path ---------- */
  s = fresh();
  W.nextFor(s, PRIYA);
  cur = W.currentOf(s, PRIYA);
  d = turn(s, PRIYA, 'picked eight, two short', env('complete'));
  check('short pick: the question says how many short', /8 of 10 picked — 2 short/.test(d.say));
  d = turn(s, PRIYA, 'yes', null, d.stage);
  check('short pick: yes records it through the WMS path (count queued for the bin)', d.result.ok && /2 short/.test(d.result.text) &&
    s.tasks.some(function (t) { return t.type === 'count' && t.binId === cur.binId && t.status !== 'done'; }));

  /* ---------- putaway: destination by voice ---------- */
  s = fresh();
  var MARCUS = 'u-marcus';
  W.nextFor(s, DEE);
  cur = W.currentOf(s, DEE);
  check('putaway in hand for Dee (her job, STG-1)', cur && cur.type === 'putaway' && cur.id === 't-putaway-STG-1');
  d = turn(s, DEE, 'in ' + cur.toBinId, env('complete'));
  check('putaway: the spoken bin is staged as the destination', !!d.stage && d.stage.plan.binId === cur.toBinId && /in Bin /.test(d.say));
  d = turn(s, DEE, 'yeah', null, d.stage);
  check('putaway: yes puts it away through the WMS path', d.result.ok && task(s, cur.id).status === 'done' && /^Put away in /.test(d.result.text));

  /* ---------- human-signature acts ---------- */
  s = fresh();
  W.nextFor(s, MARCUS);   /* his job, IN-1001: the receive goes in hand */
  before = snap(s);
  d = turn(s, MARCUS, 'done', env('complete'));
  check('receiving: voice guides to the Receiving screen, stages nothing, posts nothing', /signed act/.test(d.say) && !d.stage && d.guide && d.guide.href === '#/receiving' &&
    d.guide.shipmentId === 'IN-1001' && snap(s) === before);
  d = turn(s, MARCUS, 'yes', null, null);
  check('receiving: a yes after it signs nothing', !d.run && snap(s) === before);
  /* a load in hand: pick and pack ORD-502 first */
  s = fresh();
  W.complete(s, 't-pick-ORD-502-C-02', { by: GRACE, qty: 8 });
  W.complete(s, 't-pack-ORD-502', { by: GRACE });
  W.nextFor(s, GRACE);   /* ORD-502 is Grace's job: its load is hers next */
  cur = W.currentOf(s, GRACE);
  before = snap(s);
  d = turn(s, GRACE, 'loaded, done', env('complete'));
  check('load: voice points to Pack & Ship, stages nothing, signs nothing', cur && cur.type === 'load' && /signed act/.test(d.say) && !d.stage &&
    d.guide && d.guide.href === '#/ship' && snap(s) === before);
  check('load: even a forged staged load is refused at run time', V.run(s, { kind: 'complete', unitId: GRACE, taskId: cur.id, title: cur.title, plan: {} }).ok === false && snap(s) === before);

  /* ---------- Step 2: cycle count spoken and confirmed ---------- */
  s = fresh();
  W.cycleCount(s, ['B-04'], { by: 'u-sam', reason: 'test' });
  var cc = s.tasks.filter(function (t) { return t.type === 'count'; })[0];
  /* the count is a Cycle Count job: dealt the moment it appears to
     Jay, the free unit in that department */
  check('count: the new count job is dealt to Jay (Cycle Count, free)', cc.queuedFor === JAY);
  W.nextFor(s, JAY);
  before = snap(s);
  d = turn(s, JAY, 'counted 38', env('complete'));
  check('count: the spoken count is staged and read back — zero mutation', !!d.stage && /count 38 × Rice — bags/.test(d.say) && snap(s) === before);
  d = turn(s, JAY, 'yes', null, d.stage);
  var cnt = s.wms.counts[s.wms.counts.length - 1];
  check('count: yes posts the count through the WMS path, attributed by voice', d.result.ok && cnt && cnt.binId === 'B-04' && cnt.by === JAY &&
    binQty(s, 'B-04', 'Rice — bags') === 38 && task(s, cc.id).via === 'voice');
  s = fresh();
  W.cycleCount(s, ['A-04'], { by: 'u-sam' });
  cc = s.tasks.filter(function (t) { return t.type === 'count'; })[0];
  W.nextFor(s, JAY);
  d = turn(s, JAY, 'counted twelve', env('complete'));
  check('count: a bin with more than one item asks (screen entry), never guesses which item', /more than one item/.test(d.say) && !d.stage);

  /* ---------- Step 2: replenishment and bin-to-bin moves ---------- */
  s = fresh();
  var mv = W.createMove(s, { fromBinId: 'B-04', toBinId: 'B-05', desc: 'Rice — bags', qty: 5 }, 'u-sam');
  /* both Replenishment hands are busy, so the move job waits in the
     pool: a manager gives it to Rosa, and she finishes the job she
     held first, so the move is next in her hands */
  W.reassignJob(s, W.jobOf(s, mv.taskId).id, ROSA, 'u-sam');
  W.complete(s, 't-consolidate-Tomato sauce — cases', { by: ROSA });
  W.nextFor(s, ROSA);
  d = turn(s, ROSA, 'moved it, done', env('complete'));
  var b5 = binQty(s, 'B-05', 'Rice — bags');
  d = turn(s, ROSA, 'confirm', null, d.stage);
  check('move: staged, then yes moves the stock through the WMS path', d.result.ok && task(s, mv.taskId).status === 'done' && binQty(s, 'B-05', 'Rice — bags') === b5 + 5);
  s = fresh();
  /* take B-04 below its min (25) so the WMS layer deals a replenishment */
  E.binById(s, 'B-04').contents.forEach(function (c) { if (c.desc === 'Rice — bags') c.qty = 20; });
  E.binById(s, 'B-05').contents.push({ desc: 'Rice — bags', qty: 30 });
  W.refresh(s);
  var rp = s.tasks.filter(function (t) { return t.type === 'replen' && t.status !== 'done'; })[0];
  check('replenishment task dealt by the WMS layer', !!rp);
  if (rp) {
    W.reassignJob(s, W.jobOf(s, rp.id).id, ROSA, 'u-sam');
    W.complete(s, 't-consolidate-Tomato sauce — cases', { by: ROSA });
    W.nextFor(s, ROSA);
    d = turn(s, ROSA, 'replenished', env('complete'));
    var face = binQty(s, rp.toBinId, rp.desc);
    d = turn(s, ROSA, 'yes', null, d.stage);
    check('replenishment: staged, then yes replenishes through the WMS path', d.result.ok && task(s, rp.id).status === 'done' && binQty(s, rp.toBinId, rp.desc) > face);
  }

  /* ---------- Step 2: report a problem by voice ---------- */
  s = fresh();
  before = snap(s);
  d = turn(s, TOMMY, 'there is oil leaking by B-03', env('problem'));
  check('problem: stages a flag with the words verbatim — nothing filed yet', !!d.stage && d.stage.kind === 'flag' && d.stage.zone === 'B' &&
    /^File a flag with your words: "there is oil leaking by B-03"\?/.test(d.say) && snap(s) === before);
  d = turn(s, TOMMY, 'yes', null, d.stage, 'Oil leak');
  var fl = s.wms.flags[s.wms.flags.length - 1];
  check('problem: yes files it the console\'s way — label, exact words, voice source, zone from the words', d.result.ok && fl.label === 'Oil leak' &&
    fl.words === 'there is oil leaking by B-03' && fl.source === 'voice' && fl.zone === 'B');
  s = fresh();
  before = snap(s);
  d = turn(s, 'u-jay', 'the forklift is leaking oil by B-03', env('problem'));
  check('problem: the zone comes from the words, not where the reporter stands (Jay is Zone C)', d.stage && d.stage.zone === 'B');
  d = turn(s, 'u-jay', 'something is broken over here', env('problem'));
  check('problem: no place in the words and no task in hand — asks where, files nothing', /^Where is it\?/.test(d.say) && !d.stage && snap(s) === before);
  W.nextFor(s, TOMMY);
  before = snap(s);
  d = turn(s, TOMMY, 'done, but the bag is torn', env('complete'));
  check('problem beats done: a report with a completion word stages a flag, never a close', d.stage && d.stage.kind === 'flag' && snap(s) === before);
  d = turn(s, TOMMY, 'no', null, d.stage);
  check('problem: no drops it — nothing filed', /^Not filed/.test(d.say) && snap(s) === before);

  /* ---------- the model's yes / no ---------- */
  s = fresh();
  W.nextFor(s, PRIYA);
  d = turn(s, PRIYA, 'picked 10', env('complete'));
  var st2 = d.stage;
  d = V.decide(s, PRIYA, 'sure thing', env('confirm'), st2);
  check('a yes in other words (the model reads it as confirm, no local word against it) runs', !!d.run);
  d = V.decide(s, PRIYA, 'no, sure', env('confirm'), st2);
  check('a local no beats the model\'s confirm', !d.run && /^Left open/.test(d.say));
  d = V.decide(s, PRIYA, 'nothing in hand?', null, null);
  check('offline: unknown words do nothing', /Didn't catch an instruction/.test(d.say) && !d.stage);

  /* ---------- the envelope (wms-ai.js workTurn) ---------- */
  function stub(replies) {
    var calls = [];
    var fn = function (url, init) {
      calls.push(JSON.parse(init.body));
      var r = replies.shift();
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ choices: [{ message: { content: typeof r === 'string' ? r : JSON.stringify(r) } }] }); } });
    };
    fn.calls = calls;
    return fn;
  }
  s = fresh();
  W.nextFor(s, PRIYA);
  var f = stub([{ intent: 'complete', about: 'current', say: 'Nice work.' }]);
  var r = await AI.workTurn(f, V.context(s, PRIYA, null), 'picked 10');
  var body = f.calls[0];
  check('envelope: system prompt is the work prompt; the context carries the task in hand and the words verbatim',
    body.messages[0].content === AI.WORK_PROMPT && /Task in hand: Pick 10 × Rice — bags from Bin B-04/.test(body.messages[1].content) &&
    /THE WORKER SAID \(verbatim\):\npicked 10$/.test(body.messages[1].content));
  check('envelope: intent, about and words come back', r.intent === 'complete' && r.about === 'current' && r.say === 'Nice work.');
  f = stub([{ intent: 'close_task', say: 'x' }, { intent: 'answer', say: 'Here.' }]);
  r = await AI.workTurn(f, {}, 'hello');
  check('envelope: an unknown intent is refused (retried once)', r.intent === 'answer' && f.calls.length === 2);
  check('envelope: a completion with no "about" reads as unclear (asks)', AI.acceptWork({ intent: 'complete', say: 'ok' }).about === 'unclear');
  var pend = V.context(s, PRIYA, { question: 'Mark "X" complete?' });
  check('envelope: a pending question is in the context', /Waiting for the worker's yes or no: Mark "X" complete\?/.test(JSON.parse(AI.workBody(pend, 'yes')).messages[1].content));
  var threw = false;
  try { await AI.workTurn(stub([]), {}, '   '); } catch (e) { threw = /Nothing was heard/.test(e.userMessage); }
  check('envelope: empty words never reach the model', threw);

  /* ---------- the central agent stays mutation-free ---------- */
  var src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'central-agent.js'), 'utf8');
  check('the central agent does not load the voice act module', src.indexOf('wms-voice') === -1 && src.indexOf('WitnessWmsVoice') === -1);

  console.log('\n' + passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})();
