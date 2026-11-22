---
title: 'Engine refuses a person whose gender contradicts their relationship'
type: 'bugfix'
created: '2026-11-20'
status: 'done'
baseline_revision: '1422270ddf93ad4ae67a1ea4a780e2fc3f0f5930'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The calculation core (`engine/core.py` `evaluate`) checks impossible relationship combinations and a later deceased's spouse sex, but it accepts and calculates a person whose recorded gender contradicts a relationship (a female `father`, a male `daughter`), in the first estate and in later deaths (deferred item from the Epic 8 retrospective, source spec 8.3).

**Approach:** Before school dispatch, `evaluate` refuses with the existing `invalid_family` code when any person's own `relationship` or any `LayerHeir.relationship` in any estate contradicts that person's gender per `engine.kinship.RELATIONSHIP_GENDERS`. The one producer that can send a mismatch today, the legacy Calculation adapter, takes each heir's gender from its relationship, as the legacy Saved-case importer already does, so legacy pages keep their answers.

## Boundaries & Constraints

**Always:** Reuse the refusal code `invalid_family` (no new code, no new contract, catalog or user-facing text). The check is part of the existing impossible-family gate, so it comes before the `school_not_supported` (Jafari) and `manasikhat_unsupported` refusals, as today. Check every person in `family.persons`, including people who died before or with the root (`status: died_before_or_with`) and people who appear only as later-estate heirs (`relationship` null: skip only the own-relationship comparison, still check their estate entries). Use `RELATIONSHIP_GENDERS` as the single source of relationship gender.

**Never:** Do not touch the root (Family v1 has no root gender; the root-spouse item is a separate deferred item). Do not change `engine/queries.py` (`relationship_options`, `change_impossible`); that is a separate deferred item. Do not change the contract parser (`engine/contracts/family.py`) to reject mismatches; the refusal belongs to `evaluate`. Do not change the legacy adapter's same-person/death sex consistency checks (they still compare stored `sex`). Do not change any translation or `.po` text.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Consistent family | every heir's gender matches its relationship | calculated exactly as before | No error expected |
| First-estate mismatch | a `female` person as `father` (or `male` as `daughter`) in estate 1, any school | `Result.status == 'refused'`, `refusal == 'invalid_family'` | refusal, no exception |
| Mismatch with Jafari | same family, school `jafari` | `invalid_family` (not `school_not_supported`) | refusal |
| Died-before person | a `died_before_or_with` person, `male`, relationship `mother`, not an heir in any estate | `invalid_family` | refusal |
| Later-estate-only heir | person with null relationship, `female`, entered as `son` in estate 2 | `invalid_family` | refusal |
| Aliased heir | person is `son` (male) in estate 1 and `daughter` in estate 2 | `invalid_family` | refusal |
| Legacy row with stored sex contradicting its class | legacy `Father` row with `sex='F'` (or blank `sex`) on a legacy Calculation | calculated as before (gender follows the class) | No error expected |

</intent-contract>

## Code Map

- `engine/core.py:108` -- `evaluate`: the impossible-family loop at about lines 113-118 (`is_impossible(rels)` plus later-deceased spouse sex) returns `_refused(rule_set, 'invalid_family')`; add the gender check here, before the Jafari branch.
- `engine/kinship.py:25` -- `RELATIONSHIP_GENDERS`: all 23 relationship ids to `male`/`female` (pinned complete by `engine/tests/test_queries.py` `test_vocabulary`); there are no gender-neutral relationships.
- `engine/contracts/family.py` -- `Person(id, gender, relationship|None, status, death_order, ...)`, `Estate(order, deceased, heirs)`, `LayerHeir(person, relationship)`; the parser already requires gender in `male|female` and that a person's relationship equals their first-estate entry. Read-only.
- `calc/adapters.py:61` `family_from_calculation`, lines 110-117 -- the legacy Calculation adapter builds `session_rows` with `'gender': 'male' if row.sex == 'M' else 'female'` (blank `sex` becomes female); change it to `RELATIONSHIP_GENDERS[inverse[type(row)]]`. Leave the `earlier.sex != row.sex` / `earlier.sex != death.sex` checks and the deceased/death `gender` entries as they are.
- `api/legacy_cases.py:18,42` -- precedent: the legacy Saved-case importer already sets each heir's gender from the relationship ("Like every heir's, the gender follows the relationship, not `sex`."). Read-only.
- `engine/tests/test_core.py:160` -- `test_impossible_families` / `test_impossible_is_checked_before_other_refusals`: pattern for refusal assertions with `calculate(...)`, `family(rels)`, `later_deaths_document`, `school_rule_set`, `SCHOOLS`.
- `engine/tests/test_layered.py:125` -- layered fixtures; the existing precedence test uses a female `W` as `husband` with a male later deceased and stays `invalid_family`.
- `calc/test_engine_parity.py`, `calc/test_switch_gate.py` -- build legacy rows with consistent sexes; must stay green.

## Tasks & Acceptance

**Execution:**
- `engine/core.py` -- in `evaluate`, refuse `invalid_family` when any person's non-null `relationship`, or any estate's `LayerHeir.relationship` for that person, maps in `RELATIONSHIP_GENDERS` to a gender other than the person's `gender` -- closes the deferred gap inside the existing gate.
- `calc/adapters.py` -- set each legacy heir row's session `gender` from its relationship (`RELATIONSHIP_GENDERS`), not from `row.sex` -- legacy pages keep calculating rows whose stored sex is wrong or blank, as the importer does.
- `engine/tests/test_core.py` -- add tests for the first-estate mismatch across all `SCHOOLS` (male `daughter`, female `father`), the Jafari precedence, and a `died_before_or_with` mismatch.
- `engine/tests/test_layered.py` -- add tests for a later-estate-only mismatched heir and an aliased person whose later relationship contradicts their gender; and a consistent layered family still calculates.
- `calc/test_switch_gate.py` -- add a test that `calc.adapters.family_from_calculation` on a legacy Calculation whose `Father` row has `sex='F'` (and one with blank `sex`) gives a Family that calculates with the same allocations as the same Calculation with `sex='M'`.

**Acceptance Criteria:**
- Given any Family the session shell or the Saved-case readers produce today, when it is calculated, then the result is unchanged (all existing engine, calc and api tests pass without edits to their expectations).
- Given a mismatch in any estate, when `calculate` runs for any school, then no allocation is returned and the refusal is `invalid_family`.

## Spec Change Log

## Review Triage Log

### 2026-11-20 — Review pass
- verdicts: 12 findings — high 0, medium 0, low 9, false 3, maybe-false 0
- routing note: all five layers ran as one combined read-only codex call (Codex tier: standard); no fallback was needed.
- findings:
  - `[low]` `[reject]` blind-hunter: a legacy `Son` row and its linked later `Deceased` both stored `sex='F'`, with a `Husband` in the later estate, used to calculate (female deceased) and is now refused (male person per class) — real, but the stored data is self-contradictory (a female "son" with a husband) and cannot keep its old answer under the new engine rule either way: keeping `row.sex` would trip the new heir-gender refusal. Unlikely in production; the fix is not a direct correction. Recorded as a residual risk with a production count in deferred work.
  - `[low]` `[patch]` blind-hunter: later-death mismatch tests stop at estate 2 — added a three-estate alias case (consistent in estates 1-2, contradicting only in estate 3) to `engine/tests/test_layered.py`.
  - `[low]` `[patch]` blind-hunter: the consistent layered control only asserted the refusal was not `invalid_family` — it now asserts `calculated` for the Sunni schools and `school_not_supported` for Jafari.
  - `[false]` `[reject]` edge-case-hunter: KeyError for an unknown relationship on a directly built Family — `parse_family` only admits the 23 codes in `RELATIONSHIP_GENDERS` (pinned by `test_vocabulary`); a Family that bypasses the parser failing loudly is correct, and `evaluate` already indexes `people[...]` and counts relationships the same way.
  - `[false]` `[reject]` edge-case-hunter: KeyError for an heir missing from `persons` — the parser rejects heirs that reference unknown persons, and the pre-existing spouse check already indexes `people[estate.deceased]` without a guard.
  - `[low]` `[reject]` edge-case-hunter: legacy `Son`+`Deceased` both `F` with a later `Wife`, previously refused, now calculates — same root as the first row: self-contradictory legacy data; with the class gender the family is consistent and calculating it is correct.
  - `[low]` `[reject]` edge-case-hunter: the Design Notes claim that every legacy answer is kept does not hold for the later-death spouse case — same root as the first row; residual risk recorded.
  - `[low]` `[patch]` edge-case-hunter: control asserts only `!= invalid_family` — same fix as the blind-hunter control row.
  - `[low]` `[patch]` verification-gap: no third-estate case — same fix as the blind-hunter three-estate row.
  - `[low]` `[patch]` verification-gap: legacy normalization tested only for a root-estate row — added `test_later_estate_only_heir_gender_follows_the_class` to `calc/test_switch_gate.py` (unlinked second-calculation `Son` with stored `sex` `F` or blank keeps the `M` allocations).
  - `[low]` `[reject]` verification-gap (other): later-death spouse decision flips for a stored female `Son` that later dies with a `Husband` — duplicate of the first row.
  - `[false]` `[reject]` intent-alignment: descriptive report; the diff implements readings 1 and 2 (calculation-time refusal over every person and estate). Reading 3 (parser admission) is excluded by the spec's Never list, and the cross-story-contract layer found no contract shape change.

## Design Notes

The legacy adapter is the only current producer that can send a mismatch: it reads gender from the stored `sex` column, which is user-chosen in the old forms and blank-able. Epic 8 requires that phase-1 cases keep opening with unchanged school behaviour, and gender plays no part in a heir's share once the relationship is known, so taking gender from the class keeps every legacy answer. The importer `api/legacy_cases.py` already uses the same rule.

## Verification

**Commands:**
- `uv run python manage.py test engine.tests.test_core engine.tests.test_layered engine.tests.test_queries calc.test_engine_parity calc.test_switch_gate --noinput` -- expected: all pass.
- `uv run python manage.py test calc.tests api.tests api.test_legacy_cases api.test_snapshots api.test_foundation_outcomes --noinput` -- expected: all pass (adapter and engine consumers: legacy results pages, preview, Saved cases).

## Auto Run Result

Status: done

**Summary:** The calculation core now refuses, with the existing `invalid_family` code, any Family in which a person's own relationship, or any relationship they hold in any estate, contradicts their gender. The check runs before the Jafari and manasikhat refusals. The legacy Calculation adapter now takes each heir's gender from its row class (as the legacy Saved-case importer already did), so legacy rows with a wrong or blank stored `sex` keep calculating.

**Files changed:**
- `engine/core.py` -- gender-vs-relationship check in `evaluate`, using `engine.kinship.RELATIONSHIP_GENDERS`.
- `calc/adapters.py` -- `family_from_calculation` sets heir gender from the relationship, not `row.sex`.
- `engine/tests/test_core.py` -- first-estate mismatch across all five schools (Jafari precedence), died-before mismatch.
- `engine/tests/test_layered.py` -- later-only, aliased and third-estate mismatches; consistent control asserts `calculated` / `school_not_supported`.
- `calc/test_switch_gate.py` -- `LegacyHeirSexTests`: root and later-estate-only legacy rows with `F` or blank stored sex keep the `M` allocations.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- resolved item removed; production count of the residual legacy case added.

**Review:** one combined codex pass (standard tier, no fallback), 12 findings. Patched 3 entries (all `low`, test coverage: third estate, stricter consistent control, later-estate legacy row). Rejected: 3 `false` (KeyError on Families that bypass `parse_family` x2, intent-alignment report with no defect) and 4 `low` rows sharing one root (self-contradictory legacy later-death data whose spouse decision flips; it cannot keep its old answer under the new rule, recorded as residual risk and as a deferred production check). Nothing added to frontmatter `deferred`.

**Follow-up review recommended:** false -- patched counts: high 0, medium 0, low 3.

**Verification:**
- `uv run python manage.py test engine.tests.test_core engine.tests.test_layered engine.tests.test_queries calc.test_engine_parity calc.test_switch_gate --noinput` -- 57 tests, OK (after patches).
- `uv run python manage.py test calc.tests api.tests api.test_legacy_cases api.test_snapshots api.test_foundation_outcomes --noinput` -- 509 tests, OK (skipped=1).
- Matrix audit: every I/O row is covered (consistent family by the existing suites and the layered control; first-estate, Jafari, died-before in `test_core`; later-only and aliased in `test_layered`; legacy row in `LegacyHeirSexTests`), and all ran and passed.
- The logs contain `calc.proof: Cannot build successive-death table` (`Missing layer table`) records from the legacy table builder's deliberate catch-and-log fallback (`calc/proof.py:286`); the change does not touch that path and all tests pass.

**Residual risks:** a legacy successive-death Calculation whose heir row stores a sex contradicting its class, and whose later estate lists a spouse for that heir, changes outcome (husband: calculated to refused; wife: refused to calculated). None is expected; the deferred-work entry asks for a read-only production count.
