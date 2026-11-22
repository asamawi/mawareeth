---
title: 'Execute bootstrap-host.sh guest input validation in the host baseline test'
type: 'chore'
created: '2026-11-20'
status: 'done'
baseline_revision: '5690e648913e92a6493b558bd95f327476b6496d'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred:
  - summary: >-
      Bootstrap's ADMIN_PUBLIC_KEY check accepts a recognized key type followed by whitespace with an empty or malformed payload.
    evidence: |-
      The regex at deploy/bootstrap-host.sh validate_admin checks only the type prefix and a whitespace character (pre-existing, kept unchanged by this spec). provision-host.sh derives the key with ssh-keygen -y, so the normal path sends a parseable key; a direct guest run could install an unusable key.
    location: >-
      deploy/bootstrap-host.sh:29-34
    severity: low
  - summary: >-
      Bootstrap's validate_cidrs accepts a trailing comma (bash read -a drops the trailing empty field) and silently truncates a value with an embedded newline, while an interior empty entry is refused.
    evidence: |-
      Pre-existing behavior; the new test pins the trailing-comma acceptance with a comment. Changing it is a behavior change to bootstrap, outside this test-only spec.
    location: >-
      deploy/bootstrap-host.sh:11-17
    severity: low
  - summary: >-
      No test enters bootstrap-host.sh itself to prove a bad guest input is refused before the first host change; the suite checks call lines and order and runs the extracted validators directly.
    evidence: |-
      A validator call moved into a branch that never runs would keep the same line count and order. Covering it needs a sandboxed entry-point run with stubbed EUID, /etc/os-release, apt-get and a mutation log. The same gap applies to the existing public-web step checks.
    location: >-
      deploy/tests/test_host_baseline.sh:142-147
    severity: low
---

<intent-contract>

## Intent

**Problem:** Deferred-work item (Deploy & host, from spec-0-4): `deploy/tests/test_host_baseline.sh` never runs `bootstrap-host.sh`'s guest input validation: `validate_cidrs` (`SSH_ALLOWED_CIDRS`) and the inline `ADMIN_USER` / `ADMIN_PUBLIC_KEY` checks. A regression in them (a broken regex, a loosened prefix floor) would pass CI and only show on a real host. The item's second half (exercising provision's admin/sudo path) is already covered by the `SSH_ADMIN_OK=1` case (test ~488-500), so only the bootstrap half is open.

**Approach:** In `bootstrap-host.sh`, put `validate_cidrs` and a new `validate_admin` function (holding today's two admin checks unchanged) in a marked block `# >>> guest inputs` / `# <<< guest inputs`, and call `validate_admin` where the inline checks are now. The test extracts that block the same way it extracts `# >>> public web sources`, and runs accepted and refused inputs in child shells.

## Boundaries & Constraints

**Always:** Bootstrap's behavior is unchanged: same checks, same regexes, same `die` messages, same order (`validate_cidrs`, `validate_web_sources`, then the admin checks), all before any host change. The test runs each case in a fresh `bash -c` child with explicit env, asserts exit 0 for accepted input and non-zero plus the exact diagnostic substring for refused input. Touch no host state (works unprivileged and as root in CI). Reuse the suite's `fail`, `$tmp` and the extraction pattern; ShellCheck-clean.

**Never:** No change to `provision-host.sh`, to the root/OS/secret-file preflight, or to any message text. No main-guard refactor of bootstrap. No new test file; no change to CI wiring.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| CIDRs accepted | `SSH_ALLOWED_CIDRS=203.0.113.0/24`; `198.51.100.7/32,2001:db8::/48`; `10.0.0.0/8`; `2001:db8::/32`; host bits set `203.0.113.5/24` (strict=False) | `validate_cidrs` exits 0 | none |
| CIDRs refused | unset/empty → `SSH_ALLOWED_CIDRS is required`; `203.0.113.0/24,,198.51.100.0/24` and trailing `203.0.113.0/24,` → `contains an empty CIDR` (if bash `read -a` drops a trailing empty field, assert whatever the script really does and record it); `not-a-cidr`, `10.0.0.0/7`, `0.0.0.0/0`, `2001:db8::/31`, `::/0` → `invalid or excessively broad CIDR` | exit non-zero, stderr has `bootstrap: <message>` | assert substring |
| Admin accepted | `ADMIN_USER` in `deploy`, `_svc`, `a-b_1`, 32-char name; `ADMIN_PUBLIC_KEY` = the suite's ed25519 line, an `ecdsa-sha2-nistp256 AAAA… c` line, an `sk-ssh-ed25519@openssh.com AAAA… c` line | `validate_admin` exits 0 | none |
| Admin refused | user empty, `Deploy`, `1deploy`, 33-char name, `de ploy` → `ADMIN_USER is required and must be valid`; key empty, `ssh-ed25519` with no whitespace after, a bare `AAAAC3Nza… c` with no type, `rsa AAAA… c` → `ADMIN_PUBLIC_KEY is required and must be a valid OpenSSH public key` | exit non-zero with the message | assert substring |

</intent-contract>

## Code Map

- `deploy/bootstrap-host.sh:10-26` -- `validate_cidrs` (python3 `ip_network(strict=False)`, floors /8 IPv4, /32 IPv6). Move inside the new marked block (it can stay at the top of the file; the block just wraps it).
- `deploy/bootstrap-host.sh:270-275` -- call order `validate_cidrs`, `validate_web_sources`, then inline `ADMIN_USER=…`, `ADMIN_PUBLIC_KEY=…` defaults and the two regex `die` checks. Line 272 has a trailing space after `"${ADMIN_USER:-}"`; drop it when moving. Replace these four lines with a single `validate_admin` call. Globals `ADMIN_USER`/`ADMIN_PUBLIC_KEY` are used later in the script (sudoers, home lookup ~339), so the function must assign them globally (no `local`).
- `deploy/bootstrap-host.sh:28,260` -- existing `# >>> public web sources` / `# <<< public web sources` markers: the pattern to copy. `die` is defined at line 7 outside the block; the test prepends its own `die`.
- `deploy/tests/test_host_baseline.sh:1-9` -- `fail`, `need`, `bootstrap` path. `:102-104` -- `$tmp`, EXIT trap, `$tmp/id.pub` (ed25519 line usable as an accepted key). `:118-123` -- web block extraction (`printf` die + `sed -n` range) and `grep -q` sanity check: reuse for `$tmp/guest-inputs.sh`. `:131-133` -- "called exactly once" check loop (`grep -cx`): extend with `validate_cidrs` and `validate_admin`. `:134` -- `line_of`: use it to assert `validate_admin` comes after `validate_web_sources` and before `apt-get update`. `:169-175` -- `web_refuses` helper: model `guest_refuses`/`guest_accepts` on it.
- `.github/workflows/django.yml:225-250` -- CI runs ShellCheck on `deploy/*.sh deploy/tests/*.sh` and every `deploy/tests/test_*.sh` unprivileged and as root; no change.
- `_bmad-output/implementation-artifacts/deferred-work.md:21-23` -- the item; remove it once done (completed items are removed).

## Tasks & Acceptance

**Execution:**
- `deploy/bootstrap-host.sh` -- wrap `validate_cidrs` and a new `validate_admin` (today's lines 272-275 verbatim, minus the trailing space) in `# >>> guest inputs (deploy/tests/test_host_baseline.sh extracts this block)` / `# <<< guest inputs`; replace the inline checks with `validate_admin` at the same position -- makes the checks runnable offline with no behavior change.
- `deploy/tests/test_host_baseline.sh` -- after the web-block extraction section, extract the guest-inputs block, assert both functions exist in it and are each called exactly once in bootstrap in the order `validate_cidrs` < `validate_web_sources` < `validate_admin` < `apt-get update`, then run every I/O-matrix row with accept/refuse helpers; print `bootstrap guest input checks passed` -- the coverage the item asks for.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- delete the lines 21-23 entry -- it is done; the admin/sudo half was already covered.

**Acceptance Criteria:**
- Given the edited bootstrap, when `bash -n` and ShellCheck run, then both pass, and `git diff` of bootstrap shows only the block markers, the `validate_admin` wrapper and its call (no regex or message change).
- Given the suite, when any accepted-row value is refused or any refused-row value is accepted (e.g. the IPv4 floor changed to /7), then `test_host_baseline.sh` exits 1 with a `FAIL:` line naming the input.
- Given the suite run unprivileged on Linux, when it finishes, then it exits 0 and touches nothing outside `$tmp`.

## Spec Change Log

## Review Triage Log

### 2026-11-20 — Review pass
- verdicts: 16 findings — high 0, medium 2, low 11, false 2, maybe-false 1
- findings:
  - `[low]` `[reject]` blind: call count/order checks are literal lines; a validator in a dead branch passes — grouped with edge #6 and verification-gap #1; recorded as a deferred item (entry-point run needs EUID/os-release/apt stubs, more than a direct fix).
  - `[medium]` `[patch]` blind: a missing closing marker makes sed copy the rest of bootstrap, which as root in CI would run host changes when sourced — added an exactly-one-ordered-marker-pair check before sourcing; deleting the closing marker now fails the suite.
  - `[low]` `[defer]` blind: a recognized key type with an empty/malformed payload is accepted — pre-existing regex, kept unchanged by the spec; deferred.
  - `[low]` `[patch]` blind: broad CIDRs are only tested as single entries — added `203.0.113.0/24,10.0.0.0/7` and `203.0.113.0/24,2001:db8::/31` refusals.
  - `[low]` `[patch]` blind: no positive fixture for the `sk-ecdsa-sha2-…@openssh.com` branch — added one.
  - `[false]` `[reject]` blind: the substitute `die` and merged streams hide a diagnostic-stream change — the test's `die` is byte-identical to bootstrap's line 7, which is outside the block and unchanged; the stream is fixed by that definition.
  - `[low]` `[defer]` edge: key type with no payload accepted — same as the blind key finding; deferred.
  - `[low]` `[defer]` edge: an embedded newline truncates SSH_ALLOWED_CIDRS — pre-existing; provision sends `%q`-quoted values from a validated config; deferred with the trailing-comma item.
  - `[low]` `[defer]` edge: trailing comma bypasses the empty-entry check — pre-existing behavior the test now pins with a comment; changing bootstrap behavior is outside this test-only change; deferred.
  - `[medium]` `[patch]` edge: missing closing marker sources the rest of bootstrap — same root cause as the blind marker finding; same patch.
  - `[false]` `[reject]` edge: prefix and text on separate lines/streams could satisfy the assertion — the pattern `*"bootstrap: "*"$want"*` over a child that only prints via the single-line `die`; no path prints the prefix and message separately.
  - `[low]` `[reject]` edge: skipped validator keeps count and order — same group as the blind call-order finding; deferred as one item.
  - `[low]` `[defer]` verification-gap: bootstrap entry point can skip `validate_admin` while the suite passes — real but pre-existing gap shared with the web-step checks; the fix is a new sandboxed entry-point harness; deferred.
  - `[low]` `[patch]` verification-gap: accepted-key tests do not prove the full key survives `validate_admin` — added a child that prints `ADMIN_USER|ADMIN_PUBLIC_KEY` after validation and compares it to the input.
  - `[low]` `[patch]` verification-gap: CIDR prefix check applied only to the first entry would pass — same as the blind multi-entry finding; same patch.
  - `[maybe-false]` `[reject]` intent-alignment: the integration reading (entry point; SSH→sudo→guest chain) differs from the surfaces tested — descriptive; the entry-point part is deferred above, and a real SSH/sudo chain needs a live host, which an offline suite cannot be; would only be low.
- cross-story-contract reported "No contract shape changed" (no findings).

## Design Notes

Test children run as `bash -c 'set -Eeuo pipefail; source "$1"; validate_cidrs' _ "$guest_lib"` with the variable set or `unset` in the environment, mirroring `web_refuses`. `validate_cidrs` needs `python3` on PATH, as the web block already does.

## Verification

**Commands:**
- `bash deploy/tests/test_host_baseline.sh` (Git Bash; if `python3` is only the WindowsApps alias, prepend a temp dir with a `python3` shim calling `python`) -- expected: exit 0 with `bootstrap guest input checks passed`. CI on Linux is authoritative if Git Bash fails on unrelated pre-existing sections; record that.
- `bash -n deploy/bootstrap-host.sh deploy/tests/test_host_baseline.sh` -- expected: exit 0.
- Mutation check: temporarily change `min_prefix = 8` to `7` in bootstrap, rerun the suite, expect a FAIL, then revert.

## Auto Run Result

Status: done

**Summary:** `bootstrap-host.sh`'s guest input checks (`validate_cidrs` and the admin user/key checks, now `validate_admin`) sit in a marked `guest inputs` block that `test_host_baseline.sh` extracts and runs in child shells over every I/O-matrix row. Bootstrap behavior is unchanged (same regexes, messages and order). The item's admin/sudo provisioning half was already covered by the existing `SSH_ADMIN_OK=1` case, so it needed no change.

**Files changed:**
- `deploy/bootstrap-host.sh` -- `guest inputs` markers, `validate_admin` wrapper, one call where the inline checks were.
- `deploy/tests/test_host_baseline.sh` -- call count/order checks, marker-pair guard, accept/refuse cases for CIDRs and admin user/key, value-preservation check.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- removed the completed item; added the three deferred review items.

**Review:** one combined codex pass (blind-hunter, edge-case-hunter, verification-gap, intent-alignment, cross-story-contract). 16 findings: 4 patch entries applied by the parent (marker-pair guard, multi-entry broad CIDR refusals, `sk-ecdsa` positive fixture, admin values preserved); 3 items deferred (key payload not parsed, trailing comma/newline in CIDRs, no entry-point preflight test); 2 rejected as false (die stream, split diagnostic), 1 maybe-false descriptive intent note rejected; remaining low duplicates grouped with those routes. Patched counts by entry verdict: medium 1, low 3. Follow-up review: false (no high patched, one medium entry).

**Verification:** `bash -n` on both scripts passes. Under Git Bash (with a `python3` -> `python` shim) the suite prints `bootstrap guest input checks passed`, then stops at `FAIL: a writable persisted mode file was accepted`, which fails identically at the baseline commit (Windows file modes; pre-existing). Mutations caught: IPv4 floor /8 -> /7, user length {0,31} -> {0,32}, deleted closing marker. ShellCheck is not installed locally; CI runs it and the suite on Linux (unprivileged and as root).

**Residual risks:** ShellCheck and the Linux run happen only in CI. The three deferred items above.
