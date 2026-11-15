---
title: 'Legacy saved calculations appear in My saved cases'
type: 'feature'
created: '2026-11-13'
status: 'done'
baseline_revision: 'a0811c92bc7bf67e8398b23d4aef9b03afcfc6dd'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Users' calculations saved in the legacy Django app (`calc.Calculation` trees) do not appear in the Next.js "My saved cases" page, which lists only `api.SavedCase` rows, so registered users seem to have lost their work.

**Approach:** A one-time data migration converts every owned legacy root calculation (with its successive-death layers) into a `SavedCase` snapshot for the same owner, in the exact shape `export_snapshot` produces, and reports each calculation it cannot convert instead of dropping it. Legacy rows, views and URLs stay untouched.

## Boundaries & Constraints

**Always:**
- Convert only root calculations (`parent` is null) with a non-null `user`; the owner of the `SavedCase` is that user. Calculations without a user are skipped and only counted.
- `madhab` is `hanbali` for every converted case: the school was never stored, and the legacy engine and results pages compute and label every result as Hanbali (`calc/schools.py:18`).
- A snapshot is accepted only if it survives the live parser unchanged: `export_snapshot(read_snapshot(snapshot, ...)) == snapshot`, with a deceased and at least one root heir. Anything else is reported, not written.
- The relationship comes from the heir's polymorphic class (`calc/proof.py` `RELATIONSHIPS` names); gender comes from `anonymous_case.RELATIONSHIPS`, never from the legacy `sex` field. The deceased's gender comes from its `sex` (`M`/`F`).
- Heir ids are `h1`, `h2`, … in one sequence across the whole tree (root heirs by pk, then each layer in `death_order`, heirs by pk).
- Each report line names the legacy calculation pk, the owner pk and a short reason; the migration ends with one summary line (converted, reported, ownerless). It prints nothing when there are no legacy calculations.
- Reverse migration is a no-op.

**Block If:** converting would require changing `SavedCase`'s schema, the snapshot format, or the parser in `api/anonymous_case.py`.

**Never:** Do not modify or delete `calc` rows, views, templates or URLs (old calculation URLs and their redirects belong to the later "retire legacy pages" item). Do not add a title or legacy-source field to `SavedCase`. Do not guess a school other than `hanbali`. Do not truncate names to make them fit.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Simple case | user U; deceased `M`, estate 120000; Wife, Son "Ali" (first) + "Hasan" (last) | one SavedCase for U: `{"madhab":"hanbali","deceased":{"gender":"male","estate":"120000"},"heirs":[{"id":"h1","relationship":"wife","gender":"female","name":null},{"id":"h2","relationship":"son","gender":"male","name":"Ali Hasan"}],"deaths":[]}`, `schema_version` 1 | N/A |
| Empty names | heir with blank first and last name | `"name": null` | N/A |
| Zero estate | deceased estate 0 or negative | `"estate": null` | N/A |
| Layered | root + layer (`parent`=root, deceased.`heir`=root son h2, `death_order` 2) with a heir whose `same_person` is root heir h3 | `deaths:[{"heir_id":"h2","order":2,"gender":"male","heirs":[{"id":"h4",…,"same_as":"h3"}]}]` | N/A |
| Ownerless | `user` null | no SavedCase | counted as ownerless |
| No heirs / no deceased / two root deceased / blank deceased sex | — | no SavedCase | reported, e.g. `no heirs` |
| Unknown class | heir row whose class has no relationship id (bare `Heir`) | no SavedCase | reported `unknown relationship` |
| Name too long or invalid | joined name > 100 chars or rejected by `clean_name` | no SavedCase | reported `invalid name` |
| Parser rejects | >50 heirs in a layer, >2 later deaths, broken death order, link the parser drops | no SavedCase | reported `not representable` |

</intent-contract>

## Code Map

- `calc/models.py:83-96` -- `Person` (PolymorphicModel; `sex`, `first_name`, `last_name`, `polymorphic_ctype`).
- `calc/models.py:258` -- `Calculation`: `parent` (related_name `layers`), `user`, `name`; no school, no timestamps.
- `calc/models.py:978-990` -- `Deceased` (`heir` FK → earlier heir, `death_order`, integer `estate`, `calc`); `Heir` (`calc`, `same_person`).
- `calc/proof.py:60-70` -- `RELATIONSHIPS`: engine class name → relationship id (all 23).
- `api/anonymous_case.py:20-50` -- `RELATIONSHIPS` (id → gender), `MAX_HEIRS`, `MAX_NAME_LENGTH`; `clean_name:137`, `clean_estate:85`.
- `api/anonymous_case.py:248` -- `read_snapshot` (permissive: drops what it rejects — hence the round-trip check); `_read_deaths:376` (≤2 later deaths, orders 2/3, canonical targets, `same_as` rules); `export_snapshot:671`.
- `api/models.py:5` -- `SavedCase(owner, snapshot, schema_version=1, created_at, updated_at)`.
- `api/views.py:230-270` -- list (`schema_version=1`, dict snapshots) and open (`load_snapshot`) — migrated rows need no view change.
- `api/migrations/0003_invites.py` -- latest api migration; `calc/migrations/0028_manasikhat.py` latest calc migration.
- `user_auth/migrations/add_profiles.py` -- existing RunPython data-migration precedent.
- `calc/tests.py:1552` `build_case`, `calc/tests.py:3264` `build_layer` -- legacy fixture factories to reuse.
- `api/tests.py:3052` `SavedCaseTests`, `api/tests.py:537` `InterviewHelpers` -- list/open/preview helpers.

## Tasks & Acceptance

**Execution:**
- `api/legacy_cases.py` -- new: `convert(calc, ContentType, Heir, Deceased)` → snapshot dict or raises `Unconvertible(reason)`; `import_all(Calculation, ...)` creates SavedCases and returns (converted, report lines, ownerless). Takes model classes as arguments so the migration passes historical models and tests pass live ones; resolves relationships via `ContentType.model` lowercased against `calc/proof.py` names -- keeps logic testable outside the migration.
- `api/migrations/0004_import_legacy_calculations.py` -- new RunPython (reverse noop) depending on `api.0003_invites`, `calc.0028_manasikhat`, `contenttypes`; calls `import_all` with `apps.get_model` models and prints the report and summary -- the one-time conversion.
- `api/test_legacy_cases.py` -- new: every I/O matrix row using `build_case`/`build_layer`; that `import_all` writes nothing for reported cases; that legacy rows are unchanged afterwards; that the migrated case is listed by `GET /api/v1/saved-cases/` and opens via `POST /api/v1/saved-cases/<id>/open/` for its owner only; that the preview of an opened simple migrated case gives the same per-heir fractions as legacy `compute()` (Hanbali) -- covers the matrix and the end-to-end surface.

**Acceptance Criteria:**
- Given a user with a legacy saved calculation, when the migration has run and they open My saved cases, then the case is listed with school Hanbali and its root heir count, and opening it loads the same deceased, heirs, names and later deaths.
- Given another user, when they request the list or try to open that SavedCase, then it is not listed and opening returns 404.
- Given legacy calculations that cannot be converted, when the migration runs, then each is named in the output with its reason, no SavedCase is created for it, and its legacy rows are unchanged.
- Given no legacy calculations (fresh test database), when migrations run, then the migration prints nothing and creates nothing.

## Spec Change Log

## Review Triage Log

### 2026-11-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 0, low 2)
- defer: 0
- reject: 16 (high 0, medium 1, low 15)
- addressed_findings:
  - `[low]` `[patch]` A later death's gender came from the legacy deceased's `sex`, so a stale value made a valid tree "not representable"; it now follows the target heir's relationship (`api/legacy_cases.py`).
  - `[low]` `[patch]` No test covered a chained `same_person` link (layer 3 → layer 2 → root); added `test_chained_link_and_later_death_gender`.

## Design Notes

The parser is permissive, so validating with it alone would silently drop rows. The round-trip equality rule turns every silent drop into a reported failure without duplicating the parser's rules. A death target that is a later-layer row linked by `same_person` maps to the identity it stands for (its `same_person`'s id) before the round-trip check.

Lost on purpose (no place in the snapshot): calculation name, deceased name, later deceaseds' estates, stored results. `updated_at` becomes the migration time.

## Verification

**Commands:**
- `uv run python manage.py test api.test_legacy_cases --noinput` -- expected: all pass.
- `uv run python manage.py test api.tests.SavedCaseTests --noinput` -- expected: all pass.
- `uv run python manage.py makemigrations --check --dry-run` -- expected: no changes.

## Auto Run Result

Status: done

**Summary:** A one-time data migration (`api.0004_import_legacy_calculations`) converts every owned legacy root calculation, with its successive-death layers, into a `SavedCase` for the same owner. The snapshot uses `export_snapshot`'s shape with school `hanbali`. A snapshot is written only if it survives `read_snapshot` → `export_snapshot` unchanged. Every calculation that cannot be converted is printed with its pk, owner and reason, followed by one summary line. Legacy rows, views and URLs are unchanged.

**Files changed:**
- `api/legacy_cases.py` -- `convert()` (legacy tree → snapshot or `Unconvertible`) and `import_all()`; it takes model classes as arguments so the migration can pass its historical models.
- `api/migrations/0004_import_legacy_calculations.py` -- RunPython (reverse no-op) that prints the report and summary; it prints nothing when there are no legacy calculations.
- `api/test_legacy_cases.py` -- 6 tests: the I/O matrix, owner isolation through the list/open API, Hanbali fraction equivalence with legacy `compute()`, layered and chained links, and the migration run against historical models.

**Review:** 18 findings. 2 low patches were applied (listed above), 0 were deferred and 16 were rejected. Most rejections were decisions the spec already made (Hanbali, no-op reverse, ownerless counted only, gender from relationship). The rest were noise for the data size (query batching, streaming reports) or were already covered (the mixed batch in the migration test).

**Follow-up review recommendation:** false. Patched: high 0, medium 0, low 2, so the score is 3×0 + 2 = 2 < 5.

**Verification:** `uv run python manage.py test api.test_legacy_cases api.tests.SavedCaseTests --noinput` -- 14 tests OK. `uv run python manage.py makemigrations --check --dry-run` -- no changes.

**Residual risks:**
- The migration has not been run against production data. The number of reported calculations is unknown until `migrate` runs on deploy, and the report appears only in that output.
- Lost on purpose: calculation titles, deceased names, later estates and stored results.
- The Next.js page was not exercised in a browser; it is covered through the API.
