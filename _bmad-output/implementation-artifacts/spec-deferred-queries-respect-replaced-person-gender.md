---
title: 'Relationship queries do not offer a replaced person a relationship of the other gender'
type: 'bugfix'
created: '2026-11-20'
status: 'done'
baseline_revision: '1168a0c537fdc1b11cdb3ae85eb037444e0bd944'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** `engine/queries.py` `relationship_options` and `change_impossible` decide what an existing heir (`replacing`) may become from the estate's relationship counts only, so they offer a male person `daughter` (or a female person `son`), in any estate, although `engine/core.py` `evaluate` now refuses any person whose gender contradicts a relationship as `invalid_family` (deferred item from the Epic 8 retrospective, source spec 8.4).

**Approach:** When `replacing` is given, the queries hold that person's recorded `Person.gender` fixed: every relationship whose `kinship.RELATIONSHIP_GENDERS` gender differs is reported impossible with the existing code `gender_locked`, unless an estate-local rule already makes it impossible (that code wins). The add path (`replacing=None`) is unchanged.

## Boundaries & Constraints

**Always:** Reuse the code `gender_locked` (already a `relationship` field code in `api/contracts/interview.json` with ar/en/fr text in `web/src/i18n/messages.ts`); no new code, catalog key or text. Existing impossibility codes keep precedence for a relationship both rules forbid. A relationship marked `gender_locked` is not in `blocked` (the existing disjointness rule). The gender comes from the canonical `Person` with id `replacing` in `family.persons`. `change_impossible` gets the behavior through its delegation to `relationship_options`. Validation of `replacing` (must be a heir of the selected estate, else `ContractError('invalid_contract')`) is unchanged.

**Never:** Do not change `placement_options`, `deceased_gender_conflict`, `delete_impact` or `evaluate`. Do not add `gender_locked` to `kinship.RELATIONSHIP_CODES` (the API contract test treats it as a shell code). Do not change `api/` (its only caller, `api.heir_rules.blocked_relationships`, passes no `replacing`, so HTTP responses stay identical). Do not touch translations, `.po` files or `messages.ts`. Do not scan the person's other-estate roles beyond their gender (a `son` in estate 1 may still become `husband` in estate 2).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Add, no replacing | any family, `replacing=None` | identical `impossible` and `blocked` to today | No error expected |
| Replace male heir, estate 1 | male `son` `S` in estate 1, `replacing='S'` | `impossible['daughter'] == 'gender_locked'`, every female relationship likewise; `son`, `brother` etc. not marked for gender; `daughter` not in `blocked` | No error expected |
| Replace female heir | female `daughter` `D`, `replacing='D'` | `son`, `father`, `husband` … → `gender_locked` (unless an estate code applies) | No error expected |
| Precedence | male deceased in estate 1, replacing a female `wife` heir | `husband` stays `husband_of_male` (not `gender_locked`) | No error expected |
| Later estate, aliased person | `S` is `son` in estate 1 and `husband` in estate 2 (female deceased); `relationship_options(..., estate=2, replacing='S')` and `change_impossible(..., 'daughter', estate=2, replacing='S')` | `daughter` → `gender_locked`; `brother` (male) is not gender-locked | No error expected |
| Agreement with evaluate | for the aliased family, apply each relationship the query leaves possible in estate 2 to `S`'s estate-2 row | `evaluate` does not refuse with `invalid_family` for gender; each `gender_locked` one applied does give `invalid_family` | No error expected |
| Bad replacing | `replacing` not a heir of the selected estate, or the root | `ContractError('invalid_contract')` as today | raises |

</intent-contract>

## Code Map

- `engine/queries.py:61` `_counts(estate, replacing)` -- validates `replacing` and excludes its row from counts; keep as is.
- `engine/queries.py:71` `_options(rule_set, counts, deceased_gender, existing=None)` -- builds `impossible` per relationship via `kinship.kinship_code` plus the unspecified-deceased spouse conflict, then `blocked` minus impossible. Shared with `placement_options` (`:107`), so any new parameter must be optional and default to today's behavior.
- `engine/queries.py:88` `relationship_options(...)` -- resolve `replacing` to its `Person` (`family.persons`) and pass its gender into `_options`; add the `gender_locked` code only where no other code was set.
- `engine/queries.py:143` `change_impossible` -- delegates; no change expected.
- `engine/kinship.py:25` `RELATIONSHIP_GENDERS` -- single source of relationship gender; covers every `codes.RELATIONSHIPS` entry.
- `engine/core.py:108` `evaluate` -- the gender refusal from commit 1409487 the queries must now agree with (read-only).
- `engine/contracts/family.py:13,30,68` -- `Person(id, gender, …, relationship, status, death_order)`, `LayerHeir(person, relationship)`, `Estate(order, deceased, heirs)`, `Family`; parser requires `Person.relationship` to equal the estate-1 row. Use the parser / existing test builders in `engine/tests/test_queries.py` and `engine/tests/test_layered.py:140` to build multi-estate families.
- `api/heir_rules.py:26` `blocked_relationships` -- only production caller; passes no `replacing` (read-only; behavior must not change).
- `api/contracts/interview.json:31` -- lists `gender_locked` among `relationship` codes (read-only evidence that the code is part of the contract).

## Tasks & Acceptance

**Execution:**
- `engine/queries.py` -- add a module constant `GENDER_LOCKED = 'gender_locked'`; give `_options` an optional `person_gender=None` parameter that, after the existing code checks, marks each relationship with no code whose `kinship.RELATIONSHIP_GENDERS[relationship] != person_gender` as `GENDER_LOCKED`; in `relationship_options`, after `_counts` validates `replacing`, look up that person's gender and pass it -- makes the query agree with `evaluate`.
- `engine/tests/test_queries.py` -- add tests for every I/O matrix row, including the evaluate-agreement row (apply each candidate to a copy of the Family and call `evaluate`/`calculate` for one Sunni school), and assert `change_impossible` returns the same codes -- regression guard.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- remove the "`relationship_options` and `change_impossible` can offer a replacing person…" entry in "Epic 8 retrospective follow-ups"; add one entry (source_spec this spec) saying the case API's `edit_options` (`api/anonymous_case.py` root and later edit options) still computes options from counts without the edited person's identity, so a linked or died-before person's edit options list opposite-gender relationships that the write then rejects with `gender_locked` -- keeps the backlog accurate.

**Acceptance Criteria:**
- Given the existing engine and API test suites, when they run, then they pass unchanged (no existing assertion edited).
- Given `api.heir_rules.blocked_relationships` for any school and counts, when called, then its result is the same as before the change.

## Spec Change Log

## Review Triage Log

### 2026-11-20 — Review pass
- verdicts: 18 findings — high 0, medium 0, low 12, false 6, maybe-false 0
- findings:
  - `[false]` `[reject]` blind-hunter: cross-estate rule beyond gender has no disposition — `evaluate` performs no cross-estate role check other than gender (`engine/core.py:108-140`), so there is nothing else for the queries to agree with.
  - `[low]` `[reject]` blind-hunter: `next()` lookup can raise `StopIteration` if `family.persons` lacks the replaced heir — the parser rejects heir ids missing from persons; only a hand-built inconsistent `Family` reaches it, the only direct builder (`api/heir_rules.py`) is consistent, and the same pattern pre-exists for the later-estate deceased lookup. Fix would add a guard.
  - `[low]` `[patch]` blind-hunter: disjointness never tested on a candidate both blocked and gender-locked — added `family(['son','brother'])`, replacing `h1`: `daughter_of_son` is `gender_locked` and not in `blocked`.
  - `[low]` `[reject]` blind-hunter: sweeps skip candidates with another code — those codes are covered by the existing kinship matrix tests; not a defect.
  - `[low]` `[patch]` blind-hunter: cardinality precedence untested on replacement — added `second_father` assertion (father kept, daughter replaced by father).
  - `[low]` `[reject]` edge-case-hunter: `StopIteration` for a missing Person — same claim as the blind-hunter row, rejected for the same reason.
  - `[low]` `[reject]` edge-case-hunter: hand-built Person with null/unknown gender — the parser validates gender; unreachable from any producer, fix adds a guard.
  - `[false]` `[reject]` edge-case-hunter: an earlier-estate gender conflict still makes `evaluate` refuse — that conflict is the Family's existing state, not created by any option the query offers; whole-family validation stays in `evaluate`.
  - `[low]` `[patch]` edge-case-hunter: `brother` parity in the aliased test only checked "not gender_locked" — now asserts equality with `options.impossible.get('brother')`.
  - `[low]` `[patch]` edge-case-hunter: new backlog entry wrongly named died-before people — confirmed `api/anonymous_case.py:846` locks linked people and later deceased only, and died-before rows carry no `edit_options`; entry reworded.
  - `[low]` `[patch]` verification-gap: blocked-and-locked disjointness — same fix as the blind-hunter row.
  - `[low]` `[patch]` verification-gap: no fixture separates recorded gender from current role — added a parsed family with a male person in a `daughter` row (`son` not locked, `daughter` locked); made strict (no skip).
  - `[low]` `[patch]` verification-gap: cardinality precedence — same fix as the blind-hunter row.
  - `[low]` `[patch]` verification-gap other: backlog entry died-before wording — same fix as the edge-case row.
  - `[false]` `[reject]` intent-alignment reading 1 (engine query parity) — implemented by the diff; descriptive, no defect.
  - `[false]` `[reject]` intent-alignment reading 2 (broader cross-estate consistency) — the intent names no conflicting role combination and `evaluate` enforces none.
  - `[false]` `[reject]` intent-alignment reading 3 (case API `edit_options` parity) — the deferred item locates the gap at "the public query boundary"; the API surface is recorded as a new deferred-work entry.
  - `[false]` `[reject]` cross-story-contract: no contract shape changed.

## Verification

**Commands:**
- `uv run python -B -m unittest engine.tests.test_queries engine.tests.test_core engine.tests.test_layered api.test_heir_rules_engine` -- expected: all pass.
- `uv run python manage.py test api.tests.HeirRulesApiTests api.tests.InterviewDeathsTests --noinput` -- expected: all pass.

## Auto Run Result

Status: done

**Summary:** `relationship_options` and `change_impossible` in `engine/queries.py` now hold a replaced person's recorded gender fixed: with `replacing` set, every relationship of the other gender that no estate rule already forbids is reported impossible as `gender_locked` (an existing interview contract code with existing ar/en/fr text). The add path, `placement_options` and the API are unchanged.

**Files changed:**
- `engine/queries.py` — `GENDER_LOCKED` constant; `_options` takes optional `person_gender`; `relationship_options` passes the replaced person's gender.
- `engine/tests/test_queries.py` — two tests covering every I/O matrix row, including agreement with `calculate` across the four Sunni schools for an aliased later-estate heir.
- `_bmad-output/implementation-artifacts/deferred-work.md` — resolved item removed; new entry for the case API `edit_options` still listing opposite-gender relationships for locked people.

**Review:** one combined codex call (5 layers), 18 rows. Patched 8 low rows (5 distinct fixes: four test strengthenings, one backlog wording fix); rejected 4 low (unreachable hand-built-Family guards, skipped-candidate sweep already covered elsewhere) and 6 false (see triage log). Nothing deferred. Follow-up review recommended: false (no high or medium patched; 0 high, 0 medium, 8 low patched).

**Verification:** `uv run python -B -m unittest engine.tests.test_queries engine.tests.test_core engine.tests.test_layered api.test_heir_rules_engine` — 52 tests OK. `uv run python manage.py test api.tests.HeirRulesApiTests api.tests.InterviewDeathsTests --noinput` — 46 tests OK. Re-run after patches: same results.

**Residual risks:** HTTP edit options are still counts-only (deferred-work entry). The full calc+api suite was not run here (the driver runs it per batch).
