---
title: 'Backup/restore integrity before the 0.9 rehearsal: content checksums, cluster globals, PostgreSQL major, and an incomplete-backup alert'
type: 'feature'
created: '2026-10-21'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'b1f4ebcd18c4a357274520bdaf858fc7b593f60b'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** (1) `verify-restore` compares only row counts, so a restore with the right counts but wrong values passes. (2) Roles and globals are never backed up, and the dump's PostgreSQL major is never recorded, so a restore into a different major is not refused. (3) Nothing alerts when the latest ok backup lacks its `host-state.tar` (or the new globals archive).

**Approach:** Each manifest line gains an order-independent per-table content checksum taken in the same snapshot, and `verify-restore` compares counts first, then checksums. Each run stores a fourth snapshot, `globals.sql` (`pg_dumpall --globals-only`), and tags the dump with `pg-major:<N>`. `verify-restore` refuses a dump whose major differs from the throwaway server's. `monitor.sh` publishes whether the last ok run holds every archive, and a new warning rule alerts when it does not.

## Boundaries & Constraints

**Always:** Nothing unencrypted reaches host disk; `globals.sql` streams straight into `restic backup --stdin`. Every run snapshot stays under the same `pending` → `complete` lifecycle and `run:` tag. A failed `globals` stage fails the run (exit 5) and discards it. Legacy runs still restore and satisfy `gate`. That covers two-column manifests (counts only) and dumps with no `pg-major:` tag or `globals.sql`. Checksums and counts come from one SQL text, run with the same output settings in both sessions. ShellCheck stays clean, and `promtool` tests pass.

**Ask First:** Any change to the `gate` rules, `snapshot_py latest` selection beyond adding the major field, or retention. Restoring `globals.sql` automatically anywhere.

**Never:** `manage.py migrate --check` against the restored database. The checksum already covers `django_migrations` content exactly, and running the app image against the throwaway database needs networking and runtime secrets; it stays deferred. No checksums limited to a hand-picked table list (every user table is checksummed). No change to the host-state failure policy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Nightly backup | Healthy PG 17 | `manifest.tsv` lines are `key<TAB>count<TAB>checksum`; four snapshots (dump, manifest, globals, host-state) tagged complete; dump also tagged `pg-major:17`; `last-backup` gains `globals_snapshot=` and `pg_major=17` | — |
| Globals fail | `pg_dumpall` or its upload fails | `failed:globals` | Exit 5, run discarded |
| Globals unreadable | Stored `globals.sql` lacks the `-- PostgreSQL database cluster dump` line | `failed:verify` | Exit 5 |
| Bad version | `SHOW server_version_num` is not a 5–6 digit number | `failed:dump` | Exit 5 |
| Restore pass | Checksum manifest, same data | `pass`; evidence `content_checksums=1`, `dump_pg_major=17`, `restore_pg_major=17` | — |
| Value corrupted | Counts equal, one value differs | `fail:checksum-mismatch`; differing lines go to the run log | Exit 6 |
| Count differs | Row missing | `fail:count-mismatch` (unchanged) | Exit 6 |
| Legacy manifest | All lines are two-column | Counts-only comparison passes; `content_checksums=0` | — |
| Mixed manifest | Two- and three-column lines | `fail:manifest` | Exit 6 |
| Major differs | Dump `pg-major:16`, throwaway reports 17 | `fail:version-mismatch` before `pg_restore` | Exit 6 |
| No major tag | Legacy dump | Restore proceeds; `dump_pg_major=` empty | — |
| Incomplete ok run | `last-backup` ok but missing `host_state_snapshot` or `globals_snapshot` | `mawareeth_backup_last_archives_complete 0`, and `MawareethBackupIncomplete` fires | — |

</frozen-after-approval>

## Code Map

- `deploy/backup.sh:66-72` -- `count_sql` / `count_line_re`. Add the checksum column and keep a legacy counts-only SQL plus regex for old manifests. Add `output_settings_sql` (the SET statements).
- `deploy/backup.sh:305-362` -- `snapshot_py`. `latest` prints the dump's `pg-major:` tag value (or empty) as a sixth field. `one` is reused for `globals.sql`.
- `deploy/backup.sh:366-378` -- `write_backup_status`: add `globals_snapshot=` and `pg_major=`.
- `deploy/backup.sh:449-499` -- `dump_and_count` coprocess. Read `SHOW server_version_num` after the snapshot export, send the SETs before `count_sql`, and add `pg-major:$pg_major` to the dump's `--tag`.
- `deploy/backup.sh:544-568` -- `store_host_state` pattern for streaming. Add a `store_globals` that streams `docker exec … timeout N pg_dumpall --globals-only` into Restic. Extend `run_ids` with `globals_id`.
- `deploy/backup.sh:570-629` -- `cmd_backup`. Insert stage `globals` between manifest and host-state, add the globals read-back to verify, and tag four IDs.
- `deploy/backup.sh:633-650,708-812` -- `write_evidence` and `cmd_verify_restore`. Detect the manifest format, compare majors after `wait_restore_ready`, then compare counts and checksums.
- `deploy/monitor.sh:68-96` -- `record_metrics` / `render_metrics`. Add the gauge `mawareeth_backup_last_archives_complete`: 1 only for a usable `ok` record whose `host_state_snapshot` and `globals_snapshot` are 64-hex.
- `deploy/monitoring/mawareeth-alerts.yml` -- add the `MawareethBackupIncomplete` warning: `…archives_complete == 0 and …last_result_ok == 1`, with a runbook.
- `deploy/tests/test_backup.sh:87-89,164-299` -- `good_counts` fixture and docker stub. The prod psql must answer `SHOW server_version_num;` and SET lines, and emit the checksum column. Add `pg_dumpall`. Restore psql must handle the SET and SHOW lines and the `restore-corrupt-value` / `restore-major` markers.
- `deploy/tests/test_monitor.sh:147-220,547-600` -- metric cases, rule count 8 → 9, and the promtool unit test for the new rule.
- `deploy/README.md:172-187,193-257,361+` -- command descriptions, exit-reason table, evidence, runbook step 7 (checksum SQL), a globals note in the runbook, known limits (remove the "counts not contents" and "roles not backed up" bullets), and a new `MawareethBackupIncomplete` runbook.

## Tasks & Acceptance

**Execution:**
- [x] `deploy/backup.sh` -- implement checksums, globals stage, major tag/check, status/evidence fields, and update the header comment -- core change
- [x] `deploy/monitor.sh` -- add the archives-complete gauge -- metric for the alert
- [x] `deploy/monitoring/mawareeth-alerts.yml` -- add `MawareethBackupIncomplete` -- alert
- [x] `deploy/tests/test_backup.sh` -- extend stubs and cover every backup and restore row of the I/O matrix -- regression proof
- [x] `deploy/tests/test_monitor.sh` -- cover the gauge (ok complete, ok missing host-state, ok missing globals, failed) and add a promtool test that the rule fires only while the result is ok -- regression proof
- [x] `deploy/README.md` -- document as mapped above -- operator runbook
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- add `resolved_by` to the three resolved entries, and add a new entry for the deferred `migrate --check` -- housekeeping

**Acceptance Criteria:**
- Given a database whose value changes in one row between backup and restore with counts unchanged, when `verify-restore` runs, then it exits 6 with `fail:checksum-mismatch`.
- Given a backup taken by the previous script, when the new `verify-restore` runs, then it passes on counts alone and `gate` is satisfied as before.
- Given the backup and restore sessions, when checksums are computed, then both ran `output_settings_sql` (`TimeZone=UTC`, `DateStyle=ISO, YMD`, `IntervalStyle=postgres`, `extra_float_digits=1`, `bytea_output=hex`) first.

## Design Notes

Per-table checksum, order-independent and constant-memory (no sort, no `string_agg` 1 GB limit):

```sql
SELECT %L, count(*), coalesce(sum(('x' || left(md5(t::text), 16))::bit(64)::bigint::numeric), 0) FROM %I.%I AS t
```

The value is a sum of signed 64-bit hash prefixes. It detects corruption but is not tamper-proof, which is acceptable because the archive is already encrypted and authenticated by Restic. The new manifest regex is `^[^[:cntrl:]]+\t[0-9]+\t-?[0-9]+$`. The major is `server_version_num / 10000`.

## Verification

**Commands:**
- `for s in deploy/tests/test_*.sh; do bash "$s" || echo "FAIL $s"; done` -- expected: no FAIL lines (Linux, as in CI)
- `shellcheck deploy/*.sh deploy/tests/*.sh` -- expected: clean

## Suggested Review Order

**Content checksums**

- Entry point: order-independent, constant-memory checksum per table, same SQL in both sessions.
  [`backup.sh:84`](../../deploy/backup.sh#L84)

- Output settings pinned so rows render identically on both servers.
  [`backup.sh:90`](../../deploy/backup.sh#L90)

- Manifest format detection: all checksum, all legacy, or refuse mixed.
  [`backup.sh:837`](../../deploy/backup.sh#L837)

- Counts compared first, then checksums, so failure reasons stay distinct.
  [`backup.sh:915`](../../deploy/backup.sh#L915)

**PostgreSQL major**

- Major read inside the snapshot transaction, before counting.
  [`backup.sh:509`](../../deploy/backup.sh#L509)

- Tag parsing; empty for legacy dumps, "invalid" for duplicates or garbage.
  [`backup.sh:356`](../../deploy/backup.sh#L356)

- A checksum run without a tag is a regression, refused before any container exists.
  [`backup.sh:844`](../../deploy/backup.sh#L844)

- Throwaway server's major compared before `pg_restore`.
  [`backup.sh:879`](../../deploy/backup.sh#L879)

**Cluster globals**

- Streamed straight into Restic; stored for manual recovery only.
  [`backup.sh:610`](../../deploy/backup.sh#L610)

- Read back in memory and checked for the cluster-dump header.
  [`backup.sh:689`](../../deploy/backup.sh#L689)

- Four snapshots now share one pending → complete lifecycle.
  [`backup.sh:694`](../../deploy/backup.sh#L694)

**Incomplete-backup alert**

- Gauge is 1 only for an ok record naming both archive IDs.
  [`monitor.sh:80`](../../deploy/monitor.sh#L80)

- Warning fires only while the backup is otherwise ok, or the metric is absent.
  [`mawareeth-alerts.yml:36`](../../deploy/monitoring/mawareeth-alerts.yml#L36)

**Tests and docs**

- Legacy runs still restore and open the gate.
  [`test_backup.sh:760`](../../deploy/tests/test_backup.sh#L760)

- Corrupted value with equal counts yields checksum-mismatch.
  [`test_backup.sh:808`](../../deploy/tests/test_backup.sh#L808)

- Gauge cases for missing host-state, globals, and malformed IDs.
  [`test_monitor.sh:199`](../../deploy/tests/test_monitor.sh#L199)

- New runbook for the incomplete-backup alert.
  [`README.md:393`](../../deploy/README.md#L393)
