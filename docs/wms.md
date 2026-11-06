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

- Twelve doors, for real (data/world.js; expanded from eight on
  2026-11-04 at William's word — "I know 4 limits it"): `Inbound
  Door 1–6` (`direction: 'in'`) and `Outbound Door 1–6`
  (`direction: 'out'`).
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

A filed flag's zone is where the reporter says the problem is, not
where the reporter stands (2026-11-05). `api.flag` reads the words
first: if they name places of this building (bin ids like B-03,
pallet ids like STG-5 → that pallet's door, door names like Inbound
Door 5, zone names like Zone B) and all of them sit in one zone, that
zone wins. The places come from the live state, exact tokens only
(case aside); no fuzzy match, no model call. Words naming no place,
or places in two zones, fall back to the task in hand's zone, then
the reporter's own. The flag's fields and the verbatim words are
unchanged; the flag still pins to the task in hand.

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
from), the building's learned vocabulary (see *The building's
slang*, below), and a prep queue. It is derived data only —
`buildDigest` reads state and returns a plain JSON object; nothing
is written back. `applyChange(state, previousDigest)` is the
incremental path: it re-derives the digest and keeps the prep queue
in first-seen order; its content equals a fresh rebuild of the same
state (a test proves this across real mutations), with one
disclosed exception: the call that first sees the vocabulary grow
also appends a one-time announcement note (below), which a rebuild
does not carry.

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
  state, anywhere. A tell in one of the tight quoted teaching
  forms ("'<term>' means …", "… that's called '<term>'") is a
  *teaching*: its record carries `{ kind: 'teach', term, means,
  from, text, at }`, and the caller teaches the ontology (below).

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
it. The same suite now also proves the slang loop at this layer:
the vocabulary rides in ask context, the ask-don't-guess and
topicality rules ride in ask prompts, and the recorder classifies
the quoted teaching forms while leaving ordinary "means" tells
alone. The live surface's side — dispatch out, verbatim answer
back, fallback, teaching persisted — is proven with stubbed calls
in `test/wms-agent-test.js`, and the ontology's side in
`test/ontology-test.js`.

**Live on the Witness page (William's call, 2026-11-04).** The
module's flag reads `CENTRAL_AGENT_LIVE = true`, with the reasoning
written beside it, and exactly one file loads the module —
`js/wms-agent.js`, the agent in the Witness page's chair (a test
scans the repo to prove the importer list is exactly that one).
The wiring, in that surface:

- **Asks.** The surface calls `receive()` first. The call to Muse
  Spark then carries the dispatch's composed prompt (the sub-agent
  named, the standing rules below) with this surface's own record
  law appended unedited, and a user message holding the context
  the delegator assembled plus the item's full record. The model's
  answer is displayed **verbatim** — the delegator never sees it
  and nothing re-words it; dispatch, not relay, on the live wire
  too. The surface's existing number/quote check still runs over
  the answer and is appended as an annotation beneath it — an
  annotation, not a rewrite.
- **Tells.** The tell is dispatched to the recorder, and the
  record the recorder returns is what the surface persists through
  its existing desk-entry path, unchanged in shape. A teaching
  record also teaches the vocabulary (next section).
- **Fallback.** If the delegator is unavailable, returns no
  dispatch, or the routed call fails, the surface spends its
  second attempt on the direct call it made before this was wired
  — two attempts in total, the same honest errors. The page is
  never worse than it was with the agent dormant.

The module itself still makes no network calls and starts no
timers (a test scans its source): on the live surface the caller
makes the one model call, with the fetch it already had. What
remains a deployment question is scope, not wiring: today the one
live surface is the desk's Witness page; the glasses remain
endpoints whose routing can be pointed at the same delegator when
there is a real multi-user floor to serve.

**The standing rules in every ask prompt** (William, 2026-11-04).
The delegator's prompt builder appends them to every ask dispatch,
and the dispatch context for an ask carries the building's current
vocabulary:

- The vocabulary is in the context — words the workers use, with
  the meanings they taught. **If the user uses a word you don't
  know and it isn't in the vocabulary or the record, ask them what
  it means — never guess a meaning. If they teach you a word, use
  it.**
- Topicality is the answerer's own judgment: a request that isn't
  related to the warehouse or its work is declined in the
  answerer's own voice ("Sorry, this request isn't related to
  warehouse process."). There is no code-side topic screen,
  anywhere — the model decides, per request.

## The building's slang — the ontology learns words (Brief C)

Warehouse workers talk in their own way, and a system built around
the worker learns the worker's language instead of making the
worker learn its. Definitions live in warehouse state as
`state.vocabulary = { term: { means, about?, taughtBy, at } }` —
created lazily by the first lesson (the seed carries no vocabulary
key, so the seeded world's shape never moves) and written by
exactly one writer: `learnTerm(state, { term, means, about, from,
at })` in js/ontology.js, a pure function that returns a new state.

The loop:

1. Somebody tells the agent a word, in a quoted teaching form:
   *"'sweating' means condensation wet on the bottom bags"* — or
   *"When condensation wets the bottom bags, that's called
   'sweating'."* The recorder classifies the tell as a teaching
   (the term must be quoted, so an ordinary tell that merely
   contains the word "means" is never misread).
2. The caller persists the tell as a record, as always — and also
   applies `learnTerm`, attributing the definition to who taught
   it. The worker's answer is a tell and is what gets saved; the
   question that prompted it is not.
3. The digest gains the word in its `vocabulary` section
   (`{ term, means, taughtBy }`), the delegator's next `applyChange`
   emits one prep note announcing it — *"New word in the building's
   vocabulary: 'sweating' — taught by Rosa Flores"* — and every
   later ask dispatch carries the vocabulary in its context.
4. And when the AI meets a word it doesn't know — in nobody's
   vocabulary and nowhere in the record — it **asks the worker**
   rather than assuming (the prompt rule above). A guessed
   definition would poison every later dispatch; an asked one
   becomes the next lesson.

## Walk the shift — the game (js/wms-game.js)

The Warehouse Map carries a small game, so a person opening the
WMS has something to actually do in it. A circle marked YOU is the
worker on the map itself — the whole building, not a slice — and
it travels the real cells (inbound dock → Receiving Bay → bay
location) as the shift is worked.

The panel offers a **Shift type** (William, 2026-11-04), and each
role deals its own chain from the state as it stands, out of the
engine's real tasks only — nothing is invented to fill a chain:

- **Inbound dock worker** (the original shift): check in at the
  dock where a shipment sits, bring its pallet into the Receiving
  Bay, put that pallet away, put a second pallet away, then
  spot-count the first bin. Destination bins are scanned from the
  state's empty bins at deal time, and both putaways are the
  console's own tasks, directed to those bins.
- **Outbound loader**: pick an allocated order's lines (up to
  two), pack it at its door, load it, then verify-count the picked
  bins. The pack and load tasks are dealt by the system itself
  once the order is fully picked; the game resolves them then.
- **Replenishment**: pick the line that takes a pick face below
  its minimum — the console's refresh then deals the real
  replenishment task from reserve stock — work that task, and
  count the face and the reserve. The live seed holds no reserve
  anywhere, so this role deals only on a dressed practice copy
  (below); where its trigger is missing it deals nothing.
- **Cycle counter**: spot-count the building's four fullest bins,
  each through the same arm-and-confirm flow.

Switching shift type mid-shift sets the dealt chain aside — the
tasks it already finished stay on the record, because they were
real work — deals a fresh chain for the new role, and says so in
the panel. Every step of every role is completed through the same
WMS calls the console's own screens use, and lands on the record
as it happens — the map, the tables and the audit trail move with
the circle.

**The loop is the job loop** (William, 2026-11-04). The game
mimics how a warehouse worker using this program actually works:
the program offers one task at a time — the panel says "Next
task: …" with the work and its destination — and the next task is
offered automatically when the current one is confirmed; the
worker never hunts for what to do next. Confirmation is by voice
first, the way the real flow is confirmed: the panel's hold-to-talk
button rides the console's own mic (js/warehouse-mic.js → the
Worker's /asr) — and then the worker is **talking to META**. The
transcript goes, with the live shift context (the active role's
chain, the current offer verbatim, every task still to come, and
where the worker stands), through the console's /chat to Muse
Spark (js/wms-ai.js's `gameTurn`). She answers in her own voice
and, when the words work the shift, names the action as an intent
— complete, confirm, start, auto — which the game runs through
the very same paths the buttons use. Her words are shown as the
response only after the act has really resolved; a refused or
failed act discards them for the honest note, so she never gets
to claim work that did not happen. Questions are answered from
the context ("what tasks do I need to do" lists the current task
and what remains), problem reports are acknowledged and never
completed, and whether a request belongs to warehouse work at
all is META's own judgment, made in her prompt per request — no
code anywhere filters topics. If the /chat call fails, a pure
keyword matcher hears the words instead: it takes "complete" /
"done" and their wider natural family ("complete task", "mark it
complete", "task done", "finish it"…) for the current task,
"confirm" for the armed count, "start the shift" and "auto run"
— an utterance must BE the command, so ordinary speech about the
work never fires a step. Either way, a voice action can only ever
work the task currently offered. What was heard is quoted in the
panel with what it did, and META's line beneath it. There is no
speech synthesis on the console — her answers are text, like
every other console answer. Clicking the glowing place on the
map, or the task's button, does the same step — the fallback for
hands that can't talk — and Auto-run works the whole shift
hands-free at about a second a leg. There is no score and there
are no points; the finish is a shift summary. (The game's first
build sat on the Receiving slice, with click-first instructions;
William played it and moved it here. Its second build heard only
the keyword matcher; William played that too — "Complete task."
was not a command it knew, and there was no AI in the loop at
all — and ordered the conversation above.)

**Practice copies only.** The game can run solely on a practice
copy (?practice=1), whose state is never saved anywhere. On the
live desk record the panel says so and links to a practice copy —
the dealt tasks can never touch the real record. A practice copy
is also **dressed** (js/wms.js `dressPractice`, applied by the
store only when it seeds a practice state): the seed's building
reads bare — most bins hold a single line, six hold nothing — so
the practice building is stocked fuller, the way a worked-in
building looks: extra lines in fourteen bins, four bins (A-07,
B-06, C-03, C-06) deliberately left empty for directed work, and
reserve stock for the pick faces so the replenishment loop can
fire. The seed itself — the desk record's world — is never
dressed. The practice
banner itself now carries the way out it was missing: an "End
practice copy" button that returns to the same view of the live
record (js/wms-ui.js).

## The gate — one act path for the agent doors (js/gate.js)

Console voice (js/wms-voice.js), converse (js/converse.js — the
glasses and the phone) and the game's voice (js/wms-game.js) no
longer carry their own copies of the permission laws. Every act they
take goes through `gate.act(state, { who, via, intent, target,
params, confirmed })`, which runs six checks in order: the act exists
and its params cross-check (a disagreement returns a clarification;
an act that is not model-formed returns "AI is currently down."); the
signature class (posting a receiving, confirming a load — refused
with the desk guidance, again at run time); the confirmation law (an
unconfirmed act is only staged — the door keeps the stage); ownership;
the run through the engine's public paths; and one attribution writer
(who, via, the words heard). The rules live in one `POLICY` object.

Converse (the converse model step, 2026-11-06): converse's reader is
now the model. `js/wms-ai.js` `converseTurn` reads every glasses /
phone / warehouse-page worker turn first (the intent set done /
problem / start / next / confirm / deny / unknown, plus the start
words); `converse.js` `matchIntent` is the cross-check, and
`readWorker` adjudicates: agreement (or a code-unknown the model
reads) proceeds; a stark disagreement is one clarification, weighed
with the first words on the answer and never asked twice; no model
reading is "AI is currently down." and a pending stage dies unrun.
The kitchen's spoken correction gets the same step
(`kitchen.js` `readCorrection` + `settleCorrection`; `parseCorrection`
is the cross-check, the run and the kitchen's spots the validator).
The gate's declared exceptions are closed: `modelFormed.converse` and
`signatureEnforced.converse` are true, and pull is gone — no
`POLICY.pull`, no pull intent. An ask for work with nothing assigned
answers "Nothing is assigned to you right now."; a close inside the
worker's own created job moves to that job's next task (the take
path). The glasses.js change is onSpeech only (William's enumerated
exception).
Desk clicks — including the game panel's buttons — route through the
gate in the follow-on build.

## The host adapter — the write seam under the gate (js/adapter.js)

Witness is not a WMS: it sits on the customer's own WMS (the host),
and its acts go through the host's own published interfaces, never
its database (note 38). `js/adapter.js` is that seam. The gate keeps
the laws; an adapter only carries already-signed acts.

**The contract.** An adapter has a `profile` — `id`, `hostLabel`
(the host's name in plain words), `transport` (`'sync'` | `'async'`),
`keyed`, and `verbs` (which of `complete`, `flag`, `post-receiving`,
`confirm-load` it takes) — plus `submit(state, act)` and, on an async
transport, `confirm(state, key, verdict)`. `act` is plain data:
`{ key, via, who, intent, target, params, words }`.

**What the gate does with it** (the WMS world — the console voice
door — only; the engine and game worlds are the demo building's own
and stay built-in):
- Check 1 reads the current adapter's declared verbs. An undeclared
  verb is refused before anything is staged or sent, naming the host:
  "The host system (simulated) doesn't take that from Witness — it has
  to be done there directly. Nothing was done." (capability honesty).
- Check 5 submits through the adapter instead of calling the engine.
  The gate stays synchronous.
  - **Sync** (the dummy, the default on every surface): the act lands
    now. Live behavior is unchanged — no new state, no key (the dummy
    is in-process; its landing is the record's transaction).
  - **Async**: the act is **SENT**. It is recorded in `state.sentActs`
    (`{ key, via, who, intent, target, params, words, ts, status:
    'sent' }`), keyed `door-counter` from `state.adapterSeq`. The task
    stays open and in hand; the worker hears "Sent — waiting on the
    host to confirm …", never "landed". A new act on the same task
    while it is SENT is refused ("already sent"); a retry of the same
    act object reuses its key.
- The host's verdict arrives through `adapter.confirm(state, key,
  verdict)`: `'landed'` runs the act's effect once through the one
  land path (`W.complete` / `W.flag`) and the gate's check-6 writer
  attributes it (`gate.settle`); `{ status: 'refused', reason }` marks
  the entry refused with the host's reason and leaves the task open. A
  verdict for an unknown or already-settled key is ignored.
- `sentActs` and `adapterSeq` (and the entry fields) are registered in
  the ontology's `KNOWN_SCHEMA`.

**The simulated host** (`A.simulatedHost()`) is a test double, labeled
"the host system (simulated)": async, its own shadow record (`ledger`),
an inbox worked by `beat()` / `deliver(state)`, drops duplicates by
key, refuses acts on a task it holds (`hold(taskId)`) with a
`HOST-409` reason, and does not declare `flag`. It is not wired to any
page; only `test/adapter-test.js` runs it. No listener or poller for
live verdicts exists yet — that is the real host's build. The read side
(the ontology mirror) is its own brief.

## Tests

```
node test/wms-test.js        # 137 — the WMS logic end to end
node test/wms-ai-test.js     # 32  — Meta API calls, stubbed /chat (incl. the game's conversation: context, the intent envelope, answers untouched)
node test/wms-store-test.js  # 17  — desk-record seam, stubbed fetch (incl. practice-only dressing)
node test/wms-map-test.js    # 30  — the warehouse map, from the seed world
node test/wms-witness-test.js # 43 — the Witness page: events, transcript, empty-honest
node test/wms-agent-test.js  # 59  — the Witness page's agent: ask dispatched through the central agent (verbatim out, fallback), desk entries, teachings learned
node test/wms-flow-test.js   # 42  — flow-sliced task views (inbound / outbound), the practice banner's exit
node test/wms-flags-test.js  # 29  — flags on the map: urgent only, each opens its own item
node test/adapter-test.js    # 58  — the host adapter: the dummy unchanged, the simulated host's SENT → landed / refused arcs, idempotency, capability honesty
node test/ontology-test.js   # 48  — the dynamic ontology: digest correctness, incremental == rebuilt, prep, vocabulary/learnTerm, no network
node test/central-agent-test.js # 61 — the central agent: dispatch not relay, three simulated workers, single writer, LIVE (the agent surface its one importer), slang in context and prompts
node test/wms-game-test.js   # 67  — Walk the shift: the dealt chains (all four shift types), the offers, the map's own cells, the voice commands, real putaways, the posted count, undealable buildings, the practice dressing, hear() with META stubbed
node test/wms-ui-smoke.js    # 38  — real browser (Playwright), stubbed Worker; skips without Playwright. Not counted in the node-suite total; run it on its own (needs Playwright + Chromium)
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
