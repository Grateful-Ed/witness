/* =====================================================================
   converse.js — the conversational layer (areas 7–8): the worker
   talks to the queue, the manager asks the building a question.

   Pure, like engine.js: no DOM, no microphone. Network only through
   a fetch function the caller hands in, so node tests stub it.
   Loads in the browser (window.WitnessConverse) and in node
   (module.exports).

   Two halves:
   - WORKER: the model reads the worker's words first (readWorker →
     js/wms-ai.js converseTurn, the converse model step, 2026-11-06);
     matchIntent() is the code's own deterministic read, used as the
     cross-check. Agreement proceeds; a stark disagreement is one
     clarification; no model reading is the outage ("AI is currently
     down.") — nothing staged, nothing run. workerTurn() carries an
     adjudicated intent out through the gate (complete, report a
     problem, start the worker's created job) or does nothing. Work is
     assigned, never pulled.
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

  /* The gate (js/gate.js, the gate build 2026-11-06): every act this
     door takes on the building — a close, a problem note, a start —
     goes through gate.act, which owns the checks (signature,
     the confirmation law, ownership), the run through the engine, and
     the attribution. This door keeps its own conversation and its own
     stage, exactly as before. Read lazily: a page may load the gate
     after this file. */
  function gate() {
    var g = root.WitnessGate || null;
    if (!g && typeof require === 'function') {
      try { g = require('./gate.js'); } catch (e) { g = null; }
    }
    return g;
  }
  function gateAct(E, state, unit, intent, target, words, extra, model) {
    var G = gate();
    if (!G) return { ok: false, reason: 'The gate is not loaded. Nothing was done.' };
    var params = { words: words, model: model || null };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) params[k] = extra[k];
    return G.act(state, { who: unit.id, via: 'converse', intent: intent, target: target, params: params, confirmed: intent === 'complete' ? !!(extra && extra.confirmed) : undefined }, { engine: E });
  }

  /* The two fixed lines of this door. OUTAGE is note 40's line, word
     for word (the gate's own); NOTHING_ASSIGNED is the console voice's
     answer to an ask for work with nothing assigned (PR #40). */
  var OUTAGE = 'AI is currently down.';
  var NOTHING_ASSIGNED = 'Nothing is assigned to you right now.';

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
  /* "Start" opens a job the app created (William's creation
     protocol, 2026-11-04): anchored at the front of the phrase,
     and whatever follows rides along as startText — the job's name
     to confirm, or a product to start with. */
  var START = /^(start|begin)\b\s*(.*)$/;

  /* Completion takes a confirmation (William, 2026-11-05: "Just like
     an 'are you sure you want to delete' type thing"). A completion
     word only STAGES the close and asks; the next turn decides. These
     words only mean confirm / deny while a stage is pending — with
     none pending they read as they always did (unknown, nothing acts).
     Deny is read before confirm: "no, go ahead" leaves it open. */
  var CONFIRM = /\b(yes|yeah|yep|confirm|confirmed|do it|that'?s right|go ahead)\b/;
  var DENY = /\b(no|nope|wait|cancel|not yet|never mind|nevermind)\b/;

  /* The stage lives here, in this module's own memory, keyed by the
     unit's id and holding the staged task's id. It is never written
     into the saved state: a page reload forgets it, and the record
     only ever shows confirmed completions. heardSeq counts utterances
     heard (matchIntent calls); a stage is live only for the very next
     one, so a staged act never lingers past the next turn — even when
     that turn is a question a caller hands elsewhere. */
  var stages = {};
  var heardSeq = 0;
  function liveStage(unitId) {
    var st = stages[unitId];
    if (!st) return null;
    if (heardSeq - st.seq > 1) { delete stages[unitId]; return null; }
    return st;
  }
  function anyLiveStage() {
    for (var k in stages) if (Object.prototype.hasOwnProperty.call(stages, k) && liveStage(k)) return true;
    return false;
  }
  /* Takes the unit's live stage out of memory and returns it (or null):
     whatever this turn is, it decides the stage. */
  function takeStage(unitId) {
    var st = liveStage(unitId);
    delete stages[unitId];
    return st;
  }
  function pendingStage(unitId) {
    var st = liveStage(unitId);
    return st ? { taskId: st.taskId, title: st.title } : null;
  }
  function clearStages() { stages = {}; clarifs = {}; }

  /* A clarification waiting for its answer (the interpretation model,
     notes 34/34b): module memory only, keyed by unit id, live for the
     very next utterance, never persisted. It holds the words that
     raised it, so the answer is weighed with them; once answered (or
     let go) it is gone, and the same question is never asked again. */
  var clarifs = {};
  function takeClarif(unitId) {
    var c = clarifs[unitId];
    delete clarifs[unitId];
    if (!c || heardSeq - c.seq > 1) return null;
    return c;
  }
  function pendingClarification(unitId) {
    var c = clarifs[unitId];
    if (!c || heardSeq - c.seq > 1) return null;
    return { words: c.words, question: c.question };
  }

  function normalise(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/[^a-z0-9' ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* Returns { intent, heard } — a 'start' match also carries
     startText, the words after "start"/"begin". intent is one of:
       'problem' — something is wrong; note it, complete nothing
       'done'    — close the task in hand (staged; the next yes runs it)
       'start'   — begin the created job: its first task, or the
                   named product's task ("start with the milk")
       'next'    — say what's in hand; with empty hands, that nothing
                   is assigned (work is assigned, never pulled)
       'confirm' — yes to a staged completion (only while one is pending)
       'deny'    — no to a staged completion (only while one is pending)
       'unknown' — take no action
     Order matters: a problem beats a confirm or a completion ("done, but the
     pallet's crushed" must not close the task on a bad count), and a
     completion beats a bare "what's next" (William's own line: "what's
     up next? I just got done" closes the task). */
  function matchIntent(text) {
    heardSeq++;
    var heard = String(text || '').trim();
    var t = normalise(heard).replace(WAKE, '');
    if (!t) return { intent: 'unknown', heard: heard };
    var p = t.replace(NOT_A_PROBLEM, ' ');
    if (PROBLEM.test(p)) return { intent: 'problem', heard: heard };
    if (anyLiveStage()) {
      if (DENY.test(t)) return { intent: 'deny', heard: heard };
      if (CONFIRM.test(t)) return { intent: 'confirm', heard: heard };
    }
    var d = p.replace(NOT_DONE, ' ');
    if (DONE.test(d)) return { intent: 'done', heard: heard };
    var sm = START.exec(d);
    if (sm) return { intent: 'start', heard: heard, startText: sm[2] || '' };
    if (NEXT.test(d)) return { intent: 'next', heard: heard };
    return { intent: 'unknown', heard: heard };
  }

  /* ---------- worker: carry it out ----------------------------------- */

  function taskLine(task) {
    return task.title + (task.detail ? ' — ' + task.detail : '');
  }

  /* The product a task is about, in the words the record uses: the
     task's own item name when the kitchen set one, else its desc
     (picks, consolidates carry one), else the staged pallet's desc,
     else its title with the leading verb and quantity stripped
     ("Put away 2 × Coca-Cola 12oz can" → the can). */
  function taskProduct(state, task) {
    if (!task) return null;
    if (task.item) return task.item;
    if (task.desc) return task.desc;
    if (task.stagingId) {
      for (var i = 0; i < state.staging.length; i++) {
        if (state.staging[i].id === task.stagingId) return state.staging[i].desc || null;
      }
    }
    var t = String(task.title || '');
    var m = /^.*? \d+ × (.+)$/.exec(t);
    if (m) return m[1];
    m = /^(Put away|Pick|Receive|Consolidate|Break down|Load|Move) (.+)$/.exec(t);
    if (m) return m[2];
    return t || null;
  }

  /* The kitchen's intake run — the one shipment the kitchen intake
     created (a receipt scan, or the wearer's spoken list); its item
     putaways are one job under it. A task belongs
     to it through its staged pallet (the pallet carries the
     shipment's id) — so membership must be read before a close
     takes the pallet out of staging. */
  function receiptRun(state) {
    var ships = state.inbound || [];
    for (var i = 0; i < ships.length; i++) if (ships[i].intake === 'receipt-scan' || ships[i].intake === 'spoken-list') return ships[i];
    return null;
  }
  function runOfTask(state, task) {
    var run = receiptRun(state);
    if (!run || !task || !task.stagingId) return null;
    for (var i = 0; i < state.staging.length; i++) {
      if (state.staging[i].id === task.stagingId) return state.staging[i].shipmentId === run.id ? run : null;
    }
    return null;
  }
  /* The run is finished when nothing of it is still staged — the
     same test the engine's own shipment stage calls closed. */
  function runComplete(state, run) {
    return !state.staging.some(function (p) { return p.shipmentId === run.id; });
  }

  /* The created job's name, as stamped on its run at creation
     ("Groceries putaway" — kitchen.js's JOB_NAME). A state saved
     before the name was stamped carries it at the front of the
     run's description; the last fallback is what the job was
     called before jobs had names. */
  function jobNameOf(run) {
    if (!run) return null;
    if (run.jobName) return run.jobName;
    if (run.desc) {
      var d = String(run.desc).split(' — ')[0].trim();
      if (d) return d;
    }
    return 'Grocery run';
  }

  /* The job's tasks, in the order they were created. Membership by
     staged pallet while the pallet is staged, and by the item the
     kitchen stamped on the task after — the same rule the glasses'
     chips use to count inside the run. */
  function jobTasks(state, run) {
    return state.tasks.filter(function (t) {
      if (t.type !== 'putaway') return false;
      if (t.item) return true;
      if (!t.stagingId) return false;
      for (var i = 0; i < state.staging.length; i++) {
        if (state.staging[i].id === t.stagingId) return state.staging[i].shipmentId === run.id;
      }
      return false;
    });
  }

  /* What a start phrase asks for beyond the job itself: "start with
     the peanut butter" → "peanut butter"; "start groceries
     putaway", "start the job" → null (no product named — the
     system chooses). The job's own name, whole or in part, and
     plain filler are stripped, never read as a product. */
  var START_FILLER = { the: 1, a: 1, an: 1, job: 1, task: 1, tasks: 1, run: 1, it: 1, please: 1 };
  function startProduct(state, text) {
    var t = normalise(text).replace(/^with\s+/, '');
    var run = receiptRun(state);
    var name = run ? jobNameOf(run) : null;
    var nameWords = name ? normalise(name).split(' ') : [];
    if (name) t = t.split(normalise(name)).join(' ');
    var keep = t.split(' ').filter(function (w) {
      return !!w && !START_FILLER[w] && nameWords.indexOf(w) === -1;
    });
    return keep.length ? keep.join(' ') : null;
  }

  /* A named product matches a task when either contains the other,
     case-insensitively: "start peanut butter" names the "creamy
     peanut butter" task; "start the 2% milk" names "2% milk". */
  function productMatches(state, task, hint) {
    var p = normalise(taskProduct(state, task) || '');
    return !!p && (p.indexOf(hint) !== -1 || hint.indexOf(p) !== -1);
  }

  /* Put one named task in the unit's hand — the same three writes
     the engine's nextTaskFor makes when it assigns. The engine has
     no "assign this one" call, and the start intent must honor the
     product the wearer named, so the assignment is made here, in
     exactly the engine's shape. */
  function takeInHand(E, state, unit, task, words, model) {
    return gateAct(E, state, unit, 'take', task.id, words, null, model);
  }

  function inHand(E, state, unit) {
    if (!unit || !unit.currentTaskId) return null;
    var t = E.taskById(state, unit.currentTaskId);
    return t && t.status === 'assigned' ? t : null;
  }

  /* Runs one intent against the engine. Mutates state through
     engine calls — the one exception is the start intent's
     assignment (see takeInHand). Returns { intent, acted, lines[], closed, next,
     problem, spoken, staged } — lines are what the screen says back, short,
     and the record keeps them in full. spoken, when set, is what
     the voice says instead: the terse form of an advance (William
     2026-11-04 — the voice carries the minimum, "Next: <product>.";
     the bin is in the glance, not the ear). */
  function workerTurn(E, state, unit, match) {
    var out = { intent: match.intent, acted: false, lines: [], closed: null, next: null, problem: null, spoken: null, staged: null };
    var closedRun = null;
    if (!unit) { out.lines.push('Pick your name first. Nothing was done.'); return out; }
    /* Note 40: no model reading, no turn. A match that did not come
       through the model reading (readWorker) stages nothing and runs
       nothing — a pending stage dies unrun. */
    if (!match || !match.model) {
      delete stages[unit.id];
      out.lines.push(OUTAGE);
      out.spoken = [OUTAGE];
      out.outage = true;
      return out;
    }
    var model = match.model;
    var current = inHand(E, state, unit);
    var stage = takeStage(unit.id); /* this turn decides it, whatever it is */
    var confirming = false;

    if (match.intent === 'confirm' || match.intent === 'deny') {
      if (!stage) {
        /* No stage pending for this unit: yes / no mean nothing. */
        out.lines.push('Heard you — no action taken.');
        out.lines.push('Say "done", "what\'s next", or say what the problem is.');
        return out;
      }
      if (match.intent === 'deny') {
        out.lines.push('Left open: "' + stage.title + '".');
        return out;
      }
      if (!current || current.id !== stage.taskId) {
        out.lines.push('Can\'t close "' + stage.title + '" — it is no longer the task in your hand. Nothing was closed.');
        if (current) out.lines.push('Still yours: ' + taskLine(current));
        return out;
      }
      confirming = true;
    } else if (stage && match.intent !== 'problem') {
      /* The staged completion dies with the topic change; this turn
         runs as its own, saying so. (A problem keeps today's lines —
         they already say nothing was closed.) */
      out.lines.push('Left open: "' + stage.title + '" — not marked complete.');
    }

    if (match.intent === 'unknown') {
      out.lines.push('Heard you — no action taken.');
      out.lines.push('Say "done", "what\'s next", or say what the problem is.');
      return out;
    }

    if (match.intent === 'problem') {
      var pg = gateAct(E, state, unit, 'note-problem', null, match.heard, null, model);
      if (!pg.ok) { out.lines.push(pg.reason); return out; }
      var rep = pg.result.report;
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

    if (match.intent === 'start') {
      /* Begin the job the app created (the creation protocol: the
         intake announced "Say 'Start <job name>'" — this is that
         word landing). A soft gate, deliberately: it is the
         announced way in, not a lock — every other path into the
         work stays exactly as it was. */
      if (current) {
        /* Already working: starting again changes nothing — the
           same answer "what's next" gives with a task in hand. */
        out.lines.push('Still yours: ' + taskLine(current));
        out.lines.push('Say "done" when it\'s finished.');
        out.next = current;
        return out;
      }
      E.generateTasks(state);
      var run = receiptRun(state);
      var chosen = null;
      if (run) {
        var hint = startProduct(state, match.startText || '');
        var open = jobTasks(state, run).filter(function (t) {
          return t.status === 'open' && !(E.blockedBy && E.blockedBy(state, t));
        });
        if (hint) {
          for (var i = 0; i < open.length; i++) {
            if (productMatches(state, open[i], hint)) { chosen = open[i]; break; }
          }
        }
        if (!chosen && open.length) chosen = open[0];
      }
      if (chosen && !takeInHand(E, state, unit, chosen, match.heard, model).ok) chosen = null;
      if (chosen) {
        out.acted = true;
        out.next = chosen;
        out.lines.push('Next: ' + taskLine(chosen));
        out.spoken = ['Next: ' + (taskProduct(state, chosen) || chosen.title) + '.'];
        return out;
      }
      /* No created job to start (or nothing of it left open): work
         is assigned, never pulled (note 32) — say so; nothing moves. */
      out.lines.push(NOTHING_ASSIGNED);
      out.spoken = [NOTHING_ASSIGNED];
      return out;
    }

    if (match.intent === 'next') {
      /* An ask for work with nothing in hand: a question, never a
         pull. Nothing moves. */
      out.lines.push(NOTHING_ASSIGNED);
      out.spoken = [NOTHING_ASSIGNED];
      return out;
    }

    if (match.intent === 'done' || confirming) {
      if (current) {
        /* The gate checks the close: signature (a receiving or a load
           is signed at the desk, never by voice), the confirmation law
           (unconfirmed, it is only staged), ownership, the engine's
           hold. Confirmed, it runs the close and writes the record's
           attribution. */
        if (confirming) closedRun = runOfTask(state, current); /* before the close takes its pallet out of staging */
        var cg = gateAct(E, state, unit, 'complete', current.id, match.heard, { confirmed: confirming, title: current.title }, model);
        if (!cg.ok && cg.held) {
          out.lines.push('Can\'t close "' + current.title + '" — ' + cg.held);
          out.lines.push('Leave it be. Tell your manager.');
          return out;
        }
        if (!cg.ok && cg.unbalanced) {
          out.lines.push('Could not close "' + current.title + '" — the counts would not balance.');
          out.lines.push('It stays with you. Tell your manager.');
          return out;
        }
        if (!cg.ok) {
          out.lines.push(cg.reason);
          out.lines.push('Still yours: ' + taskLine(current));
          return out;
        }
        if (!confirming) {
          /* Stage the close and ask. Nothing moves: acted stays
             false, so no caller saves anything for this turn. */
          stages[unit.id] = { taskId: current.id, title: current.title, seq: heardSeq };
          out.staged = current;
          out.lines.push('Mark "' + current.title + '" complete? Say yes to close it, or no to leave it open.');
          out.spoken = ['Mark it complete?'];
          return out;
        }
        out.acted = true;
        out.closed = current;
        out.lines.push('Closed: ' + current.title + '.');
      } else {
        out.lines.push('Nothing was in hand to close.');
        out.lines.push(NOTHING_ASSIGNED);
        out.spoken = [NOTHING_ASSIGNED];
        return out;
      }
    }

    E.generateTasks(state); /* what this turn made possible (putaway after receiving, a load after the last pick) */
    /* No pull (note 32). A close inside the worker's own created job
       moves to that job's next open task — the job is theirs once
       started (the assignment law: a job's tasks go to no one else),
       taken by name through the gate, the same 'take' a start makes.
       Anything else: nothing is assigned, and nothing moves. */
    var next = null;
    if (closedRun && !runComplete(state, closedRun)) {
      var jobOpen = jobTasks(state, closedRun).filter(function (t) {
        return t.status === 'open' && !(E.blockedBy && E.blockedBy(state, t));
      });
      if (jobOpen.length && takeInHand(E, state, unit, jobOpen[0], match.heard, model).ok) next = jobOpen[0];
    }
    /* The voice's version of this advance: no "Closed:" line at all,
       the next task named by its product only, and the job's own
       completion, in its name, when the close finished it. */
    var spoken = [];
    if (closedRun && runComplete(state, closedRun)) spoken.push(jobNameOf(closedRun) + ' complete.');
    if (next) {
      out.next = next;
      out.lines.push('Next: ' + taskLine(next));
      spoken.push('Next: ' + (taskProduct(state, next) || next.title) + '.');
    } else {
      out.lines.push(NOTHING_ASSIGNED);
      if (!spoken.length) spoken.push(NOTHING_ASSIGNED);
    }
    out.spoken = spoken;
    return out;
  }

  /* ---------- worker: the read turn (the converse model step) ---------
     Every worker turn on this door is read by the model FIRST
     (js/wms-ai.js converseTurn — the translation layer, note 37:
     never bypassed; verbatim is a valid translation). matchIntent is
     the code's cross-check. readWorker adjudicates and resolves one
     decision; the caller runs it in its own act path, against the
     fresh state it saves:

       { kind: 'turn', match }  run C.workerTurn(E, state, unit, match)
                                (the match carries the model reading)
       { kind: 'say', turn }    a finished turn that touches nothing —
                                the outage, a clarification, an honest
                                line. Nothing to save.
       { kind: 'ask', turn }    neither reading names an act: the
                                words are for the free ask where the
                                door has one (glasses); turn is what a
                                door without one shows.

     The adjudication (notes 34/34b, 40):
       - no model reading → "AI is currently down." Nothing staged or
         run; a pending stage DIES (a later yes is inert).
       - model and code agree, or the code has no reading and the
         model reads an intent → proceed with the model's intent.
       - they disagree (or the model has no reading where the code
         reads an act) → ONE clarification naming the readings;
         nothing staged or recorded. The answer is read again by the
         model TOGETHER with the first words; a second ambiguity is
         answered honestly, never asked again.
       - a yes / no to a pending stage the two readings do not agree
         on leaves the stage open, unrun — a close needs a clear yes.
     ================================================================= */

  /* The model envelope lives in js/wms-ai.js (which reads through
     js/bol.js). Pages that do not carry those scripts get them here,
     once, on the first read turn — the frozen glasses.html loads
     neither. In node, require. */
  var aiLoading = null;
  function aiNow() {
    var W = root.WitnessWmsAi || null;
    if (!W && typeof require === 'function' && typeof document === 'undefined') {
      try { W = require('./wms-ai.js'); } catch (e) { W = null; }
    }
    return W;
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var tag = document.createElement('script');
      tag.src = src;
      tag.onload = function () { resolve(); };
      tag.onerror = function () { reject(new Error('load ' + src)); };
      document.head.appendChild(tag);
    });
  }
  function ensureAi() {
    var W = aiNow();
    if (W) return Promise.resolve(W);
    if (typeof document === 'undefined') return Promise.resolve(null);
    if (!aiLoading) {
      aiLoading = (root.WitnessBol ? Promise.resolve() : loadScript('js/bol.js'))
        .then(function () { return root.WitnessWmsAi ? null : loadScript('js/wms-ai.js'); })
        .then(function () { return root.WitnessWmsAi || null; }, function () { aiLoading = null; return null; });
    }
    return aiLoading;
  }

  /* How a reading is named back to the worker in a clarification. */
  function readingWords(intent, current) {
    if (intent === 'done') return current ? 'you\'re done with this one' : 'you\'re done';
    if (intent === 'problem') return 'that there\'s a problem';
    if (intent === 'start') return 'to start the job';
    if (intent === 'next') return 'to hear what\'s next';
    if (intent === 'confirm') return 'yes';
    if (intent === 'deny') return 'no';
    return null;
  }
  var SAY_AGAIN = 'Say "done", "what\'s next", or say what the problem is.';

  function quietTurn(intent, lines, spoken) {
    return { intent: intent, acted: false, lines: lines, closed: null, next: null, problem: null,
      spoken: spoken || null, staged: null };
  }
  function outageTurn(intent) {
    var t = quietTurn(intent, [OUTAGE], [OUTAGE]);
    t.outage = true;
    return t;
  }

  /* What the model is told about the worker: the task in hand, what is
     assigned to them, and what question (stage or clarification) is
     waiting. */
  function workerContext(E, state, unit, stage, clar) {
    var cur = inHand(E, state, unit);
    var assigned = (state.tasks || []).filter(function (t) {
      return t.assignee === unit.id && t.status !== 'done';
    }).map(function (t) { return t.title; });
    return {
      inHand: cur ? { title: cur.title, type: cur.type } : null,
      assigned: assigned,
      pending: stage ? stage.title : null,
      clarify: clar ? { words: clar.words, question: clar.question } : null
    };
  }

  function readWorker(E, state, unit, text, opts) {
    opts = opts || {};
    var code = matchIntent(text); /* the cross-check; also counts the utterance heard */
    if (!unit) return Promise.resolve({ kind: 'say', turn: quietTurn(code.intent, ['Pick your name first. Nothing was done.']) });
    var uid = unit.id;
    var clar = takeClarif(uid);
    var stage = liveStage(uid);
    if (!code.heard) return Promise.resolve({ kind: 'say', turn: quietTurn('unknown', ['Heard you — no action taken.', SAY_AGAIN]) });
    var ctx = workerContext(E, state, unit, stage, clar);
    var doFetch = opts.fetch || null;

    return ensureAi().then(function (W) {
      if (!W || !W.converseTurn || !doFetch) return null;
      return W.converseTurn(doFetch, ctx, code.heard, opts.url || CHAT_URL);
    }).then(function (reading) {
      return adjudicate(E, state, unit, code, reading, stage, clar);
    }, function () {
      return adjudicate(E, state, unit, code, null, stage, clar);
    });
  }

  function adjudicate(E, state, unit, code, reading, stage, clar) {
    var uid = unit.id;
    var ci = code.intent;

    /* Note 40: no reading, no act. The stage dies unrun. */
    if (!reading) {
      delete stages[uid];
      if (ci === 'unknown' && !clar) return { kind: 'ask', turn: outageTurn(ci), outage: true };
      return { kind: 'say', turn: outageTurn(ci) };
    }
    var mi = reading.intent;
    var model = { intent: mi, startText: reading.startText || '' };
    function proceed(intent, heard) {
      return { kind: 'turn', match: {
        intent: intent,
        heard: heard || code.heard,
        startText: intent === 'start' ? (ci === 'start' ? code.startText : (reading.startText || '')) : undefined,
        model: model
      } };
    }

    /* The answer to a clarification: weighed with the first words by
       the reading above (its context carried them). One turn only —
       a second ambiguity is said honestly, never asked again. */
    if (clar) {
      if (mi === 'unknown' || (ci !== 'unknown' && ci !== mi)) {
        return { kind: 'say', turn: quietTurn(ci, ['Still not sure what you meant — nothing was done.', SAY_AGAIN]) };
      }
      return proceed(mi, clar.words + ' — ' + code.heard);
    }

    if (mi === ci) {
      if (mi === 'unknown') return { kind: 'ask', turn: quietTurn('unknown', ['Heard you — no action taken.', SAY_AGAIN]) };
      return proceed(mi);
    }
    if (ci === 'unknown') return proceed(mi); /* the translation layer earning its keep */

    /* The two readings differ. A yes / no to a pending stage that they
       do not agree on closes nothing: the stage is left open. */
    var cur = inHand(E, state, unit);
    if (stage && (mi === 'confirm' || mi === 'deny' || ci === 'confirm' || ci === 'deny')) {
      delete stages[uid];
      return { kind: 'say', turn: quietTurn(ci, [
        'Left open: "' + stage.title + '" — I couldn\'t tell if that was a yes. Nothing was closed.',
        'Say "done" again to close it.'
      ]) };
    }

    /* A stark disagreement: one clarification, nothing staged or
       recorded. A pending stage dies with it (the topic changed). */
    var a = readingWords(ci, cur), b = mi === 'unknown' ? null : readingWords(mi, cur);
    var question = 'Did you mean ' + a + (b ? ', or ' + b : '') + '?';
    var lines = [];
    if (stage) { delete stages[uid]; lines.push('Left open: "' + stage.title + '" — not marked complete.'); }
    lines.push(question + ' Nothing was done yet.');
    clarifs[uid] = { words: code.heard, question: question, seq: heardSeq };
    var t = quietTurn(ci, lines, [question]);
    t.clarify = question;
    return { kind: 'say', turn: t };
  }

  /* The whole read turn on one state: read, adjudicate, run. Resolves
     the turn; turn.ask is set when the words belong to the free ask. */
  function readTurn(E, state, unit, text, opts) {
    return readWorker(E, state, unit, text, opts).then(function (d) {
      if (d.kind === 'turn') return workerTurn(E, state, unit, d.match);
      if (d.kind === 'ask') d.turn.ask = true;
      return d.turn;
    });
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
      var st = E.inboundStage(state, s);
      facts.incoming.push({ id: s.id, door: s.door, zone: z, pallets: s.pallets, status: s.status, stage: st.words });
      L.push(s.id + ' — ' + s.door + ' (Zone ' + z + ') — ' + s.pallets + ' pallets — ' + s.status + ' — stage: ' + st.words);
    });

    L.push('');
    L.push('STAGED AT DOORS, waiting for putaway:');
    if (!state.staging.length) L.push('Nothing staged.');
    state.staging.forEach(function (p) {
      facts.staged.push({ id: p.id, door: p.door, desc: p.desc, qty: p.qty, held: !!p.hold });
      L.push(p.id + ' — ' + p.door + ' (Zone ' + doorZone(state, p.door) + ') — ' + p.qty + ' × ' + p.desc + (p.hold ? ' — ON HOLD' : ''));
    });

    L.push('');
    L.push('HOLDS (held stock is not picked, moved or put away until released):');
    var holds = E.currentHolds(state);
    facts.holds = holds;
    if (!holds.length) L.push('No holds.');
    holds.forEach(function (h) {
      L.push(h.label + (h.zone ? ' (Zone ' + h.zone + ')' : '') + ' — on hold' + (h.reason ? ': ' + h.reason : '') + (h.by ? ' — by ' + h.by : ''));
    });

    L.push('');
    L.push('OUTBOUND ORDERS:');
    state.outbound.forEach(function (o) {
      var left = o.lines.filter(function (l) { return !l.done; });
      var os = E.orderStage(state, o);
      facts.orders.push({ id: o.id, status: o.status, linesLeft: left.length, stage: os.words });
      L.push(o.id + ' — ' + o.status + ' — ' + left.length + ' of ' + o.lines.length + ' lines left to pick' +
        (left.length ? ': ' + left.map(function (l) { return l.qty + ' × ' + l.desc + ' ' + (E.lineSource ? E.lineSource(state, l) : 'from ' + l.binId); }).join('; ') : '') +
        ' — stage: ' + os.words);
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
    readWorker: readWorker,
    readTurn: readTurn,
    OUTAGE: OUTAGE,
    NOTHING_ASSIGNED: NOTHING_ASSIGNED,
    pendingStage: pendingStage,
    pendingClarification: pendingClarification,
    clearStages: clearStages,
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
