---
title: 'Quote the trailing/leading-comma CIDR test values so ShellCheck SC2258 passes'
type: 'chore'
created: '2026-11-21'
status: 'done'
baseline_revision: 'afceafa81c69736bb02096618a566df16c511a1d'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** `deploy/tests/test_host_baseline.sh:171` reads `for cidrs in 203.0.113.0/24, ,203.0.113.0/24; do`. ShellCheck flags the trailing comma as SC2258 (warning), and CI's `ShellCheck deploy scripts` step (ShellCheck 0.11.0 over `deploy/*.sh deploy/tests/*.sh`) fails on warnings, so the next push would break CI.

**Approach:** Quote the two loop values (`'203.0.113.0/24,' ',203.0.113.0/24'`) so the words are unchanged but ShellCheck no longer treats the comma as an array-separator mistake.

## Boundaries & Constraints

**Always:** The loop must still iterate exactly two values, `203.0.113.0/24,` and `,203.0.113.0/24`, each still asserted as refused with `contains an empty CIDR`. ShellCheck 0.11.0 must report nothing on `deploy/*.sh deploy/tests/*.sh`.

**Never:** No `# shellcheck disable` directive. No change to `bootstrap-host.sh`, `provision-host.sh`, other test cases, or the CI workflow.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Trailing comma | `SSH_ALLOWED_CIDRS=203.0.113.0/24,` | `validate_cidrs` refuses with `contains an empty CIDR` | suite fails if accepted |
| Leading comma | `SSH_ALLOWED_CIDRS=,203.0.113.0/24` | `validate_cidrs` refuses with `contains an empty CIDR` | suite fails if accepted |

</intent-contract>

## Code Map

- `deploy/tests/test_host_baseline.sh:171` -- the only SC2258 site; loop over the two malformed values, body at 172 calls `guest_refuses validate_cidrs 'contains an empty CIDR' "SSH_ALLOWED_CIDRS=$cidrs"`.
- `deploy/tests/test_host_baseline.sh:156-164` -- `guest_refuses` helper (read-only; reuse as is).
- `.github/workflows/django.yml:226-227` -- CI lint command `shellcheck deploy/*.sh deploy/tests/*.sh` (read-only; the target to keep green).

## Tasks & Acceptance

**Execution:**
- `deploy/tests/test_host_baseline.sh` -- on line 171, replace the unquoted words with `'203.0.113.0/24,' ',203.0.113.0/24'` -- removes SC2258 while keeping the same test inputs.

**Acceptance Criteria:**
- Given the edited repo, when `shellcheck deploy/*.sh deploy/tests/*.sh` runs with ShellCheck 0.11.0, then it exits 0 with no output.
- Given the edited repo, when `bash deploy/tests/test_host_baseline.sh` runs on Linux, then it passes, including both malformed-comma refusals.

## Spec Change Log

## Review Triage Log

### 2026-11-21 — Review pass
- verdicts: 9 findings — high 0, medium 0, low 8, false 1, maybe-false 0
- findings:
  - `low` `patch` blind-hunter: `$(<"$file")` buffers the whole local file in memory before parsing — patched: fd 3 redirect, parsing streams again.
  - `low` `patch` blind-hunter: buffering waits for EOF, so a FIFO with a bad line stalls instead of exiting 2 — patched with the same fd redirect; a FIFO run in Ubuntu now exits 2 in 0s.
  - `low` `patch` edge-case-hunter: FIFO with malformed CIDR and open writer waits for EOF — same root cause, same patch.
  - `low` `patch` edge-case-hunter: comment-heavy file larger than shell memory — same root cause, same patch.
  - `low` `patch` edge-case-hunter: NUL byte in the local file triggers a new Bash command-substitution warning — same root cause; `read` from the fd no longer goes through `$(<…)`.
  - `low` `patch` verification-gap: no test for a malformed local line on an open FIFO (filed `defer`) — the patch removes the stall; checked by a manual FIFO run, no suite test added since the restored behaviour matches the pre-change code.
  - `low` `patch` verification-gap (other): local comments held in memory until parsing — same root cause, same patch.
  - `low` `patch` verification-gap (other): NUL-byte warning — same root cause, same patch.
  - `false` `reject` intent-alignment: the cloudflare-ips-check.sh hunk lies outside the literal SC2258 intent — the intent's stated goal is a passing CI ShellCheck step before the next push, and that step covers `deploy/*.sh`; SC2094 from e6c33f6 would fail it, so the hunk serves the intent (see Design Notes).

## Design Notes

Step-03 verification found ShellCheck 0.11.0 still exits 1 after the SC2258 fix, on an SC2094 (info) at `deploy/cloudflare-ips-check.sh:46`: `parse_ranges "$file" <"$file"`. It came in with e6c33f6, which no CI run has linted yet, so it would fail the same lint step. It is a false positive (`$1` is only a label in messages). To meet the Always rule without a disable directive, the subshell opens the file on fd 3 and feeds `parse_ranges` from it: `file_ranges="$(exec 3<"$file" && parse_ranges "$file" <&3)"`. Parsing still streams line by line, so a malformed line still exits 2 at once (a first attempt that buffered the file with `$(<"$file")` was replaced in review for that reason).

## Verification

**Commands:**
- `MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/mnt" -w /mnt koalaman/shellcheck:v0.11.0 deploy/*.sh deploy/tests/*.sh` (glob expanded inside: wrap with `sh -c` on an image that has a shell, e.g. `koalaman/shellcheck-alpine:v0.11.0`) -- expected: exit 0, no findings.
- `MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/src" -w /src ubuntu:24.04 bash -c 'apt-get update -qq >/dev/null && apt-get install -y -qq openssh-client python3 >/dev/null && bash deploy/tests/test_host_baseline.sh'` -- expected: suite passes (exit 0).

## Auto Run Result

Status: done

**Change:** Quoted the two malformed CIDR test values so ShellCheck SC2258 is gone, and fixed the SC2094 that the same CI lint step would hit in `deploy/cloudflare-ips-check.sh` (from e6c33f6, not yet linted by CI).

**Files changed:**
- `deploy/tests/test_host_baseline.sh` — line 171 loop values quoted; same two inputs, same refusal assertions.
- `deploy/cloudflare-ips-check.sh` — the local ranges file is read through fd 3 in the subshell instead of `<"$file"`, which removes the SC2094 false positive without a disable directive.

**Review:** 9 findings, 8 low patched (one root cause: the first SC2094 fix buffered the file; replaced by the streaming fd form), 1 false rejected (intent-alignment scope note; the hunk serves the stated CI goal). Nothing deferred. Patched counts: high 0, medium 0, low 8. Follow-up review recommended: false. The review patch was applied by the parent because the implementation subagent could only be resumed asynchronously.

**Verification:**
- ShellCheck 0.11.0 (`koalaman/shellcheck-alpine:v0.11.0`) on `deploy/*.sh deploy/tests/*.sh`: exit 0, no output.
- `ubuntu:24.04`: `deploy/tests/test_host_baseline.sh` exit 0 (both comma refusals ran), `deploy/tests/test_cloudflare_ips_check.sh` exit 0.
- Manual: a FIFO that sends `<html>` and stays open makes `cloudflare-ips-check.sh` exit 2 at once with the CIDR error.

**Residual risk:** none known; CI has not yet run on these commits.

