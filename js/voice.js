/* =====================================================================
   voice.js — Witness Step 1, first half: push-to-talk + transcription.

   Hold the button -> the mic records -> release -> the audio goes to
   the project proxy's /asr route, which forwards it to Muse Voice
   Transcribe (Meta Model API). The transcript comes back and is shown
   VERBATIM — labeled as the spoken scan, unedited — then handed to
   record.js, which structures it.

   Two format facts, from Meta's own Muse Voice Transcribe guide:
   - The one-shot endpoint (POST https://api.meta.ai/v1/asr/transcribe)
     takes mono 16-bit PCM audio at 24 kHz or 16 kHz; its guide says to
     convert anything else first. A browser's MediaRecorder produces
     webm/opus or mp4, so the recording is converted to 16 kHz mono WAV
     here, in the page, before upload.
   - Its default mode is PUSH_TO_TALK — the speaker delimits the turn.
     That is this button.

   The API key is never in this page. It lives in the Cloudflare Worker
   behind the proxy; this page only ever talks to the proxy.
   ===================================================================== */
(function () {
  'use strict';

  var ASR_URL = 'https://witness.e-william-harris96.workers.dev/asr';

  var btn, label, statusEl, errorBox, transcriptBox, transcriptText;
  var stream = null, recorder = null, chunks = [], recording = false, busy = false;

  function setStatus(text, mode) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = 'status' + (mode ? ' ' + mode : '');
  }

  function showError(message) {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.hidden = false;
  }
  function clearError() {
    if (!errorBox) return;
    errorBox.hidden = true;
    errorBox.textContent = '';
  }

  function pickMimeType() {
    var candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
    if (typeof MediaRecorder === 'undefined') return '';
    for (var i = 0; i < candidates.length; i++) {
      if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
    }
    return '';
  }

  /* Decode the recorded blob and re-encode it as 16 kHz mono 16-bit
     PCM WAV — the shape the one-shot transcribe endpoint documents. */
  function blobToWav(blob) {
    return blob.arrayBuffer().then(function (buf) {
      var AC = window.AudioContext || window.webkitAudioContext;
      var ctx = new AC();
      return ctx.decodeAudioData(buf).then(function (decoded) {
        return ctx.close().then(function () { return decoded; });
      });
    }).then(function (decoded) {
      var rate = 16000;
      var len = Math.max(1, Math.ceil(decoded.duration * rate));
      var off = new OfflineAudioContext(1, len, rate);
      var src = off.createBufferSource();
      src.buffer = decoded;
      src.connect(off.destination);
      src.start();
      return off.startRendering();
    }).then(function (rendered) {
      return encodeWav(rendered.getChannelData(0), 16000);
    });
  }

  function encodeWav(samples, rate) {
    var buffer = new ArrayBuffer(44 + samples.length * 2);
    var v = new DataView(buffer);
    function wstr(off, s) { for (var i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); }
    wstr(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true);
    wstr(8, 'WAVE'); wstr(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    wstr(36, 'data'); v.setUint32(40, samples.length * 2, true);
    for (var i = 0; i < samples.length; i++) {
      var s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  /* Pull the transcript text out of the ASR response. The endpoint's
     reply carries the whole transcript plus a turns array; accept the
     plain shapes first, then rebuild from turns. Returns '' when the
     reply holds nothing readable — the caller treats that as failure,
     never as an empty scan. */
  function extractTranscript(j) {
    if (!j || typeof j !== 'object') return '';
    if (typeof j.transcript === 'string' && j.transcript.trim()) return j.transcript.trim();
    if (typeof j.text === 'string' && j.text.trim()) return j.text.trim();
    var inner = j.data || j.result;
    if (inner && typeof inner === 'object') {
      var t = extractTranscript(inner);
      if (t) return t;
    }
    if (Array.isArray(j.turns)) {
      var parts = [];
      j.turns.forEach(function (turn) {
        if (!turn) return;
        var s = turn.text || turn.transcript || '';
        if (typeof s === 'string' && s.trim()) parts.push(s.trim());
      });
      if (parts.length) return parts.join(' ');
    }
    return '';
  }

  function transcribe(wavBlob) {
    var form = new FormData();
    form.append('audio', wavBlob, 'scan.wav');
    return fetch(ASR_URL, { method: 'POST', body: form }).then(function (r) {
      if (r.status === 404 || r.status === 501) {
        var notLive = new Error('asr-not-live');
        notLive.userMessage = 'Transcription is not live yet: the proxy has no /asr route (it answered ' + r.status + '). That route is the one remaining setup step — see worker/README.md in the project repo. Nothing was transcribed.';
        throw notLive;
      }
      if (r.status === 429) {
        var cap = new Error('cap');
        cap.userMessage = 'Transcription is unavailable — today\'s call cap at the proxy is reached. Nothing was transcribed.';
        throw cap;
      }
      if (!r.ok) {
        var http = new Error('http ' + r.status);
        http.userMessage = 'Transcription failed: the proxy answered with an error (HTTP ' + r.status + '). Nothing was transcribed, and no record was built.';
        throw http;
      }
      return r.json().catch(function () {
        var bad = new Error('bad-json');
        bad.userMessage = 'Transcription answered in a shape this page could not read. Nothing was transcribed, and no record was built.';
        throw bad;
      });
    }).then(function (j) {
      var text = extractTranscript(j);
      if (!text) {
        var empty = new Error('empty');
        empty.userMessage = 'Transcription came back with no readable words in it. If you did speak, try again a little closer to the mic. No record was built.';
        throw empty;
      }
      return text;
    });
  }

  function stopStream() {
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
  }

  function setButton(state) {
    /* state: 'idle' | 'recording' | 'busy' */
    btn.classList.toggle('recording', state === 'recording');
    btn.disabled = state === 'busy';
    btn.setAttribute('aria-pressed', state === 'recording' ? 'true' : 'false');
    label.textContent =
      state === 'recording' ? 'Listening… release to send' :
      state === 'busy' ? 'Working…' : 'Hold to talk';
  }

  function startRecording() {
    if (recording || busy) return;
    clearError();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
      showError('This browser cannot record audio, so the spoken scan cannot start. Try a current phone browser (Safari or Chrome).');
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
      stream = s;
      chunks = [];
      var mt = pickMimeType();
      recorder = mt ? new MediaRecorder(stream, { mimeType: mt }) : new MediaRecorder(stream);
      recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = onStopped;
      recorder.start();
      recording = true;
      setButton('recording');
      setStatus('Recording. Describe the load; release the button when you are done.', 'busy');
    }).catch(function (e) {
      stopStream();
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
        showError('Microphone access was denied, so nothing was recorded. Allow the microphone for this page in your browser settings, then hold the button again.');
      } else if (e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError')) {
        showError('No microphone was found on this device, so nothing was recorded.');
      } else {
        showError('The microphone could not be started (' + ((e && e.name) || 'unknown error') + '). Nothing was recorded.');
      }
      setStatus('Ready when you are.', '');
    });
  }

  function stopRecording() {
    if (!recording || !recorder) return;
    recording = false;
    setButton('busy');
    setStatus('Sending your scan for transcription…', 'busy');
    try { recorder.stop(); } catch (e) { onStopped(); }
  }

  function onStopped() {
    var type = (recorder && recorder.mimeType) || 'audio/webm';
    var blob = new Blob(chunks, { type: type });
    chunks = [];
    recorder = null;
    stopStream();
    if (!blob.size) {
      setButton('idle');
      setStatus('Ready when you are.', '');
      showError('That recording came out empty — hold the button a moment longer while you speak, then release.');
      return;
    }
    busy = true;
    blobToWav(blob).then(transcribe).then(function (text) {
      busy = false;
      setButton('idle');
      transcriptText.textContent = text;
      transcriptBox.hidden = false;
      setStatus('Transcribed. Building the record…', 'busy');
      if (window.WitnessRecord && window.WitnessRecord.structure) {
        window.WitnessRecord.structure(text);
      } else {
        setStatus('Transcribed. The record builder did not load, so no record was built.', '');
      }
    }).catch(function (e) {
      busy = false;
      setButton('idle');
      if (e && e.userMessage) {
        setStatus('Transcription did not complete.', '');
        showError(e.userMessage);
      } else {
        setStatus('Transcription did not complete.', '');
        showError('Something failed between the recording and the transcript (' + ((e && e.message) || 'unknown error') + '). Nothing was transcribed, and no record was built.');
      }
    });
  }

  function init() {
    btn = document.getElementById('talkBtn');
    label = document.getElementById('talkLabel');
    statusEl = document.getElementById('status');
    errorBox = document.getElementById('errorBox');
    transcriptBox = document.getElementById('transcriptBox');
    transcriptText = document.getElementById('transcriptText');
    if (!btn) return;

    btn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      try { btn.setPointerCapture(e.pointerId); } catch (err) {}
      startRecording();
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (ev) {
      btn.addEventListener(ev, function () { stopRecording(); });
    });
    btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    /* Keyboard: hold Space or Enter while the button is focused. */
    btn.addEventListener('keydown', function (e) {
      if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) { e.preventDefault(); startRecording(); }
    });
    btn.addEventListener('keyup', function (e) {
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); stopRecording(); }
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else { init(); }
  }

  window.WitnessVoice = {
    setStatus: setStatus,
    showError: showError,
    extractTranscript: extractTranscript,
    _url: function () { return ASR_URL; }
  };
})();
