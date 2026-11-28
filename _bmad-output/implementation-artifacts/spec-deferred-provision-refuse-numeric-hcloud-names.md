---
title: 'Refuse all-digit Hetzner resource names in provision-host.sh'
type: 'chore'
created: '2026-11-22'
status: 'done'
baseline_revision: '9b6a7eec0697c7d0eb233d6e5ae0c525ef4c365b'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** `deploy/provision-host.sh` accepts all-digit `SERVER_NAME`, `HETZNER_SSH_KEY_NAME` and `FIREWALL_NAME` values. The lookups validate each resource by exact `.name`, but the later `hcloud` calls (`firewall describe`, `set-rules`, `server enable-protection`, `server describe`, `apply-to-resource`, `server ip`, `server create --ssh-key/--firewall`) pass the name, and hcloud resolves a numeric argument as an ID first, so they could act on a different resource than the one validated. (Deferred item from `spec-deferred-provision-host-api-hardening.md`.)

**Approach:** Refuse an all-digit value for each of the three names at config validation, with a fixed `die` message, before any provider or transport call. This takes the first option the deferred item names; carrying IDs through later calls is not needed once names can never be read as IDs.

## Boundaries & Constraints

**Always:** Each refusal names its key (`SERVER_NAME`, `HETZNER_SSH_KEY_NAME`, `FIREWALL_NAME`) and happens before any `hcloud`, `curl`, `ssh` or `scp` call. Names containing at least one non-digit keep passing exactly as today (the existing character-set and length regexes are unchanged). Refusals never print `HETZNER_TOKEN`.

**Never:** Do not change the hcloud calls, lookups, firewall payload, server shape or `bootstrap-host.sh`. Do not rewrite later calls to use IDs. Do not change existing refusal messages for other keys.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Normal names | `SERVER_NAME=baseline-test`, key `baseline-test-key`, firewall default | Provisioning runs as today | No error expected |
| Digits with a letter or dash | `SERVER_NAME=web1`, `HETZNER_SSH_KEY_NAME=2026-key`, `FIREWALL_NAME=1-edge` | Accepted | No error expected |
| All-digit server | `SERVER_NAME=12345` | Refused | `die` naming `SERVER_NAME`; no provider call |
| All-digit SSH key | `HETZNER_SSH_KEY_NAME=42` | Refused | `die` naming `HETZNER_SSH_KEY_NAME`; no provider call |
| All-digit firewall | `FIREWALL_NAME=7` | Refused | `die` naming `FIREWALL_NAME`; no provider call |
| Default firewall | `FIREWALL_NAME` unset, `SERVER_NAME` valid | Default `${SERVER_NAME}-edge` always contains `-edge`, so accepted | No error expected |

</intent-contract>

## Code Map

- `deploy/provision-host.sh:127` -- `SERVER_NAME` regex check `^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$`, `die 'SERVER_NAME is invalid'`.
- `deploy/provision-host.sh:128` -- `HETZNER_SSH_KEY_NAME` regex check, `die 'HETZNER_SSH_KEY_NAME is invalid'`.
- `deploy/provision-host.sh:139-140` -- `FIREWALL_NAME` default and regex check; runs after the `require_command` checks but before the first hcloud call (`lookup_by_name` at line 187).
- `deploy/provision-host.sh:187-292` -- read-only evidence: later hcloud calls pass names (`firewall describe "$FIREWALL_NAME"`, `server enable-protection "$SERVER_NAME"`, `--ssh-key "$HETZNER_SSH_KEY_NAME"`, etc.).
- `deploy/tests/test_host_baseline.sh:789-800` -- `valid-config` fixture and `provision_with` helper (stubbed hcloud/ssh/scp on PATH).
- `deploy/tests/test_host_baseline.sh:853-868` -- `provision_refuses expected-name config` helper: asserts non-zero exit, message contains the name, no token, and no `hcloud|curl|ssh|scp` line in the log. Reuse it; build bad configs with `sed '/^KEY=/d'` + `printf` and `chmod 600` like the CIDR loop.
- `deploy/host-baseline.env.example:4-13` -- config template; add a short comment that names must not be all digits.

## Tasks & Acceptance

**Execution:**
- `deploy/provision-host.sh` -- after each of the three existing regex checks, add a refusal for an all-digit value (e.g. `[[ ! "$SERVER_NAME" =~ ^[0-9]+$ ]] || die 'SERVER_NAME must not be all digits (hcloud reads a number as an ID)'`), with a one-line comment giving the reason once -- names hcloud could read as IDs must never reach a later call.
- `deploy/tests/test_host_baseline.sh` -- next to the CIDR refusal loop, add `provision_refuses` cases for `SERVER_NAME=12345`, `HETZNER_SSH_KEY_NAME=42` and `FIREWALL_NAME=7`, and one `provision_with` run that accepts `SERVER_NAME=web1`, `HETZNER_SSH_KEY_NAME=2026-key`, `FIREWALL_NAME=1-edge` -- covers the matrix.
- `deploy/host-baseline.env.example` -- add a comment above the names: they must not be all digits.

**Acceptance Criteria:**
- Given a host-baseline config with an all-digit `SERVER_NAME`, `HETZNER_SSH_KEY_NAME` or `FIREWALL_NAME`, when `provision-host.sh` runs, then it exits non-zero with a message naming that key and the stub log shows no `hcloud`, `curl`, `ssh` or `scp` call.
- Given the existing valid config, when `test_host_baseline.sh` runs, then every existing provisioning check still passes.

## Spec Change Log

## Review Triage Log

### 2026-11-22 — Review pass
- verdicts: 7 findings — high 0, medium 0, low 4, false 3, maybe-false 0
- findings:
  - `[low]` `[patch]` blind-hunter: the all-digit refusal cases pass `provision_refuses` only the key name, so a generic "<KEY> is invalid" refusal would also satisfy them — patched: the loop now requires "<KEY> must not be all digits".
  - `[low]` `[patch]` blind-hunter: the mixed-name run discards its status and accepts any `hcloud` log line — patched (grouped with the next two rows): the run now requires `hcloud ssh-key create --name 2026-key` and `hcloud firewall create --name 1-edge`, so a regression to default names fails. A full successful run is not possible because the stub only knows `baseline-test` names; it was not extended.
  - `[low]` `[patch]` edge-case-hunter: the all-digit refusal could pass for an unrelated error naming the same key — same root cause and fix as the first row.
  - `[low]` `[patch]` edge-case-hunter: the mixed-name run can pass while provisioning aborts before server creation — grouped with the second row; patched as described there.
  - `[false]` `[reject]` verification-gap: leading-zero names such as `007` could reach hcloud — refuted: the guard is `^[0-9]+$`, which matches `007`; the claim is about a hypothetical weaker guard, not this code.
  - `[false]` `[reject]` verification-gap: the mixed-name test can pass while a custom firewall name is silently replaced by the default — after the patch above, the test requires `firewall create --name 1-edge`, so that substitution now fails; the remaining ask (stub fixtures for a full run) adds stub branches for no demonstrated defect.
  - `[false]` `[reject]` intent-alignment: descriptive report; the diff implements reading 1 (refuse at config validation), the first option the deferred item names. No defect claimed.

## Verification

**Commands:**
- `bash deploy/tests/test_host_baseline.sh` (Git Bash) -- expected: exits 0 and prints the existing "checks passed" lines.
- `shellcheck deploy/provision-host.sh deploy/tests/test_host_baseline.sh` (if shellcheck is installed) -- expected: no new findings.

**Verification record (2026-11-22):** On Windows Git Bash the suite stops at line 468 (chmod bits not honoured) on both the baseline and the change, and the provisioning section cannot run there (Windows Python lacks `pwd`). So the suite was run in an `ubuntu:24.04` container (python3, openssh-client, jq, shellcheck, gpg): baseline `9b6a7ee` exit 0, change exit 0 with every section passing; shellcheck clean. Mutation check: the new tests against the baseline `provision-host.sh` fail at the `SERVER_NAME` refusal. The parent rewrote the acceptance case because the hcloud stub only knows `baseline-test` names: it now uses its own stub state and asserts no name refusal and that the run reached the `hcloud` lookups.

## Auto Run Result

Status: done

**Summary:** `deploy/provision-host.sh` refuses an all-digit `SERVER_NAME`, `HETZNER_SSH_KEY_NAME` or `FIREWALL_NAME` with a fixed message naming the key, before any hcloud, curl, ssh or scp call, because hcloud resolves a numeric argument as an ID first.

**Files changed:**
- `deploy/provision-host.sh` -- three all-digit refusals after the existing name regexes.
- `deploy/tests/test_host_baseline.sh` -- refusal cases for `12345`, `42`, `7` requiring the all-digit message; a mixed-name run (`web1`, `2026-key`, `1-edge`) with its own stub state that must reach `ssh-key create --name 2026-key` and `firewall create --name 1-edge`.
- `deploy/host-baseline.env.example` -- comment that the three names must not be all digits.

**Review:** one combined codex pass (blind, edge-case, verification-gap, intent-alignment, cross-story-contract). 2 patch entries applied (both low; 4 low rows), 0 deferred, 3 rejected as false (see the triage log). Cross-story contract: no contract shape changed. The patches were two lines in one test file, applied by the parent directly instead of re-engaging a subagent.

**Follow-up review recommended:** false -- only low entries were patched (0 high, 0 medium).

**Verification:** Git Bash on Windows cannot run this suite (it stops at line 468 on baseline and change alike, and the provisioning section needs Python's `pwd`). In an `ubuntu:24.04` container with python3, openssh-client, jq, shellcheck and gpg: `bash deploy/tests/test_host_baseline.sh` exit 0 on baseline `9b6a7ee` and on the final change; `shellcheck deploy/provision-host.sh deploy/tests/test_host_baseline.sh` clean; mutation check (new tests against the baseline `provision-host.sh`) fails at the `SERVER_NAME` refusal as expected.

**Residual risks:** The mixed-name case does not prove a full provisioning run with non-default names, because the hcloud stub hard-codes `baseline-test` names. CI on Linux is the authoritative run.
