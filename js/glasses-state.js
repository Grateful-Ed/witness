/* =====================================================================
   glasses-state.js — the warehouse glasses on the shared record.

   Brief: briefs/claude-brief-glasses-shared-state.md (William,
   2026-11-05: "I would like the warehouse glasses to be a part of the
   WMS"). The desk and the phone already hold the warehouse in the
   Worker's /state document, through js/state.js. This file puts the
   glasses on that same document — WITHOUT changing js/glasses.js.

   How (the adapter route):
   - glasses.js reads and writes warehouse state only through its
     Store block, which calls the engine trio E.loadState() /
     E.saveState(s) with no store argument. The trio accepts any
     localStorage-shaped store. So this file holds the shared document
     in a localStorage-shaped MEMORY store, and hands glasses.js an
     engine view (the real engine, with the trio defaulting to that
     memory store). glasses.js reads root.WitnessEngine once, at its
     own load; the real engine goes back on window right after.
   - Hydrate, then boot: the document is fetched (js/state.js start():
     a 404 seeds once through the shared path) BEFORE glasses.js is
     injected. The scripts named on this file's tag (data-boot) are
     then injected one after another, in that order — glasses.js,
     then recorder.js, then glasses-help.js, as before.
   - A boot that cannot reach the record STOPS, in plain words on the
     start screen. There is no local world to fall back to.
   - Writes go through: the memory store's setItem posts the whole
     document through js/state.js saveState (the same wmsRev stamp and
     trim; state.wms rides along). A failed post is said on the
     glasses in plain words; the work stays on the memory copy and the
     next save posts the whole document again (last save wins).
   - Freshness: the document is re-fetched on boot, when the page
     becomes visible again, and after each of the glasses' own saves
     lands. A re-fetch never overwrites a change that has not reached
     the record yet.

   The kitchen world (?world=kitchen) is not touched: the same three
   scripts are written in place, synchronously, exactly as the static
   tags ran before. No wrapping, no fetch, no /state call.

   CORE (memory store, engine view, sync) is pure and exported to node
   for test/glasses-state-test.js. PAGE runs only in a browser.
   ===================================================================== */
(function (root) {
  'use strict';

  var DEFAULT_BOOT = ['js/glasses.js', 'js/recorder.js', 'js/glasses-help.js'];
  var STATE_SRC = 'js/state.js';
  var GATE_SRC = 'js/gate.js';

  var STOP_HEAD = 'The shared warehouse record could not be reached, so the glasses view did not open.';
  var LOADING_LINE = 'Loading the shared warehouse record…';
  var SAVE_FAIL_TAIL = ' Your work is kept on these glasses, and the next change will try the save again.';

  /* ================================================================
     CORE — pure
     ================================================================ */

  /* A localStorage-shaped store holding one document. setItem is a
     write from the page (it calls onWrite); put() is the adapter
     placing a fetched document (no write back). */
  function memoryStore(onWrite) {
    var m = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); if (onWrite) onWrite(k, m[k]); },
      removeItem: function (k) { delete m[k]; },
      put: function (k, v) { m[k] = String(v); }
    };
  }

  /* The real engine, with the storage trio defaulting to `store`.
     Every other engine function is the engine's own (prototype). */
  function engineView(E, store) {
    var v = Object.create(E);
    v.loadState = function (s) { return E.loadState(s || store); };
    v.saveState = function (state, s) { return E.saveState(state, s || store); };
    v.resetState = function (s) { return E.resetState(s || store); };
    return v;
  }

  /* opts: {
       state      — a js/state.js client (WitnessState.create(...))
       key        — the engine's STORAGE_KEY
       onSaveError(err), onSaveOk() — surface save outcomes (optional)
     }
     Returns { store, hydrate, refresh, flush, pending } */
  function createSync(opts) {
    var client = opts.state, key = opts.key;
    var gen = 0;          /* bumped on every write from the page */
    var savedGen = 0;     /* the newest write that reached the record */
    var chain = Promise.resolve();
    var store = memoryStore(function () { gen++; schedule(); });

    function dirty() { return savedGen !== gen; }

    function place(doc) { store.put(key, JSON.stringify(doc)); }

    /* Boot: the document, or a seed posted once on 404. Rejects with
       state.js's own plain-words error when the record can't be had. */
    function hydrate() {
      return client.start().then(function (r) { place(r.state); return r; });
    }

    /* Re-fetch into the memory store. Skipped while a page write has
       not reached the record — the newer truth is the local one. */
    function refresh() {
      if (dirty()) return Promise.resolve(false);
      var g = gen;
      return client.loadState().then(function (doc) {
        if (!doc || g !== gen || dirty()) return false;
        place(doc);
        return true;
      }, function () { return false; /* a missed refresh is not an error; the next one tries */ });
    }

    /* Posts are one at a time, in order; each posts the WHOLE latest
       document (writes made while one is in flight coalesce). */
    function schedule() {
      chain = chain.then(function () {
        if (!dirty()) return;
        var g = gen;
        var raw = store.getItem(key);
        if (!raw) return;
        return client.saveState(JSON.parse(raw)).then(function () {
          savedGen = Math.max(savedGen, g);
          if (opts.onSaveOk) opts.onSaveOk();
          if (!dirty()) return refresh();
        }, function (e) {
          if (opts.onSaveError) opts.onSaveError(e);
        });
      });
      return chain;
    }

    return {
      store: store,
      hydrate: hydrate,
      refresh: refresh,
      flush: function () { return chain; },
      pending: dirty
    };
  }

  function bootList(attr) {
    var l = String(attr || '').split(/\s+/).filter(Boolean);
    return l.length ? l : DEFAULT_BOOT.slice();
  }

  function stopWords(err) {
    var detail = err && err.userMessage ? err.userMessage : 'Nothing was loaded.';
    return { head: STOP_HEAD, detail: detail + ' Reload the page to try again.' };
  }

  function saveFailWords(err) {
    var m = err && err.userMessage ? err.userMessage : 'The save did not reach the shared warehouse record.';
    return m + SAVE_FAIL_TAIL;
  }

  var core = {
    DEFAULT_BOOT: DEFAULT_BOOT, STOP_HEAD: STOP_HEAD,
    memoryStore: memoryStore, engineView: engineView, createSync: createSync,
    bootList: bootList, stopWords: stopWords, saveFailWords: saveFailWords
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = core; return; }
  root.WitnessGlassesState = core;
  if (typeof document === 'undefined') return;

  /* ================================================================
     PAGE
     ================================================================ */

  var me = document.currentScript;
  var list = bootList(me && me.getAttribute('data-boot'));

  /* The gate (js/gate.js, the gate build): converse routes every act
     through it and reads it lazily, at the first turn. glasses.html is
     frozen, so the gate rides in here: fetched now, while the page is
     still loading, in both worlds. Its tag leaves the document once the
     gate is loaded, so the pinned boot sequence of script tags is
     exactly what it was. */
  if (!root.WitnessGate) {
    var gateTag = document.createElement('script');
    gateTag.src = GATE_SRC;
    gateTag.onload = function () { if (gateTag.parentNode) gateTag.parentNode.removeChild(gateTag); };
    (document.head || document.documentElement).appendChild(gateTag);
  }
  var W = root.WitnessWorlds;

  /* ---------- kitchen: exactly as before ---------------------------- */
  if (W && W.current === 'kitchen') {
    if (document.readyState === 'loading') {
      /* Parser-inserted, in order, right here — the same boot the
         static tags gave. */
      document.write(list.map(function (src) { return '<script src="' + src + '"><\/script>'; }).join(''));
    } else {
      injectInOrder(list.slice(), null);
    }
    return;
  }

  /* ---------- warehouse: hydrate, then boot ------------------------- */
  function $(id) { return document.getElementById(id); }

  function injectOne(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('script ' + src)); };
      document.body.appendChild(s);
    });
  }

  function injectInOrder(srcs, afterFirst) {
    var p = Promise.resolve();
    srcs.forEach(function (src, i) {
      p = p.then(function () { return injectOne(src); }).then(function () { if (i === 0 && afterFirst) afterFirst(); });
    });
    return p;
  }

  var startNote = null;
  function startLine(text, isError) {
    var host = $('start');
    if (!host) return;
    if (!startNote) {
      startNote = document.createElement('p');
      startNote.id = 'gsStart';
      startNote.setAttribute('role', isError ? 'alert' : 'status');
      startNote.style.cssText = 'margin:12px 0;padding:10px 12px;border-radius:6px;font:15px/1.45 system-ui,sans-serif;';
      var btn = $('openBtn');
      host.insertBefore(startNote, btn || null);
    }
    startNote.setAttribute('role', isError ? 'alert' : 'status');
    startNote.style.background = isError ? '#4a1416' : '#1d2430';
    startNote.style.color = isError ? '#ffd9d6' : '#dfe6f0';
    startNote.textContent = text;
    startNote.hidden = !text;
  }

  /* Save outcomes, on the glasses (start screen or view). */
  var saveNote = null;
  function saveLine(text) {
    if (!saveNote) {
      if (!text) return;
      saveNote = document.createElement('p');
      saveNote.id = 'gsSave';
      saveNote.setAttribute('role', 'alert');
      saveNote.style.cssText = 'position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top, 0px) + 10px);z-index:50;margin:0;' +
        'padding:8px 12px;border-radius:6px;background:rgba(74,20,22,0.92);color:#ffd9d6;font:14px/1.4 system-ui,sans-serif;';
      document.body.appendChild(saveNote);
    }
    saveNote.textContent = text || '';
    saveNote.hidden = !text;
  }

  function stop(err) {
    var w = stopWords(err);
    startLine(w.head + ' ' + w.detail, true);
    var btn = $('openBtn');
    if (btn) btn.hidden = true;
    var pick = $('pickList');
    if (pick) pick.hidden = true;
  }

  var openBtn = $('openBtn');
  if (openBtn) openBtn.disabled = true;
  startLine(LOADING_LINE, false);

  var E = root.WitnessEngine;
  injectOne(STATE_SRC).then(function () {
    var client = root.WitnessState.create({
      fetch: root.fetch.bind(root),
      seed: function () { var s = E.seedWorld(); E.generateTasks(s); return s; },
      prepare: function (s) { E.upgradeState(s); E.generateTasks(s); return s; }
    });
    var sync = createSync({
      state: client,
      key: E.STORAGE_KEY,
      onSaveError: function (e) { saveLine(saveFailWords(e)); },
      onSaveOk: function () { saveLine(null); }
    });
    return sync.hydrate().then(function (r) {
      if (W && W.stateWorld(r.state) !== 'warehouse') {
        var e = new Error('world');
        e.userMessage = 'The shared record does not hold a warehouse. Nothing was loaded.';
        throw e;
      }
      return sync;
    });
  }).then(function (sync) {
    root.WitnessGlassesSync = sync;
    startLine(null);
    if (openBtn) openBtn.disabled = false;
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') sync.refresh();
    });
    /* glasses.js takes the engine view at its own load; the real
       engine goes straight back for every script after it. */
    root.WitnessEngine = engineView(E, sync.store);
    injectInOrder(list.slice(), function () { root.WitnessEngine = E; }).catch(function () { root.WitnessEngine = E; });
  }, function (e) {
    stop(e && e.userMessage ? e : null);
  });
})(typeof window !== 'undefined' ? window : globalThis);
