/* ontology-self-extension-test.js — node, no dependencies.
   Ontology self-extension (briefs/claude-brief-ontology-self-
   extension.md): the ontology notices a feature of the WMS it has
   no concept for, the AI describes it, a human settles it.
   Proves:
     - detection is deterministic and pinned to the real building:
       the shipped seed (raw, installed, practice-dressed) and a
       worked shift of real WMS operations yield ZERO unknowns;
     - a novel section, a novel task type, a novel record kind and
       a novel field on a known kind each surface exactly one
       unknown, with real samples (copies, at most three);
     - learnConcept is pure and lazy, and the ladder is honest:
       detected → described (needs a summary) → settled (needs a
       named human); it never demotes, never settles on its own;
     - the digest lists concepts with their status, and applyChange
       announces a newly described concept exactly once — never on
       a fresh rebuild, never for a merely detected one;
     - the describe orchestration (js/wms-ai.js refreshConcepts):
       recorded detected BEFORE the AI is asked; a grounded reply
       describes it; an ungrounded or failed reply leaves it
       detected with the honest note; the seed makes no call;
     - the delegator's dispatch context carries the concepts, with
       their status, and the delegator writes nothing;
     - js/ontology.js is still pure: no network, no AI module.
   Run: node test/ontology-self-extension-test.js   (exit 0 = all pass) */
'use strict';

var fs = require('fs');
var W = require('../js/wms.js');
var O = require('../js/ontology.js');
var AI = require('../js/wms-ai.js');
var CA = require('../js/central-agent.js');
var AG = require('../js/wms-agent.js');

var failures = 0, passes = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (cond) passes++; else failures++; }
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function keys(list) { return list.map(function (u) { return u.kind + ':' + u.key; }); }
function installed() { var s = W.seed(); W.install(s); W.refresh(s); return s; }

/* A stub /chat: each reply is an object (sent as the model's JSON),
   a { status } for an HTTP error, or 'throw' for no connection. */
function stub(replies) {
  var calls = [];
  var fn = function (url, init) {
    calls.push({ url: url, body: JSON.parse(init.body) });
    var r = replies.length ? replies.shift() : null;
    if (r === 'throw') return Promise.reject(new Error('offline'));
    if (r && r.status) return Promise.resolve({ ok: false, status: r.status, json: function () { return Promise.resolve({}); } });
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ choices: [{ message: { content: JSON.stringify(r) } }] }); } });
  };
  fn.calls = calls;
  return fn;
}
/* The caller's store path, in miniature: apply fn to the working
   state and log what it did (the page uses act → store.mutate). */
function applier(state, log) {
  return function (fn) { var r = fn(state); log.push(r); return Promise.resolve(r); };
}

(async function () {

  /* ---------- 1. the shipped building: ZERO unknowns ------------- */
  check('the raw shipped seed yields zero unknowns', O.detectUnknowns(W.seed()).length === 0);
  check('the installed seed (what the console loads) yields zero unknowns', O.detectUnknowns(installed()).length === 0);
  check('a practice-dressed seed yields zero unknowns', (function () { var p = W.seed(); W.dressPractice(p); W.install(p); W.refresh(p); return O.detectUnknowns(p).length === 0; })());

  /* A worked shift: real WMS operations, every writer the console
     uses. The registry must know every shape they write. */
  var s = installed();
  var mgr = 'u-sam';
  W.schedule(s, { shipmentId: 'IN-1003', doorId: 'Inbound Door 2', day: 'Today', start: '13:00', end: '14:00' }, mgr);
  W.checkIn(s, 'APT-102', mgr);
  W.receive(s, 'IN-1002', [
    { desc: 'Laundry detergent — cases', received: 116, damaged: 4, quote: 'one sixteen, four crushed' },
    { desc: 'Paper towels — cases', received: 120, damaged: 0, quote: 'towels all good' }
  ], { by: 'u-tommy', source: 'voice' });
  W.hold(s, { binId: 'B-04' }, mgr, 'recount needed');
  W.reallocateHeld(s, mgr);
  W.release(s, { binId: 'B-04' }, mgr);
  W.cycleCount(s, ['A-01', 'B-02'], { by: mgr, reason: 'cycle count' });
  W.createMove(s, { fromBinId: 'A-01', toBinId: 'A-02', desc: (s.bins.filter(function (b) { return b.id === 'A-01'; })[0].contents[0] || {}).desc, qty: 1 }, mgr);
  W.setSlot(s, { binId: 'C-01', desc: 'Paper towels — cases', min: 5, max: 40 }, mgr);
  var ord = W.createOrder(s, { customer: 'Test Market', priority: 'normal', shipDate: '2026-11-06', lines: [{ desc: 'Paper towels — cases', qty: 2 }] }, mgr);
  W.releaseWave(s, s.wms.orders.filter(function (o) { return o.status === 'new'; }).map(function (o) { return o.id; }), mgr);
  W.flag(s, { words: 'shrink wrap torn on the end pallet', label: 'Torn wrap', by: 'u-rosa', source: 'voice' });
  s.wms.flags.forEach(function (f) { if (f.status === 'open') W.closeFlag(s, f.id, mgr, 'rewrapped'); });
  (s.wms.osd || []).forEach(function (f) { if (f.status === 'open') W.resolveOsd(s, f.id, mgr, 'carrier credit'); });
  var someTask = s.tasks.filter(function (t) { return t.status !== 'done' && t.type === 'putaway'; })[0];
  if (someTask) W.reassign(s, someTask.id, 'u-tommy', mgr);
  W.proposals(s).slice(0, 1).forEach(function (p) { W.decide(s, p, true, mgr); });
  for (var round = 0; round < 4; round++) {
    s.tasks.filter(function (t) { return t.status !== 'done'; }).forEach(function (t) {
      var by = t.assignee || t.queuedFor || mgr;
      var counted = {};
      W.complete(s, t.id, { by: by, qty: t.qty, cartons: 2, seal: 'S-1', counts: counted, via: 'voice', heard: 'done' });
    });
  }
  (s.wms.loads || []).forEach(function (l) { if (l.status === 'loading') W.closeLoad(s, l.id, { seal: 'SEAL-9', by: mgr }); });
  AG.deskEntry(s, 'bin', 'A-05', { by: mgr, words: "'sweating' means condensation on the bottom bags", source: 'typed' });
  AG.deskEntry(s, 'bin', 'A-05', { by: mgr, words: 'I decided: keep the hold until Monday', source: 'voice' });
  var worked = O.detectUnknowns(s);
  console.log("      shift covered record kinds: " + Object.keys(s.records.reduce(function (m, r) { m[r.kind] = 1; return m; }, {})).sort().join(", "));
  check('setup: the shift really ran (records of many kinds, tasks done)', s.records.length > 15 &&
    s.tasks.some(function (t) { return t.status === 'done'; }) && !!ord);
  check('a worked shift of real WMS operations yields zero unknowns', worked.length === 0);
  if (worked.length) console.log('      unexpected: ' + keys(worked).join(', '));

  /* ---------- 2. each novel shape surfaces exactly one unknown ---- */
  var a = installed();
  a.returns = [{ id: 'RMA-1', orderId: 'ORD-501', reason: 'crushed case', qty: 2 }, { id: 'RMA-2', orderId: 'ORD-502', reason: 'wrong item', qty: 1 }];
  var ua = O.detectUnknowns(a);
  check('a novel state section surfaces exactly one unknown', ua.length === 1 && ua[0].kind === 'section' && ua[0].key === 'returns');
  check('its samples are the real records', ua.length === 1 && ua[0].samples.length === 2 && ua[0].samples[0].id === 'RMA-1');

  var a2 = installed();
  a2.wms.kits = [{ id: 'KIT-1', components: ['A', 'B'] }];
  var ua2 = O.detectUnknowns(a2);
  check('a novel section of the WMS layer surfaces exactly one unknown', ua2.length === 1 && ua2[0].kind === 'section' && ua2[0].key === 'wms.kits');

  var b = installed();
  for (var i = 0; i < 5; i++) {
    b.tasks.push({ id: 't-kit-' + i, type: 'kit', zone: 'C', title: 'Build kit ' + i, detail: 'assemble', status: 'open', assignee: null,
      createdAt: '2026-11-05T10:00:00Z', kitId: 'KIT-' + i, components: [{ desc: 'Paper towels — cases', qty: 1 }] });
  }
  var ub = O.detectUnknowns(b);
  check('a novel task type surfaces exactly one unknown (its novel fields ride with it)', ub.length === 1 &&
    ub[0].kind === 'task-type' && ub[0].key === 'task.kit');
  check('samples are capped at three', ub.length === 1 && ub[0].samples.length === 3);

  var c = installed();
  var pick = c.tasks.filter(function (t) { return t.type === 'pick'; })[0];
  pick.lotNumber = 'LOT-77A';
  var uc = O.detectUnknowns(c);
  check('a novel field on a known task type surfaces exactly one unknown', uc.length === 1 &&
    uc[0].kind === 'field' && uc[0].key === 'task.pick.lotNumber' && uc[0].samples[0].lotNumber === 'LOT-77A');

  var d = installed();
  d.records.push({ ts: '2026-11-05T10:00:00Z', text: 'Recall notice for lot 77A', kind: 'recall', lot: '77A', by: 'u-sam' });
  d.records.push({ ts: '2026-11-05T10:01:00Z', text: 'Held at 41F', kind: 'hold', target: { binId: 'A-01' }, by: 'u-sam', tempF: 41 });
  var ud = O.detectUnknowns(d);
  check('a novel record kind and a novel field on a known record kind: one unknown each', ud.length === 2 &&
    ud[0].kind === 'record-kind' && ud[0].key === 'record.recall' && ud[1].kind === 'field' && ud[1].key === 'record.hold.tempF');
  check('a record with no kind is a plain note, never an unknown', (function () {
    var x = installed(); x.records.push({ ts: 'x', text: 'just a note' }); return O.detectUnknowns(x).length === 0;
  })());

  var before = JSON.stringify(c);
  var u1 = O.detectUnknowns(c);
  u1[0].samples[0].lotNumber = 'CHANGED';
  check('detectUnknowns is pure: state untouched, samples are copies', JSON.stringify(c) === before && pick.lotNumber === 'LOT-77A');
  check('detection is deterministic: the same state, the same list', JSON.stringify(O.detectUnknowns(d)) === JSON.stringify(O.detectUnknowns(d)));
  check('the registry cannot be changed from outside', (function () {
    try { O.KNOWN_SCHEMA.sections.push('returns'); } catch (e) { /* strict mode throws */ }
    return O.KNOWN_SCHEMA.sections.indexOf('returns') === -1 && Object.isFrozen(O.KNOWN_SCHEMA.taskTypes);
  })());

  /* ---------- 3. the ladder: learnConcept ------------------------- */
  var L0 = installed();
  check('the seed has no concepts key; its digest concepts list is empty', !('concepts' in L0) && O.buildDigest(L0).concepts.length === 0);
  L0.returns = [{ id: 'RMA-1', orderId: 'ORD-501', reason: 'crushed case', qty: 2 }];
  var L0s = JSON.stringify(L0);
  var L1 = O.learnConcept(L0, { key: 'returns', kind: 'section', status: 'detected', at: 'T1' });
  check('detected: pure (input untouched), lazy (concepts created), honest shape', JSON.stringify(L0) === L0s && !('concepts' in L0) &&
    JSON.stringify(L1.concepts.returns) === JSON.stringify({ key: 'returns', kind: 'section', name: 'returns', summary: null, connectsTo: [],
      status: 'detected', source: 'ai-inferred', firstSeen: 'T1' }));
  check('a recorded concept is no longer a new unknown', O.newUnknowns(L1).length === 0 && O.detectUnknowns(L1).length === 1);
  check('detected again with nothing new: the same state back', O.learnConcept(L1, { key: 'returns', status: 'detected', at: 'T2' }) === L1);
  check('described without a summary moves nothing', O.learnConcept(L1, { key: 'returns', status: 'described', summary: '  ', at: 'T2' }) === L1);
  check('settling a merely detected concept moves nothing', O.learnConcept(L1, { key: 'returns', status: 'settled', by: 'Sam Whitaker', at: 'T2' }) === L1);
  var L2 = O.learnConcept(L1, { key: 'returns', status: 'described', name: 'Customer returns', summary: 'Goods sent back by customers against an order.',
    connectsTo: ['orders', 'orders', ''], at: 'T2' });
  check('described: the AI reading, labeled ai-inferred, with its time and links', L2.concepts.returns.status === 'described' &&
    L2.concepts.returns.source === 'ai-inferred' && L2.concepts.returns.describedAt === 'T2' && L2.concepts.returns.firstSeen === 'T1' &&
    L2.concepts.returns.name === 'Customer returns' && JSON.stringify(L2.concepts.returns.connectsTo) === '["orders"]');
  check('detected never demotes a described concept', O.learnConcept(L2, { key: 'returns', status: 'detected', note: 'x', at: 'T3' }) === L2);
  check('settle needs a named human', O.learnConcept(L2, { key: 'returns', status: 'settled', at: 'T3' }) === L2);
  var L3 = O.learnConcept(L2, { key: 'returns', status: 'settled', by: 'Sam Whitaker', at: 'T3' });
  check('settled: a human act, recorded with who and when', L3.concepts.returns.status === 'settled' &&
    L3.concepts.returns.settledBy === 'Sam Whitaker' && L3.concepts.returns.settledAt === 'T3' && !('editedBy' in L3.concepts.returns));
  var L3e = O.learnConcept(L2, { key: 'returns', status: 'settled', by: 'Sam Whitaker', summary: 'Customer returns (RMA), received at Inbound Door 3.', at: 'T3' });
  check('settle with an edited summary: the edit is recorded as that person\'s', L3e.concepts.returns.summary === 'Customer returns (RMA), received at Inbound Door 3.' &&
    L3e.concepts.returns.editedBy === 'Sam Whitaker');
  check('a settled concept is never re-described by the AI', O.learnConcept(L3, { key: 'returns', status: 'described', summary: 'Something else', at: 'T4' }) === L3);
  check('a bad status or no key teaches nothing', O.learnConcept(L1, { key: 'returns', status: 'auto-settled' }) === L1 &&
    O.learnConcept(L1, { key: '', status: 'detected' }) === L1);
  var Ln = O.learnConcept(L1, { key: 'returns', status: 'detected', note: 'Meaning not yet inferable from the samples.', at: 'T2' });
  check('detected with an honest note: the note is kept, still detected', Ln.concepts.returns.status === 'detected' &&
    Ln.concepts.returns.note === 'Meaning not yet inferable from the samples.');

  /* ---------- 4. the digest + the one-time announcement ---------- */
  var dg1 = O.buildDigest(L1);
  check('the digest lists the concept with its status', dg1.concepts.length === 1 && dg1.concepts[0].key === 'returns' && dg1.concepts[0].status === 'detected');
  check('a merely detected concept is not announced', O.applyChange(L1, O.buildDigest(L0)).prep.filter(function (n) { return n.about === 'returns'; }).length === 0);
  var dg2 = O.applyChange(L2, dg1);
  var ann = dg2.prep.filter(function (n) { return n.about === 'returns'; });
  check('applyChange announces a newly described concept exactly once, to the manager, labeled AI-inferred', ann.length === 1 &&
    ann[0]['for'] === 'Sam Whitaker' && /New concept in the building: 'Customer returns'/.test(ann[0].note) && /AI-inferred, not yet settled/.test(ann[0].note) &&
    JSON.stringify(Object.keys(ann[0]).sort()) === JSON.stringify(['about', 'for', 'fromChange', 'note']));
  check('the announcement is not repeated on the next refresh', O.applyChange(L2, dg2).prep.filter(function (n) { return n.about === 'returns'; }).length === 0);
  check('a fresh rebuild carries no announcement', O.buildDigest(L2).prep.length === 0);
  check('settling is not a second announcement', O.applyChange(L3, dg2).prep.filter(function (n) { return n.about === 'returns'; }).length === 0);
  check('the digest shows who settled it', O.buildDigest(L3).concepts[0].settledBy === 'Sam Whitaker');

  /* ---------- 5. the describe orchestration (js/wms-ai.js) -------- */
  var seedLog = [], seedFetch = stub([]);
  var seedOut = await AI.refreshConcepts({ state: installed(), fetch: seedFetch, apply: applier(installed(), seedLog) });
  check('the shipped seed: no unknowns, so no AI call and no write', seedOut.length === 0 && seedFetch.calls.length === 0 && seedLog.length === 0);

  var G = installed();
  G.returns = [{ id: 'RMA-1', orderId: 'ORD-501', reason: 'crushed case', qty: 2 }];
  var seenAtCall = null;
  var gLog = [];
  var gFetch = stub([{ inferable: true, name: 'Customer returns', summary: 'Goods sent back by customers against an order.',
    connectsTo: ['orders', 'ORD-501', 'the moon'], evidence: ['orderId', 'reason', 'not in samples'] }]);
  var gWrapped = function (url, init) { seenAtCall = G.concepts && G.concepts.returns ? G.concepts.returns.status : null; return gFetch(url, init); };
  var gOut = await AI.refreshConcepts({ state: G, fetch: gWrapped, apply: applier(G, gLog), now: function () { return 'T9'; } });
  check('the unknown is recorded as detected BEFORE the AI is asked', seenAtCall === 'detected');
  check('the describe call carries the key and the real samples', gFetch.calls.length === 1 &&
    /KEY: returns/.test(gFetch.calls[0].body.messages[1].content) && /RMA-1/.test(gFetch.calls[0].body.messages[1].content) &&
    gFetch.calls[0].body.messages[0].content === AI.DESCRIBE_PROMPT);
  check('a grounded reply moves it to described, AI-inferred', gOut.length === 1 && gOut[0].status === 'described' && gOut[0].saved &&
    G.concepts.returns.status === 'described' && G.concepts.returns.source === 'ai-inferred' && G.concepts.returns.name === 'Customer returns');
  check('connections are kept only when grounded (a known name or a sample value)', JSON.stringify(G.concepts.returns.connectsTo) === '["orders","ORD-501"]');
  check('nothing auto-settles', G.concepts.returns.status !== 'settled' && !('settledBy' in G.concepts.returns));
  check('a second refresh asks nothing (the concept exists)', (await AI.refreshConcepts({ state: G, fetch: gFetch, apply: applier(G, []) })).length === 0 && gFetch.calls.length === 1);

  var H = installed();
  H.wms.kits = [{ id: 'KIT-1' }];
  var hOut = await AI.refreshConcepts({ state: H, fetch: stub([{ inferable: false, why: 'only an id is present' }]), apply: applier(H, []) });
  check('an "inferable: false" reply leaves it detected with the honest note', hOut[0].status === 'detected' &&
    H.concepts['wms.kits'].status === 'detected' && H.concepts['wms.kits'].summary === null &&
    H.concepts['wms.kits'].note.indexOf('Meaning not yet inferable from the samples.') === 0);

  var I = installed();
  I.wms.kits = [{ id: 'KIT-1' }];
  await AI.refreshConcepts({ state: I, fetch: stub([{ inferable: true, name: 'Kits', summary: 'Pre-built bundles of retail goods.', evidence: ['bundleSku'] }]), apply: applier(I, []) });
  check('a confident reply that cites nothing in the samples is ungrounded: stays detected', I.concepts['wms.kits'].status === 'detected' &&
    I.concepts['wms.kits'].summary === null && /not yet inferable/.test(I.concepts['wms.kits'].note));

  var J = installed();
  J.wms.kits = [{ id: 'KIT-1' }];
  var jFetch = stub(['throw', 'throw']);
  var jOut = await AI.refreshConcepts({ state: J, fetch: jFetch, apply: applier(J, []) });
  check('a failed call leaves it detected, says so, and fabricates nothing', jOut[0].failed === true && J.concepts['wms.kits'].status === 'detected' &&
    J.concepts['wms.kits'].summary === null && /did not come back/.test(J.concepts['wms.kits'].note));
  var jAgain = await AI.redescribe({ state: J, fetch: stub([{ inferable: true, name: 'Kits', summary: 'A kit record with its own id.', evidence: ['KIT-1'] }]), apply: applier(J, []) }, 'wms.kits');
  check('asking again (the page\'s button) can describe a detected concept', jAgain.status === 'described' && J.concepts['wms.kits'].status === 'described');

  var K = installed();
  K.alpha = [1]; K.beta = [2]; K.gamma = [3];
  var kFetch = stub([{ inferable: false }, { inferable: false }, { inferable: false }]);
  await AI.refreshConcepts({ state: K, fetch: kFetch, apply: applier(K, []), max: 2 });
  check('at most max unknowns are described per refresh', kFetch.calls.length === 2 && Object.keys(K.concepts).length === 2);

  var M = installed();
  M.returns = [{ id: 'RMA-1' }];
  var mFetch = stub([{ inferable: false }]);
  var mOut = await AI.refreshConcepts({ state: M, fetch: mFetch, apply: function () { return Promise.resolve(null); } });
  check('if the detected write cannot be saved, the AI is not asked', mOut.length === 0 && mFetch.calls.length === 0);

  /* settle through the caller's path (the Ontology page's button) */
  var settle = AI.conceptStep({ key: 'returns', status: 'settled', by: 'Sam Whitaker', summary: G.concepts.returns.summary, at: 'T10' });
  var sr = settle(G);
  check('the page\'s settle step goes through learnConcept and is a human act', sr.ok === true && G.concepts.returns.status === 'settled' &&
    G.concepts.returns.settledBy === 'Sam Whitaker' && !('editedBy' in G.concepts.returns));
  check('settling twice moves nothing and says so', settle(G).ok === false);

  /* ---------- 6. the delegator receives concepts; writes none ---- */
  var N = installed();
  N.returns = [{ id: 'RMA-1', orderId: 'ORD-501' }];
  N = O.learnConcept(N, { key: 'returns', kind: 'section', status: 'detected', at: 'T1' });
  N = O.learnConcept(N, { key: 'returns', status: 'described', name: 'Customer returns', summary: 'Goods sent back against an order.', at: 'T2' });
  var nBefore = JSON.stringify(N);
  var central = CA.createCentralAgent({ state: N });
  var dsp = central.receive({ from: 'Sam Whitaker', text: 'what needs eyes?', kind: 'question' });
  check('the dispatch context carries the concepts, labeled with their status', Array.isArray(dsp.context.concepts) &&
    dsp.context.concepts.length === 1 && dsp.context.concepts[0].status === 'described' && dsp.context.concepts[0].source === 'ai-inferred');
  check('the composed prompt tells the answerer what each status means', /context\.concepts/.test(dsp.prompt) && /never guess its meaning/.test(dsp.prompt));
  check('the delegator wrote nothing into state', JSON.stringify(N) === nBefore);

  /* ---------- 7. the ontology module is still pure --------------- */
  var src = fs.readFileSync(__dirname + '/../js/ontology.js', 'utf8');
  check('ontology.js holds the detector and learnConcept', /function detectUnknowns\(/.test(src) && /function learnConcept\(/.test(src));
  check('ontology.js makes no call and names no AI module', !/fetch\s*\(/.test(src) && src.indexOf('XMLHttpRequest') === -1 &&
    src.indexOf('WitnessWmsAi') === -1 && src.indexOf('wms-ai') === -1 && !/sendRead|\/chat/.test(src));
  var aiSrc = fs.readFileSync(__dirname + '/../js/wms-ai.js', 'utf8');
  check('the describe call lives in wms-ai.js, outside the ontology', /function describeConcept\(/.test(aiSrc) && /function refreshConcepts\(/.test(aiSrc));
  var caSrc = fs.readFileSync(__dirname + '/../js/central-agent.js', 'utf8');
  check('the delegator never calls learnConcept (it only receives concepts)', caSrc.indexOf('learnConcept') === -1);

  console.log('\n' + passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})();
