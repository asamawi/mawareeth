---
title: 'Pre-cutover deploy safety: bounded readiness, proxy trust, contract-migration gate, private release identity'
type: 'feature'
created: '2026-10-20'
status: 'done'
review_loop_iteration: 1
baseline_commit: '3889ca543a442bad3342a755619e1e342fb1db47'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-0-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Four deferred gaps weaken the Hetzner runtime before cutover. A stalled PostgreSQL pins a gunicorn worker in `/health/ready/` until gunicorn's 60s timeout. Nothing locks in that Caddy discards client `X-Forwarded-Proto` and that Django is reachable only through Caddy. A deploy will run a schema removal or rename that breaks the still-serving old slot. `/health/release/` publishes the exact version and commit to the internet.

**Approach:** Bound the readiness queries with transaction-local PostgreSQL timeouts. Pin the proxy-trust invariants with contract tests and runtime-contract docs. Make `release.sh deploy` inspect `migrate --plan` and refuse contract operations unless `--allow-contract` is passed. Make Caddy answer 404 for `/health/release*` to every client. The deploy's edge check then proves the slot from the `X-Mawareeth-Slot` header on `/health/ready/` through the edge, and the commit from that slot's direct `/health/release/` probe. (Human decision, review loop 1: a source-address allowlist fails for IPv6, because Docker's userland proxy makes every IPv6 client look like the private bridge gateway.)

## Boundaries & Constraints

**Always:**
- Keep readiness responses diagnostic-free.
- Apply the timeouts only inside the probe's own transaction, so pooled connections (`conn_max_age=600`) keep their defaults.
- Keep `release.sh`'s refusal and exit-code model.
- The plan output goes to the root-only migrate log, never to the terminal.
- The edge check must still prove, over verified TLS through `curl --resolve DOMAIN:443:127.0.0.1`, that the edge serves the expected slot and that the slot runs the expected commit.
- Every new rule gets an offline test in the existing suites.

**Ask First:**
- Changing `route_content` (existing route files would stop matching).
- Adding `trusted_proxies` anywhere.
- Refusing operations beyond the seven listed in the matrix.
- Any change to deploy exit codes.

**Never:**
- Run, reverse or fake migrations outside the existing forward `migrate --noinput`.
- Add an environment-variable bypass for the gate.
- Block `/health/live/` or `/health/ready/` (Better Stack probes `/health/ready/` publicly).
- Rely on client source addresses for privacy.
- Contact a real host.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Ready, healthy DB | queries finish | 200 `{"status":"ok","database":"ok","schema":"ok"}` | N/A |
| Stalled or locked DB | a statement or lock wait > 2s | 503 `{"status":"error"}`; cause logged | Exception caught by `ready` |
| Additive plan | plan lists only add, create, alter or `Raw Python operation` lines | Deploy continues to `migrate --noinput` | N/A |
| Contract plan, no flag | an indented plan line starting `Remove field `, `Delete model `, `Rename field `, `Rename model `, `Rename table for `, `Raw SQL operation` or `Custom state/database change combination` | Candidate aborted before `migrating`, route unchanged, message names `--allow-contract` | Exit 5, journal idle `failed:candidate-starting` |
| Contract plan, with flag | same, plus `release.sh deploy --allow-contract` | Deploy proceeds; the log records that contract operations were allowed | N/A |
| Plan command fails | `migrate --plan` exits nonzero | Candidate aborted; output kept in the migrate log | Exit 5 |
| Any client requests release identity through Caddy | `/health/release`, `/health/release/`, any source address | Caddy 404; app not contacted | N/A |
| Edge check | route targets slot X running commit C | Passes only when edge `/health/ready/` carries `X-Mawareeth-Slot: X` and returns 200, and slot X's direct `/health/release/` reports C | Wrong slot or commit → existing failure paths (2, 5/6, 7) |

</frozen-after-approval>

## Code Map

- `mawareeth/ops_views.py` -- `_database_ready` and `_schema_ready` (MigrationExecutor reads `django_migrations`). `ready` catches every exception and returns 503.
- `mawareeth/settings.py:144` -- `connect_timeout` defaults to 5s (`DATABASE_CONNECT_TIMEOUT`); `CONN_HEALTH_CHECKS=True`; `conn_max_age=600`; `ATOMIC_REQUESTS` is not set. CI tests on PostgreSQL.
- `mawareeth/tests.py:143` -- `OpsEndpointTests`.
- `deploy/Caddyfile` -- site block imports `routes/*.caddy`. `respond` sorts before `reverse_proxy`. Caddy 2.11.4 replaces client `X-Forwarded-*` unless `trusted_proxies` is set.
- `deploy/runtime.sh:346` `route_content` -- compared byte for byte (`:394,422`). Do not change it.
- `deploy/compose.yaml` -- app slots `expose: 8000` only; Caddy publishes 80/443 on all addresses. Docker IPv6 is off (`bootstrap-host.sh:78`), so IPv6 clients arrive through docker-proxy as the bridge gateway.
- `deploy/release.sh:178-206` -- `edge_fetch`, `edge_serves SLOT COMMIT` (now: release header + commit via edge, then edge ready), `edge_candidate`, `edge_prior`; also `recover_target_edge` (`:592`). `probe SLOT PATH` and `json_commit` (`:140-162`) already read a slot's commit directly.
- `deploy/release.sh:470-473` -- candidate live → `journal migrating` → `migrate --noinput`; dispatch `:807-815`; `abort_candidate` exits 5.
- `deploy/tests/test_release.sh` -- compose stub `exec` (`:129-162`; `wrong-commit-$service` fakes a slot commit); curl edge stub (`:196-226`); `:517` asserts the edge fetched `/health/release/`; `mutations()` `:344`, `migrations()` `:355`; `:737` requires every recorded manage.py call to be `migrate --noinput`.
- `deploy/tests/test_compose_runtime.sh:39` -- grep contract checks.
- `deploy/README.md:44-60` deploy steps, `:70-80` exit table, `:409-417` runtime contract.
- Django 5.2: `migrate --plan` prints each operation as four spaces plus `describe_operation()` (`django/core/management/commands/migrate.py:241-253,487`). RunSQL shows as `Raw SQL operation`, `SeparateDatabaseAndState` as `Custom state/database change combination`.

## Tasks & Acceptance

**Execution:**
- [x] `mawareeth/ops_views.py` -- On PostgreSQL, and only when the connection is not already inside an atomic block, run both readiness checks inside one `transaction.atomic()` that first issues `SET LOCAL statement_timeout` and `lock_timeout` of `2s`. Otherwise run them unchanged.
- [x] `mawareeth/tests.py` -- PostgreSQL-only tests (a `SimpleTestCase` with `databases={"default"}`, so autocommit is real): both timeouts are `2s` during the probe and unchanged afterwards; a `pg_sleep` past the timeout yields a diagnostic-free 503 with the cause logged; inside an outer atomic block no `SET LOCAL` is issued. Add a vendor-independent test that reads `contract_pattern` from `deploy/release.sh`. It renders each contract operation (RemoveField, DeleteModel, RenameField, RenameModel, AlterModelTable, RunSQL, SeparateDatabaseAndState) through `migrate.Command.describe_operation` with the four-space prefix, and asserts each one matches while AddField and CreateModel do not. Keep imports sorted.
- [x] `deploy/release.sh` -- Accept `deploy [--allow-contract]` (usage text and header). Before `journal migrating`, run `migrate --plan --no-color` in the candidate, bounded by `migrate_timeout`. Capture stdout for matching and send stderr only to the migrate log; append the plan to the log. Abort if the command fails, or if a line matches `contract_pattern` (`^    (Remove field |Delete model |Rename field |Rename model |Rename table for |Raw SQL operation|Custom state/database change combination)`) without the flag. With the flag, log and `say` that contract operations were allowed. Append `migrate --noinput` output to the log (`>>`). Rewrite `edge_serves SLOT COMMIT` per the matrix: `edge_fetch /health/ready/` with its header, then `probe SLOT /health/release/` commit.
- [x] `deploy/tests/test_release.sh` -- Stub `migrate --plan --no-color` separately from migrations: record it in `$S/plans`, serve `$S/plan-output`, and fail on `$S/fail-plan`. Count only `migrate --noinput` as a mutation. Make the curl stub answer `/health/release/` with 404, like Caddy. Change `:517` to assert that the edge is never asked for `/health/release/` and that `/health/ready/` is. Cover:
  - an additive plan deploys, and the plan runs before migrating;
  - each of the seven phrases refuses with exit 5, no migrate, and no plan text on the terminal;
  - an anchoring fixture `'    Raw Python operation -> Remove field x from y'` passes;
  - a failed plan exits 5;
  - bad arguments exit 2 with nothing touched;
  - `--allow-contract` deploys;
  - a wrong slot commit (via `wrong-commit-app-<slot>`) fails the edge check.

  Keep every existing assertion passing.
- [x] `deploy/Caddyfile` -- Add `respond /health/release* 404` with a comment explaining why (IPv6 via docker-proxy defeats address checks; the deploy verifies the commit directly). Add no address matcher.
- [x] `deploy/tests/test_compose_runtime.sh` -- Assert:
  - the Caddyfile has that respond line;
  - the Caddyfile does not use `remote_ip`;
  - neither the Caddyfile nor the `route_content blue`/`green` output contains `trusted_proxies` or `header_up x-forwarded` (case-insensitive);
  - neither `x-app` nor any `app-*` service has `ports:` or `network_mode:`.
- [x] `deploy/README.md` -- Deploy steps and the exit table: the plan gate, all seven operations, `--allow-contract`, and the new edge check. Warn that rolling back after an allowed contract release puts the old slot on a schema it may not support. Runtime contract:
  - Caddy overwrites client `X-Forwarded-*`;
  - the slots are `expose`-only;
  - `/health/release/` returns 404 through Caddy and is reached only by direct slot probes;
  - the timeouts apply per statement, and the connect timeout (default 5s) is not covered by them;
  - a Caddyfile change needs a Caddy reload, or recreating the container if the bind mount is stale.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- Add `resolved_by` to the four source entries. Append a new entry for running the Caddyfile through the pinned image (`caddy adapt`) in CI.

**Acceptance Criteria:**
- Given the full Django suite on PostgreSQL, when `python manage.py test` runs, then it passes, including the new tests.
- Given the deploy shell suites, when `test_release.sh` and `test_compose_runtime.sh` run, then they pass, and ShellCheck reports nothing new.
- Given a contract refusal, when the operator reads the terminal, then it names `--allow-contract` and the migrate log path but shows no plan or database text.

## Spec Change Log

- **Loop 1 (intent_gap, human-resolved).**
  - **Trigger:** review found that with Docker IPv6 off, IPv6 clients reach Caddy through docker-proxy as the private bridge gateway, so `not remote_ip private_ranges` exposed `/health/release/` to every IPv6 client.
  - **Human decisions:**
    - Block release identity at Caddy for everyone, and verify the commit by direct slot probe (1a).
    - Also gate `Raw SQL operation` and `Custom state/database change combination` (2a).
  - **Amended:** intent, constraints, matrix, tasks.
  - **Also folded in from review:**
    - plan stderr kept out of matching;
    - a Django-wording regression test;
    - an anchoring fixture that would actually catch a missing anchor;
    - a case-insensitive header grep and a `network_mode` check;
    - an atomic-block guard;
    - accurate timeout wording;
    - a rollback warning for contract releases.
  - **Known-bad state avoided:** release identity public over IPv6.
  - **KEEP:** iteration 1's work is saved at `C:\Users\samaw\AppData\Local\Temp\claude\c--mawareeth\4c47f55d-bb36-4108-88d0-940023118c89\scratchpad\iteration-1.patch`. Reuse its readiness code and its `SimpleTestCase` approach (`SET LOCAL` would outlive a savepoint inside `TestCase`). Also reuse the plan-gate structure and messages, the test-stub design (`$S/plans`, `$S/plan-output`, `$S/fail-plan`, the narrowed `mutations()`), the awk compose check, and the README wording, adjusted to this spec.

## Verification

**Commands:**
- `python manage.py test mawareeth` (PostgreSQL `DATABASE_URL`, plus SQLite) -- expected: OK
- `bash deploy/tests/test_release.sh && bash deploy/tests/test_compose_runtime.sh` -- expected: exit 0
- `shellcheck deploy/*.sh deploy/tests/*.sh` (0.11.0) -- expected: no findings

## Suggested Review Order

**Private release identity and the new edge check**

- Entry point: edge proves slot via `/health/ready/` header, commit via direct slot probe.
  [`release.sh:199`](../../deploy/release.sh#L199)

- Caddy hides release identity from every client; no address-based exception (IPv6).
  [`Caddyfile:21`](../../deploy/Caddyfile#L21)

- Runtime contract explains the decision and the IPv6/docker-proxy reasoning.
  [`README.md:437`](../../deploy/README.md#L437)

**Contract-migration gate**

- Seven Django plan phrases that require `--allow-contract`.
  [`release.sh:69`](../../deploy/release.sh#L69)

- Plan runs before `journal migrating`; stdout matched, everything logged root-only.
  [`release.sh:484`](../../deploy/release.sh#L484)

- Argument dispatch accepts only `deploy [--allow-contract]`.
  [`release.sh:838`](../../deploy/release.sh#L838)

- Operator docs: the seven operations, rollback warning, NOT NULL caveat.
  [`README.md:55`](../../deploy/README.md#L55)

**Bounded readiness probe**

- Transaction-local 2s statement/lock timeouts on PostgreSQL, skipped inside outer atomic blocks.
  [`ops_views.py:46`](../../mawareeth/ops_views.py#L46)

- Excluded from `ATOMIC_REQUESTS` so the timeouts keep applying.
  [`ops_views.py:70`](../../mawareeth/ops_views.py#L70)

**Proxy trust**

- Caddy overwrites client `X-Forwarded-*`; slots are expose-only.
  [`README.md:430`](../../deploy/README.md#L430)

**Tests**

- Real-PostgreSQL timeout tests in autocommit (`SimpleTestCase`), incl. no-leak and atomic guard.
  [`tests.py:215`](../../mawareeth/tests.py#L215)

- Pattern checked against Django's own `describe_operation` wording.
  [`tests.py:278`](../../mawareeth/tests.py#L278)

- Gate scenarios: seven refusals, anchoring, stderr, failed plan, bad args.
  [`test_release.sh:778`](../../deploy/tests/test_release.sh#L778)

- Compose and Caddyfile invariants: no address matchers, no published slot ports.
  [`test_compose_runtime.sh:46`](../../deploy/tests/test_compose_runtime.sh#L46)
