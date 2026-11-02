# Console Task 3 — The Witness Page: The Agent

Read START-HERE.md, then the shared law in
`briefs/claude-brief-console-layout.md`, then this file.
Build ONLY this task. Depends on Task 2 (the Witness page).

## Scope

Fill the agent's chair at the TOP of the Witness page: a live Witness
AI agent the desk user can TYPE to and SPEAK to, in the open item's
context. No glasses or phone — the desk is a full Witness surface.

- Reuse the existing conversational plumbing (converse intents,
  warehouse mic, the /chat route). Scope the context to the open
  item: its events, its transcript, its current state.
- The agent answers questions about THIS item from its own record
  ("why is this flagged", "who saw the damage", "what's missing").
- Records are never frozen: what the desk user types or says to the
  agent JOINS the item's record — appended to the transcript marked
  as a desk entry, and able to mint an event (e.g. a decision, an
  update), same as a worker's words on the floor.
- The human stays visibly in charge: the agent proposes and reports;
  anything it records from the desk user is shown as that person's
  words and act.

## Do NOT build

- No permission/gating system. One docs line only: in a real
  enterprise program this agent is manager-gated. Nothing else.

## Done when

- Agent answers an item question from that item's record.
- A typed and a spoken desk update each land in the transcript as
  desk entries, and a decision stated at the desk appears as an event.
- Baseline suites green (668, zero fails); new tests in project
  style; frozen files untouched.
