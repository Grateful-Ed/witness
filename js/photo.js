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

   SAM 3.1 TOGGLE (William, 2026-11-05; briefs/claude-brief-sam-toggle.md):
   a switch in the Step 2 panel, default OFF, remembered in this
   browser. OFF is exactly the flow above — no /segment calls, no
   record changes. ON fires SAM 3.1 through the Worker's /segment route
   in parallel with the photo scan, one call per concept, and attaches
   what it finds as segmentation EVIDENCE: boxes drawn over the sheet,
   counts per side handed to the comparison as part of the photo scan,
   the boxes saved on the OS&D record. SAM renders no verdicts — it
   measures; Spark compares; a human decides. A concept that fails
   gives no evidence and the record says so; it never blocks the scan.
   ===================================================================== */
(function () {
  'use strict';

  var WORKER_BASE = 'https://witness.e-william-harris96.workers.dev';
  var CHAT_URL = WORKER_BASE + '/chat';
  var SAVE_URL = WORKER_BASE + '/save';
  var SEGMENT_URL = WORKER_BASE + '/segment';

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

  /* ---------- SAM 3.1 evidence: constants -------------------------- */

  var SAM_CONCEPTS = ['cardboard box', 'shipping label', 'damaged cardboard box', 'torn plastic wrap'];
  var SAM_DAMAGE_CONCEPTS = ['damaged cardboard box', 'torn plastic wrap'];
  var SAM_STORE_KEY = 'witness.samEvidence';

  /* Contact-sheet geometry, read from the real files in
     test-data/photos/ (test/sam-toggle-test.js pins it against their
     headers). Both sheets are a clean 2 x 2 grid of equal panels:
     FRONT | RIGHT over BACK | LEFT, with a thin white gutter on the
     centre lines. SAM boxes arrive normalized 0–1000, so the split is
     at 500 on both axes. A box whose centre sits in the gutter band,
     or which straddles a centre line, belongs to no one panel and is
     attributed to "overall". A sheet not listed here is not a known
     grid: all its evidence is "overall" rather than a guess. */
  var SHEET_GEOMETRY = {
    a: { file: 'test-data/photos/load-a-container-cube.webp', w: 1920, h: 1280, grid: [['front', 'right'], ['back', 'left']] },
    b: { file: 'test-data/photos/load-b-peaches-stack.webp', w: 1600, h: 1600, grid: [['front', 'right'], ['back', 'left']] }
  };
  var GUTTER_LO = 485;
  var GUTTER_HI = 515;

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

  /* Appended to COMPARE_PROMPT only when the SAM toggle is ON; with
     the toggle OFF the comparison prompt is exactly the text above. */
  var COMPARE_SAM_RULE = [
    '',
    'SAM 3.1 EVIDENCE: the PHOTO SCAN may carry a block labeled "SAM 3.1 segmentation evidence". SAM 3.1 is a segmentation model run on the same photos: it only outlines and counts things matching a fixed concept ("cardboard box", "shipping label", "damaged cardboard box", "torn plastic wrap") and reports which side each was found on. Treat the block as part of the PHOTO scan — you may cite it in the "photo" field and the note (for example "SAM 3.1 outlined 2 damaged cardboard boxes on the front"). It is NOT a third scan and NOT a verdict: never give it a verdict of its own, never let it settle a point by itself, and never cite a number or location the block does not contain. A concept marked "unavailable" produced no evidence — say nothing about it.'
  ].join('\n');

  var LABEL_PROMPT = [
    'You are reading one crop of a contact-sheet photo. A segmentation model located what may be a shipping label in this crop. Read the text on it exactly as printed.',
    '',
    'Return ONLY a JSON object, no prose, no code fences: {"text":"..."}',
    'Use "" when there is no readable label text. Never guess characters you cannot see.'
  ].join('\n');
  var LABEL_CROP_MAX = 4;

  /* Step 2 state. humanScan is captured when a run starts, so a new
     Step 1 scan mid-comparison cannot swap the inputs under it. */
  var humanScan = null;    /* {transcript, flags|null, loadKey, loadLabel} */
  var photoFlags = null;   /* [{label, side, detail}] */
  var verdicts = null;     /* [{point, verdict, human, photo, note}] */
  var osdText = '';
  var busy = false;
  var osdSaveTimer = null;
  var samEvidence = null;  /* null when the toggle was OFF for this run */
  var runSeq = 0;

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

  /* The sheet travels as a data URL, not its public URL: the /chat
     service refuses to fetch this project's hosted images (live-proven
     2026-11-05, media_url_not_fetchable) — the same refusal /segment
     hit. No fallback to the URL: that is the broken path. */
  function askPhoto(loadKey) {
    return sheetDataUrl(loadKey).then(function (imageData) {
      if (!imageData) {
        var prep = new Error('sheet not encodable');
        prep.userMessage = 'The photo could not be prepared for the scan. Nothing was changed — what is already on screen still stands.';
        throw prep;
      }
      return chat([
        { role: 'system', content: PHOTO_PROMPT },
        { role: 'user', content: [
          { type: 'text', text: 'Read this load\'s four sides and return the flags JSON.' },
          { type: 'image_url', image_url: { url: imageData } }
        ] }
      ], 'photo scan', 6000);
    }).then(function (parsed) {
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

  function askCompare(scan, pFlags, sam) {
    var user = 'HUMAN SCAN — transcript:\n' + scan.transcript +
      '\n\nHUMAN SCAN — flags:\n' + JSON.stringify(scan.flags || []) +
      '\n\nPHOTO SCAN — flags:\n' + JSON.stringify(pFlags);
    if (sam) user += '\n\nPHOTO SCAN — SAM 3.1 segmentation evidence (measurement from the same photos; not a third scan, not a verdict):\n' + JSON.stringify(samEvidenceBlock(sam));
    return chat([
      { role: 'system', content: sam ? COMPARE_PROMPT + '\n' + COMPARE_SAM_RULE : COMPARE_PROMPT },
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

  /* ---------- SAM 3.1 evidence -------------------------------------- */

  /* Which panel a normalized 0–1000 box belongs to. Pure. */
  function sideForBox(loadKey, box) {
    var g = SHEET_GEOMETRY[loadKey];
    if (!g || !box) return 'overall';
    function band(lo, hi) { return lo < GUTTER_LO && hi > GUTTER_HI; }
    if (band(box.x1, box.x2) || band(box.y1, box.y2)) return 'overall';
    var cx = (box.x1 + box.x2) / 2;
    var cy = (box.y1 + box.y2) / 2;
    if ((cx >= GUTTER_LO && cx <= GUTTER_HI) || (cy >= GUTTER_LO && cy <= GUTTER_HI)) return 'overall';
    return g.grid[cy < 500 ? 0 : 1][cx < 500 ? 0 : 1];
  }

  /* /segment results -> the record's samEvidence. Pure. results is one
     entry per concept: {concept, matches} on success, {concept,
     failed: true} on any failure. Boxes keep only box + side + score. */
  function buildSamEvidence(loadKey, results) {
    var ev = { on: true, concepts: {} };
    SAM_CONCEPTS.forEach(function (concept) {
      var r = null;
      (results || []).forEach(function (x) { if (x && x.concept === concept) r = x; });
      if (!r || r.failed || !Array.isArray(r.matches)) {
        ev.concepts[concept] = { count: null, boxes: [], unavailable: true };
        return;
      }
      var boxes = [];
      r.matches.forEach(function (m) {
        var b = m && m.box;
        if (!b || [b.x1, b.y1, b.x2, b.y2].some(function (v) { return typeof v !== 'number' || !isFinite(v); })) return;
        var out = { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2, side: sideForBox(loadKey, b) };
        if (typeof m.score === 'number') out.score = m.score;
        boxes.push(out);
      });
      ev.concepts[concept] = { count: boxes.length, boxes: boxes };
    });
    return ev;
  }

  /* The evidence block the comparison sees: counts per concept per
     side, and each located damage item as a photo-side observation.
     Pure. */
  function samEvidenceBlock(ev) {
    var block = { counts: {}, located_damage: [] };
    SAM_CONCEPTS.forEach(function (concept) {
      var c = ev.concepts[concept];
      if (!c || c.unavailable) { block.counts[concept] = 'unavailable'; return; }
      var per = {};
      SIDES.forEach(function (s) { per[s] = 0; });
      c.boxes.forEach(function (b) { per[b.side] = (per[b.side] || 0) + 1; });
      per.total = c.count;
      block.counts[concept] = per;
      if (SAM_DAMAGE_CONCEPTS.indexOf(concept) !== -1) {
        c.boxes.forEach(function (b) {
          block.located_damage.push({ observation: concept, side: b.side, box: [b.x1, b.y1, b.x2, b.y2] });
        });
      }
    });
    return block;
  }

  /* The deterministic OS&D lines for SAM. Pure. [] when OFF. */
  function samOsdLines(ev) {
    if (!ev) return [];
    var missing = SAM_CONCEPTS.filter(function (c) { return !ev.concepts[c] || ev.concepts[c].unavailable; });
    if (missing.length === SAM_CONCEPTS.length) {
      return ['SAM 3.1 evidence was requested but unavailable — none was attached.'];
    }
    var cartons = ev.concepts['cardboard box'];
    var lines = [cartons && !cartons.unavailable
      ? 'SAM 3.1 evidence attached: ' + cartons.count + (cartons.count === 1 ? ' carton' : ' cartons') + ' segmented (concept "cardboard box").'
      : 'SAM 3.1 evidence attached (carton count unavailable).'];
    if (missing.length) {
      lines.push('SAM 3.1 evidence was requested but unavailable for: ' + missing.join(', ') + '.');
    }
    return lines;
  }

  /* The /save payload for the OS&D. Pure. With the toggle OFF (ev
     null) this is exactly the pre-toggle record. */
  function osdPayload(scan, text, list, savedAt, ev) {
    var payload = {
      load: scan.loadLabel || null,
      kind: 'osd',
      transcript: text,
      flags: [],
      verdicts: list || [],
      savedAt: savedAt
    };
    if (ev) payload.samEvidence = ev;
    return payload;
  }

  function samIsOn() {
    try { return window.localStorage.getItem(SAM_STORE_KEY) === 'on'; } catch (e) { return false; }
  }
  function setSamOn(on) {
    try { window.localStorage.setItem(SAM_STORE_KEY, on ? 'on' : 'off'); } catch (e) { /* the switch still works for this page */ }
  }

  /* The sheet as a data URL, for /segment: the segmentation service
     will not fetch this project's public image URLs (live-proven
     2026-11-05, HTTP 400 media_url_not_fetchable), so the image
     travels inside the request. Built from the sheet file on this
     origin — the geometry path the overlay uses — canvas-encoded as
     JPEG at natural size: SAM reads geometry from it, and the label
     crops still come from the full sheet image itself. Resolves null
     when the image cannot be encoded. */
  function sheetDataUrl(loadKey) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext('2d').drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        } catch (e) { resolve(null); }
      };
      img.onerror = function () { resolve(null); };
      img.src = SHEET_GEOMETRY[loadKey] ? SHEET_GEOMETRY[loadKey].file : SHEETS[loadKey];
    });
  }

  /* One /segment call. Never rejects: a failure is {concept, failed}. */
  function askSegment(imageData, concept) {
    return fetch(SEGMENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageData: imageData, concept: concept })
    }).then(function (r) {
      if (!r.ok) return { concept: concept, failed: true };
      return r.json().then(function (j) {
        if (!j || !Array.isArray(j.matches)) return { concept: concept, failed: true };
        return { concept: concept, matches: j.matches };
      });
    }).catch(function () { return { concept: concept, failed: true }; });
  }

  function runSam(loadKey) {
    return sheetDataUrl(loadKey).then(function (imageData) {
      if (!imageData) {
        return buildSamEvidence(loadKey, SAM_CONCEPTS.map(function (c) { return { concept: c, failed: true }; }));
      }
      return Promise.all(SAM_CONCEPTS.map(function (c) { return askSegment(imageData, c); }))
        .then(function (results) { return buildSamEvidence(loadKey, results); });
    });
  }

  var SAM_COLORS = {
    'cardboard box': '#4da3ff',
    'shipping label': '#f5c542',
    'damaged cardboard box': '#ff5a5a',
    'torn plastic wrap': '#c084fc'
  };

  /* Draw the boxes over the sheet. Display-only. */
  function renderSamOverlay(loadKey, ev) {
    var fig = $('samFigure');
    if (!fig) return;
    fig.innerHTML = '';
    fig.appendChild(el('h3', 'subhead', 'SAM 3.1 evidence — what it outlined'));
    var frame = el('div');
    frame.style.position = 'relative';
    frame.style.lineHeight = '0';
    var img = el('img');
    img.id = 'samSheet';
    img.src = SHEET_GEOMETRY[loadKey] ? SHEET_GEOMETRY[loadKey].file : SHEETS[loadKey];
    img.alt = 'The ' + (LOADS[loadKey] || 'load') + ' contact sheet with SAM 3.1 boxes drawn over it';
    img.style.width = '100%';
    img.style.display = 'block';
    frame.appendChild(img);
    var layer = el('div');
    layer.style.position = 'absolute';
    layer.style.inset = '0';
    layer.style.pointerEvents = 'none';
    SAM_CONCEPTS.forEach(function (concept) {
      var c = ev.concepts[concept];
      if (!c || c.unavailable) return;
      c.boxes.forEach(function (b) {
        var d = el('div', 'sam-box');
        d.setAttribute('data-concept', concept);
        d.title = concept;
        d.style.position = 'absolute';
        d.style.left = (b.x1 / 10) + '%';
        d.style.top = (b.y1 / 10) + '%';
        d.style.width = (Math.max(0, b.x2 - b.x1) / 10) + '%';
        d.style.height = (Math.max(0, b.y2 - b.y1) / 10) + '%';
        d.style.border = '2px solid ' + SAM_COLORS[concept];
        d.style.boxSizing = 'border-box';
        layer.appendChild(d);
      });
    });
    frame.appendChild(layer);
    fig.appendChild(frame);
    var legend = el('p', 'note');
    SAM_CONCEPTS.forEach(function (concept, i) {
      var c = ev.concepts[concept];
      var sw = el('span', null, '■ ');
      sw.style.color = SAM_COLORS[concept];
      legend.appendChild(sw);
      legend.appendChild(document.createTextNode(concept + ': ' +
        (c && !c.unavailable ? c.count : 'unavailable') + (i < SAM_CONCEPTS.length - 1 ? ' · ' : '')));
    });
    fig.appendChild(legend);
    fig.appendChild(el('p', 'note', 'SAM 3.1 only outlines and counts. It gives no verdicts — the comparison below and you do.'));
    fig.hidden = false;
  }

  /* Label crops (stretch): crop each located shipping label from the
     sheet (same-origin image, so the canvas is readable) and ask
     Spark to read it through /chat as a data: image — the same
     transport the BOL camera read already uses live. At most
     LABEL_CROP_MAX crops, highest SAM score first. Each crop is
     failure-tolerant; a failed or blank read adds nothing. */
  function sheetImage(loadKey) {
    return new Promise(function (resolve) {
      var img = $('samSheet');
      if (!img) { resolve(null); return; }
      if (img.complete && img.naturalWidth) { resolve(img); return; }
      img.addEventListener('load', function () { resolve(img); });
      img.addEventListener('error', function () { resolve(null); });
    });
  }

  function cropDataUrl(img, b) {
    var W = img.naturalWidth, H = img.naturalHeight;
    var pad = 0.15;
    var x1 = b.x1 * W / 1000, y1 = b.y1 * H / 1000, x2 = b.x2 * W / 1000, y2 = b.y2 * H / 1000;
    var pw = (x2 - x1) * pad, ph = (y2 - y1) * pad;
    x1 = Math.max(0, x1 - pw); y1 = Math.max(0, y1 - ph);
    x2 = Math.min(W, x2 + pw); y2 = Math.min(H, y2 + ph);
    var w = Math.round(x2 - x1), h = Math.round(y2 - y1);
    if (w < 4 || h < 4) return null;
    var scale = Math.min(4, Math.max(1, 384 / Math.max(w, h)));
    var c = document.createElement('canvas');
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    c.getContext('2d').drawImage(img, x1, y1, w, h, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.9);
  }

  function readLabels(loadKey, ev) {
    var labels = ev.concepts['shipping label'];
    if (!labels || labels.unavailable || !labels.boxes.length) return Promise.resolve([]);
    var picks = labels.boxes.slice().sort(function (a, b) { return (b.score || 0) - (a.score || 0); }).slice(0, LABEL_CROP_MAX);
    return sheetImage(loadKey).then(function (img) {
      if (!img) return [];
      return Promise.all(picks.map(function (b) {
        var url;
        try { url = cropDataUrl(img, b); } catch (e) { url = null; }
        if (!url) return null;
        return chat([
          { role: 'system', content: LABEL_PROMPT },
          { role: 'user', content: [
            { type: 'text', text: 'Read this label crop and return the JSON.' },
            { type: 'image_url', image_url: { url: url } }
          ] }
        ], 'label read', 3000).then(function (parsed) {
          var t = parsed && typeof parsed.text === 'string' ? parsed.text.trim() : '';
          if (!t) return null;
          return {
            label: 'Shipping label read',
            side: b.side,
            detail: 'SAM 3.1 located a shipping label here; read from the crop: "' + t + '"'
          };
        }).catch(function () { return null; });
      })).then(function (reads) { return reads.filter(Boolean); });
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

  function buildOsd(scan, pFlags, list, ev) {
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
    if (ev) {
      samOsdLines(ev).forEach(function (l) { lines.push(l); });
      lines.push('');
    }
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
    var payload = osdPayload(humanScan, osdText, verdicts, new Date().toISOString(), samEvidence);
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
    samEvidence = null;
    var samRun = null;
    var myRun = ++runSeq;
    var fig = $('samFigure');
    if (fig) fig.hidden = true;
    if (samIsOn()) {
      /* In parallel with the photo scan; never rejects. */
      samRun = runSam(scan.loadKey).then(function (ev) {
        if (myRun !== runSeq) return { ev: ev, reads: [] }; /* a newer run owns the page */
        renderSamOverlay(scan.loadKey, ev);
        return readLabels(scan.loadKey, ev).catch(function () { return []; })
          .then(function (reads) { return { ev: ev, reads: reads }; });
      });
    }
    var btn = $('photoBtn');
    if (btn) btn.disabled = true;
    $('photoFlags').hidden = true;
    $('verdicts').hidden = true;
    $('osdBox').hidden = true;
    setStatus('Running the photo scan — reading all four sides…', 'busy');
    setPhotoStatus('Reading the ' + (LOADS[scan.loadKey] || 'load') + ' sheet, side by side…');
    return askPhoto(scan.loadKey).then(function (pFlags) {
      if (samRun) {
        setPhotoStatus('Photo scan done. Waiting for the SAM 3.1 evidence…');
        return samRun.then(function (sam) {
          samEvidence = sam.ev;
          var all = pFlags.concat(sam.reads);
          photoFlags = all;
          renderPhotoFlags(all);
          setStatus('Photo scan done. Comparing the two scans…', 'busy');
          setPhotoStatus('Comparing your scan against the photo scan…');
          return askCompare(scan, all, samEvidence);
        });
      }
      photoFlags = pFlags;
      renderPhotoFlags(pFlags);
      setStatus('Photo scan done. Comparing the two scans…', 'busy');
      setPhotoStatus('Comparing your scan against the photo scan…');
      return askCompare(scan, pFlags);
    }).then(function (list) {
      verdicts = list;
      renderVerdicts(list);
      osdText = samEvidence ? buildOsd(scan, photoFlags, list, samEvidence) : buildOsd(scan, photoFlags, list);
      renderOsd(osdText);
      var flags = list.filter(function (v) { return v.verdict === 'flag'; }).length;
      setStatus(flags
        ? 'Compared. ' + flags + (flags === 1 ? ' disagreement' : ' disagreements') + ' to settle — the OS&D report is below. You decide.'
        : 'Compared. The two scans agree on everything both could check. You decide.', 'done');
      setPhotoStatus('Done. The comparison and the OS&D report are below.');
      busy = false;
      if (btn) btn.disabled = false;
      var done = { photoFlags: photoFlags, verdicts: verdicts, osd: osdText };
      if (samEvidence) done.samEvidence = samEvidence;
      return done;
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
    var sw = $('samToggle');
    if (sw) {
      sw.checked = samIsOn();
      showSamState();
      sw.addEventListener('change', function () { setSamOn(sw.checked); showSamState(); });
    }
    refresh();
  }

  function showSamState() {
    var sw = $('samToggle');
    var st = $('samToggleState');
    if (sw && st) {
      st.textContent = sw.checked
        ? 'ON — SAM 3.1 outlines cartons, labels and damage as extra evidence for the photo scan. It gives no verdicts.'
        : 'OFF — the photo scan runs on its own, as always.';
    }
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
    COMPARE_SAM_RULE: COMPARE_SAM_RULE,
    SAM_CONCEPTS: SAM_CONCEPTS,
    SHEET_GEOMETRY: SHEET_GEOMETRY,
    _sideForBox: sideForBox,
    _buildSamEvidence: buildSamEvidence,
    _samEvidenceBlock: samEvidenceBlock,
    _samOsdLines: samOsdLines,
    _osdPayload: osdPayload,
    getState: function () {
      return { humanScan: humanScan, photoFlags: photoFlags, verdicts: verdicts, osd: osdText, busy: busy };
    }
  };
})();
