---
title: 'Deploy production releases from GitHub Actions over Tailscale'
type: 'feature'
created: '2026-11-01'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'fa95645206e3d4d30a2df9aa88be8d83c53c041c'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-0-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every production deploy is a manual sequence run from the operator's workstation:
1. download and validate the manifest;
2. install it;
3. check out the commit;
4. pull the image by digest;
5. run `prepare` and `deploy`.

**Approach:** Add a manually dispatched, approval-gated GitHub Actions workflow that reaches the host over Tailscale and calls a single host-side wrapper with a commit SHA. The wrapper performs the existing deploy sequence itself, so the workflow never supplies an image, a manifest or a command. This deliberately reverses the documented "CI never contacts the production host" rule, and the README must say so.

## Boundaries & Constraints

**Always:**
- **Workflow:**
  - `workflow_dispatch` only, with one input, a 40-hex lowercase SHA, validated before anything else;
  - `environment: production`, which carries the required-reviewer approval;
  - `concurrency` with `cancel-in-progress: false`;
  - every third-party action pinned by full SHA (the existing contract test).
- **Network:** the runner reaches the host only over Tailscale as an ephemeral tagged node, with the host key pinned (`StrictHostKeyChecking=yes`, `known_hosts` from a repository variable or secret). Never public SSH.
- **Account:** the `mawareeth-deploy` user's single authorized key has `restrict,command="…"`. The forced command reads only `SSH_ORIGINAL_COMMAND`, accepts exactly one 40-hex SHA, and runs `sudo -n /usr/local/sbin/mawareeth-deploy-release <sha>`. Sudoers allows only that path, for that user.
- **Root wrapper, in order:**
  1. revalidate the SHA;
  2. take a lock;
  3. `git fetch`, and require the SHA to be an ancestor of (or equal to) `origin/master`;
  4. fetch artifact `release-manifest-<sha>` through the GitHub API with a read-only token from a root-only file;
  5. validate it with the checked-out commit's `release_manifest.py validate --expected-repository <APP_IMAGE_REPOSITORY>`, and require `deployment_bundle.git_sha == <sha>`;
  6. pull the image by digest and verify `RepoDigests`;
  7. install the manifest;
  8. `runtime.sh prepare`;
  9. `release.sh deploy`, **never** `--allow-contract`.

  On any failure before `release.sh deploy` starts, restore the previous checkout commit and manifest. Exit codes propagate.
- **Secrets:** the token, the deploy key and the Tailscale credentials are never printed, never on command lines, and never committed.

**Ask First:**
- Deploying automatically on merge.
- Allowing `--allow-contract` or `recover` from CI.
- Giving the deploy user any other command.
- Using public SSH.

**Never:**
- Touch the live host, GitHub settings, Tailscale or Cloudflare.
- Let the workflow pass a manifest, image or shell text to the host.
- Build or pull by tag.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | approved dispatch, SHA on master with a published manifest | host on that release, blue-green; log streamed; job green | N/A |
| Bad input | non-40-hex, uppercase, extra words, `;`/spaces in `SSH_ORIGINAL_COMMAND` | refused before sudo, no state change | nonzero, names the input only |
| Not on master | SHA not reachable from `origin/master` | refused, checkout unchanged | names the SHA |
| No manifest | no artifact / expired / API error / bad token | refused, checkout and manifest unchanged | names the stage, never the token |
| Bad manifest | validation fails or `git_sha` ≠ SHA or wrong repository | refused, previous checkout and manifest restored | names the check |
| Image/prepare failure | pull or digest mismatch, `prepare` refusal | previous checkout and manifest restored | propagates the exit code |
| Deploy failure | `release.sh deploy` exits non-zero | not restored (release.sh owns rollback); job red | propagates the exit code |
| Concurrent run | second dispatch while one runs | queued by `concurrency`; on the host, the lock refuses an overlap | names the lock |

</frozen-after-approval>

## Code Map

- `.github/workflows/deploy.yml` -- publishes on master; artifact `release-manifest-${{ github.event.workflow_run.head_sha }}` containing `release-manifest.json`, 90-day retention. Artifact download needs an authenticated API call even for this public repository.
- `deploy/release_manifest.py:166-172` -- `validate --input FILE --expected-repository REPO` CLI.
- `deploy/release.sh` -- `deploy` (no flags) and its exit codes (header :1-31); it refuses an unclean `deploy/` tree and needs the checkout at the manifest's commit.
- `deploy/runtime.sh` -- `prepare` with `MAWAREETH_RELEASE_MANIFEST`; `validate_image` verifies `RepoDigests` (reuse it, or match its rule).
- `mawareeth/tests.py:383-500` -- `WorkflowContractTests`, including `test_workflows_pin_third_party_actions`; add contract tests for the new workflow.
- `deploy/tests/` -- stub-based suites (docker/git/curl stubs, as in `test_release.sh`); add `test_ci_deploy.sh`, which CI's deploy-shell loop runs automatically.
- `deploy/README.md` -- "Immutable release artifacts" ("this workflow does not contact or deploy to the production host"), "Prerequisites and inputs" ("never CI"), "Blue-green deployment", and "Access, patching, and break-glass".

## Tasks & Acceptance

**Execution:**
- [x] `deploy/ci-deploy.sh` (new) -- `install` subcommand, run once as root on the host:
  - creates the `mawareeth-deploy` user;
  - installs the forced-command entry script and `/usr/local/sbin/mawareeth-deploy-release` (root 0755) from the checkout;
  - writes the sudoers drop-in, validated with `visudo -cf`;
  - installs the given public key with `restrict,command=…`;
  - checks that the token file `/etc/mawareeth/github-read.token` is root 0600.

  The `release` path is the root wrapper.
- [x] `.github/workflows/deploy-production.yml` (new) -- implements the workflow rows of the matrix: Tailscale connect, then pinned-host-key SSH with the SHA as the only payload.
- [x] `deploy/tests/test_ci_deploy.sh` (new) -- covers every matrix row with stubbed git/curl/docker/sudo, plus the restore-on-failure behaviour.
- [x] `mawareeth/tests.py` -- contract tests for the new workflow:
  - dispatch-only trigger;
  - production environment;
  - concurrency without cancel;
  - pinned actions;
  - no `--allow-contract`;
  - SHA input validation;
  - `StrictHostKeyChecking=yes`.
- [x] `deploy/README.md` -- a new "Deploying from GitHub Actions" section covering:
  - one-time setup: the Tailscale OAuth client and the ACL `tag:ci-deploy` → `mawareeth-prod:22` only; the GitHub `production` environment with required reviewers, its secrets and variables, the deploy key, the fine-grained token (Actions: read) and pinned `known_hosts`;
  - how to run a deploy;
  - how to revoke access.

  Reword the "never CI" statements.

**Acceptance Criteria:**
- Given a dispatched SHA, when the job runs, then the only thing sent to the host is that SHA, and the host independently proves the release before deploying.
- Given the deploy user's key, when it is used for anything other than one valid SHA, then nothing runs beyond the refusal.

## Verification

**Commands:**
- `bash deploy/tests/test_ci_deploy.sh` on Linux, unprivileged and as root -- expected: pass.
- ShellCheck 0.11.0 on `deploy/*.sh deploy/tests/*.sh` -- expected: clean.
- `actionlint` 1.7.7 on `.github/workflows/deploy-production.yml` -- expected: no new findings.
- `python manage.py test mawareeth.tests.WorkflowContractTests` -- expected: OK.

## Suggested Review Order

**Trust boundary: what the deploy user can do**

- Forced command: only one lowercase 40-hex SHA from `SSH_ORIGINAL_COMMAND`, then `sudo -n` the wrapper.
  [`ci-deploy.sh:127`](../../deploy/ci-deploy.sh#L127)

- The sudoers rule: one path, regex-limited argument; the installer requires sudo ≥ 1.9.10 and `visudo -cf`.
  [`ci-deploy.sh:610`](../../deploy/ci-deploy.sh#L610)

- The key works only from the tailnet: `from="100.64.0.0/10",restrict,command=…`.
  [`ci-deploy.sh:611`](../../deploy/ci-deploy.sh#L611)

- The installer repairs or refuses a pre-existing account, `authorized_keys2`, and non-default sshd key sources.
  [`ci-deploy.sh:551`](../../deploy/ci-deploy.sh#L551)

**The host proves the release itself**

- The wrapper's ordered steps: lock, clean tree, provenance, validation, pull, prepare, deploy.
  [`ci-deploy.sh:283`](../../deploy/ci-deploy.sh#L283)

- The commit must be on `origin/master`.
  [`ci-deploy.sh:328`](../../deploy/ci-deploy.sh#L328)

- Publish run and Django CI run checks share one helper; repository, branch, event and path must match.
  [`ci-deploy.sh:262`](../../deploy/ci-deploy.sh#L262)

- The manifest's own Django CI run proves `head_sha == SHA` before anything changes.
  [`ci-deploy.sh:426`](../../deploy/ci-deploy.sh#L426)

- Pull by digest only, then an exact `RepoDigests` match.
  [`ci-deploy.sh:468`](../../deploy/ci-deploy.sh#L468)

**Failure behaviour**

- Restore the previous commit, master ref and manifest on any failure before the deploy; 66 if the restore itself fails.
  [`ci-deploy.sh:160`](../../deploy/ci-deploy.sh#L160)

- SIGPIPE ignored, with output teed to a host log, so a cancelled job cannot kill `release.sh` mid-switch.
  [`ci-deploy.sh:290`](../../deploy/ci-deploy.sh#L290)

**Workflow**

- Dispatch only, from master; SHA validated before the approval-gated job.
  [`deploy-production.yml:10`](../../.github/workflows/deploy-production.yml#L10)

- `environment: production` (required reviewers), empty permissions, one-run concurrency.
  [`deploy-production.yml:50`](../../.github/workflows/deploy-production.yml#L50)

- An ephemeral `tag:ci-deploy` tailnet node; the Tailscale action is pinned by SHA.
  [`deploy-production.yml:67`](../../.github/workflows/deploy-production.yml#L67)

- Pinned host key; the SHA is the only payload.
  [`deploy-production.yml:103`](../../.github/workflows/deploy-production.yml#L103)

**Docs and tests**

- Setup, trust model (master code runs as root), exit codes, cancel semantics, revocation.
  [`README.md:140`](../../deploy/README.md#L140)

- Signal handling: TERM during prepare restores and exits 67.
  [`test_ci_deploy.sh:521`](../../deploy/tests/test_ci_deploy.sh#L521)

- Workflow contract tests, including that secrets appear only in `env:`/`with:` mappings.
  [`tests.py:495`](../../mawareeth/tests.py#L495)
