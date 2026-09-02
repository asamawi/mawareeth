---
title: 'Django Production Hardening and CI Release Gates'
type: 'feature'
created: '2026-09-02'
status: 'done'
review_loop_iteration: 0
baseline_commit: '3cc48fd12786a47507843357bf4d075b030e42cb'
context:
  - '{project-root}/_bmad-output/specs/spec-heroku-to-hetzner/SPEC.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-mawareeth-2026-09-02/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** The current Django application and build pipeline still fail open in production-critical areas: unsafe settings defaults, no readiness or release-identity checks, release-time schema generation, and a Docker build that can publish broken static assets. Until those gates are closed, any later Hetzner runtime or cutover work would be promoting artifacts that are not safe to run.

**Approach:** Keep the existing WSGI Django monolith intact and harden it in place. Upgrade and lock the runtime for Django 5.2 LTS, make configuration fail closed, add operational health endpoints, and require CI to validate migrations, static assets, deploy checks, and the only publishable image.

## Boundaries & Constraints

**Always:** Preserve `mawareeth.wsgi` as one deployable application; keep `DATABASE_URL` as the primary database input but make transport security explicit rather than `DEBUG`-driven; reuse `mawareeth/settings.py`; add shallow liveness, dependency-aware readiness, and release-identity checks outside end-user flows; require Django 5.2 LTS, committed migrations, `collectstatic`, and `manage.py check --deploy` before CI publishes an artifact.

**Ask First:** Confirm the final production hostname and `CSRF_TRUSTED_ORIGINS` if inventory differs from current assumptions; change secret names or OAuth callback hostnames only with coordinated provider updates; delete legacy CI files only if no external process still depends on them.

**Never:** Do not introduce Next.js, DRF extraction, repo splitting, or unrelated product features. Do not add Compose, Caddy, backup, monitoring, rehearsal, or cutover assets here. Do not keep Heroku `makemigrations` as a release hook, allow wildcard hosts or fallback production secrets, publish a soft-failed static build, or let CI generate schema history absent from Git.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Production-safe build | A commit with committed migrations, locked dependencies, exact hosts/origins, and build-safe secrets | CI runs migration checks, tests, `collectstatic`, and `check --deploy`, then publishes the only deployable image and release metadata | Any failed gate blocks publication |
| Fail-closed configuration | Required secret, host, trusted origin, or database transport setting is missing or malformed | The application refuses production validation and readiness does not report success | CI or startup fails before the artifact is releasable |
| Ops health probe | A running image receives liveness, readiness, and release-identity probes | Liveness stays cheap, readiness confirms Django plus database reachability, and release identity exposes the expected non-secret marker | Endpoint failures return non-success without leaking diagnostics |

</frozen-after-approval>

## Code Map

- `mawareeth/settings.py:36-41,111-118,171-218` -- fail-open defaults, `DATABASE_URL` SSL coupling, WhiteNoise, and proxy-security toggles already live here.
- `mawareeth/urls.py:22-29,79-83` -- no health or release endpoints exist yet.
- `mawareeth/wsgi.py:1-13` and `manage.py:1-17` -- stable monolith entrypoints that must remain the deploy target.
- `Dockerfile:1-27` -- single-stage root image that copies the full repository and tolerates failed `collectstatic`.
- `Procfile:1-3` and `Procfile.windows:1-3` -- release-time `makemigrations` currently contradicts the architecture.
- `.github/workflows/django.yml:1-52` and `.travis.yml:1-18` -- plain `makemigrations`, PostgreSQL 14, and missing production-shaped gates.
- `requirements.txt:1-15` and `.python-version:1` -- open-ended runtime and dependency constraints that must be pinned for reproducible builds.
- `calc/models.py` and `user_auth/models.py` -- ORM-backed durable state with no repository upload storage surface.

## Tasks & Acceptance

**Execution:**
- [x] `requirements.txt`, `.python-version`, `requirements.lock` -- upgrade and lock the Django 5.2 production runtime -- reproducible builds are a release gate.
- [x] `mawareeth/settings.py`, `mawareeth/urls.py`, `mawareeth/ops_views.py`, `mawareeth/tests.py` -- make production configuration fail closed, decouple database TLS from `DEBUG`, require exact hosts/origins, and add liveness, readiness, and release-identity coverage -- the app must expose real deployment gates.
- [x] `Dockerfile`, `.dockerignore` -- replace the permissive image with a multi-stage, non-root, hard-gated build that owns static assets inside the image -- CI must not publish broken artifacts.
- [x] `Procfile`, `Procfile.windows` -- remove release-time schema generation and stop implying deploy-time `makemigrations` -- schema history must come only from committed migrations.
- [x] `.github/workflows/django.yml`, `.github/workflows/deploy.yml`, `.travis.yml` -- make GitHub Actions run `makemigrations --check --dry-run`, `migrate`, `collectstatic`, `check --deploy`, tests, and image publication against the target stack, while retiring duplicate legacy CI behavior -- CI becomes the only release producer for this slice.

**Acceptance Criteria:**
- Given production settings are missing a required secret, exact host, trusted origin, or explicit database transport policy, when CI or startup validation runs, then the release fails before any artifact is published.
- Given a release commit contains committed migrations and static assets, when the CI pipeline runs, then it verifies `makemigrations --check --dry-run`, `migrate`, `collectstatic`, `check --deploy`, and the test suite before publishing a pinned image and release metadata.
- Given the application is built from the production image, when liveness, readiness, and release-identity endpoints are probed, then they return the expected health semantics without leaking diagnostics.
- Given the application points at a private local PostgreSQL service or a managed database, when it boots with the configured `DATABASE_URL`, then transport security follows an explicit setting rather than `DEBUG`-driven SSL assumptions.

## Spec Change Log

## Verification

**Commands:**
- `python manage.py test` -- expected: application tests pass on the upgraded runtime
- `python manage.py makemigrations --check --dry-run` -- expected: no uncommitted schema changes are generated
- `python manage.py migrate --noinput` -- expected: migrations apply cleanly on a fresh target PostgreSQL service
- `python manage.py collectstatic --noinput` -- expected: static manifest builds without fallback or ignored errors
- `python manage.py check --deploy` -- expected: production-shaped settings pass Django deployment checks
- `docker build -t mawareeth-migration-test .` -- expected: image builds successfully with hard static and dependency gates

## Suggested Review Order

**Production configuration and operations**

- Fail-closed environment parsing makes unsafe production configuration impossible to start.
  [`settings.py:20`](../../mawareeth/settings.py#L20)

- Explicit hosts, TLS policy, and database construction replace DEBUG-coupled behavior.
  [`settings.py:36`](../../mawareeth/settings.py#L36)

- Public probes separate cheap liveness, dependency readiness, and release identity.
  [`ops_views.py:15`](../../mawareeth/ops_views.py#L15)

- Routes expose operational endpoints outside end-user application flows.
  [`urls.py:26`](../../mawareeth/urls.py#L26)

**Reproducible release artifact**

- Multi-stage non-root image pins its base and hard-gates static/deploy validation.
  [`Dockerfile:1`](../../Dockerfile#L1)

- Runtime release metadata is injected from immutable build arguments.
  [`Dockerfile:46`](../../Dockerfile#L46)

- Build context excludes environment files and runtime secrets.
  [`.dockerignore:3`](../../.dockerignore#L3)

**CI release gates and supporting evidence**

- CI validates committed schema, migration, static, deploy, and test gates.
  [`django.yml:47`](../../.github/workflows/django.yml#L47)

- Publishing passes the workflow commit into the image’s release metadata.
  [`deploy.yml:43`](../../.github/workflows/deploy.yml#L43)

- Tests cover malformed production configuration, probes, and executable CI gates.
  [`tests.py:40`](../../mawareeth/tests.py#L40)
