# Console Build — Task Index

The console build (map dashboard + Witness page) is split into one
task per Claude thread, so no thread carries more context than its
own job. Shared law for ALL tasks lives in
`briefs/claude-brief-console-layout.md` — read it with START-HERE.md
before any task file.

| # | Task | File | Depends on |
|---|------|------|-----------|
| 1 | The Map Dashboard | briefs/console-task-1-map-dashboard.md | — |
| 2 | Witness Page: The Record (events + transcript) | briefs/console-task-2-witness-page-record.md | 1 |
| 3 | Witness Page: The Agent (top of page) | briefs/console-task-3-witness-page-agent.md | 2 |
| 4 | Flags on the Map | briefs/console-task-4-map-flags.md | 2 |
| 5 | Flow-Sliced Task Views (inbound/outbound) | briefs/console-task-5-flow-views.md | 1 |

Parallel-safe: 3 and 4 alongside each other; 5 alongside 2–4.

Task 6 — NOT briefed yet, gated on William's verdict after the build:
remove the ?look= switcher and the losing skins (Stand / Floor /
Record), folding Today into the new console. Faye writes that brief
when William calls it.
