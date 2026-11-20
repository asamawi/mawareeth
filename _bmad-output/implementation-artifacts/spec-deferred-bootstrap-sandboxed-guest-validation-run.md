---
title: 'Run bootstrap-host.sh in a sandbox to prove bad guest input is refused before the first host change'
type: 'chore'
created: '2026-11-21'
status: 'done'
baseline_revision: '3dae0ac18e9bff76979fbbf9354dbac1bb6f749a'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      Execute bootstrap's later public-web steps (require_ufw_ipv6, converge_docker_web_rules, allow_public_web, persist_web_sources) through the entry point, not only by call-line checks.
    evidence: |-
      The sandbox stops at the first host change (apt-get update), so these post-mutation steps are still proven only by grep -cx call checks and extracted-helper runs; a call moved into a branch that never runs would still pass. Reaching them needs stand-ins for the shell redirections into /etc, which PATH stubs cannot intercept.
    location: >-
      deploy/tests/test_host_baseline.sh:121
    severity: low
---

<intent-contract>

## Intent

**Problem:** `deploy/tests/test_host_baseline.sh` proves guest input validation only by grepping the validator call lines and their order and by running the extracted validator functions; a call moved into a branch that never runs, or a host change added before the validators, would still pass. The public-web source checks (`validate_web_sources`) have the same gap.

**Approach:** Add a section to the suite that runs `deploy/bootstrap-host.sh` itself (a temp copy with only the root check and the `/etc/os-release` path rewritten) with a PATH of stub executables for every host-mutating command. Each stub appends its name and arguments to a mutation log and exits with a sentinel status, so the run stops at the first host change. Bad inputs must fail with their own `bootstrap:` message and an empty log; valid input must reach exactly `apt-get update` first.

## Boundaries & Constraints

**Always:**
- Change only `deploy/tests/test_host_baseline.sh` (plus the backlog entry). `deploy/bootstrap-host.sh` stays byte-for-byte unchanged: no new env seam, no root-check override.
- The sandbox copy differs from `bootstrap-host.sh` only on the rewritten lines; the test checks that with a line diff (or equivalent count) and fails loudly if a rewrite target is missing or matches more than intended, so drift in bootstrap breaks the test instead of silently skipping the sandbox.
- Each sandbox run uses a clean environment (`env -i` with an explicit PATH = stub dir first, then the real PATH, and only the variables the case sets), `MAWAREETH_PUBLIC_WEB_STATE` and `MAWAREETH_UFW_DEFAULTS` pointing into the test temp dir, and a fake os-release file in the temp dir (`ID=ubuntu`, `VERSION_ID=24.04`, `VERSION_CODENAME=noble` unless the case says otherwise).
- Every refusal case is the valid input with exactly one value changed, so a root, OS or missing-command failure cannot pass as a validation refusal.
- Stubs exist for: apt-get, install, curl, gpg, chmod, chown, dpkg, systemctl, useradd, visudo, sshd, ufw, iptables, ip6tables, mv. Each one logs `<name> <args>` to the case's log and exits with one sentinel status (e.g. 97). `python3` and `stat` stay real.
- Must pass both unprivileged and as root (CI runs every suite both ways), and pass ShellCheck 0.11.0 with no new findings.
- Reuse the suite's existing `fail`, `$tmp` and `trap` helpers; print one `... checks passed` line at the end of the new section, following the suite's style.

**Never:**
- No edits to `bootstrap-host.sh`, `provision-host.sh`, CI workflow, or other suites.
- Do not remove the existing call-line/order checks or extracted-validator cases.
- Do not run any case that could pass the sentinel stop (the valid case must stop at the `apt-get update` stub).
- No Docker, network, or `unshare`/fakeroot dependency in the suite.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid input | good CIDRs, no PUBLIC_WEB_SOURCES, `ADMIN_USER=deploy`, a well-formed key (reuse the suite's `sample_key`/good key) | exit status = sentinel; log is exactly one line `apt-get update` | Fail naming the status and log |
| Missing CIDRs | SSH_ALLOWED_CIDRS unset | exit 1, stderr has `bootstrap: SSH_ALLOWED_CIDRS is required`, log empty or absent | Fail naming case, status, stderr, log |
| Trailing comma CIDR | `203.0.113.0/24,` | exit 1, `contains an empty CIDR`, log empty | same |
| Broad CIDR | `0.0.0.0/0` | exit 1, `invalid or excessively broad CIDR`, log empty | same |
| Bad web mode | `PUBLIC_WEB_SOURCES=bogus` | exit 1, `PUBLIC_WEB_SOURCES must be any or cloudflare`, log empty | same |
| Cloudflare without ranges | `PUBLIC_WEB_SOURCES=cloudflare`, no ranges | exit 1, message naming `PUBLIC_WEB_RANGES`, log empty | same |
| Bad admin user | `ADMIN_USER=Root` | exit 1, `ADMIN_USER is required and must be valid`, log empty | same |
| Bad admin key | `ADMIN_PUBLIC_KEY='ssh-ed25519 AAAA'` (truncated) | exit 1, `ADMIN_PUBLIC_KEY is required and must be a valid OpenSSH public key`, log empty | same |
| Wrong OS | otherwise valid input, fake os-release `ID=debian` | exit 1, `Ubuntu 24.04 is required`, log empty | same |

</intent-contract>

## Code Map

- `deploy/bootstrap-host.sh:298` -- `[[ ${EUID:-999} -eq 0 ]] || die 'must run as root'`: the one line rewritten to a no-op in the sandbox copy (EUID is read-only in bash; Git Bash and the unprivileged CI pass are not root).
- `deploy/bootstrap-host.sh:299,301` -- `/etc/os-release` read for the Ubuntu 24.04 gate; line 327 reads it again after the first mutation. Rewrite all occurrences to the fake file; none may remain in the copy.
- `deploy/bootstrap-host.sh:303-313` -- `require_command apt-get|python3|stat` (uses `command -v`, so the apt-get stub satisfies it), then `validate_cidrs`, `validate_web_sources`, `validate_admin`, read-only `stat` checks on `/etc/mawareeth` (absent on test hosts).
- `deploy/bootstrap-host.sh:317` -- `apt-get update`: the first host change; the sentinel stops the run here (`set -Eeuo pipefail`).
- `deploy/bootstrap-host.sh:70-71` -- existing test-only path overrides `MAWAREETH_PUBLIC_WEB_STATE`, `MAWAREETH_UFW_DEFAULTS`.
- `deploy/bootstrap-host.sh:7` -- `die` prints `bootstrap: <msg>` to stderr and exits 1.
- `deploy/tests/test_host_baseline.sh:8,102-103` -- `fail`, `$tmp` and its cleanup trap.
- `deploy/tests/test_host_baseline.sh:129-217` -- guest input section: call-line/order checks, `guest_accepts`/`guest_refuses`, `sample_key`, `good_key`; ends with `printf 'bootstrap guest input checks passed'` at line 217. Insert the new section right after it.
- `.github/workflows/django.yml:226-247` -- ShellCheck 0.11.0 over `deploy/tests/*.sh`, then every suite unprivileged and as root (`sudo env PATH=$PATH bash suite`).

## Tasks & Acceptance

**Execution:**
- `deploy/tests/test_host_baseline.sh` -- add the sandboxed bootstrap run section after the guest input checks: build the stub dir and the rewritten copy with its diff check, a helper that runs one case with a clean env and captures status, stderr and log, then the cases in the I/O matrix -- turns the validator order from a text check into an executed proof.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- remove the "sandboxed run of `bootstrap-host.sh` itself" entry under Deploy & host -- resolved.

**Acceptance Criteria:**
- Given the suite, when it runs unprivileged and as root on Ubuntu 24.04, then it exits 0 and prints the new section's pass line.
- Given `validate_admin` moved after `apt-get update` in a scratch copy of bootstrap (mutation check, not committed), when the suite runs, then it fails naming the bad-admin case and the logged `apt-get update`.
- Given the root-check line changed in bootstrap, when the suite runs, then the sandbox build fails loudly instead of running unrewritten.
- Given ShellCheck 0.11.0, when it checks `deploy/tests/test_host_baseline.sh`, then it reports nothing.

## Spec Change Log

## Review Triage Log

### 2026-11-21 — Review pass
- verdicts: 17 findings — high 0, medium 0, low 14, false 3, maybe-false 0
- findings:
  - `[low]` `[reject]` blind: empty stub log is not proof against a shell redirection writing a file before validation — real limit of PATH stubs; no such write exists today and detecting it needs a filesystem sandbox (container/namespace), which the suite cannot assume on CI or Git Bash.
  - `[low]` `[patch]` blind: fake os-release path inserted unquoted into the copied script — now substituted shell-quoted (printf %q).
  - `[low]` `[patch]` blind: no valid Cloudflare case through the entry point — added an sbx_accepts case with `PUBLIC_WEB_SOURCES=cloudflare` and `$cf_csv`.
  - `[low]` `[patch]` blind: VERSION_ID never varied, so dropping the version check would pass — fake os-release version is now per case; added an Ubuntu 22.04 refusal.
  - `[false]` `[reject]` blind: the spec AC's move-validate_admin mutation is caught by the older order check first — true of that mutation, but the fix is editing this build's spec; the implementer verified the sandbox with a never-run-branch mutation instead (fails 'bad admin user' with log 'apt-get update').
  - `[low]` `[patch]` edge: unquoted fake os-release path (same root cause as the blind row) — fixed by the same quoting patch.
  - `[low]` `[patch]` edge: `osrel_lines="$(grep -c …)"` exits silently under set -e on zero matches — now falls through to the explicit fail message.
  - `[low]` `[reject]` edge: a test host with /etc/mawareeth in an unexpected mode fails the valid case — CI runners and dev machines have no /etc/mawareeth; the suite is never run on the production host; the fix needs extra rewrites.
  - `[low]` `[reject]` edge: the stderr match could span lines — die exits at its first call, so only one `bootstrap:` line can be printed, and the exit status must also be 1; unlikely, and a stricter matcher adds complexity.
  - `[low]` `[patch]` edge: `rm` missing from the stub list (persist_web_sources calls it) — added.
  - `[false]` `[reject]` edge: the spec's mutation check never reaches the sandbox (same as the blind row) — fix is a spec edit; the sandbox was verified with a different mutation.
  - `[low]` `[reject]` verification-gap: shell writes before validation are not observed (same as the first blind row) — same reason.
  - `[low]` `[patch]` verification-gap: no valid Cloudflare entry-point case (same as the blind row) — same patch.
  - `[low]` `[patch]` verification-gap: OS refusal varies only the distro ID (same as the blind row) — same patch.
  - `[low]` `[patch]` verification-gap other: unquoted os-release path (same as above) — same patch.
  - `[false]` `[reject]` verification-gap other: order check intercepts the spec's mutation (same as the blind row) — spec-edit fix.
  - `[low]` `[defer]` intent-alignment: the backlog evidence says the later public-web steps have the same gap; the sandbox stops before them — pre-existing, needs redirection stand-ins; recorded in frontmatter `deferred` and in deferred-work.md.
  - cross-story-contract: no contract shape changed (no finding).

## Design Notes

Stopping at the first stub (sentinel exit under `set -e`) is what keeps the root pass safe: nothing after `apt-get update` runs, including the bash redirections into `/etc` that a PATH stub cannot intercept. Build the copy with exact-string replacement and verify it, e.g.:

```bash
sandbox="$tmp/bootstrap-sandbox"; mkdir -p "$sandbox/bin"
root_check="[[ \${EUID:-999} -eq 0 ]] || die 'must run as root'"
[[ "$(grep -cxF -- "$root_check" "$bootstrap")" == 1 ]] || fail 'bootstrap root check not found exactly once'
# ...replace that line with ':' and /etc/os-release with "$sandbox/os-release"; then
# require: no /etc/os-release left, and diff reports only the expected changed lines.
```

## Verification

**Commands:**
- `docker run --rm -v "c:/mawareeth:/src:ro" ubuntu:24.04 bash -c 'apt-get update -qq && apt-get install -y -qq python3 jq openssh-client iptables >/dev/null && useradd -m t && cp -r /src /w && chown -R t /w && su t -c "bash /w/deploy/tests/test_host_baseline.sh" && bash /w/deploy/tests/test_host_baseline.sh'` -- expected: both runs exit 0 with the new pass line (the suite fails on Git Bash at pre-existing chmod/ownership checks, so Linux is the reference).
- `docker run --rm -v "c:/mawareeth:/mnt:ro" koalaman/shellcheck:v0.11.0 /mnt/deploy/tests/test_host_baseline.sh` -- expected: no findings.

## Auto Run Result

Status: done

**Summary:** `deploy/tests/test_host_baseline.sh` now runs `bootstrap-host.sh` itself. A temp copy differs only in the root check (made a no-op) and the `/etc/os-release` path (pointed at a per-case fake file); the suite checks that with a line diff. Stubs for every host-mutating command (apt-get, install, curl, gpg, chmod, chown, dpkg, systemctl, useradd, visudo, sshd, ufw, iptables, ip6tables, mv, rm) log the call and exit 97, so a run stops at the first host change. Valid input, with and without Cloudflare ranges, must stop at exactly `apt-get update`. Nine refusals (missing, trailing-comma or over-broad CIDRs; bad web mode; Cloudflare without ranges; bad admin user or key; Debian; Ubuntu 22.04) must exit 1 with their own `bootstrap:` message and an empty log.

**Files changed:**
- `deploy/tests/test_host_baseline.sh` -- new sandboxed-run section after the guest input checks.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- resolved entry removed; narrower follow-up added (later public-web steps still checked only by call lines).

**Review:** 17 findings (one combined codex call; all five layers). 5 patch groups (all low; applied by codex): shell-quoted fake os-release path, grep -c zero-match fall-through, `rm` stub, valid Cloudflare case, Ubuntu-version refusal. 1 deferred (low: later public-web steps). Rejected: shell redirections not observed by PATH stubs (needs a filesystem sandbox, none exists before validation today), host `/etc/mawareeth` state (never present where the suite runs), multi-line stderr match (die exits on first call), and three false rows saying the spec's move-validate_admin mutation is caught by the older order check first (the fix would be a spec edit). Patched counts: high 0, medium 0, low 5. Follow-up review: false.

**Verification:**
- Ubuntu 24.04 container (python3, jq, openssh-client, iptables): the suite exits 0 with "bootstrap sandboxed run checks passed", both unprivileged and as root, before and after the review patches.
- ShellCheck 0.11.0 (koalaman/shellcheck:v0.11.0): no findings.
- Mutation checks (implementer): wrapping `validate_admin` in a never-run branch fails "sandbox case 'bad admin user' ... log 'apt-get update'"; changing the root-check line fails "bootstrap root check not found exactly once".
- TMPDIR with a space: the sandbox section passes; the suite then exits 127 in the provisioning-config section, identically on baseline 3dae0ac (pre-existing).
- Git Bash not run: the suite already fails there at pre-existing chmod/ownership checks.

**Residual risk:** PATH stubs cannot see shell redirections, so a future write placed before validation would not be caught; the root-pass safety relies on the run stopping at the first stub.
