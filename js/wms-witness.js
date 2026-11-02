/* =====================================================================
   wms-witness.js — the Witness page: one item's record.

   Clicking an item on the warehouse map (a pallet, an order staged to
   ship, a bin, a dock) opens its Witness page. Top to bottom:

     1. The agent's chair — reserved. The live agent arrives in the
        next build; the chair is drawn empty and says so.
     2. Two panels:
        LEFT  — THE EVENTS: the important moments, in time order,
                derived only from real records (the records ledger,
                task updates, receipts, OS&D findings, flags, holds
                and releases, ship confirms).
        RIGHT — THE FULL TRANSCRIPT: every word a person said or
                typed about this item, verbatim, in time order, with
                who said it. Many hands touch one item, so it holds
                many voices.

   Law (briefs/console-task-2-witness-page-record.md):
   - Never invent. If the record has nothing, the panel is empty and
     says so plainly ("Not said", "Nothing on the record yet").
   - A human's act stays a human's act: every event names who posted,
     held, released, closed or decided it. The machine is never shown
     as the one in charge.

   subject() / events() / transcript() / model() are pure and
   node-testable; html() renders the model. Nothing here saves.
   ===================================================================== */
(function (root) {
  'use strict';

  var E = root.WitnessEngine;
  if (!E && typeof require === 'function') { try { E = require('./engine.js'); } catch (e) { /* browser */ } }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function shortDesc(d) { return String(d || '').replace(/ — .*/, ''); }
  function has(list, v) { return v != null && list.indexOf(v) !== -1; }
  function add(list, v) { if (v != null && list.indexOf(v) === -1) list.push(v); }
  function wms(state) { return state.wms || {}; }
  function arr(x) { return Array.isArray(x) ? x : []; }
  function unit(state, id) { return id && E ? E.unitById(state, id) : null; }
  function who(state, id) { var u = unit(state, id); return u ? u.name : null; }

  /* The places the map can open, and how a route names them. */
  var PLACES = ['pallet', 'order', 'bin', 'dock', 'shipment', 'load', 'task'];
  function href(place, id) { return '#/witness/' + place + '/' + encodeURIComponent(id); }
  function parseRoute(r) {
    var m = /^witness\/([a-z]+)\/(.+)$/.exec(String(r || ''));
    if (!m || PLACES.indexOf(m[1]) === -1) return null;
    var id;
    try { id = decodeURIComponent(m[2]); } catch (e) { id = m[2]; }
    return { place: m[1], id: id };
  }

  /* ---------- the subject: what this page is about ------------------ */

  function find(list, pred) { for (var i = 0; i < list.length; i++) if (pred(list[i])) return list[i]; return null; }
  function allOrders(state) { return arr(state.outbound).concat(arr(wms(state).orders)); }

  /* Tasks for a shipment: its receive task, and the putaways of every
     pallet that came off it (still staged, or already put away). */
  function shipmentRelations(state, rel, shipId) {
    add(rel.shipmentIds, shipId);
    add(rel.taskIds, 't-receive-' + shipId);
    arr(state.staging).forEach(function (p) { if (p.shipmentId === shipId) add(rel.stagingIds, p.id); });
    arr(state.tasks).forEach(function (t) {
      if (t.stagingId && (has(rel.stagingIds, t.stagingId) || t.stagingId.indexOf('STG-' + shipId + '-') === 0)) {
        add(rel.stagingIds, t.stagingId); add(rel.taskIds, t.id);
      }
    });
  }

  function orderRelations(state, rel, orderId) {
    add(rel.orderIds, orderId);
    arr(state.tasks).forEach(function (t) { if (t.orderId === orderId) add(rel.taskIds, t.id); });
    arr(wms(state).loads).forEach(function (l) { if (has(arr(l.orderIds), orderId)) add(rel.loadIds, l.id); });
  }

  function blank(place, id) {
    return { place: place, id: id, found: false, kind: place, title: '', sub: '', facts: [],
      taskIds: [], shipmentIds: [], stagingIds: [], orderIds: [], binIds: [], loadIds: [], descs: null };
  }

  function subject(state, place, id, opts) {
    opts = opts || {};
    var s = blank(place, id);

    if (place === 'dock') {
      var d = find(arr(state.doors), function (x) { return x.id === id; });
      if (!d) return s;
      if (d.shipmentId && !opts.noFollow) { var sh = subject(state, 'shipment', d.shipmentId); sh.via = d.id; return sh; }
      var ld = d.loadId ? find(arr(wms(state).loads), function (l) { return l.id === d.loadId; }) : null;
      if (ld && !opts.noFollow) { var lo = subject(state, 'load', ld.id); lo.via = d.id; return lo; }
      s.found = true; s.kind = 'dock';
      s.title = d.id;
      s.sub = 'Nothing at this dock right now.';
      return s;
    }

    if (place === 'pallet') {
      var p = find(arr(state.staging), function (x) { return x.id === id; });
      if (!p) return s;
      s.found = true; s.kind = 'pallet';
      s.title = 'Pallet ' + p.id;
      s.sub = p.qty + ' × ' + shortDesc(p.desc) + ' · Receiving Bay at ' + p.door;
      s.facts = [p.hold ? 'On hold' : null, p.damaged ? 'Damaged' : null].filter(Boolean);
      add(s.stagingIds, p.id);
      arr(state.tasks).forEach(function (t) { if (t.stagingId === p.id) add(s.taskIds, t.id); });
      if (p.shipmentId) {
        /* Where it came from: its truck's arrival and receipt, and the
           findings about its own item — not its sibling pallets' work. */
        add(s.shipmentIds, p.shipmentId);
        add(s.taskIds, 't-receive-' + p.shipmentId);
        s.descs = [p.desc];
        s.sub += ' · off ' + p.shipmentId;
      }
      return s;
    }

    if (place === 'shipment') {
      var ship = E ? E.shipmentById(state, id) : null;
      if (!ship) return s;
      s.found = true; s.kind = 'shipment';
      s.title = 'Shipment ' + ship.id;
      s.sub = (ship.carrier ? ship.carrier + ' · ' : '') + ship.door + ' · ' + ship.status;
      shipmentRelations(state, s, ship.id);
      return s;
    }

    if (place === 'order') {
      var o = find(allOrders(state), function (x) { return x.id === id; });
      if (!o) return s;
      s.found = true; s.kind = 'order';
      s.title = 'Order ' + o.id;
      s.sub = [o.customer, o.door, o.status].filter(Boolean).join(' · ');
      s.facts = [o.packed ? 'Packed' : null].filter(Boolean);
      orderRelations(state, s, o.id);
      return s;
    }

    if (place === 'load') {
      var l = find(arr(wms(state).loads), function (x) { return x.id === id; });
      if (!l) return s;
      s.found = true; s.kind = 'load';
      s.title = 'Load ' + l.id;
      s.sub = [l.trailer, l.door, l.status].filter(Boolean).join(' · ');
      add(s.loadIds, l.id);
      arr(l.orderIds).forEach(function (oid) { orderRelations(state, s, oid); });
      return s;
    }

    if (place === 'bin') {
      var b = E ? E.binById(state, id) : null;
      if (!b) return s;
      s.found = true; s.kind = 'bin';
      s.title = 'Bin ' + b.id;
      s.sub = 'Zone ' + b.zone + ' · ' + (b.contents.length ? b.contents.map(function (c) { return c.qty + ' × ' + shortDesc(c.desc); }).join(', ') : 'Empty');
      s.facts = [b.status === 'hold' ? 'On hold' : null].filter(Boolean);
      add(s.binIds, b.id);
      arr(state.tasks).forEach(function (t) {
        if (t.binId === b.id || t.toBinId === b.id || t.fromBinId === b.id) add(s.taskIds, t.id);
      });
      return s;
    }

    if (place === 'task') {
      var t = E ? E.taskById(state, id) : null;
      if (!t) return s;
      s.found = true; s.kind = 'task';
      s.title = t.title;
      s.sub = 'Zone ' + t.zone + ' · ' + t.status;
      add(s.taskIds, t.id);
      return s;
    }

    return s;
  }

  /* ---------- the events: the important moments --------------------- */

  /* The word for each kind of record. Decision kinds are a human's call. */
  var DECISION = { hold: 1, release: 1, ship: 1, reassign: 1, wave: 1, reallocate: 1, 'labor-move': 1 };

  function verbOf(r) {
    if (r.kind === 'complete') {
      if (r.shortPick) return 'Picked short';
      return { receive: 'Checked', putaway: 'Put away', pick: 'Picked', pack: 'Packed', load: 'Loaded', count: 'Counted',
        move: 'Moved', replen: 'Replenished', consolidate: 'Moved', breakdown: 'Broken down' }[r.type] || 'Done';
    }
    return { arrive: 'Arrived', schedule: 'Scheduled', hold: 'Held', release: 'Released', incident: 'Update', ship: 'Shipped',
      reassign: 'Reassigned', 'putaway-override': 'Put away elsewhere', 'move-requested': 'Move requested',
      order: 'Ordered', wave: 'Released to pick', reallocate: 'Re-allocated', 'count-queued': 'Count queued' }[r.kind] || 'Noted';
  }

  /* Records that carry no ids say the order's id in their words. */
  var TEXT_KINDS = ['order', 'wave', 'reallocate'];
  function namesId(text, id) {
    return new RegExp('(^|[^A-Za-z0-9-])' + String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^A-Za-z0-9-])').test(String(text || ''));
  }

  function recordAbout(s, r) {
    if (r.kind === 'osd-closed' || r.kind === 'flag-closed') return false; /* told from the finding / flag itself */
    if (has(s.taskIds, r.taskId)) return true;
    if (has(s.shipmentIds, r.shipmentId)) return true;
    if (has(s.loadIds, r.loadId)) return true;
    if (r.target && (has(s.binIds, r.target.binId) || has(s.stagingIds, r.target.stagingId))) return true;
    if (TEXT_KINDS.indexOf(r.kind) !== -1) return s.orderIds.some(function (id) { return namesId(r.text, id); });
    return false;
  }

  function flagsAbout(state, s) {
    return arr(wms(state).flags).filter(function (f) { return has(s.taskIds, f.taskId); });
  }

  function osdAbout(state, s) {
    return arr(wms(state).osd).filter(function (f) {
      if (!has(s.shipmentIds, f.shipmentId)) return false;
      return !s.descs || f.desc == null || has(s.descs, f.desc);
    });
  }

  /* An update the engine wrote for a flag is told once, as the flag. */
  function isFlagUpdate(flags, r) {
    if (r.kind !== 'incident') return false;
    return flags.some(function (f) {
      return f.taskId === r.taskId && f.by === r.by && String(r.text).slice(-(f.words.length + 2)) === ': ' + f.words;
    });
  }

  function events(state, s) {
    if (!s || !s.found) return [];
    var out = [];
    var flags = flagsAbout(state, s);
    arr(state.records).forEach(function (r, i) {
      if (!recordAbout(s, r) || isFlagUpdate(flags, r)) return;
      out.push({ ts: r.ts || null, verb: verbOf(r), text: r.text, by: r.by || null, decision: !!DECISION[r.kind], kind: r.kind || 'note', n: i });
    });
    osdAbout(state, s).forEach(function (f) {
      var what = f.type === 'photo' ? 'camera saw "' + f.label + '"' : f.type + ' of ' + f.qty + ' × ' + shortDesc(f.desc) + ' (expected ' + f.expected + ', received ' + f.received + ')';
      out.push({ ts: f.ts, verb: 'Flagged', text: f.id + ' — ' + what + (f.status === 'closed' ? '.' : '. Still open — a human closes it.'), by: f.by || null, kind: 'osd', ref: f.id });
      if (f.status === 'closed') out.push({ ts: f.closedAt, verb: 'Decided', text: f.id + ' closed' + (f.note ? ': ' + f.note : '.'), by: f.closedBy || null, decision: true, kind: 'osd-closed', ref: f.id });
    });
    /* Damaged stock is staged on hold by the receipt itself (no hold
       record is written for it), so the hold is told from the receipt
       and the pallet: who posted it, when, and the words on the hold. */
    arr(state.staging).forEach(function (p) {
      if (!has(s.stagingIds, p.id) || !p.damaged || !p.shipmentId) return;
      var rc = find(arr(wms(state).receipts), function (x) { return x.shipmentId === p.shipmentId; });
      if (!rc) return;
      out.push({ ts: rc.ts || null, verb: 'Held', text: 'Pallet ' + p.id + ' (' + p.qty + ' × ' + shortDesc(p.desc) + ') staged on hold at receipt' +
        (p.hold && p.hold.reason ? ' — ' + p.hold.reason : ' — damaged on receipt') + '.', by: rc.by || null, kind: 'receipt-hold', ref: rc.id });
    });
    flags.forEach(function (f) {
      out.push({ ts: f.ts, verb: 'Flagged', text: f.id + ' "' + f.label + '"', by: f.by || null, kind: 'flag', ref: f.id });
      if (f.status === 'closed') out.push({ ts: f.closedAt, verb: 'Decided', text: f.id + ' closed' + (f.note ? ': ' + f.note : '.'), by: f.closedBy || null, decision: true, kind: 'flag-closed', ref: f.id });
    });
    return sortByTime(out);
  }

  function sortByTime(list) {
    return list.map(function (x, i) { x._i = i; return x; }).sort(function (a, b) {
      var ta = a.ts ? Date.parse(a.ts) : NaN, tb = b.ts ? Date.parse(b.ts) : NaN;
      if (isNaN(ta) && isNaN(tb)) return a._i - b._i;
      if (isNaN(ta)) return -1;
      if (isNaN(tb)) return 1;
      return ta - tb || a._i - b._i;
    }).map(function (x) { delete x._i; return x; });
  }

  /* ---------- the transcript: every word, verbatim ------------------- */

  function said(text) { var m = / Said: "([\s\S]*)"$/.exec(String(text || '')); return m ? m[1] : null; }

  function transcript(state, s) {
    if (!s || !s.found) return [];
    var out = [];
    var flags = arr(wms(state).flags);
    /* Updates pinned to the item's tasks — a worker's report, a flag's
       exact words, a desk note. */
    arr(state.tasks).forEach(function (t) {
      if (!has(s.taskIds, t.id)) return;
      arr(t.notes).forEach(function (n) {
        var f = find(flags, function (x) { return x.taskId === t.id && x.words === n.text && x.by === n.by; });
        out.push({ ts: n.ts || null, by: n.by || null, words: n.text, source: f ? f.source || 'typed' : 'update', about: t.title, ref: f ? f.id : null });
      });
    });
    /* The receiver's count, as said at the dock. */
    arr(wms(state).receipts).forEach(function (rc) {
      if (!has(s.shipmentIds, rc.shipmentId) || !rc.transcript || !String(rc.transcript).trim()) return;
      out.push({ ts: rc.ts || null, by: rc.by || null, words: String(rc.transcript), source: rc.source || 'voice', about: 'Receiving ' + rc.shipmentId + ' (' + rc.id + ')' });
    });
    /* Words said with a count. */
    arr(wms(state).counts).forEach(function (c) {
      if (!c.words || !(has(s.taskIds, c.taskId) || has(s.binIds, c.binId))) return;
      out.push({ ts: c.ts || null, by: c.by || null, words: c.words, source: 'voice', about: 'Count of ' + c.binId });
    });
    /* Words said with a short pick (kept in the record line itself). */
    arr(state.records).forEach(function (r) {
      if (!r.shortPick || !has(s.taskIds, r.taskId)) return;
      var w = said(r.text);
      if (w) out.push({ ts: r.ts || null, by: r.by || null, words: w, source: 'voice', about: 'Short pick' });
    });
    return sortByTime(out);
  }

  function model(state, place, id) {
    var s = subject(state, place, id);
    var ev = events(state, s), tr = transcript(state, s);
    var voices = [];
    tr.forEach(function (x) { add(voices, x.by || '(not said who)'); });
    return { subject: s, events: ev, transcript: tr, voices: voices };
  }

  /* ---------- rendering --------------------------------------------- */

  function time(ts) {
    if (!ts) return 'Time not recorded';
    var d = new Date(ts);
    return isNaN(d) ? 'Time not recorded' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function day(ts) {
    var d = ts ? new Date(ts) : null;
    return d && !isNaN(d) ? d.toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
  }

  /* The human's act: named, never the machine's. */
  function actor(state, by, decision) {
    var n = who(state, by);
    if (!n) return '<span class="wp-who none">Not said who</span>';
    return '<span class="wp-who' + (decision ? ' decided' : '') + '">' + (decision ? 'Decided by ' : '') + '<b>' + esc(n) + '</b></span>';
  }

  var SOURCE = { voice: 'Spoken', typed: 'Typed', update: 'Update', 'voice, corrected': 'Spoken, then corrected' };

  function eventsHtml(state, list) {
    if (!list.length) return '<p class="wp-empty">Nothing on the record yet. No event is shown until one happens.</p>';
    return '<ol class="wp-events">' + list.map(function (e) {
      return '<li class="wp-ev wp-ev-' + esc(String(e.verb).toLowerCase().replace(/[^a-z]+/g, '-')) + (e.decision ? ' decision' : '') + '">' +
        '<time datetime="' + esc(e.ts || '') + '">' + esc(time(e.ts)) + ' <small>' + esc(day(e.ts)) + '</small></time>' +
        '<div><b class="wp-verb">' + esc(e.verb) + '</b> <span class="wp-text">' + esc(e.text) + '</span><br>' + actor(state, e.by, e.decision) + '</div></li>';
    }).join('') + '</ol>';
  }

  function transcriptHtml(state, list) {
    if (!list.length) return '<p class="wp-empty">Not said. No one has spoken or typed about this item on the record.</p>';
    return '<ol class="wp-transcript">' + list.map(function (x) {
      var n = who(state, x.by);
      return '<li class="wp-line">' +
        '<div class="wp-line-h"><b>' + esc(n || 'Not said who') + '</b> <span class="wp-src">' + esc(SOURCE[x.source] || x.source) + '</span>' +
        '<time datetime="' + esc(x.ts || '') + '">' + esc(time(x.ts)) + '</time></div>' +
        '<blockquote>' + esc(x.words) + '</blockquote>' +
        (x.about ? '<div class="wp-about">' + esc(x.about) + (x.ref ? ' · ' + esc(x.ref) : '') + '</div>' : '') + '</li>';
    }).join('') + '</ol>';
  }

  function html(state, place, id) {
    var m = model(state, place, id);
    var s = m.subject;
    var out = '<div class="wp-page" data-witness="' + esc(place) + '" data-id="' + esc(id) + '">';
    out += '<a class="wp-back" href="#/dashboard">← Warehouse map</a>';
    if (!s.found) {
      return out + '<div class="wp-missing"><h2>' + esc(id) + '</h2><p>This ' + esc(place) + ' is not in the desk record now. ' +
        'It may have moved on (a pallet put away, a load shipped). Nothing is shown in its place.</p></div></div>';
    }
    out += '<header class="wp-head"><div class="wp-kind">Witness page · ' + esc(s.kind) + (s.via ? ' at ' + esc(s.via) : '') + '</div>' +
      '<h1>' + esc(s.title) + '</h1><p class="wp-sub">' + esc(s.sub) + '</p>' +
      (s.facts.length ? '<div class="wp-facts">' + s.facts.map(function (f) { return '<span class="wp-fact">' + esc(f) + '</span>'; }).join('') + '</div>' : '') +
      '</header>';
    /* The agent's chair: reserved for the next build, drawn empty. */
    out += '<section class="wp-agent" data-slot="agent" aria-label="The agent (coming next)">' +
      '<div class="wp-agent-h">The agent <span class="wp-soon">Coming next</span></div>' +
      '<p>Ask and tell this item\'s Witness here, by typing or speaking, with this record as its context. This chair is kept for it.</p></section>';
    out += '<div class="wp-panels">' +
      '<section class="wp-panel" data-panel="events"><div class="wp-panel-h"><h2>The events</h2><span>' + m.events.length + ' on the record · oldest first</span></div>' + eventsHtml(state, m.events) + '</section>' +
      '<section class="wp-panel" data-panel="transcript"><div class="wp-panel-h"><h2>The full transcript</h2><span>' +
        (m.transcript.length ? m.transcript.length + ' entr' + (m.transcript.length === 1 ? 'y' : 'ies') + ' · ' + m.voices.length + ' voice' + (m.voices.length === 1 ? '' : 's') : 'Verbatim') +
      '</span></div>' + transcriptHtml(state, m.transcript) + '</section>' +
      '</div></div>';
    return out;
  }

  var api = { subject: subject, events: events, transcript: transcript, model: model, html: html, href: href, parseRoute: parseRoute, PLACES: PLACES };
  root.WitnessWmsWitness = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
