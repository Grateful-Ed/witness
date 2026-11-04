/* wms-store-test.js — node, no dependencies.
   The WMS page's desk-record seam (js/wms-store.js) against a
   stubbed fetch boundary: page open performs no POST; a 404 seeds
   and POSTs exactly once; a mutation performs GET then POST in that
   order; a refused mutation saves nothing; a network failure is an
   honest error (no silent local world); a stale KV read never wins
   over the page's own newer save; the document stays under the
   Worker's cap; practice mode never touches the network.
   Run: node test/wms-store-test.js   (exit 0 = all pass) */
'use strict';

var S = require('../js/wms-store.js');
var W = require('../js/wms.js');

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
      if (!body) return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({ ok: false }); } });
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
function make(f, extra) {
  var o = { fetch: f, seed: W.seed, prepare: function (s) { W.install(s); W.refresh(s); return s; } };
  if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
  return S.create(o);
}

(async function () {
  var f = kvFetch();
  var st = make(f);
  var r = await st.load();
  check('404 on first open → seeds and POSTs exactly once', r.seeded && f.log.join(',') === 'GET,POST' && f.posted.length === 1);
  var f2 = kvFetch({ doc: f.doc() });
  r = await make(f2).load();
  check('page open with a desk record is read-only (GET only, no POST)', !r.seeded && f2.log.join(',') === 'GET' && !!r.state.wms);

  f2.log.length = 0;
  var st2 = make(f2);
  r = await st2.mutate(function (s) { return W.checkIn(s, 'APT-102', 'u-sam'); });
  check('a mutation is GET then POST, in that order', f2.log.join(',') === 'GET,POST' && r.saved);
  check('the saved document carries the change', JSON.parse(f2.doc()).inbound[1].status === 'staged at door');

  f2.log.length = 0;
  r = await st2.mutate(function (s) { return W.checkIn(s, 'APT-102', 'u-sam'); });
  check('a refused mutation (ok:false) saves nothing', !r.saved && f2.log.join(',') === 'GET' && r.result.ok === false);

  /* Stale read guard: KV hands back an older document. */
  var newer = f2.doc();
  var older = JSON.stringify(Object.assign(JSON.parse(newer), { wmsRev: 0 }));
  var f3 = kvFetch({ doc: newer });
  var st3 = make(f3);
  await st3.mutate(function (s) { return W.createOrder(s, { customer: 'Rev test', lines: [{ desc: 'Tea — cases', qty: 1 }] }, 'u-sam'); });
  var savedRev = JSON.parse(f3.doc()).wmsRev;
  f3.log.length = 0;
  var stale = kvFetch({ doc: f3.doc(), stale: older });
  /* same store instance, now reading a stale copy */
  var st3fetch = stale;
  var st4 = make(function (u, i) { return st3fetch(u, i); });
  /* prime st4 with its own save first */
  await st4.mutate(function (s) { return W.createOrder(s, { customer: 'Mine', lines: [{ desc: 'Tea — cases', qty: 2 }] }, 'u-sam'); });
  var mine = JSON.parse(stale.doc());
  r = await st4.load();
  check('a stale KV read never replaces the page\'s own newer save', r.state.wms.orders.some(function (o) { return o.customer === 'Mine'; }) && (r.state.wmsRev || 0) === mine.wmsRev);
  check('every save stamps a rising wmsRev', savedRev >= 1 && mine.wmsRev >= 1);

  /* Honest failures. */
  try { await make(kvFetch({ down: true })).load(); check('network down → error', false); }
  catch (e) { check('network down → an honest error, no silent local world', e.code === 'network' && /could not be reached/.test(e.userMessage)); }
  try { await make(kvFetch({ doc: f.doc(), postStatus: 413 })).mutate(function (s) { return W.checkIn(s, 'APT-102', 'u-sam'); }); check('413', false); }
  catch (e) { check('a 413 on save says nothing was saved', e.code === 'too-large'); }
  var f403 = function () { return Promise.resolve({ ok: false, status: 403 }); };
  try { await make(f403).load(); check('403', false); }
  catch (e) { check('a refused origin (403) is named, with the way out', e.code === 'origin' && /practice mode/.test(e.userMessage)); }

  /* The kitchen world is not acted on. */
  var kitchen = JSON.stringify({ world: 'kitchen', bins: [], labor: [], tasks: [], records: [] });
  try {
    await make(kvFetch({ doc: kitchen }), { check: function (s) { return s.world && s.world !== 'warehouse' ? 'other world' : null; } }).load();
    check('kitchen world refused', false);
  } catch (e) { check('a desk record holding another world is refused, not overwritten', e.code === 'other-world'); }

  /* Reset POSTs the seed. */
  var f5 = kvFetch({ doc: f2.doc() });
  r = await make(f5).reset();
  check('reset POSTs a fresh seed', f5.log.join(',') === 'POST' && JSON.parse(f5.doc()).inbound[1].status === 'expected today');

  /* Fit under the cap. */
  var big = W.seed();
  for (var i = 0; i < 6000; i++) big.records.push({ ts: '2026-11-02T08:00:00Z', text: 'filler record number ' + i + ' with some words to take up room in the document' });
  var text = S.fit(big);
  check('fit: an oversized document is trimmed under the cap, newest records kept', text.length <= S.MAX_CHARS && /filler record number 5999/.test(text));
  check('fit: the in-memory state is not trimmed', big.records.length >= 6000);

  /* Practice mode never touches the network. */
  var calls = 0;
  var pr = S.create({ fetch: function () { calls++; return Promise.reject(new Error('no')); }, seed: W.seed, practice: true,
    prepare: function (s) { W.install(s); W.refresh(s); return s; } });
  r = await pr.load();
  await pr.mutate(function (s) { return W.checkIn(s, 'APT-102', 'u-sam'); });
  r = await pr.load();
  check('practice mode: works in memory, zero network calls', calls === 0 && r.state.inbound[1].status === 'staged at door' && pr.practice());

  /* Dressing: a practice copy is stocked fuller; the seed that
     reaches the desk record is always the raw seed. The hook hangs
     off the store's own practice flag. */
  var df = kvFetch();
  var dLive = make(df, { dressPractice: function (s) { W.dressPractice(s); } });
  r = await dLive.load();
  check('dressing: the live path is never dressed (the desk record is seeded with the raw seed)',
    JSON.parse(df.doc()).bins.filter(function (b) { return b.id === 'A-03'; })[0].contents.length === 0);
  var dPr = S.create({ fetch: function () { return Promise.reject(new Error('no')); }, seed: W.seed, practice: true,
    dressPractice: function (s) { W.dressPractice(s); },
    prepare: function (s) { W.install(s); W.refresh(s); return s; } });
  r = await dPr.load();
  check('dressing: a practice copy is dressed (bare seed bins stocked, four left empty)',
    r.state.bins.filter(function (b) { return b.id === 'A-03'; })[0].contents.length === 1 &&
    r.state.bins.filter(function (b) { return !b.contents.length; }).length === 4);

  console.log('\n' + passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})();
