# Witness

A receiving-dock cross-check for warehouse shipments, built for the **Meta Global AI Developer Hackathon** (build window Oct 26 - Nov 4, 2026).

Every shipment that arrives gets **two witnesses** — the receiver's voice and a photo scan of the pallet — and Witness checks them against each other before the paperwork can lie about the freight.

Live app: https://grateful-ed.github.io/witness/

## How it works

1. **Step 1 — Speak the load (push-to-talk).** The receiver holds the button and describes the physical pallet: count, how the stack sits, the wrap, damage, and what they have decided about it. Muse Voice Transcribe turns the speech into a verbatim transcript, and Muse Spark flags everything in it that belongs in a receiving report — each flag quoting the receiver's exact words. Nothing is sorted into fixed fields and nothing is filled in for them.
2. **Step 2 — Photo scan & comparison.** Muse Spark reads photos of the same load from all four sides — front, right, back, left — and flags what it sees, side by side. Then the two scans are compared point by point. Each point gets one of three verdicts: **Agree**, **Flag**, or **Can't verify**. "Can't verify" is a first-class answer, not a failure: a receiver's decision ("send it back") is something no photo can confirm, and the report says so instead of guessing.
3. **One tap — the OS&D report.** The disagreements and unverified points become a finished **OS&D (overage, shortage & damage) exception report**, saved with the same evidence. The machine never signs off; it flags, and a human decides.

Scans and reports are stored by the project's own Cloudflare Worker (voice, structuring, vision and storage all run through it; no API key lives in the page).

Why two scans? Because each one fails differently. In our test corpus, a receiver's spoken scan of a badly damaged load reached the right verdict — reject it — while clearing the load's damaged right side and blaming its one clean side. The photo scan caught both. A single witness would have sent the crew to fix the wrong face.

## Test data

The photo test corpus is **generated test data**: two photo-realistic pallet loads rendered with known, deliberately planted defects, each documented side by side as ground truth and labeled as generated — never passed off as real warehouse photographs. It is disclosed because that is what a verifiable test set is: the app's claims are checked against loads whose true state is known, not asserted. People's spoken scans of these loads are collected through the app and scored against the same ground truth.

## Team

Directed by E. William Harris IV (domain: air-export freight operations). Project management and records by Faye (AI); code by Claude (AI). Authorship is stated the way it happened: directed by William, built with AI.

## Status

Both steps are built and live: voice scan → flags → save, and photo scan → comparison → OS&D report. Submissions close Nov 4, 2026, 9:00 PM ET.
