/* wms-flow-test.js — node, no dependencies.
   Console Task 5: flow-sliced task views (js/wms-map.js slice /
   sliceHtml, used by the task views in js/wms-ui.js). A task view
   shows only the slice its freight moves through, top to bottom:
   inbound  Inbound Docks → Receiving Bay → Bay Locations;
   outbound Bay Locations → Staging → Outbound Docks.
   Driven by the real seed world — nothing invented, nothing saved.
   Run: node test/wms-flow-test.js   (exit 0 = all pass) */
'use strict';

var fs = require('fs');
var path = require('path');
var W = require('../js/wms.js');
var M = require('../js/wms-map.js');

var failures = 0, passes = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (cond) passes++; else failures++; }
function count(html, re) { return (html.match(re) || []).length; }
function stageAt(html, key) { return html.indexOf('data-stage="' + key + '"'); }
function binIds(sl) { var ids = []; sl.stages.forEach(function (st) { (st.zones || []).forEach(function (z) { z.bins.forEach(function (b) { ids.push(b.id); }); }); }); return ids.sort(); }

var s = W.seed();
var before = JSON.stringify(s);
var inS = M.slice(s, W, 'in'), outS = M.slice(s, W, 'out');
var inH = M.sliceHtml(s, W, 'in', { docks: '<p id="A-docks"></p>', rcv: '<p id="A-rcv"></p>', bays: '<p id="A-bays"></p>' });
var outH = M.sliceHtml(s, W, 'out', { bays: '<p id="B-bays"></p>', stg: '<p id="B-stg"></p>', docks: '<p id="B-docks"></p>' });

/* 1. flow order: freight runs DOWN the screen */
check('inbound stages in flow order: docks → receiving → bays', inS.stages.map(function (x) { return x.key; }).join() === 'docks,rcv,bays');
check('outbound stages in flow order: bays → staging → docks', outS.stages.map(function (x) { return x.key; }).join() === 'bays,stg,docks');
check('inbound HTML: Inbound Docks on top, Receiving Bay below, Bay Locations last',
  stageAt(inH, 'docks') > -1 && stageAt(inH, 'docks') < stageAt(inH, 'rcv') && stageAt(inH, 'rcv') < stageAt(inH, 'bays'));
check('outbound HTML: Bay Locations on top, Staging below, Outbound Docks at the bottom',
  stageAt(outH, 'bays') > -1 && stageAt(outH, 'bays') < stageAt(outH, 'stg') && stageAt(outH, 'stg') < stageAt(outH, 'docks'));
check('stage labels read in flow order', inH.indexOf('>Inbound Docks<') < inH.indexOf('>Receiving Bay<') && inH.indexOf('>Receiving Bay<') < inH.indexOf('>Bay Locations<') &&
  outH.indexOf('>Bay Locations<') < outH.indexOf('>Staging<') && outH.indexOf('>Staging<') < outH.indexOf('>Outbound Docks<'));
check('a flow arrow between stages, never after the last', count(inH, /class="wf-arrow"/g) === 2 && count(outH, /class="wf-arrow"/g) === 2 &&
  inH.lastIndexOf('wf-arrow') < stageAt(inH, 'bays') && outH.lastIndexOf('wf-arrow') < stageAt(outH, 'docks'));
check('the arrow says the verb: unload and check, put away / pick, pack and stage, load',
  /↓ unload and check/.test(inH) && /↓ put away/.test(inH) && /↓ pick, pack and stage/.test(outH) && /↓ load</.test(outH));
check('the flow names its direction for screen readers', /data-flow="in"[^>]*aria-label="Inbound flow, top to bottom: Inbound Docks, then Receiving Bay, then Bay Locations"/.test(inH) &&
  /data-flow="out"[^>]*aria-label="Outbound flow, top to bottom: Bay Locations, then Staging, then Outbound Docks"/.test(outH));

/* 2. a slice, never the whole building */
check('inbound slice: four inbound docks, no outbound dock, no Staging band', count(inH, /data-place="dock" data-side="in"/g) === 4 &&
  count(inH, /data-side="out"/g) === 0 && inH.indexOf('>Staging<') === -1 && count(inH, /data-place="staging"/g) === 0);
check('outbound slice: four outbound docks, no inbound dock, no Receiving Bay', count(outH, /data-place="dock" data-side="out"/g) === 4 &&
  count(outH, /data-side="in"/g) === 0 && outH.indexOf('>Receiving Bay<') === -1 && count(outH, /data-place="receiving"/g) === 0);
check('the full map is not inside a slice', inH.indexOf('class="wmap"') === -1 && outH.indexOf('class="wmap"') === -1);

/* 3. places come from state */
check('Inbound Dock N over its own receiving lane (same column)', inS.stages[0].docks.every(function (d, i) { return inS.stages[1].lanes[i].doorId === d.doorId; }));
check('pallets sit in the lane of their own inbound door', inS.stages[1].lanes.every(function (l) {
  return l.items.length === s.staging.filter(function (p) { return p.door === l.doorId; }).length; }) && count(inH, /data-place="pallet"/g) === s.staging.length);
check('the trailer at Inbound Door 1 shows Unloading IN-1001', inS.stages[0].docks[0].word === 'Unloading' && inS.stages[0].docks[0].ref === 'IN-1001');
check('Outbound Dock 4 (the loading door) reads Loading', outS.stages[2].docks[3].word === 'Loading');
check('nothing staged to ship yet → staging lanes are empty, not invented', count(outH, /data-place="order"/g) === 0);

/* 4. bins: only those with a reason to be there */
check('inbound bays: putaway destinations + held bin only (A-03, A-05, C-03)', binIds(inS).join() === 'A-03,A-05,C-03');
check('outbound bays: pick sources + held bin only', binIds(outS).join() === 'A-05,A-08,B-02,B-04,C-02,C-08');
check('each bin says why it is there', /data-id="A-03"[^>]*>.*?<small>Put away here<\/small>/.test(inH) && /data-id="B-04"[^>]*>.*?<small>Pick from here<\/small>/.test(outH) &&
  /data-id="A-05"[^>]*>.*?<small>On hold<\/small>/.test(inH));
check('a zone with no reason bin is left out (inbound has no Zone B)', inS.stages[2].zones.map(function (z) { return z.zone; }).join() === 'A,C');
var quiet = W.seed(); quiet.tasks = quiet.tasks.filter(function (t) { return t.type !== 'putaway'; }); quiet.bins.forEach(function (b) { if (b.status === 'hold') b.status = 'ok'; });
check('no reason → says so plainly, draws no bin', /No bin has a reason to be here right now/.test(M.sliceHtml(quiet, W, 'in')) && count(M.sliceHtml(quiet, W, 'in'), /data-place="bin"/g) === 0);
var doneOne = W.seed(); doneOne.tasks.forEach(function (t) { if (t.id === 't-putaway-STG-4') t.status = 'done'; });
check('a done putaway no longer gives its bin a reason', binIds(M.slice(doneOne, W, 'in')).indexOf('C-03') === -1);

/* 5. the page's own panels ride under the stage they concern */
function inside(h, mark, key, nextKey) { var i = h.indexOf(mark); return i > stageAt(h, key) && (nextKey ? i < stageAt(h, nextKey) : true); }
check('inbound anchors sit under their own stage', inside(inH, 'A-docks', 'docks', 'rcv') && inside(inH, 'A-rcv', 'rcv', 'bays') && inside(inH, 'A-bays', 'bays'));
check('outbound anchors sit under their own stage', inside(outH, 'B-bays', 'bays', 'stg') && inside(outH, 'B-stg', 'stg', 'docks') && inside(outH, 'B-docks', 'docks'));
check('panels sit outside the map strip (keep console colours)', /<\/div><div class="wf-panels"><p id="A-docks">/.test(inH));
check('no anchor → no empty panel box', M.sliceHtml(s, W, 'in').indexOf('wf-panels') === -1);

/* 6. state moves → the slice moves */
var s2 = W.seed();
var o = W.allOrders(s2)[0];
o.status = 'staged at door'; o.door = 'Outbound Door 3'; o.packed = { tracking: 'X' };
var o2 = M.slice(s2, W, 'out');
check('a staged order sits in the staging lane over its own outbound door', o2.stages[1].lanes[2].items.length === 1 && o2.stages[1].lanes[2].items[0].id === o.id &&
  o2.stages[2].docks[2].doorId === 'Outbound Door 3');
var s3 = W.seed(); s3.staging[0].door = 'Outbound Door 1';
check('a pallet at no inbound door is listed, never dropped', /Not on a wall — Pallets not at an inbound door: /.test(M.sliceHtml(s3, W, 'in')) &&
  M.sliceHtml(s3, W, 'out').indexOf('Pallets not at an inbound door') === -1);

check('slice items do not pose as Witness-page links (map home only)', inH.indexOf('data-open') === -1 && outH.indexOf('data-open') === -1);

/* 7. safety */
check('slicing never changes state', JSON.stringify(s) === before);
var threw = false; try { M.slice(s, W, 'sideways'); } catch (e) { threw = true; }
check('an unknown direction is refused', threw);

/* 8. the console's task views use the slice, in the right direction */
var ui = fs.readFileSync(path.join(__dirname, '..', 'js', 'wms-ui.js'), 'utf8');
function viewBody(name) { var i = ui.indexOf('VIEWS.' + name + ' = function'); return ui.slice(i, ui.indexOf('\n  };', i)); }
function fnBody(name) { var i = ui.indexOf('function ' + name + '('); return ui.slice(i, ui.indexOf('\n  }', i)); }
check('inbound task views (receiving, osd, putaway) render the inbound flow', ['receiving', 'osd', 'putaway'].every(function (v) { return /flow\('in',/.test(viewBody(v)) && !/flow\('out',/.test(viewBody(v)); }));
check('outbound task views (picking, ship) render the outbound flow', ['picking', 'ship'].every(function (v) { return /flow\('out',/.test(viewBody(v)) && !/flow\('in',/.test(viewBody(v)); }));
check('the home stays the whole building (not a slice)', /WitnessWmsMap\.html\(/.test(viewBody('dashboard')) && !/flow\(/.test(viewBody('dashboard')));
check('the existing task actions are still in the task views', ['data-act="checkin"', 'data-act="schedule"', 'data-act="rcv-open"', 'data-act="rcv-post"', 'data-act="osd-close"',
  'data-act="pa-confirm"', 'data-act="release"', 'data-act="pick"', 'data-act="pack"', 'data-act="load"', 'data-act="close-load"'].every(function (a) {
  return ['receiving', 'osd', 'putaway', 'picking', 'ship'].some(function (v) { return viewBody(v).indexOf(a) !== -1; }) || fnBody('appointmentPanels').indexOf(a) !== -1; }));
/* design 2026-11-03: Dock & Yard merged into Receiving; Putaway starts at the Receiving Bay */
check('Receiving carries the door appointments (Dock & Yard merged in)', /appointmentPanels\(\)/.test(viewBody('receiving')) && ui.indexOf('VIEWS.dock = function') === -1);
check('Putaway leaves the inbound docks strip out', /flow\('in', bands, \['docks'\]\)/.test(viewBody('putaway')));
var sk = M.sliceHtml(s, W, 'in', {}, ['docks']);
check('a skipped stage is not drawn, and its arrow goes with it', sk.indexOf('data-stage="docks"') === -1 && sk.indexOf('data-stage="rcv"') !== -1 && (sk.match(/wf-arrow/g) || []).length === 1);
check('wms.html loads the flow styles', fs.readFileSync(path.join(__dirname, '..', 'wms.html'), 'utf8').indexOf('css/wms-flow.css') !== -1);

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
