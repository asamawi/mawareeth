# Code Reconciliation Review

## Verdict

**CONDITIONAL — the spine is directionally consistent with the brownfield application, but it is not yet safe to implement without resolving one launch-blocking database contradiction and several release-safety gaps.**

The application is a good fit for the proposed single-node architecture: it is a server-rendered WSGI Django monolith, durable business data and sessions live in PostgreSQL, static assets are handled by WhiteNoise, and no `FileField`, `ImageField`, `MEDIA_ROOT`, or other durable filesystem upload path was found. The principal risks are in the production settings, migration workflow, readiness implementation, and artifact build—not in the overall topology.

## Findings

### RC-1 — BLOCKER: current `DATABASE_URL` handling requires TLS to the private Compose database

- **Spine:** AD-2 and AD-3 place Django and PostgreSQL together on a private Compose network.
- **Code:** `mawareeth/settings.py` passes `ssl_require=not DEBUG` to `dj_database_url.config()`.
- **Consequence:** With the required production setting `DEBUG=False`, Django adds `sslmode=require`. A standard PostgreSQL container does not enable server-side TLS by default, so the application can fail to connect even though the database is healthy.
- **Required reconciliation:** Decouple database transport security from `DEBUG`. For the local private service, explicitly use a non-TLS connection policy (for example `sslmode=disable`) or configure PostgreSQL TLS deliberately. Keep the setting compatible with a future managed database where TLS is required. Exercise the exact production `DATABASE_URL` in CI or a deployment smoke test.

### RC-2 — HIGH: blue-green does not by itself make all migrations zero-downtime

- **Spine:** AD-5 promises blue-green application releases; AD-6 requires expand → migrate → contract compatibility.
- **Code:** the schema has historical rename/alter migrations, including migrations generated under Django 5.2 while the current dependency constraint remains Django `<5.0`.
- **Consequence:** A migration can be logically compatible with both application versions but still acquire a PostgreSQL table lock, perform a long rewrite, or run a long data update. That can block requests in the still-active old slot. Rollback is also unsafe once an irreversible data transformation has run.
- **Required reconciliation:** Qualify the no-downtime claim as applying to routine application releases on a healthy host. Add a migration release rule: inspect SQL/lock behavior, set bounded lock timeouts, split backfills from schema changes, make migration jobs idempotent where possible, and prohibit automatic reverse migration during application rollback. Host, PostgreSQL, and Caddy maintenance remain downtime risks on one VPS.

### RC-3 — HIGH: the dependency-aware readiness endpoint required by AD-5/AD-8 does not exist

- **Spine:** the inactive slot must pass an application-and-database readiness check before Caddy switches traffic.
- **Code:** `mawareeth/urls.py` exposes no health or readiness route, and no health implementation was found.
- **Consequence:** A process-level or TCP check can mark Gunicorn healthy while Django cannot serve requests, migrations are missing, or PostgreSQL is unavailable. That defeats the deployment gate.
- **Required reconciliation:** Add a lightweight, unauthenticated readiness route that boots Django and executes a bounded database probe without leaking diagnostics. Give Gunicorn and the Compose health check explicit timeouts/retries. Caddy must switch only after readiness succeeds; public uptime monitoring may probe a separate shallow endpoint if desired.

### RC-4 — HIGH: the existing release and CI migration behavior contradict AD-6

- **Spine:** migration files are committed; production never runs `makemigrations`; exactly one migration job runs per release.
- **Code:** `Procfile` contains `release: python manage.py makemigrations` as well as a separate migrate release line. `.github/workflows/django.yml` also runs plain `makemigrations`, which can generate files instead of failing when model changes lack committed migrations.
- **Consequence:** production can generate schema history that is absent from Git, and CI can conceal missing migration files. Multiple release commands/runners can also race unless deployment serialization is explicit.
- **Required reconciliation:** Retire the Heroku release entries as part of cutover. In CI use `makemigrations --check --dry-run`, then test migrations against a fresh PostgreSQL database. Serialize production deploys and run one `migrate --noinput` job from the new image before switching traffic.

### RC-5 — HIGH: the image build deliberately accepts broken static assets

- **Spine:** CI produces the only deployable image; app containers are disposable. Static files therefore need to be complete inside that image.
- **Code:** the Dockerfile runs `python manage.py collectstatic --noinput || echo "collectstatic failed, continuing"`. Production uses `CompressedManifestStaticFilesStorage` through WhiteNoise.
- **Consequence:** CI may publish and deploy an image with missing or invalid manifest assets; readiness may still pass, producing broken pages only after traffic switches.
- **Required reconciliation:** Make `collectstatic` a hard build failure under explicit build-safe settings. Add a `.dockerignore` so environments, Git metadata, local databases, logs, and planning artifacts are not copied into the image. Verify representative static assets in the image smoke test.

### RC-6 — HIGH: production configuration currently fails open

- **Spine:** AD-4 requires runtime secrets; AD-7 requires explicit hosts and trusted proxy/security settings.
- **Code:** `DEBUG` defaults to `True`; `DJANGO_KEY` has a known testing default; `ALLOWED_HOSTS` is overwritten to `['*']`; and there is no environment-backed `CSRF_TRUSTED_ORIGINS`. `SECURE_PROXY_SSL_HEADER` is present and is appropriate only while direct access to Gunicorn is prevented.
- **Consequence:** a missing or malformed production environment can launch insecurely. Wildcard hosts weaken host-header protections, and OAuth/admin/form POSTs behind the production domain can fail CSRF validation if origins are not configured correctly.
- **Required reconciliation:** Make production fail closed: require a strong secret, default `DEBUG=False`, configure exact hostnames and trusted HTTPS origins, and retain `SECURE_PROXY_SSL_HEADER` only with Caddy as the sole path to Gunicorn. Run `manage.py check --deploy` in CI with production-shaped settings. The current check reported an HSTS warning; HSTS should be enabled only after HTTPS behavior is verified.

### RC-7 — MEDIUM: dependency and framework state is not reproducible enough for the declared artifact policy

- **Spine:** Python is pinned; Django 5.2 LTS is a cutover gate; the deployed image is immutable by digest.
- **Code:** `.python-version` pins `3.12.12`, but `requirements.txt` mostly contains open-ended ranges or unversioned dependencies, including `Django>=4.2,<5.0` and `gunicorn>=21.0`. Existing migrations show that Django 5.2 has previously generated repository state even though the install constraint is `<5.0`. The current workflow uses an unpinned PostgreSQL 14 test service while the spine targets PostgreSQL 17.
- **Consequence:** rebuilding the same commit later can resolve materially different packages; tests do not represent the target database/framework combination; and the Django upgrade may expose compatibility issues late.
- **Required reconciliation:** Produce a reviewed dependency lock with hashes, test the Django 5.2 upgrade before cutover, and test against the selected PostgreSQL major. Continue deploying only by OCI digest; also pin GitHub Actions and base/runtime images by immutable references where practical.

### RC-8 — MEDIUM: graceful drain and rollback mechanics need enforceable runtime bounds

- **Spine:** Caddy switches, old Gunicorn workers drain, and failed releases preserve the old slot.
- **Code:** the current Gunicorn command only specifies the bind address; no health timeout, graceful timeout, worker policy, or Compose stop grace period exists yet.
- **Consequence:** stopping the previous slot may terminate long requests, hang a deployment, or exceed the orchestrator grace period. A low-memory VPS must also temporarily accommodate PostgreSQL plus both application slots during each rollout.
- **Required reconciliation:** Define Gunicorn graceful timeout/worker sizing and a longer Compose `stop_grace_period`; put a maximum duration on deployment steps; preserve the prior digest and active-slot file for immediate routing rollback; and size/test the VPS at peak two-slot memory. A failed migration must not trigger an automatic schema rollback.

### RC-9 — MEDIUM: PostgreSQL volume protection is implied but needs an explicit operational invariant

- **Spine:** AD-3 names PostgreSQL as the durable owner and the capability map mentions a PostgreSQL volume; AD-9 gates public production on tested off-host restore. WAL/PITR is deliberately deferred.
- **Code:** all current durable models and Django sessions are database-backed. No durable media/upload field or filesystem-backed application state was found.
- **Consequence:** the topology is sound, but a deploy script using destructive Compose volume options, a full disk, or a mistaken database recreation would destroy the only durable copy. Deferring all backup work means accepting complete loss until AD-9 is satisfied.
- **Required reconciliation:** Make the named database volume external to slot replacement, prohibit `docker compose down -v` in deployment automation, monitor disk utilization, and preserve the AD-9 off-host restore gate before irreplaceable production data is accepted. Deferring WAL is consistent; deferring the first tested backup past production cutover is not.

### RC-10 — MEDIUM: the container is broader and more privileged than necessary

- **Spine:** immutable disposable app images and a single shared host make containment important.
- **Code:** the Dockerfile runs as root, retains build tools and development headers in the runtime image, copies the entire build context, and has no container-level read-only/capability constraints.
- **Consequence:** a Django compromise has an unnecessarily broad container foothold on the same host as PostgreSQL and Caddy, and the image is larger than needed.
- **Required reconciliation:** Use a multi-stage build, run Gunicorn as a non-root UID, keep runtime packages minimal, use a read-only root filesystem plus explicit temporary paths where feasible, drop capabilities, and ensure only Caddy publishes host ports.

## Confirmed alignments

- The live application is a single WSGI Django deployable (`mawareeth.wsgi`) and does not require a frontend/service split, supporting AD-1.
- `DATABASE_URL` is already the primary database configuration mechanism, and the default Django session engine is database-backed, supporting shared state across blue and green slots once RC-1 is fixed.
- WhiteNoise plus `STATIC_ROOT` makes image-local static assets compatible with disposable app slots, provided `collectstatic` becomes a hard gate.
- No current `FileField`, `ImageField`, `MEDIA_ROOT`, filesystem storage integration, or durable user upload path was found. Deferring object storage is therefore consistent with current code, but that decision must be revisited before adding uploads.
- The code uses Django ORM-backed persistence for the reviewed domain models. No active MongoDB usage was found despite `pymongo[srv]` being listed; remove it if dependency audit confirms it is unused.
- `SECURE_PROXY_SSL_HEADER` is already configured for TLS termination at Caddy, consistent with AD-7 when the private network prevents bypass.

## Source-to-spine disposition

| Source reality | Spine disposition | Result |
| --- | --- | --- |
| Django WSGI monolith + Gunicorn | Preserve one deployable unit | Aligned |
| PostgreSQL ORM data and DB sessions | Shared private PostgreSQL | Aligned after SSL fix |
| WhiteNoise static files | Static assets inside immutable image | Aligned after build gate fix |
| No media/upload storage | Object storage deferred | Aligned |
| Heroku `makemigrations` release hook | Explicitly prohibited by AD-6 | Correct decision; implementation gap |
| No readiness endpoint | Required by AD-8 | Missing implementation prerequisite |
| `ALLOWED_HOSTS=['*']`, unsafe defaults | Explicit production settings required by AD-7 | Correct decision; incomplete constraints |
| Django `<5.0` vs 5.2 target | Upgrade required by AD-9 | Correctly surfaced; cutover gate remains open |
| One VPS | Restore-based, not host-level HA | Aligned only if zero downtime is scoped to routine app deploys |

## Acceptance condition

The architecture can move from draft to implementable once RC-1 is resolved in the design, RC-2's no-downtime boundary is made explicit, and RC-3 through RC-6 are represented as mandatory cutover/build requirements. RC-7 through RC-10 may be implemented incrementally, but their production-safety portions—dependency lock, drain bounds, durable database volume, and non-public service ports—should be included in the first deployment baseline.
