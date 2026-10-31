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

  var state = E.loadState();
  if (!state) {
    state = E.seedWorld();
    E.generateTasks(state);
    E.saveState(state);
  } else {
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
    var next = state.tasks.filter(function (t) {
      return t.status === 'open' && t.zone === unit.zone;
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
    E.nextTaskFor(state, unit);
    persist();
    render();
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
  }

  $('roleWorker').addEventListener('click', function () { role = 'worker'; render(); });
  $('roleManager').addEventListener('click', function () { role = 'manager'; render(); });
  $('nextBtn').addEventListener('click', onNext);
  $('resetBtn').addEventListener('click', function () {
    state = E.resetState();
    var first = null;
    state.labor.forEach(function (u) { if (!first && u.role === 'worker') first = u; });
    selectedUnitId = first ? first.id : null;
    render();
  });

  render();
})();
