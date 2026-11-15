---
title: 'Implement Safe Blue-Green Deployment'
type: 'feature'
created: '2026-10-13'
status: 'done'
review_loop_iteration: 1
baseline_commit: '67101ae7a2a01528e26814e03d17bfbe3190f771'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-0-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The 0.5 runtime runs one image in both slots and routes statically to blue from a tracked file, so there is no safe way to ship a release, and a bad candidate could replace healthy production.

**Approach:** Add a locked, journaled `deploy/release.sh deploy` that starts the idle slot with a manifest-verified image, runs one forward-only migration, gates on readiness and release identity, switches Caddy atomically, verifies production TLS, drains the old slot, and restores the prior route on any failure.

## Boundaries & Constraints

**Always:** Hold one exclusive non-blocking `flock` for the whole deploy; journal each phase atomically (temp + rename) before acting; refuse to start if the journal is not idle; treat the persisted route file as active-slot authority; deploy only to the idle slot; reuse `runtime.sh` preflight; require the candidate snapshot hash to equal the active slot's; run exactly one `migrate --noinput` with the candidate image; verify candidate `/health/ready/` and `/health/release/` commit before routing; switch via temp + rename + `caddy reload`, then verify HTTPS through `--resolve DOMAIN:443:127.0.0.1` with full certificate validation and the expected commit; keep the old slot running until verification passes, then stop it gracefully; bound every wait.

**Ask First:** Changing fixed names, ports, image/database versions, gunicorn timeouts, release/manifest contracts, or durable state; exposing the Caddy admin API beyond the container loopback; contacting a real registry or host.

**Never:** Reverse or fake migrations; build, pull, or deploy tags; change secrets or snapshots during deploy; run concurrent deploys; leave Caddy routed to an unverified slot; automate crash recovery, contract-migration detection, backups, monitoring, DNS, or cutover (deferred or later stories).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Happy deploy | Blue active, valid new manifest | Green runs the new image, migrations applied once, route → green, TLS verified, blue stopped; journal idle | N/A |
| Concurrent deploy | Lock held | Second invocation exits immediately | Non-zero, no mutation |
| Interrupted earlier deploy | Journal not idle | No mutation | Non-zero, names the journal and manual recovery steps |
| Candidate unready / wrong commit | Readiness times out or identity mismatch | Route unchanged; candidate stopped | Non-zero; journal records the failure |
| Migration fails | `migrate` error | Route unchanged; nothing unapplied | Non-zero, redacted message |
| Reload or TLS verify fails | After switch | Prior route file restored and reloaded; old slot still serving | Non-zero; distinct exit code if the restore also fails |
| Config drift | Candidate snapshot ≠ active | No mutation | Non-zero: rotate config separately |

</frozen-after-approval>

## Code Map

- `deploy/runtime.sh:233-269` -- preflight, `compose()`, dispatch; make it sourceable (guard dispatch with `BASH_SOURCE`); `compose()` passes per-slot images and the route dir.
- `deploy/runtime.sh:184-216` -- `write_snapshot` sets `APP_SNAPSHOT` (hash filename) for the equality check.
- `deploy/compose.yaml:3-4,52-90` -- `APP_IMAGE` → `APP_BLUE_IMAGE`/`APP_GREEN_IMAGE`; `./caddy` mount → `${ROUTES_DIR}`; drop Caddy `depends_on app-blue`.
- `deploy/Caddyfile:1-3` -- `admin off` blocks reload; use `admin localhost:2019` (container-only).
- `deploy/caddy/active-slot.caddy` -- becomes the tracked blue seed only.
- `mawareeth/ops_views.py:22-28,58-66` -- the candidate stays unready until migrated; the old slot stays ready; `/health/release/` returns `commit`.
- `Dockerfile:79` -- gunicorn `--graceful-timeout 30`; stop with a 35s timeout.
- `deploy/tests/test_compose_runtime.sh` -- docker-stub harness to reuse; lines 28-29 assert route content.

## Tasks & Acceptance

**Execution:**
- [x] `deploy/compose.yaml`, `deploy/Caddyfile`, `deploy/caddy/active-slot.caddy` -- per-slot images, state-dir route mount, loopback-only admin (documented as a deliberate decision), Caddy not gated on blue; each slot route stamps `header_down X-Mawareeth-Slot <slot>`.
- [x] `deploy/runtime.sh` -- sourceable; per-slot records in `$state_dir/slots/<slot>.env` (image, commit, snapshot) written only by `release.sh` after verification; seed the route if absent; mutating commands take the deploy lock and refuse a non-idle journal; `up` refuses when no active record exists (bootstrap needs `release.sh deploy`) and refuses image or commit drift; start order postgres → active slot (wait healthy) → Caddy.
- [x] `deploy/release.sh` -- `deploy` with gates and phases; bootstrap mode when no active record exists; journal at `$state_dir/deploy.journal`.
- [x] `deploy/tests/test_release.sh`, `deploy/tests/test_compose_runtime.sh` -- offline stub tests for every matrix row plus bootstrap, drain failure (exit 8), first-deploy record removal, runtime-up refusals and post-deploy route preservation, and later-phase journal failures; the curl stub answers from the loaded route and slot image, and the test manifests use different commits.
- [x] `deploy/README.md` -- deploy and bootstrap usage, expand-migrate-contract rules, rollback by redeploying a manifest (oldest compatible bundle is this release), exit codes, manual recovery, migration-timeout caveat, admin API decision.

**Acceptance Criteria:**
- Given any failed gate, when deploy exits, then the route file and Caddy target the previously active, healthy slot, or for bootstrap no route is served from an unverified slot.
- Given a successful deploy, when state is inspected, then no migration was reversed, the slot records and route agree, the edge reported the candidate slot header and commit, and the old slot was stopped only after that.
- Given the updated suites, when run, then they pass offline without network or host mutation.

## Spec Change Log

- Review loop 1: on a fresh database `runtime.sh up` could never get blue healthy (readiness requires migrations), and edge verification used the commit only, so it passed vacuously when both slots ran the same commit. Amended: added bootstrap via `release.sh deploy` with no prior slot, a per-slot Caddy response header that edge verification must match, record writes only after verification, lock/journal guarding in `runtime.sh`, and the patch list in Design Notes. Avoids: an unbootstrappable runtime, a false "verified" result, and records naming unverified images. KEEP: the loop-1 structure (sourceable `runtime.sh`, `atomic_write`, compose/Caddy changes, phase journal, exit codes 2-8, `compose_bounded` waits, stubbed docker/curl harness, redacted migrate log, README sections); the reference copy is at `C:/Users/samaw/AppData/Local/Temp/claude/c--mawareeth/555f0ff4-4061-410f-a79f-9bf24c6143de/scratchpad/0-6-loop1-reference/` and may be reused.

## Design Notes

Phases: `idle → candidate-starting → migrating → candidate-ready → switching → verifying → draining → idle`. The journal stores `phase`, `prior_slot` (empty for bootstrap), `candidate_slot`, `manifest_commit`, and the prior commit, so the deferred `recover` command can act on it. Bootstrap: when there is no active record, deploy targets blue, seeds the route, and starts Caddy once the candidate is ready; on failure it stops Caddy and the candidate.

Required hardening:
- Probe the prior slot's readiness before mutation (exit 2 if unhealthy); after any restore, confirm the edge serves the prior slot header, else exit 7.
- A Compose `ps` error is a failure, not "Caddy not running".
- Before overwriting, persist the candidate's previous record as `slots/<slot>.env.prev`.
- `fsync` the temp file and its directory around each rename; set the in-memory phase only after the journal write succeeds.
- Validate the journal's owner/mode and full format.
- Cap each probe attempt at the remaining deadline.
- Create migrate and deploy diagnostic logs as root-only 0600 files, one per deploy, instead of discarding output.
- Refuse a deploy when `git status --porcelain -- deploy` is non-empty.
- Fail with a clear message if the route seed is missing.
- Test harness: resolve real `mv`/`stat`/`install` with `command -v` before stubbing, assert sed patches applied, keep temp dirs outside the checkout or gitignored, and assert that port 2019 is never published.

## Verification

**Commands:**
- `bash -n deploy/runtime.sh deploy/release.sh deploy/tests/*.sh` -- expected: all scripts parse.
- `bash deploy/tests/test_compose_runtime.sh && bash deploy/tests/test_release.sh` -- expected: pass offline.
- `shellcheck deploy/runtime.sh deploy/release.sh deploy/tests/*.sh` -- expected: clean when installed.

## Suggested Review Order

**Deploy state machine**

- Entry point: preflight, bootstrap vs normal, phases, gates, switch, drain.
  [`release.sh:362`](../../deploy/release.sh#L362)

- Prior slot, candidate slot and bootstrap mode come from records and the persisted route.
  [`release.sh:319`](../../deploy/release.sh#L319)

- The journal is written before each phase acts; it records logs and the verified marker.
  [`release.sh:76`](../../deploy/release.sh#L76)

**Failure handling and rollback**

- Post-switch abort restores the route only when it was written, then confirms via the edge.
  [`release.sh:264`](../../deploy/release.sh#L264)

- Pre-switch abort stops the candidate and restores its records and `.prev`.
  [`release.sh:240`](../../deploy/release.sh#L240)

- Safety net for signals and unexpected exits maps each stage to an exit code.
  [`release.sh:294`](../../deploy/release.sh#L294)

- A restore that cannot be confirmed exits 7 and leaves the journal non-idle.
  [`release.sh:253`](../../deploy/release.sh#L253)

**Verification gates**

- The edge must return the slot header and commit; this defeats same-commit false positives.
  [`release.sh:172`](../../deploy/release.sh#L172)

- Running containers must use the recorded or manifest image ID.
  [`release.sh:150`](../../deploy/release.sh#L150)

- Caddy state is read with bounded retries; a `ps` error never means "stopped".
  [`release.sh:194`](../../deploy/release.sh#L194)

- Refuses a stale Caddy container whose reload would read an old mount.
  [`release.sh:339`](../../deploy/release.sh#L339)

- Bounded polling caps each attempt at the remaining deadline.
  [`release.sh:98`](../../deploy/release.sh#L98)

**Runtime integration**

- Mutating runtime commands share the deploy lock and refuse a non-idle journal.
  [`runtime.sh:469`](../../deploy/runtime.sh#L469)

- `up` needs an active record, refuses drift and starts in dependency order.
  [`runtime.sh:491`](../../deploy/runtime.sh#L491)

- The route file is the active-slot authority; stray route files are refused.
  [`runtime.sh:390`](../../deploy/runtime.sh#L390)

- Durable state writes use temp file, fsync and rename.
  [`runtime.sh:333`](../../deploy/runtime.sh#L333)

- Snapshot hashing fails closed instead of hashing empty output.
  [`runtime.sh:204`](../../deploy/runtime.sh#L204)

**Topology**

- Per-slot images and state-directory route mount; Caddy is no longer gated on blue.
  [`compose.yaml:53`](../../deploy/compose.yaml#L53)

- Admin API stays on the container loopback, a documented decision needed for reloads.
  [`Caddyfile:2`](../../deploy/Caddyfile#L2)

- The seed route stamps the slot header that edge verification relies on.
  [`active-slot.caddy:6`](../../deploy/caddy/active-slot.caddy#L6)

**Operations and tests**

- Operator runbook: bootstrap, exit codes, expand-migrate-contract, rollback, recovery.
  [`README.md:40`](../../deploy/README.md#L40)

- The offline suite walks bootstrap, happy path, refusals, failures, signals and rollback.
  [`test_release.sh:326`](../../deploy/tests/test_release.sh#L326)

- Runtime suite covers the new layout, `up` refusals and read-only status/logs.
  [`test_compose_runtime.sh:1`](../../deploy/tests/test_compose_runtime.sh#L1)
