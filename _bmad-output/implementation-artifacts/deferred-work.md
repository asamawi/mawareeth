- source_spec: none
  summary: Self-service inheritance calculation flow covering the guided interview, family tree capture, and deterministic engine behavior.
  evidence: Split from the broader Mawareeth V3 intent because it is a standalone user-facing deliverable separate from the current migration sprint.
- source_spec: none
  summary: Results lifecycle covering draft or certified reporting, save or share flows, and privacy controls.
  evidence: Split from the broader Mawareeth V3 intent because reporting and privacy features can be reviewed and shipped independently of infrastructure migration.
- source_spec: none
  summary: Lawyer operations covering onboarding, approval, pricing, sponsorship, marketplace purchase, and certification audit.
  evidence: Split from the broader Mawareeth V3 intent because the marketplace and certification workflow form a separate commercial and operational slice.
- source_spec: `_bmad-output/implementation-artifacts/spec-heroku-to-hetzner.md`
  summary: Hetzner runtime and blue-green deployment substrate covering Caddy, Compose, slot switching, and release-manifest promotion.
  evidence: Split from the migration draft because runtime orchestration and routing can be implemented and reviewed independently after the app and CI production gates are in place.
  resolved_by: `_bmad-output/implementation-artifacts/spec-0-5-build-the-private-compose-runtime.md`, `_bmad-output/implementation-artifacts/spec-0-6-implement-safe-blue-green-deployment.md`
- source_spec: `_bmad-output/implementation-artifacts/spec-heroku-to-hetzner.md`
  summary: Backup, monitoring, rehearsal, and production cutover runbooks for the Heroku-to-Hetzner migration.
  evidence: Split from the migration draft because operational safety drills and live cutover procedure depend on the hardened app/runtime but are separable from the code and build-pipeline changes.
  resolved_by: backup and monitoring only, by `_bmad-output/implementation-artifacts/spec-0-7-implement-encrypted-backup-and-restore.md` and `_bmad-output/implementation-artifacts/spec-0-8-add-monitoring-and-operational-controls.md`; rehearsal and cutover remain open (not resolved) as stories 0.9 and 0.10
- source_spec: `_bmad-output/implementation-artifacts/spec-0-4-create-secured-hetzner-host-baseline.md`
  summary: Wire `deploy/tests/test_host_baseline.sh` (and ShellCheck) into a CI job that runs whenever `deploy/` changes.
  evidence: The script is pure offline validation (no Hetzner contact, not a CI-from-host violation), but today it only runs manually; a regression in the security contract (e.g. a public 0.0.0.0/0 SSH rule) would merge with a green CI check.
  resolved_by: `_bmad-output/implementation-artifacts/spec-ci-deploy-shell-suites.md` (https://github.com/asamawi/mawareeth/pull/56)
- source_spec: `_bmad-output/implementation-artifacts/spec-0-4-create-secured-hetzner-host-baseline.md`
  summary: Document the admin user's passwordless sudo grant and the first-connection TOFU host-key acceptance (`StrictHostKeyChecking=accept-new`) as deliberate tradeoffs, and add a break-glass recovery procedure for an SSH lockout.
  evidence: Both are real, currently-undocumented security-relevant decisions in `bootstrap-host.sh`/`provision-host.sh`; `deploy/README.md` only warns "do not remove the only permitted CIDR" with no recovery path if it happens anyway.
- source_spec: `_bmad-output/implementation-artifacts/spec-0-4-create-secured-hetzner-host-baseline.md`
  summary: Harden `provision-host.sh`'s Hetzner-API interactions: distinguish a transient/auth `hcloud describe` failure from a genuine "not found" before creating resources, detect firewalls shared via a label selector (not just direct server attachment), validate the permission bits of the referenced SSH key files, and give an explicit error when `ssh-keygen -y` blocks on a passphrase-protected key.
  evidence: Each is a real edge case identified during review (confirmed by tracing the script logic) that could cause a duplicate resource, an undetected shared firewall, or an opaque hang/failure, but none are required by the story's stated acceptance criteria.
- source_spec: `_bmad-output/implementation-artifacts/spec-0-4-create-secured-hetzner-host-baseline.md`
  summary: Add `PartOf=docker.service` to the `mawareeth-docker-firewall.service` unit so the Docker-port restriction is reapplied whenever Docker restarts, not only on a full host reboot.
  evidence: Confirmed by reading the unit file (`After=`/`Requires=` only, no `PartOf=`); a `systemctl restart docker` (e.g. after a package upgrade) would recreate the `DOCKER-USER` chain without the restricting rules until the next reboot.
  resolved_by: `_bmad-output/implementation-artifacts/spec-deferred-deploy-correctness-fixes.md`
- source_spec: `_bmad-output/implementation-artifacts/spec-0-4-create-secured-hetzner-host-baseline.md`
  summary: Extend `deploy/tests/test_host_baseline.sh` to actually execute `bootstrap-host.sh`'s CIDR/key validation logic and to exercise the admin-user (sudo-prefixed) provisioning path, not only the root-fallback path.
  evidence: Confirmed while fixing the test's SSH stub during this review — the suite only `grep`-matches literal strings in `bootstrap-host.sh` and never runs its validation functions, and the stub always lets the root probe succeed first, so the admin/sudo code path in `provision-host.sh` has never actually been exercised by this test.
- source_spec: none
  summary: `_bmad-output/implementation-artifacts/sprint-status.yaml`'s `generated` timestamp (`2026-03-04 09:18:51`) fails `sprint_plan.py validate` because it includes seconds, which none of the tool's accepted formats support.
  evidence: Pre-existing — confirmed by running `sprint_plan.py validate` after this story's changes; the `generated` field was untouched by this story's diff, so this is not caused by it.
  resolved_by: `_bmad-output/implementation-artifacts/spec-deferred-pre-rehearsal-fixes.md`
- source_spec: none
  summary: Bump `oauthlib` (3.3.1 → ≥4.0.0) and `social-auth-core` (4.8.1 → ≥5.0.0) to close 7 Dependabot alerts (1 high, 6 medium, including a social-auth-core account-takeover and a login-CSRF finding), with real end-to-end testing of the OAuth/social-login flow before shipping.
  evidence: Both are major-version bumps directly backing `mawareeth/settings.py`'s social-login configuration; flattening `requirements.txt` (this story's earlier fix) made GitHub's dependency graph visible for the first time, surfacing these alerts. Deferred rather than bumped blind because a regression here breaks login, not just a lint check, and this environment has no way to exercise the live OAuth flow end-to-end.
  resolved_by: commits `43eb2f1`, `e39cb3e`, `e800326` (now `oauthlib==4.0.0`, `social-auth-core==5.0.2`); the bump shipped, but no end-to-end social-login test evidence is recorded

## Deferred from: code review of spec-0-2-make-django-production-ready (2026-10-11)

- source_spec: `_bmad-output/implementation-artifacts/spec-0-2-make-django-production-ready.md`
  summary: Bound the readiness probe's DB queries (`SELECT 1`, `django_migrations` read) with a statement/lock timeout so a stalled PostgreSQL returns 503 fast instead of pinning a gunicorn worker until its 60s timeout.
  evidence: `mawareeth/ops_views.py` relies only on `connect_timeout`; the gap pre-dates this story (`_database_ready`).
  resolved_by: `_bmad-output/implementation-artifacts/spec-pre-cutover-deploy-safety.md`
- source_spec: `_bmad-output/implementation-artifacts/spec-0-2-make-django-production-ready.md`
  summary: Execute the Dockerfile's build-time `collectstatic && check --deploy --fail-level WARNING` (e.g. `docker build --target builder`, no push) on pull requests, not only in the post-merge publish workflow.
  evidence: The only pre-merge check is a regex contract test over the Dockerfile text; a missing build-only env var would surface only on the release branch. Belongs to 0-3 (build immutable CI artifacts).
  resolved_by: `_bmad-output/implementation-artifacts/spec-ci-premerge-build-and-caddy-checks.md`
- source_spec: `_bmad-output/implementation-artifacts/spec-0-2-make-django-production-ready.md`
  summary: Deploy-check the real runtime configuration (e.g. `DJANGO_KEY` strength, `security.W009`), not just build placeholders.
  evidence: Image build and CI both run `check --deploy` with placeholder values; the runtime only enforces presence. Pre-existing.
- source_spec: `_bmad-output/implementation-artifacts/spec-0-2-make-django-production-ready.md`
  summary: Decide whether `/health/release/` (exact version + commit SHA) should be reachable from the internet or only privately.
  evidence: The endpoint pre-dates this story; this story made it bypass `ALLOWED_HOSTS` but did not change its exposure.
  resolved_by: `_bmad-output/implementation-artifacts/spec-pre-cutover-deploy-safety.md`
- source_spec: `_bmad-output/implementation-artifacts/spec-0-2-make-django-production-ready.md`
  summary: Make sure Caddy overwrites any client-supplied `X-Forwarded-Proto` and that Django is reachable only through Caddy, and document both in the runtime contract.
  evidence: `SECURE_PROXY_SSL_HEADER` trusts the header from any peer; enforcement belongs to 0-5 (private Compose runtime).
  resolved_by: `_bmad-output/implementation-artifacts/spec-pre-cutover-deploy-safety.md`
- source_spec: `_bmad-output/implementation-artifacts/spec-0-2-make-django-production-ready.md`
  summary: Remove `require` from `PRODUCTION_DATABASE_SSL_MODES` once production no longer runs on Heroku Postgres, so production accepts only `disable` (private Compose) or `verify-ca`/`verify-full`.
  evidence: Heroku Postgres (AWS RDS endpoint) cannot verify certificates; setting `DATABASE_SSL_MODE=verify-full` there on 2026-10-11 failed every connection ("root certificate file ... does not exist") until it was reverted to `require`.
- source_spec: `_bmad-output/implementation-artifacts/spec-0-5-build-the-private-compose-runtime.md`
  summary: Add the Compose runtime contract, resolved-model check, and Linux root-permission tests to the normal GitHub Actions path.
  evidence: This is independently shippable CI enforcement; Story 0-5 retains executable offline tests and local Compose validation, while pipeline wiring can be reviewed separately without changing runtime behavior.
  resolved_by: `_bmad-output/implementation-artifacts/spec-ci-deploy-shell-suites.md` (https://github.com/asamawi/mawareeth/pull/56)
- source_spec: `_bmad-output/implementation-artifacts/spec-0-5-build-the-private-compose-runtime.md`
  summary: Add an operator-approved retention and cleanup workflow for superseded content-addressed runtime snapshots after secret rotation.
  evidence: Snapshot lifecycle is a distinct operational policy requiring rollback-retention decisions; Story 0-5 safely creates immutable snapshots but does not delete prior secret material automatically.

- source_spec: `_bmad-output/implementation-artifacts/spec-0-6-implement-safe-blue-green-deployment.md`
  summary: Add a deploy gate that refuses contract-phase migration operations (remove/delete/rename field or model, detected from `migrate --plan`) unless the operator passes `--allow-contract`.
  evidence: Split from 0.6 at the token-budget check; the core deploy runs forward-only migrations and documents expand-migrate-contract rules, so this gate is independent hardening.
  resolved_by: `_bmad-output/implementation-artifacts/spec-pre-cutover-deploy-safety.md`
- source_spec: `_bmad-output/implementation-artifacts/spec-0-6-implement-safe-blue-green-deployment.md`
  summary: Add `deploy/release.sh recover`, which reads the deploy journal after a crash, restores the prior or verified route, reloads Caddy, stops the non-active candidate, and resets the journal (required before story 0.6 is done).
  evidence: Split from 0.6 at the token-budget check; the core deploy already writes the journal and refuses to run when it is not idle, so automated recovery can follow separately.
  resolved_by: `_bmad-output/implementation-artifacts/spec-release-recover.md`
- source_spec: `_bmad-output/implementation-artifacts/spec-0-6-implement-safe-blue-green-deployment.md`
  summary: Run `deploy/tests/test_release.sh` (and the other deploy shell suites, with `bash -n` and ShellCheck) in GitHub Actions on changes under `deploy/**`.
  evidence: Review of 0.6 found that no workflow references the shell suites; `django.yml` runs only `manage.py test`, so a routing or rollback regression can merge with green CI. This extends the existing 0.5 CI-enforcement deferral.
  resolved_by: `_bmad-output/implementation-artifacts/spec-ci-deploy-shell-suites.md` (https://github.com/asamawi/mawareeth/pull/56)
- source_spec: `_bmad-output/implementation-artifacts/spec-0-6-implement-safe-blue-green-deployment.md`
  summary: Add a supported, phased runtime-configuration rotation operation (new snapshot adopted by both slots with overlap for compatibility-affecting keys) and document it.
  evidence: 0.6 `release.sh deploy` and `runtime.sh up` correctly refuse snapshot drift with "rotate configuration separately", but no command or runbook exists, so any secret change currently requires hand-editing root-only slot records.
- source_spec: `_bmad-output/implementation-artifacts/spec-0-6-implement-safe-blue-green-deployment.md`
  summary: Make `validate_compose_model` in `deploy/runtime.sh` remove its temporary secret-bearing snapshot when `compose config` fails.
  evidence: The RETURN trap from 0.5 does not run when `die` or `set -e` exits inside the function, so a failed validation leaves an app snapshot with secrets in the system temp directory.
  resolved_by: `_bmad-output/implementation-artifacts/spec-deferred-deploy-correctness-fixes.md`
- source_spec: `_bmad-output/implementation-artifacts/spec-0-7-implement-encrypted-backup-and-restore.md`
  summary: Back up host state needed for a fast rebuild (`/etc/mawareeth/runtime.env`, `<state dir>/slots/`, `<state dir>/routes/`) as an encrypted Restic snapshot alongside each nightly database dump, and document using it in the host-rebuild runbook.
  evidence: Split from 0.7 at the token-budget check; the database dump, restore verification, and write gate satisfy the story's acceptance criteria on their own, while host-state capture only shortens rebuild time and can follow before the 0.9 rehearsal.
  resolved_by: `_bmad-output/implementation-artifacts/spec-deferred-pre-rehearsal-fixes.md`
- source_spec: `_bmad-output/implementation-artifacts/spec-0-7-implement-encrypted-backup-and-restore.md`
  summary: Run `deploy/tests/test_backup.sh` (with the other deploy shell suites) in GitHub Actions on changes under `deploy/**`.
  evidence: Review of 0.7 confirmed no workflow references `deploy/tests/*.sh`; `django.yml` runs only `manage.py test`, so regressions in snapshot consistency, RPO/RTO checks, or gate freshness can merge with green CI.
  resolved_by: `_bmad-output/implementation-artifacts/spec-ci-deploy-shell-suites.md` (https://github.com/asamawi/mawareeth/pull/56)
- source_spec: `_bmad-output/implementation-artifacts/spec-0-7-implement-encrypted-backup-and-restore.md`
  summary: Strengthen restore verification beyond exact row counts with per-table content checksums on key tables and an application-level check (e.g. `manage.py migrate --check` against the restored database).
  evidence: Review of 0.7 noted that a dump restoring with corrupted values but correct row counts would pass; counts satisfy the story's acceptance criteria but do not prove content integrity.
- source_spec: `_bmad-output/implementation-artifacts/spec-0-7-implement-encrypted-backup-and-restore.md`
  summary: Back up PostgreSQL roles and globals (`pg_dumpall --globals-only`) and record the server major version in the backup manifest, refusing a restore into a different major.
  evidence: Review of 0.7 found roles/grants are excluded (`--no-owner --no-acl`) and the dump's PostgreSQL major is never recorded; harmless with today's single owner role and pinned 17.x image, but a gap once extra roles or a major upgrade appear.
- source_spec: `_bmad-output/implementation-artifacts/spec-0-8-add-monitoring-and-operational-controls.md`
  summary: Operator alert-path drill for Story 0.8 — `monitor.sh drill start|confirm` (two-phase Alertmanager drill email plus manual Better Stack test alert), 0600 drill evidence under `$state_dir/monitor/`, `mawareeth_drill_active`/`mawareeth_drill_last_pass_timestamp_seconds` metrics, `MawareethAlertDrill` and `MawareethDrillOverdue` (>92d quarterly reminder) rules, and the README drill procedure; must pass before launch (0.8 AC "launch drill and quarterly schedule").
  evidence: Split at spec checkpoint because the full 0.8 spec was ~2000 tokens; the drill builds on the collector and p1 routing delivered by the narrowed spec and can be reviewed and merged separately before cutover (Story 0.10 gate).
  resolved_by: `_bmad-output/implementation-artifacts/spec-0-8-alert-path-drill.md`
- source_spec: `_bmad-output/implementation-artifacts/spec-0-8-add-monitoring-and-operational-controls.md`
  summary: Extend the Mawareeth Prometheus rules beyond disk bytes to inode exhaustion, read-only filesystems, memory/swap pressure and OOM kills, failed systemd units, host clock sync (`node_timex_sync_status`/offset), and enable Better Stack SSL/domain-expiry checks.
  evidence: Review of 0.8 found only byte-level disk usage is alerted; a host out of inodes, remounted read-only, OOM-looping, or with a drifting clock (which also skews the backup/restore age rules) would fail silently. These exceed 0.8's acceptance criteria, which name only probe and disk thresholds.
- source_spec: `_bmad-output/implementation-artifacts/spec-0-8-add-monitoring-and-operational-controls.md`
  summary: Add a dead-man's switch for the shared p1 alert path (an always-firing Watchdog routed to an external heartbeat service) so a stopped SCDF Prometheus, Alertmanager, or SMTP relay is itself detected.
  evidence: Review of 0.8 noted every host-side Mawareeth alert depends on p1's Prometheus/Alertmanager/SMTP; if any stops, all Mawareeth alerts go silent while Better Stack covers only the public endpoint. Complements the deferred alert-path drill.
- source_spec: `_bmad-output/implementation-artifacts/spec-0-8-add-monitoring-and-operational-controls.md`
  summary: Pin the expected OpenPGP fingerprints of third-party apt signing keys (Docker in `bootstrap-host.sh`, Tailscale in `monitor.sh`) and refuse to install a downloaded key that does not match.
  evidence: Review of 0.8 found `monitor.sh install` trusts whatever key `pkgs.tailscale.com` serves over HTTPS; `bootstrap-host.sh` already does the same for Docker, so this is a pre-existing pattern best fixed for both at once.
- source_spec: `_bmad-output/implementation-artifacts/spec-ci-deploy-shell-suites.md`
  summary: Make `deploy/backup.sh` run tags unique (e.g. a random or PID suffix on the second-resolution `run_stamp`) so a failed run's `discard_run` → `forget_matching "run:$run_stamp"` can never delete another run's complete snapshots, and add a test that a failed run leaves an earlier same-second run intact.
  evidence: Running the suites on Linux in CI exposed it: two back-to-back backups in the same UTC second share a tag, and the failed one forgot the first run's complete dump and manifest. The test now waits for the next second to avoid it; production runs take minutes, so the window is small but real (e.g. an operator re-running immediately after a fast failure).
  resolved_by: `_bmad-output/implementation-artifacts/spec-deferred-deploy-correctness-fixes.md`
- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-deploy-correctness-fixes.md`
  summary: Remove `runtime.sh`'s secret-bearing temporary files (`validate_compose_model`'s validation snapshot, `write_snapshot`'s `.snapshot.XXXXXX`) when INT/TERM/HUP arrives inside the temporary window, without clobbering traps of `release.sh`, which sources runtime.sh.
  evidence: Review of the deploy correctness fixes found that the subshell cleanup covers `die` and `set -e` exits but not signals; the original RETURN traps did not cover signals either, so this predates the change.
  resolved_by: `_bmad-output/implementation-artifacts/spec-deferred-pre-rehearsal-fixes.md`
- source_spec: `_bmad-output/implementation-artifacts/spec-pre-cutover-deploy-safety.md`
  summary: Validate `deploy/Caddyfile` in CI by running it through the pinned Caddy image (`caddy adapt --config deploy/Caddyfile --adapter caddyfile` in the digest from `deploy/runtime-images.lock`), so a syntax or directive-order mistake fails before a deploy reloads it.
  evidence: The pre-cutover safety change added `respond /health/release* 404` and its tests only grep the Caddyfile text; nothing parses it with the Caddy version production runs, so an invalid Caddyfile would surface only as a failed reload (exit 6) on the host.
  resolved_by: `_bmad-output/implementation-artifacts/spec-ci-premerge-build-and-caddy-checks.md`
- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-pre-rehearsal-fixes.md`
  summary: Decide whether a host-state failure should keep that night's database dump and manifest (recording a degraded `host-state` result) instead of discarding the whole backup run.
  evidence: Review found that a deploy overlapping the nightly backup (a `.prev` record or snapshot removed between collection and `tar`) fails the run at `host-state` and discards a good `mawareeth.dump`, pushing the effective RPO to 48h; the approved intent chose fail-the-whole-run, so changing it needs a decision.
- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-pre-rehearsal-fixes.md`
  summary: Expose whether the latest complete backup run includes `host-state.tar` (e.g. a metric from `last-backup`'s `host_state_snapshot=`) and alert when it is missing.
  evidence: `last-backup` now records `host_state_snapshot`, but neither `monitor.sh` nor `gate` reads it, so a run made by an older script, or a later regression, would go unnoticed until a rebuild.
