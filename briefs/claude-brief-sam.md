# Brief — SAM 3.1: the measuring witness (Segment 5 build)

Read `START-HERE.md` first, then `briefs/claude-brief-bol-camera.md` for the
Worker-route pattern this follows. William's order, 2026-11-02: SAM 3.1 goes
into the build for real — not named in the demo, USED in the product.

## The job SAM does in Witness

Three models, three jobs, no overlap:

- **Muse Voice Transcribe** hears the receiver (already built, /asr).
- **SAM 3.1** MEASURES the photo. It segments every case it can find and
  returns bounding boxes. It does not interpret, describe, or judge — it
  counts and outlines. A ruler, not a reader.
- **Muse Spark** reads and compares (already built, /chat): the spoken
  claim vs the photo read vs SAM's count. Disagreement is a finding.
- The human decides. The machine never signs. (Unchanged law.)

Concretely: during the Step 2 photo scan, after a photo is submitted, the
app ALSO runs SAM on it with the concept "cardboard box". SAM's case count
for that side becomes a third voice in the comparison:

- SAM count == spoken count and Spark's read agrees → supports Agree.
- SAM count != spoken count → a **Flag** verdict line that quotes all
  three numbers in plain words, e.g. "Count: the receiver said 26 cases.
  SAM 3.1 segmented 24 on the FRONT photo. Spark's read also found the
  stack short on the left column." (Wording follows the existing verdict
  style; the SAM number is cited as SAM's, never blended into Spark's.)
- The OS&D report gains one witness line per scanned side:
  "SAM 3.1 count (FRONT): 24 cases segmented (confidence 0.52–0.87)."
- The scan view draws SAM's boxes as outlines over the photo (toggleable,
  default ON for the main photo) — the demo visual: the pallet photo with
  every case outlined and counted by a model that only measures.

## Verified API facts (Faye probed live, 2026-11-02 — build to these)

- Model id: `sam-3.1`. It is NOT on `/v1/chat/completions` (the API 404s
  and says so). It lives on **`POST https://api.meta.ai/v1/responses`**.
- Request shape that WORKS (verified against the real Load B photo):
  ```json
  {
    "model": "sam-3.1",
    "metadata": { "include_confidence": "true" },
    "input": [{
      "role": "user",
      "content": [
        { "type": "input_image", "image_url": "data:image/webp;base64,..." },
        { "type": "input_text", "text": "cardboard box" }
      ]
    }]
  }
  ```
  The text is a **bare noun phrase** (the concept to segment). A full
  sentence prompt returns an empty output_text — do not sentence-prompt it.
- Response: `output[].content[]` items of type `output_text`; the text is
  one line per frame: `<0f>` then comma-separated records, each record =
  object id + one box token + one mask token:
  `<|box;x1=914;y1=1096;x2=1002;y2=1174;w=1600;h=1600;c=0.801|><|mask;x=0;y=0;c=0.801;data=...|>`
  Coordinates are PIXELS in the image's own frame (w/h ride in the token).
  `c` is present because we asked via metadata; parsers must accept its
  absence too (protocol rule).
- Probe receipt: Load B contact sheet, concept "cardboard box" →
  **101 box records**, confidences 0.52–0.87, ~5 s, response text ~289 KB
  (the masks are the bulk — see next point).
- **Masks: parse past them, never store or forward them.** The Worker
  extracts box records only and returns small JSON. Mask data must not
  land in KV, in /samples output, or in the page.
- Billed per image. One SAM call per submitted photo, no retries beyond
  the existing photo-flow retry pattern, and a failed SAM call NEVER
  blocks the scan: the comparison proceeds with two voices and the OS&D
  line reads "SAM 3.1 count: unavailable for this side." Honest absence,
  never a fabricated number.

## Build scope

1. **Worker** (approved change under this order; follow the /state and
   /save discipline): new route `POST /segment`.
   - Input: `{ "imageUrl": "<public photo URL>" }` (the same URL the
     photo flow already uses) OR `{ "image": "<data URI>" }`; concept
     optional, default `"cardboard box"`, server-side allowlist of
     concepts: `cardboard box`, `case`, `pallet`, `can`, `drum`, `bag`.
   - The Worker fetches the image (URL form), base64s it, calls
     /v1/responses as above with the Worker's own META_API_KEY, parses
     box records, and returns:
     `{ "concept": "...", "count": N, "boxes": [{"x1":..,"y1":..,"x2":..,"y2":..,"w":..,"h":..,"c":..|null}], "imageW": w, "imageH": h }`
   - Errors: honest JSON errors (502 with a plain message) — no stack
     traces, no key material, nothing about other routes.
   - Origin allowlist: same as the existing routes. /segment results are
     NOT saved by the Worker; the page includes the SAM summary in the
     scan record it posts to /save (extend the existing whitelist with
     one field, `sam`, holding per-side `{concept, count, boxes}` —
     boxes are small; masks never enter).
2. **New file `js/sam.js`**: the wire parser as a pure function
   (`parseSamBoxes(outputText)` → array of box objects; tolerant of
   missing `c`, extra fields, mask tokens, multiple frames) plus a
   `samCountLine(side, result)` formatter for the report wording. Pure,
   no DOM, no fetch — unit-testable like js/summon.js.
3. **Minimal hooks in the photo flow** (the ONLY frozen-file touches this
   order approves — keep them additive and small): after a photo's Spark
   read completes, call /segment for that photo; store the result on the
   scan in progress; pass SAM's count into the comparison prompt context
   as a clearly-labeled third voice; render the witness line in the
   report; draw the box outlines over the main photo (an SVG overlay
   scaled from the boxes' own w/h frame to the displayed size).
   Comparison prompt addition is CONTEXT ONLY: Spark is told SAM's
   number as data ("SAM 3.1 segmented N cases on this side") and the
   existing verdict rules stand — Spark may cite it, never invent it,
   and a SAM number never appears unless /segment actually returned one.
4. **Tests** — new `test/sam-test.js`, in the established style:
   parser cases (multiple records, missing confidence, mask-heavy lines,
   empty text, malformed tokens, two frames), the count-line formatter,
   and a Worker-shape test using a stubbed fetch returning a recorded
   wire-format sample (synthetic, hand-written, small — do NOT commit a
   real 289 KB response). All existing suites stay green: baseline is
   **668 checks, zero fails** (engine 34, kitchen 74, converse 68,
   deepen 77, glasses 89, state 28, bol 79, summon 57, wms 127,
   wms-store 15, wms-ai 20).
5. **README**: do NOT touch it in the build PR. Faye updates the models
   paragraph herself after review passes (standing flow).

## Out of scope

- No video segmentation. No glasses tie-in (Segment 3 is parked).
- No concept-prompt UI — the concept is a scan setting with the
  allowlist above; free-text concepts are a later question.
- No changes to verdict KINDS (Agree / Flag / Can't verify) — SAM feeds
  the existing comparison; it does not get its own verdict type.
- Nothing about Ship Safe, TMS, or the other Workers.

## Acceptance (Faye will verify exactly this)

- All suites green incl. the new sam suite; frozen files other than the
  two named hooks byte-identical.
- Live /segment against the real Load B photo returns count 101 ± a few
  (model variance) with sane boxes, and the response JSON contains no
  mask data.
- A full Step 2 scan of Load B saves a record whose `sam` field carries
  per-side counts, whose OS&D report shows the SAM witness lines, and
  whose comparison cites SAM only where a count actually disagrees or
  agrees — with the number SAM really returned.
- Kill-the-key test: with META_API_KEY absent, /segment errors honestly
  and the scan still completes on two voices.
