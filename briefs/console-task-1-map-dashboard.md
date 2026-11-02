# Console Task 1 — The Map Dashboard

Read START-HERE.md, then the shared law in
`briefs/claude-brief-console-layout.md`, then this file.
Build ONLY this task.

## Scope

The WMS desk console's home becomes the warehouse map, from William's
sketch (`briefs/warehouse-layout-sketch-2026-11-02.png`):

- The building as a bird's-eye place: Inbound Docks 1–4 on one wall,
  Outbound Docks 1–4 on the opposite wall.
- Pink staging bands inside the dock walls (inbound side labelled
  Receiving Bay), yellow bay-locations block in the centre, with the
  existing zones/bins rendered as places inside it.
- The map is the navigation: it shows the building, and zones/bins/
  docks are visible, named places. Item click-through is Task 2 —
  in this task, places render from existing state, read-only on open.
- The map carries NO data tables and no dense information.

## Palette

Pink = staging/receiving, yellow = bays (from the sketch). Otherwise
calm and clean — the rejected "Floor" look was too messy to digest.
Strong landmark bands, restful surfaces, AA-legible in dark mode.

## Done when

- Dashboard renders the building recognisably from the sketch,
  driven by existing warehouse state (no fabricated data).
- No data tables on the map surface.
- Baseline suites still green (668, zero fails); new tests for the
  map surface in the project's style; frozen files untouched.
