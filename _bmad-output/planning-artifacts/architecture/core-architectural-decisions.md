# Core Architectural Decisions

## Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Database: PostgreSQL 17.x (fallback 16.x if provider lags).
- Auth: Django auth + Google OAuth + email/password with MFA (email + TOTP + WhatsApp via Meta Cloud API).
- API: REST + versioned routes (/api/v1) with OpenAPI docs.
- Frontend state and routing: Next.js App Router, React Query + Zustand.
- Anonymous draft persistence: browser-local IndexedDB drafts for unsigned users, with explicit opt-in server persistence only on save/share.
- Share-link authorization: opaque, signed share tokens with server-side hashed storage, expiry, revocation, and explicit private/public access modes.
- PDF generation: canonical server-side HTML-to-PDF rendering in Django reports service via WeasyPrint.
- Accessibility enforcement: CI-level keyboard, reduced-motion, RTL, and automated accessibility gates.
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

## Data Architecture

- Database: PostgreSQL 17.x (fallback 16.x if provider lags).
- ORM & migrations: Django ORM + built-in migrations.
- Validation: Django model constraints + DRF serializers.
- Caching: Redis 8 series for cache/session/rate-limiting when needed.
- Anonymous draft persistence: unsigned users work against a client-side draft store in IndexedDB, keyed by a generated `draft_id`, with schema-version metadata and automatic invalidation on incompatible payload changes.
- Draft retention: local drafts expire after 30 days of inactivity by default; users can manually clear them at any time.
- Persistence boundary: no PII is written to the server until the user explicitly saves a case, requests protected sharing, or enters a certification flow that requires a persisted case record.
- Draft reconciliation: once a user authenticates and chooses to save, the client submits the current draft snapshot to `/api/v1/cases` and receives a canonical persisted case identifier; local draft metadata stores the mapping for resume flows.

## Authentication & Security

- Auth stack: Django native auth + django-allauth + django-otp.
- Auth methods: Google OAuth (Gmail) + email/password.
- MFA: Email + TOTP + WhatsApp (Meta WhatsApp Cloud API).
- Tokens: Short-lived JWT access + refresh tokens.
- Security: TLS 1.3 in transit, AES-256 at rest (provider + optional app-level).
- PII: Ephemeral sessions by default; persist on "Save case".
- Share-link authorization: every shareable link uses an opaque random token, signed for transport integrity and stored server-side as a hash so raw tokens are never persisted.
- Share-link modes: `private_invite` is the default mode and requires an authenticated, authorized recipient; `public_link` is optional, must be explicitly confirmed by the owner, and is visually labeled as public everywhere it is displayed.
- Share-link controls: links support expiry timestamps, revocation, audit logging, and minimum scopes such as `view_report` and `view_case_summary`; certification actions always require full authenticated access and cannot be performed via share token alone.
- Anonymous-user protection: unsigned users can generate only local drafts and non-persistent previews; any action that stores or distributes case data server-side requires authentication and explicit consent.

## API & Communication Patterns

- API style: REST (DRF) with versioned routes `/api/v1`.
- Documentation: OpenAPI 3 via drf-spectacular.
- Error handling: RFC 7807-style Problem+JSON responses.
- Rate limiting: DRF throttling; Redis-backed counters when needed.
- Contract tests: Yes, to ensure UI/engine alignment.
- Draft and sharing endpoints: add explicit endpoints for draft promotion and controlled sharing, including `/api/v1/cases`, `/api/v1/share-links`, `/api/v1/share-links/{id}/revoke`, and `/api/v1/reports/{id}/pdf`.
- PDF generation strategy: the frontend never generates the canonical court PDF. The web app renders an HTML preview, while the backend reports service renders the authoritative PDF from server-controlled templates and engine outputs.
- Long-running report jobs: PDF generation runs as an asynchronous job when the report is complex or certified, returning a job identifier for polling; simple draft PDFs may complete inline when safely under request time limits.
- Share-link API semantics: private invites resolve authorization against the current user session plus the share grant, while public links resolve against token validity, expiry, and report visibility rules only.

## Frontend Architecture

- State: React Query for server state; Zustand for shared UI state.
- Routing: Next.js App Router only.
- Forms: React Hook Form + Zod.
- Performance: Dynamic import for heavy tree visualization; memoized node render.
- i18n/RTL: next-intl with dir switching; Tailwind logical properties.
- Visualization: React Flow first; migrate to custom SVG/d3 if perf issues.
- Anonymous draft state: interview progress is stored locally in IndexedDB through a dedicated draft repository abstraction, not in ad hoc `localStorage` keys, so the schema can be versioned and tested.
- Resume behavior: the app restores the latest compatible local draft on return, with clear user choice to resume, discard, or start a new case.
- PDF UX boundary: the frontend provides preview, download status, and retry controls, but never becomes the source of truth for court formatting or certification state.
- Accessibility enforcement: every interactive flow must support full keyboard navigation, visible focus states, `prefers-reduced-motion`, screen-reader labels, and RTL-correct focus order.
- Accessibility test stack: use Playwright for end-to-end keyboard and reduced-motion flows, plus axe-based automated assertions in CI for page-level accessibility regressions.

## Infrastructure & Deployment

- Hosting: Hetzner Cloud VMs.
- Deployment: Docker Compose multi-container stack.
- Reverse proxy/TLS: Caddy with automatic HTTPS.
- CI/CD: GitHub Actions build/test/deploy.
- Environments: dev / staging / prod separation.

## Decision Impact Analysis

**Implementation Sequence:**
- Establish repo structure + baseline starters.
- Stand up Django API with auth + Postgres.
- Implement Next.js interview UI + API contracts.
- Implement browser-local anonymous draft persistence and draft promotion flow before save/share features.
- Add reporting pipeline and PDF generation.
- Add share-link issuance, revocation, and authorization enforcement.
- Add accessibility CI gates before broad feature expansion.
- Add WhatsApp notification flow (Meta Cloud API).

**Cross-Component Dependencies:**
- Auth decisions affect API permissions and UI flows.
- Deterministic engine constraints shape API contract and validation rules.
- RTL/i18n decisions influence UI component architecture and design tokens.
- Anonymous draft persistence affects interview state modeling, save flows, and privacy guarantees.
- Share-link authorization affects reports, verification, audit, and invite flows.
- The PDF strategy affects reports service boundaries, asset loading, and certification trust guarantees.
- Accessibility enforcement affects component primitives, CI, and UX acceptance criteria.
