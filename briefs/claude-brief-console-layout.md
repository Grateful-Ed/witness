# Brief — The Console: Map Dashboard + The Witness Page

Read START-HERE.md first. This brief rebuilds the WMS desk console's
presentation and interaction layer on a layout William designed and
approved on 2026-11-02. It changes how the console LOOKS and how a user
moves through it. It does not change the engine, the warehouse logic, or
the data model.

Visual references, in this order:
1. `briefs/warehouse-layout-sketch-2026-11-02.png` — William's own
   drawing of the building. This is the source of truth for the layout.
2. The approved layout artifact (ask Faye for the link if needed) — the
   same layout, cleaned up: overview + inbound view + outbound view.

## The building (layout law)

- Inbound Docks 1–4 on one wall. Outbound Docks 1–4 on the opposite wall.
- Inside each dock wall, a staging band (drawn pink):
  - Inbound side: the RECEIVING BAY — pallets are staged here to be
    checked before putaway.
  - Outbound side: the staging band for loads being built.
- The centre block (drawn yellow) is the BAY LOCATIONS — storage.
- Zone colours come from William's sketch: pink = staging/receiving,
  yellow = bays. Keep them, but in a calm, clean treatment (see Palette).

## Task views are sliced and flow-shaped

The console never shows the whole building when a task is open. It shows
the slice of the warehouse that task moves through, oriented so the
freight flows DOWN the screen:

- INBOUND task (truck → check → putaway): inbound docks at the TOP of
  the screen, receiving bay below them, bay locations below that.
- OUTBOUND task (pick → stage → load): bay locations at the top,
  staging below, outbound docks at the BOTTOM of the screen.

## The dashboard is the map

- The desk home is the warehouse map (the overview above): docks,
  staging, bays. It shows the building — the product — and the user
  navigates by eye.
- The map carries NO dense information. No tables of data on the map.
- The one exception: FLAGS. A small flag marks anything urgent that
  needs a human's eyes right now (a flagged discrepancy, a held bin
  awaiting a decision). A flag marks; it does not explain. It takes
  almost no space and says a lot. Everything else stays off the map.
- Palette: the previous "Floor" look won on its map idea and lost on
  its colours — too messy, hard to visually digest. Use a cleaner,
  calmer palette than the Floor's: strong landmark bands, restful
  surfaces, AA-legible text in dark mode. Design for the human eye:
  landmarks first, chunking, no long prose.

## The Witness page (the item page)

Clicking an item on the map — a pallet, a task, the thing in a bay — or
clicking its flag opens that item's page. It is called the WITNESS PAGE.
Layout order is ruled, top to bottom:

1. THE AGENT, at the TOP of the window. A live Witness AI agent the
   desk user can TYPE to and SPEAK to, right there, with this item's
   history as its context. No glasses or phone needed — the desk is a
   full Witness surface. Reuse the existing conversational plumbing
   (converse intents, warehouse mic, the /chat route), scoped to the
   open item: the agent answers from this item's record.
2. Below it, two panels:
   - LEFT: THE EVENTS, in chronological order — the important moments
     distilled from the transcripts and the actions taken (arrived,
     checked, flagged, held, released, decided, put away). Events are
     derived from real records: task updates, scan verdicts, holds and
     releases, human posts. If the underlying record has nothing, show
     nothing — never invent an event.
   - RIGHT: THE FULL TRANSCRIPT — every Witness/worker interaction
     about this item, verbatim, in order. An item passes through many
     hands: the transcript accumulates MULTIPLE workers over the
     item's life, not one conversation.

Further rules for the page:

- Records are never frozen. What the desk user says or types to the
  agent on the Witness page JOINS the item's record (flagged in the
  transcript as a desk entry) and can mint an event, same as a worker's
  words on the floor.
- The visible trace of the human decision stays: where a human posted,
  agreed, or decided, the page shows it. The AI is never shown as the
  one in charge.
- Enterprise note, DO NOT BUILD: in a real enterprise program, the
  Witness-page agent is manager-gated — too much power for just anyone.
  Record that as one comment/line in the docs. No permission system,
  no gating code in this build.

## Constraints

- Desk layer only (wms.html and its js/css). Do not touch the glasses
  or phone surfaces.
- FROZEN, as always: index.html beyond the approved masthead link,
  js/voice.js, js/record.js, js/photo.js, css/witness.css, worker/*
  except already-approved changes, existing test-data.
- Build on the existing WMS data and engine (tasks, task updates,
  scans, holds, the /state document). State discipline stands: fetch
  fresh before each mutation, never save on page open.
- This is a presentation + interaction build over data that exists.
  Do NOT expand WMS breadth (no new modules). If an item has no
  transcript or no events in the real data, render that honestly
  (empty / "Not said") rather than fabricating content.
- Leave the ?look= switcher (Today / Stand / Floor / Record) in place
  for now. Removing it is a separate small job after William's verdict
  on this build.
- Baseline must stay green: 668 checks, zero fails, plus new tests in
  the project's style for the new surfaces. wms-ui-smoke may self-skip
  without Playwright, as before; say so in the report if it does.

## Acceptance

- Dashboard renders the building from the sketch: 4 inbound docks,
  4 outbound docks, pink staging bands, yellow bay block, calm palette.
- A flag appears on the map for an urgent item and only for urgent
  items; clicking the flag or the item opens its Witness page.
- An inbound task view orients docks-top → receiving → bays; an
  outbound task view orients bays → staging → docks-bottom.
- On the Witness page: the agent sits at the top; events (left) and
  full transcript (right) sit below it; both are empty-honest when the
  record has nothing.
- The agent answers a question about the open item from that item's own
  record, and a typed or spoken desk update lands in the transcript
  and can appear as an event.
- Suites: all 668 baseline checks still pass; new-surface tests pass.
- Report includes: what was built, suite counts, anything skipped and
  why, and confirmation the frozen files are untouched.
