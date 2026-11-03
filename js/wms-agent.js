/* =====================================================================
   wms-agent.js — the agent in the Witness page's chair (console Task 3).

   The desk user TYPES or SPEAKS to this item's Witness, right on the
   item's page. Two things can happen, and the page always says which:

   - ASK   — a question. askItem() sends the item's own record (its
             events, its full transcript, what it is now) plus the
             question to Muse Spark through the Worker's /chat, bound
             to answer only from that record. The answer is checked:
             every number and every quoted phrase is looked up in the
             record, and the page says which were not found. Asking
             saves nothing.
   - TELL  — anything else. deskEntry() adds the words to the item's
             record as the desk user's own words (a "desk entry"), so
             they join the transcript, and mint an event: "Desk
             update", or "Decided" when the words state a decision.
             A decision is recorded as that person's act. It moves
             nothing in the building; the desk controls do that.

   Which one is decided LOCALLY and deterministically (intentOf), the
   same way converse.js matchIntent reads a worker — no model decides
   what the human meant. The page also has an explicit Ask button and
   an explicit "Add to the record" button.

   The /chat plumbing is converse.js's (CHAT_URL, replyText,
   checkNumbers), reused, not forked. Pure: the caller hands in fetch.
   Loads in the browser (window.WitnessWmsAgent) and in node.

   Enterprise note: in a real program this agent is manager-gated
   (docs/wms.md). Nothing here gates it.
   ===================================================================== */
(function (root) {
  'use strict';

  function lib(name, file) {
    if (root[name]) return root[name];
    if (typeof require === 'function') { try { return require(file); } catch (e) { /* browser */ } }
    return null;
  }
  var E = lib('WitnessEngine', './engine.js');
  var C = lib('WitnessConverse', './converse.js');
  function WP() { return lib('WitnessWmsWitness', './wms-witness.js'); }

  var MAX_TOKENS = 6000;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function arr(x) { return Array.isArray(x) ? x : []; }
  function who(state, id) { var u = id && E ? E.unitById(state, id) : null; return u ? u.name : null; }
  function shortDesc(d) { return String(d || '').replace(/ — .*/, ''); }
  function hhmm(ts) {
    var d = ts ? new Date(ts) : null;
    if (!d || isNaN(d)) return 'time not recorded';
    return d.toISOString().slice(11, 16) + ' UTC';
  }

  /* ---------- ask or tell? ------------------------------------------- */

  var WAKE = /^(hey|hi|ok|okay)?\s*(muse|witness)\b[\s,]*/;
  var QUESTION = /^(why|what|what'?s|who|who'?s|whose|when|where|how|which|is|are|was|were|did|does|do(?!\s+not\b)|has|have|had|can|could|should|would|will|tell me|show me|explain|any)\b/;
  var DECISION = /\b(i'?ve decided|i decided|i'?m deciding|decided|decision|my call|i'?m calling it|approve|approved|reject|rejected|accept|accepted|write (it |this )?off|written off|send (it |this |them )?back|return (it |this |them )?to (the )?(vendor|carrier|supplier)|refuse|refused|scrap|dispose|keep (it |this )?on hold|keep the hold|release (it|this|the hold)|ship (it|this) (as is|anyway)|ship as is|use as is|sell as is|(do not|don'?t) (ship|release|load|put (it |this )?away|pick|use)( (it|this|them))?)\b/;

  function norm(text) {
    return String(text || '').toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
  }

  /* 'ask' | 'decision' | 'update' | 'empty'. A question mark or a
     question word asks; stated decision words record a decision;
     anything else is an update for the record. */
  function intentOf(text) {
    var raw = String(text || '').trim();
    if (!raw) return 'empty';
    var t = norm(raw).replace(WAKE, '');
    if (!t) return 'empty';
    if (/\?\s*$/.test(raw) || QUESTION.test(t)) return 'ask';
    if (DECISION.test(t)) return 'decision';
    return 'update';
  }

  /* ---------- the item's record, as plain text ------------------------ */

  var SAY = { voice: 'spoken', typed: 'typed', update: 'update', 'voice, corrected': 'spoken, then corrected', 'desk-typed': 'typed at the desk', 'desk-voice': 'spoken at the desk' };

  function nowLines(state, s) {
    var L = [];
    if (s.kind === 'pallet') {
      arr(state.staging).forEach(function (p) {
        if (p.id !== s.id) return;
        L.push('Pallet ' + p.id + ': ' + p.qty + ' × ' + p.desc + ', in the Receiving Bay at ' + p.door + '.');
        L.push(p.hold ? 'On hold' + (p.hold.reason ? ': ' + p.hold.reason : '') + '.' : 'Not on hold.');
        if (p.damaged) L.push('Marked damaged at receipt.');
      });
    } else if (s.kind === 'bin') {
      var b = E.binById(state, s.id);
      if (b) {
        L.push('Bin ' + b.id + ', Zone ' + b.zone + ': ' + (b.contents.length ? b.contents.map(function (c) { return c.qty + ' × ' + c.desc; }).join('; ') : 'empty') + '.');
        L.push(b.status === 'hold' ? 'On hold' + (b.hold && b.hold.reason ? ': ' + b.hold.reason : '') + '.' : 'Not on hold.');
      }
    } else if (s.kind === 'order') {
      var o = null;
      arr(state.outbound).concat(arr(state.wms && state.wms.orders)).forEach(function (x) { if (x.id === s.id) o = x; });
      if (o) {
        L.push('Order ' + o.id + (o.customer ? ' for ' + o.customer : '') + ': ' + (o.status || 'status not said') + '.');
        arr(o.lines).forEach(function (l) {
          L.push('Line: ' + l.qty + ' × ' + l.desc + (l.pickedQty != null ? ', picked ' + l.pickedQty : '') + (l.done ? ', done' : ', not done') + '.');
        });
      }
    } else if (s.kind === 'shipment') {
      var sh = E.shipmentById(state, s.id);
      if (sh) {
        L.push('Shipment ' + sh.id + ': ' + sh.pallets + ' pallets, ' + sh.status + ', at ' + sh.door + '.');
        arr(state.staging).forEach(function (p) {
          if (p.shipmentId === sh.id) L.push('Staged: ' + p.id + ' — ' + p.qty + ' × ' + shortDesc(p.desc) + (p.hold ? ' — ON HOLD' : ''));
        });
      }
    } else if (s.kind === 'task') {
      var t = E.taskById(state, s.id);
      if (t) L.push('Task ' + t.id + ': ' + t.title + (t.detail ? ' — ' + t.detail : '') + '. Status ' + t.status + (t.assignee ? ', with ' + (who(state, t.assignee) || t.assignee) : '') + '.');
    }
    if (!L.length && s.sub) L.push(s.title + ': ' + s.sub + '.');
    if (s.facts && s.facts.length) L.push('Facts: ' + s.facts.join(', ') + '.');
    return L;
  }

  /* Returns { text, model }. Everything the agent may use is in text;
     nothing else is sent. */
  function itemContext(state, place, id) {
    var m = WP().model(state, place, id);
    var s = m.subject;
    var L = [];
    L.push('ITEM RECORD — ' + (s.found ? s.title : place + ' ' + id + ' (not in the desk record now)'));
    if (!s.found) { L.push('This item is not in the desk record. Nothing else is known.'); return { text: L.join('\n'), model: m }; }
    L.push('');
    L.push('WHAT IT IS NOW:');
    nowLines(state, s).forEach(function (x) { L.push(x); });
    L.push('');
    L.push('EVENTS (oldest first):');
    if (!m.events.length) L.push('None on the record.');
    m.events.forEach(function (e, i) {
      L.push((i + 1) + '. ' + hhmm(e.ts) + ' — ' + e.verb + ' — ' + e.text + ' — ' +
        (e.by ? (e.decision ? 'decided by ' : 'by ') + (who(state, e.by) || e.by) : 'not said who'));
    });
    L.push('');
    L.push('FULL TRANSCRIPT (verbatim, oldest first):');
    if (!m.transcript.length) L.push('Nothing said on the record.');
    m.transcript.forEach(function (x, i) {
      L.push((i + 1) + '. ' + hhmm(x.ts) + ' — ' + (who(state, x.by) || 'not said who') + ' (' + (SAY[x.source] || x.source) + (x.about ? ', ' + x.about : '') + '): "' + x.words + '"');
    });
    return { text: L.join('\n'), model: m };
  }

  /* ---------- ask ----------------------------------------------------- */

  var SYSTEM_PROMPT = [
    'You are the Witness agent on one warehouse item\'s page. A person at the desk asks you about THIS item.',
    'Answer ONLY from the ITEM RECORD in the user message. It is the whole truth you have.',
    'When you tell what someone said, quote their exact words in double quotes and name who said it. Never reword a quote.',
    'Name the person for every act. If the record does not say who, say "not said who".',
    'If the record cannot answer, say "Not on the record." and say in one line what is missing. Never guess.',
    'You report and propose; a human decides. Never say you did, moved, released, closed or decided anything.',
    'Plain dock words. Short lines. At most 5 lines. No markdown, no bullets, no preamble.'
  ].join('\n');

  function itemMessages(question, contextText) {
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: contextText + '\n\nDESK QUESTION: ' + String(question).trim() }
    ];
  }

  /* Quoted phrases in the answer, and whether each is in the record. */
  function checkQuotes(answer, contextText) {
    var flat = norm(contextText);
    var found = [], missing = [];
    var re = /["“]([^"”]{3,})["”]/g, m;
    while ((m = re.exec(String(answer || '')))) {
      var q = m[1].trim();
      (flat.indexOf(norm(q)) !== -1 ? found : missing).push(q);
    }
    return { found: found, missing: missing };
  }

  function fail(code, message) { var e = new Error(code); e.userMessage = message; return e; }

  /* One question, one answer, from this item's record. Tries once; on
     an empty reply tries once more; then gives up honestly. Resolves
     { answer, context, check: { numbers, quotes }, attempts }. */
  function askItem(opts) {
    var question = String(opts.question || '').trim();
    if (!question) return Promise.reject(fail('no-question', 'Type or say a question first.'));
    var ctx = itemContext(opts.state, opts.place, opts.id);
    var body = JSON.stringify({ messages: itemMessages(question, ctx.text), temperature: 0.1, max_tokens: opts.maxTokens || MAX_TOKENS });
    var doFetch = opts.fetch;

    function attempt(n) {
      return Promise.resolve().then(function () {
        return doFetch(opts.url || C.CHAT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body });
      }).then(function (r) {
        if (r.status === 429) throw fail('cap', 'No answer — today\'s call limit is used up. The record on this page still stands.');
        if (!r.ok) throw fail('http', 'No answer — the proxy answered with an error (HTTP ' + r.status + '). Nothing was guessed.');
        return r.json().catch(function () { throw fail('bad-json', 'No answer — the reply could not be read. Nothing was guessed.'); });
      }, function (e) {
        if (e && e.userMessage) throw e;
        throw fail('network', 'No answer — the agent could not be reached. Nothing was guessed.');
      }).then(function (j) {
        var text = C.replyText(j);
        if (text) return { answer: text, attempts: n };
        if (n < 2) return attempt(n + 1);
        throw fail('empty', 'No answer — the agent came back empty twice. Nothing was guessed. Try a shorter question.');
      });
    }

    return attempt(1).then(function (res) {
      return { answer: res.answer, attempts: res.attempts, context: ctx.text,
        check: { numbers: C.checkNumbers(res.answer, ctx.text), quotes: checkQuotes(res.answer, ctx.text) } };
    });
  }

  /* ---------- tell: desk words join the record ------------------------ */

  /* The keys a desk entry is filed under, so it shows on this item's
     page and on the pages that hold this item (a pallet's shipment,
     the bin it was put away in, an order's load). */
  function keysOf(s) {
    var k = { place: s.kind, id: s.id };
    if (s.kind === 'pallet') k.stagingId = s.id;
    if (s.kind === 'shipment') k.shipmentId = s.id;
    if (s.kind === 'order') k.orderId = s.id;
    if (s.kind === 'load') k.loadId = s.id;
    if (s.kind === 'bin') k.binId = s.id;
    if (s.kind === 'task') k.taskId = s.id;
    if (s.kind === 'dock') k.doorId = s.id;
    return k;
  }

  /* Adds the desk user's words to the item's record. Mutates state
     (call it inside store.mutate). opts: { by, words, source:
     'typed'|'voice', decision, ts }. Returns { ok, record } or
     { ok:false, reason }. */
  function deskEntry(state, place, id, opts) {
    opts = opts || {};
    var words = String(opts.words || '').trim();
    if (!words) return { ok: false, reason: 'Say or type something first. Nothing was added.' };
    var s = WP().subject(state, place, id);
    if (!s.found) return { ok: false, reason: 'This item is not in the desk record now. Nothing was added.' };
    var by = opts.by && E.unitById(state, opts.by) ? opts.by : null;
    var decision = opts.decision === undefined ? intentOf(words) === 'decision' : !!opts.decision;
    var source = opts.source === 'voice' ? 'voice' : 'typed';
    var name = who(state, by) || 'the desk (not said who)';
    var r = {
      ts: opts.ts || new Date().toISOString(),
      kind: 'desk',
      text: (decision ? 'Decision at the desk on ' : 'Desk update on ') + s.title + ' from ' + name + ': ' + words,
      by: by,
      words: words,
      source: source,
      decision: decision,
      on: keysOf(s)
    };
    state.records = state.records || [];
    state.records.push(r);
    return { ok: true, record: r, decision: decision, title: s.title };
  }

  /* ---------- the chair ------------------------------------------------ */

  function numbersLine(c) {
    if (!c) return '';
    var n = c.numbers || { found: [], missing: [] }, q = c.quotes || { found: [], missing: [] };
    var bits = [];
    if (n.found.length || q.found.length) bits.push('Found in this record: ' + n.found.concat(q.found.map(function (x) { return '"' + x + '"'; })).join(', ') + '.');
    if (n.missing.length || q.missing.length) bits.push('NOT found in this record — check it yourself: ' + n.missing.concat(q.missing.map(function (x) { return '"' + x + '"'; })).join(', ') + '.');
    return bits.join(' ');
  }

  function turnHtml(state, t) {
    if (t.kind === 'ask') {
      return '<li class="ag-turn ag-you"><span class="ag-tag">' + esc(who(state, t.by) || 'You') + ' asked' + (t.source === 'voice' ? ' (spoken)' : '') + '</span><p>' + esc(t.q) + '</p></li>';
    }
    if (t.kind === 'answer') {
      var c = numbersLine(t.check);
      var bad = t.check && ((t.check.numbers && t.check.numbers.missing.length) || (t.check.quotes && t.check.quotes.missing.length));
      return '<li class="ag-turn ag-agent"><span class="ag-tag">The agent · from this item\'s record</span><p>' + esc(t.text) + '</p>' +
        (c ? '<div class="ag-check' + (bad ? ' warn' : '') + '">' + esc(c) + '</div>' : '') +
        '<div class="ag-law">It reports; you decide. Nothing was changed.</div>' +
        (t.context ? '<details><summary>Everything it was given</summary><pre>' + esc(t.context) + '</pre></details>' : '') + '</li>';
    }
    if (t.kind === 'pending') return '<li class="ag-turn ag-agent pending"><span class="ag-tag">The agent</span><p>Reading this item\'s record…</p></li>';
    if (t.kind === 'error') return '<li class="ag-turn ag-agent err"><span class="ag-tag">The agent</span><p>' + esc(t.text) + '</p></li>';
    if (t.kind === 'recorded') {
      var n = who(state, t.by) || 'Not said who';
      return '<li class="ag-turn ag-rec' + (t.decision ? ' decision' : '') + '"><span class="ag-tag">Added to the record · ' + esc(n) + '\'s words · ' + (t.source === 'voice' ? 'spoken' : 'typed') + ' at the desk</span>' +
        '<blockquote>' + esc(t.words) + '</blockquote>' +
        (t.decision
          ? '<div class="ag-law">Recorded as <b>' + esc(n) + '</b>\'s decision. Nothing in the building was moved — use the desk controls to act on it.</div>'
          : '<div class="ag-law">It is in the transcript below, and on the events as a desk update.</div>') + '</li>';
    }
    if (t.kind === 'not-recorded') return '<li class="ag-turn ag-agent err"><span class="ag-tag">Not added</span><p>' + esc(t.text) + '</p></li>';
    return '';
  }

  /* view: { turns: [], busy: bool, draft: '', me: unitId } */
  function chairHtml(state, s, view) {
    view = view || {};
    var me = who(state, view.me);
    var turns = arr(view.turns);
    return '<section class="wp-agent ag-live" data-slot="agent" aria-label="The agent">' +
      '<div class="wp-agent-h">The agent <span class="ag-scope">Answers from this item\'s record only</span></div>' +
      '<p class="ag-intro">Ask about ' + esc(s.title) + ', or tell it what happened. ' +
        'What you tell it joins the record as <b>' + esc(me || 'your') + (me ? '\'s' : '') + '</b> words. A decision you state is recorded as yours; nothing in the building moves on its own.</p>' +
      (turns.length ? '<ol class="ag-log" aria-live="polite">' + turns.map(function (t) { return turnHtml(state, t); }).join('') + '</ol>' : '') +
      '<div class="ag-form">' +
        '<label class="ag-label" for="agQ">Ask or tell</label>' +
        '<textarea id="agQ" rows="2" placeholder="Why is this flagged?  ·  Who saw the damage?  ·  Called the carrier — they will credit four cases."' + (view.busy ? ' disabled' : '') + '>' + esc(view.draft || '') + '</textarea>' +
        '<div class="ag-btns">' +
          '<button type="button" class="btn talk" id="agTalk"' + (view.busy ? ' disabled' : '') + '>🎙 Hold to speak</button>' +
          '<button type="button" class="btn" data-act="agent-ask"' + (view.busy ? ' disabled' : '') + '>Ask</button>' +
          '<button type="button" class="btn primary" data-act="agent-tell"' + (view.busy ? ' disabled' : '') + '>Add to the record</button>' +
          '<span class="ag-status" id="agStatus">' + (view.busy ? 'Working…' : '') + '</span>' +
        '</div>' +
        '<p class="ag-hint">Enter or speaking: a question is asked; anything else is added to the record as your words.</p>' +
      '</div></section>';
  }

  var api = {
    SYSTEM_PROMPT: SYSTEM_PROMPT,
    intentOf: intentOf,
    itemContext: itemContext,
    itemMessages: itemMessages,
    checkQuotes: checkQuotes,
    askItem: askItem,
    deskEntry: deskEntry,
    keysOf: keysOf,
    chairHtml: chairHtml
  };
  root.WitnessWmsAgent = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
