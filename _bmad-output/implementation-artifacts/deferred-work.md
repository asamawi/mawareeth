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
  resolved_by: content checksums only, by `_bmad-output/implementation-artifacts/spec-deferred-backup-restore-integrity.md` (every user table, not a key-table list); the `manage.py migrate --check` application-level check remains open as its own entry below
- source_spec: `_bmad-output/implementation-artifacts/spec-0-7-implement-encrypted-backup-and-restore.md`
  summary: Back up PostgreSQL roles and globals (`pg_dumpall --globals-only`) and record the server major version in the backup manifest, refusing a restore into a different major.
  evidence: Review of 0.7 found roles/grants are excluded (`--no-owner --no-acl`) and the dump's PostgreSQL major is never recorded; harmless with today's single owner role and pinned 17.x image, but a gap once extra roles or a major upgrade appear.
  resolved_by: `_bmad-output/implementation-artifacts/spec-deferred-backup-restore-integrity.md` (`globals.sql` per run, never restored automatically; the dump is tagged `pg-major:<N>` and `verify-restore` refuses another major)
- source_spec: `_bmad-output/implementation-artifacts/spec-0-8-add-monitoring-and-operational-controls.md`
  summary: Operator alert-path drill for Story 0.8 — `monitor.sh drill start|confirm` (two-phase Alertmanager drill email plus manual Better Stack test alert), 0600 drill evidence under `$state_dir/monitor/`, `mawareeth_drill_active`/`mawareeth_drill_last_pass_timestamp_seconds` metrics, `MawareethAlertDrill` and `MawareethDrillOverdue` (>92d quarterly reminder) rules, and the README drill procedure; must pass before launch (0.8 AC "launch drill and quarterly schedule").
  evidence: Split at spec checkpoint because the full 0.8 spec was ~2000 tokens; the drill builds on the collector and p1 routing delivered by the narrowed spec and can be reviewed and merged separately before cutover (Story 0.10 gate).
  resolved_by: `_bmad-output/implementation-artifacts/spec-0-8-alert-path-drill.md`
- source_spec: `_bmad-output/implementation-artifacts/spec-0-8-add-monitoring-and-operational-controls.md`
  summary: Extend the Mawareeth Prometheus rules beyond disk bytes to inode exhaustion, read-only filesystems, memory/swap pressure and OOM kills, failed systemd units, host clock sync (`node_timex_sync_status`/offset), and enable Better Stack SSL/domain-expiry checks.
  evidence: Review of 0.8 found only byte-level disk usage is alerted; a host out of inodes, remounted read-only, OOM-looping, or with a drifting clock (which also skews the backup/restore age rules) would fail silently. These exceed 0.8's acceptance criteria, which name only probe and disk thresholds.
  resolved_by: `_bmad-output/implementation-artifacts/spec-deferred-monitoring-gaps.md` (six host-health rules, the node_exporter systemd collector, and Better Stack SSL/domain-expiry notifications documented on the uptime monitor)
- source_spec: `_bmad-output/implementation-artifacts/spec-0-8-add-monitoring-and-operational-controls.md`
  summary: Add a dead-man's switch for the shared p1 alert path (an always-firing Watchdog routed to an external heartbeat service) so a stopped SCDF Prometheus, Alertmanager, or SMTP relay is itself detected.
  evidence: Review of 0.8 noted every host-side Mawareeth alert depends on p1's Prometheus/Alertmanager/SMTP; if any stops, all Mawareeth alerts go silent while Better Stack covers only the public endpoint. Complements the deferred alert-path drill.
  resolved_by: `_bmad-output/implementation-artifacts/spec-deferred-monitoring-gaps.md` (`MawareethWatchdog` routed to a Better Stack heartbeat covers p1 Prometheus, Alertmanager, and reachability; the SMTP relay stays covered only by the quarterly alert-path drill)
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
  resolved_by: `_bmad-output/implementation-artifacts/spec-deferred-backup-restore-integrity.md` (`mawareeth_backup_last_archives_complete`, also covering `globals_snapshot`, and the `MawareethBackupIncomplete` warning)
- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-backup-restore-integrity.md`
  summary: Run an application-level check (`manage.py migrate --check` from the release image) against the database that `verify-restore` restores, in addition to the per-table counts and content checksums.
  evidence: Deferred by the backup/restore integrity spec: the throwaway PostgreSQL runs with `--network none`, so running the app image against it needs a private network and runtime secrets in the restore path; the content checksums already cover `django_migrations` exactly, so this would only add proof that the restored schema matches the code.
- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-backup-restore-integrity.md`
  summary: Add a CI job (or a docker-gated section of `deploy/tests/test_backup.sh`) that runs the exact `output_settings_sql` + `count_sql` from `backup.sh` on the pinned `POSTGRES_IMAGE`, round-trips the data through `pg_dump -Fc | pg_restore --no-owner --no-acl` into a server with different TimeZone/DateStyle defaults, and asserts every line matches `count_line_re` and that the output is unchanged.
  evidence: Review found that the stub suites only text-match the checksum SQL, so a broken cast or a missing setting would pass CI and surface only as `failed:dump` nightly or `checksum-mismatch` monthly; the round trip was verified once by hand on postgres:17.11 during this story, but nothing repeats it.
- source_spec: `_bmad-output/implementation-artifacts/spec-gh-64-backup-integrity-review-fixes.md`
  summary: Run the backup's count and checksum pass alongside `pg_dump` (both inside the exported snapshot) so the snapshot's xmin horizon is held for max(count, dump) instead of their sum.
  evidence: Deferred by the #64 review-fixes spec ("Never: running the checksum pass concurrently with `pg_dump`"); today `dump_and_count` checksums every table and only then starts `pg_dump --snapshot`, so the REPEATABLE READ transaction, and the vacuum horizon it pins on production, lasts for both passes back to back.
- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-monitoring-gaps.md`
  summary: Detect collector failures behind the host-health rules (e.g. `node_scrape_collector_success{collector=~"systemd|vmstat|timex|filesystem|meminfo"} == 0`, `node_filesystem_device_error == 1`, or `absent()` guards for the memory, OOM and clock series) so they cannot go quiet unnoticed.
  evidence: Review of the monitoring-gaps change found that only `MawareethSystemdUnitFailed` has an absence guard; if the vmstat, timex, meminfo or filesystem collector fails or drops a series, the OOM, clock, memory, inode and read-only rules can never fire, and nothing reports it.
- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-monitoring-gaps.md`
  summary: Move the Better Stack heartbeat URL out of `alertmanager.yml` into a root-only file read through `webhook_configs[].url_file`, if p1's Alertmanager version supports it.
  evidence: Review noted that substituting `${MAWAREETH_HEARTBEAT_URL}` puts a bearer URL into the generated config and depends on SCDF's config generator keeping a new variable; p1's Alertmanager version was not checked.
- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-monitoring-gaps.md`
  summary: Decide whether `MawareethMemoryPressure`'s swap branch (more than 50% of swap used for 10m) should use swap activity (`rate(node_vmstat_pswpin/pswpout)`) or memory PSI instead, since Linux does not free swap after pressure passes.
  evidence: Review found that a host can stay above 50% swap used long after pressure ends, which gives a warning that never resolves; the approved matrix specifies used-swap, so changing it needs a decision. Hetzner Ubuntu images ship without swap, so the branch is dormant until swap is added.
- source_spec: `_bmad-output/implementation-artifacts/spec-0-9-rehearse-capacity-restore-and-cutover.md`
  summary: Separate rehearsal and production cutover evidence in `deploy/rehearse.sh` (a run identifier or an `archive`/`reset` subcommand for `<state dir>/rehearsal/`) so story 0.10's `report` cannot mix rehearsal marks, import, and capacity files with production ones.
  evidence: Review of 0.9 found that both runs share one evidence directory and `mark` silently replaces earlier marks; the freshness and coherence checks added in review narrow the risk but do not give 0.10 a clean, auditable production record.
- source_spec: `_bmad-output/implementation-artifacts/spec-0-9-rehearse-capacity-restore-and-cutover.md`
  summary: Give `release.sh` (or `runtime.sh`) a supported way to apply a release's pending migrations after an import while no slot serves, with the same contract gate as a deploy, instead of the README's manual `docker exec ... migrate` step.
  evidence: The 2026-10-27 rehearsal imported Heroku's schema two migrations behind the recorded release; the recorded slot could not become ready, `runtime.sh up` exited 2, and `release.sh deploy` refused to deploy over the unready active slot, so the migrations had to be applied by hand inside the slot. Story 0.10 will meet the same state.
- source_spec: `_bmad-output/implementation-artifacts/spec-pre-cutover-cloudflare-edge.md`
  summary: Decide whether to add Cloudflare Authenticated Origin Pulls (mTLS) and/or restrict ports 80/443 to Cloudflare's ranges, so only this zone's Cloudflare traffic can reach the origin and carry trusted forwarded headers.
  evidence: Review found that `trusted_proxies` with Cloudflare's ranges trusts every Cloudflare-sourced connection, including other customers' Workers or zones aimed at the origin IP, which can then set X-Forwarded-For; impact is limited today (Django ignores X-Forwarded-For/-Host and the app is HTTPS-only), and the spec lists the firewall restriction as Ask First.
- source_spec: `_bmad-output/implementation-artifacts/spec-cloudflare-origin-lock.md`
  summary: Per-hostname Authenticated Origin Pulls with the operator's own client certificate — opt-in `ORIGIN_CLIENT_AUTH=require` (cloudflare mode only) makes Caddy require and verify it on both production names, release.sh's edge and redirect probes present it, preflight checks the root-only `aop-ca.pem`/`aop-client.pem`/`aop-client-key.pem`, and the README documents generating the certificate, the Cloudflare per-hostname API upload (token out of band), the safe enablement order and rollback.
  evidence: Split from the origin-lock spec at the user's request to keep each spec reviewable; the human decision to build it now stands ("A + B now"), so it is next, not optional. Firewall ranges alone do not stop other Cloudflare customers' traffic.
- source_spec: `_bmad-output/implementation-artifacts/spec-cloudflare-origin-lock.md`
  summary: Add a scheduled CI check that compares `deploy/cloudflare-ips.txt` with Cloudflare's published https://www.cloudflare.com/ips-v4 and /ips-v6 and fails (or opens an issue) when they differ.
  evidence: Review noted that with PUBLIC_WEB_SOURCES=cloudflare a new Cloudflare range would make visitors routed through it time out, and nothing flags drift until someone refreshes the file by hand; a CI-side fetch keeps the no-runtime-fetch rule.
- source_spec: `_bmad-output/implementation-artifacts/spec-ci-production-deploy.md`
  summary: Monitor the expiry of the host's fine-grained GitHub read token (`/etc/mawareeth/github-read.token`) — e.g. record its expiry date and alert (monitor.sh metric or a calendar/maintenance-window check) before it lapses.
  evidence: Review noted that an expired token only surfaces when a production deploy fails at the artifact-listing step; the wrapper now reports it clearly, but nothing warns beforehand.
- source_spec: `_bmad-output/implementation-artifacts/spec-cloudflare-authenticated-origin-pulls.md`
  summary: Alert before the Authenticated Origin Pulls CA or client certificate (`/etc/mawareeth/origin-tls/aop-*.pem`) expires, e.g. a monitor.sh metric and Prometheus rule at 30 days, instead of relying on preflight, which only refuses once a certificate has already expired.
  evidence: Review found that with `ORIGIN_CLIENT_AUTH=require` an expired client certificate makes Caddy reject Cloudflare (52x for visitors) while Caddy keeps running; preflight catches it only on the next runtime command.
- source_spec: `_bmad-output/implementation-artifacts/spec-cloudflare-authenticated-origin-pulls.md`
  summary: Add a CI job that starts Caddy with the cloudflare-aop snippets and a throwaway CA, and proves live that a handshake without a client certificate, or with one from another CA, fails on both names while the throwaway client certificate succeeds.
  evidence: CI only runs `caddy adapt --validate` plus JSON shape checks, and test_release.sh uses a curl stub; the live handshake behaviour was checked once by hand during implementation and is not guarded against regressions.
- source_spec: `_bmad-output/implementation-artifacts/spec-cloudflare-authenticated-origin-pulls.md`
  summary: Give the operator a check of Cloudflare's side of per-hostname Authenticated Origin Pulls (both hostnames `enabled` and status `active` via the API, or a probe through Cloudflare), since release.sh's loopback probes present the client certificate themselves and pass even when Cloudflare does not.
  evidence: Review noted a deploy with `require` succeeds while Cloudflare lacks or has lost the hostname association, leaving visitors on 52x; only the manual enablement order protects against it.
- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-credential-expiry-alerts.md`
  summary: Extend `monitor.sh token-check` with a read-only probe of the repository's Actions artifacts endpoint, so a token that is alive but lost Actions read or repository access alerts before a deploy fails.
  evidence: Review found that `/rate_limit` returns 200 for any live token, so `MawareethGithubTokenUnhealthy` stays silent for a re-scoped token; the approved spec limits the check to `/rate_limit` to spend no quota, and the runbook now documents the blind spot.
- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-credential-expiry-alerts.md`
  summary: Alert when a certificate file the running configuration requires disappears (`cert.pem` in cloudflare mode, the AOP files under `ORIGIN_CLIENT_AUTH=require`), for example by comparing file presence with the edge mode.
  evidence: Review found that deleting a required file removes its series, so an active `MawareethOriginCertificateExpiring` resolves and nothing fires until the next preflight; the approved matrix makes an absent file publish nothing, and telling required from unused needs `monitor.sh` to read `runtime.env`, which the spec lists as Ask First.
- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-credential-expiry-alerts.md`
  summary: Decide whether a token record moving from a dated `expires_epoch` to `never` should be flagged, since a renamed or stripped GitHub expiry header would silently turn off the 30-day token alert.
  evidence: Review found that HTTP 200 without `github-authentication-token-expiration` overwrites a known expiry with `never`; the approved matrix treats a missing header as a never-expiring token, and treating the change as an error would also alert on a legitimate rotation to a non-expiring token.
- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-credential-expiry-alerts.md`
  summary: Add a `for:` delay or split out the `absent()` branches of the existing `MawareethCollectorStale` and `MawareethDrillOverdue` rules, so one failed scrape cannot fire them before `MawareethHostDown` inhibits them.
  evidence: Review of the new token rule found this false-alarm path and fixed it there with `for: 5m`; both existing rules use `absent()` with no `for:`, and changing existing rules was outside this spec.
- source_spec: `_bmad-output/implementation-artifacts/spec-calc-access-control.md`
  summary: Make `calc:delete` POST-only with CSRF protection, because a GET currently deletes the owner's whole case, so a link from another site can trigger it.
  evidence: Needs a template change in `calc/templates/calc/index.html` and is a different flaw from the ownership gap that spec fixes.
- source_spec: `_bmad-output/implementation-artifacts/spec-calc-access-control.md`
  summary: Stop `ResultsView` and `NewResultsView` writing to the database on GET through `compute()`.
  evidence: Touches calculation behavior, which that spec leaves unchanged; Epic 2's pure engine is the natural place to resolve it.
- source_spec: `_bmad-output/implementation-artifacts/spec-calc-access-control.md`
  summary: Review production access logs for past anonymous writes and cross-account reads on calc routes, since the app keeps no audit trail of them.
  evidence: An operational investigation of possible past exposure, not a code change, and the outcome may require notifying users.
- source_spec: `_bmad-output/implementation-artifacts/spec-calc-access-control.md`
  summary: Make `calc:new` answer a POST with no `name` field with the existing error message instead of a 500.
  evidence: `request.POST["name"]` raises `MultiValueDictKeyError`; this predates that spec, which only handled the GET replay.
- source_spec: `_bmad-output/implementation-artifacts/spec-calc-access-control.md`
  summary: Stop the results views running `compute()` before the waffle flag and HTTP method checks, so a flag-off 404 or a POST 405 writes nothing.
  evidence: Both views call `compute()` first in `dispatch`, so an owner's rejected request still writes to the database; this predates that spec.
- source_spec: `_bmad-output/implementation-artifacts/spec-calc-access-control.md`
  summary: Count production `Calculation` rows with `user=None` and decide what happens to them, since the app now answers 404 for them and only Django admin reaches them.
  evidence: The count was not checked before the change, so the number of affected cases is unknown.
- source_spec: none
  summary: Next.js and DRF foundation for product delivery, approved by the project owner on 2026-11-05 as the Epic 1 stack, including same-origin routing, CI and blue-green deployment changes.
  evidence: Split from the epic-1 intent because it is a prerequisite that can be reviewed and shipped on its own, and the existing Django app has neither a Next.js frontend nor DRF.
- source_spec: none
  summary: Story 1.1 Zero-Signup Case Start, with anonymous case state held in the Django session and a short expiry (chosen 2026-11-05).
  evidence: Split from the epic-1 intent; independently shippable and first in the epic once the Next.js and DRF foundation exists.
- source_spec: none
  summary: Story 1.2 Start Interview + Madhab Selection.
  evidence: Split from the epic-1 intent; independently shippable, though the engine has no Madhab concept so the choice cannot change results until Epic 2.
- source_spec: none
  summary: Story 1.3 Deceased Info + Add Heirs via Guided Interview Form.
  evidence: Split from the epic-1 intent; independently shippable after Story 1.1.
- source_spec: none
  summary: Story 1.4 Family Tree Visualization (Basic Render + Updates).
  evidence: Split from the epic-1 intent; independently shippable after Story 1.3.
- source_spec: none
  summary: Story 1.5 Real-Time Share Preview from Supported Engine Cases.
  evidence: Split from the epic-1 intent; independently shippable, but needs an engine that can calculate from unpersisted session data.
- source_spec: none
  summary: Story 1.6 Fiqh-Aware Validation + Hajb (Blocking Heirs).
  evidence: Split from the epic-1 intent; independently shippable after Story 1.3.
- source_spec: none
  summary: Decide what users are told about Madhab selection before the engine is multi-school, because choosing Jafari today would show shares calculated without any Madhab logic.
  evidence: Review of the Epic 1 context found no requirement covering this gap between Story 1.2 and Epic 2; for an inheritance tool, undisclosed results are a serious risk.
- source_spec: `_bmad-output/implementation-artifacts/spec-calc-access-control.md`
  summary: Fix the language switcher, which stores the chosen language in the cookie but sends the visitor back to the old language's URL, such as `/en/` after choosing French.
  evidence: Reproduced on production on 2026-11-05 and locally on the code before and after that spec, with the same `302 /en/`; the URL prefix then keeps the page in the old language.
- source_spec: `_bmad-output/implementation-artifacts/spec-calc-access-control.md`
  summary: Make `social:complete` handle a request with no OAuth state instead of returning 500.
  evidence: Reproduced on production on 2026-11-05 and locally on the code before and after that spec; a real login round trip was not tested.
- source_spec: none
  summary: Add an "are you sure?" confirmation before deleting a whole case from the case list, as part of product development, using the confirmation dialog the UX spec defines for destructive actions.
  evidence: `calc:delete` deletes on one click of the trash button, while `heir_delete` and `deceased_delete` already show a confirmation page; `_bmad-output/planning-artifacts/ux-design-specification/ux-consistency-patterns.md:17` requires a confirmation dialog for removing a case. The owner chose on 2026-11-05 to leave this out of the security fix in PR #93 and handle it in product work.
- source_spec: `_bmad-output/implementation-artifacts/spec-nextjs-drf-foundation.md`
  summary: Enforce CSRF explicitly on anonymous POSTs when Story 1.1 adds them.
  evidence: DRF's `SessionAuthentication` enforces CSRF only for logged-in users, so anonymous writes get no CSRF check by default.
- source_spec: `_bmad-output/implementation-artifacts/spec-nextjs-drf-foundation.md`
  summary: Handle a tab left open across a deploy, which can 404 on lazily loaded old chunks, once real routes exist.
  evidence: The image holds only its own release's hashed assets, and the foundation's single page has no lazily loaded routes to exercise this.
- source_spec: `_bmad-output/implementation-artifacts/spec-nextjs-drf-foundation.md`
  summary: Add shadcn/ui, React Query, Zustand and drf-spectacular with the first story that uses each.
  evidence: The foundation has one page and one read-only endpoint, so none of them has a user yet.
- source_spec: `_bmad-output/implementation-artifacts/spec-nextjs-drf-foundation.md`
  summary: Unify full-site i18n URLs between `/ar/` and `/app/ar/`.
  evidence: `/ar/`, `/en/` and `/fr/` belong to Django, which is why the export is served under `/app/`.
- source_spec: `_bmad-output/implementation-artifacts/spec-nextjs-drf-foundation.md`
  summary: Add browser-level tests (hydration, rendered states, RTL, no-retry) when the frontend gains real routes.
  evidence: The foundation's automated tests cover the probe logic but not `SessionStatus` rendering; hydration was checked by hand in headless Chrome only.
- source_spec: `_bmad-output/implementation-artifacts/spec-nextjs-drf-foundation.md`
  summary: Add throttling to the public API before Story 1.1 opens anonymous writes.
  evidence: `REST_FRAMEWORK` sets no throttle classes, and anonymous writes would be the first expensive public endpoints.
- source_spec: `_bmad-output/implementation-artifacts/spec-nextjs-drf-foundation.md`
  summary: Add a Content-Security-Policy for pages under `/app/`.
  evidence: `add_web_headers` sets frame and robots headers only, and the settings define no CSP.
- source_spec: `_bmad-output/implementation-artifacts/spec-nextjs-drf-foundation.md`
  summary: Watch npm dependencies for vulnerabilities and move off `eslint@9`, which npm reports as unsupported.
  evidence: The new `web` job runs no audit and the diff adds no update tooling, so nothing flags a Next or React advisory.
- source_spec: `_bmad-output/implementation-artifacts/spec-nextjs-drf-foundation.md`
  summary: Allow the `next dev` origin for CSRF when Story 1.1 adds its first POST.
  evidence: Development proxies through `localhost:3000`, which the CSRF settings were not changed to cover, so the first write may be rejected in development.
- source_spec: `_bmad-output/implementation-artifacts/spec-nextjs-drf-foundation.md`
  summary: Give the interview a fallback when JavaScript is off or its chunks fail to load, and a way to change language.
  evidence: The shell's static HTML stays on the checking message without hydration and has no language switcher; both are acceptable only while `/app/` is unlinked.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-zero-signup-case-start.md`
  summary: Add a Content-Security-Policy for pages under `/app/` before they reach production.
  evidence: Story 1.1 links `/app/` from the landing page. The project owner deferred this on 2026-11-06 as a release blocker because product work stays on local `development` until all epics are complete.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-zero-signup-case-start.md`
  summary: Add browser-level tests for `/app/` routes, covering keyboard, RTL and reduced motion, before they reach production.
  evidence: Deferred by the project owner on 2026-11-06 as a release blocker. The tests have more to cover once Stories 1.2 and 1.3 add interview content.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-zero-signup-case-start.md`
  summary: Handle failed or stale chunks on `/app/` routes, including tabs left open across a deploy, before they reach production.
  evidence: Story 1.1 covers JavaScript being off with a `<noscript>` message only. The project owner deferred the rest on 2026-11-06 as a release blocker.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-zero-signup-case-start.md`
  summary: Confirm the real `X-Forwarded-For` value reaching Django behind Cloudflare before relying on the case-write throttle's `NUM_PROXIES = 2`.
  evidence: A local Caddy run on 2026-11-06 confirmed Caddy appends the peer from a trusted proxy and replaces the header otherwise, but Cloudflare's own contribution can only be observed on the deployed stack. Release blocker.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-zero-signup-case-start.md`
  summary: Re-run `deploy/monitor.sh install` on the production host when this work ships, confirm `clear-sessions` runs in the real image, and consider a last-success metric for it.
  evidence: The shell tests stub Docker, and a host that never re-runs `install` has no timer and raises no alert, so session rows would grow unnoticed. Release blocker.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-zero-signup-case-start.md`
  summary: Add a confirmation step to "Start over" before Story 1.3 stores interview answers in the case.
  evidence: "Start over" replaces the case immediately, which is harmless while the case holds only an ID and a timestamp but becomes data loss once it holds answers.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-start-interview-madhab-selection.md`
  summary: Serialize anonymous case writes, because Django saves the whole session dict and an overlapping `PATCH` can undo a concurrent start over.
  evidence: `set_madhab` reads, compares and saves with no lock, so two tabs can race; the effect is small while the case holds only a school, but Story 1.3 adds deceased and heir data to the same dict.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-start-interview-madhab-selection.md`
  summary: Make the locale test compare each pair of locales, so French copied from English fails.
  evidence: `new Set(texts).size >= 2` in `web/src/api/case.test.ts` passes whenever Arabic alone differs, and this check predates Story 1.2.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-deceased-info-add-heirs-via-guided-interview-form.md`
  summary: Serialize anonymous case writes from two tabs before this work reaches production, because simultaneous deceased, heir or Madhab writes can overwrite each other and lose an answer.
  evidence: Each tab sends one write at a time and `case_id` blocks writes to a replaced case, but Django saves the whole session dict, so two truly simultaneous writes still race. The project owner deferred this on 2026-11-06 as a release blocker.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-deceased-info-add-heirs-via-guided-interview-form.md`
  summary: Extend the heir relationship list before the engine goes multi-school, covering maternal and paternal grandparent lines, lower generations, and the relatives Jafari and Hanafi distant-kindred rules need.
  evidence: The 22 ids mirror the existing calculator's `Heir` classes, as the project owner chose on 2026-11-06, so these heirs cannot be entered and `grandfather` and `grandmother` do not record which line they belong to.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-deceased-info-add-heirs-via-guided-interview-form.md`
  summary: Decide whether the estate amount is entered before or after debts, funeral costs and bequests, and say so in the hint before Story 1.5 shows amounts.
  evidence: The estate hint says only that the field is optional, and the amount will directly set the money shown for each heir.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-family-tree-visualization-basic-render-updates.md`
  summary: Add node selection with arrow-key navigation, and pan or pinch zoom, to the family tree.
  evidence: Cut from Story 1.4, which draws a static tree inside a focusable scroll area with `role="img"`; the UX spec expects selectable nodes, and the list remains the way to edit and remove heirs.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-family-tree-visualization-basic-render-updates.md`
  summary: Build the full-viewport tree layout with the floating question card on desktop and the bottom sheet on tablet and mobile.
  evidence: Cut from Story 1.4, which keeps the tree, form and list stacked on the heir screen; the UX spec and epic context describe the immersive view.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-family-tree-visualization-basic-render-updates.md`
  summary: Add repeatable browser tests for the tree's rendering, reveal scrolling, RTL mirroring and keyboard path.
  evidence: The repo has no browser test tool, so these were checked once with a throwaway headless Edge script that is not in the repo, and a regression would pass lint, typecheck, unit tests and build.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-family-tree-visualization-basic-render-updates.md`
  summary: Decide how to keep the deceased visible once the tree outgrows its 45% viewport cap.
  evidence: In a headless browser, a six-heir family already overflowed the cap at 375px and 1280px, and revealing a new node on the last line scrolled the deceased out of view.
- source_spec: `_bmad-output/implementation-artifacts/spec-fix-engine-share-distribution.md`
  summary: Say on the results pages that the shares follow the Hanbali school, whichever school the visitor follows.
  evidence: The engine now follows the Hanbali school throughout, as the project owner chose on 2026-11-07; no results page tells the visitor, and the Madhab setting does not change the rules.
- source_spec: `_bmad-output/implementation-artifacts/spec-fix-engine-share-distribution.md`
  summary: Wrap `Calculation.compute()` in a transaction, so a failure or a second simultaneous results-page view cannot leave a case half-written.
  evidence: `compute()` runs on every results-page GET and saves each heir and the calculation separately with no `transaction.atomic`, as it did before this fix, so heir columns can disagree with calculation columns after a mid-run failure.
- source_spec: `_bmad-output/implementation-artifacts/spec-fix-engine-share-distribution.md`
  summary: Have the qualified reviewer rule on whether a full sister who inherits as a residuary with a daughter or son's daughter blocks a paternal sister.
  evidence: The rule was removed on 2026-11-07 because it had not been asked for first. Without it, mother, 2 daughters, a full sister and a paternal sister give the paternal sister 1/6 and the full sister 0, while a paternal brother in the same position is blocked.
- source_spec: `_bmad-output/implementation-artifacts/spec-fix-engine-share-distribution.md`
  summary: Resolved: a full sister who is residuary with a daughter blocks a paternal sister, so the review question logged above is closed and the rule is back.
  evidence: The project owner supplied Ibn Qudamah's ruling from Al-Mughni on 2026-11-07, which gives the paternal sister nothing in this case.
- source_spec: none
  summary: Resume Story 1.5 Real-Time Share Preview once the engine share fix lands, with previews by Madhab as follows: Hanafi and Hanbali for all supported families, Maliki and Shafi'i unavailable when a case needs radd, Jafari always unavailable; show shares and amounts, and change the estate hint in all three languages to ask for the amount after debts, funeral costs and bequests.
  evidence: The project owner chose these on 2026-11-07 after `spec-fix-engine-share-distribution.md` found `Calculation.compute()` giving wrong shares; they chose to fix the engine first, so the preview runs on it in a rolled-back transaction. Which relationships count as preview-supported, and the preview's latency on Postgres, are still open.
- source_spec: none
  summary: Rework the Story 1.5 Madhab split, recorded above, around a Hanbali engine, because Hanbali is now the only school the engine fully follows.
  evidence: The project owner chose on 2026-11-07 that the engine follows Hanbali alone (`spec-fix-engine-share-distribution.md`), after the split was recorded. Hanafi now differs when a grandfather and full or paternal siblings are both present; Maliki and Shafi'i also differ on Mushtaraka and on radd; Jafari stays unavailable.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-standard-share-calculation-sunni-schools.md`
  summary: Add the Jafari school in its own story: its rules (no awl or radd as the Sunni schools have them, its own order of heirs and blocking), plus the relationships it needs that the engine does not model yet.
  evidence: `compute(madhab='jafari')` raises `UnsupportedCase` with `school_not_supported`. Jafari needs at least the distinction between paternal and maternal lines for grandparents, siblings and uncles, which the current relationship types do not record.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-standard-share-calculation-sunni-schools.md`
  summary: Get a ruling on the Malikiyya (husband, mother or grandmother, grandfather, two or more maternal siblings and a paternal brother) for the Maliki school, then replace the refusal with a result.
  evidence: The case raises `UnsupportedCase` with `malikiyya_disputed` under Maliki. Shafi'i gives the muqasama result (1/2, 1/6, 1/6, 0, 1/6 in the fixture).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-standard-share-calculation-sunni-schools.md`
  summary: Decide whether to give radd to Maliki and Shafi'i cases where later scholars of those schools permit it, and what the engine should do with a remainder when they do not.
  evidence: Any case that needs radd raises `UnsupportedCase` with `radd_disputed` under Maliki and Shafi'i, because the classical position gives the remainder to the public treasury and the engine has no place to put it.
  resolved_by: `_bmad-output/implementation-artifacts/spec-deferred-maliki-shafii-later-radd.md`
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-standard-share-calculation-sunni-schools.md`
  summary: Record the line of each grandmother (mother's or father's side) so Hanafi, Maliki and Shafi'i can calculate cases with a grandmother and a father, or with two grandmothers.
  evidence: These cases raise `UnsupportedCase` with `grandmother_line_unknown`, because those schools block and share grandmothers by line.
  resolved_by: `_bmad-output/implementation-artifacts/spec-2-3-expanded-multi-school-coverage-beyond-standard-cases.md`; the existing grandmother became the paternal grandmother, a maternal grandmother was added, and `grandmother_line_unknown` was removed
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-standard-share-calculation-sunni-schools.md`
  summary: Decide whether Maliki should also refuse the family like Malikiyya but with a full brother (Shibh al-Malikiyya), which Story 2.1 calculates by the general grandfather rule.
  evidence: The spec's matrix refuses only the paternal-brother form and says anything unlisted matches Hanbali, but the author's understanding is that Malik rules on the full-brother form the same way, so a Maliki visitor could get a number their school disputes. This needs the qualified review.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-standard-share-calculation-sunni-schools.md`
  summary: Have the refusal text explain that the classical Maliki and Shafi'i position gives the remainder to the public treasury, before Story 1.5 shows it to visitors.
  evidence: The `radd_disputed` message says only that the remainder cannot be shared out, which does not tell a visitor why, and the Arabic and French text is unreviewed.
  resolved_by: `_bmad-output/implementation-artifacts/spec-deferred-maliki-shafii-later-radd.md`
- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-real-time-share-preview-from-supported-engine-cases.md`
  summary: Show each heir's share on its tree node, with the fiqh citation and proof, in Story 2.2.
  evidence: Story 1.5 shows shares in a list under the form only, and the spec rules out shares on tree nodes, citations and proof.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-real-time-share-preview-from-supported-engine-cases.md`
  summary: Add browser tests (Playwright with axe) for the heir screen with the share preview: add, edit, remove, change school, a refused case, a failed request, RTL at 320px, dark mode, forced colors and a keyboard-only run.
  evidence: The suite has no browser runner yet. The staleness and display rules are covered by pure tests against the shared fixtures, and the component's effects, focus behavior and layout were not run in a browser.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-real-time-share-preview-from-supported-engine-cases.md`
  summary: Move the preview off database writes to an in-memory engine path before opening it widely.
  evidence: Each anonymous preview creates rows and rolls them back, which advances Postgres sequences and leaves dead rows for vacuum, and a request the browser aborted still runs to the end on the server. It costs about 100 queries for 6 heirs and 645 for 50.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-real-time-share-preview-from-supported-engine-cases.md`
  summary: Have a native reviewer check the preview's refusal sentences, especially the Malikiyya sentence, which in Arabic reads like a repeat of the school's name.
  evidence: All Arabic and French preview text is unreviewed, and these sentences explain to visitors why no number is given.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-fiqh-aware-validation-hajb-blocking-heirs.md`
  summary: Check the relationship on blur in the edit form too, not only on save.
  evidence: `heir_options` describes adding to the whole family, and an edit leaves that heir out, so the edit form shows plain labels, runs no blur check, and only the server judges it on save.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-fiqh-aware-validation-hajb-blocking-heirs.md`
  summary: Add browser tests (Playwright with axe) for the add form's labels on blocked relatives, the hint, the second-father and spouse errors, a changed gender with a saved spouse, Arabic at 320px, and a keyboard-only run.
  evidence: The labels, hint and error display were covered by pure tests and a built export only; no browser runner exists yet.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-fiqh-aware-validation-hajb-blocking-heirs.md`
  summary: Have a native Arabic and French speaker and a fiqh reviewer check the new text: the kinship messages, the "does not inherit with the family so far" label and the hint under the relationship list.
  evidence: All new Arabic and French text is unreviewed, and the label states a fiqh result (hajb) to the visitor.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-fiqh-aware-validation-hajb-blocking-heirs.md`
  summary: Decide whether a limit on grandmothers is needed.
  evidence: Only one grandmother line is modelled and the rules accept any number of grandmothers, since the engine does not refuse them; the spec added no limit beyond its matrix.
  resolved_by: `_bmad-output/implementation-artifacts/spec-2-3-expanded-multi-school-coverage-beyond-standard-cases.md`; a second paternal or maternal grandmother is refused with `second_paternal_grandmother` and `second_maternal_grandmother`
- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-fiqh-aware-validation-hajb-blocking-heirs.md`
  summary: Check the engine's grandfather-with-siblings rule (mu'adda) against the schools that use it, for example a grandfather, a full brother and a paternal brother, where the paternal brother is counted against the grandfather and then gets nothing.
  evidence: Review of Story 1.6 found that the engine, and the hajb labels that copy it, treat the paternal brother as sharing with the grandfather even when a full brother is present. That is an engine fiqh question, out of scope for 1.6, which must not change engine rules.
  resolved_by: `_bmad-output/implementation-artifacts/spec-deferred-muadda-hajb-labels.md`
- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-fiqh-aware-validation-hajb-blocking-heirs.md`
  summary: Cut the cost of the hajb engine-comparison tests (`HeirRulesTests`), which take about 9 minutes and bring the full Django suite to about 17, for example by using fewer seeded families or classifying without a database round trip.
  evidence: Measured during Story 1.6. CI runs a plain `manage.py test` with no time limit, so every run pays this cost.
- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-case-write-integrity.md`
  summary: Wrap `Calculation.compute()` in one transaction that first locks its own `Calculation` row, so a mid-run failure or two simultaneous results-page views cannot leave heir columns disagreeing with calculation columns, and a refused school is undone without a caller transaction.
  evidence: Split from the case write integrity spec at the project owner's request on 2026-11-08 to keep that spec within the size target; it is independent of the session write lock and can ship on its own.
- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-case-write-integrity.md`
  summary: Resolved: the session write race recorded in Stories 1.2 and 1.3 (two simultaneous case writes from one browser, where the last session save wins) is fixed by `CaseWriteLockMiddleware`, which row-locks the visitor's session for the whole of each unsafe case API request.
  evidence: The lock sits directly before `SessionMiddleware`, so the session load, the view and the session save run inside one transaction. `CaseWriteLockTests` forces the overlaps on PostgreSQL and fails without the middleware.
- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-case-write-integrity.md`
  summary: Decide whether to bound the case write lock wait (for example `SET LOCAL lock_timeout` with a clear "another change is in progress" response) and add a metric or log for lock wait time, before the interview opens widely.
  evidence: `CaseWriteLockMiddleware` waits with no timeout, so one visitor firing many parallel writes, or a hung request inside the lock, ties up workers and DB connections until gunicorn's timeout; the spec put any lock timeout under Ask First, and review flagged the lack of visibility.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-deterministic-proof-output-for-multi-school-results.md`
  summary: Add hadith, ijma and scholar citations to the proof, where the schools rest on them rather than on a verse.
  evidence: The spec allowed only 4:11, 4:12 and 4:176, so every rule without a verse (the grandfather with siblings, the mushtaraka, the akdariyya, awl and radd) names its school rule and no source text.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-deterministic-proof-output-for-multi-school-results.md`
  summary: Have a qualified reviewer check the proof's codes, the verse given to each relationship, and the Arabic and French labels.
  evidence: `calc/proof.py` and the three `django.po` files are unreviewed. In particular the verse is given by relationship (a grandfather, a grandchild and a grandmother get none), the paternal siblings are put under 4:176, and the labels state fiqh positions for each school.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-deterministic-proof-output-for-multi-school-results.md`
  summary: Show the proof on the results and preview screens (Epic 3).
  evidence: The preview API now returns `proof` with labels in the request language, but nothing in the web app displays it.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-deterministic-proof-output-for-multi-school-results.md`
  summary: Say in the proof when a fixed share is split among several heirs of one type (e.g. two wives each with fraction 1/8 and share 1/16), with a count or a 'shared' condition, so the gap between fraction and share is explained.
  evidence: Story 2.2 review found wives and grandmothers keep their single-heir condition while their share is the group's fraction divided among them; changing it alters the version-1 proof contract and every fixture, so it needs its own change.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-expanded-multi-school-coverage-beyond-standard-cases.md`
  summary: Give Maliki and Shafi'i the later scholars' radd in place of the `radd_disputed` refusal: as in Hanbali, the remainder returns to the non-spouse sharers in proportion, a spouse alone still leaves it unallocated, and the proof tags those heirs `radd_later_scholars` (Hanafi and Hanbali keep `radd`).
  evidence: The project owner chose this position on 2026-11-09 while scoping Story 2.3, then split it out to keep the spec within size; it is engine-only (`calc/models.py` radd at `:684-701`, `schools.allows_radd`) and turns the `radd_disputed` tests and the "Maliki radd is refused" preview fixture into results.
  resolved_by: `_bmad-output/implementation-artifacts/spec-deferred-maliki-shafii-later-radd.md`
- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-expanded-multi-school-coverage-beyond-standard-cases.md`
  summary: Make the mu'adda explicit for Maliki, Shafi'i and Hanbali and make the hajb labels follow it: paternal siblings counted against the grandfather are labelled blocked when a full brother is present, or when full sisters are residuary with a daughter or son's daughter and take the whole siblings' pool (daughter, grandfather, sister, paternal sister gives 1/2, 1/4, 1/4, 0); the Ashariyya's paternal brother still inherits.
  evidence: The project owner ruled on 2026-11-09 that the paternal sister is wholly blocked there because the full sister became residuary with the daughter and took all the remainder. The engine already gives these zeros by arithmetic (`calc/models.py:636-657`), but `api/heir_rules.py:139-151` never labels paternal siblings blocked when a grandfather is present. Split from Story 2.3 to keep the spec within size.
  resolved_by: `_bmad-output/implementation-artifacts/spec-deferred-muadda-hajb-labels.md`
- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-expanded-multi-school-coverage-beyond-standard-cases.md`
  summary: Have a qualified reviewer read the grandmother rules, labels and positions added by Story 2.3.
  evidence: Unreviewed: the matrix of grandmother positions (father blocks his mother under Hanafi, Maliki and Shafi'i, not under Hanbali; the mother blocks both; unblocked grandmothers share one sixth), the school-rule codes `father_blocks_his_mother` and `grandmother_inherits_with_her_son` and their three-language labels, the new relationship labels (paternal and maternal grandmother, in Arabic and French) and the new engine and kinship messages in the three `django.po` files. The father rule is tagged on both grandmothers of the family, which a reviewer should confirm.
- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-maliki-shafii-later-radd.md`
  summary: Have a qualified reviewer and native Arabic and French speakers check the `radd_later_scholars` label ("Later Maliki and Shafi'i scholars: ...", "المتأخرون من المالكية والشافعية ...", "Les savants malikites et chaféites tardifs ...") and whether the plain `radd` label should also say that a spouse takes no radd.
  evidence: The label states a fiqh position for two schools and was written without review; review of this change flagged the French "tardifs" as awkward and the plain radd label as silent on the spouse.
- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-compute-transaction.md`
  summary: The `compute()` transaction entries recorded in `spec-fix-engine-share-distribution.md` and `spec-deferred-case-write-integrity.md` are resolved by this spec.
  evidence: `Calculation.compute()` now runs in one `transaction.atomic()` that locks its own calculation row first, so runs are serialized, readers see only complete results, and any exception or refusal rolls back the run's writes.
  resolved_by: `_bmad-output/implementation-artifacts/spec-deferred-compute-transaction.md`
- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-compute-transaction.md`
  summary: Reload the `Calculation` instance (`refresh_from_db()`) after `compute()` takes its row lock, or save only result columns, so a run that waited for the lock does not write back a stale `name` or `user`.
  evidence: Review found that `clear()` saves every field of an instance loaded before the lock; a rename committed while the run waited would be undone. Writing stale fields predates this change, but the lock wait widens the window, and the spec chose not to refresh.
- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-compute-transaction.md`
  summary: Decide whether to bound the `compute()` row-lock wait (for example `SET LOCAL lock_timeout`) on the results pages, which run it on every GET.
  evidence: Overlapping results-page views of one case now wait on `select_for_update()` with no limit, so a slow or stuck run ties up web workers; the spec put any lock timeout under Ask First.
- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-compute-transaction.md`
  summary: Make deleting a case and editing or deleting heirs take the `Calculation` row lock first, and have the results views answer 404 when `compute()` raises `Calculation.DoesNotExist`.
  evidence: A case delete cascades heirs before the calculation row, so it can now deadlock with a results-page run (one side gets a 500), and a heir deleted mid-run can still be re-inserted by that run's `heir.save()`; a case deleted between the view's lookup and `compute()` gives a 500 instead of a 404. Changing those views was Ask First in the spec.
