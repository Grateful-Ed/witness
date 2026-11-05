/* glasses-help-test.js — the glasses directions (William, 2026-11-04):
   people were confused how to work the demo. The help must exist for
   both worlds, name only real flows, stay isolated from the demo's
   machinery (the recorder.js rule), and load exactly once. */
'use strict';
var fs = require('fs');
var failures = 0, passes = 0;
function check(name, cond) { if (cond) { passes++; console.log('PASS  ' + name); } else { failures++; console.log('FAIL  ' + name); } }
var help = fs.readFileSync(__dirname + '/../js/glasses-help.js', 'utf8');
var html = fs.readFileSync(__dirname + '/../glasses.html', 'utf8');
check('help: glasses.html loads glasses-help.js exactly once', html.split('js/glasses-help.js').length - 1 === 1);
check('help: isolated — no fetch, no storage, no state writes', !/fetch\(|localStorage|Store\.|mutate|WMS|worker/.test(help));
check('help: the gestures are named', /Hold anywhere/.test(help) && /Double-tap/.test(help));
check('help: the warehouse work is explained (flags, person decides)', /flags where they disagree/.test(help) && /person decides/.test(help));
var STEPS = ['Take pic of receipt (double tap)', 'Wait for tasks to be created', 'Ask for tasks', 'Say \\u201cdone\\u201d when a task is complete'];
check('help: the kitchen four steps are in the file, verbatim and in order', (function () {
  var at = -1;
  return STEPS.every(function (t) { var i = help.indexOf("'" + t + "'"); var ok = i > at; at = i; return ok; });
})());
check('help: the kitchen window uses the steps list, not the old list', /stepsList\(\)/.test(help) && !/Start Groceries putaway/.test(help));
check('help: the Record button is explained honestly (device-only, no overlay)', /nothing is uploaded/.test(help) && /screen recorder/.test(help));
check('help: world-aware (kitchen chosen from the same ?world=)', /world=kitchen/.test(help));
check('help: both entry points exist (start-screen button, in-view info button)', /How it works/.test(help) && /gh-info/.test(help));
check('help: the modal can be closed (X and backdrop)', /gh-x/.test(help) && /e\.target === modal/.test(help));

/* --- no controller in the words (William, 2026-11-05) ------------- */
function userText(src) { /* strip comments; what remains can reach the page */
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
var CONTROLLER = /PlayStation|\bR2\b|controller/i;
check('no controller: glasses.html text never names it', !CONTROLLER.test(userText(html)));
check('no controller: the help content never names it', !CONTROLLER.test(userText(help)));
check('no controller: the padLine element is gone', !/padLine/.test(html));
var glassesJs = fs.readFileSync(__dirname + '/../js/glasses.js', 'utf8');
check('no controller: glasses.js writes nothing to padLine (padState removed)', !/padState|padLine/.test(glassesJs));
check('no controller: the gamepad machinery is still there, dormant', /gamepadconnected/.test(glassesJs) && /function readPad/.test(glassesJs) && /requestAnimationFrame\(loop\)/.test(glassesJs));

/* --- the steps card, in a real browser ---------------------------- */
var pw = null;
try { pw = require('playwright'); } catch (e) { pw = null; }
if (!pw) { console.log('SKIP  browser checks (playwright not installed)'); return finish(); }

var http = require('http'), path = require('path');
var ROOT = path.join(__dirname, '..');
var TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
var server = http.createServer(function (req, res) {
  var p = decodeURIComponent(req.url.split('?')[0]);
  var f = path.join(ROOT, p);
  if (f.indexOf(ROOT) !== 0 || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

/* The view is opened the real way — the Open the view button — and the
   help file must notice from outside. Camera and mic are Chromium's
   fake devices; nothing leaves the machine. */
async function load(browser, world) {
  var page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, function (r) { r.abort(); });
  await page.goto('http://127.0.0.1:' + server.address().port + '/glasses.html' + (world ? '?world=' + world : ''));
  await page.waitForSelector('.gh-info');
  return page;
}
async function openView(page) { await page.click('#openBtn'); await page.waitForSelector('#view:not([hidden])'); await page.waitForTimeout(50); }
function cardState(page) {
  return page.evaluate(function () {
    var c = document.getElementById('ghSteps');
    if (!c) return { exists: false };
    var r = c.getBoundingClientRect();
    return { exists: true, shown: !c.hidden && r.width > 0, steps: [].map.call(c.querySelectorAll('ol li'), function (li) { return li.textContent; }),
      rect: { l: r.left, t: r.top, r: r.right, b: r.bottom } };
  });
}

(async function () {
  await new Promise(function (ok) { server.listen(0, '127.0.0.1', ok); });
  var browser = await pw.chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    var k = await load(browser, 'kitchen');
    var before = await cardState(k);
    check('card: not shown on the start screen', before.exists && !before.shown);
    await openView(k);
    var up = await cardState(k);
    check('card: the kitchen view shows the steps card', up.shown);
    check('card: the four steps, verbatim, in order', JSON.stringify(up.steps) === JSON.stringify(['Take pic of receipt (double tap)', 'Wait for tasks to be created', 'Ask for tasks', 'Say \u201cdone\u201d when a task is complete']));
    check('card: a small box, not the view', (up.rect.r - up.rect.l) <= 300 && (up.rect.b - up.rect.t) < 844 / 3);

    /* The PR #29 discipline: with the card up, the view is still what a
       finger hits everywhere outside the card's own box. */
    var hits = await k.evaluate(function (rect) {
      var pts = [[195, 422], [195, 700], [40, 760], [350, 760], [350, 300], [195, rect.b + 20]];
      return pts.map(function (p) { var el = document.elementFromPoint(p[0], p[1]); return !!(el && el.closest('#view')); });
    }, up.rect);
    check('card: Talk surface (#view) still reached outside the card (6 points)', hits.every(Boolean));
    var inside = await k.evaluate(function (r) { var el = document.elementFromPoint((r.l + r.r) / 2, (r.t + r.b) / 2); return !!(el && el.closest('#ghSteps')) && !el.closest('#view'); }, up.rect);
    check('card: a tap on the card lands on the card, never the view', inside);

    /* Hold-to-talk still starts on the view with the card up: a long
       press on the view reaches its pointer listener. */
    var held = await k.evaluate(function () {
      return new Promise(function (ok) {
        var v = document.getElementById('view'), got = false;
        v.addEventListener('pointerdown', function () { got = true; }, { once: true });
        var el = document.elementFromPoint(195, 600);
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
        ok(got);
      });
    });
    check('card: a press on the view still reaches the hold / double-tap listener', held);

    await k.click('#ghSteps .gh-x');
    var gone = await cardState(k);
    check('card: its X dismisses it', !gone.shown);
    var free = await k.evaluate(function (r) { var el = document.elementFromPoint((r.l + r.r) / 2, (r.t + r.b) / 2); return !!(el && el.closest('#view')); }, up.rect);
    check('card: after X, the view owns that spot again', free);
    await k.click('.gh-info');
    var back = await cardState(k);
    var modalUp = await k.evaluate(function () { var m = document.querySelector('.gh-modal'); return !m.hidden && /Wait for tasks to be created/.test(m.textContent); });
    check('card: the info button brings the directions back (card + window with the steps)', back.shown && modalUp);
    await k.close();

    var w = await load(browser, null);
    await openView(w);
    var wc = await cardState(w);
    check('card: the warehouse view gets no steps card', !wc.exists);
    var wModal = await w.evaluate(function () { return document.querySelector('.gh-modal').textContent; });
    check('card: the warehouse window keeps its content', /Hold anywhere/.test(wModal) && /person decides/.test(wModal) && !/controller/i.test(wModal));
    var kText = await (async function () { var p = await load(browser, 'kitchen'); var t = await p.evaluate(function () { return document.body.innerText; }); await p.close(); return t; })();
    check('no controller: the kitchen page as rendered never names it', !CONTROLLER.test(kText));
    var wText = await w.evaluate(function () { return document.body.innerText + document.querySelector('.gh-modal').textContent; });
    check('no controller: the warehouse page as rendered never names it', !CONTROLLER.test(wText));
    await w.close();
  } finally {
    await browser.close();
    server.close();
  }
  finish();
})().catch(function (e) { console.log('FAIL  browser run: ' + e.message); failures++; server.close(); finish(); });

function finish() {
  console.log('---');
  console.log(passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
}
