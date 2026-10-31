/* =====================================================================
   record.js — Witness Step 1, second half: transcript -> flags -> save.

   The transcript (the receiver's own words, shown verbatim by voice.js)
   goes to Muse Spark through the Witness Worker's /chat route with the
   flagging prompt below. Spark returns a JSON list of FLAGS: every item
   in the transcript that sounds like it belongs in a receiving / OS&D
   report, each flag carrying a short plain label and the speaker's
   exact words quoted verbatim.

   FLAGS, NOT FIELDS (William's ruling, 2026-10-30): there are no fixed
   field names, no predefined slots, and no "Not said" placeholders.
   Categories are built later, bottom-up, from the flags that actually
   accumulate across samples. If nothing in a scan flags, the page says
   so plainly. If the flagging step fails or answers in a shape this
   page cannot read, the page says "flags unavailable" — the transcript
   itself is shown above either way and is never lost.

   SAVE (2026-10-30): the primary path is the "Save this scan" button,
   which POSTs {load, transcript, flags, savedAt} to the Worker's /save
   route. The saved transcript is the verbatim ASR transcript, exactly
   as returned — not a formatted copy. Until the Worker's scan storage
   is connected, /save answers 501 storage-not-connected and the button
   falls back to the previous share/copy behaviour, labeled clearly, so
   a tester is never blocked.

   The API key is never in this page. It lives in the Cloudflare Worker.
   ===================================================================== */
(function () {
  'use strict';

  var WORKER_BASE = 'https://witness.e-william-harris96.workers.dev';
  var CHAT_URL = WORKER_BASE + '/chat';
  var SAVE_URL = WORKER_BASE + '/save';

  /* Save + test-load state. lastTranscript is the verbatim ASR
     transcript; lastFlags is the flags array (null = flags unavailable,
     [] = nothing flagged); selectedLoad is the tester-picked test load
     (null = none picked), used only to label a saved scan. */
  var lastTranscript = '';
  var lastFlags = null;
  var selectedLoad = null;
  var saveTimer = null;

  var LOADS = {
    a: 'Load A — container cube',
    b: 'Load B — peaches stack'
  };

  var SYSTEM_PROMPT = [
    'You read a warehouse receiver\'s spoken description of one pallet and FLAG everything in it that sounds like it belongs in a receiving or OS&D (overage, shortage & damage) report.',
    '',
    'The input is a speech transcript. It is one person describing what they see and what they have decided about the load — counts, condition, judgments and actions mixed together, the way people actually talk on a dock.',
    '',
    'Return ONLY a JSON object in exactly this shape, no prose, no code fences:',
    '{"flags":[{"label":"...","quote":"..."}]}',
    '',
    'Each flag is one report-worthy item from the transcript:',
    '- "label": a short, plain label for the item, in ordinary dock words (for example "Leak", "Damaged wrap", "Count", "Leaning stack", "Needs rewrap", "Send to repackaging"). Invent the label from what was actually said — there is no fixed list of labels to choose from.',
    '- "quote": the speaker\'s exact words for that item, copied verbatim from the transcript. Do not tidy, paraphrase, correct, or complete them.',
    '',
    'Rules:',
    '1. Flag observations, judgments, and actions alike. If the speaker decided something — goods need separating, the load needs rewrap, it moves to repackaging — that decision gets a flag too.',
    '2. Flag only what is actually in the transcript. Never invent, infer, or add an item from general knowledge. If a sentence is ambiguous, flag it with its exact words rather than resolving it.',
    '3. One flag per distinct item. The same words are not flagged twice.',
    '4. If nothing in the transcript sounds like it belongs in a report, return {"flags":[]}.',
    '5. Output the JSON object only.'
  ].join('\n');

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

  /* Validate and normalise whatever came back into a flags array.
     Returns null when the shape is not one this page can trust. */
  function normaliseFlags(parsed) {
    var raw = null;
    if (Array.isArray(parsed)) raw = parsed;
    else if (parsed && Array.isArray(parsed.flags)) raw = parsed.flags;
    if (!raw) return null;
    var out = [];
    raw.forEach(function (f) {
      if (!f || typeof f !== 'object') return;
      var label = typeof f.label === 'string' ? f.label.trim() : '';
      var quote = typeof f.quote === 'string' ? f.quote.trim() : '';
      if (label && quote) out.push({ label: label, quote: quote });
    });
    return out;
  }

  /* Ask Spark to flag the transcript. Resolves with a flags array
     (possibly empty); rejects with an Error whose .userMessage is the
     plain-words failure to show the receiver. A reply that is not
     readable JSON in the flags shape rejects as 'unparseable' — the
     caller renders "flags unavailable" and the transcript stands. */
  function ask(transcript) {
    return fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: transcript }
        ],
        temperature: 0.2,
        /* Muse Spark is a reasoning model: it thinks in tokens before it
           speaks. Ship Safe measured a 900-token budget spent entirely on
           reasoning, returning empty content; 3000 is the proxy ceiling
           and leaves room to think AND answer. */
        max_tokens: 3000
      })
    }).then(function (r) {
      if (r.status === 429) {
        var cap = new Error('cap');
        cap.userMessage = 'The flagging step is unavailable — today\'s call cap at the proxy is reached. Your spoken scan above is transcribed and safe.';
        throw cap;
      }
      if (!r.ok) {
        var http = new Error('http ' + r.status);
        http.userMessage = 'The flagging step could not be reached (the proxy answered with an error, HTTP ' + r.status + '). Your spoken scan above is transcribed and safe.';
        throw http;
      }
      return r.json();
    }).then(function (j) {
      var text = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (!text) {
        var empty = new Error('empty');
        empty.userMessage = 'The flagging step answered with nothing usable. Your spoken scan above is transcribed and safe.';
        throw empty;
      }
      var cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      var parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch (e) {
        var bad = new Error('unparseable');
        bad.userMessage = 'The flagging step answered, but not in a shape this page can read, so no flags could be pulled from it. Your spoken scan above is transcribed and safe.';
        throw bad;
      }
      var flags = normaliseFlags(parsed);
      if (!flags) {
        var wrong = new Error('unparseable');
        wrong.userMessage = 'The flagging step answered, but not in the flags shape this page can read. Your spoken scan above is transcribed and safe.';
        throw wrong;
      }
      return flags;
    });
  }

  function renderFlags(flags) {
    var box = document.getElementById('recordBox');
    var list = document.getElementById('flagsList');
    var empty = document.getElementById('flagsEmpty');
    var unavail = document.getElementById('flagsUnavailable');
    list.innerHTML = '';
    flags.forEach(function (f) {
      var item = el('div', 'flag');
      item.appendChild(el('p', 'flag-label', f.label));
      item.appendChild(el('p', 'flag-quote', f.quote));
      list.appendChild(item);
    });
    if (empty) empty.hidden = flags.length !== 0;
    if (unavail) unavail.hidden = true;
    lastFlags = flags;
    box.hidden = false;
    var sb = document.getElementById('saveBtn');
    if (sb) sb.hidden = false;
  }

  /* The flagging step failed: the transcript above is the record.
     Say so plainly, and still offer Save — the raw transcript is
     exactly what needs saving. */
  function renderFlagsUnavailable() {
    var box = document.getElementById('recordBox');
    var list = document.getElementById('flagsList');
    var empty = document.getElementById('flagsEmpty');
    var unavail = document.getElementById('flagsUnavailable');
    if (list) list.innerHTML = '';
    if (empty) empty.hidden = true;
    if (unavail) unavail.hidden = false;
    lastFlags = null;
    box.hidden = false;
    var sb = document.getElementById('saveBtn');
    if (sb) sb.hidden = false;
  }

  /* The plain-text form of a scan, used ONLY by the share/copy
     fallback (when storage is not connected yet): the picked load's
     label first when there is one, then the spoken scan verbatim,
     then the flags with their verbatim quotes. */
  function buildShareText() {
    var transcript = lastTranscript;
    if (!transcript) {
      var t = document.getElementById('transcriptText');
      transcript = t ? t.textContent : '';
    }
    if (!transcript) return '';
    var lines = [];
    if (selectedLoad && LOADS[selectedLoad]) {
      lines.push(LOADS[selectedLoad]);
      lines.push('');
    }
    lines.push('Spoken scan (verbatim):');
    lines.push(transcript);
    lines.push('');
    if (lastFlags === null) {
      lines.push('Flags: unavailable for this scan.');
    } else if (!lastFlags.length) {
      lines.push('Flags: Nothing flagged in this scan.');
    } else {
      lines.push('Flags:');
      lastFlags.forEach(function (f) { lines.push('- ' + f.label + ': "' + f.quote + '"'); });
    }
    return lines.join('\n');
  }

  function resetSave() {
    var sb = document.getElementById('saveBtn');
    if (sb) { sb.hidden = true; sb.disabled = false; sb.textContent = 'Save this scan'; }
    var fb = document.getElementById('shareFallback');
    if (fb) fb.hidden = true;
    var ta = document.getElementById('shareText');
    if (ta) ta.value = '';
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  }

  function flashSaveButton(text) {
    var sb = document.getElementById('saveBtn');
    if (!sb) return;
    sb.textContent = text;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      sb.textContent = 'Save this scan';
      saveTimer = null;
    }, 3000);
  }

  /* Last-resort copy: no Web Share, no clipboard — write the text
     into a selectable box and let the receiver copy it by hand. */
  function showTextFallback(text) {
    var fb = document.getElementById('shareFallback');
    var ta = document.getElementById('shareText');
    if (!fb || !ta) {
      showError('This browser offers no way to share or copy the scan. The transcript and flags above are on this screen only.');
      return;
    }
    ta.value = text;
    fb.hidden = false;
    ta.focus();
    try { ta.select(); } catch (e) {}
  }

  function copyScan(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flashSaveButton('Copied — send it on'); }, function () { showTextFallback(text); });
    } else {
      showTextFallback(text);
    }
  }

  /* The pre-storage share behaviour, kept whole as the fallback:
     Web Share where it exists, clipboard behind it, selectable text
     behind that. */
  function shareScan() {
    var text = buildShareText();
    if (!text) return;
    if (typeof navigator !== 'undefined' && navigator.share) {
      navigator.share({ title: 'Witness — receiving scan', text: text }).then(function () {}, function (err) {
        if (err && err.name === 'AbortError') return; /* the receiver cancelled — their call, not a failure */
        copyScan(text);
      });
    } else {
      copyScan(text);
    }
  }

  /* Save: POST the scan to the Worker's /save route. The transcript
     sent is lastTranscript — the verbatim ASR output, exactly as it
     came back, never the formatted share text. */
  function saveScan() {
    var transcript = lastTranscript;
    if (!transcript) {
      var t = document.getElementById('transcriptText');
      transcript = t ? t.textContent : '';
    }
    if (!transcript) return;
    var sb = document.getElementById('saveBtn');
    var payload = {
      load: (selectedLoad && LOADS[selectedLoad]) ? LOADS[selectedLoad] : null,
      transcript: transcript,
      flags: lastFlags || [],
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
        flashSaveButton('Saved.');
        setStatus('Saved.', 'done');
        return;
      }
      if (res.status === 501 || (res.body && res.body.error === 'storage-not-connected')) {
        /* Storage is not connected yet — never block the tester:
           fall back to share/copy and label it for what it is. */
        if (sb) sb.textContent = "Storage isn't connected yet — copy instead";
        setStatus("Storage isn't connected yet — copy instead.", '');
        shareScan();
        return;
      }
      showError('Saving failed (the storage route answered HTTP ' + res.status + '). Your scan is on this screen — use the copy below so it is not lost.');
      showTextFallback(buildShareText());
      flashSaveButton('Save this scan');
    }).catch(function () {
      if (sb) sb.disabled = false;
      showError('Saving failed — the storage route could not be reached. Your scan is on this screen — use the copy below so it is not lost.');
      showTextFallback(buildShareText());
      flashSaveButton('Save this scan');
    });
  }

  /* Test-load picking: tapping a load marks it as the one being
     scanned; tapping it again unpicks it. The pick never changes the
     scan itself — it only labels the saved scan, so samples come
     back pre-labeled. */
  function initLoads() {
    var btns = document.querySelectorAll('.load[data-load]');
    var status = document.getElementById('loadStatus');
    if (!btns.length) return;
    function paint() {
      Array.prototype.forEach.call(btns, function (b) {
        var on = b.getAttribute('data-load') === selectedLoad;
        b.classList.toggle('selected', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      if (status) {
        status.textContent = selectedLoad
          ? LOADS[selectedLoad] + ' picked — hold the button below and say what you see.'
          : 'No load picked. Pick one, or just scan the pallet in front of you.';
      }
      if (window.WitnessPhoto && window.WitnessPhoto.refresh) window.WitnessPhoto.refresh();
    }
    Array.prototype.forEach.call(btns, function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-load');
        selectedLoad = (selectedLoad === key) ? null : key;
        paint();
      });
    });
    paint();
  }

  function initSave() {
    var sb = document.getElementById('saveBtn');
    if (sb) sb.addEventListener('click', saveScan);
  }

  /* Entry point, called by voice.js with the verbatim transcript. */
  function structure(transcript) {
    lastTranscript = transcript;
    lastFlags = null;
    resetSave();
    document.getElementById('recordBox').hidden = true;
    setStatus('Flagging what belongs in the report…', 'busy');
    ask(transcript).then(function (flags) {
      renderFlags(flags);
      setStatus(flags.length
        ? 'Flagged. Check it against the pallet — you are the one who signs off.'
        : 'Nothing flagged in this scan. You are the one who signs off.', 'done');
      if (window.WitnessPhoto && window.WitnessPhoto.refresh) window.WitnessPhoto.refresh();
    }).catch(function (e) {
      renderFlagsUnavailable();
      if (window.WitnessPhoto && window.WitnessPhoto.refresh) window.WitnessPhoto.refresh();
      setStatus('Transcribed. Flags unavailable for this scan.', '');
      showError((e && e.userMessage) || 'The flagging step failed for a reason this page could not read. Your spoken scan above is transcribed and safe.');
    });
  }

  function init() { initLoads(); initSave(); }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else { init(); }
  }

  window.WitnessRecord = {
    structure: structure,
    SYSTEM_PROMPT: SYSTEM_PROMPT,
    _ask: ask,
    _buildShareText: buildShareText,
    _saveScan: saveScan,
    getSelectedLoad: function () {
      return selectedLoad && LOADS[selectedLoad]
        ? { key: selectedLoad, label: LOADS[selectedLoad] }
        : null;
    },
    getLastFlags: function () { return lastFlags; },
    getLastTranscript: function () { return lastTranscript; }
  };
})();
