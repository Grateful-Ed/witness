/* kitchen-any-receipt-test.js — William (2026-11-04, post-submission):
   "make sure that it will read and create job/task for anything. like
   other receipts, not just the one i have been using."
   Drives parseReceipt + createRun + the voice walk over hostile,
   non-demo receipts: foreign stores, unmatched items, unknown types,
   duplicates, coerced quantities, partial reads, hostile JSON shapes,
   and a 24-line receipt. Every created task must exist and carry a
   destination that is a real kitchen spot. */
'use strict';
var E = require('../js/engine.js');
var C = require('../js/converse.js');
var B = require('../js/bol.js');
var K = require('../js/kitchen.js');
var G = require('../js/glasses.js');
var KSEED = require('../data/kitchen-world.js');
var failures = 0, passes = 0;
function check(name, cond) { if (cond) { passes++; console.log('PASS  ' + name); } else { failures++; console.log('FAIL  ' + name); } }
function kitchen() { var s = JSON.parse(JSON.stringify(KSEED)); E.generateTasks(s); return s; }
function reply(obj) { var text = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return { ok: true, status: 200, json: function () { return Promise.resolve({ choices: [{ message: { content: text } }] }); } }; }
function stubFetch(replies) { var calls = []; var f = function (url, opts) { calls.push(1); return Promise.resolve(replies[Math.min(calls.length - 1, replies.length - 1)]); }; f.calls = calls; return f; }
var BINS = ['Cabinet A', 'Cabinet B', 'Pantry', 'Fridge', 'Freezer'];
function everyTaskReal(state, res) {
  return res.created.every(function (c) {
    var t = E.taskById(state, c.taskId);
    return !!t && BINS.indexOf(t.toBinId) !== -1 && c.spot === t.toBinId;
  });
}
/* Walk a run to its finish line by voice; returns the last spoken. */
function walkToEnd(state, will, n) {
  C.workerTurn(E, state, will, C.matchIntent('start groceries putaway'));
  var last = null, guard = 0;
  while (guard++ < n + 5) {
    var tk = C.workerTurn(E, state, will, C.matchIntent('done'));
    last = tk.spoken;
    if (JSON.stringify(last) === JSON.stringify(['Groceries putaway complete.'])) break;
  }
  return last;
}

/* --- 1. a foreign receipt (no demo items, several rule paths) -------- */
var FOREIGN = { receipt: true, items: [
  { printed: 'TJ QUINOA 16OZ', name: 'quinoa', qty: 1, type: 'dry-goods' },
  { printed: 'SRIRACHA 17OZ', name: 'sriracha hot sauce', qty: 1, type: 'dry-goods' },
  { printed: 'DRAGON FRUIT EA', name: 'dragon fruit', qty: 2, type: 'produce' },
  { printed: 'ALMOND MLK 64OZ', name: 'almond milk', qty: 1, type: 'refrigerated' },
  { printed: 'EDAMAME FRZ 12OZ', name: 'frozen edamame', qty: 1, type: 'frozen' },
  { printed: 'DISH SOAP RFL', name: 'dish soap refill', qty: 1, type: 'household' },
  { printed: 'GREEK YOGURT 32OZ', name: 'greek yogurt', qty: 1, type: 'refrigerated' },
  { printed: 'SOURDOUGH LOAF', name: 'sourdough loaf', qty: 1, type: 'bakery-snacks-coffee' }
], not_read: [] };
var s1 = kitchen();
var r1 = K.parseReceipt(FOREIGN);
check('foreign: the read parses', r1.ok && r1.items.length === 8);
var res1 = K.createRun(E, s1, r1, 'u-william');
check('foreign: a job is created', res1.ok && s1.inbound.length === 1 && s1.inbound[0].jobName === 'Groceries putaway');
check('foreign: one task per item, each landing in a real spot', res1.created.length === 8 && everyTaskReal(s1, res1));
check('foreign: quinoa -> Pantry (word rule)', res1.created[0].spot === 'Pantry');
check('foreign: dragon fruit -> Fridge (META produce)', res1.created[2].spot === 'Fridge');
check('foreign: dish soap -> Cabinet B (household words)', res1.created[5].spot === 'Cabinet B');
var end1 = walkToEnd(s1, E.unitById(s1, 'u-william'), 8);
check('foreign: the run walks to its finish line by voice', JSON.stringify(end1) === JSON.stringify(['Groceries putaway complete.']));
check('foreign: the counter is empty and the spots hold the goods', s1.staging.length === 0 && s1.bins.reduce(function (n, b) { return n + b.contents.length; }, 0) === 8);

/* --- 2. nothing matches anything -------------------------------------- */
var ALIEN = { receipt: true, items: [
  { printed: 'FLORP BAR', name: 'florp bar', qty: 1, type: 'unknown' },
  { printed: 'GREEBLE 3000', name: 'greeble', qty: 1 },
  { printed: 'WUZZLE', name: 'wuzzle', qty: 2, type: 'not-a-type' }
], not_read: [] };
var s2 = kitchen();
var res2 = K.createRun(E, s2, K.parseReceipt(ALIEN), 'u-william');
check('alien: unmatched items still create the job', res2.ok && res2.created.length === 3);
check('alien: every task falls back to a real spot (emptiest-bin rule)', everyTaskReal(s2, res2));
check('alien: the fallback is honest — no routing source is claimed', res2.created.every(function (c) { return c.source === null; }));
var end2 = walkToEnd(s2, E.unitById(s2, 'u-william'), 3);
check('alien: the run still finishes by voice', JSON.stringify(end2) === JSON.stringify(['Groceries putaway complete.']));

/* --- 3. refusals create nothing ---------------------------------------- */
var s3 = kitchen();
var resNo = K.createRun(E, s3, K.parseReceipt({ receipt: false, items: [], not_read: ['a parking ticket'] }), 'u-william');
check('refusal: a non-receipt creates nothing and says why', !resNo.ok && /doesn't look like a readable receipt/.test(resNo.reason) && s3.inbound.length === 0 && s3.tasks.length === 0);
var resEmpty = K.createRun(E, s3, K.parseReceipt({ receipt: true, items: [], not_read: ['line 2 — smudged'] }), 'u-william');
check('refusal: an itemless receipt creates nothing', !resEmpty.ok && s3.inbound.length === 0);

/* --- 4. a partial read: items + not-read lines ------------------------- */
var PARTIAL = { receipt: true, items: [
  { printed: 'EGGS 12CT', name: 'eggs', qty: 1, type: 'refrigerated' },
  { printed: 'RICE 10LB', name: 'rice', qty: 1, type: 'dry-goods' }
], not_read: ['line 3 — torn, price $4.29', 'line 4 — smudged'] };
var s4 = kitchen();
var res4 = K.createRun(E, s4, K.parseReceipt(PARTIAL), 'u-william');
check('partial: the read items still create the run', res4.ok && res4.created.length === 2);
check('partial: what was not read is kept on the shipment, not dropped', s4.inbound[0].notRead.length === 2 && res4.notRead.length === 2);

/* --- 5. duplicates and quantity coercion -------------------------------- */
var DUPS = { receipt: true, items: [
  { printed: 'COLA 12PK', name: 'cola 12 pack', qty: 1, type: 'dry-goods' },
  { printed: 'COLA 12PK', name: 'cola 12 pack', qty: '3', type: 'dry-goods' },
  { printed: 'GUM 15CT', name: 'chewing gum', qty: 0, type: 'bakery-snacks-coffee' },
  { printed: 'CHICKEN BRST', name: 'chicken breast', qty: 12, type: 'refrigerated' }
], not_read: [] };
var s5 = kitchen();
var res5 = K.createRun(E, s5, K.parseReceipt(DUPS), 'u-william');
check('dups: the same product on two lines makes two distinct tasks', res5.created.length === 4 && res5.created[0].taskId !== res5.created[1].taskId);
var t5 = res5.created.map(function (c) { return E.taskById(s5, c.taskId); });
check('qty: a string "3" is read as 3', /Put away 3 ×/.test(t5[1].title));
check('qty: a printed 0 becomes 1 (never a zero task)', /Put away 1 ×/.test(t5[2].title));
check('qty: 12 rides through', /Put away 12 ×/.test(t5[3].title));
var end5 = walkToEnd(s5, E.unitById(s5, 'u-william'), 4);
check('dups: both duplicate tasks complete; the run finishes', JSON.stringify(end5) === JSON.stringify(['Groceries putaway complete.']) && s5.staging.length === 0);

/* --- 6. the same home spot, four deep (mixed spots must not jam) ------- */
var FRIDGE4 = { receipt: true, items: ['milk', 'cheddar cheese', 'orange juice', 'butter'].map(function (n) {
  return { printed: n.toUpperCase(), name: n, qty: 1, type: 'refrigerated' }; }), not_read: [] };
var s6 = kitchen();
var res6 = K.createRun(E, s6, K.parseReceipt(FRIDGE4), 'u-william');
check('fridge x4: all four route to the Fridge', res6.created.every(function (c) { return c.spot === 'Fridge'; }));
var end6 = walkToEnd(s6, E.unitById(s6, 'u-william'), 4);
var fridge = E.binById(s6, 'Fridge');
check('fridge x4: all four complete into the same mixed spot', JSON.stringify(end6) === JSON.stringify(['Groceries putaway complete.']) && fridge.contents.length === 4);

/* --- 7. a long receipt: 24 lines ---------------------------------------- */
var NAMES = ['oats', 'lentils', 'canned tomatoes', 'olive oil', 'honey', 'rice cakes', 'trail mix', 'green tea',
  'frozen peas', 'frozen corn', 'paper towels', 'trash bags', 'shampoo', 'toothpaste', 'apples', 'pears',
  'carrots', 'celery', 'bagels', 'muffins', 'almond butter', 'jam', 'crackers', ' sparkling water'];
var LONG = { receipt: true, items: NAMES.map(function (n, i) {
  return { printed: n.toUpperCase(), name: n.trim(), qty: 1, type: ['dry-goods', 'frozen', 'household', 'produce', 'bakery-snacks-coffee', 'refrigerated'][i % 6] };
}), not_read: [] };
var s7 = kitchen();
var res7 = K.createRun(E, s7, K.parseReceipt(LONG), 'u-william');
check('long: 24 lines make 24 tasks, every one with a real spot', res7.ok && res7.created.length === 24 && everyTaskReal(s7, res7));
var end7 = walkToEnd(s7, E.unitById(s7, 'u-william'), 24);
check('long: the 24-task run finishes by voice', JSON.stringify(end7) === JSON.stringify(['Groceries putaway complete.']));

/* --- 8. hostile JSON shapes through parseReceipt ------------------------ */
check('shape: items that is not an array reads as no items', K.parseReceipt({ receipt: true, items: { a: 1 } }).ok === false);
check('shape: junk entries are skipped, good ones kept', (function () {
  var r = K.parseReceipt({ receipt: true, items: [null, 'soup', 42, { printed: 'RICE', qty: 1, type: 'dry-goods' }], not_read: [] });
  return r.ok && r.items.length === 1 && r.items[0].name === 'RICE';
})());
check('shape: an item with only the printed text keeps it as its name', (function () {
  var r = K.parseReceipt({ receipt: true, items: [{ printed: 'GV PNUT BTR', qty: 1, type: 'dry-goods' }], not_read: [] });
  return r.ok && r.items[0].name === 'GV PNUT BTR';
})());
check('shape: a type with spaces ("dry goods") still classifies', (function () {
  var r = K.parseReceipt({ receipt: true, items: [{ printed: 'X', name: 'mystery box', qty: 1, type: 'dry goods' }], not_read: [] });
  return r.ok && r.items[0].metaType === 'dry-goods';
})());
check('shape: the whole reply being junk is an honest not-ok', K.parseReceipt(null).ok === false && K.parseReceipt('hello').ok === false);

/* --- 9. the chain itself: read -> parse -> create, fenced JSON --------- */
var f9 = stubFetch([reply('```json\n' + JSON.stringify(FOREIGN) + '\n```')]);
K.readReceipt(B, f9, 'https://w/chat', 'x').then(function (r9) {
  var s9 = kitchen();
  var res9 = K.createRun(E, s9, r9, 'u-william');
  check('chain: a fenced-JSON read of a foreign receipt creates the run', res9.ok && res9.created.length === 8 && everyTaskReal(s9, res9));
}).then(function () {
/* --- 10. the spoken intake: tasks from what the wearer TELLS it --------
   William's live test (2026-11-04): "create tasks for what I told it
   I had" got a camera's refusal. A tell is intake too. */
  check('spoken: the prompt carries the fall-through contract (no items = not a goods statement)',
    /NOT a statement of groceries/.test(K.SPOKEN_PROMPT) && /items/.test(K.SPOKEN_PROMPT));
  var f10 = stubFetch([reply({ items: [
    { name: 'milk', qty: 50, type: 'refrigerated' },
    { name: 'eggs', qty: 12, type: 'refrigerated' },
    { name: 'sourdough loaf', qty: 1, type: 'bakery-snacks-coffee' },
    { name: 'quinoa', qty: 1, type: 'dry-goods' }
  ] })]);
  return K.readSpoken(B, f10, 'https://w/chat', 'Can you create tasks? I have 50 gallons of milk, a dozen eggs, a sourdough loaf and some quinoa').then(function (r10) {
    check('spoken: the tell parses into items', r10.ok && r10.items.length === 4);
    var s10 = kitchen();
    var res10 = K.createRun(E, s10, r10, 'u-william', 'spoken');
    check('spoken: the tell creates the same Groceries putaway job', res10.ok && res10.created.length === 4 && everyTaskReal(s10, res10));
    var milkTask = E.taskById(s10, res10.created[0].taskId);
    check('spoken: "50 gallons of milk" is one task of 50, in the Fridge', /Put away 50 × milk/.test(milkTask.title) && milkTask.toBinId === 'Fridge');
    check('spoken: the record tells the truth about how the run was made',
      s10.inbound[0].intake === 'spoken-list' && s10.records.some(function (rec) { return rec.intake === 'spoken-list' && /^List told by/.test(rec.text); }));
    C.workerTurn(E, s10, E.unitById(s10, 'u-william'), C.matchIntent("what's next"));
    var ch10 = G.chipsFor(E, s10, E.unitById(s10, 'u-william'));
    check('spoken: the glance counts inside the told run too', ch10.task === 'Task 1 of 4' && ch10.item === 'milk');
    var end10 = walkToEnd(s10, E.unitById(s10, 'u-william'), 4);
    check('spoken: the told run walks to its finish by voice', JSON.stringify(end10) === JSON.stringify(['Groceries putaway complete.']));
    var f10b = stubFetch([reply({ items: [] })]);
    return K.readSpoken(B, f10b, 'https://w/chat', 'What is the weather like today?').then(function (r10b) {
      check('spoken: words with no goods in them create nothing (the caller falls through to the ask)',
        !r10b.ok && r10b.items.length === 0);
    });
  });
}).then(function () {
  console.log('---');
  console.log(passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
}).catch(function (e) { console.log('FAIL  chain threw: ' + (e && e.message)); process.exit(1); });
