---
title: 'Create the Secured Hetzner Host Baseline'
type: 'feature'
created: '2026-09-02'
status: 'done'
review_loop_iteration: 1
baseline_commit: '788d6cf517286557055b90a0301e47c2fe1ff8bb'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-0-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-mawareeth-2026-09-02/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** The migration has no version-controlled way to create or secure its sole Hetzner host. A manually configured VPS would drift, could expose private services, and would leave production access and runtime secrets unsafe.

**Approach:** Add a parameterized, repeatable Hetzner provisioning and guest-bootstrap baseline, together with an operator guide and safe example configuration. The baseline creates only the secure host substrate; later stories own Compose, Caddy, application slots, backups, and release deployment.

## Boundaries & Constraints

**Always:** Target a CX33 in `nbg1` with Ubuntu 24.04; require explicit operator configuration for Hetzner credentials, SSH administration source ranges, and public key; enable deletion protection; make every apply safe to repeat; configure key-only SSH, a default-deny host firewall, Docker Engine from Docker's official stable repository, Compose, documented security patching, and a root-owned runtime-secret directory/file. Permit public TCP only on 80 and 443; limit SSH to configured source ranges; neither publish nor open application or PostgreSQL ports. Keep credentials and actual secret values out of Git, CI output, and logs.

**Ask First:** Run provisioning against a real Hetzner project; choose the administrator SSH source CIDRs, server name, public-key identity, or maintenance-window schedule; change firewall ports; or grant an automation token permissions beyond the minimum needed to create and protect the server.

**Never:** Create a host from CI; place Hetzner tokens, SSH private keys, or runtime secret values in the repository; configure Caddy, Docker Compose services, blue/green slots, PostgreSQL, backups, monitoring, DNS, or application deployment in this story; use a permissive SSH policy, password authentication, public Docker API, or public Django/PostgreSQL listener.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| First provision | Valid operator config and Hetzner token | A protected CX33 in `nbg1` is created and bootstrapped with the documented security baseline | Stop before mutation when required input or provider prerequisites are absent |
| Repeat provision | Existing matching server and baseline | The script reconciles the baseline without creating a duplicate server or weakening security | Detect conflicting immutable settings and report the required operator decision |
| Unsafe network input | Empty or malformed SSH CIDR, or attempted app/database public port | No firewall rule or host change is applied | Exit non-zero with a redacted, actionable validation error |
| Secret initialization | Operator supplies runtime-secret file content out of band | A root-owned, non-world-readable secret location exists and is never echoed | Refuse unsafe ownership or mode; do not print content |

</frozen-after-approval>

## Code Map

- `deploy/` -- new infrastructure boundary; no current provisioner, Compose configuration, Caddy configuration, or deployment scripts exist.
- `Dockerfile:23-42,60-71` -- release image uses validation-only build inputs and a non-root runtime user; host baseline must preserve the rule that runtime secrets are not image data.
- `.dockerignore:1-24` -- already excludes environment files, key material, `secrets/`, and `runtime/` from image context; mirror these exclusions for host-baseline artifacts in Git.
- `.gitignore:58-63,102-109` -- ignores logs, SQLite databases, and `.env`; extend it for local operator and runtime-secret files introduced by this story.
- `.github/workflows/deploy.yml:13-71` -- produces the GHCR image and CI metadata only; do not add host provisioning or secret delivery to CI.
- `mawareeth/settings.py:25-45,65-119` -- production configuration is environment-driven and fail-closed; the baseline provides protected storage but does not duplicate application settings.
- `_bmad-output/implementation-artifacts/epic-0-context.md` -- Epic-wide operational invariants and dependencies.

## Tasks & Acceptance

**Execution:**
- [x] `deploy/provision-host.sh`, `deploy/host-baseline.env.example` -- add an idempotent operator-run provisioner that validates explicit inputs, creates/reconciles the CX33 in `nbg1`, enables deletion protection, and delegates guest hardening without logging sensitive values -- provisioning must be reproducible and safe to rerun.
- [x] `deploy/bootstrap-host.sh` -- add a non-interactive, idempotent Ubuntu 24.04 guest baseline that hardens SSH, configures default-deny firewall rules, installs Docker Engine and Compose from Docker's official stable repository, enables documented security patching, and creates root-owned runtime-secret storage -- secure the single production host before runtime services arrive.
- [x] `deploy/README.md` -- document prerequisites, required non-secret inputs, first-run and repeat-run behavior, break-glass/maintenance expectations, secret-file creation outside version control, and the exact checks that prove no application or database port is public -- enable an operator to run and audit the baseline safely.
- [x] `.gitignore` -- ignore local provisioning configuration and runtime-secret material while retaining safe examples -- prevent credential or secret commits.
- [x] `deploy/tests/test_host_baseline.sh` -- add offline validation covering syntax, required location/server type/OS, deletion protection, firewall allow-list, key-only SSH, Docker source, patch policy, secret permissions, idempotency guards, and rejection of malformed SSH ranges -- verify the security contract without contacting Hetzner.

**Acceptance Criteria:**
- Given valid operator inputs, when the provisioning baseline is run twice, then it targets one protected CX33 host in `nbg1` and the second run reconciles rather than duplicates or weakens the baseline.
- Given the host baseline has completed, when its public firewall rules are inspected, then only HTTP/HTTPS are public and SSH is restricted to explicitly configured source ranges; no Django, Docker, or PostgreSQL port is publicly reachable.
- Given a host is bootstrapped, when SSH and secret storage are inspected, then password/root login is disabled, authorized keys are required, and runtime secrets are root-owned with restrictive permissions and absent from repository/CI output.
- Given invalid or incomplete operator configuration, when an operator starts provisioning, then the scripts fail before provider or host mutation and redact all sensitive values.

### Review Findings

- [x] [Review][Patch] Docker Engine/Compose installed unpinned from the "stable" apt channel vs. the Architecture Spine's pinned Stack table (Docker Engine 29.7.2, Compose plugin 5.5.0) — resolved 2026-10-11: accept floating-within-major drift via unattended-upgrades; updated the Architecture Spine's Stack table wording to describe this as the policy instead of implying exact pins. [deploy/bootstrap-host.sh:58; architecture-mawareeth-2026-09-02/ARCHITECTURE-SPINE.md Stack table]
- [x] [Review][Patch] Repeat-provision fails once root SSH is disabled: `sudo` strips the `SSH_ALLOWED_CIDRS`/`ADMIN_USER`/`ADMIN_PUBLIC_KEY` env-var assignments on its command line (no `SETENV`/`env_keep` grant), so `bootstrap-host.sh` dies on "SSH_ALLOWED_CIDRS is required" on every run after the first — breaking the "run it twice" acceptance criterion. Fixed: added `Defaults:$ADMIN_USER env_keep += "SSH_ALLOWED_CIDRS ADMIN_USER ADMIN_PUBLIC_KEY"` to the sudoers file bootstrap-host.sh writes. [deploy/provision-host.sh:164-165; deploy/bootstrap-host.sh:116]
- [x] [Review][Patch] Existing-Hetzner-key comparison does a full raw-string compare, unlike the type+data-only compare used a few lines above for the private-key match — a differing SSH comment on the already-stored key falsely reports "different public key" and aborts a legitimate repeat run. Fixed: applied the same type+data-only comparison. [deploy/provision-host.sh:93-97]
- [x] [Review][Patch] Guest firewall (`ufw`) is fully off for the whole window between `ufw --force reset` and the final `ufw --force enable`; any failure in between leaves the host without a guest-level firewall until the next successful run (Hetzner's cloud firewall remains the primary control, so impact is defense-in-depth only). Fixed: added an `ERR` trap over that window that forces deny-all-incoming and re-enables `ufw` before the script exits. [deploy/bootstrap-host.sh:131-146]
- [x] [Review][Patch] CIDR validation only blocklisted the two literal strings `0.0.0.0/0` and `::/0`; a functionally-unrestricted range expressed another way (e.g. two /1s) passed both scripts' checks. Fixed: now rejects any IPv4 prefix shorter than /8 or IPv6 prefix shorter than /32, in both scripts. [deploy/provision-host.sh:26-42; deploy/bootstrap-host.sh:10-26]
- [x] [Review][Patch] `deploy/README.md`'s "Audit checks" section never told the operator to verify `mawareeth-docker-firewall.service` is active or inspect the `DOCKER-USER` chain. Fixed: added that check, including the IPv6 chain and a note to re-check after `systemctl restart docker`. [deploy/README.md]
- [x] [Review][Patch] Hetzner API token was passed as a literal `curl --header "Authorization: Bearer $HETZNER_TOKEN"` argument, visible in the operator workstation's own process list for the call's duration. Fixed: token now goes through a short-lived, mode-600 curl config file instead of argv. [deploy/provision-host.sh:120-134]
- [x] [Review][Patch] No timeout on the `curl` call to the Hetzner firewall API; a network partition would hang the script indefinitely. Fixed: added `--connect-timeout 10 --max-time 30`. [deploy/provision-host.sh:127-132]
- [x] [Review][Patch] Config-permission guard used GNU-only `stat -c '%U:%a'`; running from macOS/BSD failed this check (and the script) outright. Fixed: replaced with a portable python3 `os.stat`/`pwd` check (python3 is already a required dependency). [deploy/provision-host.sh:9-22]
- [x] [Review][Patch] `HETZNER_SSH_KEY_NAME` and `FIREWALL_NAME` had no format validation (unlike `SERVER_NAME`/`ADMIN_USER`). Fixed: added matching regex validation for both. [deploy/provision-host.sh:51,62]
- [x] [Review][Patch] Conflict/drift-detection `die` branches (foreign server, mismatched SSH key, shared firewall) were real but entirely untested — every `hcloud`/`jq` test stub was hardcoded to the "already matches" case. Fixed: added three new stubbed scenarios asserting each `die` branch triggers with no provider mutation. [deploy/tests/test_host_baseline.sh]
- [x] [Review][Patch] `ufw --force reset` already cleared every rule; the three subsequent `ufw --force delete allow 22/80/443` calls were dead code with a stale comment. Fixed: removed the dead calls and rewrote the comment to match the new fail-closed trap behavior. [deploy/bootstrap-host.sh:131-146]
- [x] [Review][Patch] Best-effort remote cleanup (`ssh ... 'sudo rm -f /tmp/mawareeth-bootstrap-host.sh'`) had no `|| true`; a transient SSH hiccup on this cleanup-only call reported a fully successful provision+bootstrap as a failure. Fixed: appended `|| true`. [deploy/provision-host.sh:167]
- [x] [Review][Patch] Several "Suggested Review Order" line-anchors in this spec file didn't point at the statement they described (e.g. `provision-host.sh:36`, `.gitignore:103`). Fixed: corrected every anchor against the final file state. [spec-0-4-create-secured-hetzner-host-baseline.md: Suggested Review Order]
- [x] [Review][Patch] Forbidden-port test only grepped for literal strings (`port: "2375"` / `allow 2375`); an equivalent rule expressed differently would not have been caught. Fixed: now matches the port as a standalone number anywhere in either script. [deploy/tests/test_host_baseline.sh]
- [x] [Review][Patch] 5-minute SSH-reachability poll reported only a generic timeout message. Fixed: the timeout message now names the three likely causes (still booting, operator IP not in `SSH_ALLOWED_CIDRS`, unreachable). [deploy/provision-host.sh:162]
- [x] [Review][Patch] `useradd --create-home` assumed a pre-existing `$ADMIN_USER` has home `/home/$ADMIN_USER`. Fixed: resolves the real home directory via `getent passwd` first. [deploy/bootstrap-host.sh:109-115]
- [x] [Review][Patch] Docker-port iptables backstop only touched the IPv4 `DOCKER-USER` chain, never `ip6tables`. Fixed: mirrors the same rules onto `ip6tables` when available. [deploy/bootstrap-host.sh:76-91]

## Spec Change Log

## Design Notes

Use a two-stage operator flow: the provisioner owns Hetzner resource reconciliation and deletion protection; the bootstrap script owns only guest configuration. Both accept values through environment/configuration files outside source control and must validate before side effects. This separation keeps privileged provider credentials off the VPS and leaves later deployment logic independent of host creation.

## Verification

**Commands:**
- `bash -n deploy/provision-host.sh deploy/bootstrap-host.sh deploy/tests/test_host_baseline.sh` -- expected: all scripts parse successfully.
- `bash deploy/tests/test_host_baseline.sh` -- expected: offline contract checks pass without Hetzner credentials or network mutation.
- `shellcheck deploy/provision-host.sh deploy/bootstrap-host.sh deploy/tests/test_host_baseline.sh` -- expected: no shell-safety findings, when ShellCheck is installed.
- `git check-ignore -v deploy/host-baseline.env deploy/runtime/production.env` -- expected: local operator and runtime-secret paths are ignored while the example file remains tracked.

## Suggested Review Order

**Entry point**

- Operator-run reconciliation script: validates input, then owns Hetzner server/firewall state and delegates guest hardening to `bootstrap-host.sh`.
  [`provision-host.sh:1`](../../deploy/provision-host.sh#L1)

**SSH key-pair validation (bug fixed during review)**

- Compares only the key type and base64 data on both sides — `ssh-keygen -y` echoes back any comment embedded in the private key, so comparing full lines produced false "keys don't match" failures on the common case of a commented ed25519 key. The same fix was applied to the existing-Hetzner-key comparison a few lines below it in this review round.
  [`provision-host.sh:71`](../../deploy/provision-host.sh#L71)

- Guards against a multi-key or multi-line `SSH_PUBLIC_KEY` file before it reaches the comparison above.
  [`provision-host.sh:48`](../../deploy/provision-host.sh#L48)

**SSH source-range & admin-key validation**

- Rejects any CIDR broader than `/8` (IPv4) or `/32` (IPv6) before any Hetzner call — not just the literal `0.0.0.0/0`/`::/0` strings, closing a bypass (e.g. two `/1` ranges) found during this review round.
  [`provision-host.sh:33`](../../deploy/provision-host.sh#L33)

- Mirrors the same rejection on the guest side, closing a gap where `bootstrap-host.sh` validated CIDRs independently but skipped this one check.
  [`bootstrap-host.sh:17`](../../deploy/bootstrap-host.sh#L17)

- Broadens the admin public-key check beyond `ssh-*` so valid ECDSA/FIDO2 key types aren't rejected.
  [`bootstrap-host.sh:39`](../../deploy/bootstrap-host.sh#L39)

**Provisioning ordering & reachability**

- Checks for `python3` before the CIDR validation that depends on it, so a missing interpreter reports the real cause instead of a misleading "invalid CIDR".
  [`provision-host.sh:52`](../../deploy/provision-host.sh#L52)

- Polls both the admin and root accounts for up to five minutes instead of probing once, since a freshly created host needs time to finish booting before `sshd` answers.
  [`provision-host.sh:157`](../../deploy/provision-host.sh#L157)

**Hetzner resource reconciliation**

- Inspects an existing server's type/location/image/ownership label before touching it, so a same-named but foreign server aborts for an operator decision instead of being silently adopted. This review round added test coverage exercising this path (and the matching SSH-key and firewall-sharing checks), since every stub had previously been hardcoded to the already-matching case.
  [`provision-host.sh:79`](../../deploy/provision-host.sh#L79)

**Guest hardening**

- Key-only SSH plus a default-deny `ufw` policy that only opens 80/443 and the configured admin CIDRs, now wrapped in an `ERR` trap so a failure mid-sequence forces deny-all-incoming and re-enables `ufw` rather than leaving the guest unfiltered.
  [`bootstrap-host.sh:131`](../../deploy/bootstrap-host.sh#L131)

- A systemd oneshot backstops `ufw` by restricting Docker's own iptables rules to the same public ports on both the IPv4 and IPv6 `DOCKER-USER` chains, since Docker manipulates them independently of `ufw`.
  [`bootstrap-host.sh:76`](../../deploy/bootstrap-host.sh#L76)

**Peripherals**

- Operator-facing runbook: prerequisites, first/repeat-run behavior, and the exact audit commands that prove no app/DB port is public, including verifying the Docker-port firewall backstop service is active.
  [`README.md:1`](../../deploy/README.md#L1)

- Local operator config and runtime-secret paths excluded from Git while the safe example stays tracked.
  [`.gitignore:104`](../../.gitignore#L104)

- Offline contract tests, including the three stub/assertion bugs fixed during this review (stdin-draining race under `pipefail`, an ambiguous `applied_to` stub match, and a mismatched log assertion) that had masked each other and the key-pair bug above until now.
  [`test_host_baseline.sh:1`](../../deploy/tests/test_host_baseline.sh#L1)
