# Requirements Catalog

## Domain and Regulatory Rules

- Legal authentication: The platform distinguishes preliminary algorithmic output from certified lawyer-reviewed output.
- Mandatory disclaimers: Non-removable notices are required on algorithm-only results.
- Terminology: Output must align with Lebanese Hasr al-Irth court standards.
- Lawyer eligibility: Only platform-approved lawyers may appear in certification selection flows or issue certified reports.
- Pricing transparency: Lawyer-defined pricing must be shown clearly before purchase.
- Sponsored disclosure: Paid sponsored lawyer placement must be explicitly labeled and visually separated from standard ranking.
- Review integrity: Reviews and ratings may come only from verified completed certification orders.

## Novel Patterns

- Modular Madhab architecture: Sect-specific Sunni, Shia, and future Lebanese multi-faith rules stay isolated inside one rule-based engine.
- Recursive graph solver: Multi-generational cascades move from arithmetic templates to recursive graph logic.
- Hybrid trust protocol: Deterministic engine math is paired with human lawyer validation.
- Calculation purity: Fixes happen in the engine layer; manual overrides are forbidden.

## Web App Architecture and Experience

- Interactive interviews may use an SPA-style experience, while SEO landing pages are expected to support static generation.
- The product direction calls for Bento-grid layouts and mobile-first responsiveness rather than desktop-first forms.
- The backend remains Django and Python 3.12, exposed through a versioned REST API if and when the product is split.
- Playwright end-to-end validation should prove frontend behavior matches backend math.
- Accessibility must meet WCAG 2.1 AA with high-legibility Arabic typography.
- Performance must remain acceptable on 3G and 4G Lebanese mobile networks.
- Marketplace pricing stays hidden until the user enters the bequest amount so comparisons share a declared basis.
- Marketplace cards may show verified reviews or response metrics, but not internal membership tiers as public trust badges.

## Functional Requirements

- FR-01: Calculate shares for all four Sunni madhabs and the Jafari school.
- FR-02: Perform recursive calculations for multi-generational Manasikhat.
- FR-03: Generate deterministic mathematical proofs for every share distribution.
- FR-04: Identify and flag invalid kinship inputs based on fiqh constraints.
- FR-05: Capture family data through an interactive, step-by-step kinship interview.
- FR-06: Adapt interview questions dynamically to the selected madhab or sect.
- FR-07: Preview calculated shares in real time during the interview.
- FR-08: Generate PDFs formatted to Lebanese Hasr al-Irth standards.
- FR-09: Include exact fiqh citations and visual kinship graphs in reports.
- FR-10: Embed preliminary or verified watermarks based on review status.
- FR-11: Let lawyers apply for marketplace participation, submit verification details, and gain approval before offering certification services.
- FR-12: Let approved lawyers define certification pricing as a minimum fee, a bequest percentage, or the higher of the two.
- FR-13: Let users unlock lawyer pricing by entering the bequest amount, compare approved lawyers, and purchase certification through the platform.
- FR-14: Allow clearly labeled sponsored placements and verified review signals without exposing internal membership tiers as public trust badges.
- FR-15: Let approved lawyers review and digitally certify calculation results.
- FR-16: Prevent manual overrides of engine-calculated mathematical output.
- FR-17: Maintain an audit log of human verifications, certification actions, and engine discrepancies.
- FR-18: Support privacy-first calculations without persisting PII.
- FR-19: Anonymize sensitive financial data while preserving kinship logic.

## Non-functional Requirements

- NFR-01: Standard calculations return in under 200 ms; complex Manasikhat returns in under 1 second.
- NFR-02: Phase 1 tracks toward a 99.9% availability objective for the public service, but the single-node topology is not a redundancy guarantee.
- NFR-03: Deterministic logic stays versioned and fully reproducible.
- NFR-04: Default to ephemeral sessions, with persistent encrypted records for certified cases.
- NFR-05: Use AES-256 at rest and TLS 1.3 in transit.
- NFR-06: Reports include scannable QR verification.
- NFR-07: Meet WCAG 2.1 AA with high-contrast, high-legibility Arabic fonts.
- NFR-08: Remain performant on mobile browsers over 3G and 4G Lebanese networks.
- NFR-09: Certification checkout, sponsored labeling, and final lawyer pricing disclosures must be clear before purchase confirmation.
- NFR-10: Marketplace reviews and ratings must be limited to verified completed certification orders and protected against duplicate or anonymous submission.
