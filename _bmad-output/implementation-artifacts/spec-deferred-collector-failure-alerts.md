---
title: 'Alert when a host-health collector fails or its series disappear'
type: 'feature'
created: '2026-11-20'
status: 'done'
baseline_revision: '6afbdee791331bb245e9c61e936cea2cb6b96fdd'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred:
  - summary: >-
      No test proves that Alertmanager suppresses the MawareethHostMetricsMissing email while MawareethHostDown fires for the same project.
    evidence: |-
      During a scrape outage the absent() branches fire after 5m; only the project-wide HostDown inhibit rule (deploy/monitoring/alertmanager-route.yml:47-56) keeps that from emailing. deploy/tests/test_monitor.sh checks receiver selection with amtool and the inhibit matcher text statically, but no harness evaluates inhibition at runtime (pre-existing gap for every host alert). Settle with an Alertmanager notification harness (e.g. a throwaway alertmanager posting both alerts and reading /api/v2/alerts?silenced=false&inhibited=false), or by the quarterly alert-path drill.
    location: >-
      deploy/monitoring/alertmanager-route.yml:47
    severity: low
---

<intent-contract>

## Intent

**Problem:** The host-health rules in `deploy/monitoring/mawareeth-alerts.yml` (disk, inodes, read-only, memory/swap, OOM, clock) can never fire if the node_exporter `filesystem`, `meminfo`, `vmstat` or `timex` collector fails or stops publishing a series while the scrape itself succeeds; `MawareethHostDown` stays quiet and nothing reports it. Only `MawareethSystemdUnitFailed` has an absence guard (deferred item from `spec-deferred-monitoring-gaps.md`).

**Approach:** Add one new warning alert, `MawareethHostMetricsMissing`, with `for: 5m`, that fires when (a) `node_scrape_collector_success` is `0` for one of those four collectors, (b) `node_filesystem_device_error` is `1` for a monitored filesystem, or (c) any series a host-health rule reads is absent, each checked by its own `absent()`. Document it in the README alert table and a new runbook, and cover it in `deploy/tests/test_monitor.sh`.

## Boundaries & Constraints

**Always:**
- Expression branches, all with `job="mawareeth-node"`:
  - `node_scrape_collector_success{collector=~"filesystem|meminfo|vmstat|timex"} == 0`
  - `node_filesystem_device_error{fstype=~"ext4|xfs|btrfs"} == 1` (same fstype filter as the disk rules)
  - one `absent(...)` per series: `node_filesystem_avail_bytes`, `node_filesystem_size_bytes`, `node_filesystem_files_free`, `node_filesystem_files`, `node_filesystem_readonly` (each with the fstype filter), `node_memory_MemAvailable_bytes`, `node_memory_MemTotal_bytes`, `node_memory_SwapFree_bytes`, `node_memory_SwapTotal_bytes`, `node_vmstat_oom_kill`, `node_timex_sync_status`, `node_timex_offset_seconds`.
- Labels `severity: warning`, `project: mawareeth`; `for: 5m` (longer than HostDown's `2m`, so during a scrape outage HostDown fires first and its existing project-wide inhibit suppresses this alert — the repo's established absence-alert pattern).
- Annotations follow the file's style (single-quoted `summary`, `description`, `runbook: 'deploy/README.md#runbook-mawareethhostmetricsmissing'`). The summary is conditional like the systemd rule's: names `$labels.collector` when present, else `$labels.mountpoint` (device error), else says a host-health series is missing and to check the exporter.
- Existing rules, routing, inhibitions and the systemd guard stay unchanged; the generic `project="mawareeth"` route emails the new alert.

**Never:** No `systemd` in the collector regex (its absence is already covered by `MawareethSystemdUnitFailed`; avoids double alerts for the old-wrapper case). No change to `monitor.sh`, the exporter flags, `alertmanager-route.yml`, `prometheus-scrape.yml` or CI workflow. No per-mountpoint expectations (absence is checked per series across monitored filesystems, not per mount). No edits to existing rule expressions.

## I/O & Edge-Case Matrix

| Scenario | Input series (promtool fixture) | Expected |
|----------|--------------|----------|
| Healthy | all host series present, `collector_success`=1 for the four collectors, `device_error`=0 | `MawareethHostMetricsMissing` does not fire; no other alert changes |
| Collector failure | `node_scrape_collector_success{collector="vmstat"}`=0 for 6m | fires at 5m with `collector="vmstat"`, instance/alias labels |
| Device error | `node_filesystem_device_error{mountpoint="/",fstype="ext4"}`=1 for 6m | fires at 5m with that `mountpoint` |
| One series gone | all healthy except `node_timex_sync_status` absent | fires at 5m with only `job` + static labels |
| Short blip | collector failure for 3m then recovers | does not fire |
| Swapless host | `SwapTotal`=0, `SwapFree`=0 present | does not fire |

</intent-contract>

## Code Map

- `deploy/monitoring/mawareeth-alerts.yml` -- 21 rule blocks / 18 names; host-health rules L71–95 (disk), L192–264 (inodes, read-only, memory, OOM, systemd, clock); systemd guard pattern with conditional summary at L240–251. Insert the new rule after `MawareethClockUnsynced` (L253–264), before `MawareethWatchdog`.
- `deploy/tests/test_monitor.sh` -- static checks in the `p1 snippets` section: `host_rules`/`all_rules` name lists L1063–1081 (feed required-name, runbook-anchor, healthy no-fire and `amtool` email checks L1643–1653); exact rule-block count, label counts and `for` counts L1115–1140 (currently 21 blocks, 11 `for`, seven at `5m`). Promtool unit tests generated inline L1142–1171 and L1425–1535 (`alerts.test.yml`, 1-minute interval, `alert_labels()` helper; healthy fixture L1172–1206; systemd-absence case L1498–1504). `missing_tool()` skips locally without promtool, fails under `CI`.
- `deploy/README.md` -- alert table (`Alert | Fires when | Severity`) host-health rows L697–702; runbooks section from L775, host-health runbooks from L852 (`<a id="runbook-…"></a>`, bold name + explanation, numbered steps; systemd runbook at L876, clock at L882).
- `deploy/monitoring/alertmanager-route.yml` -- read-only: project route and HostDown project inhibit (L47–62) already cover the new alert.

## Tasks & Acceptance

**Execution:**
- `deploy/monitoring/mawareeth-alerts.yml` -- add the `MawareethHostMetricsMissing` rule per Boundaries -- closes the silent-collector gap.
- `deploy/tests/test_monitor.sh` -- add the name to `host_rules`; bump block/label/`for` counts by one rule (one more `5m`); add expression-fragment `need` checks for the collector regex, device-error branch and an `absent(node_vmstat_oom_kill` fragment; seed the healthy fixture with `node_scrape_collector_success` (=1 for the four collectors) and `node_filesystem_device_error` (=0) so nothing fires; add promtool cases for every I/O matrix row -- proves the rule.
- `deploy/README.md` -- add an alert-table row and a `runbook-mawareethhostmetricsmissing` runbook (what it means; check `curl -s <tailscale-ip>:9100/metrics | grep node_scrape_collector_success`, exporter journal `journalctl -u prometheus-node-exporter`, restart/re-run `monitor.sh install`, device-error → check `dmesg`/the disk) -- operator path.

**Acceptance Criteria:**
- Given the checked-in rules, when `promtool check rules deploy/monitoring/mawareeth-alerts.yml` runs, then it passes.
- Given CI's `deploy-shell` job (promtool and amtool present), when `bash deploy/tests/test_monitor.sh` runs, then every I/O matrix case passes and the new alert is routed to email by `amtool`.
- Given the README, when an operator opens `deploy/README.md#runbook-mawareethhostmetricsmissing`, then the anchor exists and gives numbered steps.

## Spec Change Log

## Review Triage Log

### 2026-11-20 — Review pass
- verdicts: 17 findings — high 0, medium 0, low 14, false 3, maybe-false 0
- findings:
  - `[low]` `[reject]` blind-hunter: filesystem absence is checked job-wide, not per mount — node_exporter's filesystem collector emits all five families per mount from one statfs call, so one family vanishing for one mount while present for another is not an everyday failure, and the fix needs an expected-mount set (new guard complexity); a mount vanishing entirely is a different gap.
  - `[low]` `[reject]` blind-hunter: all absent() branches share one alert identity, so a second missing series can inherit the first's pending time — harm is firing slightly early on a rare overlap; fix adds per-branch label_replace complexity.
  - `[low]` `[patch]` blind-hunter: description says the host-health alerts "cannot fire" — only the affected alert loses coverage. Description reworded.
  - `[low]` `[patch]` blind-hunter: README step 4 grep ignores the fstype filter, so tmpfs samples mask a missing monitored series. Command restricted to ext4|xfs|btrfs.
  - `[false]` `[reject]` blind-hunter: new cases leave `up` undefined — the rule never reads `up`, so adding `up=1` would change no evaluation.
  - `[low]` `[patch]` blind-hunter: omission case covers only node_timex_sync_status. Looped over all 12 series.
  - `[low]` `[reject]` edge-case-hunter: per-mount loss masked by another mount — same as the per-mount row above.
  - `[false]` `[reject]` edge-case-hunter: another scrape target masks a missing metric — deploy/monitoring/prometheus-scrape.yml defines one target for job mawareeth-node; HostDown uses the same job-wide absent().
  - `[low]` `[reject]` edge-case-hunter: shared pending time across absent branches — same as the shared-identity row above.
  - `[low]` `[patch]` edge-case-hunter: README diagnostic ignores fstype — same fix as the README row above.
  - `[low]` `[patch]` edge-case-hunter: description claims the scrape succeeds, but absent branches also fire during an outage — description now says HostDown fires and suppresses it then.
  - `[low]` `[patch]` verification-gap: missing MemTotal (or any other) absence branch is unverified — covered by the per-series omission loop.
  - `[low]` `[patch]` verification-gap: only vmstat exercises the collector matcher — failure case looped over filesystem, meminfo, vmstat, timex.
  - `[low]` `[patch]` verification-gap: rendered summaries untested (annotations stripped) — collector, device-error and missing-series summaries asserted in the unstripped annotation test.
  - `[low]` `[defer]` verification-gap: HostDown inhibition of the new alert is not exercised at runtime — pre-existing harness gap for every host alert; added to `deferred`.
  - `[low]` `[patch]` verification-gap (other): description overstates loss of coverage — same fix as the description row above.
  - `[false]` `[reject]` intent-alignment: the invocation "deffered work" has several readings — this run follows the established convention of the prior `spec-deferred-*` runs (take one open item from deferred-work.md); the chosen item is identified in the spec's Problem statement.
  - (cross-story-contract: no contract shape changed — no findings.)

## Verification

**Commands:**
- `bash deploy/tests/test_monitor.sh` (Git Bash; promtool/amtool absent locally, so rule-tool sections report a skip) -- expected: exit 0, static checks pass.
- `docker run --rm -v "C:/mawareeth/deploy/monitoring:/r" --entrypoint promtool prom/prometheus check rules /r/mawareeth-alerts.yml` if Docker is running -- expected: SUCCESS. The parent may also run the generated unit tests through the same image by exporting the test's temp YAMLs.

## Auto Run Result

**Summary:** Added the `MawareethHostMetricsMissing` warning alert (`for: 5m`). It fires when the node_exporter `filesystem`, `meminfo`, `vmstat` or `timex` collector reports failure, when a monitored filesystem (ext4/xfs/btrfs) reports a device error, or when any of the 12 series the host-health rules read is absent. The disk, inode, read-only, memory, OOM and clock alerts can no longer go quiet unnoticed. `systemd` stays covered by its existing guard.

**Files changed:**
- `deploy/monitoring/mawareeth-alerts.yml` -- the new rule, with a conditional summary (collector / mountpoint / generic) and a runbook link.
- `deploy/README.md` -- an alert-table row and the `runbook-mawareethhostmetricsmissing` runbook (four numbered steps).
- `deploy/tests/test_monitor.sh` -- name inventory and counts (22 rules, 12 `for`, 8 at `5m`), expression fragments, healthy-fixture seeding, a `host_series` helper, and promtool cases. The cases cover a failure for each of the four collectors, a device error, the absence of each of the 12 series, a 3-minute blip, a swapless host, and rendered summaries for all three variants.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- removed the resolved item and added the inhibition-harness follow-up.

**Review findings:** 17 findings (low 14, false 3). Patched: 5 entries, all low (description wording, README fstype filter, per-series omission loop, per-collector loop, rendered-summary assertions). Deferred: 1 (no runtime test of HostDown inhibition; a pre-existing harness gap). Rejected:
- per-mount absence and shared pending identity (each found by two layers): low, rare, and the fix adds complexity
- `up` undefined: false, the rule never reads `up`
- multi-target masking: false, there is a single target
- intent ambiguity: false, this run follows the established convention for deferred-work runs

**Follow-up review recommended:** false (no high, fewer than two medium patched; patched counts: high 0, medium 0, low 5).

**Fallbacks:** none. Codex did the investigation and the combined review; a Sonnet subagent did the implementation and the patches.

**Verification:** `bash deploy/tests/test_monitor.sh` in Git Bash, with the pinned CI versions on PATH (promtool 3.15.0 and amtool 0.34.1, Windows builds checksum-verified against the release `sha256sums.txt`). Exit 0 before and after the patches, printing "promtool rule checks passed", "amtool route checks passed" and "deploy/monitor.sh tests passed". `promtool check rules` reports only the duplicate-rule lint for `MawareethCollectorStale`/`MawareethDrillOverdue`, which predates this change.

**Residual risks:** The rule has not been loaded on live `p1`. After the next `p1` rules sync, confirm that `node_scrape_collector_success` is ingested there and that the alert is inactive on the healthy host. Inhibition during an outage is tested only statically (deferred).
