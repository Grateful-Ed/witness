/* converse-read-test.js — node, no dependencies.
   The converse model step (briefs/claude-brief-converse-model-step.md):
     - the model envelope (js/wms-ai.js converseTurn): its body, its
       accept, null on every failure;
     - the read turn's adjudication (js/converse.js readWorker /
       readTurn): agreement proceeds; code-unknown + model-intent
       proceeds; a stark disagreement asks ONCE, records nothing, and
       the answer is weighed with the original words; a second
       ambiguity is said honestly, never asked again; a plain yes / no
       with no stage is inert;
     - the outage (note 40): "AI is currently down." — nothing staged,
       nothing run; a pending stage dies unrun, the next yes is inert;
     - the pull retirement: an ask for work with nothing assigned is
       answered "Nothing is assigned to you right now."; no task moves;
     - the signature on converse: a spoken done on a receive and on a
       load task is refused with the desk guidance, the task stays;
     - the kitchen correction's model step (js/kitchen.js
       settleCorrection): a validated reading retargets; an unlandable
       one retargets nothing; the outage retargets nothing;
     - parity: the phone and the warehouse page take the same reading
       path as the glasses (same words, same decision).
   The model is stubbed at the fetch boundary; no network.
   Run: node test/converse-read-test.js   (exit 0 = all pass) */
'use strict';

var fs = require('fs');
var path = require('path');
var E = require('../js/engine.js');
var C = require('../js/converse.js');
var AI = require('../js/wms-ai.js');
var Gt = require('../js/gate.js');
var B = require('../js/bol.js');
var K = require('../js/kitchen.js');
var KSEED = require('../data/kitchen-world.js');

var passes = 0, failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
  if (cond) passes++; else failures++;
}

function fresh() { var s = E.seedWorld(); E.generateTasks(s); return s; }
function snap(s) { return JSON.stringify(s); }
function give(world, u, type) {
  var t = world.tasks.filter(function (x) {
    return x.status === 'open' && (type ? x.type === type : x.type !== 'receive' && x.type !== 'load') && !E.blockedBy(world, x);
  })[0];
  t.status = 'assigned'; t.assignee = u.id; u.currentTaskId = t.id;
  return t;
}
function reply(obj) {
  var text = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return { ok: true, status: 200, json: function () { return Promise.resolve({ choices: [{ message: { content: text } }] }); } };
}
/* A model that answers each call from a list (the last repeats). */
function model(replies) {
  var calls = [];
  var f = function (url, opts) {
    calls.push({ url: url, body: JSON.parse(opts.body) });
    var r = replies[Math.min(calls.length - 1, replies.length - 1)];
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(typeof r === 'function' ? r() : reply(r));
  };
  f.calls = calls;
  return f;
}
function says(intent, startText) { return { intent: intent, startText: startText || '' }; }
var DOWN = function () { return Promise.reject(new Error('offline')); };
function userOf(call) { return call.body.messages[1].content; }

var chain = Promise.resolve();
function step(fn) { chain = chain.then(fn); }

/* ================= the envelope ================================== */
step(function () {
  var body = JSON.parse(AI.converseBody({ inHand: { title: 'Pick 4 × Peaches', type: 'pick' }, assigned: ['Pick 4 × Peaches'], pending: 'Pick 4 × Peaches' }, 'yes'));
  var u = body.messages[1].content;
  check('envelope: the context carries the task in hand (title, type), the assigned list, and the pending stage',
    /Task in hand: Pick 4 × Peaches \(pick\)/.test(u) && /Assigned to the worker:\n1\. Pick 4 × Peaches/.test(u) &&
    /A question is waiting/.test(u) && /THE WORKER SAID \(verbatim\):\nyes$/.test(u));
  check('envelope: the intent set is exactly the converse set', AI.CONVERSE_INTENTS.join(',') === 'done,problem,start,next,confirm,deny,unknown');
  var cb = JSON.parse(AI.converseBody({ inHand: null, assigned: [], clarify: { words: 'done', question: 'Did you mean x, or y?' } }, 'the first'));
  check('envelope: a waiting clarification carries the first words and the question',
    /The worker first said: "done"/.test(cb.messages[1].content) && /Did you mean x, or y\?/.test(cb.messages[1].content));
  check('envelope: accept keeps a known intent and start words only for start',
    JSON.stringify(AI.acceptConverse({ intent: 'start', startText: ' with the milk ' })) === '{"intent":"start","startText":"with the milk"}' &&
    AI.acceptConverse({ intent: 'done', startText: 'x' }).startText === '' &&
    AI.acceptConverse({ intent: 'pull' }) === null && AI.acceptConverse({}) === null && AI.acceptConverse([]) === null);
  var bad = model(['not json at all']);
  return Promise.all([
    AI.converseTurn(model([says('done')]), {}, 'done'),
    AI.converseTurn(bad, {}, 'done'),
    AI.converseTurn(DOWN, {}, 'done'),
    AI.converseTurn(function () { return Promise.resolve({ ok: false, status: 500 }); }, {}, 'done'),
    AI.converseTurn(null, {}, 'done')
  ]).then(function (r) {
    check('envelope: a good reply resolves the intent', r[0] && r[0].intent === 'done');
    check('envelope: an unusable reply resolves null (asked twice, nothing guessed)', r[1] === null && bad.calls.length === 2);
    check('envelope: unreachable, an HTTP error, or no fetch — null, never a throw', r[2] === null && r[3] === null && r[4] === null);
  });
});

/* ================= adjudication =================================== */
step(function () {
  C.clearStages();
  var s = fresh(), u = E.unitById(s, 'u-marcus'), t = give(s, u);
  var before = snap(s);
  var f = model([says('done')]);
  return C.readTurn(E, s, u, 'done', { fetch: f }).then(function (turn) {
    check('agree: model and code both read "done" → the close is staged and asked; nothing moved',
      turn.staged && turn.staged.id === t.id && snap(s) === before && C.pendingStage('u-marcus').taskId === t.id);
    check('agree: the model saw the task in hand and the assigned list', /Task in hand: /.test(userOf(f.calls[0])) && userOf(f.calls[0]).indexOf(t.title) !== -1);
    return C.readTurn(E, s, u, 'yes', { fetch: model([says('confirm')]) });
  }).then(function (turn) {
    check('agree: the yes (both readings confirm) closes through the gate',
      turn.closed && t.status === 'done' && t.via === 'converse' && t.heard === 'yes');
    check('pull retired: the close is followed by "Nothing is assigned to you right now." — no task moves',
      !turn.next && !u.currentTaskId && turn.lines[1] === 'Nothing is assigned to you right now.');
  });
});

step(function () {
  C.clearStages();
  var s = fresh(), u = E.unitById(s, 'u-marcus'), t = give(s, u);
  check('code-unknown: the regexes miss "that one\'s sorted"', C.matchIntent("that one's sorted").intent === 'unknown');
  return C.readTurn(E, s, u, "that one's sorted", { fetch: model([says('done')]) }).then(function (turn) {
    check('code-unknown + model-intent: proceeds with the model\'s intent (the close is staged)', turn.staged && turn.staged.id === t.id);
    C.clearStages();
  });
});

step(function () {
  C.clearStages();
  var s = fresh(), u = E.unitById(s, 'u-marcus'), t = give(s, u);
  var before = snap(s);
  var f = model([says('problem'), says('done')]);
  return C.readTurn(E, s, u, 'done', { fetch: f }).then(function (turn) {
    check('disagree: one clarification naming both readings, in plain words',
      turn.clarify === 'Did you mean you\'re done with this one, or that there\'s a problem?' &&
      turn.lines[0] === 'Did you mean you\'re done with this one, or that there\'s a problem? Nothing was done yet.');
    check('disagree: nothing staged, nothing recorded — the state is byte-identical', !turn.acted && !turn.staged && snap(s) === before && C.pendingStage('u-marcus') === null);
    check('disagree: the clarification lives in module memory, never in the saved state',
      !!C.pendingClarification('u-marcus') && snap(s).indexOf('Did you mean') === -1);
    return C.readTurn(E, s, u, 'the first one', { fetch: f });
  }).then(function (turn) {
    var u2 = userOf(f.calls[1]);
    check('the answer is weighed with the original words (the second reading carries both)',
      /The worker first said: "done"/.test(u2) && /THE WORKER SAID \(verbatim\):\nthe first one$/.test(u2));
    check('the answer lands: the second reading\'s intent proceeds (the close is staged)', turn.staged && turn.staged.id === t.id);
    check('the clarification is gone once answered (one turn, never persisted)', C.pendingClarification('u-marcus') === null);
    C.clearStages();
  });
});

step(function () {
  C.clearStages();
  var s = fresh(), u = E.unitById(s, 'u-marcus'); give(s, u);
  var before = snap(s);
  var f = model([says('problem'), says('unknown')]);
  return C.readTurn(E, s, u, 'done', { fetch: f }).then(function () {
    return C.readTurn(E, s, u, 'hmm', { fetch: f });
  }).then(function (turn) {
    check('a second ambiguity is answered honestly — never asked twice', !turn.clarify &&
      turn.lines[0] === 'Still not sure what you meant — nothing was done.' && snap(s) === before && !C.pendingClarification('u-marcus'));
  });
});

step(function () {
  C.clearStages();
  var s = fresh(), u = E.unitById(s, 'u-marcus'), t = give(s, u);
  var before = snap(s);
  return C.readTurn(E, s, u, 'yes', { fetch: model([says('confirm')]) }).then(function (turn) {
    check('no stage: a plain yes is inert (nothing acts, nothing moves)', !turn.acted && t.status === 'assigned' && snap(s) === before && /no action taken/.test(turn.lines.join(' ')));
    return C.readTurn(E, s, u, 'no', { fetch: model([says('deny')]) });
  }).then(function (turn) {
    check('no stage: a plain no is inert', !turn.acted && snap(s) === before);
  });
});

step(function () {
  C.clearStages();
  var s = fresh(), u = E.unitById(s, 'u-marcus'), t = give(s, u);
  return C.readTurn(E, s, u, 'done', { fetch: model([says('done')]) }).then(function () {
    var before = snap(s);
    return C.readTurn(E, s, u, 'yes', { fetch: model([says('problem')]) }).then(function (turn) {
      check('a yes the readings disagree on closes nothing — the stage is left open, unrun',
        !turn.acted && t.status === 'assigned' && snap(s) === before && /^Left open: /.test(turn.lines[0]) && C.pendingStage('u-marcus') === null);
    });
  });
});

step(function () {
  C.clearStages();
  var s = fresh(), u = E.unitById(s, 'u-marcus'); give(s, u);
  return C.readWorker(E, s, u, 'what is that sign over there', { fetch: model([says('unknown')]) }).then(function (d) {
    check('a question (both readings unknown) goes to the free ask; nothing acts', d.kind === 'ask');
  });
});

/* ================= the outage (note 40) =========================== */
step(function () {
  C.clearStages();
  var s = fresh(), u = E.unitById(s, 'u-marcus'), t = give(s, u);
  var before = snap(s);
  return C.readTurn(E, s, u, 'done', { fetch: DOWN }).then(function (turn) {
    check('outage: an act turn answers exactly "AI is currently down." — nothing staged or run',
      JSON.stringify(turn.lines) === JSON.stringify(['AI is currently down.']) && !turn.staged && !turn.acted && snap(s) === before && C.pendingStage('u-marcus') === null);
    return C.readTurn(E, s, u, 'done', { fetch: model([says('done')]) });
  }).then(function (turn) {
    check('outage: staged once the model is back', turn.staged && turn.staged.id === t.id);
    return C.readTurn(E, s, u, 'yes', { fetch: DOWN });
  }).then(function (turn) {
    check('outage: a yes with the model down runs nothing — "AI is currently down."',
      JSON.stringify(turn.lines) === JSON.stringify(['AI is currently down.']) && t.status === 'assigned');
    check('outage: the pending stage caught by the outage DIED', C.pendingStage('u-marcus') === null);
    return C.readTurn(E, s, u, 'yes', { fetch: model([says('confirm')]) });
  }).then(function (turn) {
    check('outage: the next yes (model back) is inert — the dead stage never runs', !turn.acted && t.status === 'assigned' && /no action taken/.test(turn.lines.join(' ')));
  });
});

step(function () {
  C.clearStages();
  var s = fresh(), u = E.unitById(s, 'u-marcus'); give(s, u);
  return Promise.all([
    C.readWorker(E, s, u, 'what is that sign over there', { fetch: DOWN }),
    C.readWorker(E, s, u, 'done', {}) /* no fetch handed in: no model, the outage */
  ]).then(function (r) {
    check('outage: words neither reading names an act still route to the free ask (its own failure stands)', r[0].kind === 'ask' && r[0].turn.lines[0] === 'AI is currently down.');
    check('outage: a door that hands in no fetch gets the outage, never a code-only act', r[1].kind === 'say' && r[1].turn.outage === true);
  });
});

/* ================= the pull retirement ============================ */
step(function () {
  C.clearStages();
  var s = fresh(), dee = E.unitById(s, 'u-dee');
  var before = snap(s);
  return Promise.all(["what's next", 'give me something to do', 'start'].map(function (w, i) {
    return C.readTurn(E, s, dee, w, { fetch: model([says(i === 2 ? 'start' : 'next')]) });
  })).then(function (turns) {
    check('pull: "what\'s next" with nothing assigned answers exactly "Nothing is assigned to you right now."',
      JSON.stringify(turns[0].lines) === JSON.stringify(['Nothing is assigned to you right now.']));
    check('pull: any ask for work (the model reads it; the code does not) answers the same', turns[1].lines[0] === 'Nothing is assigned to you right now.');
    check('pull: "start" with no created job answers the same', turns[2].lines[0] === 'Nothing is assigned to you right now.');
    check('pull: no task changes hands — the state is byte-identical', snap(s) === before && !dee.currentTaskId);
    var r = Gt.act(s, { who: 'u-dee', via: 'converse', intent: 'pull', params: { model: true } }, { engine: E });
    check('pull: the gate refuses a pull intent on converse outright', r.ok === false && r.unknown === true && snap(s) === before);
  });
});

/* ================= the signature on converse ====================== */
step(function () {
  C.clearStages();
  var s = fresh(), u = E.unitById(s, 'u-marcus'), t = give(s, u, 'receive');
  var before = snap(s);
  return C.readTurn(E, s, u, 'done', { fetch: model([says('done')]) }).then(function (turn) {
    check('signature: a spoken done on the engine receive task is refused with the desk guidance',
      turn.lines[0] === 'Receiving is a signed act — post it on the Receiving screen. Voice does not post it. Nothing was done.' && !turn.staged);
    check('signature: the receive task stays open, in hand; nothing staged', t.status === 'assigned' && u.currentTaskId === t.id && snap(s) === before && C.pendingStage('u-marcus') === null);
  });
});

step(function () {
  C.clearStages();
  var s = fresh();
  s.tasks.filter(function (x) { return x.type === 'pick' && x.orderId === s.outbound[0].id; }).forEach(function (x) { x.status = 'assigned'; E.completeTask(s, x.id); });
  E.generateTasks(s);
  var u = E.unitById(s, 'u-jay'), t = give(s, u, 'load');
  var before = snap(s);
  return C.readTurn(E, s, u, "all done, it's loaded", { fetch: model([says('done')]) }).then(function (turn) {
    check('signature: a spoken done on a load task is refused with the desk guidance',
      t.type === 'load' && turn.lines[0] === 'Loading is a signed act — confirm it on the desk screen. Voice does not sign it. Nothing was done.');
    check('signature: the load task stays open; nothing staged', t.status === 'assigned' && snap(s) === before && C.pendingStage('u-jay') === null);
    var r = Gt.act(s, { who: 'u-jay', via: 'converse', intent: 'complete', target: t.id, params: { model: { intent: 'confirm' }, words: 'yes' }, confirmed: true }, { engine: E });
    check('signature: a forged stage (a confirmed close of the load) is refused at run time', r.ok === false && r.signed && t.status === 'assigned' && snap(s) === before);
  });
});

/* ================= the kitchen: start, the job continues, no pull === */
function kitchenRun() {
  var s = JSON.parse(JSON.stringify(KSEED)); E.generateTasks(s);
  var receipt = K.parseReceipt({ receipt: true, not_read: [], items: [
    { printed: 'COFFEE', name: 'coffee', qty: 1, type: 'bakery-snacks-coffee' },
    { printed: 'MILK', name: 'milk', qty: 1, type: 'refrigerated' }
  ] });
  K.createRun(E, s, receipt, 'u-william');
  return s;
}
step(function () {
  C.clearStages();
  var s = kitchenRun(), w = E.unitById(s, 'u-william');
  return C.readTurn(E, s, w, 'start groceries putaway', { fetch: model([says('start', 'groceries putaway')]) }).then(function (t1) {
    check('kitchen: the start takes the job\'s first task (the take path stays)', t1.acted && !!w.currentTaskId && /^Next: /.test(t1.spoken[0]));
    return C.readTurn(E, s, w, 'done', { fetch: model([says('done')]) });
  }).then(function () {
    return C.readTurn(E, s, w, 'yes', { fetch: model([says('confirm')]) });
  }).then(function (t2) {
    check('kitchen: a close inside the worker\'s own job moves to the job\'s next task (the job is theirs)',
      t2.closed && t2.next && w.currentTaskId === t2.next.id && JSON.stringify(t2.spoken) === JSON.stringify(['Next: milk.']));
    C.clearStages();
  });
});

/* ================= the kitchen correction's model step ============ */
function corrReply(c, item, spot) { return { correction: c, item: item || '', spot: spot || '' }; }
step(function () {
  var s = kitchenRun();
  var coffee = s.tasks.filter(function (t) { return t.item === 'coffee'; })[0];
  var from = coffee.toBinId;
  var target = from === 'Cabinet B' ? 'Cabinet A' : 'Cabinet B';
  var said = 'coffee goes in ' + target;
  check('correction: the code still parses the plain form (the cross-check)', K.parseCorrection(said).spot === target);
  check('correction: the code\'s look sends a spot-and-verb sentence to the read', K.mightBeCorrection('could you stash the coffee in the second cabinet please, it should be there') && !K.mightBeCorrection("what's next"));
  var f = model([corrReply(true, 'coffee', target)]);
  return K.readCorrection(B, f, 'https://w/chat', said, K.runItems(s)).then(function (reading) {
    check('correction: the read sends the run\'s items and the kitchen\'s spots', /RUN ITEMS:\n- coffee/.test(userOf(f.calls[0])[0].text) && /KITCHEN SPOTS: Cabinet A, Cabinet B, Pantry, Fridge, Freezer/.test(userOf(f.calls[0])[0].text));
    var cr = K.settleCorrection(E, s, reading, said, 'u-william');
    check('correction: agreement on a validated reading retargets', cr.ok && coffee.toBinId === target && cr.lines[0] === 'coffee now goes to ' + target + '.');
  }).then(function () {
    var s2 = kitchenRun();
    var c2 = s2.tasks.filter(function (t) { return t.item === 'coffee'; })[0];
    var said2 = 'could you stash the coffee somewhere cold, the freezer should do';
    check('correction: the code cannot parse the free phrasing', K.parseCorrection(said2) === null);
    var cr2 = K.settleCorrection(E, s2, corrReply(true, 'coffee', 'Freezer'), said2, 'u-william');
    check('correction: a model reading the code cannot parse but the kitchen validates retargets', cr2.ok && c2.toBinId === 'Freezer');
    var s3 = kitchenRun(), b3 = snap(s3);
    var cr3 = K.settleCorrection(E, s3, corrReply(true, 'bananas', 'Pantry'), 'the bananas go in the pantry', 'u-william');
    check('correction: an item not on the run is unlandable — an honest line, nothing retargeted', !cr3.ok && snap(s3) === b3 && /No "bananas" on this run/.test(cr3.lines[0]));
    var cr4 = K.settleCorrection(E, s3, corrReply(true, 'coffee', 'Garage'), 'the coffee goes in the garage', 'u-william');
    check('correction: a place that is not in the kitchen is unlandable — nothing retargeted', !cr4.ok && snap(s3) === b3);
    var cr5 = K.settleCorrection(E, s3, null, 'coffee goes in the pantry', 'u-william');
    check('correction: no model reading — "AI is currently down.", nothing retargeted', !cr5.ok && JSON.stringify(cr5.lines) === '["AI is currently down."]' && snap(s3) === b3);
    var cr6 = K.settleCorrection(E, s3, corrReply(true, 'milk', 'Pantry'), 'coffee goes in the freezer', 'u-william');
    check('correction: model and code disagree — said plainly, nothing retargeted', !cr6.ok && /I heard two things/.test(cr6.lines[0]) && snap(s3) === b3);
    check('correction: neither reading a correction — the words go on to the worker turn', K.settleCorrection(E, s3, corrReply(false), 'is the fridge cold', 'u-william') === null);
    var cr7 = K.settleCorrection(E, s3, corrReply(false), 'coffee goes in the pantry', 'u-william');
    check('correction: the code parses one but the model reads none — nothing retargeted', !cr7.ok && snap(s3) === b3);
    return K.readCorrection(B, DOWN, 'https://w/chat', 'coffee goes in the pantry', []).then(function (r) {
      check('correction: the read resolves null when META is unreachable (the outage)', r === null);
    });
  });
});

/* ================= parity: the same reading path on every door ==== */
step(function () {
  function src(f) { return fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'); }
  var phone = src('phone.js'), wui = src('warehouse-ui.js'), gl = src('glasses.js');
  var onSpeech = gl.slice(gl.indexOf('function onSpeech('), gl.indexOf('/* ---------- camera'));
  check('parity: the phone reads through C.readWorker and never runs the code read alone', /C\.readWorker\(/.test(phone) && !/C\.matchIntent\(/.test(phone));
  check('parity: the warehouse page reads through C.readWorker and never runs the code read alone', /C\.readWorker\(/.test(wui) && !/C\.matchIntent\(/.test(wui));
  check('parity: the glasses\' onSpeech reads through C.readWorker; the correction through K.settleCorrection',
    /C\.readWorker\(/.test(onSpeech) && /K\.settleCorrection\(/.test(onSpeech) && !/C\.matchIntent\(/.test(gl) && !/K\.applyCorrection\(/.test(gl));
  /* same words, same model, same world → the same decision on any door */
  var words = ['done', "what's next", 'the wrap is torn', 'how about that game'];
  return Promise.all(words.map(function (w) {
    C.clearStages();
    var a = fresh(), b = fresh(), ua = E.unitById(a, 'u-marcus'), ub = E.unitById(b, 'u-marcus');
    give(a, ua); give(b, ub);
    var m = { done: 'done', "what's next": 'next', 'the wrap is torn': 'problem', 'how about that game': 'unknown' }[w];
    return C.readWorker(E, a, ua, w, { fetch: model([says(m)]) }).then(function (da) {
      C.clearStages();
      return C.readWorker(E, b, ub, w, { fetch: model([says(m)]) }).then(function (db) {
        return da.kind === db.kind && JSON.stringify(da.match || null) === JSON.stringify(db.match || null);
      });
    });
  })).then(function (same) {
    check('parity: the same words take the same reading path to the same decision', same.every(Boolean));
    C.clearStages();
  });
});

chain.then(function () {
  console.log('');
  console.log(passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
}, function (e) {
  console.log('FAIL  crashed: ' + (e && e.stack));
  process.exit(1);
});
