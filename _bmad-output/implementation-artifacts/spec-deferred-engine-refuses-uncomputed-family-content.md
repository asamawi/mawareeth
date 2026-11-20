---
title: 'Engine refuses a Family carrying gifts, bequests or eligibility answers'
type: 'bugfix'
created: '2026-11-20'
status: 'done'
baseline_revision: '1409487ec43f2bfeee72c07e07d854267af30747'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** `engine/core.py` `evaluate` reads only heirs and the estate, so a Family that carries `gifts`, `bequests` or eligibility `answers` gets a normal calculated Result, as if those facts did not exist (deferred item from the Epic 8 retrospective, source spec 8.2). No producer sends them yet, but the contract can carry them and the engine silently ignores them.

**Approach:** `evaluate` refuses with the existing `invalid_family` code when any of `family.gifts`, `family.bequests` or `family.answers` is non-empty, placed right after the existing impossible-family checks and before the Jafari and successive-death refusals. Later bequest, gift and eligibility stories replace the refusal with real computation.

## Boundaries & Constraints

**Always:** Reuse the refusal code `invalid_family`: no new refusal reason, no contract version bump, no catalog, `.po` or `messages.ts` text. One guard in `evaluate` covers `calculate`, `engine/queries.py` (`refusal`, `share_changing_presets`), `presentation/compare.py` and the ORM compute path. The existing invalid-family checks keep running first (their result is the same code). A non-empty field refuses even when the amount is 0 or the answer value is `false`.

**Never:** Do not change the contract parser (`engine/contracts/family.py`), `api/snapshots.py` (it already rejects these fields as `unsupported_content`), `calc/adapters.py` (it always sends empty lists), `presentation/notices.py` (`_bequest_prompt` does not read `family.bequests`), or any producer. Do not add a new refusal reason or touch `contracts/`, `web/`, `i18n/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Empty fields | `answers`, `gifts`, `bequests` all `[]` | calculated exactly as before | No error expected |
| Bequest | one bequest `{'branch': 'h0', 'amount_minor': 1000}`, any school | `status == 'refused'`, `refusal == 'invalid_family'`, no allocations | refusal, no exception |
| Gift | one gift on `h0`, any school | `invalid_family` | refusal |
| Answer | one answer `{'question': 'sect', 'person': None, 'value': 'sunni'}` (or `value: false`) | `invalid_family` | refusal |
| Zero amount | bequest with `amount_minor: 0` | `invalid_family` | refusal |
| Jafari precedence | bequest + school `jafari` | `invalid_family` (not `school_not_supported`) | refusal |
| Successive deaths | `later_deaths_document()` + one bequest | `invalid_family` (not calculated, not `manasikhat_unsupported`) | refusal |

</intent-contract>

## Code Map

- `engine/core.py:108` -- `evaluate`: impossible-family checks end at about line 124 (`return _refused(rule_set, 'invalid_family')`); the Jafari branch follows at line 125. Insert the new guard between them. `_refused` at line 64.
- `engine/contracts/family.py:67` -- `Family` dataclass: `answers: Tuple[Answer, ...]`, `gifts`/`bequests: Tuple[Amount, ...]`. `_amounts` (line ~93) requires each `branch` to be a known person id and `amount_minor >= 0`; answers take `question`, `person` (nullable known id) and `value` (bool or snake_case string). Read-only.
- `engine/tests/test_core.py` -- helpers `family_document(relationships)` (heirs `h0`, `h1`, ...), `later_deaths_document()`, `c.parse_family`, `calculate`, `school_rule_set`, `SCHOOLS`; refusal-test pattern in `test_impossible_families` / `test_gender_contradicting_relationship_is_refused` (around line 160-185).
- `api/test_snapshots.py:191-206,296-313` -- precedent: snapshots with each field non-empty are rejected as `unsupported_content`; stays unchanged.
- `contracts/fixtures/family/single-estate.json` -- carries two answers; used only for contract round-trip tests (`engine/tests/test_contracts.py`), which never calculate. Stays unchanged.

## Tasks & Acceptance

**Execution:**
- `engine/core.py` -- in `evaluate`, after the impossible-family loop and before the Jafari check, return `_refused(rule_set, 'invalid_family')` when `family.gifts or family.bequests or family.answers`; update the `evaluate` docstring with one sentence saying the engine refuses content it cannot compute yet -- closes the deferred gap.
- `engine/tests/test_core.py` -- add tests covering every I/O matrix row: each of bequest, gift, answer (string and `False` value) and zero-amount bequest refused as `invalid_family` with no allocations for every school in `SCHOOLS`; Jafari precedence; a successive-death family with a bequest refused; the empty-fields control still calculated; and `engine.queries.refusal(fam, school_rule_set('hanbali'))` returning `invalid_family` for a bequest family.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- remove the "`evaluate` ignores Family gifts, bequests and eligibility answers" entry under "Epic 8 retrospective follow-ups" and add one entry there (`source_spec` = this spec) saying the bequest, gift and eligibility stories must replace the `invalid_family` refusal with computation, or a dedicated refusal reason with reviewed text and a Result/Comparison/PresentedResult version bump, before any producer emits these fields, since the `invalid_family` text tells the user the family is impossible.

**Acceptance Criteria:**
- Given any Family the session shell, legacy adapter or Saved-case readers produce today (all three fields empty), when it is calculated, then the result is unchanged: all existing engine, calc, presentation and api tests pass without edits to their expectations.
- Given a Family with a non-empty `gifts`, `bequests` or `answers`, when `engine.queries.refusal` is asked for it, then it reports `invalid_family`.

## Spec Change Log

## Review Triage Log

### 2026-11-20 — Review pass
- verdicts: 8 findings — high 0, medium 0, low 7, false 1, maybe-false 0
- routing note: all five layers ran as one combined read-only codex call (Codex tier: standard); edge-case-hunter reported none, cross-story-contract reported "No contract shape changed". Patches touched 4 files, so they went back to the Sonnet implementer, not codex.
- findings:
  - `[low]` `[patch]` blind-hunter: the successive-death bequest test uses a linked later deceased, so moving the guard below the `manasikhat_unsupported` loop would still pass — added a bequest to the unlinked fixture in `engine/tests/test_layered.py`, asserting `invalid_family`.
  - `[low]` `[patch]` blind-hunter: `queries.refusal` checked only for a Hanbali bequest — now asserted for every mutation and school in `test_uncomputed_content_is_refused`.
  - `[low]` `[patch]` blind-hunter: the layered refusal asserted only the reason — now also asserts empty `allocations` and `layers`.
  - `[low]` `[patch]` blind-hunter: `share_changing_presets` not exercised with uncomputed content — same root as the verification-gap preset row; `engine/tests/test_queries.py` now asserts `()` for the grandfather-and-brother family with a gift.
  - `[low]` `[patch]` verification-gap: no test pins guard precedence over `manasikhat_unsupported` for an unlinked deceased — same root and fix as the first blind-hunter row.
  - `[low]` `[patch]` verification-gap: preset comparison has no assertion for a family every preset refuses — same fix as the blind-hunter preset row.
  - `[low]` `[patch]` verification-gap: no presentation test driven by the new refusal — added `test_family_with_bequest_is_all_refused` in `presentation/tests/test_present.py` (`state='refused'`, `comparison_outcome='all_refused'`, reason `invalid_family`, no rows).
  - `[false]` `[reject]` intent-alignment: the intent "deffered work" could mean the whole backlog or delivering bequest/gift computation — descriptive only; this unattended loop takes one deferred item per run, and the backlog item itself says "compute them or refuse a Family that carries them"; computation belongs to the future bequest/gift stories, recorded in deferred-work.md.

## Design Notes

Why `invalid_family` and not a new code: a new refusal reason is a closed-vocabulary change in three contract copies (`engine/contracts/codes.py`, `contracts/codes.json`, `web/src/contracts/codes.ts`), which AD-25 makes a Result, Comparison and PresentedResult version bump, plus new ar/en/fr sentences needing native review. No producer can reach this refusal today (adapters send empty lists; snapshot v2 rejects the fields), so the user never sees its wording; the guard only stops the engine from silently computing a wrong answer. The deferred-work entry makes the follow-up explicit.

## Verification

**Commands:**
- `uv run python -m unittest engine.tests.test_core engine.tests.test_layered engine.tests.test_queries engine.tests.test_contracts` -- expected: all pass
- `uv run python manage.py test calc.test_engine_parity presentation api.test_snapshots --noinput` -- expected: all pass (needs Postgres on localhost:5432)

## Auto Run Result

Status: done

**Summary:** `engine/core.py` `evaluate` now refuses a Family carrying non-empty `gifts`, `bequests` or `answers` with the existing `invalid_family` code, after the impossible-family checks and before the Jafari and successive-death refusals. No contract, catalog or translation changed.

**Files changed:**
- `engine/core.py` -- the guard and a docstring sentence.
- `engine/tests/test_core.py` -- refusal for bequest, gift, zero bequest, string and `False` answers across all schools (via `calculate` and `queries.refusal`); Jafari and successive-death precedence; empty-content control.
- `engine/tests/test_layered.py` -- precedence over `manasikhat_unsupported` for an unlinked later deceased.
- `engine/tests/test_queries.py` -- `share_changing_presets` returns `()` for a family with a gift.
- `presentation/tests/test_present.py` -- compare-basis presentation of a bequest family is `all_refused`.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- replaced the item with the follow-up: compute these fields, or add a dedicated refusal reason with reviewed text and a contract version bump, before any producer emits them.

**Review:** 8 findings — 7 low patched (4 distinct test additions after grouping), 1 false rejected (intent-alignment, descriptive). Nothing deferred. Patched counts by verdict: high 0, medium 0, low 7.

**Follow-up review recommended:** false (no high or medium patches).

**Verification:**
- `uv run python -m unittest engine.tests.test_core engine.tests.test_layered engine.tests.test_queries engine.tests.test_contracts` -- 62 tests OK (before and after patches).
- `uv run python manage.py test calc.test_engine_parity presentation api.test_snapshots --noinput` -- 64 tests OK (skipped=1) before patches; 65 tests OK (skipped=1) after patches.

**Residual risks:** The `invalid_family` text tells a user the family is impossible; unreachable today (adapters send empty lists, snapshot v2 rejects these fields), tracked in deferred-work.md for the bequest/gift/eligibility stories.
