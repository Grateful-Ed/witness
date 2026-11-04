/* =====================================================================
   central-agent.js — one agent for the whole warehouse: the
   delegator and its sub-agents.

   William's architecture (2026-11-03; corrected 2026-11-04): the
   glasses are endpoints, not agents. One central agent — the
   delegator — receives every input from every worker, classifies
   it, composes the prompt, and assembles the context the job needs
   from the dynamic ontology digest (js/ontology.js). Then it hands
   off. It DISPATCHES; it does not relay:

     - receive() returns a dispatch { agent, prompt, context, ... }.
       It returns no answer, and the delegator never sees one.
     - The chosen sub-agent's respond(dispatch) produces
       { answer, facts, rev } — and that object IS the response the
       user gets, verbatim. It is never routed back through the
       delegator and never re-worded by it. No bottleneck, no single
       point of failure in the response path.
     - Single writer: only the delegator holds and refreshes the
       digest (through the ontology module's own applyChange).
       Sub-agents get a deep-frozen copy of their slice. They read;
       they cannot write — enforced by Object.freeze, not by habit.
     - A tell (a statement, not a question) goes to the recorder,
       whose response carries a record entry { from, text, at } for
       the CALLER to persist through the existing store paths. This
       module persists nothing and mutates no state, anywhere.

   Hard rules, from the brief: no network calls of any kind, no
   timers, no polling, no model calls — sub-agents answer from the
   digest deterministically. A test scans this file's source.

   Loads in the browser (window.WitnessCentralAgent) and in node.
   Imported by js/wms-agent.js — the Witness page's agent, its one
   live surface (see THE FLAG below) — and by its tests.
   ===================================================================== */
(function (root) {
  'use strict';

  /* THE FLAG. Live — William's call, 2026-11-04: the competition
     is about showing the AI, so the delegator is wired into the
     one live agent surface there is, the Witness page's agent
     (js/wms-agent.js). That surface routes every ask and every
     tell through receive() first: an ask goes out under the
     delegator's composed prompt and assembled context, and the
     model's answer reaches the user unedited — dispatch, not
     relay, on the live wire too. A tell reaches the recorder here,
     and the surface persists the record the recorder returns.
     If no dispatch comes back, or the routed call fails, the
     surface falls back to its own direct behavior, so the page is
     never worse than it was before this was switched on. The
     sub-agents in this module still answer deterministically from
     the digest (that is what this module's tests exercise); the
     flag says the DELEGATOR is in the live path, which is the
     part that was waiting on a deployment decision. */
  var CENTRAL_AGENT_LIVE = true;

  var O = (typeof module !== 'undefined' && module.exports && typeof require === 'function')
    ? require('./ontology.js')
    : root.WitnessOntology;

  /* ---------- small pure helpers ---------------------------------- */

  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function deepFreeze(x) {
    if (x && typeof x === 'object' && !Object.isFrozen(x)) {
      Object.freeze(x);
      Object.keys(x).forEach(function (k) { deepFreeze(x[k]); });
    }
    return x;
  }
  /* A sub-agent's view: a fresh copy, frozen all the way down. */
  function snapshot(x) { return deepFreeze(clone(x)); }
  function find(list, pred) {
    var l = list || [];
    for (var i = 0; i < l.length; i++) if (pred(l[i])) return l[i];
    return null;
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function line(c) { return c.qty + ' × ' + c.desc; }

  /* ---------- reading the input ----------------------------------- */

  var ASK_START = /^(where|where's|wheres|what|what's|whats|which|who|who's|how|when|why|is|are|any|anything|show|list|tell me|give me|can|could|do|does|should|did|has|have)\b/i;
  function isQuestion(text) {
    var t = String(text || '').trim();
    return /\?\s*$/.test(t) || ASK_START.test(t);
  }

  /* Every place reference the text makes that the digest knows. */
  function placeRef(digest, text) {
    var t = String(text || '');
    var places = digest.places || [];
    function has(kind, id) { return find(places, function (p) { return p.kind === kind && p.id === id; }); }
    var m;
    if ((m = t.match(/\b(STG-\d+)\b/i))) { var p = has('pallet', m[1].toUpperCase()); if (p) return p; }
    if ((m = t.match(/\b([A-Z]-\d{2})\b/i))) { var b = has('bin', m[1].toUpperCase()); if (b) return b; }
    if ((m = t.match(/\b(inbound|outbound)\s+door\s+(\d+)\b/i))) {
      var id = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() + ' Door ' + m[2];
      var d = has('door', id); if (d) return d;
    }
    if ((m = t.match(/\bdoor\s+(\d+)\b/i))) {
      var doors = places.filter(function (x) { return x.kind === 'door' && / Door (\d+)$/.exec(x.id) && / Door (\d+)$/.exec(x.id)[1] === m[1]; });
      if (doors.length === 1) return doors[0];
    }
    if ((m = t.match(/\bzone\s+([A-Z])\b/i))) { var z = has('zone', m[1].toUpperCase()); if (z) return z; }
    return null;
  }
  function recordRef(digest, text) {
    var t = String(text || ''), m;
    if ((m = t.match(/\b(IN-\d+)\b/i))) {
      var s = find(digest.shipments, function (x) { return x.id === m[1].toUpperCase(); });
      if (s) return { kind: 'shipment', id: s.id };
    }
    if ((m = t.match(/\b(ORD-\d+)\b/i))) {
      var o = find(digest.orders, function (x) { return x.id === m[1].toUpperCase(); });
      if (o) return { kind: 'order', id: o.id };
    }
    if ((m = t.match(/\b(t-[A-Za-z0-9-]+)/))) {
      var k = find(digest.tasks, function (x) { return x.id === m[1]; });
      if (k) return { kind: 'task', id: k.id };
    }
    return null;
  }

  var STOP = ('where wheres is are the a an any some what whats which who bin bins has have got do does we i my ' +
    'of in on find me located kept stored there our all show list tell give can could us you it its put at ' +
    'keep stock stocked sitting sit lives live be how much many left').split(' ');
  function itemTerms(text) {
    return String(text || '').toLowerCase().replace(/[’']s\b/g, '').replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/).filter(function (w) { return w && STOP.indexOf(w) === -1; });
  }
  function stem(w) { return w.length > 4 ? w.replace(/(es|s)$/, '') : w; }
  function descMatches(desc, terms) {
    if (!terms.length) return false;
    var words = String(desc || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
    return terms.every(function (t) {
      var s = stem(t);
      return words.some(function (w) { return w.indexOf(s) === 0; });
    });
  }

  /* The delegator's reading of one input: what it is about
     (place / item / task / tell), which sub-agent takes it, and
     the job that sub-agent is being given. Pure. */
  function classify(digest, text, kind) {
    var t = String(text || '').trim();
    var tell = kind === 'tell' || (kind !== 'question' && !isQuestion(t));
    if (tell) return { about: 'tell', agent: 'recorder', intent: 'tell', subject: null };

    var place = placeRef(digest, t);
    var rec = recordRef(digest, t);

    if (/\b(next|should i|what do i do|what am i on|my (next |current )?task|what'?s mine|give me work)\b/i.test(t)) {
      return { about: 'task', agent: 'planner', intent: 'next', subject: null };
    }
    if (/\b(needs? (eyes|attention)|attention|stuck|problems?)\b/i.test(t) && !place && !rec) {
      return { about: 'task', agent: 'status', intent: 'needsEyes', subject: null };
    }
    if (/\bopen\b/i.test(t) && /\b(tasks?|work|jobs?)\b/i.test(t) && !place && !rec) {
      return { about: 'task', agent: 'status', intent: 'open', subject: null };
    }
    if (rec) {
      return { about: rec.kind === 'task' ? 'task' : 'item', agent: 'status', intent: 'record', subject: rec };
    }
    if (place && /\b(status|state|on hold|held|hold|ok|okay|open|blocked|ready|available|free)\b/i.test(t)) {
      return { about: 'place', agent: 'status', intent: 'place', subject: { kind: place.kind, id: place.id } };
    }
    if (place) {
      return { about: 'place', agent: 'locator', intent: 'contents', subject: { kind: place.kind, id: place.id } };
    }
    var terms = itemTerms(t);
    if (terms.length) return { about: 'item', agent: 'locator', intent: 'item', subject: { terms: terms } };
    return { about: 'task', agent: 'status', intent: 'needsEyes', subject: null };
  }

  /* ---------- assembling context: the digest slice a job needs ---- */

  function touches(task, id) { return task.destination === id; }
  function personOf(digest, name) { return find(digest.people, function (p) { return p.name === name; }); }

  function sliceFor(digest, job, from) {
    var base = { asOf: digest.asOf };
    var who = personOf(digest, from);
    if (job.agent === 'recorder') { base.person = who; return base; }
    /* Every ask carries the building's vocabulary — the words the
       workers taught, with their meanings — so the sub-agent (or
       the model answering under its prompt) speaks the building's
       language instead of guessing at it. */
    base.vocabulary = digest.vocabulary || [];

    if (job.intent === 'contents' || job.intent === 'place') {
      var p = find(digest.places, function (x) { return x.kind === job.subject.kind && x.id === job.subject.id; });
      base.places = [p];
      if (p.kind === 'zone') {
        base.places = base.places.concat(digest.places.filter(function (x) { return x.kind === 'bin' && x.zone === p.id; }));
      }
      base.tasks = (digest.tasks || []).filter(function (t) { return touches(t, p.id); });
      base.needsEyes = (digest.needsEyes || []).filter(function (n) { return n.id === p.id; });
      return base;
    }
    if (job.intent === 'item') {
      base.query = job.subject.terms;
      base.places = (digest.places || []).filter(function (x) {
        return (x.kind === 'bin' || x.kind === 'pallet') && (x.contents || []).some(function (c) { return descMatches(c.desc, job.subject.terms); });
      });
      base.tasks = (digest.tasks || []).filter(function (t) { return descMatches(t.item, job.subject.terms); });
      return base;
    }
    if (job.intent === 'record') {
      var s = job.subject;
      if (s.kind === 'shipment') base.shipments = [find(digest.shipments, function (x) { return x.id === s.id; })];
      if (s.kind === 'order') base.orders = [find(digest.orders, function (x) { return x.id === s.id; })];
      if (s.kind === 'task') base.tasks = [find(digest.tasks, function (x) { return x.id === s.id; })];
      base.needsEyes = (digest.needsEyes || []).filter(function (n) { return n.id === s.id; });
      return base;
    }
    if (job.intent === 'open') { base.tasks = digest.tasks || []; return base; }
    if (job.intent === 'needsEyes') { base.needsEyes = digest.needsEyes || []; return base; }
    if (job.intent === 'next') {
      base.person = who;
      var zone = who ? who.zone : null;
      base.tasks = (digest.tasks || []).filter(function (t) {
        return t.assignee === from || t.queuedFor === from ||
          (!t.assignee && !t.queuedFor && zone && t.zone === zone);
      });
      base.held = (digest.needsEyes || []).map(function (n) { return n.id; });
      base.prep = (digest.prep || []).filter(function (n) { return n['for'] === from; });
      return base;
    }
    return base;
  }

  /* Digest tasks carry no zone; the planner's slice needs it. */
  function withZones(digest, state) {
    var zoneOf = {};
    (state.tasks || []).forEach(function (t) { zoneOf[t.id] = t.zone || null; });
    return (digest.tasks || []).map(function (t) { var c = clone(t); c.zone = zoneOf[t.id] || null; return c; });
  }

  /* The standing rules every ASK prompt carries, in William's
     words in substance (2026-11-04): the building's vocabulary is
     in the context; a word the answerer doesn't know is ASKED
     about, never guessed at; and topicality is the answerer's own
     judgment — there is deliberately no code-side topic screen
     anywhere in this module or its callers. */
  var ASK_RULES =
    '\nThe building\'s vocabulary is in your context (context.vocabulary): words the workers here use, with the meanings they taught. ' +
    'If the user uses a word you don\'t know and it isn\'t in the vocabulary or the record, ask them what it means — never guess a meaning. If they teach you a word, use it.' +
    '\nYou are a warehouse-work assistant. If a request isn\'t related to the warehouse or its work, decline in your own voice — "Sorry, this request isn\'t related to warehouse process." — and leave it there. That judgment is yours, made from the request itself.';

  function composePrompt(job, from, rev) {
    var ask;
    switch (job.intent) {
      case 'contents': ask = 'say what is in ' + job.subject.kind + ' ' + job.subject.id; break;
      case 'item': ask = 'say where "' + job.subject.terms.join(' ') + '" is'; break;
      case 'place': ask = 'give the status of ' + job.subject.kind + ' ' + job.subject.id + ' and nothing else'; break;
      case 'record': ask = 'give the status of ' + job.subject.kind + ' ' + job.subject.id; break;
      case 'open': ask = 'list the open tasks'; break;
      case 'needsEyes': ask = 'list what needs eyes'; break;
      case 'next': ask = 'say what ' + from + ' should do next, from their open tasks and prep notes'; break;
      default: ask = 'take this statement for the record, in the speaker\'s own words';
    }
    return 'You are the ' + job.agent + ' sub-agent. Answer ' + (from || 'the worker') + ' directly: ' + ask +
      '. Use only the context given (digest rev ' + rev + '). You read; you never write.' +
      (job.agent === 'recorder' ? '' : ASK_RULES);
  }

  /* ---------- the sub-agents: pure functions over a frozen slice -- */
  /* Each takes a dispatch and returns { answer, facts, rev }. That
     object is the user-facing response, verbatim. */

  function placeName(p) {
    if (p.kind === 'door') return p.id;
    if (p.kind === 'zone') return 'Zone ' + p.id;
    if (p.kind === 'pallet') return 'Pallet ' + p.id;
    return 'Bin ' + p.id;
  }

  var locator = {
    name: 'locator',
    respond: function (dispatch) {
      var c = dispatch.context, job = dispatch.job, facts = [], answer;
      if (job.intent === 'item') {
        var parts = [];
        c.places.forEach(function (p) {
          p.contents.forEach(function (x) {
            if (!descMatches(x.desc, c.query)) return;
            facts.push({ place: p.kind, id: p.id, desc: x.desc, qty: x.qty, at: p.at || null });
            parts.push(x.qty + ' ' + (p.kind === 'pallet' ? 'on pallet ' + p.id + ' at ' + p.at : 'in bin ' + p.id) +
              (p.status === 'hold' ? ' (on hold)' : ''));
          });
        });
        answer = parts.length
          ? facts[0].desc + ': ' + parts.join(', ') + '.'
          : 'Nothing matching "' + c.query.join(' ') + '" is on the floor right now.';
        return { answer: answer, facts: facts, rev: c.asOf.rev };
      }
      var p = c.places[0];
      if (p.kind === 'zone') {
        var bins = c.places.slice(1);
        var held = bins.filter(function (b) { return b.status === 'hold'; }).map(function (b) { return b.id; });
        var empty = bins.filter(function (b) { return !b.contents.length; }).map(function (b) { return b.id; });
        bins.forEach(function (b) { b.contents.forEach(function (x) { facts.push({ place: 'bin', id: b.id, desc: x.desc, qty: x.qty }); }); });
        answer = 'Zone ' + p.id + ': ' + plural(bins.length, 'bin') + ', ' + plural(empty.length, 'empty') +
          (empty.length ? ' (' + empty.join(', ') + ')' : '') +
          (held.length ? ', ' + held.length + ' on hold (' + held.join(', ') + ')' : '') + '.';
      } else if (p.kind === 'door') {
        p.contents.forEach(function (x) { facts.push({ place: 'door', id: p.id, holds: x.id }); });
        answer = p.id + ' is ' + (p.status || 'idle') + (p.contents.length ? ', with ' + p.contents.map(function (x) { return x.id; }).join(', ') : '') + '.';
      } else {
        p.contents.forEach(function (x) { facts.push({ place: p.kind, id: p.id, desc: x.desc, qty: x.qty }); });
        answer = p.contents.length
          ? placeName(p) + (p.kind === 'pallet' ? ' at ' + p.at : '') + ' holds ' + p.contents.map(line).join(', ') + '.'
          : placeName(p) + ' is empty.';
        if (p.holds.length) answer += ' It is ' + p.holds[0] + '.';
      }
      return { answer: answer, facts: facts, rev: c.asOf.rev };
    }
  };

  function taskLine(t) {
    return t.id + ' (' + (t.kind || 'task') + ', ' + t.item + ')' + (t.destination ? ' to ' + t.destination : '');
  }

  var status = {
    name: 'status',
    respond: function (dispatch) {
      var c = dispatch.context, job = dispatch.job, facts = [], answer;
      if (job.intent === 'needsEyes') {
        c.needsEyes.forEach(function (n) { facts.push({ place: n.place, id: n.id, reason: n.reason }); });
        answer = c.needsEyes.length
          ? plural(c.needsEyes.length, 'thing needs', 'things need') + ' eyes: ' + c.needsEyes.map(function (n) { return n.reason; }).join('; ') + '.'
          : 'Nothing needs eyes right now.';
      } else if (job.intent === 'open') {
        var byKind = {}, order = [];
        c.tasks.forEach(function (t) {
          facts.push({ task: t.id, kind: t.kind, item: t.item, destination: t.destination, assignee: t.assignee });
          if (!byKind[t.kind]) { byKind[t.kind] = 0; order.push(t.kind); }
          byKind[t.kind]++;
        });
        answer = c.tasks.length
          ? plural(c.tasks.length, 'open task') + ': ' + order.map(function (k) { return byKind[k] + ' ' + k; }).join(', ') + '.'
          : 'No open tasks.';
      } else if (job.intent === 'place') {
        var p = c.places[0];
        facts.push({ place: p.kind, id: p.id, status: p.status, holds: p.holds.slice() });
        answer = placeName(p) + ' is ' + (p.holds.length ? p.holds[0] : (p.status || 'ok')) + '.';
      } else {
        var s = job.subject, r;
        if (s.kind === 'shipment') {
          r = c.shipments[0];
          facts.push({ shipment: r.id, status: r.status, at: r.at });
          answer = 'Shipment ' + r.id + ' is ' + r.status + (r.at ? ', at ' + r.at : '') + '.';
        } else if (s.kind === 'order') {
          r = c.orders[0];
          facts.push({ order: r.id, status: r.status, at: r.at, customer: r.customer });
          answer = 'Order ' + r.id + ' (' + r.customer + ') is ' + r.status + (r.at ? ', at ' + r.at : '') + '.';
        } else {
          r = c.tasks[0];
          facts.push({ task: r.id, status: r.status, destination: r.destination, assignee: r.assignee });
          answer = 'Task ' + taskLine(r) + ' is ' + r.status + ', ' +
            (r.assignee ? 'with ' + r.assignee : r.queuedFor ? 'queued for ' + r.queuedFor : 'unassigned') + '.';
        }
        if (c.needsEyes.length) answer += ' Needs eyes: ' + c.needsEyes.map(function (n) { return n.reason; }).join('; ') + '.';
      }
      return { answer: answer, facts: facts, rev: c.asOf.rev };
    }
  };

  var planner = {
    name: 'planner',
    respond: function (dispatch) {
      var c = dispatch.context, me = dispatch.to, facts = [], answer;
      var held = c.held || [];
      var mine = find(c.tasks, function (t) { return t.assignee === me; });
      var queued = find(c.tasks, function (t) { return t.queuedFor === me; });
      var free = find(c.tasks, function (t) { return !t.assignee && !t.queuedFor && held.indexOf(t.destination) === -1; });
      if (mine) {
        facts.push({ task: mine.id, item: mine.item, destination: mine.destination, why: 'assigned' });
        answer = 'You are on ' + taskLine(mine) + '. Finish that first.';
      } else if (queued) {
        facts.push({ task: queued.id, item: queued.item, destination: queued.destination, why: 'queued' });
        answer = 'Next for you: ' + taskLine(queued) + '.';
      } else if (free) {
        facts.push({ task: free.id, item: free.item, destination: free.destination, why: 'open in your zone' });
        answer = 'Nothing is assigned to you. First open task in zone ' + (c.person ? c.person.zone : '?') + ': ' + taskLine(free) + '.';
      } else {
        answer = 'Nothing open for you right now.';
      }
      (c.prep || []).forEach(function (n) { facts.push({ prep: n.about, note: n.note }); });
      if ((c.prep || []).length) answer += ' Heads-up: ' + c.prep.map(function (n) { return n.note; }).join(' ');
      return { answer: answer, facts: facts, rev: c.asOf.rev };
    }
  };

  /* ---------- teaching: when a tell is a definition -------------- */
  /* William's slang law (2026-11-04): the ontology learns the
     building's words from the workers who use them. A tell is a
     TEACHING only in tight, quoted forms — the term is always in
     quotes, so an ordinary tell that merely contains the word
     "means" is never misread as a definition:
       '<term>' means <definition>
       <the thing described> — that's called '<term>'
     In the second form the description the speaker just gave IS
     the meaning. teachOf returns { term, means } or null. */
  var QC = '"\'‘’“”'; /* the quote characters a taught term may be wrapped in */
  var TEACH_MEANS = new RegExp('[' + QC + ']([^' + QC + ']{1,60})[' + QC + ']\\s+means\\s+(.+)', 'i');
  var TEACH_CALLED = new RegExp('\\b(?:that\'s|it\'s|this is) called\\s+[' + QC + ']([^' + QC + ']{1,60})[' + QC + ']', 'i');
  function cleanMeans(s) {
    return String(s || '').replace(/^[\s:;—–-]+/, '').replace(/[\s.,]+$/, '').trim();
  }
  function teachOf(text) {
    var t = String(text || '').trim();
    var m = TEACH_MEANS.exec(t);
    if (m) {
      var means1 = cleanMeans(m[2]);
      if (means1) return { term: m[1].trim(), means: means1 };
    }
    m = TEACH_CALLED.exec(t);
    if (m) {
      var rest = cleanMeans(t.slice(0, m.index)) || cleanMeans(t.slice(m.index + m[0].length));
      if (rest) return { term: m[1].trim(), means: rest };
    }
    return null;
  }

  var recorder = {
    name: 'recorder',
    respond: function (dispatch) {
      var entry = { from: dispatch.from, text: dispatch.text, at: dispatch.at };
      /* A teaching tell's record carries the lesson with it. The
         caller, when it persists this record, also hands it to the
         ontology module's learnTerm — the single writer of
         definitions. This module still writes nothing itself. */
      var taught = teachOf(dispatch.text);
      if (taught) {
        entry = { kind: 'teach', term: taught.term, means: taught.means, from: dispatch.from, text: dispatch.text, at: dispatch.at };
      }
      return {
        answer: 'Noted for the record, in your words: "' + dispatch.text + '"',
        facts: [],
        record: entry,
        rev: dispatch.context.asOf.rev
      };
    }
  };

  var SUB_AGENTS = deepFreeze({ locator: locator, status: status, planner: planner, recorder: recorder });

  /* ---------- the delegator --------------------------------------- */

  function createCentralAgent(opts) {
    opts = opts || {};
    var state = opts.state;
    if (!state) throw new Error('createCentralAgent needs { state }');
    var now = typeof opts.now === 'function' ? opts.now : function () { return new Date().toISOString(); };

    /* The delegator's own digest: a frozen copy, held privately.
       It is the only thing in this module that ever replaces it. */
    var digest = deepFreeze(clone(opts.digest || O.buildDigest(state)));
    var log = [];
    var seq = 0;

    /* State has moved when its revision no longer matches the
       digest's. The refresh goes through the ontology module's own
       API; this module never derives the digest itself. */
    function current() {
      if ((state.wmsRev || 0) !== digest.asOf.rev) digest = deepFreeze(clone(O.applyChange(state, digest)));
      return digest;
    }

    function receive(input) {
      input = input || {};
      var d = current();
      var job = classify(d, input.text, input.kind);
      var view = d;
      if (job.agent === 'planner') { view = clone(d); view.tasks = withZones(d, state); }
      var dispatch = {
        id: 'd-' + (++seq),
        from: input.from || null,
        to: input.from || null,
        text: String(input.text || ''),
        channel: input.kind && input.kind !== 'tell' && input.kind !== 'question' ? input.kind : null,
        about: job.about,
        agent: job.agent,
        job: { intent: job.intent, subject: job.subject },
        prompt: composePrompt(job, input.from, d.asOf.rev),
        context: sliceFor(view, job, input.from),
        rev: d.asOf.rev,
        at: now()
      };
      dispatch = snapshot(dispatch);
      log.push(dispatch);
      return dispatch;
    }

    return {
      receive: receive,
      agents: SUB_AGENTS,
      /* What the delegator has handed off — dispatches only. It
         never holds an answer, so it has none to show. */
      dispatches: function () { return log.slice(); },
      /* A read-only look at the digest, for tests and docs. */
      digest: function () { return current(); },
      revision: function () { return current().asOf.rev; }
    };
  }

  var api = {
    CENTRAL_AGENT_LIVE: CENTRAL_AGENT_LIVE,
    createCentralAgent: createCentralAgent,
    SUB_AGENTS: SUB_AGENTS,
    classify: classify
  };
  root.WitnessCentralAgent = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
