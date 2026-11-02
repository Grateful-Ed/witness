# Brief — Segment 4: BOL-summon scan + held-bin confession

Read `START-HERE.md` first. This is the Segment 4 build: two parts, one PR.
Both parts obey the standing law — the scan model especially (William,
2026-11-01): **in the warehouse, a scan SUMMONS; only in the kitchen does a
scan CREATE.**

## Part A — the BOL-summon scan (warehouse world)

The receiving module reads a BOL from a photo. Slice 2 built inbound
shipments whose BOLs are already in the system with their task chains
pre-created. This part connects them: scanning a BOL at the dock identifies
the shipment that is already on file and brings its work up.

- **Surface:** `warehouse.html` gains a "Scan a BOL" action — camera capture
  or image pick, reusing the `js/bol.js` reader and the Worker `/chat` read
  exactly as the BOL page uses them. Warehouse world only. **Not**
  `glasses.html` — the glasses segment is on hold.
- **Flow:** read the document → take its BOL number → look that number up
  among the inbound shipments in the shared state.
  - **Match:** open that shipment's record — the file copy beside the fresh
    read (the two-way match the BOL slice already computes, disagreements
    flagged in numbers), the shipment's task chain in its current state,
    and its next open task surfaced for the worker. The scan itself creates
    nothing and changes nothing: it summons.
  - **No match:** the page says plainly that this BOL is not in the system.
    No shipment, no task, no partial record is created — not even a draft.
    Warehouse intake happens upstream (the BOL arrives by email/EDI before
    the truck); a dock scan is identification, never intake. Creation by
    scan exists only in the kitchen world, and it stays there.
- **State discipline:** fetch fresh before the lookup; the lookup is
  read-only — no save on scan, ever. Working a task from the summoned chain
  afterwards uses the mutation paths that already exist, unchanged.
- **Tests** (new `test/summon-test.js`): a known BOL summons the right
  shipment and its chain; an unknown BOL leaves the state deep-equal
  before/after (nothing created, nothing saved); a read that disagrees with
  the file copy flags through the existing match; the kitchen world is
  unaffected by the new action. All existing suites stay green — report
  every suite's count in the PR.

## Part B — the held-bin confession (display only)

Known display gap from the slice 2 review: an outbound line allocated from
a bin that was later placed on hold still reads just "from B-04", with no
sign the bin is held now.

- When an allocation line's source bin is **currently** held, its text
  confesses it: `from B-04 — bin on hold`. The allocation was legal when it
  was made; the hold came later; the line says so.
- Display only. No engine behavior changes: held stock still never
  allocates, moves, or completes, and the reservation stands exactly as
  before.
- Apply it wherever allocation lines render (the warehouse page's order
  panel; the shift summary only if it prints lines — check first, do not
  assume).
- **Tests:** allocate from a bin, then hold the bin — the line gains the
  confession; release the hold — the confession goes. Deepen suite stays
  green.

## Bounds

- Frozen files stay frozen: `index.html` beyond the one existing masthead
  link, `js/voice.js`, `js/record.js`, `js/photo.js`, `css/witness.css`,
  `worker/*`. Nothing in this brief needs any of them.
- PR-based, like PRs #1 and #2: branch, draft PR, suite counts in the PR
  body. Faye reviews before merge; William merges.
