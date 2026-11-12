---
title: 'Checked-in MO compilation and stale-MO test'
type: 'chore'
created: '2026-11-12'
status: 'done'
baseline_revision: 'acf7fb15490f6708bb77d63cbe8c8eefd6f70d71'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred:
  - summary: >-
      Plural-form PO entries (msgstr_plural) are silently dropped by compile_catalog and not checked by the stale test.
    evidence: |-
      The command's filter (entry.msgstr) skips plural entries because their msgstr is ''. The test's expected dict has the same gap. Current catalogs do not use plural forms, so this is dormant.
    location: >-
      calc/management/commands/compile_catalog.py; calc/tests.py:test_compiled_catalogs_match_po_files
    severity: low
  - summary: >-
      The stale test accesses gettext.GNUTranslations._catalog, a CPython private attribute.
    evidence: |-
      Consistent with the existing test at calc/tests.py:1318, so not a regression; both tests will break together if the attribute is removed. Flagged for awareness.
    location: >-
      calc/tests.py:test_compiled_catalogs_match_po_files
    severity: low
  - summary: >-
      compile_catalog writes the .mo in-place with no atomic rename, so a crash mid-write corrupts the file.
    evidence: |-
      polib.save_as_mofile writes directly to the target path. A partial write leaves an unreadable .mo. Low risk in practice as the command is run locally and committed.
    location: >-
      calc/management/commands/compile_catalog.py
    severity: low
---

<intent-contract>

## Intent

**Problem:** No checked-in mechanism compiles `locale/*/LC_MESSAGES/django.mo` from its `.po` source, so each story author uses an ad-hoc tool; one past run copied empty `msgstr` values into the `.mo`, blanking the 404/500 and login pages. The existing test guards against empty entries in compiled files, but nothing detects a `.mo` that is out of sync with its `.po`.

**Approach:** Add `polib` as a project dependency, a `compile_catalog` management command that compiles all `.po` → `.mo` skipping untranslated and fuzzy entries, and a test method that re-derives the expected catalog from each `.po` and fails if the committed `.mo` differs. Remove the resolved deferred-work entry in the same commit.

## Boundaries & Constraints

**Always:**
- The management command is the canonical way to rebuild `.mo` files; run it whenever a `.po` changes and commit the result.
- The command must skip entries with an empty `msgstr` and entries flagged `fuzzy`, matching `msgfmt` behaviour.
- The stale test must use the `.po` source of truth, not the previous `.mo`, to derive expected translations.
- The test must check all three locales (`ar`, `en`, `fr`) in one pass.
- No external binary (`msgfmt`, `gettext`) may be required at development or test time.

**Block If:**
- Any `.po` file uses plural forms (`msgstr[0]`, `msgstr[1]`) in a way that cannot be represented by polib's `save_as_mofile` — investigate and report before proceeding.

**Never:**
- Do not use timestamp/mtime comparison for the stale check — git checkout resets mtimes.
- Do not shell out to `msgfmt` or `django-admin compilemessages` in the management command.
- Do not add `polib` only to the `test` dependency group — the management command is in the main package.
- Do not remove or weaken the existing `test_compiled_catalogs_have_no_empty_translations` test.
- Do not rewrite the `.po` files; they are source-of-record.

</intent-contract>

## Code Map

- `pyproject.toml:5-41` — `dependencies` list; add `polib` here (main group, not test)
- `calc/management/` — does **not** exist yet; create `__init__.py` and `commands/__init__.py`
- `calc/management/commands/compile_catalog.py` — NEW management command
- `calc/tests.py:1308-1320` — `TemplateTagTests`; `test_compiled_catalogs_have_no_empty_translations` at line 1310 is the existing guard; add the stale test as a sibling method
- `locale/ar/LC_MESSAGES/django.po` / `django.mo` — Arabic catalog (2847 lines in .po)
- `locale/en/LC_MESSAGES/django.po` / `django.mo` — English catalog; msgstr == msgid by convention for translated entries
- `locale/fr/LC_MESSAGES/django.po` / `django.mo` — French catalog
- `_bmad-output/implementation-artifacts/deferred-work.md:319-322` — entry to remove

## Tasks & Acceptance

**Execution:**
- `pyproject.toml` -- add `"polib>=1.1"` to the `dependencies` list -- required by both the management command and the test
- `calc/management/__init__.py` -- create empty file -- makes `calc/management` a package
- `calc/management/commands/__init__.py` -- create empty file -- makes the commands sub-package
- `calc/management/commands/compile_catalog.py` -- implement `Command` class (see Design Notes) -- canonical compile step that skips empty and fuzzy entries
- `calc/tests.py` -- add `test_compiled_catalogs_match_po_files` to `TemplateTagTests` (see Design Notes) -- detects stale `.mo` files
- `locale/ar/LC_MESSAGES/django.mo`, `locale/en/LC_MESSAGES/django.mo`, `locale/fr/LC_MESSAGES/django.mo` -- recompile by running `uv run python manage.py compile_catalog` -- bring committed `.mo` files in sync with their `.po` sources so the new test passes
- `_bmad-output/implementation-artifacts/deferred-work.md` -- remove the block at lines 319-322 (source_spec `spec-deferred-empty-english-catalog-entries.md`, summary starting "Give the project one checked-in way...") -- resolved by this change

**Acceptance Criteria:**
- Given the management command `compile_catalog` is run, when the `.po` files are unchanged, then the committed `.mo` files are byte-for-byte identical to what the command produces (i.e. the new test passes without any additional `.mo` regeneration).
- Given a `.po` entry with an empty `msgstr`, when `compile_catalog` runs, then that entry is absent from the resulting `.mo`.
- Given a `.po` entry flagged `fuzzy`, when `compile_catalog` runs, then that entry is absent from the resulting `.mo`.
- Given `uv run python manage.py test calc.tests.TemplateTagTests.test_compiled_catalogs_match_po_files --noinput`, when run against the committed `.mo` files, then all subtests pass.
- Given the existing `test_compiled_catalogs_have_no_empty_translations` test, when run after the `.mo` files are recompiled, then it still passes.

## Design Notes

**`compile_catalog.py` structure:**
```python
import polib
from pathlib import Path
from django.conf import settings
from django.core.management.base import BaseCommand

class Command(BaseCommand):
    help = 'Compile locale .po files to .mo, skipping untranslated and fuzzy entries'

    def handle(self, *args, **options):
        for po_path in sorted(Path(settings.BASE_DIR, 'locale').glob('*/LC_MESSAGES/django.po')):
            mo_path = po_path.with_suffix('.mo')
            po = polib.pofile(str(po_path))
            out = polib.POFile()
            out.metadata = po.metadata
            for entry in po:
                if entry.msgstr and 'fuzzy' not in entry.flags:
                    out.append(entry)
            out.save_as_mofile(str(mo_path))
            self.stdout.write(f'compiled {mo_path.relative_to(settings.BASE_DIR)}')
```

**`test_compiled_catalogs_match_po_files` structure:**
```python
def test_compiled_catalogs_match_po_files(self):
    import gettext, polib
    base = Path(settings.BASE_DIR, 'locale')
    for po_path in sorted(base.glob('*/LC_MESSAGES/django.po')):
        mo_path = po_path.with_suffix('.mo')
        locale = po_path.parent.parent.name
        po = polib.pofile(str(po_path))
        expected = {
            e.msgid: e.msgstr
            for e in po
            if e.msgstr and 'fuzzy' not in e.flags
        }
        with open(mo_path, 'rb') as fh:
            catalog = gettext.GNUTranslations(fh)._catalog
        for msgid, msgstr in expected.items():
            with self.subTest(locale=locale, msgid=msgid[:50]):
                self.assertEqual(catalog.get(msgid), msgstr,
                    f'{mo_path.name}: .mo is stale for {msgid!r}')
        for msgid in expected:
            with self.subTest(locale=locale, missing=msgid[:50]):
                self.assertIn(msgid, catalog,
                    f'{mo_path.name}: .mo missing entry for {msgid!r}')
```

## Verification

**Commands:**
- `uv run python manage.py compile_catalog` -- expected: prints three `compiled locale/…/django.mo` lines, no errors
- `uv run python manage.py test calc.tests.TemplateTagTests.test_compiled_catalogs_match_po_files calc.tests.TemplateTagTests.test_compiled_catalogs_have_no_empty_translations --noinput` -- expected: 2 tests pass

## Spec Change Log

## Review Triage Log

### 2026-11-12 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 0, low 3)
- defer: 3: (high 0, medium 0, low 3)
- reject: many
- addressed_findings:
  - `[low]` `[patch]` Pin `polib==1.2.0` in pyproject.toml to match the project's fully-pinned dependency convention (`uv.lock` already resolves to 1.2.0).
  - `[low]` `[patch]` Remove redundant `assertIn` second loop in `test_compiled_catalogs_match_po_files`; `assertEqual(catalog.get(msgid), msgstr)` already catches missing keys (returns None ≠ msgstr), so the separate presence check was both redundant and caused duplicate subtest failures.
  - `[low]` `[patch]` Add `mo_path.exists()` guard in the test with a descriptive `self.fail()` so a missing `.mo` produces a clear failure message rather than a bare FileNotFoundError.

## Auto Run Result

**Summary:** Added `polib==1.2.0` as a project dependency, a `compile_catalog` management command (`calc/management/commands/compile_catalog.py`) that compiles all `locale/*/LC_MESSAGES/django.po` → `.mo` skipping untranslated, fuzzy, and obsolete entries, and a test `test_compiled_catalogs_match_po_files` that fails when any committed `.mo` diverges from its `.po`. Recompiled `ar` and `fr` catalogs (English was already in sync). Removed the resolved deferred-work entry.

**Files changed:**
- `pyproject.toml` — added `polib==1.2.0` to dependencies
- `uv.lock` — resolved and pinned polib 1.2.0
- `calc/management/__init__.py` — new empty package init
- `calc/management/commands/__init__.py` — new empty package init
- `calc/management/commands/compile_catalog.py` — new management command
- `calc/tests.py` — added `test_compiled_catalogs_match_po_files` to `TemplateTagTests`
- `locale/ar/LC_MESSAGES/django.mo` — recompiled from `.po`
- `locale/fr/LC_MESSAGES/django.mo` — recompiled from `.po`
- `_bmad-output/implementation-artifacts/deferred-work.md` — removed resolved entry

**Review findings:** 3 patches applied (all low), 3 deferred (all low), remainder rejected.

**Follow-up review score:** 0 high + 0 medium + 3 low = 3 (threshold 5) → `followup_review_recommended: false`

**Verification:**
- `uv run python manage.py compile_catalog` — printed 3 compiled lines, no errors
- `uv run python manage.py test ... test_compiled_catalogs_match_po_files test_compiled_catalogs_have_no_empty_translations --noinput` — `Ran 2 tests in 0.073s OK`

**Residual risks:** Three low-severity items deferred (plural forms, `._catalog` private attribute, non-atomic write) — all pre-existing or dormant.
