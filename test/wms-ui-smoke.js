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

var kv = null, gets = 0, posts = 0, chats = [], asrs = 0, describes = 0;
var asrText = 'I decided to keep it on hold until the carrier calls back.';
function chatReply(body) {
  var sys = body.messages[0].content;
  var content;
  if (/understand a part of its own data/.test(sys)) {
    /* Ontology self-extension: Spark describes the new shape */
    describes++;
    content = JSON.stringify({ inferable: true, name: 'Customer returns', summary: 'Goods sent back by customers against an order.',
      connectsTo: ['orders'], evidence: ['orderId', 'reason'] });
  } else if (/working their real task queue/.test(sys)) {
    /* Work by voice: META names the intent from the worker's words */
    var said = String(body.messages[1].content.split('THE WORKER SAID (verbatim):\n')[1] || '').toLowerCase();
    var intent = /next/.test(said) ? 'next' : /picked|done|put away|counted/.test(said) ? 'complete' : /leak|broken|crushed/.test(said) ? 'problem' : 'answer';
    content = JSON.stringify({ intent: intent, about: 'current', say: intent === 'answer' ? 'I do not have that in front of me.' : 'On it.' });
  } else if (/Witness agent on one warehouse item/.test(sys)) {
    content = 'Flagged at receipt: Tommy said "one sixteen cases, four crushed". It is on hold.';
  } else if (/spoken count into numbers/.test(sys)) {
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
  var browser = await pw.chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
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
    if (u.pathname === '/asr') { asrs++; return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ text: asrText }) }); }
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
  check('home is the map: 6 inbound docks, 6 outbound docks, 30 bins, receiving, staging, bays', home.docksIn === 6 && home.docksOut === 6 && home.rcv && home.stg && home.bays && home.bins === 30);
  check('no data tables on the map', home.tables === 0);
  await go('#/summary');
  var labels = await page.$$eval('.kpi .k-label', function (els) { return els.map(function (e) { return e.textContent; }); });
  check('one numbers page: Shift Summary carries every figure', ['Tasks done', 'Open tasks', 'Shipments in', 'Loads out', 'Open flags', 'OS&D open', 'Holds now',
    'Fill rate', 'Inventory accuracy', 'Dock to stock', 'Replenishment'].every(function (l) { return labels.indexOf(l) !== -1; }));
  check('Shift Numbers is gone: no sidebar entry, no #/numbers page', (await page.$('a[href="#/numbers"]')) === null &&
    (await page.evaluate(async function () { location.hash = '#/numbers'; await new Promise(function (r) { setTimeout(r, 150); }); return !!document.querySelector('.wmap') && !document.querySelector('.kpis'); })));
  await go('#/dashboard');

  var s = await st();
  check('loaded state carries the WMS layer', !!(s.wms && s.wms.appointments.length === 5));

  /* Dock & Yard is merged into Receiving: the old link lands there */
  await go('#/dock');
  check('#/dock opens Receiving, no Dock & Yard menu item', (await page.$('a[href="#/dock"]')) === null && /Receiving/.test(await page.textContent('#main h1')));
  await click('[data-act="checkin"][data-id="APT-102"]');
  s = await st();
  check('check-in brings IN-1002 to Inbound Door 3', s.inbound[1].status === 'staged at door');

  /* Receiving: voice read is driven through the AI layer directly
     (no microphone in a headless browser), then posted from the UI. */
  await go('#/receiving');
  await click('[data-act="rcv-open"][data-id="IN-1002"]');
  await page.evaluate(function () {
    var P = window.WitnessWmsPage, s = P.getState();
    var exp = window.WitnessWms.expectedLines(window.WitnessEngine.shipmentById(s, 'IN-1002'));
    return window.WitnessWmsAi.readReceiving(window.fetch.bind(window), 'detergent four pallets, one sixteen cases, four crushed. towels all six pallets, a hundred twenty', exp)
      .then(function (r) { P.ui.rcvLines = r.lines; P.ui.rcvSource = 'voice'; P.ui.rcvTranscript = 'detergent four pallets, one sixteen cases, four crushed. towels all six pallets, a hundred twenty'; });
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
  check('packed and loaded; an outbound load is open at Outbound Door 4', s.wms.loads.length === 1 && s.wms.loads[0].status === 'loading');
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

  /* The Witness page: click a pallet on the map, read its record. */
  await go('#/dashboard');
  var postsBefore = posts;
  var palletId = await page.getAttribute('[data-place="receiving"][data-id="Inbound Door 3"] [data-place="pallet"]', 'data-id');
  await click('[data-place="pallet"][data-id="' + palletId + '"]');
  var wp = await page.evaluate(function () {
    var m = document.querySelector('#main'), pg = m.querySelector('.wp-page');
    if (!pg) return null;
    var order = ['[data-slot="agent"]', '[data-panel="events"]', '[data-panel="transcript"]'].map(function (q) { var el = pg.querySelector(q); return el ? el.getBoundingClientRect() : null; });
    return { hash: location.hash, title: pg.querySelector('h1').textContent, events: pg.querySelectorAll('.wp-ev').length,
      lines: Array.prototype.map.call(pg.querySelectorAll('.wp-line blockquote'), function (b) { return b.textContent; }),
      agentTop: order[0] && order[1] && order[0].bottom <= order[1].top, leftRight: order[1] && order[2] && order[1].left < order[2].left && Math.abs(order[1].top - order[2].top) < 2 };
  });
  check('a pallet click on the map opens its Witness page', !!wp && wp.hash === '#/witness/pallet/' + encodeURIComponent(palletId) && wp.title === 'Pallet ' + palletId);
  check('Witness page: agent chair on top, events left, transcript right', !!wp && wp.agentTop && wp.leftRight);
  check('Witness page: events from the record, and the receiver\'s words verbatim', !!wp && wp.events >= 2 &&
    wp.lines.indexOf('detergent four pallets, one sixteen cases, four crushed. towels all six pallets, a hundred twenty') !== -1);
  check('opening a Witness page saves nothing', posts === postsBefore);

  /* The agent in the chair (Task 3): ask, then tell by typing and by voice. */
  var chatsBefore = chats.length;
  await page.fill('#agQ', 'why is this flagged?');
  await page.press('#agQ', 'Enter');
  await page.waitForSelector('.ag-turn.ag-agent:not(.pending)');
  var asked = await page.evaluate(function () {
    var a = document.querySelector('.ag-turn.ag-agent:not(.pending)');
    return { text: a.querySelector('p').textContent, check: (a.querySelector('.ag-check') || {}).textContent || '', you: (document.querySelector('.ag-you p') || {}).textContent };
  });
  var askBody = chats[chatsBefore] ? JSON.stringify(chats[chatsBefore].messages) : '';
  check('agent: a question (Enter) is answered from this pallet\'s record', /Tommy said/.test(asked.text) && asked.you === 'why is this flagged?' &&
    askBody.indexOf('ITEM RECORD — Pallet ' + palletId) !== -1 && askBody.indexOf('DESK QUESTION: why is this flagged?') !== -1 && /one sixteen cases, four crushed/.test(asked.check));
  check('agent: asking saves nothing', posts === postsBefore);
  await page.fill('#agQ', 'Called the carrier, photos by noon.');
  await click('[data-act="agent-tell"]');
  await page.waitForTimeout(300);
  var told = await page.evaluate(function () {
    var desk = Array.prototype.map.call(document.querySelectorAll('.wp-line.desk'), function (l) { return { words: l.querySelector('blockquote').textContent, src: l.querySelector('.wp-src').textContent }; });
    var ev = Array.prototype.map.call(document.querySelectorAll('.wp-ev'), function (l) { return l.textContent; });
    return { desk: desk, ev: ev, rec: !!document.querySelector('.ag-rec') };
  });
  s = await st();
  var last = s.records[s.records.length - 1];
  check('agent: a typed update lands in the transcript as a desk entry and saves once', posts === postsBefore + 1 && told.rec &&
    told.desk.some(function (d) { return d.words === 'Called the carrier, photos by noon.' && /Desk · typed/.test(d.src); }) &&
    told.ev.some(function (t) { return /Desk update/.test(t) && /photos by noon/.test(t); }) && last.kind === 'desk' && last.by === 'u-sam');
  var box = await page.locator('#agTalk').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  await page.waitForFunction(function () { return Array.prototype.some.call(document.querySelectorAll('.wp-line.desk .wp-src'), function (x) { return /spoken/.test(x.textContent); }); }, null, { timeout: 8000 }).catch(function () {});
  var spoke = await page.evaluate(function () {
    var dec = Array.prototype.filter.call(document.querySelectorAll('.wp-ev.decision'), function (l) { return /carrier calls back/.test(l.textContent); })[0];
    return { line: Array.prototype.some.call(document.querySelectorAll('.wp-line.desk'), function (l) { return /Desk · spoken/.test(l.textContent) && /keep it on hold until the carrier calls back/.test(l.textContent); }),
      decided: dec ? dec.querySelector('.wp-who').textContent : '', law: !!document.querySelector('.ag-rec.decision') };
  });
  s = await st();
  check('agent: a spoken decision lands as a desk entry and an event decided by the person', asrs === 1 && spoke.line && /Decided by Sam/.test(spoke.decided) && spoke.law &&
    posts === postsBefore + 2 && !!s.staging.find(function (p) { return p.id === palletId; }));
  postsBefore = posts;
  await go('#/dashboard');
  await page.focus('[data-place="bin"][data-id="C-08"]');
  await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  var empty = await page.evaluate(function () { var pg = document.querySelector('.wp-page'); return pg && { ev: pg.querySelector('[data-panel="events"] .wp-empty') ? pg.querySelector('[data-panel="events"] .wp-empty').textContent : '', tr: pg.querySelector('[data-panel="transcript"] .wp-empty') ? pg.querySelector('[data-panel="transcript"] .wp-empty').textContent : '' }; });
  check('Enter on a bin opens it; an untouched bin is empty-honest', !!empty && /Nothing on the record yet/.test(empty.ev) && /^Not said\./.test(empty.tr));
  await page.setViewportSize({ width: 390, height: 800 });
  check('Witness page fits a phone width', !(await page.evaluate(function () { return document.documentElement.scrollWidth > window.innerWidth + 1; })));
  await page.setViewportSize({ width: 1280, height: 900 });

  /* Flags on the map (Console Task 4): only urgent items carry one;
     a flag click lands on that item's own Witness page. */
  await go('#/dashboard');
  var fl = await page.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('.wmap [data-flag]'), function (a) {
      var host = a.closest('[data-place]');
      return { href: a.getAttribute('href'), host: host ? host.dataset.place + '/' + host.dataset.id : null };
    });
  });
  var heldPallet = await page.evaluate(function () { var p = window.WitnessWmsPage.getState().staging.filter(function (x) { return x.hold; })[0]; return p ? p.id : null; });
  var calmPallet = await page.evaluate(function () { var p = window.WitnessWmsPage.getState().staging.filter(function (x) { return !x.hold; })[0]; return p ? p.id : null; });
  check('a held pallet carries a flag on the map', !!heldPallet && fl.some(function (f) { return f.href === '#/witness/pallet/' + encodeURIComponent(heldPallet) && f.host === 'pallet/' + heldPallet; }));
  check('a pallet with nothing urgent carries no flag', !!calmPallet && (await page.$$('.wmap [data-place="pallet"][data-id="' + calmPallet + '"] [data-flag]')).length === 0);
  await click('.wmap [data-place="pallet"][data-id="' + heldPallet + '"] [data-flag]');
  var landed = await page.evaluate(function () { var pg = document.querySelector('.wp-page'); return { hash: location.hash, title: pg ? pg.querySelector('h1').textContent : '' }; });
  check('a flag click lands on that item\'s Witness page', landed.hash === '#/witness/pallet/' + encodeURIComponent(heldPallet) && landed.title === 'Pallet ' + heldPallet);
  await go('#/dashboard');
  var osdFlag = fl.filter(function (f) { return /^#\/witness\/shipment\//.test(f.href); })[0];
  check('an open OS&D finding flags its dock', !!osdFlag && /^dock\//.test(osdFlag.host));
  if (osdFlag) {
    await click('.wmap [data-flag][href="' + osdFlag.href + '"]');
    check('the OS&D flag lands on the shipment\'s Witness page', await page.evaluate(function () { return location.hash; }) === osdFlag.href &&
      /^Shipment /.test(await page.textContent('.wp-page h1')));
    await go('#/dashboard');
  }

  /* Work by voice on the live queue (the full-flow voice brief):
     real hold-to-talk through the stubbed /asr. Every act stages and
     asks with nothing saved; only the next yes saves. */
  async function say(text) {
    asrText = text;
    await page.locator('#wvTalk').scrollIntoViewIfNeeded();
    var b = await page.locator('#wvTalk').boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await page.waitForFunction(function (t) { var v = window.WitnessWmsPage.ui.voice; return !v.busy && v.heard === t && !!v.line; }, text, { timeout: 8000 }).catch(function () {});
    await page.waitForTimeout(150);
    return page.evaluate(function () { var v = window.WitnessWmsPage.ui.voice; return { line: v.line, note: v.note, staged: !!v.stage, refused: v.refused, shown: (document.querySelector('#main .notice.info, #main .notice.bad') || {}).textContent || '' }; });
  }
  await go('#/queues');
  check('Work by voice rides the Task Queues screen', !!(await page.$('#wvTalk')) && !!(await page.$('#wvWho')));
  await page.selectOption('#wvWho', 'u-tommy');
  await page.waitForTimeout(150);
  s = await st();
  var tommyBefore = s.labor.find(function (u) { return u.id === 'u-tommy'; }).currentTaskId;
  var vp = posts;
  var v1 = await say("what's next");
  check('voice: "what\'s next" with nothing assigned says so plainly — nothing staged, nothing saved',
    v1.line === 'Nothing is assigned to you right now.' && !v1.staged && posts === vp && !tommyBefore && v1.shown === v1.line);
  /* The desk assigns Tommy two tasks (Reassign): one in hand, one queued behind it. */
  var picksB = s.tasks.filter(function (t) { return t.type === 'pick' && t.zone === 'B' && t.status === 'open' && !t.queuedFor; });
  for (var pi = 0; pi < 2; pi++) {
    await page.selectOption('#raTask', picksB[pi].id);
    await page.selectOption('#raUnit', 'u-tommy');
    await click('[data-act="reassign"]');
  }
  await page.selectOption('#wvWho', 'u-tommy');
  await page.waitForTimeout(150);
  s = await st();
  var tCur = s.tasks.find(function (t) { return t.id === s.labor.find(function (u) { return u.id === 'u-tommy'; }).currentTaskId; });
  vp = posts;
  var v2 = await say("what's next");
  s = await st();
  check('voice: "what\'s next" names the next task on his assigned list — nothing staged, nothing saved, nothing pulled',
    /^After this one: Pick /.test(v2.line) && !v2.staged && posts === vp && !!tCur && tCur.id === picksB[0].id &&
    s.tasks.find(function (t) { return t.id === picksB[1].id; }).queuedFor === 'u-tommy');
  vp = posts;
  var doneWords = tCur.type === 'pick' ? 'picked ' + tCur.qty : 'done';
  var v3 = await say(doneWords);
  check('voice: a completion stages "Mark … complete?" — nothing saved', /^Mark ".*" complete/.test(v3.line) && v3.staged && posts === vp);
  var v4 = await say('yes');
  s = await st();
  var closed = s.tasks.find(function (t) { return t.id === tCur.id; });
  check('voice: the next "yes" closes it through the WMS path, attributed by voice, words after the act — and pulls nothing', closed.status === 'done' && closed.via === 'voice' &&
    closed.doneBy === 'u-tommy' && posts === vp + 1 && !v4.refused && /Next on your list: Pick /.test(v4.line) &&
    !s.labor.find(function (u) { return u.id === 'u-tommy'; }).currentTaskId);
  vp = posts;
  var v5 = await say('oil leaking by B-03');
  var v6 = await say('no');
  check('voice: a spoken problem stages a flag; "no" files nothing', /^File a flag with your words/.test(v5.line) && /^Not filed/.test(v6.line) && posts === vp);
  await go('#/putaway');
  check('Work by voice rides the flow views too (Putaway)', !!(await page.$('#wvTalk')));

  /* Every view renders */
  var views = ['dashboard', 'receiving', 'osd', 'putaway', 'locations', 'items', 'counts', 'replen', 'orders', 'picking', 'ship', 'queues', 'labor', 'flags', 'summary', 'audit', 'ontology', 'rf'];
  var bad = [];
  for (var i = 0; i < views.length; i++) {
    await go('#/' + views[i]);
    var h = await page.textContent('.page-head h1').catch(function () { return null; });
    if (!h) bad.push(views[i]);
  }
  check('all ' + views.length + ' views render', bad.length === 0);

  /* Ontology self-extension: a whole shift worked through the UI
     gave the detector nothing to flag — no describe call, no
     concept. Then the WMS grows a feature (a returns section lands
     in the desk record): the console detects it, Spark describes
     it, the digest announces it, and a person settles it. */
  s = await st();
  check('self-extension: a worked shift through the UI stays quiet — no describe call, no concept', describes === 0 && !s.concepts);
  var grown = JSON.parse(kv);
  grown.returns = [{ id: 'RMA-1', orderId: 'ORD-501', reason: 'crushed case', qty: 2 }];
  grown.wmsRev = (grown.wmsRev || 0) + 1;
  kv = JSON.stringify(grown);
  await go('#/flags');
  /* The announcement is a TRANSIENT prep note, by design: only the
     applyChange that first sees the concept described carries it, and
     the next digest rebuild drops it (never re-announced). So it is
     read where it is guaranteed — from the digests this refresh
     itself produces, captured as the page makes them — not later on
     the Ontology page, where a rebuild may already have replaced it.
     The capture only observes: each call returns the product's own
     digest unchanged. */
  await page.evaluate(function () {
    var O = window.WitnessOntology, orig = O.applyChange;
    window.__ann = [];
    window.__annRestore = function () { O.applyChange = orig; };
    O.applyChange = function (st, prev) {
      var d = orig.apply(this, arguments);
      var c = st && st.concepts && st.concepts.returns;
      window.__ann.push({ described: !!(c && c.status === 'described'),
        notes: (d.prep || []).filter(function (n) { return /^New concept in the building: 'Customer returns'/.test(n.note); }).length });
      return d;
    };
  });
  await click('[data-act="refresh"]');
  await page.waitForFunction(function () {
    var x = window.WitnessWmsPage.getState(); return !!(x.concepts && x.concepts.returns && x.concepts.returns.status === 'described');
  }, null, { timeout: 5000 }).catch(function () {});
  await page.waitForFunction(function () {
    return window.__ann.some(function (a) { return a.described; });
  }, null, { timeout: 5000 }).catch(function () {});
  await page.waitForTimeout(300);
  var ann = await page.evaluate(function () { window.__annRestore(); return window.__ann; });
  var firstDescribed = -1;
  ann.forEach(function (a, i) { if (firstDescribed === -1 && a.described) firstDescribed = i; });
  var announcedAt = [];
  ann.forEach(function (a, i) { if (a.notes) announcedAt.push(i); });
  check('self-extension: the digest announces it at the refresh that described it — once, on the digest that first saw it described',
    firstDescribed !== -1 && announcedAt.length >= 1 && announcedAt[0] === firstDescribed &&
    ann[firstDescribed].notes === 1 && ann.slice(0, firstDescribed).every(function (a) { return a.notes === 0; }));
  await go('#/ontology');
  s = await st();
  check('self-extension: the new section is detected and described by the AI (one call), AI-inferred, not settled',
    describes === 1 && !!(s.concepts && s.concepts.returns) && s.concepts.returns.status === 'described' &&
    s.concepts.returns.source === 'ai-inferred' && JSON.parse(kv).concepts.returns.status === 'described');
  var onto = await page.evaluate(function () {
    var m = document.querySelector('#main');
    return { row: /Customer returns/.test(m.textContent) && /Described · AI-inferred/.test(m.textContent),
      settle: !!m.querySelector('[data-act="concept-settle"][data-key="returns"]') };
  });
  check('self-extension: the Ontology page lists it with its status and a Settle button', onto.row && onto.settle);
  await click('[data-act="concept-settle"][data-key="returns"]');
  await page.waitForTimeout(300);
  s = await st();
  check('self-extension: a person settles it — saved with their name; nothing settled on its own',
    s.concepts.returns.status === 'settled' && !!s.concepts.returns.settledBy && JSON.parse(kv).concepts.returns.status === 'settled' && describes === 1);

  await go('#/dashboard');
  await page.screenshot({ path: process.env.WMS_SHOT || path.join(require('os').tmpdir(), 'wms-dashboard.png'), fullPage: true });

  /* Demo polish item 2: entering and leaving the practice copy is
     ONE render — the switch happens in place (no page load, so the
     static "Loading the desk record…" shell never paints), the URL
     gains / loses the flag with the view kept, and the live record
     is never written by the practice copy. */
  async function watchRenders() {
    await page.evaluate(function () {
      var main = document.getElementById('main');
      window.__sameDoc = true;
      window.__renders = 0;
      window.__sawShell = false;
      if (window.__mo) window.__mo.disconnect();
      window.__mo = new MutationObserver(function (ms) {
        ms.forEach(function (m) {
          if (m.target !== main) return;
          if (m.addedNodes.length) window.__renders++;
          if (main.querySelector('.loading')) window.__sawShell = true;
        });
      });
      window.__mo.observe(main, { childList: true });
    });
  }
  function renderStats() {
    return page.evaluate(function () {
      return { same: window.__sameDoc === true, renders: window.__renders, shell: window.__sawShell,
        practice: new URLSearchParams(location.search).has('practice'), hash: location.hash,
        banner: !!document.querySelector('#main .notice.practice'), start: !!document.querySelector('[data-act="game-start"]') };
    });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await go('#/dashboard');
  var pPosts = posts;
  await watchRenders();
  await page.click('[data-act="enter-practice"]');
  await page.waitForFunction(function () { return !!document.querySelector('#main .notice.practice'); }, null, { timeout: 5000 }).catch(function () {});
  await page.waitForTimeout(300);
  var enter = await renderStats();
  check('practice: entering switches in place — one render of the view, no page load, no loading shell',
    enter.same && enter.renders === 1 && !enter.shell);
  check('practice: the URL carries the flag, the view is kept, the banner shows and the game is playable',
    enter.practice && enter.hash === '#/dashboard' && enter.banner && enter.start);
  var pGets = gets, kvBefore = kv;
  /* Game-data split (job build step 1): the practice copy is the
     game's OWN building — not a copy of the live record. */
  var gw = await page.evaluate(function () {
    var x = window.WitnessWmsPage.getState();
    return { world: x.world, first: x.inbound[0].id, crew: x.labor.map(function (u) { return u.id; }).join(','),
      banner: (document.querySelector('#main .notice.practice') || {}).textContent || '' };
  });
  check('game data: the practice copy is the game\'s own building (world "game", its own trucks and crew), and the banner says so',
    gw.world === 'game' && gw.first === 'IN-2001' && /^g-/.test(gw.crew) && !/u-sam/.test(gw.crew) && /game's own building/.test(gw.banner));
  await page.click('[data-act="game-start"]');
  await page.waitForTimeout(250);
  await page.click('[data-act="game-doit"]');
  await page.waitForTimeout(400);
  check('practice: a shift started on the in-place copy writes nothing to the desk record', posts === pPosts);
  check('game data: starting and working a game step never reads or writes /state; the desk record is byte-identical',
    gets === pGets && posts === pPosts && kv === kvBefore);
  await watchRenders();
  await page.click('[data-act="end-practice"]');
  await page.waitForFunction(function () { return !document.querySelector('#main .notice.practice'); }, null, { timeout: 5000 }).catch(function () {});
  await page.waitForTimeout(300);
  var leave = await renderStats();
  check('practice: leaving switches in place — one render of the view, no page load, no loading shell',
    leave.same && leave.renders === 1 && !leave.shell);
  check('practice: back on the live record — no flag, same view, no banner, the shift forgotten, nothing saved',
    !leave.practice && leave.hash === '#/dashboard' && !leave.banner &&
    !(await page.$('[data-act="game-start"]')) && !(await page.$('.game-you')) && posts === pPosts);

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
