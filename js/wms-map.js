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

   Docks are doors, straight from state: each door carries a
   direction ('in' or 'out'). Inbound doors stand on the inbound wall,
   outbound doors on the outbound wall, in number order. Inbound Dock
   N is Inbound Door N; Outbound Dock N is Outbound Door N. A door with
   no direction, or a pallet or order not at a door on its own wall,
   is listed under the map as "not on a wall", never dropped.

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

  function byNumber(a, b) { return (doorNo(a.id) || 0) - (doorNo(b.id) || 0); }

  function model(state, W) {
    var doors = state.doors || [];
    var inDoors = doors.filter(function (d) { return d.direction === 'in'; }).sort(byNumber);
    var outDoors = doors.filter(function (d) { return d.direction === 'out'; }).sort(byNumber);
    var loose = { doors: doors.filter(function (d) { return d.direction !== 'in' && d.direction !== 'out'; }).map(function (d) { return d.id; }), pallets: [], orders: [] };

    var loads = (state.wms && state.wms.loads) || [];
    function loadById(id) { var r = null; loads.forEach(function (l) { if (l.id === id) r = l; }); return r; }
    var orders = allOrders(state, W).filter(function (o) { return o.status === 'staged at door'; });
    var inIds = inDoors.map(function (d) { return d.id; }), outIds = outDoors.map(function (d) { return d.id; });
    (state.staging || []).forEach(function (p) { if (inIds.indexOf(p.door) === -1) loose.pallets.push(p.id + ' at ' + (p.door || 'no door')); });
    orders.forEach(function (o) { if (outIds.indexOf(o.door) === -1) loose.orders.push(o.id + ' at ' + (o.door || 'no door')); });

    function dockName(prefix, d, i) { return prefix + ' Dock ' + (doorNo(d.id) || i + 1); }

    /* Inbound wall: the trailer at the door, the pallets in the Receiving Bay. */
    var inbound = inDoors.map(function (d, i) {
      var ship = d.shipmentId || null;
      return {
        doorId: d.id,
        name: dockName('Inbound', d, i),
        word: ship ? (d.state === 'unloading' ? 'Unloading' : 'At the dock') : 'Clear',
        ref: ship, busy: !!ship,
        lane: (state.staging || []).filter(function (p) { return p.door === d.id; }).map(function (p) {
          return { id: p.id, desc: shortDesc(p.desc), qty: p.qty, held: !!p.hold, damaged: !!p.damaged };
        })
      };
    });

    /* Outbound wall: the load being built, the orders staged to ship. */
    var outbound = outDoors.map(function (d, i) {
      var ld = d.loadId ? loadById(d.loadId) : null;
      var word = ld || d.state === 'loading' ? 'Loading' : 'Clear';
      return {
        doorId: d.id,
        name: dockName('Outbound', d, i),
        word: word, ref: ld ? ld.id : null, busy: word !== 'Clear',
        lane: orders.filter(function (o) { return o.door === d.id; }).map(function (o) { return { id: o.id, packed: !!o.packed, customer: o.customer || '' }; })
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

    var n = Math.max(DOCKS_PER_WALL, inbound.length, outbound.length);
    return { inbound: inbound, outbound: outbound, rows: n, zones: zones, loose: loose };
  }

  /* ---------- rendering ------------------------------------------- */

  function dockHtml(side, d) {
    if (!d) return '';
    return '<div class="wm-dock wm-' + side + (d.busy ? ' busy' : '') + '" data-place="dock" data-side="' + side + '" data-id="' + esc(d.doorId) + '" title="' +
      esc(d.name + ' — ' + d.word + (d.ref ? ' ' + d.ref : '')) + '">' +
      '<span class="wm-dock-name">' + esc(d.name) + '</span>' +
      '<span class="wm-dock-state">' + esc(d.word) + (d.ref ? ' <b>' + esc(d.ref) + '</b>' : '') + '</span>' +
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

  /* Anything the walls cannot place, said plainly — never dropped. */
  function looseHtml(l) {
    var parts = [];
    if (l.doors.length) parts.push('Doors with no wall: ' + l.doors.join(', '));
    if (l.pallets.length) parts.push('Pallets not at an inbound door: ' + l.pallets.join(', '));
    if (l.orders.length) parts.push('Orders staged away from an outbound door: ' + l.orders.join(', '));
    return parts.length ? '<p class="wm-loose" data-place="loose">Not on a wall — ' + esc(parts.join(' · ')) + '</p>' : '';
  }

  function html(state, W) {
    var m = model(state, W);
    var n = m.rows;
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

    for (var i = 0; i < n; i++) {
      var row = 'grid-row:' + (i + 3), di = m.inbound[i], dout = m.outbound[i];
      out += '<div class="wm-cell wm-col-in" style="' + row + '">' + dockHtml('in', di) + '</div>';
      out += '<div class="wm-cell wm-col-rcv wm-lane" style="' + row + '"' + (di ? ' data-place="receiving" data-id="' + esc(di.doorId) + '">' + di.lane.map(palletHtml).join('') : '>') + '</div>';
      out += '<div class="wm-cell wm-col-stg wm-lane" style="' + row + '"' + (dout ? ' data-place="staging" data-id="' + esc(dout.doorId) + '">' + dout.lane.map(orderHtml).join('') : '>') + '</div>';
      out += '<div class="wm-cell wm-col-out" style="' + row + '">' + dockHtml('out', dout) + '</div>';
    }

    out += '</div>';
    out += '<div class="wm-legend"><span><i class="wm-key rcv"></i> Receiving &amp; staging</span><span><i class="wm-key bays"></i> Bay locations</span>' +
      '<span><i class="wm-pallet"></i> Pallet waiting for putaway</span><span><i class="wm-pallet out"></i> Order staged to ship</span>' +
      '<span><i class="wm-bin stocked"></i> Stocked bin</span><span><i class="wm-bin"></i> Empty bin</span><span><i class="wm-bin held"></i> On hold</span></div>' + looseHtml(m.loose) + '</div>';
    return out;
  }

  var api = { model: model, html: html, DOCKS_PER_WALL: DOCKS_PER_WALL };
  root.WitnessWmsMap = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
