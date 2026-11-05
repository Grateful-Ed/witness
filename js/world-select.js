/* =====================================================================
   world-select.js — which world a page runs: the warehouse (default)
   or the kitchen (?world=kitchen). The ONE place the dispatch lives.

   Load order on a page: data/world.js, data/kitchen-world.js, THIS
   file, then js/engine.js. Under ?world=kitchen this file hands the
   engine the kitchen seed (window.WitnessWorldSeed), so seedWorld /
   resetState seed the kitchen with no change to the engine.

   One state, one key: switching worlds reseeds the state, and the
   page says so in plain words (announce) — never a silent wipe.

   The kitchen is stricter (William, 2026-11-04): it starts fresh
   EVERY time it opens, even over a saved kitchen state. Testers kept
   finishing a grocery run, coming back later, and finding the receipt
   scan unwilling to create a new one (one run per kitchen) — a fresh
   kitchen on open makes the scan always willing, and the page says
   so in plain words. The warehouse keeps its state as before.
   ===================================================================== */
(function (root) {
  'use strict';

  var WORLDS = ['warehouse', 'kitchen'];
  var DEFAULT_WORLD = 'warehouse';

  /* ?world=kitchen → 'kitchen'. Anything else → the warehouse. */
  function worldFromSearch(search) {
    var m = /[?&]world=([^&#]*)/.exec(String(search || ''));
    var w = m ? decodeURIComponent(m[1]).toLowerCase() : '';
    return WORLDS.indexOf(w) !== -1 ? w : DEFAULT_WORLD;
  }

  /* The world a saved state belongs to. data/world.js carries no
     marker, so no marker means the warehouse. */
  function stateWorld(state) {
    return state && state.world ? state.world : DEFAULT_WORLD;
  }

  function label(w) { return w === 'kitchen' ? 'kitchen' : 'warehouse'; }

  /* A loaded state checked against the page's world. When it belongs
     to the other world, it is not used: switched=true, and the notice
     says what is replaced. A null state is just "nothing saved yet". */
  function checkWorld(state, want) {
    if (!state) return { state: null, switched: false, notice: null };
    var have = stateWorld(state);
    if (want === 'kitchen' && have === 'kitchen') {
      return {
        state: null,
        switched: true,
        notice: 'Fresh kitchen — the kitchen world starts clean every time it opens. ' +
          'The saved kitchen state was replaced with a fresh kitchen.'
      };
    }
    if (have === want) return { state: state, switched: false, notice: null };
    return {
      state: null,
      switched: true,
      notice: 'Switched to the ' + label(want) + ' world. The saved ' + label(have) +
        ' state was replaced with a fresh ' + label(want) + '.'
    };
  }

  var api = {
    WORLDS: WORLDS, DEFAULT_WORLD: DEFAULT_WORLD,
    worldFromSearch: worldFromSearch, stateWorld: stateWorld, checkWorld: checkWorld
  };

  api.kitchenLine = 'Kitchen world — the demo\'s home-scale warehouse. Groceries land on the Counter; the receipt scan in the glasses view creates the work.';
  api.warehouseLine = 'Warehouse world — the receiving dock. Open the view, hold anywhere to talk, double-tap to capture: you speak what you see, and META checks it against the camera.';

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  /* ---------- browser: pick the seed before the engine loads ---------- */
  var current = worldFromSearch(root.location ? root.location.search : '');
  api.current = current;
  if (current === 'kitchen') {
    if (root.WitnessKitchenSeed) root.WitnessWorldSeed = root.WitnessKitchenSeed;
  }

  /* Plain words at the top of the page: which world, and any switch. */
  api.announce = function (text, where) {
    if (!text || typeof document === 'undefined') return;
    var host = (where && document.getElementById(where)) || document.querySelector('main') || document.body;
    var p = document.createElement('p');
    p.className = 'world-note';
    p.setAttribute('role', 'status');
    p.textContent = text;
    p.style.cssText = 'margin:0 0 12px;padding:8px 12px;border-radius:6px;background:#fff6d6;color:#3d3200;font:14px/1.4 system-ui,sans-serif;';
    host.insertBefore(p, host.firstChild);
  };

  /* In the kitchen, every page says so at the top. Pages other than
     the glasses view also link to it, since that is where the receipt
     is scanned. */
  if (current === 'warehouse' && typeof document !== 'undefined' && /glasses\.html$/.test(root.location.pathname || '')) {
    document.addEventListener('DOMContentLoaded', function () {
      api.announce(api.warehouseLine, document.getElementById('start') ? 'start' : null);
    });
  }

  if (current === 'kitchen' && typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function () {
      var where = document.getElementById('start') ? 'start' : null;
      api.announce(api.kitchenLine, where);
      if (!/glasses\.html$/.test(root.location.pathname || '')) {
        var note = document.querySelector('.world-note');
        if (note) {
          var a = document.createElement('a');
          a.href = 'glasses.html?world=kitchen';
          a.textContent = ' Open the kitchen glasses view →';
          note.appendChild(a);
        }
      }
    });
  }

  root.WitnessWorlds = api;
})(typeof window !== 'undefined' ? window : globalThis);
