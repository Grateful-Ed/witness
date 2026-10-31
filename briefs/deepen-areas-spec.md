# Witness warehouse — deepen-areas build spec (Faye, 2026-10-31)

Build-ready spec for the second warehouse slice. Owner unassigned
(waits on William's conversational-layer pick, since both slices
touch js/engine.js and js/warehouse-ui.js). Whoever builds works
from this spec; engine tests must stay green throughout.

## Scope (areas 2, 3, 4, 10 deepened from the foundation basics)

1. **Inbound end-to-end.** An expected shipment's life: expected →
   arrived (door assigned) → receiving (the receive task, handing
   off to module one's cross-check) → putaway tasks generated from
   what was received → received/closed. Inbound list in the manager
   view shows each shipment's stage in plain words. The staged
   quantities drive putaway — no free-floating tasks.
2. **Outbound end-to-end.** An order's life: open → allocating
   (lines reserved against real bin quantities; a line that can't be
   filled says so plainly instead of silently shorting) → picking
   (tasks) → staged at a door → loaded/shipped (record entry). Order
   list in the manager view with stage per order.
3. **Holds.** A bin or a pallet can be put on hold and released
   (manager action, worker-visible). Held stock is excluded from
   allocation and from consolidation/breakdown candidacy; the
   engine's task generation skips held bins. Hold/release lands in
   the records with who and when.
4. **Incident updates on tasks.** Any open task can take an update
   in plain words ("pallet spilled at Door 2", "forklift down in
   B") attached to the task and written to the records — William's
   standing design: records are never frozen; a load fine at scan
   can go bad while being moved and the update rides the same
   record. (This is also the API the conversational layer's
   problem-intent calls.)
5. **Shift summary (area 10).** One screen, manager view: tasks
   completed by type and by zone, labor units' completed counts,
   open bottlenecks called out, incidents listed, orders shipped /
   shipments received. Generated from state.records + counters —
   computed, never hand-written.

## Rules
- Quantities reconcile at every step; new engine functions get
  node tests in the existing style (seed → act → assert totals).
- Plain dock language; stages named as the work names them.
- Additive to the foundation files; module one stays frozen.
- The conversational layer (separate slice/brief) consumes #4's
  API and reads #1/#2 stages for its answers — build #4's function
  signature first if the two slices run in sequence:
  addTaskUpdate(state, taskId, text, byUnit) → record entry.
