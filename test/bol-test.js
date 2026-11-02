/* bol-test.js — node, no dependencies.
   The pure logic of the BOL camera read (js/bol.js): parsing the
   model's reply (clean, messy, missing fields → "not read"), the
   read request with fetch stubbed (one retry on empty/unparseable,
   honest errors), the match against Test Load 001's fixture data
   (agree / short / over / not read), and the /save body.
   Camera hardware and the live model are not tested here.
   Run: node test/bol-test.js   (exit 0 = all pass) */
'use strict';

var B = require('../js/bol.js');
var L = require('../data/bol-loads.js');

var failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
  if (!cond) failures++;
}
var NR = B.NOT_READ;
var load = L.byId('TL-001');

/* The answer a perfect read of test-data/bol-test-load-001 gives. */
var CLEAN = {
  carrier: 'Blue Ridge Freight Lines',
  bol_number: 'BRFL-TL-001',
  shipper: 'Piedmont Janitorial Supply',
  consignee: 'Witness Demo Warehouse',
  pieces_claimed: 20,
  total_weight: '624 lb',
  line_items: [
    { description: 'All-purpose cleaner, concentrate — 4 × 1 gal per carton', pieces: 6, weight: '216 lb', un_number: null, hazmat_marks: null },
    { description: 'Aerosol air freshener — 12 × 10 oz per carton', pieces: 4, weight: '88 lb', un_number: 'UN1950', hazmat_marks: 'Aerosols, flammable, 2.1, Limited Quantity' },
    { description: 'Paper towels — 12 rolls per carton', pieces: 6, weight: '120 lb', un_number: null, hazmat_marks: null },
    { description: 'Dish soap — 12 × 32 oz per carton', pieces: 4, weight: '200 lb', un_number: null, hazmat_marks: null }
  ]
};
function clone(o) { return JSON.parse(JSON.stringify(o)); }

/* --- fixture ---------------------------------------------------- */
check('fixture: Test Load 001 is Blue Ridge Freight Lines, 20 claimed, 624 lb',
  load.label === 'Test Load 001' && load.onFile.carrier === 'Blue Ridge Freight Lines' && load.onFile.piecesClaimed === 20 && load.onFile.totalWeightLb === 624);
check('fixture: line claims add up to 20 and weights to 624',
  load.lines.reduce(function (s, l) { return s + l.claimed; }, 0) === 20 && load.lines.reduce(function (s, l) { return s + l.weightLb; }, 0) === 624);
check('fixture: 18 present — cleaner and aerosol each short one',
  load.lines.reduce(function (s, l) { return s + l.present; }, 0) === 18 &&
  load.lines.filter(function (l) { return l.claimed - l.present === 1; }).map(function (l) { return l.key; }).join() === 'cleaner,aerosol');

/* --- parsing: clean ---------------------------------------------- */
var b = B.parseBolText(JSON.stringify(CLEAN));
check('clean: carrier as read', b.carrier === 'Blue Ridge Freight Lines');
check('clean: BOL number as read', b.bolNumber === 'BRFL-TL-001');
check('clean: shipper and consignee as read', b.shipper === 'Piedmont Janitorial Supply' && b.consignee === 'Witness Demo Warehouse');
check('clean: pieces claimed 20', b.piecesClaimed === 20);
check('clean: total weight kept as printed, and 624 lb', b.totalWeight === '624 lb' && b.totalWeightLb === 624);
check('clean: four line items', b.lineItems.length === 4);
check('clean: aerosol UN number and marks as printed', b.lineItems[1].unNumber === 'UN1950' && /Limited Quantity/.test(b.lineItems[1].hazmatMarks));
check('clean: a line with no hazmat says not read for UN (never filled in)', b.lineItems[0].unNumber === NR && b.lineItems[0].hazmatMarks === NR);

/* --- parsing: messy ---------------------------------------------- */
var fenced = '```json\n' + JSON.stringify(CLEAN) + '\n```';
check('messy: code-fenced JSON parses', B.parseBolText(fenced).piecesClaimed === 20);
var prose = 'Here is what I read from the bill of lading:\n' + JSON.stringify(CLEAN) + '\nLet me know if you need more.';
check('messy: JSON wrapped in prose parses', B.parseBolText(prose).carrier === 'Blue Ridge Freight Lines');
var stringy = clone(CLEAN);
stringy.pieces_claimed = '20 cartons';
stringy.total_weight = '624 LBS';
stringy.line_items[0].pieces = '6';
check('messy: "20 cartons" reads as 20', B.parseBolText(JSON.stringify(stringy)).piecesClaimed === 20);
check('messy: "624 LBS" reads as 624 lb, text kept', (function (x) { return x.totalWeightLb === 624 && x.totalWeight === '624 LBS'; })(B.parseBolText(JSON.stringify(stringy))));
check('messy: "6" as a string reads as 6', B.parseBolText(JSON.stringify(stringy)).lineItems[0].pieces === 6);
var kg = clone(CLEAN); kg.total_weight = '283 kg';
check('messy: kilograms convert to pounds, text kept as printed', (function (x) { return x.totalWeight === '283 kg' && x.totalWeightLb === 624; })(B.parseBolText(JSON.stringify(kg))));
var camel = { carrier: 'Blue Ridge Freight Lines', bolNumber: 'BRFL-TL-001', piecesClaimed: 20, lineItems: [{ description: 'Cleaner', pieces: 6 }] };
check('messy: camelCase keys are accepted', (function (x) { return x.bolNumber === 'BRFL-TL-001' && x.lineItems[0].pieces === 6; })(B.parseBolText(JSON.stringify(camel))));
check('messy: plain prose with no JSON is not a read', B.parseBolText('I could not read this image.') === null);
check('messy: an empty reply is not a read', B.parseBolText('') === null);
check('messy: an array is not a read', B.parseBolText('[1,2,3]') === null);
check('messy: an object with no BOL fields is not a read', B.parseBolText('{"flags":[]}') === null);

/* --- parsing: missing fields → not read ------------------------- */
var partial = B.parseBolText(JSON.stringify({ carrier: 'Blue Ridge Freight Lines', bol_number: null, shipper: '', consignee: 'unreadable', pieces_claimed: null, line_items: [{ description: 'Paper towels', pieces: null, weight: '' }] }));
check('missing: null BOL number → not read', partial.bolNumber === NR);
check('missing: empty shipper → not read', partial.shipper === NR);
check('missing: "unreadable" consignee → not read', partial.consignee === NR);
check('missing: null pieces → not read', partial.piecesClaimed === NR);
check('missing: absent total weight → not read (text and number)', partial.totalWeight === NR && partial.totalWeightLb === NR);
check('missing: a line with null pieces → not read', partial.lineItems[0].pieces === NR && partial.lineItems[0].weight === NR);
check('missing: no line_items at all → empty list', B.parseBolText('{"carrier":"X"}').lineItems.length === 0);
check('missing: a fractional or negative count is not read', B.parseBolText('{"pieces_claimed":2.5}').piecesClaimed === NR && B.parseBolText('{"pieces_claimed":-3}').piecesClaimed === NR);
var shown = B.bolLines(partial);
check('lines: not-read fields say "not read" on the page', shown.indexOf('BOL number: not read') !== -1 && shown.indexOf('Pieces claimed: not read') !== -1);
check('lines: the clean read lists hazmat as printed', B.bolLines(b).some(function (s) { return /Line 2: .*hazmat as printed: UN1950, Aerosols/.test(s); }));
check('lines: no line items says so', B.bolLines(B.parseBolText('{"carrier":"X"}')).indexOf('Line items: not read') !== -1);

/* --- the match ---------------------------------------------------- */
var m = B.matchBol(b, load);
check('match: labeled as against the fixture data', /Test Load 001 — fixture data/.test(m.against));
function row(name) { return m.counts.filter(function (r) { return r.name === name; })[0]; }
check('match: cleaner short 1 (BOL 6, pallet 5)', row('All-purpose cleaner').result === 'short' && row('All-purpose cleaner').diff === 1);
check('match: aerosol short 1 (BOL 4, pallet 3)', row('Aerosol air freshener').result === 'short' && row('Aerosol air freshener').diff === 1);
check('match: towels agree', row('Paper towels').result === 'agree');
check('match: soap agrees', row('Dish soap').result === 'agree');
check('match: total short 2 (20 vs 18)', m.total.result === 'short' && m.total.diff === 2 && m.total.read === 20 && m.total.present === 18);
check('match: the plain line says it', m.total.line === 'Total pieces — BOL says 20, 18 on the pallet. Short 2.');
check('match: summary names both shortages', m.summary === 'BOL claims 20 pieces; 18 are on the pallet — short: all-purpose cleaner 1, aerosol air freshener 1.');
check('match: identity all agree on a clean read', m.identity.every(function (r) { return r.result === 'agree'; }));
check('match: no extra lines on a clean read', m.extra.length === 0);

var over = clone(CLEAN); over.line_items[2].pieces = 5; over.pieces_claimed = 17;
var mo = B.matchBol(B.parseBolText(JSON.stringify(over)), load);
check('match: BOL says fewer than present → over', mo.counts[2].result === 'over' && mo.counts[2].diff === 1);
check('match: total over when BOL claims fewer', mo.total.result === 'over' && mo.total.diff === 1);

var mp = B.matchBol(partial, load);
check('match: a not-read BOL count is not compared', mp.counts.filter(function (r) { return r.name === 'Paper towels'; })[0].result === 'not-read');
check('match: a fixture line missing from the read says "not on BOL"', mp.counts.filter(function (r) { return r.name === 'All-purpose cleaner'; })[0].result === 'not-on-bol');
check('match: total not read → summary says it can\'t compare', mp.total.result === 'not-read' && /can't be compared/.test(mp.summary));
check('match: a not-read BOL number is not called a mismatch', mp.identity.filter(function (r) { return r.field === 'bolNumber'; })[0].result === 'not-read');

var wrong = clone(CLEAN); wrong.carrier = 'Smoky Mountain Express'; wrong.bol_number = 'brfl tl 001';
var mw = B.matchBol(B.parseBolText(JSON.stringify(wrong)), load);
check('match: a different carrier differs', mw.identity[0].result === 'differ');
check('match: BOL number compare ignores case and punctuation', mw.identity[1].result === 'agree');
var extra = clone(CLEAN); extra.line_items.push({ description: 'Mop heads', pieces: 2, weight: '10 lb' });
check('match: a BOL line not in the fixture is listed as extra', B.matchBol(B.parseBolText(JSON.stringify(extra)), load).extra.length === 1);
var allGood = clone(CLEAN); allGood.line_items[0].pieces = 5; allGood.line_items[1].pieces = 3; allGood.pieces_claimed = 18;
check('match: everything agrees → summary says so', B.matchBol(B.parseBolText(JSON.stringify(allGood)), load).summary === 'The BOL and the pallet agree: 18 pieces.');

/* --- the save body ------------------------------------------------- */
var body = B.buildSaveBody(load, b, m, '2026-11-02T01:00:00.000Z');
check('save: kind stays "scan"', body.kind === 'scan');
check('save: load label and a non-empty transcript', body.load === 'Test Load 001' && /BOL camera read — Test Load 001/.test(body.transcript) && /Carrier: Blue Ridge/.test(body.transcript));
check('save: bol is a plain object with the read and the match', body.bol && !Array.isArray(body.bol) && body.bol.read.piecesClaimed === 20 && body.bol.match.total.diff === 2);
check('save: flags carry only the findings that are not agreements (2 short lines + total)', body.flags.length === 3 && body.flags.every(function (f) { return f.label === 'short'; }));
check('save: no photo is included (open decision)', !('photo' in body) && JSON.stringify(body).indexOf('data:image') === -1);

/* --- the read request (fetch stubbed) ------------------------------ */
function reply(content) { return { ok: true, status: 200, json: function () { return Promise.resolve({ choices: [{ message: { content: content } }] }); } }; }
function status(code) { return { ok: false, status: code, json: function () { return Promise.resolve({}); } }; }
function stub(responses) {
  var calls = [];
  var f = function (url, init) { calls.push({ url: url, init: init }); var r = responses[Math.min(calls.length - 1, responses.length - 1)]; return r instanceof Error ? Promise.reject(r) : Promise.resolve(r); };
  f.calls = calls;
  return f;
}
var DATA = 'data:image/jpeg;base64,/9j/AAAA';

var body0 = JSON.parse(B.buildReadBody(DATA));
check('request: max_tokens 6000', body0.max_tokens === 6000);
check('request: the photo rides as a data: image_url', body0.messages[1].content[1].image_url.url === DATA);
check('request: the prompt asks for null over guessing', /never invent/.test(body0.messages[0].content));
check('downscale: longest side to 1600, shape kept', (function (s) { return s.w === 1600 && s.h === 1200; })(B.fitWithin(4000, 3000, 1600)));
check('downscale: never scales up', (function (s) { return s.w === 800 && s.h === 600; })(B.fitWithin(800, 600, 1600)));

var tests = [];
var f1 = stub([reply(JSON.stringify(CLEAN))]);
tests.push(B.readBol(f1, DATA, 'https://w/chat').then(function (r) {
  check('read: a clean reply reads on the first try', r.attempts === 1 && r.bol.piecesClaimed === 20 && f1.calls.length === 1);
  check('read: posts to the given /chat URL', f1.calls[0].url === 'https://w/chat' && f1.calls[0].init.method === 'POST');
}));
var f2 = stub([reply(''), reply(JSON.stringify(CLEAN))]);
tests.push(B.readBol(f2, DATA, 'u').then(function (r) {
  check('read: an empty reply is retried once, then reads', r.attempts === 2 && f2.calls.length === 2);
}));
var f3 = stub([reply('Sorry, the image is blurry.'), reply(JSON.stringify(CLEAN))]);
tests.push(B.readBol(f3, DATA, 'u').then(function (r) {
  check('read: an unparseable reply is retried once, then reads', r.attempts === 2);
}));
var f4 = stub([reply(''), reply('')]);
tests.push(B.readBol(f4, DATA, 'u').then(function () { check('read: empty twice is an honest error', false); }, function (e) {
  check('read: empty twice is an honest error (no third try)', e.code === 'empty' && f4.calls.length === 2 && /Nothing was guessed/.test(e.userMessage));
}));
var f5 = stub([reply('nope'), reply('still nope')]);
tests.push(B.readBol(f5, DATA, 'u').then(function () { check('read: unparseable twice is an error', false); }, function (e) {
  check('read: unparseable twice is an honest error', e.code === 'unparseable' && f5.calls.length === 2);
}));
var f6 = stub([status(413)]);
tests.push(B.readBol(f6, DATA, 'u').then(function () { check('read: 413', false); }, function (e) {
  check('read: 413 says the photo was too large, keeps the photo, no retry', e.code === 'too-large' && /still on screen/.test(e.userMessage) && f6.calls.length === 1);
}));
var f7 = stub([status(502)]);
tests.push(B.readBol(f7, DATA, 'u').then(function () { check('read: 502', false); }, function (e) {
  check('read: an HTTP error is reported with its code, no retry', e.code === 'http' && /HTTP 502/.test(e.userMessage) && f7.calls.length === 1);
}));
var f8 = stub([new TypeError('Failed to fetch')]);
tests.push(B.readBol(f8, DATA, 'u').then(function () { check('read: network', false); }, function (e) {
  check('read: no connection is said plainly', e.code === 'network' && /could not be reached/.test(e.userMessage));
}));
var f9 = stub([status(429)]);
tests.push(B.readBol(f9, DATA, 'u').then(function () { check('read: 429', false); }, function (e) {
  check('read: the call cap is said plainly', e.code === 'cap');
}));

/* --- the generic read (the kitchen demo reuses it) ----------------- */
var g = JSON.parse(B.readBody(DATA, 'SYS', 'Read this receipt.'));
check('generic: readBody carries the given prompt, text and photo, 6000 tokens',
  g.messages[0].content === 'SYS' && g.messages[1].content[0].text === 'Read this receipt.' && g.messages[1].content[1].image_url.url === DATA && g.max_tokens === 6000);
check('generic: parseJson strips code fences', B.parseJson('```json\n{"items":[1]}\n```').items[0] === 1);
var g1 = stub([reply('{"items":[]}')]);
tests.push(B.sendRead(g1, 'u', B.readBody(DATA, 'S', 'T')).then(function (r) {
  check('generic: sendRead with no validator accepts any JSON object', r.attempts === 1 && Array.isArray(r.parsed.items) && r.text === '{"items":[]}');
}));
var g2 = stub([reply('{"wrong":1}'), reply('{"items":[2]}')]);
tests.push(B.sendRead(g2, 'u', 'b', function (p) { return Array.isArray(p.items) ? p.items : null; }).then(function (r) {
  check('generic: a validator rejecting the shape triggers the one retry', r.attempts === 2 && r.value[0] === 2);
}));

/* --- save request -------------------------------------------------- */
var s1 = stub([{ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true, key: 'k1' }); } }]);
tests.push(B.saveBol(s1, body, 'https://w/save').then(function (j) {
  var sent = JSON.parse(s1.calls[0].init.body);
  check('save: posts the body to /save and returns the key', j.key === 'k1' && s1.calls[0].url === 'https://w/save' && sent.bol.read.carrier === 'Blue Ridge Freight Lines');
}));
var s2 = stub([status(501)]);
tests.push(B.saveBol(s2, body, 'u').then(function () { check('save: 501', false); }, function (e) {
  check('save: storage not connected is said plainly', e.code === 'no-storage');
}));

Promise.all(tests).then(function () {
  console.log('\n' + (failures ? failures + ' FAILED' : 'all passed'));
  process.exit(failures ? 1 : 0);
}, function (e) { console.error(e); process.exit(1); });
