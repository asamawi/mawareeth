---
title: 'Add Monitoring and Operational Controls'
type: 'feature'
created: '2026-10-14'
status: 'done'
review_loop_iteration: 0
baseline_commit: '8d42f97cfc1620db38aa3970376430c5344355de'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-0-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nothing tells the operator when the public site, the host, the disk or the nightly backup fails. Today, 0-7's backup records are read only by hand.

**Approach:** Reuse SCDF's monitoring.
- The host joins Tailscale and runs Ubuntu's `prometheus-node-exporter`.
- `deploy/monitor.sh` turns 0-7's backup and restore records into textfile metrics.
- SCDF's Prometheus/Alertmanager on `p1` scrapes the host over Tailscale. It emails SCDF's existing `SMTP_TO` under a `project=mawareeth` route.
- Better Stack probes `https://DOMAIN/health/ready/`.
- The alert drill is deferred (see deferred-work.md).

## Boundaries & Constraints

**Always:**
- Bind node_exporter only to the Tailscale IPv4, port 9100.
- UFW allows 9100/tcp only `in on tailscale0` from `100.64.0.0/10`.
- Install Tailscale (official noble repository) and node_exporter (Ubuntu archive) from signed apt repositories.
- Write `mawareeth.prom` (0644) atomically into `/var/lib/prometheus/node-exporter`.
- Treat a missing, mis-owned or malformed record as unhealthy (0).
- Bound journald at `SystemMaxUse=500M`, `SystemKeepFree=1G`, `MaxRetentionSec=30day`.

**Ask First:**
- Changing thresholds, intervals or the recipient.
- Changing SSH access.
- Running anything against `p1`, Tailscale, Better Stack or a real host.
- Adding Compose services.

**Never:**
- Expose 9100 publicly or change the Hetzner cloud firewall.
- Put SMTP or Tailscale secrets in the repository, CI, logs or command lines.
- Run Prometheus or Alertmanager on this host.
- Take the deploy or backup locks, or touch slots, routes or the database.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Healthy | Backup `ok` ≤26h; restore `pass` ≤35d | Metrics healthy; no alert fires | N/A |
| Backup bad | `failed:*` or >26h old | `MawareethBackupUnhealthy` (critical) | N/A |
| Restore bad | `fail:*` or >35d old | `MawareethRestoreUnhealthy` (critical) | N/A |
| Record unusable | File absent, wrong mode/owner, or bad line | Metric is 0, so the alert above fires | Collector exits 0 |
| Disk | Used >75% for 5m / >85% for 5m | `MawareethDiskWarning` / `MawareethDiskCritical` | N/A |
| Host down | `up==0` for 2m | `MawareethHostDown` (critical); inhibits the other Mawareeth alerts | N/A |
| Collector stopped | Last collect >20m ago | `MawareethCollectorStale` (warning) | N/A |
| Tailscale IP absent | No IPv4 at exporter start | Start fails; restarts every 15s | Never binds `0.0.0.0` |

</frozen-after-approval>

## Code Map

- `deploy/runtime.sh` -- source it as `backup.sh:20-22` does.
  - Strict mode (2-4), `state_dir` (12), `die`/`info` (29-30).
  - `atomic_write TARGET MODE CONTENT` (335-344).
- `deploy/backup.sh` -- reuse, don't copy:
  - `status_file`/`evidence_file` (33-34) and thresholds (43-45).
  - `read_record` (758-767): requires `0:0:600`, fills `record[]`.
  - Epoch validation in `gate_check` (771-803).
  - Units: `unit_service`/`unit_timer` (822-837) and the install flow (839-860).
  - `main "$@"` (909) runs unconditionally, so a guard is needed before sourcing.
  - Keys: `last-backup` has `result`, `finished_epoch`; `restore-verified` has `result`, `verified_epoch`.
- `deploy/bootstrap-host.sh` -- patterns: signed apt repo (51-59), UFW (136-146), heredoc units (94-107).
- `deploy/compose.yaml:22-26` -- containers already rotate at 10m×5. Document it; don't change it.
- `mawareeth/ops_views.py:35-49` -- `/health/ready/` returns 200 only when DB and schema are OK, else 503.
- `deploy/tests/test_backup.sh` -- harness:
  - `fail`/`need` (9-10), temp dir (24-28), EUID patch (31-38).
  - Stubs (268-322), `run`/`expect_rc` (329-343).
- `deploy/tests/test_host_baseline.sh:21-33` -- forbidden-port pattern.
- `deploy/README.md` -- lines 3, 147 and 202 say monitoring is not automated or is "story 0.8".
- SCDF reference (read-only): `Ahmad_samawi_231116/deployment/phase3/01-prometheus-alerts.sh`, `02-alertmanager-config.sh`, `03-textfile-collectors.sh` -- rule/label/route style.

## Tasks & Acceptance

**Execution:**
- [x] `deploy/backup.sh` -- guard `main "$@"` so it runs only when executed directly; behavior is otherwise unchanged.
- [x] `deploy/monitor.sh` -- `install`, `collect` and `status`, per the Design Notes. Exit codes: 2 refused, 3 lock held (`flock -n $state_dir/monitor.lock`).
- [x] `deploy/monitoring/mawareeth-alerts.yml` -- the matrix rules. Each has a `project: mawareeth` label and a `runbook` annotation.
- [x] `deploy/monitoring/prometheus-scrape.yml` -- scrape job `mawareeth-node`, target `<tailscale-ip>:9100`, labels `alias=mawareeth-prod`, `project=mawareeth`.
- [x] `deploy/monitoring/alertmanager-route.yml` -- a child route on `project=mawareeth` to the `SMTP_TO` receiver, subject `[MAWAREETH {{severity}}]`, plus the HostDown inhibit.
- [x] `deploy/tests/test_monitor.sh` -- offline stub tests:
  - every matrix row;
  - generated units and drop-ins;
  - the prom text format;
  - `backup.sh` still runs when executed directly;
  - `promtool check rules` when promtool is installed.
- [x] `deploy/tests/test_host_baseline.sh` -- fail if any script opens 9100 other than `in on tailscale0`.
- [x] `deploy/README.md` -- add a "Monitoring and alerting" section:
  - Tailscale join (interactive `tailscale up`);
  - merging the snippets into `p1`;
  - Better Stack setup;
  - log bounds (4 containers × 50 MB, plus journald);
  - runbooks.
  - Also fix lines 3, 147 and 202.

**Acceptance Criteria:**
- Given `monitor.sh install`, when outputs are inspected, then:
  - the exporter listens only on the Tailscale IP with the textfile collector enabled;
  - `mawareeth-monitor-collect.timer` runs every 5 minutes with `Persistent=true`;
  - journald and UFW match the Always rules.
- Given Better Stack is configured as documented (3-minute checks, 3-minute confirmation), when `/health/ready/` fails twice in a row, then the operator is emailed.
- Given the suites, when they run, then they pass offline without network or host mutation, and the existing suites still pass.

## Spec Change Log

## Design Notes

**Listen address.** Add a systemd drop-in for the exporter:
- `After=tailscaled.service`, `Restart=always`, `RestartSec=15`.
- `ExecStart` resolves `tailscale ip -4` and passes `--web.listen-address=<ip>:9100 --collector.textfile.directory=…`.
- It fails rather than falling back to another address (SCDF incident #34d).

**Metrics** (gauges):
```
mawareeth_backup_last_ok_timestamp_seconds     # 0 if unusable
mawareeth_backup_last_result_ok                # 1/0
mawareeth_restore_last_pass_timestamp_seconds
mawareeth_restore_last_result_pass
mawareeth_monitor_collect_timestamp_seconds
```
Staleness is judged by Prometheus rules (`time() - x`), so the collector never compares clocks.

## Verification

**Commands:**
- `bash -n deploy/*.sh deploy/tests/*.sh` -- expected: all parse.
- `bash deploy/tests/test_monitor.sh && bash deploy/tests/test_backup.sh && bash deploy/tests/test_host_baseline.sh && bash deploy/tests/test_compose_runtime.sh && bash deploy/tests/test_release.sh` -- expected: pass offline.
- `shellcheck deploy/monitor.sh deploy/tests/test_monitor.sh` -- expected: clean if installed.

## Suggested Review Order

**Exporter bound to Tailscale only**

- Entry point: install order — drop-in loaded before apt, UFW must be active, then packages.
  [`monitor.sh:143`](../../deploy/monitor.sh#L143)

- Wrapper binds only a 100.64/10 address; no Tailscale IP means exit and retry.
  [`monitor.sh:115`](../../deploy/monitor.sh#L115)

- Drop-in replaces ExecStart, restarts every 15s, waits for tailscaled.
  [`monitor.sh:128`](../../deploy/monitor.sh#L128)

- The single firewall opening: 9100 only in on tailscale0.
  [`monitor.sh:34`](../../deploy/monitor.sh#L34)

**Records to metrics**

- Unusable or unhealthy records collapse to 0, so the matching alert fires.
  [`monitor.sh:55`](../../deploy/monitor.sh#L55)

- Five gauges; staleness is left to Prometheus, the collector never compares clocks.
  [`monitor.sh:66`](../../deploy/monitor.sh#L66)

- Guard lets monitor.sh reuse backup.sh's fail-closed record reader without running it.
  [`backup.sh:911`](../../deploy/backup.sh#L911)

**Alerting on p1**

- HostDown also fires when the scrape job vanishes, and inhibits the rest.
  [`mawareeth-alerts.yml:10`](../../deploy/monitoring/mawareeth-alerts.yml#L10)

- Backup rule: not ok, older than 26h, or dated more than 300s ahead.
  [`mawareeth-alerts.yml:21`](../../deploy/monitoring/mawareeth-alerts.yml#L21)

- Disk thresholds 75% warning / 85% critical for 5m.
  [`mawareeth-alerts.yml:47`](../../deploy/monitoring/mawareeth-alerts.yml#L47)

- Collector stale, absent, or textfile parse error.
  [`mawareeth-alerts.yml:73`](../../deploy/monitoring/mawareeth-alerts.yml#L73)

- project=mawareeth route, `[MAWAREETH …]` subject, scoped inhibits.
  [`alertmanager-route.yml:10`](../../deploy/monitoring/alertmanager-route.yml#L10)

- Scrape job with alias and project labels.
  [`prometheus-scrape.yml:6`](../../deploy/monitoring/prometheus-scrape.yml#L6)

**Operator documentation**

- Setup, p1 merge checks, Better Stack, log bounds, runbooks.
  [`README.md:206`](../../deploy/README.md#L206)

**Tests**

- promtool scenarios for every alert row; required when CI is set.
  [`test_monitor.sh:450`](../../deploy/tests/test_monitor.sh#L450)

- amtool validates the merged route and receiver.
  [`test_monitor.sh:467`](../../deploy/tests/test_monitor.sh#L467)

- 9100 may open only via the tailscale0 rule; YAML may never expose it.
  [`test_host_baseline.sh:22`](../../deploy/tests/test_host_baseline.sh#L22)
