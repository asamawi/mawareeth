---
title: 'Harden provision-host.sh Hetzner lookups, shared-firewall detection and SSH key checks'
type: 'chore'
created: '2026-11-22'
status: 'done'
baseline_revision: '87657f4196fb69c1ec6af8649d861bd405ea54c3'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: ['multiple-goals', 'oversized']
deferred:
  - summary: >-
      All-digit SERVER_NAME, HETZNER_SSH_KEY_NAME or FIREWALL_NAME values pass the name regexes but are passed to hcloud commands that resolve a numeric argument as an ID first, so a later describe, set_rules, protection or --ssh-key could act on a different resource than the one validated by name.
    evidence: |-
      Pre-existing: provision-host.sh passed names to hcloud before this change too. The fix is to forbid all-digit names in the regexes, or to carry the validated IDs into later calls. Raised by the blind and edge-case review layers on 2026-11-22.
    location: >-
      deploy/provision-host.sh name regexes (SERVER_NAME, HETZNER_SSH_KEY_NAME, FIREWALL_NAME)
    severity: medium
---

<intent-contract>

## Intent

**Problem:** `deploy/provision-host.sh` treats any failed `hcloud <resource> describe` (auth, network, rate limit) as "not found" and goes on to create a server, SSH key or firewall. It also misses a firewall attached through a label selector, does not check the SSH key files' permission bits, and `ssh-keygen -y` waits at a passphrase prompt when the admin private key is encrypted. (Deferred item from `spec-0-4-create-secured-hetzner-host-baseline.md`.)

**Approach:** Before the first provider change, look up the server, SSH key and firewall with `hcloud <resource> list -o json`. Match each by exact `.name` with jq. Any lookup error stops the run. A firewall with any `label_selector` attachment counts as shared. Before calling ssh-keygen, refuse key files with loose permissions. Call `ssh-keygen -y -P ''` so that an encrypted key gets its own clear refusal instead of a prompt.

## Boundaries & Constraints

**Always:** All refusals happen with `die` before any provider change (`create`, `set_rules`, `enable-protection`, `apply-to-resource`), except the shared check after the final refresh (see the matrix). Existing refusal messages stay the same. When the lookups succeed, the happy path and repeat runs call the same hcloud changes as before. Every new refusal is a fixed `die` message, and none of them prints `HETZNER_TOKEN`.

**Never:** Do not parse hcloud stderr wording to tell absence from failure. Do not change `bootstrap-host.sh`, `ci-deploy.sh`, the firewall rule payload or the server shape (cx33, nbg1, ubuntu-24.04). Do not add dependencies beyond what the script already needs (bash, python3, jq, hcloud, curl, ssh, ssh-keygen). Do not auto-detach selectors or fix permissions with chmod.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Lookup absent | `hcloud <res> list -o json` exits 0 with `[]` (or `null`) and has no entry whose `.name` matches | Treated as absent, so the script creates the resource as it does today | ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â |
| Lookup present | Exactly one entry matches `.name` | Treated as present. Its JSON is used for the existing checks (the server shape and label, the key body, the firewall `applied_to`). | ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â |
| Lookup failure | `list` exits non-zero (for example `unauthorized` on stderr), or its output is not a JSON array | `die 'could not look up Hetzner <server\|SSH key\|firewall> "<name>"; check HETZNER_TOKEN and connectivity'` with no provider change | stop |
| Ambiguous | More than one entry matches `.name` | `die` saying the name is ambiguous and needs an operator decision | stop |
| Selector firewall, existing server | Firewall `applied_to` has an entry with `.type == "label_selector"`, even if it targets only this host | `die 'configured firewall is shared with another server; operator decision required'` before `set_rules` | stop |
| Selector firewall, new server | Same, with no server yet | The existing message `configured firewall is already attached to another server; operator decision required` | stop |
| Final refresh shows a selector or another server | Refreshed firewall JSON after `enable-protection` has a selector entry or a server entry with another id | The same shared-firewall `die` instead of `apply-to-resource` | stop |
| Final refresh: empty or exact match | Refreshed `applied_to` is empty, or holds only this server | Empty: `apply-to-resource` as today. Exact match: skip. | ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â |
| Loose private key | `ADMIN_SSH_PRIVATE_KEY` is not a regular file, or `mode & 0o077 != 0` (for example 0644) | `die 'ADMIN_SSH_PRIVATE_KEY must be a regular file not accessible by group or others (chmod 600)'` before ssh-keygen and any hcloud call | stop |
| Writable public key | `SSH_PUBLIC_KEY` is not a regular file, or `mode & 0o022 != 0` | `die 'SSH_PUBLIC_KEY must be a regular file not writable by group or others'` | stop |
| Encrypted key | Passphrase-protected private key with mode 0600 | `die 'ADMIN_SSH_PRIVATE_KEY is passphrase-protected; provisioning needs a key usable without a prompt'`, with no prompt or hang | stop |
| Other bad key | Garbage key file with mode 0600 | The existing `ADMIN_SSH_PRIVATE_KEY is not a usable private key` | stop |

</intent-contract>

## Code Map

- `deploy/provision-host.sh` -- the only script that changes.
  - Lines 13-22: an existing python3 `os.stat` config check. Reuse that style for the mode checks.
  - Lines 108-113: required inputs and the readability checks. Add the regular-file and mode checks here.
  - Line 132: `ssh-keygen -y -f`. Change it to `LC_ALL=C ssh-keygen -y -P '' -f ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ </dev/null`, capture stderr on its own, and map `incorrect passphrase` to the encrypted-key refusal.
  - Lines 145-156: the server probe. Replace it with the list lookup.
  - Lines 159-167: the SSH key probe and create. Replace it with the list lookup.
  - Lines 179-190: the firewall probe and attachment checks. Replace them with the list lookup and the stricter `all(...)` check: `.type == "server" and (.server.id|tostring) == $id`. For a new server, any entry at all still refuses.
  - Lines 224-227: the final refresh. Run the same exclusivity check before `apply-to-resource`.
  - Keep the `(.x // .)` unwrapping only where `describe` output is still read. List output is a plain array of objects.
  - Put all three lookups before the first change (the `ssh-key create` at line 160). The firewall `describe` that follows a create stays fatal on error, as it is now.
- `deploy/tests/test_host_baseline.sh` -- the stub suite.
  - Line 636: the `hcloud` heredoc stub, which logs to `TEST_LOG` and keeps marker files in `TEST_STATE`. Teach it `server|ssh-key|firewall list -o json`, returning a JSON array that follows the marker state. Make the failure and selector cases switchable through env vars.
  - Lines 671 and 839: `jq` stubs that hard-code outcomes. The new cases need the real jq, or stubs that return the fixture-driven answers.
  - Line 706: `provision_with`. Line 709: the repeat run. Line 761: `provision_refuses`, which expects zero provider calls. Line 850: the mismatch loop.
  - `ssh-keygen`, `stat` and file modes are real. Real key fixtures exist; generate an encrypted ed25519 pair in `$tmp` with `ssh-keygen -N testpass`.
- `deploy/README.md` -- line 1066 (Prerequisites and inputs) and line 1068 (the reconciliation paragraph).
- `.github/workflows/django.yml:229` -- CI runs the suite as an ordinary user and again as root. Read-only.

## Tasks & Acceptance

**Execution:**
- `deploy/provision-host.sh` -- add the list-based lookup helper and use it for the server, SSH key and firewall; tighten the firewall exclusivity check at both places; add the key file type and mode checks; make ssh-keygen non-interactive with the encrypted-key refusal -- implements the matrix.
- `deploy/tests/test_host_baseline.sh` -- extend the hcloud stub with `list`, then add cases: an auth failure on each of the three lookups (assert the message and that no `create`, `set_rules`, `enable-protection` or `apply-to-resource` call was logged); a non-array output; an ambiguous name; a selector firewall on an existing and on a new server; a selector or foreign server appearing only on the final refresh; a private key at 0644; a group-writable public key; an encrypted key, run under `timeout 20`; and keep the existing happy-path and repeat-run cases green -- proves the matrix.
- `deploy/README.md` -- in Prerequisites, say the private key must be mode 600 and have no passphrase, and the public key must not be group- or other-writable; in the reconciliation paragraph, say that a failed Hetzner lookup stops the run before any change and that a firewall attached through a label selector needs an operator decision -- documents the new refusals.

**Acceptance Criteria:**
- Given a revoked `HETZNER_TOKEN`, when `provision-host.sh` runs, then it exits non-zero with the lookup message and the stub log shows no create or change call.
- Given an encrypted admin key, when the script runs with no tty, then it exits within seconds with the passphrase-protected message.
- Given valid inputs on a fresh or an already-provisioned project, when the suite runs, then the existing provision cases pass unchanged.

## Spec Change Log

## Review Triage Log

### 2026-11-22 â€” Review pass
- verdicts: 19 findings â€” high 0, medium 4, low 11, false 1, maybe-false 3
- layers: blind-hunter, edge-case-hunter, verification-gap and intent-alignment ran as one combined read-only codex call. cross-story-contract was skipped because the diff touches only deploy shell scripts and the README, with no API or contract shape.
- findings:
  - `[medium]` `[patch]` blind: the firewall refreshed before `set_rules` is read only for its id, so a selector or foreign server attached after the list lookup gets the baseline rules â€” patched: `provision-host.sh` runs `firewall_only_on_server` (existing id or `none`) right after that describe, and a new `FW_PRE=selector` case asserts no `curl` call.
  - `[medium]` `[defer]` blind: all-digit resource names (allowed by the name regexes) are passed to hcloud commands that resolve IDs first, so another firewall or key could be targeted. This was already true before the change, which kept passing names. Deferred.
  - `[maybe-false]` `[reject]` blind: a missing or scalar `applied_to` passes `all(...[]?)`. The Hetzner API always returns an array, and no path that produces anything else was shown. If it is real, the impact is low, and the fix adds schema guards.
  - `[low]` `[reject]` blind: a top-level `null` or nameless entries count as absent. Accepting `null` is required by the spec's matrix, so changing it means editing the spec. Nameless entries are unrealistic, and guarding them adds checks.
  - `[medium]` `[patch]` blind: the firewall fixture always exists, so firewall creation on a fresh project was never exercised â€” patched: the stub's firewall is stateful, and the fresh-project case asserts that `firewall create` comes before the first `curl` and that a repeat run creates nothing.
  - `[low]` `[patch]` blind: the README said mode 600 while the script also accepts 0400 â€” patched: the README now says "600 or stricter".
  - `[medium]` `[patch]` edge: a foreign attachment between the list lookup and the pre-update describe leads to `set_rules` on a shared firewall. Same root cause as the first blind finding; the same patch fixes it.
  - `[low]` `[reject]` edge: an attachment added after `set_rules` and before `server create --firewall`. This needs a concurrent operator change within seconds, the final refresh still refuses, and the fix adds another refresh-and-guard.
  - `[medium]` `[defer]` edge: numeric names resolving to IDs. Same root cause as the second blind finding, which existed before the change. Deferred.
  - `[low]` `[reject]` edge: a null or nameless list entry. Same as the blind finding above.
  - `[maybe-false]` `[reject]` edge: a missing or scalar `applied_to`. Same as the blind finding above.
  - `[maybe-false]` `[reject]` edge: a missing server id and a missing attachment id compare as equal (`null`). It needs malformed API output on both sides at once; if it is real, the impact is low, and the fix adds guards.
  - `[low]` `[reject]` edge: a key file swapped between the mode check and its use. That is a TOCTOU race on the operator's own workstation; the fix would mean copying keys under secure open.
  - `[low]` `[reject]` edge: the ssh-keygen stderr temp file is left behind if the script is interrupted. It holds only an error message, never key material, and a trap adds complexity.
  - `[low]` `[patch]` edge: README mode 600 against an accepted 0400. Same as the blind finding; the same patch fixes it.
  - `[medium]` `[patch]` verification-gap: firewall creation on a fresh project was untested. Same as the blind fixture finding; the same patch fixes it.
  - `[medium]` `[patch]` verification-gap: no test for a selector that appears on the pre-update describe. Same patch as the first blind finding.
  - `[low]` `[patch]` verification-gap: the conflict/drift loop checked only the exit status â€” patched: it now asserts each mode's refusal message, and its mutation grep also covers `ssh-key create` and `firewall create`.
  - `[false]` `[reject]` intent-alignment: this layer describes how the phrase "deffered work" can be read and reports no defect. Step 1 chose the concrete backlog item (the `spec-0-4` Hetzner-API hardening entry), which is the reading the diff implements.

## Design Notes

A list lookup gives three clear outcomes without reading hcloud's error wording, which changed in CLI v1.52. A non-zero exit or output that is not an array means failure; zero matches means absent; one match means present. The jq should use `type == "array"` to accept `[]` and `null` as an empty array (`(. // []) | if type=="array" ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦`). Use the `.name == $n` filter from the list output.

A selector counts as shared even when it currently matches only this host, because the set of servers it matches can change.

## Verification

**Commands:**
- `bash -n deploy/provision-host.sh && shellcheck deploy/provision-host.sh deploy/tests/test_host_baseline.sh` -- expected: no errors (skip shellcheck if it is not installed, and say so)
- `bash deploy/tests/test_host_baseline.sh` (Git Bash, from the repo root) -- expected: every case passes. If Git Bash has a fork or cygheap failure, run it again.

## Auto Run Result

Status: done

**Summary:** `provision-host.sh` now looks up the server, SSH key and firewall with `hcloud <res> list -o json` and matches each by exact name before any provider change. A failed lookup, output that is not an array, or a name that matches more than one resource stops the run instead of reading as "absent". A firewall attached through a label selector, or to another server, is refused at lookup, again right before `set_rules`, and again before `apply-to-resource`. The private key must be a regular file with no group or other access. The public key must not be writable by group or others. An encrypted private key is refused with its own message (`ssh-keygen -y -P ''`, stdin closed) instead of waiting at a prompt.

**Files changed:**
- `deploy/provision-host.sh` adds the list lookups, the `firewall_only_on_server` exclusivity checks, the key-file mode checks and the non-interactive ssh-keygen call.
- `deploy/tests/test_host_baseline.sh` adds a stateful hcloud stub with `list` and failure, selector and ambiguous switches; a jq stub that runs real jq (or a python stand-in when jq is missing); and cases for every matrix row, the pre-`set_rules` selector, fresh-project firewall creation and the conflict messages.
- `deploy/README.md` documents the key-file rules, the lookup stop and the label-selector refusal.
- `_bmad-output/implementation-artifacts/deferred-work.md` removes the resolved item and adds the numeric-name item.

**Review:** 19 findings across 4 layers (cross-story-contract skipped: no contract shape). Four patch entries were applied by codex, standard tier: two medium (the firewall recheck before `set_rules`, and the fresh-project firewall-create test) and two low (the conflict-loop message asserts, and README "600 or stricter"). One entry was deferred: all-digit names resolve as hcloud IDs (medium, pre-existing; in the frontmatter and `deferred-work.md`). Rejected: missing or scalar `applied_to` (maybe-false, the API always returns an array); null or nameless list entries (the spec allows `null`, and nameless entries are unrealistic); an attachment added between `set_rules` and `server create` (a seconds-wide concurrent race, still caught by the final refresh); missing ids comparing equal (needs malformed output on both sides); a key file swapped after the mode check (a workstation TOCTOU race); the ssh-keygen stderr temp file left behind on interrupt (holds no key material); and the intent-alignment layer's note (descriptive, no defect).

**Follow-up review recommended:** true, because two medium entries were patched. The unverified risk: the new `hcloud <res> list -o json` lookups and `applied_to` parsing are proven only against stubbed JSON, never against a real hcloud CLI or the Hetzner API (for example a label-selector firewall as the live API returns it).

**Verification:** run in an ubuntu:24.04 container with jq, shellcheck, openssh-client, python3, curl and gnupg, before and after the patches. Results: `bash -n deploy/provision-host.sh` OK; `shellcheck deploy/provision-host.sh deploy/tests/test_host_baseline.sh` clean; `bash deploy/tests/test_host_baseline.sh` passed every section as an unprivileged user and as root, including "hetzner lookup and key file checks passed" and "conflict/drift detection checks passed". The Windows Git Bash host cannot run the suite (it lacks jq, and its file modes differ). The first container run without gnupg failed only the unrelated apt key pin section.

**Residual risks:** no live hcloud run. An untracked `Python/` directory (a WindowsApps python stub cache the implementation subagent created in the repo root) is left for the owner to remove.