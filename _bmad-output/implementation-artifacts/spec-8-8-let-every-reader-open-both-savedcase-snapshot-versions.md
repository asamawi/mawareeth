---
title: 'Story 8.8: Let every reader open both SavedCase snapshot versions'
type: 'feature'
created: '2026-11-17'
status: 'done'
baseline_revision: '1e632a9bf98fbf2350aea05e73a0051055ee9669'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** Every Case reader accepts only snapshot schema 1. These readers are the session, the SavedCase list and open, shares, received invites and the PDFs. `api/views.py:233,274,351,454` filter or reject everything else. Release N+1 (story 8.10) will write schema 2. If that release is rolled back to this image, Saved cases will vanish from My cases and shares will break. No schema 2 document is defined yet, and no test round-trips real phase-1 or legacy snapshots through the 8.1 contracts. That test was deferred from 8.1 to this story.

**Approach:** Define the schema 2 snapshot from the 8.1 Family and Basis contracts. Add one shared decoder, `api/snapshots.py`. It turns schema 1 or 2 into the existing in-memory case dict, or raises a typed `SnapshotError`. Route every reader through it, and add a schema 2 encoder that only tests use for now. Writers still emit schema 1. Prove the reader/writer matrix with fixtures, including real `api/test_legacy_cases.py` conversions.

## Boundaries & Constraints

**Always:**
- The schema 2 document is exactly `{"deceased": {"gender": "male"|"female"} | null, "family": <Family v1 per engine/contracts/family.py>, "basis": <Basis v1>}`.
  - Any extra or missing top-level key is `invalid_snapshot`.
  - The schema 2 estate lives in `family.estate`, where `amount_minor` is null when there is no estate. Its currency is `{code:"SAR", explicit:true}` when an amount is present and null otherwise. This follows the 8.7 rule for phase-1 bare decimals.
  - The Family root id is `"root"`. Persons and estates follow `calc/adapters.py` `family_from_session`: the first estate's heirs, then later estates whose deceased has `status:"died_later"` with its `death_order`. A row with `same_as` is the same person, and edges, answers, gifts and bequests are empty.
  - A SavedCase's version is its `schema_version` column. A session case is schema 2 only when its dict has `"schema_version": 2`, next to `id` and `started_at`. With no key, or with `1`, it is schema 1.
- `decode(version, snapshot, case_id, started_at)` returns the same dict shape `anonymous_case.read_snapshot` returns today.
  - Schema 1 goes through `read_snapshot` unchanged, so it keeps the current lenient drop-invalid behaviour. A non-dict schema 1 snapshot from a SavedCase is `invalid_snapshot`.
  - Schema 2 is strict:
    - It is parsed with `parse_family`/`resolve_basis(..., {})`. A malformed Family or Basis is `invalid_snapshot`/`invalid_basis`, and a country Basis is `preset_unavailable`. These are the ContractError codes.
    - Content this release cannot carry back to schema 1 unchanged is `unsupported_content`. This covers non-empty edges, answers, gifts or bequests, any `died_before_or_with` person, a currency other than SAR explicit, and an amount with no deceased.
    - After conversion, `encode_v2(export_snapshot(case), …)` must equal the input. Any difference is `unsupported_content`, so nothing is silently dropped or changed.
  - Any version other than 1 or 2 is `unsupported_version`.
- The Basis comes from `basis_for_snapshot` semantics. Only a schema 1 snapshot with no `basis` key uses the madhab fallback: a valid madhab gives a school, and anything else gives compare. Schema 2 school maps to `madhab=<school>` and compare maps to `madhab=None`.
- Ownership, revocation, expiry, visibility/sign-in and throttle checks run before decoding, exactly as today. The stored snapshot and `schema_version` are never written by any reader.
- Writers are unchanged. `SavedCasesView.post` still writes `schema_version=1` with `export_snapshot`. Session writes still store the schema 1 dict, so editing a decoded schema 2 session rewrites it as schema 1, which is lossless by the rule above.

**Never:** Change any writer to emit schema 2. Add a migration, a revision or name column, a command service or Country writes. Edit `engine/contracts/*`, `contracts/manifest.json` or fixtures under `contracts/fixtures/`. Change web code (the error bodies are additive keys on existing status codes). Change user-facing translation text.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Phase-1 row | SavedCase v1, madhab `hanbali`, later deaths with `same_as` | Listed, opened, shared and received exactly as before | — |
| Schema 2 row | v2 doc encoded from the same case | Listed with the same `madhab`/`heir_count`; open loads a session whose `export_snapshot` equals the v1 snapshot (estate compared by Decimal value; alias row ids may differ, person ids may not) | — |
| Legacy no-basis v1 | `madhab` missing, `"x"` or `jafari` | compare / compare / school jafari | — |
| Malformed v2 Basis | `basis: {"kind":"school"}` | open → 400, share/received view+report → 404, session → 422, each with body `{"detail", "code":"invalid_basis"}`; row untouched | typed error |
| Country v2 Basis | `{"kind":"country",…}` | as above with `code:"preset_unavailable"` | typed error |
| Unknown version | `schema_version=3` (row) or `3` (session) | as above with `code:"unsupported_version"`; not listed in My cases; stored snapshot byte-identical afterwards | typed error |
| Unrepresentable v2 | non-empty `gifts`, USD currency | `code:"unsupported_content"` | typed error |
| Session v2 | session dict `{"id","started_at","schema_version":2,…}` | GET /case returns the decoded case; a later edit stores schema 1 | — |
| Unreadable session | session `schema_version: 3` | GET/edits/draft PDF → 422 typed; POST /case with `replace:true` starts a new case; without it → 422 | typed error |
| Revoked/expired share or invite of a v2 row | — | the existing 404 unavailable body (checks precede decoding) | — |

</intent-contract>

## Code Map

- `api/anonymous_case.py:236` `get` (session reader; every session view and the draft PDF go through it), `:248` `read_snapshot` (the case dict), `:671` `export_snapshot` (the schema 1 writer), `:699` `load_snapshot`, `:292` `_save` (reassigns the whole session dict, so old v2 keys disappear on the first write). `clean_estate` :85 gives canonical strings such as `"1000.5"`.
- `api/views.py:28` `ApiView` (the base of every API and report view: add the `SnapshotError` → 422 mapping here via `handle_exception`), `:48` `CaseView` (`post` must start over on `replace:true` even when the session is unreadable), `:229` `SavedCasesView` (list filter `schema_version=1`, `report_status(row.snapshot)` on the raw snapshot → use the decoded case), `:270` `OpenSavedCaseView` (`!= 1` → 400), `:340` `SharedCaseMixin.shared` (the version check sits before the visibility check; move decoding after it), `:450` `ReceivedCaseMixin.received`.
- `reports/views.py:40,79,95` -- the session, shared and received PDF views reuse `anonymous_case.get` and the two mixins. They need no change beyond the mixins, but tests must cover them.
- `calc/adapters.py:12` `basis_from_madhab`, `:17` `family_from_session(case)` → `(Family, Currency)`. Reuse it for `encode_v2`, which calls `dump_family` and adds `deceased` plus `dump_basis`. `presentation/money.py:30` `minor_units` caps values at 2^53 and raises `PresentationError` beyond that; let the encoder propagate it, since no writer uses it yet.
- `engine/contracts/__init__.py` exports `parse_family`, `dump_family`, `resolve_basis`, `dump_basis`, `basis_for_snapshot` and `ContractError` (`.code`). These are read-only.
- `api/legacy_cases.py:44-99` `convert` -- the legacy → schema 1 conversion. It is read-only; its outputs are the "migrated-case" round-trip inputs.
- Tests to update: `api/tests.py:3395` `test_unsupported_schema_version_is_not_listed_or_opened` and `:3636` `test_unsupported_or_malformed_snapshots_are_the_same_404` treat schema 2 as unsupported. Move them to version 3. The malformed and unknown cases now return a typed 404 body with `code`, while unknown tokens keep the old body. `api/test_legacy_cases.py` holds the layered `build_case`/`build_layer` fixtures. `InterviewHelpers` in `api/tests.py` provides `complete`, `save`, `send`, `plant` and `live`.

## Tasks & Acceptance

**Execution:**
1. `api/snapshots.py` (new):
   - Add `READ_VERSIONS = (1, 2)`, `WRITE_VERSION = 1`, `SnapshotError(code, detail)`, `decode(version, snapshot, case_id, started_at)`, `encode_v2(snapshot_v1)` and `session_version(stored)`, following the constraints above.
   - Schema 2 → schema 1:
     - Order the first estate's heirs as listed.
     - Each later estate becomes a death `{heir_id: <deceased person id>, order, gender, heirs}`.
     - A later-estate heir that also appears in an earlier layer becomes a row with `same_as: <person id>` and a fresh deterministic row id `f"{person}~{order}"`. Any other heir keeps its person id as its row id.
     - Names come from the Person, and the estate is amount_minor/100 rendered as `clean_estate` would output it.
2. `api/anonymous_case.py` -- make `get` decode through `snapshots.decode(session_version(case), …)`, so it raises `SnapshotError` for an unreadable session. Change `load_snapshot(request, snapshot)` callers to pass a schema 1 snapshot (`export_snapshot(decoded)`).
3. `api/views.py`:
   - `ApiView.handle_exception` maps `SnapshotError` to 422 `{"detail": "This case version is unsupported.", "code": e.code}`.
   - `CaseView.post` starts over on an unreadable session only when `replace` is true.
   - The list decodes every row with `schema_version in READ_VERSIONS` and skips rows that raise. Its summary comes from the decoded case.
   - Open returns 400 with `code` on a decode failure.
   - The shared and received mixins decode after their access checks and return 404 `{"detail": "This link is unavailable.", "code": …}` on a failure.
4. `api/fixtures/snapshots/` (new) -- `v1-*.json` and the matching `v2-*.json` files:
   - single estate with an estate amount, no estate, `madhab` null, `jafari`, and later deaths with `same_as`;
   - `matrix.json`, an ordered list of release images `[{"image":"phase-1 (02d3627)","reads":[1],"writes":1},{"image":"8.8 dual reader","reads":[1,2],"writes":1}]`.
5. `api/test_snapshots.py` (new):
   - Run every I/O matrix row against the real endpoints, including the share, received and session PDF endpoints.
   - Check that v1→v2→decode→`export_snapshot` round-trips for the fixtures, the `api/test_legacy_cases.py` conversions (simple, layered and same-person cases built with `build_case`/`build_layer` and run through `convert`) and live-interview cases.
   - Pin the v2 fixture files as the `encode_v2` output.
   - Check that the stored row is unchanged after every error.
   - Matrix gate:
     - The last image in `matrix.json` equals `(READ_VERSIONS, WRITE_VERSION)`.
     - Each image's write version is in the `reads` of its neighbours, the active and rollback images.
     - 1 stays in `READ_VERSIONS`, and the current image decodes every fixture whose version it lists.
6. `api/tests.py` -- update the two tests named in the Code Map to version 3, and add the typed `code` assertions.
7. `_bmad-output/implementation-artifacts/deferred-work.md` -- add an 8.8 section:
   - the 8.10 writer switch must append its image to `matrix.json`;
   - the encoder raises above 2^53 minor units;
   - alias row ids are regenerated on a v2 read;
   - unreadable rows are hidden from My cases rather than shown with an error;
   - the web shows the typed errors as its generic failure.

**Acceptance Criteria:**
- Given a schema 2 SavedCase and its schema 1 twin, when the owner lists and opens them, and a share holder and an invite recipient view them and download their PDFs, then both give identical `case` and `preview` bodies (apart from the case id and the alias row ids).
- Given any reader call that fails to decode, when it returns, then `SavedCase.snapshot`, `schema_version` and `updated_at` are unchanged and the session still holds its original dict.
- Given `git diff 1e632a9 -- engine/contracts contracts web`, then it is empty. The save path still writes `schema_version=1`.
- Given the suite, when `api.test_snapshots` runs, then the matrix gate and all round-trips pass.

## Spec Change Log

## Review Triage Log

### 2026-11-17 — Review pass
- verdicts: 16 findings — high 0, medium 3, low 10, false 3, maybe-false 0
- note: all four layers ran on codex (the user's standing preference), not on the session model.
- findings:
  - **Blind hunter**
    - `[medium]` `[patch]` (blind) `CaseView.post`: an unreadable session plus `replace:true` sets `existing=None`, so a stale tab whose `case_id` differs from the stored id overwrites the newer, unreadable case. — Patched: on a decode failure the raw stored session id is compared with `case_id`. A mismatch returns 409 with the typed code and leaves the session untouched. A regression test was added.
    - `[low]` `[patch]` (blind) The PDF renderer is mocked and its arguments are never checked. — Patched: the twins test compares the `render_pdf` call arguments (normalized case and preview) between schema 1 and 2.
    - `[low]` `[patch]` (blind) The received-view preview is never compared between twins. — Patched: received previews are compared like the shared ones.
    - `[low]` `[patch]` (blind) Nothing tests opening an existing v2 row, editing it and saving back to the linked row. — Patched: a new test asserts the same pk is updated as schema 1, with only the edited madhab changed.
    - `[false]` `[reject]` (blind) Successful reads do not assert that the row is unchanged. — `decode`, the list, open and the mixins contain no write. Open writes only the session, and `SavedCase.save` is reached only from `SavedCasesView.post`.
    - `[low]` `[reject]` (blind) The endpoints skip the empty fixture and three-estate cases. — The decoder path is the same for every fixture. Three-estate cases round-trip through `decode`/`export_snapshot` in `test_legacy_conversions_and_live_interview`, and the empty fixture is decoded by the matrix test. More endpoint loops add runtime and verify nothing new.
    - `[low]` `[reject]` (blind) Session-error tests skip `true`, `"2"` and `null` versions. — `decode` rejects any non-int (bool included, via `type(...) is not int`) or unlisted version as `unsupported_version`. The handling is correct by inspection, and integer 3 already exercises that path.
  - **Verification-gap reviewer**
    - `[medium]` `[patch]` (verification-gap, other) Stale-tab replace over an unreadable session. — Grouped with the blind row; patched.
  - **Edge-case hunter**
    - `[medium]` `[patch]` (edge) Stale-tab replace over an unreadable session. — Grouped with the blind row; patched.
    - `[low]` `[reject]` (edge) The schema 2 twin returns estate `"1200.5"` where schema 1 kept the typed `"1200.50"`. — Schema 2 stores minor units, not the typed text, so the typed form cannot be recovered. The value is equal, and the I/O matrix compares estates by Decimal value. A fix would mean editing this spec.
  - **Intent-alignment auditor**
    - `[low]` `[reject]` (intent) There are no web or browser tests, and the web shows typed errors as a generic failure. — The web is unchanged. The response shapes are identical for readable cases, and the error `code` is an additive key on existing statuses. This is recorded in deferred-work.
    - `[low]` `[reject]` (intent) Rows that fail to decode are hidden from My cases. — No eligible writer (phase-1 or this image, nor 8.10's planned v2 writer) can produce such a row. Listing it would change the list contract. This is recorded in deferred-work.
    - `[false]` `[reject]` (intent) Schema 2 is accepted only for the schema 1-representable subset. — This is AD-20 step 3 by design. Country writes stay disabled until every image reads them, and unrepresentable content is refused with a typed error, never dropped.
    - `[false]` `[reject]` (intent) Alias row ids are regenerated. — The AC requires stable *person* identity. Person ids and death links are preserved exactly, while alias rows are per-layer views of a person.
    - `[low]` `[reject]` (intent) Invite issuance and acceptance are not exercised end-to-end, and the PDF is mocked. — The issuance and acceptance flows are unchanged and covered by the existing `api.tests` invite tests. The renderer is mocked because WeasyPrint's native libraries are absent locally, and its inputs are now compared (patched row above).
    - `[low]` `[reject]` (intent) The matrix does not execute historical images and only checks neighbours. — The phase-1 reader is the pre-change `read_snapshot`, which reads only schema 1, the only version any image writes. Executing old images needs deploy tooling outside this story. AD-5 makes active plus one rollback image the eligible set, which is exactly what the neighbour check covers.

## Design Notes

- **Why deceased gender sits outside Family:** the Family v1 root is not a person and has no gender. The engine queries take `deceased_gender` separately (`engine/queries.py:70`). Adding it to Family would change the Family meaning and need a contract version bump, so the snapshot carries it next to the Family.
- **Why the strict round-trip check:** release N must re-save a decoded schema 2 case as schema 1. Any content that cannot survive that trip has to be refused as a typed error. Dropping it would silently change the answer after a rollback.
- Example schema 2 (wife + son, 1200.50 SAR, Hanbali): `{"deceased":{"gender":"male"},"basis":{"kind":"school","school":"hanbali"},"family":{"version":1,"root":"root","persons":[{"id":"h1","gender":"female","name":null,"relationship":"wife","status":"alive","death_order":null},…],"edges":[],"estates":[{"order":1,"deceased":"root","heirs":[{"person":"h1","relationship":"wife"},…]}],"answers":[],"gifts":[],"bequests":[],"estate":{"amount_minor":120050,"currency":{"code":"SAR","explicit":true}}}}`.

## Verification

**Commands:**
- `uv run python manage.py test api.test_snapshots api.test_legacy_cases api.tests reports --noinput` -- expected: OK.
- `uv run python manage.py test calc.test_switch_gate --noinput` -- expected: OK (it uses `family_from_session`, so this checks for regressions).
- `uv run python manage.py makemigrations --check --dry-run` -- expected: no changes.
- `git diff 1e632a9 --stat -- engine/contracts contracts web` -- expected: empty.

## Auto Run Result

Status: done

**Summary:** Release N dual readers. `api/snapshots.py` defines schema 2 as `{deceased, family (Family v1), basis (Basis v1)}` and has one shared `decode`. Schema 1 decoding stays lenient. Schema 2 decoding is strict and verifies itself by re-encoding: content that cannot survive a trip back to schema 1 is a typed `unsupported_content` error. `encode_v2` is used only by tests for now. The session, the SavedCase list and open, the shared and received views and their PDFs all decode through it, and access checks run before decoding. Writers still emit schema 1. Typed errors (`unsupported_version`, `invalid_snapshot`, `invalid_basis`, `preset_unavailable`, `unsupported_content`) return 400 on open, 404 with a `code` on shares and invites, 422 on the session, and 409 on a stale replace. A reader never writes the stored row.

**Files changed:**
- `api/snapshots.py` (new) -- the versions, `SnapshotError`, `decode`, `encode_v2` and `session_version`.
- `api/anonymous_case.py` -- the session `get` decodes through `snapshots.decode`.
- `api/views.py` -- the `ApiView` 422 mapping, the `CaseView.post` replace and stale-tab guard, and the list, open, share and received readers.
- `api/fixtures/snapshots/` (new) -- v1/v2 twin fixtures (estate, no estate, compare, jafari, later deaths, empty) and `matrix.json`.
- `api/test_snapshots.py` (new) -- the matrix gate, the round-trips (fixtures, legacy conversions, live interview), the endpoint twins, typed errors, sessions, access ordering and save-back.
- `api/tests.py` -- the two old unsupported-version tests now use version 3, with typed codes.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- the 8.8 follow-ups.

**Review findings:** 16 findings across four layers. Patched: 1 medium (stale-tab replace over an unreadable session, found by three layers) and 3 low test gaps (received-preview parity, PDF renderer arguments, saving a v2 row back). None deferred. Rejected: 12, each with its reason in the Review Triage Log. Patched counts by verdict: high 0, medium 1, low 3. Follow-up review recommended: false.

**Verification:**
- `uv run python manage.py test api.test_snapshots api.test_legacy_cases api.tests reports --noinput`: 310 tests, OK (1 skipped), after the patches. Before the patches: 309, OK.
- `calc.test_switch_gate`: 5 tests, OK (before the patches; the patches do not touch its code).
- `makemigrations --check`: no changes.
- `git diff 1e632a9 --stat -- engine/contracts contracts web`: empty.
- I/O matrix audit: every row is covered by a test that ran.

**Residual risks:**
- PDF rendering is mocked in the new tests, because WeasyPrint's native libraries are missing locally, so rendered fidelity for schema 2 relies on equal renderer inputs.
- The review layers ran on codex, not the session model.
- The matrix is declarative. Story 8.10 must append its image to `matrix.json` and keep schema 1 readers until AD-6 eligibility allows removing them.
