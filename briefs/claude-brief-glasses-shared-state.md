# Brief — Warehouse glasses join the shared record

**For Claude, from Faye (Repo room), on William's word 2026-11-05
("I would like the warehouse glasses to be a part of the WMS").**
Repo: `Grateful-Ed/witness`. **Sequencing: builds on PR #37 (desk–phone
Steps 2–3) MERGED — the `js/state.js` seam must be in main first. This
build completes the one-world program: desk, phone, and glasses on one
shared record. It slots ahead of the full-flow voice build.**

## The gap

PR #37 moved the desk record and the phone onto the shared `/state`
document. The warehouse glasses still run on the engine's localStorage
trio, so in the same browser the glasses now hold a *different* world
from the desk. William's ruling closes that: the warehouse glasses are
part of the WMS — one world, every surface.

The kitchen world is **not** part of this. It starts fresh on every
open by William's law and must keep making zero `/state` calls.

## The seam (already built for this day — verify, then use it)

- `js/glasses.js` touches warehouse state through exactly one place,
  its `Store` adapter (load/save), whose own header comment says:
  "Re-point these two functions at js/state.js when the desk-phone
  build lands." Acts already follow fresh-load → converse → save-if-
  acted; boot loads once at script init.
- The Store calls `E.loadState()` / `E.saveState(s)` with no store
  argument. `js/engine.js`'s trio accepts any localStorage-shaped
  store (`getItem`/`setItem`/`removeItem`) and already ships an
  in-memory fallback store of exactly that shape.
- `js/state.js` (PR #37) owns the network truth: `loadState` /
  `saveState` / `start` / `mutate`, the `wmsRev` stale-read guard, and
  the record trim — shared with `js/wms-store.js`'s guard on the same
  document.

## Build

1. **New `js/glasses-state.js`** — an adapter that loads on
   `glasses.html` in place of the static `js/glasses.js` tag (see
   Files for the exception), active **only in the warehouse world**
   (`W.current` — the kitchen path must not wrap, fetch, or change
   anything):
   - **Hydrate, then boot.** GET the shared document through
     `js/state.js`'s own load path. Only when a document is in hand
     does the adapter inject `js/glasses.js` (then `js/recorder.js`
     and `js/glasses-help.js`, preserving today's order after it) and
     present the hydrated document through a localStorage-shaped
     in-memory store, so the frozen Store block reads it through the
     engine trio unchanged. On 404, seed once through the shared path
     (state.js `start()` semantics), never from a local seed alone.
   - **Failure is a stopped boot, in plain words.** If the record
     cannot be reached, do not boot a phantom local world: write the
     failure onto the start screen ("The shared warehouse record
     could not be reached…") and stop — the desk/phone honesty law.
   - **Writes go through.** The memory store's `setItem` persists
     through `js/state.js`'s save path (same `wmsRev` stamp, same
     trim; `state.wms` rides along untouched). A failed POST is
     surfaced on the glasses surface in plain words — never silently
     swallowed; the work continues on the memory copy and the next
     save retries the whole document (last save wins).
   - **Freshness.** Re-GET the document into the memory store on
     boot, when the surface becomes visible again, and after each of
     the glasses' own saves resolves. Acts validate through the
     engine/converse against the freshest copy held; a task another
     device already closed is refused by the engine's own rules and
     answered honestly — the same law the desk lives under (KV lag
     measured 2026-11-05: ~0.5 s).
2. **Nothing about the conversation changes.** converse.js, the wake
   word, the talk pipeline, directions, and the recorder behave
   exactly as today — they already run on whatever state the Store
   hands them.

## Files

- New: `js/glasses-state.js`, tests.
- **`glasses.html`: one enumerated exception** (William's direction
  covers it): the static `js/glasses.js` script tag is replaced by
  the adapter's tag. No other line changes.
- `js/glasses.js` stays **byte-identical** — that is the point of the
  adapter route. If your investigation proves the dynamic boot breaks
  a real dependency, stop and say so in the PR rather than editing
  glasses.js on your own call; the fallback (an async Store inside
  glasses.js) is a bigger exception and needs William's word.
- Everything else frozen, including `js/engine.js`, `js/converse.js`,
  `js/state.js`, `worker/*`, and all of PR #37's files.

## Tests

- Adapter tests in the house pattern: hydration presents the shared
  document to the engine trio; a save POSTs the whole document with
  the wmsRev stamp; kitchen world → zero `/state` calls and zero
  wrapping; boot failure → the plain-words stop, no seed POST.
- A Playwright pass in the desk-phone smoke pattern (stubbed Worker):
  the glasses complete a task against the stubbed shared document and
  the desk page, opened after, shows the same world.
- The glasses' existing suites (converse, glasses-help, wake) pass
  unchanged.
- Run the full node suite (`node test/<name>-test.js` across the glob)
  **plus `node test/wms-ui-smoke.js` explicitly** — the glob does not
  cover it — and report both counts.

## Stop rules

Open the PR and stop; William merges. In the PR description, name:
how boot order is preserved for recorder.js and glasses-help.js, the
freshness points you implemented, anything about the Store seam that
differed from this brief, and the suite/smoke counts.
