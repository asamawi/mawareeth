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
- source_spec: `_bmad-output/implementation-artifacts/spec-heroku-to-hetzner.md`
  summary: Backup, monitoring, rehearsal, and production cutover runbooks for the Heroku-to-Hetzner migration.
  evidence: Split from the migration draft because operational safety drills and live cutover procedure depend on the hardened app/runtime but are separable from the code and build-pipeline changes.
- source_spec: `_bmad-output/implementation-artifacts/spec-0-4-create-secured-hetzner-host-baseline.md`
  summary: Wire `deploy/tests/test_host_baseline.sh` (and ShellCheck) into a CI job that runs whenever `deploy/` changes.
  evidence: The script is pure offline validation (no Hetzner contact, not a CI-from-host violation), but today it only runs manually; a regression in the security contract (e.g. a public 0.0.0.0/0 SSH rule) would merge with a green CI check.
- source_spec: `_bmad-output/implementation-artifacts/spec-0-4-create-secured-hetzner-host-baseline.md`
  summary: Document the admin user's passwordless sudo grant and the first-connection TOFU host-key acceptance (`StrictHostKeyChecking=accept-new`) as deliberate tradeoffs, and add a break-glass recovery procedure for an SSH lockout.
  evidence: Both are real, currently-undocumented security-relevant decisions in `bootstrap-host.sh`/`provision-host.sh`; `deploy/README.md` only warns "do not remove the only permitted CIDR" with no recovery path if it happens anyway.
- source_spec: `_bmad-output/implementation-artifacts/spec-0-4-create-secured-hetzner-host-baseline.md`
  summary: Harden `provision-host.sh`'s Hetzner-API interactions: distinguish a transient/auth `hcloud describe` failure from a genuine "not found" before creating resources, detect firewalls shared via a label selector (not just direct server attachment), validate the permission bits of the referenced SSH key files, and give an explicit error when `ssh-keygen -y` blocks on a passphrase-protected key.
  evidence: Each is a real edge case identified during review (confirmed by tracing the script logic) that could cause a duplicate resource, an undetected shared firewall, or an opaque hang/failure, but none are required by the story's stated acceptance criteria.
- source_spec: `_bmad-output/implementation-artifacts/spec-0-4-create-secured-hetzner-host-baseline.md`
  summary: Add `PartOf=docker.service` to the `mawareeth-docker-firewall.service` unit so the Docker-port restriction is reapplied whenever Docker restarts, not only on a full host reboot.
  evidence: Confirmed by reading the unit file (`After=`/`Requires=` only, no `PartOf=`); a `systemctl restart docker` (e.g. after a package upgrade) would recreate the `DOCKER-USER` chain without the restricting rules until the next reboot.
- source_spec: `_bmad-output/implementation-artifacts/spec-0-4-create-secured-hetzner-host-baseline.md`
  summary: Extend `deploy/tests/test_host_baseline.sh` to actually execute `bootstrap-host.sh`'s CIDR/key validation logic and to exercise the admin-user (sudo-prefixed) provisioning path, not only the root-fallback path.
  evidence: Confirmed while fixing the test's SSH stub during this review — the suite only `grep`-matches literal strings in `bootstrap-host.sh` and never runs its validation functions, and the stub always lets the root probe succeed first, so the admin/sudo code path in `provision-host.sh` has never actually been exercised by this test.
- source_spec: none
  summary: `_bmad-output/implementation-artifacts/sprint-status.yaml`'s `generated` timestamp (`2026-03-04 09:18:51`) fails `sprint_plan.py validate` because it includes seconds, which none of the tool's accepted formats support.
  evidence: Pre-existing — confirmed by running `sprint_plan.py validate` after this story's changes; the `generated` field was untouched by this story's diff, so this is not caused by it.
