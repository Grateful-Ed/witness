# Brief — Full-flow voice completion on the console

**For Claude, from Faye (Repo room), on William's direction (recorded
2026-11-04; prepped 2026-11-05).**
Repo: `Grateful-Ed/witness`. Tracker: Agent & Ontology — "Full-flow voice
completion." **Sequencing: this builds on the merged desk–phone Steps 2–3
base (the state seam) — do not start from an older main.**

## The direction (William's own text, big-version-ideas §5 and §7)

> "Every task: assignable, completable by voice ("done — what's
> next?"), and visible."
> "A completion spoken aloud closes the task and pulls the next."

Today that is true in exactly two places: the kitchen on the glasses
(`js/converse.js` — a spoken "done" closes the real task and pulls the
next) and Walk the Shift (`js/wms-game.js` — voice-first, but **practice
copy only**). The console's real flows — the task queues behind
putaway, picks, replenishment, cycle counts, moves — are click-driven.
This build brings voice completion to them.

## The mechanism already proven — reuse it, don't rebuild it

`js/wms-ai.js`'s `gameTurn` pattern is the product's voice-act law:

- Spark returns a **structured envelope naming an intent**; code runs
  the intent through the real mutation path (`js/wms.js` / the engine),
  never through a parallel one.
- The spoken reply is shown **only after the act resolves**; a refused
  act discards the staged words for the honest note.
- Questions and answers mutate nothing.

Generalize that envelope from game steps to the console's real task
operations. Keep the central agent's hard rule intact: **the delegator
and its sub-agents never mutate state** — dispatch stays read-only.
Voice acts ride the work surface (below), not the Witness-page agent.

## Build

### Step 1 — voice completion on the task queues

- A **Work by voice** control on the console's task-queue surfaces,
  riding the existing mic plumbing (`js/warehouse-mic.js` → the
  Worker's `/asr`). Hold-to-talk, same as the game panel.
- The worker's **current offer** is the queue's next task for their
  role/zone (the engine's existing queue logic — one queue per role,
  per big-version-ideas §7). The surface speaks the offer the way the
  game panel does: task + destination.
- Intent vocabulary for v1: **complete current task** ("done",
  "complete"), **pull next** ("what's next"), **repeat the offer**,
  and **ask a question** (answered, mutates nothing, per the Meta AI
  standard). A completion intent must resolve to the *currently
  offered task* — if the words name a different task or are ambiguous
  about which task, the surface asks; it never guesses (the product's
  ask-don't-guess law).
- Every act executes through the same `js/wms.js` completion paths the
  clicks use, with the same engine validation. A completion the engine
  refuses (wrong state, already done, not yours) is refused out loud
  with the honest reason — the staged success words are discarded,
  exactly as the game does.
- This operates on the **live warehouse state** — that is the point of
  the build, and the difference from the game. A spoken completion is
  attributed in the task record the same way a clicked one is (who,
  when), plus that it arrived by voice. Corrections ride the console's
  existing paths (moves, counts); **no new undo system in v1** — if a
  task type has no correction path today, name it in the PR.
- Out of scope, named: **receiving posts and load/ship are
  human-signature acts** ("nothing posts on its own") — voice may
  guide a worker to them, it does not perform them. Labor proposals
  stay human-approved clicks.

### Step 2 — the remaining queues + flag by voice

- Extend the same envelope to the remaining task types: cycle counts
  (the count itself spoken and confirmed as an act), replenishment,
  and bin-to-bin moves.
- **Report a problem by voice** from the work surface: a spoken report
  becomes a flag filed the way the console's flag path files it — zone
  taken from the words per the flag-zone law (aware note 20), never
  from where the reporter stands.

## Files

Approved touches: `js/wms-ai.js` (envelope generalization),
`js/wms-game.js` only if the shared envelope genuinely requires it,
`js/wms-ui.js` (the work-surface wiring), `js/warehouse-mic.js` only if
the plumbing needs a second consumer shape, and new modules if the
envelope wants its own file. `js/wms.js` and `js/engine.js` are called,
not edited — if a completion path is missing for a task type, stop and
name it in the PR rather than editing the engine. Everything else
stays frozen, including `js/central-agent.js` and `js/ontology.js`.

## Tests

- Envelope tests in the house pattern: intent resolution against a
  seeded state (complete/pull-next/repeat/question), ambiguity →
  ask-not-act, engine refusal → honest words and zero mutation,
  attribution recorded on voice completions.
- The game's existing suite must pass unchanged — the generalization
  cannot regress Walk the Shift.
- Run the full node suite (`node test/<name>-test.js` across the glob)
  **plus `node test/wms-ui-smoke.js` explicitly** — the glob does not
  cover it — and report both counts.

## Stop rules

Open the PR and stop; William merges. In the PR description, name: the
intent vocabulary as built, any task type lacking a correction path,
anything you had to leave click-only and why, and the suite/smoke
counts.
