/* summon-page.js — the "Scan a BOL" panel on warehouse.html. The read
   is js/bol.js (as the BOL page uses it), the lookup is js/summon.js.
   This file only moves things on and off the screen.

   Rules kept here:
   - The photo is shown first; nothing is sent until "Find this BOL".
   - Fresh state before the lookup (re-read from the store, not the
     page's copy). The lookup is read-only: this file never saves.
   - Warehouse world only. In the kitchen the panel stays hidden — the
     kitchen's scan creates, and it lives in the glasses view. */
(function () {
  'use strict';

  var B = window.WitnessBol;
  var S = window.WitnessSummon;
  var E = window.WitnessEngine;
  var W = window.WitnessWorlds;
  function $(id) { return document.getElementById(id); }

  var box = $('summonBox');
  if (!box || !B || !S || !E) return;
  if (W && W.current === 'kitchen') { box.hidden = true; return; }
  box.hidden = false;

  var dataUrl = null;
  var busy = false;

  function setStatus(text, mode) {
    var s = $('summonStatus');
    s.textContent = text || '';
    s.className = 'status' + (mode ? ' ' + mode : '');
  }
  function showError(msg) {
    var e = $('summonError');
    e.textContent = msg || '';
    e.hidden = !msg;
  }

  /* ---------- capture → downscale → show (same as the BOL page) ---------- */
  function takeFile(file) {
    if (!file) return;
    showError('');
    $('summonResult').hidden = true;
    setStatus('Preparing the photo…', 'busy');
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
      $('summonPreview').src = dataUrl;
      $('summonPreviewNote').textContent = 'This is the photo that will be sent (' + size.w + ' × ' + size.h + '). Not right? Take another.';
      $('summonPreviewBox').hidden = false;
      $('summonReadBtn').hidden = false;
      $('summonReadBtn').disabled = false;
      setStatus('Check the photo, then tap "Find this BOL".');
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      setStatus('');
      showError('That file could not be opened as an image. Try another photo.');
    };
    img.src = url;
  }
  $('summonCam').addEventListener('change', function (e) { takeFile(e.target.files[0]); e.target.value = ''; });
  $('summonFile').addEventListener('change', function (e) { takeFile(e.target.files[0]); e.target.value = ''; });

  /* ---------- read → fresh state → summon ---------- */
  $('summonReadBtn').addEventListener('click', function () {
    if (busy || !dataUrl) return;
    busy = true;
    $('summonReadBtn').disabled = true;
    showError('');
    $('summonResult').hidden = true;
    setStatus('Reading the bill of lading…', 'busy');
    B.readBol(window.fetch.bind(window), dataUrl).then(function (res) {
      var fresh = E.loadState();  /* fresh before the lookup; read-only */
      if (!fresh) {
        setStatus('');
        showError('The warehouse state could not be loaded, so nothing was looked up. Reload the page and try again.');
        return;
      }
      setStatus('Read.' + (res.attempts > 1 ? ' (It took a second try.)' : ''), 'done');
      render(S.summon(fresh, res.bol), res.bol);
    }, function (err) {
      setStatus('');
      showError(err.userMessage || 'No read — something went wrong. Your photo is still on screen.');
    }).then(function () {
      busy = false;
      $('summonReadBtn').disabled = false;
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
    item.appendChild(body);
    return item;
  }
  function fill(id, rows) {
    var list = $(id);
    list.textContent = '';
    rows.forEach(function (r) { list.appendChild(r); });
  }

  var TAGS = { agree: 'Agree', differ: 'Differs', 'not-read': 'Not read', 'not-in-read': 'Not in read', 'not-on-file': 'Not on file',
    done: 'Done', assigned: 'In hand', open: 'Open', waiting: 'Waiting' };
  var TAG_CLASS = { 'not-in-read': 'not-on-bol', 'not-on-file': 'extra', done: 'agree', assigned: 'agree', open: 'not-read', waiting: 'not-read' };

  function render(res, read) {
    $('summonHeadline').textContent = res.message;
    $('summonHeadline').className = 'bol-summary ' + (res.status === 'match' ? 'summon-match' : 'summon-none');
    $('summonFound').hidden = res.status !== 'match';
    fill('summonSays', B.bolLines(read).map(function (l) { return li(l); }));

    if (res.status === 'match') {
      var ship = res.shipment;
      $('summonShip').textContent = ship.id + ' — ' + ship.desc + '. ' + res.stage.words;
      $('summonNextTitle').textContent = res.next.title;
      $('summonNextDetail').textContent = [res.next.detail, res.next.taskId ? res.next.words : ''].filter(Boolean).join(' ');
      fill('summonChain', res.chain.map(function (s) { return li(s.step + ' — ' + s.words, TAG_CLASS[s.key] || s.key, TAGS[s.key]); }));
      $('summonAgainst').textContent = 'Compared with: ' + res.compare.against + '.';
      $('summonSummary').textContent = res.compare.summary;
      fill('summonCounts', res.compare.counts.concat([res.compare.total], res.compare.extra).map(function (r) {
        return li(r.line, TAG_CLASS[r.result] || r.result, TAGS[r.result]);
      }));
      fill('summonIds', res.compare.identity.map(function (r) { return li(r.line, r.result, TAGS[r.result]); }));
    }
    $('summonAsOf').textContent = 'As of ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) +
      '. This scan created nothing and changed nothing.';
    $('summonResult').hidden = false;
  }
})();
