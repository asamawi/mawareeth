---
title: 'Mu''adda: label paternal siblings blocked beside a grandfather'
type: 'feature'
created: '2026-11-09'
status: 'done'
baseline_commit: '4b44385d62e79094b8dae9aa9af71768b6c8b423'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Under Maliki, Shafi'i and Hanbali, a grandfather shares with the siblings. Paternal siblings are counted against him (mu'adda) and then get nothing when a full brother is present, or when full sisters are residuary with a daughter or son's daughter and take the whole siblings' pool. The engine already gives them zero, but only as a side effect of its arithmetic. The hajb labels never mark paternal siblings blocked while a grandfather is present (`api/heir_rules.py:139-151`), so the add form offers them as heirs who will inherit.

**Approach:** Follow the owner's ruling of 2026-11-09. Give the engine one named predicate for this mu'adda exclusion, have `distribute` use it in place of the implicit arithmetic (the fractions do not change), and have the pure hajb rules label `paternal_brother` and `paternal_sister` blocked under the same two conditions. The test that holds the labels to the engine treats "excluded by the mu'adda" as blocked.

## Boundaries & Constraints

**Always:**
- Paternal siblings stay live in the engine (`blocked=False`). They must still count in the grandfather's muqasama, so the grandfather's share is unchanged.
- Every engine fraction and every proof output stays as it is today for every family. This is a labelling and naming change, not a fiqh change.
- Only Maliki, Shafi'i and Hanbali are affected. Under Hanafi the grandfather already blocks all siblings, and Jafari or an unknown school labels nothing.
- The Ashariyya (grandfather, one full sister, a paternal brother, no female descendant) still gives the paternal brother a share, and he is not labelled blocked.

**Ask First:**
- Any change to an engine fraction, to the proof codes or conditions, or to the preview's per-share `blocked` flag.
- Labelling any other family where paternal siblings happen to get zero, for example two full sisters whose 2/3 uses up the pool when there is no female descendant.

**Never:**
- Do not set `blocked=True` on paternal siblings in `get_quote`.
- Do not change the full siblings' own labels, the grandfather's options, or the akdariyya.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Full brother | Hanbali/Maliki/Shafi'i, family {grandfather, brother} | `paternal_brother` and `paternal_sister` are in `blocked` | N/A |
| Sister with daughter | same schools, {daughter, grandfather, sister} | both paternal siblings are blocked. The engine computes daughter 1/2, grandfather 1/4, sister 1/4, paternal sister 0 | N/A |
| Son's daughter | same schools, {daughter_of_son, grandfather, sister, sister} | both paternal siblings are blocked | N/A |
| Ashariyya | Hanbali, {grandfather, sister} | `paternal_brother` is not blocked. The engine computes grandfather 2/5, sister 1/2, paternal brother 1/10 | N/A |
| Sisters, no daughter | Hanbali, {grandfather, sister} | `paternal_sister` is not blocked (unchanged) | N/A |
| Hanafi | {grandfather} | unchanged: all siblings are blocked by the grandfather | N/A |

</frozen-after-approval>

## Code Map

- `calc/models.py:550-554` -- `gf_shares_with_siblings`. Add a sibling method next to it, e.g. `paternal_siblings_counted_out()`: `gf_shares_with_siblings()` and any paternal sibling and (`has_brother()` or (`has_sister()` and `has_female_descendent()`)). Reuse the existing `has_*` helpers.
- `calc/models.py:647-660` -- the full/paternal pool split. Add an explicit branch so that when the predicate holds, `full_total = pool`. This is already the arithmetic result: with a male full sibling the existing branch gives `pool`, and with a female descendant `pool <= 1/2 <= cap`. Keep the reason and basis assignment at `:669-676` as it is, including `estate_exhausted` when `pool == 0`.
- `api/heir_rules.py:140-151` -- in the `paternal_brother` and `paternal_sister` branches, after `siblings_blocked` and when the grandfather is present, return `bool(c['brother'] or (c['sister'] and c['female_desc']))` in place of `False`. Update the module docstring's sentence about mirroring `blocked` flags, so it also names the mu'adda exclusion.
- `api/tests.py:1646-1670` -- `engine_blocked`: return `heir.blocked or (candidate in ('paternal_brother', 'paternal_sister') and calc.paternal_siblings_counted_out())`, evaluated after `get_quotes`. `:1700-1728`: add directed families from the matrix. `:1730`: add documented cases for the matrix rows.
- `calc/tests.py` -- engine tests for the matrix rows' fractions and for the predicate (true and false cases, Hanafi false).
- `api/contracts/heir-options-fixtures.json` -- add "grandfather and full brother under Hanbali" and "daughter, grandfather and sister under Maliki". Generate their `heir_options` from `anonymous_case.heir_options`. `web/src/interview/answers.test.ts:478` reads the same file.
- `_bmad-output/implementation-artifacts/deferred-work.md:423` -- add `resolved_by` for this item. `:393` (the 1.6 mu'adda question) is answered by the same ruling.

## Tasks & Acceptance

**Execution:**
- [x] `calc/models.py` -- add the predicate and use it in `distribute` -- this names the mu'adda exclusion in the engine, which stays the authority.
- [x] `api/heir_rules.py` -- label paternal siblings by the same two conditions and update the docstring -- the add form follows the engine.
- [x] `calc/tests.py` -- add engine tests for the matrix fractions and the predicate -- this proves the fractions are unchanged.
- [x] `api/tests.py` -- extend the oracle, the directed families and the documented cases -- this holds the labels to the engine.
- [x] `api/contracts/heir-options-fixtures.json` -- add the two families -- web and API share one truth.
- [x] `deferred-work.md` -- mark `:423` and `:393` resolved.

**Acceptance Criteria:**
- Given the existing engine test suites, when they run after the change, then every fraction and proof fixture passes unchanged.
- Given any family in the seeded and directed `HeirRulesTests`, when the labels are compared with the extended engine oracle, then they agree under all four Sunni schools.

## Verification

**Commands:**
- `python manage.py test calc api` -- expected: all pass.
- `cd web && npm test` -- expected: all pass (shared fixtures).

## Suggested Review Order

**Engine: the mu'adda exclusion gets a name**

- Entry point: one named predicate for "counted against the grandfather, then nothing".
  [`models.py:556`](../../calc/models.py#L556)

- Explicit branch; same pool split the arithmetic already produced, so no fraction changes.
  [`models.py:665`](../../calc/models.py#L665)

**Hajb labels follow the engine**

- Pure-rules twin of the engine predicate, on plain counts.
  [`heir_rules.py:106`](../../api/heir_rules.py#L106)

- Paternal brother and sister beside a sharing grandfather now use it.
  [`heir_rules.py:152`](../../api/heir_rules.py#L152)

**Tests and fixtures**

- Oracle counts the mu'adda exclusion as blocked; engine flag stays false.
  [`tests.py:1669`](../../api/tests.py#L1669)

- Matrix rows and the Ashariyya as documented cases under three schools.
  [`tests.py:1743`](../../api/tests.py#L1743)

- New directed families compared with the engine under all four schools.
  [`tests.py:1717`](../../api/tests.py#L1717)

- Engine fractions pinned per matrix row; predicate true, heir still live.
  [`tests.py:1954`](../../calc/tests.py#L1954)

- Ashariyya keeps the paternal brother's 1/10.
  [`tests.py:1976`](../../calc/tests.py#L1976)

- Two shared families the web suite reads too.
  [`heir-options-fixtures.json:523`](../../api/contracts/heir-options-fixtures.json#L523)
