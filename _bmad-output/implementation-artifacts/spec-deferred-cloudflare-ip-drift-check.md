---
title: 'Scheduled CI check for Cloudflare IP range drift'
type: 'feature'
created: '2026-11-20'
status: 'done'
baseline_revision: '1b2cba65a82deb9746aea5e692077be5596bf8d1'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** `deploy/cloudflare-ips.txt` is a hand-maintained copy of Cloudflare's published ranges (https://www.cloudflare.com/ips-v4 and /ips-v6). With `PUBLIC_WEB_SOURCES=cloudflare`, a new Cloudflare range makes visitors routed through it time out, and nothing flags the drift until someone refreshes the file by hand (deferred-work.md, CI section, source `spec-cloudflare-origin-lock.md`).

**Approach:** Add a read-only `deploy/cloudflare-ips-check.sh` that fetches both published lists and compares them, as sets, with the ranges in `deploy/cloudflare-ips.txt`, plus a scheduled GitHub Actions workflow that runs it weekly (and on demand) and fails when they differ. The fetch happens in CI only; the host and the deploy scripts never fetch the list at runtime.

## Boundaries & Constraints

**Always:**
- Parse `deploy/cloudflare-ips.txt` exactly as `deploy/tests/test_compose_runtime.sh` (lines ~113-127) does: strip `#` comments and `\r`, trim, skip blank lines, one range per line.
- Compare as sets (order and duplicates do not matter); report each range published but missing from the file, and each range in the file no longer published, one per line, IPv4 and IPv6 together.
- Distinct exit codes: `0` match, `1` drift, `2` fetch or parse failure (empty body, HTTP error, a line that is not a CIDR). A failed fetch must never be reported as drift or as a match.
- The published-list URLs default to Cloudflare's and can be overridden by environment variables (`CLOUDFLARE_IPS_V4_URL`, `CLOUDFLARE_IPS_V6_URL`) so the offline test can point them at `file://` fixtures.
- `curl -fsSL` with retries and a bounded `--max-time`; `set -Eeuo pipefail`; passes the pinned ShellCheck the `deploy-shell` job runs (`shellcheck deploy/*.sh deploy/tests/*.sh`).
- Workflow: `permissions: contents: read` only; actions pinned by full commit SHA like the other workflows (`actions/checkout@11d5960a326750d5838078e36cf38b85af677262`); triggers `schedule` (weekly) and `workflow_dispatch`; a `timeout-minutes`; on drift, emit `::error::` lines naming the ranges.

**Never:**
- Modify `deploy/cloudflare-ips.txt`, `deploy/caddy/edge/cloudflare/global.caddy`, provisioning, or any runtime/deploy script behavior.
- Open issues, push commits or use any write token (failing the run is the signal).
- Fetch from the network in `deploy/tests/` (the suites run offline in CI and as root).
- Add the check to `django.yml` (it would make unrelated PRs fail on Cloudflare's schedule).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Match | Published v4+v6 equal the file's ranges, in any order, with a missing trailing newline or CRLF | Prints a one-line OK summary, exit 0 | No error expected |
| New range | Published lists contain a CIDR not in the file | Lists it as published but missing, exit 1 | Workflow fails with `::error::` |
| Retired range | File holds a CIDR no longer published | Lists it as no longer published, exit 1 | Workflow fails with `::error::` |
| Fetch failure | URL unreachable / HTTP error / empty body | Message naming the URL, exit 2 | Never treated as drift or match |
| Malformed body | A published line that is not an IPv4/IPv6 CIDR (e.g. an HTML page) | Message naming the line, exit 2 | Not compared |

</intent-contract>

## Code Map

- `deploy/cloudflare-ips.txt` -- the single source of Cloudflare ranges (read only); header comments, IPv4 first then IPv6.
- `deploy/tests/test_compose_runtime.sh:113-127` -- reference parser for the file (comment/CR stripping, one range per line); reuse the same rules.
- `deploy/tests/test_version.sh:1-15` -- pattern for an offline suite: `set -Eeuo pipefail`, `root=`, `fail()`, `bash -n`, `mktemp -d` outside the checkout with an EXIT trap.
- `.github/workflows/django.yml:183-248` (`deploy-shell`) -- runs ShellCheck on `deploy/*.sh deploy/tests/*.sh` and every `deploy/tests/test_*.sh` unprivileged and as root, so the new script and test are picked up automatically.
- `.github/workflows/deploy.yml` -- style reference: pinned checkout SHA, `permissions`, `timeout-minutes`, `shell: bash` with `set -euo pipefail`.
- `deploy/README.md:136` -- "Ranges" paragraph describing the manual refresh; add one sentence about the weekly check.

## Tasks & Acceptance

**Execution:**
- `deploy/cloudflare-ips-check.sh` -- new executable script (mode 100755 in git): optional first argument is the ranges file (default `deploy/cloudflare-ips.txt` relative to the repo root); fetch both URLs, validate each line as an IPv4 or IPv6 CIDR, compare sets with the file, print the differences and exit 0/1/2 per the matrix -- the drift check itself, runnable by an operator too.
- `deploy/tests/test_cloudflare_ips_check.sh` -- new executable offline suite using `file://` fixtures in a temp dir: match (reordered, CRLF, no trailing newline, duplicates), a new published range, a retired range, an unreachable URL, an empty body, a malformed (HTML) body; assert exit codes and that the reported ranges appear in the output -- covers every matrix row.
- `.github/workflows/cloudflare-ips.yml` -- new workflow "Cloudflare IP Drift": weekly `schedule` plus `workflow_dispatch`, `contents: read`, pinned checkout, runs `bash deploy/cloudflare-ips-check.sh` and turns its difference lines into `::error::` annotations -- the scheduled CI side.
- `deploy/README.md` -- in the "Ranges" paragraph, say that the Cloudflare IP Drift workflow compares the file with the published lists weekly and fails on a difference, and that `bash deploy/cloudflare-ips-check.sh` runs the same check by hand -- operators learn where the signal comes from.

**Acceptance Criteria:**
- Given the repository's current `deploy/cloudflare-ips.txt` and published lists equal to it, when `bash deploy/cloudflare-ips-check.sh` runs, then it exits 0.
- Given the new suite, when `bash deploy/tests/test_cloudflare_ips_check.sh` runs offline, then it passes and every matrix row is exercised.
- Given the workflow file, when it is parsed, then it is valid YAML with only `schedule` and `workflow_dispatch` triggers, `contents: read` permissions and a SHA-pinned checkout.
- Given the change, when ShellCheck runs over `deploy/*.sh deploy/tests/*.sh`, then the new files add no findings (if ShellCheck is available locally).

## Spec Change Log

## Review Triage Log

### 2026-11-20 — Review pass
Reviewer fallback: codex reported a usage limit (resets 2026-11-25), so all five layers ran as one combined read-only `gemini` call.
- verdicts: 16 findings — high 0, medium 1, low 2, false 12, maybe-false 0 (+ cross-story-contract: "No contract shape changed")
- findings:
  - `[false]` `[reject]` blind-hunter: `sort`/`comm` lack `LC_ALL=C` — both run in the same locale, so `comm`'s order always matches `sort -u`'s; no misclassification.
  - `[low]` `[patch]` blind-hunter: CIDR regexes accept /33../99 (IPv4) and /129../999 (IPv6) — prefixes bounded to 0-32 / 0-128, `1.2.3.0/33` case added expecting exit 2.
  - `[false]` `[reject]` blind-hunter: workflow discards stderr on exit 2 — stderr is not captured but still prints to the step log; the `::error::` names the exit code and the log names the URL/line.
  - `[false]` `[reject]` blind-hunter: the unreachable-URL test waits on curl retries — curl `--retry` retries only transient errors, and a missing `file://` is not one; the suite runs in seconds.
  - `[false]` `[reject]` blind-hunter: no `--connect-timeout` — `--max-time 30` bounds each attempt including connect; the worst case (~4 min for both URLs) is under the job's 10-minute timeout.
  - `[false]` `[reject]` blind-hunter: `file://C:/...` may parse `C:` as host — the suite passes on this Windows host, and CI on Linux uses no `cygpath`.
  - `[low]` `[patch]` edge-case-hunter: prefixes over /32 or /128 pass — same root cause as the regex finding; fixed by the same patch.
  - `[false]` `[reject]` edge-case-hunter: collation mismatch in `sort`/`comm` — same refutation as the blind-hunter row.
  - `[false]` `[reject]` edge-case-hunter: exit 2 annotation omits reason — same refutation as the stderr row.
  - `[false]` `[reject]` edge-case-hunter: exit 1 with empty stdout — the script exits 1 only when `missing` or `retired` is non-empty, and it prints each of their lines.
  - `[medium]` `[patch]` verification-gap: `test_workflows_pin_third_party_actions` skips `cloudflare-ips.yml` — added to the tuple in `mawareeth/tests.py`; `WorkflowContractTests` (19 tests) passes.
  - `[false]` `[reject]` verification-gap: default ranges path unexercised — the live run without arguments resolved `deploy/cloudflare-ips.txt` and exited 0, and every scheduled run exercises it.
  - `[false]` `[reject]` verification-gap: workflow annotation logic untested — the repository runs no workflow steps in tests (as the layer itself filed). The bash logic is eight lines, and a regression there still fails the run through `exit "$rc"`.
  - `[false]` `[reject]` intent-alignment: issue-opening surface omitted — the intent reads "fails (or opens an issue)"; failing satisfies it.
  - `[false]` `[reject]` intent-alignment: tests exercise `file://` fixtures, not the live fetch — the intent requires offline suites, and the live fetch is the scheduled workflow itself (checked once by hand, exit 0).
  - `[false]` `[reject]` intent-alignment: other readings (pre-release gate, full edge sync) — Caddy and provisioning sync is already enforced offline by `test_compose_runtime.sh` and provisioning; a PR/release gate would fail unrelated work on Cloudflare's schedule.

## Verification

**Commands:**
- `bash deploy/tests/test_cloudflare_ips_check.sh` -- expected: exit 0
- `bash -n deploy/cloudflare-ips-check.sh` -- expected: exit 0
- `uv run python -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/cloudflare-ips.yml')); print(sorted(d[True].keys()))"` -- expected: `['schedule', 'workflow_dispatch']`
- `git ls-files -s deploy/cloudflare-ips-check.sh deploy/tests/test_cloudflare_ips_check.sh` -- expected: mode 100755 for both

**Manual checks (if no CLI):**
- `bash deploy/cloudflare-ips-check.sh` against the live lists (network) -- report the result; exit 0 or 1 are both acceptable outcomes of the check itself, exit 2 needs a look.

## Auto Run Result

Status: done

**Summary:** A weekly, read-only "Cloudflare IP Drift" workflow compares `deploy/cloudflare-ips.txt` with Cloudflare's published IPv4 and IPv6 lists and fails, with `::error::` lines naming each range, when they differ. `deploy/cloudflare-ips-check.sh` runs the same check by hand.

**Files changed:**
- `deploy/cloudflare-ips-check.sh` -- new drift check (exit 0 match, 1 drift, 2 fetch/parse failure).
- `deploy/tests/test_cloudflare_ips_check.sh` -- new offline suite with `file://` fixtures covering every matrix row plus a bad-prefix case.
- `.github/workflows/cloudflare-ips.yml` -- new weekly + manual workflow, `contents: read`, SHA-pinned checkout.
- `deploy/README.md` -- the "Ranges" refresh paragraph names the workflow and the manual command.
- `mawareeth/tests.py` -- action-pinning test now covers `cloudflare-ips.yml`.

**Review findings:** 16 from one combined gemini call (codex usage-limited until 2026-11-25). Patched: 1 medium (pinning gate) and 2 low (CIDR prefix bounds, one root cause). Deferred: none. Rejected: 12 false (each reason in the triage log). Follow-up review recommended: false (patched counts: high 0, medium 1, low 2).

**Verification:** `bash deploy/tests/test_cloudflare_ips_check.sh` ok; `bash -n` clean; workflow YAML parses with triggers `['schedule', 'workflow_dispatch']` and `contents: read` (parsed with `uv run --no-project --with pyyaml`, since the project env has no PyYAML); both scripts are mode 100755; `WorkflowContractTests` 19 tests OK; a live run exits 0 (22 ranges match).

**Residual risks:** ShellCheck is not installed locally, so the new scripts are first linted by CI's `deploy-shell` job. The workflow's annotation step has never run on GitHub; the first scheduled or manual run exercises it.
