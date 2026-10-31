# Witness

**Witness is a warehouse run by voice and vision — and one day soon, through a pair of glasses.**

A receiver's hands are busy. A warehouse's paperwork lies. Witness starts from those two facts: the people doing the work should be able to talk to the system, the system should check what it's told against what it can see, and no machine should ever sign off on freight — a human decides.

Built for the **Meta Global AI Developer Hackathon** (build window Oct 26 – Nov 4, 2026). Live app: https://grateful-ed.github.io/witness/

> **This README is the project's definition of record.** The project grew on Oct 31, 2026 — from a receiving-dock cross-check into the whole warehouse. Module one (the cross-check) is built and live; the rest of the building is being built in the open, in this repo, until submissions close Nov 4, 9:00 PM ET. If anything anywhere describes Witness as only a receiving app, this file supersedes it.

## The whole project

The glasses only make sense if the whole warehouse runs through them — you can't sell them for one task. So Witness is the building, organized the way the work is:

1. **The building** — dock doors, zones, staging lanes, and bins: every storage location, what belongs in it, what's in it now.
2. **Inbound** — what's expected (the bill of lading is already in the system before the truck arrives), door assignment, receiving, putaway, and exceptions at the door.
3. **Inventory** — the truth per bin: quantity, condition, holds; which partial pallets should be **consolidated**, which pallets need to be **taken apart**.
4. **Outbound** — orders allocated against what's actually in the bins, picking, packing, staging, loading.
5. **The work queue** — putaways, consolidations, breakdowns, refills and picks as one queue of generated work, prioritized.
6. **Labor** — labor units (a labor unit is an employee): who's on shift, who's where, who holds what task; labor hours per task and per area; rebalancing proposed by the system, decided by the manager.
7. **The workflow** — the machinery behind "what's up next?": speak the completion, the task closes, the next one pulls. A problem reported mid-task re-routes the work.
8. **The AI layer, by role** — a worker's system answers worker questions (my tasks, what's next, report a problem); a manager's answers manager questions (what's backing up, what's *about* to, and who to move). Same warehouse, different eyes, by user level.
9. **Bottleneck foresight** — flow rates per area and queues building *before* they jam, answered in plain words, by location, with the labor move attached.
10. **Records** — the OS&D trail, who did what and when, shift summaries a manager can actually read.
11. **Surfaces** — phone and desk today. **The glasses come last**: the functionality is built surface-first, and the glasses point-of-view layer is the final step — the cherry on top, not the foundation.
12. **Integrations** — reading the systems warehouses already run (WMS/ERP, EDI, emailed bills of lading) instead of asking anyone to re-type the world. Last, and honestly labeled.

One law at every level: **the AI proposes; a human decides.**

Scope honesty, in the builder's own rule: a full warehouse management system is a multi-year industry. The target in this window is the high-level basic of each area *that works* — narrow claims, checked deeply, the same discipline as the pallet cross-check below.

## Module one — the receiving cross-check (built, live)

Every shipment that arrives gets **two witnesses** — the receiver's voice and a photo scan of the pallet — and Witness checks them against each other before the paperwork can lie about the freight.

1. **Step 1 — Speak the load (push-to-talk).** The receiver holds the button and describes the physical pallet: count, how the stack sits, the wrap, damage, and what they have decided about it. Muse Voice Transcribe turns the speech into a verbatim transcript, and Muse Spark flags everything in it that belongs in a receiving report — each flag quoting the receiver's exact words. Nothing is sorted into fixed fields and nothing is filled in for them.
2. **Step 2 — Photo scan & comparison.** Muse Spark reads photos of the same load from all four sides — front, right, back, left — and flags what it sees, side by side. Then the two scans are compared point by point. Each point gets one of three verdicts: **Agree**, **Flag**, or **Can't verify**. "Can't verify" is a first-class answer, not a failure: a receiver's decision ("send it back") is something no photo can confirm, and the report says so instead of guessing.
3. **One tap — the OS&D report.** The disagreements and unverified points become a finished **OS&D (overage, shortage & damage) exception report**, saved with the same evidence. The machine never signs off; it flags, and a human decides.

Scans and reports are stored by the project's own Cloudflare Worker (voice, structuring, vision and storage all run through it; no API key lives in the page).

Why two scans? Because each one fails differently. In our test corpus, a receiver's spoken scan of a badly damaged load reached the right verdict — reject it — while clearing the load's damaged right side and blaming its one clean side. The photo scan caught both. A single witness would have sent the crew to fix the wrong face.

In the whole-warehouse picture, this module is how **inbound freight gets received** (area 2) — the dock door is where the system starts, not where it ends.

## Status

- **Module one (receiving cross-check): built and live**, proven end to end on real hardware — voice scan → flags → photo scan → comparison → OS&D report saved.
- **The warehouse foundation: live** at https://grateful-ed.github.io/witness/warehouse.html — a seeded demonstration building (4 dock doors, zones A/B/C × 8 bins, 6 labor units and a manager, inbound and outbound orders) with a working task queue: putaway, consolidation, breakdown, pick and receive tasks are generated from the building's own state, assigned per labor unit, and completed with quantities reconciled — nothing created, nothing destroyed. Worker and manager views included; the manager's bottleneck panel names the backed-up zone and proposes a labor move with its numbers showing. The remaining areas deepen from this foundation until Nov 4, 9:00 PM ET; anything not listed here as built is planned or in build, and is labeled that way wherever it appears.
- **The conversational layer: live** on the warehouse page (2026-10-31) — a worker talks to the queue by voice: "done" closes the task in hand and pulls the next, "what's next" reads the task back, a problem report pins the worker's own words to the task and the record, and nothing else moves freight. The manager can ask the building a question ("Ask the building") and gets an answer computed from the building's live numbers — the numbers are shown under every answer, along with the engine's own bottleneck call and a check of every number the answer uses. The law holds at this tier too: a proposal, not a decision — nothing was moved.
- **The glasses layer: last, by design** (see area 11).

## Test data

The photo test corpus is **generated test data**: two photo-realistic pallet loads rendered with known, deliberately planted defects, each documented side by side as ground truth and labeled as generated — never passed off as real warehouse photographs. It is disclosed because that is what a verifiable test set is: the app's claims are checked against loads whose true state is known, not asserted. People's spoken scans of these loads are collected through the app and scored against the same ground truth. The warehouse build likewise runs on a seeded demonstration building, labeled as such.

## Team

Directed by E. William Harris IV (domain: air-export freight operations). Project management and records by Faye (AI); code by Claude (AI). Authorship is stated the way it happened: directed by William, built with AI.
