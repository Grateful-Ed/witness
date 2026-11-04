# Claude brief — The central agent (Witness) — implemented, tested, dormant by design

Read `START-HERE.md` first. This brief depends on the ontology brief (`briefs/claude-brief-ontology.md`) being merged — the central agent works over the digest that brief creates. Frozen files stay byte-identical, same list as always.

## Why (William's architecture, 2026-11-03, and his honesty rule)

Witness's architecture is **one agent for the whole warehouse**. The glasses are endpoints, not agents. One central agent — the delegator — receives every input from every worker, classifies it, and **dispatches** it: the delegator composes the prompt and assembles all the context the job needs (from the dynamic ontology digest), then hands both to a sub-agent. **The sub-agent acts on the input and responds to the user directly.** The delegator is a context broker, not a relay: it never takes the sub-agent's answer back and never re-words it. (William's correction, 2026-11-04: a relay puts the delegator in every response path — a bottleneck and a single point of failure. Dispatch keeps the master out of the way once the handoff is made.) The delegator alone maintains the dynamic ontology: single writer, many readers. A fleet of per-user agents would hold diverging partial views and burn its effort reconciling them; one keeper deletes that problem.

William's rule for this build, verbatim in substance: **he will not describe an idea to the judges that does not exist.** So this layer is implemented for real — the dispatch, the sub-agents answering directly, the single-writer discipline — and proven by tests with simulated workers. What it does NOT do is run live: there is no multi-user glasses traffic to route yet, and an always-on proactive loop would drain API credits. It ships dormant, behind a flag that is OFF, with the reason written next to the flag.

## Build — `js/central-agent.js`

- `createCentralAgent({ state, digest })` returning an object with:
  - `receive({ from, text, kind })` — an input arrives from a named user. The delegator classifies it (question about a place / about an item / about a task / a tell for the record), chooses a sub-agent, and returns a **dispatch**: `{ agent: <sub-agent name>, prompt: <the composed instruction>, context: <the digest slice the sub-agent needs> }`. The delegator returns NO answer.
  - **Sub-agents** as small pure functions over the digest (they READ, they never write state or digest):
    - `locator` — where is X, what's in place Y
    - `status` — what state is X in, what's open, what needs eyes
    - `planner` — what should this worker do next (from open tasks + prep queue)
  - The chosen sub-agent's `respond(dispatch)` produces `{ answer, facts: [...] }`, and **that object is the user-facing response, verbatim** — delivered by the sub-agent, not routed back through the delegator. The delegator never sees the answer text.
  - **Single writer:** the delegator reads the digest to assemble context (and may request a refresh via the ontology module's own API when state has moved); sub-agents receive a read-only snapshot of their context slice (freeze it or hand them a copy — enforce, don't convention). Nothing about the response path touches the digest.
  - **Tells:** a tell (a statement, not a question) is dispatched like anything else — to a recorder sub-agent whose response carries a structured record entry `{ from, text, at }` for the CALLER to persist through the existing store paths. The central agent itself performs no persistence and no state mutation anywhere in this module.
- **The flag:** a single clearly-named constant at the top of the module, e.g. `CENTRAL_AGENT_LIVE = false;` with a comment: live routing stays off until a real multi-user deployment; the module is exercised by tests, not wired into any live surface. **Do not import this module from any page or existing JS file.** Its only consumers are its tests and the docs.
- **No network calls anywhere in the module** (same honesty rule as the ontology brief).

## Tests — `test/central-agent-test.js`

- Simulated shift: three named workers (use the seed labor names) send a scripted mix of questions through ONE central agent over the seeded warehouse + digest.
  - Each answer comes from the expected sub-agent with correct facts (a bin's contents, a task's destination, the needs-eyes list) — and is **byte-identical to that sub-agent's own output**: assert the delegator did not wrap, prefix, or otherwise transform it (the dispatch is recorded separately from the answer).
  - **Consistency under concurrency of inputs:** interleave the three workers' questions; assert every answer reflects the same digest revision — the single-page property.
  - Sub-agent isolation: a sub-agent given a question cannot mutate the digest (assert digest deep-equal before/after, or that the snapshot it received is frozen).
  - Tells pass through as record entries and mutate nothing.
  - The module source carries `CENTRAL_AGENT_LIVE = false` and contains no `fetch(` (assert by source scan).
- Existing suites all stay green.

## Docs

- One section in `docs/wms.md`: the one-agent architecture in plain words (endpoints, delegator as context broker, sub-agents answering the user directly, single writer — and why dispatch instead of relay: no bottleneck, no single point of failure in the response path), what is implemented and test-proven, and exactly what "dormant" means here — flag off, not wired to live surfaces, and why (no multi-user traffic yet; proactive delivery would cost API credits for no demo benefit). The docs must let a judge who opens the repo see the idea AND its true status without asking anyone.

## Not in this brief

- Wiring `receive()` into the glasses, warehouse, or console surfaces.
- Spark/model calls of any kind — sub-agents answer from the digest deterministically.
- Timers, polling, proactive push.

## Done means

PR against main: the module, its tests, the docs section, full suite green, PR body walking through the simulated three-worker exchange and naming which sub-agent answered what.
