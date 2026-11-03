/* wms-agent-test.js — node, no dependencies.
   The agent in the Witness page's chair (js/wms-agent.js, console
   Task 3). Played against the real WMS layer: a truck is received by
   voice with damage, the damaged pallet is held, a worker flags it.
   Then the desk (Sam, the manager) asks and tells on the pallet's
   page. Proves: ask vs tell is decided locally; the agent is sent
   ONLY this item's record and answers from it, checked; asking saves
   nothing; a typed and a spoken desk update land in the transcript as
   desk entries with the person's name; a decision stated at the desk
   is an event decided by that person and moves nothing in the
   building; desk entries follow the item to the pages that hold it.
   Run: node test/wms-agent-test.js   (exit 0 = all pass) */
'use strict';

var E = require('../js/engine.js');
var W = require('../js/wms.js');
var C = require('../js/converse.js');
var P = require('../js/wms-witness.js');
var A = require('../js/wms-agent.js');

var failures = 0, passes = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (cond) passes++; else failures++; }

var RealDate = Date, clock = RealDate.parse('2026-11-02T08:00:00Z');
global.Date = function FakeDate(a, b, c, d, e, f, g) {
  if (!arguments.length) { clock += 60000; return new RealDate(clock); }
  return arguments.length === 1 ? new RealDate(a) : new RealDate(a, b, c || 1, d || 0, e || 0, f || 0, g || 0);
};
global.Date.parse = RealDate.parse; global.Date.UTC = RealDate.UTC; global.Date.now = function () { return clock; };
global.Date.prototype = RealDate.prototype;
W.now = function () { return new Date().toISOString(); };

function reply(content) { return { ok: true, status: 200, json: function () { return Promise.resolve({ choices: [{ message: { content: content } }] }); } }; }
function stub(replies) {
  var calls = [];
  var f = function (url, init) {
    calls.push({ url: url, body: JSON.parse(init.body) });
    var r = replies.length > 1 ? replies.shift() : replies[0];
    return typeof r === 'function' ? r() : Promise.resolve(r);
  };
  f.calls = calls;
  return f;
}
function sansRecords(st) { var x = JSON.parse(JSON.stringify(st)); delete x.records; return JSON.stringify(x); }

(async function main() {
  /* ---------- ask or tell: local, deterministic ---------- */
  var asks = ['why is this flagged', 'Who saw the damage?', "what's missing", 'Hey Muse, when did it arrive', 'did anyone count it again', 'The towels are fine?'];
  check('questions are asked (question word or "?"; wake word stripped)', asks.every(function (q) { return A.intentOf(q) === 'ask'; }));
  var decides = ['I decided to write off the four crushed cases', 'Keep it on hold until the carrier calls back.', 'Send it back to the vendor', 'Do not ship it', 'My call: use as is.'];
  check('stated decisions are decisions', decides.every(function (q) { return A.intentOf(q) === 'decision'; }));
  var updates = ['Called the carrier, they will send photos by noon.', 'Rosa says the bottom layer is wet', 'Two cases restacked'];
  check('anything else is an update for the record', updates.every(function (q) { return A.intentOf(q) === 'update'; }));
  check('nothing said is "empty"', A.intentOf('') === 'empty' && A.intentOf('   ') === 'empty' && A.intentOf('hey muse') === 'empty');

  /* ---------- a damaged pallet, through many hands ---------- */
  var s = W.seed();
  W.checkIn(s, 'APT-102', 'u-sam');
  var said = 'detergent four pallets, one sixteen cases, four crushed. towels all six pallets';
  W.receive(s, 'IN-1002', [
    { desc: 'Laundry detergent — cases', received: 116, damaged: 4, quote: 'one sixteen cases, four crushed' },
    { desc: 'Paper towels — cases', received: 120, damaged: 0, quote: 'towels all six pallets' }
  ], { by: 'u-tommy', transcript: said, source: 'voice' });
  var dmg = s.staging.filter(function (p) { return p.shipmentId === 'IN-1002' && p.damaged; })[0];
  var sib = s.staging.filter(function (p) { return p.shipmentId === 'IN-1002' && !p.damaged; })[0];
  check('setup: a damaged pallet on hold and a sound sibling', !!dmg && !!dmg.hold && !!sib);

  /* ---------- the item's record as context ---------- */
  var ctx = A.itemContext(s, 'pallet', dmg.id);
  check('context names the item and what it is now (on hold, damaged)', ctx.text.indexOf('ITEM RECORD — Pallet ' + dmg.id) === 0 && /On hold/.test(ctx.text) && /Marked damaged at receipt/.test(ctx.text));
  check('context carries the item\'s events, each with who', /EVENTS \(oldest first\):\n1\. .*Arrived/.test(ctx.text) && /Held — .* — by Tommy/.test(ctx.text));
  check('context carries the transcript verbatim with the speaker', ctx.text.indexOf('Tommy') !== -1 && ctx.text.indexOf('"' + said + '"') !== -1);
  check('context holds this item only (no sibling pallet\'s line)', ctx.text.indexOf('Pallet ' + sib.id) === -1 || ctx.text.indexOf('Staged: ' + sib.id) === -1);
  var empty = A.itemContext(s, 'bin', 'C-08');
  check('an untouched item\'s context is empty-honest', /EVENTS[^\n]*\nNone on the record\./.test(empty.text) && /Nothing said on the record\./.test(empty.text));
  check('an unknown item\'s context says so, nothing else', /not in the desk record/.test(A.itemContext(s, 'pallet', 'STG-999').text));

  /* ---------- ask: answers from this item's record ---------- */
  var snap = JSON.stringify(s);
  var f = stub([reply('Flagged at receipt: Tommy said "one sixteen cases, four crushed". 4 cases damaged. Sam said "ship it".')]);
  var res = await A.askItem({ state: s, place: 'pallet', id: dmg.id, question: 'Why is this flagged?', fetch: f });
  var sent = f.calls[0];
  check('asks through the Worker /chat (converse plumbing)', f.calls.length === 1 && sent.url === C.CHAT_URL);
  check('sends the agent prompt, bound to this record only', sent.body.messages[0].content === A.SYSTEM_PROMPT && /ONLY from the ITEM RECORD/.test(A.SYSTEM_PROMPT));
  check('sends this item\'s record and the question, nothing else', sent.body.messages.length === 2 &&
    sent.body.messages[1].content === ctx.text + '\n\nDESK QUESTION: Why is this flagged?');
  check('returns the agent\'s answer', /^Flagged at receipt/.test(res.answer) && res.attempts === 1);
  check('quotes are checked: a real quote is found, an invented one is not', res.check.quotes.found.indexOf('one sixteen cases, four crushed') !== -1 && res.check.quotes.missing.indexOf('ship it') !== -1);
  check('numbers are checked against the record', res.check.numbers.found.indexOf(4) !== -1);
  check('asking saves nothing and changes nothing', JSON.stringify(s) === snap);

  var f2 = stub([reply(''), reply('Tommy saw it at receipt.')]);
  res = await A.askItem({ state: s, place: 'pallet', id: dmg.id, question: 'who saw the damage', fetch: f2 });
  check('an empty reply is retried once', f2.calls.length === 2 && res.attempts === 2 && res.answer === 'Tommy saw it at receipt.');
  var f3 = stub([reply('')]);
  var err = await A.askItem({ state: s, place: 'pallet', id: dmg.id, question: 'what is missing', fetch: f3 }).then(function () { return null; }, function (e) { return e; });
  check('empty twice: gives up honestly, nothing guessed', f3.calls.length === 2 && err && /Nothing was guessed/.test(err.userMessage));
  err = await A.askItem({ state: s, place: 'pallet', id: dmg.id, question: 'q?', fetch: stub([{ ok: false, status: 429 }]) }).then(function () { return null; }, function (e) { return e; });
  check('call limit is said plainly', err && /call limit/.test(err.userMessage));
  err = await A.askItem({ state: s, place: 'pallet', id: dmg.id, question: 'q?', fetch: function () { return Promise.reject(new Error('offline')); } }).then(function () { return null; }, function (e) { return e; });
  check('no connection is said plainly', err && /could not be reached/.test(err.userMessage));
  err = await A.askItem({ state: s, place: 'pallet', id: dmg.id, question: '  ', fetch: stub([reply('x')]) }).then(function () { return null; }, function (e) { return e; });
  check('an empty question is refused before any call', err && /first/.test(err.userMessage));

  /* ---------- tell: a typed desk update joins the record ---------- */
  var nRec = s.records.length;
  var before = sansRecords(s);
  var typed = 'Called the carrier, they will send photos by noon.';
  var t1 = A.deskEntry(s, 'pallet', dmg.id, { by: 'u-sam', words: typed, source: 'typed' });
  check('typed update: saved as one desk record, by Sam', t1.ok && !t1.decision && s.records.length === nRec + 1 &&
    s.records[nRec].kind === 'desk' && s.records[nRec].by === 'u-sam' && s.records[nRec].words === typed && s.records[nRec].on.stagingId === dmg.id);
  var m = P.model(s, 'pallet', dmg.id);
  var line = m.transcript[m.transcript.length - 1];
  check('typed update lands in the transcript as a desk entry, verbatim, with Sam\'s name', line.desk && line.words === typed && line.by === 'u-sam' && line.source === 'desk-typed');
  var ev = m.events[m.events.length - 1];
  check('typed update mints an event: "Desk update", by Sam', ev.verb === 'Desk update' && ev.by === 'u-sam' && !ev.decision && ev.text === '"' + typed + '"');

  /* ---------- tell: a spoken decision ---------- */
  var spoken = 'I decided to write off the four crushed cases and keep the rest.';
  var t2 = A.deskEntry(s, 'pallet', dmg.id, { by: 'u-sam', words: spoken, source: 'voice' });
  m = P.model(s, 'pallet', dmg.id);
  line = m.transcript[m.transcript.length - 1];
  ev = m.events[m.events.length - 1];
  check('spoken words land in the transcript as a spoken desk entry', t2.ok && line.words === spoken && line.source === 'desk-voice' && line.by === 'u-sam');
  check('a decision stated at the desk is an event: Decided, by Sam', t2.decision && ev.verb === 'Decided' && ev.decision && ev.by === 'u-sam');
  check('the decision moves nothing in the building (only the record grew)', sansRecords(s) === before && s.records.length === nRec + 2 && !!dmg.hold);
  var h = P.html(s, 'pallet', dmg.id);
  check('page shows the decision as Sam\'s act ("Decided by Sam")', /Decided by <b>Sam/.test(h) && h.indexOf(spoken) !== -1);
  check('page marks desk lines in the transcript', /<li class="wp-line desk">[\s\S]*?Desk · spoken/.test(h) && /Desk · typed/.test(h));
  check('the agent\'s next context includes the desk words, with who', new RegExp('Sam[^(\\n]*\\(spoken at the desk, Decision at the desk\\): "' + spoken + '"').test(A.itemContext(s, 'pallet', dmg.id).text));
  check('the decision record reads as Sam\'s, in the ledger', /^Decision at the desk on Pallet .* from Sam[^:]*: I decided/.test(s.records[nRec + 1].text));
  check('caller can force an update even with decision words', A.deskEntry(JSON.parse(JSON.stringify(s)), 'pallet', dmg.id, { by: 'u-sam', words: 'approved by phone', decision: false }).decision === false);

  /* ---------- desk entries follow the item ---------- */
  var sm = P.model(s, 'shipment', 'IN-1002');
  check('the pallet\'s desk entries show on its shipment\'s page', sm.transcript.filter(function (x) { return x.desk; }).length === 2 &&
    sm.transcript.some(function (x) { return x.desk && /on pallet/.test(x.about); }));
  var gm = P.model(s, 'pallet', sib.id);
  check('they do not show on a sibling pallet', !gm.transcript.some(function (x) { return x.desk; }) && !gm.events.some(function (e) { return e.kind === 'desk'; }));
  var fresh = W.seed();
  var viaDock = A.deskEntry(fresh, 'dock', 'Inbound Door 1', { by: 'u-sam', words: 'Driver waiting on paperwork.' });
  check('telling on a dock with a truck files it under that shipment', viaDock.ok && viaDock.record.on.place === 'shipment' && viaDock.record.on.shipmentId === 'IN-1001' &&
    P.model(fresh, 'dock', 'Inbound Door 1').transcript.some(function (x) { return x.desk && x.words === 'Driver waiting on paperwork.'; }));
  W.release(s, { stagingId: dmg.id }, 'u-sam');
  W.refresh(s);
  var pa = E.taskById(s, 't-putaway-' + dmg.id);
  W.complete(s, pa.id, { by: 'u-marcus' });
  var bm = P.model(s, 'bin', pa.toBinId);
  check('after putaway, the pallet\'s desk words show on its bin\'s page', bm.transcript.filter(function (x) { return x.desk; }).length === 2 &&
    bm.events.some(function (e) { return e.verb === 'Decided' && e.kind === 'desk' && e.by === 'u-sam'; }));
  var ord = A.deskEntry(s, 'order', 'ORD-503', { by: 'u-sam', words: 'Customer asked to hold the ship date.' });
  check('a desk entry on an order shows on that order', ord.ok && P.model(s, 'order', 'ORD-503').transcript.some(function (x) { return x.desk && x.words === 'Customer asked to hold the ship date.'; }));

  /* ---------- refusals: nothing added ---------- */
  var n2 = s.records.length;
  check('empty words are refused', !A.deskEntry(s, 'bin', 'C-08', { by: 'u-sam', words: '  ' }).ok && s.records.length === n2);
  check('an item not in the record is refused', !A.deskEntry(s, 'pallet', 'STG-999', { by: 'u-sam', words: 'hello' }).ok && s.records.length === n2);
  var anon = A.deskEntry(JSON.parse(JSON.stringify(s)), 'bin', 'C-08', { by: 'nobody', words: 'wet floor' });
  check('an unknown speaker is not invented: "not said who"', anon.ok && anon.record.by === null && /the desk \(not said who\)/.test(anon.record.text));

  /* ---------- the chair ---------- */
  var sub = P.subject(s, 'bin', pa.toBinId);
  var chair = A.chairHtml(s, sub, { me: 'u-sam', turns: [
    { kind: 'ask', q: 'Why is this <b>flagged</b>?', by: 'u-sam' },
    { kind: 'answer', text: 'Sam said "ship it". 9 cases.', check: { numbers: { found: [], missing: [9] }, quotes: { found: [], missing: ['ship it'] } }, context: 'ITEM RECORD' },
    { kind: 'recorded', words: spoken, by: 'u-sam', source: 'voice', decision: true }
  ] });
  check('chair says who the words will belong to', /joins the record as <b>Sam/.test(chair));
  check('chair escapes what was typed', chair.indexOf('<b>flagged</b>') === -1 && chair.indexOf('&lt;b&gt;flagged') !== -1);
  check('chair warns on numbers/quotes not found in the record', /NOT found in this record — check it yourself: 9, &quot;ship it&quot;/.test(chair));
  check('chair says the agent reports and the human decides', /It reports; you decide\. Nothing was changed\./.test(chair));
  check('a recorded decision is shown as the person\'s, and that nothing moved', /Recorded as <b>Sam[^<]*<\/b>'s decision\. Nothing in the building was moved/.test(chair) && /spoken at the desk/.test(chair));
  check('busy chair disables the controls', /<textarea id="agQ"[^>]*disabled/.test(A.chairHtml(s, sub, { busy: true })));

  console.log('\n' + passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
