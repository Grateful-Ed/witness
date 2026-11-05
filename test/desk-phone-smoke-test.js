/* desk-phone-smoke-test.js — drives warehouse.html and phone.html in a
   real browser (Playwright) against a STUBBED Worker: /state is an
   in-memory KV, /chat and /save answer canned replies.
   Desk-phone Steps 2 and 3, end to end:
     - the desk's first open seeds once; every later open is read-only
     - a desk action is GET then POST, in that order
     - two browsers (separate contexts) hold ONE world
     - the WMS layer on the document survives a desk save
     - network down: said plainly, nothing seeded, nothing acted on
     - the kitchen world never touches the shared record
     - the phone: who-am-I, the glance chip, "what's next" / "done" /
       problem words through the converse intents, the change visible
       on the desk; the manager's ask (no state write); capture →
       data: image to /chat → flags → Save as kind "photo", no photo
     - the phone carries no WMS workflow UI
   Skips (exit 0) when Playwright is not installed.
   Run: node test/desk-phone-smoke-test.js */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');

var pw;
try { pw = require('playwright'); } catch (e) { console.log('SKIP  playwright not installed'); process.exit(0); }

var ROOT = path.join(__dirname, '..');
var failures = 0, passes = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (cond) passes++; else failures++; }

var TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp' };
var server = http.createServer(function (req, res) {
  var p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/warehouse.html';
  var f = path.join(ROOT, p);
  if (f.indexOf(ROOT) !== 0 || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

var kv = null, log = [], chats = [], saves = [], down = false;
var PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function stub(ctx) {
  await ctx.route('https://witness.e-william-harris96.workers.dev/**', async function (route) {
    var req = route.request();
    var u = new URL(req.url());
    var cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    if (u.pathname === '/state') {
      if (down) return route.abort('failed');
      log.push(req.method());
      if (req.method() === 'GET') return route.fulfill(kv ? { status: 200, headers: cors, body: kv } : { status: 404, headers: cors, body: '{"ok":false,"error":"no state yet"}' });
      kv = req.postData();
      return route.fulfill({ status: 200, headers: cors, body: '{"ok":true}' });
    }
    if (u.pathname === '/chat') {
      var b = JSON.parse(req.postData());
      chats.push(b);
      var isPhoto = /photo scan/.test(b.messages[0].content);
      var content = isPhoto
        ? JSON.stringify({ flags: [{ label: 'Torn wrap', side: 'front', detail: 'Wrap is torn at the top left corner.' }] })
        : 'Zone A is backing up. Move one worker from Zone B.';
      return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ choices: [{ message: { content: content } }] }) });
    }
    if (u.pathname === '/save') {
      saves.push(JSON.parse(req.postData()));
      return route.fulfill({ status: 200, headers: cors, body: '{"ok":true,"key":"k1"}' });
    }
    return route.fulfill({ status: 404, headers: cors, body: '{}' });
  });
}
function doc() { return JSON.parse(kv); }
function unit(d, id) { return d.labor.filter(function (u) { return u.id === id; })[0]; }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

server.listen(0, async function () {
  var base = 'http://localhost:' + server.address().port;
  var browser = await pw.chromium.launch();
  var errors = [];
  async function open(url, viewport) {
    var ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 } });
    await stub(ctx);
    var page = await ctx.newPage();
    page.on('pageerror', function (e) { errors.push(String(e)); });
    await page.goto(base + url);
    return page;
  }
  async function deskReady(page) { await page.waitForSelector('#nameChips .namechip'); }

  try {
    /* ---------------- desk: Step 2 ---------------- */
    var desk = await open('/warehouse.html');
    await deskReady(desk);
    check('desk first open (nothing stored): seeds and POSTs once', log.join(',') === 'GET,POST');
    log.length = 0;
    await desk.reload();
    await deskReady(desk);
    check('desk second open is read-only: GET, no POST', log.join(',') === 'GET');

    /* a WMS layer on the document must survive desk saves */
    var d0 = doc(); d0.wms = { marker: 'kept' }; kv = JSON.stringify(d0);

    log.length = 0;
    await desk.click('#nextBtn');
    await desk.waitForFunction(function () { return /Done/.test(document.getElementById('nextBtn').textContent); });
    check('a desk action is GET then POST, in that order', log.join(',') === 'GET,POST');
    var marcus = unit(doc(), 'u-marcus');
    check('the action landed on the shared record (Marcus has a task)', !!marcus.currentTaskId);
    check('the WMS layer rode along untouched', doc().wms && doc().wms.marker === 'kept');
    var marcusTask = marcus.currentTaskId;

    /* a second browser sees the same world */
    var desk2 = await open('/warehouse.html');
    await deskReady(desk2);
    var card2 = await desk2.textContent('#taskCard');
    check('a second browser opens on the SAME world (Marcus\'s task shows)', /Put away|Pick|Receive|Break|Marry|Load/i.test(card2) && !/Nothing in hand/.test(card2));
    await desk2.click('#nextBtn');
    await wait(300);
    var closed = doc().tasks.filter(function (t) { return t.id === marcusTask; })[0];
    check('second browser closes the task on the shared record', closed.status === 'done');

    /* the first desk acts on FRESH state: it showed the old task, which is now gone */
    log.length = 0;
    await desk.click('#nextBtn');
    await wait(400);
    var status1 = await desk.textContent('#workerTalkStatus');
    check('a stale screen does not close an unseen task: it says the task changed', /changed on another device/.test(status1) && log.join(',') === 'GET');
    check('...and shows where it stands now', (await desk.textContent('#taskCard')).length > 0);

    /* ---------------- phone: Step 3 ---------------- */
    var phone = await open('/phone.html', { width: 390, height: 844 });
    await phone.waitForSelector('#phNames .ph-name');
    var phoneUi = await phone.evaluate(function () {
      return { buttons: Array.prototype.map.call(document.querySelectorAll('#phLive button'), function (b) { return b.id; }),
        hasNext: !!document.getElementById('nextBtn'), hasTaskCard: !!document.getElementById('taskCard'),
        hasHold: !!document.getElementById('holdBtn'), tables: document.querySelectorAll('#phLive table').length };
    });
    check('phone hosts no WMS workflow UI (no task card, no Next / hold buttons)', !phoneUi.hasNext && !phoneUi.hasTaskCard && !phoneUi.hasHold);
    check('phone buttons are only talk / send / me / save', phoneUi.buttons.sort().join(',') === ['phMe', 'phSave', 'phTalk', 'phTypeBtn'].sort().join(','));

    var postsBefore = log.filter(function (m) { return m === 'POST'; }).length;
    await phone.click('#phNames [data-unit="u-dee"]');
    check('phone open + who-am-I is read-only (no POST)', log.filter(function (m) { return m === 'POST'; }).length === postsBefore);
    check('no task in hand: no chip shows', await phone.isHidden('#chipTask'));

    log.length = 0;
    await phone.fill('#phTypeInput', "what's next");
    await phone.click('#phTypeBtn');
    await phone.waitForSelector('#chipTask:not([hidden])');
    var chipTask = await phone.textContent('#chipTask');
    var chipBin = await phone.isHidden('#chipBin') ? '' : await phone.textContent('#chipBin');
    check('"what\'s next" from the phone: GET then POST', log.join(',') === 'GET,POST');
    check('glance chip: Task #', /^Task \d+$/.test(chipTask));
    check('glance chip: Bin # (or door) when it has a reason', chipBin === '' || /^(Bin |.*Door )/.test(chipBin));
    var deeTask = unit(doc(), 'u-dee').currentTaskId;
    check('the phone\'s pull is on the shared record', !!deeTask);
    check('the reply shows, clipped', (await phone.textContent('#phReply')).length <= 160 && (await phone.textContent('#phReply')).length > 0);

    /* the desk sees the phone's change */
    await desk.reload();
    await deskReady(desk);
    await desk.click('#nameChips [data-unit="u-dee"]');
    var deskCard = await desk.textContent('#taskCard');
    var deeTitle = doc().tasks.filter(function (t) { return t.id === deeTask; })[0].title;
    check('phone → desk: the desk shows Dee\'s task from the phone', deskCard.indexOf(deeTitle) !== -1);

    /* problem words pin and close nothing */
    await phone.fill('#phTypeInput', 'the wrap is torn on this one');
    await phone.click('#phTypeBtn');
    await phone.waitForFunction(function () { return /Problem noted/.test(document.getElementById('phReply').textContent); });
    var tProb = doc().tasks.filter(function (t) { return t.id === deeTask; })[0];
    check('problem words pin the worker\'s exact words to the task', (tProb.notes || []).some(function (n) { return n.text === 'the wrap is torn on this one'; }));
    check('problem words close nothing', tProb.status === 'assigned' && unit(doc(), 'u-dee').currentTaskId === deeTask);

    /* "done" closes and pulls the next */
    await phone.fill('#phTypeInput', 'done');
    await phone.click('#phTypeBtn');
    await phone.waitForFunction(function () { return /Closed/.test(document.getElementById('phReply').textContent); });
    check('"done" from the phone closes the task on the shared record', doc().tasks.filter(function (t) { return t.id === deeTask; })[0].status === 'done');

    /* capture */
    chats.length = 0;
    await phone.setInputFiles('#phCam', { name: 'load.png', mimeType: 'image/png', buffer: PNG });
    await phone.waitForSelector('#phSave:not([hidden])');
    var photoChat = chats.filter(function (c) { return /photo scan/.test(c.messages[0].content); })[0];
    var img = photoChat && photoChat.messages[1].content.filter(function (p) { return p.type === 'image_url'; })[0];
    check('capture sends a data: JPEG image_url through /chat', !!img && /^data:image\/jpeg;base64,/.test(img.image_url.url));
    check('the capture shows bare on the phone', await phone.isVisible('#phShotImg'));
    check('flags render on the phone', /Torn wrap/.test(await phone.textContent('#phFlags')));
    check('no verdicts on the phone', !/agree|can.t verify|verdict/i.test(await phone.textContent('#phLive')));
    await phone.click('#phSave');
    await phone.waitForFunction(function () { return document.getElementById('phSave').textContent === 'Saved'; });
    check('Save POSTs /save with kind "photo", the flags, the load label', saves.length === 1 && saves[0].kind === 'photo' &&
      saves[0].flags[0].label === 'Torn wrap' && /^Phone — /.test(saves[0].load));
    check('the photo itself is not stored', JSON.stringify(saves[0]).indexOf('data:image') === -1);

    /* manager: ask the building */
    await phone.click('#phMe');
    await phone.click('#phNames [data-unit="u-sam"]');
    var postsNow = log.filter(function (m) { return m === 'POST'; }).length;
    await phone.fill('#phTypeInput', 'Where is it backing up?');
    await phone.click('#phTypeBtn');
    await phone.waitForSelector('#phAskMore:not([hidden])');
    check('manager ask: the answer shows', /Zone A is backing up/.test(await phone.textContent('#phReply')));
    check('manager ask: "A proposal, not a decision" carries over', /A proposal, not a decision\. Nothing was moved\./.test(await phone.textContent('#phAskMore')));
    check('manager ask: the numbers carry over (behind a fold)', (await phone.$$('#phZones table tr')).length > 1);
    check('manager ask writes nothing to the shared state', log.filter(function (m) { return m === 'POST'; }).length === postsNow);

    /* who-am-I is remembered for the page session */
    await phone.reload();
    await phone.waitForFunction(function () { return !document.getElementById('phLive').hidden; });
    check('who-am-I is remembered for this page session', /Sam/.test(await phone.textContent('#phMe')));

    /* ---------------- reset ---------------- */
    log.length = 0;
    await desk.click('#roleManager');
    await desk.click('#resetBtn');
    await wait(400);
    check('reset POSTs the seed world', log.join(',') === 'POST' && doc().records.length === 0 && !unit(doc(), 'u-dee').currentTaskId);

    /* ---------------- network down ---------------- */
    down = true;
    var dead = await open('/warehouse.html');
    await dead.waitForFunction(function () { var m = document.getElementById('stateMsg'); return m && !m.hidden && m.className === 'error'; });
    var deadMsg = await dead.textContent('#stateMsg');
    check('desk, network down: said plainly', /could not be reached/.test(deadMsg));
    check('desk, network down: no world to act on (nothing rendered)', (await dead.$$('#nameChips .namechip')).length === 0);
    var deadPhone = await open('/phone.html', { width: 390, height: 844 });
    await deadPhone.waitForFunction(function () { return /err/.test(document.getElementById('phMsg').className); });
    check('phone, network down: said plainly, no names to pick', (await deadPhone.$$('#phNames .ph-name')).length === 0);
    down = false;

    /* ---------------- kitchen keeps its own store ---------------- */
    log.length = 0;
    var kitchen = await open('/warehouse.html?world=kitchen');
    await deskReady(kitchen);
    await kitchen.fill('#problemInput', 'the shelf is broken');
    await kitchen.click('#problemBtn');
    await wait(300);
    check('the kitchen world never touches the shared record', log.length === 0);

    check('no page errors', errors.length === 0);
    if (errors.length) console.log(errors.join('\n'));
  } catch (e) {
    console.log('FAIL  smoke threw: ' + (e && e.stack || e));
    failures++;
  }

  await browser.close();
  server.close();
  console.log('\n' + passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
});
