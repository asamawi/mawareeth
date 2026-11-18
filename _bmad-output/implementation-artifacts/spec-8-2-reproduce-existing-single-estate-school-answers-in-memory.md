---
title: 'Story 8.2: Reproduce existing single-estate School answers in memory'
type: 'feature'
created: '2026-11-16'
status: 'done'
baseline_revision: '97d16a7a7ead3e1e509ba11e85997ee7690080c3'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-8-1-preserve-case-meaning-through-versioned-shared-contracts.md'
warnings: [oversized]
deferred:
  - summary: >-
      The engine cannot refuse a spouse of the wrong sex for the deceased (a husband alone for a male deceased), because Family v1 has no gender for the root.
    evidence: |-
      engine/core.py is_impossible is gender-free by design; heir_rules.is_impossible_family refuses these with invalid_family. calc/test_engine_parity.py pins that the engine returns calculated for them. Settle with a Family version that carries the root's gender, or keep the shell's check in the 8.7 adapters.
    location: >-
      engine/core.py is_impossible
    severity: medium
  - summary: >-
      evaluate ignores Family gifts, bequests, answers and the estate amount, so a Family carrying a bequest gets a normal calculated Result with no refusal.
    evidence: |-
      maybe-false. No producer emits gifts or bequests yet (Country execution and obligatory bequests are later waves). Settle when the bequest/gift stories add them: either compute them or refuse a Family that carries them.
    location: >-
      engine/core.py evaluate
    severity: medium (unverified)
---

<intent-contract>

## Intent

**Problem:** The only single-estate engine is `Calculation.compute`. It needs database rows: the preview creates temporary rows and rolls them back. So the AD-15 pure core cannot exist until the School fiqh in `calc/models.py`, `calc/schools.py` and `calc/proof.py` also runs in memory, with identical answers.

**Approach:** Port the single-estate classification (`get_quote`) and `distribute` into pure modules under `engine/`. They work on in-memory heirs keyed by the stable person ids of a Family (8.1 contract). The core exposes:
- `engine.calculate(family, rule_set) -> Result`, the 8.1 contract;
- `engine.evaluate(...)`, which also returns the deep-frozen proof and scholars' table evidence;
- `engine.parse_preset(data) -> RuleSet`;
- built-in School rule sets.

A Django parity harness runs every family in the existing corpus through both paths and requires an identical answer. No consumer switches.

## Boundaries & Constraints

**Always:**
- `engine/` stays stdlib-only, with no I/O, clock, global mutable state, Django or gettext. The 8.1 AST purity test in `engine/tests/test_contracts.py` must keep passing over the new modules.
- Port the fiqh faithfully. Keep the same branch order, the same `FIQH_ORDER` classification order (ties broken by entry order, standing in for `pk`), the same group, column, awl, radd and correction arithmetic, the same `round()` calls and the same proof and table shapes. The `has_*` / `instance_of` counts include blocked heirs, exactly as the ORM queries do.
- Drop `quote_reason` and every other display text. Keep only codes, `Fraction`s and ints.
- School divergences are read from the RuleSet's rule values, not from the school name, except for the Ja'fari refusal. For every School, the built-in rule sets must equal the decisions in `calc/schools.py`.
- A refusal returns a refused Result with no allocations, steps or unallocated share. A bad input raises a typed `ContractError`.
- Result values are frozen dataclasses. Evidence is deep-frozen (`MappingProxyType` and tuples). `engine.thaw()` turns it back into plain dicts and lists.

**Never:**
- No changes to `calc/`, `api/`, `reports/`, `web/` or migrations, except the new test module `calc/test_engine_parity.py`. No consumer calls the engine yet.
- Never edit or rewrite an existing fixture or expected value to hide a difference. A parity mismatch is a port bug: fix the engine.
- No fiqh corrections. Shibh al-Malikiyya and other deferred questions keep today's behaviour.
- No production Country preset and no file discovery. No amounts or money rounding: those are 8.6.
- No later-death composition. That is 8.3. Here a multi-estate Family is refused.
- No new dependencies.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Known answer | Family: heirs wife, mother and 3 daughters (ids in entry order); `school_rule_set('hanbali')` | calculated. Shares 1/8, 7/40, 7/30 ×3. `unallocated` 0. Step `radd`. Mother and daughters `school_rule` `radd` | — |
| School divergence | grandfather + brother, `hanafi` vs `hanbali` | hanafi: 1 and 0 (brother `blocked`, `blocked_by` grandfather). hanbali: 1/2 and 1/2 | — |
| Spouse alone | wife only | wife 1/4. `unallocated` 3/4. Steps base 4, then `unallocated` `{rest: 3/4}` | — |
| No heirs | estate 1 has no heirs | calculated, no allocations, `unallocated` 1, steps `[base 0]` | — |
| Ja'fari | any family, `school_rule_set('jafari')` | refused `school_not_supported` | — |
| Malikiyya | husband, mother, grandfather, 2 maternal brothers and a paternal brother, `maliki` | refused `malikiyya_disputed`. Shafi'i calculates (muqasama) | — |
| Impossible | two fathers / husband and wife / 5 wives / a second of any `SECOND_OF` relationship | refused `invalid_family`, checked before any other refusal | — |
| Later deaths | Family with more than one estate | refused `manasikhat_unsupported` (after `invalid_family` and `school_not_supported`) | — |
| Unknown School | `school_rule_set('x')` | — | `ContractError('invalid_contract')` |
| Preset | valid preset data, `default_school` hanbali, `rules:{grandfather_with_siblings:"blocks"}` (cited) | RuleSet: school hanbali, the hanbali defaults overlaid with blocks. Grandfather + brother gives 1 and 0 | — |
| Preset invalid | contract-invalid data / unknown rule or setting key / wrong value type | — | the contract's code, or `invalid_contract` |

</intent-contract>

## Code Map

- `calc/models.py:17-60` -- `_Group` (weights, `column()` with the `round(amount*base)` fallback), `is_male`. Port as-is; `money` is not needed.
- `calc/models.py:383-389` -- `get_quotes`: sorts by `FIQH_ORDER` index, then `pk`, then classifies. `FIQH_ORDER` and `MALE_HEIRS` are at `:1917-1926`.
- `calc/models.py:397-578` -- the `has_*`, `get_*` and `grandmother_count` queries. They count all heirs of a type, blocked ones included. Also `gf_meets_siblings`, `gf_shares_with_siblings`, `paternal_siblings_counted_out` and `is_akdariyya`. `calc.maternal_quote` is set by MaternalBrother/MaternalSister (`:1534`, `:1573`) and read in `distribute`.
- `calc/models.py:580-904` -- `distribute` and `_tag_school_rules`. These are the fixed groups, mushtaraka, the grandfather options, akdariyya, muadda, asaba, father/grandfather extra, radd, columns, correction, `proof.build_table` arguments and `_proof_steps`. Lines 812-850 (amounts and saves) are not ported.
- `calc/models.py:924-974` -- `compute`. Order: `check_school`, the manasikhat refusal, `clear`, `get_quotes`, the `maternal` count (zeroed by a descendant or the father), `check_family`, `distribute`, `proof.build`. `live_counts` is keyed by class name.
- `calc/models.py:1012-1060` -- `set_quote`, `exact_quote`, `set_basis` (`fraction` only for `FRACTION_RULES`).
- `calc/models.py:1061-1915` -- the 23 `get_quote` methods. Mother's `spouse_and_father` branch (`:1097-1105`) is the only reader of the deceased's sex. Port it with the deceased taken as male if a wife is present.
- `calc/schools.py` -- the divergence functions, `check_school` and `check_family` (`is_malikiyya_family`). Read-only reference.
- `calc/proof.py:16-70,169-262` -- the codes, `VERSES`, `RELATIONSHIPS`, `build` and `build_table`. Port them without `LABELS` or gettext.
- `api/heir_rules.py:17-25,73-82` -- `SECOND_OF`, `MAX_WIVES` and `is_impossible_family`. Port it gender-free: both spouses count as impossible.
- `api/preview.py:57-60,189-199` -- the preview checks `invalid_family` before any engine refusal.
- `engine/contracts/{family,result,errors,values,preset,codes}.py` -- the 8.1 types to build on:
  - `Family.root` is not a person and has no gender.
  - `estates[0].heirs` holds `LayerHeir(person, relationship)`.
  - `Result` / `Allocation` / `Stage` / `Step` / `Param`.
  - `parse_preset` (contract) raises `ContractError`.
- `contracts/fixtures/result/*.json` -- the step param names: int steps use `base`, `unallocated` uses `rest`. Citation keys are `quran_4_11`, `quran_4_12` and `quran_4_176`.
- `calc/tests.py:1538-1556,1568-1649,1804-1842,1915-1983,1995-2060,2078-2085` -- the corpus:
  - `HEIR_SEX` and `build_case`;
  - `FIXTURES` (Hanbali), `families()`, the core-family product, `SCHOOL_FIXTURES` and `MUADDA_FIXTURES`;
  - the `(sex, [types])` literals in `ProofMatrixTests` (`:2366`), `ProofGrandfatherOptionTests`, `ScholarsTableTests` (`:2749`) and `MuaddaTests`.
  Import only constants and functions from `calc.tests`. Never import a TestCase class, or it is discovered twice.

## Tasks & Acceptance

**Execution:**
- `engine/rule_set.py` -- Add the following:
  - `RuleSet` (frozen): `school`, `rules` (read-only mapping), `settings` (read-only mapping), `preset_id|None`, `preset_version|None`, `default_currency|None`.
  - `RULE_SCHEMA`:
    - `grandfather_with_siblings`: `blocks` or `shares`;
    - `mushtaraka`: bool;
    - `father_blocks_his_mother`: bool;
    - `malikiyya_disputed`: bool;
    - `radd_position`: `radd` or `radd_later_scholars`.
  - `SETTING_SCHEMA`, empty.
  - `school_rule_set(school)`, built-in for the 5 schools and equal to `calc/schools.py`. An unknown school raises `invalid_contract`.
  - `parse_preset(data)`, in three steps:
    1. Parse with the contract parser.
    2. Reject unknown rule or setting keys and wrong value types with `invalid_contract`.
    3. Overlay the preset rules on `school_rule_set(default_school).rules`.
  - Rationale: AD-17, where a School is a built-in rule set, and parse_preset applies defaults.
- `engine/proof.py` -- The pure port of the `calc/proof.py` codes, `VERSES`, `RELATIONSHIPS`, `build` and `build_table`. No labels.
- `engine/single.py` -- Single-estate classification and `distribute`, ported over an in-memory heir (`id`, relationship kind, flags, exact quote, basis) and a case holding the heirs, the rule set and `maternal_quote`.
  - It returns the final fractions by id, the heirs in classification order with blocked flags and basis, the table dict and the steps dict.
  - School decisions read `rule_set.rules`. The `_tag_school_rules` codes come from the same rules: blocks gives `grandfather_blocks_siblings`, shares gives `grandfather_shares_with_siblings`; `mushtaraka` true or false gives `mushtaraka` or `no_mushtaraka`; and so on.
- `engine/core.py` -- Add `evaluate(family, rule_set) -> Evaluation(result, proof, table)`, `calculate(family, rule_set) = evaluate(...).result`, and `thaw()`.
  - Refusal order: `invalid_family` (checked on every estate), `school_not_supported` (school jafari), `manasikhat_unsupported` (more than one estate), then `malikiyya_disputed` (after classification, as `check_family`).
  - Build the Result per Design Notes. The heir order follows `estates[0].heirs`.
- `engine/__init__.py` -- Re-export `calculate`, `evaluate`, `thaw`, `RuleSet`, `school_rule_set` and `parse_preset`. Keep the contracts import path working.
- `engine/tests/test_core.py` -- Pure unittest with no Django. Tests:
  - every I/O-matrix row;
  - the `FIXTURES` answers rebuilt as Families (a local relationship-list helper);
  - parse/dump round-trip of every calculated and refused Result;
  - the same answer per person when the heir order is reversed;
  - mutating a RuleSet, a Result or the evidence raises.
- `calc/test_engine_parity.py` -- A Django `TransactionTestCase` harness. Mark the big sweeps `@tag('slow')`, as in `calc/tests.py`. For every corpus family under every School it applies to (the sweeps use all 4 Sunni schools and Ja'fari):
  1. Build the rows with `build_case`, and the Family with ids `h0..hn` in the same order.
  2. If `heir_rules.is_impossible_family(gender, counts)`, require `invalid_family`.
  3. Otherwise run `compute(madhab=…)`. Then require an equal refusal reason, or else:
     - equal final fractions per id;
     - the stored `blocked` equals `kind == 'blocked'`;
     - `thaw(proof)` equals `calc.proof` and `thaw(table)` equals `calc.table`, with pks mapped to ids;
     - `result.unallocated == 1 - sum`.
  - It also asserts that each built-in rule set matches the `calc.schools` functions.

**Acceptance Criteria:**
- Given the full corpus listed in the Code Map under all five Schools, when `calc/test_engine_parity.py` runs, then every family gives the same refusal reason or the same fractions, blocked statuses, proof (including `school_rules` and steps) and scholars' table as `Calculation.compute`, with pks mapped to ids.
- Given any calculated Result from the engine tests, when it is dumped and re-parsed with `engine.contracts.parse_result`, then it is equal. The engine never emits a Result that its own contract rejects.
- Given the repository after this story, when `git diff 97d16a7 --stat` is inspected, then only `engine/**` and `calc/test_engine_parity.py` (plus this spec) have changed, and `makemigrations --check --dry-run` reports no changes.

## Spec Change Log

## Review Triage Log

### 2026-11-16 — Review pass
- verdicts: 34 findings — high 0, medium 9, low 8, false 16, maybe-false 1
- findings:
  - `[false]` `[reject]` (intent) Parity runs only in Django and the sweeps are tagged `slow`. CI runs `manage.py test` with no labels and no tag exclusion (`.github/workflows/django.yml:123`).
  - `[medium]` `[patch]` (intent) The corpus reach is only loosely guarded. Grouped with the verification-gap corpus row; the literal count is now pinned.
  - `[medium]` `[defer]` (intent) A wrong-sex spouse is never compared. Family v1 has no root gender, so the gap predates this story; deferred, and the engine output is now pinned.
  - `[medium]` `[patch]` (intent) Result step values are not compared. Grouped with the verification-gap step row and patched.
  - `[false]` `[reject]` (intent) Hard-coded school mappings. `RuleSetParityTests` ties each built-in rule set to the `calc.schools` functions.
  - `[false]` `[reject]` (intent) The unknown-School error wording. A typed `ContractError` is exactly what the AC and the matrix ask for.
  - `[false]` `[reject]` (intent) "No other changes" and `makemigrations` are not tested. Both were verified by command and by `git status`.
  - `[medium]` `[defer]` (blind) A wrong-sex spouse is not refused. Same group as the intent row.
  - `[low]` `[patch]` (blind) The wrong-sex branch asserts tautologies. The redundant assertion was dropped, and the engine's `calculated` output is now asserted.
  - `[false]` `[reject]` (blind) Unknown relationships crash. `parse_family` admits only the 23 contract codes, all handled, and `api/test_contract_codes.py` ties them to the source.
  - `[maybe-false]` `[defer]` (blind) Gifts, bequests and answers are silently ignored. No producer emits them yet; deferred as medium (unverified).
  - `[false]` `[reject]` (blind) The `slow` tag hides coverage. Same refutation as the first intent row.
  - `[medium]` `[patch]` (blind) Corpus discovery uses magic numbers and is fragile. Grouped with the corpus row.
  - `[false]` `[reject]` (blind) The duplicated constants have no drift guard. The parity proof comparison checks `relationship` and `verse` for every heir type, so any drift fails.
  - `[low]` `[patch]` (blind) `test_only_jafari_is_refused_by_name` is misnamed. Renamed to `test_jafari_rules_equal_the_hanbali_defaults`.
  - `[false]` `[reject]` (blind) The core reads the school name for Ja'fari. The spec explicitly allows that one exception.
  - `[false]` `[reject]` (blind) Every int step uses a `base` param, and the radd_calc/union stages are missing. This follows the 8.1 fixture convention, and proof v1 steps carry no radd_calc/union either.
  - `[low]` `[reject]` (blind) The frozen types cannot be hashed. No caller hashes them, and a fix adds a custom `__hash__`.
  - `[false]` `[reject]` (blind) The stdlib-only rule is not enforced. The 8.1 AST purity test scans `engine/**` and passes.
  - `[low]` `[reject]` (blind) `TransactionTestCase` is slow. It matches the existing corpus tests' convention, and the run takes about 4.5 minutes.
  - `[false]` `[reject]` (blind) Mutable heir state could make reuse non-deterministic. `solve` builds a fresh `Case` each call, and nothing reuses one.
  - `[low]` `[patch]` (edge) A non-RuleSet raises `TypeError`. It now raises `ContractError('invalid_contract')`, as the spec requires.
  - `[false]` `[reject]` (edge) A non-Family argument or empty estates. `parse_family` guarantees `estates[0]`; a wrong argument type is a loud programmer error.
  - `[medium]` `[defer]` (edge) The wrong-sex spouse. Same group as the intent row.
  - `[low]` `[reject]` (edge) RuleSet hashing. Same as the blind row.
  - `[false]` `[reject]` (edge) RuleSet with non-mapping rules raises `TypeError`. This is a loud failure on a programmer error and is not reachable from parse.
  - `[false]` `[reject]` (edge) Calling `solve` directly with an unknown relationship. It is internal, and `evaluate` only passes parsed codes.
  - `[false]` `[reject]` (edge) Duplicate ids in `solve`. `parse_family` rejects duplicate person and heir ids (`engine/contracts/family.py:111,156`).
  - `[false]` `[reject]` (edge) No-heirs Result steps differ from the proof. The spec matrix sets `[base 0]` deliberately.
  - `[medium]` `[patch]` (verification-gap) Step param values are unchecked. Parity now compares every step value and the `rest` fraction with `calc.proof['steps']`.
  - `[medium]` `[patch]` (verification-gap) Allocation fields are unchecked. Parity now asserts rule, condition, blocked_by, school_rule, option, `kind == KINDS[rule]`, citations and stage per heir.
  - `[medium]` `[patch]` (verification-gap) The corpus guard is weak. `LITERAL_COUNT = 25` is pinned, each contributing class must give at least one family, and `ProofGrandfatherOptionTests` is pinned at 0.
  - `[low]` `[patch]` (verification-gap, other) The wrong-sex output is not pinned. Same patch as the blind tautology row.
  - `[low]` `[reject]` (verification-gap, other) The overlay of the other preset rules is untested. The overlay mechanism is tested once, and each rule key is exercised through the built-in Schools.

## Design Notes

**Result mapping.**
- Allocation `kind` comes from the proof rule:
  - fixed, mushtaraka and akdariyya give `fixed`;
  - residuary, fixed_and_residuary and grandfather_best_option give `residue`;
  - blocked gives `blocked`.
- `citations` is `[quran_4_11]` etc. from the proof `verse`, or `[]`.
- `stage` is null for blocked heirs and when `base == 0`. Otherwise it is the last integer step the proof lists (correction, then radd, then awl, then base), for example `{step:"correction", base:48}`. The contract's integrality check is the guard: a failure there is a port bug, not a reason to drop the stage.
- `steps`: each proof int step becomes `{step, params:{base:{type:int,value}}}`. `unallocated` becomes `{rest:{type:fraction}}`.
- `Result.unallocated` is `1 - sum(shares)`. It is `Fraction(0)` when the whole estate is shared.
- `school` is `rule_set.school`. `layers` is `()`.

**Deceased gender.** Family v1 has no gender for the root. Its only fiqh use is Mother's `spouse_and_father` branch, where a spouse is present, so the deceased is male if and only if a wife is present. That makes the impossibility check gender-free: a husband together with a wife is `invalid_family`. A spouse of the wrong gender for the deceased cannot be detected from Family v1. The shell keeps that check until a Family version carries the root's gender.

**Evidence.** The proof keeps its v1 shape, with person ids for `heir` and `madhab` set to the school. It sits outside Result v1 (no version bump), and presentation consumes it in 8.6.

## Verification

**Commands:**
- `uv run python manage.py test engine --noinput` -- expected: all pass, including the 8.1 purity scan.
- `uv run python manage.py test calc.test_engine_parity --noinput` -- expected: all pass, with zero mismatches.
- `uv run python manage.py makemigrations --check --dry-run` -- expected: No changes detected.

## Auto Run Result

Status: done

**Summary:** This story adds the AD-15 pure single-estate core. The School fiqh of `calc/models.py`, `calc/schools.py` and `calc/proof.py` now runs in memory over a Family (8.1 contract) keyed by stable person ids:
- `engine.calculate` returns the contract Result.
- `engine.evaluate` also returns the deep-frozen proof and scholars' table.
- `engine.school_rule_set` gives the built-in rule sets, and `engine.parse_preset` turns preset data into a RuleSet.
- School positions are rule values (AD-17).
- The refusals are `invalid_family`, `school_not_supported`, `manasikhat_unsupported` and `malikiyya_disputed`, in that order.
- No consumer was switched and no existing module was edited.

**Files:**
- `engine/rule_set.py`: `RuleSet`, `RULE_SCHEMA`, the built-in School rule sets and `parse_preset`.
- `engine/proof.py`: the label-free port of proof `build` and `build_table`, with the citation keys.
- `engine/single.py`: the in-memory classification and `distribute`, ported branch for branch.
- `engine/core.py`: `evaluate`, `calculate`, `thaw`, the refusal order and the Result mapping.
- `engine/__init__.py`: re-exports.
- `engine/tests/test_core.py`: 38 pure tests (the I/O matrix, the FIXTURES answers, contract round-trip, entry order, immutability, presets).
- `calc/test_engine_parity.py`: the Django parity harness over the whole corpus under all five Schools.

**Review:** 34 findings.
- Patched (6 groups):
  - parity now compares step values;
  - parity now compares every allocation field (kind, rule, condition, blocked_by, school_rule, option, citations, stage);
  - the corpus count is pinned per class;
  - the wrong-sex branch now pins the engine's output;
  - a test rename;
  - `ContractError` for a non-RuleSet.
  At entry verdict that is 3 medium groups (9 medium rows) and 3 low.
- Deferred (2): the wrong-sex spouse that Family v1 cannot express, and gifts/bequests ignored before any producer exists.
- Rejected: 16 false and 5 low, each with its reason in the Review Triage Log.

**Follow-up review recommended: true.** Three medium groups were patched, all in the parity harness. The new allocation-field and step-value assertions pass on the whole corpus, but they were added after review. A second pass should confirm they compare what they claim to compare: that `stage` is derived from the proof the same way the engine does it, and that the pinned `LITERAL_COUNT = 25` matches the classes the spec names. Patched counts: high 0, medium 3 groups, low 3.

**Verification:**
- `uv run python manage.py test engine --noinput`: 38 OK (includes the 8.1 purity scan).
- `uv run python manage.py test calc.test_engine_parity --noinput`: 7 OK in 268 s, including the slow sweeps, after the patches.
- `makemigrations --check --dry-run`: No changes detected.
- Every I/O-matrix row has a passing test in `engine/tests/test_core.py`.
- The full ~45-minute calc+api suite was not run. No existing module changed, and the driver runs the batch suite.

**Residual risks:**
- The cap on the full siblings' share in the grandfather branch is not exercised by any corpus family. A mutation there went undetected.
- The spec's matrix example "Step `radd`" is in fact `base`, `radd`, `correction`, and the engine matches Django on that.
- The 8.1 example preset `zz-2026-01-01` is rejected by `engine.parse_preset` because its settings are not yet in `SETTING_SCHEMA`.
- The proof and table evidence sit outside Result v1 until a contract version carries them.
