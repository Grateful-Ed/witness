/* glasses-test.js — node, no dependencies.
   The pure core of the glasses view (js/glasses.js): focus movement,
   controller reading, capture downscale maths, the page-level hide /
   who's-free commands, the chips, the employee line, and the photo
   scan request with fetch stubbed (including the 413 path).
   Camera, microphone and controller hardware are not tested here —
   they need a real phone.
   Run: node test/glasses-test.js   (exit 0 = all pass) */
'use strict';

var G = require('../js/glasses.js');
var E = require('../js/engine.js');
var C = require('../js/converse.js');

var failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
  if (!cond) failures++;
}
function fresh() { var s = E.seedWorld(); E.generateTasks(s); return s; }

/* --- focus ------------------------------------------------------- */
check('controller actions are Talk and Capture only — Hide is never a control', G.ACTIONS.join() === 'talk,capture');
check('focus starts on Capture, so X captures by default', G.ACTIONS[G.DEFAULT_FOCUS] === 'capture');
check('right moves forward', G.moveFocus(0, 'right') === 1);
check('right wraps from the last to the first', G.moveFocus(1, 'right') === 0);
check('down wraps the same way', G.moveFocus(1, 'down') === 0);
check('left wraps from the first to the last', G.moveFocus(0, 'left') === 1);
check('no direction: focus stays', G.moveFocus(1, null) === 1);

/* --- touch on the view ---------------------------------------------- */
check('a press held past HOLD_MS is a hold (talk)', G.touchKind(1000, 1000 + G.HOLD_MS, null) === 'hold');
check('a short tap alone does nothing (tap)', G.touchKind(1000, 1100, null) === 'tap');
check('a second short tap soon after is a double (capture)', G.touchKind(1300, 1380, 1100) === 'double');
check('a second tap too late is just a tap', G.touchKind(1400 + G.DOUBLE_TAP_MS + 1, 1400 + G.DOUBLE_TAP_MS + 60, 1400) === 'tap');
check('a long press after a tap is still a hold, never a capture', G.touchKind(1200, 1200 + G.HOLD_MS + 50, 1100) === 'hold');

/* --- stick ------------------------------------------------------- */
check('inside the deadzone: no direction', G.stickDir(0.3, -0.2) === null);
check('stick right', G.stickDir(0.9, 0.1) === 'right');
check('stick up (gamepad Y is negative up)', G.stickDir(0.1, -0.8) === 'up');
check('stronger axis wins', G.stickDir(-0.7, 0.6) === 'left');

/* --- controller reading ------------------------------------------- */
function pad(pressed, axes, r2value) {
  var buttons = [];
  for (var i = 0; i < 17; i++) buttons.push({ pressed: pressed.indexOf(i) !== -1, value: pressed.indexOf(i) !== -1 ? 1 : 0 });
  if (r2value != null) buttons[7] = { pressed: false, value: r2value };
  return { id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', buttons: buttons, axes: axes || [0, 0, 0, 0] };
}
check('R2 held reads as talk', G.readPad(pad([7])).talk === true);
check('R2 half-way (analog 0.6) reads as talk', G.readPad(pad([], null, 0.6)).talk === true);
check('R2 barely touched (0.2) is not talk', G.readPad(pad([], null, 0.2)).talk === false);
check('X reads as activate', G.readPad(pad([0])).activate === true);
check('D-pad right reads as right', G.readPad(pad([15])).dir === 'right');
check('D-pad beats the stick', G.readPad(pad([14], [0.9, 0])).dir === 'left');
check('stick alone gives a direction', G.readPad(pad([], [0, 0.9])).dir === 'down');

var idle = G.readPad(pad([]));
var r2 = G.readPad(pad([7]));
check('R2 press fires talk-down once', G.padEvents(idle, r2).join() === 'talk-down');
check('R2 held: nothing new', G.padEvents(r2, r2).length === 0);
check('R2 release fires talk-up', G.padEvents(r2, idle).join() === 'talk-up');
var right = G.readPad(pad([15]));
check('a held direction moves focus once', G.padEvents(idle, right).join() === 'move-right' && G.padEvents(right, right).length === 0);
check('X press/release fire once each', G.padEvents(idle, G.readPad(pad([0]))).join() === 'activate-down' &&
  G.padEvents(G.readPad(pad([0])), idle).join() === 'activate-up');
check('first snapshot with nothing held: no events', G.padEvents(null, idle).length === 0);
check('controller name: DualSense', G.padName(pad([]).id) === 'DualSense');
check('controller name: DualShock 4', G.padName('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)') === 'DualShock');
check('controller name: other pads keep a short name', G.padName('Xbox Wireless Controller (STANDARD GAMEPAD)') === 'Xbox Wireless Controller');

/* --- capture downscale maths -------------------------------------- */
var a = G.fitWithin(4032, 3024, 1600);
check('12 MP landscape → 1600 × 1200', a.w === 1600 && a.h === 1200);
var b = G.fitWithin(3024, 4032, 1024);
check('portrait → longest side 1024, shape kept (768 × 1024)', b.w === 768 && b.h === 1024);
var c = G.fitWithin(640, 480, 1600);
check('never scales up', c.w === 640 && c.h === 480);
var d = G.fitWithin(1920, 1080, 1024);
check('1080p → 1024 × 576', d.w === 1024 && d.h === 576);
check('show size is 1600, scan steps start at 1024 / 0.7 and only get smaller',
  G.SHOW_MAX === 1600 && G.SCAN_STEPS[0].max === 1024 && G.SCAN_STEPS[0].quality === 0.7 &&
  G.SCAN_STEPS.every(function (s, i) { return i === 0 || (s.max < G.SCAN_STEPS[i - 1].max && s.quality <= G.SCAN_STEPS[i - 1].quality); }));
check('scan step: first body under the cap wins', G.chooseScanStep([90000, 70000, 52000, 30000]) === 2);
check('scan step: nothing fits → the last (smallest) is sent anyway', G.chooseScanStep([90000, 80000, 70000, 65000]) === 3);
check('scan step: the cap is the Worker\'s 60,000', G.CHAT_BODY_CAP === 60000 && G.chooseScanStep([60000]) === 0 && G.chooseScanStep([60001, 59999]) === 1);

/* --- page-level commands (ahead of the converse intents) ---------- */
check('"hide" hides', G.isHide('Hide'));
check('"Hey Muse, hide that" hides', G.isHide('Hey Muse, hide that.'));
check('"clear the view" hides', G.isHide('clear the view'));
check('a problem that says "hiding" is not hide', !G.isHide('the wrap is hiding a crushed corner'));
check('"hide" inside a longer sentence is not hide', !G.isHide('hide the pallet behind the door'));
check('"who\'s free" asks for labor', G.isWhoFree("Who's free?"));
check('"Hey Muse, is anyone available right now" asks for labor', G.isWhoFree('Hey Muse, is anyone available right now'));
check('"who can help" asks for labor', G.isWhoFree('who can help'));
check('"done" is neither command', !G.isHide('done') && !G.isWhoFree('done'));
check('hide is not a converse intent today (so the page must catch it first)', C.matchIntent('hide').intent === 'unknown');

/* --- chips --------------------------------------------------------- */
var s = fresh();
var marcus = E.unitById(s, 'u-marcus');
check('no task in hand: no chips', G.chipsFor(E, s, marcus).task === null && G.chipsFor(E, s, marcus).bin === null);
var t = E.nextTaskFor(s, marcus); /* the receive at Door 1 */
var ch = G.chipsFor(E, s, marcus);
check('chips: Task # is the task\'s place in the list', ch.task === 'Task ' + (s.tasks.indexOf(t) + 1));
check('chips: a receive shows its door', ch.bin === 'Door 1');
E.completeTask(s, t.id); E.generateTasks(s);
var t2 = E.nextTaskFor(s, marcus);
check('chips: a pick shows its bin', t2.type === 'pick' && G.chipsFor(E, s, marcus).bin === 'Bin ' + t2.binId);
check('place: putaway → target bin; consolidate → source bin',
  G.taskPlace({ type: 'putaway', toBinId: 'A-03' }) === 'Bin A-03' &&
  G.taskPlace({ type: 'consolidate', fromBinId: 'C-01', toBinId: 'B-01' }) === 'Bin C-01');

/* --- employee line -------------------------------------------------- */
var w = fresh();
var dee = E.unitById(w, 'u-dee');
var emp = G.employeeFor(E, w, E.unitById(w, 'u-marcus'));
check('employee: someone free in the wearer\'s zone first', emp.name === 'Dee Carter' && emp.status === 'available' && emp.location === 'Zone A');
E.nextTaskFor(w, dee);
var emp2 = G.employeeFor(E, w, E.unitById(w, 'u-marcus'));
check('employee: busy colleague skipped for a free one', emp2.status === 'available' && emp2.name !== 'Dee Carter');
check('employee: only name / location / status', Object.keys(emp2).sort().join() === 'location,name,status');
w.labor.forEach(function (u) { if (u.role === 'worker' && u.id !== 'u-marcus') E.nextTaskFor(w, u); });
var emp3 = G.employeeFor(E, w, E.unitById(w, 'u-marcus'));
check('employee: everyone busy → says "on a task", with where, never a guessed time',
  emp3.status === 'on a task' && /near /.test(emp3.location) && !/min/.test(emp3.status));

/* --- the scan request ------------------------------------------------ */
var body = JSON.parse(G.scanBody('data:image/jpeg;base64,AAAA'));
check('scan: one frame sent as a data: image URL', body.messages[1].content[1].image_url.url === 'data:image/jpeg;base64,AAAA');
check('scan: photo.js pattern — flags JSON, quoted evidence, no verdicts',
  /"flags"/.test(body.messages[0].content) && /exactly what you see/.test(body.messages[0].content) &&
  !/verdict|agree/i.test(body.messages[0].content));
check('scan: 6,000 max_tokens', body.max_tokens === 6000);
check('flags parse, fences tolerated', G.normaliseFlags('```json\n{"flags":[{"label":"Torn wrap","detail":"Wrap open on the top left."}]}\n```').length === 1);
check('flags: unreadable → null', G.normaliseFlags('looks fine to me') === null);
check('flag lines read "label — detail"', G.flagLines([{ label: 'Torn wrap', detail: 'Top left.' }])[0] === 'Torn wrap — Top left.');
check('no flags → says so', G.flagLines([])[0] === 'Nothing flagged in that frame.');

function stub(replies) {
  var calls = 0;
  var fn = function () {
    var r = replies[Math.min(calls, replies.length - 1)]; calls++;
    if (r === 'throw') return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve({ ok: r.status === 200, status: r.status, json: function () { return Promise.resolve(r.body); } });
  };
  fn.calls = function () { return calls; };
  return fn;
}
function ok(content) { return { status: 200, body: { choices: [{ message: { content: content } }] } }; }
var pending = [];
var s413 = stub([{ status: 413, body: {} }]);
pending.push(G.sendScan(s413, 'u', '{}').then(function () { check('413 → honest message', false); }, function (e) {
  check('413 → "Photo too large to send — capture kept.", no retry', e.message === 'too-large' &&
    e.userMessage === 'Photo too large to send — capture kept.' && s413.calls() === 1);
}));
var sOk = stub([ok('{"flags":[{"label":"Crushed cartons","detail":"Bottom right corner caved in."}]}')]);
pending.push(G.sendScan(sOk, 'u', '{}').then(function (r) {
  check('scan: flags come back', r.flags.length === 1 && r.flags[0].label === 'Crushed cartons');
}));
var sEmpty = stub([ok(''), ok('{"flags":[]}')]);
pending.push(G.sendScan(sEmpty, 'u', '{}').then(function (r) {
  check('scan: empty reply → one retry', sEmpty.calls() === 2 && r.attempts === 2);
}));
var sEmpty2 = stub([ok(''), ok(''), ok('x')]);
pending.push(G.sendScan(sEmpty2, 'u', '{}').then(function () { check('scan: two empties → error', false); }, function (e) {
  check('scan: two empties → honest error, capture kept', sEmpty2.calls() === 2 && /empty twice/.test(e.userMessage) && /Capture kept/.test(e.userMessage));
}));
pending.push(G.sendScan(stub(['throw']), 'u', '{}').then(null, function (e) {
  check('scan: no network → honest error', e.message === 'network' && /Capture kept/.test(e.userMessage));
}));

/* --- respond to what it sees (William, 2026-11-01) ------------------- */
check('scan prompt: no pallet → say what IS in the frame, same shape', /no pallet, freight or warehouse stock/.test(body.messages[0].content) &&
  /"What I see"/.test(body.messages[0].content));
var sProse = stub([ok('A desk with a laptop and a coffee mug. No pallet in view.')]);
pending.push(G.sendScan(sProse, 'u', '{}').then(function (r) {
  check('scan: a plain-words reply is shown as-is, not thrown away', r.flags === null && /coffee mug/.test(r.text));
}));
var ask = JSON.parse(G.askBody('what am I looking at', 'data:image/jpeg;base64,BBBB', 'Pick 12 × Bottled water — cases for ORD-501'));
check('free ask: sends the words and the frame', /what am I looking at/.test(ask.messages[1].content[0].text) &&
  ask.messages[1].content[1].image_url.url === 'data:image/jpeg;base64,BBBB');
check('free ask: carries the task in hand as context', /Bottled water/.test(ask.messages[1].content[0].text));
check('free ask: answers in any way, responds to what it sees even without a pallet',
  /in any way/.test(ask.messages[0].content) && /even when there is no pallet/.test(ask.messages[0].content));
check('free ask: can\'t change the warehouse, points to the commands', /never say you did/.test(ask.messages[0].content) && /"done"/.test(ask.messages[0].content));
check('free ask: short for the glasses, 6,000 max_tokens', /at most 2 short sentences/.test(ask.messages[0].content) && ask.max_tokens === 6000);
var askNoFrame = JSON.parse(G.askBody('hello', null, null));
check('free ask: no frame → words only, says so', typeof askNoFrame.messages[1].content === 'string' && /No camera frame/.test(askNoFrame.messages[1].content));
var a413 = stub([{ status: 413, body: {} }]);
pending.push(G.sendAsk(a413, 'u', '{}').then(null, function (e) {
  check('free ask: 413 is reported as too-large (page re-asks without the frame)', e.message === 'too-large' && a413.calls() === 1);
}));
var aEmpty = stub([ok(''), ok('That\'s a forklift charging station.')]);
pending.push(G.sendAsk(aEmpty, 'u', '{}').then(function (r) {
  check('free ask: empty → one retry → answer', aEmpty.calls() === 2 && /forklift/.test(r.text));
}));
var aEmpty2 = stub([ok(''), ok('')]);
pending.push(G.sendAsk(aEmpty2, 'u', '{}').then(null, function (e) {
  check('free ask: two empties → honest error', /empty twice/.test(e.userMessage));
}));
check('commands still win: done / what\'s next / problem are not sent to META',
  C.matchIntent('done').intent === 'done' && C.matchIntent("what's next").intent === 'next' && C.matchIntent('this pallet is damaged').intent === 'problem');
check('anything else is "unknown" — that is what goes to META', C.matchIntent('what am I looking at').intent === 'unknown');

Promise.all(pending).then(function () {
  console.log('---');
  console.log(failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
});
