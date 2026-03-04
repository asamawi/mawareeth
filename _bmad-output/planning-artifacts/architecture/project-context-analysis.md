# Project Context Analysis

## Requirements Overview

**Functional Requirements:**
- Deterministic inheritance engine covering 4 Sunni Madhabs + Jafari with recursive Manasikhat handling and proof generation.
- Guided interview with dynamic branching, real-time share previews, and fiqh-aware validation.
- Court-ready reporting with citations, kinship graph, and verification status.
- Verification workflow for lawyers with certification and audit logging.
- Privacy-first calculation mode with optional persistence and anonymization.

**Non-Functional Requirements:**
- Performance: standard <200ms, complex Manasikhat <1s.
- Reliability: 99.9% uptime and deterministic logic via versioned engine updates.
- Security: TLS 1.3, AES-256 at rest, dual-state storage, QR verification.
- Accessibility: WCAG 2.1 AA with RTL/LTR support and mobile-first performance.

**Scale & Complexity:**
- Primary domain: full-stack web application with computational engine and court-grade reporting.
- Complexity level: high.
- Estimated architectural components: 7-10 (UI/UX shell, interview orchestration, tree visualization, rules engine, reporting, verification/audit, persistence, API gateway).

## Technical Constraints & Dependencies

- Frontend: Next.js App Router, shadcn/ui, Tailwind, React Hook Form, Zod.
- Backend: Python 3.12 + Django; versioned REST API.
- Deterministic "logic-as-code" policy: no manual overrides.
- Testing emphasis: Playwright E2E for UI/logic alignment.
- Multilingual/RTL requirements (Arabic/English/French).

## Cross-Cutting Concerns Identified

- Determinism and auditability across all layers.
- Security and privacy posture (dual-state storage, encryption).
- Accessibility and RTL/LTR correctness.
- Performance under complex graph traversal.
- Certification workflow and legal compliance.
