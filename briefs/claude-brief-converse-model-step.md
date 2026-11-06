# Brief — the converse model step (interpretation instance 3, correctly aimed; the pull retirement; the converse outage line; the converse signature)

For Claude, from Faye. The gate (PR #48) unified the act path.
Converse — the glasses / phone door — rides it, but with declared
exceptions: its reader is still code (converse.js's matchIntent),
so POLICY carries modelFormed.converse: false,
signatureEnforced.converse: false, pull.converse: true. THIS
build closes all three. It is the last build in the
interpretation arc.

STRESS-TESTED by Faye against merged main 4c29ece6 (PR #48) on
2026-11-06, including call-site greps for every function named
below. The gate brief's original instance 3 aimed at
js/wms.js's api.interpret — a function nothing calls. This brief
is scoped from the code as it actually is.

## The law this carries

- The interpretation model (aware notes 34/34b): the AI
  interprets; the code double-checks; a stark disagreement
  becomes a clarification; a clarification answer is weighed
  with the original utterance, one turn, never persisted; the
  same question is never asked twice.
- The translation layer (note 37): every voice input passes
  ASR → an AI translation layer → code. The layer is never
  bypassed; verbatim is a valid translation.
- Note 32: converse loses its pull. Work is assigned, never
  pulled (the assignment law, notes 26–28).
- Note 40: no model, no Witness. An act turn with no model
  reading stages nothing and runs nothing — including a "yes"
  to a stage already pending. The reply is exactly
  "AI is currently down."
- The signature test (note 30): a spoken "done" aimed at a
  signed act (an engine-world receive or load task) is
  refused with guidance to the desk. Voice confirms; voice
  never signs.

## The code as it stands (verified 2026-11-06)

- js/converse.js: `matchIntent(text)` (line ~117) is the code
  reader: done / problem / start / next / confirm / deny /
  unknown, with the NOT_DONE negation guard. `workerTurn(E,
  state, unit, match)` (line ~291) is SYNCHRONOUS and consumes
  a pre-computed match. Its stage lives in module memory
  (`stages`, keyed by unit id, one-turn life). Its acts already
  route through gate.act (PR #48's gateAct helper).
- Callers of matchIntent + workerTurn, all synchronous today:
  js/glasses.js `onSpeech` (line ~641/651), js/phone.js
  `queueTurn` (line ~302/306), js/warehouse-ui.js
  `onWorkerHeard` (line ~266). Phone and warehouse-ui already
  live inside async flows; glasses' onSpeech does not.
- js/glasses.js `onSpeech` order today: hide (view) → who's
  free (a question) → kitchen correction via
  `K.parseCorrection` (CODE) + `K.applyCorrection` (an act:
  retargets a task; js/kitchen.js line ~336) → matchIntent →
  unknown routes to spoken intake / the free ask;
  known routes to workerTurn.
- The kitchen spoken intake (glasses.js `spokenIntake`,
  js/kitchen.js's spoken read) ALREADY decides by META's
  read. It stands unchanged (see Not in scope).
- The engine world (js/engine.js) has receive and load task
  types (lines ~342/358) — the converse signature class.
- js/wms-ai.js hosts the model envelopes (workTurn, gameTurn).
  There is no converse envelope.

## What to build

1. **The model reading.** A new envelope in js/wms-ai.js,
   sibling to workTurn: given the transcript plus context —
   the wearer's current task (title, type), their assigned
   tasks (titles), whether a confirmation stage is pending —
   it returns the converse intent set {done, problem, start,
   next, confirm, deny, unknown} and, for start, the job words
   as heard. Failure or an unusable reply returns null, like
   the other envelopes. Plumbing follows the doors' existing
   convention: the caller hands in its fetch (the way
   converse's ask path already takes opts.fetch, and the way
   kitchen's reads take a doFetch), and converse passes it to
   the envelope.

2. **The read turn.** js/converse.js gains an async entry
   (workerTurn keeps its signature for the tests that drive it
   directly; the new entry wraps the same machinery): obtain
   the model reading; compute matchIntent as the cross-check;
   adjudicate:
   - model reading null → the turn answers exactly
     "AI is currently down." Nothing staged, nothing run; a
     pending stage DIES (cleared), exactly as PR #47's console
     door rules. (Questions never reach this entry — see 5.)
   - model and code agree, or the code has no reading
     (unknown) and the model reads an act intent → proceed
     with the model's intent through today's workerTurn path
     (which already routes acts through the gate). The
     code-unknown-plus-model-intent case is the translation
     layer earning its keep: phrasings the regexes miss still
     land.
   - model and code DISAGREE on the intent (both read, starkly
     different) → ONE clarification, in converse's voice,
     naming both readings plainly ("Did you mean you're done
     with this one, or that there's a problem?"); the answer
     is weighed with the original utterance by a second
     reading (initial + answer together), one turn, module
     memory, never persisted; the same question is never
     asked twice — a second ambiguity narrows or answers
     honestly. Nothing is staged or recorded while a
     clarification is pending.
   - confirm / deny turns go through the reading too (the
     every-turn rule, PR #47's endorsed choice): a "yes" with
     the model down runs nothing. A live stage consumes the
     turn as its answer first, as today — an utterance that
     is not its answer clears it and is then adjudicated on
     its own merits; the envelope's context therefore carries
     whether a stage is pending (step 1).

3. **The pull retirement.** workerTurn's pull path is
   deleted — today it is the fall-through at the end of the
   turn (the gateAct 'pull' call), reached by an empty-hands
   "next" and by a close chain with nothing behind it. After
   this build: a "next" (or any ask for work) with nothing
   assigned answers exactly "Nothing is assigned to you right
   now." (the console voice line, PR #40) and no task moves.
   js/gate.js: the ENGINE_WORLD pull intent is removed and
   POLICY.pull is deleted. The take path (starting a job the
   worker names — how a created job starts) is NOT pull and
   stays.

4. **The signature on converse.** One POLICY flip:
   signatureEnforced.converse: true. The check itself already
   exists — ENGINE_WORLD's signed() has carried the task-type
   branch and its refusal lines since the gate build
   ("Receiving is a signed act — post it on the Receiving
   screen. Voice does not post it. Nothing was done." /
   "Loading is a signed act — confirm it on the desk screen.
   Voice does not sign it. Nothing was done."); the flip is
   what routes a converse "complete" on a receive or load
   task through it, at stage time and again at run time.
   modelFormed.converse flips to true in the same build
   (check 1 then requires the reading this brief adds).

5. **The callers.** js/phone.js and js/warehouse-ui.js switch
   their worker path to the async read turn. Unknown-and-no-
   model-intent still routes to the free ask exactly as today
   (the ask's own behavior, including its failures, is
   unchanged and out of scope). js/glasses.js: see the scope
   exception below.

6. **The kitchen correction.** The correction branch gains
   the model step: a correction read in js/kitchen.js (sibling
   to its spoken read) returns the item and destination from
   the words; parseCorrection remains the cross-check and the
   validator (the item must be in the run; the place must
   exist in the kitchen world). Agreement (or a model reading
   the code cannot parse but can validate) → applyCorrection
   as today. A reading the validator cannot land → an honest
   line, nothing retargeted. No model → "AI is currently
   down." and nothing retargeted.

## Scope — files

- js/wms-ai.js (new envelope), js/converse.js (the read turn,
  the clarification, the pull removal), js/gate.js (POLICY
  flips, ENGINE_WORLD signed + pull removal), js/phone.js,
  js/warehouse-ui.js (async callers), js/kitchen.js (the
  correction read).
- **js/glasses.js — FROZEN-FILE EXCEPTION, GRANTED by William
  2026-11-06 (enumerated):** only `onSpeech` changes — its
  correction branch awaits the correction read (step 6), and
  its match/turn branch awaits the read turn (step 2). No
  other line of glasses.js moves; glasses.html stays frozen.
  Without this exception the flagship surface remains the one
  code-read door, which contradicts the translation law where
  it matters most.
- Tests: test/gate-test.js (POLICY flips pinned), the
  converse / deepen / glasses / desk-phone suites as their
  behavior changes; new test file for the read turn's
  adjudication (agreement, code-unknown + model-intent,
  disagreement clarification, outage incl. the dying stage).
- Docs: docs/wms.md's gate section updated for the flips;
  README status bullet after merge (Faye's, as usual).

## Not in scope

- The kitchen spoken intake and receipt intake: already
  model-read; creation in the kitchen stays the scan-model
  law (a tell creates; PR #18's soft gate deliberately). No
  gate routing for kitchen creation.
- The free ask (questions): its model path and failure
  behavior stand as built.
- The desk console's clicks; the console voice door (PR #47
  already model-formed it); the game door.
- Any change to the gate's six checks themselves — this build
  flips converse's POLICY entries and removes its pull
  intent; the checks do not move.

## Acceptance — pin every one in tests

- Pull: "what's next" with nothing assigned answers "Nothing
  is assigned to you right now."; no task changes hands; the
  gate refuses a pull intent on converse outright.
- Outage: an act turn with the model unreachable answers
  "AI is currently down."; nothing staged or run. A pending
  stage caught by an outage dies unrun — the next "yes" is
  inert.
- Signature: a spoken "done" on an engine receive task and
  on a load task is refused with the desk guidance; the task
  stays open; a forged stage is refused at run time.
- Adjudication: model/code agreement proceeds; code-unknown
  + model-intent proceeds; a stark disagreement asks once,
  records nothing, and the answer is weighed with the
  original words; a plain "yes"/"no" with no stage is inert.
- Correction: a spoken correction retargets only on a
  validated reading; an unlandable reading retargets nothing;
  an outage retargets nothing and says the outage line.
- Parity: phone and warehouse-ui turns behave as glasses
  turns do on the same words (same reading path).
- POLICY after the build: modelFormed.converse true,
  signatureEnforced.converse true, no pull entry anywhere.
- Full node suite green (report the count); smoke run
  EXPLICITLY (report its count separately).

## Report back

Open the PR as a draft. Report: the changed-expectations
list (tests whose pinned behavior this build changes on
purpose — pull-era and sync-era pins especially), the node
count and the smoke count separately, anything the brief did
not settle that you had to decide. Do not merge — the PR
waits for William's word, via Faye's review.
