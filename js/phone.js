/* =====================================================================
   phone.js — the thin phone surface (desk-phone brief, Step 3).

   The phone is a communicator to the AI (William's ruling, after the
   brief): it talks, it captures, it summons. It hosts no WMS
   workflow — no task card, no buttons that move freight, no panels
   of records. The full record lives on the desk.

   What it does:
   - Who am I: one tap on a labor unit, remembered for this page
     session only.
   - Glance: the task in hand as a chip — Task # and Bin # — and
     nothing else persistent.
   - Talk (hold, or type): a worker's words go to the existing
     converse intents, unchanged — "done" closes and pulls the next,
     "what's next" reads it, problem words are pinned to the task and
     close nothing. A manager's words go to the existing Ask-the-
     building flow, unchanged (a spoken question fills the box; the
     manager reads it and sends). Every change runs against the
     shared state: fetch fresh → engine → save (js/state.js).
   - Capture: photo → downscale (longest side ≤ 1600 px, JPEG 0.8) →
     /chat as a data: image with the photo-scan prompt pattern →
     flags on the phone → Save POSTs /save with kind "photo", the
     flags and the load label. The photo itself is NOT stored (the
     brief's open question; William has not ruled). The phone runs
     no comparison and gives no verdicts — those stay on the desk.

   Two parts, like glasses.js:
   - CORE: pure. Loads in node (module.exports) for test/phone-test.js.
   - PAGE: wiring. Runs only in a browser with a document.
   ===================================================================== */
(function (root) {
  'use strict';

  /* ================================================================
     CORE — pure
     ================================================================ */

  var WORKER_BASE = 'https://witness.e-william-harris96.workers.dev';
  var CHAT_URL = WORKER_BASE + '/chat';
  var SAVE_URL = WORKER_BASE + '/save';
  var MAX_SIDE = 1600;
  var JPEG_QUALITY = 0.8;
  var PHOTO_MAX_TOKENS = 6000;
  var SIDES = ['front', 'right', 'back', 'left', 'overall'];
  var HEARD_CLIP = 90;
  var REPLY_CLIP = 160;

  /* The photo-scan prompt, in the pattern of js/photo.js (flags,
     quoted evidence, per side where the photo allows) — reshaped for
     one phone photo instead of a four-panel contact sheet. */
  var PHOTO_PROMPT = [
    'You are the photo scan for a warehouse receiving cross-check. You are shown ONE photo of a pallet load, taken on a phone at the dock. It may show one side, two sides, or the whole load. Flag everything that would belong in a receiving or OS&D (overage, shortage & damage) report: damage, crushed or open cartons, torn or loose wrap, leaks or stains, leaning or shifted stack, loose items, broken pallet, anything out of place. Also flag a side that looks sound when that is genuinely what the photo shows.',
    '',
    'Return ONLY a JSON object in exactly this shape, no prose, no code fences:',
    '{"flags":[{"label":"...","side":"front|right|back|left|overall","detail":"..."}]}',
    '',
    '- "label": a short plain label in dock words (for example "Crushed cartons", "Torn wrap", "Side looks sound"). Invent labels from what you actually see.',
    '- "side": the side the item is seen on, only when the photo makes the side clear. Otherwise "overall".',
    '- "detail": one plain sentence saying exactly what you see and where in the photo. Do not infer causes. If part of the load is hidden or out of frame, say what you cannot verify in a flag labeled "Cannot verify".',
    '',
    'Rules: one flag per distinct item; report only what is visible in the image; never invent counts you cannot see.'
  ].join('\n');

  /* Task # — its place in the building's task list, 1-based, the
     same count the glasses glance uses. Bin # — the bin (or door)
     the task is about, shown only when it has a reason to be there. */
  function taskPlace(task) {
    if (!task) return null;
    if (task.type === 'putaway') return task.toBinId ? 'Bin ' + task.toBinId : null;
    if (task.type === 'consolidate') return task.fromBinId ? 'Bin ' + task.fromBinId : null;
    if ((task.type === 'breakdown' || task.type === 'pick') && task.binId) return 'Bin ' + task.binId;
    var m = /((?:Inbound |Outbound )?Door \d+)/.exec(task.title || '');
    return m ? m[1] : null;
  }

  function taskInHand(E, state, unit) {
    if (!unit || !unit.currentTaskId) return null;
    var t = E.taskById(state, unit.currentTaskId);
    return t && t.status === 'assigned' ? t : null;
  }

  function chipsFor(E, state, unit) {
    var t = taskInHand(E, state, unit);
    if (!t) return { task: null, bin: null };
    return { task: 'Task ' + (state.tasks.indexOf(t) + 1), bin: taskPlace(t) };
  }

  /* The phone shows the moment, clipped. */
  function clip(text, n) {
    text = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (text.length <= n) return text;
    var cut = text.slice(0, n - 1);
    var sp = cut.lastIndexOf(' ');
    if (sp > n * 0.6) cut = cut.slice(0, sp);
    return cut.replace(/[\s.,;:—-]+$/, '') + '…';
  }

  /* Longest side ≤ MAX_SIDE, never upscaled. */
  function fitSize(w, h, max) {
    max = max || MAX_SIDE;
    var long = Math.max(w, h);
    if (!long || long <= max) return { w: w, h: h };
    var k = max / long;
    return { w: Math.round(w * k), h: Math.round(h * k) };
  }

  function photoMessages(dataUrl) {
    return [
      { role: 'system', content: PHOTO_PROMPT },
      { role: 'user', content: [
        { type: 'text', text: 'Read this load and return the flags JSON.' },
        { type: 'image_url', image_url: { url: dataUrl } }
      ] }
    ];
  }

  function replyText(j) {
    return j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  }

  function normalisePhotoFlags(parsed) {
    var raw = parsed && Array.isArray(parsed.flags) ? parsed.flags : null;
    if (!raw) return null;
    var out = [];
    raw.forEach(function (f) {
      if (!f || typeof f !== 'object') return;
      var label = typeof f.label === 'string' ? f.label.trim() : '';
      var side = typeof f.side === 'string' ? f.side.trim().toLowerCase() : '';
      var detail = typeof f.detail === 'string' ? f.detail.trim() : '';
      if (SIDES.indexOf(side) === -1) side = 'overall';
      if (label && detail) out.push({ label: label, side: side, detail: detail });
    });
    return out;
  }

  function fail(code, msg) { var e = new Error(code); e.code = code; e.userMessage = msg; return e; }

  function parseFlagsReply(j) {
    var text = replyText(j);
    if (!text) throw fail('empty', 'The photo read came back empty. Nothing was saved. Try again.');
    var cleaned = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    var parsed;
    try { parsed = JSON.parse(cleaned); } catch (e) { throw fail('unparseable', 'The photo read answered, but not in a shape the phone can read. Nothing was saved.'); }
    var flags = normalisePhotoFlags(parsed);
    if (!flags) throw fail('unparseable', 'The photo read answered, but not in the flags shape. Nothing was saved.');
    return flags;
  }

  /* One photo read through /chat. An empty reply is retried once. */
  function readPhoto(doFetch, dataUrl, url) {
    var body = JSON.stringify({ messages: photoMessages(dataUrl), temperature: 0.2, max_tokens: PHOTO_MAX_TOKENS });
    function attempt(n) {
      return Promise.resolve().then(function () {
        return doFetch(url || CHAT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body });
      }).then(function (r) {
        if (r.status === 413) throw fail('too-large', 'The photo was too big to send. Nothing was saved. Try again a little further back.');
        if (r.status === 429) throw fail('cap', 'The photo read is unavailable — today\'s call cap is reached. Nothing was saved.');
        if (!r.ok) throw fail('http', 'The photo read could not be reached (HTTP ' + r.status + '). Nothing was saved.');
        return r.json().catch(function () { throw fail('bad-json', 'The photo read came back unreadable. Nothing was saved.'); });
      }, function (e) {
        if (e && e.userMessage) throw e;
        throw fail('network', 'The photo read could not be reached. Check the signal. Nothing was saved.');
      }).then(function (j) {
        if (!replyText(j) && n < 2) return attempt(n + 1);
        return parseFlagsReply(j);
      });
    }
    return attempt(1);
  }

  /* The load label a capture is saved under: the task in hand when
     there is one (its staged pallet's shipment, else the task), else
     the person. Never a guess at a load the phone can't see. */
  function loadLabel(E, state, unit) {
    var t = taskInHand(E, state, unit);
    if (t && t.stagingId) {
      for (var i = 0; i < state.staging.length; i++) {
        var p = state.staging[i];
        if (p.id === t.stagingId) return 'Phone — ' + (p.shipmentId ? p.shipmentId + ' · ' : '') + p.id;
      }
    }
    if (t) return 'Phone — ' + (state.tasks.indexOf(t) >= 0 ? 'Task ' + (state.tasks.indexOf(t) + 1) + ' · ' : '') + t.title;
    return 'Phone — ' + (unit ? unit.name : 'capture');
  }

  /* The /save body: kind "photo", the flags, the load label. The
     image is not in it (photo storage is William's open decision). */
  function savePayload(flags, label, unit, savedAt) {
    var lines = flags.map(function (f) { return f.label + ' (' + f.side + '): ' + f.detail; });
    return {
      kind: 'photo',
      load: label,
      transcript: 'Phone photo scan' + (unit ? ' by ' + unit.name : '') + '. ' +
        (lines.length ? lines.join(' | ') : 'No flags.'),
      flags: flags,
      savedAt: savedAt || new Date().toISOString()
    };
  }

  function saveCapture(doFetch, payload, url) {
    return Promise.resolve().then(function () {
      return doFetch(url || SAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) {
        if (r.status === 200 && j && j.ok) return j;
        throw fail('http', 'Saving failed (HTTP ' + r.status + '). The flags are still on screen.');
      });
    }, function () {
      throw fail('network', 'Saving failed — the record could not be reached. The flags are still on screen.');
    });
  }

  /* Who sees what (the role tier): a manager's words are a question
     for the building; a worker's words go to the queue. */
  function routeFor(unit) { return unit && unit.role === 'manager' ? 'ask' : 'queue'; }

  var core = {
    PHOTO_PROMPT: PHOTO_PROMPT, MAX_SIDE: MAX_SIDE, JPEG_QUALITY: JPEG_QUALITY, CHAT_URL: CHAT_URL, SAVE_URL: SAVE_URL,
    HEARD_CLIP: HEARD_CLIP, REPLY_CLIP: REPLY_CLIP,
    taskPlace: taskPlace, taskInHand: taskInHand, chipsFor: chipsFor, clip: clip, fitSize: fitSize,
    photoMessages: photoMessages, normalisePhotoFlags: normalisePhotoFlags, parseFlagsReply: parseFlagsReply,
    readPhoto: readPhoto, loadLabel: loadLabel, savePayload: savePayload, saveCapture: saveCapture, routeFor: routeFor
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = core; return; }
  root.WitnessPhone = core;
  if (typeof document === 'undefined') return;

  /* ================================================================
     PAGE — wiring
     ================================================================ */

  var E = root.WitnessEngine, C = root.WitnessConverse;
  var doFetch = root.fetch.bind(root);
  var store = root.WitnessState.create({
    fetch: doFetch,
    seed: function () { var s = E.seedWorld(); E.generateTasks(s); return s; },
    prepare: function (s) { E.upgradeState(s); E.generateTasks(s); return s; }
  });
  var WHO_KEY = 'witness.phone.who';

  var state = null;       /* in-memory copy, for rendering between actions */
  var meId = null;
  var busy = false;
  var asking = false;
  var shot = null;        /* { dataUrl, flags, label } */

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function msg(text, isError) {
    var el = $('phMsg');
    el.textContent = text || '';
    el.className = 'ph-msg' + (isError ? ' err' : '');
    el.hidden = !text;
  }
  function me() { return state && meId ? E.unitById(state, meId) : null; }

  function rememberWho(id) { try { root.sessionStorage.setItem(WHO_KEY, id || ''); } catch (e) { /* this page only */ } }
  function recallWho() { try { return root.sessionStorage.getItem(WHO_KEY) || null; } catch (e) { return null; } }

  /* ---------- render ---------- */

  function renderWho() {
    $('phNames').innerHTML = state.labor.map(function (u) {
      return '<button type="button" class="ph-name" data-unit="' + esc(u.id) + '">' + esc(u.name) +
        (u.role === 'manager' ? ' <span>manager</span>' : '') + '</button>';
    }).join('');
  }

  function render() {
    if (!state) return;
    var u = me();
    $('phWho').hidden = !!u;
    $('phLive').hidden = !u;
    if (!u) { renderWho(); return; }
    var c = chipsFor(E, state, u);
    $('chipTask').textContent = c.task || '';
    $('chipTask').hidden = !c.task;
    $('chipBin').textContent = c.bin || '';
    $('chipBin').hidden = !c.bin;
    $('phMe').textContent = u.name.split(' ')[0];
    $('phTypeInput').placeholder = routeFor(u) === 'ask' ? 'Ask the building…' : 'Or type it';
  }

  function showTurn(heard, reply) {
    $('phHeard').textContent = clip(heard, HEARD_CLIP);
    $('phReply').textContent = clip(reply, REPLY_CLIP);
    $('phAskMore').hidden = true;
    $('phTurn').hidden = false;
  }

  /* ---------- talk: worker → the queue ---------- */

  function queueTurn(text, how) {
    if (busy) { msg('Still saving the last one — say it again in a moment.'); return; }
    var unitId = meId;
    var heardLine = '“' + text + '”' + (how ? ' ' + how : '');
    busy = true;
    msg('');
    /* The converse model step: META reads the words first, matchIntent
       cross-checks (C.readWorker adjudicates) — the same reading path
       the glasses take. Only an adjudicated act reaches the store. */
    C.readWorker(E, state, E.unitById(state, unitId), text, { fetch: doFetch, url: C.CHAT_URL }).then(function (d) {
      if (d.kind !== 'turn') {
        showTurn(heardLine, d.turn.lines.join(' '));
        render();
        return;
      }
      return store.mutate(function (s) {
        var turn = C.workerTurn(E, s, E.unitById(s, unitId), d.match);
        if (turn.acted) E.generateTasks(s);
        return { ok: !!turn.acted, turn: turn };
      }).then(function (out) {
        state = out.state;
        showTurn(heardLine, out.result.turn.lines.join(' '));
        render();
      });
    }).then(null, function (e) {
      msg((e && e.userMessage) || 'That did not save. Nothing was done.', true);
    }).then(function () { busy = false; });
  }

  /* ---------- talk: manager → ask the building ---------- */

  function zonesTable(facts) {
    var html = '<table class="ph-table"><thead><tr><th>Zone</th><th>Waiting</th><th>Units</th><th>Per unit</th><th>Coming</th></tr></thead><tbody>';
    facts.zones.forEach(function (z) {
      var hot = facts.bottleneck && facts.bottleneck.zone === z.zone;
      html += '<tr' + (hot ? ' class="hot"' : '') + '><td>' + esc(z.zone) + (hot ? ' ⚠' : '') + '</td><td>' + z.waiting +
        '</td><td>' + z.workers + '</td><td>' + esc(z.loadPerWorker) + '</td><td>' + z.incomingPallets + '</td></tr>';
    });
    html += '</tbody></table>';
    var b = facts.bottleneck;
    html += '<p class="ph-small">Engine check: ' + (b
      ? 'Zone ' + esc(b.zone) + ' backing up — ' + b.pending + ' waiting, ' + b.workers + ' units. Engine would move ' +
        esc(b.suggestion.unitName) + ' from Zone ' + esc(b.suggestion.fromZone) + '.'
      : 'no zone meets the backing-up rule right now.') + '</p>';
    return html;
  }

  function checkLine(check) {
    if (!check.found.length && !check.missing.length) return 'This answer quotes no numbers.';
    if (!check.missing.length) return 'Every number in it (' + check.found.join(', ') + ') is in the building\'s data.';
    return 'Not in the data: ' + check.missing.join(', ') + '. Check before you act.';
  }

  function askTurn(q) {
    if (asking) return;
    asking = true;
    $('phTypeBtn').disabled = true;
    msg('Asking… this can take up to a minute.');
    /* Ask from the numbers as they are now: a fresh read, read-only. */
    store.loadState().then(function (s) {
      if (s) { E.upgradeState(s); E.generateTasks(s); state = s; render(); }
      return C.askManager({ engine: E, state: state, question: q, fetch: doFetch });
    }).then(function (res) {
      msg('');
      showTurn(q, res.answer);
      $('phCheck').textContent = checkLine(res.check);
      $('phZones').innerHTML = zonesTable(res.summary.facts);
      $('phAskMore').hidden = false;
      $('phTypeInput').value = '';
    }, function (e) {
      msg((e && e.userMessage) || 'No answer — something went wrong. Nothing was guessed.', true);
    }).then(function () {
      asking = false;
      $('phTypeBtn').disabled = false;
    });
  }

  function onTyped(e) {
    e.preventDefault();
    var text = $('phTypeInput').value.trim();
    var u = me();
    if (!text || !u) return;
    if (routeFor(u) === 'ask') { askTurn(text); return; }
    $('phTypeInput').value = '';
    queueTurn(text, '(typed)');
  }

  function talkLabel(mode) {
    var b = $('phTalk');
    b.classList.toggle('rec', mode === 'listening');
    b.setAttribute('aria-pressed', mode === 'listening' ? 'true' : 'false');
    $('phTalkLabel').textContent = mode === 'listening' ? 'Listening… let go to send' : mode === 'sending' ? 'Working…' : 'Hold to talk';
  }

  if (root.WitnessMic) {
    root.WitnessMic.attach($('phTalk'), {
      onListening: function () { talkLabel('listening'); msg(''); },
      onSending: function () { talkLabel('sending'); },
      onText: function (text) {
        talkLabel('idle');
        var u = me();
        if (!u) return;
        if (routeFor(u) === 'ask') {
          /* As on the desk: a spoken question only fills the box. */
          $('phTypeInput').value = text;
          msg('Check your question, then tap Send.');
          return;
        }
        queueTurn(text);
      },
      onError: function (m) { talkLabel('idle'); msg(m, true); },
      onIdle: function () { talkLabel('idle'); }
    });
  }

  /* ---------- capture ---------- */

  function downscale(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var size = fitSize(img.naturalWidth, img.naturalHeight, MAX_SIDE);
        var cv = document.createElement('canvas');
        cv.width = size.w; cv.height = size.h;
        cv.getContext('2d').drawImage(img, 0, 0, size.w, size.h);
        URL.revokeObjectURL(url);
        resolve(cv.toDataURL('image/jpeg', JPEG_QUALITY));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(fail('bad-image', 'That file could not be opened as a photo.')); };
      img.src = url;
    });
  }

  function renderFlags(flags) {
    var ul = $('phFlags');
    ul.innerHTML = flags.length
      ? flags.map(function (f) {
          return '<li><strong>' + esc(f.label) + '</strong>' + (f.side !== 'overall' ? ' <span>' + esc(f.side) + '</span>' : '') +
            '<br>' + esc(clip(f.detail, REPLY_CLIP)) + '</li>';
        }).join('')
      : '<li>No flags.</li>';
    ul.hidden = false;
  }

  function onCapture(file) {
    if (!file) return;
    shot = null;
    $('phFlags').hidden = true;
    $('phSave').hidden = true;
    msg('Reading the photo…');
    downscale(file).then(function (dataUrl) {
      shot = { dataUrl: dataUrl, flags: null, label: loadLabel(E, state, me()) };
      $('phShotImg').src = dataUrl;   /* the capture, bare, is its own confirmation */
      $('phShot').hidden = false;
      return readPhoto(doFetch, dataUrl).then(function (flags) {
        shot.flags = flags;
        msg('');
        renderFlags(flags);
        $('phSave').textContent = 'Save';
        $('phSave').disabled = false;
        $('phSave').hidden = false;
      });
    }).catch(function (e) {
      msg((e && e.userMessage) || 'The photo could not be read. Nothing was saved.', true);
    });
  }

  function onSave() {
    if (!shot || !shot.flags) return;
    var b = $('phSave');
    b.disabled = true;
    b.textContent = 'Saving…';
    saveCapture(doFetch, savePayload(shot.flags, shot.label, me())).then(function () {
      b.textContent = 'Saved';
      msg('Saved to the record under ' + shot.label + '. The photo itself was not stored.');
    }, function (e) {
      b.disabled = false;
      b.textContent = 'Save';
      msg(e.userMessage, true);
    });
  }

  /* ---------- wire-up ---------- */

  $('phNames').addEventListener('click', function (e) {
    var t = e.target.closest('[data-unit]');
    if (!t) return;
    meId = t.getAttribute('data-unit');
    rememberWho(meId);
    $('phTurn').hidden = true;
    render();
  });
  $('phMe').addEventListener('click', function () { meId = null; rememberWho(''); render(); });
  $('phTypeForm').addEventListener('submit', onTyped);
  $('phCam').addEventListener('change', function (e) { onCapture(e.target.files[0]); e.target.value = ''; });
  $('phSave').addEventListener('click', onSave);

  /* Coming back to the phone: re-read (read-only) so the chip is current. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden || !state || busy) return;
    store.loadState().then(function (s) {
      if (s && !busy) { E.upgradeState(s); E.generateTasks(s); state = s; render(); }
    }, function () { /* the next action will say so */ });
  });

  /* Open: read-only. Seeds once only if nothing is stored anywhere. */
  store.start().then(function (res) {
    if (res.state.world && res.state.world !== 'warehouse') {
      msg('The shared record holds the ' + res.state.world + ' world, not the warehouse. The phone will not act on it.', true);
      return;
    }
    state = res.state;
    var remembered = recallWho();
    if (remembered && E.unitById(state, remembered)) meId = remembered;
    msg('');
    render();
  }, function (e) {
    msg((e && e.userMessage) || 'The shared warehouse could not be loaded. Nothing was loaded.', true);
  });
})(typeof window !== 'undefined' ? window : globalThis);
