# Rubric-Walker Review — Architecture Spine

## Verdict

**CHANGES REQUIRED.** The spine is strong on the intended low-cost topology, brownfield preservation, immutable delivery, blue-green application releases, and schema compatibility. It does not yet close several initiative-level operational divergence points that are material to a Heroku exit: the one-time production data/DNS cutover, actionable failure detection, and the security/reproducibility baseline of the sole host. Those omissions mean two implementers could produce materially different—and differently safe—platforms while claiming conformance.

The deterministic spine lint passes with zero findings. The findings below are semantic.

## High findings

### H1 — The actual Heroku production cutover is in scope but has no governing decision

- **Checklist failure:** A real divergence point is missed; an initiative-level deployment/operations dimension is silent.
- **Evidence:** The declared scope includes “Heroku exit” and “production hosting,” but the rules govern only releases after the Compose platform exists. AD-9 provides readiness gates, yet no rule defines how the existing PostgreSQL data, DNS, mail/configuration dependencies, and traffic move from Heroku to the VPS.
- **Why this matters:** Implementers could independently choose a long write outage, unsafe concurrent writes, a stale dump/restore, or an untested DNS flip. Rollback behavior is especially ambiguous once writes begin on the new PostgreSQL instance. The blue-green promise in AD-5 does not cover this one-time platform cutover.
- **Required disposition:** **Autofix.** Add an adopted cutover rule that distinguishes initial migration downtime from routine zero-downtime releases and requires a rehearsed runbook: inventory all Heroku config/add-ons, lower DNS TTL in advance, verify a source-consistent data transfer, define the write-freeze or replication strategy, validate counts/invariants, switch traffic, and define the last safe rollback point. If the exact transfer method is intentionally postponed, put it in an explicit open item with an owner/decision deadline before production cutover; do not leave the dimension silent.

### H2 — AD-8 does not enforce the outcome named in its `Prevents`

- **Checklist failure:** The Rule is not fully enforceable and does not actually prevent its stated divergence.
- **Evidence:** AD-8 says an external uptime check “probes” the application and that disk usage “is monitored,” but specifies no alert delivery, responsible recipient, threshold, or test. Its stated prevention includes “silent host failure” and full disks.
- **Why this matters:** A probe that records an outage without notifying anyone is still a silent outage in operational terms. Likewise, disk observation without a threshold and alert can still end in PostgreSQL or Docker failure. Different implementers can satisfy the words with dashboards nobody watches.
- **Required disposition:** **Autofix.** Require external notification to a named operational channel/owner, a tested alert path, and explicit actionable thresholds (at minimum host down/public endpoint down and disk pressure). The exact vendor can remain an implementation choice, but release/launch acceptance must be machine- or drill-verifiable.

### H3 — The sole-host security and reproducibility baseline is under-decided

- **Checklist failure:** The operational/environmental envelope and security boundary are incomplete.
- **Evidence:** AD-7 constrains public application ports and Django settings; AD-4 says runtime secrets are supplied on the VPS. No rule governs host provisioning, administrative access, firewall policy for SSH, security updates, Docker installation/update policy, secret storage permissions/ownership, or recovery of host configuration. “VPS secret store” in the conventions is not a selected mechanism or enforceable contract.
- **Why this matters:** Because every production component shares one host, host drift or compromise defeats all other boundaries. Implementers may use password SSH versus keys, expose different management ports, patch manually versus automatically, or store secrets in world-readable Compose files. A manually configured pet server also weakens the claimed repeatability of the Heroku replacement.
- **Required disposition:** **Discuss, then autofix.** Add a lean host-baseline rule suitable for the simplicity constraint: supported OS release; default-deny firewall with only required ingress; key-only administrative access; defined security-patch policy; Docker from a defined source; runtime secrets in a root-owned, non-repository file with restrictive permissions and redaction from CI/logs; and an idempotent bootstrap script or version-controlled checklist. This need not introduce Terraform, Ansible, or a secrets platform.

## Medium findings

### M1 — The deployment region is neither selected nor safely deferred

- **Checklist failure:** Provider strategy is only partially decided.
- **Evidence:** Hetzner is selected, but no location is named. “Saudi/Middle East data residency” is deferred only until policy/customer demand, which does not settle the immediate placement choice.
- **Why this matters:** Location changes user latency, off-host backup failure domains, and potential data-transfer/legal assumptions. Two teams could choose materially different regions while following the spine.
- **Required disposition:** **Autofix or defer explicitly.** Name the Phase-1 Hetzner location, or define an enforceable selection criterion and require the choice to be recorded before provisioning. Keep the separate residency trigger if legal review is genuinely later.

### M2 — AD-2's scaling/availability trigger is too vague to be enforceable

- **Checklist failure:** The Rule leaves room for divergent interpretations.
- **Evidence:** “Capacity is exhausted” and a breach of a “99.9% Phase-1 target” do not define measured resources, observation windows, or whether planned maintenance counts. The same paragraph correctly disclaims high availability, but the target can still be read as a commitment from a single failure domain.
- **Why this matters:** One operator may resize after a transient CPU spike; another may wait for sustained memory pressure or recurring saturation. The availability trigger similarly has no response rule or evaluation period.
- **Required disposition:** **Autofix.** Define a small set of sustained signals and an observation window, or explicitly make capacity thresholds an operational open item to be settled before launch. Label 99.9% as an internal measurement objective rather than a guaranteed SLO unless an error-budget/maintenance policy is added.

## Checklist coverage

| Check | Result | Notes |
| --- | --- | --- |
| Fixes real divergence points | **Partial** | Strong for packaging, state, delivery, routing, migrations, and environments; initial migration/cutover and sole-host baseline are missing. |
| Every Rule is enforceable and prevents its stated divergence | **Partial** | AD-8 lacks actionable alerting; AD-2 has ambiguous triggers. Most other rules have observable acceptance conditions. |
| Deferred is safe | **Pass with caution** | WAL/PITR, HA, managed DB, frontend split, workers, and object storage have sensible triggers. AD-9 correctly prevents irreplaceable production data before a tested off-host restore path, so “backup later” is constrained safely. |
| Named technology is verified-current | **Pass** | Exact versions are pinned or explicitly retain the brownfield constraint; the stack identifies targets versus current state. The build must still produce the promised dependency lock. |
| Brownfield reality is respected | **Pass** | AD-1 explicitly preserves the server-rendered Django WSGI monolith; current Django and Gunicorn constraints are acknowledged; production `makemigrations` is prohibited. |
| Capabilities are covered | **Pass with caution** | Existing runtime, transactional data, release, health, environments, audit evidence, and future durable artifacts are mapped. Initial Heroku transfer remains the principal uncovered capability. |
| No inherited contradiction | **Pass** | The spine explicitly supersedes the conflicting infrastructure-phase Next.js/DRF direction rather than silently mixing architectures. |
| Every initiative-owned dimension is decided/deferred/open | **Partial** | Compute, database, edge, CI/CD, environments, observability minimums, scaling direction, and future services are present. Cutover, host baseline, and location need closure. |

## Strengths to preserve while fixing

- AD-1 correctly prevents an infrastructure migration from becoming a product rewrite.
- AD-4 through AD-6 form a coherent release contract: one immutable artifact, inactive-slot health gating, serialized deployment, and expand–migrate–contract schema evolution.
- AD-9 safely reconciles the simplicity-first request with data durability: infrastructure work may begin without backup automation, but irreplaceable production data cannot be accepted before an off-host restore has been tested.
- AD-10 avoids a standing staging bill while maintaining data and secret isolation.
- AD-11 distinguishes durable business evidence from disposable operational telemetry and places correct triggers around future uploads and asynchronous work.

## Recheck

**PASS.** No critical or high findings remain from the prior review. AD-12 now governs the rehearsed Heroku data/DNS cutover and its rollback boundary; AD-8 makes outage and disk monitoring actionable and testable; and AD-13 closes the sole-host provisioning, region, access, patching, firewall, and secret-storage baseline. AD-2 also replaces the vague scaling trigger with measurable thresholds. The prior medium findings are resolved as well.
