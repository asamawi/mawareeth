# Requirements Inventory

## Functional Requirements

FR-01: System calculates shares for all 4 Sunni Madhabs and the Jafari (Shia) school.
FR-02: System performs recursive calculations for multi-generational Manasikhat.
FR-03: System generates deterministic mathematical proofs for every share distribution.
FR-04: System identifies and flags invalid kinship inputs based on fiqh constraints.
FR-05: Users input family data via interactive, step-by-step kinship discovery.
FR-06: Interview adapts questions dynamically based on the selected Madhab/Sect.
FR-07: Users can preview calculated shares in real-time during the interview.
FR-08: System generates PDF reports formatted to Lebanese Hasr al-Irth standards.
FR-09: Reports include exact fiqh citations and visual kinship graphs.
FR-10: System embeds Preliminary or Verified watermarks based on review status.
FR-11: Lawyers can apply for marketplace participation, submit verification details, and gain approval before offering certification services.
FR-12: Approved lawyers can define certification pricing using a minimum fee, percentage of bequest, or the higher of the two.
FR-13: Users can unlock lawyer pricing by entering the bequest amount, compare approved lawyers, and purchase certification through the platform.
FR-14: The lawyer marketplace can show clearly labeled sponsored placements and verified review signals without exposing internal membership tiers as public trust badges.
FR-15: Approved lawyers can review and digitally certify calculation results.
FR-16: System prevents manual overrides of engine-calculated mathematical output.
FR-17: System maintains an audit log of all human verifications, certification actions, and engine discrepancies.
FR-18: Users can perform privacy-first calculations without persisting PII.
FR-19: System anonymizes sensitive financial data while preserving kinship logic.

## NonFunctional Requirements

NFR-01: Standard calculations return in <200ms; complex Manasikhat in <1s.
NFR-02: Maintain 99.9% uptime for both API and Web App.
NFR-03: 100% deterministic logic ensured via versioned engine updates.
NFR-04: Dual-state storage: ephemeral default sessions; persistent encrypted records for certified cases.
NFR-05: End-to-end encryption: AES-256 at rest; TLS 1.3 in transit.
NFR-06: Reports include scannable QR codes for court-side verification.
NFR-07: WCAG 2.1 AA compliance with high-contrast, high-legibility Arabic fonts.
NFR-08: Optimized for mobile browser performance on 3G/4G Lebanese networks.
NFR-09: Certification checkout, sponsored placement labeling, and final lawyer pricing must be presented with clear disclosure before purchase confirmation.
NFR-10: Marketplace reviews and ratings must be restricted to verified completed certification orders and protected against duplicate or anonymous submission.

## Additional Requirements

- Starter templates: Next.js App Router + Tailwind + shadcn/ui (frontend) and Cookiecutter Django (backend).
- Backend stack: Python 3.12 + Django + DRF; versioned REST API under /api/v1 with OpenAPI docs.
- Auth: Django auth + Google OAuth + email/password with MFA (email + TOTP + WhatsApp via Meta Cloud API).
- Error handling: RFC 7807 Problem+JSON responses.
- Data: PostgreSQL 17.x (fallback 16.x); optional Redis 8 series for cache/session/rate-limiting.
- Deployment: Hetzner VM + Docker Compose + Caddy + GitHub Actions CI/CD; dev/staging/prod separation.
- i18n/RTL: next-intl; RTL/LTR switching using logical properties.
- UI state: React Query for server state; Zustand for UI state.
- Visualization: React Flow initially, with migration path to custom SVG/d3 if performance issues.
- Deterministic engine boundary: engine is pure domain module, no DB writes, no manual overrides.
- Contract tests to ensure UI and engine alignment; Playwright E2E emphasis.
- UX: zero-friction start (no signup before calculation); optional signup after results and always available in navbar.
- UX: real-time family tree visualization with smooth add/remove feedback and share previews.
- UX: WhatsApp-first sharing, link/email sharing, and court-ready PDF generation.
- UX: certification badge states (Preliminary/Certified) and fiqh citations available on results.
- UX: accessibility and keyboard navigation, plus reduced-motion support.

## FR Coverage Map

FR-01: Epic 2 - Multi-School Deterministic Inheritance Engine
FR-02: Epic 2 - Multi-School Deterministic Inheritance Engine
FR-03: Epic 2 - Multi-School Deterministic Inheritance Engine
FR-04: Epic 1 - Guided Interview & Family Tree Capture
FR-05: Epic 1 - Guided Interview & Family Tree Capture
FR-06: Epic 1 - Guided Interview & Family Tree Capture
FR-07: Epic 1 - Guided Interview & Family Tree Capture
FR-08: Epic 3 - Results & Court-Ready Report
FR-09: Epic 3 - Results & Court-Ready Report
FR-10: Epic 3 - Results & Court-Ready Report
FR-11: Epic 5 - Lawyer Registration and Approval
FR-12: Epic 6 - Lawyer Membership, Pricing, and Sponsorship
FR-13: Epic 7 - Lawyer Marketplace, Certification Purchase, and Audit
FR-14: Epic 6 and Epic 7 - Lawyer Membership, Pricing, and Sponsorship; Lawyer Marketplace, Certification Purchase, and Audit
FR-15: Epic 7 - Lawyer Marketplace, Certification Purchase, and Audit
FR-16: Epic 2 - Multi-School Deterministic Inheritance Engine
FR-17: Epic 7 - Lawyer Marketplace, Certification Purchase, and Audit
FR-18: Epic 4 - Save, Share, and Privacy
FR-19: Epic 4 - Save, Share, and Privacy
