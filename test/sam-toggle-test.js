/* sam-toggle-test.js — node, no dependencies.
   SAM 3.1 as a toggle on the photo scan (briefs/claude-brief-sam-toggle.md).
   The pure pieces of js/photo.js — side attribution against the real
   contact sheets' dimensions, the samEvidence record, the evidence
   block the comparison sees, the OS&D line present/absent, the record
   shape with and without SAM — and the Worker's /segment route
   against a stubbed upstream speaking Meta's documented wire format.
   Run: node test/sam-toggle-test.js   (exit 0 = all pass) */
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

var ROOT = path.join(__dirname, '..');

/* ---------- photo.js in node (no document: init is skipped) ---------- */
global.window = {};
require(path.join(ROOT, 'js', 'photo.js'));
var P = global.window.WitnessPhoto;

/* ---------- WebP header dimensions (VP8 / VP8L / VP8X) --------------- */
function webpSize(file) {
  var b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  var chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  if (chunk === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    var bits = b.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

/* --- sheet geometry pinned to the real files ------------------------ */
Object.keys(P.SHEET_GEOMETRY).forEach(function (k) {
  var g = P.SHEET_GEOMETRY[k];
  var real = webpSize(path.join(ROOT, g.file));
  check('sheet ' + k + ': geometry matches the real file (' + g.file + ' is ' + (real && real.w) + 'x' + (real && real.h) + ')',
    !!real && real.w === g.w && real.h === g.h);
  check('sheet ' + k + ': 2 x 2 grid FRONT RIGHT / BACK LEFT',
    JSON.stringify(g.grid) === JSON.stringify([['front', 'right'], ['back', 'left']]));
});
check('load A sheet is 1920x1280, load B 1600x1600',
  P.SHEET_GEOMETRY.a.w === 1920 && P.SHEET_GEOMETRY.a.h === 1280 &&
  P.SHEET_GEOMETRY.b.w === 1600 && P.SHEET_GEOMETRY.b.h === 1600);

/* --- side attribution ------------------------------------------------ */
/* Pixel boxes on the real sheets, normalized the way the Worker does. */
function norm(k, x1, y1, x2, y2) {
  var g = P.SHEET_GEOMETRY[k];
  function n(v, s) { return Math.max(0, Math.min(1000, Math.round(v * 1000 / s))); }
  return { x1: n(x1, g.w), y1: n(y1, g.h), x2: n(x2, g.w), y2: n(y2, g.h) };
}
/* Load A, 1920x1280: panels split at x 960, y 640. */
check('A: a carton top-left of the sheet is FRONT', P._sideForBox('a', norm('a', 400, 200, 480, 260)) === 'front');
check('A: top-right is RIGHT', P._sideForBox('a', norm('a', 1400, 300, 1480, 360)) === 'right');
check('A: bottom-left is BACK', P._sideForBox('a', norm('a', 500, 900, 600, 960)) === 'back');
check('A: bottom-right is LEFT', P._sideForBox('a', norm('a', 1500, 1000, 1600, 1080)) === 'left');
/* Load B, 1600x1600: panels split at 800. */
check('B: the torn front carton (~600,520) is FRONT', P._sideForBox('b', norm('b', 560, 480, 680, 580)) === 'front');
check('B: a carton at (1300,1200) is LEFT', P._sideForBox('b', norm('b', 1250, 1150, 1350, 1250)) === 'left');
check('B: a carton at (1100,300) is RIGHT', P._sideForBox('b', norm('b', 1050, 250, 1150, 350)) === 'right');
check('B: a carton at (300,1200) is BACK', P._sideForBox('b', norm('b', 250, 1150, 350, 1250)) === 'back');
check('a box straddling the vertical split is overall', P._sideForBox('b', norm('b', 700, 100, 900, 200)) === 'overall');
check('a box straddling the horizontal split is overall', P._sideForBox('a', norm('a', 100, 600, 200, 700)) === 'overall');
check('a box centred in the gutter band is overall', P._sideForBox('b', { x1: 495, y1: 100, x2: 505, y2: 150 }) === 'overall');
check('an unknown sheet never guesses a side', P._sideForBox('z', { x1: 10, y1: 10, x2: 20, y2: 20 }) === 'overall');

/* --- samEvidence (the record field) --------------------------------- */
var results = [
  { concept: 'cardboard box', matches: [
    { box: { x1: 100, y1: 100, x2: 150, y2: 150 }, score: 0.8 },
    { box: { x1: 600, y1: 100, x2: 650, y2: 150 }, score: 0.7 },
    { box: { x1: 100, y1: 600, x2: 150, y2: 650 } }] },
  { concept: 'shipping label', matches: [] },
  { concept: 'damaged cardboard box', matches: [{ box: { x1: 300, y1: 300, x2: 400, y2: 380 }, score: 0.66 }] },
  { concept: 'torn plastic wrap', failed: true }
];
var ev = P._buildSamEvidence('b', results);
check('evidence: on is true', ev.on === true);
check('evidence: one entry per concept in the brief\'s set',
  JSON.stringify(Object.keys(ev.concepts)) === JSON.stringify(['cardboard box', 'shipping label', 'damaged cardboard box', 'torn plastic wrap']));
check('evidence: carton count 3, boxes carry their side', ev.concepts['cardboard box'].count === 3 &&
  ev.concepts['cardboard box'].boxes.map(function (b) { return b.side; }).join() === 'front,right,back');
check('evidence: score kept when SAM gave one, absent when not',
  ev.concepts['cardboard box'].boxes[0].score === 0.8 && !('score' in ev.concepts['cardboard box'].boxes[2]));
check('evidence: zero matches is a count of 0, not unavailable',
  ev.concepts['shipping label'].count === 0 && !ev.concepts['shipping label'].unavailable);
check('evidence: a failed concept is unavailable with no count and no boxes',
  ev.concepts['torn plastic wrap'].unavailable === true && ev.concepts['torn plastic wrap'].count === null &&
  ev.concepts['torn plastic wrap'].boxes.length === 0);
check('evidence: a concept with no result at all is unavailable',
  P._buildSamEvidence('b', []).concepts['cardboard box'].unavailable === true);
check('evidence: no mask data, boxes only', !/mask/i.test(JSON.stringify(ev)) &&
  ev.concepts['cardboard box'].boxes.every(function (b) {
    return Object.keys(b).every(function (k) { return ['x1', 'y1', 'x2', 'y2', 'side', 'score'].indexOf(k) !== -1; });
  }));
check('evidence: a malformed box is dropped', P._buildSamEvidence('b', [{ concept: 'cardboard box', matches: [{ box: { x1: 'a' } }, {}] }]).concepts['cardboard box'].count === 0);

/* --- the evidence block the comparison sees ------------------------- */
var block = P._samEvidenceBlock(ev);
check('block: counts per concept per side', block.counts['cardboard box'].front === 1 &&
  block.counts['cardboard box'].right === 1 && block.counts['cardboard box'].back === 1 &&
  block.counts['cardboard box'].left === 0 && block.counts['cardboard box'].total === 3);
check('block: an unavailable concept says so', block.counts['torn plastic wrap'] === 'unavailable');
check('block: located damage items are photo-side observations',
  block.located_damage.length === 1 && block.located_damage[0].observation === 'damaged cardboard box' &&
  block.located_damage[0].side === 'front');
check('block: cartons and labels are not listed as damage',
  block.located_damage.every(function (d) { return d.observation !== 'cardboard box' && d.observation !== 'shipping label'; }));

/* --- the compare prompt extension ----------------------------------- */
check('compare rule: SAM is photo-scan evidence, not a third scan, not a verdict',
  /part of the PHOTO scan/.test(P.COMPARE_SAM_RULE) && /NOT a third scan/.test(P.COMPARE_SAM_RULE) &&
  /NOT a verdict/.test(P.COMPARE_SAM_RULE));
check('compare rule: never cite a number the block lacks', /never cite a number/.test(P.COMPARE_SAM_RULE));
check('base compare prompt does not mention SAM 3.1 (OFF is unchanged)', !/SAM 3\.1|segmentation/.test(P.COMPARE_PROMPT));

/* --- OS&D line present / absent -------------------------------------- */
var scan = { transcript: 'Twenty cases, front looks fine.', flags: [], loadKey: 'b', loadLabel: 'Load B — peaches stack' };
var list = [{ point: 'Front side', verdict: 'flag', human: 'fine', photo: 'crushed', note: 'n' }];
var off = P._buildOsd(scan, [], list);
check('OS&D OFF: no SAM line at all', !/SAM 3\.1/.test(off));
var on = P._buildOsd(scan, [], list, ev);
check('OS&D ON: the attached line with the carton count', /SAM 3\.1 evidence attached: 3 cartons segmented/.test(on));
check('OS&D ON: a failed concept is named as requested but unavailable',
  /SAM 3\.1 evidence was requested but unavailable for: torn plastic wrap\./.test(on));
check('OS&D ON: the human still decides', /The machine never signs off — a human decides\.$/.test(on));
var allFailed = P._buildSamEvidence('b', P.SAM_CONCEPTS.map(function (c) { return { concept: c, failed: true }; }));
var dead = P._buildOsd(scan, [], list, allFailed);
check('OS&D ON, SAM unreachable: says requested but unavailable, invents nothing',
  /SAM 3\.1 evidence was requested but unavailable — none was attached\./.test(dead) && !/segmented/.test(dead));
check('OS&D ON, carton concept failed: no carton number is invented',
  P._samOsdLines(P._buildSamEvidence('b', [{ concept: 'shipping label', matches: [] }]))[0] === 'SAM 3.1 evidence attached (carton count unavailable).');
check('OS&D: one carton reads singular',
  P._samOsdLines(P._buildSamEvidence('b', P.SAM_CONCEPTS.map(function (c) {
    return { concept: c, matches: c === 'cardboard box' ? [{ box: { x1: 1, y1: 1, x2: 2, y2: 2 } }] : [] };
  })))[0] === 'SAM 3.1 evidence attached: 1 carton segmented (concept "cardboard box").');

/* --- record shape with and without SAM ------------------------------- */
var recOff = P._osdPayload(scan, 'REPORT', list, '2026-11-05T00:00:00.000Z', null);
check('record OFF: exactly today\'s keys', Object.keys(recOff).join() === 'load,kind,transcript,flags,verdicts,savedAt');
check('record OFF: today\'s values', recOff.load === 'Load B — peaches stack' && recOff.kind === 'osd' &&
  recOff.transcript === 'REPORT' && recOff.flags.length === 0 && recOff.verdicts === list);
var recOn = P._osdPayload(scan, 'REPORT', list, '2026-11-05T00:00:00.000Z', ev);
check('record ON: today\'s keys plus samEvidence', Object.keys(recOn).join() === 'load,kind,transcript,flags,verdicts,savedAt,samEvidence');
check('record ON: samEvidence is {on, concepts{count, boxes}}', recOn.samEvidence.on === true &&
  recOn.samEvidence.concepts['cardboard box'].count === 3 && Array.isArray(recOn.samEvidence.concepts['cardboard box'].boxes));

/* ---------- the Worker: /segment and /save samEvidence --------------- */
var ORIGIN = 'http://localhost:8902';
var BASE = 'https://witness.example.workers.dev';
var SHEET = 'https://grateful-ed.github.io/witness/test-data/photos/load-b-peaches-stack.webp';
function req(method, p, body, extraHeaders) {
  var headers = Object.assign({ 'Origin': ORIGIN, 'Content-Type': 'application/json' }, extraHeaders || {});
  var init = { method: method, headers: headers };
  if (body != null) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request(BASE + p, init);
}
/* Synthetic, hand-written wire text in the documented grammar: one
   <0f> line, records "id<|box;...|><|mask;...|>", c optional, a
   one_bit mask payload holding characters that look like syntax. */
var WIRE = '<0f>0<|box;x1=160;y1=320;x2=319;y2=479;w=1600;h=1600;c=0.875|><|mask;x=0;y=0;c=0.875;data=12,12,!a,b<c|d~e!f|>,' +
  '3<|box;x1=1200;y1=1200;x2=1279;y2=1279;w=1600;h=1600;c=0.52|><|mask;x=0;y=0;c=0.52;data=8,8,!zz>|>,' +
  '7<|box;x1=10;y1=20;x2=30;y2=40;w=1600;h=1600|><|mask;x=0;y=0;data=2,2,~ab|>';

(async function main() {
  var src = fs.readFileSync(path.join(ROOT, 'worker', 'worker.js'), 'utf8');
  var tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'witness-worker-')), 'worker.mjs');
  fs.writeFileSync(tmp, src);
  var worker = (await import(url.pathToFileURL(tmp).href)).default;
  var env = { META_API_KEY: 'test-key' };

  var sent = [];
  var reply = null;
  var realFetch = globalThis.fetch;
  globalThis.fetch = async function (u, init) {
    sent.push({ url: u, body: JSON.parse(init.body), auth: init.headers.Authorization });
    if (reply === 'throw') throw new TypeError('network');
    return reply;
  };
  function upstream(text, status) {
    return new Response(JSON.stringify({ id: 'resp_1', object: 'response', status: 'completed', model: 'sam-3.1',
      output: [{ id: 'msg_1', type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: text, annotations: [] }] }] }),
      { status: status || 200, headers: { 'Content-Type': 'application/json' } });
  }

  reply = upstream(WIRE);
  var r = await worker.fetch(req('POST', '/segment', { imageUrl: SHEET, concept: 'cardboard box' }), env);
  var j = await r.json();
  check('/segment: 200 with {concept, matches}', r.status === 200 && j.concept === 'cardboard box' && Array.isArray(j.matches));
  check('/segment: one match per box record (3)', j.matches.length === 3);
  check('/segment: boxes normalized 0–1000 from the token\'s own w/h',
    JSON.stringify(j.matches[0].box) === JSON.stringify({ x1: 100, y1: 200, x2: 199, y2: 299 }) &&
    JSON.stringify(j.matches[1].box) === JSON.stringify({ x1: 750, y1: 750, x2: 799, y2: 799 }));
  check('/segment: score from c, absent when c is absent', j.matches[0].score === 0.875 && j.matches[1].score === 0.52 && !('score' in j.matches[2]));
  check('/segment: no mask data reaches the page', !/mask|data=/.test(JSON.stringify(j)));
  var up = sent[0];
  check('/segment upstream: POST /v1/responses with the Worker\'s key',
    up.url === 'https://api.meta.ai/v1/responses' && up.auth === 'Bearer test-key');
  check('/segment upstream: model sam-3.1, one user message, input_text concept + input_image URL',
    up.body.model === 'sam-3.1' && up.body.input.length === 1 && up.body.input[0].type === 'message' &&
    up.body.input[0].role === 'user' &&
    up.body.input[0].content[0].type === 'input_text' && up.body.input[0].content[0].text === 'cardboard box' &&
    up.body.input[0].content[1].type === 'input_image' && up.body.input[0].content[1].image_url === SHEET);
  check('/segment upstream: confidence asked as the string "true", one_bit masks, store false',
    up.body.metadata.include_confidence === 'true' && up.body.metadata.mask_encoding === 'one_bit' && up.body.store === false);

  reply = upstream('');
  r = await worker.fetch(req('POST', '/segment', { imageUrl: SHEET, concept: 'torn plastic wrap' }), env);
  j = await r.json();
  check('/segment: zero matches (empty output_text) is 200 with no matches', r.status === 200 && j.matches.length === 0);

  reply = upstream('<0f>0<|box;x1=1;y1=2;x2=3|><|mask;x=0;y=0;data=1,1,~a|>,1<|box;x1=a;y1=2;x2=3;y2=4;w=10;h=10|><|mask;x=0;y=0;data=1,1,~a|>');
  r = await worker.fetch(req('POST', '/segment', { imageUrl: SHEET, concept: 'cardboard box' }), env);
  j = await r.json();
  check('/segment: malformed box tokens are skipped, not invented', r.status === 200 && j.matches.length === 0);

  var n = sent.length;
  r = await worker.fetch(req('POST', '/segment', { imageUrl: SHEET, concept: 'bus, bicycle' }), env);
  check('/segment: a concept outside the set is 400, no upstream call', r.status === 400 && sent.length === n);
  r = await worker.fetch(req('POST', '/segment', { imageUrl: 'https://evil.example/x.png', concept: 'cardboard box' }), env);
  check('/segment: an image outside the project is 400, no upstream call', r.status === 400 && sent.length === n);
  r = await worker.fetch(req('POST', '/segment', 'not json'), env);
  check('/segment: not JSON is 400', r.status === 400);
  r = await worker.fetch(req('POST', '/segment', { imageUrl: SHEET, concept: 'cardboard box', pad: 'x'.repeat(3000) }), env);
  check('/segment: an oversized body is 413', r.status === 413);
  r = await worker.fetch(req('POST', '/segment', { imageUrl: SHEET, concept: 'cardboard box' }, { 'Origin': 'https://evil.example' }), env);
  check('/segment: a foreign origin is 403', r.status === 403);
  r = await worker.fetch(req('POST', '/segment', { imageUrl: SHEET, concept: 'cardboard box' }), {});
  check('/segment: no META_API_KEY is 500 with a plain error', r.status === 500 && /META_API_KEY/.test((await r.json()).error));
  r = await worker.fetch(req('GET', '/segment'), env);
  check('/segment: GET is 405', r.status === 405);

  reply = upstream('x', 404);
  r = await worker.fetch(req('POST', '/segment', { imageUrl: SHEET, concept: 'cardboard box' }), env);
  j = await r.json();
  check('/segment: an upstream error is 502 naming the status', r.status === 502 && /HTTP 404/.test(j.error));
  reply = 'throw';
  r = await worker.fetch(req('POST', '/segment', { imageUrl: SHEET, concept: 'cardboard box' }), env);
  check('/segment: upstream unreachable is 502', r.status === 502 && /unreachable/.test((await r.json()).error));
  reply = new Response('<html>', { status: 200 });
  r = await worker.fetch(req('POST', '/segment', { imageUrl: SHEET, concept: 'cardboard box' }), env);
  check('/segment: an unreadable upstream body is 502', r.status === 502);
  reply = new Response(JSON.stringify({ choices: [] }), { status: 200 });
  r = await worker.fetch(req('POST', '/segment', { imageUrl: SHEET, concept: 'cardboard box' }), env);
  check('/segment: an upstream reply with no output array is 502', r.status === 502);

  r = await worker.fetch(req('GET', '/nope'), env);
  check('404 text names /segment', r.status === 404 && /\/segment/.test((await r.json()).error));

  /* /save keeps samEvidence (plain object only) and nothing new when absent */
  var store = {};
  var kv = { put: async function (k, v) { store[k] = v; } };
  r = await worker.fetch(req('POST', '/save', recOn), { SCANS: kv });
  j = await r.json();
  var saved = JSON.parse(store[j.key]);
  check('/save ON: samEvidence round-trips', JSON.stringify(saved.samEvidence) === JSON.stringify(ev));
  r = await worker.fetch(req('POST', '/save', recOff), { SCANS: kv });
  j = await r.json();
  saved = JSON.parse(store[j.key]);
  check('/save OFF: the stored record has exactly today\'s keys', Object.keys(saved).join() === 'load,kind,transcript,flags,savedAt,verdicts');
  r = await worker.fetch(req('POST', '/save', Object.assign({}, recOff, { samEvidence: [1, 2] })), { SCANS: kv });
  j = await r.json();
  check('/save: a samEvidence that is an array is dropped', !('samEvidence' in JSON.parse(store[j.key])));

  globalThis.fetch = realFetch;
  console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
