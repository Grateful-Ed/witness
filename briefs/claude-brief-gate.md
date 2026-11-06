# Brief: the gate — one gated act path for the agent doors (harness build 1 of 2)

Status: DRAFTED by Faye (2026-11-05), from the settled design
pass in big-version-ideas.md ("The Witness harness — design
pass") and aware notes 29/30/32. Fires on William's word.
Sequencing is settled (note 29): the agent doors route through
the gate FIRST; the desk console's own clicks route LAST, in a
follow-on build that is NOT this one.
PREREQUISITE: the interpretation-instances build is merged
first — it puts console voice's parameters through the
translation layer and retires parser-only staging; the gate
consumes that shape. Stress-tested by Faye 2026-11-06
against notes 29/30/34/37/38/39/40 and the live code.

## The problem, in one paragraph

Four doors can change the building today — console clicks,
console voice, game intents, glasses/phone conversation — and
each one re-implements the same permission laws in its own
code: the confirmation law, the signature law, the assignment
law, attribution. They agree by discipline, not by structure.
This build gives the agent doors ONE path: a gate module that
owns the checks and the record, while each door keeps its own
conversation.

## What is built

A new module, js/gate.js:

    gate.act(state, { who, via, intent, target, params,
                      confirmed })
      -> { ok: true, result }
       | { ok: false, reason }            (a refusal)
       | { ok: false, clarify: <words> }  (check 1's outcome:
         the door asks the worker; nothing is recorded)

The gate runs SIX CHECKS, in this order, and refuses in plain
words at the first one that fails:

1. **The act exists and its params are complete.** An intent
   the engine has no path for is refused as unknown, never
   improvised. Params arrive as the door AI's interpretation
   (note 34, RATIFIED 2026-11-05: the AI receives and
   interprets; the code is the double checker; a settled
   ontology definition overrides any code-side reading) —
   and on every voice door the params reach the gate THROUGH
   the translation layer (note 37, RATIFIED 2026-11-06:
   voice input always passes ASR → AI translation → code;
   the layer is never absent, a translation may be verbatim,
   and the AI renders words into the code's shapes so the
   code lands) — the gate cross-checks the reading
   against the deterministic parsers and the task itself,
   and a disagreement or an ambiguous reading is not a
   refusal: it returns a clarification turn, and the AI asks
   the worker what they meant. Nothing is recorded on an
   unclarified ambiguity. And the outage rule binds the
   whole build (note 40): an act reaches the gate only as a
   model-formed intent — no door creates or preserves a
   code-only act path, and when the model is unreachable
   the door answers "AI is currently down." and nothing is
   staged or run.
2. **Signature class** (the signature test, note 30, William's
   words): strictly internal work needs no signature;
   anything the company must confirm or update a customer or
   an outside third party on is a signed act. Signed acts as
   built: posting a receiving, confirming a load. A signed
   act arriving through an agent door is REFUSED with
   guidance to the desk screen — voice can confirm, voice
   can never sign (the double lock from PR #40 is preserved:
   even a forged staged act is refused at run time).
3. **The confirmation law** (note 25, PRs #38/#40): a spoken
   completion stages the close and asks; only the next turn's
   confirmation runs it; a no, a problem report, or any other
   utterance clears the stage; the stage lives in memory
   only, dies after one heard utterance, is never persisted;
   a bare "yes" with no stage is inert. The gate owns this
   protocol now — the RULES and the run — but the gate is
   STATELESS: each door keeps its own stage in its own
   module memory exactly as today (no shared stage store,
   no cross-door stages), and passes the stage's facts in
   (the confirmed flag and the staged act in params). The
   doors' existing behavior is preserved exactly, including
   the NOT_DONE negation guard and the stage lines naming
   the task.
4. **Ownership** (the assignment law, notes 26/27/31/32): an
   act lands on a task only for its job's holder (or a
   manager's named act). Asking for work is not an act:
   "what's next" READS the worker's assigned jobs and returns
   words, never a mutation — on every agent door now,
   including converse (see below).
5. **Run through the engine.** The gate never mutates state
   itself; a passed act runs through the same engine paths
   the doors call today (js/wms.js, the converse completion
   path). The gate calls the engine's existing public paths
   only — it never reaches into engine internals. That seam
   is deliberate: the host adapter (the build after this
   one) slots UNDER it, and the dummy's engine is simply
   the first thing under the seam. If the engine refuses, the worker hears the refusal
   honestly — the gate never claims an act landed that did
   not.
6. **One attribution writer.** Every landed act records who,
   via, and (for voice) the exact words heard, in one shape,
   written by the gate — not re-implemented per door.

**One policy point.** The confirmation and signature
checks read their rules from a single policy object inside
the gate module — not conditionals scattered across the
checks — so the ontology's configuration layer (note 39's
direction: how this site runs, manager-settled) can supply
those rules later without surgery. In this build the policy
object simply holds today's law, unchanged.

The central agent stays mutation-free, exactly as today.

## The doors, in this build

- **Converse (glasses/phone) — includes the note 32 ruling
  AND interpretation instance 3 (William's decision,
  2026-11-06: absorbed into this build).** Its state-changing
  acts route through the gate, AND its pull retires: asking
  converse for work answers from the worker's assigned jobs
  (the same lines console voice uses, including "Nothing is
  assigned to you right now." when they hold none). Converse
  can no longer hand out an unassigned pool task. William's
  reasoning is the design: the system auto-deals, so there
  is no gap for pull to fill.
  Instance 3 is the converse door's own translation-layer
  move — the same pattern as instances 1 and 2: today
  `api.interpret` (js/wms.js) reads the worker's words in
  code and produces the plan, parseQty sites included. In
  this build the reading moves to the door's AI (the
  envelope carries the claimed parameters, as the work
  envelope does after the instances build); `api.interpret`
  is demoted to the cross-check inside gate check 1, and
  its plans reach the engine only through gate.act. A
  parser-only reading on this door never stages or runs an
  act, and the clarification shapes decided in the
  instances build (partial-or-full; the one-turn
  look-back) apply here unchanged.
- **Console voice (js/wms-voice.js).** Its run path routes
  through the gate. Behavior identical: same staging, same
  lines, same attribution (via 'voice' + the words heard).
- **Game intents (Walk the Shift).** Its intents route
  through the gate against the GAME world. The game's own
  laws stand inside its world (pull is the game's semantics;
  practice-only is untouched). The signature and
  confirmation checks apply as they do today.

## NOT in this build

- Desk console clicks routing through the gate (follow-on
  build, per note 29's settled order).
- The host-WMS adapter seam (the build after the gate). Its
  communication standard is already decided (aware note 38,
  2026-11-06): REST + JSON primary, XML legacy tier per host,
  EDI never for internal acts, never a direct database write;
  reads arrive as a real-time mirror of the host database.
- Any change to what the doors SAY, beyond the converse
  work-answer lines aligning to the assigned-jobs law.
- The Worker. The kitchen. The frozen files (index.html,
  js/voice.js, js/record.js, js/photo.js, css/witness.css,
  worker/*, js/glasses.js, glasses.html). js/converse.js and
  js/wms-voice.js change only to route through the gate;
  js/wms.js changes only at api.interpret (instance 3,
  above).

## Acceptance

- Behavior parity: every existing converse, voice, and game
  test passes with its expectations intact — the suites
  only grow. (If a test's expectation must change, it is
  the converse pull behavior, and the change is named in
  the PR.)
- A signed act attempted through EACH agent door is
  refused with the desk guidance; a forged stage is refused
  at run time on each door.
- Converse: a worker holding no job asks for work and hears
  the nothing-assigned line; the state is byte-identical
  after the exchange; a worker holding a job is told their
  next assigned task.
- Instance 3: on the converse door, "done with this one"
  stages no phantom count (it clarifies in the decided
  shapes); a claimed count the parser reads differently
  clarifies and stages nothing; converse acts reach the
  engine only through the gate.
- An ambiguous reading through the gate returns the
  clarification outcome: the door asks, and nothing is
  recorded on any door.
- With no model envelope, no agent door stages or runs an
  act; the door answers "AI is currently down."
- Attribution is one shape on every agent door: who, via,
  and for voice the exact words heard — including the game
  door's acts, which land only in the game world: the live
  state is byte-identical after any game exchange.
- The gate's refusals are plain words a worker can act on.
- Full node suite AND test/wms-ui-smoke.js run and
  reported. Open the PR and stop. Do not merge.
