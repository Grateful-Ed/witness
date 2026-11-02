/* state-test.js — node, no dependencies.
   The Worker change from the desk-phone brief, Step 1 (worker/worker.js):
   GET/POST /state round-trip against a stubbed KV, /samples skipping
   reserved "__" keys, /save keeping a `bol` object and kind "photo",
   and the /chat body cap (60,000 for text, 1,500,000 when a data:
   image rides along). The upstream Meta call is stubbed at fetch.
   Run: node test/state-test.js   (exit 0 = all pass) */
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var url = require('url');

var failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
  if (!cond) failures++;
}

var ORIGIN = 'http://localhost:8902';
var BASE = 'https://witness.example.workers.dev';

function stubKV() {
  var store = {};
  return {
    store: store,
    get: async function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    put: async function (k, v) { store[k] = String(v); },
    list: async function () { return { keys: Object.keys(store).map(function (n) { return { name: n }; }) }; }
  };
}

function req(method, p, body, extraHeaders) {
  var headers = Object.assign({ 'Origin': ORIGIN, 'Content-Type': 'application/json' }, extraHeaders || {});
  var init = { method: method, headers: headers };
  if (body != null) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request(BASE + p, init);
}

(async function main() {
  /* worker.js is an ES module (export default). Load a copy as .mjs. */
  var src = fs.readFileSync(path.join(__dirname, '..', 'worker', 'worker.js'), 'utf8');
  var tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'witness-worker-')), 'worker.mjs');
  fs.writeFileSync(tmp, src);
  var worker = (await import(url.pathToFileURL(tmp).href)).default;

  var kv = stubKV();
  var env = { SCANS: kv, SAMPLES_KEY: 'k', META_API_KEY: 'test-key' };

  /* --- /state ---------------------------------------------------- */
  var r = await worker.fetch(req('GET', '/state'), env);
  var j = await r.json();
  check('GET /state before any save: 404 "no state yet"', r.status === 404 && j.ok === false && j.error === 'no state yet');

  var doc = { version: 1, workers: [{ id: 'u-1', name: 'Ana' }], note: 'synthetic' };
  r = await worker.fetch(req('POST', '/state', doc), env);
  j = await r.json();
  check('POST /state with an object: 200 {ok:true}', r.status === 200 && j.ok === true);
  check('state is stored under the reserved key', typeof kv.store.__warehouse_state__ === 'string');

  r = await worker.fetch(req('GET', '/state'), env);
  var back = await r.text();
  check('GET /state returns the document verbatim', r.status === 200 && back === JSON.stringify(doc));
  check('GET /state carries CORS for the allowed origin', r.headers.get('Access-Control-Allow-Origin') === ORIGIN);

  r = await worker.fetch(req('POST', '/state', [1, 2, 3]), env);
  check('POST /state with an array: 400', r.status === 400);
  r = await worker.fetch(req('POST', '/state', '42'), env);
  check('POST /state with a scalar: 400', r.status === 400);
  r = await worker.fetch(req('POST', '/state', 'not json'), env);
  check('POST /state with broken JSON: 400', r.status === 400);
  r = await worker.fetch(req('POST', '/state', { pad: 'x'.repeat(500001) }), env);
  check('POST /state over 500,000 chars: 413', r.status === 413);
  check('a refused POST leaves the stored state alone', kv.store.__warehouse_state__ === JSON.stringify(doc));

  r = await worker.fetch(req('GET', '/state', null, { 'Origin': 'https://evil.example' }), env);
  check('GET /state from a foreign origin: 403', r.status === 403);
  r = await worker.fetch(req('DELETE', '/state'), env);
  check('DELETE /state: 405', r.status === 405);
  r = await worker.fetch(req('GET', '/state'), {});
  check('no KV bound: 501 storage-not-connected', r.status === 501);

  /* --- /save: bol and kind photo -------------------------------- */
  var bol = { carrier: 'Blue Ridge Freight Lines', piecesClaimed: 20, lineItems: [{ description: 'Cleaner', pieces: 6 }] };
  r = await worker.fetch(req('POST', '/save', { load: 'Test Load 001', transcript: 'BOL read', flags: [], bol: bol, savedAt: '2026-11-02T00:00:00.000Z' }), env);
  j = await r.json();
  var saved = JSON.parse(kv.store[j.key]);
  check('/save with a bol object round-trips it', r.status === 200 && JSON.stringify(saved.bol) === JSON.stringify(bol));
  check('/save with a bol keeps kind "scan" by default', saved.kind === 'scan');

  r = await worker.fetch(req('POST', '/save', { load: 'L', transcript: 't', bol: [1, 2], savedAt: '2026-11-02T00:00:01.000Z' }), env);
  j = await r.json();
  check('/save drops a bol that is an array', !('bol' in JSON.parse(kv.store[j.key])));

  r = await worker.fetch(req('POST', '/save', { load: 'L', transcript: 't', kind: 'photo', savedAt: '2026-11-02T00:00:02.000Z' }), env);
  j = await r.json();
  check('/save kind "photo" survives', JSON.parse(kv.store[j.key]).kind === 'photo');
  r = await worker.fetch(req('POST', '/save', { load: 'L', transcript: 't', kind: 'osd', savedAt: '2026-11-02T00:00:03.000Z' }), env);
  j = await r.json();
  check('/save kind "osd" still survives', JSON.parse(kv.store[j.key]).kind === 'osd');
  r = await worker.fetch(req('POST', '/save', { load: 'L', transcript: 't', kind: 'anything', savedAt: '2026-11-02T00:00:04.000Z' }), env);
  j = await r.json();
  check('/save unknown kind still becomes "scan"', JSON.parse(kv.store[j.key]).kind === 'scan');
  r = await worker.fetch(req('POST', '/save', { load: 'L', transcript: 't', photo: 'data:image/jpeg;base64,AAAA', savedAt: '2026-11-02T00:00:05.000Z' }), env);
  j = await r.json();
  check('/save does not store a photo field (open decision: photos not stored)', !('photo' in JSON.parse(kv.store[j.key])));

  /* --- /samples excludes "__" keys ------------------------------ */
  r = await worker.fetch(new Request(BASE + '/samples?key=k', { headers: { 'Origin': ORIGIN } }), env);
  j = await r.json();
  var names = j.scans.map(function (s) { return s.key; });
  check('/samples lists the scans', j.ok === true && j.count === 6);
  check('/samples never lists the state document', names.every(function (n) { return n.indexOf('__') !== 0; }));

  /* --- /chat body cap -------------------------------------------- */
  var upstreamCalls = 0;
  var realFetch = globalThis.fetch;
  globalThis.fetch = async function () {
    upstreamCalls++;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  function textBodyOfLength(n) {
    var b = { messages: [{ role: 'user', content: '' }] };
    var base = JSON.stringify(b).length;
    b.messages[0].content = 'x'.repeat(n - base);
    return b;
  }
  var t1 = textBodyOfLength(60001);
  check('helper builds a 60,001-char text body', JSON.stringify(t1).length === 60001);
  r = await worker.fetch(req('POST', '/chat', t1), env);
  check('/chat: 60,001-char text body is 413', r.status === 413);
  var t0 = textBodyOfLength(60000);
  r = await worker.fetch(req('POST', '/chat', t0), env);
  check('/chat: 60,000-char text body passes', r.status === 200);

  var img = { messages: [{ role: 'user', content: [
    { type: 'text', text: 'Read this BOL.' },
    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + 'A'.repeat(200000) } }
  ] }] };
  var before = upstreamCalls;
  r = await worker.fetch(req('POST', '/chat', img), env);
  check('/chat: 200,000-char body with a data: image is NOT 413', r.status === 200 && upstreamCalls === before + 1);

  var bigImg = { messages: [{ role: 'user', content: [
    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + 'A'.repeat(1500001) } }
  ] }] };
  r = await worker.fetch(req('POST', '/chat', bigImg), env);
  check('/chat: over 1,500,000 chars even with an image is 413', r.status === 413);

  var urlImg = { messages: [{ role: 'user', content: [
    { type: 'image_url', image_url: { url: 'https://example.com/a.webp?' + 'q'.repeat(70000) } }
  ] }] };
  r = await worker.fetch(req('POST', '/chat', urlImg), env);
  check('/chat: an https image URL does not raise the cap (still 413 over 60,000)', r.status === 413);
  globalThis.fetch = realFetch;

  console.log('\n' + (failures ? failures + ' FAILED' : 'all passed'));
  process.exit(failures ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
