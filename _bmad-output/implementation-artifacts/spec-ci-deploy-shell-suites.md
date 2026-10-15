---
title: 'Run deploy shell suites and ShellCheck in CI'
type: 'chore'
created: '2026-10-15'
status: 'done'
baseline_commit: '14f1397c0cfa04fd8c9e383c019661e1ce6a0456'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The offline deploy suites (`deploy/tests/*.sh`) and ShellCheck run only by hand. `django.yml` runs only `manage.py test`, so a regression in host baseline, Compose runtime, blue-green release, backup, or monitoring can merge with green CI and still trigger the image publish. Five separate deferrals (0.4, 0.5, 0.6, 0.7) point at this gap.

**Approach:** Add a `deploy-shell` job to the existing `Django CI` workflow. It runs ShellCheck over every deploy shell script, installs pinned and checksum-verified `promtool`/`amtool` so the monitor suite's CI-mandatory validators run, and runs every suite twice: once unprivileged and once as root. Then mark the covered deferred-work entries resolved.

## Boundaries & Constraints

**Always:** The job lives in `.github/workflows/django.yml` so `deploy.yml` (which waits for `Django CI` to succeed) does not publish when a deploy suite fails. Third-party actions are pinned by commit SHA, as the existing steps are. Downloaded binaries are pinned by version and checked against upstream SHA-256 before use. `CI` stays set (GitHub sets it), so missing `promtool`/`amtool` fails the suite. The suites stay offline.

**Ask First:** Any ShellCheck finding whose fix would change runtime behavior of a `deploy/*.sh` script (not just quoting/style), or a root-run failure that needs changes to a production script rather than a test. Disabling a ShellCheck rule globally.

**Never:** No contact with Hetzner, a registry, Storage Box, p1, or a tailnet. No secrets. No `continue-on-error`, `|| true`, or skipping a suite to get green. No new path filter that could skip `Django CI` (that would also skip publishing gates). The Python deploy tests and the PR Docker build (0.2 deferral) are out of scope.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Clean push/PR | Current `deploy/` | `deploy-shell` passes; publish can proceed after a push to master | N/A |
| Suite regression | e.g. `compose.yaml` publishes 5432 | Suite exits non-zero; job and `Django CI` fail; no image publish | Failing step names the suite |
| ShellCheck regression | New unquoted expansion in `deploy/release.sh` | ShellCheck step fails | Annotated finding in the log |
| Validator download tampered | Checksum mismatch | `sha256sum -c` fails before the binary is put on PATH | Job fails |
| Root-only branch | Suites run under `sudo` | Privileged branches (real `chown`/`stat`) run | Job fails if they break |

</frozen-after-approval>

## Code Map

- `.github/workflows/django.yml` -- only CI workflow running tests; one `validate` job (Postgres service, uv). Add the sibling job here. Checkout pin: `actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4`.
- `.github/workflows/deploy.yml` -- read-only. `workflow_run` on `Django CI` with `conclusion == 'success'`; a new job in `django.yml` therefore gates publishing.
- `deploy/tests/test_host_baseline.sh`, `test_compose_runtime.sh`, `test_release.sh`, `test_backup.sh`, `test_monitor.sh` -- self-contained bash suites. Each resolves `root` from its own path, uses `mktemp -d` outside the checkout, and stubs docker/systemctl/curl. Each branches on `EUID` (unprivileged runs stub `stat` and patch the root gate; root runs use real `chown`/`stat`). `test_compose_runtime.sh:392` additionally runs real `docker compose config` when available (present on `ubuntu-latest`).
- `deploy/tests/test_monitor.sh:343-475` -- `missing_tool` fails under `CI` when `promtool` or `amtool` is absent; runs `promtool check rules`/`test rules` and `amtool check-config`/`config routes test`.
- `deploy/*.sh` (`backup`, `bootstrap-host`, `monitor`, `provision-host`, `release`, `runtime`) -- ShellCheck targets with the five suites. Suites already carry `# shellcheck disable=SC2016` headers.
- `deploy/README.md:260` -- documents the CI requirement for promtool/amtool; add one line on where CI runs the suites.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- entries to mark resolved: 0.4 "Wire test_host_baseline.sh (and ShellCheck) into a CI job", 0.5 "Compose runtime contract, resolved-model check, and Linux root-permission tests", 0.6 "Run test_release.sh … in GitHub Actions", 0.7 "Run test_backup.sh … in GitHub Actions".

## Tasks & Acceptance

**Execution:**
- [x] `.github/workflows/django.yml` -- add job `deploy-shell` (`ubuntu-latest`, `timeout-minutes: 15`): pinned checkout; `shellcheck --version` then `shellcheck deploy/*.sh deploy/tests/*.sh` (preinstalled ShellCheck); download pinned Prometheus and Alertmanager linux-amd64 release tarballs (latest stable at least two weeks old), verify each against its upstream `sha256sums.txt` value hard-coded in the workflow, install `promtool`/`amtool` to a directory on `GITHUB_PATH`; then one step per suite running `bash deploy/tests/<suite>.sh` unprivileged, followed by one step running all five with `sudo --preserve-env=CI env "PATH=$PATH" bash …` -- gates publishing on the deploy contract with both privilege branches exercised.
- [x] `deploy/*.sh`, `deploy/tests/*.sh` -- fix any ShellCheck findings with minimal, behavior-preserving edits or a line-scoped `# shellcheck disable=SCxxxx # reason` -- CI must start green without weakening the check.
- [x] `deploy/README.md` -- state that `Django CI` runs ShellCheck and every `deploy/tests/*.sh` suite (unprivileged and as root) with `promtool`/`amtool` -- keeps the runbook truthful.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- append `resolved_by: spec-ci-deploy-shell-suites` (plus PR link once known) under the four entries listed in the Code Map; do not delete them -- user chose mark-resolved over removal.

**Acceptance Criteria:**
- Given a push or PR, when `Django CI` runs, then `deploy-shell` runs ShellCheck and all five suites unprivileged and as root, and fails the workflow if any of them fails.
- Given the job log, when `test_monitor.sh` finishes, then it prints `promtool rule checks passed` and `amtool route checks passed` (never the "skipped" message).
- Given a failing `deploy-shell`, when the push was to master, then `Publish Release Image` does not publish.

## Design Notes

The deferrals say "on changes under `deploy/**`". The job runs on every push/PR instead. A workflow-level path filter would skip `Django CI` and its publish trigger, and a job-level skip gives no protection to changes elsewhere (e.g. `.gitignore`, `requirements`) that the suites copy into their bundles. The suites are offline and take seconds, so the cost is negligible.

Root step shape:
```yaml
- name: Run deploy suites as root
  run: |
    for suite in deploy/tests/test_*.sh; do
      echo "::group::$suite (root)"; sudo --preserve-env=CI env "PATH=$PATH" bash "$suite"; echo "::endgroup::"
    done
```
(`set -e` is the GitHub `bash` default, so the first failure stops the step.)

## Verification

**Commands:**
- `docker run --rm -v "$PWD:/src:ro" -w /src koalaman/shellcheck:stable deploy/*.sh deploy/tests/*.sh` -- expected: no output, exit 0.
- In a disposable `ubuntu:24.04` container with a copy of the repo, the packages the suites need (`git`, `python3`, `docker` CLI optional), the pinned `promtool`/`amtool`, and `CI=true`: run each suite as an unprivileged user and as root -- expected: every suite prints its "passed" line and exits 0.
- `actionlint .github/workflows/django.yml` (via `rhysd/actionlint` image) -- expected: no findings.
- After push: the `deploy-shell` job is green on the PR.

## Suggested Review Order

**CI gate**

- New job lives in `Django CI`, so a failure also blocks `Publish Release Image`.
  [`django.yml:77`](../../.github/workflows/django.yml#L77)

- All three tools pinned by version and verified against upstream SHA-256.
  [`django.yml:92`](../../.github/workflows/django.yml#L92)

- Pinned ShellCheck over every deploy script and suite.
  [`django.yml:119`](../../.github/workflows/django.yml#L119)

- Same `test_*.sh` glob for both passes; failures name the suite.
  [`django.yml:121`](../../.github/workflows/django.yml#L121)

- Root pass exercises the real `chown`/`stat` branches.
  [`django.yml:129`](../../.github/workflows/django.yml#L129)

**Test fixes exposed by real Linux/root runs**

- Avoid same-second run-tag collision (real bug deferred, not fixed here).
  [`test_backup.sh:336`](../../deploy/tests/test_backup.sh#L336)

- State dir must be 0700 when checked for real as root.
  [`test_backup.sh:30`](../../deploy/tests/test_backup.sh#L30)

- Symlink no longer persists into later record writes on Linux.
  [`test_monitor.sh:210`](../../deploy/tests/test_monitor.sh#L210)

- jq stubs drain piped stdin to stop SIGPIPE flakes under pipefail.
  [`test_host_baseline.sh:114`](../../deploy/tests/test_host_baseline.sh#L114)

**ShellCheck-only production edits (behavior-preserving)**

- Explicit `1>&` for numeric fd redirects (SC2261).
  [`backup.sh:456`](../../deploy/backup.sh#L456)

- Line-scoped disable: command is `%q`-quoted on purpose.
  [`provision-host.sh:166`](../../deploy/provision-host.sh#L166)

- Runtime-only `/etc/os-release` source.
  [`bootstrap-host.sh:30`](../../deploy/bootstrap-host.sh#L30)

**Docs and bookkeeping**

- Runbook states where CI runs the suites.
  [`README.md:262`](../../deploy/README.md#L262)

- Four covered deferrals marked resolved; run-tag collision deferred.
  [`deferred-work.md:19`](deferred-work.md#L19)
