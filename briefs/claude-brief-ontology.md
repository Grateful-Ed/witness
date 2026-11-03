# Claude brief — Dynamic ontology digest + predictive prep (Witness)

Read `START-HERE.md` and `briefs/claude-brief-console-layout.md` first for the house law. This brief adds a new layer to the WMS side of Witness. It builds on the merged console (main, 856 checks green). Frozen files stay byte-identical: `index.html`, `js/voice.js`, `js/record.js`, `js/photo.js`, `css/witness.css`, everything under `worker/`, existing test-data.

## Why (William's idea, 2026-11-03, in his terms)

Today, every AI answer is assembled by handing the model raw WMS state and letting it orient itself on the spot — slower, and the orientation work is repeated on every ask. William's addition: the warehouse maintains a **dynamic ontology** — a rolling, AI-shaped digest of the building that updates as things change, so the AI grabs it and goes. Riding on it: **predictive prep** — when a change affects a specific worker, the note that worker will need is composed ahead of time and held ready.

His hard constraints:
- **Zero API cost for watching.** The digest updates from state changes (mutations already flow through the store). This module must make NO network calls of any kind. Tests must prove that.
- **No live proactive delivery.** Prep notes are composed and stashed, never pushed anywhere. There is no polling loop. (Brief B adds the dormant fleet layer separately; not this brief.)

## Build

### 1. `js/ontology.js` — the digest

A module that derives and maintains a digest from warehouse state:

- `buildDigest(state)` → a plain object, JSON-serializable, shaped for an AI reader:
  - `asOf` (revision/time source from state, no wall-clock invention beyond what state carries)
  - `places`: every door, zone, bin — id, kind, status, what's in it (item ids/descriptions), holds
  - `shipments` and `orders`: id, status, where it is in its flow
  - `tasks`: open tasks — id, kind, item, destination, assignee, status
  - `people`: labor units — name, role, current task
  - `needsEyes`: the same urgency set the map flags derive from (held bin, held pallet, open OS&D finding, open worker flag), each with item + one-line reason
  - `prep`: the prep queue (below), initially empty
- `applyChange(state, digest)` or an equivalent subscription shape: given the store's mutation flow, return an updated digest. Choose the integration that touches the least existing code; the digest must be correct when rebuilt from scratch AND when updated incrementally (a test proves both paths agree on the same final state).
- The digest is derived data only. It never writes back into state.

### 2. Predictive prep (inside the same module or `js/prep.js`)

- On digest updates, detect changes a specific person needs to know: at minimum — a bin or pallet put on hold that has an open task touching it; an open OS&D finding on a shipment someone is assigned to; a task reassigned or a destination changed (kitchen ruleset: a destination correction retargeting an open task).
- For each: compose a short plain-language note FROM STATE (templates over digest fields, no model call), addressed to the affected worker (or the manager when no worker is assigned), and stash it on `digest.prep` as `{ for: <person name>, about: <item id/desc>, note: <text>, fromChange: <what changed> }`.
- Dedupe: the same change does not mint the same note twice across incremental updates. A note leaves the queue only when the underlying condition clears (the hold is released, the finding closes).

### 3. A surface to see it (console, minimal hook)

- On the desk console, one new view: **"Witness Digest"** in the sidebar's OVERVIEW group, rendering the digest the way a person scans: landmark sections (Needs eyes, Prep queue, Places, Tasks, People), counts first, details collapsed where dense. Follow the console's existing design language; dark mode correct.
- If the prep queue is non-empty, the map home shows nothing new — prep lives on the digest view only. (Flags already own the map.)

### 4. Docs

- One short section in `docs/wms.md`: what the digest is, that it updates on state change at zero API cost, that prep is composed-and-stashed (never pushed), and how to read the digest view.

## Tests — `test/ontology-test.js`

- Digest correctness: seed state → digest matches the building (places/tasks/people counts and key fields).
- Incremental == rebuilt: apply a scripted series of mutations (post a receipt, hold bin A-05, assign a task) and assert the incrementally-updated digest deep-equals a fresh `buildDigest` of the final state.
- Prep: holding a bin with an open task mints exactly one note for the right person; rebuilding/updating again does not duplicate it; releasing the hold clears it.
- **No network:** the module source contains no `fetch(`, no `XMLHttpRequest`, no Worker URL (assert by scanning the module source in the test, the same style as other honesty tests in this repo).
- Existing suites all stay green (856 + the new file).

## Not in this brief

- Wiring the desk agent or converse layer to READ the digest instead of raw state (a later, separate change — this brief makes the digest exist, stay correct, and be visible).
- Any proactive delivery, polling, or timers.
- Brief B's central agent.

## Done means

PR against main: new module(s), digest view, docs section, new test file, full suite green, PR body showing the digest for the seeded warehouse (trimmed) and one prep note minted by a hold.
