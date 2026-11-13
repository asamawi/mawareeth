---
title: 'Version 3.0 and automatic patch numbering'
type: 'chore'
created: '2026-11-06'
status: 'done'
baseline_commit: 'f0689bdda085ab7849e9503af4944e8842f4cc8e'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The app version is typed by hand in `mawareeth/settings.py` (2.0.1) and no release is tagged. The new product needs to be marked 3.0, with numbering that no longer depends on anyone remembering to edit it.

**Approach:** A `VERSION` file holds a hand-edited `major.minor`. The publish workflow derives the patch by counting first-parent `master` commits since the first-parent commit that last changed `VERSION`, so `development` history merged in does not inflate it and the epic merge itself is `3.0.0`. It bakes the result into the image as `APP_VERSION` and tags each published release. The owner chose this over Release Please on 2026-11-06.

## Boundaries & Constraints

**Always:** `RELEASE_VERSION` and `RELEASE_COMMIT_SHA` stay the commit SHA, because the smoke test and deploy compare them to the commit. Rebuilding a commit gives the same number. `VERSION` says `3.0` on `development` only. Production shows 3.0 when the epics merge to `master` (owner decision, 2026-11-06); this work stays on `development` under the no-push rule, so until then `master` keeps its hand-set `2.0.1`, unchanged by fixes.

**Ask First:** Changing `VERSION` on `master` before the epics merge.

**Never:** Pushing `development`. Tagging a release that failed its smoke test or push.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First release of a line | Merge commit that brings `VERSION` `3.0` to `master`, with many commits on the merged branch | `3.0.0` | N/A |
| Later release | Three first-parent commits after that merge | `3.0.3` | N/A |
| Local or test run | No `APP_VERSION` set | `<VERSION>.0-dev` | N/A |
| Malformed `VERSION` | Anything but `major.minor` | Publish fails before pushing | Non-zero exit |
| Tag already exists | Workflow rerun for the same commit | Same number, no second tag, run succeeds | Fails if the tag points at another commit |

</frozen-after-approval>

## Code Map

- `mawareeth/settings.py:14-18` -- hand-set version constants; `RELEASE_VERSION` defaults to `APP_VERSION`.
- `mawareeth/context_processors.py`, `calc/templates/calc/base.html:38` -- version shown in every page title.
- `mawareeth/ops_views.py:92` -- `/health/release/` reports `version` and `release`.
- `Dockerfile:3,35,46,52,60` -- `RELEASE_VERSION` build arg handling to mirror.
- `.github/workflows/deploy.yml:27-30` -- checkout is shallow and needs full history; `permissions` lacks `contents: write`, which tagging needs.

## Tasks & Acceptance

**Execution:**
- [x] `VERSION` -- Create with `3.0`.
- [x] `deploy/version.sh` and `deploy/tests/` -- Derive and validate the number; cover the matrix.
- [x] `mawareeth/settings.py` and `mawareeth/tests.py` -- Read `APP_VERSION` from the environment, falling back to `<VERSION>.0-dev`.
- [x] `Dockerfile` -- Add the `APP_VERSION` build arg to both stages; include `VERSION` in the image.
- [x] `.github/workflows/deploy.yml` -- Fetch full history, derive the version, pass the build arg, assert it in the smoke test, tag after a successful push.
- [x] `deploy/README.md` -- Explain how numbers are derived and how to change `major.minor`.

**Acceptance Criteria:**
- Given a published image, when `/health/release/` is read directly from the slot, then `version` is the derived number and `release` is still the commit SHA.
- Given a successful publish, when tags are listed, then `v<version>` points at the published commit.

## Spec Change Log

## Verification

**Commands:**
- `uv run python manage.py test` -- expected: all pass.
- `bash deploy/tests/test_version.sh` -- expected: all matrix cases pass.

## Suggested Review Order

**How a number is derived**

- Entry point: the first-parent count that makes the epic merge `3.0.0`.
  [`version.sh:21`](../../deploy/version.sh#L21)

- The hand-edited `major.minor` that starts each line.
  [`VERSION`](../../VERSION)

**Publishing and tagging**

- Numbers the image and refuses a collision before anything is pushed.
  [`deploy.yml:39`](../../.github/workflows/deploy.yml#L39)

- Separate job holds the only repository write token, after a complete publish.
  [`deploy.yml:187`](../../.github/workflows/deploy.yml#L187)

- Idempotent for reruns, and a failed lookup or push is a failure.
  [`version.sh:52`](../../deploy/version.sh#L52)

**Running application**

- Baked value first, then a strictly validated development fallback.
  [`settings.py:18`](../../mawareeth/settings.py#L18)

- An empty default lets images built without the argument use that fallback.
  [`Dockerfile:18`](../../Dockerfile#L18)

**Tests and docs**

- Rejected pushes, lost races and shallow tagging run against real git.
  [`test_version.sh:163`](../../deploy/tests/test_version.sh#L163)

- A bad `VERSION` fails in validation, before it reaches `master`.
  [`tests.py:75`](../../mawareeth/tests.py#L75)

- Operator rules: merge commits, reverts, number gaps and tag recovery.
  [`README.md:891`](../../deploy/README.md#L891)
