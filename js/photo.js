/* =====================================================================
   photo.js — Witness Step 2: the photo scan, the comparison, the OS&D.

   PURPOSE (William, locked 2026-10-28): Witness takes TWO scans of
   the same physical pallet — a HUMAN scan (Step 1: the receiver's
   spoken description, flagged) and a PHOTO scan (this step: Muse
   Spark reads photos of all four sides and flags what it sees) — and
   COMPARES them. Agreements are trusted; disagreements route to a
   human and become the OS&D exception report. The machine never
   signs off; a human decides.

   The photo scan reads the picked test load's contact sheet (FRONT /
   RIGHT / BACK / LEFT in one image) through the Witness Worker's
   /chat route with a vision message. The sheet is sent by its public
   URL — the same file the tester is looking at — so no image bytes
   pass through the page. (A real-pallet camera flow is a later UI
   step; the finish order was pipe first, UI second.)

   The comparison is a second /chat call over the two flag lists plus
   the human transcript. Every verdict is grounded in those inputs:
   agree / flag / cant-verify. The OS&D report is then assembled on
   this page from the verdicts — deterministically, no third model
   call — and saved through /save with kind "osd" when the receiver
   taps the button.

   Failure honesty, same as Step 1: if the photo scan or the
   comparison fails or answers in a shape this page cannot read, the
   page says so plainly and whatever already exists (the human scan,
   the photo flags) stays on screen. Nothing is invented to fill a
   gap.
   ===================================================================== */
(function () {
  'use strict';

  var WORKER_BASE = 'https://witness.e-william-harris96.workers.dev';
  var CHAT_URL = WORKER_BASE + '/chat';
  var SAVE_URL = WORKER_BASE + '/save';

  /* The test loads' contact sheets, at their public URLs. The photo
     scan reads exactly the file the tester sees on this page. */
  var SHEETS = {
    a: 'https://grateful-ed.github.io/witness/test-data/photos/load-a-container-cube.webp',
    b: 'https://grateful-ed.github.io/witness/test-data/photos/load-b-peaches-stack.webp'
  };
  var LOADS = {
    a: 'Load A — container cube',
    b: 'Load B — peaches stack'
  };
  var SIDES = ['front', 'right', 'back', 'left', 'overall'];

  var PHOTO_PROMPT = [
    'You are the photo scan for a warehouse receiving cross-check. You are shown one contact sheet with four panels of the SAME pallet load, labeled FRONT, RIGHT, BACK, LEFT. Read each panel separately and flag everything that would belong in a receiving or OS&D (overage, shortage & damage) report: damage, crushed or open cartons, torn or loose wrap, leaks or stains, leaning or shifted stack, loose items, broken pallet, anything out of place. Also flag a side that looks sound when that is genuinely what the panel shows.',
    '',
    'Return ONLY a JSON object in exactly this shape, no prose, no code fences:',
    '{"flags":[{"label":"...","side":"front|right|back|left|overall","detail":"..."}]}',
    '',
    '- "label": a short plain label in dock words (for example "Crushed cartons", "Torn wrap", "Side looks sound"). Invent labels from what you actually see.',
    '- "side": the panel the item is seen in. Use "overall" only for something true of the whole load.',
    '- "detail": one plain sentence saying exactly what you see and where. Do not infer causes. If a panel is partly obscured, say what you cannot verify in a flag labeled "Cannot verify" for that side.',
    '',
    'Rules: one flag per distinct item per side; report only what is visible in the image; never invent counts you cannot see.'
  ].join('\n');

  var COMPARE_PROMPT = [
    'You are the comparison step of a warehouse receiving cross-check. Two independent scans of the SAME pallet load were made: a HUMAN scan (a receiver\'s spoken description, with flags pulled from their words) and a PHOTO scan (flags from reading photos of all four sides). Compare them point by point.',
    '',
    'Return ONLY a JSON object in exactly this shape, no prose, no code fences:',
    '{"verdicts":[{"point":"...","verdict":"agree|flag|cant-verify","human":"...","photo":"...","note":"..."}]}',
    '',
    '- "point": the single claim or finding being judged, in a few plain words.',
    '- "verdict": "agree" when both scans say the same thing about the point (wording may differ). "flag" when the scans disagree — one contradicts the other (for example the human says a side looks fine and the photo shows damage on that side, or the human blames a side the photo shows sound) — OR when one scan reports something report-worthy, visible to both, that the other never mentions. "cant-verify" when the other scan cannot check the point at all (a human decision like rejecting the load, damage in a place the photo cannot see, a claim too vague to locate).',
    '- "human": the human flag\'s label and quote for this point, or "not mentioned".',
    '- "photo": the photo flag\'s label, side and detail for this point, or "not seen".',
    '- "note": one plain sentence saying why the verdict landed where it did.',
    '',
    'Rules: ground every verdict in the two flag lists given — never invent an observation neither scan made. One verdict per distinct point. A human\'s decision (reject, rewrap, send to repackaging) is always listed and is "cant-verify" for the photo scan — decisions are part of the record, not something a photo can confirm.'
  ].join('\n');

  /* Step 2 state. humanScan is captured when a run starts, so a new
     Step 1 scan mid-comparison cannot swap the inputs under it. */
  var humanScan = null;    /* {transcript, flags|null, loadKey, loadLabel} */
  var photoFlags = null;   /* [{label, side, detail}] */
  var verdicts = null;     /* [{point, verdict, human, photo, note}] */
  var osdText = '';
  var busy = false;
  var osdSaveTimer = null;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function showError(message) {
    if (window.WitnessVoice && window.WitnessVoice.showError) {
      window.WitnessVoice.showError(message);
    }
  }
  function setStatus(text, mode) {
    if (window.WitnessVoice && window.WitnessVoice.setStatus) {
      window.WitnessVoice.setStatus(text, mode);
    }
  }
  function $(id) { return document.getElementById(id); }

  /* ---------- /chat plumbing (same failure shape as record.js) --- */

  function parseJsonReply(j, what) {
    var text = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (!text) {
      var empty = new Error('empty');
      empty.userMessage = 'The ' + what + ' answered with nothing usable. Nothing was changed — what is already on screen still stands.';
      throw empty;
    }
    var cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      var bad = new Error('unparseable');
      bad.userMessage = 'The ' + what + ' answered, but not in a shape this page can read. Nothing was changed — what is already on screen still stands.';
      throw bad;
    }
  }

  function replyText(j) {
    return j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  }

  /* One /chat attempt. Spark reasons before it speaks and the
     reasoning bills against the token budget: a comparison measured
     8,628 reasoning tokens (2026-10-31), so each step asks for what
     it needs — photo 6000, comparison 16000 — under the Worker's
     ceiling. A reply that still comes back with no content (the
     model reasoned the whole budget away, or a transient empty) is
     retried exactly once before the caller hears about it. */
  function chat(messages, what, maxTokens, attempt) {
    return fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages, temperature: 0.2, max_tokens: maxTokens })
    }).then(function (r) {
      if (r.status === 429) {
        var cap = new Error('cap');
        cap.userMessage = 'The ' + what + ' is unavailable — today\'s call cap at the proxy is reached. What is already on screen still stands.';
        throw cap;
      }
      if (!r.ok) {
        var http = new Error('http ' + r.status);
        http.userMessage = 'The ' + what + ' could not be reached (the proxy answered with an error, HTTP ' + r.status + '). What is already on screen still stands.';
        throw http;
      }
      return r.json();
    }).then(function (j) {
      if (!replyText(j) && !attempt) return chat(messages, what, maxTokens, 1);
      return parseJsonReply(j, what);
    });
  }

  /* ---------- the photo scan -------------------------------------- */

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

  function askPhoto(loadKey) {
    return chat([
      { role: 'system', content: PHOTO_PROMPT },
      { role: 'user', content: [
        { type: 'text', text: 'Read this load\'s four sides and return the flags JSON.' },
        { type: 'image_url', image_url: { url: SHEETS[loadKey] } }
      ] }
    ], 'photo scan', 6000).then(function (parsed) {
      var flags = normalisePhotoFlags(parsed);
      if (!flags) {
        var wrong = new Error('unparseable');
        wrong.userMessage = 'The photo scan answered, but not in the flags shape this page can read.';
        throw wrong;
      }
      return flags;
    });
  }

  /* ---------- the comparison --------------------------------------- */

  function normaliseVerdicts(parsed) {
    var raw = parsed && Array.isArray(parsed.verdicts) ? parsed.verdicts : null;
    if (!raw) return null;
    var out = [];
    raw.forEach(function (v) {
      if (!v || typeof v !== 'object') return;
      var point = typeof v.point === 'string' ? v.point.trim() : '';
      var verdict = typeof v.verdict === 'string' ? v.verdict.trim().toLowerCase() : '';
      if (verdict !== 'agree' && verdict !== 'flag' && verdict !== 'cant-verify') return;
      out.push({
        point: point || 'Untitled point',
        verdict: verdict,
        human: typeof v.human === 'string' ? v.human : '',
        photo: typeof v.photo === 'string' ? v.photo : '',
        note: typeof v.note === 'string' ? v.note : ''
      });
    });
    return out;
  }

  function askCompare(scan, pFlags) {
    var user = 'HUMAN SCAN — transcript:\n' + scan.transcript +
      '\n\nHUMAN SCAN — flags:\n' + JSON.stringify(scan.flags || []) +
      '\n\nPHOTO SCAN — flags:\n' + JSON.stringify(pFlags);
    return chat([
      { role: 'system', content: COMPARE_PROMPT },
      { role: 'user', content: user }
    ], 'comparison', 16000).then(function (parsed) {
      var v = normaliseVerdicts(parsed);
      if (!v) {
        var wrong = new Error('unparseable');
        wrong.userMessage = 'The comparison answered, but not in the verdicts shape this page can read.';
        throw wrong;
      }
      return v;
    });
  }

  /* ---------- rendering --------------------------------------------- */

  function renderPhotoFlags(flags) {
    var box = $('photoFlags');
    box.innerHTML = '';
    box.appendChild(el('h3', 'subhead', 'What the photo scan flags'));
    SIDES.forEach(function (side) {
      var items = flags.filter(function (f) { return f.side === side; });
      if (!items.length) return;
      var group = el('div', 'side-group');
      group.appendChild(el('p', 'side-name', side === 'overall' ? 'Whole load' : side.charAt(0).toUpperCase() + side.slice(1) + ' side'));
      items.forEach(function (f) {
        var item = el('div', 'flag photo-flag');
        item.appendChild(el('p', 'flag-label', f.label));
        item.appendChild(el('p', 'flag-detail', f.detail));
        group.appendChild(item);
      });
      box.appendChild(group);
    });
    box.hidden = false;
  }

  var VERDICT_TEXT = { 'agree': 'Agree', 'flag': 'Flag', 'cant-verify': 'Can\'t verify' };

  function renderVerdicts(list) {
    var box = $('verdicts');
    box.innerHTML = '';
    box.appendChild(el('h3', 'subhead', 'The comparison'));
    var counts = { 'agree': 0, 'flag': 0, 'cant-verify': 0 };
    list.forEach(function (v) { counts[v.verdict]++; });
    box.appendChild(el('p', 'note',
      counts.agree + ' agreed · ' + counts.flag + ' flagged · ' + counts['cant-verify'] + ' can\'t verify. ' +
      'The flagged and unverified points are the OS&D report below.'));
    list.forEach(function (v) {
      var row = el('div', 'verdict verdict-' + v.verdict);
      var head = el('p', 'verdict-head');
      head.appendChild(el('span', 'chip chip-' + v.verdict, VERDICT_TEXT[v.verdict]));
      head.appendChild(el('span', 'verdict-point', v.point));
      row.appendChild(head);
      if (v.human) row.appendChild(el('p', 'verdict-line', 'You said: ' + v.human));
      if (v.photo) row.appendChild(el('p', 'verdict-line', 'Photo: ' + v.photo));
      if (v.note) row.appendChild(el('p', 'verdict-note', v.note));
      box.appendChild(row);
    });
    box.hidden = false;
  }

  /* ---------- the OS&D report --------------------------------------- */

  function buildOsd(scan, pFlags, list) {
    var lines = [];
    var flags = list.filter(function (v) { return v.verdict === 'flag'; });
    var unverified = list.filter(function (v) { return v.verdict === 'cant-verify'; });
    var agreed = list.filter(function (v) { return v.verdict === 'agree'; });
    lines.push('OS&D EXCEPTION REPORT — Witness');
    lines.push('Load: ' + (scan.loadLabel || 'Unlabeled pallet'));
    lines.push('When: ' + new Date().toISOString());
    lines.push('');
    lines.push('Receiver\'s spoken scan (verbatim):');
    lines.push(scan.transcript);
    lines.push('');
    lines.push('DISAGREEMENTS — a human settles these (' + flags.length + '):');
    if (!flags.length) lines.push('- None. The two scans agree on everything both could check.');
    flags.forEach(function (v) {
      lines.push('- ' + v.point);
      lines.push('  You said: ' + (v.human || '—'));
      lines.push('  Photo: ' + (v.photo || '—'));
      if (v.note) lines.push('  ' + v.note);
    });
    lines.push('');
    lines.push('COULD NOT VERIFY (' + unverified.length + '):');
    if (!unverified.length) lines.push('- None.');
    unverified.forEach(function (v) {
      lines.push('- ' + v.point + (v.note ? ' — ' + v.note : ''));
    });
    lines.push('');
    lines.push('CONFIRMED BY BOTH SCANS (' + agreed.length + '):');
    if (!agreed.length) lines.push('- None.');
    agreed.forEach(function (v) { lines.push('- ' + v.point); });
    lines.push('');
    lines.push('The machine never signs off — a human decides.');
    return lines.join('\n');
  }

  function renderOsd(text) {
    var box = $('osdBox');
    var pre = $('osdText');
    pre.textContent = text;
    box.hidden = false;
    var sb = $('osdSaveBtn');
    if (sb) { sb.disabled = false; sb.textContent = 'Save the OS&D report'; }
    var fb = $('osdFallback');
    if (fb) fb.hidden = true;
  }

  function saveOsd() {
    if (!osdText || !humanScan) return;
    var sb = $('osdSaveBtn');
    var payload = {
      load: humanScan.loadLabel || null,
      kind: 'osd',
      transcript: osdText,
      flags: [],
      verdicts: verdicts || [],
      savedAt: new Date().toISOString()
    };
    if (sb) { sb.disabled = true; sb.textContent = 'Saving…'; }
    fetch(SAVE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) {
        return { status: r.status, ok: r.ok, body: j };
      });
    }).then(function (res) {
      if (sb) sb.disabled = false;
      if (res.status === 200 && res.body && res.body.ok) {
        if (sb) sb.textContent = 'Saved.';
        setStatus('OS&D report saved.', 'done');
        if (osdSaveTimer) clearTimeout(osdSaveTimer);
        osdSaveTimer = setTimeout(function () {
          if (sb) sb.textContent = 'Save the OS&D report';
          osdSaveTimer = null;
        }, 3000);
        return;
      }
      showError('Saving the OS&D report failed (the storage route answered HTTP ' + res.status + '). The report is written out below so you can copy it — it is not lost.');
      showOsdFallback();
      if (sb) sb.textContent = 'Save the OS&D report';
    }).catch(function () {
      if (sb) sb.disabled = false;
      showError('Saving the OS&D report failed — the storage route could not be reached. The report is written out below so you can copy it — it is not lost.');
      showOsdFallback();
      if (sb) sb.textContent = 'Save the OS&D report';
    });
  }

  function showOsdFallback() {
    var fb = $('osdFallback');
    var ta = $('osdTextCopy');
    if (fb && ta) { ta.value = osdText; fb.hidden = false; }
  }

  /* ---------- the run ------------------------------------------------ */

  function setPhotoStatus(text) {
    var s = $('photoStatus');
    if (s) s.textContent = text;
  }

  function currentHumanScan() {
    var rec = window.WitnessRecord;
    if (!rec) return null;
    var transcript = typeof rec.getLastTranscript === 'function' ? rec.getLastTranscript() : '';
    if (!transcript) {
      var t = $('transcriptText');
      transcript = t ? t.textContent : '';
    }
    if (!transcript) return null;
    var load = typeof rec.getSelectedLoad === 'function' ? rec.getSelectedLoad() : null;
    return {
      transcript: transcript,
      flags: typeof rec.getLastFlags === 'function' ? rec.getLastFlags() : null,
      loadKey: load ? load.key : null,
      loadLabel: load ? load.label : null
    };
  }

  /* Run Step 2 for an explicit scan object (the live button passes
     the page's current scan; tests pass a fixture). Resolves when the
     OS&D is rendered; rejects after the error has been shown. */
  function runWithScan(scan) {
    if (busy) return Promise.reject(new Error('busy'));
    if (!scan || !scan.transcript) {
      showError('Step 2 needs a spoken scan first — hold the button and describe the load.');
      return Promise.reject(new Error('no-human-scan'));
    }
    if (!scan.loadKey || !SHEETS[scan.loadKey]) {
      showError('The photo scan needs a picked test load — it reads the same contact sheet you are looking at. Pick Load A or Load B above, then run Step 2. (Scanning a real pallet with the camera is a later step.)');
      setPhotoStatus('Pick a test load above so the photo scan has the same sheet you saw.');
      return Promise.reject(new Error('no-load'));
    }
    busy = true;
    humanScan = scan;
    photoFlags = null;
    verdicts = null;
    osdText = '';
    var btn = $('photoBtn');
    if (btn) btn.disabled = true;
    $('photoFlags').hidden = true;
    $('verdicts').hidden = true;
    $('osdBox').hidden = true;
    setStatus('Running the photo scan — reading all four sides…', 'busy');
    setPhotoStatus('Reading the ' + (LOADS[scan.loadKey] || 'load') + ' sheet, side by side…');
    return askPhoto(scan.loadKey).then(function (pFlags) {
      photoFlags = pFlags;
      renderPhotoFlags(pFlags);
      setStatus('Photo scan done. Comparing the two scans…', 'busy');
      setPhotoStatus('Comparing your scan against the photo scan…');
      return askCompare(scan, pFlags);
    }).then(function (list) {
      verdicts = list;
      renderVerdicts(list);
      osdText = buildOsd(scan, photoFlags, list);
      renderOsd(osdText);
      var flags = list.filter(function (v) { return v.verdict === 'flag'; }).length;
      setStatus(flags
        ? 'Compared. ' + flags + (flags === 1 ? ' disagreement' : ' disagreements') + ' to settle — the OS&D report is below. You decide.'
        : 'Compared. The two scans agree on everything both could check. You decide.', 'done');
      setPhotoStatus('Done. The comparison and the OS&D report are below.');
      busy = false;
      if (btn) btn.disabled = false;
      return { photoFlags: photoFlags, verdicts: verdicts, osd: osdText };
    }).catch(function (e) {
      busy = false;
      if (btn) btn.disabled = false;
      setStatus('Step 2 stopped partway.', '');
      setPhotoStatus('Step 2 stopped partway — see the message above. Your spoken scan still stands.');
      showError((e && e.userMessage) || 'Step 2 failed for a reason this page could not read. Your spoken scan still stands.');
      throw e;
    });
  }

  function runFromPage() {
    var scan = currentHumanScan();
    if (!scan) {
      showError('Step 2 needs a spoken scan first — hold the button and describe the load.');
      return;
    }
    runWithScan(scan).catch(function () { /* error already shown */ });
  }

  /* Panel state: named by record.js after a scan is structured and
     after the load pick changes, so the panel can say plainly what
     it is waiting for. */
  function refresh() {
    var box = $('step2Box');
    if (!box) return;
    var scan = currentHumanScan();
    box.hidden = false;
    if (!scan) {
      setPhotoStatus('Waiting for your spoken scan — Step 2 compares it against the photos.');
      return;
    }
    if (!scan.loadKey) {
      setPhotoStatus('Your scan is in. Pick the test load it belongs to above, and the photo scan can run.');
      return;
    }
    if (!busy && !verdicts) {
      setPhotoStatus('Ready — the photo scan will read the ' + LOADS[scan.loadKey] + ' sheet and compare it against your words.');
    }
  }

  function init() {
    var btn = $('photoBtn');
    if (btn) btn.addEventListener('click', runFromPage);
    var sb = $('osdSaveBtn');
    if (sb) sb.addEventListener('click', saveOsd);
    refresh();
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else { init(); }
  }

  window.WitnessPhoto = {
    runWithScan: runWithScan,
    refresh: refresh,
    PHOTO_PROMPT: PHOTO_PROMPT,
    COMPARE_PROMPT: COMPARE_PROMPT,
    _buildOsd: buildOsd,
    getState: function () {
      return { humanScan: humanScan, photoFlags: photoFlags, verdicts: verdicts, osd: osdText, busy: busy };
    }
  };
})();
