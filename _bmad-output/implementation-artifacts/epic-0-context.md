# Epic 0 Context: Heroku-to-Hetzner Production Migration

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Move the existing server-rendered Django application from Heroku to a recoverable, observable, cost-first Hetzner deployment before product modernization proceeds. The migration preserves the monolith, establishes reproducible delivery and operations, proves recovery and capacity, and completes a controlled cutover without introducing unrelated frontend, API, or service decomposition work.

## Stories

- Story 0.1: Capture and Verify the Heroku Inventory
- Story 0.2: Make Django Production-Ready
- Story 0.3: Build Immutable CI Artifacts
- Story 0.4: Create the Secured Hetzner Host Baseline
- Story 0.5: Build the Private Compose Runtime
- Story 0.6: Implement Safe Blue-Green Deployment
- Story 0.7: Implement Encrypted Backup and Restore
- Story 0.8: Add Monitoring and Operational Controls
- Story 0.9: Rehearse Capacity, Restore, and Cutover
- Story 0.10: Execute Production Cutover and Retire Heroku

## Requirements & Constraints

- Preserve the Django WSGI monolith as one deployable service during this phase; do not require Next.js, DRF extraction, or service decomposition.
- Operate production on one cost-first Hetzner VPS. This remains a single failure domain, so representative capacity testing must prove room for Caddy, PostgreSQL, and both application slots without swap, OOM, or architecture threshold breaches.
- Provision Ubuntu 24.04 LTS in Hetzner `nbg1` reproducibly with restricted key-only administration, default-deny firewalling, official stable Docker packages, documented patching, deletion protection, and root-owned runtime secrets excluded from repositories and logs.
- Expose only Caddy publicly. Django and PostgreSQL remain private to Compose; PostgreSQL uses a fixed project name and stable pre-provisioned external volume that disposable application slots cannot recreate or replace.
- CI is the sole producer of deployable artifacts. It tests once, builds once, publishes a pinned OCI image plus release manifest, and excludes secrets. Production verifies immutable identities and never builds source or deploys a branch head.
- Dependencies and base images must be reproducibly locked. Image-owned static assets are built only after `collectstatic` and production-shaped `check --deploy` pass as hard gates.
- Release manifests bind the application digest, deployment-bundle commit, Compose/Caddy/deploy revisions, configuration-schema version, and migration contract.
- Every application release uses exclusive, crash-recoverable blue-green deployment with compatible expand/migrate/contract schema changes, bounded health checks, atomic routing, production-TLS verification, graceful draining, and preservation of the last known-good route on failure.
- Health signals include bounded liveness, database- and schema-aware readiness, and release identity without diagnostic leakage. Logs rotate within defined bounds; monitoring alerts after two failed probes and at documented disk thresholds.
- Before cutover, Django 5.2 LTS, secure production checks, tested off-host backup/restore, production-shaped capacity evidence, and a separately rehearsed Heroku data/DNS transition must pass. Irreplaceable writes are prohibited until recovery is demonstrated.
- Keep development local, CI disposable, and staging on demand with isolated data and secrets. Durable legal/business evidence belongs in PostgreSQL or an explicitly protected artifact store, never only in rotating operational logs.

## Technical Decisions

- Use Docker Compose on one host for Caddy, PostgreSQL, and interchangeable `blue` and `green` Django slots. Caddy owns certificates and its persisted routing declaration is the active-slot authority.
- Use Git commit SHA for human traceability and OCI digest for deployment identity. Production pulls only artifacts pinned by the verified release manifest.
- Target Python 3.12 and Django 5.2 LTS; pin application base images by digest. GHCR is the application image registry.
- Both slots consume the same hashed runtime configuration snapshot and `DATABASE_URL`. Local private PostgreSQL uses an explicit non-TLS mode unless server TLS is configured; future managed databases require verified TLS.
- Commit Django migrations. CI runs `makemigrations --check --dry-run`; production runs one serialized `migrate --noinput` job and never creates migrations.
- Store runtime secrets in a protected non-repository file. Secret rotation is a separate phased operation, with overlap for compatibility-affecting keys.
- Record domain audit evidence durably in PostgreSQL. Do not use in-process background threads for durable asynchronous work.

## Cross-Story Dependencies

- The verified Heroku inventory and production-ready Django gates provide the trusted inputs for immutable artifact creation.
- Immutable CI artifacts and the secured host baseline must exist before the private runtime and deployment automation can safely consume production images.
- The private runtime, stable PostgreSQL volume, configuration snapshot, and Caddy edge are prerequisites for blue-green deployment, monitoring, backup, and capacity rehearsal.
- Backup/restore verification, monitoring drills, and capacity/cutover rehearsal gate the final DNS and data cutover. Heroku retirement waits until validation succeeds and the rollback point expires.
