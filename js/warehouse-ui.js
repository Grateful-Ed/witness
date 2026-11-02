/* =====================================================================
   warehouse-ui.js — the Warehouse page: role pick, the worker's
   task card, the manager's building view. All state moves go
   through engine.js; this file only renders and forwards taps.
   State persists in localStorage (engine's key) so a refresh
   mid-shift loses nothing.
   ===================================================================== */
(function () {
  'use strict';

  var E = window.WitnessEngine;
  var C = window.WitnessConverse; /* the conversational layer */

  /* Which world this page runs (js/world-select.js): a state saved
     by the other world is not used — the page reseeds and says so. */
  var W = window.WitnessWorlds;
  var state = E.loadState();
  if (W) {
    var ws = W.checkWorld(state, W.current);
    state = ws.state;
    if (ws.notice) W.announce(ws.notice);
  }
  if (!state) {
    state = E.seedWorld();
    E.generateTasks(state);
    E.saveState(state);
  } else {
    E.upgradeState(state);  /* saves from before bills of lading / outbound doors */
    E.generateTasks(state); /* pick up anything newly derivable */
    E.saveState(state);
  }

  var role = 'worker';
  var selectedUnitId = null;
  state.labor.forEach(function (u) {
    if (!selectedUnitId && u.role === 'worker') selectedUnitId = u.id;
  });

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function persist() { E.saveState(state); }
  /* After anything changes: derive the work it made possible, then save. */
  function commit() { E.generateTasks(state); persist(); }
  function managerId() {
    var m = null;
    state.labor.forEach(function (u) { if (!m && u.role === 'manager') m = u.id; });
    return m;
  }

  /* ---------- role pick ------------------------------------------- */

  function renderRole() {
    $('roleWorker').classList.toggle('selected', role === 'worker');
    $('roleManager').classList.toggle('selected', role === 'manager');
    $('workerView').hidden = role !== 'worker';
    $('managerView').hidden = role !== 'manager';
  }

  /* ---------- worker view ------------------------------------------ */

  function selectedUnit() { return E.unitById(state, selectedUnitId); }

  function renderNames() {
    var html = '';
    state.labor.forEach(function (u) {
      if (u.role !== 'worker') return;
      html += '<button type="button" class="namechip' +
        (u.id === selectedUnitId ? ' selected' : '') +
        '" data-unit="' + u.id + '">' + esc(u.name) +
        ' <span class="zone-tag">Zone ' + esc(u.zone) + '</span></button>';
    });
    $('nameChips').innerHTML = html;
    var chips = $('nameChips').querySelectorAll('.namechip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener('click', function () {
        selectedUnitId = this.getAttribute('data-unit');
        clearWorkerTalk();
        render();
      });
    }
  }

  function currentTaskOf(unit) {
    if (!unit || !unit.currentTaskId) return null;
    var t = E.taskById(state, unit.currentTaskId);
    return t && t.status === 'assigned' ? t : null;
  }

  function renderTaskCard() {
    var unit = selectedUnit();
    var box = $('taskCard');
    var btn = $('nextBtn');
    if (!unit) { box.innerHTML = '<p class="note">Pick your name above.</p>'; return; }
    var task = currentTaskOf(unit);
    if (!task) {
      var open = state.tasks.filter(function (t) { return t.status === 'open'; }).length;
      box.innerHTML = '<p class="task-none">Nothing in hand, ' + esc(unit.name.split(' ')[0]) + '.' +
        (open ? ' There is work waiting — ask for it.' : ' The building is caught up.') + '</p>';
      btn.textContent = "What's next?";
      btn.disabled = open === 0;
      return;
    }
    var html = '<div class="taskcard">' +
      '<p class="task-type">' + esc(task.type) + ' · Zone ' + esc(task.zone || '—') + '</p>' +
      '<p class="task-title">' + esc(task.title) + '</p>' +
      '<p class="task-detail">' + esc(task.detail) + '</p>';
    var held = E.blockedBy(state, task);
    if (held) html += '<p class="task-note">On hold: ' + esc(held) + ' Leave it be — ask your manager.</p>';
    (task.notes || []).forEach(function (n) {
      html += '<p class="task-note">Problem noted: “' + esc(n.text) + '”</p>';
    });
    if (task.type === 'receive' && task.link) {
      html += '<a class="crosscheck-btn" href="' + esc(task.link) + '">Open the cross-check</a>' +
        '<p class="note">Run the receiving cross-check there first — then come back and mark this done.</p>';
    }
    html += '</div>';
    box.innerHTML = html;
    btn.textContent = "Done — what's next?";
    btn.disabled = false;
  }

  function renderUpNext() {
    var unit = selectedUnit();
    var box = $('upNext');
    if (!unit) { box.innerHTML = ''; return; }
    var holds = E.currentHolds(state).filter(function (h) { return h.zone === unit.zone; });
    $('workerHolds').innerHTML = holds.length
      ? '<p class="heard-label">On hold in zone ' + esc(unit.zone) + ' — don\'t touch</p>' +
        holds.map(function (h) {
          return '<div class="upnext-row hold-row">' + esc(h.label) + (h.reason ? ' — ' + esc(h.reason) : '') + '</div>';
        }).join('')
      : '';
    var next = state.tasks.filter(function (t) {
      return t.status === 'open' && t.zone === unit.zone && !E.blockedBy(state, t);
    }).slice(0, 3);
    if (!next.length) {
      box.innerHTML = '<p class="note">Nothing else waiting in zone ' + esc(unit.zone) + ' right now.</p>';
      return;
    }
    var html = '';
    next.forEach(function (t) {
      html += '<div class="upnext-row"><span class="task-type">' + esc(t.type) + '</span> ' +
        esc(t.title) + '</div>';
    });
    box.innerHTML = html;
  }

  function onNext() {
    var unit = selectedUnit();
    if (!unit) return;
    var current = currentTaskOf(unit);
    if (current) {
      E.completeTask(state, current.id);
    }
    E.generateTasks(state);
    E.nextTaskFor(state, unit);
    commit();
    render();
  }

  /* ---------- worker voice: "done — what's next?" ------------------- */
  /* The transcript is shown first, then what was done with it. The
     intent is matched locally (converse.js) — no model decides what a
     worker meant, and an unrecognised sentence does nothing. */

  function clearWorkerTalk() {
    $('workerHeard').hidden = true;
    $('workerTalkError').hidden = true;
    $('workerTalkStatus').textContent = '';
  }

  function talkButton(btnId, labelId, mode, idleText) {
    var btn = $(btnId);
    btn.classList.toggle('recording', mode === 'listening');
    btn.setAttribute('aria-pressed', mode === 'listening' ? 'true' : 'false');
    $(labelId).textContent = mode === 'listening' ? 'Listening… let go to send' :
      mode === 'sending' ? 'Working…' : idleText;
  }

  function onWorkerHeard(text) {
    var unit = selectedUnit();
    var match = C.matchIntent(text);
    var turn = C.workerTurn(E, state, unit, match);
    if (turn.acted) commit();
    showWorkerTurn('“' + text + '”', turn);
  }

  function showWorkerTurn(heardText, turn) {
    $('workerHeardText').textContent = heardText;
    var html = '';
    turn.lines.forEach(function (l) { html += '<p class="reply-line">' + esc(l) + '</p>'; });
    $('workerReply').innerHTML = html;
    $('workerHeard').hidden = false;
    $('workerTalkStatus').textContent = '';
    render();
  }

  if (window.WitnessMic) {
    window.WitnessMic.attach($('workerTalk'), {
      onListening: function () {
        clearWorkerTalk();
        talkButton('workerTalk', 'workerTalkLabel', 'listening', 'Hold to talk');
        $('workerTalkStatus').textContent = 'Listening.';
      },
      onSending: function () {
        talkButton('workerTalk', 'workerTalkLabel', 'sending', 'Hold to talk');
        $('workerTalkStatus').textContent = 'Getting your words…';
      },
      onText: function (text) {
        talkButton('workerTalk', 'workerTalkLabel', 'idle', 'Hold to talk');
        onWorkerHeard(text);
      },
      onError: function (msg) {
        talkButton('workerTalk', 'workerTalkLabel', 'idle', 'Hold to talk');
        $('workerTalkStatus').textContent = '';
        $('workerTalkError').textContent = msg;
        $('workerTalkError').hidden = false;
      },
      onIdle: function () {
        talkButton('workerTalk', 'workerTalkLabel', 'idle', 'Hold to talk');
        $('workerTalkStatus').textContent = '';
      }
    });
  }

  /* ---------- manager view ------------------------------------------ */

  function renderDoors() {
    var html = '';
    state.doors.forEach(function (d) {
      html += '<span class="doorchip"><strong>' + esc(d.id) + '</strong> · ' +
        esc(d.state) + ' · Zone ' + esc(d.zone) + '</span>';
    });
    $('doorsRow').innerHTML = html;
  }

  function renderZones() {
    var stats = E.zoneStats(state);
    var html = '';
    state.zones.forEach(function (z) {
      var s = stats[z];
      html += '<div class="zonecard">' +
        '<p class="zone-head">Zone ' + esc(z) + '</p>' +
        '<p class="zone-line">Bins in use: <strong>' + s.binsOccupied + ' / 8</strong></p>' +
        '<p class="zone-line">Tasks waiting: <strong>' + s.pending + '</strong></p>' +
        '<p class="zone-line">Labor units here: <strong>' + s.workersPresent + '</strong></p>' +
        '<p class="zone-line">Done this session: <strong>' + s.done + '</strong></p>' +
        '</div>';
    });
    $('zoneCards').innerHTML = html;
  }

  function renderBottleneck() {
    var b = E.bottleneck(state);
    if (!b) {
      $('bottleneckText').textContent =
        'No bottleneck right now — the waiting work is spread evenly enough across the zones.';
      return;
    }
    $('bottleneckText').textContent =
      'Zone ' + b.zone + ' is backing up: ' + b.pending + ' tasks waiting, ' +
      b.workers + ' labor units there. Pull ' + b.suggestion.unitName +
      ' from Zone ' + b.suggestion.fromZone + ' — Zone ' + b.suggestion.fromZone +
      ' has ' + b.suggestion.fromPending + ' waiting with ' + b.suggestion.fromWorkers +
      ' units. The machine proposes; you decide.';
  }

  function renderLabor() {
    var html = '';
    state.labor.forEach(function (u) {
      var now = 'idle';
      if (u.currentTaskId) {
        var t = E.taskById(state, u.currentTaskId);
        if (t) now = t.title;
      }
      html += '<div class="labor-row"><strong>' + esc(u.name) + '</strong>' +
        ' <span class="zone-tag">' + esc(u.role) + ' · Zone ' + esc(u.zone) + '</span>' +
        '<br><span class="labor-now">' + esc(now) + '</span></div>';
    });
    $('laborList').innerHTML = html;
  }

  function renderRecords() {
    var box = $('recordsList');
    if (!state.records.length) {
      box.innerHTML = '<p class="note">Nothing yet this session. Completed work lands here.</p>';
      return;
    }
    var html = '';
    state.records.slice(-12).reverse().forEach(function (r) {
      html += '<div class="record-row">' + esc(r.text) + '</div>';
    });
    box.innerHTML = html;
  }

  /* ---------- worker: typed problem (the button for what voice does) --- */

  $('problemBtn').addEventListener('click', function () {
    var text = $('problemInput').value.trim();
    if (!text) return;
    var unit = selectedUnit();
    var turn = C.workerTurn(E, state, unit, { intent: 'problem', heard: text });
    if (turn.acted) commit();
    $('problemInput').value = '';
    $('workerTalkError').hidden = true;
    showWorkerTurn('“' + text + '” (typed)', turn);
  });

  /* ---------- manager: inbound, outbound, holds, updates, summary ----- */

  function stageChip(key) { return '<span class="stage-chip stage-' + esc(key) + '">' + esc(key) + '</span>'; }

  function renderInbound() {
    var html = '';
    state.inbound.forEach(function (s) {
      var st = E.inboundStage(state, s);
      html += '<div class="labor-row"><strong>' + esc(s.id) + '</strong> ' + stageChip(st.key) +
        '<br><span class="labor-now">' + esc(s.desc) + ' — ' + s.pallets + ' pallets</span>' +
        '<br>' + esc(st.words) +
        (st.key === 'expected' ? '<br><button type="button" class="mini-btn" data-arrive="' + esc(s.id) + '">Truck\'s here</button>' : '') +
        '</div>';
    });
    $('inboundList').innerHTML = html;
    var btns = $('inboundList').querySelectorAll('[data-arrive]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var r = E.arriveShipment(state, this.getAttribute('data-arrive'), managerId());
        $('inboundMsg').hidden = r.ok;
        $('inboundMsg').textContent = r.ok ? '' : r.reason;
        if (r.ok) commit();
        render();
      });
    }
  }

  function renderOrders() {
    var html = '';
    state.outbound.forEach(function (o) {
      var st = E.orderStage(state, o);
      html += '<div class="labor-row"><strong>' + esc(o.id) + '</strong> ' + stageChip(st.key) +
        '<br>' + esc(st.words) +
        '<br><span class="labor-now">' + o.lines.map(function (l) {
          return esc(l.qty + ' × ' + l.desc) + (l.done ? ' — picked' : l.allocated ? ' — from ' + esc(l.binId) +
            ((E.binById(state, l.binId) || {}).status === 'hold' ? ' (bin on hold — waits)' : '') : ' — short');
        }).join('<br>') + '</span></div>';
    });
    $('ordersList').innerHTML = html;
  }

  function renderHolds() {
    var holds = E.currentHolds(state);
    var html = holds.length ? '' : '<p class="note">Nothing on hold.</p>';
    holds.forEach(function (h, i) {
      html += '<div class="labor-row hold-row"><strong>' + esc(h.label) + '</strong>' +
        (h.reason ? ' — ' + esc(h.reason) : '') +
        '<br><span class="labor-now">' + (h.by ? 'By ' + esc(h.by) : 'Held from the start of the day') + '</span>' +
        '<br><button type="button" class="mini-btn" data-release="' + i + '">Release</button></div>';
    });
    $('holdsList').innerHTML = html;
    var btns = $('holdsList').querySelectorAll('[data-release]');
    for (var j = 0; j < btns.length; j++) {
      btns[j].addEventListener('click', function () {
        var h = holds[Number(this.getAttribute('data-release'))];
        var r = E.releaseHold(state, h.target, managerId());
        $('holdMsg').textContent = r.ok ? h.label + ' released.' : r.reason;
        if (r.ok) commit();
        render();
      });
    }
    var opts = '';
    state.bins.forEach(function (b) {
      if (b.status !== 'hold') opts += '<option value="bin:' + esc(b.id) + '">Bin ' + esc(b.id) + ' (Zone ' + esc(b.zone) + ')</option>';
    });
    state.staging.forEach(function (p) {
      if (!p.hold) opts += '<option value="stg:' + esc(p.id) + '">Pallet ' + esc(p.id) + ' — ' + esc(p.qty + ' × ' + p.desc) + ' at ' + esc(p.door) + '</option>';
    });
    var keep = $('holdTarget').value;
    $('holdTarget').innerHTML = opts;
    if (keep) $('holdTarget').value = keep;
  }

  $('holdBtn').addEventListener('click', function () {
    var v = $('holdTarget').value;
    if (!v) return;
    var target = v.indexOf('bin:') === 0 ? { binId: v.slice(4) } : { stagingId: v.slice(4) };
    var r = E.placeHold(state, target, managerId(), $('holdReason').value);
    $('holdMsg').textContent = r.ok
      ? 'On hold.' + (r.freed.length ? ' Back to the queue from ' + r.freed.join(', ') + '.' : '')
      : r.reason;
    if (r.ok) { $('holdReason').value = ''; commit(); }
    render();
  });

  function renderUpdateTasks() {
    var keep = $('updateTask').value;
    var live = state.tasks.filter(function (t) { return t.status !== 'done'; });
    var done = state.tasks.filter(function (t) { return t.status === 'done'; }).reverse();
    var opts = '';
    live.forEach(function (t) { opts += '<option value="' + esc(t.id) + '">' + esc(t.title) + '</option>'; });
    if (done.length) {
      opts += '<optgroup label="Done — still open to updates">';
      done.forEach(function (t) { opts += '<option value="' + esc(t.id) + '">' + esc(t.title) + '</option>'; });
      opts += '</optgroup>';
    }
    $('updateTask').innerHTML = opts;
    if (keep && E.taskById(state, keep)) $('updateTask').value = keep;
  }

  $('updateBtn').addEventListener('click', function () {
    var r = E.addTaskUpdate(state, $('updateTask').value, $('updateText').value, managerId());
    $('updateMsg').textContent = r ? 'Update added to the task and the records.' : 'Pick a task and say what happened.';
    if (r) { $('updateText').value = ''; commit(); }
    render();
  });

  function countLine(obj) {
    var keys = Object.keys(obj).sort();
    return keys.length ? keys.map(function (k) { return esc(k) + ' ' + obj[k]; }).join(' · ') : 'none yet';
  }

  function renderShift() {
    var x = E.shiftSummary(state);
    var b = x.bottleneck;
    var html = '<p class="zone-line">Tasks done: <strong>' + x.tasksDone + '</strong></p>' +
      '<p class="zone-line">By type: <strong>' + countLine(x.doneByType) + '</strong></p>' +
      '<p class="zone-line">By zone: <strong>' + countLine(x.doneByZone) + '</strong></p>' +
      '<p class="heard-label">Labor units</p>' +
      x.perUnit.map(function (p) { return '<p class="zone-line">' + esc(p.name) + ': <strong>' + p.done + '</strong></p>'; }).join('') +
      '<p class="heard-label">Bottleneck now</p><p class="zone-line">' + (b
        ? 'Zone ' + esc(b.zone) + ' — ' + b.pending + ' waiting, ' + b.workers + ' units. Proposed: ' + esc(b.suggestion.unitName) +
          ' from Zone ' + esc(b.suggestion.fromZone) + '.'
        : 'None.') + '</p>' +
      '<p class="heard-label">Shipments received: ' + x.shipmentsReceived.length + '</p>' +
      x.shipmentsReceived.map(function (r) { return '<p class="zone-line">' + esc(r.id) + ' — ' + r.pallets + ' pallets, ' + esc(r.door) + '</p>'; }).join('') +
      '<p class="heard-label">Orders shipped: ' + x.ordersShipped.length + '</p>' +
      x.ordersShipped.map(function (o) { return '<p class="zone-line">' + esc(o.id) + ' — ' + o.qty + ' loaded, ' + esc(o.door) + '</p>'; }).join('') +
      '<p class="heard-label">Incidents: ' + x.incidents.length + '</p>' +
      x.incidents.slice().reverse().map(function (r) { return '<p class="zone-line">' + esc(r.text) + '</p>'; }).join('') +
      '<p class="heard-label">Holds now: ' + x.holdsNow.length + ' · hold/release events: ' + x.holdEvents.length + '</p>';
    $('shiftSummary').innerHTML = html;
  }

  /* ---------- manager: ask the building ------------------------------ */
  /* The question and the live numbers go to Muse Spark through the
     Worker's /chat. The answer is shown with the numbers behind it,
     and a check of which numbers in it are — and aren't — in the
     data. A spoken question only fills the box; the manager reads it
     and taps Ask. */

  var asking = false;

  function clearAnswer() {
    $('askAnswer').hidden = true;
    $('askError').hidden = true;
    $('askStatus').textContent = '';
  }

  function renderAskZones(facts) {
    var html = '<table class="ask-table"><thead><tr><th>Zone</th><th>Waiting</th><th>Units</th>' +
      '<th>Per unit</th><th>Coming</th></tr></thead><tbody>';
    facts.zones.forEach(function (z) {
      var flag = facts.bottleneck && facts.bottleneck.zone === z.zone;
      html += '<tr' + (flag ? ' class="hot"' : '') + '><td>' + esc(z.zone) + (flag ? ' ⚠' : '') + '</td><td>' + z.waiting +
        '</td><td>' + z.workers + '</td><td>' + esc(z.loadPerWorker) + '</td><td>' + z.incomingPallets + ' pallets</td></tr>';
    });
    html += '</tbody></table>';
    var b = facts.bottleneck;
    html += '<p class="ask-engine">Engine check: ' + (b
      ? 'Zone ' + esc(b.zone) + ' backing up — ' + b.pending + ' waiting, ' + b.workers + ' units. Engine would move ' +
        esc(b.suggestion.unitName) + ' from Zone ' + esc(b.suggestion.fromZone) + '.'
      : 'no zone meets the backing-up rule right now.') + '</p>';
    return html;
  }

  function checkLine(check) {
    if (!check.found.length && !check.missing.length) return 'This answer quotes no numbers. Check the table above.';
    if (!check.missing.length) {
      return 'Numbers check: every number in this answer (' + check.found.join(', ') +
        ') appears in the building\'s data. Check each one is the right one in the table.';
    }
    return 'Not in the data: ' + check.missing.join(', ') + '. May be the AI\'s own math — check before you act.';
  }

  function ask() {
    if (asking) return;
    var q = $('askInput').value.trim();
    clearAnswer();
    if (!q) { $('askError').textContent = 'Type or say a question first.'; $('askError').hidden = false; return; }
    asking = true;
    $('askBtn').disabled = true;
    $('askStatus').textContent = 'Asking… this can take up to a minute.';
    $('askStatus').className = 'status wh-status busy';
    C.askManager({ engine: E, state: state, question: q, fetch: window.fetch.bind(window) }).then(function (res) {
      $('askAsked').textContent = q;
      var lines = res.answer.split(/\n+/).filter(function (l) { return l.trim(); });
      $('askText').innerHTML = lines.map(function (l) { return '<p class="reply-line">' + esc(l.trim()) + '</p>'; }).join('');
      $('askZones').innerHTML = renderAskZones(res.summary.facts);
      $('askCheck').textContent = checkLine(res.check);
      $('askCheck').className = 'ask-check' + (res.check.missing.length ? ' warn' : '');
      $('askEvidence').textContent = res.summary.text;
      $('askAnswer').hidden = false;
      var now = new Date();
      $('askStatus').textContent = 'Answered at ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
        ' from the numbers at that moment.' + (res.attempts > 1 ? ' (Took a second try.)' : '');
      $('askStatus').className = 'status wh-status done';
    }).catch(function (e) {
      $('askStatus').textContent = '';
      $('askStatus').className = 'status wh-status';
      $('askError').textContent = (e && e.userMessage) || 'No answer — something went wrong. Nothing was guessed.';
      $('askError').hidden = false;
    }).then(function () {
      asking = false;
      $('askBtn').disabled = false;
    });
  }

  $('askBtn').addEventListener('click', ask);
  $('exampleQ').addEventListener('click', function () {
    $('askInput').value = this.textContent;
    $('askInput').focus();
  });

  if (window.WitnessMic) {
    window.WitnessMic.attach($('managerTalk'), {
      onListening: function () {
        talkButton('managerTalk', 'managerTalkLabel', 'listening', 'Hold to say it');
        $('askError').hidden = true;
        $('askStatus').textContent = 'Listening.';
        $('askStatus').className = 'status wh-status busy';
      },
      onSending: function () {
        talkButton('managerTalk', 'managerTalkLabel', 'sending', 'Hold to say it');
        $('askStatus').textContent = 'Getting your words…';
      },
      onText: function (text) {
        talkButton('managerTalk', 'managerTalkLabel', 'idle', 'Hold to say it');
        $('askInput').value = text;
        $('askStatus').textContent = 'Check your question, then tap Ask.';
        $('askStatus').className = 'status wh-status';
      },
      onError: function (msg) {
        talkButton('managerTalk', 'managerTalkLabel', 'idle', 'Hold to say it');
        $('askStatus').textContent = '';
        $('askError').textContent = msg;
        $('askError').hidden = false;
      },
      onIdle: function () {
        talkButton('managerTalk', 'managerTalkLabel', 'idle', 'Hold to say it');
        $('askStatus').textContent = '';
      }
    });
  }

  /* ---------- wire-up ------------------------------------------------ */

  function render() {
    renderRole();
    renderNames();
    renderTaskCard();
    renderUpNext();
    renderDoors();
    renderZones();
    renderBottleneck();
    renderLabor();
    renderRecords();
    renderInbound();
    renderOrders();
    renderHolds();
    renderUpdateTasks();
    renderShift();
  }

  $('roleWorker').addEventListener('click', function () { role = 'worker'; render(); });
  $('roleManager').addEventListener('click', function () { role = 'manager'; render(); });
  $('nextBtn').addEventListener('click', onNext);
  $('resetBtn').addEventListener('click', function () {
    state = E.resetState();
    var first = null;
    state.labor.forEach(function (u) { if (!first && u.role === 'worker') first = u; });
    selectedUnitId = first ? first.id : null;
    clearWorkerTalk();
    clearAnswer();
    $('holdMsg').textContent = '';
    $('updateMsg').textContent = '';
    $('inboundMsg').hidden = true;
    render();
  });

  render();
})();
