# Brief: Demo polish — the two Walk the Shift items

Status: READY (William's sequencing call, 2026-11-05: polish
pass before the job-assignment build — judges may try the repo
at any time). Source: the tracker demo-polish items, from
William's own gameplay recording; audited by Faye 2026-11-05
(all surfaces load; the game offers all four shift types and
starts clean; these two items are the known blemishes).

## Item 1 — after a finished shift, the next start names the wrong shift

Repro: in a practice copy, finish a shift, then pick a
different shift type and start it. The toast/record line that
flashes names the FINISHED shift — and where the failure line
fires it reads "…deal a Inbound…" (grammar).

Wanted:
- Starting a shift always names the REQUESTED shift, in the
  start line and in any toast.
- If the practice building genuinely cannot deal the requested
  shift (its tasks are spent), the message says so plainly and
  tells the player to reload the practice copy for a fresh
  building — it never names a different shift as if that were
  the one starting.
- Grammar: "an Inbound dock worker" — article agrees with the
  role label everywhere the line is built (js/wms-game.js,
  begin() and friends).

## Item 2 — entering or leaving the practice copy double-renders

Repro: open a practice copy (or end one back to the live view)
and the screen renders twice for a beat — a visible flicker of
one render replacing another.

Wanted: one clean render on entering practice, one on
leaving. Find the double pass (suspects: boot render followed
by a hash/state render, or the game panel and the console each
rendering the switch) and collapse it to a single pass —
without changing what either render shows.

## Fences

- Practice-only stays a hard rule; the game still runs only on
  the practice copy; the seed stays byte-identical and pinned.
- Frozen files stay frozen (index.html, js/voice.js,
  js/record.js, js/photo.js, css/witness.css, worker/*,
  js/glasses.js, glasses.html). The game module and the console
  UI are the work area.
- No behavior changes beyond these two items: shift dealing,
  step offers, voice completion in the game, and the shift
  summary all work as they do today.

## Acceptance

- A node test drives begin() after a finished shift for a
  different role and pins the naming + grammar of both the
  start line and the cannot-deal line.
- The double-render fix is verified in the browser smoke if
  the seam is reachable there; otherwise say how it was
  verified.
- Full node suite AND test/wms-ui-smoke.js run and reported
  (the glob does not cover the smoke file).
