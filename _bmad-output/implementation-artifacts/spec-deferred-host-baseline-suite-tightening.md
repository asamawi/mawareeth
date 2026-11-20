---
title: 'Syntax-check every host baseline script and assert the malformed-CIDR provision refusal'
type: 'chore'
created: '2026-11-20'
status: 'done'
baseline_revision: '83b889afeae08847aed04d1b3a41ecb38baea7c4'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred:
  - summary: >-
      No automated test runs test_host_baseline.sh against a malformed bootstrap-host.sh to prove the per-file syntax check fails early and names the file.
    evidence: |-
      Verified manually only (Ubuntu container, appended `fi` to bootstrap: "FAIL: bash -n failed for bootstrap-host.sh"). CI's separate ShellCheck step catches malformed bootstrap source, so the gap is limited to the suite's own diagnostic.
    location: >-
      deploy/tests/test_host_baseline.sh:11
    severity: low
---

<intent-contract>

## Intent

**Problem:** In `deploy/tests/test_host_baseline.sh`, `bash -n "$provision" "$bootstrap" "$0"` parses only `provision-host.sh` (bash treats the other names as positional arguments), so `bootstrap-host.sh` and the suite itself are never syntax-checked. The offline `SSH_ALLOWED_CIDRS=not-a-cidr` provision run discards its output and accepts any nonzero exit, so a provision that fails for an unrelated reason (missing tool, unreadable key) still passes.

**Approach:** Syntax-check each of the three files with its own `bash -n`, failing with the file's name. Replace the offline not-a-cidr run with a `provision_refuses` case that requires the CIDR refusal message and proves no Hetzner or host call happened first.

## Boundaries & Constraints

**Always:** Test-only change in `deploy/tests/test_host_baseline.sh`. Keep the suite passing under `shellcheck` (CI runs it on `deploy/tests/*.sh`) and `set -Eeuo pipefail`. Keep the line `host baseline offline checks passed` (or an equivalent progress line) so output stays readable.

**Never:** Change `deploy/provision-host.sh`, `deploy/bootstrap-host.sh` or any other deploy script. Do not weaken or remove other assertions. Do not add the sandboxed bootstrap run (separate deferred item).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Syntax error in bootstrap | `bootstrap-host.sh` fails `bash -n` | suite fails naming `bootstrap-host.sh` | `fail` |
| Syntax error in suite | the suite itself fails `bash -n` | suite fails (bash itself refuses to run it, or the per-file check names it) | `fail` |
| Malformed CIDR | stubbed valid config with `SSH_ALLOWED_CIDRS=not-a-cidr` | provision exits nonzero, output contains `invalid or excessively broad CIDR`, no `hcloud`/`curl`/`ssh`/`scp` in the stub log, token not printed | `provision_refuses` fails otherwise |

</intent-contract>

## Code Map

- `deploy/tests/test_host_baseline.sh:11` -- `bash -n "$provision" "$bootstrap" "$0"`: the single-call syntax check to split into one call per file.
- `deploy/tests/test_host_baseline.sh:102-117` -- offline block: creates `$tmp` (keep the `mktemp`/`trap`), the sample key pair `$tmp/idpair` / `$tmp/id.pub` (keep: `id.pub` feeds `good_key` at ~191), a placeholder `$tmp/id` (only used by `$tmp/config`), `$tmp/config` with `SSH_ALLOWED_CIDRS=not-a-cidr`, and the run at 116 that discards output. Remove the placeholder, the config and the run; nothing else reads `$tmp/config` or `$tmp/id`.
- `deploy/tests/test_host_baseline.sh:529-531` -- `provision_with` (stubbed hcloud/ssh/etc. via `$stub`, logs to `$log`).
- `deploy/tests/test_host_baseline.sh:584-591` -- `provision_refuses expected-text config`: asserts nonzero exit, expected text in output, no token, no provider/transport call.
- `deploy/tests/test_host_baseline.sh:595-600` -- existing loop of malformed `SSH_ALLOWED_CIDRS` values built from `$tmp/valid-config` (`'value:expected text'`, split with `${bad%:*}` / `${bad##*:}`); the natural home for `not-a-cidr:invalid or excessively broad CIDR`.
- `deploy/provision-host.sh:27-38,117` -- `validate_cidrs` runs before `require_command hcloud` and any provider call; its message is `SSH_ALLOWED_CIDRS contains an invalid or excessively broad CIDR`. Read-only.
- `.github/workflows/django.yml:227-243` -- CI runs shellcheck and every `deploy/tests/test_*.sh` on Linux.

## Tasks & Acceptance

**Execution:**
- `deploy/tests/test_host_baseline.sh` -- replace line 11 with a loop running `bash -n` on each of `$provision`, `$bootstrap`, `$0`, failing with `fail "syntax error in <file>"` -- each file is actually parsed.
- `deploy/tests/test_host_baseline.sh` -- remove the placeholder `$tmp/id`, the `$tmp/config` heredoc/chmod and the discarded-output provision run; add `'not-a-cidr:invalid or excessively broad CIDR'` to the `provision_refuses` malformed-CIDR loop -- the refusal is asserted by message and by the absence of provider calls.

**Acceptance Criteria:**
- Given `bootstrap-host.sh` with a syntax error (e.g. a temporary unmatched `fi` in a scratch copy), when the per-file check runs on it, then it fails naming that file (verify by running the same `bash -n` loop against a broken copy in a temp dir; do not commit the broken copy).
- Given the unchanged scripts, when `bash deploy/tests/test_host_baseline.sh` runs, then it ends with exit 0 and its success lines.
- Given `provision-host.sh`'s CIDR message were changed, when the suite runs, then the not-a-cidr case fails (the message is asserted, unlike before).

## Spec Change Log

## Review Triage Log

### 2026-11-21 — Review pass
- verdicts: 9 findings — high 0, medium 0, low 6, false 3, maybe-false 0 (one combined codex call, standard tier, all five layers; cross-story-contract: no contract shape changed)
- findings:
  - `[low]` `[patch]` blind-hunter: line 11 reports any failed `bash -n` (including an unreadable file) as a syntax error — message changed to "bash -n failed for <file> (syntax error or unreadable file)"; applied by the parent (one line) instead of re-engaging the implementation subagent.
  - `[false]` `[reject]` blind-hunter: the "host baseline offline checks passed" banner overclaims after the CIDR run moved — the banner covers the static/offline checks above it, which still run there; the CIDR refusal is now asserted later by `provision_refuses`.
  - `[low]` `[defer]` blind-hunter: the AC's negative check used a copy of the loop, not the suite — grouped with the verification-gap finding; the suite-level check was then run manually (see Auto Run Result).
  - `[low]` `[patch]` edge-case-hunter: unreadable file labelled a syntax error — same root cause and fix as the first row.
  - `[false]` `[reject]` edge-case-hunter: missing stub log lets `provision_refuses` pass without evidence — `provision_refuses` truncates `$log` with `: > "$log"` first, so it always exists.
  - `[low]` `[reject]` edge-case-hunter: `provision_refuses` matches a substring anywhere in the output — pre-existing shared helper design; the substring is the setting-specific message, and tightening every caller is more than a direct correction.
  - `[low]` `[defer]` verification-gap: no automated malformed-bootstrap run of the suite — filed disposition defer; CI ShellCheck covers malformed source.
  - `[low]` `[reject]` verification-gap other: the spec's Verification expects exit 0 under Git Bash, which stops at a pre-existing chmod assertion — fixing it edits this build's spec; recorded under Auto Run Result instead.
  - `[false]` `[reject]` intent-alignment: descriptive report; the diff implements the selected item's reading on both points, no divergence to act on.

## Verification

**Commands:**
- `bash deploy/tests/test_host_baseline.sh` (Git Bash) -- expected: exit 0. Git Bash can fail randomly with fork/cygheap errors; rerun before diagnosing.
- `shellcheck deploy/tests/test_host_baseline.sh` if shellcheck is installed -- expected: no findings (CI runs it otherwise).

## Auto Run Result

Status: done

**Summary:** `deploy/tests/test_host_baseline.sh` now runs `bash -n` on `provision-host.sh`, `bootstrap-host.sh` and the suite separately, so all three are actually parsed and a failure names the file. The offline `SSH_ALLOWED_CIDRS=not-a-cidr` run, which discarded output and accepted any nonzero exit, is replaced by a `provision_refuses` case that requires "invalid or excessively broad CIDR" and proves no hcloud/curl/ssh/scp call happened first.

**Files changed:**
- `deploy/tests/test_host_baseline.sh` -- per-file syntax loop; offline config/placeholder key/run removed; not-a-cidr added to the malformed-CIDR `provision_refuses` loop.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- resolved item removed; pre-existing SC2258 lint warning recorded.

**Review:** 9 findings (one combined codex call). 1 patch (low, two rows: failure message now says "bash -n failed for <file> (syntax error or unreadable file)", applied by the parent). 1 deferred (low: no automated malformed-bootstrap suite run). Rejected: banner overclaim (false), missing stub log (false, log is truncated first), substring matching in `provision_refuses` (low, pre-existing shared helper), Git Bash exit-0 expectation (spec edit), intent-alignment report (no divergence). Patched counts: high 0, medium 0, low 1. Follow-up review: false.

**Verification:**
- Git Bash: the suite fails at the pre-existing writable-mode/chmod assertions (same on baseline 83b889a); there provision also stops at the config-ownership check (`pwd` module missing on Windows Python), which is why the old discarded-output run passed for the wrong reason locally.
- Ubuntu 24.04 container (python3, jq, openssh-client, iptables): the suite exits 0 as an unprivileged user and as root.
- Mutation: changing provision's CIDR message makes the suite fail with "refusal does not name invalid or excessively broad CIDR".
- Broken bootstrap (appended `fi`): the real suite fails with "FAIL: bash -n failed for bootstrap-host.sh (syntax error or unreadable file)".
- ShellCheck 0.9.0: only SC2258 at line 171, pre-existing from 83b889a (recorded in deferred-work.md).

**Residual risk:** CI's ShellCheck 0.11.0 step will likely fail on the pre-existing SC2258 warning until it is fixed.
