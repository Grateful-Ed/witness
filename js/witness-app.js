/* =====================================================================
   witness-app.js — the Witness desk application (app.html).

   Witness is not a WMS. This is Witness's OWN desk surface — where
   Witness lives for a client: the client configuration, the
   connection to the client's WMS (the adapter profile and the host
   API key), and the ontology's settle queue. The record page
   (warehouse.html) is one of its screens under the same navigation.

   The app reads and writes the SAME shared state as every other
   surface, through js/state.js. It owns no world of its own.

   Loads in the browser (window.WitnessApp) and in node
   (module.exports) — the pure pieces (config transforms, key
   masking, tile assembly, the settle step) are the testable core;
   the browser boot at the bottom only renders and wires them.
   ===================================================================== */
(function (root) {
  'use strict';

  var Ont = (typeof module !== 'undefined' && module.exports) ? require('./ontology.js') : root.WitnessOntology;
  var Adp = (typeof module !== 'undefined' && module.exports) ? require('./adapter.js') : root.WitnessAdapter;

  /* ---------------- the client configuration ---------------- */

  function configOf(state) {
    return (state && state.clientConfig) || {};
  }

  function siteNameOf(state) {
    var n = configOf(state).siteName;
    return (typeof n === 'string' && n.trim()) ? n.trim() : 'Witness';
  }

  /* The key is shown as bullets + its last four characters, never
     more. A shorter key shows fewer; nothing shows the value. */
  function maskOf(hostKey) {
    if (!hostKey || !hostKey.lastFour) return null;
    return '••••••••' + hostKey.lastFour;
  }

  /* The mutate-style transforms: each edits a draft state in place
     (js/state.js's mutate contract) and returns nothing. */
  function withSiteName(state, name) {
    state.clientConfig = configOf(state);
    var n = String(name == null ? '' : name).trim();
    if (n) state.clientConfig.siteName = n; else delete state.clientConfig.siteName;
  }

  function applyHostKey(state, value, atISO) {
    var v = String(value == null ? '' : value).trim();
    if (!v) return { ok: false, reason: 'That key is empty — nothing was saved.' };
    state.clientConfig = configOf(state);
    state.clientConfig.hostKey = { value: v, lastFour: v.slice(-4), savedAt: atISO || null };
    return { ok: true };
  }

  function removeHostKey(state) {
    state.clientConfig = configOf(state);
    delete state.clientConfig.hostKey;
    return { ok: true };
  }

  /* ---------------- home tiles ---------------- */

  /* Everything on Home is read from the digest and the raw state —
     no new mechanics. `profile` is the current adapter's profile
     (adapter.js's current().profile), passed in so this stays pure. */
  function homeTiles(state, profile) {
    var d = Ont ? Ont.buildDigest(state) : { tasks: [], shipments: [], needsEyes: [] };
    var tasks = d.tasks || [];
    var open = tasks.filter(function (t) { return t.status !== 'done'; });
    var inHand = open.filter(function (t) { return !!t.assignee; });
    var concepts = Ont ? Ont.conceptsOf(state) : [];
    var awaiting = concepts.filter(function (c) { return c.status !== 'settled'; }).length;
    var sent = (state && Array.isArray(state.sentActs) ? state.sentActs : [])
      .filter(function (e) { return e && e.status === 'sent'; }).length;
    var verbs = profile && profile.verbs ? Object.keys(profile.verbs).filter(function (k) { return profile.verbs[k]; }) : [];
    return {
      site: siteNameOf(state),
      connection: profile ? {
        id: profile.id, hostLabel: profile.hostLabel, transport: profile.transport,
        keyed: !!profile.keyed, verbs: verbs
      } : null,
      openTasks: open.length,
      inHand: inHand.length,
      shipments: (d.shipments || []).length,
      needsEyes: (d.needsEyes || []).length,
      awaitingConcepts: awaiting,
      sentPending: sent
    };
  }

  /* ---------------- the ontology screen ---------------- */

  function ontologyView(state) {
    var concepts = Ont ? Ont.conceptsOf(state) : [];
    var vocab = [];
    var v = (state && state.vocabulary) || {};
    Object.keys(v).sort().forEach(function (term) {
      var e = v[term] || {};
      vocab.push({ term: term, meaning: e.meaning || '' });
    });
    return {
      awaiting: concepts.filter(function (c) { return c.status !== 'settled'; }),
      settled: concepts.filter(function (c) { return c.status === 'settled'; }),
      vocabulary: vocab
    };
  }

  /* The settle step, exactly the console's shape: the ontology's
     learnConcept is the single writer; if it does not move, the
     step reports why instead of saving nothing silently. Only a
     DESCRIBED concept can be settled — that is the ladder's law,
     enforced by the writer itself. */
  function settleStep(key, by, summary, atISO) {
    return function (s) {
      if (!Ont) return { ok: false, reason: 'The ontology is not loaded. Nothing was done.' };
      var next = Ont.learnConcept(s, { key: key, status: 'settled', by: by, summary: summary, at: atISO });
      if (next === s) return { ok: false, reason: 'Nothing changed — the concept is not ready to settle (it must be described first, and settling needs your name).' };
      s.concepts = next.concepts;
      return { ok: true };
    };
  }

  var api = {
    configOf: configOf,
    siteNameOf: siteNameOf,
    maskOf: maskOf,
    withSiteName: withSiteName,
    applyHostKey: applyHostKey,
    removeHostKey: removeHostKey,
    homeTiles: homeTiles,
    ontologyView: ontologyView,
    settleStep: settleStep
  };
  root.WitnessApp = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  /* ==================== browser boot ==================== */
  if (typeof document === 'undefined') return;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var SCREENS = [
    { id: 'home', label: 'Home' },
    { id: 'connection', label: 'Connection' },
    { id: 'ontology', label: 'Ontology' },
    { id: 'site', label: 'Site' }
  ];

  /* The shared header: the console's masthead restated in the
     app's own classes (css/witness-app.css carries its style on
     both pages, so the record page's design is untouched) + the
     app's tab bar. On app.html the tabs switch screens; Record
     links to warehouse.html, which carries this same header
     with Record as the current tab. */
  function navHTML(current, siteName) {
    var tabs = SCREENS.map(function (s) {
      var cur = s.id === current ? ' class="app-tab current"' : ' class="app-tab"';
      return '<a' + cur + ' href="app.html#' + s.id + '" data-screen="' + s.id + '">' + s.label + '</a>';
    }).join('');
    var rec = current === 'record' ? ' class="app-tab current"' : ' class="app-tab"';
    tabs += '<a' + rec + ' href="warehouse.html">Record</a>';
    return '<header class="app-topbar">' +
      '<div class="app-brand"><span class="app-mark">W</span> WITNESS <small>' + esc(siteName) + '</small></div>' +
      '<div class="app-spacer"></div>' +
      '<span class="app-tag">The Witness application</span>' +
      '</header>' +
      '<nav class="app-tabs" aria-label="Witness application">' + tabs + '</nav>';
  }

  function renderNav(current, siteName) {
    var mount = document.getElementById('witness-app-nav');
    if (mount) mount.innerHTML = navHTML(current, siteName);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var isAppPage = !!document.getElementById('witness-app');
    renderNav(isAppPage ? 'home' : 'record', 'Witness');
    if (!isAppPage) {
      /* Nav-only page (the record): render and STOP. The record's
         request discipline is exact and load-bearing — a plain
         open reads once and writes nothing, and the kitchen world
         never touches the shared record at all (pinned by
         test/desk-phone-smoke-test.js) — so the header adds NO
         network traffic of its own. The site's name therefore
         shows in the header on the application's own pages,
         where loading the state is already the page's job. */
      return;
    }

    var E = root.WitnessEngine, S = root.WitnessState;
    var store = S.create({
      fetch: window.fetch.bind(window),
      seed: function () { var s = E.seedWorld(); E.generateTasks(s); return s; },
      prepare: function (s) { E.upgradeState(s); E.generateTasks(s); return s; }
    });
    var state = null;
    var current = 'home';

    function $(id) { return document.getElementById(id); }

    function showScreen(id) {
      current = id;
      SCREENS.forEach(function (s) { $('screen-' + s.id).style.display = s.id === id ? '' : 'none'; });
      renderNav(id, state ? siteNameOf(state) : 'Witness');
      if (window.location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
    }

    /* Tab clicks are delegated: renderNav replaces the nav's HTML
       on every render, so listeners on the tabs themselves would
       die with each render. The mount persists; its children don't. */
    document.getElementById('witness-app-nav').addEventListener('click', function (ev) {
      var t = ev.target.closest ? ev.target.closest('.app-tab[data-screen]') : null;
      if (t) { ev.preventDefault(); showScreen(t.getAttribute('data-screen')); }
    });

    function notice(id, text, bad) {
      var n = $(id);
      if (n) { n.textContent = text || ''; n.className = 'app-note' + (bad ? ' bad' : ''); }
    }

    function renderAll() {
      renderNav(current, state ? siteNameOf(state) : 'Witness');
      var profile = Adp ? Adp.current().profile : null;

      /* ----- Home ----- */
      var t = homeTiles(state || {}, profile);
      $('tile-connection').innerHTML = t.connection
        ? '<div class="tile-num">' + esc(t.connection.hostLabel) + '</div>' +
          '<div class="tile-sub">' + esc(t.connection.transport) + ' transport · ' + t.connection.verbs.length + ' verbs declared</div>'
        : '<div class="tile-sub">No adapter is loaded.</div>';
      $('tile-tasks').innerHTML = '<div class="tile-num">' + t.openTasks + ' open</div>' +
        '<div class="tile-sub">' + t.inHand + ' in hand · ' + t.shipments + ' shipments on the board · ' + t.needsEyes + ' need eyes</div>';
      $('tile-human').innerHTML = '<div class="tile-num">' + (t.awaitingConcepts + t.sentPending) + ' waiting</div>' +
        '<div class="tile-sub">' + t.awaitingConcepts + ' concepts to settle · ' + t.sentPending + ' acts sent, awaiting the host</div>';
      $('home-empty').style.display = state ? 'none' : '';

      /* ----- Connection ----- */
      $('conn-profile').innerHTML = profile
        ? '<table class="app-kv">' +
          '<tr><th>Adapter</th><td>' + esc(profile.id) + '</td></tr>' +
          '<tr><th>Host</th><td>' + esc(profile.hostLabel) + '</td></tr>' +
          '<tr><th>Transport</th><td>' + esc(profile.transport) + (profile.keyed ? ' · idempotency keys on every act' : ' · in-process, not keyed') + '</td></tr>' +
          '<tr><th>Takes from Witness</th><td>' + esc(t.connection.verbs.join(', ')) + '</td></tr></table>'
        : '<p class="app-note bad">No adapter is loaded — the gate has nothing to submit through.</p>';
      var hk = configOf(state).hostKey;
      $('key-state').innerHTML = hk
        ? '<span class="key-mask">' + esc(maskOf(hk)) + '</span>' +
          '<span class="tile-sub">Saved ' + esc(hk.savedAt ? new Date(hk.savedAt).toLocaleString() : '') + '. The full key is never shown again — replace it to change it.</span>'
        : '<span class="tile-sub">No host API key is saved yet.</span>';
      $('key-remove').style.display = hk ? '' : 'none';

      /* ----- Ontology ----- */
      var ov = ontologyView(state || {});
      $('onto-awaiting').innerHTML = ov.awaiting.length ? ov.awaiting.map(function (c, i) {
        var can = c.status === 'described';
        return '<div class="concept">' +
          '<div class="concept-head"><b>' + esc(c.name) + '</b> <span class="rung">' + esc(c.status) + '</span></div>' +
          (c.summary ? '<p>' + esc(c.summary) + '</p>' : '<p class="tile-sub">Not yet described — the console’s Ontology page can ask the AI to describe it; settling comes after a description.</p>') +
          (can ? '<textarea id="cx-' + i + '" rows="2">' + esc(c.summary || '') + '</textarea>' +
            '<button type="button" class="btn" data-settle="' + esc(c.key) + '" data-i="' + i + '">Settle</button>' : '') +
          '</div>';
      }).join('') : '<p class="tile-sub">Nothing is waiting — everything the ontology has learned is settled.</p>';
      $('onto-settled').innerHTML = ov.settled.length ? ov.settled.map(function (c) {
        return '<div class="concept"><div class="concept-head"><b>' + esc(c.name) + '</b> <span class="rung">settled</span></div>' +
          (c.summary ? '<p>' + esc(c.summary) + '</p>' : '') +
          '<div class="tile-sub">Settled by ' + esc(c.settledBy || 'a person') + '.</div></div>';
      }).join('') : '<p class="tile-sub">Nothing settled yet.</p>';
      $('onto-vocab').innerHTML = ov.vocabulary.length ? ov.vocabulary.map(function (v) {
        return '<div class="concept"><b>' + esc(v.term) + '</b> — ' + esc(v.meaning) + '</div>';
      }).join('') : '<p class="tile-sub">No learned terms yet — the building learns words from the people who work in it.</p>';
      document.querySelectorAll('[data-settle]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var by = $('settle-as').value.trim();
          if (!by) { notice('onto-note', 'Settling needs your name — a settle is a human’s act, signed like one.', true); return; }
          var key = btn.getAttribute('data-settle');
          var summary = $('cx-' + btn.getAttribute('data-i')).value;
          store.mutate(settleStep(key, by, summary, new Date().toISOString())).then(function (r) {
            state = r.state;
            if (r.result && r.result.ok === false) { notice('onto-note', r.result.reason, true); return; }
            notice('onto-note', 'Settled by ' + by + '.');
            renderAll();
          }, function (e) { notice('onto-note', (e && e.userMessage) || 'The settle did not save.', true); });
        });
      });

      /* ----- Site ----- */
      $('site-name').value = configOf(state).siteName || '';
    }

    /* ----- actions ----- */
    $('key-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var v = $('key-input').value;
      if (!v.trim()) { notice('key-note', 'That key is empty — nothing was saved.', true); return; }
      store.mutate(function (s) { return applyHostKey(s, v, new Date().toISOString()); }).then(function (r) {
        state = r.state; $('key-input').value = '';
        notice('key-note', 'Saved. From here it shows only as a mask.');
        renderAll();
      }, function (e) { notice('key-note', (e && e.userMessage) || 'The key did not save.', true); });
    });
    $('key-remove').addEventListener('click', function () {
      store.mutate(function (s) { return removeHostKey(s); }).then(function (r) {
        state = r.state; notice('key-note', 'Removed.'); renderAll();
      }, function (e) { notice('key-note', (e && e.userMessage) || 'The removal did not save.', true); });
    });
    $('site-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      store.mutate(function (s) { withSiteName(s, $('site-name').value); return { ok: true }; }).then(function (r) {
        state = r.state; notice('site-note', 'Saved — the header carries the name now.'); renderAll();
      }, function (e) { notice('site-note', (e && e.userMessage) || 'The name did not save.', true); });
    });
    store.loadState().then(function (s) {
      state = s;
      renderAll();
      var h = (window.location.hash || '#home').slice(1);
      showScreen(SCREENS.some(function (x) { return x.id === h; }) ? h : 'home');
    }, function () {
      renderAll();
      notice('home-note', 'The shared record could not be reached — check the connection and reload.', true);
    });
  });
})(typeof window !== 'undefined' ? window : globalThis);
