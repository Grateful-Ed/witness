# Brief for Claude — Witness slice 3: the BOL camera read (fresh thread)

From William via Repo Faye, 2026-10-31. One job, one thread.
Division of labor: Claude hardcodes; Faye manages and reviews
(tests re-run independently, live verification, frozen-file check)
before William's pass. Build to be reviewed.

## Start state

Read first: the repo README (definition of record), then
big-version-ideas.md §2 (the BOL recognition note), then
briefs/claude-brief-conversational-layer.md for the /asr and /chat
call shapes already proven in this app. This slice starts from the
tree AFTER the deepen-areas slice (briefs/claude-deepen-areas.md)
lands — say so and wait if it hasn't.

## William's ask, in his words (2026-10-31)

A camera integration in the app: point the phone at a mock bill of
lading and the AI reads it. CORRECTED 2026-11-01 (William): nothing
needs to be printed — printing is not important to the demo. The
fixture is a clean digital BOL page/image; the read must work from a
camera capture or an image of that page, whether it happens to be
shown on paper or on a screen. This is module one's "identity comes
from a scan" law made literal, and the third leg of the cross-check:
what was EXPECTED (the BOL), what the worker SAYS (voice scan), what
the camera SEES (photo scan).

## The job

1. **BOL fixture (test-data/):** a clean digital mock BOL page for
   Test Load 001 matching the project's existing mock BOL
   (artifact witness-test-load-mock-bol-pallet; carrier Blue Ridge
   Freight Lines; 20 pieces claimed; 624 lb; line items include the
   cleaner and the aerosol lines). Black on white, real BOL layout,
   legible as a full-page image. It may be printed if William ever
   wants paper, but printing is optional and NOT part of the demo.
2. **A new page, bol.html (+ js/bol.js, own CSS or warehouse.css):**
   - "Read the bill of lading": capture from the phone camera
     (file input with capture, plus a plain file pick fallback).
     Show the captured image before sending — never send a photo
     the user hasn't seen.
   - Downscale/re-encode the capture in the browser, send it
     through the existing Worker POST /chat as image content with
     a read-this-BOL prompt. Ask for structured JSON back: carrier,
     BOL number, shipper, consignee, pieces claimed, total weight,
     line items (description, pieces, weight, any UN numbers /
     hazmat marks as printed).
   - Token care per the house lesson: max_tokens 6000, one retry on
     an empty or unparseable reply, then an honest error.
   - Render "What the BOL says" from the parsed JSON — the paper's
     claims in plain lines, exactly as read, with anything the
     model couldn't read shown as "not read", never guessed.
3. **The match:** compare the BOL's claims against the picked test
   load's known state (Test Load 001: 20 pieces claimed vs 18
   present — cleaner and aerosol each short one). Show the
   agreements and the shortages as plain findings. This is a
   comparison against the load's fixture data, labeled as such.
4. **Save:** the BOL read can be saved alongside the load's record
   through the existing POST /save (additive fields only — a `bol`
   object on the scan entry; kind stays "scan").
   CORRECTED 2026-10-31 (Faye): the original "Worker change expected
   zero" was wrong — /save rebuilds each record from named fields, so
   a `bol` object would have been silently dropped, and /chat's
   60,000-char body cap strangles camera images. Both fixes now land
   in briefs/claude-brief-desk-phone.md, Step 1 (William approved,
   2026-10-31). **This slice depends on that brief's Step 1 being
   built and deployed first.** Keep js/bol.js free of page code, so
   the read logic can move into the phone surface unchanged.
5. **Entry point:** ONE masthead link on index.html ("Read the BOL
   →"), the same one-line pattern as the warehouse link. That is
   the only permitted touch to a frozen file, and only in that
   form. Everything else frozen stays frozen: js/voice.js,
   js/record.js, js/photo.js, css/witness.css, test-data's existing
   files.
6. **Tests:** node tests for the pure logic — BOL JSON parsing
   (clean, messy, missing fields → "not read") and the match
   (claims vs fixture state: agree / short / over). The network
   read is stubbed at the fetch boundary. All existing suites stay
   green.

## Deliver
Working slice on the live page, the fixture's URL, test
results, and the choices list where this brief was silent. Faye's
review will include a REAL read: she renders the BOL page to an
image and sends it through the live Worker — the fields must come
back right.
