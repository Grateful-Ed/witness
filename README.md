# Witness

A receiving-dock cross-check for warehouse shipments, built for the **Meta Global AI Developer Hackathon** (build window Oct 26 - Nov 4, 2026).

Every shipment that arrives gets **two witnesses** - the receiver's voice and a photo of the pallet - and Witness checks them against each other before the paperwork can lie about the freight.

## How it works

1. **Voice in (push-to-talk).** The receiver speaks the shipment in: what it is, how many pieces, what the labels say. Speech becomes a structured receiving record (voice transcription + Muse Spark).
2. **Photo check.** The receiver photographs the pallet. Vision (SAM 3.1 + Muse Spark) checks the physical load against the spoken claim - piece count, wrap condition, orientation, label placement.

Each claim gets one of three verdicts: **Agree**, **Flag**, or **Can't verify**. "Can't verify" is a first-class answer, not a failure - if pieces are hidden behind other pieces, the app says so instead of guessing.

Where the two witnesses disagree, one tap turns the same evidence into a finished **OS&D (overage, shortage & damage) exception report**. The machine never signs off; it flags, and a human decides.

## Test data

The photo test corpus is **staged test data**: pallets arranged for the camera with known contents and deliberately planted defects, photographed and labeled as ground truth. It is disclosed as staged because that is what a verifiable test set is - the claims the app makes are checked against loads whose true state is known, not asserted.

## Team

Directed by E. William Harris IV (domain: air-export freight operations). Project management and records by Faye (AI); code by Claude (AI). Authorship is stated the way it happened: directed by William, built with AI.

## Status

Build in progress. Submissions close Nov 4, 2026, 9:00 PM ET.
