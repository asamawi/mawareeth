---
title: 'Deploy correctness fixes before the 0.9 rehearsal'
type: 'bugfix'
created: '2026-10-20'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'e80032604ae7801c9b7dc267e2ef5893ec7d0228'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Three deferred deploy defects can bite during the 0.9 rehearsal. (1) `backup.sh` tags snapshots with `run:<UTC second>`, so a failed run's cleanup can forget a complete earlier run from the same second. (2) `runtime.sh` removes its temporary secret-bearing Compose snapshot through a `RETURN` trap, which does not fire when `die` or `set -e` exits. (3) `mawareeth-docker-firewall.service` is not tied to Docker, so the DOCKER-USER restrictions are lost after a Docker restart until the host reboots.

**Approach:** Tag every snapshot with the existing per-process `run_token`. Run the secret-bearing temporary section in a subshell and have the parent always remove the temporary files. Bind the firewall unit to `docker.service` so it reapplies whenever Docker starts or restarts.

## Boundaries & Constraints

**Always:** Snapshots from older runs, tagged `run:YYYYMMDDTHHMMSSZ`, stay restorable; restore selection keeps ordering by snapshot time. Exit codes and messages of the changed functions stay the same. `bootstrap-host.sh` stays idempotent, and rerunning it on an existing host installs the corrected unit. Tests and code pass ShellCheck.

**Ask First:** Any change to restore-selection logic in `snapshot_py`, or to the `last-backup` status fields beyond the `run=` value.

**Never:** Global `EXIT` traps in `runtime.sh`, because `release.sh` sources it. Unrelated deferred items (host-state backup, config rotation, etc.).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Same-second failed backup | Run A completes; run B starts in the same UTC second and fails after uploading | Run A's complete dump and manifest remain; only B's snapshots are forgotten | B exits 5 as today |
| Legacy tags | Repository holds only old `run:<stamp>` complete runs | `restore` picks the latest by time as before | — |
| Compose model invalid | `compose config` fails | Exit 2 with `the resolved Compose model is invalid`; no `app.snapshot.env` is left under `$TMPDIR` | — |
| Temp setup fails | `chmod`/render fails inside the window | Same die message; temporary dir removed | — |
| Atomic snapshot fails | `chown`/hash check fails in `write_snapshot` | Same die message; no `.snapshot.*` left in the state dir | — |
| Docker restarts | `systemctl restart docker`, or stop then start | Firewall unit reruns; DOCKER-USER has accept-established, 80/443, drop | — |

</frozen-after-approval>

## Code Map

- `deploy/backup.sh:215-216` -- `open_run_log` sets `run_stamp` (second resolution) and `run_token="$run_stamp-$$"`, which already makes container labels and log names unique.
- `deploy/backup.sh:365` -- `write_backup_status` writes `run=$run_stamp`; the tests read this field to rebuild the snapshot tag.
- `deploy/backup.sh:401,482,533,537,548` -- every `run:$run_stamp` tag, used by forget, both uploads and both `run_ids` checks.
- `deploy/backup.sh:316-318,343-352` -- `run_of` accepts any tag string, and `latest` sorts by `epoch(s["time"])`. Read-only: no change needed.
- `deploy/runtime.sh:266-281` -- `validate_compose_model`, whose `RETURN` trap is the leak.
- `deploy/runtime.sh:240-263` -- `write_snapshot`, which has the same `RETURN` trap pattern for `$state_dir/.snapshot.XXXXXX`.
- `deploy/runtime.sh:2,29` -- `set -Eeuo pipefail`; `die` exits 2. `deploy/release.sh:31` sources runtime.sh, and `:418` calls `validate_compose_model`.
- `deploy/runtime.sh:549-550` -- the existing `EXIT` trap in `runtime_inspect`. Leave it as is.
- `deploy/bootstrap-host.sh:96-109` -- the firewall unit heredoc plus `daemon-reload` / `enable --now`.
- `deploy/tests/test_backup.sh:330-337` -- `run()` waits for the next second before each backup to dodge the tag collision. Remove that workaround.
- `deploy/tests/test_compose_runtime.sh:300-308` -- the invalid-Compose test, triggered by `$state/fail-compose`. The `chown` stub is at `:146`.
- `deploy/tests/test_host_baseline.sh:5` -- references `bootstrap-host.sh`.
- `deploy/README.md:423` -- tells the operator to re-check the backstop after `systemctl restart docker`.

## Tasks & Acceptance

**Execution:**
- [x] `deploy/backup.sh` -- replace every `run:$run_stamp` with `run:$run_token` and write `run=$run_token` in the status file. Keep `run_stamp` for human-readable `say` lines. -- This gives each run a unique tag.
- [x] `deploy/tests/test_backup.sh` -- remove the same-second wait in `run()` and update the tag regex at `:432` to `run:[0-9]{8}T[0-9]{6}Z-[0-9]+`. Add a test where a complete backup is followed in the same second (pin the `date` stub) by a failing backup, and assert that the first run still has 2 complete snapshots. Add a test that a legacy-tagged complete run still restores. -- Regression coverage.
- [x] `deploy/runtime.sh` -- in `validate_compose_model` and in `write_snapshot`'s temporary branch, run the steps that use the temporary path inside `( set -e; ... )` with `set +e` around it, capture the status, always `rm` the temporary path in the parent, then `exit` with the captured status if it is non-zero. Remove both `RETURN` traps. Variables set only for `compose config` stay inside the subshell. -- Cleanup that `die` cannot skip.
- [x] `deploy/tests/test_compose_runtime.sh` -- run the invalid-Compose case with `TMPDIR` set to an empty test dir and assert that the dir is empty afterwards. Add a `write_snapshot` failure (via the `chown` stub) and assert that no `.snapshot.*` remains in the state dir. -- Proves the leak is closed.
- [x] `deploy/bootstrap-host.sh` -- add `PartOf=docker.service` under `[Unit]` and `WantedBy=docker.service` under `[Install]` (keeping `multi-user.target`). Run `systemctl reenable` so existing hosts gain the new wants link. -- Reapply after Docker restarts.
- [x] `deploy/tests/test_host_baseline.sh` -- assert that the generated unit contains `PartOf=docker.service` and `WantedBy=` including `docker.service`.
- [x] `deploy/README.md` -- say that the unit reapplies automatically on Docker (re)start, and keep the verification command.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- add `resolved_by:` to the three source entries.

**Acceptance Criteria:**
- Given all deploy suites, when they run, then each passes and ShellCheck reports nothing.
- Given an existing host, when `bootstrap-host.sh` is rerun, then `systemctl show -p WantedBy,PartOf` reflects `docker.service`.

## Design Notes

The subshell is required because `die` calls `exit`, which skips `RETURN` traps. Wrapping in `( ... ) || status=$?` would silently disable `set -e` inside the subshell, so use:

```bash
set +e
( set -e; ...steps using "$temporary_dir"... )
status=$?
set -e
rm -rf -- "$temporary_dir"
(( status == 0 )) || exit "$status"
```

## Verification

**Commands:**
- `for s in deploy/tests/test_*.sh; do bash "$s" || echo "FAIL $s"; done` -- expected: no FAIL lines (run in WSL/Linux, as in CI).
- `shellcheck deploy/*.sh deploy/tests/*.sh` -- expected: clean.

## Suggested Review Order

**Unique backup run tags**

- Entry point: the per-process token already existed; tags now use it instead of the bare second.
  [`backup.sh:216`](../../deploy/backup.sh#L216)

- Failed-run cleanup forgets only this run's token-tagged snapshots.
  [`backup.sh:401`](../../deploy/backup.sh#L401)

- Status records the token so evidence and tags stay matched; selection still orders by snapshot time.
  [`backup.sh:365`](../../deploy/backup.sh#L365)

**Secret-bearing temp cleanup**

- Subshell isolates `die`; parent always removes the validation dir, then propagates the status.
  [`runtime.sh:278`](../../deploy/runtime.sh#L278)

- Same pattern for the atomic `.snapshot.XXXXXX` publish file.
  [`runtime.sh:253`](../../deploy/runtime.sh#L253)

**Firewall follows Docker**

- `BindsTo`/`PartOf` plus `WantedBy=docker.service`: stops on any Docker deactivation, reapplies on start.
  [`bootstrap-host.sh:100`](../../deploy/bootstrap-host.sh#L100)

- `reenable` refreshes wants links on existing hosts; `restart` reapplies idempotent rules.
  [`bootstrap-host.sh:112`](../../deploy/bootstrap-host.sh#L112)

- Operator check updated to the new dependency model.
  [`README.md:423`](../../deploy/README.md#L423)

**Tests**

- Pinned stamp proves a same-second failure spares the earlier run and cleans its own.
  [`test_backup.sh:443`](../../deploy/tests/test_backup.sh#L443)

- Legacy `run:<stamp>` pairs remain restorable.
  [`test_backup.sh:554`](../../deploy/tests/test_backup.sh#L554)

- Invalid Compose, publish, and chmod failures leave no temporary snapshot.
  [`test_compose_runtime.sh:305`](../../deploy/tests/test_compose_runtime.sh#L305)

- Static unit assertions for the firewall dependencies.
  [`test_host_baseline.sh:61`](../../deploy/tests/test_host_baseline.sh#L61)
