# Brief — Ontology self-extension: detect, describe, settle

**For Claude, from Faye (Repo room), on William's design (recorded
2026-11-04, `big-version-ideas.md`); prepped 2026-11-05.**
Repo: `Grateful-Ed/witness`. Tracker: Agent & Ontology — "Ontology
self-extension." **Sequencing: last in the current queue — this builds
on the merged desk–phone state seam and the merged full-flow voice
work. Do not start from an older main.**

## The design (William's, from the notebook — build this, not a variant)

The ontology adapts on its own when the warehouse's system grows a new
feature or record shape, instead of waiting for a human to map it in:

- **Detection is deterministic:** the digest watches the state's
  SCHEMA, not just its values — a new state section, task type, record
  kind, or field shape it has no concept for gets flagged as unknown.
- **Description is the AI's job:** Spark reads samples of the new
  records and writes the concept — what it is, what it seems to
  connect to — attributed as **AI-inferred**.
- **Status ladder, honesty-gated:** detected (seen, not understood) →
  described (the AI's best reading, labeled) → settled (confirmed by
  use or a human). If it can't infer a meaning it says so. Additions
  are announced in the digest, never silent.
- Once described, the concept is first-class: the delegator's dispatch
  context includes it (labeled with its status), workers can ask and
  tell about it, prep can watch it.

## The architecture constraint that shapes everything

`js/ontology.js` is **pure by law**: derived data only, no writes, no
network — a source-scan test enforces it, and `learnTerm` is the
precedent for how learned things enter state (a pure function returns
the new state; the *caller* applies it; this module is the single
writer of the shape). The describe step needs a Spark call, so it
cannot live in ontology.js. Build the split:

- **In `js/ontology.js` (pure):**
  - A **known-schema registry**: the state sections, task types,
    record kinds, and per-kind field sets the digest builders have
    concepts for today.
  - `detectUnknowns(state)` → a list of unknowns, each
    `{kind: 'section'|'task-type'|'record-kind'|'field', key, samples}`
    (samples = a few real records, carried for the describe step).
  - `learnConcept(state, concept)` beside `learnTerm`: pure, returns
    new state; concepts live in `state.concepts` (created lazily, the
    vocabulary pattern), shaped
    `{key, name, summary, connectsTo: [], status:
    'detected'|'described'|'settled', source: 'ai-inferred',
    firstSeen, describedAt?, settledBy?}`.
  - The digest gains a `concepts` list (plain, like the vocabulary
    list) carrying each concept's status, and — mirroring the
    vocabulary-growth exception — the `applyChange` that first sees a
    concept described emits **one transient prep note** announcing it.
    A fresh rebuild never re-announces.
- **Outside it (the describe orchestration):** the caller that already
  refreshes the digest (the delegator's path) checks `detectUnknowns`
  on refresh; for each unknown with no concept yet, it records the
  concept as **detected** (through `learnConcept`, applied via the
  existing store paths), then asks Spark — through the console's
  existing AI plumbing (`js/wms-ai.js`), with the samples — to write
  the description. A grounded reply moves the concept to **described**
  with the AI's summary and connections. An ungrounded or failed reply
  leaves it **detected** with an honest note ("meaning not yet
  inferable from the samples") — never a fabricated description.
- **Settle (human act):** the Ontology page lists concepts with their
  ladder status; a human can **settle** a described concept (confirm,
  or edit the summary then confirm), which writes `status: 'settled'`
  and `settledBy` through the same caller-applies path. Nothing
  auto-settles in v1.

## Files

Approved touches: `js/ontology.js`, `js/wms-ai.js` (the describe
call), the delegator's refresh path (`js/central-agent.js` — dispatch
context inclusion only; its no-mutation law stands: it *receives*
concepts in the digest, it does not write them), and the Ontology
page's rendering module for the concepts list + settle control.
Everything else stays frozen. The Worker is untouched.

## Tests

- Detector tests: a seeded state carrying a novel section, a novel
  task type, and a novel field on a known kind each surface exactly
  one unknown; the shipped seed produces **zero** unknowns (no false
  detections against the registry — pin the registry to the real seed).
- Ladder tests: detected → described (stubbed AI reply) → settled
  (human act); ungrounded reply leaves detected + the honest note;
  announcement fires exactly once and not on rebuild.
- The ontology source-scan test still passes — no network, no writes
  crept into the module.
- Run the full node suite (`node test/<name>-test.js` across the glob)
  **plus `node test/wms-ui-smoke.js` explicitly** — the glob does not
  cover it — and report both counts.

## Stop rules

Open the PR and stop; William merges. In the PR description, name:
the registry's coverage as built, where the describe orchestration
lives and why, any design point you had to interpret, and the
suite/smoke counts.
