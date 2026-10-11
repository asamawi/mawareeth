Read `C:\mawareeth\_bmad\render\bmad-build\mawareeth-84c4a456988d\7a1034927a4895fea8a5/review-prompts/verification-gap.md` completely and follow it as your review instructions.

Review content:

diff --git a/.github/workflows/deploy.yml b/.github/workflows/deploy.yml
index d5635a6..a3a4993 100644
--- a/.github/workflows/deploy.yml
+++ b/.github/workflows/deploy.yml
@@ -10,6 +10,10 @@ permissions:
   contents: read
   packages: write
 
+env:
+  CONFIGURATION_SCHEMA_VERSION: "1"
+  MIGRATION_CONTRACT: expand-migrate-contract-v1
+
 jobs:
   publish:
     if: >-
@@ -18,54 +22,104 @@ jobs:
       contains(fromJson('["dev","main","master"]'), github.event.workflow_run.head_branch)
     runs-on: ubuntu-latest
     steps:
-      - uses: actions/checkout@v4
+      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
         with:
           ref: ${{ github.event.workflow_run.head_sha }}
 
+      - name: Derive immutable image identity
+        id: image
+        shell: bash
+        run: |
+          repository="ghcr.io/${GITHUB_REPOSITORY,,}"
+          echo "repository=$repository" >> "$GITHUB_OUTPUT"
+          echo "tag=$repository:${{ github.event.workflow_run.head_sha }}" >> "$GITHUB_OUTPUT"
+
       - name: Set up Docker Buildx
-        uses: docker/setup-buildx-action@v3
+        uses: docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f
 
       - name: Log in to GHCR
-        uses: docker/login-action@v3
+        uses: docker/login-action@c94ce9fb468520275223c153574b00df6fe4bcc9
         with:
           registry: ghcr.io
           username: ${{ github.actor }}
           password: ${{ secrets.GITHUB_TOKEN }}
 
-      - name: Derive image metadata
-        id: meta
-        uses: docker/metadata-action@v5
-        with:
-          images: ghcr.io/${{ github.repository }}
-          tags: |
-            type=sha,format=long,prefix=
-
-      - name: Build and publish image
-        id: build
-        uses: docker/build-push-action@v6
+      - name: Build release image once
+        uses: docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8
         with:
           context: .
-          push: true
-          tags: ${{ steps.meta.outputs.tags }}
-          labels: ${{ steps.meta.outputs.labels }}
+          load: true
+          push: false
+          tags: ${{ steps.image.outputs.tag }}
           build-args: |
             RELEASE_VERSION=${{ github.event.workflow_run.head_sha }}
             RELEASE_COMMIT_SHA=${{ github.event.workflow_run.head_sha }}
 
-      - name: Write release metadata
+      - name: Smoke-test release image
+        shell: bash
+        env:
+          IMAGE_TAG: ${{ steps.image.outputs.tag }}
+          EXPECTED_SHA: ${{ github.event.workflow_run.head_sha }}
         run: |
-          cat > release-metadata.json <<'EOF'
-          {
-            "git_sha": "${{ github.event.workflow_run.head_sha }}",
-            "image": "${{ steps.meta.outputs.tags }}",
-            "digest": "${{ steps.build.outputs.digest }}",
-            "workflow": "Django CI",
-            "workflow_run_id": "${{ github.event.workflow_run.id }}"
+          set -euo pipefail
+          container="mawareeth-release-smoke"
+          cleanup() {
+            docker logs "$container" 2>&1 || true
+            docker rm -f "$container" >/dev/null 2>&1 || true
           }
-          EOF
+          trap cleanup EXIT
+          docker run --detach --name "$container" --publish 127.0.0.1::8000 \
+            --env DJANGO_ENV=production \
+            --env DJANGO_KEY=ci-smoke-validation-key-with-sufficient-length-0123456789 \
+            --env DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost \
+            --env DJANGO_CSRF_TRUSTED_ORIGINS=https://localhost \
+            --env DATABASE_URL=sqlite:////tmp/mawareeth-smoke.sqlite3 \
+            --env DATABASE_SSL_MODE=disable \
+            --env MAILGUN_ACCESS_KEY=build-only \
+            --env MAILGUN_SERVER_NAME=build.example.invalid \
+            "$IMAGE_TAG"
+          port="$(docker port "$container" 8000/tcp | head -n 1 | sed 's/.*://')"
+          for attempt in {1..30}; do
+            if curl --fail --silent --show-error "http://127.0.0.1:$port/health/live/" >/dev/null; then
+              break
+            fi
+            if [ "$attempt" -eq 30 ]; then
+              exit 1
+            fi
+            sleep 1
+          done
+          curl --fail --silent --show-error "http://127.0.0.1:$port/health/release/" > release-identity.json
+          python -c 'import json, os; data=json.load(open("release-identity.json", encoding="utf-8")); expected=os.environ["EXPECTED_SHA"]; assert data["release"] == expected and data["commit"] == expected'
+
+      - name: Push smoke-tested image
+        id: push
+        shell: bash
+        env:
+          IMAGE_TAG: ${{ steps.image.outputs.tag }}
+        run: |
+          set -euo pipefail
+          docker push "$IMAGE_TAG" | tee docker-push.log
+          digest="$(sed -nE 's/^.*digest: (sha256:[0-9a-f]{64}).*$/\1/p' docker-push.log | tail -n 1)"
+          test -n "$digest"
+          echo "digest=$digest" >> "$GITHUB_OUTPUT"
+
+      - name: Build and validate release manifest
+        shell: bash
+        run: |
+          python deploy/release_manifest.py build \
+            --git-sha "${{ github.event.workflow_run.head_sha }}" \
+            --image-repository "${{ steps.image.outputs.repository }}" \
+            --image-digest "${{ steps.push.outputs.digest }}" \
+            --configuration-schema "$CONFIGURATION_SCHEMA_VERSION" \
+            --migration-contract "$MIGRATION_CONTRACT" \
+            --workflow "Django CI" \
+            --workflow-run-id "${{ github.event.workflow_run.id }}" \
+            --output release-manifest.json
+          python deploy/release_manifest.py validate --input release-manifest.json
 
-      - name: Upload release metadata
-        uses: actions/upload-artifact@v4
+      - name: Upload release manifest
+        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
         with:
-          name: release-metadata
-          path: release-metadata.json
+          name: release-manifest-${{ github.event.workflow_run.head_sha }}
+          path: release-manifest.json
+          if-no-files-found: error
diff --git a/_bmad-output/implementation-artifacts/epic-0-context.md b/_bmad-output/implementation-artifacts/epic-0-context.md
index 164fcbc..b9ca467 100644
--- a/_bmad-output/implementation-artifacts/epic-0-context.md
+++ b/_bmad-output/implementation-artifacts/epic-0-context.md
@@ -4,7 +4,7 @@
 
 ## Goal
 
-Move the existing Mawareeth Django monolith from Heroku to a cost-first, recoverable, observable Hetzner production deployment before product modernization continues. The migration must establish a secure and reproducible operating baseline, demonstrate that application data and releases can be recovered safely, and complete a rehearsed cutover without turning the hosting change into a Next.js, DRF, or service-decomposition project.
+Move the existing server-rendered Django application from Heroku to a recoverable, observable, cost-first Hetzner deployment before product modernization proceeds. The migration preserves the monolith, establishes reproducible delivery and operations, proves recovery and capacity, and completes a controlled cutover without introducing unrelated frontend, API, or service decomposition work.
 
 ## Stories
 
@@ -21,30 +21,31 @@ Move the existing Mawareeth Django monolith from Heroku to a cost-first, recover
 
 ## Requirements & Constraints
 
-- Preserve the server-rendered Django application as one deployable WSGI service. The active migration phase must not require a frontend/backend split, Next.js, DRF extraction, or service decomposition.
-- Run production on one cost-first Hetzner VPS. This is a single failure domain, not a high-availability guarantee; capacity decisions must be informed by representative load, two-slot deployment headroom, CPU, memory, and swap/OOM signals.
-- Provision the sole host reproducibly in Hetzner `nbg1` on Ubuntu 24.04 LTS. The baseline must be idempotent and include restricted key-only administration, a default-deny firewall exposing only HTTP/HTTPS plus restricted SSH, Docker from its official stable repository, documented security patching, deletion protection, and root-owned runtime secrets excluded from source control, CI output, and logs.
-- Production may receive public HTTP/HTTPS only through Caddy. Django and PostgreSQL must remain private to the Compose topology; PostgreSQL must never publish a public port.
-- PostgreSQL is the single durable transactional-state owner. Use a fixed Compose project name and a stable, pre-provisioned external volume; disposable application slots must not own durable state, recreate the database, or replace its volume.
-- CI must be the only producer of deployable artifacts. It tests and builds once, publishes a pinned OCI image and release manifest, and production verifies and pulls immutable identities rather than building source or deploying branch heads. Secrets must never be embedded in artifacts.
-- Every release must use blue/green application slots, an exclusive and crash-recoverable deployment flow, compatible expand/migrate/contract schema evolution, health verification, atomic edge routing, TLS verification, and graceful draining. A failed release must preserve or restore the known-good route; rolling back an application must not automatically reverse migrations.
-- Health signals must include bounded liveness, database- and schema-aware readiness, and release identity without diagnostic leakage. Container logs rotate within defined bounds; external probes alert the primary operator after two consecutive failures, with disk warnings at 75% and critical alerts at 85%.
-- Before public production cutover, Django 5.2 LTS, secure production settings, `check --deploy`, an off-host tested backup/restore path, and a representative capacity test with Caddy, PostgreSQL, and both slots must pass. Irreplaceable production writes are prohibited until recovery has been demonstrated.
-- Keep development local, CI disposable, and any staging environment on demand with isolated data and secrets; no permanent staging host is required. Before storing sensitive or durable business artifacts, document the AES-256-at-rest control and ensure artifacts are reproducible from immutable inputs or covered by durable backup.
+- Preserve the Django WSGI monolith as one deployable service during this phase; do not require Next.js, DRF extraction, or service decomposition.
+- Operate production on one cost-first Hetzner VPS. This remains a single failure domain, so representative capacity testing must prove room for Caddy, PostgreSQL, and both application slots without swap, OOM, or architecture threshold breaches.
+- Provision Ubuntu 24.04 LTS in Hetzner `nbg1` reproducibly with restricted key-only administration, default-deny firewalling, official stable Docker packages, documented patching, deletion protection, and root-owned runtime secrets excluded from repositories and logs.
+- Expose only Caddy publicly. Django and PostgreSQL remain private to Compose; PostgreSQL uses a fixed project name and stable pre-provisioned external volume that disposable application slots cannot recreate or replace.
+- CI is the sole producer of deployable artifacts. It tests once, builds once, publishes a pinned OCI image plus release manifest, and excludes secrets. Production verifies immutable identities and never builds source or deploys a branch head.
+- Dependencies and base images must be reproducibly locked. Image-owned static assets are built only after `collectstatic` and production-shaped `check --deploy` pass as hard gates.
+- Release manifests bind the application digest, deployment-bundle commit, Compose/Caddy/deploy revisions, configuration-schema version, and migration contract.
+- Every application release uses exclusive, crash-recoverable blue-green deployment with compatible expand/migrate/contract schema changes, bounded health checks, atomic routing, production-TLS verification, graceful draining, and preservation of the last known-good route on failure.
+- Health signals include bounded liveness, database- and schema-aware readiness, and release identity without diagnostic leakage. Logs rotate within defined bounds; monitoring alerts after two failed probes and at documented disk thresholds.
+- Before cutover, Django 5.2 LTS, secure production checks, tested off-host backup/restore, production-shaped capacity evidence, and a separately rehearsed Heroku data/DNS transition must pass. Irreplaceable writes are prohibited until recovery is demonstrated.
+- Keep development local, CI disposable, and staging on demand with isolated data and secrets. Durable legal/business evidence belongs in PostgreSQL or an explicitly protected artifact store, never only in rotating operational logs.
 
 ## Technical Decisions
 
-- Use Docker Compose on the host for Caddy, PostgreSQL, and `blue`/`green` Django application slots. Caddy owns certificates and the sole public edge; its persisted routing declaration is the authority for which slot is active.
-- Standardize release traceability on a human-readable Git commit SHA and an immutable OCI digest for deployment identity. Bind the application digest, deployment-bundle revision, Compose/Caddy/deploy revisions, configuration-schema version, and migration contract in a release manifest.
-- Both slots consume the same hashed runtime configuration snapshot and `DATABASE_URL`. PostgreSQL connections on the private local network use an explicit non-TLS mode unless server TLS is intentionally configured; any future managed database must use verified TLS.
-- Use committed Django migrations only. CI checks that migrations are present; production runs one serialized `migrate --noinput` job before traffic switches and never runs `makemigrations`.
-- Store runtime secrets in a protected, root-owned non-repository file. Treat rotation as a separate phased operation; use overlapping dual-key support for compatibility-affecting secrets.
-- Record domain audit evidence durably in PostgreSQL rather than container logs. Operational logs are non-authoritative and may rotate. Do not use in-process background threads for durable asynchronous work.
-- Rehearse the one-time Heroku exit separately from routine blue/green releases: inventory Heroku dependencies, restore a source-consistent logical dump using target-version tools, validate migrations and invariants, lower DNS TTL, and choose either a write-freeze or replication runbook with a named last safe rollback point. Do not reuse PostgreSQL data directories across major versions.
+- Use Docker Compose on one host for Caddy, PostgreSQL, and interchangeable `blue` and `green` Django slots. Caddy owns certificates and its persisted routing declaration is the active-slot authority.
+- Use Git commit SHA for human traceability and OCI digest for deployment identity. Production pulls only artifacts pinned by the verified release manifest.
+- Target Python 3.12 and Django 5.2 LTS; pin application base images by digest. GHCR is the application image registry.
+- Both slots consume the same hashed runtime configuration snapshot and `DATABASE_URL`. Local private PostgreSQL uses an explicit non-TLS mode unless server TLS is configured; future managed databases require verified TLS.
+- Commit Django migrations. CI runs `makemigrations --check --dry-run`; production runs one serialized `migrate --noinput` job and never creates migrations.
+- Store runtime secrets in a protected non-repository file. Secret rotation is a separate phased operation, with overlap for compatibility-affecting keys.
+- Record domain audit evidence durably in PostgreSQL. Do not use in-process background threads for durable asynchronous work.
 
 ## Cross-Story Dependencies
 
-- The verified Heroku inventory and production-ready Django configuration establish the inputs and safety gates for artifact creation, host/runtime provisioning, rehearsal, and cutover.
-- Immutable CI artifacts and the secure host baseline must exist before the private Compose runtime and deployment automation can consume production images safely.
-- The private runtime, stable PostgreSQL volume, configuration snapshot, and Caddy edge are prerequisites for blue/green deployment, monitoring, backup, and capacity rehearsal.
-- Backup/restore verification, monitoring launch drills, and capacity/cutover rehearsal are explicit gates before the final DNS and data cutover. Heroku retirement occurs only after validation and expiry of the defined rollback point.
+- The verified Heroku inventory and production-ready Django gates provide the trusted inputs for immutable artifact creation.
+- Immutable CI artifacts and the secured host baseline must exist before the private runtime and deployment automation can safely consume production images.
+- The private runtime, stable PostgreSQL volume, configuration snapshot, and Caddy edge are prerequisites for blue-green deployment, monitoring, backup, and capacity rehearsal.
+- Backup/restore verification, monitoring drills, and capacity/cutover rehearsal gate the final DNS and data cutover. Heroku retirement waits until validation succeeds and the rollback point expires.
diff --git a/_bmad-output/implementation-artifacts/sprint-status.yaml b/_bmad-output/implementation-artifacts/sprint-status.yaml
index 769b5a0..fe4a8db 100644
--- a/_bmad-output/implementation-artifacts/sprint-status.yaml
+++ b/_bmad-output/implementation-artifacts/sprint-status.yaml
@@ -43,7 +43,7 @@ development_status:
   epic-0: in-progress
   0-1-capture-and-verify-the-heroku-inventory: done
   0-2-make-django-production-ready: done
-  0-3-build-immutable-ci-artifacts: backlog
+  0-3-build-immutable-ci-artifacts: in-progress
   0-4-create-the-secured-hetzner-host-baseline: done
   0-5-build-the-private-compose-runtime: backlog
   0-6-implement-safe-blue-green-deployment: backlog
diff --git a/deploy/README.md b/deploy/README.md
index beb698e..4b766ed 100644
--- a/deploy/README.md
+++ b/deploy/README.md
@@ -2,6 +2,14 @@
 
 This directory creates the secure substrate only. It does not install Compose services, Caddy, Django, PostgreSQL, backups, DNS, monitoring, or deploy an application.
 
+## Immutable release artifacts
+
+`Django CI` remains the application validation authority. After a successful push run on an allowed release branch, `.github/workflows/deploy.yml` checks out that run's exact commit, builds the application image once, starts that local image, and verifies both liveness and the baked release identity before pushing the same tag to GHCR. A failed build, smoke probe, identity assertion, registry push, or manifest validation prevents publication of a deployable manifest.
+
+The workflow uploads `release-manifest-<commit>` containing `release-manifest.json`. Its `application.image` is the only production-consumable image identity and has the canonical form `ghcr.io/<owner>/<repository>@sha256:<digest>`; branch names and tags are not deployment inputs. The manifest also binds the same 40-character commit as the human release identity and deployment-bundle revision, plus configuration schema `1`, migration contract `expand-migrate-contract-v1`, and the successful `Django CI` workflow run. The deployment-bundle commit identifies all tracked Compose, Caddy, and deploy files added by later stories.
+
+`deploy/release_manifest.py validate --input release-manifest.json` fails closed on missing, extra, malformed, or inconsistent fields. The manifest compatibility version, configuration schema, and migration contract are release interfaces: change them only through an explicit compatibility decision. The manifest contains identities and contract versions only. Runtime credentials, environment values, secret material, host deployment logic, and mutable source references must never be added. Stories 0.5 and 0.6 consume and verify this contract; this workflow does not contact or deploy to the production host.
+
 ## Prerequisites and i…863 tokens truncated…, r"^[^@]+@[0-9a-f]{40}$")
diff --git a/_bmad-output/implementation-artifacts/spec-0-3-build-immutable-ci-artifacts.md b/_bmad-output/implementation-artifacts/spec-0-3-build-immutable-ci-artifacts.md
new file mode 100644
index 0000000..27cd53f
--- /dev/null
+++ b/_bmad-output/implementation-artifacts/spec-0-3-build-immutable-ci-artifacts.md
@@ -0,0 +1,79 @@
+---
+title: 'Build Immutable CI Artifacts'
+type: 'feature'
+created: '2026-10-11'
+status: 'in-review'
+review_loop_iteration: 0
+baseline_commit: '74424f73900350a4b9b561039310cc0b61adc2c2'
+context:
+  - '{project-root}/_bmad-output/implementation-artifacts/epic-0-context.md'
+---
+
+<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">
+
+## Intent
+
+**Problem:** The publish workflow produces a GHCR image digest, but its ad hoc metadata omits the deployment-bundle, configuration-schema, and migration-contract identities required to reproduce and verify a release. The workflow also relies on mutable action tags and does not prove the built image starts with the expected release identity.
+
+**Approach:** Turn the successful CI commit into one immutable release unit: build once from locked inputs, smoke-test that exact image, publish it to GHCR, and generate a validated release manifest that binds the digest to the source/deployment commit and explicit runtime contracts.
+
+## Boundaries & Constraints
+
+**Always:** Publish only after the existing `Django CI` push run succeeds; check out its exact `head_sha`; keep Python dependencies and Docker build inputs locked; represent the deployable image as `registry/repository@sha256:...`; treat the source commit as the deployment-bundle revision; make the manifest deterministic, machine-validated, and free of secrets; retain image-owned WhiteNoise static assets and production-shaped build gates.
+
+**Ask First:** Changing the release branch allow-list, registry/repository naming, manifest compatibility version, or the agreed configuration/migration contract values.
+
+**Never:** Add host deployment, Compose/Caddy runtime orchestration, secret injection, signing/provenance infrastructure, mutable production tags, source builds on production, or a second application build after validation.
+
+## I/O & Edge-Case Matrix
+
+| Scenario | Input / State | Expected Output / Behavior | Error Handling |
+|----------|--------------|---------------------------|----------------|
+| Valid release | Successful trusted CI push with commit SHA and built digest | Canonical manifest binds image digest, bundle commit, config schema, migration contract, workflow run, and release identity | Upload manifest artifact only after validation |
+| Invalid identity | Missing/malformed SHA, digest, image, or contract field | No release manifest is accepted or uploaded | Validator exits non-zero with field-specific diagnostics and no secret values |
+| Image mismatch | Built image cannot start or `/health/release/` does not report the triggering commit | Image is not pushed and no manifest is emitted | Workflow fails closed with container diagnostics |
+| Untrusted run | Failed, pull-request, or non-allowed branch workflow run | Publish job does not execute | Existing job condition remains the gate |
+
+</frozen-after-approval>
+
+## Code Map
+
+- `.github/workflows/deploy.yml:3` -- existing post-CI publisher; exact `workflow_run.head_sha` checkout and branch gate already exist, but build currently pushes before smoke validation and emits incomplete `release-metadata.json`.
+- `.github/workflows/django.yml:8` -- authoritative test/migration/static/deploy-check pipeline; publish must remain downstream of this successful push workflow rather than duplicate its application test suite.
+- `Dockerfile:1` -- digest-pinned Python and uv inputs, locked dependency install, production-shaped `collectstatic`/deploy checks, non-root runtime, and release build args; reuse its runtime image for smoke verification.
+- `mawareeth/ops_views.py:53` -- `/health/release/` exposes image-baked release and commit identity for the smoke assertion.
+- `mawareeth/tests.py:251` -- existing workflow contract tests; replace shallow snippet checks with manifest/publish invariants and edge-case tests.
+- `deploy/release_manifest.py` -- new dependency-free manifest builder/validator CLI; keep it independent of Django and suitable for CI and later host-side verification.
+- `deploy/tests/` -- existing deployment-tool test package and natural home for focused manifest unit tests.
+- `pyproject.toml:5` and `uv.lock:1` -- locked Python dependency graph; read-only evidence for reproducible application inputs.
+- `.dockerignore:1` -- excludes VCS, local secrets, runtime state, and planning artifacts from the image context; preserve these exclusions.
+
+## Tasks & Acceptance
+
+**Execution:**
+- [x] `deploy/release_manifest.py` -- add deterministic build/validate commands with strict SHA, OCI digest, schema-version, migration-contract, and no-unknown-field checks -- establish one reusable release contract for CI and later deployment.
+- [x] `deploy/tests/test_release_manifest.py` -- cover valid output, canonical image reference, malformed/missing inputs, unknown fields, deterministic serialization, and secret-free diagnostics -- fail closed at the contract boundary.
+- [x] `.github/workflows/deploy.yml` -- load the built image locally, smoke-test `/health/live/` and `/health/release/`, then push by immutable digest and generate/validate/upload `release-manifest.json` -- ensure the tested image is the published image and no manifest survives a failed gate.
+- [x] `mawareeth/tests.py` -- strengthen repository-level workflow/Docker contract assertions around exact-SHA checkout, no production build, immutable digest identity, smoke-before-push ordering, and manifest validation -- prevent CI configuration regressions.
+- [x] `deploy/README.md` -- document manifest fields, immutable pull reference, contract-version ownership, and explicit exclusion of secrets/host deployment -- give Stories 0.5/0.6 a stable consumer contract.
+
+**Acceptance Criteria:**
+- Given a successful allowed-branch `Django CI` push, when the publish workflow runs, then it builds the checked-out commit once, verifies that exact image locally, publishes it to GHCR, and uploads a validated release manifest whose image reference includes the returned OCI digest.
+- Given a release manifest, when validation runs, then the application digest, source/deployment commit, configuration schema, migration contract, workflow identity, and release identity are complete, canonical, mutually consistent, and contain no runtime secret material.
+- Given a failed CI run, disallowed event/branch, failed image build, failed smoke probe, identity mismatch, push failure, or invalid manifest, when the workflow evaluates the release, then no deployable manifest is published.
+- Given the repository at the approved baseline, when its focused unit tests and Django suite run, then locked dependency installation, static/deploy build gates, and existing application behavior remain intact.
+
+## Spec Change Log
+
+## Design Notes
+
+The deployment-bundle revision is the full triggering Git commit, not a second archive or mutable branch. That commit transitively identifies every tracked deployment file added by later stories while keeping this story independent of the future host runtime. The configuration schema and migration contract are explicit versioned release inputs; changing their meaning is a compatibility decision, not an incidental CI edit.
+
+## Verification
+
+**Commands:**
+- `uv run python -m unittest deploy.tests.test_release_manifest` -- all manifest unit and edge-case tests pass.
+- `uv run python manage.py test mawareeth.tests.WorkflowContractTests` -- workflow and image contract tests pass.
+- `uv run python manage.py test` -- full Django suite passes.
+- `docker build --build-arg RELEASE_VERSION=test-release --build-arg RELEASE_COMMIT_SHA=0123456789abcdef0123456789abcdef01234567 -t mawareeth:story-0-3 .` -- locked production image builds through static/deploy gates.
+- `docker run --rm mawareeth:story-0-3 python manage.py check --deploy --fail-level WARNING` with the documented production-shaped environment -- runtime deploy check remains clean.
diff --git a/deploy/release_manifest.py b/deploy/release_manifest.py
new file mode 100644
index 0000000..f53b450
--- /dev/null
+++ b/deploy/release_manifest.py
@@ -0,0 +1,168 @@
+import argparse
+import json
+import re
+import sys
+from pathlib import Path
+
+
+MANIFEST_VERSION = 1
+SHA_PATTERN = re.compile(r"[0-9a-f]{40}")
+DIGEST_PATTERN = re.compile(r"sha256:[0-9a-f]{64}")
+IMAGE_PATTERN = re.compile(
+    r"ghcr\.io/[a-z0-9]+(?:[._-][a-z0-9]+)*/"
+    r"[a-z0-9]+(?:[._/-][a-z0-9]+)*@sha256:[0-9a-f]{64}"
+)
+VERSION_PATTERN = re.compile(r"[a-z0-9]+(?:[._-][a-z0-9]+)*")
+MIGRATION_CONTRACT_PATTERN = re.compile(r"[a-z0-9]+(?:[._-][a-z0-9]+)*")
+WORKFLOW_RUN_PATTERN = re.compile(r"[1-9][0-9]*")
+
+EXPECTED_FIELDS = {
+    "": {"manifest_version", "release", "application", "deployment_bundle", "configuration", "database", "ci"},
+    "release": {"version", "commit_sha"},
+    "application": {"image", "digest"},
+    "deployment_bundle": {"git_sha"},
+    "configuration": {"schema_version"},
+    "database": {"migration_contract"},
+    "ci": {"workflow", "workflow_run_id"},
+}
+
+
+class ManifestError(ValueError):
+    pass
+
+
+def build_manifest(
+    *,
+    git_sha,
+    image_repository,
+    image_digest,
+    configuration_schema,
+    migration_contract,
+    workflow,
+    workflow_run_id,
+):
+    manifest = {
+        "manifest_version": MANIFEST_VERSION,
+        "release": {"version": git_sha, "commit_sha": git_sha},
+        "application": {
+            "image": f"{image_repository}@{image_digest}",
+            "digest": image_digest,
+        },
+        "deployment_bundle": {"git_sha": git_sha},
+        "configuration": {"schema_version": configuration_schema},
+        "database": {"migration_contract": migration_contract},
+        "ci": {"workflow": workflow, "workflow_run_id": workflow_run_id},
+    }
+    validate_manifest(manifest)
+    return manifest
+
+
+def validate_manifest(manifest):
+    if not isinstance(manifest, dict):
+        raise ManifestError("manifest must be a JSON object")
+
+    _validate_fields(manifest, "")
+    for section in EXPECTED_FIELDS:
+        if section:
+            value = manifest.get(section)
+            if not isinstance(value, dict):
+                raise ManifestError(f"{section} must be a JSON object")
+            _validate_fields(value, section)
+
+    if manifest["manifest_version"] != MANIFEST_VERSION:
+        raise ManifestError("manifest_version is unsupported")
+
+    commit_sha = manifest["release"]["commit_sha"]
+    if not _fullmatch(SHA_PATTERN, commit_sha):
+        raise ManifestError("release.commit_sha must be a lowercase 40-character Git SHA")
+    if manifest["release"]["version"] != commit_sha:
+        raise ManifestError("release.version must equal release.commit_sha")
+    if manifest["deployment_bundle"]["git_sha"] != commit_sha:
+        raise ManifestError("deployment_bundle.git_sha must equal release.commit_sha")
+
+    digest = manifest["application"]["digest"]
+    if not _fullmatch(DIGEST_PATTERN, digest):
+        raise ManifestError("application.digest must be a sha256 OCI digest")
+    image = manifest["application"]["image"]
+    if not _fullmatch(IMAGE_PATTERN, image):
+        raise ManifestError("application.image must be a canonical lowercase GHCR digest reference")
+    if not image.endswith(f"@{digest}"):
+        raise ManifestError("application.image must end with application.digest")
+
+    if not _fullmatch(VERSION_PATTERN, manifest["configuration"]["schema_version"]):
+        raise ManifestError("configuration.schema_version has an invalid format")
+    if not _fullmatch(MIGRATION_CONTRACT_PATTERN, manifest["database"]["migration_contract"]):
+        raise ManifestError("database.migration_contract has an invalid format")
+    if manifest["ci"]["workflow"] != "Django CI":
+        raise ManifestError("ci.workflow must identify the validated workflow")
+    if not _fullmatch(WORKFLOW_RUN_PATTERN, manifest["ci"]["workflow_run_id"]):
+        raise ManifestError("ci.workflow_run_id must be a positive integer string")
+
+
+def serialize_manifest(manifest):
+    validate_manifest(manifest)
+    return json.dumps(manifest, indent=2, sort_keys=True) + "\n"
+
+
+def load_manifest(path):
+    try:
+        return json.loads(Path(path).read_text(encoding="utf-8"))
+    except (OSError, json.JSONDecodeError) as error:
+        raise ManifestError("manifest could not be read as JSON") from error
+
+
+def _validate_fields(value, section):
+    actual = set(value)
+    expected = EXPECTED_FIELDS[section]
+    if actual != expected:
+        location = section or "manifest"
+        raise ManifestError(f"{location} fields do not match the release contract")
+
+
+def _fullmatch(pattern, value):
+    return isinstance(value, str) and pattern.fullmatch(value) is not None
+
+
+def parse_args(argv=None):
+    parser = argparse.ArgumentParser(description="Build or validate an immutable release manifest.")
+    subparsers = parser.add_subparsers(dest="command", required=True)
+
+    build = subparsers.add_parser("build")
+    build.add_argument("--git-sha", required=True)
+    build.add_argument("--image-repository", required=True)
+    build.add_argument("--image-digest", required=True)
+    build.add_argument("--configuration-schema", required=True)
+    build.add_argument("--migration-contract", required=True)
+    build.add_argument("--workflow", required=True)
+    build.add_argument("--workflow-run-id", required=True)
+    build.add_argument("--output", required=True)
+
+    validate = subparsers.add_parser("validate")
+    validate.add_argument("--input", required=True)
+    return parser.parse_args(argv)
+
+
+def main(argv=None):
+    args = parse_args(argv)
+    try:
+        if args.command == "build":
+            manifest = build_manifest(
+                git_sha=args.git_sha,
+                image_repository=args.image_repository,
+                image_digest=args.image_digest,
+                configuration_schema=args.configuration_schema,
+                migration_contract=args.migration_contract,
+                workflow=args.workflow,
+                workflow_run_id=args.workflow_run_id,
+            )
+            Path(args.output).write_text(serialize_manifest(manifest), encoding="utf-8")
+        else:
+            validate_manifest(load_manifest(args.input))
+    except ManifestError as error:
+        print(f"release manifest error: {error}", file=sys.stderr)
+        return 2
+    return 0
+
+
+if __name__ == "__main__":
+    raise SystemExit(main())
diff --git a/deploy/tests/test_release_manifest.py b/deploy/tests/test_release_manifest.py
new file mode 100644
index 0000000..2d9a242
--- /dev/null
+++ b/deploy/tests/test_release_manifest.py
@@ -0,0 +1,111 @@
+import copy
+import json
+import tempfile
+import unittest
+from contextlib import redirect_stderr
+from io import StringIO
+from pathlib import Path
+
+from deploy import release_manifest
+
+
+GIT_SHA = "0123456789abcdef0123456789abcdef01234567"
+IMAGE_DIGEST = "sha256:" + ("a" * 64)
+
+
+class ReleaseManifestTests(unittest.TestCase):
+    def build_manifest(self):
+        return release_manifest.build_manifest(
+            git_sha=GIT_SHA,
+            image_repository="ghcr.io/example/mawareeth",
+            image_digest=IMAGE_DIGEST,
+            configuration_schema="1",
+            migration_contract="expand-migrate-contract-v1",
+            workflow="Django CI",
+            workflow_run_id="12345",
+        )
+
+    def test_builds_complete_canonical_manifest(self):
+        manifest = self.build_manifest()
+
+        self.assertEqual(manifest["release"]["commit_sha"], GIT_SHA)
+        self.assertEqual(manifest["deployment_bundle"]["git_sha"], GIT_SHA)
+        self.assertEqual(
+            manifest["application"]["image"],
+            f"ghcr.io/example/mawareeth@{IMAGE_DIGEST}",
+        )
+        self.assertEqual(manifest["configuration"]["schema_version"], "1")
+        self.assertEqual(manifest["database"]["migration_contract"], "expand-migrate-contract-v1")
+
+    def test_serialization_is_deterministic(self):
+        expected = release_manifest.serialize_manifest(self.build_manifest())
+
+        self.assertEqual(release_manifest.serialize_manifest(self.build_manifest()), expected)
+        self.assertTrue(expected.endswith("\n"))
+
+    def test_rejects_missing_and_unknown_fields(self):
+        for mutation in ("missing", "unknown"):
+            with self.subTest(mutation=mutation):
+                manifest = self.build_manifest()
+                if mutation == "missing":
+                    del manifest["configuration"]["schema_version"]
+                else:
+                    manifest["secret"] = "must-not-be-accepted"
+                with self.assertRaisesRegex(release_manifest.ManifestError, "fields"):
+                    release_manifest.validate_manifest(manifest)
+
+    def test_rejects_malformed_or_inconsistent_identity(self):
+        changes = (
+            (("release", "commit_sha"), "not-a-sha", "release.commit_sha"),
+            (("release", "version"), "different", "release.version"),
+            (("deployment_bundle", "git_sha"), "f" * 40, "deployment_bundle.git_sha"),
+            (("application", "digest"), "sha256:short", "application.digest"),
+            (("application", "image"), "ghcr.io/example/mawareeth:latest", "application.image"),
+            (("configuration", "schema_version"), "", "configuration.schema_version"),
+            (("database", "migration_contract"), "unsafe contract", "database.migration_contract"),
+        )
+        for path, value, message in changes:
+            with self.subTest(path=path):
+                manifest = self.build_manifest()
+                manifest[path[0]][path[1]] = value
+                with self.assertRaisesRegex(release_manifest.ManifestError, message):
+                    release_manifest.validate_manifest(manifest)
+
+    def test_cli_build_and_validate_round_trip(self):
+        with tempfile.TemporaryDirectory() as directory:
+            output = Path(directory) / "release-manifest.json"
+            result = release_manifest.main(
+                [
+                    "build",
+                    "--git-sha", GIT_SHA,
+                    "--image-repository", "ghcr.io/example/mawareeth",
+                    "--image-digest", IMAGE_DIGEST,
+                    "--configuration-schema", "1",
+                    "--migration-contract", "expand-migrate-contract-v1",
+                    "--workflow", "Django CI",
+                    "--workflow-run-id", "12345",
+                    "--output", str(output),
+                ]
+            )
+
+            self.assertEqual(result, 0)
+            self.assertEqual(release_manifest.main(["validate", "--input", str(output)]), 0)
+            self.assertEqual(json.loads(output.read_text(encoding="utf-8")), self.build_manifest())
+
+    def test_cli_error_does_not_echo_untrusted_values(self):
+        secret = "super-secret-runtime-token"
+        manifest = copy.deepcopy(self.build_manifest())
+        manifest["secret"] = secret
+        with tempfile.TemporaryDirectory() as directory:
+            path = Path(directory) / "invalid.json"
+            path.write_text(json.dumps(manifest), encoding="utf-8")
+            stderr = StringIO()
+            with redirect_stderr(stderr):
+                result = release_manifest.main(["validate", "--input", str(path)])
+
+        self.assertEqual(result, 2)
+        self.assertNotIn(secret, stderr.getvalue())
+
+
+if __name__ == "__main__":
+    unittest.main()


Do not invoke any skill. If the instruction file is unreadable, report that exact failure and stop. Return only the review result.

