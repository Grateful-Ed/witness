/* =====================================================================
   state.js — the shared warehouse state, on the desk record.

   Desk-phone brief, Step 2. The warehouse state is ONE JSON document
   in the witness Worker's /state (KV key __warehouse_state__). The
   desk (warehouse.html) and the phone (phone.html) both read and
   write it through this file, so two devices hold one world.

   The three storage functions are async network versions of the
   engine's old localStorage trio:
     loadState()       GET /state. 404 → null. Read-only, never saves.
     saveState(state)  POST /state.
     resetState()      POST a fresh seed world (Reset keeps its meaning).
   And the two shapes every page uses:
     start()           load; on 404 ONLY, seed and POST once.
     mutate(fn)        GET fresh → fn(state) → POST. A result with
                       ok === false saves nothing.

   Rules (from the brief):
     - Never save on page open. Loading is read-only.
     - Network failure → an honest error with plain words. There is
       no local fallback world to act on.
     - localStorage is not a store of truth here. Nothing is mirrored.
     - Last save wins. No versioning or conflict machinery.

   One guard, the same one js/wms-store.js keeps on this same
   document: a KV read can lag a write by a moment, so each save stamps
   state.wmsRev, and a GET that comes back OLDER than the copy this
   page itself last saved uses the page's own copy (it is the newer
   truth, not a guess). Sharing the wmsRev counter keeps the WMS desk
   console's guard honest about saves made from here.

   The document also carries the WMS layer (state.wms) written by
   wms.html. Engine functions mutate in place, so it rides along
   untouched on every save from here.

   Pure of the DOM: fetch is handed in, so node tests stub it.
   Loads in the browser (window.WitnessState) and in node.
   ===================================================================== */
(function (root) {
  'use strict';

  var STATE_URL = 'https://witness.e-william-harris96.workers.dev/state';
  var MAX_CHARS = 480000;   /* the Worker caps /state at 500,000 */
  var KEEP_RECORDS = 400;

  function fail(code, msg) { var e = new Error(code); e.code = code; e.userMessage = msg; return e; }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  /* Keep the document under the Worker's cap: the oldest records go
     first (the newest KEEP_RECORDS always stay). The same trim the
     WMS desk console applies to this document. */
  function fit(state) {
    var text = JSON.stringify(state);
    if (text.length <= MAX_CHARS || !Array.isArray(state.records)) return text;
    var s = copy(state);
    if (s.records.length > KEEP_RECORDS) s.records = s.records.slice(-KEEP_RECORDS);
    text = JSON.stringify(s);
    while (text.length > MAX_CHARS && s.records.length > 50) {
      s.records = s.records.slice(Math.floor(s.records.length / 4));
      text = JSON.stringify(s);
    }
    return text;
  }

  /* opts: {
       fetch          — the fetch to use (required)
       url            — /state URL (default: the live Worker)
       seed()         — a fresh world, tasks generated (required)
       prepare(state) — run on every loaded state before use (optional)
     } */
  function create(opts) {
    var doFetch = opts.fetch;
    var url = opts.url || STATE_URL;
    var lastSaved = null;

    function prepare(s) { return opts.prepare ? opts.prepare(s) || s : s; }

    function loadState() {
      return Promise.resolve().then(function () {
        return doFetch(url, { method: 'GET', cache: 'no-store' });
      }).then(function (r) {
        if (r.status === 404) return null;
        if (r.status === 501) throw fail('storage', 'The shared warehouse state is not connected at the Worker. Nothing was loaded.');
        if (r.status === 403) throw fail('origin', 'The Worker refused this page\'s address. Open this page from grateful-ed.github.io/witness. Nothing was loaded.');
        if (!r.ok) throw fail('http', 'The shared warehouse state answered with an error (HTTP ' + r.status + '). Nothing was loaded.');
        return r.json().catch(function () { throw fail('bad-json', 'The shared warehouse state came back unreadable. Nothing was loaded.'); });
      }, function (e) {
        if (e && e.userMessage) throw e;
        throw fail('network', 'The shared warehouse state could not be reached. Check the connection and reload. Nothing was loaded.');
      }).then(function (s) {
        if (s && (typeof s !== 'object' || !s.bins || !s.labor)) throw fail('bad-shape', 'The shared warehouse state is not a warehouse. Nothing was loaded.');
        if (s && lastSaved && (s.wmsRev || 0) < (lastSaved.wmsRev || 0)) return copy(lastSaved);
        return s;
      });
    }

    function saveState(state) {
      state.wmsRev = Math.max(state.wmsRev || 0, lastSaved ? lastSaved.wmsRev || 0 : 0) + 1;
      var text = fit(state);
      return Promise.resolve().then(function () {
        return doFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text });
      }).then(function (r) {
        if (r.status === 413) throw fail('too-large', 'The shared warehouse state is full (HTTP 413). Nothing was saved.');
        if (!r.ok) throw fail('http', 'The shared warehouse state refused the save (HTTP ' + r.status + '). Nothing was saved.');
        lastSaved = JSON.parse(text);
        return state;
      }, function (e) {
        if (e && e.userMessage) throw e;
        throw fail('network', 'The save did not reach the shared warehouse state. Check the connection. Nothing was saved.');
      });
    }

    function resetState() {
      var s = opts.seed();
      return saveState(s);
    }

    return {
      loadState: loadState,
      saveState: saveState,
      resetState: resetState,

      /* Page open. Read-only, except the very first open anywhere
         (404): then the seed world is POSTed once. */
      start: function () {
        return loadState().then(function (s) {
          if (s) return { state: prepare(s), seeded: false };
          var fresh = opts.seed();
          return saveState(fresh).then(function () { return { state: fresh, seeded: true }; });
        });
      },

      /* Every mutating action: fetch fresh, apply, save. */
      mutate: function (fn) {
        return loadState().then(function (s) {
          if (!s) throw fail('empty', 'The shared warehouse state is gone (someone may be resetting it). Reload the page. Nothing was done.');
          s = prepare(s);
          var result = fn(s);
          if (result && result.ok === false) return { state: s, result: result, saved: false };
          return saveState(s).then(function () { return { state: s, result: result, saved: true }; });
        });
      }
    };
  }

  var api = { create: create, STATE_URL: STATE_URL, MAX_CHARS: MAX_CHARS, fit: fit };
  root.WitnessState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
