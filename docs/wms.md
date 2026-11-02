# Witness WMS — the desk console (wms.html)

Built 2026-11-02 on top of the warehouse foundation. Open it at
`https://grateful-ed.github.io/witness/wms.html` (add `?practice=1`
for an in-memory copy that is never saved).

## What it is

A full warehouse management system, beginning to end, in an
enterprise WMS layout: navy masthead, left module menu, dense data
grids, status chips, KPI tiles, and an RF-gun style worker console.
Original code and styling.

The flow it runs:

dock appointment → check-in → receive against the BOL on file →
OS&D on every discrepancy → directed putaway (voice / photo / typed,
suggested vs actual kept) → live stock, holds, cycle counts, moves →
min/max replenishment → customer orders → waves → allocation that
never takes held stock → picks by zone, voice-confirmed, short picks
reconciled → pack & label → load at a door → ship confirm closes the
outbound load (BOL number, seal, totals) → per-worker queues,
reassignment, labor proposals (a human approves) → flags (a label
plus the speaker's exact words) → dashboard and shift summary
computed from real state.

## Files (all new, except one link)

| File | What |
| --- | --- |
| `wms.html` | The page. |
| `css/wms.css` | Its styling (standalone; does not load witness.css). |
| `data/wms-seed.js` | The WMS layer's seed: item master, appointments, BOL file copies, pick faces, unreleased orders, customers. |
| `js/wms.js` | The WMS logic. Pure; built on `engine.js` (calls its functions, never changes them). |
| `js/wms-ai.js` | The Meta Model API calls through the Worker's `/chat`: receiving count from speech, flag labels, putaway photo, dock photo. Reuses `bol.js` `readBody` + `sendRead`. |
| `js/wms-store.js` | The desk-record seam: `GET /state`, `POST /state`. |
| `js/wms-ui.js` | Page rendering and actions. |
| `warehouse.html` | One added masthead link to the WMS. |

Voice uses `js/warehouse-mic.js` unchanged (`/asr`, Muse Voice
Transcribe). The manager's "Ask the building" uses `converse.js`
`askManager` unchanged (Muse Spark, numbers checked).

## Where state lives

On the desk record: the Worker's existing `/state` document
(`__warehouse_state__` in KV). The WMS layer rides on it as
`state.wms`, so the document stays the engine's shape plus one key.

- Page open is read-only. A 404 seeds and POSTs once.
- Every action: GET fresh → apply → POST. A refused action saves nothing.
- Network failure is said plainly; there is no silent local fallback.
  Practice mode is an explicit choice and every screen says so.
- KV read lag guard: each save stamps `wmsRev`; a read older than the
  page's own last save is not used.
- The document is kept under the Worker's 500,000-char cap (oldest
  records trimmed first, newest 400 always kept).
- A desk record holding the kitchen world is refused, never overwritten
  without an explicit reset.

No Worker change was needed.

## Tests

```
node test/wms-test.js        # 127 — the WMS logic end to end
node test/wms-ai-test.js     # 20  — Meta API calls, stubbed /chat
node test/wms-store-test.js  # 15  — desk-record seam, stubbed fetch
node test/wms-ui-smoke.js    # 18  — real browser (Playwright), stubbed Worker; skips without Playwright
```

## Left out, and why

- **Returns, kitting, labeling/relabeling, equipment, lot/serial/expiry,
  hazmat rules, location capacity.** Benchmark areas beyond the ten the
  brief listed; the scope rule is "the basic of each area, that works."
- **BOL summon by camera.** That is the open "Add BOL summon scan" work
  (PR #4). The WMS receives against the BOL already on file by picking
  the shipment; when PR #4 lands, its `bol` data reads the same.
- **Moving warehouse.html onto /state** (desk-phone Step 2). Not touched,
  so the open threads don't collide; the WMS uses its own seam module.
- **Storing photos with records.** Still William's open decision. Photo
  reads keep the flags only.
- **Conflict machinery.** Last save wins, by the desk-phone brief.
