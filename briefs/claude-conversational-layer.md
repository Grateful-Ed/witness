# Brief for Claude — Witness warehouse build, functional slice (fresh thread)

From William via Repo Faye, 2026-10-31. One job, one thread.
SUPERSEDES the playable-sim brief from earlier today: the sim is
parked to the end phase with the glasses layer (William's ruling:
glasses last, the cherry on top). This brief is FUNCTION, not
presentation.

## Where the project stands (read first)

Witness is now the whole warehouse, not just the receiving
cross-check. Definition of record: the repo README in
Grateful-Ed/witness — read it first; it supersedes any older
description. Module one (receiving cross-check: voice scan → flags →
photo scan → comparison → OS&D) is built, live, and FROZEN — do not
modify index.html (beyond nothing), js/voice.js, js/record.js,
js/photo.js, css/witness.css, worker/*, test-data/.

The warehouse foundation landed this morning (2026-10-31): 
warehouse.html + js/warehouse-ui.js + js/engine.js + data/world.js +
css/warehouse.css + test/engine-test.js (all checks passing). A
seeded demo building (doors 1–4, zones A/B/C × 8 bins, 6 labor units
+ manager, inbound/outbound) with an engine that generates tasks
(putaway / consolidate / breakdown / pick / receive), assigns them
per labor unit, and completes them with quantities reconciled.
State persists client-side (localStorage 'witness-warehouse-v1').
Read those files before writing anything — build ON the engine,
never around it.

## Your slice: the conversational layer (areas 7–8)

William's example dialogues are the spec (his words, from the
design session — full text in big-version-ideas.md in Faye's
workspace; ask William for it if you don't have it):

- WORKER (by voice, hands-free): "Hey Muse, what's up next? I just
  got done with my task." → the current task is marked completed and
  the system tells him his next task.
- MANAGER (typed or voice): "What's a bottleneck that's supposed to
  be coming up here soon, and how can I move around labor to help
  fix it?" → an answer computed from the building's live state, in
  plain words: the zone, the numbers, the proposed move.

Concretely:

1. Worker voice: a hold-to-talk button in the worker view using the
   project's existing transcription route (POST /asr on the witness
   Worker — study how js/voice.js shapes that call: 16 kHz mono WAV,
   multipart) but implemented in the warehouse UI's own code (do not
   edit module one's files). Intent handling is LOCAL and
   deterministic: done/finished → complete current + pull next;
   "what's next" → read the current/next task aloud in text (on
   screen); problem/report → attach a note to the current task and
   log a record. Show the transcript; never act on a transcript the
   user can't see. Buttons keep working for everything voice does.
2. Manager ask: a question box in the manager view. The building's
   live state is summarized compactly (zone stats, bottleneck()
   output, labor assignments, open orders/inbound) and sent with the
   question through the existing Worker POST /chat route (Muse
   Spark). The system prompt must bind the model to the supplied
   state: answer only from these numbers, propose moves, never
   decide, never invent counts. Render the answer in the panel.
   Token care: ask for a modest max_tokens (this model's reasoning
   bills against the cap; a comparison once starved at 3,000 — 6,000
   is a sane ask here) and handle an empty reply with one retry,
   then an honest error.
3. Tests: extend test/engine-test.js style — node tests for the
   intent matcher (done / what's-next / problem / unknown → no
   action) and for the state-summary builder (contains the real
   zone numbers from a seeded state). Network calls are NOT tested
   live; stub at the fetch boundary if you test the UI glue.
4. Push in the established pattern (per-file Contents API commits;
   helper scripts live in ~/workspace/witness/, e.g.
   push-warehouse.py / push-flags-save.py — mirror their auth).
   Verify each file serves on GitHub Pages before reporting done.

## Constraints

- Additive only: new code in the warehouse files; engine changes
  must keep every existing engine test green — run them and say so.
- Nothing merges or publishes beyond this slice's own files without
  William's review; every pass gets his approval.
- Plain dock language in the UI. Short lines. Numbers always shown
  with any AI answer — the manager sees the evidence, not just the
  conclusion.
- Deliver: the working slice on the live page + test results + a
  short note of choices you made where this brief was silent.
