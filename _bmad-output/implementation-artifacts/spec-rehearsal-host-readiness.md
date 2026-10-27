---
title: 'Rehearsal host readiness: fixes found while preparing mawareeth-prod'
type: 'bugfix'
created: '2026-10-27'
status: 'done'
review_loop_iteration: 0
baseline_commit: '1524ca9'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-0-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-0-9-rehearse-capacity-restore-and-cutover.md'
---

## Intent

**Problem:** Preparing the story 0.9 rehearsal on a real host exposed defects that the offline suites could not catch, because their stubs encoded the same wrong assumptions as the code. The defects were in image validation, host access, provisioning, script modes, and container networking. CI also cost more runs and time than needed.

**Approach:** Fix each defect where it lives. Make the stubs reproduce the real behaviour so the tests would have caught it, and record the operational lessons in `deploy/README.md`. Each change shipped as its own PR, one per row below. This record collects them, because they were made during operations rather than from a planned spec.

## Changes

| PR | Defect found on the host | Fix |
|----|--------------------------|-----|
| #71 | `validate_image` refused correctly pulled Docker Hub images: Docker Engine lists them by short name in `RepoDigests` (`postgres@sha256:…`, `restic/restic@sha256:…`), while the lock pins `docker.io/library/…`. | Also accept the short form for `docker.io` repositories. The digest must still match exactly, and other registries are unchanged. The test stub can now report short names, and a foreign-repository digest is still refused. |
| #72 | After the operator's home IP changed, SSH was locked out. The allow-list is enforced twice, by the Hetzner cloud firewall and by UFW, and UFW cannot be changed without a session. | `monitor.sh install` adds `allow in on tailscale0 from 100.64.0.0/10 to any port 22 proto tcp`; the public allow-list remains as a fallback. The host was rebuilt (same IPv4) and joined the tailnet. |
| #72 | `provision-host.sh` failed against hcloud 1.70.2, jq 1.7 and the current API, which the jq stub had hidden by matching the old expressions literally. Specifically: JSON is no longer wrapped (`.server`, `.ssh_key`, `.firewall`); location moved to `.location`; `applied_to` lists server ids only; jq 1.7 needs parentheses around an array sum in the rules program; `set_rules` returns an `actions` array; delete and rebuild protection must be set together. | Each lookup accepts both shapes, the shared-firewall check compares ids, every returned action is awaited, and protection sets `delete rebuild`. Stub patterns updated. |
| #73 | Every feature-branch push ran CI and its PR ran it again; each run also listed a skipped publish run. | `Django CI` runs on pull requests and on pushes to `master` only. Superseded PR runs are cancelled. `Publish Release Image` triggers and publishes from `master` only. The workflow contract test is updated. |
| #74 | `runtime.sh`, `rehearse.sh`, `bootstrap-host.sh` and `provision-host.sh` were committed `100644`, so the documented `sudo deploy/…` invocations, including the capacity pipe, failed with "command not found". | Mode `100755`; the three test scripts that lacked it too. |
| #75 | The `DOCKER-USER` backstop dropped every connection a container started unless it went to 80/443: DNS, the Storage Box (23), Heroku PostgreSQL (5432), and Mailgun name resolution. `backup.sh init` failed with "Could not resolve hostname". | Traffic arriving from `docker0`/`br-+` `RETURN`s to Docker's own forwarding and isolation rules (not `ACCEPT`, which would skip isolation). Inbound is still limited to 80/443. Applied to the host by reinstalling the firewall script and restarting its unit, without re-bootstrapping, because that would reset UFW. |
| #76 | `deploy-shell` took about 11 min: `promtool test rules` evaluated day-scale groups (up to 94 days) every simulated minute, in both the unprivileged and the root pass. | The four day-scale groups run from a second test file at `evaluation_interval: 15m` (no `for:`, every `eval_time` a multiple of 15m). The root pass skips `promtool`/`amtool` (`MAWAREETH_SKIP_RULE_TOOLS=1`). The job takes about 5.6 min. |

## Verification

- **Each PR's own CI is green.** The offline suites pass on Linux, ShellCheck 0.11.0 is clean, and actionlint shows only the pre-existing `ports['5432']` warnings.
- **The host now works end to end** on release `0b6170f`:
  - provisioning reconciles;
  - SSH works over Tailscale;
  - containers resolve DNS and reach the Storage Box and Heroku;
  - the restic repository initialises on Storage Box sub-account `u569862-sub1` (host keys pinned against Hetzner's published fingerprints);
  - `runtime.sh prepare` and `release.sh deploy` succeed.
- **Mutation checks:**
  - #71: the short-name test fails without the fix.
  - #76: a restore threshold moved to 37 days fails the 15m day-scale test.

## Operational notes

- **Rotate after the rehearsal:**
  - the Mawareeth Hetzner token, which was pasted in chat;
  - the Heroku database password, which appeared in a session transcript.
- **Off-host copies of the backup secrets** (`restic.password` twice, `backup.env`, `storagebox_ed25519`, `storagebox_known_hosts`) are the operator's to make, before the first backup is relied on.
