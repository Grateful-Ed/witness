/* =====================================================================
   wms-ai.js — the WMS's calls to the Meta Model API, through the
   witness Worker's /chat (Muse Spark). Speech reaches the WMS as a
   transcript from /asr (js/warehouse-mic.js, unchanged).

   Five reads, each one honest about what it could not read:
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
     5. gameTurn      — the shift game's conversation: a worker
        speaks to META mid-shift; she answers as herself and, when
        the words are a command for the current task, names the
        action as an intent. The game performs the action itself
        and shows her words only when the work really happened
        (js/wms-game.js owns that honesty); 'answer' replies pass
        through untouched.
     6. workTurn      — the same envelope, generalized to the live
        task queues (js/wms-voice.js): META names an intent; code
        stages the act, asks, and runs it only on the next turn's
        yes, through js/wms.js. This call mutates nothing.

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

  /* ---------- 5. the shift game's conversation ------------------------- */
  /* The worker talks; META answers. The intent is only the ACTION
     envelope — whether this turn should work the current task,
     confirm the count, start, toggle auto-run, or simply be an
     answer. What she says inside 'answer' is open-ended: questions
     about the work are answered from the context the game sends,
     and whether a request belongs here at all is HER judgment, made
     per request in this prompt — no code anywhere filters topics. */

  var GAME_INTENTS = ['complete', 'confirm', 'start', 'auto', 'answer', 'none'];

  var GAME_PROMPT = [
    'You are META, the voice of Witness — the same META a worker talks to through the warehouse glasses. You are guiding one worker through a practice shift on the warehouse console: the shift context below says what job they are working, the task currently offered to them, what is still to come, and where they are standing.',
    '',
    'Return ONLY a JSON object in exactly this shape, no prose, no code fences:',
    '{"intent":"answer","say":"..."}',
    '',
    '"intent" is one of:',
    '- "complete": the worker says the currently offered task is done, or asks you to complete it. Only for the current task, only when their words mean it is finished.',
    '- "confirm": the worker confirms the pending spot count (the context says a count is waiting for confirmation).',
    '- "start": the worker asks to start the shift.',
    '- "auto": the worker asks to turn auto-run on or off.',
    '- "answer": anything you respond to without changing the work — a question about the work, a problem report, a decline. Most turns are this.',
    '- "none": you cannot tell what the worker wants. "say" asks a short clarifying question.',
    '',
    '"say" is what you say back to the worker: one or two short sentences, in your own voice, the way you talk to a worker on the floor.',
    '',
    'Rules:',
    '- Never invent state. The context is all you know: the current task, the remaining tasks, the place the worker stands. If the worker asks about something the context does not cover, say you do not have it in front of you (intent "answer").',
    '- Answer questions about the work from the context. If the worker asks what tasks they need to do, name the current task and then the remaining ones, in order (intent "answer").',
    '- A problem report — damage, a wrong pallet, a shortage, a spill, anything broken or unsafe — is intent "answer", NEVER "complete": acknowledge it plainly and say what to do next (set it aside, flag it for the lead). A task with a problem is not a finished task.',
    '- You are a warehouse-work assistant. If a request is not related to warehouse work or this warehouse\'s processes, decline it in your own voice, along the lines of: "Sorry, this request isn\'t related to warehouse process." (intent "answer"). Whether a request is off-topic is your call, made on the request itself.',
    '- When the intent works a task, keep "say" short and about that task — the game shows your words only after the work has really happened.'
  ].join('\n');

  /* The context block is composed by the caller (js/wms-game.js)
     from the live shift; this builder only frames it. */
  function gameBody(context, words) {
    var c = context || {};
    var lines = ['SHIFT CONTEXT'];
    lines.push('Job: ' + (c.roleLabel || 'warehouse shift'));
    if (c.offer) {
      lines.push('Current task (step ' + c.step + ' of ' + c.total + '): ' + c.offer);
      lines.push('Pending: ' + (c.pending === 'count' ? 'a spot count is counted and waiting for the worker to confirm it'
        : c.pending === 'countStep' ? 'the current task is a spot count — confirming it means counting what is in the bin and posting that count'
        : 'a normal task, worked when the worker says it is done'));
    } else {
      lines.push('No task is currently offered' + (c.done ? ' — the shift is complete.' : ' — no shift is running.'));
    }
    if (c.remaining && c.remaining.length) {
      lines.push('Still to come after the current task:');
      c.remaining.forEach(function (o, i) { lines.push((i + 1) + '. ' + o); });
    }
    if (c.at) lines.push('The worker is standing at: ' + c.at);
    lines.push('');
    lines.push('THE WORKER SAID (verbatim):');
    lines.push(words);
    return textBody(GAME_PROMPT, lines.join('\n'));
  }

  /* Accept only the envelope: a known intent and something to say.
     The words themselves pass through untouched — an answer is the
     model's own, never edited here (a sanity length bound aside). */
  function acceptGame(parsed) {
    if (!parsed || typeof parsed !== 'object') return null;
    if (GAME_INTENTS.indexOf(parsed.intent) === -1) return null;
    var say = str(parsed.say);
    if (!say) return null;
    if (say.length > 500) say = say.slice(0, 500);
    return { intent: parsed.intent, say: say };
  }

  function gameTurn(doFetch, context, words, url) {
    if (!String(words || '').trim()) return Promise.reject(Object.assign(new Error('empty'), { userMessage: 'Nothing was heard. Hold the button and say it again.' }));
    return B.sendRead(doFetch, url, gameBody(context, words), acceptGame)
      .then(function (r) { return { intent: r.value.intent, say: r.value.say, attempts: r.attempts }; });
  }

  /* ---------- 6. work by voice: the live task queues ----------------- */
  /* The same envelope as gameTurn, generalized from the game's steps
     to the console's real task queue (js/wms-voice.js owns the act).
     The model only NAMES the intent; code resolves it against the
     live state, stages any act and asks, and runs it only on the
     next turn's yes. Nothing in this call mutates anything. "about"
     says whether a completion is about the task in hand — anything
     but "current" makes the surface ask instead of act. */

  var WORK_INTENTS = ['complete', 'next', 'repeat', 'problem', 'confirm', 'deny', 'answer', 'none'];
  var WORK_ABOUT = ['current', 'other', 'unclear'];

  var WORK_PROMPT = [
    'You are META, the voice of Witness — the same META a worker talks to through the warehouse glasses. You are on the warehouse console with one worker, working their real task queue. The context below says who the worker is, the task in their hands (if any), a question waiting for their yes or no (if any), and what is next in their queue.',
    '',
    'Return ONLY a JSON object in exactly this shape, no prose, no code fences:',
    '{"intent":"answer","about":"current","say":"..."}',
    '',
    '"intent" is one of:',
    '- "complete": the worker says the task in their hands is done (including a spoken pick quantity, a bin they put it in, or a count). Only when their words mean it is finished.',
    '- "next": the worker asks for their next task.',
    '- "repeat": the worker asks you to repeat or say again what their task is.',
    '- "problem": the worker reports something wrong — damage, a shortage, a spill, a wrong pallet, anything broken or unsafe. A task with a problem is not finished: never "complete".',
    '- "confirm": the worker says yes to the question waiting for them.',
    '- "deny": the worker says no, wait, or cancel to the question waiting for them.',
    '- "answer": a question about the work, or anything you respond to without changing the work. Most turns that are not commands are this.',
    '- "none": you cannot tell what the worker wants. "say" asks a short clarifying question.',
    '',
    '"about" (for "complete"): "current" when the words are about the task in hand; "other" when the words name a different task, bin, pallet or order; "unclear" when you cannot tell which task they mean. Use "current" for every other intent.',
    '',
    '"say" is what you say back: one or two short sentences, in your own voice, the way you talk to a worker on the floor.',
    '',
    'Rules:',
    '- Never invent state. The context is all you know. If the worker asks about something it does not cover, say you do not have it in front of you (intent "answer").',
    '- You never close, take or file anything yourself: the console asks the worker to confirm every change, and shows your words only after the work has really happened.',
    '- You are a warehouse-work assistant. If a request is not related to warehouse work or this warehouse\'s processes, decline it in your own voice (intent "answer").'
  ].join('\n');

  /* The context is composed by js/wms-voice.js from the live state;
     this builder only frames it. */
  function workBody(context, words) {
    var c = context || {};
    var lines = ['WORK CONTEXT'];
    lines.push('Worker: ' + (c.worker || 'a worker') + (c.zone ? ' (Zone ' + c.zone + ')' : ''));
    lines.push(c.inHand ? 'Task in hand: ' + c.inHand : 'No task in hand.');
    if (c.pending) lines.push('Waiting for the worker\'s yes or no: ' + c.pending);
    if (c.nextUp && c.nextUp.length) {
      lines.push('Next in the queue:');
      c.nextUp.forEach(function (o, i) { lines.push((i + 1) + '. ' + o); });
    } else {
      lines.push('Nothing else is waiting in the queue.');
    }
    lines.push('');
    lines.push('THE WORKER SAID (verbatim):');
    lines.push(words);
    return textBody(WORK_PROMPT, lines.join('\n'));
  }

  function acceptWork(parsed) {
    if (!parsed || typeof parsed !== 'object') return null;
    if (WORK_INTENTS.indexOf(parsed.intent) === -1) return null;
    var say = str(parsed.say);
    if (!say) return null;
    if (say.length > 500) say = say.slice(0, 500);
    var about = WORK_ABOUT.indexOf(parsed.about) === -1 ? (parsed.intent === 'complete' ? 'unclear' : 'current') : parsed.about;
    return { intent: parsed.intent, about: about, say: say };
  }

  function workTurn(doFetch, context, words, url) {
    if (!String(words || '').trim()) return Promise.reject(Object.assign(new Error('empty'), { userMessage: 'Nothing was heard. Hold the button and say it again.' }));
    return B.sendRead(doFetch, url, workBody(context, words), acceptWork)
      .then(function (r) { return { intent: r.value.intent, about: r.value.about, say: r.value.say, attempts: r.attempts }; });
  }

  var api = {
    WORK_PROMPT: WORK_PROMPT,
    WORK_INTENTS: WORK_INTENTS,
    workBody: workBody,
    acceptWork: acceptWork,
    workTurn: workTurn,
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
    readDock: readDock,
    GAME_PROMPT: GAME_PROMPT,
    gameBody: gameBody,
    acceptGame: acceptGame,
    gameTurn: gameTurn
  };

  root.WitnessWmsAi = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
