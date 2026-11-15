---
changeDate: '2026-11-11'
changeTrigger: 'Adopt an open-core structure: keep the inheritance engine public under AGPL-3.0 for credibility and future integration, and build the lawyer marketplace and certification (Epics 5-7) in a private repository from the first story of Epic 5.'
mode: 'Incremental'
scopeClassification: 'Moderate'
approvalStatus: 'approved'
appliedDate: '2026-11-11'
artifactsReviewed:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/epics/epic-list.md
  - _bmad-output/planning-artifacts/epics/index.md
  - _bmad-output/planning-artifacts/epics/requirements-inventory.md
  - _bmad-output/planning-artifacts/architecture/project-structure-boundaries.md
  - _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md
  - _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md
  - _bmad-output/planning-artifacts/architecture/architecture-mawareeth-2026-09-02/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-design-specification/*.md
  - _bmad-output/implementation-artifacts/sprint-status.yaml
projectContext: 'No AGENTS.md or project-context.md was found in the repository.'
---

# Sprint Change Proposal

## 1. Issue Summary

The repository `asamawi/mawareeth` is public (AGPL-3.0, two forks) but the planning set never says which code is meant to be public. Read literally, the architecture places lawyer certification, certification audit and billing beside the engine in the one public tree, so Epics 5-7 (pricing, commission, sponsorship, marketplace ranking, certification and the future registry) would be published by default.

The question surfaced on 2026-11-11 in a party-mode session, while Story 3.1b was in progress, when the owner asked whether the repository should stay public. The session established:

- The original reason for going public (community contributions) produced none in six years: 540 commits by the owner, 6 by Dependabot, nothing else.
- The reason that remains is credibility of the rules and their execution, and integration later by courts, government registries and legal tech.
- The business is the lawyer certification marketplace (Epics 5-7), not the engine. Its defensible asset is the lawyer network and a certification registry, not its code.

Categorised as a **strategic decision**, not a technical failure.

### Evidence

- No AGPL, licensing, open-source or contributor policy appears anywhere in the PRD, epics, architecture or UX corpus.
- `architecture/project-structure-boundaries.md:80` routes `/api/v1/verification/*` (lawyer certification and audit) and `:122` routes payments to `api/apps/billing`, both inside the public tree.
- NFR-06 (QR-Verify, `prd.md:184`) has no story, registry or signing-key design.
- No story addresses whether Lebanese Sharia courts accept a platform-certified report (`prd.md:77-80` treats it as an aspiration).
- AD-1 keeps one deployable unit, and the release image is built in public CI and pushed to GHCR, so an image containing private code would leak it.

## 2. Impact Analysis

### Epic Impact

- **Epic 3 (in progress):** continues as planned. Story 3.2 gains one acceptance criterion keeping certified rendering out of the public code.
- **Epic 4:** unchanged. Draft saving and sharing stay public; certified status reaches it only through the report-status extension point.
- **Epics 5, 6, 7:** move to the private repository. Epic 5 gains a gate, Story 5.0. Epic 7 gains Story 7.7 for the registry and QR verification.
- No epic becomes obsolete; no resequencing.

### Story Impact

| Story | Change |
|---|---|
| 3.2 | One added acceptance criterion (Edit 6) |
| 5.0 | New: validation gate and private package bootstrap (Edit 5) |
| 5.1-7.6 | Unchanged text; built in the private repository per AD-14 |
| 7.7 | New: certification registry and QR verification (Edit 7) |

### Artifact Conflicts

- **PRD:** new "Product Model: Open Core" section; Phase 3 ecosystem line widened to courts and government with self-hosting (Edits 1, 2).
- **Architecture:** new spine decision AD-14; ownership annotations in the structure document (Edits 3, 4).
- **UX:** not affected. Screens and flows are unchanged; only code ownership moves.

### Technical Impact

- Nothing is extracted now; no code changes in this sprint.
- From Story 5.0: a private repository, a one-way dependency (private imports public, never the reverse), a report-status extension point that defaults to "draft", and a release image containing private code published only to a private registry.
- Public CI never needs access to private code.

## 3. Recommended Approach

### Options Considered

1. **Direct adjustment** (selected): add the boundary to the PRD and architecture, add two stories, annotate one. Effort low, risk low, no timeline impact.
2. **Rollback:** not viable. No completed work conflicts with the boundary.
3. **MVP review:** not needed. MVP scope is unchanged.
4. **Make the whole repository private:** rejected in the session. The forks already hold the history; the open engine is the credibility asset; AGPL would still oblige publishing the source of the running service.

### Rationale

- The boundary falls where the plan already separates concerns: the marketplace depends on the engine, never the reverse.
- Epics 5-7 are unbuilt, so drawing the line now costs nothing; drawing it later means extracting code.
- Story 5.0 places the validation gate before three epics of investment.
- The CLA keeps the owner's right to relicense or sell a commercial engine licence.

## 4. Detailed Change Proposals

All eight edits were approved individually on 2026-11-11.

### Edit 1: PRD, new section "Product Model: Open Core"

Artifact: `prd.md`, under "Domain & Innovation Requirements", before "Compliance & Regulatory".

OLD: no such section.

NEW:

```markdown
### Product Model: Open Core
*   **Public engine (AGPL-3.0):** The inheritance engine (school rules, proof, Manasikhat), the interview, the draft results and draft report, and the known-answer test corpus stay public in `asamawi/mawareeth`. Anyone can read and re-run the logic; this is the product's credibility for heirs, lawyers, courts and future integrators.
*   **Private marketplace:** Lawyer registration and approval, membership, pricing, sponsorship, marketplace ranking, certification purchase, certification, its audit trail, and the certification registry with its signing keys are built in a private repository from the first story of Epic 5. Nothing is extracted before then.
*   **The moat is the network, not the code:** a certified report is valid only if it verifies against the Mawareeth certification registry (NFR-06); approved lawyers, reviews and the registry cannot be forked.
*   **Contributions:** Outside contributions to the public engine are accepted only under a Contributor License Agreement, so the owner keeps the right to relicense or sell a commercial license of the engine.
```

Rationale: records the decision where every later story sees it; the CLA protects a future commercial engine licence.

### Edit 2: PRD, Phase 3 ecosystem line

Artifact: `prd.md:105`.

OLD:

```markdown
*   **Ecosystem:** Public OpenAPI/SDKs for banking and legal tech integration.
```

NEW:

```markdown
*   **Ecosystem:** Public OpenAPI/SDKs for banking, legal tech, court and government integration, built on the public engine. Integrators can either call the hosted API or self-host the public engine (data residency); a versioned rule set and the known-answer corpus serve as the conformance suite. Certification and registry verification stay a hosted Mawareeth service.
```

Rationale: courts and government registries usually must self-host; the open engine allows it while certification stays with Mawareeth.

### Edit 3: Architecture spine, AD-14

Artifact: `architecture/architecture-mawareeth-2026-09-02/ARCHITECTURE-SPINE.md`, after AD-13; add `AD-14` to `binds:`.

NEW:

```markdown
### AD-14 — Open-core repository boundary [ADOPTED]

- **Binds:** Repository ownership, dependency direction, and release-image visibility
- **Prevents:** Marketplace, pricing, certification or signing-key code landing in the public AGPL repository by default, and the public engine coming to depend on private code
- **Rule:** The public repository (`asamawi/mawareeth`, AGPL-3.0) owns the engine, interview, draft results, draft report and known-answer corpus. A private repository owns Epics 5–7: lawyer accounts and approval, membership, pricing, sponsorship, marketplace ranking, certification purchase and action, certification audit, and the certification registry and its signing keys. Dependencies point one way: private code may import public code; public code never imports private code and builds, tests and runs without it. Certified status reaches public screens and the report only through a narrow extension point that defaults to "draft". AD-1 still holds: the private package is installed into the one release image at build time, so any image that contains private code is published only to a private registry. Story 5.0 chooses the mechanism; nothing is extracted before Epic 5.
```

Rationale: binds future implementation to the boundary and surfaces the release-image visibility consequence.

### Edit 4: Architecture structure document, ownership

Artifact: `architecture/project-structure-boundaries.md`.

4a, line 80. OLD: `- `/api/v1/verification/*` → lawyer certification + audit` NEW: `- `/api/v1/verification/*` → lawyer certification + audit (**private package**, AD-14)`

4b, line 122. OLD: `- Payments (future) → `api/apps/billing` (deferred)` NEW: `- Payments (future) → billing in the **private package** (deferred; AD-14)`

4c, new subsection at the end of "Architectural Boundaries":

```markdown
**Open-Core Ownership (AD-14):**
- Public repository: `api/apps/engine`, cases/heirs, draft reports and share links for drafts, `web/src/features/interview`, `web/src/features/reports` (draft rendering), the known-answer corpus.
- Private package: lawyer accounts and approval, membership/pricing/sponsorship, marketplace, certification purchase and action, `verification`, certification `audit`, billing, the certification registry and its signing keys.
- Report status is the only seam: public code reads it through an extension point that returns "draft" when the private package is absent; only the private package can set "certified" or render a seal.
- The private package may import public modules; public modules never import private ones, and public CI never needs private access.
```

Rationale: aligns the structure document with AD-14; draft share-link audit stays public, certification audit is private.

### Edit 5: Epics, new Story 5.0

Artifact: `epics/epic-list.md`, between the Epic 5 header and Story 5.1.

NEW:

```markdown
## Story 5.0: Marketplace Validation Gate and Private Package Bootstrap

**Implements:** AD-14 (open-core boundary); precondition for FR-11 through FR-17

As the product owner,
I want evidence that lawyers and courts will accept platform certification, and a private home for the marketplace code,
So that Epics 5–7 are built on a validated demand and never land in the public repository.

**Acceptance Criteria:**

**Given** Epic 5 has not started
**When** the validation gate is reviewed
**Then** at least five Lebanese lawyers who handle estates and five heirs abroad (Lebanese expats in the Gulf) have been interviewed
**And** the findings record whether Lebanese Sharia courts give weight to a platform-certified Hasr al-Irth report, what lawyers charge today, and whether they would certify through a platform for a commission
**And** the owner records a go, change, or stop decision for Epics 5–7

**Given** the gate decision is "go"
**When** the private package is bootstrapped
**Then** a private repository exists that depends on the public engine and is never imported by it
**And** the public repository still builds, tests and runs with the private package absent, and report status defaults to "draft"
**And** any release image that contains the private package is published only to a private registry, with the mechanism recorded against AD-14
**And** the public repository has a CONTRIBUTING file requiring a CLA for outside contributions
```

Rationale: one gate for validated demand, the private home and the CLA before three epics of investment.

### Edit 6: Story 3.2, added acceptance criterion

Artifact: `epics/epic-list.md`, Story 3.2, appended after the PDF-failure criterion.

NEW:

```markdown
**Given** the open-core boundary (AD-14)
**When** the report status and disclaimer are rendered
**Then** the public code reads the status only through the report-status extension point, which returns "draft" when no private package is installed
**And** no certified seal, signature, registry link or certification wording is implemented in the public repository
```

Rationale: Story 3.2 is next; without this the certified branch of the PDF would be written into public code.

### Edit 7: Epics, new Story 7.7

Artifact: `epics/epic-list.md`, after Story 7.6.

NEW:

```markdown
## Story 7.7: Certification Registry and QR Verification

**Implements:** NFR-06; AD-14 (private package)

As a court clerk or relative holding a certified report,
I want to scan the report's QR code and see whether the certification is genuine and current,
So that I can trust the report without contacting the platform or the lawyer.

**Acceptance Criteria:**

**Given** a lawyer certifies a report (Story 7.5)
**When** the certified report is issued
**Then** the registry records the report, the certifying lawyer, the time, and the engine version and rule set that produced the result
**And** the certification is signed with a key held only by the private service, and the report carries a QR code linking to its registry entry on the Mawareeth domain

**Given** someone scans a certified report's QR code
**When** the registry entry is valid and not revoked
**Then** the page shows the certifying lawyer, the certification date and the shares, and states that the result can be re-derived with the published engine version

**Given** a certification is revoked, the lawyer's approval is withdrawn, or the report was altered
**When** someone scans or checks it
**Then** the page clearly shows that the report is not currently certified

**Given** the signing key must change
**When** it is rotated
**Then** earlier certifications still verify, and the verification page lists the current and previous public keys
```

Rationale: NFR-06 had no story; the registry is the moat and resists lawyer disintermediation.

### Edit 8: Sprint status

Artifact: `implementation-artifacts/sprint-status.yaml`.

- After `epic-5: backlog`, add `5-0-marketplace-validation-gate-and-private-package-bootstrap: backlog`.
- After `7-6-audit-trail-for-certification-actions: backlog`, add `7-7-certification-registry-and-qr-verification: backlog`.
- `last_updated: 2026-11-10` becomes `last_updated: 2026-11-11`.

## 5. Implementation Handoff

### Scope Classification

Moderate. Planning edits and backlog additions; no code changes, no replan.

### Handoff Recipients

- Product Owner / Developer: apply Edits 1-8 in one pass on `development`.
- Developer: implement Story 3.2 with its new criterion.
- Owner (Ahmad): run the Story 5.0 validation interviews before Epic 5.
- Architect: choose the private-package and private-image mechanism in Story 5.0.

### Success Criteria

- A reader of the PRD or spine can tell in one pass which code is public and which is private.
- Story 3.2 ships with no certified wording or seal in the public repository.
- Epic 5 cannot start without a recorded go/change/stop decision.
- `sprint-status.yaml` lists 5.0 and 7.7 and parses.

### Follow-ups Logged, Not in This Change

- **Lebanese legal systems:** Ja'fari is unsupported (`calc/schools.py:135`), and Lebanon also has Druze law and the 1959 inheritance law for non-Muslims. "Legal system" should become a concept above madhhab, designed before Ja'fari is added. Sequence by coverage: Hanafi (done), then Ja'fari.
- **Lawyer disintermediation:** Epic 7 has no protection against lawyers taking clients off the platform. Story 7.7 helps; a fuller answer should follow the Story 5.0 interviews.
- **Beachhead customer:** the session suggested Lebanese expats in the Gulf settling an estate in Lebanese courts. Story 5.0 tests this.

## 6. Checklist Summary

- [x] Trigger and evidence identified
- [x] Epic impact assessed
- [x] PRD, architecture, UX and secondary artifacts assessed (UX not applicable)
- [!] CI/release: a release image containing private code must go to a private registry (Story 5.0)
- [x] Path forward evaluated: direct adjustment
- [x] Edits 1-8 approved individually
- [x] Proposal approved 2026-11-11 and Edits 1-8 applied

## 7. Proposed Next Step

Approve this proposal, apply Edits 1-8 in one pass on `development`, then continue Story 3.1b and Story 3.2.
