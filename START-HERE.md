# START HERE — for a new Claude session on Witness

Read this first. It carries the standing context so William doesn't
have to repeat it. Then read the brief for the build you've been
given. The repo README is the project's definition of record; this
file is the working agreement.

## Who's who
- **William** (also written "Ed" in older docs — same person, E.
  William Harris IV) directs. His word in the thread is the ruling.
- **Claude builds.** All coding for these slices is yours.
- **Faye manages and reviews.** She writes the briefs, then
  independently re-runs the tests, verifies the live site, and
  reports to William. **Do not update the README's Status section —
  Faye does that after her review passes.**

## How work lands
- **Builds land as pull requests** (the flow since PR #1; PRs
  #1–#44 are all merged). Open the PR as a draft, report the suite
  counts, and stop: **merging waits for William's explicit word on
  that PR** — Faye reviews first, William merges on his call.
- Builds are additive. **Frozen files — do not touch without a brief
  saying so:** index.html (beyond a single approved masthead link),
  js/voice.js, js/record.js, js/photo.js, css/witness.css,
  worker/* (except the one approved change inside the desk-phone
  brief), and the existing test-data.
- Every suite must stay green. Current counts (2026-11-06): 1,776
  node checks + 61 browser smoke, all passing. Run `test/*-test.js`
  AND `test/wms-ui-smoke.js` — the glob does NOT cover the smoke
  file; run it explicitly (NODE_PATH=~/workspace/.pwtest/node_modules).
- If a brief seems to require breaking any of this, stop and report
  instead of improvising.

## Where things stand (2026-11-06)
- **Submitted** to the Meta Global AI Developer Hackathon on
  Nov 4, 2026 — and the project continues past it (William: "It's
  my second baby"). PRs #1–#44 are merged; nothing is open.
- **Built and reviewed since Nov 1:** the WMS desk console, the
  central agent (dispatch architecture), the dynamic ontology —
  including self-extension (it learns new WMS features; a human
  settles them) — the shared record across desk, phone, and
  glasses (one warehouse, one /state document), full-flow voice
  under the confirmation law, and job-based assignment (jobs dealt
  by department pool; see Standing product law).
- **The glasses are live**, not on hold. One fix remains owed in
  the glasses free-ask path: a 413 fallback to words-only must
  tell the wearer the frame wasn't sent.
- **Photo scan:** healed in production (PR #46, 2026-11-06) —
  askPhoto sends the sheet as a data URL; never send it by
  public URL (the model service refuses hosted URLs).
- **Demo video:** being rebuilt from Faye's script v2
  (~/workspace/witness/claude-demo-video/) — the cross-check is
  module one in it, not the headline.

## Build order (briefs in briefs/) — all built; kept for reference
1. `claude-brief-desk-phone.md` — shared state in the Worker, desk
   & phone surfaces. Built (PR #37).
2. `claude-brief-bol-camera.md` — BOL camera read. Built and live.
3. `claude-brief-kitchen-demo.md` — kitchen world; the receipt scan
   creates the shipment and its tasks. Built and live.

Already built (for reference): `claude-conversational-layer.md`,
`claude-deepen-areas.md` + `deepen-areas-spec.md`,
`claude-brief-glasses-mock.md`.

## Standing product law (don't relitigate)
- Two scans per load — the human's voice and the photo — compared:
  **Agree / Flag / Can't verify** ("can't verify" is first-class).
  The machine never signs off; a human decides. Records are never
  frozen; an incident can be added to a load's record at any time.
- Third-party by design (standing): Witness is a layer that
  sits on the customer's OWN WMS (Manhattan / SAP / Blue
  Yonder class); the WMS in this repo is host zero — the
  proving stand-in, not the product's home. Anything built
  for the real application reads and validates against the
  ontology digest's shapes (the surface an adapter supplies),
  never against this WMS's internals alone.
- Completion confirmation (2026-11-05): a spoken completion only
  STAGES the close — the system reads it back and asks; only the
  worker's next-turn yes runs it, recorded with the exact words
  heard. Voice can confirm; **voice can never sign.** The only
  signed acts: a human posting a receiving, a human confirming a
  load.
- Assignment (2026-11-05): work is assigned as JOBS (one shipment's
  or order's full flow), dealt from the worker's department pool.
  Once assigned, a job's tasks go to no one else unless a manager
  reassigns (a manager may cross departments; the record marks
  it). "What's next" is a question, never a pull.
- Interpretation (ratified 2026-11-05): the AI receives and
  interprets the worker's words; the code is the double checker;
  a settled ontology definition overrides any code-side reading;
  a genuine ambiguity goes back to the worker as a clarification,
  and the answer is learned. Facts land only by human
  confirmation or deterministic derivation — assignment itself is
  code: the jobs exist before anyone checks in.
- Scan semantics: in the warehouse, a BOL scan **summons** — the
  BOL is already in the system and its tasks already exist; the
  scan identifies and brings them up. In the kitchen demo, the
  receipt scan **creates** — there is no back office, so the scan
  is the intake. (Full note: big-version-ideas.md.)
- Flags, not fields: flag anything in a transcript that sounds like
  it belongs in a report, quoted in the speaker's own words.
- Bin presentation (William, 2026-11-01): a bin is shown only when
  it has a reason to be there (source, destination, hold, problem).
  A destination bin reads plainly "Stage: Bin #". An availability
  question gets the status and nothing else.
- Tracker (William's, kept current by Faye):
  https://docs.google.com/spreadsheets/d/1MsNmodgNmrbtIFo0FECQ674y0dKl-4ghT8m-26iwggI/edit

## Open decision (do not decide it yourself)
- Whether /save stores the BOL/receipt **photo itself** with the
  record. Default until William rules: **do not store photos** —
  keep the read/flags only.
