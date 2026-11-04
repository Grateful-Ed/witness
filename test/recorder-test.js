/* recorder-test.js — the glasses Record button (William, 2026-11-04):
   mime picking, the clock, and the recorder state machine driven by
   fakes. The module must stay isolated: it never touches the glasses'
   state or storage (scan-checked below). */
'use strict';
const fs = require('fs');
const path = require('path');
const R = require(path.join(__dirname, '..', 'js', 'recorder.js'));
let pass = 0, fail = 0;
function check(name, ok) { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name); } }
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/* --- mime picking ------------------------------------------------------ */
check('mime: mp4 video wins when supported', eq(R.pickMime(t => t === 'video/mp4'), { kind: 'video', mime: 'video/mp4' }));
check('mime: webm video when mp4 is not', R.pickMime(t => /webm/.test(t)).mime.indexOf('video/webm') === 0);
check('mime: audio fallback when no video type is supported', eq(R.pickMime(t => t === 'audio/mp4'), { kind: 'audio', mime: 'audio/mp4' }));
check('mime: nothing supported is an honest none', eq(R.pickMime(() => false), { kind: 'none', mime: '' }));
check('ext: mp4 -> mp4, webm -> webm, aac -> m4a', R.extFor('video/mp4') === 'mp4' && R.extFor('video/webm') === 'webm' && R.extFor('audio/aac') === 'm4a');

/* --- the clock --------------------------------------------------------- */
check('clock: 0 -> 0:00', R.fmtClock(0) === '0:00');
check('clock: 9 -> 0:09', R.fmtClock(9) === '0:09');
check('clock: 65 -> 1:05', R.fmtClock(65) === '1:05');
check('clock: 600 -> 10:00', R.fmtClock(600) === '10:00');

/* --- fakes -------------------------------------------------------------- */
function fakeStream() { return { getTracks: () => [{ stop() {} }] }; }
function FakeMR(supported) {
  return class {
    constructor(stream, opts) { this.opts = opts || {}; FakeMR.last = this; }
    static isTypeSupported(t) { return supported.indexOf(t) !== -1; }
    start() {}
    stop() { if (this.ondataavailable) this.ondataavailable({ data: new Blob(['x']) }); if (this.onstop) this.onstop(); }
  };
}
let clock = 100000;
const now = () => clock;

(async function () {
  /* happy path: video + audio */
  const MRv = FakeMR(['video/mp4']);
  const rec = R.createRecorder({ getUserMedia: () => Promise.resolve(fakeStream()), MediaRecorder: MRv, now });
  const r1 = await rec.start();
  check('recorder: video start ok, state recording', r1.ok === true && r1.kind === 'video' && rec.state() === 'recording');
  const r2 = await rec.start();
  check('recorder: a second start is refused while recording', r2.ok === false);
  clock += 42000;
  check('recorder: elapsed rides the injected clock', Math.round(rec.elapsed()) === 42);
  check('recorder: stop ok', rec.stop().ok === true);
  const take = rec.take();
  check('recorder: the take is assembled on stop (mime, kind, ext, seconds)', take && take.mime === 'video/mp4' && take.kind === 'video' && take.ext === 'mp4' && Math.round(take.seconds) === 42 && rec.state() === 'stopped');
  check('recorder: stop when not recording is refused', rec.stop().ok === false);

  /* camera refused -> audio-only fallback */
  let calls = 0;
  const recA = R.createRecorder({
    getUserMedia: (c) => { calls++; return c.video ? Promise.reject(new Error('no cam')) : Promise.resolve(fakeStream()); },
    MediaRecorder: FakeMR(['video/mp4', 'audio/mp4']), now });
  const ra = await recA.start();
  check('recorder: camera refused falls back to audio only, and says so', ra.ok === true && ra.kind === 'audio' && /audio only/.test(ra.note || '') && calls === 2);
  recA.stop();
  check('recorder: the audio take carries the audio mime', recA.take() && recA.take().kind === 'audio');

  /* everything refused -> honest error */
  const recE = R.createRecorder({ getUserMedia: () => Promise.reject(new Error('denied')), MediaRecorder: FakeMR(['video/mp4']), now });
  const re = await recE.start();
  check('recorder: refused camera and mic is an honest error, not a crash', re.ok === false && recE.state() === 'error' && /refused/.test(recE.note()));

  /* no MediaRecorder at all */
  const recN = R.createRecorder({ getUserMedia: () => Promise.resolve(fakeStream()), MediaRecorder: null, now });
  const rn = recN.start();
  check('recorder: no MediaRecorder is reported as unsupported', rn.ok === false && /not supported/.test(recN.note()));

  /* --- isolation + wiring ---------------------------------------------- */
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'recorder.js'), 'utf8');
  check('isolation: the recorder never touches engine state or storage', !/saveState|loadState|localStorage/.test(src));
  const html = fs.readFileSync(path.join(__dirname, '..', 'glasses.html'), 'utf8');
  check('wiring: glasses.html loads recorder.js exactly once, after glasses.js',
    (html.match(/js\/recorder\.js/g) || []).length === 1 && html.indexOf('js/recorder.js') > html.indexOf('js/glasses.js'));

  console.log('recorder: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
