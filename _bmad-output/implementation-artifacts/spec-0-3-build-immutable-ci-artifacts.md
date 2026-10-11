---
title: 'Build Immutable CI Artifacts'
type: 'feature'
created: '2026-10-11'
status: 'done'
review_loop_iteration: 0
baseline_commit: '74424f73900350a4b9b561039310cc0b61adc2c2'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-0-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The publish workflow produces a GHCR image digest, but its ad hoc metadata omits the deployment-bundle, configuration-schema, and migration-contract identities required to reproduce and verify a release. The workflow also relies on mutable action tags and does not prove the built image starts with the expected release identity.

**Approach:** Turn the successful CI commit into one immutable release unit: build once from locked inputs, smoke-test that exact image, publish it to GHCR, and generate a validated release manifest that binds the digest to the source/deployment commit and explicit runtime contracts.

## Boundaries & Constraints

**Always:** Publish only after the existing `Django CI` push run succeeds; check out its exact `head_sha`; keep Python dependencies and Docker build inputs locked; represent the deployable image as `registry/repository@sha256:...`; treat the source commit as the deployment-bundle revision; make the manifest deterministic, machine-validated, and free of secrets; retain image-owned WhiteNoise static assets and production-shaped build gates.

**Ask First:** Changing the release branch allow-list, registry/repository naming, manifest compatibility version, or the agreed configuration/migration contract values.

**Never:** Add host deployment, Compose/Caddy runtime orchestration, secret injection, signing/provenance infrastructure, mutable production tags, source builds on production, or a second application build after validation.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid release | Successful trusted CI push with commit SHA and built digest | Canonical manifest binds image digest, bundle commit, config schema, migration contract, workflow run, and release identity | Upload manifest artifact only after validation |
| Invalid identity | Missing/malformed SHA, digest, image, or contract field | No release manifest is accepted or uploaded | Validator exits non-zero with field-specific diagnostics and no secret values |
| Image mismatch | Built image cannot start or `/health/release/` does not report the triggering commit | Image is not pushed and no manifest is emitted | Workflow fails closed with container diagnostics |
| Untrusted run | Failed, pull-request, or non-allowed branch workflow run | Publish job does not execute | Existing job condition remains the gate |

</frozen-after-approval>

## Code Map

- `.github/workflows/deploy.yml:3` -- existing post-CI publisher; exact `workflow_run.head_sha` checkout and branch gate already exist, but build currently pushes before smoke validation and emits incomplete `release-metadata.json`.
- `.github/workflows/django.yml:8` -- authoritative test/migration/static/deploy-check pipeline; publish must remain downstream of this successful push workflow rather than duplicate its application test suite.
- `Dockerfile:1` -- digest-pinned Python and uv inputs, locked dependency install, production-shaped `collectstatic`/deploy checks, non-root runtime, and release build args; reuse its runtime image for smoke verification.
- `mawareeth/ops_views.py:53` -- `/health/release/` exposes image-baked release and commit identity for the smoke assertion.
- `mawareeth/tests.py:251` -- existing workflow contract tests; replace shallow snippet checks with manifest/publish invariants and edge-case tests.
- `deploy/release_manifest.py` -- new dependency-free manifest builder/validator CLI; keep it independent of Django and suitable for CI and later host-side verification.
- `deploy/tests/` -- existing deployment-tool test package and natural home for focused manifest unit tests.
- `pyproject.toml:5` and `uv.lock:1` -- locked Python dependency graph; read-only evidence for reproducible application inputs.
- `.dockerignore:1` -- excludes VCS, local secrets, runtime state, and planning artifacts from the image context; preserve these exclusions.

## Tasks & Acceptance

**Execution:**
- [x] `deploy/release_manifest.py` -- add deterministic build/validate commands with strict SHA, OCI digest, schema-version, migration-contract, and no-unknown-field checks -- establish one reusable release contract for CI and later deployment.
- [x] `deploy/tests/test_release_manifest.py` -- cover valid output, canonical image reference, malformed/missing inputs, unknown fields, deterministic serialization, and secret-free diagnostics -- fail closed at the contract boundary.
- [x] `.github/workflows/deploy.yml` -- load the built image locally, smoke-test `/health/live/` and `/health/release/`, then push by immutable digest and generate/validate/upload `release-manifest.json` -- ensure the tested image is the published image and no manifest survives a failed gate.
- [x] `mawareeth/tests.py` -- strengthen repository-level workflow/Docker contract assertions around exact-SHA checkout, no production build, immutable digest identity, smoke-before-push ordering, and manifest validation -- prevent CI configuration regressions.
- [x] `deploy/README.md` -- document manifest fields, immutable pull reference, contract-version ownership, and explicit exclusion of secrets/host deployment -- give Stories 0.5/0.6 a stable consumer contract.

**Acceptance Criteria:**
- Given a successful allowed-branch `Django CI` push, when the publish workflow runs, then it builds the checked-out commit once, verifies that exact image locally, publishes it to GHCR, and uploads a validated release manifest whose image reference includes the returned OCI digest.
- Given a release manifest, when validation runs, then the application digest, source/deployment commit, configuration schema, migration contract, workflow identity, and release identity are complete, canonical, mutually consistent, and contain no runtime secret material.
- Given a failed CI run, disallowed event/branch, failed image build, failed smoke probe, identity mismatch, push failure, or invalid manifest, when the workflow evaluates the release, then no deployable manifest is published.
- Given the repository at the approved baseline, when its focused unit tests and Django suite run, then locked dependency installation, static/deploy build gates, and existing application behavior remain intact.

## Spec Change Log

## Design Notes

The deployment-bundle revision is the full triggering Git commit, not a second archive or mutable branch. That commit transitively identifies every tracked deployment file added by later stories while keeping this story independent of the future host runtime. The configuration schema and migration contract are explicit versioned release inputs; changing their meaning is a compatibility decision, not an incidental CI edit.

## Verification

**Commands:**
- `uv run python -m unittest deploy.tests.test_release_manifest` -- all manifest unit and edge-case tests pass.
- `uv run python manage.py test mawareeth.tests.WorkflowContractTests` -- workflow and image contract tests pass.
- `uv run python manage.py test` -- full Django suite passes.
- `docker build --build-arg RELEASE_VERSION=test-release --build-arg RELEASE_COMMIT_SHA=0123456789abcdef0123456789abcdef01234567 -t mawareeth:story-0-3 .` -- locked production image builds through static/deploy gates.
- `docker run --rm mawareeth:story-0-3 python manage.py check --deploy --fail-level WARNING` with the documented production-shaped environment -- runtime deploy check remains clean.
