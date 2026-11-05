/* wms-flags-test.js — node, no dependencies.
   Flags on the map (Console Task 4, js/wms-map.js flags()). The one
   voice the map is allowed: a small mark on anything whose record
   already says a human is needed now — a held bin, a held pallet, an
   open OS&D finding, an open worker flag. Proves: flags derive only
   from existing data; a non-urgent item carries none; a decided item
   loses its flag; each flag links to its own item's Witness page; a
   flag carries no words, counts or legend; nothing is saved.
   Run: node test/wms-flags-test.js   (exit 0 = all pass) */
'use strict';

var E = require('../js/engine.js');
var W = require('../js/wms.js');
var M = require('../js/wms-map.js');
var P = require('../js/wms-witness.js');

var failures = 0, passes = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (cond) passes++; else failures++; }
function count(html, re) { return (html.match(re) || []).length; }
function hrefs(list) { return list.map(function (f) { return f.href; }).sort(); }
/* Every flag link in the HTML, with the opening tag of the place it sits on. */
function marks(html) { return (html.match(/<a class="wm-flag" data-flag href="[^"]*"/g) || []).map(function (a) { return a.replace(/.*href="/, '').replace(/"$/, ''); }); }
function flagOn(html, place, id) {
  var re = new RegExp('data-place="' + place + '"[^>]*? data-id="' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*>[^<]*(<span class="wm-[a-z-]+"[^>]*>)*[^<]*<span class="wm-flags"><a class="wm-flag"');
  return re.test(html);
}

/* ---------- 1. the seed world: one urgent item, one flag ---------- */
var s = W.seed();
var before = JSON.stringify(s);
var f0 = M.flags(s, W);
var h0 = M.html(s, W);
check('seed: the held bin and the standing worker flags → two flag entries', f0.length === 2 && f0[0].href === '#/witness/bin/A-05' &&
  f0[1].href === '#/flags' && f0[1].host.place === 'zone' && f0[1].host.id === 'B' && /FLG-001/.test(f0[1].why) && /FLG-002/.test(f0[1].why));
check('seed: the flag sits on bin A-05 itself', f0[0].host && f0[0].host.place === 'bin' && f0[0].host.id === 'A-05' && flagOn(h0, 'bin', 'A-05'));
check('seed: two flag marks in the map HTML', count(h0, /class="wm-flag"/g) === 2);
check('seed: a stocked, not-held bin (A-01) carries no flag', !flagOn(h0, 'bin', 'A-01'));
check('seed: no pallet, dock or order carries a flag', !/data-place="(pallet|dock|order)"[^>]*>[^]*?<span class="wm-flags">/.test(h0.replace(/data-place="bin"[^]*$/, '')) &&
  ['STG-1', 'STG-2', 'STG-3', 'STG-4'].every(function (id) { return !flagOn(h0, 'pallet', id); }));
check('the flag link lands on the bin\'s own Witness page (same route the page reads)', (function () {
  var r = P.parseRoute(f0[0].href.replace(/^#\//, ''));
  return !!r && r.place === 'bin' && r.id === 'A-05' && P.model(s, r.place, r.id).subject.title === 'Bin A-05';
})());
check('reading flags and rendering the map changes nothing in state', JSON.stringify(s) === before);

/* ---------- 2. a flag marks; it does not explain ---------- */
check('a flag has no visible words (empty link, name for screen readers only)', /<a class="wm-flag" data-flag href="[^"]*" aria-label="Needs a human now — [^"]+" title="[^"]+"><\/a>/.test(h0));
check('no flag entry in the legend, no counts of flags on the map', !/wm-legend[^]*wm-flag/.test(h0) && !/[0-9]+ flag/i.test(h0));
check('flags add no buttons, forms or tables to the map', !/<button|<input|<select|<form|<table|data-act=/.test(h0));

/* ---------- 3. when nothing is urgent, the map is clean ---------- */
var sc = W.seed();
W.release(sc, { binId: 'A-05' }, 'u-sam');
check('A-05 released → only the worker flags mark remains', M.flags(sc, W).length === 1 && M.flags(sc, W)[0].href === '#/flags' && count(M.html(sc, W), /class="wm-flag"/g) === 1);

/* ---------- 4. a receipt with damage: held pallet + open OS&D ---------- */
var s2 = W.seed();
W.checkIn(s2, 'APT-102', 'u-sam');
var r = W.receive(s2, 'IN-1002', [
  { desc: 'Laundry detergent — cases', received: 116, damaged: 4, quote: 'one sixteen cases, four crushed' },
  { desc: 'Paper towels — cases', received: 120, damaged: 0, quote: 'towels all six pallets' }
], { by: 'u-tommy', source: 'voice' });
check('setup: IN-1002 received with open findings', r.ok && r.osd.length >= 2);
var ship = E.shipmentById(s2, 'IN-1002');
var dmg = s2.staging.filter(function (p) { return p.shipmentId === 'IN-1002' && p.damaged; })[0];
var good = s2.staging.filter(function (p) { return p.shipmentId === 'IN-1002' && !p.damaged; })[0];
var f2 = M.flags(s2, W), h2 = M.html(s2, W);
check('the held, damaged pallet carries a flag that opens that pallet', flagOn(h2, 'pallet', dmg.id) &&
  marks(h2).indexOf('#/witness/pallet/' + encodeURIComponent(dmg.id)) !== -1);
check('a good pallet off the same truck carries no flag', !flagOn(h2, 'pallet', good.id));
check('open OS&D findings → ONE flag for the shipment, at the dock it came in at', (function () {
  var sf = f2.filter(function (f) { return f.place === 'shipment'; });
  return sf.length === 1 && sf[0].id === 'IN-1002' && sf[0].host.place === 'dock' && sf[0].host.id === ship.door && flagOn(h2, 'dock', ship.door);
})());
check('the shipment flag lands on the shipment\'s Witness page', (function () {
  var x = f2.filter(function (f) { return f.place === 'shipment'; })[0];
  var rt = P.parseRoute(x.href.replace(/^#\//, ''));
  return rt.place === 'shipment' && rt.id === 'IN-1002' && P.model(s2, rt.place, rt.id).subject.title === 'Shipment IN-1002';
})());
check('every flag on the map is a distinct item (no doubles)', (function () { var m = marks(h2); return m.length === f2.length && m.every(function (x, i) { return m.indexOf(x) === i; }); })());

/* A human decides: the findings close, the hold is released → those flags go. */
s2.wms.osd.forEach(function (f) { if (f.status === 'open') W.resolveOsd(s2, f.id, 'u-sam', 'carrier credit agreed'); });
check('all findings closed → the shipment flag is gone', !M.flags(s2, W).some(function (f) { return f.place === 'shipment'; }) && !flagOn(M.html(s2, W), 'dock', ship.door));
W.release(s2, { stagingId: dmg.id }, 'u-sam');
W.refresh(s2);
check('hold released → the pallet flag is gone', !flagOn(M.html(s2, W), 'pallet', dmg.id) && hrefs(M.flags(s2, W)).join() === '#/flags,#/witness/bin/A-05');

/* ---------- 5. a worker's flag (can't verify) → its task, where it works ---------- */
var pa = E.taskById(s2, 't-putaway-' + dmg.id);
var fr = W.flag(s2, { unitId: 'u-rosa', words: 'the wrap on this one is torn and a case is leaking', label: 'Leaking case', taskId: pa.id, source: 'voice' });
var f5 = M.flags(s2, W), h5 = M.html(s2, W);
var tf = f5.filter(function (f) { return f.place === 'task'; })[0];
check('an open worker flag marks its task', fr.ok && !!tf && tf.id === pa.id && tf.href === '#/witness/task/' + encodeURIComponent(pa.id));
check('…placed on the pallet that task moves', tf.host.place === 'pallet' && tf.host.id === dmg.id && flagOn(h5, 'pallet', dmg.id));
check('the task flag lands on the task\'s Witness page', P.model(s2, 'task', pa.id).subject.found);
W.closeFlag(s2, fr.flag.id, 'u-sam', 'rewrapped');
check('the worker flag closed → its mark is gone', !M.flags(s2, W).some(function (f) { return f.place === 'task'; }));

var s6 = W.seed();
var pick = E.taskById(s6, 't-pick-ORD-501-B-04');
W.flag(s6, { unitId: 'u-rosa', words: 'the label on this face does not match', label: 'Label mismatch', taskId: pick.id });
check('a flag on a pick task sits on the bin it picks from', (function () {
  var x = M.flags(s6, W).filter(function (f) { return f.place === 'task'; })[0];
  return !!x && x.host.place === 'bin' && x.host.id === 'B-04' && flagOn(M.html(s6, W), 'bin', 'B-04');
})());
check('a bin with nothing urgent next to it stays clean (B-02)', !flagOn(M.html(s6, W), 'bin', 'B-02'));

/* ---------- 6. never dropped, never invented ---------- */
check('a held pallet the walls cannot place is still flagged, under the map', (function () {
  var s7 = W.seed(); s7.staging[0].door = 'Door 9'; s7.staging[0].hold = { by: 'u-sam', reason: 'x', ts: '' };
  var x = M.flags(s7, W).filter(function (f) { return f.place === 'pallet'; })[0];
  var y = M.html(s7, W);
  return !!x && x.host === null && /class="wm-loose"[^]*wm-flags-loose[^]*#\/witness\/pallet\/STG-1/.test(y);
})());
check('a worker flag with no task lands on the Flags page, marked in its zone', (function () {
  var s8 = W.seed(); s8.wms.flags.push({ id: 'FLG-009', label: 'Spill', words: 'oil by the door', by: 'u-rosa', taskId: null, zone: 'B', ts: '', status: 'open' });
  var x = M.flags(s8, W).filter(function (f) { return f.href === '#/flags'; })[0];
  return !!x && /Flag FLG-009 awaiting a decision/.test(x.why) && x.host.place === 'zone' && x.host.id === 'B' && /<h3>Zone B<span class="wm-flags">/.test(M.html(s8, W));
})());
check('state text in a flag\'s name is escaped', (function () {
  var s9 = W.seed(); s9.bins[0].id = '<b>x'; s9.bins[0].status = 'hold';
  var y = M.html(s9, W); return y.indexOf('<b>x') === -1 && y.indexOf('href="#/witness/bin/%3Cb%3Ex"') !== -1;
})());
check('task slices carry no flags (flags are the map home\'s voice)', count(M.sliceHtml(s, W, 'in'), /wm-flag/g) === 0 && count(M.sliceHtml(s, W, 'out'), /wm-flag/g) === 0);

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
