# Brief — Desk & phone surfaces: shared state, the thin phone, and one Worker change

Written by Faye, 2026-10-31. Build in a fresh Claude session:
"In the repo Grateful-Ed/witness, read briefs/claude-brief-desk-phone.md and build it."

## Why

William's surface architecture (adopted 2026-10-31): **the desk is the record,
the phone is the capture, the glasses are the glance.** Today the warehouse
state lives in each browser's localStorage, so the phone and the desk hold
different worlds. This brief moves the state into the Worker so both surfaces
share one truth, and adds the thin phone surface William specced: camera,
push-to-talk, AI answers, and only the information the user needs to see —
the same minimal philosophy as the settled glasses HUD.

William approved ONE Worker change for this brief (2026-10-31, relayed and
confirmed in the Repo chat). The worker/* freeze is lifted for exactly the
items in Step 1 and nothing else.

Technical review by Claude (PC session, from main 7b009be) is baked into this
brief — the seam constraints, the last-save-wins fix, and the two gaps in the
BOL brief (the /save field whitelist and the /chat body cap) all come from it.

## Sequencing — three steps, each leaves the live app working

1. **The Worker change** (deploys alone; every existing page keeps working).
2. **The state move** (warehouse-ui seam goes network; behaviour otherwise
   identical, now shared across devices).
3. **The phone surface** (new page; nothing existing is modified to add it).

Do not start a step until the previous one is committed.

## Step 1 — the Worker change (worker/worker.js ONLY)

Additive only. No existing route changes behaviour except where stated.

### 1a. GET /state and POST /state

- The whole warehouse state is ONE JSON document, stored in the SCANS KV
  binding under the reserved key `__warehouse_state__`.
- `GET /state` → 200 with the stored document verbatim. If none exists yet:
  404 `{ ok: false, error: "no state yet" }` (the client seeds on this).
- `POST /state` with a JSON body → stores it verbatim, answers
  `{ ok: true }`. Validation is deliberately light: the body must parse as a
  JSON **object** (not an array, not a scalar) or 400. Body cap 500,000
  chars, 413 beyond it.
- `GET /samples` must EXCLUDE keys beginning with `__` (the state document
  is not a scan and must never appear in the scan listing).
- Auth posture matches /save by design for the hackathon window: origin
  allow-list only, no key. The state is synthetic test data.

### 1b. POST /save learns two optional fields

The save handler rebuilds each record from named fields — extend the
whitelist, do not switch to pass-through:

- `bol`: if `body.bol` is a plain object (not an array), store it on the
  record as `bol`. (The BOL slice depends on this.)
- `kind`: accept `"photo"` alongside `"scan"` and `"osd"`
  (`kind: body.kind === 'osd' ? 'osd' : body.kind === 'photo' ? 'photo' : 'scan'`).

Nothing else about /save changes: same key format, same defaults.

### 1c. Raise the /chat body cap for image payloads

Today: `MAX_CHAT_BODY_CHARS = 60000`, 413 over it — a base64 camera photo
caps at ~45 KB, which strangles live camera reads. Change the check, not
the spirit:

- If any message contains an image part (`image_url` whose URL starts with
  `data:`), the cap for that request is **1,500,000 chars**.
- Otherwise the cap stays **60,000**.
- Everything else about /chat is untouched: model forcing, the 16,000
  token ceiling, error shapes.

## Step 2 — the state move (client side)

Current seam (per Claude's read of main): all state flows through
`loadState` / `saveState` / `resetState`, called only from warehouse-ui.js —
but they are **synchronous**, and startup currently **saves on every page
open**. Both facts change here:

- Put the async network versions of the three functions in a new shared
  module, `js/state.js`, used by warehouse-ui.js (and by phone.js in
  Step 3). If the functions physically live in engine.js today, relocating
  the storage functions into js/state.js is a permitted mechanical move —
  **zero logic change**. The engine's pure functions (generateTasks,
  nextTaskFor, completeTask, reportProblem, zoneStats, bottleneck) must not
  change behaviour; engine tests stay 29/29.
- Startup becomes async: load from `GET /state` before first render of the
  world (a brief plain loading line is fine). On 404, seed the world from
  data/world.js and POST it as the initial state. On network failure, say so
  plainly on the page; do NOT silently fall back to a local seed and let the
  user act on a phantom world.
- **Never save on page open.** Loading is read-only.
- **Fetch fresh before every mutating action, then save.** Complete-task,
  problem reports, holds, moves — every mutation re-GETs /state, applies the
  engine function to the fresh state, then POSTs the result. Rendering
  between actions may use the in-memory copy.
- `resetState` POSTs the seed world (the reset button keeps its meaning).
- localStorage stops being a store of truth. Remove its authority entirely;
  do not keep a silent mirror.
- Accepted scope, stated so nobody "fixes" it later: last-save-wins remains.
  Fetch-fresh shrinks the collision window to near zero for a demo; there
  is deliberately **no versioning or conflict machinery** in this brief.

## Step 3 — the phone surface (phone.html + js/phone.js + css/phone.css)

New files only. The phone loads `js/engine.js`, `js/converse.js`, and
`js/state.js` **unchanged** — the surface is thin, the brain is shared.
It does NOT load warehouse-ui.js.

- **Who am I:** pick a labor unit from the state (the worker list). One tap,
  remembered in the page session only.
- **Glance header (HUD rules, settled 2026-10-31):** the current task as a
  chip — Task # and Bin # — and nothing else persistent. Keep the whole page
  bare and compact: no dashboard, no panels of records. The full record
  lives on the desk.
- **Hold-to-talk:** wired to the existing converse intents, unchanged —
  "done" completes and pulls the next task, "what's next" reads it, problem
  words pin the worker's exact words to the task and close nothing. Actions
  run against server state via the Step 2 seam (fetch fresh → engine →
  save). The transcript shows clipped, the reply shows clipped — the
  phone's job is the moment, not the archive.
- **Manager ask:** include the Ask-the-building box (typed or spoken),
  reusing the existing converse ask flow unchanged — role decides what you
  see, per the role-tier ruling; the panel's numbers and "A proposal, not a
  decision" framing carry over as-is.
- **Camera:** capture → downscale (longest side ≤ 1600px, JPEG ~0.8) →
  send as a `data:` image_url through /chat with the photo-scan prompt
  pattern from js/photo.js (flags, quoted evidence, per-side where the
  photo allows) → flags render on the phone → **Save** POSTs to /save with
  `kind: "photo"`, the flags, and the load label. The capture itself shows
  bare on the phone as its own confirmation (HUD rule). The phone does NOT
  run the comparison or produce verdicts — verdicts and the OS&D report
  stay on the desk (module one), per "the machine never signs off."

## Open question — do NOT build this without William's nod

Persisting the photo itself in /save (an optional base64 `photo` field on
the record). Default in this brief is **photo NOT stored** — flags are
saved, the image is not. It is a one-line whitelist addition if William
wants the evidence kept; flag it in your report, don't decide it.

## Tests

- New `test/state-test.js` (node): /state round-trip against a stubbed KV;
  /samples excludes `__` keys; /save with a `bol` object round-trips it;
  /save `kind: "photo"` survives; /chat cap — a 60,001-char text body is
  413, a 200,000-char body containing a `data:` image part is NOT 413
  (stub the upstream fetch).
- New client test (stub the fetch boundary, per the step2 stub-test
  pattern): startup performs no POST; a mutation performs GET then POST in
  that order; a 404 seeds and POSTs once.
- Existing suites stay green: `test/engine-test.js` 29/29,
  `test/converse-test.js` 68/68.
- Include a KV-lag probe (script or documented manual steps): POST /state,
  then poll GET until the new value is visible; report the delay in
  milliseconds. The phone→desk demo beat depends on this number; Faye will
  re-measure it live in review.

## Freeze discipline

- worker/worker.js: Step 1 items ONLY.
- Frozen, byte-identical when you're done: index.html, js/voice.js,
  js/record.js, js/photo.js, css/witness.css, existing test-data.
- js/engine.js / js/converse.js: unchanged (mechanical relocation of the
  storage functions out of engine.js, if that's where they live, is the one
  permitted touch — logic identical, tests green).
- warehouse.html / js/warehouse-ui.js / css/warehouse.css: Step 2 seam
  changes only; no visual or behaviour changes.
- Stop and report instead of improvising if: a pure engine function's
  behaviour seems to need changing; the /state shape seems to need anything
  beyond the single document; or a second existing-route behaviour change
  looks necessary.

## What Faye checks in review

Diff scope against the freeze list; every test above re-run by her; live
curl contracts for /state, the `bol` save, and the image cap against the
deployed Worker; the KV lag measured live; warehouse.html verified working
against server state in two separate browsers (two worlds must now be one);
phone.html verified live on Pages.
