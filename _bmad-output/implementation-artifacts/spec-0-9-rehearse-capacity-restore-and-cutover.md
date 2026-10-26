---
title: 'Rehearse Capacity, Restore, and Cutover'
type: 'feature'
created: '2026-10-26'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'ac2562d1f215523ef59c6dd2eab06f7d3d0235b2'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-0-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 0.10's go-live needs evidence that does not exist yet: whether the CX33 holds both slots under load, how long the Heroku data move takes, and whether that fits the 20-minute write-freeze budget. No tooling exists to copy Heroku's database, time the cutover phases, or measure capacity.

**Approach:** Add `deploy/rehearse.sh` with four subcommands, and `deploy/rehearsal.py` (stdlib only) for sampling, load and evaluation:
- `import` streams a snapshot-consistent `pg_dump` of Heroku into the private PostgreSQL and checks counts and checksums against the source.
- `mark` records the operator's manual cutover phases.
- `capacity` runs both slots and samples the host under load from `rehearsal.py loadgen`.
- `report` combines the evidence, including 0.7's restore record, into a gate verdict and picks the write-freeze or replication path.

Write the runbook in `deploy/README.md`.

## Boundaries & Constraints

**Always:**
- **Source access.** Credentials are libpq keys (`PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD`) in `/etc/mawareeth/heroku-source.env` (root 0600, same strict format as `runtime.env`). They are passed only via `docker run --env-file`. `PGSSLMODE=require` is forced. Clients come from the locked `POSTGRES_IMAGE` (17.11).
- **Dump consistency.** Source counts and the dump come from one exported snapshot, as in `dump_and_count`. Only the `public` schema is copied, with `pg_dump -Fc --no-owner --no-acl --schema=public` → `pg_restore --exit-on-error --no-owner --no-acl`. The dump never touches disk.
- **Target protection.** `import` refuses unless the target has no `public` tables and no app slot is running. It holds both the deploy lock and the backup lock.
- **Capacity scope.** `capacity` never changes the route. It starts the inactive slot from its own slot record and stops it on every exit path.
- **Load and evidence.** The load generator sends only `GET`/`HEAD`. Evidence goes in `$state_dir/rehearsal/` as 0600 `key=value` files written via `atomic_write`.
- **Thresholds** (architecture AD-2):
  - fail if mean CPU >70% or memory used >80% over any 15-minute window;
  - fail on any swap-in/out or OOM kill;
  - fail if the load error rate exceeds 1%.

**Ask First:**
- Running anything against Heroku, DNS, Better Stack, `p1` or a real host.
- Using `heroku maintenance:on` at any point.
- Changing thresholds, the 20- or 30-minute budgets, or the load defaults.

**Never:**
- Switch production DNS, or freeze production writes, during the rehearsal (see Design Notes).
- Write to Heroku.
- Put source credentials in argv, logs, the repository or CI.
- Copy schemas other than `public`, or restore over existing data.
- Add Compose services or resource limits.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Behavior | Error Handling |
|----------|---------------|-------------------|----------------|
| Import ok | Empty target, reachable source | Restore done; counts+checksums match; `import` evidence `pass` with dump/restore/compare seconds | exit 0 |
| Target not empty | Any `public` table in target | Nothing written | exit 2 |
| Slot running / lock held | Slot up / deploy or backup lock taken | Refused | exit 2 / 3 |
| Non-public source tables | User tables outside `public` | Refused, schemas named | exit 2 |
| Mismatch / dump fails | Diff, or pipe status ≠0 | Evidence `fail:<stage>`; differing keys logged | exit 4 |
| Bad source file | Wrong mode/owner/key | Refused before contact | exit 2 |
| Capacity ok | 30 min, no breach | Evidence `pass`, peaks recorded; slot stopped | exit 0 |
| Capacity breach | CPU/mem window, swap or OOM | `fail:<signal>` | exit 4 |
| Freeze path ok | `validated − freeze-start` ≤1200s and `dns-switched − freeze-start` ≤1800s | `path=write-freeze` | — |
| Too slow | `validated − freeze-start` >1200s | `path=replication` | gate fails |
| Gate | Any of import, capacity, restore (pass, ≤35 days old, RPO ≤86400, RTO ≤14400) or a required mark missing/failed | `report` names each unmet item | exit 1 |

</frozen-after-approval>

## Code Map

- `deploy/runtime.sh` -- source it as backup.sh:32-34 does:
  - `state_dir` :12; `die` :32 (exit 2); `atomic_write` :391; `load_raw_env` :44 (pattern for the source file).
  - `load_lock`/`locked[POSTGRES_IMAGE]` :92-105; `preflight_runtime` :334 (no manifest needed); `compose_bounded` :366.
  - `read_active_slot` :448, `read_slot_record` :468, `other_slot` :377, `load_slot_images` :482.
  - `acquire_deploy_lock` :530 (fd 9); guarded main :605.
- `deploy/backup.sh` -- source it; never copy:
  - SQL: `output_settings_sql` :92, `count_sql` :86, `count_line_re` :87, `migrations_key` :108.
  - Container helpers: `find_postgres` :492, in-container `timeout` pattern :523/:567.
  - `dump_and_count` :519-575 (coproc snapshot export, `pipe=("${PIPESTATUS[@]}")`); mirror it with a remote source.
  - Also reuse: `acquire_backup_lock` :261 (fd 8), `now_epoch` :142, `cap` :163, `read_record` :995, restore evidence keys (`write_evidence` :750). Guard :1149.
- `deploy/release.sh:484-498` -- migrations run inside `release.sh deploy`; the runbook calls it after `import`. Don't add a migrate path.
- `deploy/monitor.sh` -- template: header and exit codes :1-30, local `die`/`say`, `cmd_*` dispatch :428.
- `deploy/compose.yaml` -- no resource limits; gunicorn `--workers 3` (Dockerfile:79). Read-only.
- `deploy/tests/test_backup.sh` -- harness:
  - bundle copy and EUID patch :36-45;
  - docker stub with `$S/<flag>` fault files :174;
  - `base_env` :399, `run`/`expect_rc` :403-414.
- `.github/workflows/django.yml:118-135` -- globs `deploy/tests/test_*.sh` and ShellCheck `deploy/*.sh`; Python tests run via `manage.py test`. No edit needed.
- `docs/operations/heroku-inventory.redacted.json` -- source is PostgreSQL 17.10 essential-1. Domains `mawareeth.com` and `www`.
- `deploy/README.md` -- add a section before :555. Fix :265 ("host rebuild is story 0.9").

## Tasks & Acceptance

**Execution:**
- [x] `deploy/rehearsal.py` -- stdlib CLI:
  - `sample --proc DIR --interval S --minutes M` reads `/proc/stat`, `/proc/meminfo`, `/proc/vmstat` and writes TSV;
  - `evaluate TSV` applies the thresholds and prints `key=value`;
  - `loadgen --url --concurrency 20 --minutes 30 --path ...` uses threads over `urllib` and prints requests, error rate and p95; exits 4 when errors exceed 1%.
- [x] `deploy/rehearse.sh` -- `import`, `mark PHASE`, `capacity [--minutes N]`, `report`, per the matrix. Exit codes: 0 ok, 1 gate unmet, 2 refused, 3 lock held, 4 failed. HUP/INT/TERM → 129/130/143.
- [x] `deploy/tests/test_rehearsal.py` -- fake `/proc` fixtures for every threshold edge (69.9/70.1% window, swap delta, OOM delta, <15 min of samples), and a loadgen run against a local `http.server`.
- [x] `deploy/tests/test_rehearse.sh` -- offline stubs for every matrix row, plus the check that source credentials never appear in argv or logs.
- [x] `deploy/README.md` -- a "Cutover rehearsal" section:
  - TTL lowering;
  - the source file (from `heroku pg:credentials:url`);
  - phase marks;
  - the capacity run with the workstation load command;
  - `verify-restore`;
  - `report`;
  - the 0.10 production sequence (`heroku maintenance:on` freeze, import, deploy, validate, DNS, rollback point).

  Also fix :265.

**Acceptance Criteria:**
- Given a rehearsal that ran every step, when `rehearse.sh report` runs, then it prints:
  - the import, capacity and restore results;
  - each phase duration;
  - the chosen path;
  - the gate verdict;

  and it writes `$state_dir/rehearsal/report`.
- Given an import in progress, when `ps` is sampled, then no process argv holds `PGPASSWORD` or a URL.
- Given the suites, when they run, then they pass offline, and all existing suites still pass.

## Spec Change Log

- **First rehearsal on `mawareeth-prod`, 2026-10-27 (in progress).**
  - **Host:** rebuilt CX33 in nbg1 (2.28.64.83, tailnet 100.64.64.22) at release `0b6170f`.
  - **Throwaway record:** `rehearsal.mawareeth.com`, already pointing at the host.
  - **Results so far:**
    - **Import** passed in 12 s total: count 3 s, dump 6 s, restore 6 s, compare 2 s, analyze 1 s. All 49 tables match on counts and checksums, and sequences match. The source is PostgreSQL 17.10.
    - **`validated`** at 22:16:57Z, 4.5 min after `freeze-start` (budget 20 min).
    - **`dns-switched`** marked at the same moment. The record already resolved to the host, so the DNS switch itself was **not measured**; the rollback will be.
    - **Capacity:** a 30-minute run started 22:19Z (20 concurrent GETs over `/en/`, `/ar/` and `/health/ready/`, about 33 req/s).
    - Still to come: the rollback, `backup` with `verify-restore`, and `report`.
  - **Findings, fixed in PR #77 unless noted:**
    1. **No TTL control.** eNom's basic DNS (`name-services.com`) has no TTL field and serves 1800 s. That fills the whole 30-minute `dns-switched` window in 0.10, and a DNS rollback takes up to 30 minutes. `ttl-lowered` was marked without a TTL change. README: move the zone to a host with TTL control at least two days before 0.10. *This is a 0.10 prerequisite, not yet done.*
    2. **Missing extension.** Heroku has `pg_stat_statements` in `public`. The first import refused (exit 2, nothing written) until it was created on the target; then `--extensions-created`. Documented in the README.
    3. **Migrate deadlock.** A first deploy plus a reset left a slot record, and Heroku's schema was 2 migrations behind the release (`calc.0026`, `social_django.0017`). The recorded slot could not become ready, `runtime.sh up` exited 2, and `release.sh deploy` refused to deploy over an unready active slot. Worked around by applying the migrations inside `app-blue`, after checking the plan against `contract_pattern` (48 metadata-only operations and one constraint, with 0 offending rows). The README procedure is in PR #77; a supported command is in deferred work. 0.10 will meet the same state.
    4. **False cleanup warning.** Import cleanup reported "could not remove source containers" when a `--rm` container was already removing itself. Fixed in `rehearse.sh`.
    5. **Disconnect not detected.** The first capacity attempt got no load, because Git Bash rewrote `--path /en/` into a Windows path. The run then sampled on with the extra slot up, since a dropped non-interactive SSH session sends EOF, not SIGHUP. It was terminated (`fail:interrupted`, slot stopped). `capacity` now fails within 5 s when standard input closes early, closing the matching deferred item. The README covers `MSYS_NO_PATHCONV=1`.
  - **Host prerequisites fixed on the way** (PRs #71–#76, see `spec-rehearsal-host-readiness.md`):
    - Docker Hub short names in `validate_image`;
    - Tailscale SSH;
    - provisioning against current `hcloud`;
    - script executable bits;
    - container egress;
    - CI trigger and duration.

## Design Notes

**Rehearsal versus production.** The rehearsal copies live Heroku read-only: one snapshot, no maintenance mode. It rehearses DNS on a throwaway name such as `rehearsal.mawareeth.com`, switched Heroku→Hetzner→Heroku to time propagation and the rollback.

Marks (fixed set):
- `ttl-lowered`
- `freeze-start` (in rehearsal, simulated at `import` start)
- `validated` (after `release.sh deploy` passes)
- `dns-switched`
- `dns-rolled-back`
- `rollback-point`

The last safe rollback point is the moment before Hetzner accepts its first write. Until then, `heroku maintenance:off` plus DNS back is lossless.

**Capacity windows.** The 15-minute windows are rolling over 15-second samples. CPU is the busy-jiffies delta. Memory used is `1 − MemAvailable/MemTotal`. Swap and OOM come from `pswpin`, `pswpout` and `oom_kill` deltas.

## Verification

**Commands:**
- `bash -n deploy/*.sh deploy/tests/*.sh` -- expected: all parse.
- `bash deploy/tests/test_rehearse.sh`, then each other `deploy/tests/test_*.sh` -- expected: pass offline.
- `python manage.py test deploy.tests` -- expected: pass.
- `shellcheck deploy/rehearse.sh deploy/tests/test_rehearse.sh` -- expected: clean if installed.

## Suggested Review Order

**Snapshot-consistent Heroku import**

- Entry point: refusals, locks, snapshot, stream, compare, sequences, ANALYZE — in that order.
  [`rehearse.sh:348`](../../deploy/rehearse.sh#L348)

- One read-only REPEATABLE READ session exports the snapshot counts and pg_dump share.
  [`rehearse.sh:290`](../../deploy/rehearse.sh#L290)

- Credentials reach the container only through `--env-file`; session forced read-only, no timeouts.
  [`rehearse.sh:194`](../../deploy/rehearse.sh#L194)

- Target must hold zero user objects in any schema, not only tables.
  [`rehearse.sh:378`](../../deploy/rehearse.sh#L378)

- Streamed restore in one transaction; restore status is blamed first (SIGPIPE is ignored).
  [`rehearse.sh:410`](../../deploy/rehearse.sh#L410)

- Sequences compared after tables, then ANALYZE so planner statistics exist at cutover.
  [`rehearse.sh:453`](../../deploy/rehearse.sh#L453)

- `--freeze-marked` accepts only a fresh operator mark newer than the last import.
  [`rehearse.sh:381`](../../deploy/rehearse.sh#L381)

**Capacity under both slots**

- Starts the inactive slot from its own verified record; never touches the route.
  [`rehearse.sh:572`](../../deploy/rehearse.sh#L572)

- The load must span the whole sampling window, or the run fails.
  [`rehearse.sh:558`](../../deploy/rehearse.sh#L558)

- AD-2 thresholds over rolling 15-minute windows; any swap or OOM delta fails.
  [`rehearsal.py:190`](../../deploy/rehearsal.py#L190)

- Load refuses unless the hostname resolves to the host, so traffic cannot hit Heroku.
  [`rehearsal.py:407`](../../deploy/rehearsal.py#L407)

- Redirects count as answers and are never followed.
  [`rehearsal.py:319`](../../deploy/rehearsal.py#L319)

**Gate and path decision**

- Combines import, measured capacity, 0.7 restore evidence and marks; requires one coherent run.
  [`rehearse.sh:654`](../../deploy/rehearse.sh#L654)

- Restore must be verified after the import, within RPO/RTO limits.
  [`rehearse.sh:707`](../../deploy/rehearse.sh#L707)

- Mark ordering, including the rollback point between DNS switch and rollback.
  [`rehearse.sh:728`](../../deploy/rehearse.sh#L728)

- Freeze ≤20 min to validation and ≤30 min to DNS, else replication.
  [`rehearse.sh:744`](../../deploy/rehearse.sh#L744)

**Runbook**

- Rehearsal credentials, live-Heroku impact, sequence, and the 0.10 production steps.
  [`README.md:555`](../../deploy/README.md#L555)

**Tests**

- Offline stubs for every matrix row, credential argv scan, signals, gate cases.
  [`test_rehearse.sh:335`](../../deploy/tests/test_rehearse.sh#L335)

- Threshold edges on fake /proc, sampler signals, loadgen against a local server.
  [`test_rehearsal.py:48`](../../deploy/tests/test_rehearsal.py#L48)
