---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/ux-design-specification.md
workflowType: 'architecture'
project_name: 'mawareeth'
user_name: 'Ahmad'
date: '2026-03-04T00:55:44+03:00'
lastStep: 8
status: 'complete'
completedAt: '2026-03-04T01:26:00+03:00'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

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

### Technical Constraints & Dependencies

- Frontend: Next.js App Router, shadcn/ui, Tailwind, React Hook Form, Zod.
- Backend: Python 3.12 + Django; versioned REST API.
- Deterministic "logic-as-code" policy: no manual overrides.
- Testing emphasis: Playwright E2E for UI/logic alignment.
- Multilingual/RTL requirements (Arabic/English/French).

### Cross-Cutting Concerns Identified

- Determinism and auditability across all layers.
- Security and privacy posture (dual-state storage, encryption).
- Accessibility and RTL/LTR correctness.
- Performance under complex graph traversal.
- Certification workflow and legal compliance.

## Starter Template Evaluation

### Primary Technology Domain

Full-stack web application (interactive Next.js frontend + Django REST backend + deterministic compute engine)

### Starter Options Considered

1. **Next.js official starter (create-next-app)**
   - Best fit for App Router + TypeScript + Tailwind + App Router defaults.
   - Officially supported and keeps us on the "happy path" for Next.js.

2. **shadcn/ui CLI initialization**
   - Adds design system primitives and Tailwind setup for component-driven UI.

3. **Cookiecutter Django**
   - Production-ready Django starter with Postgres, DRF, CI options, and optional Docker.

### Selected Starter: Next.js + shadcn/ui (frontend) + Cookiecutter Django (backend)

**Rationale for Selection:**
- Matches stated stack preferences (Next.js App Router, Tailwind, TypeScript, Django, Postgres).
- Provides a clean, maintainable base without over-committing to SaaS boilerplates (payments later).
- Supports CI/CD workflows from day one (frontend via standard CI, backend via cookiecutter options).

**Initialization Commands:**

Frontend (Next.js App Router + TS + Tailwind):
```bash
npx create-next-app@latest mawareeth-web --ts --tailwind --eslint --app --src-dir --import-alias "@/*"
```

UI system (shadcn/ui init):
```bash
pnpm dlx shadcn@latest init
```

Backend (Django + DRF + Postgres via Cookiecutter):
```bash
pipx run cookiecutter gh:cookiecutter/cookiecutter-django
```

**Architectural Decisions Provided by Starters:**

**Language & Runtime:**
- Frontend: TypeScript + React (Next.js App Router).
- Backend: Python + Django (choose DRF during cookiecutter prompts).

**Styling Solution:**
- Tailwind CSS baseline from Next.js starter.
- shadcn/ui components initialized into the project for controlled, local customization.

**Build Tooling:**
- Next.js build pipeline with App Router defaults.
- Django project structure with environment-based settings (cookiecutter).

**Testing Framework:**
- Frontend: ESLint configured; E2E can be added (Playwright planned).
- Backend: Cookiecutter offers CI selection (choose GitHub Actions) and test scaffolding.

**Code Organization:**
- Next.js `src/` layout and App Router conventions.
- Django modular settings and standard app structure.

**Development Experience:**
- Hot reload and fast dev server on both ends.
- CI/CD ready with GitHub Actions and container-friendly layout (use Docker in cookiecutter if desired).

**Note:** Hetzner deployment is compatible but not enforced by these starters. We can target container-based deployments to keep cloud portability.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Database: PostgreSQL 17.x (fallback 16.x if provider lags).
- Auth: Django auth + Google OAuth + email/password with MFA (email + TOTP + WhatsApp via Meta Cloud API).
- API: REST + versioned routes (/api/v1) with OpenAPI docs.
- Frontend state and routing: Next.js App Router, React Query + Zustand.
- Deployment: Hetzner VM + Docker Compose + Caddy + GitHub Actions CI/CD.

**Important Decisions (Shape Architecture):**
- Validation: Django model constraints + DRF serializers.
- Caching: Redis 8 series (optional MVP).
- Error handling: Problem+JSON style errors.
- i18n: next-intl with RTL/LTR switching via logical properties.
- Visualization: React Flow first, migrate to custom SVG/d3 if perf issues.

**Deferred Decisions (Post-MVP):**
- Payments provider and billing architecture (not required in MVP).
- AI validator integration into CI/CD.

### Data Architecture

- Database: PostgreSQL 17.x (fallback 16.x if provider lags).
- ORM & migrations: Django ORM + built-in migrations.
- Validation: Django model constraints + DRF serializers.
- Caching: Redis 8 series for cache/session/rate-limiting when needed.

### Authentication & Security

- Auth stack: Django native auth + django-allauth + django-otp.
- Auth methods: Google OAuth (Gmail) + email/password.
- MFA: Email + TOTP + WhatsApp (Meta WhatsApp Cloud API).
- Tokens: Short-lived JWT access + refresh tokens.
- Security: TLS 1.3 in transit, AES-256 at rest (provider + optional app-level).
- PII: Ephemeral sessions by default; persist on "Save case".

### API & Communication Patterns

- API style: REST (DRF) with versioned routes `/api/v1`.
- Documentation: OpenAPI 3 via drf-spectacular.
- Error handling: RFC 7807-style Problem+JSON responses.
- Rate limiting: DRF throttling; Redis-backed counters when needed.
- Contract tests: Yes, to ensure UI/engine alignment.

### Frontend Architecture

- State: React Query for server state; Zustand for shared UI state.
- Routing: Next.js App Router only.
- Forms: React Hook Form + Zod.
- Performance: Dynamic import for heavy tree visualization; memoized node render.
- i18n/RTL: next-intl with dir switching; Tailwind logical properties.
- Visualization: React Flow first; migrate to custom SVG/d3 if perf issues.

### Infrastructure & Deployment

- Hosting: Hetzner Cloud VMs.
- Deployment: Docker Compose multi-container stack.
- Reverse proxy/TLS: Caddy with automatic HTTPS.
- CI/CD: GitHub Actions build/test/deploy.
- Environments: dev / staging / prod separation.

### Decision Impact Analysis

**Implementation Sequence:**
- Establish repo structure + baseline starters.
- Stand up Django API with auth + Postgres.
- Implement Next.js interview UI + API contracts.
- Add reporting pipeline and PDF generation.
- Add WhatsApp notification flow (Meta Cloud API).

**Cross-Component Dependencies:**
- Auth decisions affect API permissions and UI flows.
- Deterministic engine constraints shape API contract and validation rules.
- RTL/i18n decisions influence UI component architecture and design tokens.

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**Critical Conflict Points Identified:**
14 areas where AI agents could make different choices

### Naming Patterns

**Database Naming Conventions:**
- Tables: snake_case plural (e.g., `inheritance_cases`)
- Columns: snake_case (e.g., `user_id`, `case_status`)
- FKs: `{table}_id` (e.g., `case_id`)
- Indexes: `idx_{table}_{column}`

**API Naming Conventions:**
- REST endpoints: plural nouns (e.g., `/cases`, `/heirs`)
- Route params: `{id}` in docs, `:id` in Next.js routes
- Query params: snake_case (e.g., `case_id`)
- Headers: `X-Request-ID`, `X-Client-Version`

**Code Naming Conventions:**
- React components: PascalCase (e.g., `FamilyTreeVisualizer`)
- Files: kebab-case (e.g., `family-tree-visualizer.tsx`)
- Functions: camelCase in TS, snake_case in Python
- Variables: camelCase in TS, snake_case in Python

### Structure Patterns

**Project Organization:**
- Frontend: `src/app`, `src/components`, `src/features`, `src/lib`, `src/types`
- Backend: `apps/` for Django apps, `core/` for shared utilities
- Tests: colocated `*.test.tsx` in frontend; `tests/` per app in backend

**File Structure Patterns:**
- Config: `.env.*` at repo root, `settings/` in Django
- Static assets: `public/` (frontend), `static/` (backend)
- Docs: `docs/` only; ADRs in `docs/adr/`

### Format Patterns

**API Response Formats:**
- Success: `{ "data": ..., "meta": ... }`
- Error: RFC 7807 Problem+JSON format

**Data Exchange Formats:**
- JSON fields: snake_case in API payloads
- Dates: ISO 8601 strings
- Booleans: true/false only

### Communication Patterns

**Event System Patterns:**
- If internal events used: `domain.action` (e.g., `case.created`)
- Payloads: `{ event_id, occurred_at, data }`

**State Management Patterns:**
- Server state: React Query
- UI state: Zustand store per feature, no cross-feature global store
- Immutable updates in TS

### Process Patterns

**Error Handling Patterns:**
- API errors normalized to Problem+JSON
- UI error banners use a single `AppError` shape

**Loading State Patterns:**
- Single `loading` boolean per feature slice
- Skeletons for tree + report views

### Enforcement Guidelines

**All AI Agents MUST:**
- Follow naming conventions by language (TS vs Python).
- Keep API payloads snake_case and map to camelCase at UI boundary.
- Use Problem+JSON for all error responses.

**Pattern Enforcement:**
- Linting rules + API contract tests
- PR checklist in `docs/adr/0001-patterns.md`

### Pattern Examples

**Good Examples:**
- `GET /api/v1/cases?case_id=123`
- `FamilyTreeVisualizer` in `family-tree-visualizer.tsx`

**Anti-Patterns:**
- `GET /api/v1/case/123`
- `UserCard.tsx` file name with `user_card` Python naming

## Project Structure & Boundaries

### Complete Project Directory Structure
```
mawareeth/
├── README.md
├── .gitignore
├── .env.example
├── docker-compose.yml
├── docker/
│   ├── caddy/
│   │   └── Caddyfile
│   ├── web/
│   │   └── Dockerfile
│   └── api/
│       └── Dockerfile
├── .github/
│   └── workflows/
│       └── ci.yml
├── web/
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.js
│   ├── tailwind.config.ts
│   ├── postcss.config.js
│   ├── public/
│   └── src/
│       ├── app/
│       ├── components/
│       │   ├── ui/
│       │   └── features/
│       ├── features/
│       │   ├── interview/
│       │   ├── results/
│       │   ├── auth/
│       │   └── reports/
│       ├── lib/
│       ├── hooks/
│       ├── state/
│       ├── styles/
│       ├── types/
│       └── middleware.ts
└── api/
    ├── pyproject.toml
    ├── manage.py
    ├── config/
    │   ├── settings/
    │   ├── urls.py
    │   └── wsgi.py
    ├── apps/
    │   ├── users/
    │   ├── cases/
    │   ├── heirs/
    │   ├── engine/
    │   ├── reports/
    │   ├── verification/
    │   └── audit/
    ├── core/
    │   ├── auth/
    │   ├── permissions/
    │   ├── validators/
    │   └── utils/
    ├── tests/
    │   ├── unit/
    │   ├── integration/
    │   └── e2e/
    └── requirements/
```

### Architectural Boundaries

**API Boundaries:**
- `/api/v1/auth/*` → users/auth app
- `/api/v1/cases/*` → cases + heirs
- `/api/v1/engine/*` → deterministic engine (no manual overrides)
- `/api/v1/reports/*` → PDF generation + verification status
- `/api/v1/verification/*` → lawyer certification + audit

**Component Boundaries:**
- `web/src/features/*` owns feature logic and state.
- `web/src/components/*` holds reusable UI and layout primitives.
- `web/src/lib/*` holds API clients and shared utilities.

**Service Boundaries:**
- Engine is a pure domain module in `api/apps/engine` with strict validation, no DB writes.
- Reports service reads engine outputs and generates PDFs.
- Verification service writes audit logs and status changes.

**Data Boundaries:**
- Case data in `cases`/`heirs`.
- Engine uses read-only snapshots of case data.
- Audit is append-only.

### Requirements to Structure Mapping

**Feature Mapping:**
- Universal Inheritance Engine → `api/apps/engine`, `web/src/features/interview`
- Guided Interview → `web/src/features/interview`, `web/src/components/features`
- Court-Ready Reporting → `api/apps/reports`, `web/src/features/reports`
- Verification → `api/apps/verification`, `api/apps/audit`, `web/src/features/reports`
- Privacy/PII → `api/apps/users`, `api/core/validators`, `web/src/features/auth`

**Cross-Cutting Concerns:**
- Auth/MFA → `api/apps/users`, `api/core/auth`, `web/src/features/auth`
- Logging/Audit → `api/apps/audit`
- i18n/RTL → `web/src/lib/i18n`, `web/src/styles`

### Integration Points

**Internal Communication:**
- Web ↔ API via REST + OpenAPI contract
- Engine output consumed by reports/verification services

**External Integrations:**
- WhatsApp Cloud API → `api/core/notifications/whatsapp`
- Email + MFA → `api/core/notifications/email`
- Payments (future) → `api/apps/billing` (deferred)

**Data Flow:**
- Interview → Case snapshot → Engine calc → Report → Verification → Audit

### File Organization Patterns

**Configuration Files:**
- `.env.*` in repo root
- Django settings in `api/config/settings/`

**Source Organization:**
- Feature-first in web; app-first in api

**Test Organization:**
- Frontend: co-located tests
- Backend: `api/tests/` by unit/integration/e2e

**Asset Organization:**
- Frontend `public/`
- Backend `static/` and `media/` (if needed)

### Development Workflow Integration

**Development Server Structure:**
- `docker-compose` runs web + api + db + redis + caddy

**Build Process Structure:**
- Web builds to `web/.next`
- API builds via Docker image

**Deployment Structure:**
- Compose deploys on Hetzner with Caddy as edge

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:**
- Next.js App Router + Tailwind + shadcn/ui + React Hook Form align with rich, RTL-aware UI.
- Django + DRF + Postgres align with deterministic engine and auditability.
- Docker Compose + Hetzner + Caddy + GitHub Actions form a coherent deployment pipeline.

**Pattern Consistency:**
- Naming conventions are consistent across TS and Python.
- API response format (Problem+JSON) matches UI error handling patterns.
- Data casing (snake_case in API, camelCase in UI) is explicitly defined.

**Structure Alignment:**
- Project structure maps cleanly to feature categories and service boundaries.
- Engine/report/verification boundaries are separated to preserve determinism.

### Requirements Coverage Validation ✅

**Epic/Feature Coverage:**
- All FR categories are mapped to specific modules and endpoints.

**Functional Requirements Coverage:**
- Inheritance engine, interview, reporting, verification, and privacy are all supported.

**Non-Functional Requirements Coverage:**
- Performance, reliability, security, accessibility, and localization are addressed in decisions and patterns.

### Implementation Readiness Validation ✅

**Decision Completeness:**
- All critical decisions documented; auth and API contracts defined.
- Minor: version pinning for core services can be formalized at implementation.

**Structure Completeness:**
- Directory structure is complete for frontend, backend, CI/CD, and infra.

**Pattern Completeness:**
- Naming, formatting, and error handling rules defined with examples.

### Gap Analysis Results

**Important Gaps:**
- Pin specific runtime versions (PostgreSQL, Redis, Django, DRF) in implementation docs.
- Confirm WhatsApp Cloud API setup details (phone number verification, template rules).

**Nice-to-Have Gaps:**
- Add ADRs for engine correctness validation and PDF generation pipeline.

### Validation Issues Addressed

- WhatsApp MFA provider confirmed as Meta Cloud API.
- Version pinning deferred to implementation but noted.

### Architecture Completeness Checklist

**✅ Requirements Analysis**

- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**✅ Architectural Decisions**

- [x] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [x] Performance considerations addressed

**✅ Implementation Patterns**

- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**✅ Project Structure**

- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High

**Key Strengths:**
- Deterministic engine boundaries and auditability are well-defined.
- Strong UI/UX direction with RTL support and clear data flow.
- Deployment model is portable and cost-effective.

**Areas for Future Enhancement:**
- Formalize version pinning and environment baselines.
- Add ADRs for engine correctness validation and PDF rendering.

### Implementation Handoff

**AI Agent Guidelines:**

- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently across all components
- Respect project structure and boundaries
- Refer to this document for all architectural questions

**First Implementation Priority:**
- Initialize starter templates and scaffold baseline repo structure.
