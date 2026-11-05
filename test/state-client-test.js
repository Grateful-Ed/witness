/* state-client-test.js — node, no dependencies.
   Desk-phone Step 2: the client side of the shared state (js/state.js)
   against a stubbed fetch boundary — the same stub pattern as
   test/wms-store-test.js.
     - startup (an existing document) performs no POST
     - a 404 seeds and POSTs exactly once
     - a mutation performs GET then POST, in that order
     - a refused mutation (ok === false) saves nothing
     - a network failure is an honest error, never a local world
     - reset POSTs the seed world
     - the WMS layer on the document rides along untouched
     - a stale KV read never wins over this page's own newer save
     - the engine's pure functions drive the change, unchanged
   Run: node test/state-client-test.js   (exit 0 = all pass) */
'use strict';

var S = require('../js/state.js');
var E = require('../js/engine.js');

var failures = 0, passes = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (cond) passes++; else failures++; }

function kvFetch(opts) {
  opts = opts || {};
  var doc = opts.doc || null;
  var log = [];
  var f = function (url, init) {
    var m = (init && init.method) || 'GET';
    log.push(m);
    if (opts.down) return Promise.reject(new TypeError('Failed to fetch'));
    if (m === 'GET') {
      var body = opts.stale ? opts.stale : doc;
      if (opts.getStatus) return Promise.resolve({ ok: false, status: opts.getStatus, json: function () { return Promise.resolve({}); } });
      if (!body) return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({ ok: false, error: 'no state yet' }); } });
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(JSON.parse(body)); } });
    }
    if (opts.postStatus) return Promise.resolve({ ok: false, status: opts.postStatus });
    doc = init.body;
    f.posted.push(init.body);
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true }); } });
  };
  f.log = log; f.posted = []; f.doc = function () { return doc; };
  return f;
}

function seed() { var s = E.seedWorld(); E.generateTasks(s); return s; }
function make(f) {
  return S.create({
    fetch: f,
    seed: seed,
    prepare: function (s) { E.upgradeState(s); E.generateTasks(s); return s; }
  });
}
function firstWorker(s) { var w = null; s.labor.forEach(function (u) { if (!w && u.role === 'worker') w = u; }); return w; }

(async function () {
  /* ---- startup: read-only ---- */
  var existing = seed();
  existing.wms = { marker: 'wms-layer', flags: [1, 2, 3] };
  var f = kvFetch({ doc: JSON.stringify(existing) });
  var store = make(f);
  var res = await store.start();
  check('startup with a stored document: GETs once', f.log.join(',') === 'GET');
  check('startup performs no POST', f.posted.length === 0);
  check('startup returns the stored world, not seeded', res.seeded === false && res.state.labor.length === existing.labor.length);

  /* ---- 404 seeds once ---- */
  f = kvFetch();
  store = make(f);
  res = await store.start();
  check('404: seeds and POSTs exactly once', f.posted.length === 1 && f.log.join(',') === 'GET,POST');
  check('404: says it seeded', res.seeded === true);
  var posted = JSON.parse(f.posted[0]);
  check('404: the POSTed seed is the world (bins, labor, tasks)', Array.isArray(posted.bins) && Array.isArray(posted.labor) && posted.tasks.length > 0);
  await store.start();
  check('a second open after the seed POSTs nothing more', f.posted.length === 1);

  /* ---- mutation: GET then POST ---- */
  f = kvFetch({ doc: JSON.stringify(existing) });
  store = make(f);
  await store.start();
  f.log.length = 0;
  var w = firstWorker(existing);
  var out = await store.mutate(function (s) {
    var u = E.unitById(s, w.id);
    E.nextTaskFor(s, u);
    E.generateTasks(s);
    return { ok: true, unit: u.id };
  });
  check('a mutation performs GET then POST, in that order', f.log.join(',') === 'GET,POST');
  check('a mutation saves', out.saved === true);
  var after = JSON.parse(f.doc());
  var afterUnit = E.unitById(after, w.id);
  check('the saved document carries the change (worker has a task)', !!afterUnit.currentTaskId);
  check('the WMS layer rides along untouched', after.wms && after.wms.marker === 'wms-layer' && after.wms.flags.length === 3);
  check('each save stamps wmsRev', after.wmsRev === 1);

  /* ---- fetch fresh: a change made elsewhere is seen ---- */
  var elsewhere = JSON.parse(f.doc());
  elsewhere.records.push({ text: 'made on the phone', ts: new Date().toISOString() });
  elsewhere.wmsRev = 2;
  var g = kvFetch({ doc: JSON.stringify(elsewhere) });
  var desk = make(g);
  await desk.start();
  var phoneDoc = JSON.parse(g.doc());
  phoneDoc.records.push({ text: 'second phone change', ts: new Date().toISOString() });
  phoneDoc.wmsRev = 3;
  /* the phone writes behind the desk's back */
  await g('x', { method: 'POST', body: JSON.stringify(phoneDoc) });
  out = await desk.mutate(function (s) { return { ok: true, seen: s.records.length }; });
  check('a mutation applies to the FRESH state, not the page copy', out.result.seen === phoneDoc.records.length);
  check('the change made elsewhere survives the save', JSON.parse(g.doc()).records.some(function (r) { return r.text === 'second phone change'; }));

  /* ---- refused mutation ---- */
  f = kvFetch({ doc: JSON.stringify(existing) });
  store = make(f);
  f.log.length = 0;
  out = await store.mutate(function () { return { ok: false, reason: 'nope' }; });
  check('a refused mutation (ok === false) GETs and saves nothing', f.log.join(',') === 'GET' && out.saved === false);

  /* ---- engine result passes through: completeTask on fresh state ---- */
  f = kvFetch({ doc: JSON.stringify(existing) });
  store = make(f);
  await store.mutate(function (s) { var u = E.unitById(s, w.id); E.nextTaskFor(s, u); });
  var tid = E.unitById(JSON.parse(f.doc()), w.id).currentTaskId;
  out = await store.mutate(function (s) { return E.completeTask(s, tid); });
  var done = E.taskById(JSON.parse(f.doc()), tid);
  check('completeTask through the seam: the task is done on the record', done && done.status === 'done' && out.saved === true);

  /* ---- network failure: honest, never a local world ---- */
  f = kvFetch({ down: true });
  store = make(f);
  var err = null;
  try { await store.start(); } catch (e) { err = e; }
  check('network down at open: rejects with plain words', err && err.code === 'network' && /could not be reached/.test(err.userMessage));
  check('network down at open: nothing POSTed, no seed', f.posted.length === 0);
  err = null;
  try { await store.mutate(function () { return { ok: true }; }); } catch (e) { err = e; }
  check('network down at a change: rejects, nothing done', err && err.code === 'network');

  f = kvFetch({ getStatus: 500 });
  store = make(f);
  err = null;
  try { await store.start(); } catch (e) { err = e; }
  check('HTTP 500 at open: rejects, does not seed over it', err && err.code === 'http' && f.posted.length === 0);

  f = kvFetch({ doc: JSON.stringify(existing), postStatus: 413 });
  store = make(f);
  err = null;
  try { await store.mutate(function () { return { ok: true }; }); } catch (e) { err = e; }
  check('a 413 on save is said plainly', err && err.code === 'too-large' && /Nothing was saved/.test(err.userMessage));

  f = kvFetch({ doc: JSON.stringify({ hello: 'world' }) });
  store = make(f);
  err = null;
  try { await store.start(); } catch (e) { err = e; }
  check('a document that is not a warehouse is refused, not acted on', err && err.code === 'bad-shape' && f.posted.length === 0);

  /* ---- 404 mid-session: no silent reseed ---- */
  f = kvFetch();
  store = make(f);
  err = null;
  try { await store.mutate(function () { return { ok: true }; }); } catch (e) { err = e; }
  check('a mutation that finds no document does not reseed silently', err && err.code === 'empty' && f.posted.length === 0);

  /* ---- reset ---- */
  var worked = JSON.parse(JSON.stringify(existing));
  worked.records.push({ text: 'old work' });
  f = kvFetch({ doc: JSON.stringify(worked) });
  store = make(f);
  f.log.length = 0;
  var fresh = await store.resetState();
  check('reset POSTs (no GET needed)', f.log.join(',') === 'POST');
  var rs = JSON.parse(f.doc());
  check('reset POSTs the seed world', rs.records.length === 0 && rs.bins.length === seed().bins.length && fresh.tasks.length > 0);

  /* ---- stale KV read guard ---- */
  var base = seed();
  f = kvFetch({ doc: JSON.stringify(base) });
  store = make(f);
  await store.mutate(function (s) { s.records.push({ text: 'mine' }); return { ok: true }; });
  /* now the KV serves an older copy (rev 0) */
  var g2 = kvFetch({ doc: f.doc(), stale: JSON.stringify(base) });
  /* reuse the same store, re-pointed: build one that saved through f, then reads through stale */
  var mixed = (function () {
    var useStale = false;
    var ff = function (u, init) { return (useStale ? g2 : f)(u, init); };
    var st = make(ff);
    return { st: st, stale: function () { useStale = true; } };
  })();
  await mixed.st.mutate(function (s) { s.records.push({ text: 'mine-2' }); return { ok: true }; });
  mixed.stale();
  var seen = await mixed.st.loadState();
  check('a stale read never wins over this page\'s own newer save', seen.records.some(function (r) { return r.text === 'mine-2'; }));

  /* ---- loading never saves ---- */
  f = kvFetch({ doc: JSON.stringify(existing) });
  store = make(f);
  await store.loadState(); await store.loadState(); await store.start();
  check('loadState and start never POST on an existing document', f.posted.length === 0);

  /* ---- fit ---- */
  var big = seed();
  for (var i = 0; i < 4000; i++) big.records.push({ text: 'record ' + i + ' ' + 'x'.repeat(120) });
  var text = S.fit(big);
  check('fit keeps the document under the Worker cap', text.length <= S.MAX_CHARS);
  check('fit keeps the newest record', JSON.parse(text).records.slice(-1)[0].text.indexOf('record 3999') === 0);

  console.log('\n' + passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
