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

   Every place carries data-place / data-id hooks. The items a person
   can open (a dock, a pallet, an order staged to ship, a bin) are
   focusable (data-open); wms-ui.js routes a click or Enter on one to
   that item's Witness page (js/wms-witness.js). Flags come next.

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

  /* An item a person can open: its Witness page. */
  var OPEN = ' data-open tabindex="0" role="link"';

  function dockHtml(side, d) {
    if (!d) return '';
    return '<div class="wm-dock wm-' + side + (d.busy ? ' busy' : '') + '" data-place="dock" data-side="' + side + '" data-id="' + esc(d.doorId) + '"' + OPEN + ' title="' +
      esc(d.name + ' — ' + d.word + (d.ref ? ' ' + d.ref : '')) + '">' +
      '<span class="wm-dock-name">' + esc(d.name) + '</span>' +
      '<span class="wm-dock-state">' + esc(d.word) + (d.ref ? ' <b>' + esc(d.ref) + '</b>' : '') + '</span>' +
      '</div>';
  }

  function palletHtml(p) {
    return '<span class="wm-pallet' + (p.held ? ' held' : '') + '" data-place="pallet" data-id="' + esc(p.id) + '"' + OPEN + ' title="' +
      esc(p.id + ' · ' + p.qty + ' × ' + p.desc + (p.held ? ' · on hold' : '')) + '"></span>';
  }

  function orderHtml(o) {
    return '<span class="wm-pallet out' + (o.packed ? ' packed' : '') + '" data-place="order" data-id="' + esc(o.id) + '"' + OPEN + ' title="' +
      esc(o.id + (o.customer ? ' · ' + o.customer : '') + (o.packed ? ' · packed' : ' · picked, not packed')) + '"></span>';
  }

  function binHtml(b) {
    return '<span class="wm-bin' + (b.stocked ? ' stocked' : '') + (b.held ? ' held' : '') + '" data-place="bin" data-id="' + esc(b.id) + '"' + OPEN + ' title="' +
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

  /* ---------- task slices: the flow views (Console Task 5) --------
     A task view never shows the whole building. It shows the slice
     the freight moves through, top to bottom, the way it flows:

       inbound  (truck → check → putaway):  Inbound Docks → Receiving Bay → Bay Locations
       outbound (pick → stage → load):      Bay Locations → Staging → Outbound Docks

     Only bins with a reason to be there are drawn (William's bin
     law): inbound, a putaway destination or a hold; outbound, a pick
     source or a hold. The page's own panels ride under the stage
     they concern (anchors), so every existing action stays as it was. */

  var FLOW = {
    'in': [
      { key: 'docks', label: 'Inbound Docks', next: 'unload and check' },
      { key: 'rcv', label: 'Receiving Bay', next: 'put away' },
      { key: 'bays', label: 'Bay Locations' }
    ],
    'out': [
      { key: 'bays', label: 'Bay Locations', next: 'pick, pack and stage' },
      { key: 'stg', label: 'Staging', next: 'load' },
      { key: 'docks', label: 'Outbound Docks' }
    ]
  };

  /* Why a bin belongs in this slice, or null. */
  function binReasons(state, dir) {
    var r = {};
    function add(id, why) { if (!id) return; (r[id] = r[id] || []).indexOf(why) === -1 && r[id].push(why); }
    (state.tasks || []).forEach(function (t) {
      if (t.status === 'done') return;
      if (dir === 'in' && t.type === 'putaway') add(t.toBinId, 'Put away here');
      if (dir === 'out' && t.type === 'pick') add(t.binId, 'Pick from here');
    });
    (state.bins || []).forEach(function (b) { if (b.status === 'hold') add(b.id, 'On hold'); });
    return r;
  }

  function slice(state, W, dir) {
    if (!FLOW[dir]) throw new Error('slice: direction must be "in" or "out"');
    var m = model(state, W);
    var docks = dir === 'in' ? m.inbound : m.outbound;
    var why = binReasons(state, dir);
    var zones = m.zones.map(function (z) {
      return { zone: z.zone, bins: z.bins.filter(function (b) { return why[b.id]; }).map(function (b) {
        return { id: b.id, stocked: b.stocked, held: b.held, title: b.title, why: why[b.id] };
      }) };
    }).filter(function (z) { return z.bins.length; });
    var loose = dir === 'in' ? { doors: m.loose.doors, pallets: m.loose.pallets, orders: [] } : { doors: m.loose.doors, pallets: [], orders: m.loose.orders };
    return {
      dir: dir,
      stages: FLOW[dir].map(function (st) {
        var o = { key: st.key, label: st.label, next: st.next || null };
        if (st.key === 'docks') o.docks = docks;
        if (st.key === 'rcv' || st.key === 'stg') o.lanes = docks.map(function (d) { return { doorId: d.doorId, name: d.name, items: d.lane }; });
        if (st.key === 'bays') o.zones = zones;
        return o;
      }),
      columns: Math.max(DOCKS_PER_WALL, docks.length),
      loose: loose
    };
  }

  function sliceBinHtml(b) {
    return '<span class="wm-bin wf-bin' + (b.stocked ? ' stocked' : '') + (b.held ? ' held' : '') + '" data-place="bin" data-id="' + esc(b.id) + '" title="' +
      esc(b.id + ' — ' + b.title + ' · ' + b.why.join(', ')) + '"><b>' + esc(b.id) + '</b><small>' + esc(b.why.join(' · ')) + '</small></span>';
  }

  function stripHtml(sl, st) {
    var side = sl.dir;
    var cols = ' style="--wf-cols:' + sl.columns + '"';
    if (st.docks) {
      return '<div class="wf-row wf-docks"' + cols + '>' + st.docks.map(function (d) { return '<div class="wf-cell">' + dockHtml(side, d) + '</div>'; }).join('') + '</div>';
    }
    if (st.lanes) {
      var place = st.key === 'rcv' ? 'receiving' : 'staging';
      return '<div class="wf-row wf-lanes"' + cols + '>' + st.lanes.map(function (l) {
        return '<div class="wm-lane wf-lane" data-place="' + place + '" data-id="' + esc(l.doorId) + '" title="' + esc(st.label + ' at ' + l.name) + '">' +
          l.items.map(st.key === 'rcv' ? palletHtml : orderHtml).join('') + '</div>';
      }).join('') + '</div>';
    }
    if (!st.zones.length) return '<p class="wf-none">No bin has a reason to be here right now.</p>';
    return '<div class="wf-zones">' + st.zones.map(function (z) {
      return '<section class="wm-zone" data-place="zone" data-id="' + esc(z.zone) + '"><h3>Zone ' + esc(z.zone) + '</h3><div class="wf-bins">' +
        z.bins.map(sliceBinHtml).join('') + '</div></section>';
    }).join('') + '</div>';
  }

  /* anchors: { docks, rcv | stg, bays } → HTML of the page's own panels,
     placed under the stage they concern. Panels sit OUTSIDE the
     .wm-surface strip so they keep the console's own colours. */
  function sliceHtml(state, W, dir, anchors) {
    var sl = slice(state, W, dir);
    anchors = anchors || {};
    var names = sl.stages.map(function (st) { return st.label; }).join(', then ');
    var out = '<div class="wf wf-' + dir + '" data-flow="' + dir + '" role="group" aria-label="' + esc((dir === 'in' ? 'Inbound flow, top to bottom: ' : 'Outbound flow, top to bottom: ') + names) + '">';
    sl.stages.forEach(function (st, i) {
      out += '<section class="wf-stage wf-' + st.key + '" data-stage="' + st.key + '">' +
        '<div class="wm-surface wf-strip"><div class="wf-label">' + esc(st.label) + '</div>' + stripHtml(sl, st) + '</div>' +
        (anchors[st.key] ? '<div class="wf-panels">' + anchors[st.key] + '</div>' : '') + '</section>';
      if (i < sl.stages.length - 1) out += '<div class="wf-arrow" aria-hidden="true"><span>↓ ' + esc(st.next) + '</span></div>';
    });
    var lo = looseHtml(sl.loose);
    out += (lo ? '<div class="wm-surface wf-foot">' + lo + '</div>' : '') + '</div>';
    /* Witness-page opening is wired for the map home only (.wmap); a
       slice item must not claim to be a link it cannot follow. */
    return out.split(OPEN).join('');
  }

  var api = { model: model, html: html, slice: slice, sliceHtml: sliceHtml, FLOW: FLOW, DOCKS_PER_WALL: DOCKS_PER_WALL };
  root.WitnessWmsMap = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
