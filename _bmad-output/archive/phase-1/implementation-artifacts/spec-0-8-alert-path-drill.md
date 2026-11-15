---
title: 'Alert-Path Drill for Monitoring (Story 0.8 completion)'
type: 'feature'
created: '2026-10-18'
status: 'done'
review_loop_iteration: 0
baseline_commit: '09388f10d415955323ff237ed30d1c16bb801903'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-0-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 0.8 requires that "the primary operator notification path passes a launch drill and has a quarterly drill schedule". Nothing proves today that an alert from the host actually reaches the operator's inbox. Nothing reminds the operator when a drill is overdue.

**Approach:** Add a two-phase drill to `deploy/monitor.sh`:
- `drill start` publishes a random code as a metric. A new `MawareethAlertDrill` rule emails it through the real `project=mawareeth` route.
- `drill confirm CODE --better-stack-received` records a pass only when the code from the email matches and the operator asserts that the manual Better Stack test alert arrived.
- `MawareethDrillOverdue` warns when the last pass is older than 92 days.

## Boundaries & Constraints

**Always:**
- Drill state lives in `<state dir>/monitor/drill`: root-owned, mode 0600, and read with `read_record`. The directory is mode 0700.
- Every drill outcome is appended to `<state dir>/monitor/drill-history` (0600).
- Every drill command takes the monitor lock and then republishes `mawareeth.prom` immediately.
- A missing or unusable drill record publishes 0 for both drill metrics, so `MawareethDrillOverdue` fires.
- The drill uses the existing route and receiver unchanged.

**Ask First:**
- Changing the 92-day interval or the recipient.
- Running anything against `p1`, Better Stack or a real host.

**Never:**
- Add a separate receiver or route for drills.
- Contact Better Stack's API.
- Take the deploy or backup locks, or touch slots, routes or the database.
- Put any secret in the repository.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Start | Idle or absent record | `state=active` and a new 6-digit code; `mawareeth_drill_active_code` = code; code printed | N/A |
| Start while active | `state=active` | Unchanged | Exit 2 |
| Confirm ok | Active, matching code, flag given | `last_result=pass`, `last_pass_epoch=now`, idle, code metric 0, history line | N/A |
| Confirm bad | Wrong code, flag missing, or idle | Unchanged, still active | Exit 2 |
| Abort | Active | Idle, `last_result=aborted`, previous pass kept, history line | Exit 2 when idle |
| Lock held | Another monitor run | Nothing changed | Exit 3 |
| Drill alert | Code metric > 0 | `MawareethAlertDrill` (info) fires immediately | N/A |
| Overdue | Last pass >92d, 0 (never or unusable), or >300s in the future | `MawareethDrillOverdue` (warning) | N/A |

</frozen-after-approval>

## Code Map

- `deploy/monitor.sh` -- the only behavioral change.
  - `monitor_lock_file`/`acquire_monitor_lock` (26, 43-50); `record_metrics` pattern (55-60).
  - `gauge`/`render_metrics` (62-77) and `publish_metrics` (83-89).
  - `cmd_collect` checks (91-99); `monitor_main` dispatch (217-225).
  - Usage header (1-16).
- `deploy/backup.sh` (sourced) -- `read_record` (758) fills `record[]` and requires `0:0:600`; `now_epoch`/`now_iso` (94-95); `clean_path` (109).
- `deploy/runtime.sh` -- `atomic_write TARGET MODE CONTENT` (335); `state_dir` (12).
- `deploy/monitoring/mawareeth-alerts.yml` -- add two rules in the existing style: `project: mawareeth` label, `runbook` annotation.
- `deploy/monitoring/alertmanager-route.yml` -- unchanged. The HostDown inhibit already suppresses drill alerts while the host is down.
- `deploy/tests/test_monitor.sh`:
  - `run`/`expect_rc`/`metric`/`write_record`/`set_meta` (108-132).
  - The five-gauge count and malformed-line regex (164-170).
  - The six-rule counts (331-333) and the anchor check (338-341).
  - The promtool healthy scenario (359-374) and per-row scenarios.
- `deploy/README.md`:
  - Line 3 and line 287 call the drill deferred; update both.
  - "five metrics" (line 251) and the collector gauge list (255-260).
  - The alert table (279-285) and the runbooks (307+).

## Tasks & Acceptance

**Execution:**
- [x] `deploy/monitor.sh`:
  - Add `drill start|confirm CODE --better-stack-received|abort`, root-only, under the monitor lock, with exit codes per the matrix.
  - The code is 100000–999999, read from `/dev/urandom`.
  - Records are written with `atomic_write` (0600).
  - Add both drill gauges to `render_metrics`. The drill record is read with the same fail-closed rules: `state=active` plus `code` matching `^[1-9][0-9]{5}$`, and `last_pass_epoch` matching `epoch_re`.
  - `status` shows the drill record's state.
  - Update the usage text and header.
- [x] `deploy/monitoring/mawareeth-alerts.yml`:
  - `MawareethAlertDrill`: `mawareeth_drill_active_code{job="mawareeth-node"} > 0`, severity `info`. The summary carries the code via `{{ $value | printf "%.0f" }}`.
  - `MawareethDrillOverdue`: `(time() - last_pass) > 92 * 86400 or (last_pass - time()) > 300`, severity `warning`.
- [x] `deploy/tests/test_monitor.sh`:
  - Every drill matrix row: start, refused re-start, wrong code, missing flag, confirm while idle, confirm, abort, lock held.
  - Record and history modes; unusable drill records publishing 0.
  - Seven gauges and eight rules (update the counts).
  - promtool scenarios: drill fires with the code as its value and is silent at 0; overdue fires past 92d, never-passed, and future-dated; the healthy scenario includes the drill series and nothing fires.
- [x] `deploy/README.md`:
  - Add an "Alert-path drill" subsection: launch and quarterly procedure, the Better Stack manual test alert ("Send test notification" on the monitor), and the evidence files.
  - Add two alert-table rows and two runbook anchors (`runbook-mawareethalertdrill`, `runbook-mawareethdrilloverdue`).
  - Fix lines 3, 251 and 287.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- add `resolved_by` to the 0.8 drill entry.

**Acceptance Criteria:**
- Given a host running `monitor.sh install`, when the operator runs `drill start`, then the next scrape makes `MawareethAlertDrill` email `[MAWAREETH info] MawareethAlertDrill` with the code through the existing route. After `drill confirm`, a resolved email follows.
- Given the suites, when they run offline, then all pass (promtool/amtool required under `CI`), and the existing suites still pass.

## Spec Change Log

## Design Notes

**Why a code instead of a timestamp.** `confirm` demands the code that appears only in the email. This turns "I think it arrived" into proof of receipt. The code is a gauge value, not a label, so the prom line format stays `name integer` and no extra series appear. Here it replaces the deferred entry's separate `mawareeth_drill_active` gauge.

**Drill record example:**
```
state=idle
code=
started_epoch=1760000000
last_result=pass
last_pass_epoch=1760000300
last_pass_at=2025-10-09T08:58:20Z
```

**Never passed fires Overdue.** A fresh host warns until the launch drill passes. That warning is the pre-cutover reminder the story asks for. An unconfirmed drill keeps re-emailing every 4h (`repeat_interval`) until it is confirmed or aborted, which is deliberate.

## Verification

**Commands:**
- `bash -n deploy/*.sh deploy/tests/*.sh` -- expected: all parse.
- `bash deploy/tests/test_monitor.sh && bash deploy/tests/test_backup.sh && bash deploy/tests/test_host_baseline.sh && bash deploy/tests/test_compose_runtime.sh && bash deploy/tests/test_release.sh` -- expected: pass offline.
- `shellcheck deploy/monitor.sh deploy/tests/test_monitor.sh` -- expected: clean if installed.

## Suggested Review Order

**Drill lifecycle**

- Entry point: start/confirm/abort dispatch, argument refusals before the lock.
  [`monitor.sh:246`](../../deploy/monitor.sh#L246)

- Fail-closed record loader; inconsistent or unknown records refuse with exit 2.
  [`monitor.sh:176`](../../deploy/monitor.sh#L176)

- All-or-nothing commit: history checked first, rollback on append failure.
  [`monitor.sh:205`](../../deploy/monitor.sh#L205)

- Directory and history ownership/mode checks before any write.
  [`monitor.sh:159`](../../deploy/monitor.sh#L159)

- Six-digit code from /dev/urandom.
  [`monitor.sh:238`](../../deploy/monitor.sh#L238)

**Metrics and alerts**

- Code published as a gauge value, so the prom format stays label-free.
  [`monitor.sh:102`](../../deploy/monitor.sh#L102)

- Drill alert fires at once; summary carries the code.
  [`mawareeth-alerts.yml:88`](../../deploy/monitoring/mawareeth-alerts.yml#L88)

- Overdue after 92 days, never passed, future-dated, or metric absent.
  [`mawareeth-alerts.yml:98`](../../deploy/monitoring/mawareeth-alerts.yml#L98)

**Operator documentation**

- Launch and quarterly procedure, Better Stack test, honesty caveat on the code.
  [`README.md:303`](../../deploy/README.md#L303)

- Runbooks for the two new alerts.
  [`README.md:368`](../../deploy/README.md#L368)

**Tests**

- Drill matrix rows, refusals, lock and rollback paths.
  [`test_monitor.sh:313`](../../deploy/tests/test_monitor.sh#L313)

- promtool scenarios for Overdue (92d, never, future, absent).
  [`test_monitor.sh:696`](../../deploy/tests/test_monitor.sh#L696)
