---
title: 'Delay the absent() branches of MawareethCollectorStale and MawareethDrillOverdue'
type: 'bugfix'
created: '2026-11-12'
status: 'done'
baseline_revision: 'eda478601ecc2666a33385cf54dd015f752a358c'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** `MawareethCollectorStale` and `MawareethDrillOverdue` each have an `absent(...)` branch and no `for:`. When a single scrape of the Mawareeth host fails, Prometheus marks every series from that target stale, so both `absent()` branches turn true at once. Both alerts then fire and email the operator before `MawareethHostDown` (`for: 2m`) can fire and inhibit them. `MawareethGithubTokenUnhealthy` fixed the same false alarm with `for: 5m`, but these two rules never got the fix (deferred-work.md, "Monitoring & alerts").

**Approach:** Split each rule into two rules that share one alert name, the same pattern as `MawareethOriginCertificateExpiring`. The first keeps today's threshold branches, with no `for:`, so they still fire at once. The second holds only the `absent(...)` branch, with `for: 5m`. A missing metric then warns after 5 minutes, which is longer than HostDown's 2 minutes.

## Boundaries & Constraints

**Always:** Keep every threshold, label set (`severity: warning`, `project: mawareeth`), summary, description and runbook annotation of the threshold rule unchanged. The new absent-only rule carries the same severity, project label and runbook, plus a summary and description that say the metric is missing and that this fires after 5 minutes. The existing promtool tests for the stale, unparseable, overdue, never-passed and future-dated cases must keep passing with their current eval times. Shell code must stay ShellCheck-clean.

**Block If:** promtool shows that the split changes the result of any existing non-absent test case, or that the absent-only rule cannot fire after 5 minutes while `up == 1`.

**Never:** Do not put `for:` on the threshold branches. Do not change any other rule, the Alertmanager route or inhibit snippets, `monitor.sh`, or the drill/collector logic. Do not touch the other open monitoring items in deferred-work.md (collector-failure guards, heartbeat `url_file`, swap branch).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Metric missing, host scraped | `up == 1`, no `mawareeth_monitor_collect_timestamp_seconds` / no `mawareeth_drill_last_pass_timestamp_seconds` | No alert at 4m; each alert fires by 6m with labels `{severity: warning, project: mawareeth, alertname, job: mawareeth-node}` | — |
| One failed scrape | Metric present, then missing for under 5m, then present again | Neither alert fires | — |
| Collector stale | timestamp not advancing | CollectorStale fires after 20 minutes, as today (silent at 19m, firing at 21m) | — |
| Unparseable file | `node_textfile_scrape_error == 1` | CollectorStale fires at once, as today | — |
| Drill overdue / never / future-dated | existing day-scale and 1m cases | Unchanged eval times and results | — |
| Healthy | full healthy fixture | Nothing fires at 30m | — |

</intent-contract>

## Code Map

- `deploy/monitoring/mawareeth-alerts.yml:97-108` -- `MawareethCollectorStale`. Remove `or absent(...)` (line 100) and put it in a new rule right after this one.
- `deploy/monitoring/mawareeth-alerts.yml:120-131` -- `MawareethDrillOverdue`. Same change for the `absent(...)` on line 124.
- `deploy/monitoring/mawareeth-alerts.yml:133-153` -- `MawareethOriginCertificateExpiring`, the existing example of two rules sharing one alert name.
- `deploy/monitoring/mawareeth-alerts.yml:155-170` -- the GitHub token rule, the precedent for `for: 5m` on an `absent()` and its wording ("... for 5 minutes").
- `deploy/tests/test_monitor.sh:1080-1114` -- `need` static text checks. Lines 1086 and 1090 match the absent text. 1090 matches `or absent(...)`, which will no longer exist after the split, so update it to match the new `expr:` text.
- `deploy/tests/test_monitor.sh:1115-1126` -- counts of `for:` lines. Today there are 9 in total and 5 at `for: 5m`; after the change there will be 11 and 7. Update the counts and the comment. Add checks that each name's absent-only rule has `for: 5m`, and that its threshold rule has none. With two blocks per name, `sed -n '/alert: X$/,/labels:/p'` prints both, so the check has to look at each block separately (for example with awk).
- `deploy/tests/test_monitor.sh:1253-1256` -- the CollectorStale absent case, which today expects it firing at 1m. Change it to silent at 4m and firing at 6m, and give the input series enough samples (for example `1x10`).
- `deploy/tests/test_monitor.sh:1316-1320` -- the DrillOverdue absent case. Same change.
- `deploy/tests/test_monitor.sh:1379-1385` -- the token absent test to copy.
- `deploy/README.md:686,688` -- rules table rows. Say the absent case fires after 5 minutes.
- `deploy/README.md:804-822` -- the runbooks for both alerts. Add one short line saying that a missing metric fires only after 5 minutes, so a single failed scrape does not.
- `_bmad-output/implementation-artifacts/deferred-work.md:90-92` -- the entry this spec resolves. Remove it.

## Tasks & Acceptance

**Execution:**
- `deploy/monitoring/mawareeth-alerts.yml` -- split CollectorStale and DrillOverdue as described, and update the header comment if it lists firing behaviour -- removes the false alarm on one failed scrape.
- `deploy/tests/test_monitor.sh` -- update the static checks, the `for:` counts and comment, the per-rule `for:` checks and both absent promtool cases. Add a "one failed scrape" promtool case using staleness markers, the way a failed scrape leaves them (for example `values: '0+60x3 stale stale stale 360+60x5'` for the collect timestamp, a constant drill timestamp with `stale` at the same positions, and `up` at `1 1 1 1 0 0 0 1 1 1 1 1`). Assert that neither alert fires at 5m, 7m or 9m. Note: `_` (an absent sample) is not enough, because the 5-minute lookback still finds the last sample. -- covers the matrix.
- `deploy/README.md` -- update the two table rows and the two runbooks -- keeps the operator documentation accurate.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- remove the resolved entry -- backlog hygiene.

**Acceptance Criteria:**
- Given the edited rules, when `deploy/tests/test_monitor.sh` runs with CI set and the pinned promtool 3.15.0 and amtool 0.34.1, then it passes, including the new cases.
- Given the edited rules, when `promtool check rules deploy/monitoring/mawareeth-alerts.yml` runs, then it reports no errors.

## Spec Change Log

## Review Triage Log

### 2026-11-12 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1 (high 0, medium 0, low 1)
- defer: 0
- reject: 15 (high 0, medium 0, low 15)
- addressed_findings:
  - `[low]` `[patch]` The stale-marker fixture's comment said "a failed scrape" although the case has three failed scrapes; reworded to "a short scrape outage (3 failed scrapes)" in `deploy/tests/test_monitor.sh`.

## Verification

**Commands:**
- Run the suite in Linux with the CI tool versions. In Git Bash, from the repo root: `MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W)":/src -w /src -e CI=1 ubuntu:24.04 bash -c 'apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null && cd /tmp && curl -fsSL -o p.tgz https://github.com/prometheus/prometheus/releases/download/v3.15.0/prometheus-3.15.0.linux-amd64.tar.gz && curl -fsSL -o a.tgz https://github.com/prometheus/alertmanager/releases/download/v0.34.1/alertmanager-0.34.1.linux-amd64.tar.gz && printf "%s  %s\n" 2a542df32eac02ee17b9d844fb2aa1de00dafa5476579ba8a3ba862e9d572ea0 p.tgz 265b9d1e55ef0d5306a436018af6d2b686c2ce051f03d968f7464ecb1372a7e8 a.tgz | sha256sum -c - && tar -xzf p.tgz --strip-components=1 -C /usr/local/bin prometheus-3.15.0.linux-amd64/promtool && tar -xzf a.tgz --strip-components=1 -C /usr/local/bin alertmanager-0.34.1.linux-amd64/amtool && cd /src && bash deploy/tests/test_monitor.sh'` -- expected: exit 0. If the suite needs extra packages, install them in the container. Never install them on the host.
- `MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W)":/src koalaman/shellcheck:v0.11.0 /src/deploy/tests/test_monitor.sh` -- expected: no findings. That tag matches `SHELLCHECK_VERSION` in `.github/workflows/django.yml`.

## Auto Run Result

Status: done

**Summary:** `MawareethCollectorStale` and `MawareethDrillOverdue` are each split into two rules with one alert name. The threshold rule keeps its current branches and fires at once. A new rule holds only the `absent(...)` branch, with `for: 5m`. A short scrape outage no longer emails these alerts before `MawareethHostDown` (`for: 2m`) fires and inhibits them. That inhibit rule matches on `equal: [project]`, so it also covers these job-only alerts.

**Files changed:**
- `deploy/monitoring/mawareeth-alerts.yml`: split both rules; the new absent-only rules have `for: 5m`.
- `deploy/tests/test_monitor.sh`: rule and `for:` counts (21 rules, 11 delays, 7 at 5m); awk check per name (threshold rule with no `for:`, absent rule with `for: 5m`); the absent cases are now silent at 4m and fire at 6m; new stale-marker outage case (3 failed scrapes, then recovery, nothing fires at 5m, 7m or 9m).
- `deploy/README.md`: the two rules-table rows, plus one line in each runbook about the 5-minute delay.
- `_bmad-output/implementation-artifacts/deferred-work.md`: removed the resolved entry.

**Review:** 4 reviewers (blind, edge-case, verification-gap, intent-alignment); 1 low patch applied, 0 deferred, 15 rejected. Rejected findings: job-wide `absent()` (pre-existing, single target); HostDown inhibition of job-only alerts (verified: `equal: [project]`); requests for end-to-end Alertmanager or email tests (the operator alert-path drill covers that path, and the route is unchanged); extra boundary and transition fixtures; wording of unchanged threshold annotations (the spec keeps them); "missing from mawareeth.prom" wording (same as the GitHub token rule); garbled characters, which are only how the reviewer displayed an em dash. Also rejected: standalone `promtool check rules` now prints a non-fatal lint warning, "2 duplicate rule(s)". Each pair has identical static labels but different output label sets, so the alerts do not collide. Fixing the warning would mean adding a label that changes alert identity.

**Follow-up review recommended:** false (patched: high 0, medium 0, low 1; score 1).

**Verification:** In `ubuntu:24.04`, with checksum-verified promtool 3.15.0 and amtool 0.34.1 and `CI=1`, `bash deploy/tests/test_monitor.sh` passed (promtool rule checks, amtool route checks, monitor.sh tests), both before and after the patch. `promtool check rules` exited 0 with the lint warning above. `koalaman/shellcheck:v0.11.0` reported no findings on `deploy/tests/test_monitor.sh`. LF endings confirmed.

**Residual risks:** The rules take effect only after the operator copies `mawareeth-alerts.yml` to p1 and reloads Prometheus. Until then, production keeps firing at once on a missing metric. Not deployed; committed locally on `development`.

