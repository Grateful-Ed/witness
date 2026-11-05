/* glasses-state-test.js — node, no dependencies.
   The warehouse glasses on the shared record (js/glasses-state.js),
   against a stubbed /state — the same stub pattern as
   test/state-client-test.js. Uses the REAL js/state.js and engine.
     - hydration presents the shared document to the engine trio
     - boot over an existing document performs no POST
     - a 404 seeds once through the shared path
     - a save POSTs the WHOLE document with the wmsRev stamp; state.wms
       rides along; a fresh GET follows the save
     - writes made while a save is in flight coalesce, in order
     - a failed save is said in plain words; the change stays on the
       memory copy; the next save posts the whole document
     - a refresh never overwrites a change not yet on the record
     - another device's change reaches the glasses on refresh
     - boot failure: plain words, no seed POST
     - kitchen: the page branch returns before any /state work
     - the seam glasses.js offers is the one this adapter relies on
   Run: node test/glasses-state-test.js   (exit 0 = all pass) */
'use strict';

var fs = require('fs');
var path = require('path');
var S = require('../js/state.js');
var E = require('../js/engine.js');
var G = require('../js/glasses-state.js');

var failures = 0, passes = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (cond) passes++; else failures++; }

function kvFetch(opts) {
  opts = opts || {};
  var f = function (url, init) {
    var m = (init && init.method) || 'GET';
    f.log.push(m);
    if (f.down) return Promise.reject(new TypeError('Failed to fetch'));
    if (m === 'GET') {
      if (!f.doc) return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({}); } });
      var body = f.doc;
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(JSON.parse(body)); } });
    }
    if (f.postStatus) return Promise.resolve({ ok: false, status: f.postStatus });
    f.doc = init.body;
    f.posted.push(init.body);
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true }); } });
  };
  f.log = []; f.posted = []; f.doc = opts.doc || null; f.down = !!opts.down; f.postStatus = opts.postStatus || 0;
  return f;
}
function seed() { var s = E.seedWorld(); E.generateTasks(s); return s; }
function client(fetch) {
  return S.create({ fetch: fetch, url: 'https://x.test/state', seed: seed,
    prepare: function (s) { E.upgradeState(s); E.generateTasks(s); return s; } });
}
function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

(async function () {
  /* ---- hydration ---- */
  var world = seed();
  world.wms = { marker: 'desk-layer' };
  world.wmsRev = 7;
  var f = kvFetch({ doc: JSON.stringify(world) });
  var errs = [], oks = 0;
  var sync = G.createSync({ state: client(f), key: E.STORAGE_KEY, onSaveError: function (e) { errs.push(e); }, onSaveOk: function () { oks++; } });
  await sync.hydrate();
  var view = G.engineView(E, sync.store);
  var got = view.loadState();
  check('hydrate: the engine trio (no store argument) reads the shared document', got && got.wms && got.wms.marker === 'desk-layer' && got.labor.length === world.labor.length);
  check('hydrate: boot over an existing document is GET only — no POST', f.log.join(',') === 'GET');
  check('engine view: every other engine function is the engine\'s own', view.generateTasks === E.generateTasks && view.unitById === E.unitById && view.STORAGE_KEY === E.STORAGE_KEY);

  /* ---- a save, the way glasses.js's Store.save makes it ---- */
  var s = view.loadState();
  var t = s.tasks[0];
  t.note = 'from the glasses';
  E.generateTasks(s); view.saveState(s);
  await sync.flush(); await tick();
  check('save: one POST of the whole document', f.posted.length === 1);
  var sent = JSON.parse(f.posted[0]);
  check('save: the change is on the record', sent.tasks[0].note === 'from the glasses');
  check('save: wmsRev stamped past the document\'s own (7 → 8)', sent.wmsRev === 8);
  check('save: state.wms rides along untouched', sent.wms && sent.wms.marker === 'desk-layer');
  check('save: a fresh GET follows the landed save', f.log.join(',') === 'GET,POST,GET');
  check('save: success reported, no error', oks === 1 && errs.length === 0 && !sync.pending());

  /* ---- coalescing ---- */
  f.log.length = 0; f.posted.length = 0;
  var a = view.loadState(); a.tasks[0].note = 'one'; view.saveState(a);
  var b = view.loadState(); b.tasks[0].note = 'two'; view.saveState(b);
  var c = view.loadState(); c.tasks[0].note = 'three'; view.saveState(c);
  await sync.flush(); await tick();
  check('coalesce: the last write wins on the record', JSON.parse(f.doc).tasks[0].note === 'three');
  check('coalesce: posts never exceed writes, and the last post is the latest', f.posted.length <= 3 && JSON.parse(f.posted[f.posted.length - 1]).tasks[0].note === 'three');
  var revs = f.posted.map(function (p) { return JSON.parse(p).wmsRev; });
  check('coalesce: posts go in order (wmsRev rises)', revs.every(function (r, i) { return i === 0 || r > revs[i - 1]; }));

  /* ---- a failed save ---- */
  f.log.length = 0; f.posted.length = 0; errs.length = 0;
  f.postStatus = 500;
  var d = view.loadState(); d.tasks[0].note = 'offline change'; view.saveState(d);
  await sync.flush(); await tick();
  check('fail: the error carries plain words', errs.length === 1 && /refused the save/.test(errs[0].userMessage));
  var words = G.saveFailWords(errs[0]);
  check('fail: the glasses line says the work is kept and the next save retries', /kept on these glasses/.test(words) && /try the save again/.test(words));
  check('fail: the change stays on the memory copy', view.loadState().tasks[0].note === 'offline change');
  check('fail: still pending, and no GET after a failed save', sync.pending() && f.log.indexOf('GET') === -1);

  /* a refresh now must not overwrite the unsaved change */
  var r1 = await sync.refresh();
  check('refresh: skipped while a change has not reached the record', r1 === false && view.loadState().tasks[0].note === 'offline change');

  /* the next save posts the whole document, with the earlier change */
  f.postStatus = 0; f.posted.length = 0;
  var e2 = view.loadState(); e2.tasks[1].note = 'next change'; view.saveState(e2);
  await sync.flush(); await tick();
  var last = JSON.parse(f.posted[f.posted.length - 1]);
  check('retry: the next save carries the earlier unsaved change too', last.tasks[0].note === 'offline change' && last.tasks[1].note === 'next change');
  check('retry: the error line clears on success', oks >= 2 && !sync.pending());

  /* ---- another device's change reaches the glasses ---- */
  var other = JSON.parse(f.doc);
  other.tasks[0].note = 'closed on the desk';
  other.wmsRev = (other.wmsRev || 0) + 5;
  f.doc = JSON.stringify(other);
  var r2 = await sync.refresh();
  check('refresh: another device\'s change is in the memory copy', r2 === true && view.loadState().tasks[0].note === 'closed on the desk');

  /* a stale KV read never wins over the glasses' own newer save */
  var stale = JSON.parse(f.doc); stale.wmsRev = 1; stale.tasks[0].note = 'stale';
  f.doc = JSON.stringify(stale);
  await sync.refresh();
  check('refresh: a stale read does not replace the glasses\' newer save', view.loadState().tasks[0].note !== 'stale');

  /* ---- 404 → seed once ---- */
  var f404 = kvFetch();
  var s404 = G.createSync({ state: client(f404), key: E.STORAGE_KEY });
  var r404 = await s404.hydrate();
  check('404: seeds and POSTs exactly once', r404.seeded === true && f404.posted.length === 1 && f404.log.join(',') === 'GET,POST');
  check('404: the seed is in the memory store', !!G.engineView(E, s404.store).loadState());

  /* ---- boot failure ---- */
  var fDown = kvFetch({ down: true });
  var sDown = G.createSync({ state: client(fDown), key: E.STORAGE_KEY });
  var err = null;
  try { await sDown.hydrate(); } catch (x) { err = x; }
  check('down: boot rejects with plain words', err && /could not be reached/.test(err.userMessage));
  check('down: no seed POST', fDown.posted.length === 0 && fDown.log.indexOf('POST') === -1);
  check('down: nothing in the memory store (no phantom world)', G.engineView(E, sDown.store).loadState() === null);
  var sw = G.stopWords(err);
  check('down: the start-screen words', /^The shared warehouse record could not be reached/.test(sw.head) && /Reload/.test(sw.detail));

  var f501 = kvFetch(); f501.doc = null;
  var g501 = function (u, i) { return Promise.resolve({ ok: false, status: 501, json: function () { return Promise.resolve({}); } }); };
  var s501 = G.createSync({ state: client(g501), key: E.STORAGE_KEY });
  var e501 = null; try { await s501.hydrate(); } catch (x) { e501 = x; }
  check('501: a store not connected stops too, no seed', e501 && /not connected/.test(e501.userMessage));

  /* ---- source + wiring ---- */
  var src = fs.readFileSync(path.join(__dirname, '..', 'js', 'glasses-state.js'), 'utf8');
  var page = src.slice(src.indexOf('PAGE'));
  var kIdx = page.indexOf("W.current === 'kitchen'");
  var kitchenBlock = page.slice(kIdx, page.indexOf('return;', kIdx));
  check('kitchen: the branch comes before any /state work', kIdx !== -1 && kIdx < page.indexOf('injectOne(STATE_SRC)'));
  check('kitchen: the branch has no fetch, no WitnessState, no engine wrap', !/fetch|WitnessState|engineView|WitnessEngine/.test(kitchenBlock));
  check('adapter: never touches localStorage', !/localStorage/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')));

  var html = fs.readFileSync(path.join(__dirname, '..', 'glasses.html'), 'utf8');
  check('wiring: glasses.html has no static glasses.js tag', !/<script src="js\/glasses\.js">/.test(html));
  var m = /<script src="js\/glasses-state\.js" data-boot="([^"]+)"><\/script>/.exec(html);
  check('wiring: the adapter tag names the boot order glasses → recorder → help', m && m[1] === 'js/glasses.js js/recorder.js js/glasses-help.js');
  check('wiring: the adapter tag is last, after kitchen.js', m && html.indexOf(m[0]) > html.indexOf('js/kitchen.js') && html.indexOf('<script', html.indexOf(m[0]) + 1) === -1);
  check('wiring: the default boot list matches the tag', G.DEFAULT_BOOT.join(' ') === 'js/glasses.js js/recorder.js js/glasses-help.js');

  var gl = fs.readFileSync(path.join(__dirname, '..', 'js', 'glasses.js'), 'utf8');
  check('seam: glasses.js reads root.WitnessEngine once, at its own load', (gl.match(/root\.WitnessEngine/g) || []).length === 1);
  check('seam: its Store calls the engine trio with no store argument', /E\.loadState\(\)/.test(gl) && /E\.saveState\(s\)/.test(gl) && !/localStorage\./.test(gl));

  console.log('---');
  console.log(passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})().catch(function (e) { console.log('FAIL  run: ' + (e && e.stack)); process.exit(1); });
