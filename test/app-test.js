/* app-test.js — the Witness desk application (js/witness-app.js):
   the client configuration is a registered ontology shape, the
   host key is masked and never reaches the digest, the config
   transforms round-trip, the home tiles read the real adapter
   profile, and the settle step rides the ontology's single
   writer — a described concept settles, a detected one refuses. */
'use strict';
var W = require('../js/wms.js');
var O = require('../js/ontology.js');
var A = require('../js/adapter.js');
var App = require('../js/witness-app.js');

var fails = 0, total = 0;
function check(name, cond) {
  total++;
  if (cond) console.log('PASS  ' + name);
  else { fails++; console.log('FAIL  ' + name); }
}

var AT = '2026-11-06T10:00:00.000Z';

/* ---------- registration ---------- */
var s0 = W.seed();
App.applyHostKey(s0, 'host-key-abcdef1234', AT);
App.withSiteName(s0, 'DC-01 · Witness Demo Warehouse');
var unknowns = O.detectUnknowns(s0).map(function (u) { return u.key; });
check('registration: a state carrying clientConfig raises no unknown for it',
  unknowns.indexOf('clientConfig') === -1);

/* ---------- the key: masked, stored, never in the digest ---------- */
check('key: applyHostKey stores the value with its last four',
  App.configOf(s0).hostKey.value === 'host-key-abcdef1234' && App.configOf(s0).hostKey.lastFour === '1234');
check('key: the mask shows bullets + the last four and nothing else',
  App.maskOf(App.configOf(s0).hostKey) === '••••••••1234');
var digestJson = JSON.stringify(O.buildDigest(s0));
check('key: the digest contains neither the key nor its stored form',
  digestJson.indexOf('host-key-abcdef1234') === -1 && digestJson.indexOf('hostKey') === -1);
check('key: an empty key is refused, nothing saved',
  App.applyHostKey(W.seed(), '   ', AT).ok === false);
var s1 = W.seed();
App.applyHostKey(s1, 'first-key-0001', AT);
App.applyHostKey(s1, 'second-key-9999', AT);
check('key: replace overwrites — the mask follows the new key',
  App.maskOf(App.configOf(s1).hostKey) === '••••••••9999');
App.removeHostKey(s1);
check('key: remove clears it — no mask, no key',
  App.configOf(s1).hostKey === undefined && App.maskOf(App.configOf(s1).hostKey) === null);

/* ---------- the site name ---------- */
check('site: the name applies and reads back',
  App.siteNameOf(s0) === 'DC-01 · Witness Demo Warehouse');
check('site: an unset name falls back to Witness',
  App.siteNameOf(W.seed()) === 'Witness');
var s2 = W.seed();
App.withSiteName(s2, '  Named Site  ');
App.withSiteName(s2, '   ');
check('site: a blank save clears the name back to the fallback',
  App.siteNameOf(s2) === 'Witness');

/* ---------- home tiles ---------- */
var tiles = App.homeTiles(W.seed(), A.current().profile);
check('tiles: the connection is the live adapter profile (the demo WMS, sync)',
  tiles.connection.id === 'dummy-wms' && tiles.connection.hostLabel === 'the demo WMS' &&
  tiles.connection.transport === 'sync' && tiles.connection.verbs.length === 4);
check('tiles: the seed building has open tasks and none sent',
  tiles.openTasks > 0 && tiles.sentPending === 0 && tiles.awaitingConcepts === 0);
var s3 = W.seed();
s3.sentActs = [{ key: 'k1', status: 'sent' }, { key: 'k2', status: 'landed' }];
check('tiles: a SENT act counts as waiting on the host; a landed one does not',
  App.homeTiles(s3, A.current().profile).sentPending === 1);

/* ---------- the settle step ---------- */
var s4 = W.seed();
var step1 = O.learnConcept(s4, { key: 'widget-crates', kind: 'section', status: 'detected', name: 'Widget crates', at: AT });
var step2 = O.learnConcept(step1, { key: 'widget-crates', status: 'described', name: 'Widget crates', summary: 'Crates the host tracks that the floor calls widgets.', at: AT });
var refused = App.settleStep('widget-crates', 'Sam', 'edited', AT)(JSON.parse(JSON.stringify(step1)));
check('settle: a DETECTED concept refuses — the ladder demands a description first',
  refused.ok === false);
var draft = JSON.parse(JSON.stringify(step2));
var settled = App.settleStep('widget-crates', 'Sam', 'Crates the host tracks that the floor calls widgets.', AT)(draft);
var after = O.conceptsOf(draft).filter(function (c) { return c.key === 'widget-crates'; })[0];
check('settle: a DESCRIBED concept settles through the step, signed by the settler',
  settled.ok === true && after.status === 'settled' && after.settledBy === 'Sam');
var view = App.ontologyView(draft);
check('settle: the ontology view moves it from awaiting to settled',
  view.awaiting.length === 0 && view.settled.length === 1);
var noname = App.settleStep('widget-crates', '', 'x', AT)(JSON.parse(JSON.stringify(step2)));
check('settle: no name, no settle — a settle is a human’s act',
  noname.ok === false);

console.log('---');
console.log(total + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
