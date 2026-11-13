# Project Structure & Boundaries

## Complete Project Directory Structure
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

## Architectural Boundaries

**API Boundaries:**
- `/api/v1/auth/*` → users/auth app
- `/api/v1/cases/*` → cases + heirs
- `/api/v1/engine/*` → deterministic engine (no manual overrides)
- `/api/v1/reports/*` → PDF generation + verification status
- `/api/v1/verification/*` → lawyer certification + audit (**private package**, AD-14)

**Component Boundaries:**
- `web/src/features/*` owns feature logic and state.
- `web/src/components/*` holds reusable UI and layout primitives.
- `web/src/lib/*` holds API clients and shared utilities.

**Service Boundaries:**
- Engine is a pure domain module in `api/apps/engine` with strict validation, no DB writes.
- Reports service reads engine outputs, renders canonical HTML report templates, and generates PDFs via WeasyPrint.
- Draft session logic lives in the web app until explicit save, with the API receiving only promoted persisted cases.
- Share-link service owns token issuance, hashing, expiry, revocation, and permission checks for report access.
- Verification service writes audit logs and status changes.

**Data Boundaries:**
- Case data in `cases`/`heirs`.
- Engine uses read-only snapshots of case data.
- Anonymous draft data remains browser-local until explicit promotion to a persisted case.
- Share tokens are stored hashed with metadata and never treated as primary identifiers for cases or reports.
- Audit is append-only.

**Open-Core Ownership (AD-14):**
- Public repository: `api/apps/engine`, cases/heirs, draft reports and share links for drafts, `web/src/features/interview`, `web/src/features/reports` (draft rendering), the known-answer corpus.
- Private package: lawyer accounts and approval, membership/pricing/sponsorship, marketplace, certification purchase and action, `verification`, certification `audit`, billing, the certification registry and its signing keys.
- Report status is the only seam: public code reads it through an extension point that returns "draft" when the private package is absent; only the private package can set "certified" or render a seal.
- The private package may import public modules; public modules never import private ones, and public CI never needs private access.

## Requirements to Structure Mapping

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

## Integration Points

**Internal Communication:**
- Web ↔ API via REST + OpenAPI contract
- Engine output consumed by reports/verification services
- Report generation jobs and share-link authorization events emit auditable status transitions

**External Integrations:**
- WhatsApp Cloud API → `api/core/notifications/whatsapp`
- Email + MFA → `api/core/notifications/email`
- Payments (future) → billing in the **private package** (deferred; AD-14)

**Data Flow:**
- Anonymous interview → IndexedDB draft snapshot → explicit save/promote → persisted case snapshot → Engine calc → Report HTML/PDF → Verification → Audit
- Persisted report → share-link issuance/revocation → authorized recipient access → audit trail

## File Organization Patterns

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

## Development Workflow Integration

**Development Server Structure:**
- `docker-compose` runs web + api + db + redis + caddy

**Build Process Structure:**
- Web builds to `web/.next`
- API builds via Docker image

**Deployment Structure:**
- Compose deploys on Hetzner with Caddy as edge
