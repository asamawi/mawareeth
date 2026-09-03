---
title: 'Create the Secured Hetzner Host Baseline'
type: 'feature'
created: '2026-09-02'
status: 'in-review'
review_loop_iteration: 0
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

## Spec Change Log

## Design Notes

Use a two-stage operator flow: the provisioner owns Hetzner resource reconciliation and deletion protection; the bootstrap script owns only guest configuration. Both accept values through environment/configuration files outside source control and must validate before side effects. This separation keeps privileged provider credentials off the VPS and leaves later deployment logic independent of host creation.

## Verification

**Commands:**
- `bash -n deploy/provision-host.sh deploy/bootstrap-host.sh deploy/tests/test_host_baseline.sh` -- expected: all scripts parse successfully.
- `bash deploy/tests/test_host_baseline.sh` -- expected: offline contract checks pass without Hetzner credentials or network mutation.
- `shellcheck deploy/provision-host.sh deploy/bootstrap-host.sh deploy/tests/test_host_baseline.sh` -- expected: no shell-safety findings, when ShellCheck is installed.
- `git check-ignore -v deploy/host-baseline.env deploy/runtime/production.env` -- expected: local operator and runtime-secret paths are ignored while the example file remains tracked.
