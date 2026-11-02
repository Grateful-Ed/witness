/* =====================================================================
   wms-ai.js — the WMS's calls to the Meta Model API, through the
   witness Worker's /chat (Muse Spark). Speech reaches the WMS as a
   transcript from /asr (js/warehouse-mic.js, unchanged).

   Four reads, each one honest about what it could not read:
     1. readReceiving — a receiver's spoken count, turned into counts
        per BOL line, each with the receiver's EXACT words as the
        quote. The human reviews and posts; nothing auto-posts.
     2. labelFlag     — a short label for a reported problem. The
        speaker's words are kept verbatim by the caller; only the
        label comes back. No categories.
     3. readPutaway   — a photo at a putaway: the bin label in view,
        what is on the pallet, and anything report-worthy.
     4. readDock      — a photo of freight at the dock: flags in the
        receiving-report sense (label + plain detail).

   The request/retry/error plumbing is bol.js's readBody + sendRead —
   reused, never forked. Pure: the caller hands in fetch. Loads in the
   browser (window.WitnessWmsAi) and in node (module.exports).
   ===================================================================== */
(function (root) {
  'use strict';

  var B = root.WitnessBol;
  if (!B && typeof require === 'function') {
    try { B = require('./bol.js'); } catch (e) { B = null; }
  }

  var MAX_TOKENS = 6000;

  function textBody(system, user) {
    return JSON.stringify({
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.1,
      max_tokens: MAX_TOKENS
    });
  }

  function str(v) { return typeof v === 'string' ? v.trim() : ''; }
  function count(v) {
    if (typeof v === 'number' && isFinite(v) && v >= 0 && Math.floor(v) === v) return v;
    if (typeof v === 'string' && /^\s*\d+\s*$/.test(v)) return parseInt(v, 10);
    return null;
  }

  /* ---------- 1. receiving by voice ---------------------------------- */

  var RECEIVE_PROMPT = [
    'You turn a warehouse receiver\'s spoken count into numbers. You are given the bill of lading (BOL) lines on file for the shipment, numbered, and the receiver\'s exact transcript.',
    '',
    'Return ONLY a JSON object in exactly this shape, no prose, no code fences:',
    '{"lines":[{"line":1,"received":0,"damaged":0,"quote":"..."}]}',
    '',
    '- One entry per BOL line the receiver spoke about, using the BOL line number.',
    '- "received": the total units (cases or bags) the receiver says arrived for that line, including damaged ones. If they speak in pallets with a per-pallet count, multiply. If they never give a number for the line, use null.',
    '- "damaged": units they say are damaged, crushed, wet, leaking or otherwise not sound. 0 if they say none; null if they do not say.',
    '- "quote": the receiver\'s exact words about that line, copied verbatim from the transcript. Never reword.',
    '',
    'Rules: never invent a number the receiver did not say. Never copy a number from the BOL into "received" — the BOL is what was promised, not what arrived.'
  ].join('\n');

  function receivingBody(transcript, expected) {
    var lines = expected.map(function (l, i) { return (i + 1) + '. ' + l.desc + ' — BOL says ' + l.expected; }).join('\n');
    return textBody(RECEIVE_PROMPT, 'BOL LINES ON FILE:\n' + lines + '\n\nRECEIVER\'S TRANSCRIPT (verbatim):\n' + transcript);
  }

  /* Keep only what the receiver really said: a quote that is not in
     the transcript is dropped (never shown as their words). */
  function acceptReceiving(transcript, expected) {
    var flat = String(transcript || '').toLowerCase().replace(/\s+/g, ' ');
    return function (parsed) {
      if (!parsed || !Array.isArray(parsed.lines)) return null;
      var out = expected.map(function (l) { return { desc: l.desc, expected: l.expected, received: null, damaged: null, quote: '' }; });
      parsed.lines.forEach(function (x) {
        if (!x) return;
        var i = count(x.line);
        if (i == null || i < 1 || i > out.length) return;
        var row = out[i - 1];
        row.received = count(x.received);
        row.damaged = count(x.damaged);
        var q = str(x.quote);
        if (q && flat.indexOf(q.toLowerCase().replace(/\s+/g, ' ')) !== -1) row.quote = q;
      });
      return out;
    };
  }

  function readReceiving(doFetch, transcript, expected, url) {
    if (!String(transcript || '').trim()) return Promise.reject(Object.assign(new Error('empty'), { userMessage: 'Nothing was heard. Hold the button and say the count.' }));
    return B.sendRead(doFetch, url, receivingBody(transcript, expected), acceptReceiving(transcript, expected))
      .then(function (r) { return { lines: r.value, attempts: r.attempts }; });
  }

  /* ---------- 2. flag label -------------------------------------------- */

  var LABEL_PROMPT = [
    'A warehouse worker reported something in their own words. Give it a short plain label a supervisor would scan in a list — two to five words, dock language, no punctuation at the end. Describe what happened; do not judge or blame.',
    '',
    'Return ONLY a JSON object: {"label":"..."}'
  ].join('\n');

  function labelBody(words) { return textBody(LABEL_PROMPT, 'WORKER\'S WORDS (verbatim):\n' + words); }

  function acceptLabel(parsed) {
    var l = parsed ? str(parsed.label) : '';
    if (!l) return null;
    l = l.replace(/[.!?]+$/, '');
    if (l.split(/\s+/).length > 8) l = l.split(/\s+/).slice(0, 8).join(' ');
    return l;
  }

  function labelFlag(doFetch, words, url) {
    return B.sendRead(doFetch, url, labelBody(words), acceptLabel).then(function (r) { return { label: r.value, attempts: r.attempts }; });
  }

  /* ---------- 3. putaway photo ------------------------------------------ */

  var PUTAWAY_PROMPT = [
    'You look at a photo taken by a warehouse worker at a putaway: a pallet or cases being placed in a storage location. Bin labels in this building look like "A-03" (zone letter A, B or C, dash, two digits 01–08).',
    '',
    'Return ONLY a JSON object in exactly this shape, no prose, no code fences:',
    '{"bin_label":"...","item":"...","flags":[{"label":"...","detail":"..."}]}',
    '',
    '- "bin_label": the bin label you can read in the photo, exactly as printed, or null if none is legible.',
    '- "item": what the freight appears to be, from printed carton text if any, or null.',
    '- "flags": anything that belongs in a report — damage, leaning stack, torn wrap, wrong item for the label. Empty list if nothing.',
    '',
    'Rules: report only what is visible. Never guess a bin label you cannot read.'
  ].join('\n');

  function acceptPutaway(parsed) {
    if (!parsed || typeof parsed !== 'object') return null;
    var raw = str(parsed.bin_label).toUpperCase().replace(/\s+/g, '');
    var m = /^([ABC])-?0?([1-8])$/.exec(raw);
    return {
      binLabel: m ? m[1] + '-0' + m[2] : null,
      binRaw: str(parsed.bin_label) || null,
      item: str(parsed.item) || null,
      flags: flagsOf(parsed.flags)
    };
  }

  function flagsOf(raw) {
    var out = [];
    (Array.isArray(raw) ? raw : []).forEach(function (f) {
      if (!f) return;
      var label = str(f.label), detail = str(f.detail);
      if (label) out.push({ label: label, detail: detail });
    });
    return out;
  }

  function readPutaway(doFetch, dataUrl, url) {
    return B.sendRead(doFetch, url, B.readBody(dataUrl, PUTAWAY_PROMPT, 'Read the bin label and the freight in this photo and return the JSON.'), acceptPutaway)
      .then(function (r) { return { read: r.value, attempts: r.attempts }; });
  }

  /* ---------- 4. dock photo ---------------------------------------------- */

  var DOCK_PROMPT = [
    'You are the photo scan at a warehouse receiving dock. You see one photo of inbound freight. Flag everything that would belong in a receiving or OS&D (overage, shortage & damage) report: crushed or open cartons, torn or loose wrap, leaks or stains, leaning or shifted stack, broken pallet. Also flag "Looks sound" when that is genuinely what the photo shows.',
    '',
    'Return ONLY a JSON object in exactly this shape, no prose, no code fences:',
    '{"flags":[{"label":"...","detail":"..."}]}',
    '',
    '- "label": a short plain label in dock words.',
    '- "detail": one plain sentence saying exactly what you see and where. If part of the load is out of view, add a flag labeled "Cannot verify" saying what.',
    '',
    'Rules: report only what is visible; never invent counts.'
  ].join('\n');

  function acceptDock(parsed) {
    if (!parsed || !Array.isArray(parsed.flags)) return null;
    return flagsOf(parsed.flags);
  }

  function readDock(doFetch, dataUrl, url) {
    return B.sendRead(doFetch, url, B.readBody(dataUrl, DOCK_PROMPT, 'Read this freight photo and return the flags JSON.'), acceptDock)
      .then(function (r) { return { flags: r.value, attempts: r.attempts }; });
  }

  var api = {
    RECEIVE_PROMPT: RECEIVE_PROMPT,
    LABEL_PROMPT: LABEL_PROMPT,
    PUTAWAY_PROMPT: PUTAWAY_PROMPT,
    DOCK_PROMPT: DOCK_PROMPT,
    receivingBody: receivingBody,
    acceptReceiving: acceptReceiving,
    readReceiving: readReceiving,
    labelBody: labelBody,
    acceptLabel: acceptLabel,
    labelFlag: labelFlag,
    acceptPutaway: acceptPutaway,
    readPutaway: readPutaway,
    acceptDock: acceptDock,
    readDock: readDock
  };

  root.WitnessWmsAi = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
