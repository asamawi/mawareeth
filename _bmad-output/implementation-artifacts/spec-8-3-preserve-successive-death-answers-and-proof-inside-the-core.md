---
title: 'Story 8.3: Preserve successive-death answers and proof inside the core'
type: 'feature'
created: '2026-11-17'
status: 'done'
baseline_revision: '26a540a3b64a00d74e3187f0f747b42bd1b0a7c8'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-8-2-reproduce-existing-single-estate-school-answers-in-memory.md'
warnings: [oversized]
deferred:
  - summary: >-
      The engine accepts a person whose estate relationship contradicts their own gender (a female person entered as `father`) and calculates it.
    evidence: |-
      engine/contracts/family.py parse_family never cross-checks Person.gender against a heir relationship, in the root estate (already true in 8.2) or a later one. Django's manasikhat refuses linked rows whose sex differs, but a Family carries one gender per person, so the mismatch moves to the relationship. Settle by adding a relationship-gender check to the Family contract (version bump) or to the engine refusal order, or keep it in the 8.4 query/command boundary.
    location: >-
      engine/core.py evaluate; engine/contracts/family.py parse_family
    severity: medium
---

<intent-contract>

## Intent

**Problem:** The engine from 8.2 refuses every Family with more than one estate (`manasikhat_unsupported`). Successive deaths still need the database: `calc/manasikhat.py` (`compute_manasikhat`) and the layered proof and table builders in `calc/proof.py`. So the pure core does not yet cover the later-death corpus.

**Approach:** Compose successive deaths inside `engine/`. Each estate is solved with the 8.2 single-estate solver. The estate of a person who died later is that person's running exact total, carried into their layer. The core returns:
- a Result with the root estate at the top level and one `layers` entry per later death;
- the deep-frozen layered proof (v2) and the layered scholars' table.

A pure helper recomposes the combined final fractions from any Result. The Django parity harness is extended to require identical answers for the `ManasikhatTests` / `LayeredTableTests` families against `compute_manasikhat`. No consumer switches.

## Boundaries & Constraints

**Always:**
- `engine/` stays stdlib-only and pure. There is no logging: the layered table builder returns None where Django logs and returns None. The 8.1 AST purity test must keep passing.
- Port `compute_manasikhat`, `build_layered` and `build_layered_table` faithfully:
  - the same exact Fraction arithmetic;
  - the same combination order by death order;
  - the same `relation` / `jamia` / multiplier / `unallocated` arithmetic;
  - the same fail-closed checks (a failed check gives a table of None, never an exception).
- Person ids are the stable identities. A Family needs no row-to-person link: the same id in two estates is the same person.
- Refusal order:
  1. `invalid_family`: any estate impossible by the 8.2 gender-free check, or a later estate whose spouse heir contradicts that deceased person's own `gender` (a husband of a male, a wife of a female). This is the same check `api/preview.py:_single` applies to deaths.
  2. `school_not_supported` (jafari).
  3. `manasikhat_unsupported`: a later estate's deceased is not an heir of some estate of lower order.
  4. Per-estate solver refusals (`malikiyya_disputed`) in death order. Any one of them refuses the whole Result, with no layers or partial shares.
- A single-estate Family gives exactly the 8.2 output (same Result, proof v1 and table). All 8.2 parity sweeps keep passing unchanged.
- Result values and evidence are frozen, as in 8.2.

**Never:**
- No changes to `calc/`, `api/`, `reports/`, `web/`, `contracts/` fixtures or migrations, except `calc/test_engine_parity.py`. `engine/contracts/` is unchanged, so there is no contract version bump.
- Never edit an existing fixture or expected value to hide a difference. A mismatch is an engine port bug.
- No fiqh corrections. Keep the three-death limit from the Family contract (orders 1-3). The 50-heir / two-later-death product limits and the preview's "ready" check (`_ready`: every later death has heirs) stay in the shell.
- No new dependencies. No consumer calls the engine.

## I/O & Edge-Case Matrix

Ids below follow `ManasikhatTests.fixture`: root heirs W (wife), S1 and S2 (sons). S1 dies second, with heirs W (mother) and S2 (brother). With `third`, W dies third, with heirs S2 (son) and N (her mother, a new person). Every calculated row also round-trips through `dump_result` / `parse_result` unchanged.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Two deaths | fixture, any Sunni School | calculated. Top-level allocations are the root estate: W 1/8, S1 7/16, S2 7/16. One layer: order 2, deceased S1, `inherited` 7/16. Combined final: W 13/48, S2 35/48. Proof v2 `base` 48 and `layers[1].estate` 7/16 | — |
| Three deaths | fixture with `third` | combined final: S2 275/288, N 13/288. Proof `base` 288. Layers 2 and 3 | — |
| Entry order | the fixture with root heirs entered S1, S2, W | the same combined final and the same layer `inherited` per person id | — |
| Sibling layers | `test_sibling_layers` | W 37/72, uncle 35/72. Proof `base` 72 | — |
| School difference | `test_school_difference` | hanbali: husband 9/16, paternal grandmother 1/16, S2 3/8. Other Sunni Schools: 5/8, 0, 3/8. The layer proof `school_rules` as in Django | — |
| Zero inherited | father + brother; the brother dies, leaving a son | final father 1, son 0. Layer `inherited` 0. Table relation `no_share` | — |
| Blocked, then heir | father + brother; the father dies, leaving a son and the brother | final brother 1 | — |
| Empty later estate | a later estate with no heirs | calculated. That layer has no allocations and `unallocated` 1. The inherited share is in no person's final fraction | — |
| Malikiyya in layer | `test_refusal_rolls_back_earlier_layer` under maliki | refused `malikiyya_disputed`, with no layers | — |
| Ja'fari | any layered family, jafari | refused `school_not_supported` | — |
| Unlinked death | a later deceased who is not an heir of any earlier estate | refused `manasikhat_unsupported` | — |
| Wrong-sex spouse in layer | a male later deceased with a husband heir | refused `invalid_family` | — |

</intent-contract>

## Code Map

- `calc/manasikhat.py:10-113` -- `compute_manasikhat`. These are the topology checks, the per-layer `compute`, `totals` (where `estate = totals.pop(identity of the deceased)`), `entries` (`order`, `deceased` = Deceased pk, `heir`, `estate`, `proof`), `final = dict(sorted(totals))`, then `build_layered_table` and `build_layered`. Read-only reference.
- `calc/proof.py:265-358` -- `build_layered` (version 2, `people` row-to-person pairs where row != person, `madhab`, `layers` with `estate` as a fraction body, `final`, `base` = the lcm of the final denominators) and `build_layered_table` (fail-closed, combining tables per layer). Port without `logging`.
- `calc/tests.py:3261-3600` -- the layered corpus: `build_layer`, `ManasikhatTests` (`fixture(third, reverse)`, sibling layers, school difference, malikiyya refusal, zero inherited, unallocated conservation) and `LayeredTableTests` (hand-built tables for the defect cases, the relations, the merged parts and the carried unallocated parts). Import only `build_case` / `build_layer` / constants, never a TestCase class.
- `api/preview.py:139-199` -- how the shell checks layer impossibility with the deceased's gender (`heir_rules.is_impossible_family`) and relabels evidence. Read-only.
- `engine/core.py:94-138` -- `evaluate`, which refuses with `manasikhat_unsupported` when there is more than one estate (replace this) and maps one estate to Result fields. Factor the per-estate mapping (allocations, stage, steps, unallocated, proof v1, table) into a helper reused for every estate.
- `engine/single.py:802-814` -- `solve(entries, rules)` returns `Solved(heirs, final, table, steps)` or raises `Refused`. Reuse it as-is.
- `engine/proof.py` -- the 8.2 `build` / `build_table`. Add the layered builders here.
- `engine/contracts/result.py:45-64,128-164` -- `Layer(order, deceased, inherited, allocations, steps, unallocated)`. The parse rules: layer orders are unique and ascending (2-3), and every level sums to 1.
- `engine/contracts/family.py:106-194` -- parse already guarantees the following, so the engine need not re-check them:
  - orders 1..3 without gaps, and estate 1 belongs to the root;
  - a later deceased is `died_later` with a matching order;
  - heirs are alive at their estate, are unique per estate and are not the deceased;
  - every `died_later` person has an estate.
- `engine/tests/test_core.py:178-181` -- `test_later_deaths_are_refused`. Its `manasikhat_unsupported` expectation is now wrong by design. Replace it with the new behaviour; `later_deaths_document` is the helper.
- `calc/test_engine_parity.py` -- `ParityMixin`, `map_ids` and `build_family`. Extend this module.

## Tasks & Acceptance

**Execution:**
- `engine/proof.py` -- Add these two functions:
  - `build_layered(school, entries, final)` ports `calc.proof.build_layered`. `people` is always `[]`, because every row is a person. `madhab` is the school.
  - `build_layered_table(entries, tables, final, people)` ports `calc.proof.build_layered_table`. Use the identity mapping over person ids in first-appearance order: estates in order, then heirs in entry order. It returns None on any failed check and never logs.
- `engine/core.py` -- Implement the composition in `evaluate`, with the refusal order given in Boundaries:
  - Each entry is `{order, deceased: estate.deceased, heir: None or the later deceased id, estate: Fraction, proof: the layer's proof v1}`.
  - Running totals are kept in first-appearance order. `final` is in the same order.
  - A layered Result:
    - the top level is the root estate, mapped as in 8.2;
    - `layers` holds `Layer(order, deceased, inherited=estate, ...)` per later estate, mapped the same way;
    - the evidence is `freeze(build_layered(...))` and `freeze(build_layered_table(...))`.
  - Add `final_shares(result) -> dict` (re-exported from `engine`). It recomposes the combined exact fractions from a calculated Result: root allocations ×1, then each layer in order pops its deceased's total, requires it to equal `inherited` (else `ContractError('invalid_contract')`), and adds share × inherited. It returns None for a refused Result.
- `engine/__init__.py` -- Re-export `final_shares`.
- `engine/tests/test_core.py` -- Replace `test_later_deaths_are_refused` with tests of every I/O-matrix row, built as Families. Also test:
  - `final_shares` equals the proof v2 `final`;
  - parse/dump round-trip of every layered Result, with `final_shares` unchanged after it;
  - a repeated evaluate gives an equal Result and evidence;
  - the `LayeredTableTests` table cases fed to `engine.proof.build_layered_table` give the same relations, `jamia`, merged parts, carried `unallocated` and None for each defect.
- `calc/test_engine_parity.py` -- Add a `LayeredParityTests(TransactionTestCase)`:
  - It covers every `ManasikhatTests` family (the fixture with and without `third` and in both entry orders, sibling layers, school difference, malikiyya, zero inherited, unallocated conservation, blocked then heir) plus an empty later estate.
  - Each family runs under all five Schools.
  - The DB side is built with `build_case` / `build_layer`, layers created in death order. The Family has one id per person, and a linked row maps to its earliest row's id.
  - Require each of the following:
    - an equal refusal reason; for the wrong-sex rows, `heir_rules.is_impossible_family` with the layer's deceased gender gives `invalid_family`;
    - equal combined final fractions per id;
    - `final_shares(result)` equals the Django final;
    - `thaw(proof)` equals the Django evidence, with every pk mapped to its person id, Deceased pks mapped to the estate's deceased id, and `people` reduced to the pairs where row != person after mapping (expect `[]`);
    - `thaw(table)` equals the mapped `calc.table`;
    - each layer's `inherited` equals the Django entry `estate`;
    - each layer's allocation shares equal the Django layer proof's shares.

**Acceptance Criteria:**
- Given the `ManasikhatTests` and `LayeredTableTests` corpus under all five Schools, when `calc/test_engine_parity.py` runs, then every layered family gives the same refusal reason, or else the same combined fractions, death-order layers, layered proof and layered scholars' table as `compute_manasikhat`, with pks mapped to person ids.
- Given a layered calculated Result from the engine tests, when it is dumped, re-parsed and passed to `final_shares`, then the Result is equal, and the stage bases, deceased ids, `inherited` multipliers and combined fractions are unchanged.
- Given a single-estate Family, when evaluated, then the Result, proof and table equal the 8.2 output, and the existing 8.2 parity tests pass unchanged.
- Given the repository after this story, when `git diff 26a540a --stat` is inspected, then only `engine/**` and `calc/test_engine_parity.py` (plus this spec) have changed, and `makemigrations --check --dry-run` reports no changes.

## Spec Change Log

## Review Triage Log

### 2026-11-17 — Review pass
- verdicts: 15 findings — high 0, medium 3, low 6, false 6, maybe-false 0
- findings:
  - `[false]` `[reject]` (intent) Multipliers and jami'a live in `Evaluation.table`, not in the round-tripped Result. The story's "multipliers" are the per-layer `inherited` fractions, which the Result carries and the round-trip test checks. Proof and table sit outside Result v1 by the 8.2 design.
  - `[false]` `[reject]` (intent) The existing topology cases (cycles, external links, duplicate orders, sex mismatch, a fourth death) are not replayed. A Family cannot express them: `parse_family` rejects them with `ContractError` (8.1 tests). The one expressible case, an unlinked death, is tested.
  - `[false]` `[reject]` (intent) Parity normalizes rows to person ids, so it does not test an adapter resolving raw links. Adapters are 8.7, and the story's last AC defers adapter and presentation parity.
  - `[false]` `[reject]` (intent) The empty later estate is calculated rather than shown as incomplete. Parity shows Django computes it identically. Readiness is the shell's `_ready`, which no consumer bypasses.
  - `[false]` `[reject]` (intent) No family-facing surface changes. This is explicitly deferred by the story.
  - `[medium]` `[defer]` (blind) A female person entered as `father` in a later estate is calculated. This predates the story (Family v1 has no relationship/gender check, true of the root estate in 8.2). Deferred.
  - `[low]` `[reject]` (blind) `final_shares` accepts a hand-made Result where a layer pays its own deceased or a dead person reappears. The engine never emits such a Result, and the fix adds guards to a helper over trusted output.
  - `[low]` `[reject]` (blind) `final_shares` accepts a lone layer of order 3. Same reasoning: unreachable from `evaluate`, and the fix adds guards.
  - `[low]` `[reject]` (blind) `build_layered_table` does not validate intermediate columns (an overallocated column is clamped by `max(0, ...)`). This is a faithful port of `calc/proof.py`, and its inputs come from the engine's own `build_table`.
  - `[medium]` `[patch]` (blind) No case has a later deceased who first appears in a non-root estate. Added such a case to `layered_cases` (engine and parity).
  - `[low]` `[patch]` (blind) No layered case with awl or a grandfather in a later estate. Added both cases to `layered_cases`.
  - `[medium]` `[patch]` (verification-gap) Layer steps are unchecked. Each layer's steps are now compared with the same estate evaluated alone.
  - `[medium]` `[defer]` (edge) Gender-incompatible relationship in a later estate. Same root cause and deferral as the blind row.
  - `[low]` `[reject]` (edge) Negative table parts pass when they agree with negative shares. Unreachable: the engine never produces negative shares. Faithful port.
  - `[low]` `[reject]` (edge) An overallocated earlier column is clamped. Same as the blind table row.

## Design Notes

**Result shape (no contract change).** Result v1 already carries `layers`. The top-level fields are the root estate (estate 1). `Layer.inherited` is the multiplier: the deceased person's exact running total of the root estate when they died. That total is popped from the running totals, as in `compute_manasikhat`. Combined final fractions are not a Result field. They are derivable, and `final_shares` derives them, so they survive a round-trip without a version bump.

**Golden example (two deaths).** The root estate gives W 1/8, S1 7/16, S2 7/16. Layer 2 (S1, `inherited` 7/16) gives W (mother) 1/3, S2 2/3. The running totals are W = 1/8 + 7/16·1/3 = 13/48 and S2 = 7/16 + 7/16·2/3 = 35/48. S1 is popped.

**Identity.** Django links rows with `same_person` and names a person after their earliest row. In a Family the person id is already that identity. The presentation boundary (8.6) keeps naming a person from their root-relative `relationship`/`name`. So the proof v2 `people` list is empty here, and parity checks that the mapped Django list collapses to nothing.

**Incomplete families.** The shell decides whether a layered case is "ready" (`api/preview.py:_ready`). The engine computes whatever valid Family it is given: an empty later estate is computed as Django computes it (unallocated), never as a partial completed answer to a different family.

## Verification

**Commands:**
- `uv run python manage.py test engine --noinput` -- expected: all pass, including the 8.1 purity scan.
- `uv run python manage.py test calc.test_engine_parity --noinput` -- expected: all pass, including the 8.2 sweeps and the new layered tests.
- `uv run python manage.py makemigrations --check --dry-run` -- expected: No changes detected.

## Auto Run Result

Status: done

**Summary:** The pure core now handles successive deaths (manasikhat).
- `engine.evaluate` solves each estate in death order with the 8.2 single-estate solver. It carries each later deceased's exact running total into their layer as `Layer.inherited`.
- It returns a Result with the root estate at the top level and one `layers` entry per later death. The deep-frozen evidence is the layered proof v2 and the layered scholars' table.
- `engine.final_shares(result)` recomposes the combined exact fractions from any calculated Result, so they survive a round-trip with no contract change.
- The refusal order is `invalid_family` (including a wrong-sex spouse of a later deceased), `school_not_supported`, then `manasikhat_unsupported` (a later deceased who is not an heir of an earlier estate), then per-estate refusals in death order.
- Single-estate output is unchanged, and no consumer was switched.

**Files:**
- `engine/core.py`: the per-estate mapping helper, layered composition in `evaluate`, and `final_shares`.
- `engine/proof.py`: pure ports of `build_layered` (with `people` always `[]`) and `build_layered_table` (fail-closed, no logging).
- `engine/__init__.py`: re-exports `final_shares`.
- `engine/tests/test_core.py`: the later-deaths test now expects a calculated Result; the refused round-trip uses jafari.
- `engine/tests/test_layered.py`: 16 layered Family cases (the I/O matrix plus a non-root later deceased, awl and grandfather/brother in a later estate), round-trip, determinism, per-layer steps against the estate alone, frozen evidence, and the `LayeredTableTests` table cases.
- `calc/test_engine_parity.py`: `LayeredParityTests` runs every layered case under all five Schools against `compute_manasikhat`. It compares final fractions, `final_shares`, the mapped proof and table, layer `inherited` values and layer shares.

**Review:** 15 findings.
- Patched (3), all tests: a later deceased first appearing in a non-root estate (medium); per-layer steps checked (medium); awl and grandfather cases in a later estate (low).
- Deferred (1, two rows): a relationship that contradicts the person's gender. This predates the story; see frontmatter `deferred`.
- Rejected: 6 false (intent-alignment divergences that the story's own deferrals or the Family contract settle) and 5 low (`final_shares` / `build_layered_table` guards against inputs the engine never produces, in faithful ports).

**Follow-up review recommended: true.** Two medium findings were patched, both as tests added after review. The new later-estate cases pass parity, but a second pass should confirm they compare what they claim to. In particular, check that the non-root-deceased case really links through estate 2 in the DB build, and that the standalone-estate step comparison uses the same heir order as the layer. Patched counts: high 0, medium 2, low 1.

**Verification:**
- `uv run python manage.py test engine --noinput`: 44 OK, including the purity scan.
- `uv run python manage.py test calc.test_engine_parity --noinput`: 8 OK in 521 s before the patch round. After the patches, which changed tests only, `LayeredParityTests` passed again: 1 OK over 16 cases × 5 Schools.
- `makemigrations --check --dry-run`: No changes detected.
- Every I/O-matrix row is covered by `engine/tests/test_layered.py` and ran.
- The full calc+api suite was not run; the driver runs it per batch.

**Residual risks:**
- A gender-inconsistent relationship in any estate is calculated (deferred).
- The proof v2 `people` list is always empty. Earliest-row naming moves to the presentation boundary (8.6), and the 8.7 adapters must map legacy rows to person ids.
- Django logs "Cannot build successive-death table" for an empty later estate. The engine returns `table` None silently, and a shell consumer must log it if it wants that signal.
