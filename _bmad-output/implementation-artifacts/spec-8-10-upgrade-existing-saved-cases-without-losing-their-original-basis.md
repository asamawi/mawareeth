---
title: 'Story 8.10: Upgrade existing Saved cases without losing their original Basis'
type: 'feature'
created: '2026-11-18'
status: 'done'
baseline_revision: '6dbda1b656e5d2c3427a0059b72bc1991baaf857'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** Every reader accepts SavedCase schema 1 and 2 (8.8), but every writer still emits schema 1. SavedCase has no name. Opening a SavedCase links the session working copy to the row id only, so a save from an old working copy silently overwrites a newer save. The 8.9 `revision` column has no database default, so a rollback image that does not know the column cannot insert a row.

**Approach:** Add a SavedCase `name` column with a migration. Switch the SavedCase writer to schema 2 behind an operator setting, and add a resumable, dry-run-capable backfill command that converts schema 1 rows losslessly and assigns default names. The working-copy link carries the base revision, and save becomes a compare-and-swap. Append the writer image to the reader/writer matrix.

## Boundaries & Constraints

**Always:**
- **Migration** `api/migrations/0006_savedcase_name.py` (additive):
  - It adds `name = CharField(max_length=100, blank=True, default='', db_default='')`.
  - It alters `revision` to add `db_default=1`, so an image that does not know the columns can still insert a row.
  - `''` means "no name assigned".
- **Writer switch.**
  - New setting `SNAPSHOT_WRITE_VERSION = config('SNAPSHOT_WRITE_VERSION', default=1, cast=int)`. It must be 1 or 2; any other value raises `ImproperlyConfigured` at startup.
  - `api/snapshots.py` keeps `READ_VERSIONS = (1, 2)`, sets `WRITE_VERSION = 2` (what this image writes once switched), and adds `write_version()`, which returns the setting.
  - `SavedCasesView.post` writes `encode_v2(export_snapshot(case))` with `schema_version=2` when `write_version()` is 2. Otherwise it writes schema 1 exactly as today.
  - Schema 2 holds only inputs: deceased, family (estate in minor units, currency `{code:"SAR", explicit:true}` when there is an amount, else null) and Basis. Results are never stored.
  - When the encoder fails (an amount at or above 2^53 minor units), the save returns 400 `{"detail":"The case cannot be saved.","code":"unsupported_content"}`. The row and the session stay unchanged.
- **Session.** The session working copy keeps its current dict form. A schema 1 session dict converts on read through `decode` and stays usable until its existing expiry. Its estate is presented as SAR explicit (the 8.7 rule). Reads never rewrite the session or touch `changed_at`. When the lenient v1 read drops stored content, it logs one redacted `mawareeth.snapshots` WARNING record with `code="normalized_on_read"` only.
- **Names.**
  - The default name is the gettext msgid `"Estate of %(deceased)s, %(date)s"`. `deceased` is the msgid `"the deceased"`, because no snapshot carries a deceased name.
  - It is rendered under `translation.override(settings.LANGUAGE_CODE)`, the site default Locale, because users have no stored language.
  - `date` is the row's `created_at` in `TIME_ZONE`, formatted with Babel `format_date(..., format='long', locale=<registry babel_locale>)`.
  - The result is truncated to 100 characters.
  - A new row gets the default name on create. An existing row keeps its name on save.
  - The list response adds `name`.
- **Backfill** `python manage.py backfill_saved_cases [--dry-run] [--batch-size N]` (default 200):
  - It raises `CommandError` unless `write_version() == 2`.
  - It walks rows in pk order that have `schema_version == 1` or `name == ''`. Each row is committed on its own, so a rerun resumes.
  - **Name:** if `name == ''`, assign the default name.
  - **Conversion:** a row with `schema_version == 1` converts only when it is lossless:
    - `export_snapshot(decode(1, s))` equals `{**s, 'madhab': resolved_school}` in canonical JSON, where `resolved_school` comes from `basis_for_snapshot` (so a missing or invalid madhab becomes compare, a valid one stays its school, and never a Country Basis);
    - `encode_v2` succeeds;
    - `decode(2, v2)` succeeds.
  - Otherwise the row is left as schema 1 and reported as `malformed` with its pk only.
  - Writes use `QuerySet.update(...)` filtered on `pk`, the read `revision` and the read `schema_version`, so `updated_at`, `created_at`, `owner`, `revision`, the pk, and the share and invite rows are untouched. A concurrent save makes the filter miss, and the row is retried on the next run.
  - It never replaces a non-empty name or reconverts a schema 2 row.
  - Output is counts only (`converted`, `named`, `malformed`, `skipped`) plus the malformed pks: no names and no family data. `--dry-run` writes nothing and prints the same counts.
- **Working-copy compare-and-swap.**
  - `set_saved_link(request, case_id, saved_id, base_revision)` stores `{case_id, saved_id, base_revision}`. `get_saved_link` keeps returning the id. A new `get_saved_base_revision(request, case_id)` reads 1 for a link without the key.
  - Open sets `base_revision = row.revision`.
  - Save locks the linked row with `select_for_update`. When `row.revision != base_revision`, it returns 409 `{"error":"conflict","code":"saved_case_conflict","detail":"This saved case changed since it was opened.","revision":<row revision>}`. The row, the session Case and the link stay unchanged.
  - On success the revision is bumped as today, and the link's `base_revision` is set to the new revision.
  - The web is unchanged: a 409 makes `saveCase` return null, which takes the existing error state while the working copy stays on the server.
- **Matrix.** Append `{"image":"8.10 schema-2 writer","reads":[1,2],"writes":2}` to `api/fixtures/snapshots/matrix.json`. The gate compares the last image with `(READ_VERSIONS, WRITE_VERSION)`.
- **Readers and Basis.** Shares, invites, received views, open and the PDFs keep decoding through `snapshots.decode`, which uses the one Basis resolver. Share links stay live views of the row. A Country Basis stays `preset_unavailable`, and pinned versions are never substituted.

**Never:**
- Remove schema 1 readers, or change `decode`'s strictness.
- Write a Country Basis.
- Add a rename endpoint, the save-naming UI or a My cases name display (later stories).
- Edit `engine/`, `contracts/`, `api/fixtures/snapshots/v*.json` or the session dict shape.
- Bump a revision or `updated_at` in the backfill.
- Change existing translations.
- Default `SNAPSHOT_WRITE_VERSION` to 2.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Save, switched | setting 2, new complete case | 201; row schema 2 equals `encode_v2(export_snapshot(case))`; name is the default; revision 1 | — |
| Save, not switched | setting 1 | row schema 1 as today; the name is still set | — |
| Backfill v1 hanbali | v1 row, madhab hanbali, estate "1200.50" | schema 2, basis school hanbali, amount_minor 120050 SAR explicit; `updated_at`/revision/owner/pk unchanged; share link still opens | — |
| Backfill no madhab | v1 row with no madhab key | basis compare | — |
| Backfill no estate | deceased estate null | `amount_minor` null, currency null | — |
| Backfill later deaths | v1 row with `same_as` rows | v2 decodes to the same persons and deaths | — |
| Backfill rerun | the user renamed it to "عائلتي"; already v2 | nothing changes; counts `skipped` | — |
| Backfill malformed | v1 heirs include an unknown relationship | row byte-identical; reported `malformed` with its pk; still named | reported |
| Backfill dry run | `--dry-run` | no row changes; same counts | — |
| Backfill not switched | setting 1 | `CommandError`; nothing written | — |
| Concurrent save during backfill | the row's revision changed after it was read | the update misses; the row is untouched this run, converted next run | — |
| Working-copy CAS ok | opened at rev 2, row still 2 | 200; rev 3; link base 3 | — |
| Competing save | tab A opened at rev 2; tab B saved to rev 3; A saves | 409 `saved_case_conflict`; row stays rev 3 with B's inputs; A's session Case unchanged | conflict |
| Old link | link without `base_revision`, row rev 1 | save succeeds | — |
| Guest v1 session | session dict without `schema_version`, estate "500" | GET and preview work; the preview currency is SAR explicit; the stored session is byte-identical after reads | — |
| Malformed guest session | v1 session with an invalid heir | read drops it as today; one WARNING `normalized_on_read`; session and `changed_at` unchanged | reported |
| Oversized encode | setting 2, estate 999999999999999 | 400 `unsupported_content`; no row | typed |

</intent-contract>

## Code Map

- `api/models.py:5` `SavedCase` (`revision` added in `0005`, which has no db default). Django is 5.2, so `db_default` is available. Latest migration: `0005_savedcase_revision`.
- `api/snapshots.py` -- `READ_VERSIONS`, `WRITE_VERSION = 1`, `encode_v2(snapshot_v1)`, which raises `PresentationError` above 2^53 minor units, and `decode(version, snapshot, case_id, started_at)`, which returns the case dict, raises `SnapshotError(code)` and is strict for v2. `basis_for_snapshot` is imported here.
- `api/views.py`:
  - `:333` `SavedCasesView`: `get` builds the list and needs `name`; `post` has the writer at `:369-391`, with the row lock, `F('revision') + 1`, `is_lock_timeout` and `busy_response`.
  - `:395` `OpenSavedCaseView`: `set_saved_link` at `:403` needs the base revision.
- `api/anonymous_case.py`:
  - `:277` `_decode` and `:292` `get` (the session read; add the normalization warning here; reads never write);
  - `:304` `read_snapshot` (lenient);
  - `:732` `export_snapshot`;
  - `:745-758` the saved-link helpers (key `SAVED_LINK_KEY`); `:269` `is_expired` uses `get_saved_link`.
- `mawareeth/settings.py:343-347` -- the case settings; add `SNAPSHOT_WRITE_VERSION` here. `LANGUAGE_CODE` (`:293`) comes from `i18n.default_locale()` (`ar`). `TIME_ZONE='Asia/Riyadh'`.
- `i18n/__init__.py` -- `registry()` gives each locale's `babel_locale`.
- `locale/{ar,en,fr}/LC_MESSAGES/django.po` and the `.mo` files, both tracked. Compile the `.mo` files with Babel (`babel.messages.pofile`/`mofile`) if `msgfmt` is missing. Check that the i18n validator (`i18n/tests.py`) still passes.
- `api/management/commands/` -- does not exist yet; create it with `__init__.py` files.
- `api/legacy_cases.py:86` `import_all` -- migrated legacy rows are ordinary schema 1 rows whose `created_at` is the import time. The legacy `Calculation` has no date, so `created_at` is the original save date.
- Tests:
  - `api/test_snapshots.py`: `fixture()`, `normalized()`, `SnapshotTests` with `roundtrip`, `test_fixture_and_release_matrix:65` (the matrix gate), `test_session_decode_edit_and_writer_remains_v1:190` (must become setting-aware), `test_open_v2_edit_and_save_updates_linked_row:205`;
  - `api/tests.py` `SavedCaseTests` (around `:3246`) and the `InterviewHelpers` `save`/`complete`;
  - `api/test_legacy_cases.py` `build_case`/`build_layer`/`convert` for the legacy rows;
  - `api/test_case_commands.py` covers the saved-row lock and revision.
- `web/src/api/saved-cases.ts` -- read-only evidence: a 409 returns null, and the list validator ignores extra keys. No web change.

## Tasks & Acceptance

**Execution:**
1. `api/models.py`, `api/migrations/0006_savedcase_name.py` -- the `name` column and the `revision` `db_default`, as in the constraints.
2. `mawareeth/settings.py` -- `SNAPSHOT_WRITE_VERSION` with the 1/2 validation and a comment on the switch precondition.
3. `api/snapshots.py` -- `WRITE_VERSION = 2`, `write_version()`, a `lossless_v1(snapshot) -> v2 | None` helper used by the backfill, and `default_name(created_at)`. The name helper can live in a new `api/names.py` if that is cleaner.
4. `api/anonymous_case.py` -- the link with `base_revision`, `get_saved_base_revision`, and the redacted normalization warning on a v1 session read.
5. `api/views.py` -- the switched writer, the 400 `unsupported_content`, the CAS 409, the default name on create, the link base revision on open and save, and `name` in the list.
6. `api/management/commands/backfill_saved_cases.py` (new) -- as in the constraints.
7. `locale/*/LC_MESSAGES/django.po` + `.mo` -- the two new msgids with ar, en and fr msgstrs.
8. `api/fixtures/snapshots/matrix.json` -- append the image.
9. `api/test_saved_case_upgrade.py` (new) -- a test for every I/O matrix row against the real endpoints and the command. Include:
   - legacy-converted rows (`convert` output) backfilled and then opened, shared and received with the same preview as before;
   - the share token, invite and pk unchanged;
   - `updated_at` equal before and after;
   - a 100-character limit test with a long Arabic default name;
   - a migration test showing existing rows read `name == ''` and that a raw SQL insert without `name` or `revision` succeeds.
10. `api/test_snapshots.py`, `api/tests.py` -- update the matrix gate and the "writer remains v1" test for the setting (both values). Update the assertions on the session link shape. Do not weaken anything else.
11. `_bmad-output/implementation-artifacts/deferred-work.md` -- an 8.10 section:
    - **Ops order:** flip `SNAPSHOT_WRITE_VERSION=2` and run the backfill (with a fresh restic backup first) only once the rollback-eligible image reads schema 2, which means not in the same deploy that first ships 8.8;
    - the new name msgids need native review;
    - the backfill names use the site default Locale, not each user's;
    - the legacy `Calculation.name` is not carried into names;
    - alias row ids are regenerated in v2;
    - the save-conflict UX is Epic 9.

**Acceptance Criteria:**
- Given setting 2 and a completed backfill, when the owner lists, opens, shares and receives every pre-existing row, then each decodes as schema 2 with the same Basis, the same persons and estate value, and an identical preview to before the backfill.
- Given `git diff 6dbda1b -- engine contracts api/fixtures/snapshots/v*.json web`, then it is empty.
- Given migration `0006`, when `makemigrations --check` runs, then no changes are pending.

## Spec Change Log

## Review Triage Log

### 2026-11-18 — Review pass
- verdicts: 29 findings — high 0, medium 0, low 18, false 10, maybe-false 1
- note: all four layers ran on Claude subagents at the session model. Codex cannot read the `_bmad/render` review prompts. Implementation and patches ran on codex.
- findings:
  - **Intent-alignment auditor**
    - `[false]` `[reject]` (intent) The writer switch defaults to schema 1, so the release does not persist schema 2 until an env flip. — The story's own precondition is "Given all active and rollback-eligible readers accept both versions". Epic 8 is unreleased, so the rollback image would be phase-1, which reads only schema 1. The setting makes the switch an explicit operator step (Design Notes; the ops order is in deferred-work).
    - `[low]` `[reject]` (intent) Every default name is the same fixed phrase plus a date. — No snapshot or Family carries a deceased name, so the "label" branch is the only one available. The legacy `Calculation.name` gap is recorded in deferred-work.
    - `[low]` `[reject]` (intent) The guest SAR check goes through `encode_v2`, not the read path's response. — The session has no currency field (8.7 rule), and the same test asserts the preview succeeds. A response-level currency check would test 8.7 presentation, not this story.
    - `[false]` `[reject]` (intent) Malformed guest data is normalized in what the user sees. — This is the existing lenient read (8.8). The criterion is that it is reported and the stored data is not destructively normalized. The test asserts a byte-identical session and a single redacted WARNING.
    - `[false]` `[reject]` (intent) User names are set through a DB update in tests. — No naming surface exists until the Epic 9/10 save-naming story, which consumes this column. The rerun guarantee is what is tested.
    - `[false]` `[reject]` (intent) A pre-deploy link without `base_revision` conflicts once the row has moved. — Grouped with the edge and blind rows: the conflict is correct, because such a working copy really is older than the row.
    - `[false]` `[reject]` (intent) Pinned versions, Country writes and AD-6 reader removal are not tested here. — They are covered by 8.8's `test_snapshots` (Country v2 is `preset_unavailable`, `READ_VERSIONS` keeps 1 in the matrix gate). This diff keeps them green.
  - **Verification-gap reviewer**
    - `[low]` `[patch]` (verification-gap) `SNAPSHOT_WRITE_VERSION` validation is untested. — Patched: `mawareeth/tests.py` asserts that "3", "0" and "abc" raise `ImproperlyConfigured` and that unset gives 1.
    - `[low]` `[reject]` (verification-gap, other) `WRITE_VERSION = 2` and the matrix's `writes: 2` describe the switched image while the default config writes 1. — By design: the matrix describes what this image writes once switched, and the setting carries the operator precondition (Design Notes).
  - **Edge-case hunter**
    - `[low]` `[patch]` (edge) Save catches only `PresentationError`; other encoder errors give a 500. — Patched: `ContractError`, `SnapshotError`, `ValueError` and `KeyError` also return 400 `unsupported_content`. A test covers each.
    - `[maybe-false]` `[patch]` (edge) A saved v2 document that `decode(2)` would reject becomes unopenable. — Settled by checking whether any valid session case encodes to a v2 document that `decode(2)` refuses. Grouped with the row above: the save now calls `decode(2, …)` after encoding, and a refusal returns 400 with no row.
    - `[false]` `[reject]` (edge) An old link with no `base_revision` on a row above revision 1 always gets 409. — Correct compare-and-swap. Pre-deploy rows were all at revision 1, and they move only through saves on this image, which store a base. A link at the implied base 1 against a newer row is a stale working copy. Re-opening recovers, and the conflict UX is Epic 9.
    - `[low]` `[reject]` (edge) A `LANGUAGE_CODE` outside the registry makes `default_name` raise. — Operator misconfiguration. Django `LANGUAGES` derive from the same registry, so such a value is already unsupported site-wide.
    - `[low]` `[patch]` (edge) A malformed row that is already named is counted as both malformed and skipped. — Patched: malformed rows are no longer counted as skipped. A test asserts `malformed=1 skipped=0`.
    - `[low]` `[patch]` (edge) An update missed in a concurrent race is double-counted. — Grouped with the blind `skipped` row: patched with a separate `retry` count.
  - **Blind hunter**
    - `[false]` `[reject]` (blind) Old links can never save again. — Same claim as the edge row: a stale working copy correctly conflicts.
    - `[false]` `[reject]` (blind) `lossless_v1` never compares the v2 round trip. — `decode(2)` already requires `encode_v2(export(decoded)) == encoded`, and `encoded = encode_v2(v1_export)`. Both readings therefore map to the identical v2 document, which is meaning-equal under the one encoder.
    - `[low]` `[reject]` (blind) Broad excepts in `lossless_v1` hide bugs as malformed. — The lenient v1 data can raise these types. The rows stay untouched and are listed by pk for follow-up, so nothing is lost.
    - `[low]` `[patch]` (blind) The save view catches only `PresentationError`. — Grouped with the edge row; patched there. The English `detail` strings follow the existing API convention (the web maps by status and `code`), so that part is rejected.
    - `[low]` `[reject]` (blind) The `normalized_on_read` warning is noisy or gives false positives. — Verified: stored session rows come from the same clean/read helpers that `export_snapshot` mirrors, so a well-formed session never warns. The no-warning test covers it, and only really malformed sessions warn.
    - `[low]` `[reject]` (blind) There is no runbook entry for the switch and backfill. — The ops order is recorded in deferred-work for the release. A deploy runbook belongs with the 8.11 release gate.
    - `[low]` `[patch]` (blind) The setting validation is untested. — Grouped with the verification-gap row; patched there.
    - `[low]` `[reject]` (blind) The new-row name is a second write. — It runs in the same transaction under the row lock, so no reader sees an unnamed row. It is one extra UPDATE per first save.
    - `[low]` `[patch]` (blind) `skipped` mixes "done", "raced" and "nothing to do". — Patched: a new `retry` count. The concurrent test asserts `skipped=0 retry=1`.
    - `[false]` `[reject]` (blind) An invalid madhab is silently rewritten. — This is the AD-18 legacy fallback the story requires ("assigns the preserved School or compare Basis"), and every reader already treats it as compare.
    - `[low]` `[reject]` (blind) An oversized estate saved under setting 1 later backfills as malformed. — Such a row stays readable as schema 1 and is reported by pk. It is rare: over 90 trillion.
    - `[low]` `[patch]` (blind) The "CAS ok → link base 3" row is not asserted. — Patched: `test_switched_writer_and_conflict` asserts `base_revision == 3`.
    - `[false]` `[reject]` (blind) The 409 tests do not check that the link is unchanged. — They assert that the whole session dict is equal before and after, and the link lives in that dict.
    - `[low]` `[patch]` (blind) Stray double blank line in the tests. — Removed.

## Design Notes

- **Why a setting rather than a code switch:** Epic 8 has not shipped yet (`master..development` holds 8.1–8.9). If this commit shipped in the same deploy as 8.8, the rollback image would be phase-1, which reads only schema 1, so converted rows would disappear on rollback. AD-20 step 2 needs every rollback-eligible image to read schema 2 first, and the setting turns that precondition into an explicit operator step.
- **Why the session stays dict-shaped:** the session is the working copy, and AD-20 says guest sessions "convert on read". Every API body is unchanged. Re-encoding on every session write would add two round-trip encodes per command and rename alias rows mid-edit.
- **Why the backfill does not bump `revision`:** conversion does not change the inputs. A bump would make every open working copy fail its CAS on the next save.
- Example default name (ar): `تركة المتوفى، ٣ مايو ٢٠٢٦` (Latin digits per the registry's `latn`); en: `Estate of the deceased, May 3, 2026`.

## Verification

**Commands:**
- `uv run python manage.py test api.test_saved_case_upgrade api.test_snapshots api.tests api.test_case_commands api.test_legacy_cases reports i18n --noinput` -- expected: OK.
- `uv run python manage.py makemigrations --check --dry-run` -- expected: no changes.
- `uv run python manage.py backfill_saved_cases --dry-run` against the local DB with setting 2 -- expected: counts printed, no writes.
- `git diff 6dbda1b --stat -- engine contracts web` -- expected: empty.

## Auto Run Result

Status: done

**Summary:**
- **Name column.** `SavedCase` gains a `name` column (migration `0006`, `db_default=''`), and `revision` gains `db_default=1`, so an older image can still insert rows.
- **Writer switch.** The SavedCase writer emits schema 2 (`encode_v2`, verified by `decode(2)`) when the new `SNAPSHOT_WRITE_VERSION` setting is 2. The default stays 1 until the operator flips it, once every rollback-eligible image reads schema 2.
- **Names.** New rows get a default name, "Estate of the deceased, {date}", using the creation date, rendered in the site Locale and truncated to 100 characters. The list response adds `name`.
- **Backfill.** `manage.py backfill_saved_cases [--dry-run] [--batch-size N]` is resumable. It converts losslessly representable schema 1 rows to schema 2 (the preserved School, or compare, never a Country Basis; SAR explicit when there is an estate) and fills in missing names. It writes through a compare-and-swap `QuerySet.update`, so the ids, owner, timestamps, revision, shares and invites are untouched. Malformed rows are reported by pk and left as they are. It prints counts only.
- **Working-copy save.** The saved link carries `base_revision`, and save is a compare-and-swap: a mismatch returns 409 `saved_case_conflict` with the row, session and link unchanged.
- **Guest sessions.** Schema 1 guest sessions keep converting on read. A lossy read logs one redacted `normalized_on_read` warning and never rewrites the session.
- **Matrix.** The reader/writer matrix gains the "8.10 schema-2 writer" image.

**Files changed:**
- `api/models.py`, `api/migrations/0006_savedcase_name.py` (new) -- the `name` column and the `revision` db default.
- `mawareeth/settings.py` -- `SNAPSHOT_WRITE_VERSION` (1 or 2, default 1, validated).
- `api/snapshots.py` -- `WRITE_VERSION = 2`, `write_version()`, `default_name()`, `lossless_v1()`.
- `api/anonymous_case.py` -- saved link with `base_revision`, `get_saved_base_revision`, the redacted normalization warning.
- `api/views.py` -- the switched writer with a decode check, 400 `unsupported_content`, the 409 conflict, the default name on create, the base revision on open and save, `name` in the list.
- `api/management/commands/backfill_saved_cases.py` (new) -- the backfill.
- `locale/{ar,en,fr}/LC_MESSAGES/django.po` + `.mo` -- two new msgids (needs native review).
- `api/fixtures/snapshots/matrix.json` -- the new image.
- `api/test_saved_case_upgrade.py` (new), `api/test_snapshots.py`, `api/tests.py`, `mawareeth/tests.py` -- tests.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- the 8.10 follow-ups, including the ops order.

**Review findings:** 29 findings across four layers (high 0, medium 0, low 18, false 10, maybe-false 1).
- **Patched (7 entries):** encoder failures and a refused v2 now return a typed 400; the setting validation tests; the malformed/skipped double count; the separate `retry` count; the base-revision-3 assertion; the stray blank line. Patched counts by verdict: high 0, medium 0, low 6, maybe-false 1.
- **Deferred:** none.
- **Rejected:** the rest, each with its reason in the Review Triage Log.

**Follow-up review recommended: false.** No high or medium entry was patched.

**Verification:**
- `uv run python manage.py test api.test_saved_case_upgrade api.test_snapshots api.tests api.test_case_commands api.test_legacy_cases reports i18n mawareeth --noinput --exclude-tag slow`: 477 tests, OK (1 skipped), after the patches. Before the patches: 371 targeted tests, OK.
- `makemigrations --check`: no changes.
- `SNAPSHOT_WRITE_VERSION=2 manage.py backfill_saved_cases --dry-run` on the local DB printed `converted=1 named=1 malformed=0 skipped=0 retry=0` and wrote nothing. With the default setting it raises `CommandError`.
- `git diff 6dbda1b --stat -- engine contracts web api/fixtures/snapshots/v*.json`: empty. All changed files are LF.
- I/O matrix audit: every row has a covering test that ran and passed.

**Residual risks:**
- The `slow`-tagged engine sweeps were not run; the batch driver runs the full suite.
- PDF rendering stays mocked locally (WeasyPrint native libraries are missing).
- Production stays on schema 1 until the operator flips `SNAPSHOT_WRITE_VERSION=2` and runs the backfill. That must not happen in the deploy that first ships Epic 8, and needs a fresh restic backup first.
- The default-name text (ar, en, fr) needs native review. It uses the site Locale, not each user's.
