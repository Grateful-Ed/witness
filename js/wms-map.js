/* =====================================================================
   wms-map.js — the warehouse map, the desk console's home.

   William's sketch (briefs/warehouse-layout-sketch-2026-11-02.png):
   Inbound Docks 1–4 on one wall, Outbound Docks 1–4 on the opposite
   wall, a pink band inside each dock wall (inbound side: the
   Receiving Bay; outbound side: Staging), the yellow block of bay
   locations in the centre.

   The map shows places, read from the real state. It carries no
   tables and no dense numbers: a dock says what is at it in a word
   or two, a pallet is a small square, a bin is a tile with its name.

   Docks and doors: the warehouse state has four dock doors (Door 1–4)
   and each one can be used in or out. The building drawing has two
   walls of four. So Inbound Dock N shows the inbound side of Door N
   (a trailer being received, pallets waiting for putaway) and
   Outbound Dock N shows the outbound side of the same door (a load
   being built, orders staged to ship). Each dock names its door, so
   nothing is hidden.

   Every place carries data-place / data-id hooks for the next tasks
   (the Witness page, flags). Nothing here acts on a click.

   model() is pure (node-testable); html() renders the model.
   ===================================================================== */
(function (root) {
  'use strict';

  var DOCKS_PER_WALL = 4;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function shortDesc(d) { return String(d || '').replace(/ — .*/, ''); }
  function doorNo(id) { var m = /(\d+)\s*$/.exec(String(id || '')); return m ? +m[1] : null; }

  /* All orders the WMS knows (released or not). */
  function allOrders(state, W) {
    if (W && W.allOrders) return W.allOrders(state);
    return ((state.wms && state.wms.orders) || []).concat(state.outbound || []);
  }

  /* ---------- the model: places, read from state ------------------ */

  function model(state, W) {
    var doors = (state.doors || []).slice();
    var byNo = {};
    var extra = [];
    doors.forEach(function (d) {
      var n = doorNo(d.id);
      if (n && n >= 1 && n <= DOCKS_PER_WALL && !byNo[n]) byNo[n] = d; else extra.push(d);
    });
    var slots = [];
    for (var i = 1; i <= DOCKS_PER_WALL; i++) slots.push(byNo[i] || null);
    extra.forEach(function (d) { slots.push(d); });

    var loads = (state.wms && state.wms.loads) || [];
    function loadById(id) { var r = null; loads.forEach(function (l) { if (l.id === id) r = l; }); return r; }
    var orders = allOrders(state, W);

    var rows = slots.map(function (d, i) {
      var n = i + 1;
      var doorId = d ? d.id : null;

      /* Inbound side: the trailer at the door, the pallets in the Receiving Bay. */
      var inShip = d && d.shipmentId ? d.shipmentId : null;
      var inWord = inShip ? (d.state === 'unloading' ? 'Unloading' : 'At the dock') : 'Clear';
      var pallets = !doorId ? [] : (state.staging || []).filter(function (p) { return p.door === doorId; }).map(function (p) {
        return { id: p.id, desc: shortDesc(p.desc), qty: p.qty, held: !!p.hold, damaged: !!p.damaged };
      });

      /* Outbound side: the load being built, the orders staged to ship. */
      var ld = d && d.loadId ? loadById(d.loadId) : null;
      var outWord = ld ? 'Loading' : (d && d.state === 'loading' ? 'Loading' : 'Clear');
      var staged = !doorId ? [] : orders.filter(function (o) {
        return o.door === doorId && o.status === 'staged at door';
      }).map(function (o) { return { id: o.id, packed: !!o.packed, customer: o.customer || '' }; });

      return {
        n: n,
        doorId: doorId,
        inbound: { name: 'Inbound Dock ' + n, word: inWord, ref: inShip, busy: !!inShip },
        receiving: pallets,
        outbound: { name: 'Outbound Dock ' + n, word: outWord, ref: ld ? ld.id : null, busy: outWord !== 'Clear' },
        staging: staged
      };
    });

    var zones = (state.zones || []).map(function (z) {
      return {
        zone: z,
        bins: (state.bins || []).filter(function (b) { return b.zone === z; }).map(function (b) {
          var qty = 0; b.contents.forEach(function (c) { qty += c.qty; });
          return {
            id: b.id,
            stocked: b.contents.length > 0,
            held: b.status === 'hold',
            title: b.contents.length ? b.contents.map(function (c) { return c.qty + ' × ' + shortDesc(c.desc); }).join(', ') : 'Empty'
          };
        })
      };
    });

    return { rows: rows, zones: zones };
  }

  /* ---------- rendering ------------------------------------------- */

  function dockHtml(side, d, doorId) {
    var title = d.name + (doorId ? ' · ' + doorId : '') + ' — ' + d.word + (d.ref ? ' ' + d.ref : '');
    return '<div class="wm-dock wm-' + side + (d.busy ? ' busy' : '') + '" data-place="dock" data-side="' + side + '" data-id="' + esc(doorId || '') + '" title="' + esc(title) + '">' +
      '<span class="wm-dock-name">' + esc(d.name) + '</span>' +
      '<span class="wm-dock-state">' + esc(d.word) + (d.ref ? ' <b>' + esc(d.ref) + '</b>' : '') + '</span>' +
      (doorId ? '<span class="wm-door">' + esc(doorId) + '</span>' : '') +
      '</div>';
  }

  function palletHtml(p) {
    return '<span class="wm-pallet' + (p.held ? ' held' : '') + '" data-place="pallet" data-id="' + esc(p.id) + '" title="' +
      esc(p.id + ' · ' + p.qty + ' × ' + p.desc + (p.held ? ' · on hold' : '')) + '"></span>';
  }

  function orderHtml(o) {
    return '<span class="wm-pallet out' + (o.packed ? ' packed' : '') + '" data-place="order" data-id="' + esc(o.id) + '" title="' +
      esc(o.id + (o.customer ? ' · ' + o.customer : '') + (o.packed ? ' · packed' : ' · picked, not packed')) + '"></span>';
  }

  function binHtml(b) {
    return '<span class="wm-bin' + (b.stocked ? ' stocked' : '') + (b.held ? ' held' : '') + '" data-place="bin" data-id="' + esc(b.id) + '" title="' +
      esc(b.id + ' — ' + b.title + (b.held ? ' · on hold' : '')) + '">' + esc(b.id) + '</span>';
  }

  function html(state, W) {
    var m = model(state, W);
    var n = m.rows.length;
    var out = '<div class="wm-surface"><div class="wmap" role="group" aria-label="Warehouse map: inbound docks, receiving bay, bay locations, staging, outbound docks" style="--wm-rows:' + n + '">';

    var span = 'grid-row:2 / span ' + (n + 1);
    out += '<div class="wm-wall-label wm-col-in">Inbound</div><div class="wm-wall-label wm-col-out">Outbound</div>';
    out += '<div class="wm-band wm-col-rcv" style="' + span + '"><span class="wm-band-label">Receiving Bay</span></div>';
    out += '<div class="wm-band wm-col-stg" style="' + span + '"><span class="wm-band-label">Staging</span></div>';
    out += '<div class="wm-bays-head" style="grid-row:2"><span class="wm-band-label">Bay Locations</span></div>';
    out += '<div class="wm-bays" style="grid-row:3 / span ' + n + '">' + m.zones.map(function (z) {
      return '<section class="wm-zone" data-place="zone" data-id="' + esc(z.zone) + '"><h3>Zone ' + esc(z.zone) + '</h3><div class="wm-bins">' +
        z.bins.map(binHtml).join('') + '</div></section>';
    }).join('') + '</div>';

    m.rows.forEach(function (r, i) {
      var row = 'grid-row:' + (i + 3);
      out += '<div class="wm-cell wm-col-in" style="' + row + '">' + dockHtml('in', r.inbound, r.doorId) + '</div>';
      out += '<div class="wm-cell wm-col-rcv wm-lane" style="' + row + '" data-place="receiving" data-id="' + esc(r.doorId || '') + '">' + r.receiving.map(palletHtml).join('') + '</div>';
      out += '<div class="wm-cell wm-col-stg wm-lane" style="' + row + '" data-place="staging" data-id="' + esc(r.doorId || '') + '">' + r.staging.map(orderHtml).join('') + '</div>';
      out += '<div class="wm-cell wm-col-out" style="' + row + '">' + dockHtml('out', r.outbound, r.doorId) + '</div>';
    });

    out += '</div>';
    out += '<div class="wm-legend"><span><i class="wm-key rcv"></i> Receiving &amp; staging</span><span><i class="wm-key bays"></i> Bay locations</span>' +
      '<span><i class="wm-pallet"></i> Pallet waiting for putaway</span><span><i class="wm-pallet out"></i> Order staged to ship</span>' +
      '<span><i class="wm-bin stocked"></i> Stocked bin</span><span><i class="wm-bin"></i> Empty bin</span><span><i class="wm-bin held"></i> On hold</span></div></div>';
    return out;
  }

  var api = { model: model, html: html, DOCKS_PER_WALL: DOCKS_PER_WALL };
  root.WitnessWmsMap = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
