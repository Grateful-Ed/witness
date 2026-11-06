# Brief — the host-WMS adapter: the write seam, a simulated host, and the SENT state

For Claude, from Faye. The gate (PR #48) unified the act path;
the converse model step (PR #49) closed its exceptions. This
build puts the adapter under the gate — the seam the whole
design has pointed at: gate verbs on top, a host's own
interfaces underneath, and the dummy WMS demoted to what it
always was, the first thing under the seam. The communication
standard is aware note 38, decided 2026-11-06; this brief
builds to it, it does not re-decide it.

STRESS-TESTED by Faye against merged main 4c6582ee (PR #49)
on 2026-11-06, call sites grepped for every function named.

## The standard (note 38, in one paragraph)

Acts go through the host's own published interfaces, never
its database. REST/JSON is the primary mode (synchronous
confirm/refuse at act granularity); the legacy tier — XML
over SOAP, queue, or file — is FIRST-CLASS, declared per host
under capability honesty, because much of the likely customer
base runs legacy. EDI is never used for internal acts. Every
call carries an idempotency key. On an asynchronous
transport an act honestly sits in a SENT state until the
host's confirmation message lands; the worker hears "sent,"
never "landed," until then. The host is the system of
record and the final checker: "landed" means its
transaction committed. The signature stays human and stays
in Witness (note 29) — the adapter only ever carries
already-signed acts.

## The code as it stands (verified 2026-11-06)

- js/gate.js's worlds are informal adapters already: each
  carries prepare / signed / owns / blocked / run / taskId
  over its engine's public paths. WMS_WORLD.run calls
  W.complete / W.flag synchronously and the act lands in the
  same turn. There is no transport, no capability
  declaration, no idempotency, no in-between state.
- The doors call the gate SYNCHRONOUSLY (converse.js's
  gateAct inside the synchronous workerTurn; wms-voice.js
  likewise). The gate therefore cannot wait on a host —
  and under note 38 it must not: submission is the gate's
  run; the host's verdict is a later event (see step 2).
- State lives in the surfaces' store (js/state.js mutate);
  the record's attribution is written by the gate's check 6
  at land time.

## What to build

1. **The adapter contract** (new js/adapter.js). An adapter
   declares: an id; a profile — transport: 'sync' | 'async',
   and the verbs it supports (complete, flag, post-receiving,
   confirm-load — the gate's act vocabulary); and two
   operations: `submit(act)` — carries the gate's prepared
   act plus its idempotency key and returns the immediate
   outcome; and a confirmation channel for async adapters —
   the host's verdict (landed / refused + the host's reason)
   delivered against the act's key when it arrives. An act
   the adapter's profile does not declare is never submitted
   (step 4).

2. **The gate learns the seam.** gate.act check 5 becomes:
   submit through the current adapter instead of calling the
   world's run directly. The gate stays synchronous. For a
   sync adapter the outcome is today's: landed (or the
   engine's refusal, said honestly). For an async adapter the
   outcome is SENT, and the mechanics are explicit:
   - The pending act is recorded in state as a new shape —
     `state.sentActs`, entries { key, via, who, intent,
     target, params, words, ts, status: 'sent' } — attributed
     by check 6 exactly as a landed act is (who, via, the
     words heard), plus its key. The same build registers
     'sentActs' (and its fields) in the ontology's
     KNOWN_SCHEMA registry, per the PR #44 precedent —
     a deliberate shape is registered, never left for the
     detector to "discover."
   - The act's idempotency key is minted once, at check 5,
     from a state-held counter (`state.adapterSeq`, also
     registered): door + counter is unique per act by
     construction, and resubmitting the same act object
     reuses its key by construction.
   - The door's reply uses sent language ("Sent — waiting on
     the host to confirm." in the door's register; the exact
     line is the door's, the state is the gate's). The task
     itself stays open and in hand while its act is SENT.
   - The host's verdict is applied by a confirmation handler
     the adapter exposes — `adapter.confirm(state, key,
     verdict)` — which the surface calls through its store
     when a verdict arrives: 'landed' runs the act's effect
     through the world's run path and marks the entry
     settled; 'refused' marks the entry refused with the
     host's reason and the task stays open, plainly. In THIS
     build no live surface runs an async adapter, so verdicts
     are delivered only in tests — no listener or poller is
     built (that is the real host's build, later).
   - A confirmation for an unknown or already-settled key is
     ignored, never double-applied (idempotency, enforced at
     both ends).

3. **The dummy adapter.** Today's WMS_WORLD run paths,
   wrapped as an adapter: transport 'sync', every verb
   declared. It becomes the default adapter on every current
   surface. Live behavior is byte-identical — the full suite
   is the regression net, and no current test's expectation
   should need to change for the refactor itself.

4. **Capability honesty.** The gate consults the current
   adapter's declared verbs at check 1: an act whose verb
   the adapter does not support is refused in plain words
   that name the host by the profile's own label (the
   profile carries a `hostLabel`; the simulated host's is
   "the host system (simulated)") — "The host system
   (simulated) doesn't take that from Witness — it has to
   be done there directly. Nothing was done." The refusal
   names the limit; it never fakes a landing, never queues
   silently. POLICY gains no new entries; the adapter
   profile is the declaration the gate reads.

5. **The simulated host.** A second adapter, exercised in
   tests (not wired to any live surface): an async transport
   double with its own shadow record. It confirms most acts
   after a beat, refuses acts its rules reject (with a
   host-flavored reason), drops duplicate submissions by
   key, and deliberately does NOT declare one verb — so the
   suite can pin capability honesty, the SENT → landed arc,
   the SENT → refused arc (task reopens, reason recorded), a
   retried submission landing exactly once, and an unknown-
   key confirmation being ignored. The doors and the gate run
   on it unchanged: the same spoken flows, with sent
   language where the dummy says landed language.

## Scope — files

- js/adapter.js (new: the contract, the dummy adapter, the
  simulated host adapter).
- js/gate.js (check 5 submits through the adapter; check 1
  reads its declared verbs; the sent state in check 6's
  record). The six checks' ORDER and the other worlds
  (engine, game) do not move — those worlds are the demo
  building's own and stay built-in, declared as such in the
  gate's header.
- wms.html only: the adapter script tag. It is the one
  surface whose door runs the WMS world; the engine and
  game worlds do not use the adapter, so warehouse.html,
  phone.html, and the glasses need no tag (gate.js reads the
  adapter lazily, the way it reads the WMS layer — in node,
  via require).
- Tests: new test/adapter-test.js for step 5's pins; the
  full existing suite as the step-3 regression net.
- Docs: docs/wms.md gains the adapter section; the notebook
  already carries the design.

## Not in scope

- The READ side — the ontology mirror (replica / CDC,
  conversion riding creation, detected-and-unmapped). It
  gets its own brief next; this build is the write seam.
- Any real vendor integration. No real host exists; nothing
  here pretends one does. The simulated host is a test
  double and is labeled one wherever it appears.
- The engine and game worlds moving behind the adapter.
- New surfaces or pages (a visible host simulator is a
  separate, demo-polish call).
- The desk console's clicks (they route through the gate in
  a later build, as already queued).

## Acceptance — pin every one in tests

- Dummy adapter: the full existing suite passes unchanged
  in expectation; a spoken complete and a spoken flag land
  exactly as before, attribution identical.
- Simulated host: an act submitted reads SENT (record +
  door language) until the confirmation; on confirm, the
  act's effect lands once; on refuse, the task is open, the
  act carries the host's reason, and the record says refused.
- Idempotency: the same key submitted twice lands once at
  the host and once in the record; a confirmation repeated
  or addressed to an unknown key changes nothing.
- Capability honesty: an act on the undeclared verb is
  refused in plain words before submission; nothing is
  recorded as sent or landed.
- The gate's six checks run in their order on both
  adapters; the signature and confirmation laws behave
  identically on each (a signed act is refused at check 2
  before any adapter is consulted).
- Full node suite green (report the count); smoke run
  EXPLICITLY (report its count separately).

## Report back

Open the PR as a draft. Report: the changed-expectations
list (expected to be empty for the refactor — say so plainly
if it is), the node count and the smoke count separately,
anything the brief did not settle that you had to decide.
Do not merge — the PR waits for William's word, via Faye's
review.
