# Brief: Job-based assignment (+ the game splits onto its own data)

Status: DRAFT for William's review (Repo chat, 2026-11-05). Source
rulings: aware notes 27 (the job model) and 28 (the game's own
data), both William, 2026-11-05. Build AFTER PR #40 (voice),
which only reads assignment state.

## Why

On the live queues, work is not pulled task-by-task from a shared
pool — that was the game's model, and PR #40's review removed it
from voice. In the real process the WMS assigns work: JOBS to
users, by department. This build makes the live data run on that
model, and it first moves the game onto its own data so the two
models never share a dataset again.

## Step 1 — Walk the Shift gets its own data

- The game runs on its OWN seed/world: its own shipments, orders,
  tasks, and crew, sized for the game (four shift types: inbound
  dock worker, outbound loader, replenishment, cycle counter).
- Opening the game switches to the game world entirely. The game
  never reads, copies, or derives from the live warehouse data,
  and nothing in the game can touch the shared /state record.
- Inside its own world the game keeps its pull mechanics exactly
  as they are — pulling is the game's mechanic, on the game's
  data. The game's voice completion (gameTurn) is unchanged.
- Practice-only stays a hard rule.

## Step 2 — Jobs on the live data

Vocabulary: a JOB is the full task flow of one shipment or order
(receive → putaway; pick → pack → load). TASKS are the steps
inside a job. Assignment happens at the job level.

- Each labor unit works a department/process (the areas already
  in the building: inbound, putaway, replenishment, picking,
  pack & ship, cycle count). A unit's department is visible on
  the console, next to who they are.
- The engine assigns each unassigned job to one user in the
  job's department. Assignment is the SYSTEM's act — it happens
  on its own (when a job appears, and when a user frees up), not
  by a worker asking, and never by voice.
- EXCLUSIVITY: while a job is assigned, none of its tasks are
  offered, listed as available, or assignable to anyone else —
  on any surface. The worker's task list shows their job's tasks
  in order; "what's next" (PR #40) reads exactly this.
- AUTO-ASSIGN: when a user finishes a job (its last open task
  closes), the engine immediately assigns them the next job from
  their department's pool. No gap state where a working user has
  nothing and must ask.
- POOLS: each department holds a visible pool of unassigned
  jobs. The console shows pools and who holds what job — the
  bird's-eye map gains job ownership (a job's tasks carry their
  owner's mark; the map still explains nothing, the job's page
  shows the owner).
- MANAGER REASSIGN: the only way an assigned job changes hands
  is a manager's deliberate act on the desk console — in the
  labor-proposal pattern: a named human moves job X from user A
  to user B, and the record shows who moved it, when, and from
  whom. Voice can never reassign. A mid-job reassign moves the
  job's remaining tasks; completed tasks stay with their doer.
- Seed: the shipped seed world is rebuilt on this model — every
  seeded shipment/order is a job; some start assigned (spread
  across departments and crew), the rest sit in pools. The two
  standing seed flags (FLG-001/002) and the Zone B bottleneck
  (9 pending / 2 workers, proposal naming Jay Patel C → B) must
  still hold in the new shape — the labor proposal reads JOB
  load, not bare task counts.

## Fences

- js/converse.js (glasses/phone conversation) is NOT in this
  build — its pull question is open with William separately.
  The kitchen world is untouched.
- Voice (PR #40) needs no changes: it reads assigned lists
  (queuedFor today). If the job engine changes the shape of an
  assignment, wms-voice's reads must keep working — flag any
  shape change in the PR instead of silently adapting voice.
- Receiving posts and load/ship confirmations stay human-signed.
  Flags, the confirmation law, and the record rules are
  unchanged.
- The shared /state document and its save path are unchanged;
  the game world is NOT part of it.

## Acceptance

- Tests: assignment by department (a picking job never lands on
  an inbound-only unit); exclusivity (an assigned job's tasks
  are unreachable for others, incl. via nextFor-style reads);
  auto-assign on job completion (the finisher holds the next
  pool job immediately, deterministically); pools drain in a
  stated order (say which: oldest job first); manager reassign
  (moves remaining tasks, record attributes the move, completed
  tasks keep their doer); the seed bottleneck invariant still
  fires; the game runs start-to-finish on its own data with the
  live state byte-identical before and after a game session.
- Full node suite AND test/wms-ui-smoke.js run and reported
  (the glob does not cover the smoke file).
- Live reseed after merge follows the standing recipe (backup
  first, verify counts after) — Faye runs it, not the build.
