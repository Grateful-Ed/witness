# Brief: Walk the Shift splits onto its own data (job build, step 1 of 2)

Status: READY (William's split call, 2026-11-05 — step 1 fires on
the remaining Claude budget; step 2, the job-assignment engine,
follows on a fresh window). Source ruling: aware note 28
(William, 2026-11-05): the game pulls from its OWN data, so the
live data can be set up for jobs vs tasks properly.

## What changes

- The game gets its OWN seed/world: its own shipments, orders,
  tasks, and crew, sized for the game — enough for all four
  shift types (inbound dock worker, outbound loader,
  replenishment, cycle counter) to deal their full shifts.
- Opening the game switches to the game world entirely. The
  game never reads, copies, or derives from the live warehouse
  data, and nothing in a game session can touch the shared
  /state record — the separation is structural (its own data),
  not just the practice rule.
- Inside its world the game keeps everything it has today:
  pull mechanics, step offers, voice completion through
  gameTurn, the shift summary, the practice banner and its
  in-place switch. Practice-only stays a hard rule.

## Fences

- The LIVE seed and live world do not change in this step —
  the live seed file stays byte-identical. The job engine
  (step 2) is what rebuilds the live data; do not start it.
- The game world is new data authored for the game. It may
  resemble the live building (same shape of work) but lives in
  its own file(s), independently editable, and no code path
  loads live data into the game or game data into the live
  record.
- Frozen files stay frozen (index.html, js/voice.js,
  js/record.js, js/photo.js, css/witness.css, worker/*,
  js/glasses.js, glasses.html). The kitchen world is untouched.

## Acceptance

- A test plays a full game session (deal a shift, work steps)
  and asserts the live state is byte-identical before and
  after; a second test starts all four shift types on the
  game data.
- The game's existing tests keep passing against the game
  world (re-point fixtures at the game data where they read
  the live seed today).
- Full node suite AND test/wms-ui-smoke.js run and reported
  (the glob does not cover the smoke file).
- Open the PR and stop. Do not merge.
