---
title: 'Story 8.7: Switch existing calculation consumers only after full parity'
type: 'feature'
created: '2026-11-17'
status: 'done'
baseline_revision: 'f397f75b44a7db26a34c472dcff14fb21070a175'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-8-6-produce-one-presented-answer-for-every-renderer.md'
warnings: [multiple-goals, oversized]
deferred:
  - summary: >-
      The legacy results pages' new presented template has only loose test assertions (a share, SAR, per-heir amounts); the scholars' table, unallocated row, blocked cell and rowspans are unasserted.
    evidence: |-
      calc/tests.py results-page tests assert '1/8'/'SAR' and amounts only; no ar/fr, blocked, unallocated or table-header assertions. Pages await Epic 12's retirement decision.
    location: >-
      calc/templates/calc/_presented_result.html
    severity: low
---

<intent-contract>

## Intent

**Problem:** The parity-proven core (`engine/`) and presenter (`presentation/`) are not used in production yet.
- `api/preview.py` still builds `Calculation`/`Deceased`/`Heir` rows and rolls them back. This advances PostgreSQL sequences and takes row locks.
- `Calculation.compute` still runs the ORM fiqh. On GET it persists derived columns under a `select_for_update()` that has no time limit (deferred-work.md:124, :137–142).
- The PDF (`reports/report.py` `percent_of`/`kirat_of`), the browser (`format.ts`, `preview.ts` `percentOf`/`kiratOf`) and the legacy `calc/results.html`/`new_results.html` templates each do their own arithmetic and formatting.

**Approach:**
1. Add Django adapters that map a session case or ORM rows to an `engine.contracts` Family.
2. Gate the switch on adapter parity across the existing corpus.
3. Switch the consumers:
   - Preview becomes an in-memory core plus presenter path.
   - `Calculation.compute` becomes a thin, non-persisting, lock-free adapter.
   - The PDF, web and legacy templates render **PresentedResult v3**, which is v2 plus a formatted scholars' table.

## Boundaries & Constraints

**Always:**
- **Switch gate first (AD-15).**
  - The adapter parity tests (Tasks 2–3) run before any consumer change.
  - Every family in the known-answer, School, proof, refusal and later-death corpus passes on core, adapters and presentation.
  - If any family differs, stop. Do not switch consumers. HALT `blocked` with the differing families.
  - Never edit an expected answer in an existing fixture or test to make it pass.
- **Legacy reference.**
  - Rename today's ORM fiqh entry point to `Calculation.legacy_compute` (body unchanged). `calc/manasikhat.py` `compute_manasikhat` keeps calling it.
  - Both remain only as the parity reference until Epic 12. No production code path calls either.
- **Adapters** (new `calc/adapters.py`):
  - `family_from_session(case) -> (Family, Currency|None)`. It handles later deaths and `same_as`. The session `estate` decimal becomes `presentation.minor_units(estate, 'SAR')` with `Currency('SAR', explicit=True)` (owner decision for phase-1 bare decimals).
  - `family_from_calculation(calc) -> (Family, ids)`. It maps ORM rows, including parent/child layered calculations, to a Family with stable person ids. `ids` maps engine person id ↔ Heir pk explicitly.
  - Relationship codes equal the session ids, so reuse the `api/preview.py` `HEIR_CLASSES` inverse.
  - The Basis comes from `madhab`: a school → `{kind:"school", school}`; null → `{kind:"compare"}`. It goes through `engine.contracts.basis.resolve_basis`.
- **Preview (`api/preview.py`).**
  - `preview(case)` is computed by `presentation.outcome` + `present`. It creates, updates and locks no rows and calls no sequence.
  - The response keeps every existing legacy field and value (`status`, `madhab`, `agreement`, `basis`, `shares` with `amount`, `unallocated`, `proof`, `table`, `schools`, `rules`, `reason`). They are now derived from the `engine.Evaluation` with today's labelling (`_labelled`, `_table`), so cached bundles keep working for one release.
  - It adds `presented`: a PresentedResult v3 dict, in the active locale, for `available`, `unavailable` and `choose_school`. `not_ready` stays `{"status":"not_ready"}` with no `presented`.
  - The legacy `amount` equals the presented `amount_minor` scaled to 2 decimals. It is identical to today's `money()` for SAR.
  - Unexpected failures still raise to `PreviewView`, which returns 503.
- **`Calculation.compute(madhab=None)`.**
  - It builds the Family through `family_from_calculation`, evaluates the core (successive deaths use core composition), and sets the transient `madhab`, `proof` and `table` with Heir pks.
  - It returns `{heir_pk: Fraction}` with the same keys and values as `legacy_compute`. Blocked status is read from `presented` rows, not from the Heir columns.
  - It raises `schools.UnsupportedCase(reason)` on refusal, as today.
  - It performs **no** writes, `select_for_update` or savepoints. Derived columns stay as they are on disk.
- **PresentedResult v3** = v2 plus a `table` key: the engine's scholars' table (single or layered) with:
  - heir ids as person ids;
  - every numeric leaf (an integer, or a `{numerator, denominator}`) replaced by `{value, text, dir:"ltr"}`, where `value` is unchanged and `text` is formatted by Babel with the registry `numbering_system`;
  - each column carrying a catalog `label`.
  It is `null` when refused or `selection_required`. Bump `presented_result` to 3 in Python, TS and the manifest, regenerate the fixtures from `present()` and relock. v2 becomes `unsupported_version`.
- **New catalog keys** `table.column.{base,awl,radd,remainder,radd_calc,radd_union,correction}` (ar/en/fr, `review:"pending"`). Copy each byte-for-byte from the existing `.po` msgstr of the `_column_labels()` caption (`Shares`, `Excess`, `Shortage`, `Remainder`, `Shortage calc`, `Calc Union`, `Correction`) with a scratch script. The validator `requiredKeys`, the generated module and the Python key test learn them.
- **Renderers draw only presented strings for numbers, comparison, the School line and evidence:**
  - **PDF** (`reports/report.py`, `draft.html`): rows, unallocated, rounding, the School line, evidence and table come from `presented`. `generated` uses `presentation.format_datetime`. `percent_of`/`kirat_of` are removed.
  - **Web**: preview/results/shared/received rows, the agreement/School line, the school-choice comparison, the unallocated share, the scholars' table and the proof panels read `presented`. Remove `percentOf`, `kiratOf`, `localPercent`, `localKirat`, `localFraction` and any `Intl` number formatting of results.
  - **Legacy Django pages** (`ResultsView`, `NewResultsView`): `compute()` plus `present(...)` under a school Basis (`madhab` or Hanbali, as today), the active language and SAR explicit. The templates render presented rows, amounts and the scholars' table instead of the ORM derived columns.
  - The RTL isolation (`dir` on every name, number and amount) and the Arabic-original relationship segments are rendered.
- **Writes and locks.**
  - Results GETs perform no writes and take no row lock.
  - `calc/views.py` `lock_calculation` and any other remaining explicit legacy write lock run `SET LOCAL lock_timeout = '500ms'` (a new constant `LOCK_WAIT_MS = 500`, inside the AD-27 1 s budget). On timeout they return a retryable 503 and leave the inputs unchanged.
- **States.**
  - Not-ready, refused and error keep their existing HTTP and JSON semantics.
  - The web never shows a previous answer's numbers on a not-ready, refused, error or stale response.
  - PDFs stay regenerated, non-canonical drafts.

**Never:**
- Change engine answers, `engine/` fiqh code, an existing expected value, a School/compare decision, or any existing `messages.ts`/`.po` text.
- Persist results, add a migration, or drop the ORM derived columns. Column removal and legacy page retirement belong to Epic 12.
- Touch `SavedCase` snapshot reading or writing, revisions or the command service (8.8–8.10).
- Enable new notices, Country bases, presets or Locales.
- Remove the legacy preview fields in this story. That contraction happens after one release.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Preview, a school | session wife, mother, 3 daughters; hanbali; estate "1000.50" | legacy fields as today; `presented.state` `answer`; amounts carry SAR | — |
| Preview, compare agreement | madhab null; schools agree | `agreement:"all"`; `presented.school_line.code` `same_in_all_schools` | — |
| Preview, compare difference | grandfather + brother | `choose_school` + `presented.state` `selection_required` with the comparison | — |
| Preview, refused | Ja'fari, or an impossible family | `unavailable` + reason; `presented.state` `refused`; no shares | — |
| Preview, later deaths | session with `deaths` and `same_as` | same shares/proof/table as before; recomposed presented rows | — |
| Preview, no rows | any preview | Calculation/Deceased/Heir counts and their sequences' `last_value` are unchanged | — |
| Not ready | no heirs | `{"status":"not_ready"}`; web shows no stale numbers | — |
| Unexpected failure | the core raises | 503 as today; inputs are kept; retry works | — |
| Legacy results GET | owned calc; GET twice concurrently | 200; no UPDATE and no FOR UPDATE in the captured queries | refusal → `calc/error.html` as today |
| Legacy write lock | a row lock held by another transaction | a 503 retryable response after ~500 ms; no change | — |
| PDF | an available preview | the PDF strings equal the `presented` texts; the stamp comes from `format_datetime` | not ready/refused → 409; error → 503 |

</intent-contract>

## Code Map

- `api/preview.py:122-260` -- `_compute`/`_compute_layered` (ORM rows + rollback, to replace), `_labelled`, `_column_labels`, `_table`, `_single`, `_signature`, `compare`, `_differences`, `preview`. `HEIR_CLASSES` :26 maps relationship → ORM class. `basis` :62 is a staleness fingerprint, not the contract Basis.
- `api/views.py:192` `PreviewView` (400/404/409/503); `:356` shared and `:457` received views call `anonymous_case.read_snapshot` then `preview`. `reports/views.py:52` `draft_pdf_response` (409 for non-available, 503 on error).
- `api/anonymous_case.py:248` `read_snapshot` (the case shape: `madhab|null`, `deceased{gender,estate:str|null}`, `heirs[{id,relationship,gender,name}]`, `deaths[{heir_id,order,gender,heirs[{...,same_as?}]}]`), `:351` `_layers`, `_rows`, `_person`.
- `engine/contracts/family.py:68` Family/Person/Edge/Estate/EstateFacts/Currency, `parse_family:106` (the root is not a person; a later deceased has `status:"died_later"`, a `death_order` and their own estate). The example builders are `engine/tests/test_core.py:24` `family_document` and `:38` `later_deaths_document`. `engine/core.py:29` `Evaluation(result, proof, table)`, `:157` `final_shares` (keyed by person id). `engine/proof.py:84` `build_table`, `:144` `build_layered_table`.
- `engine/contracts/basis.py:32` `ResolvedBasis`, `:77` `resolve_basis(data, presets)` (pass `{}`).
- `presentation/compare.py:21` `outcome`; `presentation/present.py:138` `present` (needs a ResolvedBasis and a `Currency`); `presentation/money.py` `minor_units`; `formatting.py` `format_datetime`. `engine/contracts/presented.py` (row keys :166), `codes.py` `CONTRACT_VERSIONS`, `contracts/manifest.json`, `contracts/fixtures/presented_result/*`, `contracts/fixtures/invalid/presented_result.json`, `scripts/contract_fixtures_lock.py`; TS `web/src/contracts/presented.ts`, `codes.ts`, `contracts.test.ts`.
- `calc/models.py:924` `compute` (lock :948; "no time limit" doc :935), `:906` `clear`, `:580` `distribute`, `:56` `money`. `calc/manasikhat.py:10,101` `compute_manasikhat`. Production callers: `api/preview.py:130,156` and `calc/views.py:781,821`.
- `calc/views.py:25` `lock_calculation` (an unbounded `select_for_update`), `:748` `NewResultsView`, `:789` `ResultsView` (context keys: `object`, `calculation`, the relationship-group querysets, `asaba`, `Spouse`, `No_Spouse`). Templates: `calc/templates/calc/results.html`, `new_results.html` (ORM columns; the JS cell merge is at :212–219).
- `calc/test_engine_parity.py:37` `relationship`, `:41` `build_family`, `:57` `map_ids`, `:125/157` `ParityMixin.check` (it compares fractions, proof, table and blocked flags), `:273` `LayeredParityTests`. `presentation/tests/test_parity.py:61,155,212`. Repoint their ORM side to `legacy_compute`.
- `calc/tests.py` -- about 100 `compute()` call sites assert the legacy derived columns or legacy transactions. The classes are `CalculationGetSharesTestCase`, `CalculationGetShareTestCase`, the correction/excess/shortage/asaba/son-of-uncle classes (from :676), `DistributionFixtureTests`, `DistributionInvariantTests`, `DistributionEntryOrderTests`, `MuaddaTests`, `SchoolFixtureTests`, `SchoolInvariantTests`, `SchoolAgreementTests`, `SchoolEntryOrderTests`, `ProofMatrixTests`, `ProofInvariantTests`, `ScholarsTableTests:2748`, `ComputeTransactionTests:2898`, `ComputeConcurrencyTests:2941` and `ManasikhatTests:3273`. `CalculationWriteViewTests:3157`, `LayeredResultsViewTests:3215` and `TemplateTagTests:1350` test views.
- `reports/report.py:20-34` `percent_of`, `kirat_of`, `build_context`; `reports/templates/reports/draft.html:19,28-44`. Tests: `reports/tests.py:69,258`.
- Web: `web/src/api/case.ts:735` (preview types), `:1217` `parsePreview` (it drops unknown keys on ordinary bodies), `:1308` `fetchPreview`; `web/src/interview/{format,preview,results,table,answers}.ts`; `web/src/app/[locale]/interview/{share-preview,school-choice}.tsx`, `results/{results-view,inheritance-table}.tsx`, `shared/shared-view.tsx:103`, `received/received-view.tsx:84`. `answers.ts:208` `formatEstate` formats the *input* estate, so leave it.
- `i18n/terms/{ar,en,fr}.json`, `i18n/tests.py`, `web/src/i18n/validate.ts` `requiredKeys`, `web/scripts/i18n.mjs`; `locale/*/LC_MESSAGES/django.po` holds the column-caption msgstrs.

## Tasks & Acceptance

**Execution (in order):**
1. `calc/models.py`, `calc/manasikhat.py`, `calc/tests.py`, `calc/test_engine_parity.py`, `presentation/tests/test_parity.py`, `api/tests.py`, `api/test_legacy_cases.py` -- rename the ORM entry point to `legacy_compute`. Point every test that asserts legacy derived columns, legacy transactions or legacy concurrency at it. This is a call-site rename only; the expected values do not change.
2. `calc/adapters.py` (new) -- `family_from_session`, `family_from_calculation`, `basis_from_madhab`.
3. `calc/test_switch_gate.py` (new; the corpus sweeps are `@tag('slow')`, and CI runs them) -- reuse the `calc/test_engine_parity.py` corpus builders.
   - For every single-estate family under each School and under compare, and every layered sweep family:
     - (a) `family_from_calculation` + the core gives the `legacy_compute`/`compute_manasikhat` fractions, blocked flags, proof and table (after `map_ids`);
     - (b) the session form of the same family through the new `preview` gives the same `shares`/`unallocated`/`proof`/`table`/`schools`/`rules`/`reason` as the ORM path labelled by `_labelled`/`_table`;
     - (c) `presented` rows equal those fractions.
   - The gate passes before step 4. Otherwise HALT.
4. `api/preview.py` -- the in-memory core path plus `presented` (v3), per the constraints. Delete `_compute`/`_compute_layered`.
5. `engine/contracts/presented.py`, `codes.py`, `contracts/manifest.json`, `web/src/contracts/{presented,codes}.ts`, fixtures + lock, `presentation/present.py` -- the v3 `table`. `i18n/terms/*.json`, `i18n/tests.py`, `web/src/i18n/validate.ts` (+test) and the regenerated catalog -- the column keys.
6. `calc/models.py` `compute` -- the thin adapter. `calc/views.py` -- results views render presented; `lock_calculation` gets the bounded wait and the retryable 503. `calc/templates/calc/{results,new_results}.html` -- render presented rows, amounts and the table.
7. `reports/report.py`, `reports/templates/reports/draft.html` -- render `presented`; drop `percent_of`/`kirat_of`.
8. Web -- parse `presented` with the contract parser in `parsePreview`, and switch the renderers listed above. Delete the local arithmetic and `Intl` formatting. Update the web tests to presented fixtures.
9. Tests:
   - `api/tests.py`: no-rows/sequence, `presented` states, 503.
   - `calc/tests.py`: compute issues no writes or locks (`CaptureQueriesContext`); results views; lock timeout → 503.
   - `reports/tests.py`: PDF strings equal the presented texts.
   - Web: no stale numbers on not-ready/error/stale; rows render presented text.
10. `_bmad-output/implementation-artifacts/deferred-work.md` -- an 8.7 section:
    - the new pending column keys;
    - the legacy page look now from PresentedResult;
    - `legacy_compute`, the derived columns and the legacy preview fields awaiting removal (Epic 12 / next release);
    - SAR currency symbols in amounts;
    - `formatEstate` input formatting left on `Intl`.

**Acceptance Criteria:**
- Given the corpus, when the switch-gate tests run, then core, adapters and presentation match the legacy reference for every family, and no existing expected value has been edited (`git diff f397f75 -- '*fixtures*' calc/tests.py api/tests.py` shows no changed expected answers).
- Given any preview, results GET, shared/received view or PDF request, when it computes, then no INSERT/UPDATE/DELETE or `FOR UPDATE` touches the calc tables, and no sequence advances.
- Given preview, Full results, shared/received views, PDF and the legacy pages, when they render a calculation, then every fraction, percent, kirat, amount, School/agreement line and table number is a `presented` string. `grep` finds no `percentOf|kiratOf|percent_of|kirat_of|Intl.NumberFormat` in result renderers.
- Given the legacy write views, when a lock is held elsewhere, then the wait is bounded (~500 ms) and the response is a retryable 503.

## Spec Change Log

## Review Triage Log

### 2026-11-17 — Review pass
- verdicts: 53 findings — high 1, medium 5, low 37, false 10, maybe-false 0
- note: codex hit its usage limit during implementation and the Sonnet implementer hit its own limit before re-engagement. The review layers ran on Claude, and the patches were applied in the main session. The blind hunter listed 19 findings (it said 17); every one is logged.
- findings:
  - **Blind hunter**
    - `[medium]` `[patch]` (blind) `SET LOCAL lock_timeout` stays on for the whole write transaction, so a later lock wait raises a raw `OperationalError` (500), not the retryable 503. — Patched: `lock_calculation` now runs `SET LOCAL lock_timeout TO DEFAULT` once the case lock is held. Only the case lock is bounded; the rest of the write waits as before.
    - `[low]` `[reject]` (blind) The results pages evaluate the calculation three times. `compute()` is mostly wasted. — The legacy pages are a waffle-flagged, owner-only path whose retirement Epic 12 decides. `compute()` keeps the refusal and school checks in one place, and restructuring the GET is more than a direct correction.
    - `[low]` `[reject]` (blind) The derived columns are no longer written, and no gate shows that nothing reads them. — By design (AD-18): no template, view, report or API reads them any more (the reviewer's grep found readers only in the replaced templates). Admin shows them raw, and deferred-work lists their removal.
    - `[low]` `[reject]` (blind) `compute(madhab=None)` now means Hanbali instead of raising. — The spec defines this. No caller passes junk, and unknown codes still raise through `schools.check_school`.
    - `[low]` `[reject]` (blind) Unguarded `KeyError`/`ValueError` paths in the adapters and `minor_units`. — Every Heir subclass is in `HEIR_CLASSES`. Session estates come through `clean_estate` (2 decimals). The very large estate case is grouped with the edge row below.
    - `[medium]` `[patch]` (blind) The legacy pages lost the per-heir `quote_reason` explanation. — Patched: each row's `title` tooltip is now the presented evidence's rule text. The other layout differences (no asaba caption, no proof panel) are the product/visual review already filed in deferred-work for Epic 12.
    - `[low]` `[patch]` (blind) The legacy relationship cell prints the Arabic original even when it equals the translation ("الأب (الأب)"). — Patched: the original is shown only when its text differs, matching `relationship-text.tsx`.
    - `[low]` `[defer]` (blind) The legacy-page and report tests are thin on locale and shape. — Grouped with the verification-gap legacy-template row (deferred).
    - `[false]` `[reject]` (blind) The report fails on non-answer states (`school_line` None). — `draft_pdf_response` renders only `status == 'available'`. Its `presented.state` is always `answer`, which always has a `school_line` (school or same_in_all_schools); other states return 409 before `build_context`.
    - `[low]` `[reject]` (blind) The report mixes the typed estate with formatted amounts, and its locale or time zone could diverge. — The Estate line echoes the visitor's input (recorded in deferred-work). One request sets both the Django language and `presented.locale`. The stamp format `yyyy-MM-dd HH:mm` matches the old template.
    - `[low]` `[patch]` (blind) The new msgids "The case is busy. Try again." and "Rounding" have no ar/fr translation. — Patched in deferred-work as native-translation work (the rules forbid writing translation text here). The legacy captions Percentage and Relation already have translations.
    - `[low]` `[patch]` (blind) The copied column captions are questionable (missing hamza in "مسالة", "Excess"/"Shortage", fr "Pénurie"). — The values are legacy `.po` text copied unchanged by rule. Patched: deferred-work has a terminology-review entry naming each one.
    - `[low]` `[reject]` (blind) `whole()` casts a `Num` value that the contract also allows as a fraction. — `present_table` emits integers for column totals and cells (the engine table has only integers there), so the gap is validator-only.
    - `[low]` `[reject]` (blind) `presented.table` cross-reference validation gaps. — These are validator-only gaps that the single producer never hits, consistent with the 8.6 triage of the same contract.
    - `[low]` `[reject]` (blind) An optional `presented` renders blank. — Every fetch path (`fetchPreview`, shared, received) uses `parseServedPreview`, which rejects an answer without a valid `presented`. `parsePreview` remains for the tests and the legacy body.
    - `[low]` `[reject]` (blind) Legacy status and `presented.state` are two sources of truth. — Both come from the same evaluations by the same agreement rule. A mismatch fails loudly as `failed`, and the switch gate plus `test_presented_states_follow_the_legacy_status` check them across the corpus.
    - `[low]` `[reject]` (blind) Dead or fragile surface in `api/preview.py` (`_single`, the `compare(out)` signature, the reference module's placement, the calc→api import). — `_single` is used by `api.tests:1652`. The others are internal and only developer misuse could reach them; the reference module is documented as test-only and listed for removal.
    - `[low]` `[reject]` (blind) The response size doubles with no measurement. — This is the one-release expand/contract transition; removing the legacy fields is in deferred-work.
    - `[low]` `[reject]` (blind) Structural integers in the web table are unlocalized. — Every registered Locale is `latn`, and this is already recorded in deferred-work.
  - **Edge-case hunter**
    - `[low]` `[reject]` (edge) A session estate above 2^53 minor units raises `invalid_amount`, so preview returns 503. — It needs an estate of more than about 90 trillion; a cap or fallback adds a branch for an unrealistic input.
    - `[false]` `[reject]` (edge) The presented and legacy statuses can disagree. — Both use one `Outcome` and the same signature rule (8.6 `compare` mirrors `_signature`). The gate asserts state equality for every corpus family.
    - `[medium]` `[patch]` (edge) The lock timeout persists after the first lock. — Grouped with the blind lock row; patched.
    - `[false]` `[reject]` (edge) `PresentedResultsMixin` does not catch `PresentationError`/`ValueError`. — The currency is always SAR explicit and the school is the default, so `invalid_currency` and unknown-school errors cannot occur there.
    - `[low]` `[reject]` (edge) `compute()` and `present_calculation()` re-read without a snapshot. — A concurrent edit between two reads of the owner's own legacy page shows the newer state on reload. Adding REPEATABLE READ transactions is more than a direct fix.
    - `[low]` `[reject]` (edge) An unmapped Heir class or a null estate in `family_from_calculation`. — Every concrete Heir class is mapped, and `Deceased.estate` is always set by the legacy forms.
    - `[low]` `[reject]` (edge) A table row whose heir has no presented row renders blank. — The table and rows come from the same evaluation, so this cannot occur.
    - `[false]` `[reject]` (edge) `legacy_evidence` walks non-id values under `heir`/`row`/`person`. — In the engine proof and table those keys always hold person ids or None.
    - `[low]` `[reject]` (edge) `_evidence` raises a `KeyError` on an inconsistent session case. — `read_snapshot` drops invalid stored parts before preview, and the old ORM path would equally have failed.
    - `[low]` `[reject]` (edge) Web `unallocated_cells` can be shorter than the columns. — The producer always emits one per column; this is a validator-only gap.
    - `[low]` `[reject]` (edge) The `whole()` cast. — Grouped with the blind row.
    - `[low]` `[reject]` (edge) The contract `_table` lacks cross-checks. — Grouped with the blind validation row.
    - `[false]` `[reject]` (edge) `evidenceNotes` indexes tables by `order - 1`. — Evidence and layered-table orders are consecutive from 1 by contract (`parse_family` estates 1..n), so the index is the order.
    - `[false]` `[reject]` (edge) `build_context` fails when `school_line` is None. — Grouped with the blind report row (false).
    - `[low]` `[reject]` (edge) `family_from_session` accepts a duplicate death or an unknown `same_as`. — The session writes enforce these, and `parse_family` rejects a second estate for the same deceased.
    - `[low]` `[reject]` (edge) Removing `select_for_update` from `compute` allows torn reads. — Grouped with the snapshot row above; intended by AD-18/AD-27 (no GET lock).
    - `[false]` `[reject]` (edge) A blocked heir with a nonzero share is no longer flagged. — Blocked means a zero final share (8.6 decision). The legacy single path's ORM-blocked heirs always had share 0, and the gate compares the blocked flags.
    - `[medium]` `[patch]` (edge) The lock claim holds only for the first statement. — Grouped with the blind lock row; patched.
    - `[low]` `[reject]` (edge) The results page evaluates the family twice. — Grouped with the blind triple-evaluation row.
  - **Verification-gap reviewer**
    - `[low]` `[patch]` (verification-gap) No running test exercises the school-choice screen with presented data. — Pre-verified. Patched: `web/e2e/interview.spec.ts` now serves the fixtures with `presented` (and each chosen School's presented answer) and asserts every School's label and non-blocked share texts on the choice screen.
    - `[low]` `[patch]` (verification-gap) The step values on the Full results page are untested. — Pre-verified. Patched: a received-view test renders the awl, radd-with-spouse and correction fixtures and asserts that each step line equals the legacy proof value. A scratch check over every v1 fixture also confirmed the mapping.
    - `[low]` `[defer]` (verification-gap) The legacy `_presented_result.html` has only loose assertions. — Deferred per the layer's disposition: the pages await Epic 12's retirement decision. Recorded in frontmatter `deferred`.
    - `[false]` `[reject]` (verification-gap) The agreement table comes from `evaluations[-1]` and may not be Hanbali's. — `outcome()` orders hanafi, maliki, shafii, hanbali, so `[-1]` is Hanbali. The legacy `table` is built from the same Evaluation.
    - `[high]` `[patch]` (verification-gap, other) The e2e specs stub preview with fixtures that lack `presented`, so the interview flows fail as `failed`. — Patched: the e2e fixtures merge `preview-presented-fixtures.json`, including a new `chosen` map of per-School presented answers. That map is generated from the bridge and pinned by `test_presented_fixtures_are_the_bridge_output`.
    - `[medium]` `[patch]` (verification-gap, other) Stale legacy-page assertions. — Confirmed by the suite: `test_grandfather_quote_is_stored_and_shown` and `test_results_pages_show_columns_that_add_up` failed. Patched: the markup assertion matches the presented cell (two `1/2` shares, grandfather and brother). The amounts test stores the reference amounts with `legacy_compute` before the GETs, since a GET no longer writes them; the expected values are unchanged.
    - `[low]` `[patch]` (verification-gap, other) The untranslated labels. — Grouped with the blind msgid row; patched in deferred-work.
    - `[low]` `[reject]` (verification-gap, other) Redundant core evaluation. — Grouped with the blind triple-evaluation row.
  - **Intent-alignment auditor**
    - `[false]` `[reject]` (intent) The gate does not compare with the HEAD preview, and `presented` is not compared with the legacy output. — `legacy_preview_reference.py` is the HEAD preview's ORM path kept verbatim. Presented rows are asserted equal to the engine fractions, which the gate proves equal to the legacy ones.
    - `[false]` `[reject]` (intent) The received/shared/saved web views are not substantively exercised (zero-line diffs). — `invites.ts`/`shares.ts` switch to `parseServedPreview`. `received-view.test.tsx` renders an available result from presented strings and now also the step lines.
    - `[low]` `[reject]` (intent) `formatEstate` still uses `Intl`, and the PDF Estate line echoes the input. — It formats the typed input, not a calculation result; the spec permits it and deferred-work records it.
    - `[low]` `[reject]` (intent) The legacy pages still refuse later deaths. — This is unchanged behaviour pinned by `LayeredResultsViewTests`; legacy page scope is Epic 12's.
    - `[low]` `[reject]` (intent) Concurrent results GETs are tested only sequentially. — The GET takes no lock and writes nothing (asserted from captured SQL), so concurrency adds nothing to verify.
    - `[low]` `[reject]` (intent) `legacy_compute` and the legacy preview fields remain. — They are the parity reference and the one-release transition, unreachable from requests and listed for removal.
    - `[low]` `[reject]` (intent) Amounts now carry a currency symbol. — Owner decision of 2026-11-16 for phase-1 bare decimals, recorded in deferred-work.

## Design Notes

- **Why keep `legacy_compute`.** AD-15 requires a reference to switch against. Deleting the ORM fiqh now would leave the gate with nothing to compare. Renaming it keeps ~100 legacy-column tests intact, so no fixture is rewritten, while production stops calling it.
- **Why the legacy preview fields stay.** This is an expand/switch/contract rollout. A cached web bundle from release N−1 must still parse the preview body during deployment, so `presented` is additive.
- **Impossible families in the gate.** The legacy reference for a family that `heir_rules.is_impossible_family` rejects (for example, two paternal grandmothers) is the legacy *consumer* answer: a refusal with `invalid_family`. Both the legacy preview guard and `calc/test_engine_parity.py:134` / `presentation/tests/test_parity.py:145` already establish this. The gate therefore asserts that the core refuses with `invalid_family` for such families, exactly as `ParityMixin` does. It does not compare against raw `legacy_compute` on rows that no consumer would compute.
- **Table leaf example** (v3): `{"code":"base","label":"Shares","total":{"value":24,"text":"24","dir":"ltr"}}`; a cell `{"value":{"value":3,"text":"٣","dir":"ltr"},"span":1}` (an Arabic Locale with `arab` digits would show `٣`; today's Locales are `latn`).

## Verification

**Commands:**
- `uv run python manage.py test calc.test_switch_gate calc.test_engine_parity presentation.tests.test_parity --noinput` -- expected: OK (the gate).
- `uv run python manage.py test api reports calc i18n --noinput` -- expected: OK.
- `uv run python -m unittest engine.tests.test_contracts engine.tests.test_purity presentation.tests.test_present presentation.tests.test_display_changes` -- expected: OK.
- `cd web && npm run i18n && npm test && npm run lint && npm run typecheck` -- expected: pass; `npm run i18n:write` leaves `git status` clean.
- `uv run python scripts/contract_fixtures_lock.py --check` and `uv run python manage.py makemigrations --check --dry-run` -- expected: the lock is current; no changes.

## Auto Run Result

Status: done

**Summary:** The existing calculation consumers now run on the pure core and the presenter, behind a passing AD-15 switch gate.
- **Preview** (`api/preview.py`) calculates in memory. It creates, updates and locks no rows and advances no sequence. It keeps every legacy field for one release and adds `presented` (PresentedResult **v3**: v2 plus the formatted scholars' table).
- **`Calculation.compute`** is a thin adapter: no writes, no `select_for_update`, no savepoints, with later deaths composed in the core. The ORM fiqh is kept only as the parity reference `legacy_compute`.
- **Renderers.** The PDF, the web (preview, Full results, shared, received, school choice) and the legacy Django results pages render presented strings only. `percent_of`/`kirat_of`, `format.ts` and the browser's `Intl`/BigInt result arithmetic are gone.
- **Legacy write views** bound their case-lock wait to 500 ms and return a retryable 503.

**Gate:** `calc.test_switch_gate calc.test_engine_parity presentation.tests.test_parity`: 17 tests OK (2548 s), covering fixtures, School sweeps, relationship/random families, core families and later deaths. Impossible families are compared with the legacy refusal (`invalid_family`), as the Design Notes record. The first implementer had halted on that family before the note was added.

**Files:**
- `calc/adapters.py` (new): `family_from_session`, `family_from_calculation` (explicit person ↔ Heir ids), `basis_from_madhab`, `legacy_evidence`, `present_calculation`.
- `calc/models.py`, `calc/manasikhat.py`, `calc/schools.py`: thin `compute`, `legacy_compute` reference, catalog fallback for `UnsupportedCase.message`.
- `calc/views.py`, `calc/templates/calc/{results,new_results,_presented_result}.html`: the presented legacy pages and the bounded `lock_calculation`.
- `calc/test_switch_gate.py`, `calc/legacy_preview_reference.py` (test-only): the AD-15 gate and its frozen reference.
- `api/preview.py`: the in-memory preview plus `presented`. `api/contracts/preview-presented-fixtures.json`: generated presented fixtures, with per-School `chosen` answers.
- `engine/contracts/presented.py`, `codes.py`, `contracts/manifest.json`, `contracts/fixtures/**`, `contracts/fixtures.lock.json`, `web/src/contracts/{presented,codes}.ts`: PresentedResult v3.
- `presentation/{table,present,compare,__init__}.py`: the table leaves and `refused_outcome`.
- `i18n/terms/*.json`, `i18n/tests.py`, `web/src/i18n/{validate,validate.test,catalog.generated}.ts`: seven `table.column.*` keys (pending).
- `reports/report.py`, `reports/templates/reports/draft.html`: the PDF from `presented`.
- `web/src/api/{case,invites,shares}.ts`, `web/src/interview/{preview,results,table}.ts` (`format.ts` deleted), the results, interview, received and shared components, and their tests. `web/e2e/interview.spec.ts` uses the presented fixtures.
- `api/tests.py`, `calc/tests.py`, `reports/tests.py`, `presentation/tests/*`: the legacy-reference rename, new no-write/no-lock/sequence/presented/PDF tests. No expected answer was changed.
- `deferred-work.md`: the 8.7 section.

**Review:** 53 findings (high 1, medium 5, low 37, false 10).
- **Patched:**
  - **high:** the e2e preview stubs lacked `presented`. They now merge the generated presented fixtures, and the choice screen's per-School texts are asserted.
  - **medium (3 entries):**
    - the lock timeout is reset after the case lock (3 findings grouped);
    - the legacy page's reason tooltip is restored from the evidence;
    - two stale legacy-page tests are updated (the reference amounts are stored first; the markup and count match the two 1/2 shares).
  - **low:**
    - the Arabic original is shown only when it differs;
    - deferred-work entries for the untranslated msgids and the caption terminology;
    - a steps test on the results page;
    - school-choice assertions.
- **Deferred:** the legacy template's thin assertions (frontmatter `deferred`).
- **Rejected:** 10 false and the remaining low findings, each with its reason in the triage log.

**Follow-up review recommended: true.** This first pass patched a `high` entry. The named unverified risk is `web/e2e/interview.spec.ts`: the Playwright interview flows (agree, differ-and-choose, refusal) were not run on this host. CI must confirm that the merged fixtures and the new per-School assertions pass. Patched counts: high 1, medium 3, low 4.

**Verification:**
- Switch gate: 17 OK.
- `manage.py test api reports calc i18n` (526 tests): only the two stale legacy-page tests failed. They are fixed, and the follow-up runs passed: the targeted calc/api classes (58) and `api.tests` + the grandfather test (276 OK).
- `python -m unittest engine.tests.test_contracts engine.tests.test_purity presentation.tests.test_present presentation.tests.test_display_changes`: 58 OK.
- `contract_fixtures_lock.py --check`: current. `makemigrations --check`: no changes.
- Web: `npm run i18n` ok; `npm test` 501 pass; lint 0 errors (12 warnings, two fewer than before the patches); typecheck clean.
- The acceptance grep finds `Intl.NumberFormat` only in `answers.ts` `formatEstate` (input formatting, permitted).
- The full `calc.tests` suite was not re-run after the template and lock patches; the affected classes were.

**Residual risks:**
- The e2e suite was not run locally.
- Preview latency and response size are unmeasured; the legacy fields double the body for one release.
- The legacy pages changed look (product review in deferred-work).
- "The case is busy. Try again." and "Rounding" are untranslated in ar/fr.
- The new column captions and currency symbols await native/owner review.
- `i18n.glyphs` could not run on this host (no Noto fonts).
