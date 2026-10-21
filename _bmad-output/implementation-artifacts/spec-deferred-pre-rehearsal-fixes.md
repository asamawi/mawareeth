---
title: 'Host-state backup, signal-safe runtime temp files, and deferred-log housekeeping before the 0.9 rehearsal'
type: 'feature'
created: '2026-10-21'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'bef8a7256f13a2919a290ea4b3c5b9015ee3ee6e'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** (A) A rebuilt host must hand-recreate `runtime.env`, slot records, and routes, because nightly backups hold only the database. (C) `runtime.sh`'s secret-bearing temp files (the validation dir and `.snapshot.XXXXXX`) are removed on `die`/`set -e` but leak when INT/TERM/HUP arrives inside the window. (L) `sprint-status.yaml`'s `generated` value has seconds, so `sprint_plan.py validate` fails. Several deferred-work entries are already resolved but not marked.

**Approach:** Each `backup.sh backup` run streams an encrypted `host-state.tar` (runtime file, `slots/`, `routes/`, and the runtime snapshots the slot records name) into Restic as a third snapshot under the same `run:` tag and pending → complete lifecycle. Document restoring it in the rebuild runbook. In `runtime.sh`, defer INT/TERM/HUP during each temp window, clean up, restore the caller's traps, and re-raise. Fix the timestamp and add `resolved_by` notes.

## Boundaries & Constraints

**Always:** Nothing unencrypted is written to host disk; the tar streams straight into `restic backup --stdin`. A host-state failure fails the whole run as today: exit 5, the run is discarded, and the stage is recorded. Older runs without `host-state.tar` still restore and still satisfy `gate`. backup.sh still never takes the deploy lock and never writes slots, routes, the journal, or snapshots. Signals that are ignored when a window opens (`trap ''`, as release.sh uses in critical sections) stay ignored. ShellCheck stays clean.

**Ask First:** Archiving the deploy journal or `/etc/mawareeth` secrets beyond `runtime.env`. Any change to restore selection (`snapshot_py latest`) or the `gate` rules.

**Never:** An automated host-state restore command (runbook only). Global `EXIT` traps in runtime.sh. Other deferred items (config rotation, snapshot retention, backup integrity checks).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Nightly backup | runtime.env, routes, blue/green records (+ `.prev`) naming snapshots | One complete `host-state.tar` holding exactly those paths plus the referenced `*.snapshot.env` files; status gains `host_state_snapshot=` | — |
| No slot records yet | `slots/` absent or empty | Archive holds runtime.env and routes only | — |
| Referenced snapshot missing | Record names a snapshot file that does not exist | Run fails at stage `host-state` | Exit 5, run discarded |
| tar/upload fails | tar non-zero or Restic store fails | Same as above | Exit 5 |
| Signal in validation window | TERM delivered while `compose config` runs | Temp dir removed; process ends by TERM (status 143) | — |
| Signal in publish window | TERM during `write_snapshot`'s temporary branch | No `.snapshot.*` left in state dir; status 143 | — |
| Caller trap preserved | Sourced with a TERM trap set (release.sh) | Window ends, caller's trap runs once | — |
| Ignored signal | `trap '' TERM` before the window | Signal stays ignored; window completes normally | — |

</frozen-after-approval>

## Code Map

- `deploy/backup.sh:1-19` -- header contract ("never touches slots, routes ... snapshots"). Reword it to say these are read only, for the host-state archive.
- `deploy/backup.sh:173` -- `require_command` list. Add `tar`.
- `deploy/backup.sh:362-373` -- `write_backup_status`. Add `host_state_snapshot=$host_state_id`.
- `deploy/backup.sh:497-504` -- `run_ids` uses `snapshot_py one` per filename. Extend it to `host-state.tar`.
- `deploy/backup.sh:531-553` -- the manifest / verify / tag stages. Insert stage `host-state` after manifest, and tag three IDs at `:546`.
- `deploy/backup.sh:397-402` -- `discard_run` skips early stages. `host-state` must not be added there, so discard runs.
- `deploy/runtime.sh:12-17` -- `state_dir`, `routes_dir`, `slots_dir`, `runtime_file`. `read_slot_record` (around `:432`) sets `SLOT_SNAPSHOT` (a basename) and takes a `.prev` suffix.
- `deploy/runtime.sh:240-291` -- `write_snapshot` and `validate_compose_model` subshell windows (pattern from `spec-deferred-deploy-correctness-fixes`).
- `deploy/release.sh:278,302,339,402-405,564,646-649` -- the caller's INT/TERM/HUP traps (ignore or `exit 12x`) that must survive.
- `deploy/tests/test_backup.sh:15` -- grep guard forbidding `slots_dir|routes_dir` in backup.sh. Relax it to permit reads only, keeping write/lock names forbidden. The Restic stub (`:66-140`) stores `--stdin` data in `$S/repo/snaps/<id>/data`, so the tar can be listed.
- `deploy/tests/test_compose_runtime.sh:331-366` -- existing temp-cleanup tests and the docker stub's `fail-compose` marker (`:125`).
- `deploy/README.md:193-246` -- manual restore runbook and "Known limits (deferred)" bullet.
- `.agent/skills/bmad-sprint-planning/scripts/sprint_plan.py:71-74` -- accepted stamp formats.

## Tasks & Acceptance

**Execution:**
- [x] `deploy/backup.sh` -- add `host_state_name=host-state.tar` and `host_state_id`. Add a `stage=host-state` step that builds the path list: runtime file, routes dir, and slots dir if present, plus `$state_dir/<SLOT_SNAPSHOT>` for each readable blue/green record and `.prev`. Validate each path, then pipe `tar --numeric-owner -cf - -C / <relative paths>` into `restic_in ... --stdin-filename host-state.tar --tag pending,run:$run_token`. Check both PIPESTATUS values. Include it in `run_ids`, the tag call, and the status file. Update the header comment and the `tar` requirement.
- [x] `deploy/tests/test_backup.sh` -- seed `$state/routes`, `$state/slots/{blue.env,green.env.prev}` and their snapshots. Assert that the complete run has a `host-state.tar` whose `tar -t` listing matches exactly, that status has `host_state_snapshot=`, that a missing referenced snapshot fails with exit 5 and leaves no run snapshots, and that a legacy run without host-state still restores. Relax the `:15` guard as above.
- [x] `deploy/runtime.sh` -- add `runtime_defer_signals` / `runtime_release_signals`. Call them around the mktemp-to-rm span in both windows; the release follows `rm` and comes before `exit "$status"`.
- [x] `deploy/tests/test_compose_runtime.sh` -- signal tests through a stub that runs `kill -TERM 0` inside a `set -m` job (own process group), for both windows: assert exit 143 and no leftover temp. Unit-test trap restore and ignored-signal behaviour by sourcing runtime.sh.
- [x] `deploy/README.md` -- in the restore runbook, add a step to extract `host-state.tar` (`restic dump HOST_ID /host-state.tar | tar -x --numeric-owner -C /`) before `prepare`, with a note that the journal is not archived (absent = idle). Update the Known limits bullet.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- set `generated` (and the header comment) to `2026-03-04 09:18`.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- add `resolved_by` to: host-state backup and runtime signal cleanup (this spec), the OAuth bump (commits `43eb2f1`, `e39cb3e`, `e800326`; now `oauthlib==4.0.0`, `social-auth-core==5.0.2`), the runtime/blue-green split (`spec-0-5…`, `spec-0-6…`), the backup/monitoring/rehearsal/cutover split (`spec-0-7…`, `spec-0-8…`; rehearsal and cutover tracked as stories 0.9/0.10), and the sprint-status timestamp (this spec).

**Acceptance Criteria:**
- Given all deploy suites, when they run on Linux, then each passes and `shellcheck deploy/*.sh deploy/tests/*.sh` is clean.
- Given the fixed sprint-status file, when `sprint_plan.py validate` runs, then it reports no `generated` format error.

## Design Notes

```bash
runtime_defer_signals() {   # caller-trap-safe; ignored signals stay ignored
  runtime_saved_traps="$(trap -p INT TERM HUP)"; runtime_pending_signal=''
  local sig
  for sig in INT TERM HUP; do
    [[ "$(trap -p "$sig")" == "trap -- '' SIG$sig" ]] && continue
    # shellcheck disable=SC2064 # expand $sig now
    trap "runtime_pending_signal=$sig" "$sig"
  done
}
runtime_release_signals() {
  trap - INT TERM HUP; eval "$runtime_saved_traps"
  [[ -z "$runtime_pending_signal" ]] || kill -s "$runtime_pending_signal" "$BASHPID"
}
```

Bash runs a trap only after the foreground subshell finishes, so cleanup always comes first. A subshell resets caught traps to the default, so the subshell dies on the signal while the parent survives. The archive is a point-in-time copy of atomically written files, taken without the deploy lock. A capture made mid-deploy may pair a new record with the old route. The runbook tells the operator to check `runtime.sh status` and use `release.sh recover` steps if they disagree.

## Verification

**Commands:**
- `for s in deploy/tests/test_*.sh; do bash "$s" || echo "FAIL $s"; done` -- expected: no FAIL lines (Linux, as in CI)
- `shellcheck deploy/*.sh deploy/tests/*.sh` -- expected: clean
- `python3 .agent/skills/bmad-sprint-planning/scripts/sprint_plan.py validate` (exact args per its `--help`) -- expected: no `generated` error

## Suggested Review Order

**Host-state archive**

- Entry point: explicit member list, no recursion, so stray files and directory races stay out.
  [`backup.sh:506`](../../deploy/backup.sh#L506)

- Streams tar straight into Restic; storage status checked before tar's so failures are named correctly.
  [`backup.sh:544`](../../deploy/backup.sh#L544)

- New stage sits after the manifest, so any failure discards the whole run as approved.
  [`backup.sh:600`](../../deploy/backup.sh#L600)

- Verify reads the archive back and requires the runtime file as a member.
  [`backup.sh:612`](../../deploy/backup.sh#L612)

- All three snapshots are promoted together; status records the host-state ID.
  [`backup.sh:618`](../../deploy/backup.sh#L618)

**Signal-safe temporary windows**

- Defer records the first signal; ignored signals stay ignored.
  [`runtime.sh:251`](../../deploy/runtime.sh#L251)

- Release restores caller traps before resetting the rest, then re-raises.
  [`runtime.sh:264`](../../deploy/runtime.sh#L264)

- Publish window: defer before mktemp, release after rm and before exit.
  [`runtime.sh:283`](../../deploy/runtime.sh#L283)

- Validation window: same bracket.
  [`runtime.sh:309`](../../deploy/runtime.sh#L309)

**Operator runbook**

- Rebuild prep creates root-only state; extraction lists members before writing to /.
  [`README.md:207`](../../deploy/README.md#L207)

- Extraction step for the matching run's host-state archive.
  [`README.md:224`](../../deploy/README.md#L224)

- Known limits: what is not archived, and deploy-overlap rerun advice.
  [`README.md:253`](../../deploy/README.md#L253)

**Tests and housekeeping**

- Exact member listing, failure stages, legacy runs, and read-only guard.
  [`test_backup.sh:530`](../../deploy/tests/test_backup.sh#L530)

- Real TERM to the process group in each window; caller-trap unit checks.
  [`test_compose_runtime.sh:374`](../../deploy/tests/test_compose_runtime.sh#L374)

- Timestamp now matches the validator's accepted format.
  [`sprint-status.yaml:36`](sprint-status.yaml#L36)
