# Brief — The Witness desk application (v1 shell)

Status: BUILT — by Faye on William's direct word (he chose the
Faye-built route, 2026-11-06). PR #51, awaiting his review.
Two build-time corrections to this brief, recorded here so the
record stays honest: (1) the site name shows in the header on
the application's own pages only — the header must add no
network traffic to the record page, whose request discipline
is pinned exactly (a plain open is one GET and no writes; the
kitchen world touches nothing); (2) a DETECTED concept lists
as awaiting description with NO settle button — the ontology
ladder refuses to settle an undescribed concept, so the
button would only ever refuse.

## Why this exists (William, 2026-11-06)

"Witness is not a WMS" (standing framing) — so Witness needs its
own desk surface. William: the client config will live in the
Witness application; the application connects to the client's
WMS; "this is essentially where Witness lives." Today the
ontology's settle queue lives inside the dummy console and the
adapter is selected in code — both are Witness concerns sitting
in demo equipment. This build gives the layer its home. Thin
shell first: real screens over structures that already exist.

Settled with William before this brief: (1) the existing record
page (warehouse.html) folds into the app as one of its screens;
(2) the app lands BEFORE the mirror brief — the mirror then has
a home to land in; (3) the app carries a setting for the
client's API key, entered hidden the way other apps hide it;
(4) the key setting is the HOST key only — the model service
keeps the current API connection (the existing Worker setup)
for now (William, 2026-11-06: "we use the current API
connection we have set up. So host now"). No model-key field
in this build.

## What to build

### New files

- `app.html` — the application shell: a header (the app's name
  for the site, from the client config) and a tab bar with four
  screens — **Home, Connection, Ontology, Site** — plus
  **Record**, which is warehouse.html under the same navigation
  (see below).
- `js/witness-app.js` — the app's logic. Keep the testable
  pieces pure and node-requireable in the house pattern
  (masking, config application, tile assembly).
- `css/witness-app.css` — the app's own styles. `css/witness.css`
  is FROZEN and must not be edited; the app may LINK it read-only
  for shared tokens and carry its own sheet on top. DESIGN
  (William, 2026-11-06): for now the app MIMICS what the dummy
  WMS console looks like — its navy/neutral chrome, layout
  grammar, and component feel. A visual identity of Witness's
  own is a later call, not this build's.

### The record folds in (warehouse.html — NOT frozen)

Add the app's navigation header to `warehouse.html` — the same
header and tabs as app.html, with Record as the current tab —
and the app's Record tab links to it. One navigation, two pages,
the launchpad pattern. The header is a small shared component
rendered by `js/witness-app.js`, loaded by both pages;
warehouse.html's diff is confined to the header's mount point
plus that one script tag — nothing else on the page moves,
and warehouse-ui.js is untouched.

### Screens

**Home** — status at a glance, all read from the existing
shared state and the ontology digest; no new mechanics:
- the connection summary (the current adapter's host label,
  transport, and how many verbs it declares);
- the building at a glance (open tasks, tasks in hand,
  shipments on the board, open flags — from the digest);
- needs-a-human tiles: concepts awaiting a settle (count,
  linking to the Ontology screen) and acts sitting SENT
  (count, from state.sentActs).
Empty states are honest sentences, never fake zeroes dressed
as data.

**Connection** — the adapter profile and the key:
- The current adapter's profile, displayed: id, host label,
  transport, and the declared verbs by name (read via
  adapter.js's `current()`).
- **The host API key setting** (William's requirement): a
  password-type field. On save, the key is stored through
  `js/state.js`'s mutate into the client config (below), and
  from then on the screen shows only a mask — bullets plus the
  last four characters — and when it was saved. Actions:
  Replace (enter a new key) and Remove. The saved value is
  NEVER rendered back into the page, never written into any
  record text, and never appears in the digest (pinned by
  test). One honest line under the field, in the UI: in this
  demonstration build the key is kept with the app's
  configuration; a production deployment keeps it in the
  client's own server-side secret store. (That line is
  disclosure, not decoration — keep it.)

**Ontology** — the settle queue comes home:
- Concepts from state.concepts grouped by status: described
  and detected awaiting a human, settled below. Each DESCRIBED
  concept shows its name, its (editable) summary, and a Settle
  action; a detected one shows plainly that a description
  comes first (see the status note above).
- Settle calls the SAME writer the console's ontology page
  uses (`js/ontology.js`'s concept-settle writer) through
  state.mutate — one writer, one behavior, two doors; the
  console page keeps working unchanged.
- Vocabulary: the learned-terms count and the terms
  themselves, read-only.

**Site** — the client configuration's home:
- Site name: a text field stored in the client config; the
  app header (both pages) shows it on load, falling back to
  "Witness" when unset.
- The operating knobs of note 39 live on this screen as they
  are built; v1 carries the screen with the site name and one
  honest line saying the site's operating choices land here —
  NO fake toggles, nothing decorative that pretends to work.

### State

- `state.clientConfig` — `{ siteName?: string, hostKey?:
  { value, lastFour, savedAt } }`. Register `clientConfig` in
  `js/ontology.js`'s KNOWN_SCHEMA in this build (the #44/#50
  pattern). The digest must not include it (pin by test).
- The app reads and writes the SAME shared state as every
  other surface via js/state.js — no fork, no local copy.

## Scope fences

- NO frozen file is touched: index.html, js/voice.js,
  js/record.js, js/photo.js, css/witness.css, worker/*,
  js/glasses.js, glasses.html.
- warehouse.html: the navigation header only.
- The dummy console (wms.html, js/wms-ui.js) is untouched —
  its ontology page keeps working as-is.
- No mirror work, no new adapter, no Worker change, no
  change to the gate. The key is stored, masked, and
  removable; CONSUMING it (the adapter or the Worker using a
  client-supplied key) is a named follow-on, not this build.

## Acceptance

- New test/app-test.js: clientConfig registered (no detector
  complaint on a state carrying it); the digest contains no
  key material; the mask shows only the last four; save /
  replace / remove round-trip at the config level; the site
  name applies and falls back.
- The full existing suite passes with NO changed
  expectations (baseline: 2,016 node checks). Smoke
  (test/wms-ui-smoke.js, run explicitly) — the app page adds
  its own smoke checks if the harness reaches it; any smoke
  count change is declared, never silent.
- Changed expectations, if any, are listed in the PR report
  before merge; the expectation is none.
- The PR states which files were touched; warehouse.html's
  diff is the header mount point + one script tag only.

## For the PR report

Suite counts (node and smoke reported SEPARATELY), the
changed-expectations list (expected: none), and any choice
the brief left open, flagged as a choice.
