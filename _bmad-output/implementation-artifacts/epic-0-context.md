# Epic 0 Context: Heroku-to-Hetzner Production Migration

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Move the existing Mawareeth Django monolith from Heroku to a cost-first, recoverable, observable Hetzner production deployment before product modernization continues. The migration must establish a secure and reproducible operating baseline, demonstrate that application data and releases can be recovered safely, and complete a rehearsed cutover without turning the hosting change into a Next.js, DRF, or service-decomposition project.

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

- Preserve the server-rendered Django application as one deployable WSGI service. The active migration phase must not require a frontend/backend split, Next.js, DRF extraction, or service decomposition.
- Run production on one cost-first Hetzner VPS. This is a single failure domain, not a high-availability guarantee; capacity decisions must be informed by representative load, two-slot deployment headroom, CPU, memory, and swap/OOM signals.
- Provision the sole host reproducibly in Hetzner `nbg1` on Ubuntu 24.04 LTS. The baseline must be idempotent and include restricted key-only administration, a default-deny firewall exposing only HTTP/HTTPS plus restricted SSH, Docker from its official stable repository, documented security patching, deletion protection, and root-owned runtime secrets excluded from source control, CI output, and logs.
- Production may receive public HTTP/HTTPS only through Caddy. Django and PostgreSQL must remain private to the Compose topology; PostgreSQL must never publish a public port.
- PostgreSQL is the single durable transactional-state owner. Use a fixed Compose project name and a stable, pre-provisioned external volume; disposable application slots must not own durable state, recreate the database, or replace its volume.
- CI must be the only producer of deployable artifacts. It tests and builds once, publishes a pinned OCI image and release manifest, and production verifies and pulls immutable identities rather than building source or deploying branch heads. Secrets must never be embedded in artifacts.
- Every release must use blue/green application slots, an exclusive and crash-recoverable deployment flow, compatible expand/migrate/contract schema evolution, health verification, atomic edge routing, TLS verification, and graceful draining. A failed release must preserve or restore the known-good route; rolling back an application must not automatically reverse migrations.
- Health signals must include bounded liveness, database- and schema-aware readiness, and release identity without diagnostic leakage. Container logs rotate within defined bounds; external probes alert the primary operator after two consecutive failures, with disk warnings at 75% and critical alerts at 85%.
- Before public production cutover, Django 5.2 LTS, secure production settings, `check --deploy`, an off-host tested backup/restore path, and a representative capacity test with Caddy, PostgreSQL, and both slots must pass. Irreplaceable production writes are prohibited until recovery has been demonstrated.
- Keep development local, CI disposable, and any staging environment on demand with isolated data and secrets; no permanent staging host is required. Before storing sensitive or durable business artifacts, document the AES-256-at-rest control and ensure artifacts are reproducible from immutable inputs or covered by durable backup.

## Technical Decisions

- Use Docker Compose on the host for Caddy, PostgreSQL, and `blue`/`green` Django application slots. Caddy owns certificates and the sole public edge; its persisted routing declaration is the authority for which slot is active.
- Standardize release traceability on a human-readable Git commit SHA and an immutable OCI digest for deployment identity. Bind the application digest, deployment-bundle revision, Compose/Caddy/deploy revisions, configuration-schema version, and migration contract in a release manifest.
- Both slots consume the same hashed runtime configuration snapshot and `DATABASE_URL`. PostgreSQL connections on the private local network use an explicit non-TLS mode unless server TLS is intentionally configured; any future managed database must use verified TLS.
- Use committed Django migrations only. CI checks that migrations are present; production runs one serialized `migrate --noinput` job before traffic switches and never runs `makemigrations`.
- Store runtime secrets in a protected, root-owned non-repository file. Treat rotation as a separate phased operation; use overlapping dual-key support for compatibility-affecting secrets.
- Record domain audit evidence durably in PostgreSQL rather than container logs. Operational logs are non-authoritative and may rotate. Do not use in-process background threads for durable asynchronous work.
- Rehearse the one-time Heroku exit separately from routine blue/green releases: inventory Heroku dependencies, restore a source-consistent logical dump using target-version tools, validate migrations and invariants, lower DNS TTL, and choose either a write-freeze or replication runbook with a named last safe rollback point. Do not reuse PostgreSQL data directories across major versions.

## Cross-Story Dependencies

- The verified Heroku inventory and production-ready Django configuration establish the inputs and safety gates for artifact creation, host/runtime provisioning, rehearsal, and cutover.
- Immutable CI artifacts and the secure host baseline must exist before the private Compose runtime and deployment automation can consume production images safely.
- The private runtime, stable PostgreSQL volume, configuration snapshot, and Caddy edge are prerequisites for blue/green deployment, monitoring, backup, and capacity rehearsal.
- Backup/restore verification, monitoring launch drills, and capacity/cutover rehearsal are explicit gates before the final DNS and data cutover. Heroku retirement occurs only after validation and expiry of the defined rollback point.
