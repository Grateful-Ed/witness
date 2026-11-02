/* =====================================================================
   wms-ui.js — the Witness WMS desk console (wms.html).

   Renders the state and forwards actions. Every state change goes
   through js/wms.js (the WMS layer on engine.js) inside
   store.mutate(): fetch fresh from the desk record → apply → save.
   Voice goes to the Worker's /asr (js/warehouse-mic.js); reading,
   labeling and photos go to /chat (js/wms-ai.js, js/converse.js).
   ===================================================================== */
(function () {
  'use strict';

  var E = window.WitnessEngine;
  var C = window.WitnessConverse;
  var W = window.WitnessWms;
  var AI = window.WitnessWmsAi;
  var S = window.WitnessWmsStore;
  var B = window.WitnessBol;
  var Mic = window.WitnessMic;

  var params = new URLSearchParams(location.search);
  var state = null;
  var me = null;            /* labor unit id of who is signed in */
  var busy = false;
  var micActive = false;
  var lastSync = null;
  var ui = {                /* page-only selections; never saved */
    rcvShip: null, rcvLines: null, rcvTranscript: '', rcvSource: 'typed', rcvPhoto: null, rcvPhotoFlags: [],
    selBin: null, zoneFilter: '', binSearch: '', taskType: '', taskZone: '', taskStatus: 'active',
    recKind: '', rfUnit: null, rfReply: '', rfHeard: '', rfPhoto: null, rfPhotoRead: null,
    flagWords: '', ask: null, askBusy: false, camFor: null, pin: null
  };

  var store = S.create({
    fetch: window.fetch.bind(window),
    seed: W.seed,
    prepare: function (s) { W.install(s); W.refresh(s); return s; },
    check: function (s) {
      if (s.world && s.world !== 'warehouse') {
        return 'The desk record holds the ' + s.world + ' world, not the warehouse. The WMS will not act on it. ' +
          'Use practice mode, or reset the desk record to the warehouse (that replaces the ' + s.world + ' state).';
      }
      return null;
    },
    practice: params.has('practice')
  });

  /* ---------- helpers --------------------------------------------- */

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function time(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return isNaN(d) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function uname(id) { var u = id ? E.unitById(state, id) : null; return u ? u.name : (id ? id : 'Desk'); }
  function chip(text, cls) { return '<span class="chip ' + (cls || '') + '">' + esc(text) + '</span>'; }
  function isManager() { var u = E.unitById(state, me); return u && u.role === 'manager'; }
  function managerId() { var m = null; state.labor.forEach(function (u) { if (!m && u.role === 'manager') m = u.id; }); return m; }
  function workers() { return state.labor.filter(function (u) { return u.role === 'worker'; }); }
  function val(id) { var el = $(id); return el ? el.value : ''; }
  function opt(v, label, sel) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(label) + '</option>'; }
  function items() { return Object.keys(state.wms.items).sort(); }

  var toastTimer = null;
  function toast(text, bad) {
    var t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); document.body.appendChild(t); }
    t.className = 'toast' + (bad ? ' bad' : '');
    t.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, bad ? 7000 : 4200);
  }

  function setSync(text, cls) {
    var p = $('syncPill');
    p.textContent = text;
    p.className = 'sync' + (cls ? ' ' + cls : '');
  }
  function syncIdle() {
    if (store.practice()) setSync('Practice copy — not saved', 'practice');
    else setSync('Desk record' + (lastSync ? ' · ' + lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''));
  }

  /* Run one mutation against the desk record. fn(state) returns the
     WMS result; ok:false saves nothing and the reason is shown. */
  function act(fn, okText) {
    if (busy) return Promise.resolve(null);
    busy = true;
    setSync('Saving…', 'busy');
    return store.mutate(fn).then(function (res) {
      state = res.state;
      busy = false;
      if (res.saved) lastSync = new Date();
      syncIdle();
      var r = res.result || {};
      if (r.ok === false) toast(r.reason || r.reply || 'Nothing was changed.', true);
      else if (okText !== null) toast(typeof okText === 'function' ? okText(r) : (okText || r.text || r.reply || 'Saved to the desk record.'));
      render();
      return r;
    }).catch(function (e) {
      busy = false;
      setSync('Not saved', 'err');
      toast((e && e.userMessage) || 'Something went wrong. Nothing was saved.', true);
      return null;
    });
  }

  function reload(quiet) {
    if (busy || micActive) return Promise.resolve();
    return store.load().then(function (res) {
      state = res.state;
      if (res.seeded) lastSync = new Date();
      else lastSync = new Date();
      syncIdle();
      render();
      if (!quiet && res.seeded) toast(store.practice() ? 'Practice copy started. Nothing is saved to the desk record.' : 'No desk record yet — the WMS building was seeded and saved once.');
    }).catch(function (e) {
      if (quiet) { setSync('Desk record unreachable', 'err'); return; }
      fatal((e && e.userMessage) || 'The desk record could not be loaded.', e && e.code);
    });
  }

  function fatal(msg, code) {
    setSync('Not loaded', 'err');
    $('main').innerHTML = '<div class="fatal panel"><div class="panel-h"><h2>Desk record</h2></div><div class="panel-b">' +
      '<div class="notice bad">' + esc(msg) + '</div>' +
      '<p class="hint">The WMS acts only on the shared desk record, so nothing on this page is pretend. Practice mode runs an in-memory copy that is never saved — every screen says so.</p>' +
      '<div class="form-actions"><button class="btn primary" data-act="retry">Try again</button>' +
      '<button class="btn" data-act="practice">Use a practice copy (not saved)</button>' +
      (code === 'other-world' ? '<button class="btn danger" data-act="reset-world">Reset desk record to the warehouse</button>' : '') +
      '</div></div></div>';
  }

  /* ---------- downscale a photo for /chat --------------------------- */
  function photoToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var fit = B.fitWithin(img.naturalWidth, img.naturalHeight, B.SEND_MAX);
        var c = document.createElement('canvas');
        c.width = fit.w; c.height = fit.h;
        c.getContext('2d').drawImage(img, 0, 0, fit.w, fit.h);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', B.SEND_QUALITY));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That file could not be read as a photo.')); };
      img.src = url;
    });
  }

  /* ---------- navigation ---------------------------------------------- */

  var NAV = [
    { group: 'Overview' },
    { id: 'dashboard', label: 'Warehouse Map' },
    { group: 'Inbound' },
    { id: 'dock', label: 'Dock & Yard' },
    { id: 'receiving', label: 'Receiving' },
    { id: 'osd', label: 'OS&D Findings', badge: function () { return state.wms.osd.filter(function (f) { return f.status === 'open'; }).length; } },
    { id: 'putaway', label: 'Putaway' },
    { group: 'Inventory' },
    { id: 'locations', label: 'Locations' },
    { id: 'items', label: 'Item Inventory' },
    { id: 'counts', label: 'Cycle Counts' },
    { id: 'replen', label: 'Replenishment', badge: function () { return W.slotStatus(state).filter(function (s) { return s.state !== 'ok'; }).length; }, info: true },
    { group: 'Outbound' },
    { id: 'orders', label: 'Orders & Waves' },
    { id: 'picking', label: 'Picking' },
    { id: 'ship', label: 'Pack & Ship' },
    { group: 'Labor' },
    { id: 'queues', label: 'Task Queues' },
    { id: 'labor', label: 'Labor Management', badge: function () { return W.proposals(state).length; }, info: true },
    { group: 'Control' },
    { id: 'flags', label: 'Flags & Incidents', badge: function () { return state.wms.flags.filter(function (f) { return f.status === 'open'; }).length; } },
    { id: 'summary', label: 'Shift Summary' },
    { id: 'audit', label: 'Audit Trail' },
    { group: 'Floor' },
    { id: 'rf', label: 'RF Console (worker)' }
  ];
  var WORKER_VIEWS = ['rf', 'flags'];

  function route() {
    var r = (location.hash || '').replace(/^#\/?/, '') || (isManager() ? 'dashboard' : 'rf');
    if (!isManager() && WORKER_VIEWS.indexOf(r) === -1) r = 'rf';
    return r;
  }

  function renderNav(cur) {
    var html = '';
    var mgr = isManager();
    NAV.forEach(function (n) {
      if (n.group) { if (mgr || n.group === 'Floor' || n.group === 'Control') html += '<div class="nav-group">' + esc(n.group) + '</div>'; return; }
      if (!mgr && WORKER_VIEWS.indexOf(n.id) === -1) return;
      var b = n.badge ? n.badge() : 0;
      html += '<a class="nav-item' + (n.id === cur ? ' active' : '') + '" href="#/' + n.id + '"><span>' + esc(n.label) + '</span>' +
        (b ? '<span class="nav-badge' + (n.info ? ' info' : '') + '">' + b + '</span>' : '') + '</a>';
    });
    $('sidenav').innerHTML = html;
  }

  function renderWho() {
    var sel = $('whoSel');
    var html = '';
    state.labor.forEach(function (u) {
      html += opt(u.id, u.name + (u.role === 'manager' ? ' (Manager)' : ' (Zone ' + u.zone + ')'), u.id === me);
    });
    sel.innerHTML = html;
  }

  function head(crumb, title, desc, tools) {
    return '<div class="crumbs">DC-01 › ' + esc(crumb) + '</div><div class="page-head"><div><h1>' + esc(title) + '</h1>' +
      (desc ? '<p>' + desc + '</p>' : '') + '</div><div class="toolbar">' + (tools || '') +
      '<button class="btn" data-act="refresh" title="Read the desk record again">⟳ Refresh</button></div></div>' +
      (store.practice() ? '<div class="notice practice"><b>Practice copy.</b> Nothing on this page is saved to the desk record.</div>' : '') +
      '<!--/head-->';
  }

  function panel(title, body, sub, flush) {
    return '<section class="panel"><div class="panel-h"><h2>' + esc(title) + '</h2>' + (sub ? '<span class="sub">' + sub + '</span>' : '') +
      '</div><div class="panel-b' + (flush ? ' flush' : '') + '">' + body + '</div></section>';
  }

  function table(cols, rows, emptyText) {
    if (!rows.length) return '<div class="empty">' + esc(emptyText || 'Nothing here.') + '</div>';
    return '<div class="table-wrap"><table class="grid"><thead><tr>' + cols.map(function (c) {
      var cls = /^#|Qty|Exp|Rec|Dmg|On hand|Held|Reserved|Avail|Min|Max|Units|Cartons|Lb|Done|Waiting|Workers/.test(c) ? ' class="num"' : '';
      return '<th' + cls + '>' + esc(c) + '</th>';
    }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }

  function taskChip(t) {
    var b = W.blocked(state, t);
    if (t.status === 'done') return chip('Done', 'ok');
    if (b) return '<span title="' + esc(b) + '">' + chip('Blocked', 'bad') + '</span>';
    if (t.status === 'assigned') return chip('In progress', 'info');
    if (t.queuedFor) return chip('Queued · ' + uname(t.queuedFor).split(' ')[0], 'warn');
    return chip('Open');
  }

  function stageChip(st) {
    var map = { new: 'warn', allocating: 'bad', allocated: 'info', picking: 'info', picked: 'warn', packed: 'info', staged: 'warn',
      loading: 'info', loaded: 'info', shipped: 'ok', expected: '', arrived: 'warn', receiving: 'info', putaway: 'info', closed: 'ok' };
    return chip(st.key.charAt(0).toUpperCase() + st.key.slice(1), map[st.key] || '');
  }

  /* ---------- views ------------------------------------------------- */

  var VIEWS = {};

  /* The home: the building itself (js/wms-map.js). No tables here. */
  VIEWS.dashboard = function () {
    return head('Overview', 'Warehouse', 'The building, live from the desk record.') + window.WitnessWmsMap.html(state, W);
  };

  function doorsHtml() {
    return '<div class="doors">' + state.doors.map(function (d) {
      var what = '';
      if (d.shipmentId) {
        var s = E.shipmentById(state, d.shipmentId);
        what = 'Inbound ' + d.shipmentId + (s && s.bol ? ' · BOL ' + s.bol.bolNumber : '');
      } else if (d.loadId) {
        var ld = null; state.wms.loads.forEach(function (l) { if (l.id === d.loadId) ld = l; });
        what = 'Outbound ' + d.loadId + (ld ? ' · ' + ld.trailer + ' · ' + ld.orderIds.length + ' order(s)' : '');
      }
      var staged = state.staging.filter(function (p) { return p.door === d.id; }).length;
      if (staged) what += (what ? ' · ' : '') + staged + ' pallet' + (staged === 1 ? '' : 's') + ' staged';
      return '<div class="door ' + esc(d.state) + '"><div class="d-id">' + esc(d.id) + ' <span class="hint">Zone ' + esc(d.zone) + '</span></div>' +
        '<div class="d-state">' + esc(d.state) + '</div><div class="d-what">' + esc(what || 'Clear') + '</div></div>';
    }).join('') + '</div>';
  }

  function recordsHtml(list) {
    if (!list.length) return '<div class="empty">Nothing recorded yet.</div>';
    if (LOOK === 'record') return ledgerHtml(list);
    return table(['Time', 'Kind', 'What happened'], list.map(function (r) {
      return '<tr><td class="id">' + time(r.ts) + '</td><td>' + chip(r.kind || 'note', r.kind === 'incident' ? 'bad' : (r.kind === 'ship' || r.kind === 'complete' ? 'ok' : '')) + '</td><td>' + esc(r.text) + '</td></tr>';
    }));
  }

  /* ---- Dock & Yard ---- */
  VIEWS.dock = function () {
    var html = head('Inbound › Dock & Yard', 'Dock & Yard', 'Door appointments for inbound trailers. A door can hold one window at a time; check-in brings the trailer to the door and opens receiving.');
    var rows = state.wms.appointments.slice().sort(function (a, b) { return (a.day + a.start) < (b.day + b.start) ? -1 : 1; }).map(function (a) {
      var s = E.shipmentById(state, a.shipmentId);
      var st = a.status === 'checked in' ? chip('Checked in', 'info') : a.status === 'complete' ? chip('Complete', 'ok') : chip('Scheduled', 'warn');
      return '<tr><td class="id">' + esc(a.id) + '</td><td class="id">' + esc(a.shipmentId) + '</td><td class="id">' + esc(s && s.bol ? s.bol.bolNumber : '—') + '</td><td>' + esc(a.carrier) + '</td><td class="id">' + esc(a.trailer || '—') + '</td><td>' +
        esc(a.door) + '</td><td>' + esc(a.day) + ' ' + esc(a.start) + '–' + esc(a.end) + '</td><td>' + st + (a.checkInAt ? ' <span class="hint">' + time(a.checkInAt) + '</span>' : '') + '</td><td class="actions">' +
        (a.status === 'scheduled' ? '<button class="btn small primary" data-act="checkin" data-id="' + esc(a.id) + '">Check in</button>' : '') + '</td></tr>';
    });
    var ships = state.inbound.filter(function (s) { return s.status !== 'received' && s.status !== 'staged at door'; });
    var form = ships.length ? '<div class="form">' +
      '<div class="field"><label>Shipment</label><select id="apShip">' + ships.map(function (s) { return opt(s.id, s.id + ' — ' + s.desc); }).join('') + '</select></div>' +
      '<div class="field"><label>Door</label><select id="apDoor">' + state.doors.filter(function (d) { return d.direction !== 'out'; }).map(function (d) { return opt(d.id, d.id + ' (Zone ' + d.zone + ')'); }).join('') + '</select></div>' +
      '<div class="field"><label>Day</label><select id="apDay">' + opt('Today', 'Today') + opt('Tomorrow', 'Tomorrow') + '</select></div>' +
      '<div class="field"><label>Start</label><input id="apStart" type="time" value="13:00"></div>' +
      '<div class="field"><label>End</label><input id="apEnd" type="time" value="14:00"></div>' +
      '<div class="field"><label>Trailer</label><input id="apTrailer" type="text" placeholder="e.g. SEL-2208"></div>' +
      '</div><div class="form-actions"><button class="btn primary" data-act="schedule">Schedule / reschedule</button></div>'
      : '<p class="empty">Every inbound shipment is already at a door or received.</p>';
    html += panel('Dock doors', doorsHtml());
    html += panel('Appointments', table(['Appt', 'Shipment', 'BOL', 'Carrier', 'Trailer', 'Door', 'Window', 'Status', ''], rows, 'No appointments.'), null, true);
    html += panel('Schedule a door', form, 'conflicts on the same door are refused');
    return html;
  };

  /* ---- Receiving ---- */
  VIEWS.receiving = function () {
    var html = head('Inbound › Receiving', 'Receiving', 'Receive against the BOL already in the system. Speak the count or type it; a human posts the receipt. Every shortage, overage and damage becomes an OS&D finding, quoted in the receiver\'s own words.');
    var rows = state.inbound.map(function (s) {
      var st = W.inboundStatus(state, s);
      var sel = ui.rcvShip === s.id;
      return '<tr class="' + (sel ? 'sel' : '') + '"><td class="id">' + esc(s.id) + '</td><td class="id">' + esc(s.bol ? s.bol.bolNumber : '—') + '</td><td>' + esc(s.desc) + '</td><td>' + esc(s.door) +
        '</td><td class="num">' + esc(s.pallets) + '</td><td>' + stageChip(st) + ' <span class="hint">' + esc(st.words) + '</span></td><td class="actions">' +
        (s.status === 'staged at door' ? '<button class="btn small primary" data-act="rcv-open" data-id="' + esc(s.id) + '">Receive</button>' : '') + '</td></tr>';
    });
    html += panel('Inbound shipments (ASN / BOL on file)', table(['Shipment', 'BOL #', 'Description', 'Door', 'Pallets', 'Status', ''], rows), null, true);

    var s = ui.rcvShip ? E.shipmentById(state, ui.rcvShip) : null;
    if (s && s.status === 'staged at door') {
      var exp = W.expectedLines(s);
      if (!ui.rcvLines || ui.rcvLines.length !== exp.length) {
        ui.rcvLines = exp.map(function (l) { return { desc: l.desc, expected: l.expected, received: '', damaged: '', quote: '' }; });
      }
      var lrows = ui.rcvLines.map(function (l, i) {
        return '<tr><td>' + esc(l.desc) + '</td><td class="num">' + l.expected + '</td><td class="num"><input class="cell" data-rcv="received" data-i="' + i + '" inputmode="numeric" value="' + esc(l.received == null ? '' : l.received) + '"></td>' +
          '<td class="num"><input class="cell" data-rcv="damaged" data-i="' + i + '" inputmode="numeric" value="' + esc(l.damaged == null ? '' : l.damaged) + '"></td><td>' +
          (l.quote ? '<span class="quote">' + esc(l.quote) + '</span>' : '<span class="hint">—</span>') + '</td></tr>';
      });
      var bol = s.bol || {};
      var body = '<p class="hint">BOL <b>' + esc(bol.bolNumber || 'not on file') + '</b> · ' + esc(bol.carrier || '') + ' · shipper ' + esc(bol.shipper || '—') +
        ' · claims ' + esc(bol.piecesClaimed == null ? '—' : bol.piecesClaimed) + ' pieces · at ' + esc(s.door) + '</p>' +
        table(['Item', 'BOL qty', 'Received', 'Damaged', 'Receiver\'s words'], lrows) +
        '<div class="form-actions">' +
        '<button class="btn talk" id="rcvTalk" type="button">🎙 Hold to speak the count</button>' +
        '<button class="btn" data-act="cam" data-for="dock">📷 Photo of the freight</button>' +
        '<a class="btn" href="index.html">Full two-scan cross-check ↗</a>' +
        '<span class="hint" id="rcvStatus"></span></div>' +
        (ui.rcvTranscript ? '<div class="heard"><b>Heard</b><span class="quote">' + esc(ui.rcvTranscript) + '</span></div>' : '') +
        (ui.rcvPhoto ? '<img class="photo-preview" src="' + ui.rcvPhoto + '" alt="Freight photo">' : '') +
        (ui.rcvPhotoFlags.length ? '<div class="heard"><b>Photo flags (attach to the receipt as findings)</b>' + ui.rcvPhotoFlags.map(function (f) {
          return '<div>' + chip(f.label, /sound/i.test(f.label) ? 'ok' : 'warn') + ' ' + esc(f.detail) + '</div>';
        }).join('') + '</div>' : '') +
        '<div class="form-actions"><button class="btn primary" data-act="rcv-post">Post receipt</button><button class="btn" data-act="rcv-clear">Clear</button></div>' +
        '<p class="law">The machine fills in what it heard; a human checks the numbers and posts. Nothing posts on its own.</p>';
      html += panel('Receive ' + s.id + ' — ' + s.desc, body, 'counts against the BOL on file');
    } else {
      html += panel('Receive', '<p class="empty">Check a trailer in at Dock & Yard, then pick a shipment at a door above.</p>');
    }
    var rr = state.wms.receipts.slice().reverse().map(function (r) {
      var units = 0, dmg = 0; r.lines.forEach(function (l) { units += l.received; dmg += l.damaged; });
      return '<tr><td class="id">' + esc(r.id) + '</td><td class="id">' + esc(r.shipmentId) + '</td><td class="id">' + esc(r.bolNumber || '—') + '</td><td class="num">' + units + '</td><td class="num">' + dmg +
        '</td><td>' + esc(r.source) + '</td><td>' + esc(uname(r.by)) + '</td><td class="id">' + time(r.ts) + '</td><td class="num">' + r.osdIds.length + '</td></tr>';
    });
    html += panel('Receipts posted', table(['Receipt', 'Shipment', 'BOL', 'Units', 'Dmg', 'Source', 'Receiver', 'Time', 'OS&D'], rr, 'No receipts yet.'), null, true);
    return html;
  };

  /* ---- OS&D ---- */
  VIEWS.osd = function () {
    var html = head('Inbound › OS&D', 'OS&D Findings', 'Overage, shortage and damage found at receiving. Each finding keeps the receiver\'s exact words. Records stay open: close a finding with a note when it is settled.');
    var rows = state.wms.osd.slice().reverse().map(function (f) {
      var cls = f.type === 'damage' ? 'bad' : f.type === 'shortage' ? 'warn' : f.type === 'overage' ? 'info' : '';
      return '<tr><td class="id">' + esc(f.id) + '</td><td class="id">' + esc(f.shipmentId) + '</td><td>' + chip(f.type === 'photo' ? 'Photo: ' + f.label : f.type, cls) + '</td><td>' + esc(f.desc || '—') +
        '</td><td class="num">' + esc(f.qty == null ? '—' : f.qty) + '</td><td class="num">' + esc(f.expected == null ? '—' : f.expected) + '</td><td class="num">' + esc(f.received == null ? '—' : f.received) +
        '</td><td><span class="quote">' + esc(f.words) + '</span></td><td>' + (f.status === 'open' ? chip('Open', 'bad') : chip('Closed', 'ok') + (f.note ? ' <span class="hint">' + esc(f.note) + '</span>' : '')) +
        '</td><td class="actions">' + (f.status === 'open' ? '<button class="btn small" data-act="osd-close" data-id="' + esc(f.id) + '">Close…</button>' : '') + '</td></tr>';
    });
    html += panel('Findings', table(['ID', 'Shipment', 'Type', 'Item', 'Qty', 'Exp', 'Rec', 'Words on record', 'Status', ''], rows, 'No OS&D findings. Receive a shipment to create them.'), null, true);
    return html;
  };

  /* ---- Putaway ---- */
  VIEWS.putaway = function () {
    var html = head('Inbound › Putaway', 'Putaway', 'Every staged pallet is directed to a bin. The worker confirms by voice ("in A-03") or by a photo of the bin label on the RF console; a different bin is allowed and recorded as suggested vs. actual.');
    var rows = state.tasks.filter(function (t) { return t.type === 'putaway' && t.status !== 'done'; }).map(function (t) {
      var p = null; state.staging.forEach(function (x) { if (x.id === t.stagingId) p = x; });
      return '<tr><td class="id">' + esc(t.stagingId) + '</td><td>' + esc(p ? p.desc : '') + '</td><td class="num">' + esc(p ? p.qty : '') + '</td><td>' + esc(p ? p.door : '') + '</td><td class="id">' +
        esc(t.toBinId ? dest(t.toBinId) : '—') + '</td><td>' + taskChip(t) + '</td><td>' + esc(t.assignee ? uname(t.assignee) : '—') + '</td><td class="actions">' +
        '<input class="cell" style="width:70px" id="pa-' + esc(t.id) + '" placeholder="' + esc(t.toBinId || '') + '"> <button class="btn small" data-act="pa-confirm" data-id="' + esc(t.id) + '">Confirm</button></td></tr>';
    });
    html += panel('Directed putaway', table(['Pallet', 'Item', 'Qty', 'At', 'Destination', 'Status', 'Worker', 'Confirm bin'], rows, 'No pallets waiting for putaway.'), null, true);
    var held = state.staging.filter(function (p) { return p.hold; }).map(function (p) {
      return '<tr><td class="id">' + esc(p.id) + '</td><td>' + esc(p.desc) + '</td><td class="num">' + p.qty + '</td><td>' + esc(p.door) + '</td><td>' + esc(p.hold.reason) + '</td><td class="actions">' +
        '<button class="btn small" data-act="release" data-stg="' + esc(p.id) + '">Release</button></td></tr>';
    });
    html += panel('Pallets on hold at the dock', table(['Pallet', 'Item', 'Qty', 'At', 'Why', ''], held, 'No pallets on hold.'), 'held stock gets no putaway task until released', true);
    var done = state.tasks.filter(function (t) { return t.type === 'putaway' && t.status === 'done'; }).slice(-10).reverse().map(function (t) {
      return '<tr><td class="id">' + esc(t.stagingId) + '</td><td>' + esc(t.title) + '</td><td class="id">' + esc(t.suggestedBinId || t.toBinId) + '</td><td class="id">' + esc(t.toBinId) +
        '</td><td>' + esc(uname(t.doneBy)) + '</td><td class="id">' + time(t.doneAt) + '</td></tr>';
    });
    html += panel('Completed putaway', table(['Pallet', 'Task', 'Suggested', 'Actual', 'By', 'Time'], done, 'None yet.'), null, true);
    return html;
  };

  /* ---- Locations ---- */
  VIEWS.locations = function () {
    var html = head('Inventory › Locations', 'Locations', 'Live stock by bin. Hatched bins are on hold: excluded from allocation, picks, moves and putaway until released. PICK marks a min/max pick face.');
    var faces = {}; state.wms.slots.forEach(function (s) { faces[s.binId] = s; });
    var q = ui.binSearch.toLowerCase();
    var filt = '<div class="filters"><div class="field"><label>Zone</label><select id="fZone">' + opt('', 'All zones', !ui.zoneFilter) +
      state.zones.map(function (z) { return opt(z, 'Zone ' + z, ui.zoneFilter === z); }).join('') + '</select></div>' +
      '<div class="field"><label>Item or bin</label><input id="fBin" type="search" value="' + esc(ui.binSearch) + '" placeholder="e.g. peaches"></div></div>';
    var map = state.zones.filter(function (z) { return !ui.zoneFilter || z === ui.zoneFilter; }).map(function (z) {
      return '<div class="zone-row"><h3>Zone ' + esc(z) + '</h3><div class="bins">' + state.bins.filter(function (b) { return b.zone === z; }).map(function (b) {
        var match = !q || b.id.toLowerCase().indexOf(q) !== -1 || b.contents.some(function (c) { return c.desc.toLowerCase().indexOf(q) !== -1; });
        var cls = 'bin' + (b.status === 'hold' ? ' held' : '') + (!b.contents.length ? ' emptyb' : '') + (ui.selBin === b.id ? ' sel' : '');
        return '<button type="button" class="' + cls + '" data-act="bin" data-id="' + esc(b.id) + '" style="' + (match ? '' : 'opacity:.3') + '">' +
          '<span class="b-id">' + esc(b.id) + '</span>' + (faces[b.id] ? '<span class="b-tag">PICK</span>' : '') +
          (b.contents.length ? b.contents.map(function (c) { return '<span class="b-line"><span class="b-qty">' + c.qty + '</span> ' + esc(c.desc.replace(/ — .*/, '')) + '</span>'; }).join('') : '<span class="b-line">Empty</span>') +
          (b.status === 'hold' ? '<span class="b-line" style="color:#b3261e">ON HOLD</span>' : '') + '</button>';
      }).join('') + '</div></div>';
    }).join('');
    var left = panel('Location map', filt + '<div class="panel-b">' + map + '</div>', null, true);
    html += '<div class="grid2"><div>' + left + '</div><div>' + binDetail() + '</div></div>';
    return html;
  };

  function binDetail() {
    var b = ui.selBin ? E.binById(state, ui.selBin) : null;
    if (!b) return panel('Bin detail', '<p class="empty">Pick a bin on the map.</p>');
    var rows = b.contents.map(function (c) {
      var r = W.reserved(state, b.id, c.desc);
      return '<tr><td>' + esc(c.desc) + '</td><td class="id">' + esc(W.item(state, c.desc).sku) + '</td><td class="num">' + c.qty + '</td><td class="num">' + r + '</td><td class="num">' + W.freeIn(state, b, c.desc) + '</td></tr>';
    });
    var body = '<p>' + (b.status === 'hold' ? chip('On hold', 'bad') + ' <span class="hint">' + esc(b.hold && b.hold.reason ? b.hold.reason : '') + '</span>' : chip('Available', 'ok')) + ' ' + chip('Zone ' + b.zone) + '</p>' +
      table(['Item', 'SKU', 'On hand', 'Reserved', 'Avail'], rows, 'Empty bin.');
    body += '<div class="form-actions">' + (b.status === 'hold'
      ? '<button class="btn" data-act="release" data-bin="' + esc(b.id) + '">Release hold</button>'
      : '<input class="cell" style="width:180px;text-align:left" id="holdWhy" placeholder="Why hold?"> <button class="btn danger" data-act="hold" data-bin="' + esc(b.id) + '">Put on hold</button>') +
      '<button class="btn" data-act="count-bin" data-id="' + esc(b.id) + '">Cycle count</button></div>';
    if (b.contents.length && b.status !== 'hold') {
      body += '<h3 class="hint" style="margin-top:12px">Move stock out of ' + esc(b.id) + '</h3><div class="form">' +
        '<div class="field"><label>Item</label><select id="mvDesc">' + b.contents.map(function (c) { return opt(c.desc, c.desc); }).join('') + '</select></div>' +
        '<div class="field"><label>To bin</label><select id="mvTo">' + state.bins.filter(function (x) { return x.id !== b.id; }).map(function (x) { return opt(x.id, x.id + (x.status === 'hold' ? ' (held)' : '')); }).join('') + '</select></div>' +
        '<div class="field"><label>Qty</label><input id="mvQty" inputmode="numeric" value="1"></div></div>' +
        '<div class="form-actions"><button class="btn primary" data-act="move" data-id="' + esc(b.id) + '">Create move task</button></div>';
    }
    return panel('Bin ' + b.id, body);
  }

  /* ---- Item inventory ---- */
  VIEWS.items = function () {
    var html = head('Inventory › Items', 'Item Inventory', 'On hand across all bins. Held stock and stock reserved for released orders are not available to allocate.');
    var rows = W.inventory(state).map(function (r) {
      return '<tr><td class="id">' + esc(r.sku) + '</td><td>' + esc(r.desc) + '</td><td>' + esc(r.uom) + '</td><td class="num">' + r.onHand + '</td><td class="num">' + (r.held ? '<b style="color:#b3261e">' + r.held + '</b>' : 0) +
        '</td><td class="num">' + r.reserved + '</td><td class="num"><b>' + r.available + '</b></td><td class="id">' + esc(r.bins.join(', ')) + '</td></tr>';
    });
    var inbound = state.staging.map(function (p) {
      return '<tr><td class="id">' + esc(p.id) + '</td><td>' + esc(p.desc) + '</td><td class="num">' + p.qty + '</td><td>' + esc(p.door) + '</td><td>' + (p.hold ? chip('On hold', 'bad') : chip('Awaiting putaway', 'warn')) + '</td></tr>';
    });
    html += panel('Stock by item', table(['SKU', 'Description', 'UOM', 'On hand', 'Held', 'Reserved', 'Avail', 'Bins'], rows), null, true);
    html += panel('Staged at the dock (not yet in a bin)', table(['Pallet', 'Item', 'Qty', 'Door', 'Status'], inbound, 'Nothing staged.'), null, true);
    return html;
  };

  /* ---- Cycle counts ---- */
  VIEWS.counts = function () {
    var d = W.dashboard(state);
    var html = head('Inventory › Cycle Counts', 'Cycle Counts', 'Small, ongoing blind counts. The counter never sees the system number; variances adjust the bin and are kept with the counter\'s words. A short pick queues a count on its own.',
      '<select class="cell" style="width:auto" id="ccZone">' + state.zones.map(function (z) { return opt(z, 'Zone ' + z); }).join('') + '</select> <button class="btn primary" data-act="count-zone">Count occupied bins in zone</button>');
    var open = state.tasks.filter(function (t) { return t.type === 'count' && t.status !== 'done'; }).map(function (t) {
      var b = E.binById(state, t.binId);
      var inputs = (b.contents.length ? b.contents : [{ desc: '(nothing)' }]).map(function (c, i) {
        return '<div style="margin:2px 0"><span class="hint">' + esc(c.desc) + '</span> <input class="cell" data-cc="' + esc(t.id) + '" data-desc="' + esc(c.desc === '(nothing)' ? '' : c.desc) + '" inputmode="numeric" placeholder="count"></div>';
      }).join('');
      return '<tr><td class="id">' + esc(t.id) + '</td><td class="id">' + esc(t.binId) + '</td><td>' + esc(t.reason) + '</td><td>' + taskChip(t) + '</td><td>' + esc(t.assignee ? uname(t.assignee) : '—') + '</td><td>' + inputs +
        '</td><td class="actions"><button class="btn small primary" data-act="count-post" data-id="' + esc(t.id) + '">Post count</button></td></tr>';
    });
    html += panel('Open counts', table(['Task', 'Bin', 'Reason', 'Status', 'Counter', 'Count (blind)', ''], open, 'No counts waiting.'), 'accuracy ' + (d.accuracy == null ? '—' : d.accuracy + '%'), true);
    var hist = state.wms.counts.slice().reverse().map(function (c) {
      var off = c.lines.filter(function (l) { return l.variance; });
      return '<tr><td class="id">' + esc(c.id) + '</td><td class="id">' + esc(c.binId) + '</td><td>' + (off.length ? off.map(function (l) {
        return esc(l.desc) + ': system ' + l.system + ', counted ' + l.counted + ' <b style="color:' + (l.variance < 0 ? '#b3261e' : '#1e7b45') + '">(' + (l.variance > 0 ? '+' : '') + l.variance + ')</b>';
      }).join('<br>') : chip('Matches', 'ok')) + '</td><td>' + esc(c.reason || '') + '</td><td>' + esc(uname(c.by)) + '</td><td>' + (c.words ? '<span class="quote">' + esc(c.words) + '</span>' : '—') + '</td><td class="id">' + time(c.ts) + '</td></tr>';
    });
    html += panel('Count history & adjustments', table(['Count', 'Bin', 'Variance', 'Reason', 'Counter', 'Words', 'Time'], hist, 'No counts posted yet.'), null, true);
    return html;
  };

  /* ---- Replenishment ---- */
  VIEWS.replen = function () {
    var html = head('Inventory › Replenishment', 'Replenishment', 'Min/max pick faces. A face below min gets a task to bring it toward max from reserve stock in another bin. No reserve, no task — the exception says so.');
    var rows = W.slotStatus(state).map(function (s) {
      var pct = Math.min(100, Math.round(100 * s.onHand / s.max));
      var t = s.taskId ? E.taskById(state, s.taskId) : null;
      return '<tr><td class="id">' + esc(s.binId) + '</td><td>' + esc(s.desc) + '</td><td class="num">' + s.min + '</td><td class="num">' + s.max + '</td><td class="num"><b>' + s.onHand + '</b></td><td style="width:18%"><div class="bar ' +
        (s.state === 'ok' ? '' : 'warn') + '"><span style="width:' + pct + '%"></span></div></td><td>' + (s.state === 'ok' ? chip('OK', 'ok') : s.state === 'exception' ? chip(s.exception, 'bad') : chip('Below min', 'warn')) +
        '</td><td>' + (t ? esc(t.title) + ' ' + taskChip(t) : '—') + '</td></tr>';
    });
    html += panel('Pick faces', table(['Bin', 'Item', 'Min', 'Max', 'On hand', 'Level', 'Status', 'Replenishment task'], rows), null, true);
    var tasks = state.tasks.filter(function (t) { return t.type === 'replen'; }).slice().reverse().map(function (t) {
      return '<tr><td class="id">' + esc(t.id) + '</td><td>' + esc(t.title) + '</td><td class="id">' + esc(t.fromBinId) + ' → ' + esc(t.toBinId) + '</td><td class="num">' + (t.movedQty == null ? t.qty : t.movedQty) + '</td><td>' + taskChip(t) + '</td><td>' + esc(t.assignee ? uname(t.assignee) : t.doneBy ? uname(t.doneBy) : '—') + '</td></tr>';
    });
    html += panel('Replenishment tasks', table(['Task', 'What', 'From → to', 'Qty', 'Status', 'Worker'], tasks, 'No replenishment tasks yet.'), null, true);
    html += panel('Set a pick face', '<div class="form"><div class="field"><label>Bin</label><select id="slBin">' + state.bins.map(function (b) { return opt(b.id, b.id); }).join('') + '</select></div>' +
      '<div class="field"><label>Item</label><select id="slDesc">' + items().map(function (d) { return opt(d, d); }).join('') + '</select></div>' +
      '<div class="field"><label>Min</label><input id="slMin" inputmode="numeric" value="10"></div><div class="field"><label>Max</label><input id="slMax" inputmode="numeric" value="40"></div></div>' +
      '<div class="form-actions"><button class="btn primary" data-act="slot">Save pick face</button></div>');
    return html;
  };

  /* ---- Orders & waves ---- */
  VIEWS.orders = function () {
    var html = head('Outbound › Orders & Waves', 'Orders & Waves', 'Customer orders wait as New until a wave releases them. Allocation then reserves real stock and never takes it from a held bin; a line no single bin can fill is shown short, with the numbers.',
      '<button class="btn" data-act="realloc">Re-allocate off held bins</button>');
    var newRows = state.wms.orders.map(function (o) {
      return '<tr><td><input type="checkbox" data-wave="' + esc(o.id) + '" checked></td><td class="id">' + esc(o.id) + '</td><td>' + esc(o.customer) + '</td><td>' + (o.priority === 'High' ? chip('High', 'bad') : chip('Normal')) +
        '</td><td>' + esc(o.shipDate) + '</td><td>' + esc(o.lines.map(function (l) { return l.qty + ' × ' + l.desc; }).join('; ')) + '</td></tr>';
    });
    html += panel('New orders — not released', table(['', 'Order', 'Customer', 'Priority', 'Ship', 'Lines'], newRows, 'No new orders. Enter one below.') +
      (newRows.length ? '<div class="panel-b"><button class="btn primary" data-act="wave">Release wave</button></div>' : ''), null, true);
    var all = state.outbound.slice().reverse().map(function (o) {
      var st = W.orderStatus(state, o);
      var lines = o.lines.map(function (l) {
        var src = l.done ? 'picked ' + (l.pickedQty || 0) + (l.shortPicked ? ' (' + l.shortPicked + ' short)' : '') : l.allocated ? 'from ' + l.binId + (E.binById(state, l.binId) && E.binById(state, l.binId).status === 'hold' ? ' — bin on hold' : '') : 'SHORT' + (l.short ? ' (' + l.short.free + ' free in any one bin)' : '');
        return l.qty + ' × ' + l.desc + ' <span class="hint">' + esc(src) + '</span>';
      }).join('<br>');
      return '<tr><td class="id">' + esc(o.id) + '</td><td>' + esc(o.customer || '—') + '</td><td>' + (o.priority === 'High' ? chip('High', 'bad') : chip('Normal')) + '</td><td class="id">' + esc(o.wave || '—') + '</td><td>' + lines + '</td><td>' + stageChip(st) + '<br><span class="hint">' + esc(st.words) + '</span></td></tr>';
    });
    html += panel('Released orders', table(['Order', 'Customer', 'Priority', 'Wave', 'Lines & allocation', 'Status'], all), null, true);
    var lineInputs = [0, 1, 2].map(function (i) {
      return '<div class="field"><label>Item ' + (i + 1) + '</label><select id="olD' + i + '">' + opt('', i ? '(none)' : 'Pick an item') + items().map(function (d) { return opt(d, d); }).join('') + '</select></div>' +
        '<div class="field"><label>Qty ' + (i + 1) + '</label><input id="olQ' + i + '" inputmode="numeric"></div>';
    }).join('');
    html += panel('Enter an order', '<div class="form"><div class="field"><label>Customer</label><input id="oCust" placeholder="Customer name"></div>' +
      '<div class="field"><label>Priority</label><select id="oPri">' + opt('Normal', 'Normal') + opt('High', 'High') + '</select></div>' +
      '<div class="field"><label>Ship</label><select id="oShip">' + opt('Today', 'Today') + opt('Tomorrow', 'Tomorrow') + '</select></div>' + lineInputs + '</div>' +
      '<div class="form-actions"><button class="btn primary" data-act="order">Save order</button></div>');
    var waves = state.wms.waves.slice().reverse().map(function (w) {
      return '<tr><td class="id">' + esc(w.id) + '</td><td>' + esc(w.orderIds.join(', ')) + '</td><td>' + esc(w.by ? uname(w.by) : (w.note || '—')) + '</td><td class="id">' + time(w.releasedAt) + '</td></tr>';
    });
    html += panel('Waves', table(['Wave', 'Orders', 'Released by', 'Time'], waves), null, true);
    return html;
  };

  /* ---- Picking ---- */
  VIEWS.picking = function () {
    var html = head('Outbound › Picking', 'Picking', 'Pick tasks by zone. On the floor the picker confirms the quantity by voice ("picked 10"); fewer than asked is a short pick — reconciled on the order and a cycle count is queued for the bin.');
    state.zones.forEach(function (z) {
      var rows = state.tasks.filter(function (t) { return t.type === 'pick' && t.zone === z && t.status !== 'done'; }).map(function (t) {
        var o = E.orderById(state, t.orderId);
        return '<tr><td class="id">' + esc(t.orderId) + '</td><td>' + esc(o && o.customer || '') + '</td><td class="id">' + esc(t.binId) + '</td><td>' + esc(t.desc) + '</td><td class="num">' + t.qty + '</td><td>' + taskChip(t) +
          '</td><td>' + esc(t.assignee ? uname(t.assignee) : '—') + '</td><td class="actions"><input class="cell" style="width:60px" id="pk-' + esc(t.id) + '" value="' + t.qty + '"> <button class="btn small" data-act="pick" data-id="' + esc(t.id) + '">Confirm qty</button></td></tr>';
      });
      html += panel('Zone ' + z, table(['Order', 'Customer', 'Bin', 'Item', 'Qty', 'Status', 'Picker', 'Picked'], rows, 'No picks waiting in zone ' + z + '.'), null, true);
    });
    var done = state.tasks.filter(function (t) { return t.type === 'pick' && t.status === 'done'; }).slice(-10).reverse().map(function (t) {
      var o = E.orderById(state, t.orderId), line = null;
      if (o) o.lines.forEach(function (l) { if (l.binId === t.binId && l.desc === t.desc) line = l; });
      return '<tr><td class="id">' + esc(t.orderId) + '</td><td>' + esc(t.desc) + '</td><td class="num">' + t.qty + '</td><td class="num">' + (line ? line.pickedQty : '—') + '</td><td>' + (line && line.shortPicked ? chip(line.shortPicked + ' short', 'warn') : chip('Full', 'ok')) + '</td><td>' + esc(uname(t.doneBy)) + '</td></tr>';
    });
    html += panel('Recent picks', table(['Order', 'Item', 'Qty', 'Picked', 'Result', 'Picker'], done, 'No picks done yet.'), null, true);
    return html;
  };

  /* ---- Pack & ship ---- */
  VIEWS.ship = function () {
    var html = head('Outbound › Pack & Ship', 'Pack, Stage, Load & Ship', 'Picked orders are packed and labeled at Pack 1, staged at their door, loaded on the trailer, and the outbound load is closed with a ship confirm — BOL number, seal, totals.');
    var pack = state.tasks.filter(function (t) { return t.type === 'pack' && t.status !== 'done'; }).map(function (t) {
      var o = E.orderById(state, t.orderId);
      return '<tr><td class="id">' + esc(t.orderId) + '</td><td>' + esc(o.customer || '') + '</td><td>' + esc(o.lines.map(function (l) { return (l.pickedQty || 0) + ' × ' + l.desc; }).join('; ')) + '</td><td>' + taskChip(t) +
        '</td><td class="actions"><input class="cell" style="width:50px" id="pc-' + esc(t.id) + '" value="' + o.lines.length + '"> cartons <button class="btn small primary" data-act="pack" data-id="' + esc(t.id) + '">Pack & label</button></td></tr>';
    });
    html += panel('Pack station — Pack 1', table(['Order', 'Customer', 'Picked', 'Status', 'Pack'], pack, 'Nothing waiting to pack.'), null, true);
    var staged = state.outbound.filter(function (o) { return o.status === 'staged at door'; }).map(function (o) {
      var lt = E.taskById(state, 't-load-' + o.id);
      return '<tr><td class="id">' + esc(o.id) + '</td><td>' + esc(o.customer || '') + '</td><td>' + esc(o.door) + '</td><td>' + (o.packed ? esc(o.packed.cartons + ' ctn · ' + o.packed.weightLb + ' lb · ' + o.packed.tracking) : chip('Not packed', 'warn')) +
        '</td><td>' + (lt ? taskChip(lt) : '—') + '</td><td class="actions">' + (lt && o.packed ? '<button class="btn small primary" data-act="load" data-id="' + esc(lt.id) + '">Confirm loaded</button>' : '') + '</td></tr>';
    });
    html += panel('Staging lanes', table(['Order', 'Customer', 'Door', 'Package', 'Load task', ''], staged, 'No orders staged.'), null, true);
    var loads = state.wms.loads.slice().reverse().map(function (l) {
      return '<tr><td class="id">' + esc(l.id) + '</td><td>' + esc(l.door) + '</td><td class="id">' + esc(l.trailer) + '</td><td>' + esc(l.carrier) + '</td><td>' + esc(l.orderIds.join(', ')) + '</td><td>' +
        (l.status === 'shipped' ? chip('Shipped', 'ok') + ' <span class="hint">BOL ' + esc(l.bolNumber) + ' · seal ' + esc(l.seal) + ' · ' + esc(l.totals.units) + ' units · ' + esc(l.totals.weightLb) + ' lb · ' + time(l.closedAt) + '</span>' : chip('Loading', 'info')) +
        '</td><td class="actions">' + (l.status === 'loading' ? '<input class="cell" style="width:90px;text-align:left" id="seal-' + esc(l.id) + '" placeholder="Seal #"> <button class="btn small primary" data-act="close-load" data-id="' + esc(l.id) + '">Ship confirm</button>' : '') + '</td></tr>';
    });
    html += panel('Outbound loads', table(['Load', 'Door', 'Trailer', 'Carrier', 'Orders', 'Status', ''], loads, 'No outbound loads yet. Loading an order opens one at its door.'), null, true);
    return html;
  };

  /* ---- Task queues ---- */
  VIEWS.queues = function () {
    var html = head('Labor › Task Queues', 'Task Queues', 'Each worker\'s task in hand, what is queued for them, and what the system would hand them next. Reassign any open task; if the worker\'s hands are full it is queued ahead of everything else.');
    html += '<div class="cards">' + workers().map(function (u) {
      var q = W.queueFor(state, u.id);
      return '<div class="wcard"><div class="w-h"><b>' + esc(u.name) + '</b>' + chip('Zone ' + u.zone, 'info') + '</div><div class="w-b">' +
        '<p class="w-task">' + (q.current ? chip(q.current.type, 'type') + ' ' + esc(q.current.title) : '<span class="hint">Nothing in hand</span>') + '</p>' +
        (q.queued.length ? '<b class="hint">Queued for ' + esc(u.name.split(' ')[0]) + '</b><ol class="w-q">' + q.queued.map(function (t) { return '<li>' + esc(t.title) + '</li>'; }).join('') + '</ol>' : '') +
        '<b class="hint">Next up</b><ol class="w-q">' + (q.suggested.length ? q.suggested.map(function (t) { return '<li>' + esc(t.title) + '</li>'; }).join('') : '<li>Nothing workable</li>') + '</ol></div></div>';
    }).join('') + '</div><br>';
    var openTasks = state.tasks.filter(function (t) { return t.status !== 'done'; });
    html += panel('Reassign', '<div class="form wide"><div class="field"><label>Task</label><select id="raTask">' + openTasks.map(function (t) {
      return opt(t.id, '[' + t.type + '] ' + t.title + (t.assignee ? ' — ' + uname(t.assignee) : ''));
    }).join('') + '</select></div><div class="field"><label>Give to</label><select id="raUnit">' + workers().map(function (u) { return opt(u.id, u.name + ' (Zone ' + u.zone + ')'); }).join('') + '</select></div></div>' +
      '<div class="form-actions"><button class="btn primary" data-act="reassign">Reassign</button></div>');
    var types = {}; state.tasks.forEach(function (t) { types[t.type] = 1; });
    var filt = '<div class="filters"><div class="field"><label>Type</label><select id="tfType">' + opt('', 'All', !ui.taskType) + Object.keys(types).sort().map(function (k) { return opt(k, k, ui.taskType === k); }).join('') + '</select></div>' +
      '<div class="field"><label>Zone</label><select id="tfZone">' + opt('', 'All', !ui.taskZone) + state.zones.map(function (z) { return opt(z, 'Zone ' + z, ui.taskZone === z); }).join('') + '</select></div>' +
      '<div class="field"><label>Status</label><select id="tfStatus">' + opt('active', 'Not done', ui.taskStatus === 'active') + opt('done', 'Done', ui.taskStatus === 'done') + opt('all', 'All', ui.taskStatus === 'all') + '</select></div></div>';
    var rows = state.tasks.filter(function (t) {
      if (ui.taskType && t.type !== ui.taskType) return false;
      if (ui.taskZone && t.zone !== ui.taskZone) return false;
      if (ui.taskStatus === 'active' && t.status === 'done') return false;
      if (ui.taskStatus === 'done' && t.status !== 'done') return false;
      return true;
    }).map(function (t) {
      var b = W.blocked(state, t);
      return '<tr><td class="id">' + esc(t.id) + '</td><td>' + chip(t.type, 'type') + '</td><td>' + esc(t.zone || '—') + '</td><td>' + esc(t.title) + (b ? '<br><span class="hint" style="color:#b3261e">' + esc(b) + '</span>' : '') +
        ((t.notes || []).length ? '<br>' + t.notes.map(function (n) { return '<span class="quote">' + esc(n.text) + '</span>'; }).join('<br>') : '') + '</td><td>' + taskChip(t) + '</td><td>' +
        esc(t.assignee ? uname(t.assignee) : t.doneBy ? uname(t.doneBy) : '—') + '</td></tr>';
    });
    html += panel('All tasks', filt + table(['Task', 'Type', 'Zone', 'Title', 'Status', 'Worker'], rows, 'No tasks match.'), null, true);
    return html;
  };

  /* ---- Labor management ---- */
  VIEWS.labor = function () {
    var html = head('Labor › Management', 'Labor Management', 'Where work is backing up, and who could move. Proposals come from the live numbers; nothing moves until a manager approves.');
    var props = W.proposals(state);
    html += panel('Proposals', props.length ? table(['Worker', 'Move', 'Why', ''], props.map(function (p, i) {
      return '<tr><td><b>' + esc(p.unitName) + '</b></td><td>Zone ' + esc(p.fromZone) + ' → ' + esc(p.toZone) + '</td><td>' + esc(p.why) + '</td><td class="actions"><button class="btn small primary" data-act="approve" data-i="' + i + '">Approve</button> <button class="btn small" data-act="decline" data-i="' + i + '">Decline</button></td></tr>';
    })) + '<div class="panel-b"><p class="law">A proposal, not a decision. Approving changes the worker\'s zone; it does not reassign their task in hand.</p></div>' : '<p class="empty">No zone is backing up past the threshold, and nobody is idle while work waits elsewhere.</p>', null, !!props.length);
    var d = W.dashboard(state);
    html += panel('Zone load', table(['Zone', 'Waiting', 'Workers', 'Per worker', 'Done'], d.zones.map(function (z) {
      return '<tr><td>Zone ' + esc(z.zone) + '</td><td class="num">' + z.pending + '</td><td class="num">' + z.workers + '</td><td class="num">' + (Math.round(z.load * 10) / 10).toFixed(1) + '</td><td class="num">' + z.done + '</td></tr>';
    })), null, true);
    var a = ui.ask;
    html += panel('Ask the building', '<p class="hint">Ask in your own words. Muse Spark answers only from this building\'s live numbers — shown under the answer, with any number it used that is not in the data called out.</p>' +
      '<div class="field"><textarea id="askQ" placeholder="Where is it backing up? Who should I move?">' + esc(a ? a.q : '') + '</textarea></div>' +
      '<div class="form-actions"><button class="btn primary" data-act="ask"' + (ui.askBusy ? ' disabled' : '') + '>' + (ui.askBusy ? 'Asking…' : 'Ask') + '</button><button class="btn talk" id="askTalk" type="button">🎙 Hold to say it</button></div>' +
      (a && a.answer ? '<div class="heard"><b>Answer</b><div class="answer">' + esc(a.answer) + '</div>' +
        (a.check && a.check.missing && a.check.missing.length ? '<p class="hint" style="color:#b3261e">Numbers not found in the data (may be the model\'s own sum — check): ' + esc(a.check.missing.join(', ')) + '</p>' : '<p class="hint">Every number in the answer is in the data.</p>') +
        '<p class="law">A proposal, not a decision. Nothing was moved.</p><details><summary class="hint">Everything it was given</summary><pre class="evidence">' + esc(a.summary) + '</pre></details></div>' : '') +
      (a && a.error ? '<div class="notice bad">' + esc(a.error) + '</div>' : ''));
    var dec = state.wms.decisions.slice().reverse().map(function (x) {
      return '<tr><td class="id">' + time(x.ts) + '</td><td>' + esc(uname(x.unitId)) + '</td><td>' + esc(x.fromZone) + ' → ' + esc(x.toZone) + '</td><td>' + (LOOK === 'record' ? stamp(x.approved ? 'Approved' : 'Declined', x.by, x.ts) : (x.approved ? chip('Approved', 'ok') : chip('Declined'))) + '</td><td>' + esc(uname(x.by)) + '</td></tr>';
    });
    html += panel('Decisions', table(['Time', 'Worker', 'Move', 'Decision', 'By'], dec, 'No decisions yet.'), null, true);
    return html;
  };

  /* ---- Flags ---- */
  VIEWS.flags = function () {
    var html = head('Control › Flags & Incidents', 'Flags & Incidents', 'Workers report problems by voice. A flag is a short label plus the speaker\'s exact words — no category fields. It pins to the task in hand and closes nothing.');
    html += panel('Report a problem', flagForm());
    var rows = state.wms.flags.slice().reverse().map(function (f) {
      var t = f.taskId ? E.taskById(state, f.taskId) : null;
      return '<tr><td class="id">' + esc(f.id) + '</td><td><b>' + esc(f.label) + '</b></td><td><span class="quote">' + esc(f.words) + '</span></td><td>' + esc(uname(f.by)) + '</td><td>' + esc(t ? t.title : 'No task in hand') + '</td><td>' + esc(f.zone || '—') +
        '</td><td class="id">' + time(f.ts) + '</td><td>' + (f.status === 'open' ? chip('Open', 'bad') : chip('Closed', 'ok') + (f.note ? ' <span class="hint">' + esc(f.note) + '</span>' : '')) + '</td><td class="actions">' +
        (f.status === 'open' && isManager() ? '<button class="btn small" data-act="flag-close" data-id="' + esc(f.id) + '">Close…</button>' : '') + '</td></tr>';
    });
    html += panel('Flags', table(['Flag', 'Label', 'Exact words', 'Reported by', 'Task', 'Zone', 'Time', 'Status', ''], rows, 'No flags yet.'), null, true);
    return html;
  };

  function flagForm() {
    var who = isManager() ? (ui.rfUnit || workers()[0].id) : me;
    return '<div class="form wide"><div class="field"><label>Who is reporting</label><select id="flWho"' + (isManager() ? '' : ' disabled') + '>' + workers().map(function (u) { return opt(u.id, u.name, u.id === who); }).join('') + '</select></div></div>' +
      '<div class="field" style="margin-top:8px"><label>What happened (their words)</label><textarea id="flWords" placeholder="Forklift is leaking oil by B-03">' + esc(ui.flagWords) + '</textarea></div>' +
      '<div class="form-actions"><button class="btn talk" id="flTalk" type="button">🎙 Hold to report by voice</button><button class="btn primary" data-act="flag">File flag</button><span class="hint" id="flStatus"></span></div>' +
      '<p class="law">The label comes from Muse Spark; the words are kept exactly as said.</p>';
  }

  /* ---- Shift summary ---- */
  VIEWS.summary = function () {
    var s = W.shiftSummary(state);
    var d = s.dash;
    var html = head('Control › Shift Summary', 'Shift Summary', 'Counted from the records and the live state. Nobody writes this up.', '<button class="btn" data-act="print">Print</button>');
    var types = Object.keys(s.base.doneByType).sort().map(function (k) { return '<tr><td>' + esc(k) + '</td><td class="num">' + s.base.doneByType[k] + '</td></tr>'; });
    var per = s.base.perUnit.map(function (u) { return '<tr><td>' + esc(u.name) + '</td><td>' + esc(u.zone || '—') + '</td><td class="num">' + u.done + '</td></tr>'; });
    /* The one numbers surface. Every figure comes from W.dashboard
       (s.dash) or the shift's records (s.base, s.flags, s.osd). */
    var k = function (label, v, sub, cls, href) {
      return '<a class="kpi ' + (cls || '') + '" href="#/' + href + '"><div class="k-label">' + esc(label) + '</div><div class="k-val">' +
        esc(v == null ? '—' : v) + '</div>' + (sub ? '<div class="k-sub">' + esc(sub) + '</div>' : '') + '</a>';
    };
    var pl = function (n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); };
    html += '<div class="kpis">' +
      k('Tasks done', s.base.tasksDone, 'this shift', 'ok', 'queues') +
      k('Open tasks', d.tasks.open + d.tasks.assigned, d.tasks.assigned + ' in progress · ' + d.tasks.blocked + ' blocked', d.tasks.blocked ? 'warn' : '', 'queues') +
      k('Shipments in', d.inbound.received + ' / ' + (d.inbound.received + d.inbound.atDoor + d.inbound.expected), d.inbound.atDoor + ' at a door · ' + d.inbound.unitsIn + ' units counted', '', 'receiving') +
      k('Loads out', d.outbound.loadsClosed, pl(d.outbound.shipped, 'order') + ' shipped · ' + d.outbound.unitsOut + ' units', d.outbound.loadsClosed ? 'ok' : '', 'ship') +
      k('Open flags', d.flagsOpen, s.flags.length + ' reported', d.flagsOpen ? 'bad' : 'ok', 'flags') +
      k('OS&D open', d.osdOpen, s.osd.length + ' found', d.osdOpen ? 'bad' : 'ok', 'osd') +
      k('Holds now', s.base.holdsNow.length, '', '', 'putaway') +
      k('Fill rate', d.fillRate == null ? '—' : d.fillRate + '%', pl(d.shortPicks, 'short pick'), d.shortPicks ? 'warn' : '', 'picking') +
      k('Inventory accuracy', d.accuracy == null ? '—' : d.accuracy + '%', pl(d.countsDone, 'cycle count'), '', 'counts') +
      k('Dock to stock', d.dockToStockMin == null ? '—' : d.dockToStockMin + ' min', 'avg, received → last pallet binned', '', 'putaway') +
      k('Replenishment', d.replen, 'pick faces below min', d.replen ? 'warn' : 'ok', 'replen') +
      '</div>';
    html += '<div class="grid2 even"><div>' + panel('Done by type', table(['Type', 'Done'], types, 'Nothing done yet.'), null, true) +
      panel('Done by worker', table(['Worker', 'Zone', 'Done'], per), null, true) + '</div><div>' +
      panel('Zone loads now', table(['Zone', 'Waiting', 'Workers', 'Per worker', 'Done'], d.zones.map(function (z) {
        return '<tr><td>Zone ' + esc(z.zone) + '</td><td class="num">' + z.pending + '</td><td class="num">' + z.workers + '</td><td class="num">' + (Math.round(z.load * 10) / 10).toFixed(1) + '</td><td class="num">' + z.done + '</td></tr>';
      })), d.bottleneck ? 'bottleneck: zone ' + d.bottleneck.zone : 'no bottleneck', true) +
      panel('Shipments', table(['In / out', 'ID', 'Detail'], s.receipts.map(function (r) {
        return '<tr><td>' + chip('In', 'info') + '</td><td class="id">' + esc(r.shipmentId) + '</td><td>' + esc(r.id) + ' · ' + r.osdIds.length + ' OS&D</td></tr>';
      }).concat(s.loads.map(function (l) {
        return '<tr><td>' + chip('Out', 'ok') + '</td><td class="id">' + esc(l.id) + '</td><td>' + esc(l.orderIds.join(', ')) + ' · BOL ' + esc(l.bolNumber) + ' · ' + l.totals.units + ' units</td></tr>';
      })), 'None yet.'), null, true) + '</div></div>';
    html += panel('Flags this shift', table(['Label', 'Words', 'By', 'Status'], s.flags.map(function (f) {
      return '<tr><td><b>' + esc(f.label) + '</b></td><td><span class="quote">' + esc(f.words) + '</span></td><td>' + esc(uname(f.by)) + '</td><td>' + esc(f.status) + '</td></tr>';
    }), 'No flags.'), null, true);
    return html;
  };

  /* ---- Audit trail ---- */
  VIEWS.audit = function () {
    var kinds = {}; state.records.forEach(function (r) { kinds[r.kind || 'note'] = 1; });
    var html = head('Control › Audit Trail', 'Audit Trail', 'Who did what, and when — every record on the desk record, latest first.');
    var list = state.records.filter(function (r) { return !ui.recKind || (r.kind || 'note') === ui.recKind; }).slice().reverse();
    html += panel('Records', '<div class="filters"><div class="field"><label>Kind</label><select id="rkFilter">' + opt('', 'All', !ui.recKind) + Object.keys(kinds).sort().map(function (k) { return opt(k, k, ui.recKind === k); }).join('') + '</select></div></div>' +
      recordsHtml(list), list.length + ' shown', true);
    return html;
  };

  /* ---- RF console ---- */
  VIEWS.rf = function () {
    var mgr = isManager();
    var uid = mgr ? (ui.rfUnit || workers()[0].id) : me;
    ui.rfUnit = uid;
    var u = E.unitById(state, uid);
    var cur = W.currentOf(state, uid);
    var html = head('Floor › RF Console', 'RF Console', mgr ? 'The handheld a worker carries, run from the desk. Pick a worker to act as them.' : 'Your handheld. Hold to talk: "what\'s next", "picked 10", "in A-03", "done", or say what\'s wrong.');
    if (mgr) {
      html += '<div class="rf" style="margin-bottom:8px"><select class="cell" style="width:100%;text-align:left" id="rfWho">' + workers().map(function (w) { return opt(w.id, w.name + ' (Zone ' + w.zone + ')', w.id === uid); }).join('') + '</select></div>';
    }
    var screen = '<div class="rf-screen"><div class="rf-top"><span>' + esc(u.name.toUpperCase()) + ' · ZONE ' + esc(u.zone) + '</span><span>' + time(new Date().toISOString()) + '</span></div>';
    if (cur) {
      var blk = W.blocked(state, cur);
      screen += '<div class="rf-type">' + esc(cur.type) + ' · ' + esc(cur.id.replace(/^t-/, '')) + '</div>';
      if (cur.type === 'pick') screen += '<div class="rf-big">BIN ' + esc(cur.binId) + ' · QTY ' + cur.qty + '</div><div class="rf-title">' + esc(cur.desc) + '</div><div class="rf-detail">For ' + esc(cur.orderId) + '. Say "picked ' + cur.qty + '".</div>';
      else if (cur.type === 'putaway') screen += '<div class="rf-big">' + esc(dest(cur.toBinId)) + '</div><div class="rf-title">' + esc(cur.title) + '</div><div class="rf-detail">' + esc(cur.detail) + '. Say "in ' + esc(cur.toBinId) + '" or photograph the bin label.</div>';
      else if (cur.type === 'count') screen += '<div class="rf-big">COUNT BIN ' + esc(cur.binId) + '</div><div class="rf-detail">Blind count. Say the number, or enter each item below.</div>';
      else if (cur.type === 'receive') {
        var rs = E.shipmentById(state, cur.shipmentId);
        screen += '<div class="rf-title">' + esc(cur.title) + '</div><div class="rf-detail">' + esc(rs ? rs.desc : '') + '. Count it against BOL ' + esc(rs && rs.bol ? rs.bol.bolNumber : '(on file)') + ' and post the receipt on the Receiving screen.</div>';
      }
      else if (cur.type === 'move' || cur.type === 'replen') screen += '<div class="rf-big">' + esc(dest(cur.toBinId)) + '</div><div class="rf-title">' + esc(cur.qty + ' × ' + cur.desc) + '</div><div class="rf-detail">From ' + esc(cur.fromBinId) + '. Say "done" when it is in.</div>';
      else screen += '<div class="rf-title">' + esc(cur.title) + '</div><div class="rf-detail">' + esc(cur.detail) + '</div>';
      if (blk) screen += '<div class="rf-warn">ON HOLD: ' + esc(blk) + '</div>';
      (cur.notes || []).forEach(function (n) { screen += '<div class="rf-warn">NOTED: “' + esc(n.text) + '”</div>'; });
    } else {
      screen += '<div class="rf-title">NO TASK IN HAND</div><div class="rf-detail">Press GET NEXT or say "what\'s next".</div>';
    }
    if (ui.rfHeard) screen += '<div class="rf-reply">HEARD: “' + esc(ui.rfHeard) + '”</div>';
    if (ui.rfReply) screen += '<div class="rf-reply">' + esc(ui.rfReply) + '</div>';
    screen += '</div>';
    var keys = '<div class="rf-keys"><button class="btn talk" id="rfTalk" type="button">🎙 HOLD TO TALK</button>' +
      '<button class="btn primary" data-act="rf-next">' + (cur ? 'SHOW TASK' : 'GET NEXT') + '</button>';
    if (cur && cur.type === 'putaway') keys += '<button class="btn" data-act="cam" data-for="putaway">📷 BIN LABEL</button>';
    else keys += '<a class="btn" href="#/flags">REPORT</a>';
    keys += '</div>';
    var inputs = '';
    if (cur) {
      if (cur.type === 'pick') inputs = '<div class="form"><div class="field"><label>Picked qty</label><input id="rfQty" inputmode="numeric" value="' + cur.qty + '"></div></div>';
      else if (cur.type === 'putaway') inputs = '<div class="form"><div class="field"><label>Bin put in</label><input id="rfBin" value="' + esc(cur.toBinId || '') + '"></div></div>';
      else if (cur.type === 'pack') inputs = '<div class="form"><div class="field"><label>Cartons</label><input id="rfCartons" inputmode="numeric" value="1"></div></div>';
      else if (cur.type === 'count') {
        var b = E.binById(state, cur.binId);
        inputs = '<div class="form">' + (b.contents.length ? b.contents : [{ desc: '' }]).map(function (c) {
          return '<div class="field"><label>' + esc(c.desc || 'Anything in the bin?') + '</label><input data-rfcc="' + esc(c.desc) + '" inputmode="numeric" placeholder="count"></div>';
        }).join('') + '</div>';
      }
      if (cur.type !== 'receive') inputs += '<div class="form-actions"><button class="btn primary" data-act="rf-confirm">CONFIRM</button></div>';
      else inputs += '<div class="form-actions"><a class="btn primary" href="#/receiving" data-act="rf-goto-rcv" data-id="' + esc(cur.shipmentId) + '">OPEN RECEIVING</a></div>';
    }
    var photo = '';
    if (ui.rfPhoto && cur && cur.type === 'putaway') {
      var rd = ui.rfPhotoRead;
      photo = '<img class="photo-preview" src="' + ui.rfPhoto + '" alt="Bin label photo">' + (rd ? '<div class="heard"><b>Photo read</b>Bin label: ' + esc(rd.binLabel || 'not read') +
        (rd.item ? ' · Item: ' + esc(rd.item) : '') + (rd.flags.length ? '<br>' + rd.flags.map(function (f) { return chip(f.label, 'warn') + ' ' + esc(f.detail); }).join('<br>') : '') +
        (rd.binLabel ? '<div class="form-actions"><button class="btn primary" data-act="rf-photo-confirm">Confirm putaway in ' + esc(rd.binLabel) + '</button></div>' : '<p class="hint">No bin label read — say or type the bin.</p>') + '</div>' : '<p class="hint" id="rfPhotoStatus">Reading the photo…</p>');
    }
    if (LOOK !== 'current' && ui.rfPhoto && ui.rfPhotoRead && cur && cur.type === 'putaway') photo = putawayWitness(cur, ui.rfPhotoRead) + photo;
    html += '<div class="rf">' + screen + keys + '<div class="rf-inputs">' + inputs + photo + '</div><p class="hint" id="rfStatus"></p></div>';
    return html;
  };

  /* ==================================================================
     LOOKS — three design directions for this console, on the real
     page. Presentation only: every look reads the same state and
     calls the same actions. Nothing here changes the record.
       stand  — The Witness Stand: the comparison is the layout.
       floor  — The Floor: the building is the landmark.
       record — The Record: the grids, read as evidence.
       current — the console as it was before the looks.
     ================================================================== */

  /* The look in use. To pick a winner: set this word, then delete
     the LOOK SWITCHER block below. */
  var LOOK = 'current';
  var LOOK_NAMES = { current: 'Today', stand: 'Witness Stand', floor: 'The Floor', record: 'The Record' };

  /* ===== LOOK SWITCHER — design review only. Delete from here to
     "end LOOK SWITCHER" once a look is picked. ===== */
  (function () {
    var want = params.get('look');
    if (want && LOOK_NAMES[want]) LOOK = want;
    var css = document.createElement('style');
    css.textContent = '.look-switch{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:5px 12px;background:#2b2b2b;color:#f4f4f4;' +
      'font:600 12px/1.3 system-ui,sans-serif;border-bottom:2px dashed #f2c94c}.look-switch b{color:#f2c94c;letter-spacing:.06em;text-transform:uppercase;font-size:11px}' +
      '.look-switch button{font:inherit;background:#444;color:#fff;border:1px solid #666;border-radius:12px;padding:2px 10px;cursor:pointer}' +
      '.look-switch button[aria-pressed="true"]{background:#f2c94c;color:#222;border-color:#f2c94c}@media print{.look-switch{display:none}}';
    document.head.appendChild(css);
    var bar = document.createElement('div');
    bar.className = 'look-switch';
    bar.setAttribute('aria-label', 'Design review: switch the look');
    bar.innerHTML = '<b>Design review</b><span>Look:</span>' + Object.keys(LOOK_NAMES).map(function (k) {
      return '<button type="button" data-look="' + k + '" aria-pressed="' + (k === LOOK) + '">' + esc(LOOK_NAMES[k]) + '</button>';
    }).join('');
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-look]');
      if (!b) return;
      var p = new URLSearchParams(location.search);
      if (b.dataset.look === 'current') p.delete('look'); else p.set('look', b.dataset.look);
      var q = p.toString();
      location.href = location.pathname + (q ? '?' + q : '') + location.hash;
    });
    document.body.insertBefore(bar, document.body.firstChild);
  })();
  /* ===== end LOOK SWITCHER ===== */

  (function applyLook() {
    document.body.setAttribute('data-look', LOOK);
    if (LOOK === 'current') return;
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'css/wms-look-' + LOOK + '.css';
    document.head.appendChild(l);
  })();

  var LOOK_VIEWS = { stand: {}, floor: {}, record: {} };

  /* ---------- shared by the looks: the two witnesses ---------------- */

  /* Bin law: a destination reads plainly "Stage: Bin #". */
  function dest(binId) { return 'Stage: Bin ' + (binId || '?'); }
  function num(v) { if (v === '' || v == null) return null; var x = parseInt(v, 10); return isNaN(x) ? null : x; }
  function shortDesc(d) { return String(d || '').replace(/ — .*/, ''); }
  function initials(id) { return uname(id).split(' ').map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase(); }

  var VERDICT = { agree: 'Agree', flag: 'Flag', cant: 'Can\'t verify' };
  var VERDICT_MARK = { agree: '✓', flag: '!', cant: '?' };
  function verdictTag(v, big) {
    return '<span class="verdict v-' + v + (big ? ' big' : '') + '"><i aria-hidden="true">' + VERDICT_MARK[v] + '</i>' + VERDICT[v] + '</span>';
  }

  /* What the camera said, sorted: "Looks sound", "Cannot verify", or a problem. */
  function photoKind(f) {
    var t = String(f.label || '');
    if (/can.?n?o?t verify|can't verify|out of (frame|view)|not visible|unclear/i.test(t)) return 'cant';
    if (/sound|intact|no (visible )?damage|undamaged|looks (good|fine|ok)/i.test(t)) return 'sound';
    return 'problem';
  }
  function camera(flags) {
    flags = flags || [];
    var c = { has: flags.length > 0, problems: [], sound: false, blind: [] };
    flags.forEach(function (f) {
      var k = photoKind(f);
      if (k === 'problem') c.problems.push(f); else if (k === 'sound') c.sound = true; else c.blind.push(f);
    });
    c.text = c.problems.length ? c.problems.map(function (f) { return f.label + (f.detail ? ' — ' + f.detail : ''); }).join(' · ')
      : c.sound ? 'Photo shows the freight sound.'
      : c.blind.length ? 'Photo could not see it: ' + c.blind.map(function (f) { return f.detail || f.label; }).join(' · ')
      : '';
    return c;
  }

  /* Compare the worker's voice with the camera's eye for one receipt
     (posted, or the one on screen). Plain rules, said out loud:
       Agree        — both witnesses say the same thing.
       Flag         — they disagree, or one reports what the other doesn't.
       Can't verify — one witness was not there, or cannot see that point
                      (a photo cannot count cases). */
  function witness(lines, photoFlags, transcript) {
    var cam = camera(photoFlags);
    var points = [];
    var spokeDamage = false, any = false;
    (lines || []).forEach(function (l) {
      var rec = num(l.received), dmg = num(l.damaged) || 0;
      if (rec == null) return;
      any = true;
      if (dmg > 0) {
        spokeDamage = true;
        points.push({ point: 'Damage · ' + shortDesc(l.desc), words: l.quote || '', says: dmg + ' damaged',
          camera: cam.problems.length || cam.sound ? cam.text : '', verdict: cam.problems.length ? 'agree' : cam.sound ? 'flag' : 'cant' });
      }
      if (rec !== l.expected) {
        points.push({ point: (rec < l.expected ? 'Short · ' : 'Over · ') + shortDesc(l.desc), words: l.quote || '', says: rec + ' counted, BOL says ' + l.expected,
          camera: 'A photo cannot count cases.', verdict: 'cant', blind: true });
      }
    });
    if (!spokeDamage && (any || cam.has)) {
      points.push({ point: 'Condition', words: transcript || '', says: any ? 'No damage spoken' : 'Nothing spoken yet',
        camera: cam.text, verdict: cam.problems.length ? 'flag' : cam.sound && any ? 'agree' : 'cant' });
    }
    return points;
  }
  function tally(points) {
    var t = { agree: 0, flag: 0, cant: 0 };
    points.forEach(function (p) { t[p.verdict]++; });
    return t;
  }
  function tallyHtml(t) {
    return '<span class="tally">' + ['agree', 'flag', 'cant'].map(function (k) {
      return '<span class="t-' + k + '"><b>' + t[k] + '</b> ' + esc(VERDICT[k]) + '</span>';
    }).join('') + '</span>';
  }
  function receiptById(id) { var r = null; state.wms.receipts.forEach(function (x) { if (x.id === id) r = x; }); return r; }
  function receiptChecks() {
    return state.wms.receipts.map(function (r) {
      var s = E.shipmentById(state, r.shipmentId);
      return { id: r.id, ts: r.ts, by: r.by, where: s ? s.door : '', shipmentId: r.shipmentId, bolNumber: r.bolNumber,
        transcript: r.transcript, points: witness(r.lines, r.photoFlags, r.transcript), receipt: r };
    });
  }
  /* One OS&D finding, seen by both witnesses. */
  function findingWitness(f) {
    var r = receiptById(f.receiptId);
    var cam = camera(r ? r.photoFlags : []);
    var spoke = !!(r && r.lines.some(function (l) { return l.damaged > 0; }));
    if (f.type === 'photo') {
      var k = photoKind(f);
      return { words: '', says: spoke ? 'Receiver spoke of damage' : 'Receiver spoke of no damage', camera: f.label + (f.words ? ' — ' + f.words : ''),
        verdict: k === 'cant' ? 'cant' : k === 'sound' ? (spoke ? 'flag' : 'agree') : (spoke ? 'agree' : 'flag'), fromCamera: true };
    }
    var says = f.type === 'damage' ? f.qty + ' damaged' : (f.received + ' counted, BOL says ' + f.expected);
    var words = /^\(typed/.test(f.words || '') ? '' : f.words;
    if (f.type === 'damage') return { words: words, says: says, camera: cam.problems.length || cam.sound ? cam.text : '', verdict: cam.problems.length ? 'agree' : cam.sound ? 'flag' : 'cant' };
    return { words: words, says: says, camera: 'A photo cannot count cases.', verdict: 'cant', blind: true };
  }

  /* The human's decision — always drawn as a stamp, never as a chip. */
  function stamp(verb, by, ts, note) {
    return '<span class="stamp"><b>' + esc(verb) + '</b><span class="st-who">' + esc(uname(by)) + '</span>' +
      (ts ? '<span class="st-ts">' + time(ts) + '</span>' : '') + (note ? '<span class="st-note">' + esc(note) + '</span>' : '') + '</span>';
  }
  function awaiting(text) { return '<span class="stamp pending"><b>' + esc(text || 'Waiting for a human') + '</b></span>'; }

  function saidHtml(words, by, says) {
    return (words ? '<blockquote class="said"><span class="q">' + esc(words) + '</span>' + (by ? '<cite>' + esc(uname(by)) + '</cite>' : '') + '</blockquote>'
      : '<p class="said none">No words on record' + (says ? '' : ' — typed') + '</p>') +
      (says ? '<p class="says">' + esc(says) + '</p>' : '');
  }
  function cameraHtml(text, blind) {
    return text ? '<p class="seen' + (blind ? ' blind' : '') + '">' + esc(text) + '</p>' : '<p class="seen none">No photo. The camera did not see this.</p>';
  }

  /* One witness row: voice | verdict | camera. */
  function witnessRow(p, by) {
    return '<div class="w-row v-' + p.verdict + '"><div class="w-voice"><div class="w-point">' + esc(p.point || '') + '</div>' + saidHtml(p.words, by, p.says) + '</div>' +
      '<div class="w-verdict">' + verdictTag(p.verdict, true) + '</div>' +
      '<div class="w-camera"><div class="w-point w-point-cam">' + esc(p.point || '') + '</div>' + cameraHtml(p.camera, p.blind) + '</div></div>';
  }

  /* Putaway on the handheld: where the work was sent vs the bin label the camera read. */
  function putawayWitness(cur, rd) {
    var v = !rd.binLabel ? 'cant' : String(rd.binLabel).toUpperCase() === String(cur.toBinId).toUpperCase() ? 'agree' : 'flag';
    return '<div class="pa-witness w-row v-' + v + '"><div class="w-voice"><div class="w-point">Directed</div><p class="says big">' + esc(dest(cur.toBinId)) + '</p>' +
      (ui.rfHeard ? '<blockquote class="said"><span class="q">' + esc(ui.rfHeard) + '</span></blockquote>' : '') + '</div>' +
      '<div class="w-verdict">' + verdictTag(v, true) + '</div>' +
      '<div class="w-camera"><div class="w-point">Camera</div><p class="says big">' + esc(rd.binLabel ? 'Label reads ' + rd.binLabel : 'No label read') + '</p></div></div>';
  }

  function injectAfterHead(html, extra) { return html.replace('<!--/head-->', '<!--/head-->' + extra); }

  /* ================== LOOK 1 — THE WITNESS STAND ==================== */

  function standCase(c, hero) {
    var t = tally(c.points);
    var open = c.receipt.osdIds.filter(function (id) { var f = null; state.wms.osd.forEach(function (x) { if (x.id === id) f = x; }); return f && f.status === 'open'; }).length;
    return '<section class="case' + (hero ? ' hero' : '') + '"><header class="case-h"><div><span class="case-kicker">' + esc(c.where) + ' · ' + esc(c.shipmentId) +
      (c.bolNumber ? ' · BOL ' + esc(c.bolNumber) : '') + '</span><h2>Receipt ' + esc(c.id) + '</h2></div>' + tallyHtml(t) + '</header>' +
      '<div class="w-head"><span>The worker\'s voice</span><span>Verdict</span><span>The camera\'s eye</span></div>' +
      c.points.map(function (p) { return witnessRow(p, c.by); }).join('') +
      '<footer class="human">' + stamp('Posted', c.by, c.ts) +
      (open ? '<a class="human-open" href="#/osd">' + open + ' finding' + (open === 1 ? '' : 's') + ' still open — a human closes ' + (open === 1 ? 'it' : 'them') + '</a>' : '<span class="human-open done">Every finding settled</span>') +
      '</footer></section>';
  }

  function flagCase(f) {
    var t = f.taskId ? E.taskById(state, f.taskId) : null;
    return '<section class="case small"><header class="case-h"><div><span class="case-kicker">Report from the floor · Zone ' + esc(f.zone || '—') + (t ? ' · ' + esc(t.title) : '') +
      '</span><h2>' + esc(f.label) + '</h2></div></header>' +
      witnessRow({ point: 'Reported', words: f.words, says: '', camera: '', verdict: 'cant' }, f.by) +
      '<footer class="human">' + (f.status === 'open' ? awaiting('Open — waiting for a human') + (isManager() ? '<button class="btn" data-act="flag-close" data-id="' + esc(f.id) + '">Close…</button>' : '')
        : stamp('Closed', f.closedBy, f.closedAt, f.note)) + '</footer></section>';
  }

  LOOK_VIEWS.stand.dashboard = function () {
    var d = W.dashboard(state);
    var checks = receiptChecks().reverse();
    var html = head('Overview', 'The Witness Stand', 'Two witnesses at every check: the worker\'s voice and the camera\'s eye. The page compares them. A human decides.');
    if (!checks.length) {
      html += '<section class="stand-empty"><h2>No one has testified yet.</h2><p>Receive a shipment: speak the count, take a photo of the freight. The two witnesses meet here.</p>' +
        '<a class="btn primary" href="#/receiving">Go to Receiving</a></section>';
    } else {
      var all = [];
      checks.forEach(function (c) { all = all.concat(c.points); });
      html += '<div class="stand-tally"><span class="st-label">Across ' + checks.length + ' receipt' + (checks.length === 1 ? '' : 's') + '</span>' + tallyHtml(tally(all)) + '</div>';
      html += standCase(checks[0], true);
      if (checks.length > 1) html += '<h3 class="stand-sub">Earlier testimony</h3>' + checks.slice(1, 4).map(function (c) { return standCase(c, false); }).join('');
    }
    var flags = state.wms.flags.slice().reverse().slice(0, 3);
    if (flags.length) html += '<h3 class="stand-sub">Reports from the floor</h3>' + flags.map(flagCase).join('');
    var rec = [
      ['Open tasks', d.tasks.open + d.tasks.assigned, 'queues'], ['Open flags', d.flagsOpen, 'flags'], ['OS&D open', d.osdOpen, 'osd'],
      ['Inbound received', d.inbound.received, 'receiving'], ['Loads shipped', d.outbound.loadsClosed, 'ship'],
      ['Fill rate', d.fillRate == null ? '—' : d.fillRate + '%', 'picking'], ['Replenishment', d.replen, 'replen']
    ];
    html += '<section class="record-strip"><h3>The record</h3><div>' + rec.map(function (r) {
      return '<a href="#/' + r[2] + '"><b>' + esc(r[1]) + '</b> ' + esc(r[0]) + '</a>';
    }).join('') + '</div></section>';
    return html;
  };

  LOOK_VIEWS.stand.receiving = function () {
    var html = head('Inbound › Receiving', 'Receiving', 'The receiver speaks the count. The camera looks at the freight. The page compares the two. A human checks the numbers and posts.');
    var s = ui.rcvShip ? E.shipmentById(state, ui.rcvShip) : null;
    if (s && s.status === 'staged at door') {
      var exp = W.expectedLines(s);
      if (!ui.rcvLines || ui.rcvLines.length !== exp.length) {
        ui.rcvLines = exp.map(function (l) { return { desc: l.desc, expected: l.expected, received: '', damaged: '', quote: '' }; });
      }
      var points = witness(ui.rcvLines, ui.rcvPhotoFlags, ui.rcvTranscript);
      var bol = s.bol || {};
      html += '<section class="case hero live"><header class="case-h"><div><span class="case-kicker">' + esc(s.door) + ' · ' + esc(s.id) + ' · BOL ' + esc(bol.bolNumber || 'not on file') +
        ' · claims ' + esc(bol.piecesClaimed == null ? '—' : bol.piecesClaimed) + ' pieces</span><h2>' + esc(s.desc) + '</h2></div>' + (points.length ? tallyHtml(tally(points)) : '') + '</header>' +
        '<div class="stand-live"><div class="sl-voice"><h3>The worker\'s voice</h3><button class="btn talk big" id="rcvTalk" type="button">🎙 Hold to speak the count</button><span class="hint" id="rcvStatus"></span>' +
        (ui.rcvTranscript ? '<blockquote class="said"><span class="q">' + esc(ui.rcvTranscript) + '</span><cite>' + esc(uname(me)) + '</cite></blockquote>' : '<p class="said none">Nothing said yet. Say what you count and what you see.</p>') + '</div>' +
        '<div class="sl-verdicts"><h3>Verdict</h3>' + (points.length ? points.map(function (p) {
          return '<div class="sl-point v-' + p.verdict + '"><span>' + esc(p.point) + '</span>' + verdictTag(p.verdict, true) + '</div>';
        }).join('') : '<p class="said none">Waiting for both witnesses.</p>') + '</div>' +
        '<div class="sl-camera"><h3>The camera\'s eye</h3><button class="btn big" data-act="cam" data-for="dock">📷 Photo of the freight</button>' +
        (ui.rcvPhoto ? '<img class="photo-preview" src="' + ui.rcvPhoto + '" alt="Freight photo">' : '') +
        (ui.rcvPhotoFlags.length ? ui.rcvPhotoFlags.map(function (f) { return '<p class="seen">' + esc(f.label) + (f.detail ? ' — ' + esc(f.detail) : '') + '</p>'; }).join('')
          : '<p class="seen none">No photo yet.</p>') + '</div></div>';
      var lrows = ui.rcvLines.map(function (l, i) {
        return '<tr><td>' + esc(l.desc) + '</td><td class="num">' + l.expected + '</td><td class="num"><input class="cell" data-rcv="received" data-i="' + i + '" inputmode="numeric" value="' + esc(l.received == null ? '' : l.received) + '"></td>' +
          '<td class="num"><input class="cell" data-rcv="damaged" data-i="' + i + '" inputmode="numeric" value="' + esc(l.damaged == null ? '' : l.damaged) + '"></td><td>' +
          (l.quote ? '<span class="quote">' + esc(l.quote) + '</span>' : '<span class="hint">—</span>') + '</td></tr>';
      });
      html += '<div class="stand-record"><h3>The numbers — check them</h3>' + table(['Item', 'BOL qty', 'Received', 'Damaged', 'Receiver\'s words'], lrows) + '</div>' +
        '<footer class="human act"><p>The machine fills in what it heard. Nothing posts on its own.</p><button class="btn primary human-btn" data-act="rcv-post">I checked it — post receipt</button>' +
        '<button class="btn" data-act="rcv-clear">Clear</button><a class="btn" href="index.html">Full two-scan cross-check ↗</a></footer></section>';
    } else {
      html += '<section class="stand-empty"><h2>Pick a trailer at a door.</h2><p>Check a trailer in at Dock & Yard, then press Receive below.</p></section>';
    }
    var rows = state.inbound.map(function (x) {
      var st = W.inboundStatus(state, x);
      return '<tr class="' + (ui.rcvShip === x.id ? 'sel' : '') + '"><td class="id">' + esc(x.id) + '</td><td>' + esc(x.desc) + '</td><td>' + esc(x.door) + '</td><td>' + stageChip(st) + '</td><td class="actions">' +
        (x.status === 'staged at door' ? '<button class="btn small primary" data-act="rcv-open" data-id="' + esc(x.id) + '">Receive</button>' : '') + '</td></tr>';
    });
    html += '<div class="recede">' + panel('Trailers', table(['Shipment', 'Description', 'Door', 'Status', ''], rows), null, true) + '</div>';
    var checks = receiptChecks().reverse();
    if (checks.length) html += '<h3 class="stand-sub">Posted testimony</h3>' + checks.slice(0, 3).map(function (c) { return standCase(c, false); }).join('');
    return html;
  };

  LOOK_VIEWS.stand.osd = function () {
    var html = head('Inbound › OS&D', 'OS&D Findings', 'Every finding at receiving, with both witnesses side by side. Records stay open: a human closes a finding with a note.');
    var list = state.wms.osd.slice().reverse();
    if (!list.length) return html + '<section class="stand-empty"><h2>No findings.</h2><p>Receive a shipment to create them.</p></section>';
    html += list.map(function (f) {
      var w = findingWitness(f);
      var r = receiptById(f.receiptId);
      return '<section class="case small"><header class="case-h"><div><span class="case-kicker">' + esc(f.id) + ' · ' + esc(f.shipmentId) + (r ? ' · ' + esc(r.id) : '') + '</span><h2>' +
        esc(f.type === 'photo' ? 'Camera: ' + f.label : f.type.charAt(0).toUpperCase() + f.type.slice(1) + (f.desc ? ' · ' + shortDesc(f.desc) : '')) + '</h2></div></header>' +
        witnessRow({ point: '', words: w.words, says: w.says, camera: w.camera, verdict: w.verdict, blind: w.blind }, f.by) +
        '<footer class="human">' + (f.status === 'open' ? awaiting('Open — waiting for a human') + '<button class="btn" data-act="osd-close" data-id="' + esc(f.id) + '">Close…</button>'
          : stamp('Closed', f.closedBy, f.closedAt, f.note)) + '</footer></section>';
    }).join('');
    return html;
  };

  LOOK_VIEWS.stand.flags = function () {
    var html = head('Control › Flags & Incidents', 'Flags & Incidents', 'A worker says what is wrong. The words are kept exactly. The camera did not see it, so it reads Can\'t verify until a human looks.');
    html += '<section class="case hero live"><header class="case-h"><div><span class="case-kicker">The worker\'s voice</span><h2>Report a problem</h2></div></header><div class="stand-form">' + flagForm() + '</div></section>';
    var list = state.wms.flags.slice().reverse();
    html += list.length ? list.map(flagCase).join('') : '<section class="stand-empty"><h2>No reports yet.</h2></section>';
    return html;
  };

  /* ===================== LOOK 2 — THE FLOOR ========================= */

  function bays() {
    /* Each zone is a bay running from the dock wall to the back wall. */
    var by = {};
    state.zones.forEach(function (z) { by[z] = { zone: z, doors: [], bins: [] }; });
    state.doors.forEach(function (d) { if (by[d.zone]) by[d.zone].doors.push(d); });
    state.bins.forEach(function (b) { if (by[b.zone]) by[b.zone].bins.push(b); });
    return state.zones.map(function (z) { return by[z]; });
  }

  function floorModel() {
    var m = { bin: {}, door: {}, zonePins: {}, crew: {}, pack: { tasks: [] } };
    state.bins.forEach(function (b) { m.bin[b.id] = { inc: [], out: [], pins: [], here: [] }; });
    state.doors.forEach(function (d) { m.door[d.id] = { pins: [], staged: [], here: [] }; });
    state.zones.forEach(function (z) { m.zonePins[z] = []; m.crew[z] = []; });
    state.staging.forEach(function (p) { if (m.door[p.door]) m.door[p.door].staged.push(p); });
    state.tasks.forEach(function (t) {
      if (t.status === 'done') return;
      if (t.toBinId && m.bin[t.toBinId]) m.bin[t.toBinId].inc.push(t);
      var src = t.type === 'pick' || t.type === 'count' ? t.binId : t.fromBinId;
      if (src && m.bin[src]) m.bin[src].out.push(t);
      if (t.type === 'pack') m.pack.tasks.push(t);
    });
    state.labor.forEach(function (u) {
      if (u.role !== 'worker') return;
      var t = W.currentOf(state, u.id);
      var r = taskRoute(t);
      if (m.crew[u.zone]) m.crew[u.zone].push({ u: u, t: t, route: r });
      if (t && r.at) {
        if (r.at.bin && m.bin[r.at.bin]) m.bin[r.at.bin].here.push(u);
        else if (r.at.door && m.door[r.at.door]) m.door[r.at.door].here.push(u);
      }
    });
    state.wms.flags.forEach(function (f) {
      if (f.status !== 'open') return;
      var t = f.taskId ? E.taskById(state, f.taskId) : null;
      var b = t && (t.binId || t.toBinId || t.fromBinId);
      var pin = { kind: 'flag', id: f.id, label: f.label, verdict: 'cant' };
      if (b && m.bin[b]) m.bin[b].pins.push(pin); else if (m.zonePins[f.zone]) m.zonePins[f.zone].push(pin);
    });
    state.wms.osd.forEach(function (f) {
      if (f.status !== 'open') return;
      var s = E.shipmentById(state, f.shipmentId);
      var pin = { kind: 'osd', id: f.id, label: f.type === 'photo' ? f.label : f.type + (f.desc ? ' · ' + shortDesc(f.desc) : ''), verdict: findingWitness(f).verdict };
      if (s && m.door[s.door]) m.door[s.door].pins.push(pin);
    });
    return m;
  }

  /* Where a task takes its worker: from → to, in floor words. */
  function taskRoute(t) {
    if (!t) return { text: 'Free', at: null };
    if (t.type === 'putaway') {
      var p = null; state.staging.forEach(function (x) { if (x.id === t.stagingId) p = x; });
      return { text: (p ? p.door : 'Dock') + ' → ' + dest(t.toBinId), at: { bin: t.toBinId } };
    }
    if (t.type === 'pick') return { text: 'Bin ' + t.binId + ' → Pack 1', at: { bin: t.binId } };
    if (t.type === 'move' || t.type === 'replen') return { text: 'Bin ' + t.fromBinId + ' → ' + dest(t.toBinId), at: { bin: t.toBinId } };
    if (t.type === 'count') return { text: 'Counting Bin ' + t.binId, at: { bin: t.binId } };
    if (t.type === 'receive') { var s = E.shipmentById(state, t.shipmentId); return { text: 'Receiving at ' + (s ? s.door : 'the dock'), at: { door: s ? s.door : null } }; }
    if (t.type === 'pack') return { text: 'Packing at Pack 1', at: { door: 'Outbound Door 4' } };
    if (t.type === 'load') return { text: 'Loading at Outbound Door 4', at: { door: 'Outbound Door 4' } };
    return { text: t.title, at: null };
  }

  function pinHtml(p) {
    return '<button type="button" class="pin v-' + p.verdict + (ui.pin === p.id ? ' sel' : '') + '" data-act="pin" data-id="' + esc(p.id) + '" title="' + esc(p.id + ' — ' + p.label + ' — ' + VERDICT[p.verdict]) + '">' +
      '<i aria-hidden="true">' + VERDICT_MARK[p.verdict] + '</i><span>' + esc(p.label) + '</span></button>';
  }
  function avatar(u) { return '<span class="ava" title="' + esc(u.name) + '">' + esc(initials(u.id)) + '</span>'; }

  function floorMap(opts) {
    opts = opts || {};
    var m = floorModel();
    var q = (ui.binSearch || '').toLowerCase();
    var faces = {}; state.wms.slots.forEach(function (s) { faces[s.binId] = s; });
    var html = '<div class="floor' + (opts.compact ? ' compact' : '') + (opts.focus ? ' focus-' + opts.focus : '') + '">' +
      '<div class="fl-wall"><span>Dock wall</span></div><div class="fl-bays">';
    bays().forEach(function (bay) {
      html += '<section class="fl-bay"><div class="fl-dock">';
      bay.doors.forEach(function (d) {
        var di = m.door[d.id];
        var what = '';
        if (d.shipmentId) { var s = E.shipmentById(state, d.shipmentId); what = d.shipmentId + (s && s.bol ? ' · BOL ' + s.bol.bolNumber : ''); }
        else if (d.loadId) what = 'Outbound ' + d.loadId;
        html += '<div class="fl-door st-' + esc(d.state) + '"><div class="fl-door-h"><b>' + esc(d.id) + '</b><span class="fl-state">' + esc(d.state) + '</span></div>' +
          (what ? '<div class="fl-what">' + esc(what) + '</div>' : '') +
          (di.staged.length ? '<div class="fl-pallets" title="Pallets staged at ' + esc(d.id) + '">' + di.staged.map(function (p) {
            return '<span class="pallet' + (p.hold ? ' held' : '') + '" title="' + esc(p.id + ' · ' + p.qty + ' × ' + p.desc + (p.hold ? ' · ON HOLD' : '')) + '">' + p.qty + '</span>';
          }).join('') + '</div>' : '') +
          (di.here.length ? '<div class="fl-here">' + di.here.map(avatar).join('') + '</div>' : '') +
          (di.pins.length ? '<div class="fl-pins">' + di.pins.map(pinHtml).join('') + '</div>' : '') + '</div>';
      });
      if (bay.doors.some(function (d) { return d.id === 'Outbound Door 4'; })) {
        html += '<div class="fl-door fl-pack"><div class="fl-door-h"><b>Pack 1</b><span class="fl-state">' + (m.pack.tasks.length ? m.pack.tasks.length + ' to pack' : 'clear') + '</span></div></div>';
      }
      html += '</div><div class="fl-racks"><span class="fl-aisle" aria-hidden="true">aisle</span>';
      bay.bins.forEach(function (b) {
        var bi = m.bin[b.id];
        var match = !q || b.id.toLowerCase().indexOf(q) !== -1 || b.contents.some(function (c) { return c.desc.toLowerCase().indexOf(q) !== -1; });
        var qty = 0; b.contents.forEach(function (c) { qty += c.qty; });
        html += '<button type="button" class="fl-bin' + (b.status === 'hold' ? ' held' : '') + (!b.contents.length ? ' empty' : '') + (bi.inc.length ? ' inc' : '') + (bi.out.length ? ' out' : '') +
          (ui.selBin === b.id ? ' sel' : '') + (match ? '' : ' dim') + '" data-act="bin" data-id="' + esc(b.id) + '">' +
          '<span class="fl-bin-id">' + esc(b.id) + (faces[b.id] ? ' <small>PICK</small>' : '') + '</span>' +
          (opts.compact ? '' : '<span class="fl-bin-what">' + (b.contents.length ? esc(qty + ' · ' + shortDesc(b.contents[0].desc)) + (b.contents.length > 1 ? ' +' + (b.contents.length - 1) : '') : 'Empty') + '</span>') +
          (b.status === 'hold' ? '<span class="fl-tag hold">HOLD</span>' : '') +
          (bi.inc.length ? '<span class="fl-tag inc" title="Work on its way in">▼ ' + bi.inc.length + '</span>' : '') +
          (bi.out.length ? '<span class="fl-tag out" title="Work leaving from here">▲ ' + bi.out.length + '</span>' : '') +
          (bi.here.length ? '<span class="fl-here">' + bi.here.map(avatar).join('') + '</span>' : '') +
          (bi.pins.length ? '<span class="fl-pins">' + bi.pins.map(function (p) { return '<i class="pin-dot v-' + p.verdict + '" title="' + esc(p.label) + '">' + VERDICT_MARK[p.verdict] + '</i>'; }).join('') + '</span>' : '') +
          '</button>';
      });
      var crew = m.crew[bay.zone];
      var waiting = state.tasks.filter(function (t) { return t.zone === bay.zone && t.status !== 'done'; }).length;
      html += '</div><div class="fl-crew"><div class="fl-zone"><b>Zone ' + esc(bay.zone) + '</b><span>' + waiting + ' task' + (waiting === 1 ? '' : 's') + ' waiting</span></div>' +
        (m.zonePins[bay.zone].length ? '<div class="fl-pins">' + m.zonePins[bay.zone].map(pinHtml).join('') + '</div>' : '') +
        (opts.compact ? '<div class="fl-crew-row">' + crew.map(function (c) { return avatar(c.u); }).join('') + '</div>'
          : crew.map(function (c) { return '<div class="fl-worker' + (c.t ? ' busy' : '') + '">' + avatar(c.u) + '<span><b>' + esc(c.u.name.split(' ')[0]) + '</b> ' + esc(c.route.text) + '</span></div>'; }).join('')) +
        '</div></section>';
    });
    html += '</div></div>';
    return html;
  }

  function floorLegend() {
    return '<div class="fl-legend"><span><i class="pin-dot v-flag">!</i> Flag</span><span><i class="pin-dot v-agree">✓</i> Agree</span><span><i class="pin-dot v-cant">?</i> Can\'t verify</span>' +
      '<span><b class="fl-tag inc">▼</b> work coming in</span><span><b class="fl-tag out">▲</b> work going out</span><span><b class="pallet">n</b> pallet at a door</span><span><b class="pallet held">n</b> on hold</span></div>';
  }

  function pinDetail() {
    var f = null, kind = null;
    state.wms.flags.forEach(function (x) { if (x.id === ui.pin) { f = x; kind = 'flag'; } });
    state.wms.osd.forEach(function (x) { if (x.id === ui.pin) { f = x; kind = 'osd'; } });
    if (!f) return '';
    var body;
    if (kind === 'flag') {
      body = '<h3>' + esc(f.label) + '</h3>' + witnessRow({ point: 'Reported · Zone ' + (f.zone || '—'), words: f.words, says: '', camera: '', verdict: 'cant' }, f.by) +
        '<div class="human">' + (f.status === 'open' ? awaiting() + (isManager() ? '<button class="btn" data-act="flag-close" data-id="' + esc(f.id) + '">Close…</button>' : '') : stamp('Closed', f.closedBy, f.closedAt, f.note)) + '</div>';
    } else {
      var w = findingWitness(f);
      var s = E.shipmentById(state, f.shipmentId);
      body = '<h3>' + esc(f.type === 'photo' ? 'Camera: ' + f.label : f.type + (f.desc ? ' · ' + shortDesc(f.desc) : '')) + '</h3><p class="hint">' + esc(f.shipmentId + (s ? ' at ' + s.door : '')) + '</p>' +
        witnessRow({ point: '', words: w.words, says: w.says, camera: w.camera, verdict: w.verdict, blind: w.blind }, f.by) +
        '<div class="human">' + (f.status === 'open' ? awaiting() + '<button class="btn" data-act="osd-close" data-id="' + esc(f.id) + '">Close…</button>' : stamp('Closed', f.closedBy, f.closedAt, f.note)) + '</div>';
    }
    return panel('Pinned ' + f.id, body + '<p><button class="btn small" data-act="pin" data-id="">Back to the floor</button></p>');
  }

  function pinList() {
    var m = floorModel(), pins = [];
    Object.keys(m.door).forEach(function (k) { m.door[k].pins.forEach(function (p) { pins.push([k, p]); }); });
    Object.keys(m.bin).forEach(function (k) { m.bin[k].pins.forEach(function (p) { pins.push(['Bin ' + k, p]); }); });
    Object.keys(m.zonePins).forEach(function (k) { m.zonePins[k].forEach(function (p) { pins.push(['Zone ' + k, p]); }); });
    return panel('Pinned on the floor', pins.length ? '<ul class="fl-pinlist">' + pins.map(function (x) {
      return '<li><span class="hint">' + esc(x[0]) + '</span>' + pinHtml(x[1]) + '</li>';
    }).join('') + '</ul>' : '<p class="empty">Nothing pinned. No open flags or findings.</p>', 'open flags & findings');
  }

  LOOK_VIEWS.floor.dashboard = function () {
    var d = W.dashboard(state);
    var html = head('Overview', 'The Floor', 'The building, live. Doors along the dock wall, zones behind them, every bin in its place. Work shows where it is going; problems are pinned where they happened.');
    html += '<div class="fl-strip"><span><b>' + (d.tasks.open + d.tasks.assigned) + '</b> tasks open</span><span><b>' + d.inbound.atDoor + '</b> trailers at a door</span><span><b>' +
      d.flagsOpen + '</b> flags open</span><span><b>' + d.osdOpen + '</b> OS&D open</span><span><b>' + d.outbound.loadsClosed + '</b> loads shipped</span>' +
      (d.bottleneck ? '<span class="bad">Backing up: <b>Zone ' + esc(d.bottleneck.zone) + '</b></span>' : '') + '</div>';
    var side = ui.pin ? pinDetail() : ui.selBin ? binDetail() + '<p><button class="btn small" data-act="pin" data-id="">Back to the floor</button></p>' : pinList();
    var props = W.proposals(state);
    if (props.length) side += panel('Labor proposals', props.map(function (p) { return '<p><b>Move ' + esc(p.unitName) + '</b> Zone ' + esc(p.fromZone) + ' → ' + esc(p.toZone) + '<br><span class="hint">' + esc(p.why) + '</span></p>'; }).join('') +
      '<p class="law">A proposal, not a decision. <a href="#/labor">Decide in Labor Management</a>.</p>');
    html += '<div class="fl-layout"><div>' + floorMap({}) + floorLegend() + '</div><div class="fl-side">' + side + '</div></div>';
    return html;
  };

  LOOK_VIEWS.floor.locations = function () {
    var html = head('Inventory › Locations', 'Locations', 'Every bin where it stands. Hatched bins are on hold. Tap a bin to see what is in it.');
    html += '<div class="filters fl-filter"><div class="field"><label>Find an item or bin</label><input id="fBin" type="search" value="' + esc(ui.binSearch) + '" placeholder="e.g. peaches"></div></div>';
    html += '<div class="fl-layout"><div>' + floorMap({}) + floorLegend() + '</div><div class="fl-side">' + binDetail() + '</div></div>';
    return html;
  };

  /* The other floor screens keep their work lists, under a small map of the building. */
  [['dock', 'dock'], ['receiving', 'dock'], ['putaway', 'racks'], ['picking', 'racks'], ['ship', 'dock'], ['osd', 'pins'], ['flags', 'pins'], ['queues', 'crew'], ['counts', 'racks'], ['replen', 'racks']].forEach(function (x) {
    LOOK_VIEWS.floor[x[0]] = function () { return injectAfterHead(VIEWS[x[0]](), floorMap({ compact: true, focus: x[1] })); };
  });

  /* ===================== LOOK 3 — THE RECORD ======================== */

  /* A case entry: the worker's words, quoted and attributed. */
  function entryWords(words, by, ts) {
    if (!words || /^\(typed/.test(words)) return '<span class="entry-none">No words on record (typed)</span>';
    return '<blockquote class="entry-q"><span class="q">' + esc(words) + '</span><cite>' + esc(uname(by)) + (ts ? ', ' + time(ts) : '') + '</cite></blockquote>';
  }

  LOOK_VIEWS.record.dashboard = function () {
    var d = W.dashboard(state);
    var k = function (label, v, sub, cls, href) {
      return '<a class="kpi ' + (cls || '') + '" href="#/' + href + '"><div class="k-label">' + esc(label) + '</div><div class="k-val">' + esc(v == null ? '—' : v) + '</div><div class="k-sub">' + esc(sub || '') + '</div></a>';
    };
    var all = [];
    receiptChecks().forEach(function (c) { all = all.concat(c.points); });
    var t = tally(all);
    var html = head('Overview', 'The Record', 'Everything here is evidence: counted from the desk record, quoted in the worker\'s own words, decided by a human.');
    html += '<div class="kpis">' +
      k('Agree', t.agree, 'voice and camera match', 'ok', 'receiving') +
      k('Flag', t.flag, 'voice and camera differ', t.flag ? 'bad' : '', 'osd') +
      k('Can\'t verify', t.cant, 'one witness could not see', t.cant ? 'warn' : '', 'osd') +
      k('Open findings', d.osdOpen + d.flagsOpen, d.osdOpen + ' OS&D · ' + d.flagsOpen + ' flags', d.osdOpen + d.flagsOpen ? 'bad' : 'ok', 'osd') +
      k('Open tasks', d.tasks.open + d.tasks.assigned, d.tasks.assigned + ' in progress · ' + d.tasks.blocked + ' blocked', d.tasks.blocked ? 'warn' : '', 'queues') +
      k('Inbound', d.inbound.received + ' / ' + (d.inbound.received + d.inbound.atDoor + d.inbound.expected), d.inbound.unitsIn + ' units counted', '', 'receiving') +
      k('Outbound loads', d.outbound.loadsClosed, d.outbound.unitsOut + ' units shipped', d.outbound.loadsClosed ? 'ok' : '', 'ship') +
      k('Fill rate', d.fillRate == null ? '—' : d.fillRate + '%', d.shortPicks + ' short pick' + (d.shortPicks === 1 ? '' : 's'), d.shortPicks ? 'warn' : '', 'picking') +
      '</div>';
    var waiting = [];
    state.wms.osd.forEach(function (f) { if (f.status === 'open') waiting.push({ ts: f.ts, html: '<tr><td class="id">' + esc(f.id) + '</td><td>' + esc(f.type === 'photo' ? 'Camera: ' + f.label : f.type + (f.desc ? ' · ' + shortDesc(f.desc) : '')) + '</td><td>' + (findingWitness(f).fromCamera ? '<span class="entry-none">Seen by the camera</span>' : entryWords(f.words, f.by, f.ts)) + '</td><td>' + verdictTag(findingWitness(f).verdict) + '</td><td><a class="btn small" href="#/osd">Decide</a></td></tr>' }); });
    state.wms.flags.forEach(function (f) { if (f.status === 'open') waiting.push({ ts: f.ts, html: '<tr><td class="id">' + esc(f.id) + '</td><td>' + esc(f.label) + '</td><td>' + entryWords(f.words, f.by, f.ts) + '</td><td>' + verdictTag('cant') + '</td><td><a class="btn small" href="#/flags">Decide</a></td></tr>' }); });
    W.proposals(state).forEach(function (p) { waiting.push({ ts: '', html: '<tr><td class="id">Labor</td><td>Move ' + esc(p.unitName) + ', Zone ' + esc(p.fromZone) + ' → ' + esc(p.toZone) + '</td><td><span class="entry-none">' + esc(p.why) + '</span></td><td>—</td><td><a class="btn small" href="#/labor">Decide</a></td></tr>' }); });
    waiting.sort(function (a, b) { return a.ts < b.ts ? 1 : -1; });
    var left = panel('Awaiting a human decision', table(['Entry', 'Finding', 'Words on record', 'Verdict', ''], waiting.map(function (w) { return w.html; }), 'Nothing is waiting for a decision.'), waiting.length + ' open', true) +
      panel('Dock doors', doorsHtml(), 'live');
    var right = panel('Latest on the record', recordsHtml(state.records.slice(-8).reverse()), '<a href="#/audit">Full record</a>', true);
    html += '<div class="grid2"><div>' + left + '</div><div>' + right + '</div></div>';
    return html;
  };

  LOOK_VIEWS.record.receiving = function () {
    var html = head('Inbound › Receiving', 'Receiving', 'Receive against the BOL on file. Each line is entered as evidence: what the receiver said, what the camera saw, and whether the two agree. A human posts the receipt.');
    var rows = state.inbound.map(function (s) {
      var st = W.inboundStatus(state, s);
      return '<tr class="' + (ui.rcvShip === s.id ? 'sel' : '') + '"><td class="id">' + esc(s.id) + '</td><td class="id">' + esc(s.bol ? s.bol.bolNumber : '—') + '</td><td>' + esc(s.desc) + '</td><td>' + esc(s.door) +
        '</td><td class="num">' + esc(s.pallets) + '</td><td>' + stageChip(st) + ' <span class="hint">' + esc(st.words) + '</span></td><td class="actions">' +
        (s.status === 'staged at door' ? '<button class="btn small primary" data-act="rcv-open" data-id="' + esc(s.id) + '">Receive</button>' : '') + '</td></tr>';
    });
    html += panel('Inbound shipments (ASN / BOL on file)', table(['Shipment', 'BOL #', 'Description', 'Door', 'Pallets', 'Status', ''], rows), null, true);
    var s = ui.rcvShip ? E.shipmentById(state, ui.rcvShip) : null;
    if (s && s.status === 'staged at door') {
      var exp = W.expectedLines(s);
      if (!ui.rcvLines || ui.rcvLines.length !== exp.length) {
        ui.rcvLines = exp.map(function (l) { return { desc: l.desc, expected: l.expected, received: '', damaged: '', quote: '' }; });
      }
      var cam = camera(ui.rcvPhotoFlags);
      var lrows = ui.rcvLines.map(function (l, i) {
        var pts = witness([l], ui.rcvPhotoFlags, '').filter(function (p) { return p.point !== 'Condition'; });
        var v = pts.length ? (pts.some(function (p) { return p.verdict === 'flag'; }) ? 'flag' : pts.some(function (p) { return p.verdict === 'cant'; }) ? 'cant' : 'agree') : null;
        return '<tr><td>' + esc(l.desc) + '</td><td class="num">' + l.expected + '</td><td class="num"><input class="cell" data-rcv="received" data-i="' + i + '" inputmode="numeric" value="' + esc(l.received == null ? '' : l.received) + '"></td>' +
          '<td class="num"><input class="cell" data-rcv="damaged" data-i="' + i + '" inputmode="numeric" value="' + esc(l.damaged == null ? '' : l.damaged) + '"></td><td>' +
          (l.quote ? entryWords(l.quote, me) : '<span class="entry-none">—</span>') + '</td><td>' + (cam.text ? '<span class="entry-seen">' + esc(cam.text) + '</span>' : '<span class="entry-none">No photo</span>') + '</td><td>' + (v ? verdictTag(v) : '—') + '</td></tr>';
      });
      var bol = s.bol || {};
      var body = '<p class="hint">BOL <b>' + esc(bol.bolNumber || 'not on file') + '</b> · ' + esc(bol.carrier || '') + ' · shipper ' + esc(bol.shipper || '—') +
        ' · claims ' + esc(bol.piecesClaimed == null ? '—' : bol.piecesClaimed) + ' pieces · at ' + esc(s.door) + '</p>' +
        table(['Item', 'BOL qty', 'Received', 'Damaged', 'Voice — receiver\'s words', 'Camera — photo', 'Verdict'], lrows) +
        witness(ui.rcvLines, ui.rcvPhotoFlags, ui.rcvTranscript).filter(function (p) { return p.point === 'Condition'; }).map(function (p) {
          return '<p class="entry-cond"><b>Condition</b> Voice: ' + esc(p.says) + ' · Camera: ' + esc(p.camera || 'no photo') + ' ' + verdictTag(p.verdict) + '</p>';
        }).join('') +
        '<div class="form-actions">' +
        '<button class="btn talk" id="rcvTalk" type="button">🎙 Hold to speak the count</button>' +
        '<button class="btn" data-act="cam" data-for="dock">📷 Photo of the freight</button>' +
        '<a class="btn" href="index.html">Full two-scan cross-check ↗</a>' +
        '<span class="hint" id="rcvStatus"></span></div>' +
        (ui.rcvTranscript ? '<div class="heard"><b>Heard — entered as said</b>' + entryWords(ui.rcvTranscript, me) + '</div>' : '') +
        (ui.rcvPhoto ? '<img class="photo-preview" src="' + ui.rcvPhoto + '" alt="Freight photo">' : '') +
        '<div class="form-actions"><button class="btn primary" data-act="rcv-post">Post receipt — I checked it</button><button class="btn" data-act="rcv-clear">Clear</button></div>' +
        '<p class="law">The machine fills in what it heard; a human checks the numbers and posts. Nothing posts on its own.</p>';
      html += panel('Receive ' + s.id + ' — ' + s.desc, body, 'counts against the BOL on file');
    } else {
      html += panel('Receive', '<p class="empty">Check a trailer in at Dock & Yard, then pick a shipment at a door above.</p>');
    }
    var rr = receiptChecks().reverse().map(function (c) {
      var r = c.receipt, units = 0, dmg = 0;
      r.lines.forEach(function (l) { units += l.received; dmg += l.damaged; });
      return '<tr><td class="id">' + esc(r.id) + '</td><td class="id">' + esc(r.shipmentId) + '<br>' + esc(r.bolNumber || '—') + '</td><td class="num">' + units + '</td><td class="num">' + dmg +
        '</td><td>' + entryWords(r.transcript, r.by, null) + '</td><td>' + (camera(r.photoFlags).text ? '<span class="entry-seen">' + esc(camera(r.photoFlags).text) + '</span>' : '<span class="entry-none">No photo</span>') +
        '</td><td>' + tallyHtml(tally(c.points)) + '</td><td>' + stamp('Posted', r.by, r.ts) + '</td></tr>';
    });
    html += panel('Receipts on the record', table(['Receipt', 'Shipment / BOL', 'Units', 'Dmg', 'Voice', 'Camera', 'Verdicts', 'Decision'], rr, 'No receipts yet.'), null, true);
    return html;
  };

  LOOK_VIEWS.record.osd = function () {
    var html = head('Inbound › OS&D', 'OS&D Findings', 'Case entries from receiving. Each one quotes the receiver, shows what the camera saw, and carries a human\'s stamp when it is settled. Records stay open.');
    var rows = state.wms.osd.slice().reverse().map(function (f) {
      var w = findingWitness(f);
      var cls = f.type === 'damage' ? 'bad' : f.type === 'shortage' ? 'warn' : f.type === 'overage' ? 'info' : '';
      return '<tr><td class="id">' + esc(f.id) + '<br><span class="hint">' + esc(f.shipmentId) + '</span></td><td>' + chip(f.type === 'photo' ? 'Photo: ' + f.label : f.type, cls) + '<br>' + esc(f.desc ? shortDesc(f.desc) : '') +
        (f.qty != null ? ' <b>' + esc(f.qty) + '</b>' : '') + '</td><td>' + (w.fromCamera ? '<span class="entry-none">' + esc(w.says) + '</span>' : entryWords(f.words, f.by, f.ts)) + '</td><td>' +
        (w.camera ? '<span class="entry-seen' + (w.blind ? ' blind' : '') + '">' + esc(w.camera) + '</span>' : '<span class="entry-none">No photo</span>') + '</td><td>' + verdictTag(w.verdict) + '</td><td>' +
        (f.status === 'open' ? awaiting() + ' <button class="btn small" data-act="osd-close" data-id="' + esc(f.id) + '">Close…</button>' : stamp('Closed', f.closedBy, f.closedAt, f.note)) + '</td></tr>';
    });
    html += panel('Case entries', table(['Entry', 'Finding', 'Voice — on the record', 'Camera', 'Verdict', 'Decision'], rows, 'No OS&D findings. Receive a shipment to create them.'), null, true);
    return html;
  };

  LOOK_VIEWS.record.flags = function () {
    var html = head('Control › Flags & Incidents', 'Flags & Incidents', 'A flag is an entry on the record: a short label and the speaker\'s exact words. It closes nothing. A human closes it, and the stamp says who.');
    html += panel('Report a problem', flagForm());
    var rows = state.wms.flags.slice().reverse().map(function (f) {
      var t = f.taskId ? E.taskById(state, f.taskId) : null;
      return '<tr><td class="id">' + esc(f.id) + '</td><td><b>' + esc(f.label) + '</b><br><span class="hint">' + esc(t ? t.title : 'No task in hand') + ' · Zone ' + esc(f.zone || '—') + '</span></td><td>' +
        entryWords(f.words, f.by, f.ts) + '</td><td>' + verdictTag('cant') + '<br><span class="hint">no photo</span></td><td>' +
        (f.status === 'open' ? awaiting() + (isManager() ? ' <button class="btn small" data-act="flag-close" data-id="' + esc(f.id) + '">Close…</button>' : '') : stamp('Closed', f.closedBy, f.closedAt, f.note)) + '</td></tr>';
    });
    html += panel('Entries', table(['Entry', 'Label', 'Exact words', 'Verdict', 'Decision'], rows, 'No flags yet.'), null, true);
    return html;
  };

  var DECISION_KINDS = { ship: 'Shipped', 'osd-closed': 'Closed', 'flag-closed': 'Closed', wave: 'Released', hold: 'Held', release: 'Released', reassign: 'Reassigned' };
  function ledgerHtml(list) {
    var total = state.records.length;
    return table(['Entry', 'Time', 'What happened', 'Decided by'], list.map(function (r) {
      var verb = r.kind === 'labor-move' ? (r.approved ? 'Approved' : 'Declined') : r.kind === 'complete' && r.receiptId ? 'Posted' : DECISION_KINDS[r.kind];
      var human = r.by && E.unitById(state, r.by);
      var i = state.records.indexOf(r);
      return '<tr><td class="id">No. ' + (i >= 0 ? i + 1 : total) + '</td><td class="id">' + time(r.ts) + '</td><td>' + chip(r.kind || 'note', r.kind === 'incident' ? 'bad' : '') + ' ' + esc(r.text) + '</td><td>' +
        (verb && human ? stamp(verb, r.by, null) : '<span class="entry-none">' + (human ? esc(uname(r.by)) : 'System') + '</span>') + '</td></tr>';
    }));
  }

  /* ---------- render ------------------------------------------------ */

  function render() {
    if (!state) return;
    if (micActive) return;
    if (!E.unitById(state, me)) me = managerId();
    var cur = route();
    renderWho();
    renderNav(cur);
    var v = (LOOK_VIEWS[LOOK] || {})[cur] || VIEWS[cur] || VIEWS.dashboard;
    var scroll = window.scrollY;
    $('main').innerHTML = v();
    window.scrollTo(0, scroll);
    wireMics(cur);
  }

  /* ---------- voice ------------------------------------------------- */

  function micHandlers(btn, statusId, onText) {
    var label = btn.textContent;
    function status(t) { var el = $(statusId); if (el) el.textContent = t || ''; }
    return {
      onListening: function () { micActive = true; btn.classList.add('listening'); btn.textContent = '● Listening — let go to send'; status(''); },
      onSending: function () { btn.classList.remove('listening'); btn.textContent = 'Transcribing…'; },
      onText: function (text) { micActive = false; btn.textContent = label; status('Heard it.'); onText(text); },
      onError: function (m) { micActive = false; btn.classList.remove('listening'); btn.textContent = label; status(m); toast(m, true); },
      onIdle: function () { micActive = false; btn.classList.remove('listening'); btn.textContent = label; }
    };
  }

  function wireMics(view) {
    if (!Mic) return;
    if (view === 'receiving' && $('rcvTalk')) Mic.attach($('rcvTalk'), micHandlers($('rcvTalk'), 'rcvStatus', receivingVoice));
    if (view === 'flags' && $('flTalk')) Mic.attach($('flTalk'), micHandlers($('flTalk'), 'flStatus', function (text) { ui.flagWords = text; fileFlag(text, 'voice'); }));
    if (view === 'rf' && $('rfTalk')) Mic.attach($('rfTalk'), micHandlers($('rfTalk'), 'rfStatus', rfVoice));
    if (view === 'labor' && $('askTalk')) Mic.attach($('askTalk'), micHandlers($('askTalk'), 'askQ', function (text) { askBuilding(text); }));
  }

  function receivingVoice(text) {
    var s = E.shipmentById(state, ui.rcvShip);
    if (!s) return;
    ui.rcvTranscript = text;
    var st = $('rcvStatus'); if (st) st.textContent = 'Reading the count with Muse Spark…';
    AI.readReceiving(window.fetch.bind(window), text, W.expectedLines(s)).then(function (res) {
      ui.rcvLines = res.lines.map(function (l) {
        return { desc: l.desc, expected: l.expected, received: l.received == null ? '' : l.received, damaged: l.damaged == null ? '' : l.damaged, quote: l.quote };
      });
      ui.rcvSource = 'voice';
      render();
      toast('Counts filled from what was said. Check them, then post.');
    }).catch(function (e) {
      render();
      toast((e && e.userMessage) || 'The count could not be read. Type it instead.', true);
    });
  }

  function fileFlag(words, source, unitId) {
    words = String(words || '').trim();
    if (!words) { toast('Say or type what happened first.', true); return Promise.resolve(); }
    var who = unitId || (isManager() ? val('flWho') || ui.rfUnit : me);
    var st = $('flStatus'); if (st) st.textContent = 'Labeling with Muse Spark…';
    return AI.labelFlag(window.fetch.bind(window), words).then(function (r) { return r.label; }, function () { return null; }).then(function (label) {
      return act(function (s) { return W.flag(s, { unitId: who, words: words, label: label, source: source }); }, function (r) {
        return 'Flagged "' + r.flag.label + '"' + (label ? '' : ' (the label service did not answer — filed unlabeled)') + '. Words kept exactly.';
      });
    }).then(function (r) { if (r && r.ok) ui.flagWords = ''; render(); return r; });
  }

  function rfVoice(text) {
    var uid = ui.rfUnit;
    ui.rfHeard = text;
    var plan = W.interpret(state, uid, text);
    if (plan.intent === 'problem') {
      ui.rfReply = 'Filing it as a flag…';
      render();
      fileFlag(text, 'voice', uid).then(function (r) {
        ui.rfReply = r && r.ok ? 'Flagged "' + r.flag.label + '" with your words. Nothing was closed.' : 'The flag was not filed.';
        render();
      });
      return;
    }
    act(function (s) {
      var p = W.interpret(s, uid, text); /* re-read against the fresh state */
      var r = W.act(s, uid, p);
      ui.rfReply = r.reply;
      if (!r.ok) return { ok: false, reason: r.reply };
      return r;
    }, null).then(function () { render(); });
  }

  function askBuilding(q) {
    q = String(q || '').trim();
    if (!q) { toast('Type or say a question first.', true); return; }
    ui.ask = { q: q }; ui.askBusy = true; render();
    C.askManager({ engine: E, state: state, fetch: window.fetch.bind(window), question: q }).then(function (res) {
      ui.ask = { q: q, answer: res.answer, check: res.check, summary: res.summary.text };
    }).catch(function (e) {
      ui.ask = { q: q, error: (e && e.userMessage) || 'No answer. Nothing was guessed.' };
    }).then(function () { ui.askBusy = false; render(); });
  }

  /* ---------- camera ------------------------------------------------ */

  $('camInput').addEventListener('change', function () {
    var f = this.files && this.files[0];
    this.value = '';
    if (!f) return;
    var forWhat = ui.camFor;
    photoToDataUrl(f).then(function (dataUrl) {
      if (forWhat === 'dock') {
        ui.rcvPhoto = dataUrl; ui.rcvPhotoFlags = [];
        render();
        toast('Reading the freight photo with Muse Spark…');
        return AI.readDock(window.fetch.bind(window), dataUrl).then(function (r) {
          ui.rcvPhotoFlags = r.flags;
          render();
          toast(r.flags.length + ' photo flag' + (r.flags.length === 1 ? '' : 's') + ' — they ride with the receipt.');
        });
      }
      if (forWhat === 'putaway') {
        ui.rfPhoto = dataUrl; ui.rfPhotoRead = null;
        render();
        return AI.readPutaway(window.fetch.bind(window), dataUrl).then(function (r) {
          ui.rfPhotoRead = r.read;
          render();
        });
      }
    }).catch(function (e) {
      toast((e && e.userMessage) || (e && e.message) || 'The photo could not be read.', true);
      render();
    });
  });

  /* ---------- actions ----------------------------------------------- */

  function promptNote(text) {
    var n = window.prompt(text, '');
    return n === null ? null : n;
  }

  var ACTIONS = {
    retry: function () { $('main').innerHTML = '<div class="loading">Loading the desk record…</div>'; reload(); },
    practice: function () { store.enterPractice(); reload(); },
    'reset-world': function () {
      if (!window.confirm('Replace the desk record with a fresh WMS warehouse? The state stored there now is overwritten for everyone.')) return;
      store.reset().then(function (res) { state = res.state; lastSync = new Date(); syncIdle(); render(); toast('Desk record reset to the warehouse.'); })
        .catch(function (e) { toast((e && e.userMessage) || 'Reset failed.', true); });
    },
    refresh: function () { reload(true).then(function () { toast('Read the desk record again.'); }); },
    print: function () { window.print(); },
    checkin: function (el) { act(function (s) { return W.checkIn(s, el.dataset.id, me); }, 'Checked in — the trailer is at its door and ready to receive.'); },
    schedule: function () {
      act(function (s) { return W.schedule(s, { shipmentId: val('apShip'), door: val('apDoor'), day: val('apDay'), start: val('apStart'), end: val('apEnd'), trailer: val('apTrailer') }, me); }, 'Appointment saved.');
    },
    'rcv-open': function (el) {
      ui.rcvShip = el.dataset.id; ui.rcvLines = null; ui.rcvTranscript = ''; ui.rcvSource = 'typed'; ui.rcvPhoto = null; ui.rcvPhotoFlags = [];
      render();
    },
    'rcv-clear': function () { ui.rcvLines = null; ui.rcvTranscript = ''; ui.rcvPhoto = null; ui.rcvPhotoFlags = []; ui.rcvSource = 'typed'; render(); },
    'rcv-post': function () {
      var sid = ui.rcvShip, lines = (ui.rcvLines || []).map(function (l) { return { desc: l.desc, received: l.received, damaged: l.damaged, quote: l.quote }; });
      var flags = ui.rcvPhotoFlags.slice(), tr = ui.rcvTranscript, src = ui.rcvSource;
      act(function (s) { return W.receive(s, sid, lines, { by: me, transcript: tr, source: src, photoFlags: flags }); }, function (r) {
        ui.rcvShip = null; ui.rcvLines = null; ui.rcvTranscript = ''; ui.rcvPhoto = null; ui.rcvPhotoFlags = [];
        return 'Receipt ' + r.receiptId + ' posted — ' + r.staged + ' pallet(s) staged for putaway, ' + r.osd.length + ' OS&D finding(s).';
      });
    },
    'osd-close': function (el) {
      var n = promptNote('Close ' + el.dataset.id + ' — note (how it was settled):');
      if (n === null) return;
      act(function (s) { return W.resolveOsd(s, el.dataset.id, me, n); }, 'Finding closed.');
    },
    'pa-confirm': function (el) {
      var b = val('pa-' + el.dataset.id).trim();
      act(function (s) { return W.complete(s, el.dataset.id, { by: me, binId: b || undefined }); });
    },
    bin: function (el) { ui.selBin = el.dataset.id; ui.pin = null; render(); },
    pin: function (el) {
      ui.pin = el.dataset.id || null; ui.selBin = null;
      if (ui.pin && route() !== 'dashboard') { location.hash = '#/dashboard'; return; }
      render();
    },
    hold: function (el) { var why = val('holdWhy'); act(function (s) { return W.hold(s, { binId: el.dataset.bin }, me, why); }, function (r) { return 'On hold.' + (r.freed && r.freed.length ? ' Back to the queue from ' + r.freed.join(', ') + '.' : ''); }); },
    release: function (el) {
      var t = el.dataset.bin ? { binId: el.dataset.bin } : { stagingId: el.dataset.stg };
      act(function (s) { return W.release(s, t, me); }, 'Released.');
    },
    'count-bin': function (el) { act(function (s) { return W.cycleCount(s, [el.dataset.id], { by: me, reason: 'Manager request' }); }, 'Cycle count queued.'); },
    'count-zone': function () {
      var z = val('ccZone');
      act(function (s) {
        return W.cycleCount(s, s.bins.filter(function (b) { return b.zone === z && b.contents.length; }).map(function (b) { return b.id; }), { by: me, reason: 'Zone ' + z + ' cycle count' });
      }, function (r) { return r.tasks.length + ' count task(s) queued.'; });
    },
    'count-post': function (el) {
      var counts = {};
      var inputs = document.querySelectorAll('[data-cc="' + el.dataset.id + '"]');
      for (var i = 0; i < inputs.length; i++) { if (inputs[i].dataset.desc) counts[inputs[i].dataset.desc] = inputs[i].value; }
      act(function (s) { return W.complete(s, el.dataset.id, { by: me, counts: counts }); });
    },
    move: function (el) {
      var m = { fromBinId: el.dataset.id, toBinId: val('mvTo'), desc: val('mvDesc'), qty: val('mvQty') };
      act(function (s) { return W.createMove(s, m, me); }, 'Move task created — it is in the queue.');
    },
    slot: function () {
      var sl = { binId: val('slBin'), desc: val('slDesc'), min: val('slMin'), max: val('slMax') };
      act(function (s) { return W.setSlot(s, sl, me); }, 'Pick face saved.');
    },
    wave: function () {
      var ids = [];
      var boxes = document.querySelectorAll('[data-wave]');
      for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) ids.push(boxes[i].dataset.wave);
      act(function (s) { return W.releaseWave(s, ids, me); }, function (r) {
        var short = r.summary.filter(function (x) { return x.short; });
        return 'Wave ' + r.waveId + ' released.' + (short.length ? ' Short on allocation: ' + short.map(function (x) { return x.id; }).join(', ') + '.' : ' Fully allocated.');
      });
    },
    realloc: function () { act(function (s) { return W.reallocateHeld(s, me); }, function (r) { return 'Re-allocated: ' + r.moved.join('; '); }); },
    order: function () {
      var o = { customer: val('oCust'), priority: val('oPri'), shipDate: val('oShip'), lines: [] };
      [0, 1, 2].forEach(function (i) { if (val('olD' + i)) o.lines.push({ desc: val('olD' + i), qty: val('olQ' + i) }); });
      act(function (s) { return W.createOrder(s, o, me); }, function (r) { return 'Order ' + r.order.id + ' saved as New. Release it in a wave.'; });
    },
    pick: function (el) { var q = val('pk-' + el.dataset.id); act(function (s) { return W.complete(s, el.dataset.id, { by: me, qty: q }); }); },
    pack: function (el) { var c = val('pc-' + el.dataset.id); act(function (s) { return W.complete(s, el.dataset.id, { by: me, cartons: c }); }); },
    load: function (el) { act(function (s) { return W.complete(s, el.dataset.id, { by: me }); }); },
    'close-load': function (el) {
      var seal = val('seal-' + el.dataset.id);
      act(function (s) { return W.closeLoad(s, el.dataset.id, { seal: seal, by: me }); }, function (r) { return 'Shipped — ' + r.load.id + ' closed, BOL ' + r.load.bolNumber + '.'; });
    },
    reassign: function () { var t = val('raTask'), u = val('raUnit'); act(function (s) { return W.reassign(s, t, u, me); }, function (r) { return 'Reassigned — ' + r.how + '.'; }); },
    approve: function (el) { var p = W.proposals(state)[+el.dataset.i]; act(function (s) { return W.decide(s, p, true, me); }, 'Approved — the worker\'s zone changed.'); },
    decline: function (el) { var p = W.proposals(state)[+el.dataset.i]; act(function (s) { return W.decide(s, p, false, me); }, 'Declined — recorded.'); },
    ask: function () { askBuilding(val('askQ')); },
    flag: function () { fileFlag(val('flWords'), 'typed'); },
    'flag-close': function (el) {
      var n = promptNote('Close ' + el.dataset.id + ' — what was done:');
      if (n === null) return;
      act(function (s) { return W.closeFlag(s, el.dataset.id, me, n); }, 'Flag closed.');
    },
    cam: function (el) { ui.camFor = el.dataset.for; $('camInput').click(); },
    'rf-next': function () {
      var uid = ui.rfUnit;
      act(function (s) { var r = W.act(s, uid, { intent: 'next' }); ui.rfReply = r.reply; ui.rfHeard = ''; return r.next || r.ok ? r : { ok: false, reason: r.reply }; }, null);
    },
    'rf-confirm': function () {
      var uid = ui.rfUnit;
      var cur = W.currentOf(state, uid);
      if (!cur) return;
      var plan = { intent: 'confirm', task: cur, heard: '' };
      if (cur.type === 'pick') plan.qty = val('rfQty');
      if (cur.type === 'putaway') plan.binId = val('rfBin').trim() || undefined;
      if (cur.type === 'pack') plan.cartons = val('rfCartons');
      if (cur.type === 'count') {
        plan.counts = {};
        var inputs = document.querySelectorAll('[data-rfcc]');
        for (var i = 0; i < inputs.length; i++) if (inputs[i].dataset.rfcc) plan.counts[inputs[i].dataset.rfcc] = inputs[i].value;
      }
      ui.rfHeard = '';
      act(function (s) { var r = W.act(s, uid, plan); ui.rfReply = r.reply; return r.ok ? r : { ok: false, reason: r.reply }; }, null).then(function () { ui.rfPhoto = null; ui.rfPhotoRead = null; render(); });
    },
    'rf-photo-confirm': function () {
      var uid = ui.rfUnit, cur = W.currentOf(state, uid), rd = ui.rfPhotoRead;
      if (!cur || !rd || !rd.binLabel) return;
      act(function (s) { var r = W.act(s, uid, { intent: 'confirm', task: cur, binId: rd.binLabel, heard: '' }); ui.rfReply = r.reply; return r.ok ? r : { ok: false, reason: r.reply }; }, null)
        .then(function () { ui.rfPhoto = null; ui.rfPhotoRead = null; render(); });
    },
    'rf-goto-rcv': function (el) { ui.rcvShip = el.dataset.id; ui.rcvLines = null; }
  };

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var fn = ACTIONS[el.dataset.act];
    if (!fn) return;
    if (el.tagName !== 'A') e.preventDefault();
    fn(el);
  });

  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.dataset && el.dataset.rcv && ui.rcvLines) {
      ui.rcvLines[+el.dataset.i][el.dataset.rcv] = el.value;
      ui.rcvSource = ui.rcvSource === 'voice' ? 'voice, corrected' : ui.rcvSource;
    }
    if (el.id === 'fBin') { ui.binSearch = el.value; var pos = el.selectionStart; render(); var n = $('fBin'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }
    if (el.id === 'flWords') ui.flagWords = el.value;
  });

  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.id === 'fZone') { ui.zoneFilter = el.value; render(); }
    if (el.id === 'tfType') { ui.taskType = el.value; render(); }
    if (el.id === 'tfZone') { ui.taskZone = el.value; render(); }
    if (el.id === 'tfStatus') { ui.taskStatus = el.value; render(); }
    if (el.id === 'rkFilter') { ui.recKind = el.value; render(); }
    if (el.id === 'rfWho') { ui.rfUnit = el.value; ui.rfReply = ''; ui.rfHeard = ''; render(); }
    if (el.id === 'whoSel') {
      me = el.value;
      if (!isManager()) ui.rfUnit = me;
      try { sessionStorage.setItem('wms-who', me); } catch (err) { /* convenience only */ }
      location.hash = isManager() ? '#/dashboard' : '#/rf';
      render();
    }
  });

  window.addEventListener('hashchange', function () { document.body.classList.remove('nav-open'); render(); });
  $('menuBtn').addEventListener('click', function () { document.body.classList.toggle('nav-open'); });

  function tick() { var c = $('clock'); if (c) c.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  setInterval(tick, 15000); tick();

  /* Quietly re-read the desk record so work done on another device
     (the phone, another desk) shows up. Read-only; never saves. */
  setInterval(function () {
    if (!state || busy || micActive || store.practice() || document.hidden) return;
    var a = document.activeElement;
    if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
    reload(true);
  }, 20000);

  /* ---------- start ------------------------------------------------- */
  try { me = sessionStorage.getItem('wms-who'); } catch (e) { me = null; }
  reload().then(function () {
    if (state && !E.unitById(state, me)) { me = managerId(); render(); }
  });

  /* For tests and the console. */
  window.WitnessWmsPage = { getState: function () { return state; }, store: store, ui: ui };
})();
