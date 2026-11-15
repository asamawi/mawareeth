---
title: 'Implement Encrypted Backup and Restore'
type: 'feature'
created: '2026-10-13'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'ed7c0cdecb38e49ca02381fe8e8a7138d62f690d'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-0-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** PostgreSQL lives only on the single Hetzner VPS. Losing the host loses every record, and nothing stops the operator from accepting irreplaceable writes before a recovery has been proven.

**Approach:** Add `deploy/backup.sh` with these commands:
- `backup`: nightly. Streams a consistent `pg_dump -Fc` and a row-count manifest into a client-side encrypted Restic repository in a dedicated Hetzner BX11 Storage Box sub-account, then applies 7 daily / 4 weekly / 6 monthly retention.
- `verify-restore`: monthly. Restores into an isolated throwaway PostgreSQL and proves the counts, the 24h RPO and the 4h RTO.
- `gate`: refuses until a passing restore exists.
- `init`, `install` (systemd timers) and `status`.

## Boundaries & Constraints

**Always:**
- Run Restic only from the `restic/restic` image pinned by digest in `runtime-images.lock` and checked with `validate_image`.
- Keep secrets in root-only files outside the repository: `/etc/mawareeth/backup.env` (raw keys `STORAGE_BOX_USER`, `STORAGE_BOX_HOST`, `RESTIC_REPOSITORY_PATH`), `restic.password` and `storagebox_ed25519` (both 0600), and a pinned `storagebox_known_hosts`.
- Use SFTP on port 23 with `StrictHostKeyChecking=yes`.
- Never write unencrypted dump bytes to host disk.
- Treat any non-zero pipeline stage as a failure; never use `|| true`.
- Tag a dump `complete` only after it starts with `PGDMP` and its manifest is stored.
- Take a non-blocking `flock` on `$state_dir/backup.lock`.
- Bound every wait.
- Write status and evidence atomically as 0600 files under `$state_dir/backup/`.
- Remove the restore container and volume on every exit path.

**Ask First:** Changing retention, RPO/RTO, schedules, Storage Box layout or pinned database images; adding age encryption; contacting a real Storage Box, registry or host.

**Never:**
- Take the deploy lock or touch slots, routes, the journal or snapshots.
- Put Restic secrets in `runtime.env`, CI, logs or command lines.
- Restore into the production database or volume.
- Give the restore container a network.
- Automate alerting (0.8), host rebuild (0.9), host-state backup (deferred), WAL/PITR, or append-only storage.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Nightly backup | Postgres healthy, repository reachable | Dump and manifest snapshots tagged `complete` with a shared `run:<stamp>`; retention applied; status `ok` | N/A |
| Dump fails mid-stream | `pg_dump` non-zero | Run's `pending` snapshots forgotten; status `failed` | Exit 5 |
| Repository unreachable / unknown host key | SFTP fails | Status `failed` | Exit 5, redacted message |
| Concurrent run | Lock held | No mutation | Exit 3 |
| Restore passes | Latest `complete` dump ≤ 24h old, counts equal the manifest, duration ≤ 4h | Evidence `restore-verified` with result `pass`; container and volume removed | N/A |
| Restore mismatch / stale / slow | Any check fails | Evidence result `fail:<reason>` | Exit 6 |
| Gate | Evidence `pass` ≤ 35 days old and last backup `ok` ≤ 26h old | Exit 0 | Otherwise exit 1 naming the unmet condition |

</frozen-after-approval>

## Code Map

- `deploy/runtime.sh:2-21,29-58` -- strict mode, `$state_dir` (`MAWAREETH_RUNTIME_DIR`), `die`, `info`, `file_metadata`, `load_raw_env`. Its 8-key allowlist (L53) stays, so parse `backup.env` with a sibling allowlist. Source it like `release.sh:16-18`.
- `deploy/runtime.sh:89-100` -- `load_lock` regex (L93) and allowlist (L98-99): accept an optional `RESTIC_IMAGE`. `preflight` (L281-300, which needs the manifest) is not reused.
- `deploy/runtime.sh:133-143,215,333-344` -- `validate_image`, `ensure_state_dir`, `atomic_write`, `state_subdir`.
- `deploy/release.sh:53-110` -- `say`, `fail_with`, `open_logs` (0600 per-run logs), `wait_until`/`attempt_limit` patterns.
- `deploy/compose.yaml:29-49` -- find the postgres container by Compose labels (`project=mawareeth`, `service=postgres`, exactly one) and use `docker exec`, because `compose()` needs every slot variable.
- `deploy/bootstrap-host.sh:94-107` -- pattern for writing systemd units from a heredoc.
- `deploy/tests/test_release.sh:8-51,84-304` -- harness to copy: `fail`/`need`, real-tool resolution, temp directory outside the checkout, `EUID` sed patch, docker stub with markers.

## Tasks & Acceptance

**Execution:**
- [x] `deploy/runtime-images.lock`, `deploy/runtime.sh` -- add `RESTIC_IMAGE` (restic 0.18.x, digest from Docker Hub) as an optional lock entry.
- [x] `deploy/backup.sh` -- all commands, per the Design Notes.
- [x] `deploy/backup.env.example` -- the three keys.
- [x] `deploy/tests/test_backup.sh` -- offline stub tests for every matrix row, the generated units, and dump/count snapshot consistency; existing suites still pass.
- [x] `deploy/README.md` -- sub-account setup, password escrow (two off-host copies), `init`, schedules, evidence, the gate as a cutover precondition, a manual restore runbook, deferred risks (the host can prune; no append-only). Fix line 3.

**Acceptance Criteria:**
- Given `backup.sh install`, when the units are inspected, then `mawareeth-backup.timer` runs daily at 02:30 (`RandomizedDelaySec=15m`, `Persistent=true`), `mawareeth-restore-check.timer` runs monthly at 04:00, and both services set `HOME=/root`.
- Given the suites, when they run, then they pass offline without network or host mutation.

## Design Notes

**Consistency.** In one `docker exec -i … psql` coprocess:
1. `BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT pg_export_snapshot();`
2. Exact `count(*)` for every user table, written to the manifest.
3. `pg_dump -Fc --snapshot=<id>`, then `COMMIT`.

Counts and dump then describe the same data, so the restore compares them exactly.

**Snapshots.**
- The dump is stored with `--stdin-filename mawareeth.dump`.
- The manifest is stored with `--stdin-filename manifest.tsv`.
- Both are first tagged `pending,run:<stamp>`.
- They are re-tagged `complete` once `restic dump <id> mawareeth.dump | head -c5` equals `PGDMP`.
- Each run first forgets stale `pending` snapshots.
- Retention: `forget --tag complete --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune`.

**Restic container.** `docker run --rm -i` with read-only secret mounts and the volume `mawareeth-restic-cache` as `RESTIC_CACHE_DIR`. The SFTP command is `-o sftp.command="ssh -p 23 -i … -o UserKnownHostsFile=… -o StrictHostKeyChecking=yes USER@HOST -s sftp"`.

**Restore.**
1. Start the pinned postgres with `--network none`, a labelled temporary volume, and a random password.
2. Run `restic dump … | docker exec -i … pg_restore --exit-on-error --no-owner`.
3. Compare counts, including `django_migrations`.
4. Time the whole run.

## Verification

**Commands:**
- `bash -n deploy/*.sh deploy/tests/*.sh` -- expected: all scripts parse.
- `bash deploy/tests/test_backup.sh && bash deploy/tests/test_compose_runtime.sh && bash deploy/tests/test_release.sh` -- expected: pass offline.
- `shellcheck deploy/backup.sh deploy/tests/test_backup.sh` -- expected: clean if installed.

## Suggested Review Order

**Consistent backup pipeline**

- Entry point: lock, pending cleanup, dump, read-back, tag, re-read IDs, retention.
  [`backup.sh:506`](../../deploy/backup.sh#L506)

- One REPEATABLE READ snapshot feeds both the counts and `pg_dump`; nothing unencrypted touches disk.
  [`backup.sh:444`](../../deploy/backup.sh#L444)

- The dump runs under in-container `timeout`, so server-side work dies with the client.
  [`backup.sh:481`](../../deploy/backup.sh#L481)

- A dump counts as usable only after its stored bytes read back as `PGDMP`.
  [`backup.sh:542`](../../deploy/backup.sh#L542)

- Tagging rewrites IDs; the run's IDs are re-read before status is recorded.
  [`backup.sh:546`](../../deploy/backup.sh#L546)

- Retention of 7/4/6 is applied only to `complete` snapshots.
  [`backup.sh:552`](../../deploy/backup.sh#L552)

**Failure containment**

- Any failure before retention forgets every snapshot of the run.
  [`backup.sh:397`](../../deploy/backup.sh#L397)

- Restic containers get deterministic names and are force-removed after a timeout or failure.
  [`backup.sh:253`](../../deploy/backup.sh#L253)

- Signal and exit handling maps each stage to status, evidence and exit code.
  [`backup.sh:866`](../../deploy/backup.sh#L866)

- One run deadline caps every stage below the systemd timeouts.
  [`backup.sh:115`](../../deploy/backup.sh#L115)

**Isolated restore verification**

- Entry point: repository check, newest complete pair, RPO, disk space, restore, count compare, RTO.
  [`backup.sh:636`](../../deploy/backup.sh#L636)

- The throwaway PostgreSQL has no network, a labelled temporary volume, and a password passed through the environment.
  [`backup.sh:705`](../../deploy/backup.sh#L705)

- The restore uses `--no-owner --no-acl`, so a missing role cannot fail a good backup.
  [`backup.sh:717`](../../deploy/backup.sh#L717)

- Cleanup runs on every path; a removal failure is CRITICAL and `fail:cleanup`.
  [`backup.sh:582`](../../deploy/backup.sh#L582)

**Write gate and scheduling**

- The gate requires `pass` evidence at most 35 days old and an `ok` backup at most 26h old; malformed records fail closed.
  [`backup.sh:771`](../../deploy/backup.sh#L771)

- Units: hourly bounded retries for the restore check, with Nice/IO idle on both services.
  [`backup.sh:839`](../../deploy/backup.sh#L839)

**Configuration and pins**

- Secrets are parsed from a separate raw file with its own allowlist; `runtime.env` is untouched.
  [`backup.sh:128`](../../deploy/backup.sh#L128)

- The lock accepts an optional Restic entry pinned to one exact digest; deploys are unaffected.
  [`runtime.sh:101`](../../deploy/runtime.sh#L101)

**Operations and tests**

- Operator section: setup, escrow, commands, failure reasons, restore runbook, known limits.
  [`README.md:103`](../../deploy/README.md#L103)

- The offline suite walks every matrix row, failure path and unit property.
  [`test_backup.sh:355`](../../deploy/tests/test_backup.sh#L355)

- Example keys for the root-only backup configuration.
  [`backup.env.example:1`](../../deploy/backup.env.example#L1)
