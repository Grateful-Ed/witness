# Console Task 5 — Flow-Sliced Task Views

Read START-HERE.md, then the shared law in
`briefs/claude-brief-console-layout.md`, then this file.
Build ONLY this task. Depends on Task 1 (the map). Can run parallel
to Tasks 2–4.

## Scope

When a task is open, the console shows only the slice of the
warehouse that task moves through, oriented so the freight flows
DOWN the screen:

- INBOUND task (truck → check → putaway): the inbound docks at the
  TOP, the receiving bay (pink) below them, the bay locations
  (yellow) below that. The existing inbound task panels/data ride in
  this orientation, anchored to the places they concern.
- OUTBOUND task (pick → stage → load): the bay locations at the TOP,
  staging (pink) below, the outbound docks at the BOTTOM.

This is reorientation of existing surfaces around the map slice —
not new WMS functionality and no new data. The whole building is
never shown inside a task view.

## Done when

- An inbound task renders its slice docks-top in flow order; an
  outbound task renders bays-top, docks-bottom.
- Existing task actions still work inside the reoriented views.
- Baseline suites green (668, zero fails); new tests in project
  style; frozen files untouched.
