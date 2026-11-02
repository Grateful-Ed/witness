/* =====================================================================
   bol.js — Witness slice 3: the BOL camera read. PURE LOGIC ONLY.

   Point the phone at a bill of lading; Muse Spark reads it through
   the Worker's /chat; the read is shown exactly as read, matched
   against the picked test load's fixture data, and can be saved with
   the load's record through /save (a `bol` object, kind "scan").

   This file holds no page code on purpose: the phone surface and the
   kitchen demo reuse it unchanged (never fork it). The page wiring
   lives in js/bol-page.js. Loaded in the browser (window.WitnessBol)
   and in node (module.exports).

   Honesty rules:
   - Anything the model could not read is "not read" — never guessed,
     never filled from the fixture.
   - The match is labeled for what it is: the BOL's claims against
     the load's FIXTURE data (what is known to be on the pallet).
   - The machine never signs off. Findings are findings; a human
     decides.
   ===================================================================== */
(function (root) {
  'use strict';

  var WORKER_BASE = 'https://witness.e-william-harris96.workers.dev';
  var CHAT_URL = WORKER_BASE + '/chat';
  var SAVE_URL = WORKER_BASE + '/save';

  var NOT_READ = 'not read';
  var MAX_TOKENS = 6000;           /* house lesson: Spark reasons first */
  var SEND_MAX = 1600, SEND_QUALITY = 0.85; /* text must stay legible */

  var BOL_PROMPT = [
    'You read a photo of a bill of lading (BOL) for a warehouse receiving dock. The photo may be of paper or of a screen, may be tilted, and may be partly out of frame. Read what is printed. Do not guess.',
    '',
    'Return ONLY a JSON object in exactly this shape, no prose, no code fences:',
    '{"carrier":"...","bol_number":"...","shipper":"...","consignee":"...","pieces_claimed":0,"total_weight":"...","line_items":[{"description":"...","pieces":0,"weight":"...","un_number":"...","hazmat_marks":"..."}]}',
    '',
    '- "carrier": the carrier name as printed.',
    '- "bol_number": the BOL number as printed.',
    '- "shipper" and "consignee": the company names only, as printed.',
    '- "pieces_claimed": the total pieces / handling units / cartons the BOL claims, as a number.',
    '- "total_weight": the total weight exactly as printed, with its unit (for example "624 lb").',
    '- "line_items": one entry per commodity line, top to bottom. "pieces" is a number; "weight" is as printed with its unit; "un_number" is the UN number as printed (for example "UN1950"); "hazmat_marks" is any hazard class, packing group, "Limited Quantity" or HM mark as printed.',
    '',
    'Rules: copy text exactly as printed. If a field is missing, cut off, blurred, or you are not sure, use null for it — never invent or infer a value. A line with no hazmat marks gets null for un_number and hazmat_marks.'
  ].join('\n');

  /* ---------- small helpers ------------------------------------------ */

  /* Fit w×h inside a square of side max, keeping the shape. Never
     scales up. Whole pixels, at least 1. */
  function fitWithin(w, h, max) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    var scale = Math.min(1, max / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
  }

  var BLANKS = ['', 'null', 'none', 'n/a', 'na', 'unknown', 'unreadable', 'illegible', 'not read', 'not visible', '?', '-'];

  /* A printed text field: trimmed string, or NOT_READ. */
  function textField(v) {
    if (typeof v === 'number' && isFinite(v)) return String(v);
    if (typeof v !== 'string') return NOT_READ;
    var t = v.trim();
    if (BLANKS.indexOf(t.toLowerCase()) !== -1) return NOT_READ;
    return t;
  }

  /* A count: a whole number ≥ 0, or NOT_READ. "20 cartons" → 20. */
  function countField(v) {
    if (typeof v === 'number') return isFinite(v) && v >= 0 && Math.floor(v) === v ? v : NOT_READ;
    if (typeof v !== 'string') return NOT_READ;
    var m = v.replace(/,/g, '').match(/^\s*(\d+)\b/);
    return m ? parseInt(m[1], 10) : NOT_READ;
  }

  /* A weight as printed: { text, lb }. lb is a number when the unit is
     pounds (or absent) or kilograms (converted), else NOT_READ. */
  function weightField(v) {
    var text = textField(v);
    if (text === NOT_READ) return { text: NOT_READ, lb: NOT_READ };
    var m = text.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([a-z.]*)/i);
    if (!m) return { text: text, lb: NOT_READ };
    var n = parseFloat(m[1]);
    var unit = m[2].toLowerCase().replace(/\./g, '');
    if (unit === '' || unit === 'lb' || unit === 'lbs' || unit === 'pounds' || unit === 'pound' || unit === '#') return { text: text, lb: n };
    if (unit === 'kg' || unit === 'kgs' || unit === 'kilograms') return { text: text, lb: Math.round(n * 2.20462) };
    return { text: text, lb: NOT_READ };
  }

  function pick(obj, names) {
    for (var i = 0; i < names.length; i++) {
      if (obj && Object.prototype.hasOwnProperty.call(obj, names[i])) return obj[names[i]];
    }
    return undefined;
  }

  /* ---------- parsing the model's reply ------------------------------ */

  /* Pull a JSON object out of reply text: plain JSON, fenced JSON, or
     JSON with prose around it. Returns the object or null. */
  function extractJson(text) {
    if (typeof text !== 'string' || !text.trim()) return null;
    var cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
      var direct = JSON.parse(cleaned);
      return direct && typeof direct === 'object' && !Array.isArray(direct) ? direct : null;
    } catch (e) { /* fall through to the brace scan */ }
    var start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      var inner = JSON.parse(cleaned.slice(start, end + 1));
      return inner && typeof inner === 'object' && !Array.isArray(inner) ? inner : null;
    } catch (e2) { return null; }
  }

  /* The model's object → the page's BOL read. Every field is present;
     anything missing or unreadable is NOT_READ. Returns null when the
     object has none of the BOL fields at all (not a BOL answer). */
  function normaliseBol(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    var keys = ['carrier', 'bol_number', 'bolNumber', 'shipper', 'consignee', 'pieces_claimed', 'piecesClaimed', 'total_weight', 'totalWeight', 'line_items', 'lineItems'];
    var any = keys.some(function (k) { return Object.prototype.hasOwnProperty.call(obj, k); });
    if (!any) return null;
    var rawLines = pick(obj, ['line_items', 'lineItems']);
    var lines = [];
    if (Array.isArray(rawLines)) {
      rawLines.forEach(function (li) {
        if (!li || typeof li !== 'object') return;
        var w = weightField(pick(li, ['weight']));
        lines.push({
          description: textField(pick(li, ['description', 'desc'])),
          pieces: countField(pick(li, ['pieces', 'qty', 'quantity'])),
          weight: w.text,
          weightLb: w.lb,
          unNumber: textField(pick(li, ['un_number', 'unNumber', 'un'])),
          hazmatMarks: textField(pick(li, ['hazmat_marks', 'hazmatMarks', 'hazmat']))
        });
      });
    }
    var tw = weightField(pick(obj, ['total_weight', 'totalWeight']));
    return {
      carrier: textField(pick(obj, ['carrier'])),
      bolNumber: textField(pick(obj, ['bol_number', 'bolNumber'])),
      shipper: textField(pick(obj, ['shipper'])),
      consignee: textField(pick(obj, ['consignee'])),
      piecesClaimed: countField(pick(obj, ['pieces_claimed', 'piecesClaimed'])),
      totalWeight: tw.text,
      totalWeightLb: tw.lb,
      lineItems: lines
    };
  }

  /* Reply text → BOL read, or null if it can't be read as one. */
  function parseBolText(text) {
    return normaliseBol(extractJson(text));
  }

  function replyText(j) {
    return j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  }

  /* ---------- the read: one request, one retry -----------------------
     Generic on purpose: the kitchen demo's receipt read reuses
     readBody + sendRead + parseJson with its own prompt and its own
     normaliser. The BOL read below is just one caller. */

  /* A /chat body: system prompt, then the user text and the photo as
     a data: image_url. max_tokens 6000 (house lesson). */
  function readBody(dataUrl, systemPrompt, userText) {
    return JSON.stringify({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url: dataUrl } }
        ] }
      ],
      temperature: 0.1,
      max_tokens: MAX_TOKENS
    });
  }

  function buildReadBody(dataUrl) {
    return readBody(dataUrl, BOL_PROMPT, 'Read this bill of lading and return the JSON.');
  }

  function fail(code, msg) { var e = new Error(code); e.code = code; e.userMessage = msg; return e; }

  /* Send one prepared body to /chat. `accept` (optional) turns the
     parsed object into the caller's value, or null when it is the
     wrong shape; without it any JSON object is accepted. An empty or
     unacceptable reply is retried exactly once; then an honest error.
     HTTP errors are not retried. Resolves { parsed, value, text, attempts }. */
  function sendRead(doFetch, url, body, accept) {
    url = url || CHAT_URL;
    function attempt(n) {
      return Promise.resolve().then(function () {
        return doFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body });
      }).then(function (r) {
        if (r.status === 413) throw fail('too-large', 'The photo was too large for the Worker to accept (HTTP 413). Your photo is still on screen. If this keeps happening, the Worker\'s image-size change may not be deployed yet.');
        if (r.status === 429) throw fail('cap', 'No read — today\'s call limit at the Worker is used up. Your photo is still on screen.');
        if (!r.ok) throw fail('http', 'No read — the Worker answered with an error (HTTP ' + r.status + '). Your photo is still on screen.');
        return r.json().catch(function () { return null; });
      }, function (e) {
        if (e && e.userMessage) throw e;
        throw fail('network', 'No read — the Worker could not be reached. Check the connection. Your photo is still on screen.');
      }).then(function (j) {
        var text = replyText(j);
        var parsed = text ? extractJson(text) : null;
        var value = parsed ? (accept ? accept(parsed) : parsed) : null;
        if (value) return { parsed: parsed, value: value, text: text, attempts: n };
        if (n < 2) return attempt(n + 1);
        if (!text) throw fail('empty', 'No read — the reader came back empty twice. Nothing was guessed. Try again, or take a clearer photo.');
        throw fail('unparseable', 'No read — the reader answered twice, but not in a shape this page can use. Nothing was guessed. Try again, or take a clearer photo.');
      });
    }
    return attempt(1);
  }

  /* The BOL read. Resolves { bol, attempts }. */
  function readBol(doFetch, dataUrl, url) {
    return sendRead(doFetch, url, buildReadBody(dataUrl), normaliseBol).then(function (res) {
      return { bol: res.value, attempts: res.attempts };
    });
  }

  /* ---------- "What the BOL says" ------------------------------------ */

  function show(v) { return v === NOT_READ ? 'not read' : String(v); }

  /* The read as plain lines, exactly as read. */
  function bolLines(bol) {
    var out = [
      'Carrier: ' + show(bol.carrier),
      'BOL number: ' + show(bol.bolNumber),
      'Shipper: ' + show(bol.shipper),
      'Consignee: ' + show(bol.consignee),
      'Pieces claimed: ' + show(bol.piecesClaimed),
      'Total weight: ' + show(bol.totalWeight)
    ];
    if (!bol.lineItems.length) out.push('Line items: not read');
    bol.lineItems.forEach(function (li, i) {
      var s = 'Line ' + (i + 1) + ': ' + show(li.description) + ' — pieces ' + show(li.pieces) + ', weight ' + show(li.weight);
      var marks = [];
      if (li.unNumber !== NOT_READ) marks.push(li.unNumber);
      if (li.hazmatMarks !== NOT_READ) marks.push(li.hazmatMarks);
      if (marks.length) s += ' — hazmat as printed: ' + marks.join(', ');
      out.push(s);
    });
    return out;
  }

  /* ---------- the match ---------------------------------------------- */

  function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function alnum(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

  function identityRow(field, label, read, onFile, same) {
    var result = read === NOT_READ ? 'not-read' : (same(read, onFile) ? 'agree' : 'differ');
    var line = label + ' — read "' + show(read) + '", on file "' + onFile + '". ' +
      (result === 'agree' ? 'Agree.' : result === 'differ' ? 'Differs.' : 'Not read — can\'t compare.');
    return { field: field, label: label, read: read, onFile: onFile, result: result, line: line };
  }

  function countRow(name, read, present) {
    var result, diff = 0, tail;
    if (read === NOT_READ) { result = 'not-read'; tail = 'BOL count not read — can\'t compare.'; }
    else if (read === present) { result = 'agree'; tail = 'Agree.'; }
    else if (read > present) { result = 'short'; diff = read - present; tail = 'Short ' + diff + '.'; }
    else { result = 'over'; diff = present - read; tail = 'Over ' + diff + '.'; }
    var line = name + ' — BOL says ' + show(read) + ', ' + present + ' on the pallet. ' + tail;
    return { name: name, read: read, present: present, result: result, diff: diff, line: line };
  }

  /* Compare the BOL read with the load's fixture data.
     identity: the read's header fields against the BOL on file.
     counts:   each fixture line's BOL count against what is on the
               pallet, then the total.
     extra:    lines on the BOL that match no fixture line. */
  function matchBol(bol, load) {
    var of = load.onFile;
    var identity = [
      identityRow('carrier', 'Carrier', bol.carrier, of.carrier, function (a, b) { var x = norm(a), y = norm(b); return x.indexOf(y) !== -1 || y.indexOf(x) !== -1; }),
      identityRow('bolNumber', 'BOL number', bol.bolNumber, of.bolNumber, function (a, b) { return alnum(a) === alnum(b); }),
      identityRow('shipper', 'Shipper', bol.shipper, of.shipper, function (a, b) { var x = norm(a), y = norm(b); return x.indexOf(y) !== -1 || y.indexOf(x) !== -1; }),
      identityRow('consignee', 'Consignee', bol.consignee, of.consignee, function (a, b) { var x = norm(a), y = norm(b); return x.indexOf(y) !== -1 || y.indexOf(x) !== -1; }),
      identityRow('totalWeight', 'Total weight', bol.totalWeightLb === NOT_READ ? NOT_READ : bol.totalWeightLb + ' lb', of.totalWeightLb + ' lb',
        function () { return Math.abs(bol.totalWeightLb - of.totalWeightLb) <= 1; })
    ];

    var used = [];
    var counts = load.lines.map(function (fl) {
      var idx = -1;
      for (var i = 0; i < bol.lineItems.length; i++) {
        if (used.indexOf(i) !== -1) continue;
        var d = bol.lineItems[i].description;
        if (d === NOT_READ) continue;
        var dl = d.toLowerCase();
        if (fl.match.some(function (w) { return dl.indexOf(w) !== -1; })) { idx = i; break; }
      }
      if (idx === -1) {
        return { name: fl.name, read: NOT_READ, present: fl.present, result: 'not-on-bol', diff: 0,
          line: fl.name + ' — not found in the BOL read. ' + fl.present + ' on the pallet. Can\'t compare.' };
      }
      used.push(idx);
      var row = countRow(fl.name, bol.lineItems[idx].pieces, fl.present);
      row.readAs = bol.lineItems[idx].description;
      return row;
    });

    var presentTotal = load.lines.reduce(function (s, l) { return s + l.present; }, 0);
    var total = countRow('Total pieces', bol.piecesClaimed, presentTotal);

    var extra = [];
    bol.lineItems.forEach(function (li, i) {
      if (used.indexOf(i) !== -1) return;
      extra.push({ description: li.description, pieces: li.pieces,
        line: show(li.description) + ' — on the BOL (pieces ' + show(li.pieces) + '), not part of this load\'s fixture data.' });
    });

    var shortLines = counts.filter(function (c) { return c.result === 'short'; });
    var summary;
    if (total.result === 'not-read') summary = 'The BOL\'s total pieces were not read, so the total can\'t be compared.';
    else if (total.result === 'agree' && !shortLines.length) summary = 'The BOL and the pallet agree: ' + presentTotal + ' pieces.';
    else summary = 'BOL claims ' + total.read + ' pieces; ' + presentTotal + ' are on the pallet' +
      (shortLines.length ? ' — short: ' + shortLines.map(function (c) { return c.name.toLowerCase() + ' ' + c.diff; }).join(', ') : '') + '.';

    return {
      against: load.label + ' — fixture data (what is known to be on the pallet)',
      identity: identity,
      counts: counts,
      total: total,
      extra: extra,
      summary: summary
    };
  }

  /* ---------- save --------------------------------------------------- */

  /* The /save body: the read and the match ride as a `bol` object;
     kind stays "scan"; /save needs a transcript, so the read's plain
     lines are it. The photo itself is NOT included (open decision —
     default is not to store photos). */
  function buildSaveBody(load, bol, match, savedAt) {
    var lines = bolLines(bol);
    var findings = match.identity.concat(match.counts, [match.total]).filter(function (r) { return r.result !== 'agree'; });
    return {
      load: load.label,
      kind: 'scan',
      transcript: 'BOL camera read — ' + load.label + '\n' + lines.join('\n'),
      flags: findings.map(function (r) { return { label: r.result, detail: r.line }; }),
      bol: { read: bol, match: match, source: 'camera' },
      savedAt: savedAt || new Date().toISOString()
    };
  }

  function saveBol(doFetch, body, url) {
    return Promise.resolve().then(function () {
      return doFetch(url || SAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }).then(function (r) {
      if (r.status === 501) throw fail('no-storage', 'Not saved — storage is not connected on the Worker yet.');
      if (!r.ok) throw fail('http', 'Not saved — the Worker answered HTTP ' + r.status + '.');
      return r.json();
    }, function (e) {
      if (e && e.userMessage) throw e;
      throw fail('network', 'Not saved — the Worker could not be reached.');
    });
  }

  var api = {
    CHAT_URL: CHAT_URL,
    SAVE_URL: SAVE_URL,
    NOT_READ: NOT_READ,
    MAX_TOKENS: MAX_TOKENS,
    SEND_MAX: SEND_MAX,
    SEND_QUALITY: SEND_QUALITY,
    BOL_PROMPT: BOL_PROMPT,
    fitWithin: fitWithin,
    extractJson: extractJson,
    parseJson: extractJson,
    readBody: readBody,
    sendRead: sendRead,
    normaliseBol: normaliseBol,
    parseBolText: parseBolText,
    buildReadBody: buildReadBody,
    readBol: readBol,
    bolLines: bolLines,
    matchBol: matchBol,
    buildSaveBody: buildSaveBody,
    saveBol: saveBol
  };

  root.WitnessBol = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
