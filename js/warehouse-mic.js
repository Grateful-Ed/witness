/* =====================================================================
   warehouse-mic.js — hold-to-talk for the Warehouse page.

   Same transcription route and audio shape as module one (js/voice.js,
   frozen, not loaded here): record while the button is held, convert
   to 16 kHz mono 16-bit WAV in the page, POST it multipart (field
   "audio") to the witness Worker's /asr. The transcript text is handed
   back to the caller — this file decides nothing about what was said.

   WitnessMic.attach(button, {
     onListening(), onSending(), onText(text), onError(message), onIdle()
   })
   ===================================================================== */
(function () {
  'use strict';

  var C = window.WitnessConverse;
  var busyGlobal = false; /* one mic at a time on this page */

  function pickMimeType() {
    var c = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
    if (typeof MediaRecorder === 'undefined') return '';
    for (var i = 0; i < c.length; i++) if (MediaRecorder.isTypeSupported(c[i])) return c[i];
    return '';
  }

  function encodeWav(samples, rate) {
    var buffer = new ArrayBuffer(44 + samples.length * 2);
    var v = new DataView(buffer);
    function w(off, s) { for (var i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); }
    w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true);
    w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, samples.length * 2, true);
    for (var i = 0; i < samples.length; i++) {
      var s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  function blobToWav(blob) {
    return blob.arrayBuffer().then(function (buf) {
      var AC = window.AudioContext || window.webkitAudioContext;
      var ctx = new AC();
      return ctx.decodeAudioData(buf).then(function (d) { return ctx.close().then(function () { return d; }); });
    }).then(function (decoded) {
      var rate = 16000;
      var off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
      var src = off.createBufferSource();
      src.buffer = decoded;
      src.connect(off.destination);
      src.start();
      return off.startRendering();
    }).then(function (r) { return encodeWav(r.getChannelData(0), 16000); });
  }

  function transcribe(wav) {
    var form = new FormData();
    form.append('audio', wav, 'talk.wav');
    return fetch(C.ASR_URL, { method: 'POST', body: form }).then(function (r) {
      if (r.status === 429) throw new Error('Didn\'t catch that — today\'s call limit is used up. Use the buttons.');
      if (!r.ok) throw new Error('Didn\'t catch that — transcription answered with an error (HTTP ' + r.status + '). Nothing was done.');
      return r.json().catch(function () { throw new Error('Didn\'t catch that — the reply was unreadable. Nothing was done.'); });
    }, function () {
      throw new Error('Didn\'t catch that — no connection to transcription. Nothing was done.');
    }).then(function (j) {
      var text = C.extractTranscript(j);
      if (!text) throw new Error('Didn\'t catch any words. Hold the button, speak, then let go. Nothing was done.');
      return text;
    });
  }

  function attach(btn, h) {
    var stream = null, recorder = null, chunks = [], recording = false;

    function stopStream() {
      if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    }

    function start() {
      if (recording || busyGlobal) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
        h.onError('This browser can\'t record audio. Use the buttons.');
        return;
      }
      busyGlobal = true;
      recording = true;
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
        stream = s;
        if (!recording) { stopStream(); busyGlobal = false; h.onIdle(); return; } /* let go before the mic opened */
        chunks = [];
        var mt = pickMimeType();
        recorder = mt ? new MediaRecorder(stream, { mimeType: mt }) : new MediaRecorder(stream);
        recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        recorder.onstop = stopped;
        recorder.start();
        h.onListening();
      }).catch(function (e) {
        recording = false;
        busyGlobal = false;
        stopStream();
        h.onError(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
          ? 'Microphone is blocked for this page. Allow it in browser settings, or use the buttons.'
          : 'Microphone didn\'t start. Use the buttons.');
      });
    }

    function stop() {
      if (!recording) return;
      recording = false;
      if (!recorder) return; /* mic still opening — start() cleans up */
      h.onSending();
      try { recorder.stop(); } catch (e) { stopped(); }
    }

    function stopped() {
      var blob = new Blob(chunks, { type: (recorder && recorder.mimeType) || 'audio/webm' });
      chunks = [];
      recorder = null;
      stopStream();
      if (!blob.size) { busyGlobal = false; h.onError('That came out empty. Hold the button while you talk.'); return; }
      blobToWav(blob).then(transcribe).then(function (text) {
        busyGlobal = false;
        h.onText(text);
      }).catch(function (e) {
        busyGlobal = false;
        h.onError((e && e.message && /^Didn/.test(e.message)) ? e.message : 'Didn\'t catch that — the recording couldn\'t be read. Nothing was done.');
      });
    }

    btn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      try { btn.setPointerCapture(e.pointerId); } catch (err) {}
      start();
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (ev) {
      btn.addEventListener(ev, stop);
    });
    btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    btn.addEventListener('keydown', function (e) {
      if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) { e.preventDefault(); start(); }
    });
    btn.addEventListener('keyup', function (e) {
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); stop(); }
    });
  }

  window.WitnessMic = { attach: attach };
})();
