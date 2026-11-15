---
title: 'Review fixes for the backup/restore integrity change (#64)'
type: 'bugfix'
created: '2026-10-25'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'b38eeda0a743d180dee727195f38142a070a2b1a'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A review of #64 found several issues. The major is computed wrongly for five-digit (9.x) versions. A backup role that is not a superuser fails every nightly run at `globals`. Checksums depend on the unpinned `search_path`. `archives_metric` relies on a leftover global, and the restore record does not show how much of the RTO the checksum pass used. There is also duplicated or redundant logic in `backup.sh`.

**Approach:** Fix each finding in place. The RTO keeps covering the whole `verify-restore` run, and the restore record gains a `restore_seconds` field. A role that is not a superuser stores its globals without password hashes, and the backup record says so.

## Boundaries & Constraints

**Always:** Runs written by the previous script still restore and satisfy `gate`: counts-only manifests, dumps without a `pg-major:` tag, and records without the new fields. Nothing unencrypted reaches host disk. ShellCheck stays clean, and `promtool` tests pass.

**Ask First:** Any change to `rto_seconds`, the deadline arithmetic, `unit_start_timeout`, the `gate` rules, or retention.

**Never:** Running the checksum pass concurrently with `pg_dump`; that is deferred. No new alert rule.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Superuser backup | `SHOW is_superuser` = `on` | `pg_dumpall --globals-only` without extra flags; `last-backup` has `globals_role_passwords=1` | — |
| Non-superuser backup | `SHOW is_superuser` = `off` | `--no-role-passwords` is added; the run is `ok` with `globals_role_passwords=0`, and the log names the cause | — |
| Bad superuser value | Anything other than on/off | `failed:dump` | Exit 5 |
| Old server version | `server_version_num` = `90600` (five digits) | `failed:dump` (invalid server_version_num); the throwaway equivalent gives `fail:setup` | Exit 5 / 6 |
| Single-digit tag | Dump tagged `pg-major:9` | `fail:version-mismatch` (malformed tag) before any throwaway exists | Exit 6 |
| Restore pass | Checksum manifest | `pass`; evidence has `restore_seconds` ≤ `duration_seconds` | — |
| Count differs | Row missing | `fail:count-mismatch`; the diff goes to the run log | Exit 6 |
| Value differs | Counts equal | `fail:checksum-mismatch`; the diff goes to the run log | Exit 6 |

</frozen-after-approval>

## Code Map

- `deploy/backup.sh:73-96` -- `output_settings_sql` (append `SET search_path = '';`, safe because every name is `%I.%I`-qualified) and `version_re` (now `^[1-9][0-9]{5}$`). Add `major_re='^[1-9][0-9]{1,2}$'` next to it.
- `deploy/backup.sh:149-158` -- `cap`; add a `pg_major_of VERSION NAME` helper below it (validates against `version_re`, uses `printf -v` to set NAME = value/10000) and use it at both call sites (`:512-513` and `:885-886`).
- `deploy/backup.sh:354-359,392` -- Python `major_of` hardcodes the major regex; pass `major_re` as `argv[5]` from the `latest` call (`:815`). The Bash check at `:823` uses `$major_re`.
- `deploy/backup.sh:406-418` -- `write_backup_status`; add `globals_role_passwords=` (empty when the run failed before the role was read).
- `deploy/backup.sh:507-513` -- the `dump_and_count` coprocess; after the version, send `SHOW is_superuser;` and read and validate it into the global `pg_superuser`.
- `deploy/backup.sh:606-621` -- `store_globals`; when it is not `on`, add `--no-role-passwords` as a trailing argument and `say` why.
- `deploy/backup.sh:709-727` -- `write_evidence`; add `restore_seconds=$restore_seconds` from a new global (initialised to `''` beside `restore_pg_major`), in the same way as `content_checksums`, so `restore_fail` and the `on_exit` writers (`:1073-1074`) need no change.
- `deploy/backup.sh:789,830-840` -- remove `columns`, `line_columns`, and `verify_sql`; derive per-line flags into `content_checksums` alone, and pick `count_sql`/`legacy_count_sql` at the point of use.
- `deploy/backup.sh:892-917` -- set `restore_seconds` after `pg_restore`. Replace the two comparisons with one `[[ "$restored" != "$stored" ]]`, choose the reason by comparing `cut -f1,2` only on that failure path, and use a single diff.
- `deploy/monitor.sh:80-90,102` -- `archives_metric` reads `$status_file` itself via `read_record` and checks `result=ok`, independent of call order.
- `deploy/tests/test_backup.sh:92` -- `expected-settings` gains the search_path line. `:255-271` prod psql stub answers `SHOW is_superuser;` (`off` with the `$S/not-superuser` marker). `:259,308` add a five-digit version marker. `:285` already records `dumpall-args`.
- `deploy/tests/test_monitor.sh` -- add a case where `render_metrics` order cannot leak: the evidence record lacks `globals_snapshot` while the backup is complete, and the result is still 1.
- `deploy/README.md:172-187` -- the version rule (six digits, PostgreSQL 10+), search_path, the non-superuser globals note, the `globals_role_passwords`/`restore_seconds` fields, and a note that the RTO includes the count and checksum pass.

## Tasks & Acceptance

**Execution:**
- [x] `deploy/backup.sh` -- apply every Code Map change above and update the header comment -- core fixes
- [x] `deploy/monitor.sh` -- make `archives_metric` self-contained -- order independence
- [x] `deploy/tests/test_backup.sh` -- stub updates, and cover every I/O-matrix row -- regression proof
- [x] `deploy/tests/test_monitor.sh` -- add an order-independence case -- regression proof
- [x] `deploy/README.md` -- document as mapped -- operator runbook
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- add an entry deferring "run the checksum pass alongside `pg_dump` so the exported snapshot's xmin horizon is held for max(count, dump) instead of their sum" -- housekeeping

**Acceptance Criteria:**
- Given both psql sessions, when checksums are computed, then `SET search_path = '';` ran before the checksum query.
- Given a record written by the previous script (no `globals_role_passwords`, no `restore_seconds`), when `gate`, `status`, and `monitor.sh collect` run, then they behave as before.
- Given the major regex, when the shell or the Python code is checked, then the pattern exists in only one place (`major_re`).

## Design Notes

The RTO stays whole-run by the user's decision: the checksum pass still counts against the 4-hour budget. `restore_seconds` (time from start to the end of `pg_restore`) lets an operator see how much of `duration_seconds` was spent verifying.

## Verification

**Commands:**
- `for s in deploy/tests/test_*.sh; do bash "$s" || echo "FAIL $s"; done` -- expected: no FAIL lines (Linux, as in CI)
- `shellcheck deploy/*.sh deploy/tests/*.sh` -- expected: clean

## Suggested Review Order

**PostgreSQL version and major**

- Entry point: one helper turns server_version_num into a major for both sessions.
  [`backup.sh:177`](../../deploy/backup.sh#L177)

- Six digits only (PostgreSQL 10+), and the single tag pattern beside it.
  [`backup.sh:106`](../../deploy/backup.sh#L106)

- Python receives `major_re` as a parameter instead of its own copy.
  [`backup.sh:379`](../../deploy/backup.sh#L379)

- The `latest` call passes the pattern through.
  [`backup.sh:853`](../../deploy/backup.sh#L853)

**Globals for a role that is not a superuser**

- The backup session reads `is_superuser` before counting; anything other than on/off fails.
  [`backup.sh:543`](../../deploy/backup.sh#L543)

- Without superuser rights, `--no-role-passwords` keeps the run alive instead of failing nightly.
  [`backup.sh:649`](../../deploy/backup.sh#L649)

- The field is written only for ok runs, so a failed run never claims globals.
  [`backup.sh:429`](../../deploy/backup.sh#L429)

**Checksum determinism and restore comparison**

- An empty search_path pins reg* rendering; every name is already qualified.
  [`backup.sh:102`](../../deploy/backup.sh#L102)

- A single comparison and diff; the count columns pick the failure reason.
  [`backup.sh:959`](../../deploy/backup.sh#L959)

- `content_checksums` is the only manifest-format state; a refused manifest leaves it empty.
  [`backup.sh:879`](../../deploy/backup.sh#L879)

- `restore_seconds` shows how much of the whole-run RTO went to the restore itself.
  [`backup.sh:948`](../../deploy/backup.sh#L948)

**Monitoring**

- Reads its own record and requires a valid epoch, so call order no longer matters.
  [`monitor.sh:85`](../../deploy/monitor.sh#L85)

**Tests and docs**

- Non-superuser backup records 0 and passes `--no-role-passwords`.
  [`test_backup.sh:602`](../../deploy/tests/test_backup.sh#L602)

- Records from the previous script still satisfy gate and status.
  [`test_backup.sh:748`](../../deploy/tests/test_backup.sh#L748)

- Mixed manifest in the reverse order is refused.
  [`test_backup.sh:791`](../../deploy/tests/test_backup.sh#L791)

- Operator notes: version rule, search_path, and password recovery for globals without hashes.
  [`README.md:172`](../../deploy/README.md#L172)
