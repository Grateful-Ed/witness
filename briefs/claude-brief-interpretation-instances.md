# Brief — Interpretation instances 1 + 2: numbers and flag-zone through the translation layer

From Faye, 2026-11-06. Two instances of one pattern, one
build. Both move a code-side reading of a worker's words to
the AI — where the ratified law says interpretation lives —
and demote the code to the double checker.

## The law this serves

- **Note 34/34b (ratified 2026-11-05):** the AI receives and
  interprets; the code is the double checker; a settled
  ontology definition overrides any code-side reading; a
  stark disagreement between readings goes back to the
  worker as a clarification; nothing is recorded on an
  unclarified ambiguity.
- **Note 37 (ratified 2026-11-06) — the translation layer:**
  every voice input passes ASR → AI translation → code. The
  layer is never absent; a translation may be verbatim; the
  AI knows the code's shapes and renders the words into
  them so the code lands.
- **Note 33:** "Done with this one" is a known completion
  phrase claiming no count — ontology knowledge, not a
  number. **Note 39 (2026-11-06) refines note 33's fix
  sketch:** where 33 said a no-count completion on a pick
  asks the count, 39 rules that a clean completion stages
  the FULL close; the count ask survives for count tasks
  and after a "partial" answer. Note 33's parser half (the
  parser stops eating the pronoun) is NOT in this build —
  the claim architecture makes the parser's read harmless,
  because it can never stage alone.
- Audit rows (tracker, Interpretation audit tab): #6
  numbers-from-speech (MISALIGNED), #21 flag's zone
  (resolution directed by William 2026-11-06).

## Host consideration (standing — William, 2026-11-06)

Witness ships as a third-party layer on the customer's own
WMS; the WMS in this repo is a **dummy**, present only to
demonstrate the layer — Witness is not a WMS.
Both instances therefore read and validate against the
**ontology digest's shapes** — the places, vocabulary, and
task context the door already composes — the same surface a
host adapter will one day supply. Do not reach past those
surfaces into engine internals for new behavior, and do not
bake in anything that only makes sense inside the dummy
WMS. Where host-zero's state and the digest agree, the
digest is the source, so the layer ports.

## Instance 1 — numbers claimed in speech (console voice door)

Today: the workTurn envelope (js/wms-ai.js) names the intent
but returns no parameters; js/wms-voice.js `completionPlan`
then re-reads the raw words with `W.parseQty` /
`W.parseBin` — its own comment states the old doctrine:
"Deterministic: no model decides a quantity." That is the
pronoun bug's home: "done with this one" stages "1 of 10
picked — 9 short."

The change:

1. The work envelope gains a **claim**: for intent
   `complete`, the AI also returns what the worker claimed —
   `{ qty: <number|null>, bin: <string|null>, cartons:
   <number|null> }` — a field is null when the worker
   claimed nothing of that kind. The WORK_PROMPT states the
   rule plainly: report only what the worker's words claim;
   "done with this one" claims no count. `acceptWork`
   validates the claim's shape (numbers or null; a bin is a
   string or null).
2. The work context (workBody) gains the ontology the AI
   reads against: the task's numbers (already partly there)
   plus the building's **settled vocabulary** from the
   digest — settled meanings override code-side readings
   (note 34b).
3. `completionPlan` consumes the claim instead of reading
   raw words. parseQty/parseBin stay as the **cross-check**:
   - Claim and parser agree → stage as today (the
     confirmation law still owns the close).
   - The AI claims a number the parser does not read (or
     reads differently) → **clarification, nothing
     staged**, in the decided shape (below).
   - The worker claimed nothing and the parser reads
     nothing → the utterance translated cleanly (a known
     completion phrase — note 33): **the full task is
     assumed complete** and the full close is staged (the
     confirmation law still owns the close). This CHANGES
     today's behavior — completionPlan's no-number
     branches currently ask for the count; William's
     ruling (2026-11-06, note 39): the partial/full
     question is reserved for utterances that do NOT
     translate well. Exception: count tasks, where the
     number is the work product (a cycle count's counted
     quantity) — there the count ask stands, because
     "done" cannot supply a measurement.
   - The worker claimed nothing but the parser reads a
     number → that is the pronoun case: the parser's read
     is a nudge, never a stage. The ask is the decided
     clarification (below); the parser's number is never
     named in it and never staged silently.
   - Claim above the task's quantity → today's guard
     stands (an ask, nothing staged).
   - The same adjudication covers the claim's other
     fields: a claimed **bin** that parseBin reads
     differently (or does not read) → clarification,
     nothing staged; **cartons** follow the number rules
     above.
   **The clarification's shape (William, decided
   2026-11-06).** For a quantity ambiguity the door asks
   exactly: "Is this a partial or full completion?" —
   *full* stages the full close; *partial* asks the count
   (today's ask), and that answer stages the short close.
   The worker's answer is an ordinary next utterance
   through the same path, with one addition: the pending
   clarification carries the initial utterance and its
   readings for exactly one turn — the same module-memory
   pattern as the confirmation stage, never persisted,
   dead after that one utterance — and the second reading
   is made against the initial words and the answer
   TOGETHER before anything is asked again. If the
   combined reading still cannot resolve it, the next ask
   is narrower than the last; the same question is never
   asked twice.
4. If the model turn fails or returns no claim, **no act
   is staged or run from code-side reading at all**
   (William, 2026-11-06, note 40): Witness does not work
   without the model — it cannot fall back on code alone.
   The door's reply is exactly: **"AI is currently
   down."** — the outage named as an outage, never a
   per-request apology, so nobody retries against it
   like a bug (William's wording call, 2026-11-06). That covers staging a completion or a
   flag, and running a staged act on a local "yes" — a
   stage caught by an outage dies like a topic change,
   unrun. The local intent reader (localIntent) keeps its
   role only as the code-side nudge it always was: it may
   prompt the AI's reconsideration, never decide an act.
   In a real deployment this is the honest outage story:
   the warehouse simply works in its own WMS, as it did
   before Witness, which was always fully functional
   underneath. The code's read alone never stages a
   number again — and never stages an act.

## Instance 2 — the flag's zone (problem reports)

Today: `zoneFromWords` (js/wms.js) matches place tokens in
the reporter's words against the live building; two zones
named → resolves nothing → the caller falls back (task's
zone, then reporter's). William's direction (2026-11-06):
the reading moves to the AI against the ontology; the code
validates and keeps the honesty.

The change:

1. For intent `problem`, the work envelope gains a
   **place reading**: the place the worker's words point
   at, as the AI understands it — a place id from the
   building, or null. The work context gains the digest's
   **places** (ids + zones), so the AI reads against the
   ontology's own list, nicknames and settled meanings
   included via the vocabulary (instance 1, step 2).
2. Code validates the reading before it is used: the place
   must exist in the digest's places — the same list the AI
   read against; its zone is read from that list, never
   from the AI's say-so. An unknown or invented place is
   discarded to the fallback.
3. `zoneFromWords` becomes the cross-check, exactly as
   parseQty does above:
   - AI place and token read agree (or the token read
     finds nothing and the AI's place validates) → the
     flag takes that zone.
   - The token read finds places in two zones → resolve
     nothing (today's honesty), whatever the AI read.
   - AI place and token read point at different zones →
     **clarification before filing**: one short question
     naming both readings. The pending clarification is
     carried exactly one turn, by the same module-memory
     pattern as instance 1's — the next utterance is read
     against the pending flag's words and both readings
     together. If it answers, the flag files at the
     answered zone; if the next utterance is anything
     else, that is "unanswered": the flag files at the
     fallback with the disagreement noted in its record.
4. `api.flag`'s precedence otherwise stands: the words'
   place first, then the task's zone, then the reporter's.
   Callers without an AI reading (typed flags, the game)
   keep today's behavior — zoneFromWords as the reader of
   last resort, unchanged for them.

## NOT in scope

- `api.interpret` (js/wms.js) — the converse door's
  deterministic reader, parseQty sites included. Its
  translation-layer move is instance 3 and belongs with
  the gate build, which unifies the doors. Do not touch it
  here.
- The gate itself (its own brief). The bottleneck
  (note 36). The glasses buttons (note 35).
- Any change to the confirmation law, the signature rules,
  or what gets recorded on a confirmed act (via: voice +
  the exact words heard stays).

## Acceptance

- New tests pin, at minimum: "done with this one" stages
  nothing and asks partial-or-full; "picked all 10" stages the
  full count (claim and parser agree); a claimed short
  count stages the short close with its detail line; a
  claim/parser disagreement asks and stages nothing; a
  model failure stages nothing and runs nothing — the door
  answers "AI is currently down." (any
  expectation that pinned local-fallback staging is an
  expected change). For flags: an AI place that validates lands the
  zone; an invented place falls back; two-zone words
  resolve nothing; an AI/token zone disagreement asks
  before filing. For the clarification loop: "full"
  stages the full close; "partial" draws the count ask
  and the count stages; an answer that only resolves
  read together with the initial utterance stages from
  the combined reading; a second ambiguity narrows the
  ask instead of repeating it.
- Behavior parity everywhere else: full node suite AND
  test/wms-ui-smoke.js reported separately; counts only
  grow.
- Bare "done" on a pick stages the full close; bare
  "done" on a count task still asks for the count.
- The PR states its head SHA and names any expectation it
  changed in existing tests (completion wording on the
  pronoun path and the bare-"done" path are the expected
  ones).
- Open as a draft. Do not merge — William's word.
