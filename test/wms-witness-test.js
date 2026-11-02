/* wms-witness-test.js — node, no dependencies.
   The Witness page (js/wms-witness.js): an item's record, opened from
   the warehouse map. Played against the real WMS layer: a truck
   arrives and is received by voice with damage, the damaged pallet
   is held, two different workers speak about it, a manager closes the
   finding and releases the hold, then it is put away. Proves:
   events derive ONLY from real records, in time order; the transcript
   is verbatim and holds many voices; empty items are empty-honest;
   every human act names the human; nothing is saved or changed.
   Run: node test/wms-witness-test.js   (exit 0 = all pass) */
'use strict';

var E = require('../js/engine.js');
var W = require('../js/wms.js');
var M = require('../js/wms-map.js');
var P = require('../js/wms-witness.js');

var failures = 0, passes = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (cond) passes++; else failures++; }
function verbs(list) { return list.map(function (e) { return e.verb; }); }
function ordered(list) {
  for (var i = 1; i < list.length; i++) if (Date.parse(list[i].ts) < Date.parse(list[i - 1].ts)) return false;
  return true;
}

/* One clock for the engine and the WMS layer, moving one minute per
   reading, so times are ordered and the same on both sides. */
var RealDate = Date, clock = RealDate.parse('2026-11-02T08:00:00Z');
global.Date = function FakeDate(a, b, c, d, e, f, g) {
  if (!arguments.length) { clock += 60000; return new RealDate(clock); }
  return arguments.length === 1 ? new RealDate(a) : new RealDate(a, b, c || 1, d || 0, e || 0, f || 0, g || 0);
};
global.Date.parse = RealDate.parse; global.Date.UTC = RealDate.UTC; global.Date.now = function () { return clock; };
global.Date.prototype = RealDate.prototype;
W.now = function () { return new Date().toISOString(); };

/* ---------- routes ---------- */
check('href → parseRoute round-trips an id with spaces', (function () {
  var h = P.href('dock', 'Inbound Door 3');
  var r = P.parseRoute(h.replace(/^#\//, ''));
  return h === '#/witness/dock/Inbound%20Door%203' && r && r.place === 'dock' && r.id === 'Inbound Door 3';
})());
check('parseRoute refuses an unknown place and a bare route', !P.parseRoute('witness/spaceship/X') && !P.parseRoute('dashboard') && !P.parseRoute('witness/bin/'));

/* ---------- the map: items open ---------- */
var s = W.seed();
var mh = M.html(s, W);
check('map: every dock, pallet, staged order and bin is openable (data-open, focusable)',
  /data-place="dock"[^>]*data-open tabindex="0" role="link"/.test(mh) && /data-place="pallet"[^>]*data-open/.test(mh) &&
  /data-place="bin"[^>]*data-open/.test(mh) &&
  (mh.match(/data-open/g) || []).length === (mh.match(/data-place="(dock|pallet|order|bin)"/g) || []).length);
check('map: zones, lanes and bands are not openable', !/data-place="(zone|receiving|staging|loose)"[^>]*data-open/.test(mh));

/* ---------- empty-honest: a seeded pallet nobody has touched ---------- */
var before = JSON.stringify(s);
var m0 = P.model(s, 'pallet', 'STG-1');
check('seed pallet STG-1 is found', m0.subject.found && m0.subject.title === 'Pallet STG-1');
check('seed pallet: no events (nothing invented)', m0.events.length === 0);
check('seed pallet: no transcript (nothing invented)', m0.transcript.length === 0);
var h0 = P.html(s, 'pallet', 'STG-1');
check('seed pallet page says so plainly', /Nothing on the record yet/.test(h0) && /Not said\./.test(h0));
check('page order: agent chair at the top, then events (left), then transcript (right)',
  h0.indexOf('data-slot="agent"') !== -1 && h0.indexOf('data-slot="agent"') < h0.indexOf('data-panel="events"') &&
  h0.indexOf('data-panel="events"') < h0.indexOf('data-panel="transcript"'));
check('the agent chair is reserved and labelled as coming', /The agent <span class="wp-soon">Coming next<\/span>/.test(h0) && !/<input|<textarea|<button/.test(h0));
check('an unknown item renders honestly, not a guess', /not in the desk record now/.test(P.html(s, 'pallet', 'STG-999')) && P.events(s, P.subject(s, 'pallet', 'STG-999')).length === 0);
var dockClear = P.model(s, 'dock', 'Inbound Door 4');
check('a clear dock is its own page, empty', dockClear.subject.found && dockClear.subject.kind === 'dock' && !dockClear.events.length && !dockClear.transcript.length);
check('reading pages changes nothing in state', JSON.stringify(s) === before);

/* ---------- a load's life, through many hands ---------- */
W.checkIn(s, 'APT-102', 'u-sam');
var dock = P.model(s, 'dock', 'Inbound Door 3');
var said = 'detergent four pallets, one sixteen cases, four crushed. towels all six pallets';
var r = W.receive(s, 'IN-1002', [
  { desc: 'Laundry detergent — cases', received: 116, damaged: 4, quote: 'one sixteen cases, four crushed' },
  { desc: 'Paper towels — cases', received: 120, damaged: 0, quote: 'towels all six pallets' }
], { by: 'u-tommy', transcript: said, source: 'voice' });
check('setup: IN-1002 received by voice with findings', r.ok && r.osd.length >= 2);

var dmg = s.staging.filter(function (p) { return p.shipmentId === 'IN-1002' && p.damaged; })[0];
var good = s.staging.filter(function (p) { return p.shipmentId === 'IN-1002' && !p.damaged && p.desc === 'Paper towels — cases'; })[0];
check('setup: a damaged pallet staged on hold', !!dmg && !!dmg.hold);

check('setup: held pallet has no putaway task yet', !E.taskById(s, 't-putaway-' + dmg.id));
/* A manager decides: closes the damage finding, releases the hold. */
var dmgOsd = s.wms.osd.filter(function (f) { return f.type === 'damage'; })[0];
W.resolveOsd(s, dmgOsd.id, 'u-sam', 'carrier credit agreed');
W.release(s, { stagingId: dmg.id }, 'u-sam');
W.refresh(s);
/* Two different workers speak about the damaged pallet's putaway. */
var pa = E.taskById(s, 't-putaway-' + dmg.id);
check('setup: released, the damaged pallet has a putaway task', !!pa);
W.flag(s, { unitId: 'u-rosa', words: 'the wrap on this one is torn and a case is leaking', label: 'Leaking case', taskId: pa.id, source: 'voice' });
E.addTaskUpdate(s, pa.id, 'Checked it again, two cases wet on the bottom layer.', 'u-marcus');

var m = P.model(s, 'pallet', dmg.id);
var v = verbs(m.events);
check('pallet events: arrived, flagged (2 OS&D + 1 worker), checked, decided, released, update',
  v.indexOf('Arrived') !== -1 && v.indexOf('Checked') !== -1 && v.filter(function (x) { return x === 'Flagged'; }).length === 3 &&
  v.indexOf('Update') !== -1 && v.indexOf('Decided') !== -1 && v.indexOf('Released') !== -1);
check('pallet events are in time order, oldest first', ordered(m.events) && m.events[0].verb === 'Arrived');
check('the hold placed by the receipt is told (Held, by the receiver, before Released)', (function () {
  var hi = v.indexOf('Held'), ri = v.indexOf('Released');
  return hi !== -1 && ri > hi && m.events[hi].by === 'u-tommy' && /staged on hold at receipt/.test(m.events[hi].text);
})());
check('a closed finding does not still read "open"', m.events.filter(function (e) { return e.ref === dmgOsd.id && e.verb === 'Flagged'; }).every(function (e) { return !/Still open/.test(e.text); }));
check('the flag is told once (its engine update is not repeated as a second event)',
  m.events.filter(function (e) { return /leaking/.test(e.text); }).length === 0 && m.events.filter(function (e) { return /Leaking case/.test(e.text); }).length === 1);
check('pallet events carry only its own item\'s findings (no paper-towel shortage noise)', m.events.every(function (e) { return !/Paper towels/.test(e.text) || e.verb !== 'Flagged'; }));
check('every event is a real record line, OS&D finding or flag — nothing else', m.events.every(function (e) {
  if (e.kind === 'osd' || e.kind === 'osd-closed') return s.wms.osd.some(function (f) { return f.id === e.ref; });
  if (e.kind === 'flag' || e.kind === 'flag-closed') return s.wms.flags.some(function (f) { return f.id === e.ref; });
  if (e.kind === 'receipt-hold') return s.wms.receipts.some(function (rc) { return rc.id === e.ref; });
  return s.records.some(function (rec) { return rec.text === e.text; });
}));
var decided = m.events.filter(function (e) { return e.decision; });
check('the human decisions name the human (Sam), never the machine', decided.length === 2 && decided.every(function (e) { return e.by === 'u-sam'; }));

var tr = m.transcript;
check('transcript: verbatim words of three people, in order', tr.length === 3 && ordered(tr) &&
  tr[0].words === said && tr[0].by === 'u-tommy' &&
  tr[1].words === 'the wrap on this one is torn and a case is leaking' && tr[1].by === 'u-rosa' && tr[1].source === 'voice' &&
  tr[2].words === 'Checked it again, two cases wet on the bottom layer.' && tr[2].by === 'u-marcus');
check('transcript counts voices (many hands)', m.voices.length === 3);

var h = P.html(s, 'pallet', dmg.id);
check('page shows the human\'s act: "Decided by Sam"', /Decided by <b>Sam/.test(h));
check('page shows each speaker by name and the exact words', /<b>Rosa[^<]*<\/b>/.test(h) && h.indexOf('the wrap on this one is torn and a case is leaking') !== -1);
check('page escapes words (no markup from speech)', (function () {
  var x = JSON.parse(JSON.stringify(s));
  E.addTaskUpdate(x, pa.id, '<img src=x onerror=alert(1)>', 'u-marcus');
  return P.html(x, 'pallet', dmg.id).indexOf('<img src=x') === -1;
})());

/* The sibling pallet shares the truck, not the damaged pallet's words. */
var mg = P.model(s, 'pallet', good.id);
check('a sibling pallet carries the truck\'s arrival and the spoken count', verbs(mg.events).indexOf('Arrived') !== -1 && mg.transcript.length === 1 && mg.transcript[0].words === said);
check('a sibling pallet does not carry the damaged pallet\'s flag or hold', !mg.events.some(function (e) { return /Leaking|released from hold/.test(e.text); }));

/* The dock opened while the truck was there, and the shipment now. */
check('a dock with a truck opens that shipment\'s page', dock.subject.kind === 'shipment' && dock.subject.via === 'Inbound Door 3' && dock.subject.id === 'IN-1002');
var ship = P.model(s, 'shipment', 'IN-1002');
check('shipment page holds every pallet\'s story and every voice', ship.transcript.length === 3 && ship.voices.length === 3 &&
  ship.events.filter(function (e) { return e.kind === 'osd'; }).length === s.wms.osd.filter(function (f) { return f.shipmentId === 'IN-1002'; }).length);

/* Put away: the pallet leaves the map; its page says so, not a guess. */
var pr = W.complete(s, pa.id, { by: 'u-marcus' });
check('setup: damaged pallet put away', pr.ok);
check('a pallet put away is no longer on the record as a pallet; the page says so', !P.subject(s, 'pallet', dmg.id).found && /may have moved on/.test(P.html(s, 'pallet', dmg.id)));
var bin = P.model(s, 'bin', pa.toBinId);
check('its bin now shows the putaway, the flag and both workers\' words', verbs(bin.events).indexOf('Put away') !== -1 &&
  bin.transcript.length === 2 && bin.transcript.some(function (x) { return x.by === 'u-rosa'; }) && bin.transcript.some(function (x) { return x.by === 'u-marcus'; }));

/* ---------- outbound: an order, a short pick said aloud ---------- */
var pick = E.taskById(s, 't-pick-ORD-503-B-02');
r = W.complete(s, pick.id, { by: 'u-tommy', qty: 4, words: 'only four left, the back two are crushed' });
check('setup: short pick with words', r.ok);
var om = P.model(s, 'order', 'ORD-503');
check('order page: the short pick is an event and its words are in the transcript',
  verbs(om.events).indexOf('Picked short') !== -1 && om.transcript.length === 1 && om.transcript[0].words === 'only four left, the back two are crushed' && om.transcript[0].by === 'u-tommy');
var b02 = P.model(s, 'bin', 'B-02');
check('bin B-02: the short pick and the count it queued', verbs(b02.events).indexOf('Picked short') !== -1 && verbs(b02.events).indexOf('Count queued') === -1);

/* ---------- holds on a bin: the human's act ---------- */
W.hold(s, { binId: 'C-08' }, 'u-sam', 'water on the floor under it');
var c08 = P.model(s, 'bin', 'C-08');
check('a held bin: the hold is a decision, by Sam, with his words in the event', c08.events.some(function (e) { return e.verb === 'Held' && e.decision && e.by === 'u-sam' && /water on the floor/.test(e.text); }));
check('a bin no one has spoken about has an empty transcript', c08.transcript.length === 0);

/* ---------- read-only, always ---------- */
var snap = JSON.stringify(s);
P.PLACES.forEach(function (pl) { P.html(s, pl, 'X'); });
P.html(s, 'bin', 'C-08'); P.html(s, 'order', 'ORD-503'); P.html(s, 'shipment', 'IN-1002'); P.html(s, 'dock', 'Outbound Door 4');
check('rendering every kind of page changes nothing in state', JSON.stringify(s) === snap);

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
