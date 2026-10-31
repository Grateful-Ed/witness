# Brief for Claude — Witness warehouse, deepen-areas slice (fresh thread)

From William via Repo Faye, 2026-10-31. One job, one thread.
Division of labor for the whole build window (William's ruling):
**Claude hardcodes; Faye manages and reviews.** You build; Faye
reviews your output (tests re-run independently, live verification,
module-one intactness) before it goes to William. Build to be
reviewed: tests and plain commit messages are how your work gets
accepted.

## Start state

Read first: the repo README in Grateful-Ed/witness (the project's
definition of record), then the foundation files — data/world.js,
js/engine.js, js/warehouse-ui.js, warehouse.html, test/engine-test.js
(all checks passing). Module one is FROZEN: index.html,
js/voice.js, js/record.js, js/photo.js, css/witness.css, worker/*,
test-data/ — no edits.

**Sequence:** this slice starts from the tree AFTER the
conversational-layer slice lands (separate brief:
claude-brief-conversational-layer.md). If that slice hasn't landed
yet, say so and wait — do not build this on the pre-conversation
tree; both slices touch js/engine.js and js/warehouse-ui.js.

## The job (areas 2, 3, 4, 10 — deepening the foundation basics)

Full spec: `deepen-areas-spec.md` in Faye's workspace — ask William
for it if you don't have it. In brief:

1. **Inbound end-to-end:** expected → arrived (door) → receiving
   (the receive task; the real cross-check lives in module one) →
   putaway tasks generated from what was received → closed. Manager
   view lists each shipment with its stage in plain words.
2. **Outbound end-to-end:** open → allocating (lines reserved
   against real bin quantities; an unfillable line says so plainly)
   → picking tasks → staged at a door → shipped (record entry).
   Manager view lists each order with its stage.
3. **Holds:** bin/pallet hold + release (manager action,
   worker-visible). Held stock is excluded from allocation and from
   consolidation/breakdown candidacy; task generation skips held
   bins. Holds/releases land in the records with who and when.
4. **Incident updates:** addTaskUpdate(state, taskId, text, byUnit)
   — William's standing design: records are never frozen; a load
   fine at scan can go bad mid-move and the update rides the same
   record. The conversational layer's problem-intent will call this
   exact signature — do not change it without flagging Faye.
5. **Shift summary (area 10):** manager view, one screen — tasks
   completed by type and zone, per-unit completed counts, open
   bottlenecks, incidents, orders shipped / shipments received.
   Computed from state, never hand-written.

## Rules
- Quantities reconcile at every step; every new engine function
  ships with node tests in the existing style (seed → act → assert
  totals). All prior engine tests stay green — run the full file.
- Plain dock language; lifecycle stages named as the work names
  them.
- Push per-file via the established Contents API pattern (helpers
  in ~/workspace/witness/, e.g. push-warehouse.py); verify each
  file serves on GitHub Pages before reporting.
- Deliver to Faye (via William): what you built, test results
  verbatim summary, live URLs, and every choice you made where the
  spec was silent.
