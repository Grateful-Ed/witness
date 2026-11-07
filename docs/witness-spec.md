# Witness Spec Documentation

Version: V1.0 | Date:  | Author: Edward Harris

## 1. Overview & Objectives

Witness is an AI warehouse management assistant utilizing smart glasses to communicate with the clients WMS via an AI liaison. The Goal of this application is to mitigate muda (waste) and support an efficient streamline to updating the wms without requiring the use of your hands.

### 1.1 Core Objectives

- Primary Objective: Deliver a robust, scalable application meeting primary user needs.
- Secondary Objective: Streamline workflow efficiency and reduce operational latency.
## 2. User Roles & Personas

| Role / Persona | Description | Key Responsibilities & Permissions |
| --- | --- | --- | --- |
| Warehouse User | Warehouse operational user accessing job execution and completion setting | View and execute completion for  core operational tasks, and view warehouse procedure flow and status. |
| Planner | Standard operational user accessing core workflows. | Create, view, and edit assigned user resource data. |
| Administrator | System administrator managing configurations and security. | Manage user permissions, system logs, and global settings. |

## 3. Functional Requirements

### 3.1 Core Features

- **FR-01 The Glasses:** Primary user to WMS interface
  - **FR-01.1 Voice-First Operation:** Voice-in, display-out operating mode of the glasses.
    - **FR-01.1.1 Wake Word:** Voice activation trigger that opens the command input window.
  - **FR-01.2 Photo Capture:** Still-image capture from the glasses camera.
  - **FR-01.3 Glasses Controls:** Physical on-device controls for core task actions.
    - **FR-XX Finger Piece Input:** Wearable finger-worn input device mapped to task-advance and photo-capture actions.
- **FR-02 The Ontology:** The AI’s internal model of the client’s building and operations.
  - **FR-02.1 Self-Extension:** Extension of the ontology with newly detected site entities, subject to human settlement.
  - **FR-02.2 Learned Vocabulary:** Repository of site-specific vocabulary and definitions within the ontology.
  - **FR-02.3 Learned Procedures:** Stored procedures in the ontology, AI-drafted and human-settled, executable on request.
  - **FR-02.4 Confidentiality & Access:** Access policy for the ontology: non-user-facing; contents auditable by the client; internal representation proprietary.
  - **FR-02.5 Client-Specific Configuration:** Operating parameters defined per client site and held as ontology content.
  - **FR-XX The Keeper:** Agent role responsible for ontology currency.
  - **FR-XX The Horizon:** Time-window scoping of the live ontology to current and near-term work.
  - **FR-XX Doctrine in the Ontology:** Domain theory stored in the ontology as a reference layer for AI reasoning.
- **FR-03 The Interpretation Layer:** Component that converts worker speech into system-executable inputs.
  - **FR-03.1 Interpretation:** Resolution of ambiguous utterances via clarification, with answers retained as ontology input.
  - **FR-03.2 Disruption and blocker Handling:** Conversational processing of worker-reported deviations from plan.
  - **FR-03.3 Ask the Building:** Query interface answering from the system record.
  - **FR-03.4 AI Triage Proposals:** Constraint and exceptions solution proposals.
  - **FR-XX Local Listener:** On-device speech model for a basic command set, with escalation to the cloud model.
- **FR-04 The Gate:** Single checkpoint for all state-changing acts, with per-act attribution.
  - **FR-04.1 Completion Confirmation:** Staging-and-confirmation control on spoken task completions.
  - **FR-04.2 Human Signatures:** Signature requirement for customer- or third-party-facing acts, bound to a named human.
  - **FR-04.3 Model Outage:** System state when the AI model is unavailable: no acts staged or executed; user-facing notice: "AI is currently down."
- **FR-05 Work Assignment:** Allocation of work to workers at whole-job granularity.
  - **FR-05.1 Job Assignment & Dealing:** Automatic assignment of the next job from the department pool on job completion; manager-only reassignment.
    - **FR-XX Push Task Delivery:** Code-driven delivery of the next task on job start and task close, without user input.
- **FR-06 Freight Verification:** Verification of received freight against expected receipt data.
  - **FR-06.1 Cross-Check:** Comparison of the worker’s spoken receipt report against a photo scan of the same freight, with agree / flag / can’t-verify outcomes.
  - **FR-06.2 OS&D Report & Human Posting:** Discrepancy report generation for receiving exceptions; receiving posting restricted to a human action.
- **FR-07 Host Integration:** Connection layer between Witness and the client’s WMS.
  - **FR-07.1 The Adapter:** Interface that delivers Witness acts to the host WMS through the host’s published interfaces.
  - **FR-07.2 The Mirror:** One-way synchronization of host data into the ontology.
- **FR-08 One Record:** Single shared state record across desk, phone, and glasses surfaces.
  - **FR-08.1 Phone Interface:** AI communication, plus viewing and changing of the worker’s own tasks and jobs. No WMS functions.
- **FR-09 The Witness Application:** Witness’s desk application: host connection settings and site configuration.
  - **FR-09.1 Practice Mode:** Training mode executing against an isolated dataset, separate from the live record.
  - **FR-09.2 User Interfaces:** Exists within desk application at warehouse level and on the phone at user level
  - **FR-XX Analytics Views:** AI-generated activity views over the system record, subject to client settlement.
  - **FR-XX KPI Tracking:** Client-defined performance measures computed from the system record; underivable measures rejected at definition time.
- **FR-XX Authentication & Authorization:** Secure login via SSO/OAuth2 with role-based access control (RBAC).
- **FR-XX User Dashboard:** Real-time analytics and activity summary panel.
- **FR-XX Data Export & Reporting:** Ability to generate PDF and CSV reports on demand.
## 4. Technical Architecture & Data Model

- **AR-01 The Record:** The system’s single shared state.
  - **AR-01.1 One State:** All surfaces read and write the same record.
  - **AR-01.2 Revision Guard:** A stale read cannot overwrite a newer state.
- **AR-02 Surface Topology:** The component chain supplying the glasses.
  - **AR-02.1 Phone-Sourced:** Desk → Phone → Glasses.
  - **AR-02.2 Desk-Sourced:** Desk → Glasses.
- **AR-03 Agent Architecture:** The system’s agent roles and invocation rules.
  - **AR-03.1 The Delegator:** Assembles context and dispatches; never answers the user.
  - **AR-03.2 Sub-Agents:** Delegator-invoked; act on dispatched context only; persist nothing.
  - **AR-03.3 The Keeper:** Maintains ontology currency; event-invoked, never user-invoked.
  - **AR-03.4 Invocation:** One invocation, one model call; roles are assigned by code.
- **AR-04 The Gate:** The single checkpoint for every state-changing act.
  - **AR-04.1 Six Checks:** Validation, signature class, confirmation, ownership, execution, attribution.
  - **AR-04.2 Policy:** Gate behavior rules held in one policy object.
  - **AR-04.3 Attribution:** Each act records actor, surface, and words heard.
- **AR-05 Host Integration:** The boundary with the client’s WMS.
  - **AR-05.1 The Adapter:** Acts reach the host only through its published interfaces.
  - **AR-05.2 Idempotency:** Each act carries a unique key; retries land at most once.
  - **AR-05.3 SENT State:** Unconfirmed async acts are held as SENT.
  - **AR-05.4 The Mirror:** Host data flows one-way into the ontology.
- **AR-06 The Model Boundary:** The interface between the system and its AI models.
  - **AR-06.1 Envelopes:** Model traffic uses defined request/response envelopes.
  - **AR-06.2 Translation:** Voice input is translated to system shapes before code acts.
  - **AR-06.3 Outage:** Model unavailable — no acts staged or executed.
- **AR-07 Data Model:** The core shapes held in the record.
  - **AR-07.1 Core Shapes:** Tasks, jobs, shipments, vocabulary, concepts, configuration.
  - **AR-07.2 Registered Shapes:** Predefined shapes, declared in a registry.
  - **AR-07.3 Learned Shapes:** Detected shapes enter via the settle ladder.
## 5. Open Questions & Decisions

- **Q1.0 Interpretation Placement:** Does the interpretation layer stand as its own core (FR-03) or under FR-01?
  - **Q1.1 Considerations:** An earlier annotation placed it under FR-01 as implied by the glasses; the layer also serves phone and desk input.
- **Q2.0 Mirror Placement:** Does the Mirror sit under Host Integration (FR-07) or under the Ontology (FR-02)?
  - **Q2.1 Considerations:** It is integration mechanics, and it is also the ontology’s supply line.
- **Q3.0 Blocker Resolution:** By what path does a blocker get resolved so work can proceed?
  - **Q3.1 Considerations:** Disruption and blocker are defined; the resolution path is not. Manager action and reassignment are candidates.
- **Q4.0 Local Listener and Outage:** Does a local basic-command model change the outage rule (FR-04.3)?
  - **Q4.1 Considerations:** Local commands could survive a cloud outage; signed acts cannot be taken locally.
- **Q5.0 Doctrine in the Ontology:** Is domain theory stored in the ontology as a reference layer?
  - **Q5.1 Considerations:** Theory as a lens, not a verdict; live data wins on contradiction.
- **Q6.0 Repository Privacy:** The Witness repo goes private after the hackathon event; what happens to the public demo?
  - **Q6.1 Considerations:** A private repo on a free plan takes the Pages demo dark; a stripped public demo copy is the alternative.
