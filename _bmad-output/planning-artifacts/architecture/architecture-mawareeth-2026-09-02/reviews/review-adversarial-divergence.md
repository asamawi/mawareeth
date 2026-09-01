# Adversarial Divergence Review

**Artifact:** `ARCHITECTURE-SPINE.md`  
**Lens:** Independently implemented units one level below the spine  
**Verdict:** **REVISE — the platform direction is coherent, but the current ADs do not uniquely determine a safe blue-green release protocol.** Two competent teams can obey every decision literally and still produce incompatible routing, release, database, configuration, and health behavior. The highest-risk gaps are crash recovery during a switch, stable database identity, and the absence of a versioned release manifest that binds app and infrastructure artifacts.

## Method

For each test, the units below were implemented independently from the adopted decisions, with no assumptions beyond their literal text. A divergence is a failure when both implementations remain compliant but cannot safely compose.

## Findings

### 1. Critical — The slot switch is not a crash-consistent state machine

**Independent pair**

- **Deployment unit A:** rewrites `active-slot.caddy` to `green`, reloads Caddy successfully, then records `green` in a local state file and stops `blue`.
- **Recovery unit B:** after a process or SSH failure between reload and state-file update, reads the stale state file (`blue`), concludes `green` is inactive, replaces or stops it, and can take down the slot that is actually receiving traffic.

Both units obey AD-5: the new slot was healthy, Caddy was gracefully reloaded, and the old slot was intended to drain. AD-6 says deploys are serialized but serialization does not make an interrupted deployment atomic. The spine does not define which observation is authoritative after partial failure, nor how the next invocation reconciles actual Caddy routing, container state, and recorded state.

**Required tightening**

Add an AD defining a host-side, crash-recoverable deployment state machine:

1. Acquire one VPS-local exclusive lock covering CI-triggered and manual deploys.
2. Discover the active slot from a single authoritative, persisted routing declaration—not from a second shadow state file.
3. Write candidate routing configuration by atomic rename, validate it, reload, and verify through Caddy that the expected release identity is served.
4. Only then mark the transition committed and drain the previous slot.
5. On every invocation, reconcile routing, slot health, and image digest before mutating either slot.
6. A crash at every transition must leave at least one known-good slot routable.

### 2. Critical — A “named volume” does not establish stable PostgreSQL identity

**Independent pair**

- **Compose unit A:** declares `postgres_data:` as a normal named volume and runs the project as `mawareeth-prod`.
- **Deployment unit B:** invokes Compose from a release directory or with project name `mawareeth-$SHA`, creating a new equally valid named volume such as `mawareeth-abc123_postgres_data`.

Both comply with AD-3: PostgreSQL has a named volume outside app-slot replacement and automation does not remove a volume. Yet a deployment can attach a fresh empty database, creating apparent data loss or a split database identity. AD-2 and AD-3 do not bind the Compose project identity or the concrete external volume name.

**Required tightening**

Amend AD-3 or add an AD requiring:

- one fixed Compose project name;
- a pre-provisioned `external: true` PostgreSQL volume with an explicit host-stable name;
- a deployment preflight that verifies the expected database identity/schema marker before migration or switching;
- app-only operations that never recreate, replace, or implicitly rename the PostgreSQL service or volume;
- a separately approved procedure for PostgreSQL image or major-version changes.

### 3. High — The application image is immutable, but the release is not

**Independent pair**

- **CI unit A:** builds and publishes the exact OCI digest required by AD-4.
- **Host deployment unit B:** uses whatever `compose.yaml`, `Caddyfile`, `deploy.sh`, and environment schema happen to be present on the VPS, or fetches them from the mutable branch head.

Both obey the literal artifact rule because production pulls the application by digest and does not build source. They can still combine an old deployment script with a new image, a new Caddy fragment with an old Compose model, or an environment file missing newly required variables. The spine gives release identity only to the app image, while the structural seed makes non-image files release-critical.

**Required tightening**

Add a release-integrity AD: every production release is an immutable manifest binding the app digest, Compose/Caddy/deploy artifact revision, required configuration schema version, and migration compatibility metadata. The VPS must verify the complete manifest before mutation. Infrastructure files must be delivered from the same pinned commit (or a separately immutable deployment bundle), never from an unpinned branch or unmanaged host copy.

### 4. High — Migration and readiness ordering is underdetermined

**Independent pair**

- **Migration unit A:** starts the inactive app, waits for its dependency-aware readiness check, then runs `migrate --noinput` before switching.
- **Application unit B:** implements readiness as Django startup plus a successful `SELECT 1`, exactly as AD-8 requires, while the new code also requires a column introduced by the pending migration on its first real request.

Both obey AD-5, AD-6, and AD-8. The health check can pass before migration, and it need not prove the release’s schema contract after migration. Alternatively, a deployer may migrate first and only then discover an app-level incompatibility while the old slot is already running against the expanded schema.

**Required tightening**

Define one mandatory release order and schema gate: start isolated candidate → run the single migration job while old remains live → verify the candidate against the post-migration schema → switch → drain. The candidate must expose its release digest and required schema-contract version; switch verification must check both. “Dependency-aware” should distinguish shallow liveness, readiness, and release/schema compatibility. Expand migrations must be proven safe for the still-active old image before they execute.

### 5. High — Runtime configuration and secret compatibility across slots is unspecified

**Independent pair**

- **Compose unit A:** supplies both slots from a shared mutable `.env` file read when each container is created.
- **Secret-rotation unit B:** changes `SECRET_KEY`, database credentials, trusted origins, or another secret between creation of blue and green.

Both satisfy AD-4 and the configuration convention: secrets are supplied at runtime and do not enter the image. During overlap, however, the slots may disagree about session/signing keys, database users, allowed origins, or feature configuration. Users routed across the switch can be logged out or requests can fail, and rollback may no longer have valid credentials.

**Required tightening**

Add a runtime-configuration AD requiring a versioned configuration snapshot/hash per release, identical shared settings for both slots during handover, and preflight comparison of all non-slot-specific configuration. Secret rotations that affect compatibility need an explicit dual-read/dual-key or phased rotation procedure; rotation may not be conflated with an ordinary blue-green switch.

### 6. High — Routing success is not tied to the intended release identity

**Independent pair**

- **Caddy unit A:** considers a successful validated reload sufficient and routes to the Compose DNS name `green`.
- **Health/deploy unit B:** has verified a particular green container and digest, but after recreation, DNS caching or name reuse lets Caddy reach a different container—or the endpoint returns 200 from a default/fallback route.

Each unit follows AD-5, AD-7, and AD-8. Nothing requires the post-switch probe to traverse the public edge or prove that the response came from the intended image digest and schema-compatible slot. A syntactically successful Caddy reload is not proof of correct routing.

**Required tightening**

Require a release identity endpoint/header that exposes a non-secret image digest or release ID. Before draining the old slot, the deployer must probe through Caddy using the production host/TLS path and verify the expected release identity. Any mismatch triggers routing rollback while the previous slot is still running.

### 7. Medium — Static asset ownership can diverge while all stated gates pass

**Independent pair**

- **Image unit A:** runs `collectstatic` and expects WhiteNoise to serve fingerprinted files from the image.
- **Caddy unit B:** is configured to serve `/static/` from a persistent host mount populated by a previous release.

AD-4 requires `collectstatic`, and AD-7 makes Caddy the public edge, but neither assigns ownership of `/static/`. Both implementations are plausible and compliant; HTML from the new app can reference assets absent from the host-mounted static directory.

**Required tightening**

Choose exactly one Phase-1 static path. The simplest invariant is that static assets are image-owned and served by WhiteNoise through the active app slot, with Caddy only proxying requests. If Caddy serves assets directly, the asset bundle must instead be immutable, digest-bound to the release manifest, populated before switch, and retained for rollback.

### 8. Medium — “No downtime” has no explicit service boundary

**Independent pair**

- **Drain unit A:** stops old Gunicorn workers after a 30-second grace period.
- **Application unit B:** permits legitimate report requests lasting 60 seconds; Caddy has already routed new requests to green, but the in-flight blue request is killed during drain.

AD-8 asks for explicit bounds but does not define the accepted maximum request duration or the behavior of requests exceeding it. Both units can choose reasonable but incompatible limits. The document therefore supports zero interruption for ordinary bounded requests, not an unconditional no-downtime guarantee.

**Required tightening**

State the availability contract precisely: normal deploys must not reject new requests and must preserve in-flight requests up to a defined maximum duration. Align Caddy upstream timeouts, Gunicorn graceful timeout, application request limits, deployment drain polling, and Compose stop grace period. Long-running work beyond that bound must move to the durable-worker decision described by AD-11.

## Minimum revision set before implementation

The spine should not be considered implementation-deterministic until it adds or tightens rules for:

1. crash-consistent slot selection and VPS-local locking;
2. fixed Compose project/database volume identity;
3. an immutable release manifest covering both app and deployment artifacts;
4. exact migration/readiness/switch ordering with release and schema identity checks;
5. configuration snapshot compatibility and phased secret rotation;
6. one explicit static-asset owner and a bounded no-downtime contract.

The selected Hetzner + Compose + Caddy + GitHub Actions architecture remains viable. These are protocol holes, not reasons to add Kubernetes, a second VPS, or a platform dashboard.

## Recheck

**Verdict: PASS.** The revised spine closes all previously reported critical and high divergence paths: AD-5 defines locked, crash-recoverable switching and edge identity verification; AD-3 fixes database and Compose identity; AD-4 binds immutable application and deployment artifacts and assigns static ownership; AD-5/AD-6/AD-8 establish migration, schema-readiness, switch, and drain ordering; and the configuration conventions establish shared snapshots plus phased secret rotation. No critical or high findings from the original review remain.
