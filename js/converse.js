/* =====================================================================
   converse.js — the conversational layer (areas 7–8): the worker
   talks to the queue, the manager asks the building a question.

   Pure, like engine.js: no DOM, no microphone. Network only through
   a fetch function the caller hands in, so node tests stub it.
   Loads in the browser (window.WitnessConverse) and in node
   (module.exports).

   Two halves:
   - WORKER: matchIntent() turns a transcript into one of four
     intents, LOCALLY and deterministically — no model decides what
     a worker meant. workerTurn() carries the intent out through the
     engine (complete, pull next, report a problem) or does nothing.
   - MANAGER: buildStateSummary() writes the building's live numbers
     as plain text; askManager() sends that text plus the question to
     Muse Spark (Worker POST /chat), bound to answer only from those
     numbers; checkNumbers() then tells the manager which numbers in
     the answer are, and are not, in the data.
   ===================================================================== */
(function (root) {
  'use strict';

  var WORKER_BASE = 'https://witness.e-william-harris96.workers.dev';
  var CHAT_URL = WORKER_BASE + '/chat';
  var ASR_URL = WORKER_BASE + '/asr';

  /* Spark reasons before it speaks and the reasoning bills against
     max_tokens (a comparison once starved at 3,000). A manager answer
     is short, but the reasoning over a building isn't: 6,000. */
  var MANAGER_MAX_TOKENS = 6000;

  /* ---------- worker: what did they say? ---------------------------- */

  /* Wake words are stripped so "Hey Muse, what's next" reads the same
     as "what's next". */
  var WAKE = /^(hey|hi|ok|okay)?\s*muse\b[\s,]*/;

  /* Phrases that sound like a problem or a completion but say the
     opposite. Removed before matching. */
  var NOT_A_PROBLEM = /\b(no|not a|not any|without any?) (problems?|issues?|trouble)\b/g;
  var NOT_DONE = /\b(not|isn'?t|aren'?t|ain'?t|haven'?t|hasn'?t|wasn'?t|not yet|almost|nearly|never|not quite) (yet )?(done|finished|complete|completed)\b|\bhaven'?t (finished|completed)\b|\bnot (finished|done) yet\b/g;

  var PROBLEM = /\b(problem|problems|issue|issues|broken|broke|damage|damaged|spill|spilled|spilt|leak|leaking|leaks|can'?t|cannot|missing|short|wrong|stuck|blocked|hurt|injured|crushed|torn|collapsed|report)\b/;
  var DONE = /\b(done|finished|finish|complete|completed|all set|wrapped up|got it put away)\b/;
  var NEXT = /\b(what'?s (up )?next|what is (up )?next|next task|next one|next|what do i do|what should i do|what have i got|what'?s my task|my task)\b/;

  function normalise(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/[^a-z0-9' ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* Returns { intent, heard }. intent is one of:
       'problem' — something is wrong; note it, complete nothing
       'done'    — close the task in hand, pull the next
       'next'    — say what's in hand, or pull one if hands are empty
       'unknown' — take no action
     Order matters: a problem beats a completion ("done, but the
     pallet's crushed" must not close the task on a bad count), and a
     completion beats a bare "what's next" (William's own line: "what's
     up next? I just got done" closes the task). */
  function matchIntent(text) {
    var heard = String(text || '').trim();
    var t = normalise(heard).replace(WAKE, '');
    if (!t) return { intent: 'unknown', heard: heard };
    var p = t.replace(NOT_A_PROBLEM, ' ');
    if (PROBLEM.test(p)) return { intent: 'problem', heard: heard };
    var d = p.replace(NOT_DONE, ' ');
    if (DONE.test(d)) return { intent: 'done', heard: heard };
    if (NEXT.test(d)) return { intent: 'next', heard: heard };
    return { intent: 'unknown', heard: heard };
  }

  /* ---------- worker: carry it out ----------------------------------- */

  function taskLine(task) {
    return task.title + (task.detail ? ' — ' + task.detail : '');
  }

  function inHand(E, state, unit) {
    if (!unit || !unit.currentTaskId) return null;
    var t = E.taskById(state, unit.currentTaskId);
    return t && t.status === 'assigned' ? t : null;
  }

  /* Runs one intent against the engine. Mutates state only through
     engine calls. Returns { intent, acted, lines[], closed, next,
     problem } — lines are what the screen says back, short. */
  function workerTurn(E, state, unit, match) {
    var out = { intent: match.intent, acted: false, lines: [], closed: null, next: null, problem: null };
    if (!unit) { out.lines.push('Pick your name first. Nothing was done.'); return out; }
    var current = inHand(E, state, unit);

    if (match.intent === 'unknown') {
      out.lines.push('Heard you — no action taken.');
      out.lines.push('Say "done", "what\'s next", or say what the problem is.');
      return out;
    }

    if (match.intent === 'problem') {
      var rep = E.reportProblem(state, unit.id, match.heard);
      if (!rep) { out.lines.push('Nothing to note. No action taken.'); return out; }
      out.acted = true;
      out.problem = rep.entry;
      if (rep.task) {
        out.lines.push('Problem noted on your task. It\'s logged for the manager.');
        out.lines.push('Still yours: ' + rep.task.title + '.');
        out.lines.push('Nothing was closed. Say "done" when it\'s really done.');
      } else {
        out.lines.push('Problem logged for the manager. You had no task in hand.');
      }
      return out;
    }

    if (match.intent === 'next' && current) {
      out.lines.push('Still yours: ' + taskLine(current));
      out.lines.push('Say "done" when it\'s finished.');
      out.next = current;
      return out;
    }

    if (match.intent === 'done') {
      if (current) {
        if (!E.completeTask(state, current.id)) {
          out.lines.push('Could not close "' + current.title + '" — the counts would not balance.');
          out.lines.push('It stays with you. Tell your manager.');
          return out;
        }
        out.acted = true;
        out.closed = current;
        out.lines.push('Closed: ' + current.title + '.');
      } else {
        out.lines.push('Nothing was in hand to close.');
      }
    }

    var next = E.nextTaskFor(state, unit);
    if (next) {
      out.acted = true;
      out.next = next;
      out.lines.push('Next: ' + taskLine(next));
    } else {
      out.lines.push('No work waiting. The building is caught up.');
    }
    return out;
  }

  /* ---------- manager: the building as numbers ------------------------ */

  function doorZone(state, doorId) {
    for (var i = 0; i < state.doors.length; i++) if (state.doors[i].id === doorId) return state.doors[i].zone;
    return null;
  }

  /* The live state, compact, as plain lines. Every number the model
     may use is in here; nothing else is sent. Returns { text, facts }
     where facts is the structured form the page shows as evidence. */
  function buildStateSummary(E, state) {
    var stats = E.zoneStats(state);
    var b = E.bottleneck(state);
    var L = [];
    L.push('BUILDING STATE — seeded demo warehouse, live in this browser.');
    L.push('');
    L.push('ZONES (waiting = open or assigned tasks not done):');

    var facts = { zones: [], bottleneck: b, labor: [], incoming: [], orders: [], staged: [] };

    state.zones.forEach(function (z) {
      var s = stats[z];
      var byType = {};
      state.tasks.forEach(function (t) {
        if (t.zone === z && t.status !== 'done') byType[t.type] = (byType[t.type] || 0) + 1;
      });
      var types = Object.keys(byType).sort().map(function (k) { return k + ' ' + byType[k]; }).join(', ');
      var binsTotal = state.bins.filter(function (x) { return x.zone === z; }).length;
      var idle = state.labor.filter(function (u) {
        return u.role === 'worker' && u.zone === z && !inHand(E, state, u);
      }).length;
      var incoming = 0, coming = [];
      state.inbound.forEach(function (s2) {
        if (s2.status !== 'received' && s2.status !== 'staged at door' && doorZone(state, s2.door) === z) {
          incoming += s2.pallets;
          coming.push(s2.pallets + ' (' + s2.id + ', ' + s2.status + ')');
        }
      });
      var load = s.pending / Math.max(s.workersPresent, 1);
      var loadText = (Math.round(load * 10) / 10).toFixed(1);
      facts.zones.push({ zone: z, waiting: s.pending, byType: byType, workers: s.workersPresent, idle: idle,
        done: s.done, binsUsed: s.binsOccupied, binsTotal: binsTotal, loadPerWorker: loadText, incomingPallets: incoming });
      L.push('Zone ' + z + ': ' + s.pending + ' tasks waiting' + (types ? ' (' + types + ')' : '') +
        '; ' + s.workersPresent + ' labor units, ' + idle + ' with no task in hand; ' +
        'load ' + loadText + ' tasks per unit; ' + s.done + ' done this session; ' +
        s.binsOccupied + ' of ' + binsTotal + ' bins in use; ' +
        'pallets expected at its doors, not yet arrived: ' + (coming.length ? coming.join(' + ') : 'none') + '.');
    });

    L.push('');
    L.push('ENGINE BOTTLENECK CHECK (rule: a zone with 4 or more waiting AND at least double the lightest zone\'s load per unit):');
    if (b) {
      L.push('Zone ' + b.zone + ' is backing up: ' + b.pending + ' waiting, ' + b.workers + ' labor units. ' +
        'Engine proposes moving ' + b.suggestion.unitName + ' from Zone ' + b.suggestion.fromZone +
        ' (' + b.suggestion.fromPending + ' waiting, ' + b.suggestion.fromWorkers + ' units).');
    } else {
      L.push('No zone meets the rule right now.');
    }

    L.push('');
    L.push('LABOR UNITS:');
    state.labor.forEach(function (u) {
      var t = inHand(E, state, u);
      var row = { name: u.name, role: u.role, zone: u.zone, task: t ? t.title : null };
      facts.labor.push(row);
      L.push(u.name + ' — ' + u.role + ', Zone ' + u.zone + ' — ' + (t ? 'on: ' + t.title : (u.role === 'worker' ? 'no task in hand' : 'managing')));
    });

    L.push('');
    L.push('INBOUND:');
    state.inbound.forEach(function (s) {
      var z = doorZone(state, s.door);
      facts.incoming.push({ id: s.id, door: s.door, zone: z, pallets: s.pallets, status: s.status });
      L.push(s.id + ' — ' + s.door + ' (Zone ' + z + ') — ' + s.pallets + ' pallets — ' + s.status);
    });

    L.push('');
    L.push('STAGED AT DOORS, waiting for putaway:');
    if (!state.staging.length) L.push('Nothing staged.');
    state.staging.forEach(function (p) {
      facts.staged.push({ id: p.id, door: p.door, desc: p.desc, qty: p.qty });
      L.push(p.id + ' — ' + p.door + ' (Zone ' + doorZone(state, p.door) + ') — ' + p.qty + ' × ' + p.desc);
    });

    L.push('');
    L.push('OUTBOUND ORDERS:');
    state.outbound.forEach(function (o) {
      var left = o.lines.filter(function (l) { return !l.done; });
      facts.orders.push({ id: o.id, status: o.status, linesLeft: left.length });
      L.push(o.id + ' — ' + o.status + ' — ' + left.length + ' of ' + o.lines.length + ' lines left to pick' +
        (left.length ? ': ' + left.map(function (l) { return l.qty + ' × ' + l.desc + ' from ' + l.binId; }).join('; ') : ''));
    });

    return { text: L.join('\n'), facts: facts };
  }

  /* ---------- manager: ask ------------------------------------------- */

  var SYSTEM_PROMPT = [
    'You answer a warehouse manager\'s question about their building.',
    'Answer ONLY from the BUILDING STATE in the user message. It is the whole truth you have.',
    'Every count you say must be copied from that state. Never invent, estimate, round or project a count.',
    'If the state cannot answer the question, say so in one line and say what is missing.',
    'Name zones, people and numbers. Example shape: "Zone B is backing up: 7 tasks waiting, 2 labor units. Zone A has 2 waiting with 2 units. Move Dee Carter from Zone A to Zone B."',
    '"About to back up" means pallets expected at a zone\'s doors that have not arrived yet — use those numbers as listed.',
    'You propose labor moves; the manager decides. Never say a move is made or a task is done.',
    'Plain dock words. Short lines. At most 6 lines. No markdown, no bullets, no numbered lists, no preamble.'
  ].join('\n');

  function managerMessages(question, summaryText) {
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: summaryText + '\n\nMANAGER\'S QUESTION: ' + String(question).trim() }
    ];
  }

  /* The reply's text, from an OpenAI-shaped response. Content can be
     a string or a list of parts. '' when there is nothing. */
  function replyText(j) {
    var m = j && j.choices && j.choices[0] && j.choices[0].message;
    if (!m) return '';
    var c = m.content;
    if (typeof c === 'string') return c.trim();
    if (Array.isArray(c)) {
      return c.map(function (p) { return (p && (p.text || (typeof p === 'string' ? p : ''))) || ''; }).join('').trim();
    }
    return '';
  }

  function finishReason(j) {
    return (j && j.choices && j.choices[0] && j.choices[0].finish_reason) || null;
  }

  function fail(code, message) {
    var e = new Error(code);
    e.userMessage = message;
    return e;
  }

  /* One question, one answer. Tries once; on an empty reply tries
     exactly once more; then gives up honestly. Resolves to
     { answer, summary, check, attempts }. Rejects with an Error
     carrying userMessage — nothing is guessed in its place. */
  function askManager(opts) {
    var E = opts.engine, state = opts.state, doFetch = opts.fetch;
    var question = String(opts.question || '').trim();
    if (!question) return Promise.reject(fail('no-question', 'Type or say a question first.'));
    var summary = buildStateSummary(E, state);
    var body = JSON.stringify({
      messages: managerMessages(question, summary.text),
      temperature: 0.2,
      max_tokens: opts.maxTokens || MANAGER_MAX_TOKENS
    });

    function attempt(n) {
      return Promise.resolve().then(function () {
        return doFetch(opts.url || CHAT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body
        });
      }).then(function (r) {
        if (r.status === 429) throw fail('cap', 'No answer — today\'s call limit at the proxy is used up. The numbers on this page still stand.');
        if (!r.ok) throw fail('http', 'No answer — the proxy answered with an error (HTTP ' + r.status + '). Nothing was guessed.');
        return r.json().catch(function () {
          throw fail('bad-json', 'No answer — the reply came back in a shape this page can\'t read. Nothing was guessed.');
        });
      }, function (e) {
        if (e && e.userMessage) throw e;
        throw fail('network', 'No answer — the assistant could not be reached. Check the signal and try again. Nothing was guessed.');
      }).then(function (j) {
        var text = replyText(j);
        if (text) return { answer: text, attempts: n, finish: finishReason(j) };
        if (n < 2) return attempt(n + 1);
        throw fail('empty', 'No answer — the assistant came back empty twice' +
          (finishReason(j) === 'length' ? ' (it ran out of room thinking)' : '') +
          '. Nothing was guessed. Try again, or ask a shorter question.');
      });
    }

    return attempt(1).then(function (res) {
      return { answer: res.answer, attempts: res.attempts, summary: summary, check: checkNumbers(res.answer, summary.text) };
    });
  }

  /* ---------- manager: does the answer's arithmetic come from the data? */

  function numbersIn(text) {
    var m = String(text || '').match(/\d+(?:\.\d+)?/g) || [];
    return m.map(Number);
  }

  /* Every number in the answer, sorted into found in the data / not
     found. A number not found isn't proof of a lie (it may be the
     model's own sum) — the page says exactly that and lets the
     manager check. */
  function checkNumbers(answer, summaryText) {
    var known = {};
    numbersIn(summaryText).forEach(function (n) { known[n] = true; });
    var found = [], missing = [], seen = {};
    numbersIn(answer).forEach(function (n) {
      if (seen[n]) return;
      seen[n] = true;
      (known[n] ? found : missing).push(n);
    });
    return { found: found, missing: missing };
  }

  /* ---------- transcription reply (same shapes voice.js accepts) ------ */

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

  var api = {
    CHAT_URL: CHAT_URL,
    ASR_URL: ASR_URL,
    MANAGER_MAX_TOKENS: MANAGER_MAX_TOKENS,
    SYSTEM_PROMPT: SYSTEM_PROMPT,
    matchIntent: matchIntent,
    workerTurn: workerTurn,
    buildStateSummary: buildStateSummary,
    managerMessages: managerMessages,
    askManager: askManager,
    replyText: replyText,
    checkNumbers: checkNumbers,
    extractTranscript: extractTranscript
  };

  root.WitnessConverse = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
