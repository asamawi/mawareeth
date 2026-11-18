---
title: 'Alert before the origin certificates or the GitHub read token expire'
type: 'feature'
created: '2026-11-03'
status: 'done'
baseline_commit: 'cf1449e64153afc8f5359c7a9c3234ee806927c0'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An expired Origin or Authenticated Origin Pulls (AOP) certificate in `/etc/mawareeth/origin-tls/` makes Cloudflare fail every visitor (52x/526) while Caddy keeps running. `runtime.sh` preflight only refuses once a certificate has already expired. An expired or revoked `/etc/mawareeth/github-read.token` only surfaces when a production deploy fails.

**Approach:** `monitor.sh collect` publishes each origin certificate file's earliest `notAfter`. A new daily `monitor.sh token-check` asks GitHub for the token's expiry and records the result, and `collect` publishes it. New Prometheus rules alert 30 days ahead (certificates go critical at 7 days), and each alert gets a README runbook.

## Boundaries & Constraints

**Always:** Fail closed: an unreadable certificate, or a token record that is missing, unusable or stale, raises an alert and never stays silent. The token value is never printed, logged or put on argv or in the environment. curl reads it from a config on a pipe, as `ci-deploy.sh` `api_get` does. `collect` stays offline and keeps exiting 0. Records are root:root 0600 `key=value` files read with `read_record`. Writes go through `atomic_write` under the monitor lock. Every new rule carries `project=mawareeth`, a severity and a `runbook` annotation.

**Ask First:** Adding any network call to `collect`. Changing existing rules or metrics. Reading `runtime.env` from `monitor.sh`.

**Never:** Taking the deploy or backup locks. Touching Caddy, slots or Cloudflare. Rotating credentials automatically. Checking Cloudflare's side of AOP. Spending GitHub API quota (use `/rate_limit`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Cert healthy | `cert.pem`, `aop-ca.pem` (one or more certificates) and `aop-client.pem` present and valid for more than 30 days | `mawareeth_origin_certificate_expiry_timestamp_seconds{file="…"}` = earliest `notAfter` across the file's certificates; no alert | N/A |
| Cert near expiry | Any certificate's `notAfter` is under 30 days away (under 7 days) | `MawareethOriginCertificateExpiring` fires as warning (critical) | N/A |
| Cert unreadable | File present but unparsable, not root-owned, a symlink, or `openssl` missing | Series value 0, so the critical alert fires | `collect` still exits 0 |
| Cert absent | File does not exist (acme mode, or AOP never set up) | No series for that file | N/A |
| Token ok | HTTP 200 with the expiration header | Record `result=ok`, `last_ok_epoch=now`, `expires_epoch=<epoch>`; alert when under 30 days | N/A |
| Token never expires | HTTP 200 without the header | `expires_epoch=never`, published as expiry 0; no expiry alert | N/A |
| Token rejected | HTTP 401/403 | `result=rejected` → `usable=0`, so `MawareethGithubTokenUnhealthy` fires | Exit 0 |
| Token file bad | Missing, not root:root 0600, or malformed | `result=missing` → `usable=0`, alert | Exit 0; curl is never called |
| Transient failure | Network error, 5xx, or an unparsable header | `result=error`; previous `last_ok_epoch` and expiry kept; alert only once the last ok check is more than 2 days old | Exit 0 |
| Record unusable | Token record absent, mis-owned or malformed | `usable=0`, `last_ok=0`, `expiry=0`, so the alert fires | `collect` exits 0 |

</frozen-after-approval>

## Code Map

- `deploy/monitor.sh` -- `render_metrics` (L101), `record_metrics`, `gauge`, `publish_metrics`, `cmd_collect`, `cmd_status`, `cmd_install` (timer install pattern, L413-425), `monitor_main`, header usage comment. `drill_dir`/`drill_check_dir` give the root 0700 `$state_dir/monitor` convention for the new record.
- `deploy/runtime.sh:22-30` -- `origin_tls_dir` (`MAWAREETH_ORIGIN_TLS_DIR`) and `aop_ca_file`/`aop_client_cert`, already in scope because `monitor.sh` → `backup.sh` → `runtime.sh`. `aop_certificates` (L189) shows how to walk PEM blocks; it calls `die`, so don't call it from `collect`.
- `deploy/backup.sh` -- reuse `read_record` (L996), `atomic_write`, `unit_service`/`unit_timer` (L1061-1075), `now_epoch`, `clean_path`, `require_command`.
- `deploy/ci-deploy.sh:221-243` -- `api_get` curl pattern (token config on a pipe, `--proto '=https'`, timeouts) and the 401/403 meaning. Read only.
- `deploy/monitoring/mawareeth-alerts.yml` -- add rules modelled on `MawareethDrillOverdue` / `MawareethBackupUnhealthy`, and update the header comment.
- `deploy/tests/test_monitor.sh` -- offline stubs (curl is stubbed in `$stub`), `metric`/`expect_metric`, `write_record`/`set_meta`, promtool matrix tests at L723-1041.
- `deploy/README.md` -- "Monitoring and alerting" (L578; install bullet list; "lists the eight metrics" at host check 3), Runbooks (L713), GitHub token setup (L898).

## Tasks & Acceptance

**Execution:**
- [x] `deploy/monitor.sh` -- In `render_metrics`, for each of `cert.pem`, `aop-ca.pem` and `aop-client.pem` in `$origin_tls_dir` that exists, publish the earliest `notAfter` epoch across its certificate blocks (`openssl x509 -enddate`), or 0 when it can't be read. Add `token-check`: outside the lock, read the token, call `https://api.github.com/rate_limit` with `--max-time 60` and bounded retries, and parse the header with `date -u -d`; then, under the monitor lock with a bounded wait, write `$state_dir/monitor/github-token` (`result`, `checked_epoch`, `last_ok_epoch`, `expires_epoch`). `collect` publishes `mawareeth_github_token_usable`, `mawareeth_github_token_last_ok_timestamp_seconds` and `mawareeth_github_token_expiry_timestamp_seconds`. `install` writes and enables `mawareeth-github-token-check.{service,timer}` (daily, `RandomizedDelaySec=1h`, `Persistent=true`), then runs one check before `publish_metrics`. `status` prints the token record without the token. Update the usage text and header comment.
- [x] `deploy/monitoring/mawareeth-alerts.yml` -- Add `MawareethOriginCertificateExpiring` (warning under 30 days, critical under 7 days, labelled by `file`) and `MawareethGithubTokenUnhealthy` (warning: `usable == 0`, or last ok more than 2 days old, or expiry > 0 and under 30 days away, or `absent(usable)`).
- [x] `deploy/tests/test_monitor.sh` -- Cover every matrix row: certificate metrics from throwaway certificates made with `openssl req -x509` (multi-certificate CA, unparsable, absent), `token-check` outcomes through the curl stub, checks that the token value never appears in the output, record or curl argv, and promtool unit tests for both rules at their thresholds.
- [x] `deploy/README.md` -- Document the new install bullet, the metric count, the `token-check` command, the two runbooks (anchors `runbook-mawareethorigincertificateexpiring`, `runbook-mawareethgithubtokenunhealthy`) and the AOP rotation pointer. Also note that leftover AOP files with AOP off are still monitored (remove them).

**Acceptance Criteria:**
- Given an installed host, when `monitor.sh install` runs, then the token-check timer is enabled and `mawareeth.prom` already holds the certificate and token series.
- Given any `token-check` run, when output, the record and the curl argv are inspected, then the token value appears in none of them.
- Given the full test suite, when `bash deploy/tests/test_monitor.sh` runs with promtool present, then it passes, and shellcheck reports nothing new.

## Spec Change Log

## Design Notes

The expiry of a fine-grained token isn't stored in the token. GitHub returns it as the `github-authentication-token-expiration` response header (for example `2027-01-31 00:00:00 UTC` or `… -0700`). `/rate_limit` doesn't count against the quota. Because the check runs daily from its own timer, `collect` stays offline. A transient failure keeps the previous good values, so a network blip doesn't page; persistent failure surfaces through the 2-day staleness rule. Certificates are judged by Prometheus (`expiry - time()`), so the host never compares clocks.

Review changed three things the plan did not state. The probe runs outside the monitor lock, so a slow GitHub call cannot refuse `collect` or `drill`, and a lost lock race cannot skip the day's check; the record is still written under the lock. `MawareethGithubTokenUnhealthy` has `for: 5m`, so the matrix's token alert rows fire about 5 minutes later, and one failed scrape cannot fire `absent()` before `MawareethHostDown` inhibits it. `TimeoutStartSec=360` covers the worst case of three 60s attempts, two 15s delays and the 120s lock wait; `Retry-After` can stretch it, and a kill then writes no record and shows a failed unit, so it fails closed.

## Verification

**Commands:**
- `bash deploy/tests/test_monitor.sh` -- expected: all checks pass, including promtool
- `shellcheck deploy/*.sh deploy/tests/*.sh` (the CI command, which follows `source`) -- expected: no findings
- `promtool check rules deploy/monitoring/mawareeth-alerts.yml` -- expected: SUCCESS

## Suggested Review Order

**GitHub token check**

- Entry point: probe outside the lock, then record under a bounded lock wait.
  [`monitor.sh:358`](../../deploy/monitor.sh#L358)

- Token stays on a pipe; status and last response's headers decide the result.
  [`monitor.sh:294`](../../deploy/monitor.sh#L294)

- Every non-ok result keeps the previous good values, so blips don't erase them.
  [`monitor.sh:340`](../../deploy/monitor.sh#L340)

- Only a transient error stays usable; a malformed record publishes all zeros.
  [`monitor.sh:214`](../../deploy/monitor.sh#L214)

- Own unit: needs only the network; timeout covers retries plus lock wait.
  [`monitor.sh:563`](../../deploy/monitor.sh#L563)

**Certificate expiry**

- Earliest notAfter across PEM blocks; anything unreadable publishes 0 and goes critical.
  [`monitor.sh:162`](../../deploy/monitor.sh#L162)

- Series only for files that exist, so acme hosts publish nothing.
  [`monitor.sh:194`](../../deploy/monitor.sh#L194)

**Alert rules**

- Warning stops at 7 days, so only the critical rule fires after that.
  [`mawareeth-alerts.yml:133`](../../deploy/monitoring/mawareeth-alerts.yml#L133)

- Token rule: rejected, stale, future-dated, expiring or absent, delayed by `for: 5m`.
  [`mawareeth-alerts.yml:155`](../../deploy/monitoring/mawareeth-alerts.yml#L155)

**Operator docs**

- Upgrade order: host first, then p1 rules, or `absent()` fires.
  [`README.md:617`](../../deploy/README.md#L617)

- Certificate runbook, including leftover files and checking the served certificate.
  [`README.md:787`](../../deploy/README.md#L787)

- Token runbook, including the Actions-permission blind spot and 403 throttling.
  [`README.md:798`](../../deploy/README.md#L798)

**Tests**

- Certificate rows of the matrix, using throwaway certificates.
  [`test_monitor.sh:582`](../../deploy/tests/test_monitor.sh#L582)

- Token rows of the matrix, including leak checks and curl flag assertions.
  [`test_monitor.sh:668`](../../deploy/tests/test_monitor.sh#L668)
