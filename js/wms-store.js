/* =====================================================================
   wms-store.js — the desk record for the WMS page.

   State lives on the desk record: the witness Worker's /state (one
   JSON document in KV). The page never treats the browser as the
   truth. The rules (from the desk-phone brief):
     - Loading is read-only. GET /state; never save on page open.
     - 404 → seed the WMS building and POST it once.
     - Network failure → say so plainly. No silent local fallback.
     - Every mutation: GET fresh → apply → POST. Rendering between
       actions uses the in-memory copy.
     - Reset POSTs a fresh seed.
     - Last save wins. No conflict machinery, by design.

   One guard, not machinery: KV reads can lag a write by a moment.
   Each save stamps state.wmsRev; if a GET comes back OLDER than the
   copy this page itself last saved, the page's own copy is used (it
   is the newer truth, not a guess).

   Practice mode (?practice=1, or the page's explicit button after a
   failure) runs on an in-memory copy and says so on every screen. It
   is never written anywhere.

   Pure of the DOM: fetch is handed in, so node tests stub it.
   Loads in the browser (window.WitnessWmsStore) and in node.
   ===================================================================== */
(function (root) {
  'use strict';

  var STATE_URL = 'https://witness.e-william-harris96.workers.dev/state';
  var MAX_CHARS = 480000;   /* the Worker caps /state at 500,000 */
  var KEEP_RECORDS = 400;

  function fail(code, msg) { var e = new Error(code); e.code = code; e.userMessage = msg; return e; }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  /* Keep the document under the Worker's cap: the oldest records go
     first (the newest KEEP_RECORDS always stay). */
  function fit(state) {
    var text = JSON.stringify(state);
    if (text.length <= MAX_CHARS) return text;
    var s = copy(state);
    if (s.records.length > KEEP_RECORDS) s.records = s.records.slice(-KEEP_RECORDS);
    text = JSON.stringify(s);
    while (text.length > MAX_CHARS && s.records.length > 50) {
      s.records = s.records.slice(Math.floor(s.records.length / 4));
      text = JSON.stringify(s);
    }
    return text;
  }

  /* opts: { fetch, url, seed(): state, prepare(state): state, check(state): string|null, practice: bool,
       dressPractice(state): void — optional; applied to a freshly seeded state in practice mode ONLY,
       so a practice copy can be dressed (stocked fuller) without the seed — or the desk record —
       ever changing. Never applied on the live path, reset included. } */
  function create(opts) {
    var doFetch = opts.fetch;
    var url = opts.url || STATE_URL;
    var practice = !!opts.practice;
    var mem = null;          /* practice-mode document */
    var lastSaved = null;    /* the copy this page last POSTed */

    function prepare(s) { return opts.prepare ? opts.prepare(s) : s; }

    /* The one place fresh states come from. Dressing hangs off the
       store's own practice flag — not the URL — so entering practice
       from the page's fallback button dresses too, and a live seed
       (first open, reset) is always the raw seed. */
    function seedState() {
      var s = opts.seed();
      if (practice && opts.dressPractice) opts.dressPractice(s);
      return s;
    }

    function get() {
      if (practice) return Promise.resolve(mem ? copy(mem) : null);
      return Promise.resolve().then(function () {
        return doFetch(url, { method: 'GET', cache: 'no-store' });
      }).then(function (r) {
        if (r.status === 404) return null;
        if (r.status === 501) throw fail('storage', 'The desk record is not connected at the Worker (storage-not-connected). Nothing was loaded.');
        if (r.status === 403) throw fail('origin', 'The Worker refused this page\'s address (origin not allowed). Open the WMS from grateful-ed.github.io/witness, or use practice mode.');
        if (!r.ok) throw fail('http', 'The desk record answered with an error (HTTP ' + r.status + '). Nothing was loaded.');
        return r.json().catch(function () { throw fail('bad-json', 'The desk record came back unreadable. Nothing was loaded.'); });
      }, function (e) {
        if (e && e.userMessage) throw e;
        throw fail('network', 'The desk record could not be reached. Check the connection. Nothing was loaded, and nothing on this page is pretend.');
      }).then(function (s) {
        if (s && lastSaved && (s.wmsRev || 0) < (lastSaved.wmsRev || 0)) return copy(lastSaved);
        return s;
      });
    }

    function post(state) {
      state.wmsRev = Math.max(state.wmsRev || 0, lastSaved ? lastSaved.wmsRev || 0 : 0) + 1;
      state.wmsSavedAt = new Date().toISOString();
      var text = fit(state);
      if (practice) { mem = JSON.parse(text); lastSaved = copy(mem); return Promise.resolve(state); }
      return Promise.resolve().then(function () {
        return doFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text });
      }).then(function (r) {
        if (r.status === 413) throw fail('too-large', 'The desk record is full (HTTP 413). Nothing was saved.');
        if (!r.ok) throw fail('http', 'The desk record refused the save (HTTP ' + r.status + '). Nothing was saved.');
        lastSaved = JSON.parse(text);
        return state;
      }, function (e) {
        if (e && e.userMessage) throw e;
        throw fail('network', 'The save did not reach the desk record. Check the connection. Nothing was saved.');
      });
    }

    function seedAndSave() {
      var s = seedState();
      return post(s).then(function () { return { state: s, seeded: true }; });
    }

    var api = {
      practice: function () { return practice; },
      enterPractice: function () { practice = true; mem = null; lastSaved = null; },

      /* Read-only load. Seeds (one POST) only when nothing exists. */
      load: function () {
        return get().then(function (s) {
          if (!s) return seedAndSave();
          var why = opts.check ? opts.check(s) : null;
          if (why) throw fail('other-world', why);
          return { state: prepare(s), seeded: false };
        });
      },

      /* Fresh read → fn(state) → save. fn returns a result; a result
         with ok === false saves nothing. Resolves { state, result }. */
      mutate: function (fn) {
        return get().then(function (s) {
          if (!s) s = seedState();
          var why = opts.check ? opts.check(s) : null;
          if (why) throw fail('other-world', why);
          s = prepare(s);
          var result = fn(s);
          if (result && result.ok === false) return { state: s, result: result, saved: false };
          return post(s).then(function () { return { state: s, result: result, saved: true }; });
        });
      },

      reset: function () { return seedAndSave(); }
    };
    return api;
  }

  var exported = { create: create, STATE_URL: STATE_URL, MAX_CHARS: MAX_CHARS, fit: fit };
  root.WitnessWmsStore = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof window !== 'undefined' ? window : globalThis);
