---
changeDate: '2026-09-02'
changeTrigger: 'Resolve the planning-authority conflict between the March 4, 2026 product planning baseline that assumes a Next.js plus DRF split and the September 2, 2026 Heroku-to-Hetzner migration contract that preserves the existing Django monolith.'
mode: 'Batch'
scopeClassification: 'Major'
approvalStatus: 'approved'
appliedDate: '2026-09-02'
artifactsReviewed:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/epics/epic-list.md
  - _bmad-output/planning-artifacts/epics/migration-epic.md
  - _bmad-output/planning-artifacts/architecture/index.md
  - _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md
  - _bmad-output/planning-artifacts/architecture/starter-template-evaluation.md
  - _bmad-output/planning-artifacts/architecture/architecture-validation-results.md
  - _bmad-output/planning-artifacts/architecture/project-context-analysis.md
  - _bmad-output/planning-artifacts/architecture/architecture-mawareeth-2026-09-02/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/architecture/architecture-mawareeth-2026-09-02/reviews/reconcile-planning.md
  - _bmad-output/specs/spec-heroku-to-hetzner/SPEC.md
  - _bmad-output/implementation-artifacts/sprint-status.yaml
projectContext: 'No AGENTS.md or project-context.md was found in the repository.'
---

# Sprint Change Proposal

## 1. Issue Summary

The planning set is carrying two incompatible implementation contracts.

On March 4, 2026, the product planning artifacts were written as if the current delivery baseline were a fresh Next.js App Router frontend plus a Django/DRF backend. That assumption is still explicit in the PRD, the epic implementation note, the starter-template evaluation, the architecture validation, and the core architectural decisions.

On September 2, 2026, a newer Heroku-to-Hetzner migration SPEC and companion architecture spine were added. Those documents explicitly preserve the existing Django monolith for the current migration phase and prohibit turning the Heroku exit into a frontend/backend rewrite.

This conflict surfaced during sprint planning on September 2, 2026. The tracker parses cleanly, but a developer could still follow either of two contradictory baselines:

- Baseline A: start by scaffolding `web/` and `api/` around Next.js, DRF, and starter templates.
- Baseline B: migrate the existing Django application as one deployable WSGI service on Hetzner.

That is a planning-contract issue, not a parser issue.

### Evidence

- PRD phase text still says Phase 1 foundation is "Next.js SPA/SSG, UI UX Pro Max design system, and shadcn/ui."
- `epics/epic-list.md` still says the approved architecture baseline is "Next.js App Router + shadcn/ui frontend and Cookiecutter Django backend."
- `architecture/architecture-validation-results.md` still declares "READY FOR IMPLEMENTATION" and names starter initialization as the first implementation priority.
- `architecture/architecture-mawareeth-2026-09-02/ARCHITECTURE-SPINE.md` states that the Heroku exit must preserve the current Django monolith and must not require Next.js, DRF extraction, or service decomposition.
- `specs/spec-heroku-to-hetzner/SPEC.md` already records the phase-safe interpretation of uptime, environment isolation, audit durability, and durable artifact gating.

## 2. Impact Analysis

### Epic Impact

- Epic 0 is directly affected because it is the current sprint and is already aligned to the migration contract.
- Epics 1 through 7 are indirectly affected because their top-level implementation note still treats a future modernization stack as a current prerequisite.
- No epic content needs to be deleted. The immediate need is to clarify phase boundaries and planning authority so Epic 0 can proceed without a rewrite mandate.
- Epic order should remain with Epic 0 first, but the roadmap must explicitly say that product epics follow migration stabilization or a separately approved modernization effort.

### Story Impact

- No individual story is the trigger. The trigger is cross-artifact planning authority.
- Migration stories 0.1 through 0.10 remain valid as written.
- Product stories remain valid at the requirement level, but they cannot currently inherit the March 2026 starter assumptions as mandatory for the active sprint.

### Artifact Conflicts

#### PRD

- The PRD's phased-delivery section still frames the MVP as "Experience-First Continuous Authority" with a Next.js-led foundation.
- NFR-02 still reads as a hard 99.9 percent uptime commitment, while the September 2, 2026 migration contract narrows that to an observed objective for a single-node phase.

#### Architecture

- `architecture/index.md`, `starter-template-evaluation.md`, `core-architectural-decisions.md`, and `architecture-validation-results.md` still read like the current implementation contract.
- Those documents conflict with the September 2, 2026 migration spine unless they are explicitly demoted to future-product reference or updated with a precedence note.
- The older architecture documents also leave a few migration-relevant obligations under-specified unless the September SPEC/spine are treated as authoritative:
  - durable storage policy for canonical PDFs, lawyer uploads, and legal evidence
  - phase-1 interpretation of dev/staging/prod separation
  - exact encryption-at-rest evidence path

#### UX

- The UX specification remains useful and does not block migration.
- It does not need a structural rewrite now, but it should no longer be read as evidence that a Next.js rewrite is part of the current infrastructure sprint.

#### Secondary Artifacts

- `sprint-status.yaml` is structurally in sync today, but it should not be regenerated as the "go build now" signal until the planning contract is corrected.
- The March 4, 2026 implementation-readiness and PRD-validation artifacts are stale relative to the September 2, 2026 migration contract.

### Technical Impact

- If the old baseline wins silently, the team risks mixing host migration, repo restructuring, API extraction, and UI rewrite in one sprint.
- If the new baseline wins silently without updating the older documents, future implementation agents may still follow the old "READY FOR IMPLEMENTATION" instructions and reintroduce drift.
- This is high planning risk and low code-change risk. The fix is documentation authority, not rollback.

## 3. Recommended Approach

### Option 1: Direct Adjustment

Viable.

- Update the existing planning artifacts so the September 2, 2026 migration SPEC and spine are the authoritative contract for Epic 0.
- Preserve the broader product roadmap, but mark the March 2026 starter-based architecture as future or conditional.
- Effort: Medium
- Risk: Low to Medium

### Option 2: Potential Rollback

Not viable.

- No code rollback is needed because this is a planning-contract conflict, not a bad implementation.
- Reverting the newer migration contract would re-open the original ambiguity and increase delivery risk.
- Effort: High
- Risk: High

### Option 3: PRD MVP Review

Partially viable.

- The product goals do not need to shrink.
- The PRD does need a phase-boundary correction so "current sprint" stops implying a rewrite-first MVP.
- Effort: Medium
- Risk: Low

### Selected Path

Hybrid of Option 1 and Option 3.

Keep the product goals, keep Epic 0 first, and correct the planning corpus so the current sprint is migration-first and brownfield-safe. Treat the March 2026 product architecture as reference material for a later product-delivery phase unless it is separately re-approved as a modernization initiative.

### Rationale

- Lowest delivery risk for the current sprint
- No loss of long-term product intent
- No unnecessary rollback
- Removes contradictory instructions before implementation begins
- Makes sprint planning and future handoffs defensible

## 4. Detailed Change Proposals

### 4.1 PRD: Replace the current sprint framing

Artifact: `prd.md`
Section: `Project Scoping & Phased Development`

OLD:

```md
### MVP Strategy: "Experience-First Continuous Authority"
We lead with high-fidelity UI/UX (Next.js/UUPM) and a stable "Islamic Core" (Sunni/Shia) trunk, deploying new legal modules continuously as they pass validation.

#### Phase 1: Core Protocol (Current Sprint)
*   **Foundation:** Next.js SPA/SSG, UI UX Pro Max design system, and shadcn/ui.
*   **Logic:** Recursive Manasikhat Graph-Solver (Sunni/Shia).
*   **API:** REST API contract between Next.js and Python 3.12 logic hub.
*   **Certification Flow:** Verified lawyer onboarding, lawyer selection, paid certification purchase, and auditable certified report delivery.
```

NEW:

```md
### MVP Strategy: "Migration-First, Product-Safe Delivery"
The current sprint is the Heroku-to-Hetzner migration of the existing Django application. Product modernization remains in scope, but it is not a prerequisite for the migration sprint.

#### Phase 1: Infrastructure Stabilization and Heroku Exit (Current Sprint)
*   **Foundation:** Preserve the current Django monolith as one deployable WSGI service.
*   **Delivery:** Containerize the existing app, publish immutable artifacts, deploy through Caddy plus Docker Compose, and prove backup, monitoring, and blue-green release safety.
*   **Scope Boundary:** Do not require Next.js, DRF extraction, or a `web/` plus `api/` repository split during this phase.

#### Phase 2: Product Delivery on Stable Hosting
*   Guided interview, multi-school inheritance engine, reporting, privacy, and certification features continue on the stabilized hosting baseline.
*   If a split frontend/backend architecture is still desired, approve it as a separate modernization initiative before implementation.
```

Rationale:

- Aligns the PRD's "current sprint" language with the September 2, 2026 migration contract
- Preserves the product roadmap without forcing a rewrite into the migration window

### 4.2 PRD: Clarify uptime semantics for Phase 1

Artifact: `prd.md`
Section: `Non-Functional Requirements`

OLD:

```md
*   **NFR-02:** Maintain **99.9% uptime** for both API and Web App.
```

NEW:

```md
*   **NFR-02:** Phase 1 tracks toward a **99.9% availability objective** for the public service, but the single-node topology is not a redundancy guarantee. Zero-downtime applies to routine application deployments only until a later high-availability phase is approved.
```

Rationale:

- Matches the accepted single-VPS migration topology
- Prevents blue-green release language from being misread as host-level HA

### 4.3 Epics: Remove the rewrite prerequisite from the roadmap note

Artifact: `epics/epic-list.md`
Section: top implementation note

OLD:

```md
Implementation note: The approved architecture baseline (Next.js App Router + shadcn/ui frontend and Cookiecutter Django backend) is a delivery prerequisite, not a user-valued story. Planning assumes a hybrid delivery context: implementation starts from the approved starter baseline while integrating into this existing repository and artifact set.
```

NEW:

```md
Implementation note: For the Heroku-to-Hetzner phase, the authoritative implementation contract is `_bmad-output/specs/spec-heroku-to-hetzner/SPEC.md` and its companion architecture spine. Epic 0 executes against the existing Django monolith and must not require a `web/` plus `api/` split. Product Epics 1 through 7 remain the roadmap after migration stabilization; any Next.js or DRF modernization must be separately approved before it becomes a delivery prerequisite.
```

Rationale:

- Keeps Epic 0 actionable
- Preserves the product roadmap without letting future-stack assumptions override the current sprint

### 4.4 Architecture index: Add an explicit precedence note

Artifact: `architecture/index.md`
Section: file header

OLD:

```md
# Architecture Decision Document
```

NEW:

```md
> Status note (2026-09-02): This folder captures the March 2026 product-architecture baseline. For the current Heroku-to-Hetzner migration, the authoritative implementation contract is `_bmad-output/specs/spec-heroku-to-hetzner/SPEC.md` with companion `_bmad-output/planning-artifacts/architecture/architecture-mawareeth-2026-09-02/ARCHITECTURE-SPINE.md`. Where these documents conflict, the migration SPEC and spine take precedence.

# Architecture Decision Document
```

Rationale:

- Gives future readers a single conflict-resolution rule
- Avoids silent drift without deleting useful product-architecture exploration

### 4.5 Core architecture: Reframe the current blocker decisions

Artifact: `architecture/core-architectural-decisions.md`
Sections: `Decision Priority Analysis`, `Infrastructure & Deployment`, `Decision Impact Analysis`

OLD:

```md
**Critical Decisions (Block Implementation):**
- API: REST + versioned routes (/api/v1) with OpenAPI docs.
- Frontend state and routing: Next.js App Router, React Query + Zustand.
...
**Implementation Sequence:**
- Establish repo structure + baseline starters.
- Stand up Django API with auth + Postgres.
- Implement Next.js interview UI + API contracts.
```

NEW:

```md
## Scope and precedence

This document remains the product-architecture reference for future product delivery. For the current Heroku-to-Hetzner migration, the migration SPEC and September 2, 2026 architecture spine are authoritative where they conflict with this document.

**Critical Decisions for the current migration phase:**
- Preserve the existing Django monolith as one deployable WSGI service.
- Publish immutable CI-built artifacts and deploy them through Caddy plus Docker Compose on Hetzner.
- Keep PostgreSQL as the single durable transactional store on a private network with rehearsed backup and restore.

**Product modernization candidates (not current migration blockers):**
- REST plus versioned API routes
- Next.js App Router, React Query, Zustand, and shadcn/ui
- Starter-based repo restructuring

**Implementation Sequence:**
- Capture the Heroku inventory and upgrade the current Django application to its approved production baseline.
- Build immutable CI artifacts from the existing app.
- Provision the Hetzner host baseline, private Compose runtime, blue-green release flow, monitoring, and backups.
- After migration stabilization, decide whether product delivery continues on the current Django baseline or moves to a separately approved modernization architecture.
```

Rationale:

- Preserves the useful product architecture
- Stops current migration work from inheriting rewrite-only blockers

### 4.6 Architecture validation: Demote "READY FOR IMPLEMENTATION" to a conditional product-reference status

Artifact: `architecture/architecture-validation-results.md`
Sections: `Architecture Readiness Assessment`, `Implementation Handoff`

OLD:

```md
**Overall Status:** READY FOR IMPLEMENTATION
...
**First Implementation Priority:**
- Initialize starter templates and scaffold baseline repo structure.
```

NEW:

```md
**Overall Status:** CONDITIONAL

This architecture is valid as a product-modernization reference, but it is not the authoritative implementation contract for the current Heroku-to-Hetzner migration sprint.
...
**First Implementation Priority:**
- Execute Epic 0 migration work against the existing Django monolith using `_bmad-output/specs/spec-heroku-to-hetzner/SPEC.md` and the September 2, 2026 architecture spine.
- Treat starter-template initialization and repo restructuring as deferred until separately approved.
```

Rationale:

- Removes the highest-risk contradictory signal in the older planning set
- Keeps the document useful without letting it overrule the migration contract

### 4.7 Requirements inventory: Convert the starter stack from mandate to candidate, and record the missing phase-1 guards

Artifact: `epics/requirements-inventory.md`
Section: `Additional Requirements`

OLD:

```md
- Starter templates: Next.js App Router + Tailwind + shadcn/ui (frontend) and Cookiecutter Django (backend).
- Deployment: Hetzner VM + Docker Compose + Caddy + GitHub Actions CI/CD; dev/staging/prod separation.
```

NEW:

```md
- Product modernization candidate: if the team later approves a frontend/backend rewrite after migration stabilization, evaluate Next.js App Router + Tailwind + shadcn/ui with a Django/DRF backend as a separate initiative rather than a Phase 1 prerequisite.
- Deployment: Hetzner VM + Docker Compose + Caddy + GitHub Actions CI/CD.
- Phase 1 environment separation: local Compose for development, disposable CI services, and on-demand staging with isolated data and secrets; no permanent staging host is required in Phase 1.
- Durable artifact policy: canonical PDFs, lawyer verification uploads, and other legal evidence must either be reproducibly regenerated from immutable inputs or stored durably with backup coverage before those features launch.
- Encryption-at-rest evidence: before production launch, document the exact AES-256-at-rest control for production data and off-host backups.
```

Rationale:

- Aligns the older requirements inventory with the migration-phase decisions already captured in the September SPEC and spine
- Closes the remaining planning gaps surfaced by the reconciliation review

### 4.8 Starter-template evaluation: Mark it as future-state only

Artifact: `architecture/starter-template-evaluation.md`
Section: file header and selected-starter heading

OLD:

```md
## Primary Technology Domain

Full-stack web application (interactive Next.js frontend + Django REST backend + deterministic compute engine)
...
## Selected Starter: Next.js + shadcn/ui (frontend) + Cookiecutter Django (backend)
```

NEW:

```md
> Status note (2026-09-02): This evaluation is retained as a future product-modernization candidate. It is superseded for the current Heroku-to-Hetzner migration by the brownfield-preservation SPEC and architecture spine.

## Primary Technology Domain

Future product-modernization candidate: interactive frontend plus deterministic Django-backed platform
...
## Deferred Modernization Candidate: Next.js + shadcn/ui (frontend) + Cookiecutter Django (backend)
```

Rationale:

- Keeps the work
- Removes its ability to masquerade as the current sprint's mandatory baseline

## 5. Implementation Handoff

### Scope Classification

Major.

This is not a code rollback, but it is a planning-authority correction across the PRD, epics, architecture, and readiness gate. It changes what "current sprint" means and which documents are allowed to direct implementation.

### Handoff Recipients

- Product Manager / Analyst
- Architect
- Developer, after planning approval

### Responsibilities

Product Manager / Analyst:

- Update the PRD phase framing and uptime wording
- Confirm that the product roadmap remains intact while the current sprint is migration-first

Architect:

- Add the precedence note to the architecture corpus
- Reclassify the March 2026 architecture as future or conditional where it conflicts with the migration contract
- Land the missing storage, isolation, and encryption planning dispositions in the authoritative planning set

Developer:

- Do not treat starter-template scaffolding as the first implementation task for the current sprint
- After the planning updates are approved and applied, rerun `bmad-sprint-planning`
- Implement Epic 0 against the existing Django monolith and migration contract

### Success Criteria

- A new reader can tell, in one pass, which artifact is authoritative for Epic 0
- The PRD no longer says the current sprint starts with a rewrite
- The epics no longer require a `web/` plus `api/` split for the migration phase
- The older architecture documents stop advertising "READY FOR IMPLEMENTATION" for the current sprint
- The planning set explicitly records the phase-1 interpretation of uptime, environment separation, durable legal artifacts, and encryption-at-rest evidence
- `bmad-sprint-planning` can be rerun without reopening baseline ambiguity

## 6. Checklist Summary

- [x] Trigger and evidence identified
- [x] Epic impact assessed
- [x] PRD, architecture, UX, and secondary artifact conflicts assessed
- [x] Path forward evaluated
- [x] Proposal written
- [!] Approval still required before changing planning artifacts or sprint tracking
- [!] `sprint-status.yaml` intentionally left unchanged pending approval

## 7. Proposed Next Step

Approve this proposal, then apply the planning edits in one pass and rerun `bmad-sprint-planning`.
