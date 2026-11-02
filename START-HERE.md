# START HERE — for a new Claude session on Witness

Read this first. It carries the standing context so William doesn't
have to repeat it. Then read the brief for the build you've been
given. The repo README is the project's definition of record; this
file is the working agreement.

## Who's who
- **William** (also written "Ed" in older docs — same person, E.
  William Harris IV) directs. His word in the thread is the ruling.
- **Claude builds.** All coding for these slices is yours.
- **Faye manages and reviews.** She writes the briefs, then
  independently re-runs the tests, verifies the live site, and
  reports to William. **Do not update the README's Status section —
  Faye does that after her review passes.**

## How work lands
- **Commit directly to main.** There is no PR flow for Witness.
- Builds are additive. **Frozen files — do not touch without a brief
  saying so:** index.html (beyond a single approved masthead link),
  js/voice.js, js/record.js, js/photo.js, css/witness.css,
  worker/* (except the one approved change inside the desk-phone
  brief), and the existing test-data.
- Every suite must stay green. Current counts: engine 29, converse
  68, deepen 72, glasses 84 — plus each new slice's own tests.
- If a brief seems to require breaking any of this, stop and report
  instead of improvising.

## Where things stand (2026-11-01)
- **Built and reviewed:** module one (the receiving cross-check),
  the warehouse foundation, the conversational layer, slice 2
  (deepened areas: inbound/outbound end-to-end, holds, incident
  updates, shift summary), and the glasses view (phone-as-glasses).
- **The glasses work is ON HOLD at William's word.** One known fix
  is owed when it resumes: in the glasses free-ask path, a 413
  fallback to words-only must tell the wearer the frame wasn't
  sent. Don't pick it up unless William reopens the segment.
- **Deadline: submissions due Wed Nov 4, 2026, 9:00 PM ET** (Meta
  Global AI Developer Hackathon). Demo video spine: a real grocery
  putaway run in William's kitchen (script v3, held by Faye).

## Build order (briefs in briefs/)
1. `claude-brief-desk-phone.md` — shared state in the Worker, desk
   & phone surfaces. Includes the one approved Worker change.
2. `claude-brief-bol-camera.md` — BOL camera read. Needs only
   desk-phone **Step 1** (the Worker change), not the whole slice.
3. `claude-brief-kitchen-demo.md` — kitchen world; the receipt scan
   creates the shipment and its tasks. Build after the BOL slice;
   reuse js/bol.js, never fork it.

Already built (for reference): `claude-conversational-layer.md`,
`claude-deepen-areas.md` + `deepen-areas-spec.md`,
`claude-brief-glasses-mock.md`.

## Standing product law (don't relitigate)
- Two scans per load — the human's voice and the photo — compared:
  **Agree / Flag / Can't verify** ("can't verify" is first-class).
  The machine never signs off; a human decides. Records are never
  frozen; an incident can be added to a load's record at any time.
- Scan semantics: in the warehouse, a BOL scan **summons** — the
  BOL is already in the system and its tasks already exist; the
  scan identifies and brings them up. In the kitchen demo, the
  receipt scan **creates** — there is no back office, so the scan
  is the intake. (Full note: big-version-ideas.md.)
- Flags, not fields: flag anything in a transcript that sounds like
  it belongs in a report, quoted in the speaker's own words.
- Tracker (William's, kept current by Faye):
  https://docs.google.com/spreadsheets/d/1MsNmodgNmrbtIFo0FECQ674y0dKl-4ghT8m-26iwggI/edit

## Open decision (do not decide it yourself)
- Whether /save stores the BOL/receipt **photo itself** with the
  record. Default until William rules: **do not store photos** —
  keep the read/flags only.
