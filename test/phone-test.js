/* phone-test.js — node, no dependencies.
   Desk-phone Step 3: the phone's pure core (js/phone.js CORE).
     - glance chip: Task # and Bin #, nothing when no task in hand
     - clipping, downscale sizing (≤ 1600 px, never upscaled)
     - the photo read: a data: image_url through /chat, the flags shape,
       one retry on an empty reply, honest errors
     - the save: kind "photo", the flags, the load label — and NO photo
     - role tier: a manager's words ask, a worker's words go to the queue
   Run: node test/phone-test.js   (exit 0 = all pass) */
'use strict';

var P = require('../js/phone.js');
var E = require('../js/engine.js');

var failures = 0, passes = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (cond) passes++; else failures++; }

function world() { var s = E.seedWorld(); E.generateTasks(s); return s; }
function firstWorker(s) { var w = null; s.labor.forEach(function (u) { if (!w && u.role === 'worker') w = u; }); return w; }
function manager(s) { var m = null; s.labor.forEach(function (u) { if (!m && u.role === 'manager') m = u; }); return m; }
function reply(content) { return { ok: true, status: 200, json: function () { return Promise.resolve({ choices: [{ message: { content: content } }] }); } }; }

(async function () {
  /* ---- glance chip ---- */
  var s = world();
  var w = firstWorker(s);
  var c = P.chipsFor(E, s, w);
  check('no task in hand: no chips at all', c.task === null && c.bin === null);
  var t = E.nextTaskFor(s, w);
  c = P.chipsFor(E, s, w);
  check('task in hand: chip reads "Task N"', c.task === 'Task ' + (s.tasks.indexOf(t) + 1));
  check('putaway in hand: Bin chip is its destination bin', t.type !== 'putaway' || c.bin === 'Bin ' + t.toBinId);
  check('taskPlace: pick → its bin', P.taskPlace({ type: 'pick', binId: 'B-02' }) === 'Bin B-02');
  check('taskPlace: consolidate → its source bin', P.taskPlace({ type: 'consolidate', fromBinId: 'A-01' }) === 'Bin A-01');
  check('taskPlace: a door task → the door', P.taskPlace({ type: 'receive', title: 'Receive IN-1001 at Inbound Door 1' }) === 'Inbound Door 1');
  check('taskPlace: nothing to say → null (no guess)', P.taskPlace({ type: 'receive', title: 'Receive it' }) === null);
  E.completeTask(s, t.id);
  check('a done task leaves no chip', P.chipsFor(E, s, w).task === null);

  /* ---- clip ---- */
  check('clip: short text unchanged', P.clip('done', 20) === 'done');
  var long = P.clip('Closed: Put away 18 × Paper towels — cases. Next: Put away 24 × Laundry detergent — cases at bin A-03.', 40);
  check('clip: long text is cut with an ellipsis, within the limit', long.length <= 40 && /…$/.test(long));

  /* ---- downscale sizing ---- */
  var f1 = P.fitSize(4032, 3024);
  check('fitSize: 4032×3024 → longest side 1600', f1.w === 1600 && f1.h === 1200);
  var f2 = P.fitSize(3024, 4032);
  check('fitSize: portrait → longest side 1600', f2.h === 1600 && f2.w === 1200);
  var f3 = P.fitSize(800, 600);
  check('fitSize: never upscales', f3.w === 800 && f3.h === 600);
  check('JPEG quality is 0.8', P.JPEG_QUALITY === 0.8);

  /* ---- the photo read ---- */
  var DATA = 'data:image/jpeg;base64,' + 'A'.repeat(200000);
  var sent = [];
  var flagsJson = JSON.stringify({ flags: [
    { label: 'Torn wrap', side: 'Front', detail: 'Wrap is torn at the top left corner.' },
    { label: 'Side looks sound', side: 'sideways', detail: 'The right side shows square cartons.' },
    { label: '', side: 'front', detail: 'dropped: no label' }
  ] });
  var flags = await P.readPhoto(function (url, init) { sent.push({ url: url, body: JSON.parse(init.body) }); return Promise.resolve(reply(flagsJson)); }, DATA);
  var msg = sent[0].body.messages;
  check('photo read goes to /chat', sent.length === 1 && /\/chat$/.test(sent[0].url));
  check('photo read sends the image as a data: image_url', msg[1].content.some(function (p) { return p.type === 'image_url' && p.image_url.url === DATA; }));
  check('photo read uses the photo-scan prompt (flags, sides, cannot verify)', /photo scan/.test(msg[0].content) && /"flags"/.test(msg[0].content) && /Cannot verify/.test(msg[0].content));
  check('photo read asks no verdicts (the phone runs no comparison)', !/verdict/i.test(msg[0].content));
  check('flags normalised: side lowercased, unknown side → overall, empty label dropped',
    flags.length === 2 && flags[0].side === 'front' && flags[1].side === 'overall');

  var tries = 0;
  flags = await P.readPhoto(function () { tries++; return Promise.resolve(tries === 1 ? reply('') : reply('```json\n{"flags":[]}\n```')); }, DATA);
  check('an empty reply is retried once, then read', tries === 2 && flags.length === 0);

  var err = null;
  try { await P.readPhoto(function () { return Promise.resolve(reply('not json')); }, DATA); } catch (e) { err = e; }
  check('an unreadable reply is an honest error', err && err.code === 'unparseable' && /Nothing was saved/.test(err.userMessage));
  err = null;
  try { await P.readPhoto(function () { return Promise.resolve({ ok: false, status: 413 }); }, DATA); } catch (e) { err = e; }
  check('a 413 says the photo was too big', err && err.code === 'too-large');
  err = null;
  try { await P.readPhoto(function () { return Promise.reject(new TypeError('x')); }, DATA); } catch (e) { err = e; }
  check('network down is said plainly', err && err.code === 'network');

  /* ---- save ---- */
  s = world();
  w = firstWorker(s);
  E.nextTaskFor(s, w);
  var label = P.loadLabel(E, s, w);
  check('load label names the task in hand', /^Phone — /.test(label) && label.length > 8);
  var fl = [{ label: 'Torn wrap', side: 'front', detail: 'Wrap is torn.' }];
  var body = P.savePayload(fl, label, w, '2026-11-05T12:00:00.000Z');
  check('save body: kind "photo"', body.kind === 'photo');
  check('save body: carries the flags and the load label', body.flags === fl && body.load === label);
  check('save body: a non-empty transcript (the /save contract)', typeof body.transcript === 'string' && /Torn wrap/.test(body.transcript));
  check('save body: the photo itself is NOT stored', JSON.stringify(body).indexOf('data:image') === -1 && !('photo' in body));
  var saved = [];
  await P.saveCapture(function (url, init) { saved.push({ url: url, body: JSON.parse(init.body) }); return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true, key: 'k' }); } }); }, body);
  check('save POSTs to /save', saved.length === 1 && /\/save$/.test(saved[0].url) && saved[0].body.kind === 'photo');
  err = null;
  try { await P.saveCapture(function () { return Promise.resolve({ ok: false, status: 500, json: function () { return Promise.resolve({}); } }); }, body); } catch (e) { err = e; }
  check('a failed save keeps the flags on screen and says so', err && /still on screen/.test(err.userMessage));
  check('load label with no task names the person', P.loadLabel(E, world(), w) === 'Phone — ' + w.name);

  /* ---- role tier ---- */
  check('a worker\'s words go to the queue', P.routeFor(w) === 'queue');
  check('a manager\'s words ask the building', P.routeFor(manager(s)) === 'ask');

  console.log('\n' + passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
