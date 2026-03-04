---
changeDate: '2026-03-04'
changeTrigger: 'Rework epics.md so Epic 2 explicitly covers all mandated madhabs and full Manasikhat recursion with measurable acceptance criteria.'
mode: 'Batch'
scopeClassification: 'Moderate'
artifactsReviewed:
  - /home/ahmad/mawareeth/_bmad-output/planning-artifacts/prd.md
  - /home/ahmad/mawareeth/_bmad-output/planning-artifacts/epics.md
  - /home/ahmad/mawareeth/_bmad-output/planning-artifacts/architecture.md
  - /home/ahmad/mawareeth/_bmad-output/planning-artifacts/ux-design-specification.md
  - /home/ahmad/mawareeth/_bmad-output/planning-artifacts/implementation-readiness-report-2026-03-04.md
---

# Sprint Change Proposal

## 1. Issue Summary

The current [epics.md](/home/ahmad/mawareeth/_bmad-output/planning-artifacts/epics.md) does not decompose the inheritance engine in a way that faithfully represents the approved product scope. The PRD requires support for all 4 Sunni Madhabs plus Jafari and full recursive multi-generational Manasikhat, but the current Epic 2 stories only name Hanbali coverage and treat Manasikhat as partial coverage rather than a dedicated deliverable.

This issue was identified during implementation readiness assessment. The clearest triggering story is `Story 2.1: Hanbali Core Share Engine for Primary Heirs`, which narrows a multi-school requirement into a single-school implementation. The readiness report also confirmed that the current decomposition overstates FR coverage and creates avoidable implementation risk.

**Evidence**
- PRD `FR-01`: all 4 Sunni Madhabs plus Jafari are required.
- PRD `FR-02`: full recursive Manasikhat is required.
- Readiness report: Epic 2 does not faithfully implement the PRD requirement and lacks a dedicated Manasikhat recursion story.

## 2. Impact Analysis

### Epic Impact

- **Epic 2 is directly affected.**
  - It must be rewritten from a Hanbali-first engine epic into a multi-school inheritance engine epic with explicit coverage across all mandated schools.
  - It must include a dedicated recursion story for full Manasikhat, rather than treating recursion as part of expanded edge-case coverage.

- **Epic 1 is indirectly affected.**
  - `Story 1.2` and `Story 1.5` must ensure user input and validation support school-specific branching and blocked-heir rules consistently enough to feed the multi-school engine.

- **Epic 3 is indirectly affected.**
  - Proof and results stories must assume school-specific proof output and recursive-case explanation, but no structural change is required if Epic 2 outputs become richer.

- **Future marketplace/certification epics are not the trigger for this change.**
  - They can remain if the updated PRD keeps them in scope, but they should not block correction of Epic 2.

### Story Impact

- `Story 2.1` must be replaced or rewritten.
- `Story 2.2` must be generalized from Hanbali proof output to multi-school proof output.
- `Story 2.3` must be split so that Manasikhat recursion is a dedicated story with measurable acceptance criteria.
- A new dedicated engine story is required for full recursive Manasikhat.

### Artifact Conflicts

- **PRD:** No blocking conflict after the recent PRD update. The PRD already requires all schools and recursive Manasikhat.
- **Architecture:** No architectural contradiction. The modular Madhab architecture and graph-solver support the proposed correction.
- **UX:** No blocking contradiction. The UX already assumes Madhab-aware interaction and proof-rich result presentation.

### Technical Impact

- Test matrix expands from one school to five required legal rule sets.
- Contract and fixture coverage must include:
  - standard cases across 4 Sunni schools + Jafari
  - school-specific divergences
  - full recursive Manasikhat cascades
- CI and readiness expectations should explicitly include deterministic multi-school fixtures and recursive-case coverage.

## 3. Recommended Approach

**Selected approach:** Hybrid of Option 1 and Option 3

- **Option 1: Direct Adjustment** is viable.
  - Rework Epic 2 and its stories directly.
  - Preserve the rest of the epic structure unless dependencies require minor edits.
  - Effort: Medium
  - Risk: Medium

- **Option 2: Rollback** is not viable.
  - No implementation has been reported against the faulty story set.
  - Rolling back completed work is unnecessary at this stage.
  - Effort: High
  - Risk: Medium

- **Option 3: PRD MVP Review** is partially viable as a guardrail.
  - Use the updated PRD as the authority for what Epic 2 must include.
  - Do not reduce the multi-school or recursive scope because those are core product requirements, not optional growth items.
  - Effort: Low
  - Risk: Low

**Recommendation**
- Keep the approved PRD scope.
- Rework Epic 2 immediately.
- Re-run implementation readiness after the epic correction.

This is the lowest-risk path because it corrects the decomposition before development begins and keeps the planning set consistent across PRD, architecture, UX, and epics.

## 4. Detailed Change Proposals

### 4.1 Epic 2 Summary

**Artifact:** [epics.md](/home/ahmad/mawareeth/_bmad-output/planning-artifacts/epics.md)

**OLD**
```md
### Epic 2: Deterministic Inheritance Engine
Users receive correct inheritance calculations across Madhabs, including Manasikhat, with deterministic proofs and no manual overrides.
**FRs covered:** FR1, FR2, FR3, FR12
```

**NEW**
```md
### Epic 2: Multi-School Deterministic Inheritance Engine
Users receive deterministic inheritance calculations for all 4 Sunni Madhabs and the Jafari school, with measurable rule coverage, proof output, and no manual overrides.
**FRs covered:** FR1, FR3, FR12
```

**Rationale**
- Removes the false implication that one epic already covers recursion just because Manasikhat is named in the summary.
- Makes FR1 coverage explicit and measurable.

### 4.2 Story 2.1 Replacement

**Artifact:** [epics.md](/home/ahmad/mawareeth/_bmad-output/planning-artifacts/epics.md)

**OLD**
```md
### Story 2.1: Hanbali Core Share Engine for Primary Heirs
```

**NEW**
```md
### Story 2.1: Standard Share Calculation Across All Required Schools

As a legal user,
I want standard inheritance cases calculated across all 4 Sunni Madhabs and the Jafari school,
So that the platform fulfills the required school coverage for first-level inheritance cases.

**Acceptance Criteria:**

**Given** a supported standard inheritance case
**When** I select any of the 4 Sunni Madhabs or the Jafari school
**Then** the system calculates the case according to the selected school
**And** the result differs where school rules differ

**Given** a school-specific rule changes eligibility or share amount
**When** the calculation completes
**Then** the output reflects the selected school's rule set deterministically

**Given** blocked or invalid heir data reaches the engine
**When** validation runs
**Then** the calculation fails safely
**And** no manual override path is available
```

**Rationale**
- Replaces the Hanbali-only narrowing with explicit PRD-compliant coverage.

### 4.3 Story 2.2 Rewrite

**OLD**
```md
### Story 2.2: Hanbali Deterministic Proof Output for Eligible Heirs
```

**NEW**
```md
### Story 2.2: Deterministic Proof Output for Multi-School Results

As a legal user,
I want each supported school calculation to include deterministic proof output,
So that every result can be traced to the selected legal rule set.

**Acceptance Criteria:**

**Given** a supported calculation is completed for any required school
**When** the result is returned
**Then** the system includes structured proof output for the selected school
**And** the same input and school selection always produce the same proof structure

**Given** two schools differ on the same supported case
**When** the user compares outputs
**Then** the proof output reflects the school-specific legal basis for the difference
```

**Rationale**
- Keeps FR3 explicit and school-aware.

### 4.4 Story 2.3 Rewrite

**OLD**
```md
### Story 2.3: Hanbali Expanded Case Support
```

**NEW**
```md
### Story 2.3: Expanded Multi-School Coverage Beyond Standard Cases

As a legal user,
I want broader supported inheritance scenarios across all required schools,
So that the engine handles more than a narrow primary-heir subset.

**Acceptance Criteria:**

**Given** a supported non-trivial inheritance scenario
**When** the calculation runs for any required school
**Then** the system returns a deterministic result for that school

**Given** a scenario is not yet supported
**When** the engine evaluates it
**Then** the system returns a clear unsupported-case response
**And** does not silently degrade to an incorrect result
```

**Rationale**
- Keeps breadth work separate from recursion.

### 4.5 New Story 2.4

**Artifact:** [epics.md](/home/ahmad/mawareeth/_bmad-output/planning-artifacts/epics.md)

**NEW**
```md
### Story 2.4: Full Recursive Manasikhat Calculation

As a legal user,
I want the engine to resolve full recursive multi-generational Manasikhat cases,
So that complex successive inheritance cascades are handled correctly end to end.

**Acceptance Criteria:**

**Given** a supported recursive Manasikhat case spanning multiple inheritance layers
**When** the engine executes the calculation
**Then** the system resolves the full cascade recursively
**And** produces deterministic final shares for the surviving eligible heirs

**Given** the same recursive case is recalculated
**When** the engine runs again
**Then** the result and proof output are identical

**Given** a recursive case exceeds currently supported boundaries
**When** the engine evaluates it
**Then** the system returns a clear unsupported-case response
**And** identifies that the failure is due to unsupported recursion scope rather than generic engine failure
```

**Rationale**
- Satisfies the explicit readiness gap for FR2.

### 4.6 Optional Supporting Change for Epic 1

**Artifact:** [epics.md](/home/ahmad/mawareeth/_bmad-output/planning-artifacts/epics.md)

**Recommended**
- Keep `Story 1.2` and `Story 1.6` aligned with school-aware input branching and blocked-heir rules.
- No rewrite is required for this specific correction unless future readiness still flags a mismatch.

## 5. Implementation Handoff

**Scope classification:** Moderate

This change requires backlog reorganization and planning artifact updates, but not a full product replan.

### Handoff Recipients

- **Product Manager**
  - Update Epic 2 story map in [epics.md](/home/ahmad/mawareeth/_bmad-output/planning-artifacts/epics.md)
  - Ensure Epic 2 traceability matches PRD FR1, FR2, FR3, and FR12

- **Scrum Master / Story Preparation**
  - Regenerate or re-sequence affected story documents after Epic 2 is corrected
  - Make sure story ordering supports school coverage before recursion-heavy cases

- **Architecture / QA**
  - Confirm fixture strategy and acceptance test expectations for:
    - 4 Sunni schools + Jafari
    - recursive Manasikhat
    - deterministic proof output

### Success Criteria for the Change

- Epic 2 no longer names only Hanbali coverage
- Epic 2 contains a dedicated recursive Manasikhat story
- Every revised Epic 2 story has measurable, school-aware acceptance criteria
- Implementation readiness can be re-run without the previous FR1/FR2 blocker

## Checklist Status Summary

- `1.1` Triggering story identified: `[x] Done`
- `1.2` Core problem defined: `[x] Done`
- `1.3` Evidence gathered: `[x] Done`
- `2.1` Current epic impact assessed: `[x] Done`
- `2.2` Epic-level changes identified: `[x] Done`
- `2.3` Future epic impact reviewed: `[x] Done`
- `2.4` New/obsolete epic check: `[N/A]`
- `2.5` Epic priority/order check: `[!] Action-needed` after Epic 2 rewrite
- `3.1` PRD conflict check: `[x] Done`
- `3.2` Architecture conflict check: `[x] Done`
- `3.3` UX conflict check: `[x] Done`
- `3.4` Other artifacts check: `[!] Action-needed` for tests/readiness rerun
- `4.1` Direct adjustment evaluated: `[x] Viable`
- `4.2` Rollback evaluated: `[x] Not viable`
- `4.3` PRD MVP review evaluated: `[x] Viable`
- `4.4` Recommended path selected: `[x] Done`
- `5.1` Issue summary created: `[x] Done`
- `5.2` Impact documented: `[x] Done`
- `5.3` Path forward documented: `[x] Done`
- `5.4` MVP/high-level action plan defined: `[x] Done`
- `5.5` Handoff plan established: `[x] Done`
- `6.1` Checklist completion reviewed: `[x] Done`
- `6.2` Proposal accuracy reviewed: `[x] Done`
- `6.3` User approval: `[ ] Action-needed`
- `6.4` Sprint status update: `[N/A]` no sprint status file found
- `6.5` Next-step handoff confirmation: `[ ] Action-needed`
