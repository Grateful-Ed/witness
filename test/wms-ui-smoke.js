/* wms-ui-smoke.js — drives wms.html in a real browser (Playwright),
   end to end, against a STUBBED Worker: /state is an in-memory KV,
   /chat and /asr answer canned replies. Proves the page loads from
   the desk record without saving, and that a full shift runs
   through the UI: check-in → receive (voice-read counts) → putaway
   → wave → pick → pack → load → ship confirm → flag → summary.
   Skips (exit 0) when Playwright is not installed.
   Run: node test/wms-ui-smoke.js */
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
  if (p === '/') p = '/wms.html';
  var f = path.join(ROOT, p);
  if (f.indexOf(ROOT) !== 0 || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

var kv = null, gets = 0, posts = 0, chats = [];
function chatReply(body) {
  var sys = body.messages[0].content;
  var content;
  if (/spoken count into numbers/.test(sys)) {
    content = JSON.stringify({ lines: [
      { line: 1, received: 116, damaged: 4, quote: 'detergent four pallets, one sixteen cases, four crushed' },
      { line: 2, received: 120, damaged: 0, quote: 'towels all six pallets, a hundred twenty' }] });
  } else if (/short plain label/.test(sys)) {
    content = JSON.stringify({ label: 'Forklift leaking oil' });
  } else if (/BUILDING STATE|building/i.test(JSON.stringify(body.messages))) {
    content = 'Zone A is busiest. Consider moving one worker from B.';
  } else {
    content = JSON.stringify({ flags: [] });
  }
  return { choices: [{ message: { content: content } }] };
}

server.listen(0, async function () {
  var port = server.address().port;
  var browser = await pw.chromium.launch();
  var page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  var errors = [];
  page.on('pageerror', function (e) { errors.push(String(e)); });
  page.on('dialog', function (d) { d.accept('settled with carrier'); });
  await page.route('https://witness.e-william-harris96.workers.dev/**', async function (route) {
    var req = route.request();
    var u = new URL(req.url());
    var cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    if (u.pathname === '/state') {
      if (req.method() === 'GET') { gets++; return route.fulfill(kv ? { status: 200, headers: cors, body: kv } : { status: 404, headers: cors, body: '{"ok":false}' }); }
      posts++; kv = req.postData(); return route.fulfill({ status: 200, headers: cors, body: '{"ok":true}' });
    }
    if (u.pathname === '/chat') { var b = JSON.parse(req.postData()); chats.push(b); return route.fulfill({ status: 200, headers: cors, body: JSON.stringify(chatReply(b)) }); }
    return route.fulfill({ status: 404, headers: cors, body: '{}' });
  });

  async function go(hash) { await page.evaluate(function (h) { location.hash = h; }, hash); await page.waitForTimeout(150); }
  async function click(sel) { await page.click(sel); await page.waitForTimeout(250); }
  function st() { return page.evaluate(function () { return window.WitnessWmsPage.getState(); }); }

  await page.goto('http://localhost:' + port + '/wms.html');
  await page.waitForSelector('.wmap');
  check('first open with no desk record seeds and POSTs once', posts === 1 && gets >= 1);
  await page.reload();
  await page.waitForSelector('.wmap');
  check('second open is read-only (no POST on page open)', posts === 1);

  /* Home is the warehouse map: the building, no tables. */
  var home = await page.evaluate(function () {
    var m = document.querySelector('#main');
    return { docksIn: m.querySelectorAll('[data-place="dock"][data-side="in"]').length, docksOut: m.querySelectorAll('[data-place="dock"][data-side="out"]').length,
      bins: m.querySelectorAll('[data-place="bin"]').length, rcv: !!m.querySelector('.wm-col-rcv.wm-band'), stg: !!m.querySelector('.wm-col-stg.wm-band'),
      bays: !!m.querySelector('.wm-bays'), tables: m.querySelectorAll('table').length };
  });
  check('home is the map: 4 inbound docks, 4 outbound docks, receiving, staging, bays', home.docksIn === 4 && home.docksOut === 4 && home.rcv && home.stg && home.bays && home.bins === 24);
  check('no data tables on the map', home.tables === 0);
  await go('#/numbers');
  check('the numbers moved one click away (Shift Numbers)', await page.$('.kpis') !== null);
  await go('#/dashboard');

  var s = await st();
  check('loaded state carries the WMS layer', !!(s.wms && s.wms.appointments.length === 3));

  /* Dock: check in IN-1002 */
  await go('#/dock');
  await click('[data-act="checkin"][data-id="APT-102"]');
  s = await st();
  check('check-in brings IN-1002 to Door 3', s.inbound[1].status === 'staged at door');

  /* Receiving: voice read is driven through the AI layer directly
     (no microphone in a headless browser), then posted from the UI. */
  await go('#/receiving');
  await click('[data-act="rcv-open"][data-id="IN-1002"]');
  await page.evaluate(function () {
    var P = window.WitnessWmsPage, s = P.getState();
    var exp = window.WitnessWms.expectedLines(window.WitnessEngine.shipmentById(s, 'IN-1002'));
    return window.WitnessWmsAi.readReceiving(window.fetch.bind(window), 'detergent four pallets, one sixteen cases, four crushed. towels all six pallets, a hundred twenty', exp)
      .then(function (r) { P.ui.rcvLines = r.lines; P.ui.rcvSource = 'voice'; });
  });
  await go('#/dashboard'); await go('#/receiving');
  var v = await page.inputValue('input[data-rcv="received"][data-i="0"]');
  check('voice-read counts fill the receiving grid (116)', v === '116');
  await click('[data-act="rcv-post"]');
  s = await st();
  check('receipt posted: IN-1002 received', s.inbound[1].status === 'received');
  check('OS&D: shortage and damage findings for detergent', s.wms.osd.filter(function (f) { return f.desc === 'Laundry detergent — cases'; }).length === 2);
  check('damaged cases staged on hold with the receiver\'s words', s.staging.some(function (p) { return p.damaged && p.hold && /four crushed/.test(p.hold.reason); }));

  /* Putaway one pallet from the desk, overriding the bin */
  await go('#/putaway');
  var paId = await page.getAttribute('[data-act="pa-confirm"]', 'data-id');
  await page.fill('#pa-' + paId.replace(/([^\w-])/g, '\\$1'), 'B-06');
  await click('[data-act="pa-confirm"][data-id="' + paId + '"]');
  s = await st();
  var pt = s.tasks.find(function (t) { return t.id === paId; });
  check('putaway confirmed to an override bin, suggested vs actual kept', pt.status === 'done' && pt.toBinId === 'B-06');

  /* Orders: release the wave (ORD-603 dog food is held → short) */
  await go('#/orders');
  await click('[data-act="wave"]');
  s = await st();
  var o603 = s.outbound.find(function (o) { return o.id === 'ORD-603'; });
  check('wave released; held dog food is not allocated', o603 && !o603.lines[0].allocated);

  /* Pick ORD-502 (green beans, C-02) fully from the desk */
  await go('#/picking');
  await click('[data-act="pick"][data-id="t-pick-ORD-502-C-02"]');
  s = await st();
  check('pick confirmed; ORD-502 staged at door', s.outbound.find(function (o) { return o.id === 'ORD-502'; }).status === 'staged at door');

  await go('#/ship');
  await click('[data-act="pack"][data-id="t-pack-ORD-502"]');
  await click('[data-act="load"][data-id="t-load-ORD-502"]');
  s = await st();
  check('packed and loaded; an outbound load is open at Door 4', s.wms.loads.length === 1 && s.wms.loads[0].status === 'loading');
  await page.fill('#seal-LD-001', 'SL-7781');
  await click('[data-act="close-load"][data-id="LD-001"]');
  s = await st();
  check('ship confirm closes the load with BOL and seal', s.wms.loads[0].status === 'shipped' && s.wms.loads[0].seal === 'SL-7781');

  /* Flag: label from the stubbed model, words verbatim */
  await go('#/flags');
  await page.fill('#flWords', 'Forklift is leaking oil by B-03');
  await click('[data-act="flag"]');
  await page.waitForTimeout(300);
  s = await st();
  var fl = s.wms.flags[0];
  check('flag filed with the model label and exact words', fl && fl.label === 'Forklift leaking oil' && fl.words === 'Forklift is leaking oil by B-03');

  /* RF console: worker gets next and confirms */
  await go('#/rf');
  await click('[data-act="rf-next"]');
  s = await st();
  var unitId = await page.evaluate(function () { return window.WitnessWmsPage.ui.rfUnit; });
  var cur = s.labor.find(function (u) { return u.id === unitId; }).currentTaskId;
  check('RF console hands the worker a task', !!cur);

  /* Every view renders */
  var views = ['dashboard', 'numbers', 'dock', 'receiving', 'osd', 'putaway', 'locations', 'items', 'counts', 'replen', 'orders', 'picking', 'ship', 'queues', 'labor', 'flags', 'summary', 'audit', 'rf'];
  var bad = [];
  for (var i = 0; i < views.length; i++) {
    await go('#/' + views[i]);
    var h = await page.textContent('.page-head h1').catch(function () { return null; });
    if (!h) bad.push(views[i]);
  }
  check('all ' + views.length + ' views render', bad.length === 0);
  await go('#/dashboard');
  await page.screenshot({ path: process.env.WMS_SHOT || path.join(require('os').tmpdir(), 'wms-dashboard.png'), fullPage: true });

  /* Mobile width: no horizontal scroll on the RF console */
  await page.setViewportSize({ width: 390, height: 800 });
  await go('#/rf');
  var overflow = await page.evaluate(function () { return document.documentElement.scrollWidth > window.innerWidth + 1; });
  check('RF console fits a phone width', !overflow);

  check('no page errors', errors.length === 0);
  if (errors.length) console.log(errors.join('\n'));

  await browser.close();
  server.close();
  console.log('\n' + passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
});
