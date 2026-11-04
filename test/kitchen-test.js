/* kitchen-test.js — node, no dependencies.
   The kitchen world (data/kitchen-world.js), its world dispatch
   (js/world-select.js), and the receipt intake (js/kitchen.js): the
   read through js/bol.js with fetch stubbed, spots by rule, the scan
   creating the shipment and one putaway task per item, voice
   corrections, and the honest failures.
   Run: node test/kitchen-test.js   (exit 0 = all pass) */
'use strict';

var E = require('../js/engine.js');
var C = require('../js/converse.js');
var B = require('../js/bol.js');
var K = require('../js/kitchen.js');
var G = require('../js/glasses.js');
var W = require('../js/world-select.js');
var KSEED = require('../data/kitchen-world.js');

var failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
  if (!cond) failures++;
}
function kitchen() { var s = JSON.parse(JSON.stringify(KSEED)); E.generateTasks(s); return s; }
function reply(obj) {
  var text = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return { ok: true, status: 200, json: function () { return Promise.resolve({ choices: [{ message: { content: text } }] }); } };
}
function stubFetch(replies) {
  var calls = [];
  var f = function (url, opts) { calls.push({ url: url, body: opts.body }); return Promise.resolve(replies[Math.min(calls.length - 1, replies.length - 1)]); };
  f.calls = calls;
  return f;
}
var RULES = KSEED.destinationRules;
var spot = function (name, meta) { return K.spotFor(RULES, name, meta); };

var SAMPLE = {
  receipt: true,
  items: [
    { printed: 'GV 2% MLK GAL', name: '2% milk', qty: 1, type: 'refrigerated' },
    { printed: 'MARIE C CHKN POT PIE FRZ', name: 'frozen chicken pot pie meal', qty: 2, type: 'frozen' },
    { printed: 'BARILLA PENNE', name: 'penne pasta', qty: 3, type: 'dry-goods' },
    { printed: 'LYSOL SPRAY', name: 'Lysol disinfecting spray cleaner', qty: 1, type: 'household' },
    { printed: 'FOLGERS', name: 'Folgers coffee', qty: 1, type: 'bakery-snacks-coffee' },
    { printed: 'MOCHI 6CT', name: 'mochi', qty: 1, type: 'frozen' }
  ],
  not_read: ['line 7 — smudged, price $2.19']
};

var tasksDone = [];

/* --- the world ------------------------------------------------------- */
var k = kitchen();
check('kitchen: one staging door, the Counter', k.doors.length === 1 && k.doors[0].id === 'Counter');
check('kitchen: one zone, Kitchen', k.zones.join() === 'Kitchen');
check('kitchen: the five storage spots', k.bins.map(function (b) { return b.id; }).join() === 'Cabinet A,Cabinet B,Pantry,Fridge,Freezer');
check('kitchen: William is the worker', k.labor.length === 1 && k.labor[0].name === 'William' && k.labor[0].role === 'worker');
check('kitchen: no inbound shipment and an empty counter at the start', k.inbound.length === 0 && k.staging.length === 0);
check('kitchen: no work before the scan', k.tasks.length === 0);
check('kitchen: the state says which world it is', k.world === 'kitchen');

/* --- world dispatch --------------------------------------------------- */
check('dispatch: ?world=kitchen picks the kitchen', W.worldFromSearch('?world=kitchen') === 'kitchen');
check('dispatch: no parameter is the warehouse', W.worldFromSearch('') === 'warehouse');
check('dispatch: an unknown world is the warehouse', W.worldFromSearch('?world=moon') === 'warehouse');
check('dispatch: the warehouse seed carries no marker and counts as the warehouse', W.stateWorld(E.seedWorld()) === 'warehouse');
var sw = W.checkWorld(E.seedWorld(), 'kitchen');
check('dispatch: a warehouse state on a kitchen page is not used', sw.state === null && sw.switched === true);
check('dispatch: and the switch is said in plain words', /Switched to the kitchen world/.test(sw.notice) && /warehouse/.test(sw.notice));
var same = W.checkWorld(k, 'kitchen');
check('dispatch: the same world keeps its state, no notice', same.state === k && !same.notice);
check('dispatch: nothing saved yet is not a switch', W.checkWorld(null, 'kitchen').switched === false);

/* --- spots by rule ---------------------------------------------------- */
check('rule: milk → Fridge (exact item rule)', spot('2% milk').spot === 'Fridge' && spot('2% milk').source === 'item rule');
check('rule: ice cream → Freezer (exact item rule)', spot('vanilla ice cream').spot === 'Freezer' && spot('vanilla ice cream').source === 'item rule');
check('rule: a frozen meal → Freezer', spot('frozen chicken pot pie meal').spot === 'Freezer');
check('rule: frozen beats fresh meat', spot('frozen chicken breasts').spot === 'Freezer');
check('rule: pasta → Pantry', spot('penne pasta').spot === 'Pantry');
check('rule: cleaning spray → Cabinet B', spot('disinfecting spray cleaner').spot === 'Cabinet B');
check('rule: eggs → Fridge', spot('large eggs').spot === 'Fridge');
check('rule: produce → Fridge', spot('strawberries').spot === 'Fridge');
check('rule: bananas are the exception that lives out', spot('bananas').spot !== 'Fridge');
check('rule: bread → Cabinet A', spot('wheat bread').spot === 'Cabinet A');
check('rule: coffee → Cabinet A', spot('Folgers coffee').spot === 'Cabinet A');
check('rule: peanut butter is not butter (exact first)', spot('peanut butter').spot === 'Pantry');
check('rule: whole words only — "pecans" is not "can"', spot('pecans', null).spot === null);
var unknown = spot('mochi', 'frozen');
check('rule: an item no rule covers is classified by META from its name', unknown.spot === 'Freezer' && unknown.source === 'META');
check('rule: no rule and no META type → no spot decided (never guessed)', spot('mochi', null).spot === null);

/* --- the read: bol.js reused, receipt prompt ---------------------------- */
var body = JSON.parse(K.receiptBody(B, 'data:image/jpeg;base64,AAAA'));
check('read: the body is bol.js\'s readBody (max_tokens 6000)', body.max_tokens === 6000);
check('read: the receipt prompt is the system message', body.messages[0].content === K.RECEIPT_PROMPT);
check('read: the photo rides as a data: image part', body.messages[1].content[1].image_url.url.indexOf('data:') === 0);

var f1 = stubFetch([reply('```json\n' + JSON.stringify(SAMPLE) + '\n```')]);
K.readReceipt(B, f1, 'https://w/chat', K.receiptBody(B, 'data:image/jpeg;base64,AAAA')).then(function (r) {
  check('read: a fenced reply parses', r.ok && r.items.length === 6);
  check('read: items keep printed text and name', r.items[0].printed === 'GV 2% MLK GAL' && r.items[0].name === '2% milk');
  check('read: quantities come through', r.items[2].qty === 3);
  check('read: what was not read is listed, not dropped', r.notRead.length === 1 && /smudged/.test(r.notRead[0]));

  /* --- the scan creates the work --------------------------------------- */
  var s = kitchen();
  check('intake mode: before any shipment, a capture is a receipt read', K.isIntakeMode(s));
  check('intake mode: never in the warehouse world', !K.isIntakeMode(E.seedWorld()));
  var res = K.createRun(E, s, r, 'u-william');
  check('scan: creates the job at the Counter, under its creation name', res.ok && s.inbound.length === 1 && s.inbound[0].door === 'Counter' && /Groceries putaway/.test(s.inbound[0].desc));
  check('scan: the run carries the job name made at creation', s.inbound[0].jobName === 'Groceries putaway' && K.JOB_NAME === 'Groceries putaway');
  check('scan: the run is received from exactly the read items', s.inbound[0].status === 'received' && s.inbound[0].lines.length === 6);
  var puts = s.tasks.filter(function (t) { return t.type === 'putaway'; });
  check('scan: one putaway task per item, automatically', puts.length === 6 && res.created.length === 6);
  function target(name) { var c = res.created.filter(function (x) { return x.item === name; })[0]; return c && c.spot; }
  check('scan: milk task → Fridge', target('2% milk') === 'Fridge');
  check('scan: frozen meal task → Freezer', target('frozen chicken pot pie meal') === 'Freezer');
  check('scan: pasta task → Pantry', target('penne pasta') === 'Pantry');
  check('scan: cleaning spray task → Cabinet B', target('Lysol disinfecting spray cleaner') === 'Cabinet B');
  check('scan: the unknown item went where META classified it', target('mochi') === 'Freezer' &&
    res.created.filter(function (x) { return x.item === 'mochi'; })[0].source === 'META');
  check('scan: every task targets its assigned spot in the engine', res.created.every(function (c) {
    return E.taskById(s, c.taskId).toBinId === c.spot;
  }));
  check('scan: quantities carried onto the tasks', /Put away 3 × penne pasta/.test(E.taskById(s, res.created[2].taskId).title));
  check('scan: the record says the receipt created it, with what was not read',
    s.records.some(function (rec) { return rec.intake === 'receipt-scan' && /not read: line 7/.test(rec.text); }));
  var lines = K.intakeLines(res);
  check('scan: META answers the intake with exactly the creation line',
    JSON.stringify(lines) === JSON.stringify(["Tasks have been created. Say 'Start Groceries putaway' to start tasks."]));
  check('scan: the creation line is one line — no item list, no not-read list rides along',
    lines.length === 1 && lines[0].indexOf('→') === -1 && lines[0].indexOf('Not read') === -1);
  check('scan: after the run exists, a capture is the ordinary photo scan', !K.isIntakeMode(s));
  check('scan: a second receipt cannot silently add a run', K.createRun(E, s, r, 'u-william').ok === false && s.inbound.length === 1);

  /* --- the run is the ordinary queue, by voice -------------------------- */
  var will = E.unitById(s, 'u-william');
  var turn = C.workerTurn(E, s, will, C.matchIntent("what's next"));
  check('queue: "what\'s next" gives William a putaway task', turn.acted && will.currentTaskId && /^t-putaway-STG-RUN-1-/.test(will.currentTaskId));

  /* --- voice correction -------------------------------------------------- */
  check('correction: "coffee goes in Cabinet B" parses', JSON.stringify(K.parseCorrection('coffee goes in Cabinet B')) === '{"item":"coffee","spot":"Cabinet B"}');
  check('correction: "put the pasta in the fridge" parses', K.parseCorrection('put the pasta in the fridge').spot === 'Fridge');
  check('correction: speech "cabinet bee" is Cabinet B', K.parseCorrection('the coffee goes in cabinet bee').spot === 'Cabinet B');
  check('correction: a non-spot is not a correction', K.parseCorrection('the wrap goes on the pallet') === null);
  check('correction: a problem report is not a correction', K.parseCorrection('the milk is leaking') === null);
  var coffee = res.created.filter(function (x) { return x.item === 'Folgers coffee'; })[0];
  var cr = K.applyCorrection(E, s, K.parseCorrection('coffee goes in Cabinet B'), 'u-william', 'coffee goes in Cabinet B');
  check('correction: the coffee task retargets to Cabinet B', cr.ok && E.taskById(s, coffee.taskId).toBinId === 'Cabinet B');
  check('correction: logged on the task', (E.taskById(s, coffee.taskId).notes || []).some(function (n) { return /Cabinet A → Cabinet B/.test(n.text); }));
  check('correction: logged on the record, with his words', s.records.some(function (rec) { return rec.kind === 'correction' && /said: "coffee goes in Cabinet B"/.test(rec.text); }));
  check('correction: an item not on the run changes nothing', K.applyCorrection(E, s, { item: 'caviar', spot: 'Fridge' }, 'u-william').ok === false);
  /* Done tasks are not retargeted. */
  var ct = E.taskById(s, coffee.taskId);
  if (will.currentTaskId) { E.taskById(s, will.currentTaskId).status = 'open'; E.taskById(s, will.currentTaskId).assignee = null; will.currentTaskId = null; }
  ct.status = 'assigned'; ct.assignee = 'u-william'; will.currentTaskId = ct.id;
  E.completeTask(s, ct.id);
  check('correction: completing puts the coffee where the correction said', E.binById(s, 'Cabinet B').contents.some(function (c) { return c.desc === 'Folgers coffee'; }));
  check('correction: a done task is not retargeted, and says so', /already put away in Cabinet B/.test(K.applyCorrection(E, s, { item: 'coffee', spot: 'Pantry' }, 'u-william').lines[0]));

  /* --- honest failures --------------------------------------------------- */
  var bad = stubFetch([reply({ receipt: false, items: [], not_read: ['a photo of a cat'] })]);
  return K.readReceipt(B, bad, 'https://w/chat', 'x').then(function (r2) {
    var s2 = kitchen();
    var res2 = K.createRun(E, s2, r2, 'u-william');
    check('unreadable: says so plainly', !r2.ok && /doesn't look like a readable receipt/.test(r2.reason) && /cat/.test(r2.reason));
    check('unreadable: creates nothing', !res2.ok && s2.inbound.length === 0 && s2.tasks.length === 0 && s2.staging.length === 0 && s2.records.length === 0);
    check('unreadable: the world stays in intake mode', K.isIntakeMode(s2));
    var empty = stubFetch([reply(''), reply('')]);
    return K.readReceipt(B, empty, 'https://w/chat', 'x').then(function () {
      check('empty twice: rejects', false);
    }, function (e) {
      check('empty twice: one retry, then bol.js\'s honest error', empty.calls.length === 2 && e.code === 'empty' && !!e.userMessage);
    });
  }).then(function () {
    var wrong = stubFetch([reply({ carrier: 'x' }), reply(SAMPLE)]);
    return K.readReceipt(B, wrong, 'https://w/chat', 'x').then(function (r3) {
      check('wrong shape: retried once, then read', wrong.calls.length === 2 && r3.ok && r3.items.length === 6);
    });
  }).then(function () {
    var partial = K.parseReceipt({ receipt: true, items: [{ printed: '', name: '' }, { printed: 'EGGS LG', name: 'large eggs', qty: 'x' }], not_read: [] });
    check('partial: a line with no name goes to "not read", never guessed', partial.items.length === 1 && /item 1/.test(partial.notRead[0]));
    check('partial: an unreadable quantity counts as 1', partial.items[0].qty === 1);
    var big = stubFetch([{ ok: false, status: 413, json: function () { return Promise.resolve({}); } }]);
    return K.readReceipt(B, big, 'https://w/chat', 'x').then(function () { check('413: rejects', false); },
      function (e) { check('413: honest too-large error, nothing parsed', e.code === 'too-large'); });
  });
}).then(function () {
  /* --- the run by voice: terse advances, run-relative chips ----------
     William's live-test rulings (2026-11-04): the run is one master
     task, the voice says only "Next: <product>.", the product rides
     in the glance, and the count runs inside the run. */
  var s3 = kitchen();
  var f3 = stubFetch([reply('```json\n' + JSON.stringify(SAMPLE) + '\n```')]);
  return K.readReceipt(B, f3, 'https://w/chat', 'x').then(function (r3) {
    var res3 = K.createRun(E, s3, r3, 'u-william');
    var will3 = E.unitById(s3, 'u-william');
    C.workerTurn(E, s3, will3, C.matchIntent("what's next"));
    var ch1 = G.chipsFor(E, s3, will3);
    check('run chips: the count runs inside the run', ch1.task === 'Task 1 of 6');
    check('run chips: the product is in the glance', ch1.item === res3.created[0].item && ch1.bin === 'Bin ' + res3.created[0].spot);
    var spoke = [], lastLines = null;
    for (var k = 0; k < 6; k++) {
      var tk = C.workerTurn(E, s3, will3, C.matchIntent('done'));
      spoke.push(tk.spoken);
      lastLines = tk.lines;
      if (k === 1) {
        var ch3 = G.chipsFor(E, s3, will3);
        check('run chips: mid-run count and product', ch3.task === 'Task 3 of 6' && ch3.item === res3.created[2].item);
      }
    }
    check('voice: each advance speaks exactly "Next: <product>."',
      [0, 1, 2, 3, 4].every(function (k2) {
        return JSON.stringify(spoke[k2]) === JSON.stringify(['Next: ' + res3.created[k2 + 1].item + '.']);
      }));
    check('voice: no advance ever speaks a Closed line or a full title',
      spoke.every(function (sp) {
        return sp.every(function (l) { return l.indexOf('Closed:') !== 0 && l.indexOf('Put away') === -1; });
      }));
    check('voice: the last item closes the job, in its name', JSON.stringify(spoke[5]) === JSON.stringify(['Groceries putaway complete.']));
    check('voice: the screen lines keep the full wording the record needs',
      lastLines[0].indexOf('Closed: Put away') === 0 && /caught up/.test(lastLines[1]));
    check('run: the engine agrees the shipment is closed', E.inboundStage(s3, s3.inbound[0]).key === 'closed');
  });
}).then(function () {
  /* --- the creation protocol: named, announced, started ---------
     William (2026-11-04): when the app creates tasks they group
     under a job named at creation; META announces the start word;
     saying it picks a task — unless the wearer names a product. */
  var s4 = kitchen();
  var f4 = stubFetch([reply('```json\n' + JSON.stringify(SAMPLE) + '\n```')]);
  return K.readReceipt(B, f4, 'https://w/chat', 'x').then(function (r4) {
    var res4 = K.createRun(E, s4, r4, 'u-william');
    var will4 = E.unitById(s4, 'u-william');
    check('start: nothing is in hand before the word is said', !will4.currentTaskId);
    var t0 = C.workerTurn(E, s4, will4, C.matchIntent('start'));
    check('start: "start" pulls the job\'s first task', t0.acted && will4.currentTaskId === res4.created[0].taskId);
    check('start: spoken is exactly "Next: <first item>."',
      JSON.stringify(t0.spoken) === JSON.stringify(['Next: ' + res4.created[0].item + '.']));
    check('start: the screen line keeps the full task wording',
      t0.lines.some(function (l) { return l.indexOf('Next: Put away') === 0; }));
    var heldId = will4.currentTaskId;
    var t0b = C.workerTurn(E, s4, will4, C.matchIntent('start groceries putaway'));
    check('start: saying the job\'s name mid-job keeps the task in hand',
      will4.currentTaskId === heldId && !t0b.closed && /Still yours/.test(t0b.lines[0]));
  }).then(function () {
    var s5 = kitchen();
    var f5 = stubFetch([reply('```json\n' + JSON.stringify(SAMPLE) + '\n```')]);
    return K.readReceipt(B, f5, 'https://w/chat', 'x').then(function (r5) {
      var res5 = K.createRun(E, s5, r5, 'u-william');
      var will5 = E.unitById(s5, 'u-william');
      var pasta = res5.created[2];
      var t1 = C.workerTurn(E, s5, will5, C.matchIntent('start with penne pasta'));
      check('start: "start with <a later product>" starts at that product',
        will5.currentTaskId === pasta.taskId && pasta.taskId !== res5.created[0].taskId &&
        JSON.stringify(t1.spoken) === JSON.stringify(['Next: penne pasta.']));
    });
  }).then(function () {
    var s6 = kitchen();
    var will6 = E.unitById(s6, 'u-william');
    var t2 = C.workerTurn(E, s6, will6, C.matchIntent('start groceries putaway'));
    check('start: with no job created, spoken is "No work waiting."',
      JSON.stringify(t2.spoken) === JSON.stringify(['No work waiting.']) && !t2.next);
  });
}).then(function () {
  console.log('---');
  console.log(failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
}).catch(function (e) {
  console.log('FAIL  test crashed: ' + (e && e.stack));
  process.exit(1);
});
