/* glasses-state-smoke-test.js — drives glasses.html and warehouse.html
   in a real browser (Playwright) against a STUBBED Worker: /state is an
   in-memory KV, nothing leaves the machine. The desk-phone smoke
   pattern, for the glasses shared-state brief:
     - warehouse glasses boot from the shared record, read-only
     - the wearer's talk ("what's next", "done", "yes") lands on the
       shared record; the WMS layer rides along; a fresh GET follows
     - the desk, opened after, shows the same world
     - a desk change reaches the glasses when they become visible again
     - a failed save is said on the glasses; the next save carries it
     - record down at boot: plain words on the start screen, no seed,
       no glasses.js, no phantom world
     - a first-ever open from the glasses seeds once
     - the kitchen world: zero /state calls, no wrap, boots as before
   Talk enters where the real mic hands it in: the transcript callback
   glasses.js gives js/warehouse-mic.js (captured, not replaced).
   Skips (exit 0) when Playwright is not installed.
   Run: node test/glasses-state-smoke-test.js */
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
  var f = path.join(ROOT, p);
  if (f.indexOf(ROOT) !== 0 || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

var kv = null, log = [], down = false, postFail = false;
async function stub(ctx) {
  await ctx.route(/^https?:\/\/(?!localhost)/, function (r) { r.abort(); });
  await ctx.route('https://witness.e-william-harris96.workers.dev/**', async function (route) {
    var req = route.request();
    var u = new URL(req.url());
    var cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    if (u.pathname === '/state') {
      if (down) return route.abort('failed');
      log.push(req.method());
      if (req.method() === 'GET') return route.fulfill(kv ? { status: 200, headers: cors, body: kv } : { status: 404, headers: cors, body: '{"ok":false,"error":"no state yet"}' });
      if (postFail) return route.fulfill({ status: 500, headers: cors, body: '{"ok":false}' });
      kv = req.postData();
      return route.fulfill({ status: 200, headers: cors, body: '{"ok":true}' });
    }
    return route.fulfill({ status: 404, headers: cors, body: '{}' });
  });
}
function doc() { return JSON.parse(kv); }
function unit(d, id) { return d.labor.filter(function (u) { return u.id === id; })[0]; }
function task(d, id) { return d.tasks.filter(function (t) { return t.id === id; })[0]; }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* Keep the transcript callback glasses.js hands the mic, so a test can
   speak exactly where a real transcript lands. warehouse-mic.js itself
   still loads and attaches unchanged. */
var MIC_TAP = function () {
  var real;
  Object.defineProperty(window, 'WitnessMic', {
    configurable: true,
    get: function () { return real; },
    set: function (v) {
      real = v;
      var attach = v.attach;
      v.attach = function (el, o) { window.__mic = o; return attach.apply(this, arguments); };
    }
  });
};

server.listen(0, async function () {
  var base = 'http://localhost:' + server.address().port;
  var browser = await pw.chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  var errors = [];
  async function open(url, viewport) {
    var ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 } });
    await stub(ctx);
    await ctx.addInitScript(MIC_TAP);
    var page = await ctx.newPage();
    page.on('pageerror', function (e) { errors.push(url + ': ' + String(e)); });
    await page.goto(base + url);
    return page;
  }
  async function glassesReady(page) { await page.waitForSelector('#pickList [data-unit]'); await page.waitForFunction(function () { return !document.getElementById('openBtn').disabled; }); }
  async function say(page, text) { await page.evaluate(function (t) { window.__mic.onText(t); }, text); await wait(350); }
  function meta(page) { return page.textContent('#metaText'); }

  try {
    /* ---------------- the desk seeds the record ---------------- */
    var desk = await open('/warehouse.html');
    await desk.waitForSelector('#nameChips .namechip');
    var d0 = doc(); d0.wms = { marker: 'kept' }; kv = JSON.stringify(d0);
    var rev0 = d0.wmsRev || 0;
    await desk.context().close();

    /* ---------------- glasses boot: read-only ---------------- */
    log.length = 0;
    var g = await open('/glasses.html?unit=u-marcus', { width: 390, height: 844 });
    await glassesReady(g);
    check('boot: the glasses read the shared record, GET only', log.join(',') === 'GET');
    var boot = await g.evaluate(function () {
      return {
        scripts: [].map.call(document.scripts, function (s) { return s.getAttribute('src'); }).filter(Boolean),
        engineIsReal: Object.getPrototypeOf(window.WitnessEngine) === Object.prototype,
        rec: !!document.getElementById('recBtn'), help: !!document.querySelector('.gh-info'),
        note: (document.getElementById('gsStart') || {}).hidden
      };
    });
    var order = boot.scripts.filter(function (s) { return /glasses\.js|recorder\.js|glasses-help\.js|state\.js/.test(s); });
    check('boot: state.js, then glasses.js → recorder.js → glasses-help.js, each once', order.join(' ') === 'js/glasses-state.js js/state.js js/glasses.js js/recorder.js js/glasses-help.js');
    check('boot: recorder and help are up', boot.rec && boot.help);
    check('boot: the real engine is back on window after glasses.js took its view', boot.engineIsReal);
    check('boot: the loading line is gone', boot.note === true);
    check('boot: the start screen lists the record\'s workers', /Marcus/.test(await g.textContent('#pickList')));

    /* ---------------- the wearer works ---------------- */
    await g.click('#openBtn');
    await g.waitForSelector('#view:not([hidden])');
    log.length = 0;
    await say(g, "what's next");
    var marcusTask = unit(doc(), 'u-marcus').currentTaskId;
    check('"what\'s next" on the glasses: the task lands on the shared record', !!marcusTask);
    check('"what\'s next": POST, then a fresh GET', log.join(',') === 'POST,GET');
    check('the WMS layer rode along untouched', doc().wms && doc().wms.marker === 'kept');
    check('wmsRev stamped past the desk\'s', (doc().wmsRev || 0) > rev0);

    await say(g, 'done');
    check('"done" asks and closes nothing yet', /complete\?/.test(await meta(g)) && task(doc(), marcusTask).status === 'assigned');
    await say(g, 'yes');
    check('"yes" closes the task on the shared record', task(doc(), marcusTask).status === 'done');
    var nextTask = unit(doc(), 'u-marcus').currentTaskId;

    /* ---------------- the desk, opened after, shows the same world ---------------- */
    var desk2 = await open('/warehouse.html');
    await desk2.waitForSelector('#nameChips .namechip');
    await desk2.click('#nameChips [data-unit="u-marcus"]');
    var card = await desk2.textContent('#taskCard');
    var want = nextTask ? task(doc(), nextTask).title : null;
    check('the desk opened after shows the glasses\' world (Marcus\'s next task, or nothing in hand)', want ? card.indexOf(want) !== -1 : /Nothing in hand/.test(card));

    /* ---------------- a desk change reaches the glasses on visible ---------------- */
    var dd = doc(); dd.tasks[0].note = 'desk-made'; dd.wmsRev = (dd.wmsRev || 0) + 1; kv = JSON.stringify(dd);
    log.length = 0;
    await g.evaluate(function () { document.dispatchEvent(new Event('visibilitychange')); });
    await wait(300);
    var seen = await g.evaluate(function () { var s = window.WitnessEngine.loadState(window.WitnessGlassesSync.store); return s.tasks[0].note; });
    check('visible again: one GET, and the desk\'s change is on the glasses', log.join(',') === 'GET' && seen === 'desk-made');

    /* ---------------- a failed save is said ---------------- */
    postFail = true;
    var before = kv;
    await say(g, 'the shelf is broken');
    var fail = await g.evaluate(function () { var n = document.getElementById('gsSave'); return n && !n.hidden ? n.textContent : ''; });
    check('save failed: said on the glasses in plain words', /refused the save/.test(fail) && /kept on these glasses/.test(fail));
    check('save failed: the record is unchanged', kv === before);
    postFail = false;
    await say(g, 'the box is crushed');
    var cleared = await g.evaluate(function () { var n = document.getElementById('gsSave'); return !n || n.hidden; });
    check('the next save lands and the line clears', cleared && kv !== before);
    check('the earlier change rode along on the next save', /the shelf is broken/.test(kv));
    await desk2.context().close();
    await g.context().close();

    /* ---------------- record down at boot ---------------- */
    down = true; log.length = 0;
    var dead = await open('/glasses.html', { width: 390, height: 844 });
    await dead.waitForFunction(function () { var n = document.getElementById('gsStart'); return n && /could not be reached/.test(n.textContent) && n.getAttribute('role') === 'alert'; });
    var deadState = await dead.evaluate(function () {
      return { glasses: !!window.WitnessGlasses, btn: document.getElementById('openBtn').hidden, pick: document.getElementById('pickList').children.length,
        text: document.getElementById('gsStart').textContent };
    });
    check('down: plain words on the start screen', /^The shared warehouse record could not be reached, so the glasses view did not open\./.test(deadState.text));
    check('down: glasses.js never booted (no phantom world)', !deadState.glasses && deadState.pick === 0);
    check('down: the open button is gone', deadState.btn);
    check('down: nothing was seeded', log.indexOf('POST') === -1);
    await dead.context().close();
    down = false;

    /* ---------------- first-ever open from the glasses ---------------- */
    kv = null; log.length = 0;
    var first = await open('/glasses.html', { width: 390, height: 844 });
    await glassesReady(first);
    check('404: the glasses seed once through the shared path', log.join(',') === 'GET,POST' && !!kv);
    await first.context().close();

    /* ---------------- kitchen: untouched ---------------- */
    log.length = 0;
    var k = await open('/glasses.html?world=kitchen', { width: 390, height: 844 });
    await k.waitForSelector('#pickList [data-unit]');
    await k.waitForSelector('.gh-info');
    var kb = await k.evaluate(function () {
      return { state: typeof window.WitnessState, sync: typeof window.WitnessGlassesSync, real: Object.getPrototypeOf(window.WitnessEngine) === Object.prototype,
        scripts: [].map.call(document.scripts, function (s) { return s.getAttribute('src'); }).filter(Boolean).join(' '),
        kitchen: window.WitnessEngine.loadState() && window.WitnessEngine.loadState().world };
    });
    check('kitchen: no js/state.js, no sync, no engine wrap', kb.state === 'undefined' && kb.sync === 'undefined' && kb.real && kb.scripts.indexOf('js/state.js') === -1);
    check('kitchen: glasses.js, recorder.js, glasses-help.js boot in place, in order', /js\/glasses-state\.js js\/glasses\.js js\/recorder\.js js\/glasses-help\.js$/.test(kb.scripts));
    check('kitchen: its own fresh kitchen in the browser store', kb.kitchen === 'kitchen');
    await k.click('#openBtn');
    await k.waitForSelector('#view:not([hidden])');
    await say(k, "what's next");
    check('kitchen: zero /state calls through boot and talk', log.length === 0);
    await k.context().close();

    check('no page errors', errors.length === 0);
    if (errors.length) console.log(errors.join('\n'));
  } catch (e) {
    console.log('FAIL  run: ' + (e && e.stack));
    failures++;
  } finally {
    await browser.close();
    server.close();
  }
  console.log('---');
  console.log(passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
});
