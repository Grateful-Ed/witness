# Brief — The glasses view: phone-as-glasses mock (camera + HUD + voice + controller)

Written by Faye, 2026-11-01. Build in a fresh Claude session:
"In the repo Grateful-Ed/witness, read briefs/claude-brief-glasses-mock.md and build it."

## Why

William's idea (2026-11-01): don't mock the glasses up with drawings — use
the phone camera as the glasses. The live camera view fills the screen, the
settled HUD floats over it, and everything is wired to the real engine. A
person holds the phone up to a stack of boxes and the product behaves the
way the glasses will. For the demo video this turns the glasses segment
from a rendered vision piece into a working demonstration on stand-in
hardware — labeled exactly that way.

The design of record is the settled artifact mock-up (round 2, William,
2026-10-31) and the HUD rulings in the notebook. This brief builds that
design over live video.

## What you build — ALL-NEW FILES ONLY

- `glasses.html`, `js/glasses.js`, `css/glasses.css`.
- **No edits to any existing file.** Not one line. (Links from other pages
  come in a later tidy pass; the page is reached by direct URL for now.)
  Zero edits means zero collision with the desk-phone build.
- The page loads `js/engine.js` and `js/converse.js` **unchanged**.
- A small line on the page states what it is: "Glasses view, running on a
  phone — the glasses hardware is the vision." Keep it small and plain.

## The camera

- `<video>` full-screen background: `getUserMedia` with
  `facingMode: "environment"` (the rear camera), `playsinline`, muted,
  autoplay. The wearer sees the room through it.
- If the camera is denied or unavailable, fall back to the drawn pallet
  scene from the artifact design (an inline SVG scene is fine) so the HUD
  still demonstrates. Say plainly on the page that the camera is off.

## The HUD — settled design, no relitigating

Over the video, floating text only. **No boxes, no panel backgrounds, no
borders** (William's ruling). Compact and genuinely translucent — the
wearer must be able to see through the information; size and see-through
are safety specs, not styling.

- **Top:** the current task as two chips — Task # and Bin #. Nothing else
  persistent.
- **Bottom:** the wearer's own transcript, **first 2 lines only**, no
  heading, no name tag. The full transcript lives in the app, not here.
- **META's reply:** the word "META:" plus the reply's **first 2 lines**.
  No verdict detail in the glasses — Agree / Flag / Can't verify live in
  the phone record, never here.
- **Employee information** (when a labor answer calls for it): name,
  location, and status only — e.g. "Tommy Nguyen / Zone B, near B-04 /
  available" (or "available in 5 min"). No avatar, no card.
- **Capture:** when a photo is taken it simply appears, briefly, bare —
  no label, no description. Its appearing is the confirmation.
- **Appearance rule:** elements pop up only when their topic requires
  them. An idle glasses view is the room and two chips.
- **Hide is spoken, never a control.** Saying "hide" (a converse intent,
  or the controller's hide action) fades the transcript, reply, and
  employee text out. The chips stay. Any new speech brings the text back.
  Transcripts are never expandable here.

## Voice and actions

- Hold-to-talk (on-screen hold area, and the controller — below) runs the
  existing flow unchanged: `/asr` transcription, then the converse
  intents — "done" completes the task in hand and pulls the next,
  "what's next" reads it, problem words pin the wearer's words to the
  task and close nothing, "hide" hides the text. The transcript shows
  before/with the action, as everywhere else.
- **Capture action:** grab the current video frame to a canvas, downscale
  (longest side ≤ 1600px, JPEG ~0.8), show it bare as the confirmation,
  and run the photo scan: the image through `/chat` as a `data:` image
  URL with the photo-scan prompt pattern from js/photo.js (flags, quoted
  evidence). Flags render in the META area as the reply. No verdicts, no
  comparison — that stays with module one on the desk.
- **KNOWN LIMIT, design around it:** `/chat` caps bodies at 60,000 chars
  until the desk-phone brief's Worker change raises it for images. A
  full-size capture will 413. So for the scan send, downscale harder
  (≤ 1024px, JPEG ~0.7) and if the Worker still answers 413, the page
  says so plainly ("photo too large to send — capture kept") and keeps
  the capture on screen. Never fail silently. Full-quality live scan
  unlocks when the desk-phone Step 1 lands; note that in your report.

## State — one discipline that protects the future

- Read and write warehouse state ONLY through a small adapter in
  glasses.js that wraps the existing load/save seam (the same functions
  warehouse-ui.js uses today). No direct localStorage access anywhere
  else in the file. When the desk-phone build moves state to the Worker,
  this page re-points at `js/state.js` in one place — that swap is a
  follow-up, not part of this brief, but the adapter is what makes it
  cheap. Say so in your report.

## The controller (PlayStation, Gamepad API)

William's prototype-input idea: while there's no glasses hardware, a
PlayStation controller in the hand is the input — the phone can be
propped up as the glasses.

- Use the standard Gamepad mapping; poll with `requestAnimationFrame`.
- **Hold R2** = push-to-talk (press and hold to talk, release to send).
  On-screen hold-to-talk must also work — the controller is an addition,
  never a requirement.
- **Left stick or D-pad** moves a visible focus among the page's few
  actions: Talk, Capture, Hide. **X (button 0)** activates the focused
  action.
- Show controller state plainly in one small line ("Controller:
  DualSense — connected" / "No controller"). If none is connected,
  nothing about the page is blocked.
- Keep the mapping in one small table in the code, commented, so it is
  trivially re-mappable.

## Tests

- Node tests for what's pure: the focus-movement logic and the capture
  downscale maths (extract them pure, same style as the other suites).
  Converse and engine suites must stay green (29 / 68 / 72) since both
  files load unchanged.
- Camera, microphone, and controller need real hardware — William's phone
  run is the check (the conversational-layer pattern). Your report should
  say exactly what you could not test from your container.

## Stop and report instead of improvising if

- Anything seems to require editing an existing file.
- The converse intents need changing to support "hide" — if "hide" can't
  ride as a glasses-page-level command ahead of the intent routing, stop
  and say so rather than forking converse.js.
- The adapter can't wrap the current seam without touching warehouse-ui.js.

## What Faye checks in review

Diff scope (all-new files only); the three suites re-run; glasses.html
verified live on Pages; HUD against the settled rulings line by line;
the 413 path exercised or honestly reported as untested; William's phone
run (camera + voice + controller) is the hardware gate, as with the
conversational layer.
