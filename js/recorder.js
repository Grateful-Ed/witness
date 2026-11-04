/* =====================================================================
   recorder.js — a Record button for the glasses view (William,
   2026-11-04, filming night). He has no presentation mic: the phone
   running the glasses IS his mic, and the take is how he reviews the
   actual glasses session afterward.

   What it records: the camera's own feed (the wearer's point of
   view) plus the microphone — one MediaRecorder take, saved on the
   device. What it does NOT record: the glasses overlay itself (the
   chips and text lines are page, not camera). For the overlay, the
   phone's own screen recorder is the tool; this button says so.

   Nothing is uploaded. The take lives in page memory until the
   wearer taps Save, which downloads the file like any browser
   download. Isolated on purpose: this module never touches the
   glasses' own state, mic, or camera plumbing — if recording fails,
   the glasses work exactly as before.
   ===================================================================== */
(function (root) {
  'use strict';

  var VIDEO_TYPES = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  var AUDIO_TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/aac'];

  /* First supported mime wins; video preferred, audio the fallback
     (the mic is the hard requirement — a take with no picture still
     carries his narration). */
  function pickMime(isSupported) {
    var i;
    for (i = 0; i < VIDEO_TYPES.length; i++) if (isSupported(VIDEO_TYPES[i])) return { kind: 'video', mime: VIDEO_TYPES[i] };
    for (i = 0; i < AUDIO_TYPES.length; i++) if (isSupported(AUDIO_TYPES[i])) return { kind: 'audio', mime: AUDIO_TYPES[i] };
    return { kind: 'none', mime: '' };
  }

  function extFor(mime) {
    if (/mp4/.test(mime)) return 'mp4';
    if (/aac/.test(mime)) return 'm4a';
    return 'webm';
  }

  function fmtClock(totalSeconds) {
    var s = Math.max(0, Math.floor(totalSeconds || 0));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  /* The recorder proper. deps injects {getUserMedia, MediaRecorder,
     now} so the state machine is testable without a device. */
  function createRecorder(deps) {
    var gum = deps.getUserMedia, MR = deps.MediaRecorder, now = deps.now || function () { return Date.now(); };
    var state = 'idle';           /* idle | starting | recording | stopped | error */
    var rec = null, stream = null, chunks = [], startedAt = 0, take = null, note = '';

    function stopTracks() {
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }

    function start() {
      if (state === 'recording' || state === 'starting') return { ok: false, reason: 'already recording' };
      if (!gum || !MR) { state = 'error'; note = 'Recording is not supported in this browser.'; return { ok: false, reason: note }; }
      var pick = pickMime(function (t) { return MR.isTypeSupported ? MR.isTypeSupported(t) : false; });
      if (pick.kind === 'none') { state = 'error'; note = 'This browser cannot record audio or video here.'; return { ok: false, reason: note }; }
      state = 'starting'; note = '';
      var want = pick.kind === 'video'
        ? gum({ video: { facingMode: 'environment' }, audio: true })
        : gum({ audio: true });
      return want.then(function (s) {
        stream = s; chunks = [];
        rec = pick.mime ? new MR(stream, { mimeType: pick.mime }) : new MR(stream);
        rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = function () {
          var blob = new Blob(chunks, { type: pick.mime || 'video/webm' });
          take = { blob: blob, mime: pick.mime, kind: pick.kind, ext: extFor(pick.mime), seconds: (now() - startedAt) / 1000 };
          state = 'stopped'; stopTracks();
        };
        startedAt = now();
        rec.start(1000);
        state = 'recording';
        return { ok: true, kind: pick.kind, mime: pick.mime };
      }).catch(function () {
        /* Video asked, camera refused: the mic alone still serves. */
        if (pick.kind === 'video') {
          return gum({ audio: true }).then(function (s2) {
            stream = s2; chunks = [];
            var apick = pickMime(function (t) { return MR.isTypeSupported ? MR.isTypeSupported(t) : false; });
            rec = apick.mime ? new MR(stream, { mimeType: apick.mime }) : new MR(stream);
            rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
            rec.onstop = function () {
              var blob = new Blob(chunks, { type: apick.mime || 'audio/webm' });
              take = { blob: blob, mime: apick.mime, kind: 'audio', ext: extFor(apick.mime), seconds: (now() - startedAt) / 1000 };
              state = 'stopped'; stopTracks();
            };
            startedAt = now();
            rec.start(1000);
            state = 'recording';
            return { ok: true, kind: 'audio', mime: apick.mime, note: 'Camera refused — recording audio only.' };
          }).catch(function () {
            state = 'error'; note = 'The camera and mic were refused — nothing is recording.'; stopTracks();
            return { ok: false, reason: note };
          });
        }
        state = 'error'; note = 'The mic was refused — nothing is recording.'; stopTracks();
        return { ok: false, reason: note };
      });
    }

    function stop() {
      if (state !== 'recording' || !rec) return { ok: false, reason: 'not recording' };
      rec.stop();
      return { ok: true };
    }

    return {
      start: start, stop: stop,
      state: function () { return state; },
      note: function () { return note; },
      take: function () { return take; },
      elapsed: function () { return state === 'recording' ? (now() - startedAt) / 1000 : (take ? take.seconds : 0); }
    };
  }

  var api = { pickMime: pickMime, extFor: extFor, fmtClock: fmtClock, createRecorder: createRecorder, VIDEO_TYPES: VIDEO_TYPES, AUDIO_TYPES: AUDIO_TYPES };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.WitnessRecorder = api;

  /* ---------- browser: the button, injected, self-contained -------- */
  if (typeof document === 'undefined' || !root.navigator) return;
  var boot = function () {
    if (document.getElementById('recBtn')) return;
    var rec = createRecorder({
      getUserMedia: (root.navigator.mediaDevices && root.navigator.mediaDevices.getUserMedia)
        ? root.navigator.mediaDevices.getUserMedia.bind(root.navigator.mediaDevices) : null,
      MediaRecorder: root.MediaRecorder || null,
      now: function () { return Date.now(); }
    });
    var btn = document.createElement('button');
    btn.id = 'recBtn'; btn.type = 'button'; btn.textContent = '● Record';
    btn.style.cssText = 'position:fixed;top:10px;right:10px;z-index:9999;padding:12px 18px;border-radius:999px;border:2px solid #e5484d;background:#1c1c22;color:#fff;font:600 16px/1 system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.45);';
    var panel = document.createElement('div');
    panel.id = 'recPanel'; panel.hidden = true;
    panel.style.cssText = 'position:fixed;left:10px;right:10px;bottom:10px;z-index:9999;background:#141419;color:#f2f2f2;border:1px solid #3a3a44;border-radius:12px;padding:12px;font:14px/1.45 system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.5);';
    document.body.appendChild(btn); document.body.appendChild(panel);
    var timer = null, url = null;

    function showPanel(html) { panel.innerHTML = html; panel.hidden = false; }
    btn.addEventListener('click', function () {
      if (rec.state() === 'recording') {
        rec.stop();
        clearInterval(timer);
        btn.textContent = '● Record'; btn.style.background = '#1c1c22';
        setTimeout(function () {
          var t = rec.take();
          if (!t) { showPanel('Recording stopped, but no take was captured.'); return; }
          if (url) URL.revokeObjectURL(url);
          url = URL.createObjectURL(t.blob);
          var media = t.kind === 'video'
            ? '<video controls playsinline src="' + url + '" style="width:100%;border-radius:8px;background:#000"></video>'
            : '<audio controls src="' + url + '" style="width:100%"></audio>';
          showPanel(media +
            '<p style="margin:8px 0 4px">Take recorded — ' + fmtClock(t.seconds) + ', ' + (t.kind === 'video' ? 'camera + mic' : 'mic only') +
            '. It lives on this device only; nothing was uploaded.</p>' +
            '<p style="margin:4px 0"><a href="' + url + '" download="witness-glasses-take.' + t.ext + '" style="color:#8ab8ff;font-weight:600">Save the take</a>' +
            ' &nbsp;·&nbsp; <a href="#" id="recDismiss" style="color:#bbb">Dismiss</a></p>' +
            '<p style="margin:4px 0 0;color:#999">This records the camera and your voice — not the glasses\' text overlay. For the overlay too, use the phone\'s own screen recorder.</p>');
          var d = document.getElementById('recDismiss');
          if (d) d.addEventListener('click', function (e) { e.preventDefault(); panel.hidden = true; });
        }, 350);
        return;
      }
      panel.hidden = true;
      btn.textContent = '… starting';
      Promise.resolve(rec.start()).then(function (r) {
        if (!r || !r.ok) {
          btn.textContent = '● Record';
          showPanel(rec.note() || 'Recording could not start.');
          return;
        }
        btn.style.background = '#e5484d';
        btn.textContent = '■ Stop 0:00';
        timer = setInterval(function () { btn.textContent = '■ Stop ' + fmtClock(rec.elapsed()); }, 500);
        if (r.note) showPanel(r.note);
      });
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
