/* =====================================================================
   glasses.js — the glasses view, running on a phone.

   The phone's rear camera is the wearer's view; the settled HUD
   (round 2, William 2026-10-31) floats over it in two distinguished
   lenses; voice and a PlayStation controller drive it; the real
   engine (js/engine.js) and converse layer (js/converse.js) run it,
   both loaded UNCHANGED. Hold-to-talk is js/warehouse-mic.js, also
   loaded unchanged.

   Two halves in one file:
   - CORE: pure helpers (focus movement, controller reading, capture
     downscale maths, page-level commands, HUD text shaping, the scan
     request with fetch handed in). No DOM. Exported to node for
     test/glasses-test.js.
   - PAGE: camera, HUD, controller loop, wiring. Runs only in a
     browser with a document.

   State discipline: warehouse state is read and written ONLY through
   the Store adapter below, which wraps the same engine seam
   warehouse-ui.js uses (loadState / saveState). When state moves to
   the Worker (desk-phone brief), Store is the one place to re-point.
   ===================================================================== */
(function (root) {
  'use strict';

  /* ================================================================
     CORE — pure
     ================================================================ */

  /* The controller's actions, in focus order. Hide is NOT one of
     them: hide is spoken only, never a selectable control (William's
     hard ruling). Focus starts on Capture, so X captures by default. */
  var ACTIONS = ['talk', 'capture'];
  var DEFAULT_FOCUS = 1;

  /* Touch on the view: press and hold = talk; two quick taps =
     capture. A single short tap does nothing. */
  var HOLD_MS = 250, DOUBLE_TAP_MS = 320;

  /* Controller mapping — Standard Gamepad layout (DualSense /
     DualShock report it in Chrome and Safari). Change a number here
     to re-map; nothing else reads raw indices. */
  var PAD_MAP = {
    talk: 7,          /* R2 — hold to talk, release to send */
    activate: 0,      /* X (cross) — activate the focused action */
    dpadUp: 12,
    dpadDown: 13,
    dpadLeft: 14,
    dpadRight: 15,
    stickX: 0,        /* left stick, axis index */
    stickY: 1
  };
  var STICK_DEADZONE = 0.5;
  var TRIGGER_PRESSED = 0.5; /* R2 is analog; past half-way counts as held */

  /* Capture sizes. Shown at up to 1600px. Sent for the scan at up to
     1024px / JPEG 0.7, stepping down until the request fits the
     Worker's /chat body cap (60,000 chars) — or, if even the smallest
     step doesn't fit, sent anyway so the Worker's 413 is reported
     honestly. */
  var SHOW_MAX = 1600, SHOW_QUALITY = 0.8;
  var SCAN_STEPS = [
    { max: 1024, quality: 0.7 },
    { max: 800, quality: 0.65 },
    { max: 640, quality: 0.6 },
    { max: 512, quality: 0.55 }
  ];
  var CHAT_BODY_CAP = 60000;
  var SCAN_MAX_TOKENS = 6000;

  /* Fit w×h inside a square of side max, keeping the shape. Never
     scales up. Whole pixels, at least 1. */
  function fitWithin(w, h, max) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    var long = Math.max(w, h);
    if (long <= max) return { w: w, h: h };
    var k = max / long;
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  }

  /* Given the request body length each scan step would produce,
     the index of the first step that fits under the cap — or the
     last step when none fits. */
  function chooseScanStep(bodyLengths, cap) {
    cap = cap || CHAT_BODY_CAP;
    for (var i = 0; i < bodyLengths.length; i++) if (bodyLengths[i] <= cap) return i;
    return bodyLengths.length - 1;
  }

  /* A finished touch on the view: 'hold' (it already started talk),
     'double' (second tap close enough to the last), or 'tap'. */
  function touchKind(downAt, upAt, lastTapAt) {
    if (upAt - downAt >= HOLD_MS) return 'hold';
    if (lastTapAt != null && downAt - lastTapAt <= DOUBLE_TAP_MS) return 'double';
    return 'tap';
  }

  /* Move focus one step; wraps at both ends. dir: 'left'|'up' = back,
     'right'|'down' = forward. Unknown dir: stay. */
  function moveFocus(index, dir, n) {
    n = n || ACTIONS.length;
    var step = (dir === 'left' || dir === 'up') ? -1 : (dir === 'right' || dir === 'down') ? 1 : 0;
    return ((index + step) % n + n) % n;
  }

  /* The left stick's direction, or null inside the deadzone. The
     stronger axis wins. Gamepad Y is positive downward. */
  function stickDir(x, y, deadzone) {
    deadzone = deadzone == null ? STICK_DEADZONE : deadzone;
    if (Math.abs(x) < deadzone && Math.abs(y) < deadzone) return null;
    if (Math.abs(x) >= Math.abs(y)) return x > 0 ? 'right' : 'left';
    return y > 0 ? 'down' : 'up';
  }

  function btn(gp, i) {
    var b = gp && gp.buttons && gp.buttons[i];
    if (!b) return { pressed: false, value: 0 };
    return typeof b === 'object' ? { pressed: !!b.pressed, value: +b.value || 0 } : { pressed: b === 1, value: +b };
  }

  /* One controller snapshot → the few things the page cares about. */
  function readPad(gp, map) {
    map = map || PAD_MAP;
    var t = btn(gp, map.talk);
    var axes = (gp && gp.axes) || [];
    var dir = stickDir(axes[map.stickX] || 0, axes[map.stickY] || 0);
    if (btn(gp, map.dpadLeft).pressed) dir = 'left';
    else if (btn(gp, map.dpadRight).pressed) dir = 'right';
    else if (btn(gp, map.dpadUp).pressed) dir = 'up';
    else if (btn(gp, map.dpadDown).pressed) dir = 'down';
    return {
      talk: t.pressed || t.value >= TRIGGER_PRESSED,
      activate: btn(gp, map.activate).pressed,
      dir: dir
    };
  }

  /* What changed between two snapshots: presses and releases fire
     once, a held direction moves focus once until it's let go. */
  function padEvents(prev, cur) {
    prev = prev || { talk: false, activate: false, dir: null };
    var ev = [];
    if (cur.talk && !prev.talk) ev.push('talk-down');
    if (!cur.talk && prev.talk) ev.push('talk-up');
    if (cur.activate && !prev.activate) ev.push('activate-down');
    if (!cur.activate && prev.activate) ev.push('activate-up');
    if (cur.dir && cur.dir !== prev.dir) ev.push('move-' + cur.dir);
    return ev;
  }

  /* A short name for the controller line. */
  function padName(id) {
    var s = String(id || '');
    if (/dualsense/i.test(s) || /0ce6/i.test(s)) return 'DualSense';
    if (/dualshock|^wireless controller|05c4|09cc/i.test(s)) return 'DualShock'; /* Sony's DS4 reports as "Wireless Controller" */
    var clean = s.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
    return clean ? clean.slice(0, 32) : 'Controller';
  }

  function normalise(text) {
    return String(text || '').toLowerCase().replace(/[’‘]/g, "'")
      .replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()
      .replace(/^(hey|hi|ok|okay)?\s*muse\b\s*/, '');
  }

  /* Page-level commands, checked BEFORE the converse intents. Both
     are strict: the whole sentence has to be the command, so "the
     wrap is hiding a crushed corner" is still a problem report. */
  function isHide(text) {
    return /^(please )?(hide|hide it|hide that|hide this|hide text|hide the text|clear it|clear the view|clear the screen)( please)?$/
      .test(normalise(text));
  }
  function isWhoFree(text) {
    return /^(please )?(who'?s|who is|is anyone|anyone|anybody|is anybody) (free|available|around to help)( right now| now)?( please)?$|^who can help( me)?( right now| now)?$/
      .test(normalise(text));
  }

  /* The bin (or door) a task is about, for the Bin # chip. */
  function taskPlace(task) {
    if (!task) return null;
    if (task.type === 'putaway') return task.toBinId ? 'Bin ' + task.toBinId : null;
    if (task.type === 'consolidate') return 'Bin ' + task.fromBinId;
    if (task.type === 'breakdown' || task.type === 'pick') return 'Bin ' + task.binId;
    var m = /(Door \d+)/.exec(task.title || '');
    return m ? m[1] : null;
  }

  /* The two persistent chips: Task # (its place in the building's
     task list, 1-based — stable for the shift) and Bin #. */
  function chipsFor(E, state, unit) {
    if (!unit || !unit.currentTaskId) return { task: null, bin: null };
    var t = E.taskById(state, unit.currentTaskId);
    if (!t || t.status !== 'assigned') return { task: null, bin: null };
    return { task: 'Task ' + (state.tasks.indexOf(t) + 1), bin: taskPlace(t) };
  }

  /* Who's free, for a labor answer: name / location / status only.
     Prefers someone with no task in hand, same zone first. Location
     is their zone, plus the bin of what they last finished when we
     know it. Status is only what the state can say — "available" or
     "on a task" — never a guessed time. */
  function employeeFor(E, state, wearer) {
    var workers = state.labor.filter(function (u) { return u.role === 'worker' && (!wearer || u.id !== wearer.id); });
    if (!workers.length) return null;
    function busy(u) {
      var t = u.currentTaskId ? E.taskById(state, u.currentTaskId) : null;
      return !!(t && t.status === 'assigned');
    }
    workers.sort(function (a, b) {
      var fa = busy(a) ? 1 : 0, fb = busy(b) ? 1 : 0;
      if (fa !== fb) return fa - fb;
      var za = wearer && a.zone === wearer.zone ? 0 : 1, zb = wearer && b.zone === wearer.zone ? 0 : 1;
      if (za !== zb) return za - zb;
      return a.name < b.name ? -1 : 1;
    });
    var u = workers[0];
    var near = null;
    if (busy(u)) near = taskPlace(E.taskById(state, u.currentTaskId));
    else {
      for (var i = state.tasks.length - 1; i >= 0 && !near; i--) {
        if (state.tasks[i].doneBy === u.id) near = taskPlace(state.tasks[i]);
      }
    }
    return {
      name: u.name,
      location: 'Zone ' + u.zone + (near ? ', near ' + near.replace(/^Bin /, '') : ''),
      status: busy(u) ? 'on a task' : 'available'
    };
  }

  /* ---------- the photo scan (one live frame) ---------------------- */
  /* The pattern from js/photo.js — flags in dock words, each with
     what is seen, nothing inferred — for a single camera frame
     instead of a four-panel sheet. No verdicts, no comparison: those
     stay with module one on the desk. */
  var SCAN_PROMPT = [
    'You are the photo scan for a warehouse worker wearing smart glasses. You are shown ONE camera frame of what they are looking at — a pallet, a stack of boxes, a bin, or an aisle. Flag everything that would belong in a receiving or OS&D (overage, shortage & damage) report: damage, crushed or open cartons, torn or loose wrap, leaks or stains, leaning or shifted stack, loose items, broken pallet, anything out of place. Flag that it looks sound when that is genuinely what the frame shows.',
    '',
    'Return ONLY a JSON object in exactly this shape, no prose, no code fences:',
    '{"flags":[{"label":"...","detail":"..."}]}',
    '',
    '- "label": a short plain label in dock words (for example "Crushed cartons", "Torn wrap", "Looks sound").',
    '- "detail": one plain sentence saying exactly what you see and where in the frame. Do not infer causes. If part is out of frame or unclear, flag it "Cannot verify" and say what.',
    '',
    'Rules: one flag per distinct item; report only what is visible; never invent counts you cannot see. Most important flag first.',
    '',
    'If there is no pallet, freight or warehouse stock in the frame, do not force it: still return the same JSON shape, with one or two flags labeled "What I see" that say plainly what IS in the frame.'
  ].join('\n');

  /* Free speech: anything the wearer says that isn't a command goes
     here with the current frame (when there is one). William,
     2026-11-01: "just let it respond in any way … respond to what it
     does see." It can't change the warehouse — the commands do that. */
  var ASK_PROMPT = [
    'You are META, the assistant in a warehouse worker\'s smart glasses. The worker just spoke to you.',
    'You may be shown what they are looking at right now. Respond to what they said in any way that helps, and if it is about what they see, respond to what you actually see in the frame — even when there is no pallet or freight in it.',
    'You cannot change tasks or the warehouse system; never say you did. If they want a task closed or the next one, tell them to say "done" or "what\'s next".',
    'This shows on a glasses display: plain words, at most 2 short sentences, no lists, no markdown.'
  ].join('\n');

  function askMessages(text, dataUrl, taskTitle) {
    var said = 'The worker said: "' + String(text).trim() + '"' + (taskTitle ? '\nTheir task in hand: ' + taskTitle : '');
    var user = dataUrl
      ? [{ type: 'text', text: said }, { type: 'image_url', image_url: { url: dataUrl } }]
      : said + '\n(No camera frame this time.)';
    return [{ role: 'system', content: ASK_PROMPT }, { role: 'user', content: user }];
  }
  function askBody(text, dataUrl, taskTitle) {
    return JSON.stringify({ messages: askMessages(text, dataUrl, taskTitle), temperature: 0.4, max_tokens: SCAN_MAX_TOKENS });
  }

  function scanMessages(dataUrl) {
    return [
      { role: 'system', content: SCAN_PROMPT },
      { role: 'user', content: [
        { type: 'text', text: 'Read this frame and return the flags JSON.' },
        { type: 'image_url', image_url: { url: dataUrl } }
      ] }
    ];
  }
  function scanBody(dataUrl) {
    return JSON.stringify({ messages: scanMessages(dataUrl), temperature: 0.2, max_tokens: SCAN_MAX_TOKENS });
  }

  function replyText(j) {
    var m = j && j.choices && j.choices[0] && j.choices[0].message;
    if (!m) return '';
    if (typeof m.content === 'string') return m.content.trim();
    if (Array.isArray(m.content)) return m.content.map(function (p) { return (p && p.text) || ''; }).join('').trim();
    return '';
  }

  function normaliseFlags(text) {
    var cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    var parsed;
    try { parsed = JSON.parse(cleaned); } catch (e) { return null; }
    if (!parsed || !Array.isArray(parsed.flags)) return null;
    var out = [];
    parsed.flags.forEach(function (f) {
      if (!f || typeof f !== 'object') return;
      var label = typeof f.label === 'string' ? f.label.trim() : '';
      var detail = typeof f.detail === 'string' ? f.detail.trim() : '';
      if (label && detail) out.push({ label: label, detail: detail });
    });
    return out;
  }

  function fail(code, msg) { var e = new Error(code); e.userMessage = msg; return e; }

  /* Send one prepared body. 413 is its own honest message — the
     capture stays on screen. Empty reply: one retry, then say so. */
  function sendScan(doFetch, url, body) {
    function attempt(n) {
      return Promise.resolve().then(function () {
        return doFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body });
      }).then(function (r) {
        if (r.status === 413) throw fail('too-large', 'Photo too large to send — capture kept.');
        if (r.status === 429) throw fail('cap', 'No scan — today\'s call limit is used up. Capture kept.');
        if (!r.ok) throw fail('http', 'No scan — the proxy answered HTTP ' + r.status + '. Capture kept.');
        return r.json().catch(function () { throw fail('bad-json', 'No scan — unreadable reply. Capture kept.'); });
      }, function (e) {
        if (e && e.userMessage) throw e;
        throw fail('network', 'No scan — no connection. Capture kept.');
      }).then(function (j) {
        var text = replyText(j);
        if (!text) {
          if (n < 2) return attempt(n + 1);
          throw fail('empty', 'No scan — came back empty twice. Capture kept.');
        }
        var flags = normaliseFlags(text);
        /* Not the flags shape, but it said something: show its words. */
        if (!flags) return { flags: null, text: text, attempts: n };
        return { flags: flags, attempts: n };
      });
    }
    return attempt(1);
  }

  /* One free question. 413 (frame too big) is reported so the page
     can re-ask without the frame. Empty: one retry, then say so. */
  function sendAsk(doFetch, url, body) {
    function attempt(n) {
      return Promise.resolve().then(function () {
        return doFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body });
      }).then(function (r) {
        if (r.status === 413) throw fail('too-large', 'Frame too large to send.');
        if (r.status === 429) throw fail('cap', 'No answer — today\'s call limit is used up.');
        if (!r.ok) throw fail('http', 'No answer — the proxy answered HTTP ' + r.status + '.');
        return r.json().catch(function () { throw fail('bad-json', 'No answer — unreadable reply.'); });
      }, function (e) {
        if (e && e.userMessage) throw e;
        throw fail('network', 'No answer — no connection.');
      }).then(function (j) {
        var text = replyText(j);
        if (text) return { text: text, attempts: n };
        if (n < 2) return attempt(n + 1);
        throw fail('empty', 'No answer — came back empty twice.');
      });
    }
    return attempt(1);
  }

  /* HUD text: what the right lens says after a scan. */
  function flagLines(flags) {
    if (!flags.length) return ['Nothing flagged in that frame.'];
    return flags.map(function (f) { return f.label + ' — ' + f.detail; });
  }

  var core = {
    ACTIONS: ACTIONS, DEFAULT_FOCUS: DEFAULT_FOCUS, HOLD_MS: HOLD_MS, DOUBLE_TAP_MS: DOUBLE_TAP_MS, touchKind: touchKind,
    PAD_MAP: PAD_MAP, SCAN_STEPS: SCAN_STEPS, SHOW_MAX: SHOW_MAX, CHAT_BODY_CAP: CHAT_BODY_CAP,
    fitWithin: fitWithin, chooseScanStep: chooseScanStep, moveFocus: moveFocus, stickDir: stickDir,
    readPad: readPad, padEvents: padEvents, padName: padName,
    isHide: isHide, isWhoFree: isWhoFree, taskPlace: taskPlace, chipsFor: chipsFor, employeeFor: employeeFor,
    scanMessages: scanMessages, scanBody: scanBody, askMessages: askMessages, askBody: askBody, sendAsk: sendAsk, normaliseFlags: normaliseFlags, sendScan: sendScan, flagLines: flagLines
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = core; return; }
  root.WitnessGlasses = core;
  if (typeof document === 'undefined') return;

  /* ================================================================
     PAGE
     ================================================================ */

  var E = root.WitnessEngine, C = root.WitnessConverse;
  function $(id) { return document.getElementById(id); }

  /* ---------- Store: the ONLY door to warehouse state -------------- */
  /* Same seam as warehouse-ui.js: engine loadState / saveState (the
     browser's localStorage today, shared with the warehouse page in
     this browser). Re-point these two functions at js/state.js when
     the desk-phone build lands. */
  var Store = {
    load: function () {
      var s = E.loadState();
      if (!s) { s = E.seedWorld(); E.generateTasks(s); E.saveState(s); return s; }
      E.upgradeState(s);
      E.generateTasks(s);
      return s;
    },
    save: function (s) { E.generateTasks(s); E.saveState(s); }
  };

  var state = Store.load();
  var wearerId = null;
  (function pickWearer() {
    var want = /[?&]unit=([^&]+)/.exec(location.search);
    state.labor.forEach(function (u) {
      if (u.role !== 'worker') return;
      if (want && u.id === decodeURIComponent(want[1])) wearerId = u.id;
      if (!wearerId && !want) wearerId = u.id;
    });
    if (!wearerId) state.labor.forEach(function (u) { if (!wearerId && u.role === 'worker') wearerId = u.id; });
  })();
  function wearer() { return E.unitById(state, wearerId); }

  /* ---------- start screen: who's wearing, then open the view ------- */
  /* The plain page before the view. It carries the label line and the
     worker pick; the view itself carries only the HUD. */

  function renderPick() {
    var html = '';
    state.labor.forEach(function (u) {
      if (u.role !== 'worker') return;
      html += '<button type="button" class="pick' + (u.id === wearerId ? ' selected' : '') +
        '" data-unit="' + u.id + '">' + u.name + ' <span class="pick-zone">Zone ' + u.zone + '</span></button>';
    });
    $('pickList').innerHTML = html;
    var bs = $('pickList').querySelectorAll('[data-unit]');
    for (var i = 0; i < bs.length; i++) {
      bs[i].addEventListener('click', function () { wearerId = this.getAttribute('data-unit'); renderPick(); });
    }
  }

  var opened = false;
  function openView() {
    if (opened) return;
    opened = true;
    $('start').hidden = true;
    $('view').hidden = false;
    renderChips();
    startCamera(); /* started from the tap, which phones want */
  }

  /* ---------- HUD ---------------------------------------------------- */

  var captureTimer = null;

  function setText(id, text) {
    var el = $(id);
    el.textContent = text || '';
    el.hidden = !text;
  }

  function renderChips() {
    var c = chipsFor(E, state, wearer());
    setText('chipTask', c.task);
    setText('chipBin', c.bin);
  }

  /* Hide (spoken only) fades the transcript, the reply and the
     employee text. The chips stay. Any new speech brings text back. */
  function showText() { document.body.classList.remove('text-hidden'); }
  function hideText() { document.body.classList.add('text-hidden'); }

  function say(lines) {
    /* "META:" + the reply's first 2 lines (CSS clamps to two lines). */
    setText('metaText', (lines || []).join(' '));
    $('metaLine').hidden = !(lines && lines.length);
  }
  function heard(text) { setText('youText', text); }
  function employee(e) {
    $('employee').hidden = !e;
    if (!e) return;
    $('empName').textContent = e.name;
    $('empPlace').textContent = e.location;
    $('empStatus').textContent = e.status;
  }
  /* A one-word cue where the wearer's words will land, only while
     the mic is live — the wearer has no button to watch. */
  function cue(word) { setText('cue', word); }

  function onSpeech(text) {
    showText();
    heard(text);
    if (isHide(text)) { say(null); employee(null); setTimeout(hideText, 700); return; }
    if (isWhoFree(text)) {
      var e = employeeFor(E, state, wearer());
      employee(e);
      say(e ? null : ['No one else is on the labor list.']);
      return;
    }
    employee(null);
    var match = C.matchIntent(text);
    if (match.intent === 'unknown') { askFree(text); return; } /* not a command: let META answer */
    state = Store.load(); /* fresh before acting */
    var turn = C.workerTurn(E, state, wearer(), match);
    if (turn.acted) Store.save(state);
    say(turn.lines);
    renderChips();
  }

  /* ---------- camera -------------------------------------------------- */

  var cameraOn = false;
  function startCamera() {
    var v = $('cam');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return cameraOff('this browser has no camera access');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function (s) {
      v.srcObject = s;
      v.play().catch(function () {});
      cameraOn = true;
      $('scene').setAttribute('hidden', ''); /* SVG has no .hidden property — set the attribute */
      v.hidden = false;
    }).catch(function (e) {
      cameraOff(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
        ? 'camera blocked for this page' : 'no camera found');
    });
  }
  function cameraOff(why) {
    cameraOn = false;
    $('cam').hidden = true;
    $('scene').removeAttribute('hidden');
    /* Said plainly, once, in META's place — the topic requires it. */
    showText();
    say(['Camera off — ' + why + '. Showing a drawn scene.']);
  }

  /* ---------- capture -------------------------------------------------- */

  function sourceSize() {
    var v = $('cam');
    if (cameraOn && v.videoWidth) return { el: v, w: v.videoWidth, h: v.videoHeight };
    return null;
  }

  function drawTo(src, w, h, max) {
    var size = fitWithin(w, h, max);
    var c = document.createElement('canvas');
    c.width = size.w; c.height = size.h;
    c.getContext('2d').drawImage(src, 0, 0, size.w, size.h);
    return c;
  }

  /* The drawn scene as an image, so capture still demonstrates with
     the camera off. */
  function sceneImage() {
    return new Promise(function (resolve, reject) {
      var svg = $('scene');
      var xml = new XMLSerializer().serializeToString(svg);
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    });
  }

  /* The current view as a drawable: the camera frame, or the drawn
     scene when the camera is off. */
  function currentSource() {
    var live = sourceSize();
    return live ? Promise.resolve(live) : sceneImage().then(function (img) { return { el: img, w: 1200, h: 800 }; });
  }

  /* Build the request at each scan size, smallest needed to fit the
     /chat cap (the last size if none fits). */
  function fittedBody(src, makeBody) {
    var bodies = [];
    for (var i = 0; i < SCAN_STEPS.length; i++) {
      var st = SCAN_STEPS[i];
      bodies.push(makeBody(drawTo(src.el, src.w, src.h, st.max).toDataURL('image/jpeg', st.quality)));
      if (bodies[i].length <= CHAT_BODY_CAP) break;
    }
    return bodies[chooseScanStep(bodies.map(function (b) { return b.length; }))];
  }

  function askFree(text) {
    var t = chipsFor(E, state, wearer()).task ? E.taskById(state, wearer().currentTaskId) : null;
    var title = t ? t.title : null;
    say(['…']);
    currentSource().then(function (src) {
      return sendAsk(fetch.bind(window), C.CHAT_URL, fittedBody(src, function (url) { return askBody(text, url, title); }))
        .catch(function (e) {
          /* Frame too big for the Worker's cap: ask again with words only. */
          if (e && e.message === 'too-large') return sendAsk(fetch.bind(window), C.CHAT_URL, askBody(text, null, title));
          throw e;
        });
    }, function () {
      return sendAsk(fetch.bind(window), C.CHAT_URL, askBody(text, null, title));
    }).then(function (res) {
      say([res.text]);
    }).catch(function (e) {
      say([(e && e.userMessage) || 'No answer — something went wrong.']);
    });
  }

  function capture() {
    currentSource().then(function (src) {
      var shown = drawTo(src.el, src.w, src.h, SHOW_MAX);
      var pic = $('capture');
      pic.src = shown.toDataURL('image/jpeg', SHOW_QUALITY);
      pic.hidden = false;
      pic.classList.remove('gone');
      clearTimeout(captureTimer);
      captureTimer = setTimeout(function () { pic.classList.add('gone'); }, 4000);

      /* Scan copy: step down until the body fits the /chat cap. */
      var body = fittedBody(src, scanBody);
      showText();
      employee(null);
      say(['Reading the photo…']);
      return sendScan(fetch.bind(window), C.CHAT_URL, body).then(function (res) {
        say(res.flags ? flagLines(res.flags) : [res.text]);
      });
    }).catch(function (e) {
      showText();
      say([(e && e.userMessage) || 'Capture failed — nothing was sent.']);
    });
  }

  /* ---------- talk: the mic, warehouse-mic.js unchanged --------------- */
  /* It is attached to an invisible key (#talkKey). Holding on the view,
     R2, or X-on-Talk drive it through the keyboard hold it supports. */

  function talkKey(type) {
    $('talkKey').dispatchEvent(new KeyboardEvent(type, { code: 'Space', key: ' ', bubbles: true }));
  }
  if (root.WitnessMic) {
    root.WitnessMic.attach($('talkKey'), {
      onListening: function () { cue('listening…'); },
      onSending: function () { cue('…'); },
      onText: function (t) { cue(null); onSpeech(t); },
      onError: function (m) { cue(null); showText(); say([m]); },
      onIdle: function () { cue(null); }
    });
  }

  /* ---------- touch on the view: hold = talk, double-tap = capture ---- */

  var downAt = null, lastTapAt = null, holdTimer = null, holding = false;
  var view = $('view');
  view.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    downAt = Date.now();
    holding = false;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(function () { holding = true; talkKey('keydown'); }, HOLD_MS);
  });
  function touchEnd() {
    if (downAt == null) return;
    clearTimeout(holdTimer);
    var now = Date.now();
    if (holding) { holding = false; talkKey('keyup'); downAt = null; return; }
    var kind = touchKind(downAt, now, lastTapAt);
    if (kind === 'double') { lastTapAt = null; capture(); }
    else lastTapAt = now;
    downAt = null;
  }
  view.addEventListener('pointerup', touchEnd);
  view.addEventListener('pointercancel', touchEnd);
  view.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* ---------- controller ---------------------------------------------- */
  /* R2 = hold to talk. Stick / D-pad moves focus between Talk and
     Capture; X activates it (hold X on Talk to talk). The focus shows
     as two faint floating words — never a box — that appear only
     while the controller is being used, then fade. */

  var focus = DEFAULT_FOCUS, prevPad = null, padIndex = null, activeOnTalk = false, hintTimer = null;
  function showFocus() {
    ACTIONS.forEach(function (a, i) { $('hint-' + a).classList.toggle('on', i === focus); });
    $('padHint').hidden = false;
    $('padHint').classList.remove('gone');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { $('padHint').classList.add('gone'); }, 2500);
  }
  function padState(gp) {
    $('padLine').textContent = gp ? 'Controller: ' + padName(gp.id) + ' — connected.' : 'No controller connected (optional).';
  }
  window.addEventListener('gamepadconnected', function (e) { padIndex = e.gamepad.index; padState(e.gamepad); });
  window.addEventListener('gamepaddisconnected', function () { padIndex = null; prevPad = null; padState(null); });

  function loop() {
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var gp = null;
    if (padIndex != null && pads[padIndex]) gp = pads[padIndex];
    else for (var i = 0; i < pads.length; i++) if (pads[i]) { gp = pads[i]; padIndex = i; padState(gp); break; }
    if (gp) {
      var cur = readPad(gp);
      if (opened) {
        padEvents(prevPad, cur).forEach(function (ev) {
          if (ev === 'talk-down') talkKey('keydown');
          else if (ev === 'talk-up') talkKey('keyup');
          else if (ev.indexOf('move-') === 0) { focus = moveFocus(focus, ev.slice(5)); showFocus(); }
          else if (ev === 'activate-down') {
            showFocus();
            if (ACTIONS[focus] === 'talk') { activeOnTalk = true; talkKey('keydown'); }
            else capture();
          } else if (ev === 'activate-up' && activeOnTalk) { activeOnTalk = false; talkKey('keyup'); }
        });
      } else if (padEvents(prevPad, cur).indexOf('activate-down') !== -1) {
        openView(); /* X on the start screen opens the view */
      }
      prevPad = cur;
    }
    requestAnimationFrame(loop);
  }

  $('openBtn').addEventListener('click', openView);
  renderPick();
  padState(null);
  requestAnimationFrame(loop);
})(typeof window !== 'undefined' ? window : globalThis);
