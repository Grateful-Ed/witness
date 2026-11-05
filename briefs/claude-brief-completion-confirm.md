# Brief — Completion takes a confirmation

**For Claude, from Faye (Repo room), on William's word 2026-11-05.**
Repo: `Grateful-Ed/witness`. William's design, in his words: a user
might accidentally say done and not mean it — "The AI should say
'would you like to mark task complete' and then another 'yes' or
whatever to confirm. Just like a 'are you sure you want to delete'
type thing."

**Sequencing: small and self-contained — it lands ahead of the
glasses shared-state build (no file overlap) and sets the act law the
full-flow voice build will inherit.**

## Today

`js/converse.js` closes the task in hand in a single turn: the DONE
word set matches (done / finished / finish / complete / completed /
all set / wrapped up / got it put away, behind the NOT_DONE negation
guard), the engine validates, `E.completeTask` runs, `out.acted` is
set, and the callers save. The glasses and the phone both speak
through this one layer, so one change covers every real surface.

## Build — stage, ask, confirm

1. **A completion word no longer closes anything by itself.** When
   the 'done' intent matches and a task is in hand, the turn *stages*
   the completion and asks, mutating nothing (`out.acted` stays
   false, so no caller saves):
   - Lines: `Mark "<task title>" complete? Say yes to close it, or no to leave it open.`
   - Spoken (the glasses' minimum form): `Mark it complete?`
   - The blocked-task case keeps today's answer exactly (a task the
     engine already refuses never reaches the question).
2. **The stage lives in converse.js's session memory**, keyed by the
   unit, holding the staged task's id. It is never written into the
   saved state — a page reload forgets it, and the record only ever
   shows confirmed completions.
3. **The next turn decides.** While a stage is pending for the unit:
   - A **confirm** word (yes / yeah / yep / confirm / do it / that's
     right / go ahead) runs the close exactly as today's done-branch
     does — same engine validation, same refusal lines if the counts
     no longer balance or the task is no longer the one in hand (in
     which case the stage clears and the answer says so honestly).
   - A **deny** word (no / nope / wait / cancel / not yet / never
     mind) clears the stage and closes nothing: `Left open: "<task title>".`
   - A **problem** report files the problem as today and clears the
     stage (a problem already completed nothing; the staged close
     dies with the topic change).
   - **Anything else** — a question, "what's next", a fresh
     completion word, a start — clears the stage and is then
     processed as its own turn normally, with one added line noting
     the staged completion was left open. A staged act never lingers
     past the next turn.
   - With **no stage pending**, yes/no words mean what they mean
     today (unknown intent; nothing acts).
4. **Only completions are gated.** "What's next", starts, problem
   reports, and questions act as they do today — the confirm is for
   the one act that closes work and moves the record, nothing else.

## Files

`js/converse.js` and its tests. Nothing else: no caller changes
(glasses.js, phone.js stay as they are — the stage rides converse's
own memory), no engine changes, no Worker changes. Everything else
stays frozen. Out of scope, named: Walk the Shift's game completions
(practice copy, a different envelope) — untouched.

## Tests

Extend the converse suites in the house pattern:
- Done word → question asked, **zero mutation** (task still open,
  state unchanged, `acted` false).
- Yes after the question → the task closes, next pulls, exactly the
  post-close shape today.
- No after the question → nothing closes; the following turn behaves
  as if no stage ever existed.
- A question or a problem as the next turn → stage cleared (problem
  still filed), no close.
- Confirm with no stage pending → nothing acts.
- The staged task closed elsewhere first (state moved) → honest
  refusal, stage cleared.
- The existing converse suite passes — in particular the negation
  guard ("not done" still stages nothing) and problem-beats-done.
- Run the full node suite (`node test/<name>-test.js` across the glob)
  **plus `node test/wms-ui-smoke.js` explicitly** — the glob does not
  cover it — and report both counts.

## Stop rules

Open the PR and stop; William merges. In the PR description, name:
the confirm/deny word sets as built, where the stage lives, and the
suite/smoke counts.
