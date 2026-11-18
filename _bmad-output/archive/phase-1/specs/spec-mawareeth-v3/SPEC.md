---
id: SPEC-mawareeth-v3
companions:
  - success-criteria.md
  - user-journeys.md
  - phase-boundaries.md
  - requirements-catalog.md
sources:
  - ../../planning-artifacts/prd.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability - consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Mawareeth V3 Universal Inheritance Platform

## Why

Mawareeth V3 exists to replace fragmented, manual, and error-prone inheritance work with a deterministic legal-tech platform for heirs, lawyers, and courts. It combines a product vision, a market opportunity, and a trust mandate: non-experts need guided self-service calculations, professionals need liability-reducing certified outputs, and the platform needs a credible path from draft results to court-usable lawyer-reviewed reports across Lebanese and diaspora cases.

## Capabilities

- **CAP-1**
  - **intent:** Users and lawyers can calculate inheritance shares across the supported Sunni and Jafari schools, including multi-generational Manasikhat cases, without manual math.
  - **success:** The system returns deterministic shares, mathematical proofs, and invalid-kinship flags for complex cases, and a scholarly validated test suite can confirm the engine stays correct.

- **CAP-2**
  - **intent:** A non-expert user can define a complex family tree through an adaptive guided interview and understand the draft outcome before certification.
  - **success:** A user can complete a three-generation case in under five minutes, see real-time share previews, and navigate the flow accurately on a mobile-first multilingual interface.

- **CAP-3**
  - **intent:** The platform can turn calculation results into preliminary or certified reports that lawyers and courts can inspect.
  - **success:** Generated PDFs include Lebanese Hasr al-Irth formatting, fiqh citations, kinship visuals, QR verification, and the correct review-state watermark.

- **CAP-4**
  - **intent:** Eligible lawyers can join a controlled marketplace, publish certification pricing, and be compared only within compliant disclosure rules.
  - **success:** Only approved lawyers appear in certification flows, users unlock comparable pricing after declaring the bequest amount, sponsored placements are labeled, and public trust signals exclude internal membership tiers.

- **CAP-5**
  - **intent:** A user can purchase lawyer certification for a draft calculation and receive an auditable certified result without the lawyer altering the engine math.
  - **success:** Approved lawyers can review, certify, and deliver reports through a tracked workflow that logs certification actions, preserves legal disclaimers, and rejects manual overrides of calculated shares.

- **CAP-6**
  - **intent:** Users can run sensitive inheritance cases with privacy-first defaults while still supporting persistent certified cases when needed.
  - **success:** Self-service calculations can run without persisted PII, certified cases store the required records under encryption, and sensitive financial data can be masked without breaking kinship logic.

## Constraints

- Phase 1 remains the Heroku-to-Hetzner migration of the existing Django monolith, and this product contract cannot make frontend or backend modernization a prerequisite for that phase.
- The product must preserve dual states of preliminary and certified outputs, with non-removable disclaimers on non-certified results.
- Only platform-approved lawyers may appear in certification flows or issue certified reports.
- Lawyer pricing must be disclosed clearly before purchase, sponsored placements must be labeled, and public reviews must come only from verified completed certification orders.
- Calculation purity is non-negotiable: no workflow may manually override the engine mathematical output.
- Accessibility and mobile performance are mandatory, including WCAG 2.1 AA support, high-legibility Arabic typography, and acceptable behavior on 3G and 4G networks.
- Persisted case data must use encryption at rest, TLS 1.3 in transit, and QR-verifiable report authenticity.
- Target response times remain under 200 ms for standard cases and under 1 s for complex Manasikhat traversals.

## Non-goals

- Requiring a Next.js plus DRF split, repository decomposition, or other product modernization as part of the current migration sprint.
- Exposing internal marketplace membership tiers as public trust badges.
- Shipping Christian, Druze, civil-law, blockchain, or AI-validator expansions in the initial delivery slice.

## Success signal

A diaspora heir can complete a complex inheritance case, obtain a preliminary report with citations and kinship proof, purchase certification from an approved lawyer, and receive a certified court-usable PDF without leaving the platform. In parallel, lawyers save hours on complex cases, and the engine remains deterministic under the scholarly validation suite and published performance thresholds.

## Assumptions

- This spec covers the full Mawareeth V3 product contract while treating the migration-first phase boundary as a hard delivery constraint rather than a separate spec topic.
- The PRD's Next.js SPA/SSG and decoupled API notes describe a future-approved architecture direction, not a prerequisite for Phase 1 infrastructure stabilization.

## Open Questions

- Should every exported report be lawyer-certified, or do draft users receive preliminary PDFs while only lawyer-reviewed outputs carry the certified designation?
- What payment compliance boundary is intended for certification checkout: hosted off-site processor, embedded fields, or another PCI-scoped model?
- What exact legal or technical mechanism makes a lawyer certification valid: platform attestation, digital signature, uploaded signed PDF, or jurisdiction-specific e-signature standard?
