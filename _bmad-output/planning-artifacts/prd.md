---
stepsCompleted:
  - step-01-init
  - step-02-discovery
  - step-02b-vision
  - step-02c-executive-summary
  - step-03-success
  - step-04-journeys
  - step-05-domain
  - step-06-innovation
  - step-07-project-type
  - step-08-scoping
  - step-09-functional
  - step-10-nonfunctional
  - step-11-polish
  - step-11-polish
inputDocuments:
  - _bmad-output/brainstorming/brainstorming-session-2026-03-03-045222.md
documentCounts:
  briefCount: 0
  researchCount: 0
  brainstormingCount: 1
  projectDocsCount: 0
classification:
  projectType: web_app
  domain: legaltech
  complexity: high
  projectContext: brownfield
workflowType: prd
---

# Product Requirements Document - Mawareeth V3

## Executive Summary

Mawareeth V3 is the definitive universal protocol for Islamic inheritance. It replaces fragmented, manual, and error-prone distribution methods with a deterministic, scholarly-validated "Source of Truth." The platform serves heirs, lawyers, and courts in Lebanon and the global diaspora by bridging 1,400 years of jurisprudence (fiqh) with modern legal technology.

### core Differentiator: The Universal Engine
The core innovation is a "Modular Madhab" architecture that isolates sect-specific rules (Sunni/Shia) and Lebanese multi-faith laws within a single, rule-based engine. It features a recursive "Manasikhat" graph-solver to automate complex, multi-generational cascades—a capability that currently requires elite scholarly intervention.

## Success Criteria

### User Success
*   **Efficiency:** Heirs and lawyers complete 3-generation "Manasikhat" cases in **<5 minutes**.
*   **Trust:** 100% of reports provide 'Mawareeth-Certified' PDF output with direct fiqh citations.
*   **Usability:** Non-experts navigate the "Guided Interview" flow to accurately define complex family trees.

### Business Success
*   **Market Dominance:** Achieve and maintain the **#1 global search ranking** for Islamic inheritance calculators.
*   **Authority:** Secure formal endorsement from at least one recognized Lebanese Islamic Council.
*   **Adoption:** 500+ unique calculations performed within 30 days of launch.

### Technical Success
*   **Accuracy:** **100% pass rate** on a 1,000+ scholarly-validated case test suite.
*   **Integrity:** Zero logic leaks between the domain layer (Python 3.12) and persistence layer (Django).
*   **Performance:** API response for complex graph traversals stays below **1s**.

## User Journeys

### 1. The Diaspora Heir (Sami)
*   **Context:** Lives in Paris; father deceased in Beirut. Conflicting family advice causes tension.
*   **Action:** Uses Mawareeth V3 "Guided Interview" to input a 3-generation tree.
*   **Outcome:** Receives a clear, printable PDF explaining the distribution, resolving family conflict in <5 minutes.

### 2. The Estate Lawyer (Layla)
*   **Context:** Handles 10+ cases monthly in Tripoli; manual math takes hours and risks liability.
*   **Action:** Uses Mawareeth V3 to automate a 4-generation complex cascade.
*   **Outcome:** Attaches 'Mawareeth-Certified' report to court filings, saving 5+ hours per case.

### 3. The Court Clerk (Mustafa)
*   **Context:** Processes official 'Hasr al-Irth' (حصر الإرث) decrees at the Sharia Court.
*   **Action:** Receives family reports pre-prepared via Mawareeth V3.
*   **Outcome:** Uses verified citations to expedite judicial approval, establishing V3 as the "Silent Advocate."

## Project Scoping & Phased Development

### MVP Strategy: "Experience-First Continuous Authority"
We lead with high-fidelity UI/UX (Next.js/UUPM) and a stable "Islamic Core" (Sunni/Shia) trunk, deploying new legal modules continuously as they pass validation.

#### Phase 1: Core Protocol (Current Sprint)
*   **Foundation:** Next.js SPA/SSG, UI UX Pro Max design system, and shadcn/ui.
*   **Logic:** Recursive **Manasikhat (المناسخات)** Graph-Solver (Sunni/Shia).
*   **API:** REST API contract between Next.js and Python 3.12 logic hub.

#### Phase 2: Universal Expansion (Growth)
*   **Multi-Faith:** Continuous rollout of Christian (Maronite/Orthodox), Druze, and Civil Law modules.
*   **Ecosystem:** Public OpenAPI/SDKs for banking and legal tech integration.
*   **Localization:** Professional Arabic, English, and French UI.

#### Phase 3: Visionary Intelligence (Future)
*   **AI Validator:** LLM-based scholarly oversight integrated into the CI/CD loop.
*   **Blockchain:** Immutable recording of verified distributions for permanent integrity.

## Domain & Innovation Requirements

### Compliance & Regulatory
*   **Legal Authentication:** Dual-state architecture: "Preliminary" (Unverified) and "Certified" (Lawyer-Reviewed).
*   **Mandatory Disclaimers:** Non-removable notices for algorithm-only results.
*   **Terminology:** Precise alignment with Lebanese 'Hasr al-Irth' court standards.

### Novel Patterns
*   **Recursive Graph-Solver:** Transition from arithmetic templates to recursive graph theory for generational cascades.
*   **Hybrid Trust Protocol:** Deterministic engine math paired with Human-Lawyer final validation.
*   **Calculation Purity:** "Logic-as-Code" policy forbids manual overrides; all fixes happen at the engine level.

## Web App Specific Requirements

### Architecture & SEO
*   **Next.js SPA/SSG:** SPA for interactive interviews; SSG for #1 ranking keyword landing pages.
*   **UI Intelligence:** **UI UX Pro Max v2.0** for Bento Grid layouts and mobile-first responsiveness.
*   **API-First Core:** Decoupled Django/Python 3.12 backend communicating via versioned REST API.

### Quality & Standards
*   **Deterministic Validation:** Playwright E2E tests ensure frontend logic matches backend math.
*   **Accessibility:** **WCAG 2.1 AA** compliance with high-legibility Arabic typography.
*   **Performance:** SSG for rapid initial load; optimized for 3G/4G connectivity.

## Functional Requirements

### 1. Universal Inheritance Engine
*   **FR-01:** System calculates shares for all 4 Sunni Madhabs and the Jafari (Shia) school.
*   **FR-02:** System performs recursive calculations for multi-generational **Manasikhat**.
*   **FR-03:** System generates deterministic mathematical proofs for every share distribution.
*   **FR-04:** System identifies and flags 'Invalid' kinship inputs based on fiqh constraints.

### 2. Guided Interview Experience
*   **FR-05:** Users input family data via interactive, step-by-step kinship discovery.
*   **FR-06:** Interview adapts questions dynamically based on the selected Madhab/Sect.
*   **FR-07:** Users can preview calculated shares in real-time during the interview.

### 3. Court-Ready Reporting
*   **FR-08:** System generates PDF reports formatted to Lebanese 'Hasr al-Irth' standards.
*   **FR-09:** Reports include exact fiqh citations and visual kinship graphs.
*   **FR-10:** System embeds "Preliminary" or "Verified" watermarks based on review status.

### 4. Verification & Authentication
*   **FR-11:** Verified Lawyers can review and digitally 'Certify' calculation results.
*   **FR-12:** System prevents manual overrides of engine-calculated mathematical output.
*   **FR-13:** System maintains an audit log of all human verifications and engine discrepancies.

### 5. Privacy & Data Ethics
*   **FR-14:** Users can perform "Privacy-First" calculations without persisting PII.
*   **FR-15:** System anonymizes sensitive financial data while preserving kinship logic.

## Non-Functional Requirements

### 1. Performance & Reliability
*   **NFR-01:** Standard calculations return in **<200ms**; complex Manasikhat in **<1s**.
*   **NFR-02:** Maintain **99.9% uptime** for both API and Web App.
*   **NFR-03:** 100% Deterministic logic ensured via versioned engine updates.

### 2. Security & Trust
*   **NFR-04:** **Dual-State Storage:** Ephemeral default sessions; persistent encrypted records for certified cases.
*   **NFR-05:** **End-to-End Encryption:** AES-256 for data at rest; TLS 1.3 for transit.
*   **NFR-06:** **QR-Verify:** Reports include scannable QR codes for court-side verification.

### 3. Accessibility
*   **NFR-07:** **WCAG 2.1 AA** compliance with high-contrast, high-legibility Arabic fonts.
*   **NFR-08:** Optimized for mobile browser performance on 3G/4G Lebanese networks.
