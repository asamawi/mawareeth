---
title: 'Story 8.5: Keep terms and Locale settings consistent across consumers'
type: 'feature'
created: '2026-11-17'
status: 'done'
baseline_revision: '7b54ade0d4cd5237a98609b1f0fd2be670689a79'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
warnings: [multiple-goals, oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** The same fiqh term is held in up to three places with different wording. Relationship names live in `messages.ts`, in the PDF's `Report relationship: <code>` msgids and in legacy msgids. Refusal reasons live in `messages.ts` and in `calc/schools.py`. Proof labels live only in `.po`. For example, French `paternal_brother` is "Frère consanguin" in the PDF but different on screen. The Locale list (`ar`, `en`, `fr`), direction and fonts are hard-coded in at least six files. No check stops an empty or missing key or a placeholder mismatch.

**Approach:**
- Add `i18n/locales.json` (Locale registry) and `i18n/terms/<locale>.json` (fiqh term catalog, in the 8.1 catalog contract shape). Django, Next.js, the PDF and SEO read Locale settings from the registry. Code-keyed fiqh consumers read terms from the catalog.
- Add one Node validator/generator. It checks the registry, the catalogs, `messages.ts`, `public-pages.ts` and the `.po` files, and generates a typed Next.js module, rejecting drift.
- Add a Python PDF glyph check that gates publication.

## Boundaries & Constraints

**Always:**
- **Catalog shape.** Each catalog is exactly the 8.1 contract: `{schema_version:1, locale, terms:{key:{text, review, placeholders}}}`, and parses with `engine.contracts.catalog.parse_catalog`. `review` is `pending` for every existing and new term. Nothing is marked `reviewed`.
- **Required keys.** The required key set is derived from `engine/contracts/codes.py`:
  - `relationship.<RELATIONSHIPS>`
  - `school.<SCHOOLS>` and `school.<SCHOOLS>.description`
  - `basis.<BASIS_KINDS>`
  - `refusal.<REFUSAL_REASONS>`
  - `proof.rule.<PROOF_RULES>`, `proof.condition.<PROOF_CONDITIONS>`, `proof.blocked_by.<BLOCKED_BY>`, `proof.school_rule.<SCHOOL_RULES>`, `proof.option.<PROOF_OPTIONS>`, `proof.step.<PROOF_STEPS>`
  - `proof.verse.quran_4_11`, `proof.verse.quran_4_12`, `proof.verse.quran_4_176` (verse code `4:11` ↔ key segment `quran_4_11`).
- **Canonical text.**
  - Where `messages.ts` already has the code (relationships, madhabs name/description, previewReasons), the catalog text is the `messages.ts` text, byte-for-byte, so the screen does not change.
  - Proof labels take the current `.po` msgstr of each locale (for `en`, the msgstr, which equals the msgid).
  - `basis.*` has no existing text. Draft it new: en "Compare the four Sunni schools" / "One school" / "Country law", plus ar and fr equivalents. Record it in deferred-work for native review.
- **Arabic original.** The Arabic original is the `ar` catalog entry with the same key, referenced by key. Non-`ar` catalogs contain no Arabic-script characters (U+0600–U+06FF, U+0750–U+077F, U+08A0–U+08FF, U+FB50–U+FDFF, U+FE70–U+FEFF).
- **Registry fields.**
  - Top level: `{schema_version:1, default_locale:"ar", fallback_locale:"en", locales:[...]}` in order ar, en, fr.
  - Each Locale has `code`, `direction` (`rtl`|`ltr`), `babel_locale`, `numbering_system`, `own_name`, `pdf_font_stack` (non-empty array of family names), `published` (bool) and `review` (`reviewed`|`pending`).
  - Values: ar = rtl / `ar` / `latn` / "العربية"; en = ltr / `en` / `latn` / "English"; fr = ltr / `fr` / `latn` / "Français".
  - Font stack for all three: `["Noto Naskh Arabic", "Noto Sans"]`. All three are `published: true` and `review: "pending"`.
  - `latn` is today's digit behaviour: Node ICU resolves `ar` to `latn`, and the PDF prints Latin digits.
- **Published Locales.** Only published Locales feed Django `LANGUAGES`, Next.js `locales`, hreflang and the sitemap. The registry does not add a language or preset.
- **Divergent server wording.** Server consumers that today word a code differently switch to the catalog text. These are `schools.REASONS`/`LAYERED_REASONS` and report `RELATIONSHIPS`/`SCHOOLS`. List every such before→after string per locale in deferred-work.md for native review.
- **Validator errors.** Each validator error names the file, the Locale and the key/msgid path. Generated output is deterministic: sorted keys, LF, trailing newline, lint-clean.

**Never:**
- Change the text of an existing `messages.ts` value, `.po` msgstr or public page, except as follows: fill the two empty `Cancel` msgstrs (ar "إلغاء", fr "Annuler"; record them in deferred-work), and the intended divergent-wording convergence above.
- Exempt a Locale, mark text reviewed, or add a Locale.
- Move general UI copy, legacy calc template heir-class msgids (`Mother`, `GrandFather`…), report `COMBINATION_RELATIONS`, or results/table fiqh copy in `messages.ts`. These belong to 8.6/8.7/Epic 12; record them as deferred.
- Add Babel formatting (8.6). Change `web/src/interview/format.ts`. Import `i18n` from `engine/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Clean tree | committed registry, catalogs, messages, .po, generated module | `node scripts/i18n.mjs` exits 0 | — |
| Missing catalog key | `fr.json` lacks `relationship.uncle` | exit 1, `i18n/terms/fr.json: fr: missing key relationship.uncle` | CI fails |
| Empty term / message / msgstr | `""` or whitespace-only text in catalog, messages.ts, public-pages.ts, or a non-header .po msgstr (any plural form) | exit 1 naming file, Locale and key/msgid | CI fails |
| Placeholder mismatch | catalog `{base}` declared `int` in en but `fraction` in fr; messages key `{heir}` in en but `{name}` in ar; .po msgstr lacks msgid's `%(n)s`/`{n}` | exit 1 naming Locale/key and both placeholder sets | CI fails |
| Key parity | messages/public-pages key path or .po msgid present in one Locale only; extra catalog key | exit 1 per offending key | CI fails |
| Fuzzy / PO header | fuzzy entry; header `msgid ""` with metadata | fuzzy → error; header treated as metadata, never an empty-message error | — |
| Copied Arabic | `en.json` text containing Arabic script | exit 1 | CI fails |
| Registry invalid | missing field, duplicate code, bad direction, empty font stack, default/fallback not a published code, no catalog file for a code | exit 1 naming Locale and field | CI fails |
| Drift | generated module edited by hand or stale | check mode exits 1 `generated output drift: run npm run i18n:write`; write mode rewrites it identically on rerun | CI fails |
| Glyph gap | a published Locale's text has a char no font in its stack covers | `python -m i18n.glyphs` exits 1 naming Locale, key/msgid and U+code | CI fails; publication blocked |
| Font absent | a stack family is not installed | glyph check exits 1 naming the family | CI fails |
| Term lookup | `i18n.term('relationship.father', 'fr-ca')` / unregistered `de` / unknown key | base-language `fr` text / `fallback_locale` text / `KeyError` | — |

</intent-contract>

## Code Map

- `engine/contracts/catalog.py` -- `parse_catalog`/`dump_catalog`/`KEY_RE`/`PLACEHOLDER_RE`. Reuse it; do not change the contract. `engine/contracts/codes.py` -- the vocabularies the required keys derive from.
- `calc/proof.py:72-166` -- `LABELS` (63 lazy gettext labels by kind→code), `VOCABULARY`, `label(kind, code)`. Callers: `calc/models.py:962`, `calc/manasikhat.py:113`, `api/preview.py:83,246` (`_labelled`), with values consumed by `reports/report.py:80`. `calc/tests.py:2872` `ProofLabelTests`.
- `calc/schools.py:37-57` -- `REASONS`, `LAYERED_REASONS`, `UnsupportedCase.message`. Callers: `api/preview.py:255`, `api/tests.py:1499`, `api/test_contract_codes.py:25`, `calc/tests.py:2211,3451` (these use the dict keys; keep the dicts keyed by code).
- `reports/report.py:9-46,100-110` -- `RELATIONSHIPS` (23) and `SCHOOLS` (5) `gettext_noop("Report relationship: …")` tables. `build_context` sets the direction by an Arabic-prefix check. `reports/templates/reports/draft.html:2,6` hard-codes `font-family`. `reports/tests.py:215,229`.
- `mawareeth/settings.py:293` (`LANGUAGE_CODE`) and `:354` (`LANGUAGES`). `mawareeth/web_headers.py:14` (`LANGUAGES` tuple). `mawareeth/web_views.py:27,54`. `mawareeth/tests.py:759` (`test_export_locales_match_django_languages` regex-reads messages.ts; update it to read the registry/generated module). Legacy `calc/templates/calc/base.html:73-77` shows `name_local` only, so `LANGUAGES` names can be `own_name`.
- `web/src/i18n/messages.ts:3-13` -- `locales`, `Locale`, `isLocale`, `directionOf`. `:135,148,175` -- the `relationships`, `madhabs` and `previewReasons` types. Values at ar `:383,463,~496`, en `:699,780,~812`, fr `:1015,1098,~1131`.
- `web/src/i18n/paths.ts:6` -- hard-coded `["ar","en","fr"]`.
- `web/src/app/[locale]/site-nav.tsx:14-16` -- own-name table.
- `web/src/seo/site.ts:21-30` -- hreflang/public URLs from `locales`. Keep the `openGraphLocale` map.
- `web/src/app/sitemap.ts`. `web/src/app/[locale]/layout.tsx:16,47`.
- `locale === "ar" ? "rtl" : "ltr"` call sites: `auth-form.tsx:93`, `cases/page.tsx:7`, `invite/page.tsx:12`, `received/page.tsx:12`, `results/auth-gate.tsx:109`, `results/share-panel.tsx:70,96`, `results/whatsapp-panel.tsx:27`, `shared/page.tsx:12`.
- `web/src/i18n/public-pages.ts:14,31` -- `Record<Locale, PublicPageText>`; validate only, never edit.
- `web/package.json:8-15` -- the scripts. Unit tests: `node --import ./src/test/loader.mjs --test "src/**/*.test.{ts,tsx}"`. `web/.nvmrc` = 26.13.0. `web/scripts/check-export.mjs` is the style reference.
- `locale/{ar,en,fr}/LC_MESSAGES/django.{po,mo}` -- 573 entries each. One empty msgstr (`Cancel`) in ar and in fr; none fuzzy. `.mo` files are committed and compiled with polib (`pyproject.toml:26 polib==1.2.0`). The compiled-vs-`.po` checks are at `calc/tests.py:1351,1365`.
- `.github/workflows/django.yml` -- `validate` job: setup-uv, `uv sync`, "Engine purity gate" at `:87`. `web` job: `npm ci` at `:279`, then Lint.
- `Dockerfile:39` -- `COPY . .` (`i18n/` ships). `:91` -- `fonts-noto-core`.
- `pyproject.toml:40` -- weasyprint 70.0 brings fontTools.

## Tasks & Acceptance

**Execution:**
- `i18n/locales.json`, `i18n/terms/{ar,en,fr}.json` (new) -- Registry and catalogs per Boundaries. Extract the texts mechanically with a scratch script, not by hand.
- `i18n/__init__.py` (new, stdlib + `engine.contracts`) -- Holds:
  - `registry()`, `published_codes()`, `locale_config(code)`, `default_locale()`, `fallback_locale()`, `catalog(code)` (cached, parsed by `parse_catalog`);
  - `resolve_locale(tag)` (lowercases, takes the base language, and falls back to `fallback_locale` when unregistered);
  - `term(key, locale)` (raises `KeyError` for an unknown key);
  - `django_languages()` returning `[(code, own_name)]`.
- `i18n/glyphs.py` (new) -- `check(locales, texts, resolve_font) -> list[str]` (pure; one error per Locale/key/char, skipping whitespace and Unicode category `Cf`/`Cc`) and a CLI `python -m i18n.glyphs`. The CLI covers every published Locale's catalog texts plus its `.po` msgstrs, resolves families with `fc-list : family file` and reads cmaps with fontTools. It exits 1 on any gap or any missing family. If `fc-list` is unavailable it exits 2 with a clear message (no silent pass).
- `i18n/tests.py` (new) -- Covers:
  - the lookup/fallback matrix rows;
  - registry→`settings.LANGUAGES`/`LANGUAGE_CODE`/`web_headers.LANGUAGES` equality;
  - every required key present in each catalog;
  - `proof.label` equals the catalog for every `VOCABULARY` code in ar/en/fr;
  - report direction/font from the registry;
  - glyph `check` with fake cmaps (missing char fails and names Locale/key/U+code; covered passes; `Cf` skipped).
- `calc/proof.py` -- Replace `LABELS` with catalog lookups. `label(kind, code)` returns `i18n.term(f'proof.{kind}.{seg}', translation.get_language())`, where `seg` maps verse codes. Keep `VOCABULARY` and the signatures.
- `calc/schools.py` -- `REASONS`/`LAYERED_REASONS` stay dicts keyed by code, but their values are lazy objects whose `str()` is `i18n.term('refusal.<code>', active language)`.
- `reports/report.py` + `draft.html` -- `relation()`/school use `i18n.term('relationship.<code>'|'school.<code>', locale)`. The `RELATIONSHIPS`/`SCHOOLS` gettext tables are removed. Keep `SAME_IN_ALL_SCHOOLS`/`COMBINATION_RELATIONS`. The direction and the CSS font-family list come from `locale_config(resolve_locale(locale))`.
- `locale/*/LC_MESSAGES/django.po|.mo` -- Remove the moved msgids from all three, but only where no remaining source references them: the 63 proof labels, the 3 refusal sentences, and the `Report relationship:`/`Report school:` entries. Fill the two `Cancel` gaps. Recompile `.mo` with polib.
- `mawareeth/settings.py`, `mawareeth/web_headers.py` -- `LANGUAGES = i18n.django_languages()`, `LANGUAGE_CODE = i18n.default_locale()`, `web_headers.LANGUAGES = tuple(i18n.published_codes())`.
- `web/src/i18n/validate.ts` (new, pure) + `validate.test.ts` -- Holds:
  - `parsePo` (multi-line strings, plurals, flags, `#~` obsolete skipped, header as metadata);
  - the registry, catalog, messages-tree and po validators;
  - `generateModule(registry, catalogs) -> string`.
  Tests cover every validator row of the matrix with inline samples.
- `web/scripts/i18n.mjs` (new) -- A CLI with a check default and `--write`. It reads `../i18n` and `../locale`, imports `messages.ts` and `public-pages.ts`, prints all errors, and exits 1 on any. `package.json` gets `"i18n": "node --import ./src/test/loader.mjs scripts/i18n.mjs"` and `"i18n:write": "… --write"`.
- `web/src/i18n/catalog.generated.ts` (generated, committed) -- Exports:
  - `locales` (published, as const), `Locale`, `defaultLocale`, `fallbackLocale`;
  - `localeConfig: Record<Locale,{direction,ownName,numberingSystem,babelLocale,published,review}>`;
  - `TermKey` union, `terms: Record<Locale, Record<TermKey,string>>`, `termPlaceholders`.
  Header comment: generated, do not edit.
- `web/src/i18n/messages.ts` -- Re-export `locales`/`Locale` from the generated module. `isLocale` and `directionOf` use it. The values of `relationships`, `madhabs` and `previewReasons` are built from `terms[locale]` (types unchanged, text identical).
- `web/src/i18n/paths.ts`, `site-nav.tsx`, and the `dir` call sites listed -- Use `locales`/`localeConfig`/`directionOf` instead of literals.
- `mawareeth/tests.py` -- Repoint `test_export_locales_match_django_languages` at the registry/generated module.
- `.github/workflows/django.yml` --
  - `web` job: a step `Validate i18n catalogs` (`npm run i18n`) after Install dependencies.
  - `validate` job: after Engine purity gate, `sudo apt-get install -y --no-install-recommends fonts-noto-core fontconfig`, then `PDF glyph check` (`python -m i18n.glyphs`).
- `_bmad-output/implementation-artifacts/deferred-work.md` -- One section for 8.5. It lists the new `basis.*` texts, the `Cancel` fills, every converged server/PDF string (before→after per Locale), the out-of-scope fiqh copy left in place, and that the Locale `review` for ar/en/fr is `pending` pending an Epic 12/18 decision.

**Acceptance Criteria:**
- Given the repository after this story, when `npm run i18n` runs in `web/`, then it exits 0, and `npm run i18n:write` leaves `git status` clean.
- Given the web app after this story, when `npm test`, `npm run lint`, `npm run typecheck` and `npm run build` run, then they pass, and screen text for relationships, schools and refusal reasons is unchanged (`git diff` of the rendered `messages` values is empty).
- Given a request in ar, en and fr, when a proof label or refusal is rendered by preview or the PDF, then its text equals `i18n/terms/<locale>.json`. No `LABELS`/`RELATIONSHIPS`/`SCHOOLS` text tables remain in `calc/proof.py` or `reports/report.py`.
- Given the registry, when Django settings, `web_headers`, the generated module, the sitemap, hreflang and the PDF direction/font are inspected, then all derive from it, and no `["ar","en","fr"]` literal or `=== "ar" ? "rtl"` remains in `web/src` outside tests and the generated file.
- Given the Python side, when the targeted Django tests run, then they pass and `makemigrations --check --dry-run` reports no changes.

## Spec Change Log

## Review Triage Log

### 2026-11-17 — Review pass
- verdicts: 33 findings — high 0, medium 3, low 23, false 7, maybe-false 0
- findings:
  - **Blind hunter**
    - `[medium]` `[patch]` (blind) The CI font install runs `apt-get install` without `apt-get update`. — Confirmed at `django.yml:92`; stale runner indexes make it 404. Patched: `sudo apt-get update` runs first in the same step.
    - `[false]` `[reject]` (blind) No production font install, and fontTools/polib are undeclared. — `Dockerfile:91` already installs `fonts-noto-core`. `polib` is declared (`pyproject.toml:26`), and fontTools ships with weasyprint.
    - `[low]` `[reject]` (blind) The `font_family` `mark_safe` CSS injection. — The values come only from the developer-owned registry, not user input. A guard adds validator complexity for an unlikely developer error.
    - `[low]` `[reject]` (blind) `refusal.school_not_supported` names the Ja'fari school. — This is the existing `messages.ts` text (`messages.ts@7b54ade:495,811,1130`). The spec makes it canonical, Ja'fari is the only unsupported School, and the change is listed for native review.
    - `[low]` `[reject]` (blind) The `term()` cast in `messages.ts` drops key typing. — The id arrays are typed with `satisfies RelationshipId[]` etc., so only the literal prefix could typo. Every screen test renders these maps.
    - `[low]` `[reject]` (blind) The verse list is duplicated across validate.ts, the tests and proof.py. — Drift between them fails the key-completeness checks on both sides. This is cosmetic.
    - `[false]` `[reject]` (blind) No `.mo`-vs-`.po` check. — `calc/tests.py:1352,1364` (`test_compiled_catalogs_match_po_files`) already checks this.
    - `[low]` `[reject]` (blind) The report still mixes gettext and catalog sources. — The intent contract's Never list leaves `COMBINATION_RELATIONS` and the general copy in `.po`, and they are recorded in deferred-work.
    - `[low]` `[reject]` (blind/edge) The `LANGUAGE_CODE` env override is not checked against the registry. — The override already existed, and no deployment sets it.
    - `[low]` `[reject]` (blind) `npm run i18n` is not run in local flows. — CI gates it. Adding a pretest hook is a workflow preference.
    - `[low]` `[reject]` (blind/edge) The fc-list `': '` parsing. — Debian font paths never contain `': '`. Any mis-parse fails loudly as a missing family, never as a silent pass.
    - `[low]` `[reject]` (blind) Assorted Python test gaps (unpublished Locale in `build_context`, `label()` KeyError). — These are unreachable today because all Locales are published. `test_term_resolves_…` covers the KeyError path.
    - `[low]` `[reject]` (blind) The `i18n` package name may shadow PyPI `i18n`. — That package is not a dependency and is not installed.
    - `[false]` `[reject]` (blind) Importing `i18n` in settings risks a circular import through engine. — `engine.contracts` is pure stdlib with no Django or project imports (8.4 purity gate). The settings import ran in every test.
    - `[false]` `[reject]` (blind) All three Locales share the Naskh-first font stack. — This is identical to the previous hard-coded `draft.html` stack, so behaviour is unchanged, as the spec chose.
  - **Edge-case hunter**
    - `[low]` `[reject]` (edge) The fc-list parse. — Grouped with the blind row above.
    - `[low]` `[reject]` (edge) `getBestCmap()` returning None is swallowed. — The effect is less coverage, which fails loudly as glyph errors and never passes silently. This is rare for Noto fonts.
    - `[low]` `[reject]` (edge) The absent-family error does not say coverage was skipped. — Cosmetic message wording.
    - `[low]` `[reject]` (edge) The `label()` KeyError names only the code. — Cosmetic.
    - `[low]` `[reject]` (edge) The `LANGUAGE_CODE` env override. — Grouped with the blind row above.
    - `[false]` `[reject]` (edge) An empty fallback catalog generates invalid TS. — `validateCatalogs` fails missing required keys before generation runs (`i18n.mjs` exits first).
    - `[low]` `[reject]` (edge) Positional `%s`/`%d` placeholders are not compared in `.po`. — The `.po` files use named placeholders. This is an extra guard for an unseen case.
    - `[low]` `[reject]` (edge) Placeholder parity is only checked against the fallback tree. — The fallback (en) holds every key, and key-parity errors fire first.
    - `[low]` `[reject]` (edge) Unknown `.po` backslash escapes are kept literally. — No such escapes exist in the `.po` files.
    - `[low]` `[reject]` (edge) Multi-segment Locale tags (`zh-Hans`). — Only ar/en/fr exist. This is a future concern for Epic 19.
    - `[low]` `[reject]` (edge) The `Arabic`/`English`/`French` msgids are left unused in `.po`. — They are harmless and are not fiqh terms. The legacy switcher uses Django `name_local`.
  - **Verification-gap reviewer**
    - `[medium]` `[patch]` (verification-gap) The rendered PDF `font-family` is never asserted. — Pre-verified. Patched: the reports rendered-HTML test asserts the registry stack per Locale.
    - `[medium]` `[patch]` (verification-gap) The language switcher's `ownName` names are untested. — Pre-verified. Patched: a `SiteNav` test asserts the three own-script names and the current-Locale marking.
    - `[low]` `[reject]` (verification-gap, other) `directionOf` has no direct test at the converted sites. — The shared function is exercised through `AuthForm`, and each site change is a one-token substitution.
    - `[low]` `[reject]` (verification-gap/intent, other) Report and proof tests compare against the catalog they read. — The catalog wording was extracted mechanically. The rendered `messages` JSON was diffed identical before and after, and wording review is deferred to Epic 12.
    - `[false]` `[reject]` (verification-gap, other) fontTools is not a declared dependency. — It is locked via weasyprint (`uv.lock` fonttools 4.68.0) and imported only by the CI/CLI glyph check.
  - **Intent-alignment auditor**
    - `[low]` `[reject]` (intent) The glyph check has never run against real fonts. — The real-font code path was smoke-tested locally with installed Arial (cmap read, no errors), and CI runs it with `fonts-noto-core`. Recorded as a residual risk.
    - `[false]` `[reject]` (intent) The report keeps `COMBINATION_RELATIONS`/`SAME_IN_ALL_SCHOOLS` in gettext. — The intent contract's Never list explicitly keeps them.

## Design Notes

**Why one Node validator.** `messages.ts` and `public-pages.ts` are TypeScript, and the web job already has Node. Only a JS tool can read them without a second parser. It also reads the JSON catalogs and the `.po` files, so there is one gate and one error format. The Python `i18n` loader only parses (via the 8.1 contract) and never validates completeness.

**Why web wording is canonical.** AD-21's goal is one translation per term. The `messages.ts` wording is the newest UX-reviewed screen text, and 8.6 presentation will serve all renderers from this catalog. So the PDF and server sentences converge onto it. Every changed string stays `pending` and is listed for the Epic 12 wording pass (FR-32/33).

Example catalog entry:
```json
"proof.step.awl": {"text": "Awl: the base is raised because the fixed shares exceed the estate", "review": "pending", "placeholders": {}}
```

## Verification

**Commands:**
- `cd web && npm run i18n` -- expected: exit 0. Then `npm run i18n:write && git status --porcelain web/src/i18n` -- expected: empty.
- `cd web && npm test && npm run lint && npm run typecheck && npm run build` -- expected: all pass.
- `uv run python manage.py test i18n calc.tests.ProofLabelTests reports mawareeth.tests api.test_contract_codes --noinput` -- expected: all pass.
- `uv run python manage.py test calc.tests api.tests --noinput` -- expected: all pass (only expectation updates for listed converged strings).
- `uv run python -m unittest engine.tests.test_purity` -- expected: OK.
- `uv run python manage.py makemigrations --check --dry-run` -- expected: No changes detected.
- `uv run python -m i18n.glyphs` -- expected: exit 0 on CI. Locally, exit 2 is acceptable only when `fc-list` is absent, and must be recorded.

## Auto Run Result

Status: done

**Summary:** Fiqh terms and Locale settings now each have one owner (AD-21).
- `i18n/locales.json` is the Locale registry. Django `LANGUAGES`/`LANGUAGE_CODE`, `web_headers`, the auth redirects, the Next.js `locales`/direction/switcher names, hreflang, the sitemap and the PDF direction and font stack all derive from it.
- `i18n/terms/{ar,en,fr}.json` hold 103 fiqh terms each, all `pending`: relationships, Schools and descriptions, Basis kinds, refusal reasons and proof labels.
- The proof labels, server refusal sentences and PDF relationship/School names read the catalog. The `.po` duplicates are removed.
- One Node validator/generator (`npm run i18n`) gates the registry, catalogs, `messages.ts`, `public-pages.ts` and the `.po` files, and keeps `catalog.generated.ts` drift-free.
- `python -m i18n.glyphs` gates PDF glyph coverage on CI.

**Files:**
- `i18n/__init__.py`, `i18n/locales.json`, `i18n/terms/*.json`: registry, catalogs and the pure loader (`term`, `resolve_locale`, `django_languages`).
- `i18n/glyphs.py`: the pure glyph `check`, plus a CLI using fontconfig and fontTools. Its stdout decode was hardened during verification.
- `i18n/tests.py`: lookup/fallback, registry→settings, key completeness, label/refusal/report wiring, and glyph check self-tests.
- `calc/proof.py`, `calc/schools.py`: the label/refusal tables are replaced by catalog lookups.
- `reports/report.py`, `reports/templates/reports/draft.html`: catalog relationship/School names; direction and font stack from the registry.
- `mawareeth/settings.py`, `mawareeth/web_headers.py`, `mawareeth/web_views.py`, `api/auth_views.py`: Locale lists and fallback from the registry.
- `locale/*/LC_MESSAGES/django.po|.mo`: 94 moved msgids removed per Locale; the `Cancel` gaps filled; recompiled with polib.
- `web/src/i18n/validate.ts`, `validate.test.ts`, `web/scripts/i18n.mjs`, `catalog.generated.ts`, `web/package.json`: the validator/generator and its tests. A `driftErrors` helper was added during the matrix audit.
- `web/src/i18n/messages.ts`, `paths.ts`, `site-nav.tsx`, error pages and eight `dir` call sites: registry/catalog driven, with screen text unchanged.
- Tests updated to the catalog: `calc/tests.py`, `reports/tests.py`, `mawareeth/tests.py`, `web/src/app/[locale]/auth-form.test.tsx`. `api/contracts/preview-fixtures.json` follows the intended `malikiyya_disputed` convergence.
- `.github/workflows/django.yml`: `Validate i18n catalogs` in the web job, plus the font install and `PDF glyph check` in validate.
- `deferred-work.md`: the 8.5 native-review list (basis drafts, `Cancel` fills, 12 converged strings, out-of-scope fiqh copy, Locale review state).

**Review:** 33 findings.
- Patched (3 medium): the CI `apt-get update`, a rendered PDF `font-family` assertion, and a language-switcher own-name test.
- Deferred: none.
- Rejected: 23 low and 7 false, each with its reason in the triage log.

**Follow-up review recommended: true.** This first pass patched 3 medium and 0 high (patched counts: high 0, medium 3, low 0). The unverified risk is that the real glyph check and the CI font install have never run against Noto fonts. The first CI run of `PDF glyph check` should be watched.

**Verification:**
- `npm run i18n`: OK, and `i18n:write` produces no change.
- `npm test`: 499 pass. `npm run lint`: 0 errors (10 warnings, the same as before). `npm run typecheck`: clean.
- `npm run build`: passed before the review patches, which touched only tests and CI.
- `manage.py test i18n calc.tests.ProofLabelTests reports mawareeth.tests api.test_contract_codes api.tests.PreviewTests`: 176 OK (1 skipped).
- `engine.tests.test_purity`: OK. `makemigrations --check`: no changes.
- `python -m i18n.glyphs` locally: exit 1, Noto families not installed (expected on this host). The real-font path was smoke-tested with Arial.
- The full `calc.tests api.tests` run (457 tests) showed 10 failures, all expected converged refusal strings. They were fixed, and the affected classes were re-run green. The whole suite was not re-run; the driver's batch run covers it.

**Residual risks:**
- The PDF glyph check is unproven on CI fonts.
- 12 server/PDF strings changed wording to match the screen. They are pending native review (Epic 12).
- Locale `review` for ar/en/fr is `pending`. A future Beta-label consumer must decide whether that should show Beta on the existing Locales.
