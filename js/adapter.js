/* =====================================================================
   adapter.js — the host-WMS adapter: the write seam under the gate
   (briefs/claude-brief-adapter.md; the standard is aware note 38).

   Witness is not a WMS. It sits on the customer's own WMS (the HOST),
   and every act it carries goes through the host's own published
   interfaces, never its database. The gate (js/gate.js) owns the
   laws; an adapter owns only the carrying.

   THE CONTRACT. An adapter is:
     {
       profile: {
         id:        'dummy-wms' | 'sim-host' | ...,
         hostLabel: the host's name in plain words, as a refusal says it,
         transport: 'sync' | 'async',
         keyed:     true when every submission carries an idempotency
                    key (always true on an async transport),
         verbs:     { complete, flag, 'post-receiving', 'confirm-load' }
                    — the gate's act vocabulary; only the verbs set
                    true are declared. An undeclared verb is never
                    submitted: the gate refuses it at check 1
                    (capability honesty).
       },
       submit(state, act) -> the immediate outcome:
         sync:   the landing itself — { ok: true, ...the engine's
                 result } or { ok: false, reason };
         async:  { ok: true, sent: true, key } (the host has it; its
                 verdict comes later), or { ok: false, reason } when
                 the transport refused it outright.
       confirm(state, key, verdict) — async only: the host's verdict,
         delivered against the act's key when it arrives.
           verdict: 'landed' | { status: 'landed' }
                  | { status: 'refused', reason: <the host's words> }
         'landed' runs the act's effect through the one land path
         (below) and marks the entry settled; 'refused' marks it
         refused with the host's reason, and the task stays open.
         A verdict for an unknown or already-settled key is ignored,
         never double-applied.
     }

   act (what the gate hands submit): { key, via, who, intent, target,
     params: { plan, label, zone, zoneNote }, words } — plain data,
     so an async act can be carried, recorded, and landed later.

   The adapter only ever carries ALREADY-SIGNED acts (note 29): the
   signature stays human and stays in Witness; the gate refuses a
   signed act at check 2, before any adapter is reached.

   Two adapters live here:
     - DUMMY: the demo WMS in this repo (js/wms.js), wrapped. Sync,
       every verb declared, in-process (no key needed: the landing IS
       the record's transaction). The default on every current
       surface; live behavior is unchanged.
     - simulatedHost(opts): a TEST DOUBLE of an async host, with its
       own shadow record. Labeled "the host system (simulated)"
       wherever it speaks. Not wired to any live surface; exercised
       in test/adapter-test.js only.

   Pure: no DOM, no network. Loads in the browser
   (window.WitnessAdapter) and in node (module.exports).
   ===================================================================== */
(function (root) {
  'use strict';

  function wms() {
    var W = root.WitnessWms || null;
    if (!W && typeof require === 'function') {
      try { W = require('./wms.js'); } catch (e) { W = null; }
    }
    return W;
  }
  function gate() {
    var g = root.WitnessGate || null;
    if (!g && typeof require === 'function') {
      try { g = require('./gate.js'); } catch (e) { g = null; }
    }
    return g;
  }

  /* The gate's act vocabulary — the verbs a profile may declare. */
  var VERBS = ['complete', 'flag', 'post-receiving', 'confirm-load'];
  var SENT = 'sent', LANDED = 'landed', REFUSED = 'refused';

  function no(reason) { return { ok: false, reason: reason }; }
  function copy(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }
  function find(list, pred) {
    var l = list || [];
    for (var i = 0; i < l.length; i++) if (pred(l[i])) return l[i];
    return null;
  }
  function now() { var W = wms(); return W && W.now ? W.now() : new Date().toISOString(); }

  /* ---------- the one land path for the WMS world ------------------ */
  /* The act's effect, through the WMS layer's public paths only
     (W.complete, W.flag) — exactly what the gate's run did before
     this build. The dummy's sync submit is this call; an async
     host's 'landed' verdict is this call, later. */
  function land(state, act) {
    var W = wms();
    if (!W) return no('The WMS layer is not loaded. Nothing was done.');
    var p = act.params || {};
    if (act.intent === 'complete') {
      var pl = p.plan || {};
      var r = W.complete(state, act.target, { by: act.who, qty: pl.qty, binId: pl.binId, counts: pl.counts, cartons: pl.cartons, words: act.words });
      if (!r.ok) return no(r.reason + ' Nothing was closed.');
      return r;
    }
    if (act.intent === 'flag') {
      var fo = { unitId: act.who, words: act.words, label: p.label, source: 'voice' };
      if ('zone' in p) fo.zone = p.zone;
      if (p.zoneNote) fo.zoneNote = p.zoneNote;
      var f = W.flag(state, fo);
      if (!f.ok) return no(f.reason + ' Nothing was filed.');
      return f;
    }
    /* The signed verbs never reach here from an agent door (check 2);
       the desk's own signing screens are not on this path yet. */
    return no('The act did not go through. Nothing was done.');
  }

  /* ---------- the dummy: today's WMS, wrapped ----------------------- */
  var DUMMY = {
    profile: {
      id: 'dummy-wms',
      hostLabel: 'the demo WMS',
      transport: 'sync',
      keyed: false,
      verbs: { complete: true, flag: true, 'post-receiving': true, 'confirm-load': true }
    },
    submit: function (state, act) { return land(state, act); }
  };

  /* ---------- the confirmation handler (async adapters) ------------- */
  function verdictOf(v) {
    if (v === LANDED) return { status: LANDED };
    if (v && typeof v === 'object' && (v.status === LANDED || v.status === REFUSED)) {
      return v.status === LANDED ? { status: LANDED }
        : { status: REFUSED, reason: String(v.reason || '').trim() || 'The host refused it and gave no reason.' };
    }
    return null;
  }

  function confirmSent(state, key, verdict) {
    var entry = state ? find(state.sentActs, function (e) { return e && e.key === key; }) : null;
    if (!entry) return { ok: false, ignored: true, reason: 'No act was sent under that key. Nothing changed.' };
    if (entry.status !== SENT) return { ok: false, ignored: true, reason: 'That act is already settled (' + entry.status + '). Nothing changed.' };
    var v = verdictOf(verdict);
    if (!v) return { ok: false, ignored: true, reason: 'That is not a verdict. Nothing changed.' };
    if (v.status === REFUSED) {
      entry.status = REFUSED;
      entry.reason = v.reason;
      entry.settledAt = now();
      return { ok: true, status: REFUSED, reason: v.reason, entry: entry };
    }
    /* Landed: the host's transaction committed. The effect lands in
       Witness's view once, through the one land path, attributed by
       the gate's check-6 writer. */
    var r = gate().settle(state, entry);
    entry.status = LANDED;
    entry.settledAt = now();
    if (!r.ok) entry.localRefusal = r.reason;
    return { ok: true, status: LANDED, result: r, entry: entry };
  }

  /* ---------- the simulated host: an async test double -------------- */
  /* Its own shadow record (ledger: the transactions it committed),
     an inbox of submissions not yet processed, and the keys it has
     ever received (a duplicate submission is dropped by key). It
     confirms most acts "after a beat" (beat(): process the inbox,
     return the verdicts); its rule refuses an act on a task it holds
     (hold(taskId)) with a host-flavored reason. By default it does
     NOT declare 'flag' — the verb capability honesty is pinned on. */
  function simulatedHost(opts) {
    opts = opts || {};
    var verbs = opts.verbs || { complete: true, 'post-receiving': true, 'confirm-load': true };
    var host = {
      profile: {
        id: 'sim-host',
        hostLabel: 'the host system (simulated)',
        transport: 'async',
        keyed: true,
        simulated: true,
        verbs: verbs
      },
      ledger: [],
      inbox: [],
      seen: {},
      holds: {},
      dropped: 0,
      confirm: confirmSent
    };
    host.hold = function (taskId, why) { host.holds[taskId] = why || 'cycle count in progress'; };
    host.submit = function (state, act) {
      if (!act || !act.key) return no('The host system (simulated) needs an idempotency key on every call. Nothing was sent.');
      if (host.seen[act.key]) { host.dropped++; return { ok: true, sent: true, key: act.key, duplicate: true }; }
      host.seen[act.key] = true;
      host.inbox.push(copy(act));
      return { ok: true, sent: true, key: act.key };
    };
    /* The beat: the host works its inbox. Each act is committed to its
       shadow record or refused by its rules. Returns the verdicts, in
       order, for the surface to deliver through confirm. */
    host.beat = function () {
      var out = [];
      host.inbox.splice(0).forEach(function (a) {
        var why = a.target && host.holds[a.target];
        if (why) {
          out.push({ key: a.key, verdict: { status: REFUSED, reason: 'HOST-409: task ' + a.target + ' is locked in the host system (simulated) — ' + why + '.' } });
          return;
        }
        host.ledger.push({ key: a.key, intent: a.intent, target: a.target || null, who: a.who });
        out.push({ key: a.key, verdict: { status: LANDED } });
      });
      return out;
    };
    /* A beat with its verdicts delivered to the state, as a surface's
       listener would (no live listener exists in this build). */
    host.deliver = function (state) {
      return host.beat().map(function (v) { return host.confirm(state, v.key, v.verdict); });
    };
    return host;
  }

  /* ---------- the current adapter ----------------------------------- */
  var current = DUMMY;

  function check(a) {
    var p = a && a.profile;
    if (!p || !p.id || !p.hostLabel) return 'An adapter needs a profile with an id and a hostLabel.';
    if (p.transport !== 'sync' && p.transport !== 'async') return 'An adapter\'s transport is sync or async.';
    if (!p.verbs || typeof p.verbs !== 'object') return 'An adapter declares its verbs.';
    for (var k in p.verbs) if (Object.prototype.hasOwnProperty.call(p.verbs, k) && VERBS.indexOf(k) === -1) return 'Unknown verb in the profile: ' + k + '.';
    if (typeof a.submit !== 'function') return 'An adapter submits.';
    if (p.transport === 'async' && (typeof a.confirm !== 'function' || !p.keyed)) return 'An async adapter is keyed and has a confirmation channel.';
    return null;
  }

  function use(a) {
    var why = check(a);
    if (why) throw new Error(why);
    current = a;
    return a;
  }

  var api = {
    VERBS: VERBS,
    SENT: SENT, LANDED: LANDED, REFUSED: REFUSED,
    dummy: DUMMY,
    land: land,
    confirm: confirmSent,
    simulatedHost: simulatedHost,
    check: check,
    use: use,
    current: function () { return current; }
  };
  root.WitnessAdapter = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
