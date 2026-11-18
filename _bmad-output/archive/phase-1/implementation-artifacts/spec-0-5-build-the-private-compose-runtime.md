---
title: 'Build the Private Compose Runtime'
type: 'feature'
created: '2026-10-11'
status: 'done'
review_loop_iteration: 1
baseline_commit: '83fdb4c0ba2bd511683926cbb8193c189028e245'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-0-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The secured host has Docker but no version-controlled runtime for Caddy, PostgreSQL, or interchangeable Django slots. An ad hoc stack could expose private ports, lose durable data, or run mutable images with inconsistent configuration.

**Approach:** Add a Compose bundle and operator preflight that validate inputs, create stable external state, derive one protected configuration snapshot for both slots, and expose only Caddy.

## Boundaries & Constraints

**Always:** Use Compose project `mawareeth`; run Caddy, PostgreSQL, `app-blue`, and `app-green` on private networks; publish only Caddy 80/443; consume canonical GHCR digests; keep PostgreSQL on a pre-created external volume; give both slots the same root-owned mode-0600 configuration snapshot and database URL; add bounded health checks, restart policies, and log rotation; make reruns non-destructive.

**Ask First:** Change fixed names, ports, image/database versions, domain, release contracts, or existing durable state; contact a real registry or host.

**Never:** Build source on-host; deploy tags or branches; publish Django/PostgreSQL; commit secrets, snapshots, certificates, or data; automate migrations, slot switching, rollback, backups, monitoring, DNS, or cutover; replace durable state silently.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| First preparation | Valid root-owned runtime file and app digest | External volume and one mode-0600 hashed snapshot are created | Fail before mutation on invalid inputs, ownership, image, or contracts |
| Repeat preparation | Matching volume and values | Durable state and snapshot are reused | Report drift; never replace state |
| Runtime start | Prepared inputs and available images | Only Caddy binds 80/443; private services become healthy | Report unhealthy dependencies; open no fallback ports |
| Unsafe configuration | Mutable image, missing secret, unsafe mode, or foreign volume | No mutation | Exit non-zero with redacted diagnostics |

</frozen-after-approval>

## Code Map

- `deploy/compose.yaml`, `deploy/Caddyfile`, `deploy/caddy/` -- new topology and directory-mounted route state.
- `deploy/runtime.sh`, `deploy/runtime.env.example`, `deploy/runtime-images.lock` -- strict runtime boundary and image allowlist.
- `deploy/release_manifest.py:63-107`, `deploy/bootstrap-host.sh:43-44,149-154` -- reuse manifest and protected-input contracts.
- `Dockerfile:50-79`, `mawareeth/settings.py:114-146`, `mawareeth/ops_views.py:12-60` -- immutable app, runtime inputs, health.

## Tasks & Acceptance

**Execution:**
- [x] `deploy/compose.yaml`, `deploy/Caddyfile`, `deploy/caddy/active-slot.caddy`, `deploy/runtime-images.lock` -- pin official Caddy `2.11.4` (`sha256:0c994536bddb66445885237f1a5dcc1916bccea922661c76b4e9fc24061f9b52`) and PostgreSQL `17.11` (`sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3`); directory-mount routing, gate Caddy on blue, and use owned external volumes.
- [x] `deploy/runtime.sh`, `deploy/runtime.env.example` -- strictly validate env schema, URL/domain, manifest, paths, Docker/Compose, volume labels and `PG_VERSION`; atomically create an app-only snapshot; run Compose with a sanitized environment.
- [x] `deploy/tests/test_compose_runtime.sh` -- cover the matrix, real metadata rejection, malformed values, allowlists, inspect failures, atomic snapshots, routing semantics, and resolved Compose parsing.
- [x] `deploy/README.md`, `.gitignore` -- document sudo use, URL-safe passwords, immutable IDs, volume/snapshot limits, operation/auditing, and exclusions.

**Acceptance Criteria:**
- Given valid inputs, when Compose starts, then only Caddy publishes 80/443 and all other services remain private.
- Given repeated preparation or container recreation, when state is inspected, then the external database volume and matching snapshot survive without duplication.
- Given a manifest and runtime file, when preflight runs, then only the expected digest/contracts pass and both slots receive one snapshot without secret output.
- Given an unhealthy or restarting service, when status/logs are inspected, then health is visible, logs stay bounded, and no migration or route switch occurs.

## Spec Change Log

- Review loop 1: arbitrary infrastructure digests, weak env/URL/volume checks, excess app secrets, non-atomic state, inherited overrides, and mocked verification triggered rework. Require verified indexes, app-only raw snapshots, atomic validation, directory-mounted routing, and real permission/Compose tests. KEEP fixed names, Caddy-only ports, private slots, app-manifest validation, protected snapshots, bounded health/logs, and no migration/switch automation. CI enforcement and snapshot cleanup were deferred by user choice.

## Design Notes

Preflight owns validation/durable prerequisites; Compose owns lifecycle. Give apps one raw-format least-privilege snapshot and pass infrastructure values through a sanitized process environment. Mount the protected route directory for atomic replacement. Labels establish ownership; `PG_VERSION` establishes database-major compatibility.

## Verification

**Commands:**
- `bash -n deploy/runtime.sh deploy/tests/test_compose_runtime.sh` -- expected: scripts parse successfully.
- `bash deploy/tests/test_compose_runtime.sh` -- expected: offline contract and edge-case tests pass without network or host mutation.
- `APP_IMAGE=ghcr.io/example/mawareeth@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa APP_SNAPSHOT="$PWD/deploy/runtime.env.example" POSTGRES_IMAGE=docker.io/library/postgres:17.11@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3 CADDY_IMAGE=docker.io/library/caddy:2.11.4@sha256:0c994536bddb66445885237f1a5dcc1916bccea922661c76b4e9fc24061f9b52 POSTGRES_DB=mawareeth POSTGRES_USER=mawareeth POSTGRES_PASSWORD=abcdefghijklmnopqrst DOMAIN=example.com docker compose --project-name mawareeth -f deploy/compose.yaml config --quiet` -- expected: a valid stack without printing runtime values.
- `shellcheck deploy/runtime.sh deploy/tests/test_compose_runtime.sh` -- expected: no shell-safety findings when ShellCheck is installed.
- `git check-ignore -v deploy/runtime/runtime.env deploy/runtime/*.snapshot.env` -- expected: generated runtime configuration is ignored while `deploy/runtime.env.example` remains tracked.

## Suggested Review Order

**Runtime Boundary**

- Start with the privileged entrypoint, validation sequence, and command behavior.
  [`runtime.sh:233`](../../deploy/runtime.sh#L233)

- Manifest identity is parsed and validated atomically from protected input.
  [`runtime.sh:89`](../../deploy/runtime.sh#L89)

- Volume creation validates ownership, compatibility, failures, and races.
  [`runtime.sh:158`](../../deploy/runtime.sh#L158)

- Compose resolves against a temporary protected snapshot before durable mutation.
  [`runtime.sh:218`](../../deploy/runtime.sh#L218)

**Private Topology**

- Shared app policy requires immutable images and one raw protected snapshot.
  [`compose.yaml:3`](../../deploy/compose.yaml#L3)

- PostgreSQL remains private and uses fixed external durable state.
  [`compose.yaml:29`](../../deploy/compose.yaml#L29)

- Caddy alone publishes TCP 80/443 and waits for blue health.
  [`compose.yaml:63`](../../deploy/compose.yaml#L63)

**Operations And Evidence**

- Operator guidance covers offline images, ACME prerequisites, and state handling.
  [`README.md:5`](../../deploy/README.md#L5)

- Offline tests exercise malformed inputs, metadata failures, races, and Compose parsing.
  [`test_compose_runtime.sh:10`](../../deploy/tests/test_compose_runtime.sh#L10)

- Every durable volume role rejects foreign ownership metadata.
  [`test_compose_runtime.sh:243`](../../deploy/tests/test_compose_runtime.sh#L243)
