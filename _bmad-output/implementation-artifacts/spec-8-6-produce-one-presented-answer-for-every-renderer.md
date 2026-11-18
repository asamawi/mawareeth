---
title: 'Story 8.6: Produce one presented answer for every renderer'
type: 'feature'
created: '2026-11-17'
status: 'done'
baseline_revision: 'b7fc1023aa6cdb6bde37111c37b831869861dd23'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
warnings: [multiple-goals, oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** Preview, the PDF and the browser each compare Schools, round money and format numbers their own way:
- `api/preview.py` rounds amounts to 2 decimals with no currency.
- `reports/report.py` and `web/src/interview/preview.ts` both compute percent and kirat.
- `format.ts`/`answers.ts` format with `Intl`.

The 8.1 `PresentedResult` v1 is too thin to replace them. It has no percent or kirat, no proof or stage evidence, no per-School comparison detail, no School line and no unallocated amount.

**Approach:**
- Add a Django-free `presentation/` package. `present(outcome, basis, locale, currency)` becomes the only producer of a richer `PresentedResult` **v2**. It runs the comparison, attaches catalog labels and Arabic originals, selects notices, rounds money in integer minor units and formats every number once with Babel.
- Prove it against the existing corpus. No consumer switches: that is 8.7.

## Boundaries & Constraints

**Always:**
- **Package.** `presentation/` imports only stdlib, `engine`, `i18n` and `babel`. It has no Django, ORM, clock or request access, and no module-level mutable state.
- **Outcome.** `presentation.outcome(family, resolved_basis) -> Outcome` evaluates the core.
  - `compare`: the four Sunni Schools, in the order hanafi, maliki, shafii, hanbali.
  - `school`: that School only, Ja'fari included (it refuses as today).
  - `country`: the derived School.
  - `Outcome` holds the Family and `((school, engine.Evaluation), ...)`.
  - `present` itself never calls the engine.
- **Comparison.**
  - `presentation.compare(outcome) -> engine.contracts.Comparison` (8.1 contract, valid under `parse_comparison`).
  - **Agreement.** All four Schools are calculated and have identical per-person `(final share, blocked)` plus an identical unallocated fraction. This is the preview `_signature` rule. Blocked means kind `blocked` or a final share of 0.
  - **differing_persons.** Every person whose share or status differs between calculated Schools, in Family person order.
  - **Partial refusal.** Some Schools refused and some calculated. It is `difference`, with the refusals listed.
  - **all_refused.** Every School refused.
  - A compare Basis never has a `selected_school`, so `selection_required` is true on every `difference`.
- **States.**
  - **Agreement** gives `state:"answer"`, with rows from Hanbali (as preview does) and `school_line` `same_in_all_schools`.
  - **Difference** gives `state:"selection_required"`, with no rows and a filled `comparison`.
  - **all_refused or a refused School Basis** gives `state:"refused"`. There are no rows, rounding or unallocated share. `refusals` carries one entry per distinct reason, with the localized `refusal.<reason>` text.
  - **A calculated School Basis** gives `state:"answer"`, `school_line` `school` with that School's label, and `comparison` null.
- **Rows.**
  - One row per person in `engine.final_shares` (layers recomposed), in Family person order, blocked persons included with share 0.
  - `translated` = `i18n.term('relationship.<code>', locale)` with the Locale's lang and direction. `original` = the `ar` term, `lang:"ar"`, `dir:"rtl"`.
  - `name` is the Family name or null.
  - `kind` is the person's root-estate allocation kind, else that of the first layer that allocates to them.
- **Isolation.** Every name, fraction, percent, kirat and amount text is an object carrying `dir`:
  - names `auto`;
  - fractions, percents and kirat `ltr`;
  - amounts `auto`.
  No Unicode control characters are injected.
- **Numbers.** All are formatted with Babel, using `babel_locale` and passing `numbering_system` from `i18n/locales.json` explicitly.
  - **Fraction:** the reduced `n/d`, each integer ungrouped.
  - **Percent:** the exact share ×100, rounded half-up to 1 decimal in `Decimal` (the formula is `report.percent_of`), then formatted with pattern `#,##0.0%` so Babel never rounds again.
  - **Kirat:** share ×24, half-up to 2 decimals (`report.kirat_of`), pattern `#,##0.00`.
  - **Dates:** `presentation.format_datetime(dt, locale)` uses the pattern `yyyy-MM-dd HH:mm` (the PDF's current stamp).
- **Money.**
  - **Estate.** The estate is `family.estate.amount_minor`. With no estate, there is no amount, rounding or unallocated amount.
  - **Precision.** It is `babel.numbers.get_currency_precision(code)`. A code not in `babel.numbers.list_currencies()` is `PresentationError('invalid_currency')`.
  - **Rounding.** Each row's amount and the unallocated amount are `floor(estate_minor × share + 1/2)`. `rounding` = estate − Σrows − unallocated amount. It is signed, emitted only when non-zero, and never merged into `unallocated`.
  - **Amount text.** `format_currency(Decimal(minor).scaleb(-precision), code, locale=…, numbering_system=…)`.
  - **Minor units.** `presentation.minor_units(text, code) -> int` converts a decimal estate string. It raises `PresentationError('invalid_amount')` for more decimals than the precision, for a non-positive value, or for a value that is not a plain decimal.
- **Currency.**
  - `currency` is `engine.contracts` `Currency{code, explicit}` or None.
  - **Explicit** (`explicit` true): the code is used exactly and never re-defaulted.
  - **Otherwise** (None or `explicit` false): `presentation.default_currency(locale, preset=None)` applies. It returns `preset.default_currency` when a preset is given (the Country extension, not called by `present` in this story), else the Locale's new registry field `default_currency`: ar SAR, en USD, fr EUR (owner decision 2026-11-16).
- **Notices.**
  - `presentation.select_notices(resolved_basis, locale, outcome, enabled=ENABLED_NOTICES) -> tuple[code]` is the one owner.
  - **Codes:** `disclaimer`, `country_notice`, `citation`, `civil_law`, `obligatory_bequest_prompt`, `locale_beta`.
  - **`ENABLED_NOTICES` = `{disclaimer}`.**
  - **Predicates when enabled:**
    - `disclaimer`: always;
    - `country_notice` and `citation`: country Basis;
    - `civil_law`: school Basis;
    - `obligatory_bequest_prompt`: school/compare Basis and a person `died_before_or_with` who has descendants in the Family edges;
    - `locale_beta`: the Locale's registry `review` is `pending`.
  - Only the disclaimer gets text, from the catalog key `notice.disclaimer`.
- **New catalog keys** (ar/en/fr, `review:"pending"`), each byte-for-byte from the current `messages.ts` value of that Locale:
  - `notice.disclaimer` = `footer.note`;
  - `comparison.same_in_all_schools` = the `schoolsAgree` key.
  - The validator's `requiredKeys`, the generated module and the Python key test learn both keys.
- **PresentedResult v2.** The shape is in Design Notes. `contracts/manifest.json` and `CONTRACT_VERSIONS` give `presented_result: 2`. The Python and TS parsers accept only v2. The fixtures are rewritten as v2 and relocked with `scripts/contract_fixtures_lock.py`.

**Never:**
- Switch a consumer: no change to `api/preview.py`, `calc/`, `reports/`, `web/src/interview/*`, the results pages or templates.
- Change engine answers, `engine/` code (other than the contract files), existing fixtures' expected answers, or any existing `messages.ts`/`.po` text.
- Enable or write copy for the Country, citation, civil-law, FR-14 or Beta notices. Publish a preset. Add a Locale.
- Put the scholars' table into PresentedResult. It is deferred to 8.7.
- Use floats anywhere in money or share math. Let Babel round a value.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Compare agreement | wife, mother, 3 daughters; compare; en; estate 100000 minor USD | `answer`, outcome `agreement`, Hanbali rows, `school_line.code` `same_in_all_schools`, `comparison` null | — |
| Compare difference | grandfather + brother; compare | `selection_required`, no rows, `comparison.differing_persons` names the affected persons, four schools each with shares | — |
| Partial refusal | Malikiyya family; compare | `difference`; maliki is refused (`malikiyya_disputed`) and the other three are calculated; `selection_required` | — |
| All refused | impossible family; compare | `refused`; one refusal `invalid_family` with the localized text; no rows, rounding or unallocated | — |
| Ja'fari | school `jafari` | `refused`, `school_not_supported` | — |
| Rounding | estate 100 minor, three equal 1/3 heirs | amounts 33, 33, 33; `rounding.amount_minor` 1 | — |
| Unallocated | spouse alone | `unallocated` has a fraction, text and amount; rounding is separate | — |
| No estate | amount_minor null | every amount null; rounding null; unallocated amount null | — |
| KWD / JPY | precision 3 / 0 | amounts follow precision; `minor_units('1.5','JPY')` | `invalid_amount` |
| Unknown currency | `XYZ` | — | `PresentationError('invalid_currency')` |
| Explicit currency | `{EUR, explicit:true}`, locale ar | EUR is kept | — |
| Defaulted currency | None or `{EUR, false}`, locale ar | SAR | — |
| Unregistered locale | `de` | falls back to `en` via `i18n.resolve_locale`; output `locale:"en"` | — |
| Later deaths | `later_deaths_document` | rows are the recomposed final shares; evidence has one layer per estate with the inherited fraction | — |

</intent-contract>

## Code Map

- `engine/contracts/presented.py`, `engine/contracts/codes.py:3` (`CONTRACT_VERSIONS`), `contracts/manifest.json`, `contracts/codes.json` -- the v1 shape to extend to v2. The helpers are in `engine/contracts/values.py` (`obj` exact keys, `fraction`, `pattern`, `check_version` accepts only the current version).
- `contracts/fixtures/presented_result/*.json` (agreement, difference, partial-refusal, refused, selection-required), `contracts/fixtures/invalid/presented_result.json`, `contracts/fixtures.lock.json`, `scripts/contract_fixtures_lock.py` (refuses changes unless the manifest version is greater). Tests: `engine/tests/test_contracts.py`, `web/src/contracts/contracts.test.ts`. TS mirror: `web/src/contracts/presented.ts`, `codes.ts`.
- `engine/contracts/comparison.py` -- `Comparison`, `SchoolResult`, `Refusal`, consistency rules (`parse_comparison`). Build `compare()` output so it passes them.
- `engine/core.py:28` `Evaluation(result, proof, table)`, `:108` `evaluate`, `:157` `final_shares`, `:172` `calculate`. `engine/rule_set.py:76` `school_rule_set(school)`. `engine/contracts/basis.py:32` `ResolvedBasis`, `:77` `resolve_basis`. `engine/contracts/family.py:56` `Currency{code, explicit}`, `:62` `EstateFacts{amount_minor, currency}`.
- `engine/contracts/result.py` -- `Allocation` (`kind`, `share`, `stage{step,base}`, `rule`, `condition`, `blocked_by`, `school_rule`, `option`, `citations`), `Step{step, params{name: Param{type,value}}}`, `Layer{order, deceased, inherited, allocations, steps, unallocated}`.
- `api/preview.py:227-278` -- the legacy comparison (`_signature`, `compare`, `preview`) that `compare()` must match. `:213` and `calc/models.py:56` hold the legacy 2-decimal half-up amount. Read-only.
- `reports/report.py:20-28` -- `percent_of`/`kirat_of`, the exact half-up formulas to reproduce. `web/src/interview/format.ts`, `preview.ts:108`, `answers.ts:204` -- the legacy client formatting, to compare against for the display-change fixture. All read-only.
- `engine/tests/test_core.py` (`family_document`, `later_deaths_document`, `MALIKIYYA`, known answers) and `engine/tests/test_layered.py:28` -- reusable unittest family builders.
- `calc/test_engine_parity.py:110,273` -- the Django corpus gatherer (ORM known-answer/School/proof families and layered sweeps mapped to engine Families). Reuse its builders; do not edit it.
- `i18n/__init__.py` (`term`, `resolve_locale`, `locale_config`, `catalog`), `i18n/locales.json`, `i18n/terms/{ar,en,fr}.json`, `i18n/tests.py` (the required-key test).
- `web/src/i18n/validate.ts:65` `requiredKeys` and the registry validator (`:105` field list), `web/scripts/i18n.mjs`, the generated `web/src/i18n/catalog.generated.ts`.
- `web/src/i18n/messages.ts` -- `footer.note` (en `:852`; ar and fr equivalents) and `schoolsAgree` (en `:755`): the source text for the new keys. Read-only.
- `engine/tests/test_purity.py` -- scans only `engine/`. It must keep passing; `engine` must not import `presentation`.
- `pyproject.toml`/`uv.lock` -- Babel is absent. Add it.

## Tasks & Acceptance

**Execution:**
- `pyproject.toml`, `uv.lock` -- `uv add "babel==2.17.0"` (or the newest available 2.x that supports `numbering_system=`).
- `i18n/locales.json` -- add `default_currency` (ar SAR, en USD, fr EUR). `web/src/i18n/validate.ts` -- require it on every Locale (`^[A-Z]{3}$`), add `notice.disclaimer` and `comparison.same_in_all_schools` to `requiredKeys`, emit `defaultCurrency` in the generated `localeConfig`, and add validate tests. Rerun `npm run i18n:write`.
- `i18n/terms/{ar,en,fr}.json` -- the two new keys, copied mechanically from `messages.ts` with a scratch script. `i18n/tests.py` -- the required keys plus a `default_currency` check.
- `engine/contracts/presented.py`, `codes.py`, `contracts/manifest.json`, `contracts/codes.json`, `web/src/contracts/presented.ts`, `codes.ts` -- PresentedResult v2 per Design Notes, with strict parse/dump and consistency rules:
  - a refused answer has no rows, comparison or school_line;
  - `selection_required` has no rows and has a comparison whose outcome is `difference`;
  - `answer` has rows;
  - `comparison.schools[].shares` persons are unique.
- `contracts/fixtures/presented_result/*.json` (rewrite as v2; add `later-deaths.json`), `contracts/fixtures/invalid/presented_result.json` (v2 cases, plus `{"version":1}` → `unsupported_version`), then relock.
- `presentation/__init__.py`, `presentation/money.py`, `presentation/formatting.py`, `presentation/compare.py`, `presentation/notices.py`, `presentation/present.py` (new) -- `outcome`, `compare`, `present`, `select_notices`, `ENABLED_NOTICES`, `default_currency`, `minor_units`, `format_datetime`, `PresentationError(code)`. `present` returns a `PresentedResult` that round-trips through `parse_presented_result(dump_presented_result(x))`.
- `presentation/tests/test_present.py` (new, unittest, no Django) -- every I/O matrix row in ar/en/fr:
  - the Babel strings for fraction/percent/kirat/amount, including fr `12,5 %` and ar;
  - a purity check that `presentation` imports no `django`;
  - a test that disabled notices never appear while enabled ones follow their predicates.
- `presentation/tests/test_parity.py` (new, Django `TransactionTestCase`, `@tag('slow')` for sweeps) -- uses the `calc/test_engine_parity.py` corpus builders.
  - For every corpus family under each School, the presented rows' `(person, share, blocked)`, the evidence codes (rule, condition, blocked_by, school_rule, option, verses, stage) and the step codes and params equal the engine evaluation's proof and `final_shares`, and the legacy `Calculation.compute` fractions.
  - For every family under compare, the comparison outcome equals the legacy `api.preview` signature decision applied to the same four answers.
  - The layered sweep is covered too.
- `presentation/tests/fixtures/display-changes.json` + a test -- for representative values in ar/en/fr: the legacy string (preview amount `.2f`, report `percent_of`/`kirat_of`, fraction `n/d`) beside the presented string, each labelled `display_change: true|false`. The test regenerates and compares. Engine answers are never in this file.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- an 8.6 section:
  - the two new catalog keys (pending review);
  - the `default_currency` registry field;
  - the disabled notice slots awaiting copy (Epics 9–12);
  - the scholars' table not yet in PresentedResult (8.7);
  - the display changes (currency symbols, Babel percent spacing).

**Acceptance Criteria:**
- Given the repository after this story, when the contract tests run in Python and TS, then every v2 presented fixture round-trips, a v1 document is `unsupported_version`, and the lock matches.
- Given any corpus family, when it is presented under each School and under compare, then the shares, statuses, stage/proof evidence and School choice equal the legacy path. Any formatting difference appears only in `display-changes.json`.
- Given `present` output in ar/en/fr, when it is inspected, then no float appears, every number string came from Babel with the registry `numbering_system`, and the disclaimer notice is always present.
- Given the repository after this story, when `git diff b7fc102 --stat` is inspected, then no file under `api/`, `calc/`, `reports/` or `web/src/interview` has changed, and `makemigrations --check --dry-run` reports no changes.

## Spec Change Log

## Review Triage Log

### 2026-11-17 — Review pass
- verdicts: 48 findings — high 0, medium 2, low 38, false 8, maybe-false 0
- note: the first launch of all four layers on codex failed on its usage limit, and the Claude relaunch paused on a rate limit and resumed after the reset. The reports below are from the completed runs.
- findings:
  - **Blind hunter**
    - `[low]` `[reject]` (blind) `present()` ignores `family.estate.currency`, so a non-explicit currency follows the viewer's Locale. — This is the spec's reading of AD-19: the default comes from the Locale while `explicit` is false. It is unreachable today: phase-1 estates convert to SAR with `explicit: true`, and no writer emits a non-explicit currency until the currency-picker epic. ar, en and fr defaults (SAR/USD/EUR) all have precision 2. Noted as a residual risk for that epic.
    - `[false]` `[reject]` (blind) Half-up rows can sum above the estate and leave a negative rounding line. — This is intended. AD-19 and FR-13 call for per-allocation half-up and a *signed* rounding line that makes the total equal the estate. The spec's matrix includes a negative rounding test.
    - `[low]` `[reject]` (blind) On agreement, the Hanbali evidence appears under "same in all schools". — This is the legacy behaviour: `api.preview.preview` returns the Hanbali body, proof included, with `agreement: "all"`. Changing what evidence an agreement shows is a product decision outside this parity story.
    - `[low]` `[patch]` (blind) `compare()` matches persons by list position. — Every calculated School allocates to the same heirs, so this is not reachable today, but the fix is a direct correction. Patched: signatures are keyed by person id, and differing persons are taken over the union in Family order.
    - `[medium]` `[patch]` (blind) A person blocked at the first estate who inherits later is shown `blocked: true` with a positive share. — Confirmed: `answers()` used the root kind, and the parity test asserted only one direction. Patched: blocked means a final share of 0, matching the legacy `_signature`/`compute_manasikhat`. The contract rule in Python and TS is now `blocked == (share == 0)`, and the parity assertion is two-way.
    - `[low]` `[reject]` (blind) A Country basis does not name its preset in `school_line`. — Country bases are not resolvable in production (no published preset), and Country presentation copy belongs to the later Country epics.
    - `[low]` `[reject]` (blind) `present()` does not check that the outcome matches the basis. — Only developer misuse could trigger this; `outcome()` is the one builder. A guard adds a branch for no reachable case.
    - `[low]` `[patch]` (blind) Refusal attribution drops the School. — Patched for the School/Country basis refusal, which now carries its School code. Rejected for the deduplicated difference/all-refused entries: the per-School refusals are kept in `comparison.schools`, and the contract keeps one entry per reason.
    - `[low]` `[reject]` (blind) The contract validators miss cross-field rules (row↔evidence persons, differing ⊆ shares, disclaimer required, empty name). — `present()` is the only producer and never emits these shapes. Each rule adds validator complexity in two languages.
    - `[low]` `[reject]` (blind) The invalid-fixture corpus does not cover most v2 rules. — The rules are exercised through the Python round-trip of every `present()` output. Python/TS parity of the extra negative cases matters once the web parses live PresentedResults (8.7).
    - `[low]` `[patch]` (blind) The registry `default_currency` is only shape-checked. — Patched: an i18n test asserts that every default is in `babel.numbers.list_currencies()`.
    - `[low]` `[reject]` (blind) `format_datetime` has no timezone and does not apply `numbering_system`. — No caller yet, and every registered Locale is `latn`. The PDF stamp switch happens in 8.7.
    - `[low]` `[reject]` (blind) `PresentedResult` holds mutable dicts, and the contract imports the private `_param`. — Cosmetic design. No consumer mutates or hashes it.
    - `[low]` `[reject]` (blind) `present()` does not validate its own output. — Every test path round-trips the output through `parse_presented_result`. A runtime self-check is extra cost for a producer whose shape the tests pin.
    - `[low]` `[patch]` (blind) A stale `PresentationError` docstring, dead `expected` entries in `test_babel_strings`, an unused `run(enabled)` parameter, and a substring purity test. — Patched the docstring and the dead entries. The other two are cosmetic.
    - `[false]` `[reject]` (blind) The spec is not in the diff. — It was deliberately excluded. The spec is the claims file given to the edge-case layer.
    - `[low]` `[reject]` (blind) The `_bequest_prompt` predicate is too broad (a predeceased uncle with children). — The notice is disabled with no copy. The FR-14 epic owns the exact predicate.
  - **Edge-case hunter**
    - `[low]` `[patch]` (edge) `compare()` by position can raise `IndexError`. — Grouped with the blind position row and patched there.
    - `[false]` `[reject]` (edge) Unallocated differs while no person differs. — Unallocated is 1 − Σ final shares, so identical per-person shares imply an identical unallocated fraction.
    - `[low]` `[reject]` (edge) Agreement shows Hanbali-only kinds and evidence. — Grouped with the blind Hanbali row: legacy parity.
    - `[low]` `[reject]` (edge) Non-explicit `family.estate.currency` is read at the wrong precision. — Grouped with the blind currency row; unreachable today.
    - `[low]` `[reject]` (edge) An estate amount with no currency is reinterpreted by Locale. — Grouped with the blind currency row.
    - `[low]` `[reject]` (edge) An Outcome built for a different basis is presented. — Grouped with the blind outcome/basis row.
    - `[low]` `[patch]` (edge) A School basis refusal shows school null. — Grouped with the blind refusal row; patched.
    - `[false]` `[reject]` (edge) A negative unallocated share hides over-allocation. — The engine never over-allocates (awl scales the base), and `present` emits unallocated only when it is > 0.
    - `[low]` `[reject]` (edge) The contract does not range-check `unallocated.fraction`. — The only producer emits 0 < u < 1. A validator-only gap.
    - `[low]` `[reject]` (edge) The contract allows mixed currencies or partial amounts. — The only producer uses one currency and all-or-none amounts. A validator-only gap.
    - `[low]` `[reject]` (edge) The contract allows malformed evidence order/deceased pairs. — Same reason: a validator-only gap the producer never hits.
    - `[low]` `[reject]` (edge) `differing_persons` is not checked to be a subset of the shares. — Same reason.
    - `[low]` `[reject]` (edge) Date digits ignore `numbering_system`. — Grouped with the blind datetime row.
    - `[medium]` `[patch]` (edge) The parity blocked check is one-way. — Grouped with the blind layered-blocked row; patched.
    - `[low]` `[patch]` (edge) Parity does not catch legacy persons missing from rows. — Patched: the parity test asserts that the row persons equal the legacy persons.
  - **Verification-gap reviewer**
    - `[low]` `[patch]` (verification-gap) The top-level `refusals` of a partial refusal are never asserted. — Pre-verified. Patched: `test_partial_refusal_is_a_difference` asserts the Maliki refusal entry.
    - `[low]` `[patch]` (verification-gap) The comparison shares' `blocked` flag is never asserted. — Pre-verified. Patched: the Hanafi brother is asserted blocked.
    - `[low]` `[patch]` (verification-gap) The first-relationship row label for a person in two estates is untested. — Pre-verified. Patched: a later-deaths test with an heir in both estates asserts the estate-1 label.
    - `[low]` `[reject]` (verification-gap) TS never parses real `present()` output. — The v2 fixtures were generated from `present()`. Keeping them in sync belongs with the first TS consumer in 8.7, where renderers move to PresentedResult (the layer filed it as defer).
    - `[low]` `[patch]` (verification-gap, other) Dead `expected` entries in `test_babel_strings`. — Grouped with the blind small-issues row; patched.
    - `[low]` `[reject]` (verification-gap, other) The ar Babel expectations are circular. — The exact ar strings are pinned by `display-changes.json` (`test_the_table_is_current`).
  - **Intent-alignment auditor**
    - `[false]` `[reject]` (intent) No renderer surface is exercised. — By design under the 8.6/8.7 split: 8.7 switches consumers, and 8.6's last AC is about the "candidate presentation".
    - `[low]` `[reject]` (intent) The scholars' table is not in PresentedResult. — The 8.6 ACs ask for proof and stage evidence, which v2 carries and parity checks. The table is 8.7's "scholars tables remain available" and is recorded in deferred-work.
    - `[false]` `[reject]` (intent) Engine evaluation sits in `outcome()` rather than `present()`. — `present` still owns the comparison decision and all presented meaning. The split keeps `present` free of engine calls, with no observable difference.
    - `[false]` `[reject]` (intent) The agreement rule adds an unallocated check beyond the AC. — The unallocated share is determined by the per-person shares, so the check cannot change an outcome. It mirrors the legacy `_signature`.
    - `[low]` `[reject]` (intent) `present` does not validate `amount_minor` against the precision, and ignores the family currency. — `amount_minor` is an integer by contract, so precision only applies when converting decimal input (`minor_units`). The currency part is grouped with the blind currency row.
    - `[low]` `[reject]` (intent) A new `no_heirs` typed error. — The legacy preview is `not_ready` for this case, and the contract forbids an answer without rows. Recorded as a display change.
    - `[low]` `[reject]` (intent) The Maliki-basis refusal is covered only in the corpus sweeps. — The Django sweeps run in CI (no tag exclusion). A School-basis refusal unit test is now also added (Jafari, plus the patched school attribution).
    - `[low]` `[reject]` (intent) Date numbering. — Grouped with the blind datetime row.
    - `[false]` `[reject]` (intent) The Beta path is tested only through the override. — Intended: the notice is represented but not enabled.
    - `[low]` `[reject]` (intent) The display baseline uses copied legacy formulas. — They are byte-for-byte copies of the read-only `report.percent_of`/`kirat_of` and the preview `.2f`. Importing `reports` would tie a pure test to Django.

## Design Notes

**PresentedResult v2** (the changes from v1 are new keys; strict, exact keys):
```text
{version:2, locale, direction, basis, state, comparison_outcome|null,
 school_line:{code:"same_in_all_schools"|"school", text}|null,
 rows:[{person, name:{text, dir:"auto"}|null, relationship:{translated, original}, kind, blocked:bool,
        share:{fraction, text, dir:"ltr"}, percent:{text, dir:"ltr"}, kirat:{text, dir:"ltr"},
        amount:{amount_minor, currency, text, dir:"auto"}|null}],
 rounding:{amount_minor(signed), currency, text, dir}|null,
 unallocated:{fraction, text, dir:"ltr", amount:Money|null}|null,
 comparison:{schools:[{school, label, status:"calculated"|"refused", refusal|null,
             shares:[{person, blocked, share:{fraction,text,dir}}]}], differing_persons:[id]}|null,
 evidence:[{order, deceased:id|null, inherited:{fraction,text,dir}|null,
            heirs:[{person, stage:{step,base}|null, rule:{code,text}, condition, blocked_by, school_rule,
                    option:{code,text}|null, verses:[{code,text}]}],
            school_rules:[{code,text}], steps:[{step, text, params:{name:{type,value}}}],
            unallocated:{fraction,text,dir}|null}],
 refusals:[{school|null, reason, text}], notices:[{code, text}]}
```
- Evidence comes from the Result's allocations/steps/layers, labelled with `i18n.term('proof.<kind>.<code>')` (verse `4:11` → `proof.verse.quran_4_11`). It is empty when refused or in selection_required.
- Why v2 rather than extending a consumer: the AC requires proof and stage parity and a comparison that names the affected people. v1 cannot carry either, and AD-25 demands a version bump for a meaning change. No v1 consumer exists, so nothing breaks.
- The `display-changes.json` fixture is the "presentation fixtures separately identify AD-19 display/rounding changes" requirement. Engine-answer parity lives in `test_parity.py`.

## Verification

**Commands:**
- `uv run python -m unittest engine.tests.test_contracts engine.tests.test_purity presentation.tests.test_present` -- expected: OK.
- `uv run python manage.py test presentation.tests.test_parity i18n --noinput` -- expected: OK.
- `cd web && npm run i18n && npm test && npm run lint && npm run typecheck` -- expected: pass; `npm run i18n:write` leaves `git status` clean.
- `uv run python scripts/contract_fixtures_lock.py --check` (or the test equivalent) -- expected: lock current.
- `uv run python manage.py makemigrations --check --dry-run` -- expected: No changes detected.

## Auto Run Result

Status: done

**Summary:** `presentation.present(outcome, basis, locale, currency)` is now the only producer of a versioned **PresentedResult v2** (AD-19). It is a Django-free `presentation/` package that owns:
- **Comparison.** The four Sunni Schools; agreement means identical per-person final share and blocked status; it names the differing persons and makes partial refusals explicit.
- **Labels.** Catalog terms, each with an Arabic-original segment and direction metadata.
- **Notices.** One owner; only the disclaimer is enabled.
- **Money.** Integer minor units, half-up rows, and a signed rounding line kept separate from the unallocated share. Precision and currency validation come from Babel.
- **Formatting.** Babel formats every number with the registry `numbering_system`.

No consumer is switched; that is 8.7. Engine answers, proof codes, stage evidence and School choices match the legacy path across the full corpus. Display-only changes are catalogued in `presentation/tests/fixtures/display-changes.json`.

**Files:**
- `presentation/{__init__,compare,money,formatting,notices,present}.py`: `outcome`, `compare`, `present`, `select_notices`, `default_currency`, `minor_units`, `format_datetime`, `PresentationError`.
- `presentation/tests/test_present.py`: Django-free tests covering every matrix row in ar/en/fr, purity and notices.
- `presentation/tests/test_parity.py`: Django corpus parity (School sweeps, compare, layered).
- `presentation/tests/test_display_changes.py` + `fixtures/display-changes.json`: legacy vs presented strings.
- `engine/contracts/presented.py`, `codes.py`, `contracts/manifest.json`, `web/src/contracts/{presented,codes}.ts`: the PresentedResult v2 contract in Python and TS (v1 is now `unsupported_version`).
- `contracts/fixtures/presented_result/*` (v2, plus `school-answer` and `later-deaths`), `contracts/fixtures/invalid/presented_result.json`, `contracts/fixtures.lock.json`: rewritten and relocked.
- `i18n/locales.json`: the `default_currency` field (ar SAR, en USD, fr EUR).
- `i18n/terms/{ar,en,fr}.json`: `notice.disclaimer` and `comparison.same_in_all_schools`, byte-for-byte from `messages.ts`, `pending`.
- `i18n/tests.py`: the new keys, plus a test that each default currency is known to Babel.
- `web/src/i18n/validate.ts`, `validate.test.ts`, `catalog.generated.ts`: the validator requires `default_currency` and the new keys.
- `pyproject.toml`, `uv.lock`: `babel==2.17.0`.
- `deferred-work.md`: the 8.6 section.

**Review:** 48 findings (high 0, medium 2, low 38, false 8).
- **Patched:**
  - medium (one grouped entry): the later-death blocked flag now means a zero final share in the code and both contracts, and the parity check is two-way.
  - low:
    - `compare()` is keyed by person id;
    - a School-basis refusal names its School;
    - parity asserts that row persons equal legacy persons;
    - tests cover partial-refusal `refusals`, comparison `blocked`, the first-relationship label across two estates, and Babel-known default currencies;
    - the `PresentationError` docstring is fixed and the dead test entries are removed.
- **Deferred:** none.
- **Rejected:** 8 false and the remaining low findings, each with its reason in the triage log. The main groups are:
  - the viewer-Locale currency default is unreachable until the currency-picker epic;
  - Hanbali evidence on agreement is legacy parity;
  - validator-only cross-field gaps;
  - dates are `latn`-only today;
  - Country presentation and the scholars' table are left to later stories.
- **Review layers:** the first codex launch hit its usage limit. The layers were relaunched on Claude and resumed after a rate-limit pause.

**Follow-up review recommended: false.** This first pass patched 1 medium and 0 high entries (patched counts: high 0, medium 1, low 6), below the threshold.

**Verification (after patches):**
- `python -m unittest engine.tests.test_contracts engine.tests.test_purity presentation.tests.test_present presentation.tests.test_display_changes`: 56 OK.
- `manage.py test presentation.tests.test_parity i18n`: 16 OK, including the slow sweeps (about 4.5 min).
- `npm run i18n`: OK with no drift. `npm test`: 500 pass. Lint: 0 errors (10 warnings, the same as before). Typecheck: clean.
- `contract_fixtures_lock.py`: current. `makemigrations --check`: no changes.
- `git diff b7fc102 -- api calc reports web/src/interview`: empty.

**Residual risks:**
- A non-explicit currency follows the viewer's Locale at presentation time. Revisit this when the currency picker writes non-explicit currencies.
- The scholars' table must join PresentedResult in 8.7, which needs another contract version.
- Arabic amount strings carry Babel's own U+200F marks.
- `contracts/fixtures/presented_result/refused.json` still shows `school: null` for a Ja'fari refusal, while the producer now emits `jafari`. Both are valid.
- The new catalog text and the `default_currency` choices are pending native/owner review.
