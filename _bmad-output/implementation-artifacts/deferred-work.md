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
