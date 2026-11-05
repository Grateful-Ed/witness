# Brief — SAM 3.1 as a toggle on the photo scan

**For Claude, from Faye (Repo room), on William's word 2026-11-05 ("lets do it").**
Repo: `Grateful-Ed/witness`. Recorded as aware note 21 and in the tracker
(Receiving — the Cross-Check).

## The design (William's, verbatim in substance)

SAM 3.1 ships as a **toggle on the photo scan**. OFF (the default) is exactly
today's flow — Spark reads the photo, nothing else runs. ON adds SAM 3.1
segmentation **evidence**, in parallel, attached to the scan record. SAM
renders no verdicts, ever; the comparison still belongs to Spark over its
inputs, and the human still decides. The receipt scan is never touched: a
receipt is text, there is nothing to segment.

## The flow today (ground yourself before changing anything)

- `index.html` loads `js/photo.js`. The photo scan reads a picked test load's
  **contact sheet** (one image, four panels: FRONT / RIGHT / BACK / LEFT) by
  its public URL, through the Worker's `/chat` route with a vision message.
  `askPhoto(loadKey)` → per-side flags → `askCompare(scan, pFlags)` →
  verdicts → `buildOsd(...)` assembles the OS&D deterministically →
  `/save` with kind `"osd"` when the receiver taps Save.
- The Worker (`worker/worker.js`) forwards to `https://api.meta.ai/v1/...`
  with `Authorization: Bearer <META_API_KEY>`; `/chat` forces the Spark model.
  Routes share the origin allow-list and the failure-honesty shapes
  (400 / 413 / 502 with plain errors). Note: `/chat` already has a larger body
  cap when a message carries a data image (`hasDataImage`) — check what that
  affords before designing the label-crop step.
- SAM 3.1 is on the same Meta Model API as model `sam-3.1` over the
  **Responses API**: one call carries an `input_text` part with a short noun
  phrase (one concept per call — no lists) plus the media, and streams back a
  box and a mask per match. **The wire truth is Meta's own docs**:
  https://dev.meta.ai/docs/media-segmentation and
  https://dev.meta.ai/docs/sam/segmenting — build to those, not to memory.
  If a wire detail cannot be confirmed from the docs, say so in the PR
  description rather than inventing a shape.

## Build

1. **Worker: a `/segment` route.** Same transport pattern as `/chat` (origin
   check, key check, plain-error failures). Body: `{imageUrl, concept}`.
   Response: `{concept, matches: [{box, score?}]}` — boxes in the image's
   coordinate space, normalized 0–1000 like the rest of this codebase's
   geometry. Parse masks out of the upstream reply as needed to extract
   boxes, but **do not forward raw mask data to the page** (size); boxes are
   the evidence currency. Add the route to the router and the 404 text.
2. **Page: the toggle.** A switch in the photo-scan section of `index.html`,
   labeled plainly (e.g. "SAM 3.1 evidence"), default OFF, persisted in
   localStorage, visible state at all times. When OFF, the run is
   byte-identical to today: no `/segment` calls, no record changes.
3. **Page: when ON.** After `askPhoto` is kicked off, fire `/segment` in
   parallel for the concept set: `"cardboard box"`, `"shipping label"`,
   `"damaged cardboard box"`, `"torn plastic wrap"`. Each concept is
   independently failure-tolerant: a failed or empty concept yields no
   evidence for that concept and never blocks the scan.
   - **Side attribution:** boxes live in contact-sheet coordinates. Determine
     the sheet's panel geometry from the actual files in
     `test-data/photos/` and map each box center to its panel's side; pin the
     mapping with a test using the real sheets' dimensions. If a sheet's
     geometry doesn't read as a clean panel grid, attribute SAM evidence to
     side `"overall"` instead of guessing.
   - **Evidence into the comparison:** the SAM results join the photo side's
     inputs to `askCompare` as a clearly-labeled evidence block (counts per
     concept per side; located damage items as photo-side observations).
     Extend the compare prompt minimally and visibly: it may cite the SAM
     block as photo-scan evidence; it may not treat SAM output as a third
     scan or a verdict.
   - **Overlay:** draw the returned boxes over the displayed contact sheet
     (a positioned overlay layer; boxes labeled by concept). Display-only;
     nothing about the overlay is persisted except the boxes themselves.
   - **Label crops (stretch, gated):** if — and only if — the `/chat` vision
     path verifiably accepts the crop (the data-image cap suggests it might),
     crop each shipping-label box client-side from the sheet image and ask
     Spark to read the crops, adding the reads as photo flags. If it cannot
     be verified against the live API shape from the docs, ship boxes-only
     and say so in the PR.
4. **Record + OS&D.** When ON, the saved OS&D record gains
   `samEvidence: {on: true, concepts: {<concept>: {count, boxes}}}` (boxes
   only — no mask data). `buildOsd` gains one deterministic line when ON:
   that SAM 3.1 evidence was attached, with the carton count. When a concept
   failed or SAM was unreachable, the record and the OS&D say **SAM evidence
   was requested but unavailable** — failure honesty, never silence, never
   invented evidence. When OFF, the record is exactly today's shape.

## Files

Approved touches (William's direction covers these frozen surfaces):
`worker/worker.js`, `js/photo.js`, `index.html`, and `css/witness.css` only
if the toggle/overlay genuinely needs a rule. Everything else stays frozen —
no other file changes; tests are new or extended files under `test/`.

## Tests

- New unit tests in the house pattern for the pure pieces: side attribution
  from box centers (against the real sheets' dimensions), evidence-block
  assembly, record shape with and without SAM, OS&D line present/absent.
- Worker route tests if the existing suites give you a pattern for routes;
  otherwise say so in the PR.
- Run the full node suite (`node test/<name>-test.js` across the glob)
  **plus `node test/wms-ui-smoke.js` explicitly** — the glob does not cover
  it — and report both counts.

## Stop rules

Open the PR and stop; William merges. In the PR description, name: the
concept set as built, whether label crops shipped or were gated out and why,
any wire-format detail you could not confirm from Meta's docs, and the
suite/smoke counts.
