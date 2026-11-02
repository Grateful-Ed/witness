/* wms-map-test.js — node, no dependencies.
   The warehouse map (js/wms-map.js), the desk console's home, against
   the real seed world: the building from William's sketch (Inbound
   Docks 1–4, Outbound Docks 1–4, the pink Receiving Bay and Staging
   bands, the yellow bay block with every zone and bin), driven only
   by state — nothing invented, nothing saved, no tables on the map.
   Run: node test/wms-map-test.js   (exit 0 = all pass) */
'use strict';

var E = require('../js/engine.js');
var W = require('../js/wms.js');
var M = require('../js/wms-map.js');

var failures = 0, passes = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (cond) passes++; else failures++; }
function count(html, re) { return (html.match(re) || []).length; }

var s = W.seed();
var before = JSON.stringify(s);
var m = M.model(s, W);
var h = M.html(s, W);

/* 1. the building */
check('four dock rows, one per door', m.rows.length === 4);
check('Inbound Docks 1–4 named on the inbound wall', [1, 2, 3, 4].every(function (n) { return h.indexOf('>Inbound Dock ' + n + '<') !== -1; }) &&
  count(h, /data-place="dock" data-side="in"/g) === 4);
check('Outbound Docks 1–4 named on the outbound wall', [1, 2, 3, 4].every(function (n) { return h.indexOf('>Outbound Dock ' + n + '<') !== -1; }) &&
  count(h, /data-place="dock" data-side="out"/g) === 4);
check('each dock names the door it reads from', m.rows.every(function (r, i) { return r.doorId === 'Door ' + (i + 1); }));
check('inbound side: Receiving Bay band (pink)', /class="wm-band wm-col-rcv"[^>]*><span class="wm-band-label">Receiving Bay</.test(h));
check('outbound side: Staging band (pink)', /class="wm-band wm-col-stg"[^>]*><span class="wm-band-label">Staging</.test(h));
check('centre: Bay Locations block (yellow)', h.indexOf('>Bay Locations<') !== -1 && h.indexOf('class="wm-bays"') !== -1);
check('band order on the floor: inbound, receiving, bays, staging, outbound', (function () {
  var a = h.indexOf('wm-wall-label wm-col-in'), b = h.indexOf('wm-col-rcv'), c = h.indexOf('wm-bays-head'), d = h.indexOf('wm-col-stg'), e = h.indexOf('wm-wall-label wm-col-out');
  return a !== -1 && a < e && b < d && b < c && c > 0;
})());

/* 2. places come from state */
check('every zone in state is a place in the bay block', s.zones.every(function (z) { return h.indexOf('data-place="zone" data-id="' + z + '"') !== -1; }) &&
  count(h, /data-place="zone"/g) === s.zones.length);
check('every bin in state is a place, in its own zone', count(h, /data-place="bin"/g) === s.bins.length &&
  m.zones.every(function (z) { return z.bins.every(function (b) { return E.binById(s, b.id).zone === z.zone; }); }));
check('a stocked bin reads stocked; an empty bin reads empty', m.zones[0].bins[0].stocked === true && m.zones[0].bins[2].stocked === false);
check('a held bin is marked held (A-05)', /class="wm-bin stocked held" data-place="bin" data-id="A-05"/.test(h));
check('pallets in the Receiving Bay sit at their own door', m.rows[0].receiving.length === s.staging.filter(function (p) { return p.door === 'Door 1'; }).length &&
  m.rows[1].receiving.length === s.staging.filter(function (p) { return p.door === 'Door 2'; }).length &&
  count(h, /data-place="pallet"/g) === s.staging.length);
check('the trailer at Door 1 shows on Inbound Dock 1, unloading', m.rows[0].inbound.ref === 'IN-1001' && m.rows[0].inbound.word === 'Unloading');
check('Door 4 (the loading door) reads Loading on Outbound Dock 4', m.rows[3].outbound.word === 'Loading');
check('a door with nothing on a side says Clear (never invented)', m.rows[2].inbound.word === 'Clear' && m.rows[2].outbound.word === 'Clear' &&
  m.rows[2].receiving.length === 0 && m.rows[2].staging.length === 0);
check('nothing staged to ship yet → the Staging band is empty', count(h, /data-place="order"/g) === 0);

/* 3. state moves → the map moves */
var s2 = W.seed();
var o = W.allOrders(s2)[0];
o.status = 'staged at door'; o.door = 'Door 4'; o.packed = { tracking: 'X' };
s2.wms.loads.push({ id: 'LD-001', door: 'Door 4', trailer: 'TR-9', orderIds: [o.id], status: 'loading' });
s2.doors[3].loadId = 'LD-001';
s2.bins[0].status = 'hold';
var m2 = M.model(s2, W), h2 = M.html(s2, W);
check('an order staged at Door 4 shows in the Staging band at Outbound Dock 4', m2.rows[3].staging.length === 1 && m2.rows[3].staging[0].id === o.id &&
  h2.indexOf('data-place="order" data-id="' + o.id + '"') !== -1);
check('the load at Door 4 is named on Outbound Dock 4', m2.rows[3].outbound.ref === 'LD-001');
check('a bin put on hold shows held', /data-id="A-01"/.test(h2) && m2.zones[0].bins[0].held === true);

/* 4. map law */
check('no data tables on the map', !/<table|<tr|<td|<th/.test(h) && !/<table/.test(h2));
check('no buttons or forms on the map (read-only)', !/<button|<input|<select|<form|data-act=/.test(h));
check('rendering the map changes nothing in state', JSON.stringify(s) === before);
check('state text is escaped', (function () {
  var s3 = W.seed(); s3.bins[0].id = '<b>x'; s3.staging[0].desc = '"><script>';
  var x = M.html(s3, W); return x.indexOf('<b>x') === -1 && x.indexOf('<script>') === -1 && x.indexOf('&lt;b&gt;x') !== -1;
})());
check('a building with no doors yet still has its two walls of four docks, all Clear', (function () {
  var s4 = W.seed(); s4.doors = []; s4.staging = [];
  var x = M.model(s4, W);
  return x.rows.length === 4 && x.rows.every(function (r) { return r.inbound.word === 'Clear' && r.outbound.word === 'Clear' && !r.receiving.length; });
})());
check('a fifth door is not dropped — it gets its own row', (function () {
  var s5 = W.seed(); s5.doors.push({ id: 'Door 5', zone: 'C', state: 'empty', shipmentId: null });
  return M.model(s5, W).rows.length === 5 && M.model(s5, W).rows[4].doorId === 'Door 5';
})());

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
