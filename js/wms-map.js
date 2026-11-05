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
   that item's Witness page (js/wms-witness.js).

   FLAGS (Console Task 4) are the one voice the map is allowed: a
   small mark on anything whose record already says a human is needed
   now. No new urgency model — flags() only reads what is there:
     - a bin on hold                    → flag on the bin,  opens the bin
     - a pallet on hold                 → flag on the pallet, opens the pallet
     - an open OS&D finding (a receipt
       discrepancy, or a camera finding
       awaiting a decision)             → flag on the dock it came in at,
                                          opens the shipment
     - an open worker flag (can't
       verify — a human must decide)    → flag on the place its task
                                          touches, opens the task
   A flag marks; it does not explain: no words, no counts, no legend
   entry on the map (its name is for screen readers and hover only).
   When nothing is urgent, the map carries no flag.

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

  /* ---------- flags: what already says a human is needed now ------ */

  function hrefOf(place, id) { return '#/witness/' + place + '/' + encodeURIComponent(id); }

  /* Pure. Returns [{ href, place, id, host: { place, id } | null, why }],
     one per item to open. host is where the mark sits on the map; a
     null host means the walls cannot place it (said under the map). */
  function flags(state, W) {
    var m = model(state, W);
    var on = { dock: {}, pallet: {}, order: {}, bin: {}, zone: {} };
    m.inbound.forEach(function (d) { on.dock[d.doorId] = 1; d.lane.forEach(function (p) { on.pallet[p.id] = 1; }); });
    m.outbound.forEach(function (d) { on.dock[d.doorId] = 1; d.lane.forEach(function (o) { on.order[o.id] = 1; }); });
    m.zones.forEach(function (z) { on.zone[z.zone] = 1; z.bins.forEach(function (b) { on.bin[b.id] = 1; }); });
    function at(place, id) { return id != null && on[place][id] ? { place: place, id: id } : null; }
    function find(list, pred) { for (var i = 0; i < (list || []).length; i++) if (pred(list[i])) return list[i]; return null; }
    function binZone(id) { var b = find(state.bins, function (x) { return x.id === id; }); return b ? b.zone : null; }
    function doorZone(id) { var d = find(state.doors, function (x) { return x.id === id; }); return d ? d.zone : null; }

    var out = [], seen = {};
    function push(place, id, host, why, href) {
      var h = href || hrefOf(place, id);
      if (seen[h]) { if (seen[h].why.indexOf(why) === -1) seen[h].why.push(why); return; }
      seen[h] = { href: h, place: place, id: id, host: host, why: [why] };
      out.push(seen[h]);
    }

    /* 1. Held bins. */
    (state.bins || []).forEach(function (b) {
      if (b.status === 'hold') push('bin', b.id, at('bin', b.id), 'Bin ' + b.id + ' on hold');
    });

    /* 2. Held pallets. */
    (state.staging || []).forEach(function (p) {
      if (p.hold) push('pallet', p.id, at('pallet', p.id) || at('zone', doorZone(p.door)), 'Pallet ' + p.id + ' on hold');
    });

    /* 3. Open OS&D findings → the shipment, marked at its dock. */
    var ships = (state.inbound || []);
    ((state.wms && state.wms.osd) || []).forEach(function (f) {
      if (f.status !== 'open' || !f.shipmentId) return;
      var sh = find(ships, function (x) { return x.id === f.shipmentId; });
      var door = sh ? sh.door : null;
      push('shipment', f.shipmentId, at('dock', door) || at('zone', doorZone(door)),
        'Shipment ' + f.shipmentId + ': ' + (f.type === 'photo' ? 'camera finding' : f.type) + ' awaiting a decision');
    });

    /* 4. Open worker flags → the task, marked where the task works. */
    ((state.wms && state.wms.flags) || []).forEach(function (f) {
      if (f.status !== 'open') return;
      var t = f.taskId ? find(state.tasks, function (x) { return x.id === f.taskId; }) : null;
      var why = 'Flag ' + f.id + ' awaiting a decision';
      if (!t) { push(null, f.id, at('zone', f.zone), why, '#/flags'); return; }
      var shipId = /^t-receive-(.+)$/.exec(t.id);
      var sh = shipId ? find(ships, function (x) { return x.id === shipId[1]; }) : null;
      var host = at('pallet', t.stagingId) || at('bin', t.binId) || at('bin', t.toBinId) || at('bin', t.fromBinId) ||
        at('order', t.orderId) || (sh ? at('dock', sh.door) : null) ||
        at('zone', t.zone) || at('zone', binZone(t.binId || t.toBinId)) || at('zone', f.zone);
      push('task', t.id, host, why);
    });
    out.forEach(function (x) { x.why = x.why.join('; '); });
    return out;
  }

  /* host key → [flag] for one render of the map. */
  function flagIndex(list) {
    var ix = {};
    list.forEach(function (f) { if (!f.host) return; var k = f.host.place + '|' + f.host.id; (ix[k] = ix[k] || []).push(f); });
    return ix;
  }

  function flagLink(f) {
    var name = 'Needs a human now — ' + f.why;
    return '<a class="wm-flag" data-flag href="' + esc(f.href) + '" aria-label="' + esc(name) + '" title="' + esc(name) + '"></a>';
  }

  function flagsOn(ix, place, id) {
    var l = ix && ix[place + '|' + id];
    return l ? '<span class="wm-flags">' + l.map(flagLink).join('') + '</span>' : '';
  }

  /* ---------- job ownership (job assignment) ---------------------
     briefs/claude-brief-job-assignment.md: the bird's-eye map gains
     job ownership — each open task of a HELD job carries its holder's
     mark (initials) on the place it works: the dock for a receive, the
     pallet for a putaway, the staged order for a pack or load, the bin
     for a pick, count, breakdown, or the source bin of a move. The map
     still explains nothing: the mark is initials only; the job's
     Witness page shows the owner. Pool jobs carry no mark. Pure. */
  function initials(name) {
    return String(name || '').split(/\s+/).filter(Boolean).map(function (w) { return w.charAt(0).toUpperCase(); }).join('').slice(0, 2);
  }
  function owners(state) {
    var ix = {};
    var jobs = (state.wms && state.wms.jobs) || [];
    if (!jobs.length) return ix;
    var byId = {};
    jobs.forEach(function (j) { if (j.status === 'open' && j.owner) byId[j.id] = j.owner; });
    function mark(place, id, uid) {
      if (!id) return;
      var k = place + '|' + id;
      ix[k] = ix[k] || [];
      if (ix[k].indexOf(uid) === -1) ix[k].push(uid);
    }
    (state.tasks || []).forEach(function (t) {
      var uid = t.status !== 'done' && t.jobId ? byId[t.jobId] : null;
      if (!uid) return;
      if (t.type === 'receive') {
        var sh = null;
        (state.inbound || []).forEach(function (x) { if (x.id === t.shipmentId) sh = x; });
        if (sh) mark('dock', sh.door, uid);
      } else if (t.type === 'putaway') mark('pallet', t.stagingId, uid);
      else if (t.type === 'pack' || t.type === 'load') mark('order', t.orderId, uid);
      else if (t.type === 'pick' || t.type === 'count' || t.type === 'breakdown') mark('bin', t.binId, uid);
      else mark('bin', t.fromBinId, uid);
    });
    return ix;
  }
  function ownerMarks(state, oix, place, id) {
    var l = oix && oix[place + '|' + id];
    if (!l || !l.length) return '';
    return '<span class="wm-owners">' + l.map(function (uid) {
      var u = null;
      (state.labor || []).forEach(function (x) { if (x.id === uid) u = x; });
      return '<span class="wm-owner" data-owner="' + esc(uid) + '" aria-label="' + esc(u ? u.name : uid) + '">' + esc(initials(u ? u.name : uid)) + '</span>';
    }).join('') + '</span>';
  }

  /* ---------- rendering ------------------------------------------- */

  /* An item a person can open: its Witness page. */
  var OPEN = ' data-open tabindex="0" role="link"';

  function dockHtml(side, d, ix, om) {
    if (!d) return '';
    var fl = flagsOn(ix, 'dock', d.doorId) + (om ? ownerMarks(om.state, om.ix, 'dock', d.doorId) : '');
    return '<div class="wm-dock wm-' + side + (d.busy ? ' busy' : '') + '" data-place="dock" data-side="' + side + '" data-id="' + esc(d.doorId) + '"' + OPEN + ' title="' +
      esc(d.name + ' — ' + d.word + (d.ref ? ' ' + d.ref : '')) + '">' + fl +
      '<span class="wm-dock-name">' + esc(d.name) + '</span>' +
      '<span class="wm-dock-state">' + esc(d.word) + (d.ref ? ' <b>' + esc(d.ref) + '</b>' : '') + '</span>' +
      '</div>';
  }

  function palletHtml(p, ix, om) {
    var fl = flagsOn(ix, 'pallet', p.id) + (om ? ownerMarks(om.state, om.ix, 'pallet', p.id) : '');
    return '<span class="wm-pallet' + (p.held ? ' held' : '') + '" data-place="pallet" data-id="' + esc(p.id) + '"' + OPEN + ' title="' +
      esc(p.id + ' · ' + p.qty + ' × ' + p.desc + (p.held ? ' · on hold' : '')) + '">' + fl + '</span>';
  }

  function orderHtml(o, ix, om) {
    var fl = flagsOn(ix, 'order', o.id) + (om ? ownerMarks(om.state, om.ix, 'order', o.id) : '');
    return '<span class="wm-pallet out' + (o.packed ? ' packed' : '') + '" data-place="order" data-id="' + esc(o.id) + '"' + OPEN + ' title="' +
      esc(o.id + (o.customer ? ' · ' + o.customer : '') + (o.packed ? ' · packed' : ' · picked, not packed')) + '">' + fl + '</span>';
  }

  function binHtml(b, ix, om) {
    var fl = flagsOn(ix, 'bin', b.id) + (om ? ownerMarks(om.state, om.ix, 'bin', b.id) : '');
    return '<span class="wm-bin' + (b.stocked ? ' stocked' : '') + (b.held ? ' held' : '') + '" data-place="bin" data-id="' + esc(b.id) + '"' + OPEN + ' title="' +
      esc(b.id + ' — ' + b.title + (b.held ? ' · on hold' : '')) + '">' + esc(b.id) + fl + '</span>';
  }

  /* Anything the walls cannot place, said plainly — never dropped. */
  function looseHtml(l, unplaced) {
    var parts = [];
    if (l.doors.length) parts.push('Doors with no wall: ' + l.doors.join(', '));
    if (l.pallets.length) parts.push('Pallets not at an inbound door: ' + l.pallets.join(', '));
    if (l.orders.length) parts.push('Orders staged away from an outbound door: ' + l.orders.join(', '));
    var fl = (unplaced || []).map(flagLink).join('');
    return parts.length || fl ? '<p class="wm-loose" data-place="loose">' + (parts.length ? 'Not on a wall — ' + esc(parts.join(' · ')) : '') + (fl ? ' <span class="wm-flags wm-flags-loose">' + fl + '</span>' : '') + '</p>' : '';
  }

  function html(state, W) {
    var m = model(state, W);
    var fls = flags(state, W), ix = flagIndex(fls);
    var om = { state: state, ix: owners(state) };
    var n = m.rows;
    var out = '<div class="wm-surface wm-board"><div class="wmap" role="group" aria-label="Warehouse map: inbound docks, receiving bay, bay locations, staging, outbound docks" style="--wm-rows:' + n + '">';

    var span = 'grid-row:2 / span ' + (n + 1);
    out += '<div class="wm-wall-label wm-col-in">Inbound</div><div class="wm-wall-label wm-col-out">Outbound</div>';
    out += '<div class="wm-band wm-col-rcv" style="' + span + '"><span class="wm-band-label">Receiving Bay</span></div>';
    out += '<div class="wm-band wm-col-stg" style="' + span + '"><span class="wm-band-label">Staging</span></div>';
    out += '<div class="wm-bays-head" style="grid-row:2"><span class="wm-band-label">Bay Locations</span></div>';
    out += '<div class="wm-bays" style="grid-row:3 / span ' + n + '">' + m.zones.map(function (z) {
      return '<section class="wm-zone" data-place="zone" data-id="' + esc(z.zone) + '"><h3>Zone ' + esc(z.zone) + flagsOn(ix, 'zone', z.zone) + '</h3><div class="wm-bins">' +
        z.bins.map(function (b) { return binHtml(b, ix, om); }).join('') + '</div></section>';
    }).join('') + '</div>';

    for (var i = 0; i < n; i++) {
      var row = 'grid-row:' + (i + 3), di = m.inbound[i], dout = m.outbound[i];
      out += '<div class="wm-cell wm-col-in" style="' + row + '">' + dockHtml('in', di, ix, om) + '</div>';
      /* Each lane is named for its row: Receiving Bay N beside Inbound
         Dock N, Staging N beside Outbound Dock N (design 2026-11-03). */
      out += '<div class="wm-cell wm-col-rcv wm-lane" style="' + row + '"' + (di ? ' data-place="receiving" data-id="' + esc(di.doorId) + '"><span class="wm-lane-label">Receiving Bay ' + (i + 1) + '</span>' + di.lane.map(function (p) { return palletHtml(p, ix, om); }).join('') : '>') + '</div>';
      out += '<div class="wm-cell wm-col-stg wm-lane" style="' + row + '"' + (dout ? ' data-place="staging" data-id="' + esc(dout.doorId) + '"><span class="wm-lane-label">Staging ' + (i + 1) + '</span>' + dout.lane.map(function (o) { return orderHtml(o, ix, om); }).join('') : '>') + '</div>';
      out += '<div class="wm-cell wm-col-out" style="' + row + '">' + dockHtml('out', dout, ix, om) + '</div>';
    }

    out += '</div>';
    /* No legend: the board reads on its own (design 2026-11-03). */
    out += looseHtml(m.loose, fls.filter(function (f) { return !f.host; })) + '</div>';
    return out;
  }

  /* ---------- task slices: the flow views (Console Task 5) --------
     A task view never shows the whole building. It shows the slice
     the freight moves through, top to bottom, the way it flows:

       inbound  (truck → check → putaway):  Inbound Docks → Receiving Bay → Bay Locations
       outbound (pick → stage → load):      Bay Locations → Staging → Outbound Docks

     Only bins with a reason to be there are drawn (William's bin
     law): inbound, a putaway destination, an open count, or a hold;
     outbound, a pick source or a hold. The page's own panels ride
     under the stage they concern (anchors), so every existing action
     stays as it was. */

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
      if (dir === 'in' && t.type === 'count') add(t.binId, 'Count here');
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
          l.items.map(function (x) { return st.key === 'rcv' ? palletHtml(x) : orderHtml(x); }).join('') + '</div>';
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
  function sliceHtml(state, W, dir, anchors, skip) {
    var sl = slice(state, W, dir);
    anchors = anchors || {};
    /* skip: stage keys a view leaves out (Putaway starts at the
       Receiving Bay — design 2026-11-03). */
    if (skip && skip.length) sl.stages = sl.stages.filter(function (st) { return skip.indexOf(st.key) === -1; });
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

  var api = { model: model, html: html, flags: flags, owners: owners, slice: slice, sliceHtml: sliceHtml, FLOW: FLOW, DOCKS_PER_WALL: DOCKS_PER_WALL };
  root.WitnessWmsMap = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
