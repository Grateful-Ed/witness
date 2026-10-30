/* =====================================================================
   record.js — Witness Step 1, second half: transcript -> record.

   The transcript (the receiver's own words, shown verbatim by voice.js)
   goes to Muse Spark through the project proxy's /chat route — the same
   OpenAI-shaped call Ship Safe's AI review makes — with the structuring
   prompt below. Spark returns one JSON object; this file renders it as
   labeled rows, exactly as returned.

   THE RULE the prompt carries: the record captures JUDGMENTS and ACTIONS,
   not only observations — a segregation call, a rewrap call, a routing
   decision are record content. And nothing is invented: a field the
   speaker didn't address comes back null / empty and renders as
   "Not said". That rule comes straight out of Foundation Sample 001
   (William's spoken scan of Test Load 001, 2026-10-28).

   The API key is never in this page. It lives in the Cloudflare Worker
   behind the proxy.
   ===================================================================== */
(function () {
  'use strict';

  var CHAT_URL = 'https://witness.e-william-harris96.workers.dev/chat';

  var FIELDS = [
    { key: 'count_main',         label: 'Boxes in the main stack', type: 'number' },
    { key: 'odd_units',          label: 'Odd / extra units',       type: 'list' },
    { key: 'stack_state',        label: 'How the stack sits',      type: 'text' },
    { key: 'security',           label: 'Secure for handling?',    type: 'text' },
    { key: 'hazards_noticed',    label: 'Hazards noticed',         type: 'list' },
    { key: 'segregation_action', label: 'Separation call',         type: 'text' },
    { key: 'wrap_state',         label: 'Wrap',                    type: 'text' },
    { key: 'rewrap_action',      label: 'Rewrap',                  type: 'text' },
    { key: 'temperature_notes',  label: 'Temperature',             type: 'text' },
    { key: 'disposition',        label: 'Goes to',                 type: 'text' },
    { key: 'anything_else',      label: 'Anything else said',      type: 'list' }
  ];

  var SYSTEM_PROMPT = [
    'You turn a warehouse receiver\'s spoken description of one pallet into a structured receiving record.',
    '',
    'The input is a speech transcript. It is one person describing what they see and what they have decided about the load — counts, condition, judgments and actions mixed together, the way people actually talk on a dock.',
    '',
    'Return ONLY a JSON object with exactly these fields, no prose, no code fences:',
    '',
    '- "count_main": the number of boxes/cartons the speaker counted in the main stack — a number, or null. Odd units the speaker named separately do NOT go in this number.',
    '- "odd_units": extra or non-standard units the speaker named apart from the main count (for example a long carton lying across the top, a loose pail), as an array of short strings. Empty array if none.',
    '- "stack_state": how the stack sits — leaning, crooked, straight, cattywampus — in the speaker\'s own wording where you can. String or null.',
    '- "security": the speaker\'s judgment of whether the load is secure and stable for handling. String or null.',
    '- "hazards_noticed": hazards or hazard mixes the speaker noticed (for example different dangerous goods on one pallet), as an array of short strings. Empty array if none.',
    '- "segregation_action": any judgment or action the speaker stated about goods needing to be separated. String or null.',
    '- "wrap_state": the state of the wrap — intact, broken, partial, missing. String or null.',
    '- "rewrap_action": any stated need or plan to rewrap. String or null.',
    '- "temperature_notes": anything the speaker said about temperature control, or about mixing temperature-controlled and non-controlled goods. String or null.',
    '- "disposition": where the speaker said the load goes next (for example "to repackaging"). String or null.',
    '- "anything_else": any other real content from the description that fits none of the fields above, as an array of short strings. Empty array if none.',
    '',
    'Rules:',
    '1. Capture judgments and actions, not only observations. If the speaker decided something — goods need separating, the load needs rewrap, it moves to repackaging — that decision belongs in the record.',
    '2. A field the speaker did not address is null (or an empty array for a list). Never invent, infer, or complete a field from general knowledge.',
    '3. Do not count anything yourself. If the speaker gave no number for the main stack, "count_main" is null.',
    '4. Stay close to the speaker\'s words. Light tidying of filler ("um", "uh") is fine; changing a meaning is not.',
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

  /* Ask Spark to structure the transcript. Resolves with the parsed
     record object; rejects with an Error whose .userMessage is the
     plain-words failure to show the receiver. */
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
        cap.userMessage = 'The structuring step is unavailable — today\'s call cap at the proxy is reached. Your spoken scan above is transcribed and safe; the record could not be built from it right now.';
        throw cap;
      }
      if (!r.ok) {
        var http = new Error('http ' + r.status);
        http.userMessage = 'The structuring step could not be reached (the proxy answered with an error, HTTP ' + r.status + '). Your spoken scan above is transcribed and safe; no record was built.';
        throw http;
      }
      return r.json();
    }).then(function (j) {
      var text = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (!text) {
        var empty = new Error('empty');
        empty.userMessage = 'The structuring step answered with nothing usable. Your spoken scan above is transcribed and safe; no record was built.';
        throw empty;
      }
      var cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      try {
        return JSON.parse(cleaned);
      } catch (e) {
        var bad = new Error('unparseable');
        bad.userMessage = 'The structuring step answered, but not in the record shape this page can read. Your spoken scan above is transcribed and safe; no record was built.';
        throw bad;
      }
    });
  }

  function renderRecord(rec) {
    var box = document.getElementById('recordBox');
    var rows = document.getElementById('recordRows');
    rows.innerHTML = '';
    FIELDS.forEach(function (f) {
      var v = rec ? rec[f.key] : undefined;
      var row = el('div', 'row');
      row.appendChild(el('dt', null, f.label));
      var dd;
      if (f.type === 'list') {
        var items = Array.isArray(v) ? v.filter(function (s) { return typeof s === 'string' && s.trim(); }) : [];
        if (!items.length) {
          dd = el('dd', 'unsaid', 'Not said');
        } else if (items.length === 1) {
          dd = el('dd', null, items[0]);
        } else {
          dd = el('dd');
          var ul = el('ul');
          items.forEach(function (s) { ul.appendChild(el('li', null, s)); });
          dd.appendChild(ul);
        }
      } else if (v == null || v === '') {
        dd = el('dd', 'unsaid', 'Not said');
      } else {
        dd = el('dd', null, String(v));
      }
      row.appendChild(dd);
      rows.appendChild(row);
    });
    box.hidden = false;
  }

  /* Entry point, called by voice.js with the verbatim transcript. */
  function structure(transcript) {
    document.getElementById('recordBox').hidden = true;
    setStatus('Building the record from your words…', 'busy');
    ask(transcript).then(function (rec) {
      renderRecord(rec);
      setStatus('Record built. Check it against the pallet — you are the one who signs off.', 'done');
    }).catch(function (e) {
      setStatus('Transcribed. The record could not be built.', '');
      showError((e && e.userMessage) || 'The structuring step failed for a reason this page could not read. Your spoken scan above is transcribed and safe; no record was built.');
    });
  }

  window.WitnessRecord = {
    structure: structure,
    SYSTEM_PROMPT: SYSTEM_PROMPT,
    FIELDS: FIELDS,
    _ask: ask
  };
})();
