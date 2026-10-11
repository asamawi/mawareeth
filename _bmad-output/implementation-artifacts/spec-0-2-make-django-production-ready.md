---
title: 'Make Django Production-Ready'
type: 'feature'
created: '2026-10-11'
status: 'review'
review_loop_iteration: 0
baseline_commit: 'e1159a7a42fc326efed8d3eed17b5afe7f1fa2ce'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-0-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-mawareeth-2026-09-02/ARCHITECTURE-SPINE.md'
---

## Intent

**Problem:** The brownfield monolith must satisfy the production gates in CAP-1, CAP-4, and CAP-5 before any Hetzner runtime consumes it.

**Approach:** Most of the story landed earlier in `763c7c2` (Django 5.2 LTS, fail-closed production settings, health endpoints, CI gates) without the story being tracked. This pass audited each acceptance criterion against the private Compose topology described in the epic context and closed the gaps found.

## Gap Audit (against baseline)

| Area | Baseline behaviour | Gap | Resolution |
|------|--------------------|-----|------------|
| Private health probes | `/health/*` subject to `ALLOWED_HOSTS` and `SECURE_SSL_REDIRECT` | Probes to `app-blue:8000` returned 400; plain-HTTP probes returned 301, so Caddy/Docker/deploy checks would see every slot as unhealthy | `HealthCheckMiddleware` (first in `MIDDLEWARE`) answers exact GET/HEAD health paths before host validation and redirect |
| Readiness | `SELECT 1` only | Not schema-aware; a slot with unapplied migrations reported ready | Readiness also requires an empty migration plan for this release's leaf nodes; migrations from a newer release are ignored so the old slot stays ready during expand/migrate |
| `check --deploy` gate | Exit code 0 on warnings | All `security.W*` deploy checks are warnings, so the gate never failed (verified: 7 warnings, exit 0) | `--fail-level WARNING` in CI and the Dockerfile build |
| Database TLS policy | Any libpq mode accepted | `prefer` silently falls back to plaintext; `verify-*` had no CA path | `prefer` rejected in production; `verify-ca`/`verify-full` require `DATABASE_SSL_ROOT_CERT` (passed as `sslrootcert`) |
| Required secrets | Mailgun defaulted to `dummy` | Production would start with broken email | `MAILGUN_ACCESS_KEY`/`MAILGUN_SERVER_NAME` required in production |
| Probe caching | No cache headers | Intermediaries could cache health state | `never_cache` on all three endpoints |

## Code Map

- `mawareeth/middleware.py` -- new `HealthCheckMiddleware`.
- `mawareeth/ops_views.py` -- schema-aware readiness, `never_cache`.
- `mawareeth/settings.py` -- middleware order, DB TLS policy, required Mailgun settings.
- `Dockerfile`, `.github/workflows/django.yml` -- strict deploy checks; build-only Mailgun placeholders.
- `mawareeth/tests.py` -- settings, readiness, private-probe, and build-gate contract tests.
- `deploy/README.md` -- application runtime contract for 0-5/0-6.

## Acceptance Criteria

- [x] Django is upgraded to 5.2 LTS with tests passing -- Django 5.2.17; 58 tests pass in production mode.
- [x] Database TLS policy, explicit hosts and trusted origins, proxy security, and required secrets work for the private Compose topology.
- [x] Static collection and `manage.py check --deploy` fail the build on error -- chained in the image build and separate CI steps; deploy checks now fail on warnings.
- [x] Liveness, dependency-aware readiness, and release identity endpoints are implemented without leaking diagnostics.

## Follow-ups / Risks

- Before this reaches a branch Heroku deploys from, confirm via the 0-1 inventory that Heroku sets `MAILGUN_ACCESS_KEY`, `MAILGUN_SERVER_NAME`, and a non-`prefer` `DATABASE_SSL_MODE` whenever `DJANGO_ENV=production`; otherwise the dyno will refuse to boot.
- Readiness runs a migration-graph load per probe; acceptable at probe intervals, revisit if probe frequency rises sharply.
