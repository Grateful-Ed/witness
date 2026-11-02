# Brief — The kitchen world: the demo's home-scale warehouse

Written by Faye, 2026-11-01; REVISED same day to William's corrected
scan model (below). Build in a fresh Claude session, AFTER the BOL
camera slice (briefs/claude-brief-bol-camera.md) has landed:
"In the repo Grateful-Ed/witness, read briefs/claude-brief-kitchen-demo.md and build it."

## The scan model — William's ruling, 2026-11-01 (read this first)

A scan means different things in the two worlds, and the difference
is the point:

- **Warehouse:** the BOL is already in the system (sent ahead via
  email/EDI) and its tasks were already created from it. Scanning the
  BOL through the glasses is an **identification / confirmation**:
  "this is BOL ABC" — and the glasses bring up the tasks that belong
  to BOL ABC. The scan creates nothing; it summons the work.
- **Kitchen (the demo):** there is no back office. William buys real
  groceries and scans the real paper receipt, and **the scan is the
  intake**: the receipt is read, its items become the shipment, and
  the tasks are created from the scan, live. Legit end to end —
  nothing is pre-loaded.

This brief builds the KITCHEN side. The warehouse summon behavior is
the same interaction with lookup standing in for creation; do not
change any warehouse behavior in this slice.

## Why

William's demo-video ruling (2026-11-01): no warehouse to film in, so
the video's spine is a real run at home — groceries on the counter,
storage labeled like bins (Cabinet A, Cabinet B, Fridge, Pantry),
the receipt scanned through the glasses, tasks created from it, and
the putaway run worked by voice through the glasses view.

## What you build

### 1. A kitchen seed world — `data/kitchen-world.js` (NEW)
Same shape as `data/world.js`, home scale:
- One staging door: the **Counter** (groceries land there).
- One zone, **Kitchen**, whose bins are the storage spots:
  **Cabinet A, Cabinet B, Pantry, Fridge, Freezer**.
- Labor: **William** as the worker (the wearer picks himself on the
  glasses start screen).
- **NO inbound shipment.** The world starts with an empty counter.
  The shipment exists only after a receipt scan creates it (§3).
- A **destination rules table** — the demo logic William asked for
  (2026-11-01): when the scan sees a product, its TYPE decides the
  spot, and the putaway task is created for that spot. Exact item
  rules win first (milk → Fridge, ice cream → Freezer), then
  product-type rules:
  - frozen anything (frozen meals, frozen vegetables, ice cream)
    → **Freezer**
  - refrigerated / dairy / deli / eggs / fresh meat → **Fridge**
  - fresh produce → **Fridge** (fruit that lives out, like bananas,
    can be an exact-item exception)
  - dry goods (pasta, rice, cereal, cans, jars) → **Pantry**
  - bread / bakery / snacks / coffee → **Cabinet A**
  - household / cleaning / paper goods → **Cabinet B**
  This is master data, like a warehouse's fixed-bin table. Ship it
  with sensible common groceries; Faye extends it with William's
  real items during demo prep.

### 2. One engine behavior: fixed home locations
Putaway target selection prefers an item's `home` bin when that bin
is free and not held; otherwise it falls back to the existing
emptiest-bin rule, unchanged. (A real WMS concept — fixed /
dedicated storage — not a demo hack; note that in your report.)
Tests: home respected when free; home held or occupied → fallback;
items without a home behave exactly as today; engine suite stays
green.

### 3. Receipt intake in kitchen mode (the heart of the slice)
In the glasses view under `?world=kitchen`, **before any shipment
exists, a capture is a receipt read**:
- Send the frame through `/chat` with the BOL slice's structured-read
  pattern (reuse `js/bol.js`'s read + parse — do not fork it):
  extract the line items (name + quantity).
- For each item, assign its spot automatically: exact item rule
  first, product-type rule second, and for an item neither covers,
  META classifies it from its name and picks the spot. The scan does
  the whole job on its own — **no manual entry and no separate
  confirmation gate** (William, 2026-11-01): the read populates the
  items, assigns the spots, and creates the work in one flow.
- In that same flow: create the "Grocery run" shipment at the
  Counter from exactly those items, receive it, and let the
  existing task generation produce one putaway task per item, each
  targeting its assigned spot per §2. The META area shows what was
  created (item → spot, task by task).
- A wrong spot is corrected by voice after the fact ("coffee goes
  in Cabinet B"): the item's task retargets and the correction is
  logged on the record. The human can override anything — he just
  isn't made to approve everything first.
- From here the run is the ordinary queue: the wearer works it by
  voice through the glasses, exactly like the warehouse flow.
- After a shipment exists, captures in kitchen mode are the ordinary
  photo scan (flags), as in the warehouse world.
- Honest failures: an unreadable receipt says so and creates nothing;
  a partial read lists what it could not read as "not read" — never
  guessed, never silently dropped.

### 4. World selection — `?world=kitchen`
- `warehouse.html`, `glasses.html`, and `bol.html` accept
  `?world=kitchen` and seed from the kitchen world. Default is the
  warehouse, unchanged.
- The dispatch lives in one small place. Switching worlds reseeds
  the state, and the page says so in plain words — no silent wipe.
- The kitchen world works through the same state seam as the
  warehouse world, so it survives the desk-phone server-state move
  whenever that lands.

## Frozen
- Module-one files: untouched. `data/world.js`: untouched.
- Warehouse behavior: untouched — including task generation for
  warehouse shipments (no homes → today's behavior, byte for byte).
- Engine changes limited to the home-bin preference and the seed
  dispatch. `js/bol.js` is reused, not forked.

## Tests
- New kitchen tests: the receipt read → items + spots by rule
  (milk → Fridge, a frozen meal → Freezer, pasta → Pantry, cleaning
  spray → Cabinet B; unknown item classified); the scan creates the
  shipment and one putaway task per item automatically, each
  targeting its assigned spot; a voice correction retargets a task;
  unreadable receipt creates nothing.
- All existing suites green: engine 29 (+ new), converse 68, deepen
  72, glasses 84, plus the BOL slice's tests.

## Stop and report instead of improvising if
- `js/bol.js`'s read can't be reused for a receipt without forking
  its prompt/parse core.
- World selection seems to require touching a frozen file.

## What Faye checks in review
Seed and dispatch diff; intake flow read end to end; home-bin and
kitchen tests run by her; all suites green; kitchen world live on
Pages under ?world=kitchen; a sample receipt read exercised through
the live Worker; the warehouse world verified unchanged.
