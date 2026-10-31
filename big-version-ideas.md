# Witness — the big version: design notebook

The design notebook for the project defined in the repo README:
the whole warehouse, in William's words first, shaping after.
(A trimmed copy of Faye's working notebook, published so the
build record lives with the code.)

PROJECT REDEFINITION (William, 2026-10-31 09:03 ET, his alignment
call): the project itself has changed. Witness is no longer "the
receiving cross-check product" — it is the whole-warehouse glasses
system in this file. The receiving cross-check is module one: the
built proof and the entry wedge.

BUILD RULING (William, 2026-10-31 09:04 ET — supersedes the
"submission stays module one" framing minutes earlier): we build
the 12-area list BEFORE the submission, as much as we possibly can
until submissions close Wed Nov 4, 9:00 PM ET. All of it lands
inside the build window, so everything built is legitimately
submittable new work. Target per area stays his scope rule: the
high-level basic that works. Module one is protected — new areas
are additions; the proven cross-check loop must not break. The demo video + form get reserved time at the end.

Started 2026-10-31.

## The seed idea

- **Meta glasses in the warehouse** (William, 2026-10-31): the fancy
  glasses Meta is selling — find the way to use those on the dock.
  **His ruling on how it lands (2026-10-31 07:52 ET): not a footnote —
  a BIG POINT in the demo video.** His framing, near-verbatim: "This
  is what it can do without the glasses — now imagine if we had the
  glasses on top of it." He knows glasses support itself isn't
  buildable in the window; the video makes the pitch. One guardrail
  from the official rules: the demo must show only what the team
  built — so the glasses segment is labeled on screen as the vision /
  where this goes, clearly separated from the working demo. Pitching
  a roadmap is fair; dressing it as built would be a DQ risk.
  (The product logic: Witness exists because the receiver's hands
  are busy. A phone still needs a hand and a pocket. Glasses put the
  camera where the receiver's eyes already are and the mic where
  their voice already is — the human scan and the photo scan from
  the same viewpoint, hands never leaving the freight.)

## Demo video shape (3:00, draft — William's glasses beat placed)

- 0:00–0:20 The hook: freight arrives, paperwork lies; every load
  deserves two witnesses.
- 0:20–1:40 THE WORKING DEMO (all built, all real): Load B on the
  phone — speak the scan → flags → photo scan → the comparison
  catches the wrong-side verdicts → OS&D saved.
- 1:40–2:05 What it proves / who it's for.
- 2:05–2:50 THE GLASSES BEAT (labeled vision): "Everything you just
  saw needed one hand on a phone. Now imagine it on the glasses…"
  receiver just looks and talks; verdicts land while both hands stay
  on the freight.
- 2:50–3:00 Close: the machine never signs off — a human decides.
  Team/authorship card.

## The glasses mock-up (William, 2026-10-31 07:53 ET)

For the video's glasses beat: a created POV visual — as if the
viewer is looking OUT through the glasses at the pallet, with the
information the glasses could show overlaid on the view. Not real
glasses footage; a mock-up frame (or a short sequence of frames)
built from a load view plus a glasses-style display layer.

Display layer shows only what Witness already produces, re-homed to
the eye: the listening state while the receiver speaks, flags as
they land, a verdict surfacing in the corner of the view ("Right
side — damage you didn't call"), and the OS&D ready state. Spec for
the build, three frames:
1. Looking at the load — "Say what you see" + listening indicator.
2. Turning to the damaged side — a FLAG chip surfaces in-view.
3. The settle frame — "OS&D ready — a human decides."
Build as HTML/CSS overlay on a load photo and screenshot it, so the
text is crisp and exactly controlled. It lives only in the labeled
vision segment of the video.

## The whole warehouse (William, 2026-10-31 — "I'm not kidding")

Not just the package, not just receiving — you can't sell the
glasses for one task. The whole warehouse runs through them, and
**what the AI gives you depends on who you are**:

- **Roles / user levels.** A manager's glasses answer manager
  questions; a floor worker's glasses don't. Same warehouse, same
  system, different eyes per role — permissions shape both what's
  shown and what can be asked.
- **Worker flow (voice, hands-free)** — both sides of this exchange
  are William's scripted example dialogue, in his words:
  WORKER: "Hey Muse, what's up next? I just got done with my task."
  → the finished task gets marked completed, and the AI tells him
  what his next task is. Task management by talking, hands never
  leaving the work.
- **Manager flow (foresight, not just status)** — same, both sides
  his:
  MANAGER: "What's a bottleneck that's supposed to be coming up here
  soon, and how can I move around labor to help fix it?"
  AI (his words): bottleneck is located in location B currently; you
  can pull someone from location A to help with location B.
  This is Goldratt's Theory of Constraints running on live data —
  the constraint found before it bites, with the rebalance
  suggested; and Witness's own law scales with it: the machine
  proposes, the manager decides.
- The receiving cross-check (the hackathon build) becomes module
  one of a platform — the dock is where it starts, not where it ends.

## The pitch (written 2026-10-31, for sharing)

### Text-message version (copy-paste)

Okay so you know the Meta glasses? Imagine them in a warehouse. A
truck backs in, and the guy receiving the freight never touches a
screen — he just looks at the pallet and talks. The glasses hear what
he says about the load AND see what he's seeing, and the two have to
agree. If he misses damage on one side, the glasses catch it, because
the camera saw it even if he didn't. The report basically writes
itself.

Then it gets bigger. A worker finishes a job and just says "what's
next?" — done, here's your next task, hands never leave the freight.
And the manager can ask the question that actually runs a warehouse:
"what's ABOUT to jam up, and who do I move to stop it?" — and the
glasses tell him which spot's about to back up and who to pull from
where. Different people get different answers, because the system
knows who's asking.

The AI never makes the final call. It proposes, a human decides.

That's the thing I'm building. The receiving part already works — I
built it for a Meta hackathon, it's live right now. The glasses part
is where it goes.

### 30-second spoken version

"You know how Meta's betting the glasses are the next phone? I think
the first place they actually earn it is a warehouse. I built an app
where a receiver just looks at a pallet and talks — the system
cross-checks what he says against what the camera sees, and catches
what either one missed. Now put that on the glasses and run the whole
building through it: workers get their next task by asking, managers
ask where the next bottleneck's forming and get told who to move.
The AI proposes, humans decide. The receiving part's already built
and live — the rest is the dream I'm chasing."

### One-liner

Witness: two witnesses for every load — the worker's voice and the
camera's eye — and someday soon, the whole warehouse talking back
through a pair of glasses.
## The build list — whole scope (William's framing, 2026-10-31 08:09 ET)

His words for the target: everything a warehouse management system
can do is the horizon; realistically we land the high-level basics
of each area. His vocabulary, kept: the garages where trucks come in,
bins (where pallets and goods go), labor hours, labor units (a labor
unit IS an employee), the workflow, orders in and out, and the
consolidate / take-apart work. ✓ = the hackathon build already has a
working piece of it.

### 1. The building itself (the map everything else reads)
- Dock doors ("garages"): which door, which trailer, what state
  (empty / unloading / staged / loaded).
- Zones and areas (his "location A / location B") — the level the
  manager's bottleneck answers speak in.
- Bins: every storage location, what belongs in it, what's in it now.
- Staging lanes by the doors for freight in motion.

### 2. Inbound (orders coming in)
- What's expected: the shipment/BOL known ahead (email/EDI), door
  assignment, appointment times.
- BOL recognition on the glasses (William, 2026-10-31,
  to-do note): a worker wearing the glasses picks up the paper bill
  of lading; the glasses read it and match it to the shipment
  already in the building, so the expected contents load on the
  spot and the worker repeats nothing. Identity from the paperwork
  itself — module one's "identity comes from a scan" law, with the
  camera doing the reading. Lives with the glasses layer (§11);
  the cross-check then compares three things: what was expected,
  what the worker says, what the camera sees.
  UPDATE (William, 2026-10-31): no longer glasses-only
  theory — build the phone-camera version in the app NOW (slice 3):
  point the phone at a printed mock BOL and the AI reads the
  physical paper. William prints the mock BOL himself. Brief:
  briefs/claude-brief-bol-camera.md in this repo.
- Receiving: the two-witness cross-check ✓ (voice scan + photo scan,
  verdicts, OS&D report) — module one, built and live.
- Putaway: where each pallet goes (which bin), issued as a task.
- Exceptions at the door: damage, shortage, wrong freight, incident
  updates after the scan (load spills while moving).

### 3. Inventory (the truth about what's in the bins)
- What's in every bin, in what quantity and condition.
- Moves: bin-to-bin transfers as tasks.
- Counts: cycle counting by voice through the glasses.
- Holds and releases: damaged / quarantined / available.
- Consolidation candidates: partial pallets that should marry up.
- Breakdown candidates: pallets that need to come apart.

### 4. Outbound (orders going out)
- Orders in, allocated against what's actually in the bins.
- Picking: guided by voice/glasses, bin by bin.
- Packing and staging at the right door.
- Loading and shipping: the trailer leaves with the right freight,
  and the record proves it.

### 5. The work queue (consolidate / take apart / move)
- Generated work: consolidations, breakdowns, replenishment of pick
  bins, putaways — all as tasks in one queue.
- Priorities: what matters now vs. what can wait.
- Every task: assignable, completable by voice ("done — what's
  next?"), and visible.

### 6. Labor (units and hours)
- Labor units = employees: who's on shift, who's where.
- Assignment: who holds which task, in which area.
- Labor hours: time on task, time per area, the shift's shape.
- Rebalancing: moving a unit from A to B — proposed by the system,
  decided by the manager (see §8).

### 7. The workflow engine (what's up next)
- One queue per role; the next-task logic behind "what's up next?"
- A completion spoken aloud closes the task and pulls the next.
- Problems reported mid-task (his incident update) re-route the work.

### 8. The AI layer, by role (the glasses product)
- Worker tier: my tasks, what's next, report a problem, count this,
  check this load.
- Manager tier: what's backing up, what's ABOUT to back up and
  where, labor moves proposed with reasons, throughput questions.
- Admin tier: the flag watch-list and building config (which bins,
  which rules) — his configurable watch-list idea, grown up.
- The law at every tier: the AI proposes; a human decides.

### 9. Bottleneck foresight (the manager's question, as a system)
- Flow rates per area: how fast work is clearing vs. arriving.
- Queue build-up detection before it becomes a jam.
- The forecast answer in plain words, by location, with the labor
  move attached.

### 10. Records (the trail)
- The OS&D trail ✓ (reports saved per load).
- Who did what, when: tasks, moves, verdicts — the audit story.
- Shift summaries a manager can actually read.

### 11. The surfaces
- Glasses POV: the mock-up defined above (listen, flag in-view,
  settle) for every role.
- Phone: the working surface today ✓.
- Desk: the manager's wide view, later.

### 12. Integrations (later, honestly labeled)
- Reading the systems warehouses already run (WMS/ERP, EDI, email
  BOLs) instead of asking anyone to re-type the world.
- This is the long pole. The basics above stand without it; this is
  what turns a product into a platform.

Scope honesty (his own rule, recorded): a full WMS is a multi-year
industry. The target per area is the high-level basic that WORKS —
the same discipline as the hackathon build: narrow claim set,
checked deeply.

## The playable presentation (William, 2026-10-31)

A short game-like interactive for the presentation: you're looking
through the glasses, first-person, DOING the warehouse work. The
player picks a role first:
- **Warehouse worker** — tasks arrive in-view; you work them, say
  done, get the next; the receiving cross-check is one of the jobs.
- **Manager** — you watch the building's queues build and answer the
  bottleneck question by making labor moves, seeing them work (or
  not) live.
Purpose: show the potential by letting someone live two minutes of
it instead of hearing it described. Build note: a small web
interactive is very buildable in our stack; two clean uses —
(a) screen-record a playthrough into the demo video's vision
segment, (b) a playable link from the repo/README for anyone who
wants to try it. Honesty line: it presents as a concept simulation,
clearly — it demonstrates the idea, it isn't the glasses product.
