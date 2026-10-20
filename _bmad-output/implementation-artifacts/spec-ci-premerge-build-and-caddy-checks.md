---
title: 'Pre-merge CI checks: build the release image and validate the Caddyfile with the pinned Caddy'
type: 'chore'
created: '2026-10-20'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'e9b5f8bff6f8a9bccc98a1f5ae68b276a8a90396'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-0-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Two deploy artifacts are only checked by text tests before merge. The Dockerfile's build-time `collectstatic && check --deploy --fail-level WARNING` runs only in the post-merge `Publish Release Image` workflow, so a broken build surfaces on the release branch. `deploy/Caddyfile` is only grepped, so a syntax or directive mistake surfaces as a failed `caddy reload` (exit 6) on the host.

**Approach:** Add two jobs to `Django CI` (runs on push and pull_request): one builds the full release image with no push, the other runs `caddy validate` on `deploy/Caddyfile` with the digest-pinned Caddy image from `deploy/runtime-images.lock`, for both the blue and the green route. Resolves deferred-work entries for 0-2 (Dockerfile build on PRs) and pre-cutover-deploy-safety (Caddyfile validation).

## Boundaries & Constraints

**Always:**
- Pin every new third-party action to a 40-hex commit SHA, reusing the SHAs already in `deploy.yml`.
- Read the Caddy image reference from `deploy/runtime-images.lock`; never hard-code a second copy of the tag or digest.
- New jobs get `permissions: contents: read` and a `timeout-minutes`.
- The Caddy check must prove it can fail: a deliberately broken copy of the Caddyfile must be rejected in the same job.
- Any failure fails `Django CI`, so `Publish Release Image` does not publish.

**Ask First:**
- Adding a registry login, a build cache (`type=gha` or similar), or any secret to `Django CI`.
- Changing `deploy.yml`, the Dockerfile, the Caddyfile or the route content.

**Never:**
- Push or tag images from `Django CI`.
- Give the Caddy validation container network access (`--network none` after the pull).
- Replace the existing text contract tests in `deploy/tests/test_compose_runtime.sh`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid tree | Current Dockerfile, Caddyfile, seed route | Both jobs pass; Caddy validates with blue and with green route | N/A |
| Build-only env var missing | `check --deploy` warns or `collectstatic` fails in the builder stage | Image build job fails on the PR | Docker build log shows the Django error |
| Invalid Caddyfile | Unknown directive or bad syntax | `caddy validate` exits non-zero; job fails | Caddy error printed in the job log |
| Lock line malformed or missing | No `CADDY_IMAGE=…@sha256:<64 hex>` line | Job fails before pulling | `::error::` naming the lock file |
| Self-test | Broken copy of the Caddyfile | Validation must fail; if it passes, the job fails | `::error::` that the check accepts invalid config |

</frozen-after-approval>

## Code Map

- `.github/workflows/django.yml` -- `Django CI`; jobs `validate` and `deploy-shell` (pattern: `permissions`, `timeout-minutes`, `::group::`/`::error::`). Add the two new jobs here.
- `.github/workflows/deploy.yml` -- read-only reference: pinned `docker/setup-buildx-action@8d2750c…` and `docker/build-push-action@10e90e3…` with `build-args` `RELEASE_VERSION`/`RELEASE_COMMIT_SHA`.
- `Dockerfile` -- read-only; `builder` stage runs `collectstatic && check --deploy`; `runtime` stage is the default target.
- `deploy/runtime-images.lock` -- `CADDY_IMAGE=docker.io/library/caddy:2.11.4@sha256:…`; `deploy/runtime.sh:93` parses lines with `^(CADDY_IMAGE|POSTGRES_IMAGE|RESTIC_IMAGE)=([^[:space:]]+)$`.
- `deploy/Caddyfile` -- uses `{$DOMAIN:…}` and `import /etc/caddy/routes/*.caddy`; `deploy/compose.yaml:65-80` mounts it at `/etc/caddy/Caddyfile` and routes at `/etc/caddy/routes`.
- `deploy/caddy/active-slot.caddy` -- canonical blue route; `deploy/runtime.sh:347` (`route_content`) shows green differs only by the slot name (`app-green`, header `green`).
- `mawareeth/tests.py:366` -- `WorkflowContractTests`; `test_workflows_pin_third_party_actions` already enforces SHA pins for `django.yml`.
- `deploy/README.md:307` -- describes `Django CI`'s `deploy-shell` job; add the new jobs alongside.
- `_bmad-output/implementation-artifacts/deferred-work.md:47,124` -- entries to mark `resolved_by`.

## Tasks & Acceptance

**Execution:**
- [x] `.github/workflows/django.yml` -- add job `image-build`: checkout, setup-buildx, build-push-action with `context: .`, `push: false`, no `load`, build-args `RELEASE_VERSION=ci` and `RELEASE_COMMIT_SHA=${{ github.sha }}` -- runs the Dockerfile's Django checks before merge.
- [x] `.github/workflows/django.yml` -- add job `caddy-config`: parse `CADDY_IMAGE` from the lock (require `@sha256:` + 64 hex), `docker pull` it, then for `blue` and `green` render the route from the seed (substitute the slot name), and run `docker run --rm --network none -e DOMAIN=ci.example.com` with the Caddyfile and route dir mounted read-only at the compose paths, `caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`; finally run the broken-copy self-test -- catches Caddyfile errors with the production Caddy version.
- [x] `mawareeth/tests.py` -- extend `WorkflowContractTests` with a test asserting `django.yml` contains the image build (`push: false`, no `push: true`) and the Caddy validation reading `deploy/runtime-images.lock` with `caddy validate` and `--network none` -- keeps the gates from being silently removed.
- [x] `deploy/README.md` -- document both jobs next to the `deploy-shell` paragraph.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- add `resolved_by: \`_bmad-output/implementation-artifacts/spec-ci-premerge-build-and-caddy-checks.md\`` under the two resolved entries.

**Acceptance Criteria:**
- Given a pull request, when `Django CI` runs, then `image-build` and `caddy-config` both run and must pass for the workflow to succeed.
- Given `django.yml`, when `WorkflowContractTests` runs, then every `uses:` is SHA-pinned and the new contract test passes.

## Design Notes

The jobs run `caddy adapt --validate`, which performs the same validation as `caddy validate` (adapt, then provision modules without starting servers) and also emits the JSON, so CI can assert the slot's `"dial":"app-<slot>:8000"` upstream. Review found that an `import` glob matching no file is not a Caddy error, so validation alone could pass with no route loaded. Green route rendering: `sed 's/blue/green/g' deploy/caddy/active-slot.caddy` — the seed is verified by `runtime.sh` to equal `route_content blue`, which only varies by slot name. Building the full image (default `runtime` target) covers the builder-stage checks plus runtime-stage failures, at little extra cost.

## Verification

**Commands:**
- `uv run python manage.py test mawareeth.tests.WorkflowContractTests` -- expected: all pass (needs the CI-style env vars from `django.yml`).
- `docker run --rm --network none -e DOMAIN=ci.example.com -v "$PWD/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" -v "<routes dir>:/etc/caddy/routes:ro" <CADDY_IMAGE> caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile --validate` -- expected: JSON containing `"dial":"app-blue:8000"` (if Docker is available locally).
- `actionlint .github/workflows/django.yml` -- expected: no findings (if installed).

## Suggested Review Order

**Caddyfile validated with the production Caddy**

- Entry point: every slot route is adapted and validated offline, with the compose mount paths.
  [`django.yml:201`](../../.github/workflows/django.yml#L201)

- Proves the route import loaded; an empty glob is not a Caddy error.
  [`django.yml:231`](../../.github/workflows/django.yml#L231)

- Image reference comes only from the lock, digest-pinned, CRLF-tolerant.
  [`django.yml:168`](../../.github/workflows/django.yml#L168)

- Self-test: a broken copy must be rejected for the injected directive.
  [`django.yml:237`](../../.github/workflows/django.yml#L237)

**Release image built before merge**

- Full image build, no push or load, runs the Dockerfile's Django gates on PRs.
  [`django.yml:137`](../../.github/workflows/django.yml#L137)

**Peripherals**

- Contract test keeps both gates, offline runs and lock sourcing in place.
  [`tests.py:428`](../../mawareeth/tests.py#L428)

- Operator docs for the two jobs.
  [`README.md:309`](../../deploy/README.md#L309)

- Deferred entries marked resolved.
  [`deferred-work.md:49`](deferred-work.md#L49)
