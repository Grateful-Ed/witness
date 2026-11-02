/* bol-page.js — the page wiring for bol.html. All the read, match and
   save logic lives in js/bol.js (pure, reusable); this file only moves
   things on and off the screen.

   Order on the page, by rule: the photo is shown first; nothing is
   sent until the user taps "Read this BOL" on the photo they can see. */
(function () {
  'use strict';

  var B = window.WitnessBol;
  var L = window.WitnessBolLoads;
  function $(id) { return document.getElementById(id); }

  var load = L.loads[0];   /* picked test load */
  var dataUrl = null;      /* the downscaled photo, exactly as shown */
  var bol = null, match = null;
  var busy = false;
  var savedFor = null;     /* the read last saved, so a double tap doesn't save twice */

  function setStatus(id, text, mode) {
    var s = $(id);
    s.textContent = text || '';
    s.className = 'status' + (mode ? ' ' + mode : '');
  }
  function showError(msg) {
    var e = $('error');
    if (!msg) { e.hidden = true; e.textContent = ''; return; }
    e.textContent = msg;
    e.hidden = false;
  }

  /* ---------- load pick ---------- */
  function renderLoads() {
    var box = $('loadChips');
    box.textContent = '';
    L.loads.forEach(function (l) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'namechip' + (l === load ? ' selected' : '');
      b.setAttribute('aria-pressed', l === load ? 'true' : 'false');
      b.textContent = l.label;
      b.addEventListener('click', function () {
        load = l;
        renderLoads();
        if (bol) renderMatch();
      });
      box.appendChild(b);
    });
  }

  /* ---------- capture → downscale → show ---------- */
  function takeFile(file) {
    if (!file) return;
    showError('');
    setStatus('status', 'Preparing the photo…', 'busy');
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var size = B.fitWithin(img.naturalWidth, img.naturalHeight, B.SEND_MAX);
      var c = document.createElement('canvas');
      c.width = size.w; c.height = size.h;
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, size.w, size.h);
      ctx.drawImage(img, 0, 0, size.w, size.h);
      URL.revokeObjectURL(url);
      dataUrl = c.toDataURL('image/jpeg', B.SEND_QUALITY);
      $('preview').src = dataUrl;
      $('previewNote').textContent = 'This is the photo that will be sent (' + size.w + ' × ' + size.h + '). Not right? Take another.';
      $('previewBox').hidden = false;
      $('readBtn').hidden = false;
      $('readBtn').disabled = false;
      setStatus('status', 'Check the photo, then tap "Read this BOL".');
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      setStatus('status', '');
      showError('That file could not be opened as an image. Try another photo.');
    };
    img.src = url;
  }

  $('camInput').addEventListener('change', function (e) { takeFile(e.target.files[0]); e.target.value = ''; });
  $('fileInput').addEventListener('change', function (e) { takeFile(e.target.files[0]); e.target.value = ''; });

  /* ---------- read ---------- */
  $('readBtn').addEventListener('click', function () {
    if (busy || !dataUrl) return;
    busy = true;
    $('readBtn').disabled = true;
    showError('');
    setStatus('status', 'Reading the bill of lading…', 'busy');
    B.readBol(window.fetch.bind(window), dataUrl).then(function (res) {
      bol = res.bol;
      savedFor = null;
      setStatus('status', 'Read.' + (res.attempts > 1 ? ' (It took a second try.)' : ''), 'done');
      renderSays();
      renderMatch();
    }, function (err) {
      setStatus('status', '');
      showError(err.userMessage || 'No read — something went wrong. Your photo is still on screen.');
    }).then(function () {
      busy = false;
      $('readBtn').disabled = false;
    });
  });

  /* ---------- render ---------- */
  function li(text, tag, tagText) {
    var item = document.createElement('li');
    if (tag) {
      var t = document.createElement('span');
      t.className = 'tag ' + tag;
      t.textContent = tagText;
      item.appendChild(t);
    }
    var body = document.createElement('span');
    body.textContent = text;
    if (/not read/.test(text) && !tag) body.className = 'notread';
    item.appendChild(body);
    return item;
  }

  function renderSays() {
    var list = $('saysList');
    list.textContent = '';
    B.bolLines(bol).forEach(function (line) { list.appendChild(li(line)); });
    $('saysBox').hidden = false;
  }

  var TAGS = { agree: 'Agree', short: 'Short', over: 'Over', differ: 'Differs', 'not-read': 'Not read', 'not-on-bol': 'Not on BOL', extra: 'Extra' };

  function renderMatch() {
    match = B.matchBol(bol, load);
    $('matchAgainst').textContent = 'Compared with: ' + match.against + '.';
    $('matchSummary').textContent = match.summary;
    var counts = $('countList');
    counts.textContent = '';
    match.counts.concat([match.total]).forEach(function (r) { counts.appendChild(li(r.line, r.result, TAGS[r.result])); });
    match.extra.forEach(function (x) { counts.appendChild(li(x.line, 'extra', TAGS.extra)); });
    var ids = $('idList');
    ids.textContent = '';
    match.identity.forEach(function (r) { ids.appendChild(li(r.line, r.result, TAGS[r.result])); });
    $('matchBox').hidden = false;
    $('saveBtn').disabled = false;
    setStatus('saveStatus', '');
  }

  /* ---------- save ---------- */
  $('saveBtn').addEventListener('click', function () {
    if (!bol || !match) return;
    if (savedFor === bol) { setStatus('saveStatus', 'Already saved.', 'done'); return; }
    $('saveBtn').disabled = true;
    setStatus('saveStatus', 'Saving…', 'busy');
    var forRead = bol;
    B.saveBol(window.fetch.bind(window), B.buildSaveBody(load, bol, match)).then(function (j) {
      savedFor = forRead;
      setStatus('saveStatus', 'Saved with ' + load.label + '\'s record' + (j && j.key ? ' (' + j.key + ')' : '') + '. The photo itself was not stored.', 'done');
    }, function (err) {
      setStatus('saveStatus', err.userMessage || 'Not saved.', '');
      $('saveBtn').disabled = false;
    });
  });

  renderLoads();
})();
