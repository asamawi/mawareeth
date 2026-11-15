---
title: 'Close Mawareeth monitoring blind spots: host health rules and a dead-man''s switch for the p1 alert path'
type: 'feature'
created: '2026-10-25'
status: 'done'
review_loop_iteration: 0
baseline_commit: '556b75a93767d1f0d0aa83e1c73f8e9cbc51f874'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Only disk bytes are alerted, so a host out of inodes, remounted read-only, short of memory, OOM-killing, with a failed systemd unit, or with a drifting clock fails silently. Every host alert also depends on p1's Prometheus and Alertmanager; if either stops, all Mawareeth alerts go quiet and nothing notices.

**Approach:** Enable node_exporter's systemd collector and add host-health rules for inodes, read-only filesystems, memory/swap, OOM kills, failed units, and clock sync. Add an always-firing `MawareethWatchdog` routed by webhook to a Better Stack heartbeat, which alerts on its own when the pings stop. Document the Better Stack heartbeat and SSL/domain-expiry settings, and state that SMTP-relay failure stays covered only by the quarterly drill.

## Boundaries & Constraints

**Always:** Every new rule carries `project: mawareeth`, a severity, and a `runbook` annotation whose README anchor exists. `MawareethHostDown` inhibits the new host rules but never the Watchdog. The heartbeat URL is a `${MAWAREETH_HEARTBEAT_URL}` placeholder substituted on p1 like `${SMTP_TO}`. The exporter still binds only the Tailscale IPv4. ShellCheck stays clean, and the `promtool` and `amtool` checks pass.

**Ask First:** Changing existing rule thresholds or the email route. Any Better Stack API call or automation.

**Never:** A real heartbeat URL, token, or SMTP secret in the repository. Routing the Watchdog to email. Alerting on `alertmanager_notifications_failed_total` (SMTP stays covered by the drill). Running Prometheus or Alertmanager on the Mawareeth host.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Healthy host | Every series nominal | Only `MawareethWatchdog` fires | — |
| Inodes | ext4/xfs/btrfs more than 85% of inodes used for 5m | `MawareethInodesLow` critical | Filesystems with `files == 0` (btrfs) never fire |
| Read-only | `node_filesystem_readonly == 1` on ext4/xfs/btrfs for 2m | `MawareethFilesystemReadOnly` critical | — |
| Memory | MemAvailable below 10% of MemTotal, or swap more than 50% used with SwapTotal > 0, for 10m | `MawareethMemoryPressure` warning | Swapless host: the swap branch never fires |
| OOM | `increase(node_vmstat_oom_kill[10m]) > 0` | `MawareethOOMKill` warning, firing at once | Resolves once 10m pass with no kill |
| Unit failed | `node_systemd_unit_state{state="failed"} == 1` for 5m | `MawareethSystemdUnitFailed` warning, labelled with the unit `name` | — |
| Collector off | No `node_systemd_unit_state` series (old wrapper) for 5m | Same alert without `name`; runbook says re-run `install` | — |
| Clock | `node_timex_sync_status == 0`, or `abs(node_timex_offset_seconds) > 0.5`, for 10m | `MawareethClockUnsynced` warning | — |
| Host down | `MawareethHostDown` firing | New host rules inhibited; Watchdog still sent | — |
| Watchdog routing | `alertname=MawareethWatchdog` | Goes only to `mawareeth-heartbeat`, never to `mawareeth-email` | — |

</frozen-after-approval>

## Code Map

- `deploy/monitor.sh` `exporter_wrapper_content()` -- the exporter command line; add `--collector.systemd` (off by default; its default unit-exclude already drops automount/device/mount/scope/slice). `install` rewrites the wrapper, so re-running it upgrades a host.
- `deploy/monitoring/mawareeth-alerts.yml` -- 9 rules today; use the same style (`job="mawareeth-node"` selectors, `fstype=~"ext4|xfs|btrfs"`, quoted summaries using `{{ $labels.alias }}`).
- `deploy/monitoring/alertmanager-route.yml` -- one route, one receiver, two inhibit rules; the header tells the operator how to merge them.
- `deploy/tests/test_monitor.sh` -- static checks at L169-214 (exact rule, receiver, and route counts that need updating), wrapper flag checks at L139-167, promtool matrix at L222-368 (the healthy block expects no alert for every rule name), amtool checks at L394-415 (they substitute `${SMTP_TO}`, so the new placeholder needs the same treatment).
- `deploy/README.md` -- "Host setup" (exporter flags), "Wiring `p1`" (steps 3-4), the alert table, "Better Stack uptime probe", and "Runbooks" (one `<a id="runbook-...">` per alert).
- `.github/workflows/django.yml` L92-116 -- pins promtool/amtool for CI; read only.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- the two 0.8 entries for extended rules and the dead-man's switch get `resolved_by:` this spec.

## Tasks & Acceptance

**Execution:**
- [x] `deploy/monitor.sh` -- add `--collector.systemd` to the exporter exec line and mention it in the header -- the failed-unit rule needs it.
- [x] `deploy/monitoring/mawareeth-alerts.yml` -- add the six host rules from the matrix plus `MawareethWatchdog` (`expr: vector(1)`, `severity: heartbeat`, `project: mawareeth`); update the header comment -- closes the blind spots.
- [x] `deploy/monitoring/alertmanager-route.yml` -- add a route matching `alertname="MawareethWatchdog"` as the FIRST child (before the project route; `group_wait: 0s`, `group_interval: 1m`, `repeat_interval: 1m`), a `mawareeth-heartbeat` receiver (`webhook_configs`, `url: '${MAWAREETH_HEARTBEAT_URL}'`, `send_resolved: false`), and `alertname!="MawareethWatchdog"` on the HostDown inhibit's target matchers; update the merge comment -- dead-man's switch.
- [x] `deploy/tests/test_monitor.sh` -- update the counts and static needles; check that the wrapper passes `--collector.systemd`; add promtool rows for every matrix scenario (fire/no-fire around each `for:` boundary, swapless host, btrfs `files == 0`, absent systemd series, Watchdog firing in the healthy block); in amtool, substitute the heartbeat URL and verify the Watchdog routes only to `mawareeth-heartbeat`, a HostDown→Watchdog inhibit leaves it uninhibited where checkable, and fail if a real Better Stack heartbeat URL (`betterstack.com`/`heartbeat/`) appears in the repository.
- [x] `deploy/README.md` -- the systemd collector; a p1 step for the heartbeat receiver (with `grep '\${'` still required to print nothing); Better Stack heartbeat setup (expected period 5 minutes, grace 5 minutes, email to `SMTP_TO`, monitor name prefixed `MAWAREETH`); enable SSL and domain expiry notifications on the uptime monitor; one table row and runbook per new alert; a note that the Watchdog covers p1 Prometheus, Alertmanager, and reachability but not SMTP, which the drill covers.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- set `resolved_by:` on the two entries.

**Acceptance Criteria:**
- Given a host running the old wrapper, when `monitor.sh install` is re-run, then the drop-in-started exporter is invoked with `--collector.systemd` and the Tailscale-only listen address.
- Given p1 has merged the snippets, when `amtool config routes test` is run for `alertname=MawareethWatchdog project=mawareeth`, then it resolves to `mawareeth-heartbeat` only, and `project=mawareeth` alone still resolves to `mawareeth-email`.
- Given the repository, when `deploy/tests/test_monitor.sh` runs with `CI` set, then it passes, and every rule has a README runbook anchor.

## Design Notes

The Watchdog keeps `project: mawareeth` so it is grouped and filtered with the other Mawareeth alerts, but it gets its own earlier route and is excluded from the HostDown inhibit. A dead host must not silence the heartbeat, because the heartbeat tests p1, not the host. Better Stack heartbeats accept the POST that Alertmanager's webhook sends. `repeat_interval: 1m` with `group_interval: 1m` pings about every 1–2 minutes, well inside a 5-minute period plus 5-minute grace.

## Verification

**Commands:**
- `bash deploy/tests/test_monitor.sh` -- expected: `deploy/monitor.sh tests passed`, with promtool and amtool checks passing where installed
- `shellcheck deploy/*.sh deploy/tests/*.sh` -- expected: no findings

## Suggested Review Order

**Dead-man's switch**

- Entry point: an always-firing alert whose silence, not its presence, is the signal.
  [`mawareeth-alerts.yml:204`](../../deploy/monitoring/mawareeth-alerts.yml#L204)

- Its own first route to a webhook, so it is never emailed.
  [`alertmanager-route.yml:16`](../../deploy/monitoring/alertmanager-route.yml#L16)

- The heartbeat URL stays a placeholder, substituted on p1 like SMTP_TO.
  [`alertmanager-route.yml:35`](../../deploy/monitoring/alertmanager-route.yml#L35)

- HostDown no longer inhibits the Watchdog, because the Watchdog tests p1, not the host.
  [`alertmanager-route.yml:54`](../../deploy/monitoring/alertmanager-route.yml#L54)

**Host-health rules**

- Failed units, plus an absent-series branch that catches the old wrapper.
  [`mawareeth-alerts.yml:178`](../../deploy/monitoring/mawareeth-alerts.yml#L178)

- Inodes, guarded against btrfs reporting zero inodes.
  [`mawareeth-alerts.yml:130`](../../deploy/monitoring/mawareeth-alerts.yml#L130)

- Memory and swap (the swap branch applies only when SwapTotal > 0), OOM kills, and clock sync.
  [`mawareeth-alerts.yml:154`](../../deploy/monitoring/mawareeth-alerts.yml#L154)

- The exporter gains the systemd collector and still binds only the Tailscale IPv4.
  [`monitor.sh:335`](../../deploy/monitor.sh#L335)

**Operator docs**

- p1 wiring for the heartbeat receiver and the extra validation step.
  [`README.md:315`](../../deploy/README.md#L315)

- Heartbeat setup, the one-time paging check, and the silence/downtime caveats.
  [`README.md:357`](../../deploy/README.md#L357)

**Tests**

- Secret scan: no Better Stack or Better Uptime heartbeat URL may be committed.
  [`test_monitor.sh:30`](../../deploy/tests/test_monitor.sh#L30)

- Upgrade path: the old wrapper is rewritten before the exporter restarts.
  [`test_monitor.sh:569`](../../deploy/tests/test_monitor.sh#L569)

- The HostDown inhibit is extracted and must exclude the Watchdog.
  [`test_monitor.sh:653`](../../deploy/tests/test_monitor.sh#L653)
