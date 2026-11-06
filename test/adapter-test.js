/* adapter-test.js — node, no dependencies.
   The host-WMS adapter (js/adapter.js, briefs/claude-brief-adapter.md;
   the standard is note 38). Pins:
     - the contract: a profile (id, hostLabel, transport, declared
       verbs), submit, and an async confirmation channel;
     - the dummy adapter: the default, sync, every verb declared — a
       spoken complete and a spoken flag land exactly as the engine's
       own path, attribution identical, nothing new in the state;
     - the simulated host (a TEST DOUBLE, async, labeled simulated):
       SENT (record + door language) until the verdict; landed once on
       confirm; refused → the task stays open with the host's reason;
     - idempotency: the same act resubmitted lands once at the host
       and once in the record; a repeated or unknown-key confirmation
       changes nothing;
     - capability honesty: the undeclared verb is refused in plain
       words naming the host, before submission, nothing recorded;
     - the gate's checks run in their order on both adapters (outage,
       clarification, signature before any adapter, the confirmation
       law, ownership);
     - the sentActs / adapterSeq shapes are registered in the ontology;
     - the engine world (converse) does not move behind the adapter.
   Run: node test/adapter-test.js   (exit 0 = all pass) */
'use strict';

var fs = require('fs');
var path = require('path');
var E = require('../js/engine.js');
var W = require('../js/wms.js');
var A = require('../js/adapter.js');
var Gt = require('../js/gate.js');
var V = require('../js/wms-voice.js');
var O = require('../js/ontology.js');

var failures = 0, passes = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (cond) passes++; else failures++; }

var t0 = Date.parse('2026-11-06T09:00:00Z'), tick = 0;
W.now = function () { return new Date(t0 + 60000 * (tick++)).toISOString(); };

function snap(s) { return JSON.stringify(s); }
var MARCUS = 'u-marcus', GRACE = 'u-grace', PRIYA = 'u-priya', TOMMY = 'u-tommy';
var SIM_NO = 'The host system (simulated) doesn\'t take that from Witness — it has to be done there directly. Nothing was done.';

function env(intent) { return { intent: intent, say: 'OK.', about: 'current' }; }
function claimOf(words) { return { qty: W.parseQty(words), bin: W.parseBin(words), cartons: null }; }
/* A worker's turn, the way the page runs it (as in wms-voice-test). */
function turn(s, uid, words, e, pending, label) {
  if (e == null) {
    var c = W.currentOf(s, uid);
    e = env(V.localIntent(words, { pending: !!pending, pickInHand: !!c && c.type === 'pick' }));
  }
  if (e.intent === 'complete' && !e.claim) e.claim = claimOf(words);
  var d = V.decide(s, uid, words, e, pending || null);
  if (d.run) d.result = V.run(s, d.run, { label: label || null });
  return d;
}
function voiceAct(s, who, intent, target, params, confirmed, opts) {
  return Gt.act(s, { who: who, via: 'voice', intent: intent, target: target, params: params, confirmed: confirmed }, opts);
}
function pickInHand() { var s = W.seed(); W.nextFor(s, PRIYA); return { s: s, cur: W.currentOf(s, PRIYA) }; }
function completesOf(s, taskId) { return s.records.filter(function (r) { return r.kind === 'complete' && r.taskId === taskId; }).length; }

/* ================= the contract ================= */
check('contract: the gate\'s act vocabulary is the verb list',
  JSON.stringify(A.VERBS) === JSON.stringify(['complete', 'flag', 'post-receiving', 'confirm-load']));
var D = A.dummy;
check('contract: the dummy is the default adapter — sync, not keyed, every verb declared',
  A.current() === D && D.profile.transport === 'sync' && D.profile.keyed === false &&
  A.VERBS.every(function (v) { return D.profile.verbs[v] === true; }) && A.check(D) === null);
var H = A.simulatedHost();
check('contract: the simulated host is async, keyed, has a confirmation channel, and is labeled simulated',
  H.profile.transport === 'async' && H.profile.keyed === true && H.profile.simulated === true &&
  H.profile.hostLabel === 'the host system (simulated)' && typeof H.confirm === 'function' && A.check(H) === null);
check('contract: the simulated host deliberately does not declare one verb (flag)',
  !H.profile.verbs.flag && H.profile.verbs.complete && H.profile.verbs['post-receiving'] && H.profile.verbs['confirm-load']);
var threw = 0;
try { A.use({ profile: { id: 'x', hostLabel: 'x', transport: 'carrier-pigeon', verbs: {} }, submit: function () {} }); } catch (e) { threw++; }
try { A.use({ profile: { id: 'x', hostLabel: 'x', transport: 'async', verbs: { complete: true } }, submit: function () {} }); } catch (e) { threw++; }
try { A.use({ profile: { id: 'x', hostLabel: 'x', transport: 'sync', verbs: { teleport: true } }, submit: function () {} }); } catch (e) { threw++; }
check('contract: an adapter with a bad transport, an unkeyed async channel, or an unknown verb is refused at use()',
  threw === 3 && A.current() === D);
check('contract: the gate exposes no new POLICY entries — the profile is the declaration',
  JSON.stringify(Object.keys(Gt.POLICY).sort()) === JSON.stringify(['confirm', 'modelFormed', 'outage', 'signatureEnforced', 'signedIntents', 'signedTaskTypes']));

/* ================= the dummy: behavior unchanged ================= */
/* The same spoken complete, once through the gate (dummy adapter) and
   once by hand through the engine's own path with the attribution the
   gate wrote before this build: the two states are byte-identical. */
tick = 0; var x = pickInHand(); tick = 0; var y = pickInHand();
var words = 'picked ' + x.cur.qty + ' | yes';
tick = 100;
var r = voiceAct(x.s, PRIYA, 'complete', x.cur.id, { model: true, words: words, title: x.cur.title, plan: { qty: x.cur.qty } }, true);
tick = 100;
var mark = y.s.records.length;
var byHand = W.complete(y.s, y.cur.id, { by: PRIYA, qty: y.cur.qty, words: words });
var yt = E.taskById(y.s, y.cur.id);
yt.via = 'voice'; yt.heard = words;
y.s.records.slice(mark).forEach(function (rec) { rec.via = 'voice'; rec.heard = words; if (rec.by == null) rec.by = PRIYA; });
check('dummy: a confirmed complete lands now — the task is done, the result is the engine\'s own',
  r.ok === true && !r.result.sent && E.taskById(x.s, x.cur.id).status === 'done' && r.result.text === byHand.text);
/* (Two stamps come from the wall clock, which no test can pin:
   js/engine.js's doneAt on a task, and the ts on each record the
   paths write — the two runs land a millisecond apart as often as
   not. Both stamps are masked; everything else must match exactly.
   Mask extended by Faye in the PR #50 review, 2026-11-06.) */
function wall(st) { return snap(st).replace(/"doneAt":"[^"]*"/g, '"doneAt":"*"').replace(/"ts":"[^"]*"/g, '"ts":"*"'); }
check('dummy: the state is byte-identical to the engine\'s own path with today\'s attribution (via, heard, by)',
  wall(x.s) === wall(y.s));
check('dummy: nothing new in the state — no sentActs, no adapterSeq (the dummy is in-process, not keyed)',
  !('sentActs' in x.s) && !('adapterSeq' in x.s));

/* A spoken flag, through the door, both ways. */
tick = 0; x = { s: W.seed() }; tick = 0; y = { s: W.seed() };
tick = 200;
var d = turn(x.s, TOMMY, 'there is oil leaking by B-03', env('problem'));
d = turn(x.s, TOMMY, 'yes', null, d.stage, 'Oil leak');
tick = 200;
mark = y.s.records.length;
var fh = W.flag(y.s, { unitId: TOMMY, words: 'there is oil leaking by B-03', label: 'Oil leak', source: 'voice', zone: 'B' });
y.s.records.slice(mark).forEach(function (rec) { rec.via = 'voice'; rec.heard = 'there is oil leaking by B-03'; if (rec.by == null) rec.by = TOMMY; });
check('dummy: a spoken flag lands as before — landed language, the console\'s path',
  d.result.ok === true && !d.result.sent && /^Flagged "Oil leak" with your words \(Zone B\)/.test(d.result.text) && fh.ok);
check('dummy: the flag\'s state is byte-identical to W.flag with today\'s attribution', wall(x.s) === wall(y.s));

/* A spoken complete through the door, on the dummy: landed language. */
x = pickInHand();
d = turn(x.s, PRIYA, 'done', env('complete'));
d = turn(x.s, PRIYA, 'yes', null, d.stage);
check('dummy (door): "done" then "yes" closes the task with landed language, never "sent"',
  d.result.ok && !d.result.sent && !/^Sent/.test(d.result.text) && E.taskById(x.s, x.cur.id).status === 'done' &&
  E.taskById(x.s, x.cur.id).via === 'voice' && E.taskById(x.s, x.cur.id).heard === 'done');

/* ================= the simulated host: SENT → landed ================= */
H = A.simulatedHost();
A.use(H);
x = pickInHand();
var s = x.s, cur = x.cur;
var recsBefore = s.records.length;
d = turn(s, PRIYA, 'done', env('complete'));
check('sim: staging is unchanged — the door asks, nothing sent, no key minted',
  d.stage && d.stage.kind === 'complete' && H.inbox.length === 0 && !('adapterSeq' in s) && !('sentActs' in s));
d = turn(s, PRIYA, 'yes', null, d.stage);
var entry = s.sentActs && s.sentActs[0];
check('sim: "yes" SENDS — the door says sent, never landed',
  d.result.ok && d.result.sent === true && /^Sent — waiting on the host to confirm "/.test(d.result.text) &&
  /stays in your hands/.test(d.result.text) && !/[Cc]losed|[Pp]icked/.test(d.result.text));
check('sim: the task stays open and in hand while SENT; the engine has not run (no records written)',
  E.taskById(s, cur.id).status !== 'done' && W.currentOf(s, PRIYA).id === cur.id && s.records.length === recsBefore);
check('sim: the SENT act is recorded in state.sentActs — key, via, who, intent, target, params, words, ts, status',
  s.sentActs.length === 1 && entry.status === 'sent' && entry.via === 'voice' && entry.who === PRIYA &&
  entry.intent === 'complete' && entry.target === cur.id && entry.words === 'done' && typeof entry.ts === 'string' &&
  entry.params && entry.params.plan && entry.params.plan.qty === cur.qty &&
  JSON.stringify(Object.keys(entry)) === JSON.stringify(['key', 'via', 'who', 'intent', 'target', 'params', 'words', 'ts', 'status']));
check('sim: the idempotency key is door + the state-held counter, minted once',
  entry.key === 'voice-1' && s.adapterSeq === 1 && d.result.key === 'voice-1' && H.inbox.length === 1 && H.inbox[0].key === 'voice-1');
check('sim: the entry is plain data (survives the /state round trip)', snap(JSON.parse(snap(entry))) === snap(entry));

var again = turn(s, PRIYA, 'done', env('complete'));
check('sim: while SENT, a new "done" on the same task is refused plainly — nothing staged, nothing sent again',
  !again.stage && /already sent to the host system \(simulated\)/.test(again.say) && H.inbox.length === 1 && s.sentActs.length === 1);

var out = H.deliver(s);
var t = E.taskById(s, cur.id);
check('sim: on the host\'s "landed" verdict the effect lands once through the WMS path — the task is done',
  out.length === 1 && out[0].ok && out[0].status === 'landed' && t.status === 'done' && completesOf(s, cur.id) === 1);
check('sim: the landing is attributed by the gate\'s one writer — via, the words heard, who',
  t.via === 'voice' && t.heard === 'done' &&
  s.records.slice(recsBefore).length > 0 && s.records.slice(recsBefore).every(function (rec) { return rec.via === 'voice' && rec.heard === 'done' && rec.by === PRIYA; }));
check('sim: the entry is settled (landed, settledAt) and the host\'s shadow record holds one transaction',
  entry.status === 'landed' && typeof entry.settledAt === 'string' && H.ledger.length === 1 && H.ledger[0].key === 'voice-1');

var before = snap(s);
var rep = H.confirm(s, 'voice-1', 'landed');
check('idempotency: a repeated confirmation is ignored — nothing changes, nothing double-applied',
  rep.ok === false && rep.ignored === true && snap(s) === before && completesOf(s, cur.id) === 1);
rep = H.confirm(s, 'voice-999', { status: 'refused', reason: 'nope' });
check('idempotency: a confirmation for an unknown key is ignored — nothing changes', rep.ignored === true && snap(s) === before);
rep = H.confirm(s, 'voice-1', { status: 'refused', reason: 'late refusal' });
check('idempotency: a late refusal of an already-landed act is ignored — the landing stands', rep.ignored === true && snap(s) === before);

/* ================= SENT → refused ================= */
H = A.simulatedHost();
A.use(H);
x = pickInHand(); s = x.s; cur = x.cur;
H.hold(cur.id);
recsBefore = s.records.length;
d = turn(s, PRIYA, 'done', env('complete'));
d = turn(s, PRIYA, 'yes', null, d.stage);
check('refused arc: the act is first SENT', d.result.sent === true && s.sentActs[0].status === 'sent');
out = H.deliver(s);
entry = s.sentActs[0];
check('refused arc: the host refuses with its own reason; the record says refused, with the reason',
  out[0].status === 'refused' && entry.status === 'refused' && /^HOST-409: task .* locked in the host system \(simulated\)/.test(entry.reason) &&
  typeof entry.settledAt === 'string');
check('refused arc: the task is open, still in hand, nothing landed, the host committed nothing',
  E.taskById(s, cur.id).status !== 'done' && W.currentOf(s, PRIYA).id === cur.id && s.records.length === recsBefore && H.ledger.length === 0);
delete H.holds[cur.id];
d = turn(s, PRIYA, 'done', env('complete'));
d = turn(s, PRIYA, 'yes', null, d.stage);
check('refused arc: after a refusal the worker can send it again — a new act, a new key',
  d.result.sent === true && d.result.key === 'voice-2' && s.sentActs.length === 2);
H.deliver(s);
check('refused arc: the second act lands once', E.taskById(s, cur.id).status === 'done' && completesOf(s, cur.id) === 1 && H.ledger.length === 1);

/* ================= idempotency: a retried submission ================= */
H = A.simulatedHost();
A.use(H);
x = pickInHand(); s = x.s; cur = x.cur;
var req = { who: PRIYA, via: 'voice', intent: 'complete', target: cur.id, confirmed: true,
  params: { model: true, words: 'yes', title: cur.title, plan: { qty: cur.qty } } };
var r1 = Gt.act(s, req);
var r2 = Gt.act(s, req);
check('retry: the same act object resubmitted reuses its key — one entry, one counter tick',
  r1.result.sent && r2.result.sent && r1.result.key === r2.result.key && req.key === r1.result.key &&
  s.sentActs.length === 1 && s.adapterSeq === 1);
check('retry: the host drops the duplicate by key — one submission in its inbox', H.inbox.length === 1 && H.dropped === 1);
H.deliver(s);
check('retry: it lands exactly once at the host and once in the record',
  H.ledger.length === 1 && completesOf(s, cur.id) === 1 && E.taskById(s, cur.id).status === 'done');
before = snap(s);
var r3 = Gt.act(s, req);
check('retry: resubmitting after it landed is refused by the gate (the task is closed) — nothing changes',
  r3.ok === false && snap(s) === before && H.inbox.length === 0);

/* ================= capability honesty ================= */
H = A.simulatedHost();
A.use(H);
s = W.seed();
before = snap(s);
d = turn(s, TOMMY, 'there is oil leaking by B-03', env('problem'));
check('capability: a spoken flag on a host that does not declare it is refused at once, in words naming the host',
  !d.stage && d.say === SIM_NO && snap(s) === before);
r = voiceAct(s, TOMMY, 'flag', null, { model: true, words: 'oil by B-03', label: 'Oil leak', zone: 'B' }, true);
check('capability: a confirmed flag is refused before submission — nothing sent, nothing recorded, no key minted',
  r.ok === false && r.unsupported === true && r.reason === SIM_NO && snap(s) === before && H.inbox.length === 0);
check('capability: the refusal never fakes a landing and never queues silently',
  !('sentActs' in s) && !('adapterSeq' in s) && s.wms.flags.length === W.seed().wms.flags.length);
/* A host that does declare flag: the spoken flag rides the SENT arc. */
H = A.simulatedHost({ verbs: { complete: true, flag: true } });
A.use(H);
s = W.seed();
var nFlags = s.wms.flags.length;
d = turn(s, TOMMY, 'there is oil leaking by B-03', env('problem'));
d = turn(s, TOMMY, 'yes', null, d.stage, 'Oil leak');
check('flag on a declaring host: SENT, in sent language — nothing filed yet',
  d.result.sent === true && /^Sent — waiting on the host to confirm the flag/.test(d.result.text) && s.wms.flags.length === nFlags &&
  s.sentActs[0].intent === 'flag' && s.sentActs[0].params.label === 'Oil leak' && s.sentActs[0].params.zone === 'B');
H.deliver(s);
var fl = s.wms.flags[s.wms.flags.length - 1];
check('flag on a declaring host: on landed it files once, the console\'s way — label, words, zone, voice source',
  s.wms.flags.length === nFlags + 1 && fl.label === 'Oil leak' && fl.words === 'there is oil leaking by B-03' && fl.zone === 'B' && fl.source === 'voice');
/* A host that does not take completions at all. */
var noComplete = A.simulatedHost({ verbs: { flag: true } });
x = pickInHand();
before = snap(x.s);
r = voiceAct(x.s, PRIYA, 'complete', x.cur.id, { model: true, words: 'done', claim: { qty: null, bin: null, cartons: null } }, false, { adapter: noComplete });
check('capability: the declaration is read per adapter (opts.adapter) — completions refused on a host that does not take them',
  r.ok === false && r.reason === SIM_NO && snap(x.s) === before);

/* ================= the six checks, in order, on both adapters ======= */
[['dummy', A.dummy], ['sim', A.simulatedHost()]].forEach(function (pair) {
  var name = pair[0], ad = pair[1];
  A.use(ad);
  var o = pickInHand(), st = o.s, c = o.cur, b = snap(st);
  var g = voiceAct(st, PRIYA, 'complete', c.id, { words: 'done', claim: { qty: null, bin: null, cartons: null } });
  check(name + ': check 1 — not model-formed is the outage, before any adapter', g.reason === Gt.OUTAGE && snap(st) === b);
  g = voiceAct(st, PRIYA, 'complete', c.id, { model: true, words: 'done with this one', claim: { qty: null, bin: null, cartons: null } });
  check(name + ': check 1 — a disagreement is a clarification, nothing recorded', g.clarify === Gt.PARTIAL_OR_FULL && snap(st) === b);
  g = voiceAct(st, PRIYA, 'complete', c.id, { model: true, words: 'picked ' + c.qty, claim: { qty: c.qty, bin: null, cartons: null } });
  check(name + ': check 3 — unconfirmed only stages; nothing submitted', g.ok && g.result.staged && snap(st) === b && (!ad.inbox || ad.inbox.length === 0));
  g = voiceAct(st, GRACE, 'complete', c.id, { model: true, words: 'yes', title: c.title, plan: { qty: c.qty } }, true);
  check(name + ': check 4 — ownership: another worker\'s yes is refused, nothing submitted',
    g.ok === false && /no longer in your hands/.test(g.reason) && snap(st) === b && (!ad.inbox || ad.inbox.length === 0));
  var m = W.seed(); W.nextFor(m, MARCUS); var mc = W.currentOf(m, MARCUS); var mb = snap(m);
  g = voiceAct(m, MARCUS, 'complete', mc.id, { model: true, words: 'yes', title: mc.title, plan: {} }, true);
  check(name + ': check 2 — a signed act (a receiving) is refused with the desk guidance before any adapter is reached',
    mc.type === 'receive' && g.ok === false && /signed act/.test(g.reason) && snap(m) === mb && (!ad.inbox || ad.inbox.length === 0));
  g = voiceAct(m, MARCUS, 'confirm-load', null, { model: true, words: 'load it' }, true);
  check(name + ': check 2 — the signed intent itself is refused, never carried', g.ok === false && /signed act/.test(g.reason) && snap(m) === mb && (!ad.inbox || ad.inbox.length === 0));
});
A.use(A.dummy);

/* ================= the engine world stays built-in ================= */
A.use(A.simulatedHost());
var es = E.seedWorld(); E.generateTasks(es);
var marcus = E.unitById(es, 'u-marcus');
E.nextTaskFor(es, marcus);
r = Gt.act(es, { who: 'u-marcus', via: 'converse', intent: 'note-problem', params: { model: true, words: 'pallet is leaning' } }, { engine: E });
check('engine world: converse acts still run on the engine directly — landed, no SENT, no key',
  r.ok === true && !r.result.sent && !('sentActs' in es) && !('adapterSeq' in es) && A.current().inbox.length === 0);
A.use(A.dummy);

/* ================= the ontology registry ================= */
H = A.simulatedHost(); A.use(H);
x = pickInHand(); s = x.s;
turn(s, PRIYA, 'yes', null, turn(s, PRIYA, 'done', env('complete')).stage);
H.hold('nothing');
var keys = O.detectUnknowns(s).map(function (u) { return u.key; });
check('ontology: sentActs and adapterSeq are registered — the detector does not "discover" them',
  O.KNOWN_SCHEMA.sections.indexOf('sentActs') !== -1 && O.KNOWN_SCHEMA.sections.indexOf('adapterSeq') !== -1 &&
  keys.indexOf('sentActs') === -1 && keys.indexOf('adapterSeq') === -1);
H.deliver(s);
check('ontology: every field a sent entry carries (sent or settled) is registered',
  s.sentActs.every(function (e2) { return Object.keys(e2).every(function (k) { return O.KNOWN_SCHEMA.sentActFields.indexOf(k) !== -1; }); }));
A.use(A.dummy);

/* ================= the pages ================= */
var root = path.join(__dirname, '..');
function scripts(page) { return (fs.readFileSync(path.join(root, page), 'utf8').match(/<script src="[^"]+"/g) || []).map(function (m) { return m.slice(13, -1); }); }
var ws = scripts('wms.html');
check('wms.html loads js/adapter.js, before the gate', ws.indexOf('js/adapter.js') !== -1 && ws.indexOf('js/adapter.js') < ws.indexOf('js/gate.js'));
check('no other page carries the adapter tag (the engine and game worlds do not use it)',
  ['warehouse.html', 'phone.html', 'glasses.html', 'index.html'].every(function (p) { return scripts(p).indexOf('js/adapter.js') === -1; }));
var src = fs.readFileSync(path.join(root, 'js/adapter.js'), 'utf8');
check('the simulated host is labeled a test double where it is defined', /TEST DOUBLE/.test(src) && /simulated/.test(H.profile.hostLabel));

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
