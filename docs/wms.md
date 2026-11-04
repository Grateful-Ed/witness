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
| `js/wms-map.js` | The warehouse map — the console home (console Task 1). Pure model + HTML from state. |
| `css/wms-map.css` | The map's styling: pink receiving/staging bands, yellow bay block, light and dark. |
| `js/wms-witness.js` | The Witness page — one item's record (console Task 2). Pure model + HTML from state. |
| `css/wms-witness.css` | The Witness page's styling, and the map's openable items. |
| `js/wms-agent.js` | The agent in the Witness page's chair (console Task 3): asks Muse Spark from one item's record; adds desk words to the record. |
| `warehouse.html` | One added masthead link to the WMS. |

Voice uses `js/warehouse-mic.js` unchanged (`/asr`, Muse Voice
Transcribe). The manager's "Ask the building" uses `converse.js`
`askManager` unchanged (Muse Spark, numbers checked).

## The home: the warehouse map (console Task 1, 2026-11-02)

The desk home (`#/dashboard`) is the building from William's sketch
(`briefs/warehouse-layout-sketch-2026-11-02.png`): Inbound Docks 1–4
on one wall, Outbound Docks 1–4 on the other, the pink Receiving Bay
and Staging bands inside them, the yellow Bay Locations block in the
centre with every zone and bin from state. No tables; read-only.

- Eight doors, for real (data/world.js): `Inbound Door 1–4`
  (`direction: 'in'`) and `Outbound Door 1–4` (`direction: 'out'`).
  The map renders doors straight from state: Inbound Dock N is
  Inbound Door N, Outbound Dock N is Outbound Door N. Outbound Door 4
  is the loading door (engine `DEFAULT_OUTBOUND_DOOR`).
- Trucks come in only at inbound doors: `arriveShipment` (engine) and
  `schedule` (WMS) refuse an outbound door; the Dock & Yard door list
  shows inbound doors only.
- A door with no direction (a save from the old four-door world), a
  pallet not at an inbound door, or an order staged away from an
  outbound door is listed under the map as "Not on a wall" — never
  dropped.
- Every place carries `data-place` / `data-id` hooks. Docks, pallets,
  staged orders and bins also carry `data-open` (focusable): a click
  or Enter opens that item's Witness page (Task 2). Map flags are
  Task 4 (below).
- One numbers page: Shift Summary (`#/summary`). The KPI dashboard
  that used to be the home was folded into it (open tasks, inbound
  x / y with trucks at a door, orders shipped, fill rate, inventory
  accuracy, dock to stock, replenishment, done per zone) and then
  deleted. All figures come from `W.dashboard` / `W.shiftSummary`.
- The design-review looks are removed (console Task 6, 2026-11-03).
  The `?look=` switcher, the three alternate looks (Witness Stand,
  Floor, Record) and their stylesheets are gone; the console has the
  one design — the default look ("Today") plus the design pass.

## Flags on the map (console Task 4, 2026-11-02)

The one voice the map is allowed. A small red pennant marks anything
whose record already says a human is needed now. No new urgency
model: `flags()` in js/wms-map.js only reads what is there.

| The record says | The flag sits on | A click opens |
| --- | --- | --- |
| A bin is on hold | that bin | the bin's Witness page |
| A pallet is on hold | that pallet | the pallet's Witness page |
| An OS&D finding is open (count or camera, awaiting a decision) | the inbound dock it came in at | the shipment's Witness page |
| A worker flag is open (can't verify; a human decides) | the pallet, bin, order or dock its task works on (else its zone) | the task's Witness page |

- One flag per item, however many reasons it has. When the human
  decides (finding closed, hold released, flag closed), the flag goes.
  When nothing is urgent, the map has no flag.
- A flag marks; it does not explain: no words, no counts, no legend
  entry. Its name ("Needs a human now — …") is for screen readers and
  hover only.
- A flag is a real link (`<a data-flag href="#/witness/…">`). It sits
  inside the place it marks; wms-ui.js lets a flag click follow its own
  link instead of opening the place underneath.
- Never dropped: an item the walls cannot place is flagged under the
  map, in the "Not on a wall" line. A worker flag with no task opens
  the Flags & Incidents page (there is no item page to land on).
- Flags are the map home's voice only; the task slices carry none.

## The Witness page: an item's record (console Task 2, 2026-11-02)

`#/witness/<place>/<id>` — opened from the map. Places: `dock`,
`pallet`, `order`, `bin` (from the map), and `shipment`, `load`,
`task`. A dock with a truck opens that shipment; a dock that is
loading opens that load; a clear dock is its own, empty page.

Top to bottom: the agent's chair (the live agent, Task 3 — below),
then two panels.

- **The events** (left), oldest first, derived only from real data:
  the records ledger (arrived, checked, put away, picked, held,
  released, shipped, updates…), OS&D findings and flags (and who
  closed them), and the hold a receipt puts on damaged stock. Every
  event names the person who did it; holds, releases, closes and
  ship confirms show "Decided by <name>".
- **The full transcript** (right), verbatim and in order: task
  updates and flag words, the receiver's spoken count, words said
  with a count or a short pick. Each line names its speaker, so one
  item shows many voices.
- Empty-honest: no event → "Nothing on the record yet"; no words →
  "Not said". An item no longer in the record (a pallet put away, an
  order gone) says so; nothing stands in its place.
- Opening the page saves nothing. Only what the desk user tells the
  agent is saved (below).
- A pallet carries its truck's arrival, receipt and spoken count, and
  only the findings for its own item — not its sibling pallets' work.

## The agent in the chair (console Task 3, 2026-11-02)

The top of every Witness page. The desk user types, or holds the mic
button and speaks (`js/warehouse-mic.js` → `/asr`). Code:
`js/wms-agent.js`.

- **Ask or tell is decided locally**, like the worker's intents: a
  question mark or a question word asks; anything else is told. The
  Ask and "Add to the record" buttons force either one.
- **Ask**: the item's own record (what it is now, its events, its full
  transcript — the same model the panels show) plus the question go to
  Muse Spark through `/chat`, bound to answer only from that record.
  Every number and quoted phrase in the answer is looked up in the
  record; the page says which were not found. "Everything it was
  given" shows the exact text sent. Asking saves nothing.
- **Tell**: the words are saved as one record (`kind: 'desk'`, `by`,
  `words`, `source` typed/voice, `decision`, `on` = the item's keys).
  They show in the transcript as a desk entry ("Desk · typed" /
  "Desk · spoken") under the person's name, and as an event: "Desk
  update", or "Decided" (by that person) when the words state a
  decision ("I decided…", "keep it on hold", "send it back", "do not
  ship"…). A decision moves nothing in the building — the desk
  controls do that. Questions and the agent's answers are not saved.
- A desk entry shows on its item and on the pages that hold that
  item: a pallet's shipment (and, once put away, its bin), an order's
  load. A dock with a truck files it under that shipment.
- Enterprise note: in a real enterprise program this agent is
  manager-gated. This build has no gating.

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

## Flow-sliced task views (Console Task 5)

A task view never shows the whole building. The inbound pages (Dock &
Yard, Receiving, OS&D, Putaway) stack Inbound Docks → Receiving Bay →
Bay Locations, top to bottom. The outbound pages (Picking, Pack & Ship)
stack Bay Locations → Staging → Outbound Docks. Each page's own panels
sit under the stage they concern; every action is unchanged. Only bins
with a reason show: a putaway destination or pick source, or a hold.
Code: `slice()` / `sliceHtml()` in js/wms-map.js, `flow()` in
js/wms-ui.js, styles in css/wms-flow.css.

## The dynamic ontology — the digest and prep (js/ontology.js)

The digest is the building's standing summary, shaped for an AI
reader: every place (doors, zones, bins, pallets) with its status
and contents, the shipments and orders and where each sits in its
flow, the open tasks with their destinations and hands, the people,
a `needsEyes` list (the same urgency set the map flags derive
from), and a prep queue. It is derived data only — `buildDigest`
reads state and returns a plain JSON object; nothing is written
back. `applyChange(state, previousDigest)` is the incremental
path: it re-derives the digest and keeps the prep queue in
first-seen order; its content always equals a fresh rebuild of
the same state (a test proves this across real mutations).

It costs nothing to keep current. The digest updates when the
state changes — mutations already flow through the store — and the
module makes no network calls of any kind (a test scans its source
to prove it). There is no timer and no polling.

Riding on the digest is **predictive prep**: when a change touches
someone's work — a bin or pallet goes on hold with an open task
against it, an OS&D finding opens on a shipment a worker is putting
away, a task is reassigned or its destination corrected — a short
note is composed from state (templates, no model call) and stashed
on the digest, addressed to the affected worker or, when no worker
is attached, the manager. Notes are composed and held, never
delivered; a note leaves the queue when its condition clears (the
hold is released, the finding closes, the task finishes).

Read it in the console on the **Ontology** page (Control, after
Audit Trail): Needs eyes and the Prep queue first, then Places,
Open tasks and People, counts ahead of detail.

## The central agent — one agent for the whole warehouse (js/central-agent.js)

**The idea.** Witness runs one agent for the whole building, not
one per person. The glasses (and the desk, and the phone) are
*endpoints*: they take a worker's words in and show an answer out.
Behind them sits one central agent, the **delegator**. Every input
from every worker goes to it. It reads the input, decides what kind
of job it is, writes the instruction (the prompt), and cuts the
exact slice of the dynamic ontology digest that job needs. Then it
hands the job to a **sub-agent** — and steps out of the way.

**Dispatch, not relay.** The sub-agent answers the worker
directly. Its answer never goes back through the delegator, and the
delegator never re-words it. `receive()` returns a *dispatch*
(`{ agent, prompt, context, ... }`), never an answer. William's
reason (2026-11-04): a relay puts the delegator in every response
path — a bottleneck, and a single point of failure. With dispatch,
once the handoff is made the master is not in the way.

**Single writer.** Only the delegator holds the digest, and only
the delegator refreshes it (through the ontology module's own
`applyChange`, when the state's revision has moved). Sub-agents get
a deep-frozen copy of their slice: they read, and a write throws.
One keeper means one page everyone reads from — no fleet of
per-user agents holding diverging partial views and spending their
effort reconciling them.

**The sub-agents** (small pure functions over the digest, no model
calls — the same input always gives the same answer):

- `locator` — where is X; what is in place Y.
- `status` — what state X is in; what is open; what needs eyes.
- `planner` — what this worker should do next, from their open
  tasks and their prep notes. It suggests; it assigns nothing.
- `recorder` — takes a *tell* (a statement, not a question) and
  returns a record entry `{ from, text, at }` in the speaker's own
  words. The **caller** persists it through the existing store
  paths. The central agent itself saves nothing and changes no
  state, anywhere.

**What is implemented and test-proven** (`test/central-agent-test.js`).
Three seed workers — Marcus Reed, Tommy Nguyen, Priya Shah — send
a scripted mix of questions and a tell through one central agent
over the seeded building. The tests prove: each input goes to the
expected sub-agent with the right facts (A-05's contents, where
the peaches are, the needs-eyes list, a task's destination, each
worker's next task); each answer is byte-identical to the
sub-agent's own output and never appears in the delegator's record
of dispatches; the delegator has no method that takes an answer
back; three different interleavings of the inputs give identical
answers, all at the same digest revision; a sub-agent that tries
to write to its context is refused and the digest is unchanged;
tells come back as record entries and change nothing; after a real
state change the delegator refreshes and the next answer reflects
it.

**What "dormant" means here, exactly.** The module starts with
`CENTRAL_AGENT_LIVE = false`, with the reason written beside it.
It is **not wired into any live surface**: no page, no existing JS
file and no Worker file loads it (a test scans the repo to prove
it). It makes no network calls and starts no timers (a test scans
its source). Why off: there is no multi-user glasses traffic to
route yet, and an always-on proactive loop would spend API credits
for no demo benefit. The architecture is real and runs in the
tests; turning it on is a deployment decision, made when there is
a real multi-user floor to serve.

## Walk the shift — the game (js/wms-game.js)

The Receiving view carries a small game, so a person opening the
WMS has something to actually do in it. A circle marked YOU is the
worker on the Receiving slice. Five tasks are dealt from the state
as it stands — check in at the dock where a shipment sits, bring
its pallet into the Receiving Bay, put that pallet away, put a
second pallet away, then spot-count the first bin. Destination
bins are scanned from the state's empty bins at deal time, and
both putaways are the console's own tasks, directed to those bins
and completed through the same WMS calls the Putaway screen uses;
the spot count is a real cycle count, queued and posted the same
way. Every step lands on the record as it happens — the map, the
tables and the audit trail move with the circle. Clicking the
glowing place works the task; every task also has its button, and
Auto-run works the whole shift hands-free at about a second a leg.

**Practice copies only.** The game can run solely on a practice
copy (?practice=1), whose state is never saved anywhere. On the
live desk record the panel says so and links to a practice copy —
the dealt tasks can never touch the real record.

## Tests

```
node test/wms-test.js        # 128 — the WMS logic end to end
node test/wms-ai-test.js     # 20  — Meta API calls, stubbed /chat
node test/wms-store-test.js  # 15  — desk-record seam, stubbed fetch
node test/wms-map-test.js    # 30  — the warehouse map, from the seed world
node test/wms-witness-test.js # 43 — the Witness page: events, transcript, empty-honest
node test/wms-agent-test.js  # 48  — the Witness page's agent: ask from the record, desk entries
node test/wms-flow-test.js   # 36  — flow-sliced task views (inbound / outbound)
node test/wms-flags-test.js  # 29  — flags on the map: urgent only, each opens its own item
node test/ontology-test.js   # 39  — the dynamic ontology: digest correctness, incremental == rebuilt, prep, no network
node test/central-agent-test.js # 52 — the central agent: dispatch not relay, three simulated workers, single writer, dormant
node test/wms-game-test.js   # 28  — Walk the shift: the dealt chain, real putaways, the posted count, undealable buildings
node test/wms-ui-smoke.js    # 37  — real browser (Playwright), stubbed Worker; skips without Playwright
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
