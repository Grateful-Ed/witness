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

/* 1. the building: eight doors, two walls, straight from state */
check('state has eight doors: four in, four out', s.doors.length === 8 &&
  s.doors.filter(function (d) { return d.direction === 'in'; }).length === 4 && s.doors.filter(function (d) { return d.direction === 'out'; }).length === 4);
check('four dock rows', m.rows === 4);
check('Inbound Docks 1–4 named on the inbound wall', [1, 2, 3, 4].every(function (n) { return h.indexOf('>Inbound Dock ' + n + '<') !== -1; }) &&
  count(h, /data-place="dock" data-side="in"/g) === 4);
check('Outbound Docks 1–4 named on the outbound wall', [1, 2, 3, 4].every(function (n) { return h.indexOf('>Outbound Dock ' + n + '<') !== -1; }) &&
  count(h, /data-place="dock" data-side="out"/g) === 4);
check('Inbound Dock N is Inbound Door N; Outbound Dock N is Outbound Door N', m.inbound.every(function (d, i) { return d.doorId === 'Inbound Door ' + (i + 1); }) &&
  m.outbound.every(function (d, i) { return d.doorId === 'Outbound Door ' + (i + 1); }));
check('no door is two docks (eight distinct places)', (function () {
  var ids = m.inbound.concat(m.outbound).map(function (d) { return d.doorId; });
  return ids.filter(function (x, i) { return ids.indexOf(x) === i; }).length === 8;
})());
check('no "Door N" sublabel on a dock', !/class="wm-door"/.test(h));
check('inbound side: Receiving Bay band (pink)', /class="wm-band wm-col-rcv"[^>]*><span class="wm-band-label">Receiving Bay</.test(h));
check('outbound side: Staging band (pink)', /class="wm-band wm-col-stg"[^>]*><span class="wm-band-label">Staging</.test(h));
check('centre: Bay Locations block (yellow)', h.indexOf('>Bay Locations<') !== -1 && h.indexOf('class="wm-bays"') !== -1);

/* 2. places come from state */
check('every zone in state is a place in the bay block', s.zones.every(function (z) { return h.indexOf('data-place="zone" data-id="' + z + '"') !== -1; }) &&
  count(h, /data-place="zone"/g) === s.zones.length);
check('every bin in state is a place, in its own zone', count(h, /data-place="bin"/g) === s.bins.length &&
  m.zones.every(function (z) { return z.bins.every(function (b) { return E.binById(s, b.id).zone === z.zone; }); }));
check('a stocked bin reads stocked; an empty bin reads empty', m.zones[0].bins[0].stocked === true && m.zones[0].bins[2].stocked === false);
check('a held bin is marked held (A-05)', /class="wm-bin stocked held" data-place="bin" data-id="A-05"/.test(h));
check('pallets in the Receiving Bay sit at their own inbound door', m.inbound.every(function (d) {
  return d.lane.length === s.staging.filter(function (p) { return p.door === d.doorId; }).length; }) && count(h, /data-place="pallet"/g) === s.staging.length);
check('the trailer at Inbound Door 1 shows on Inbound Dock 1, unloading', m.inbound[0].ref === 'IN-1001' && m.inbound[0].word === 'Unloading');
check('Outbound Door 4 (the loading door) reads Loading on Outbound Dock 4', m.outbound[3].word === 'Loading');
check('a door with nothing at it says Clear (never invented)', m.inbound[2].word === 'Clear' && !m.inbound[2].lane.length && m.outbound[0].word === 'Clear' && !m.outbound[0].lane.length);
check('nothing staged to ship yet → the Staging band is empty', count(h, /data-place="order"/g) === 0);
check('the seed world places everything (nothing "not on a wall")', h.indexOf('wm-loose') === -1);

/* 3. state moves → the map moves */
var s2 = W.seed();
var o = W.allOrders(s2)[0];
o.status = 'staged at door'; o.door = 'Outbound Door 4'; o.packed = { tracking: 'X' };
s2.wms.loads.push({ id: 'LD-001', door: 'Outbound Door 4', trailer: 'TR-9', orderIds: [o.id], status: 'loading' });
s2.doors.filter(function (d) { return d.id === 'Outbound Door 4'; })[0].loadId = 'LD-001';
s2.bins[0].status = 'hold';
var m2 = M.model(s2, W), h2 = M.html(s2, W);
check('an order staged at Outbound Door 4 shows in the Staging band at Outbound Dock 4', m2.outbound[3].lane.length === 1 && m2.outbound[3].lane[0].id === o.id &&
  h2.indexOf('data-place="order" data-id="' + o.id + '"') !== -1);
check('the load at Outbound Door 4 is named on Outbound Dock 4', m2.outbound[3].ref === 'LD-001');
check('a bin put on hold shows held', /data-id="A-01"/.test(h2) && m2.zones[0].bins[0].held === true);

/* 4. map law */
check('no data tables on the map', !/<table|<tr|<td|<th/.test(h) && !/<table/.test(h2));
check('no buttons or forms on the map (read-only)', !/<button|<input|<select|<form|data-act=/.test(h));
check('rendering the map changes nothing in state', JSON.stringify(s) === before);
check('state text is escaped', (function () {
  var s3 = W.seed(); s3.bins[0].id = '<b>x'; s3.staging[0].desc = '"><script>';
  var x = M.html(s3, W); return x.indexOf('<b>x') === -1 && x.indexOf('<script>') === -1 && x.indexOf('&lt;b&gt;x') !== -1;
})());
check('a building with no doors yet still has its two walls of four rows, nothing invented', (function () {
  var s4 = W.seed(); s4.doors = []; s4.staging = [];
  var x = M.model(s4, W), y = M.html(s4, W);
  return x.rows === 4 && !x.inbound.length && !x.outbound.length && count(y, /data-place="dock"/g) === 0;
})());
check('a door with no direction (an old 4-door save) is listed "not on a wall", not dropped', (function () {
  var s5 = W.seed(); s5.doors.push({ id: 'Door 1', zone: 'A', state: 'empty', shipmentId: null });
  var y = M.html(s5, W); return /class="wm-loose"/.test(y) && y.indexOf('Doors with no wall: Door 1') !== -1;
})());
check('a pallet at a door that is not on the inbound wall is listed, not dropped', (function () {
  var s6 = W.seed(); s6.staging[0].door = 'Outbound Door 2';
  var y = M.html(s6, W); return y.indexOf('Pallets not at an inbound door: STG-1 at Outbound Door 2') !== -1;
})());

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
