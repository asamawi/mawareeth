---
title: 'Make Django Production-Ready'
type: 'feature'
created: '2026-10-11'
status: 'done'
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

### Review Findings

- [x] [Review][Decision] Merging to `master` can stop the live Heroku dyno from booting before 0-1 inventory exists — production now fails closed without `MAILGUN_ACCESS_KEY`/`MAILGUN_SERVER_NAME` or with `DATABASE_SSL_MODE=prefer`; 0-1 is still `backlog` and `master` is a deploy branch (`Procfile`, `deploy.yml`). The spec's own follow-up is unresolved. **Resolved (2026-10-11):** Ahmad confirmed Heroku production sets the required vars; merge as-is.
- [x] [Review][Decision] Production still accepts `DATABASE_SSL_MODE=require` — resolved: restrict production to `disable` or `verify-*` (now a patch below). **Reversed (2026-10-11):** Heroku Postgres (AWS RDS endpoint) cannot verify certificates; setting `verify-full` there took the live app down. `require` is allowed again in production until the Heroku exit; `prefer` stays rejected.
- [x] [Review][Patch] ~~Reject `DATABASE_SSL_MODE=require` in production~~ — applied, then reverted for Heroku compatibility (see decision above) [mawareeth/settings.py:28]
- [x] [Review][Patch] Health responses skip every response-side security header (HSTS, nosniff, Referrer-Policy, COOP) because `HealthCheckMiddleware` returns before `SecurityMiddleware` [mawareeth/middleware.py:166]
- [x] [Review][Patch] `ready()` swallows every exception without logging, so a dead DB, pending migrations and a broken loader can't be told apart [mawareeth/ops_views.py:37]
- [x] [Review][Patch] The "newer-release migrations are ignored" blue/green property is untested; add a test that records an unknown applied migration and asserts 200 [mawareeth/tests.py:143]
- [x] [Review][Patch] New settings tests use bare `assertRaises`; use `assertRaisesRegex` on the setting name, and add non-production negatives (`prefer`, and `verify-*` without a cert, are allowed) [mawareeth/tests.py:307]
- [x] [Review][Patch] `DATABASE_SSL_ROOT_CERT` isn't checked to be a readable file in production; the README should say it is a mounted file path [mawareeth/settings.py:241]
- [x] [Review][Patch] The health bypass matches exact trailing-slash paths only; a slashless probe such as `/health/ready` on a slot hostname gets 400 [mawareeth/middleware.py:165]
- [x] [Review][Defer] Readiness DB queries are bounded only by `connect_timeout`, with no statement timeout; a stalled DB can hold a gunicorn worker [mawareeth/ops_views.py:8] — deferred, pre-existing
- [x] [Review][Defer] The Dockerfile's build-time `collectstatic`/`check --deploy` env is only regex-checked before merge, not executed [Dockerfile:28] — deferred, belongs to 0-3 (CI artifacts)
- [x] [Review][Defer] `check --deploy` runs against build placeholders, so runtime config (e.g. `DJANGO_KEY` strength, W009) is never deploy-checked [Dockerfile:44] — deferred, pre-existing
- [x] [Review][Defer] `/health/release/` exposes the exact version and commit SHA publicly; no decision on record [mawareeth/ops_views.py:44] — deferred, pre-existing
- [x] [Review][Defer] Runtime contract relies on Caddy overwriting a client-supplied `X-Forwarded-Proto`; document and enforce it in the Caddy config [deploy/README.md:26] — deferred, belongs to 0-5
- [x] [Review][Defer] Reject `DATABASE_SSL_MODE=require` in production once off Heroku Postgres [mawareeth/settings.py:28] — deferred, blocked on Heroku exit
