---
id: SPEC-heroku-to-hetzner
companions:
  - ../../planning-artifacts/architecture/architecture-mawareeth-2026-09-02/ARCHITECTURE-SPINE.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Heroku-to-Hetzner Production Migration

## Why

Mawareeth must leave Heroku to reduce recurring infrastructure cost while retaining a safe, supportable production service. The migration affects users who require continuity and durable inheritance data, and the operator who needs reproducible delivery, recovery, and observability without taking on premature multi-node complexity.

## Capabilities

- **CAP-1**
  - **intent:** The team can package the existing Django monolith as an immutable production release without coupling the migration to application modernization.
  - **success:** CI reproducibly builds a digest-addressed image that passes the test suite, `collectstatic`, and production-shaped Django deployment checks without requiring a Next.js/DRF rewrite.

- **CAP-2**
  - **intent:** The system can serve the application and persist its data on a cost-first Hetzner production host.
  - **success:** A Hetzner CX33 in `nbg1` runs Caddy, PostgreSQL, and both app slots under representative capacity without threshold breach; public HTTPS reaches only Caddy, private services have no public ports, and app replacement leaves PostgreSQL data intact.

- **CAP-3**
  - **intent:** The team can release and roll back application versions without routine request interruption.
  - **success:** A deployment starts an immutable candidate beside the active release, promotes it only after readiness and production-TLS verification, drains the old slot, and preserves or restores the prior route when any gate fails.

- **CAP-4**
  - **intent:** The team can evolve the production schema safely while old and new application releases overlap.
  - **success:** Every schema change is committed, checked in CI, serialized in production, compatible across the handover window, and never automatically reversed during application rollback.

- **CAP-5**
  - **intent:** The operator can detect unhealthy releases, host outages, and resource exhaustion before they silently compromise service.
  - **success:** Dependency-aware readiness gates traffic; logs rotate within bounds; external availability and disk thresholds alert the primary operator; and the notification path passes its launch drill.

- **CAP-6**
  - **intent:** The team can move Heroku configuration, dependencies, data, and DNS to Hetzner without split writes or an unbounded rollback risk.
  - **success:** A verified Heroku inventory and timed rehearsal restore a source-consistent logical database copy, validate migrations and data invariants, and exercise DNS rollback; production uses a maintenance-page write freeze within 30 minutes, unless rehearsal exceeds 20 minutes and therefore requires replication.

- **CAP-7**
  - **intent:** The operator can recover production data independently of the sole VPS.
  - **success:** Nightly client-side encrypted Restic backups reach a Hetzner BX11 Storage Box with 7 daily, 4 weekly, and 6 monthly retention, and an automated monthly isolated restore demonstrates a 24-hour RPO and 4-hour RTO before irreplaceable writes are accepted.

- **CAP-8**
  - **intent:** The operator can reproduce and secure the production host while keeping non-production environments isolated.
  - **success:** A versioned Ubuntu 24.04 baseline recreates the required firewall, restricted key-only administration, Docker runtime, patching, and secret handling; development, CI, and on-demand staging use isolated data and secrets.

## Constraints

- The Heroku exit preserves the server-rendered Django WSGI monolith and cannot require a frontend/backend rewrite or service decomposition.
- Phase 1 uses one Hetzner `nbg1` VPS as an accepted single failure domain; 99.9% is an observed objective, not a redundancy guarantee.
- Initial production sizing is CX33 with 4 vCPU, 8 GB RAM, and 80 GB NVMe; resizing requires the architecture's measured scaling signals.
- Only CI-produced, digest-pinned artifacts may deploy; production source builds, mutable branch deployments, self-hosted CI runners, and secrets embedded in artifacts are prohibited.
- PostgreSQL exclusively owns durable transactional state on a stable external volume and is never publicly reachable.
- Routine releases use backward-compatible expand → migrate → contract database changes; incompatible migrations may require planned downtime.
- Public cutover requires Django 5.2 LTS, production settings that pass `manage.py check --deploy`, a tested off-host restore, and representative capacity with PostgreSQL, Caddy, and both app slots running without swap, OOM, or threshold breach.
- Cutover is blocked until the live Heroku PostgreSQL, add-on, configuration, domain, and DNS inventory is captured and verified.
- Domain audit records remain durable PostgreSQL data; rotating container logs cannot serve as business or legal evidence.
- Canonical PDFs, verification uploads, and long-running certified reports cannot launch until their durable artifact and job-processing policies are approved.

## Non-goals

- Rewriting the application into Next.js, DRF, or independently deployed services during the migration.
- Multi-host high availability, managed PostgreSQL, Kubernetes, Redis, task workers, or a self-hosted PaaS in Phase 1.
- A permanently running staging server.
- Object storage or a CDN until durable uploads or measured delivery demand requires it.
- Guaranteed zero downtime for the one-time Heroku cutover, host failure, host maintenance, Docker/Caddy restart, or incompatible database changes.

## Success signal

After a rehearsed cutover, the production domain serves the validated Mawareeth release from Hetzner, writes only to the restored private PostgreSQL database, survives a failed candidate deployment without losing the active release, and can restore production data from an off-host backup. Heroku can then be decommissioned without retaining a live dependency or accepting split writes.
