/* sam-toggle-ui-test.js — drives index.html's Step 2 in a real browser
   (Playwright) against a STUBBED Worker, with the SAM 3.1 toggle OFF
   and then ON (briefs/claude-brief-sam-toggle.md).
   OFF: no /segment call, the compare prompt and the saved OS&D record
   are exactly today's. ON: four /segment calls (one per concept) fired
   alongside the photo scan, the boxes drawn over the sheet, the label
   crops read through /chat as data: images, the evidence block in the
   comparison, samEvidence on the saved record, and one failed concept
   reported as unavailable — never blocking the scan.
   Skips (exit 0) when Playwright is not installed.
   Run: node test/sam-toggle-ui-test.js */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');

var pw;
try { pw = require('playwright'); } catch (e) { console.log('SKIP  playwright not installed'); process.exit(0); }

var ROOT = path.join(__dirname, '..');
var failures = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (!cond) failures++; }

var TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp' };
var server = http.createServer(function (req, res) {
  var p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  var f = path.join(ROOT, p);
  if (f.indexOf(ROOT) !== 0 || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

var chats, segments, saves;
function reset() { chats = []; segments = []; saves = []; }

var SEG = {
  'cardboard box': [{ box: { x1: 100, y1: 100, x2: 160, y2: 160 }, score: 0.8 }, { box: { x1: 600, y1: 120, x2: 660, y2: 180 }, score: 0.7 }],
  'shipping label': [{ box: { x1: 120, y1: 120, x2: 150, y2: 140 }, score: 0.9 }],
  'damaged cardboard box': [{ box: { x1: 300, y1: 260, x2: 400, y2: 340 }, score: 0.6 }]
  /* 'torn plastic wrap' answers 502 — the failure case */
};

function chatReply(body) {
  var sys = body.messages[0].content;
  var content;
  if (/photo scan for a warehouse/.test(sys)) {
    content = JSON.stringify({ flags: [{ label: 'Crushed cartons', side: 'front', detail: 'Cartons torn open mid-stack on the front.' }] });
  } else if (/comparison step/.test(sys)) {
    content = JSON.stringify({ verdicts: [{ point: 'Front damage', verdict: 'flag', human: 'not mentioned', photo: 'Crushed cartons, front', note: 'Photo shows damage the receiver did not mention.' }] });
  } else if (/crop of a contact-sheet photo/.test(sys)) {
    content = JSON.stringify({ text: 'PEACHES 24/15OZ' });
  } else {
    content = JSON.stringify({ flags: [] });
  }
  return { choices: [{ message: { content: content } }] };
}

var SCAN = { transcript: 'Twenty-four cases of peaches, looks fine.', flags: [], loadKey: 'b', loadLabel: 'Load B — peaches stack' };

server.listen(0, async function () {
  var port = server.address().port;
  var browser = await pw.chromium.launch();
  var page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  var errors = [];
  page.on('pageerror', function (e) { errors.push(String(e)); });
  await page.route('https://witness.e-william-harris96.workers.dev/**', async function (route) {
    var req = route.request();
    var u = new URL(req.url());
    var body = req.postData() ? JSON.parse(req.postData()) : null;
    var cors = { 'Access-Control-Allow-Origin': '*' };
    if (u.pathname === '/chat') {
      chats.push(body);
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(chatReply(body)) });
    }
    if (u.pathname === '/segment') {
      segments.push(body);
      if (!SEG[body.concept]) return route.fulfill({ status: 502, contentType: 'application/json', headers: cors, body: JSON.stringify({ error: 'segmentation service answered with an error (HTTP 500)' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ concept: body.concept, matches: SEG[body.concept] }) });
    }
    if (u.pathname === '/save') {
      saves.push(body);
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, key: 'k' }) });
    }
    return route.fulfill({ status: 404, headers: cors, body: '{}' });
  });

  await page.goto('http://localhost:' + port + '/index.html');
  await page.evaluate(function () { try { localStorage.removeItem('witness.samEvidence'); } catch (e) {} });
  await page.reload();

  /* --- the switch ----------------------------------------------------- */
  check('toggle: present, labeled "SAM 3.1 evidence"', await page.locator('label:has(#samToggle)').innerText().then(function (t) { return /SAM 3\.1 evidence/.test(t); }));
  check('toggle: OFF by default', (await page.isChecked('#samToggle')) === false);
  check('toggle: OFF state is visible in words', /^OFF/.test(await page.textContent('#samToggleState')));

  /* --- OFF: today's flow ------------------------------------------------ */
  reset();
  await page.evaluate(function (scan) { return window.WitnessPhoto.runWithScan(scan); }, SCAN);
  await page.click('#osdSaveBtn');
  await page.waitForFunction(function () { return document.getElementById('osdSaveBtn').textContent === 'Saved.'; });
  check('OFF: no /segment calls', segments.length === 0);
  check('OFF: exactly two /chat calls (photo, comparison)', chats.length === 2);
  check('OFF: the compare prompt carries no SAM rule', !/SAM 3\.1/.test(chats[1].messages[0].content) && !/SAM 3\.1/.test(chats[1].messages[1].content));
  check('OFF: the saved record has exactly today\'s keys', Object.keys(saves[0]).join() === 'load,kind,transcript,flags,verdicts,savedAt');
  check('OFF: the OS&D has no SAM line', !/SAM 3\.1/.test(saves[0].transcript));
  check('OFF: no overlay shown', await page.isHidden('#samFigure'));

  /* --- ON ------------------------------------------------------------- */
  await page.check('#samToggle');
  check('toggle: ON state is visible in words', /^ON/.test(await page.textContent('#samToggleState')));
  await page.reload();
  check('toggle: ON survives a reload (localStorage)', (await page.isChecked('#samToggle')) === true);

  reset();
  var res = await page.evaluate(function (scan) { return window.WitnessPhoto.runWithScan(scan); }, SCAN);
  check('ON: one /segment call per concept, four in all', segments.length === 4 &&
    segments.map(function (s) { return s.concept; }).sort().join('|') === ['cardboard box', 'damaged cardboard box', 'shipping label', 'torn plastic wrap'].join('|'));
  check('ON: /segment sends the sheet as a data URL', segments.every(function (s) { return typeof s.imageData === 'string' && s.imageData.indexOf('data:image/jpeg;base64,') === 0; }));
  check('ON: a failed concept did not block the scan', !!res && res.verdicts.length === 1);
  var labelCalls = chats.filter(function (c) { return /crop of a contact-sheet photo/.test(c.messages[0].content); });
  check('ON: the located label was cropped and read through /chat as a data: image',
    labelCalls.length === 1 && /^data:image\/jpeg;base64,/.test(labelCalls[0].messages[1].content[1].image_url.url));
  var cmp = chats.filter(function (c) { return /comparison step/.test(c.messages[0].content); })[0];
  check('ON: the compare prompt gains the SAM rule', /SAM 3\.1 EVIDENCE/.test(cmp.messages[0].content));
  check('ON: the evidence block rides with the photo scan', /PHOTO SCAN — SAM 3\.1 segmentation evidence/.test(cmp.messages[1].content) &&
    /"torn plastic wrap":"unavailable"/.test(cmp.messages[1].content));
  check('ON: the label read joined the photo flags', /PEACHES 24\/15OZ/.test(cmp.messages[1].content));
  check('ON: overlay shown with one box per match (4)', (await page.isVisible('#samFigure')) && (await page.locator('#samFigure .sam-box').count()) === 4);
  check('ON: OS&D says evidence attached with the carton count', /SAM 3\.1 evidence attached: 2 cartons segmented/.test(res.osd));
  check('ON: OS&D names the unavailable concept', /requested but unavailable for: torn plastic wrap/.test(res.osd));

  await page.click('#osdSaveBtn');
  await page.waitForFunction(function () { return document.getElementById('osdSaveBtn').textContent === 'Saved.'; });
  var rec = saves[0];
  check('ON: the saved record carries samEvidence', !!rec.samEvidence && rec.samEvidence.on === true);
  check('ON: carton boxes with sides, no mask data', rec.samEvidence.concepts['cardboard box'].count === 2 &&
    rec.samEvidence.concepts['cardboard box'].boxes.map(function (b) { return b.side; }).join() === 'front,right' &&
    !/mask/i.test(JSON.stringify(rec.samEvidence)));
  check('ON: the failed concept is unavailable on the record', rec.samEvidence.concepts['torn plastic wrap'].unavailable === true);

  /* --- ON, SAM unreachable --------------------------------------------- */
  await page.route('https://witness.e-william-harris96.workers.dev/segment', function (route) { return route.abort(); });
  reset();
  res = await page.evaluate(function (scan) { return window.WitnessPhoto.runWithScan(scan); }, SCAN);
  check('ON, SAM unreachable: the scan still completes', !!res && res.verdicts.length === 1);
  check('ON, SAM unreachable: OS&D says requested but unavailable', /SAM 3\.1 evidence was requested but unavailable — none was attached\./.test(res.osd));
  check('ON, SAM unreachable: no label reads were attempted', chats.length === 2);

  /* back to OFF for whoever opens this profile next */
  await page.uncheck('#samToggle');
  check('no page errors', errors.length === 0);
  if (errors.length) console.log(errors.join('\n'));

  await browser.close();
  server.close();
  console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASS');
  process.exit(failures ? 1 : 0);
});
