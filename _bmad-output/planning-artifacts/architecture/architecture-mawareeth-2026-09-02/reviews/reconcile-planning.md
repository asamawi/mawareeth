# Planning Reconciliation Review

## Verdict

**CONDITIONAL PASS — the infrastructure direction is coherent, but four planning obligations need an explicit disposition before this spine can be treated as the sole build contract.**

The spine faithfully captures the newly chosen cost-first Heroku exit: retain the brownfield Django application, use one Hetzner VPS, Docker Compose, Caddy, GitHub Actions/GHCR, private PostgreSQL, and blue-green application releases. Most apparent disagreement with the older architecture is intentional phasing rather than a technical contradiction. The remaining risks are that downstream implementers can still read the older planning set as equally authoritative, the 99.9% availability requirement is not achievable as a guarantee with the accepted single failure domain, and durable files/audit evidence plus environment separation have no complete initial placement.

## Sources Compared

- `ARCHITECTURE-SPINE.md`
- `architecture/core-architectural-decisions.md`
- `architecture/project-structure-boundaries.md`
- `architecture/project-context-analysis.md`
- `architecture/architecture-validation-results.md`
- `epics/requirements-inventory.md`

## Findings

### 1. The old Next.js/DRF split conflicts textually with the preserved Django monolith

**Severity:** High  
**Classification:** Intentional supersession for the infrastructure phase, but not reconciled in the planning corpus

The older decisions and requirements call Next.js App Router, a versioned DRF API, React Query/Zustand, and a `web/` plus `api/` repository layout mandatory. AD-1 instead preserves the existing server-rendered Django application as one WSGI deployable and says the Heroku exit must not require Next.js, DRF extraction, or service decomposition.

This is a sound migration constraint: replacing hosting and rewriting the product simultaneously would enlarge cost and risk. It does not necessarily cancel a future product-driven Next.js/API initiative. However, the older documents still label those choices “Critical Decisions,” “Technical Constraints,” “Additional Requirements,” and “READY FOR IMPLEMENTATION.” An implementation agent could therefore obey either incompatible starter structure.

**Required disposition:** Declare precedence and phase boundaries in the canonical planning set. The infrastructure spine should govern the Heroku-exit phase; the Next.js/DRF structure should be marked future/conditional or separately re-approved as a product modernization. Do not scaffold `web/` and `api/` merely to satisfy the old structure during this migration.

### 2. The accepted one-VPS failure domain does not substantiate NFR-02's 99.9% uptime commitment

**Severity:** High  
**Classification:** Intentional phase trade-off, but the requirement exception did not land explicitly

AD-2 accepts one host and defers multi-host high availability. AD-5 removes routine application-release downtime, but it cannot prevent downtime from VPS, host, network, Caddy, Docker daemon, or colocated PostgreSQL failure and maintenance. The requirements inventory still says the API and web app **must maintain 99.9% uptime**.

Blue-green deployment and service availability are separate concerns. The spine correctly limits its mechanism to releases, but neither relaxes NFR-02 nor defines evidence that a single-node topology can meet it.

**Required disposition:** Record one of these explicitly: (a) 99.9% is a target/SLO accepted without redundancy for Phase 1, with error-budget measurement and a trigger for a second node/managed database; or (b) 99.9% remains a hard contractual requirement, in which case AD-2 must be revisited. Preserve the distinction that “zero downtime” applies to normal app deployments, not host failures or incompatible database changes.

### 3. Durable PDFs, verification uploads, and legal audit evidence have no storage boundary

**Severity:** High  
**Classification:** Accidental omission / unresolved requirement

AD-3 says PostgreSQL exclusively owns durable application state and app containers are disposable. The older architecture requires canonical court PDFs, lawyer verification details, append-only audit records, QR-verifiable reports, and certified-case persistence. It also says the reports service generates PDFs via WeasyPrint and that verification/audit are distinct application boundaries. The spine defers object storage until durable user uploads are introduced, but these planned features inherently introduce durable binary artifacts unless they are always reproducibly regenerated.

Bounded stdout/container logs in AD-8 are appropriate operational telemetry, but they cannot serve as the FR-17 append-only legal/business audit trail. Domain audit records must remain durable transactional data, presumably in PostgreSQL; operational logs may rotate independently.

**Required disposition:** Before implementing reports or lawyer verification, specify:

- whether canonical PDFs are regenerated from immutable/versioned inputs or stored as durable blobs;
- where lawyer-submitted documents and other media live;
- that application audit events live in PostgreSQL and are not Docker logs;
- backup/restore coverage for every durable artifact, not only the database.

Deferring object storage is acceptable only while those features are not live or while a deliberate database-backed/regeneration design satisfies them.

### 4. Dev/staging/prod separation is missing from the initial topology

**Severity:** Medium  
**Classification:** Accidental omission or unrecorded cost-driven supersession

Both `core-architectural-decisions.md` and `requirements-inventory.md` require dev/staging/prod separation. The spine defines one production VPS and a production delivery path, but does not place development or staging. It is unclear whether development is local Compose, staging is an ephemeral CI environment, staging shares the production host, or staging is intentionally deferred.

Sharing production PostgreSQL or secrets would violate meaningful separation; purchasing a permanent staging VPS would conflict with the minimal-cost goal unless explicitly chosen.

**Required disposition:** Choose a low-cost interpretation. A coherent initial model would be local Compose for development, CI for automated validation, and ephemeral/on-demand staging with an isolated database and secrets. If there is no staging environment in Phase 1, mark the older separation requirement superseded rather than leaving it silently unmet.

### 5. AES-256-at-rest is asserted by requirements but not implemented by an infrastructure decision

**Severity:** Medium  
**Classification:** Accidental omission

NFR-05 and the older security decisions require AES-256 at rest. The spine governs PostgreSQL placement and backups but does not name a volume/disk encryption control, application-level field encryption, key ownership, or provider guarantee. “PostgreSQL is private” protects network reachability, not data at rest.

**Required disposition:** Validate the selected Hetzner storage encryption guarantees and document the actual control. If provider storage does not satisfy the precise requirement, define host-volume or application-level encryption and key recovery. The future off-host backup must also be encrypted. If “AES-256” was aspirational rather than a verified requirement, revise NFR-05 to an outcome-based encryption-at-rest requirement with testable evidence.

### 6. The asynchronous certified-report path conflicts with deferring task workers unless explicitly phased

**Severity:** Medium  
**Classification:** Intentional simplification with an unstated feature gate

The old core decisions say complex or certified PDF reports run asynchronously and return a polling job identifier. The spine defers Redis and task workers until measured workload requires them. That is compatible only if Phase 1 either handles all report generation safely inline, uses a database-backed job mechanism, or delays complex/certified report generation.

**Required disposition:** Mark asynchronous certified reports as a trigger for introducing a worker/job architecture, or approve a bounded synchronous implementation with explicit timeout and concurrency evidence. Do not silently implement an in-process background thread in disposable app containers.

### 7. Backup timing is reconciled correctly as a production gate, not an initial build dependency

**Severity:** Informational  
**Classification:** Intentional sequencing; no conflict if “later” means before valuable live data

The chosen simplification deferred backup implementation. AD-9 still requires a tested off-host database backup/restore path before public cutover with irreplaceable data, while the Deferred section postpones continuous WAL/PITR until after that first backup path. This is internally coherent: Compose/blue-green infrastructure can be built and validated first, a simple tested off-host backup can follow, and WAL remains later hardening.

If the intended meaning of “backup later” is after accepting production user data, AD-9 intentionally overrides that unsafe interpretation and should remain a blocking gate.

### 8. Several older product-level decisions are outside this infrastructure spine, not lost

**Severity:** Informational  
**Classification:** Proper scope exclusion

The deterministic engine boundary, multi-Madhab behavior, anonymous IndexedDB drafts, share-token authorization, authentication/MFA, accessibility gates, RTL/i18n, lawyer marketplace, pricing disclosures, and UI state choices do not appear in the infrastructure capability map. The spine's declared scope is Heroku exit, hosting, delivery, routing, database placement, and initial operations. These product/application requirements should remain governed by the product architecture and epics rather than being duplicated into the infrastructure spine.

There are two infrastructure-facing caveats: deployment must preserve outbound/inbound integration needs for email, OAuth, and WhatsApp webhooks, and CI must eventually run the accessibility/contract/E2E gates already required by the product plan. These can be workflow requirements without changing the runtime topology.

### 9. Redis deferral, managed-database deferral, and version pinning are reconciled

**Severity:** Informational  
**Classification:** Intentional supersession / refinement

- Redis was optional in the older architecture, so deferring it until cache/session/rate-limit or worker demand exists is consistent.
- Managed PostgreSQL/Neon was an explored option, not a load-bearing prior requirement. Colocating PostgreSQL on the cost-first VPS is a deliberate initial choice.
- The older validation requested explicit runtime version pins. The spine now targets Python 3.12.12, Django 5.2 LTS, PostgreSQL 17.11, Caddy 2.11.4, and Compose 5.5.0, while requiring image digests. This closes the earlier versioning gap, subject to implementation lock files/digests.
- The Django 5.2 cutover gate explicitly acknowledges and safely resolves the current repository's `Django>=4.2,<5.0` constraint rather than hiding it.

## Load-Bearing Items That Landed Correctly

- Hetzner + Docker Compose + Caddy + GitHub Actions deployment direction.
- PostgreSQL as the single transactional owner using Django ORM and committed migrations.
- Private database networking and public TLS edge.
- Immutable CI-built images and rollback identity.
- Blue-green application release flow with health checks, edge switching, and draining.
- Migration compatibility discipline through expand → migrate → contract.
- Minimal observability baseline: health, bounded operational logs, and external uptime checks.
- Cost-first vertical scaling and explicit deferral of multi-host HA, Neon, Kubernetes, Redis, and a self-hosted PaaS.

## Reconciliation Gate

Before declaring the spine fully authoritative, resolve Findings 1–5 in the planning documents or annotate their accepted phase exceptions. Findings 6–9 can remain deferred/properly scoped if their trigger conditions are preserved. No infrastructure implementation should infer that blue-green app switching satisfies host-level HA, that rotating container logs satisfy audit retention, or that ephemeral containers provide storage for certified artifacts.
