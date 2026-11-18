# Migration Plan

Source contract: `../../specs/spec-heroku-to-hetzner/SPEC.md`

This epic is deliberately numbered zero. Sprint tracking sorts epic numbers numerically, so the migration remains ahead of product Epics 1–7 on every deterministic refresh.

## Epic 0: Heroku-to-Hetzner Production Migration

Move the existing Mawareeth Django application from Heroku to a recoverable, observable, cost-first Hetzner deployment before new product work proceeds. The epic is complete only after the production cutover passes every gate and Heroku is safely retired.

### Story 0.1: Capture and Verify the Heroku Inventory

As the migration operator,
I want a verified inventory of the live Heroku service,
So that no hidden dependency can invalidate rehearsal or cutover.

**Acceptance Criteria:**

- PostgreSQL version, extensions, locale, size, and growth are captured.
- Add-ons, configuration keys, domains, DNS, and external integrations are captured without recording secret values.
- The inventory is reviewed against CAP-6, and every unknown blocks cutover.

### Story 0.2: Make Django Production-Ready

As the release team,
I want the brownfield application to satisfy its production gates,
So that infrastructure migration does not launch unsupported or unsafe code.

**Acceptance Criteria:**

- Django is upgraded to 5.2 LTS with tests passing.
- Database TLS policy, explicit hosts and trusted origins, proxy security, and required secrets work for the private Compose topology.
- Static collection and `manage.py check --deploy` fail the build on error.
- Liveness, dependency-aware readiness, and release identity endpoints are implemented without leaking diagnostics.

### Story 0.3: Build Immutable CI Artifacts

As the release team,
I want CI to produce the only deployable artifact,
So that production releases are reproducible and traceable.

**Acceptance Criteria:**

- GitHub Actions tests, builds, and publishes the application image to GHCR by immutable digest.
- A release manifest binds application digest, deployment bundle, configuration schema, and migration contract.
- Production never builds source, deploys a mutable branch head, or receives secrets inside artifacts.

### Story 0.4: Create the Secured Hetzner Host Baseline

As the operator,
I want the CX33 host to be reproducibly provisioned and secured,
So that the sole production node does not depend on undocumented manual state.

**Acceptance Criteria:**

- Versioned provisioning targets CX33 in `nbg1` with Ubuntu 24.04 LTS.
- The baseline configures restricted key-only administration, default-deny firewalling, Docker, patching, deletion protection, and protected runtime secrets.
- Reapplying the baseline is idempotent and does not expose application or database ports.

### Story 0.5: Build the Private Compose Runtime

As the operator,
I want a stable single-host runtime for edge, application, and data services,
So that disposable releases cannot endanger durable state.

**Acceptance Criteria:**

- Caddy is the only public HTTP entry point.
- PostgreSQL uses a pre-provisioned stable external volume and is reachable only on a private Compose network.
- Blue and green application slots share the approved configuration snapshot and database without owning durable local state.

### Story 0.6: Implement Safe Blue-Green Deployment

As the release team,
I want application releases to switch safely between slots,
So that a failed candidate cannot replace a healthy production release.

**Acceptance Criteria:**

- Deployment uses one exclusive lock and a crash-recoverable state machine.
- Committed migrations are serialized and follow expand, migrate, contract compatibility.
- Candidate readiness, atomic Caddy routing, production-TLS verification, and graceful draining are enforced.
- Failure at any gate preserves or restores the prior known-good route; application rollback never automatically reverses schema migrations.

### Story 0.7: Implement Encrypted Backup and Restore

As the operator,
I want production data recoverable outside the VPS,
So that failure of the sole host does not destroy irreplaceable data.

**Acceptance Criteria:**

- Nightly client-side encrypted Restic backups are stored in a Hetzner BX11 Storage Box.
- Retention is 7 daily, 4 weekly, and 6 monthly recovery points.
- An automated monthly isolated restore demonstrates the approved 24-hour RPO and 4-hour RTO.
- Production cannot accept irreplaceable writes until the first restore verification passes.

### Story 0.8: Add Monitoring and Operational Controls

As the operator,
I want actionable visibility into release and host health,
So that outages and resource exhaustion are detected promptly.

**Acceptance Criteria:**

- Container logs rotate within documented bounds.
- External checks alert after two consecutive failed public probes.
- Disk use warns at 75 percent and becomes critical at 85 percent.
- The primary operator notification path passes a launch drill and has a quarterly drill schedule.

### Story 0.9: Rehearse Capacity, Restore, and Cutover

As the migration team,
I want a production-shaped rehearsal,
So that capacity, recovery, timing, and rollback are evidenced before go-live.

**Acceptance Criteria:**

- CX33 runs Caddy, PostgreSQL, and both application slots under representative load without swap, OOM, or architecture threshold breach.
- An isolated restore meets the 24-hour RPO and 4-hour RTO.
- The Heroku logical migration, invariant checks, maintenance behavior, DNS transition, and last safe rollback point are timed and recorded.
- If the restore-and-validation path exceeds 20 minutes, the production runbook switches from write freeze to replication.

### Story 0.10: Execute Production Cutover and Retire Heroku

As the service owner,
I want the rehearsed migration executed under explicit go-live control,
So that Mawareeth runs solely on Hetzner without split writes or an unsafe rollback gap.

**Acceptance Criteria:**

- Every SPEC production gate and Story 0.9 rehearsal gate passes before the maintenance window begins.
- The write freeze, final logical transfer, validation, and DNS switch complete inside 30 minutes unless the approved replication path is used.
- Production identity, data integrity, monitoring, and backup are verified before Heroku retirement.
- Heroku is decommissioned only after the rollback point expires and the team verifies no live dependency or split-write path remains.
