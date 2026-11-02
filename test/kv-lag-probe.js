/* kv-lag-probe.js — measures how long a POST /state takes to show up
   on GET /state, against the LIVE Worker. Not part of the test suites.

   It touches real data, so it is careful:
   - It needs a state document to exist already (open warehouse.html
     once after the state move lands). With none, it stops.
   - It writes the SAME document back with one extra field, "__probe",
     polls until that field is visible, then writes the original back.

   Run: node test/kv-lag-probe.js [workerBase]
   Default base: https://witness.e-william-harris96.workers.dev */
'use strict';

var BASE = process.argv[2] || 'https://witness.e-william-harris96.workers.dev';
var HEADERS = { 'Origin': 'https://grateful-ed.github.io', 'Content-Type': 'application/json' };
var POLL_MS = 100, GIVE_UP_MS = 120000;

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

(async function () {
  var r = await fetch(BASE + '/state', { headers: HEADERS });
  if (r.status === 404) { console.log('No state document yet. Open warehouse.html once, then run this again.'); process.exit(2); }
  if (!r.ok) { console.log('GET /state answered HTTP ' + r.status + '. Is the Worker change deployed?'); process.exit(2); }
  var original = await r.text();
  var doc = JSON.parse(original);
  var marker = 'probe-' + Date.now();
  doc.__probe = marker;

  var t0 = Date.now();
  r = await fetch(BASE + '/state', { method: 'POST', headers: HEADERS, body: JSON.stringify(doc) });
  if (!r.ok) { console.log('POST /state answered HTTP ' + r.status); process.exit(2); }
  var posted = Date.now();

  var seenAt = null, polls = 0;
  while (Date.now() - posted < GIVE_UP_MS) {
    polls++;
    var g = await fetch(BASE + '/state', { headers: HEADERS, cache: 'no-store' });
    var got = await g.json().catch(function () { return null; });
    if (got && got.__probe === marker) { seenAt = Date.now(); break; }
    await wait(POLL_MS);
  }

  await fetch(BASE + '/state', { method: 'POST', headers: HEADERS, body: original });

  if (seenAt == null) console.log('Not visible after ' + GIVE_UP_MS + ' ms (' + polls + ' polls). Original written back.');
  else console.log('KV lag: ' + (seenAt - posted) + ' ms after the POST answered (' + (seenAt - t0) + ' ms from send), ' + polls + ' polls. Original written back.');
})().catch(function (e) { console.error(e); process.exit(1); });
