/* game-data-split-test.js — node, no dependencies.
   Job build step 1 (briefs/claude-brief-game-data-split.md): Walk the
   Shift splits onto its own data. Proves:
     - the LIVE seed files are byte-identical to what they were before
       this build (data/world.js, data/wms-seed.js — pinned hashes);
     - a full game session — every shift type dealt and worked to its
       summary through the store the WMS page uses, the first step by
       voice (gameTurn's complete intent) — leaves the live state
       byte-identical: the shared /state document, the live seed, and
       the seed modules in memory; and the practice store makes zero
       network calls doing it;
     - all four shift types start on the game's own data, and every
       game mutation refuses the live building;
     - no code path loads live data into the game or game data into
       the live record (source scans + the store's refusal).
   Run: node test/game-data-split-test.js   (exit 0 = all pass) */
'use strict';

var fs = require('fs');
var crypto = require('crypto');
var path = require('path');
var E = require('../js/engine.js');
var W = require('../js/wms.js');
var S = require('../js/wms-store.js');
var G = require('../js/wms-game.js');
var WORLD = require('../data/world.js');
var WSEED = require('../data/wms-seed.js');
var GW = require('../data/game-world.js');

var failures = 0, passes = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (cond) passes++; else failures++; }
/* A fixed clock, so two seeds compare byte for byte (flag stamps). */
W.now = function () { return '2026-11-05T08:00:00.000Z'; };
function root(p) { return path.join(__dirname, '..', p); }
function sha(p) { return crypto.createHash('sha256').update(fs.readFileSync(root(p))).digest('hex'); }
function flush() { return new Promise(function (res) { setTimeout(res, 0); }); }

/* ---------- the live seed files: byte-identical ---------------------- */
/* Hashes pinned so the live seed only changes on purpose. Step 1
   (the game split) left both files byte-identical. Step 2 (job
   assignment, briefs/claude-brief-job-assignment.md) changed
   data/world.js once, on purpose: each labor unit gained its
   departments (depts). data/wms-seed.js is still step 1's bytes. */
check('live seed: data/world.js is byte-identical (pinned at job assignment: labor depts)',
  sha('data/world.js') === '6bb48d6a0e125a1db0ce6bba3ab9940c19eff8542e683a7f2d524d779e8497c1');
check('live seed: data/wms-seed.js is byte-identical',
  sha('data/wms-seed.js') === 'bbec2537fa4b8952ca4524208f21b594bb06819c70f9182dee83d14644a33ed2');

/* ---------- no path between the two worlds --------------------------- */
var gameSrc = fs.readFileSync(root('js/wms-game.js'), 'utf8');
var gameData = fs.readFileSync(root('data/game-world.js'), 'utf8');
check('the game module never names the live seed (no WitnessWorldSeed / WitnessWmsSeed / world.js / wms-seed.js / W.seed())',
  !/WitnessWorldSeed|WitnessWmsSeed|data\/world\.js|wms-seed|W\.seed\(\)|seedWorld/.test(gameSrc));
check('the game data file is standalone (requires nothing, names no live seed)',
  !/require\(|WitnessWorldSeed|WitnessWmsSeed/.test(gameData));
check('the live seed files never name the game world',
  !/game-world|WitnessGameWorld/.test(fs.readFileSync(root('data/world.js'), 'utf8') + fs.readFileSync(root('data/wms-seed.js'), 'utf8')));
var uiSrc = fs.readFileSync(root('js/wms-ui.js'), 'utf8');
check('the WMS page seeds its practice copy from the game world (practiceSeed: W.seedGame), and its live path from the live seed',
  /practiceSeed:\s*W\.seedGame/.test(uiSrc) && /seed:\s*W\.seed,/.test(uiSrc) && !/dressPractice/.test(uiSrc));
check('the WMS page loads the game world', /<script src="data\/game-world\.js"><\/script>/.test(fs.readFileSync(root('wms.html'), 'utf8')));

/* ---------- all four shift types start on the game data -------------- */
var gameIds = JSON.stringify(GW.building.inbound.map(function (x) { return x.id; })
  .concat(GW.building.outbound.map(function (x) { return x.id; }), GW.building.staging.map(function (x) { return x.id; })));
G.ROLES.forEach(function (r) {
  var st = W.seedGame();
  var b = G.begin(st, r.id);
  var n = { inbound: 5, outbound: 5, replenishment: 4, counter: 4 }[r.id];
  check('start on game data: ' + r.label + ' deals a full shift (' + n + ' tasks) on the game’s own building',
    st.world === 'game' && b.ok === true && !!b.chain && b.chain.role === r.id && b.chain.steps.length === n);
});
var inC = G.begin(W.seedGame(), 'inbound').chain;
var outC = G.begin(W.seedGame(), 'outbound').chain;
check('start on game data: the dealt work is the game’s own — pallet ' + inC.palletA + ' at Inbound Door 1, order ' + outC.orderId,
  gameIds.indexOf('"' + inC.palletA + '"') !== -1 && outC.orderId === 'ORD-701' &&
  gameIds.indexOf('"' + outC.orderId + '"') !== -1);

G.ROLES.forEach(function (r) {
  var live = W.seed();
  var before = JSON.stringify(live);
  var b = G.begin(live, r.id);
  check('the live building refuses: ' + r.label + ' cannot start on the live seed, and the state is untouched',
    b.ok === false && /only on the game/.test(b.reason) && JSON.stringify(live) === before);
});
(function () {
  var g = W.seedGame();
  var chain = G.begin(g, 'counter').chain;
  var live = W.seed();
  var before = JSON.stringify(live);
  check('every game mutation refuses the live building (performStep, armCount, confirmCount)',
    G.performStep(live, chain, 0).ok === false && G.armCount(live, chain, 0).ok === false &&
    G.confirmCount(live, chain, 0).ok === false && JSON.stringify(live) === before);
})();

/* ---------- a full game session leaves the live state byte-identical - */
/* The shared /state record is a stubbed KV: one document, every call
   logged. A live store reads it the way the desk does; the game plays
   on a practice store built the way the WMS page builds it, handed
   the SAME fetch — so any game call that reached for /state would be
   logged. Then every shift type is dealt and worked to its summary. */

function kv(doc) {
  var log = [];
  var f = function (url, init) {
    var m = (init && init.method) || 'GET';
    log.push(m + ' ' + url);
    if (m === 'GET') return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(JSON.parse(doc)); } });
    doc = init.body;
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true }); } });
  };
  f.log = log; f.doc = function () { return doc; };
  return f;
}
function makeStore(f, practice) {
  return S.create({ fetch: f, seed: W.seed, practiceSeed: W.seedGame, practice: practice,
    prepare: function (s) { W.install(s); W.refresh(s); return s; },
    check: function (s, inPractice) {
      if (inPractice) return W.isGame(s) ? null : 'not the game building';
      return s.world && s.world !== 'warehouse' ? 'not the warehouse' : null;
    } });
}

(async function () {
  var liveDoc = JSON.stringify(W.seed());
  var f = kv(liveDoc);
  var liveStore = makeStore(f, false);
  var liveLoaded = (await liveStore.load()).state;
  var liveBefore = JSON.stringify(liveLoaded);
  var seedBefore = JSON.stringify(W.seed());
  var modsBefore = JSON.stringify(WORLD) + JSON.stringify(WSEED);
  var callsBefore = f.log.length;

  var game = makeStore(f, true);
  var state = (await game.load()).state;
  var talkCalls = 0;
  var ctx = {
    practice: true, base: 'dashboard', render: function () {},
    act: function (fn) {
      return game.mutate(fn).then(function (res) { state = res.state; ctx.state = state; G.afterRender(ctx); return res.result; });
    },
    /* gameTurn, stubbed: META hears "Complete task." and names the complete intent */
    talk: function () { talkCalls++; return Promise.resolve({ intent: 'complete', say: 'Done.' }); }
  };
  ctx.state = state;
  G.reset();
  G.afterRender(ctx);

  async function workToEnd() {
    for (var k = 0; k < 40; k++) {
      var vc = G.voiceContext();
      if (vc.done) return true;
      if (vc.pending === 'count') await G.ui('confirm');
      else {
        var at = vc.step;
        G.ui('doit'); await flush(); await flush();
        /* a step that walks first (a second pallet, a reserve bin) glides before it acts */
        if (!G.voiceContext().done && G.voiceContext().step === at) { await new Promise(function (res) { setTimeout(res, 1000); }); await flush(); }
      }
    }
    return false;
  }

  var summaries = [];
  var voiceWorked = false;
  for (var i = 0; i < G.ROLES.length; i++) {
    var role = G.ROLES[i].id;
    await G.ui('role', role);
    var r = await G.ui('start');
    if (i === 0) {
      /* the first step by voice — gameTurn's complete intent works it */
      var recs = state.records.length;
      G.hear('Complete task.');
      for (var w = 0; w < 6; w++) await flush();
      voiceWorked = talkCalls === 1 && state.records.length > recs && G.voiceContext().step === 2;
    }
    var done = await workToEnd();
    var html = G.panelHtml(function (t, b) { return b; }, state, true);
    summaries.push(!!(r && r.ok) && done && html.indexOf('Shift complete') !== -1);
  }

  check('session: every shift type was dealt on the game’s building and worked to its shift summary',
    summaries.length === 4 && summaries.every(Boolean) && state.world === 'game');
  check('session: the first step was worked by voice through the gameTurn path (META’s complete intent)', voiceWorked);
  check('session: the game really worked — counts posted, an order shipped, a replenishment done, pallets put away',
    state.wms.counts.length >= 4 &&
    state.outbound.some(function (o) { return o.status === 'shipped'; }) &&
    state.tasks.some(function (t) { return t.type === 'replen' && t.status === 'done'; }) &&
    state.tasks.filter(function (t) { return t.type === 'putaway' && t.status === 'done'; }).length >= 2);
  check('session: the game made ZERO calls to the shared /state record', f.log.length === callsBefore);
  check('session: the shared /state document is byte-identical after the session', f.doc() === liveDoc);
  var liveAfter = JSON.stringify((await liveStore.load()).state);
  check('session: the live state read back through the live store is byte-identical', liveAfter === liveBefore);
  check('session: a fresh live seed is byte-identical, and the seed modules in memory are unchanged',
    JSON.stringify(W.seed()) === seedBefore && JSON.stringify(WORLD) + JSON.stringify(WSEED) === modsBefore);
  check('session: nothing of the live building in the game state (its crew, trucks, orders are the game’s own)',
    !/u-sam|u-marcus|IN-100\d|ORD-50\d|ORD-60\d/.test(JSON.stringify(state)));
  check('session: practice-only holds — the start lines say "on a practice copy"',
    state.records.filter(function (x) { return /Walk the shift started/.test(x.text); }).every(function (x) { return /practice copy/.test(x.text); }));

  /* A game state handed to the live store is refused before any POST. */
  var before = f.log.length, err = null;
  try { await liveStore.mutate(function (s) { s.world = 'game'; return { ok: true }; }); } catch (e) { err = e; }
  check('live store: a game state can never be POSTed to /state',
    !!err && err.code === 'game-world' && f.log.slice(before).every(function (l) { return l.indexOf('POST') !== 0; }) && f.doc() === liveDoc);
  /* And the live store refuses a game document sitting in /state. */
  var g2 = kv(JSON.stringify(W.seedGame()));
  var err2 = null;
  try { await makeStore(g2, false).load(); } catch (e) { err2 = e; }
  check('live store: a game document is never loaded as the live warehouse', !!err2 && err2.code === 'other-world');

  console.log('\n' + passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})();
