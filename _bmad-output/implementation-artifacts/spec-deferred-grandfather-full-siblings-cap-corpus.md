---
title: 'Known-answer corpus families for the full siblings cap in the grandfather branch'
type: 'chore'
created: '2026-11-20'
status: 'done'
baseline_revision: '9899cdbc1ca0fcc555da794ecffcd42e7fdd2e0e'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** In the grandfather-with-siblings branch, female-only full siblings take `min(pool, max(counted, cap))` with `cap` 1/2 for one full sister and 2/3 for two or more (`engine/single.py` ~L593-596, mirrored in `calc/models.py` ~L676-679). Only the Ashariyya family (`[GrandFather, Sister, PaternalBrother]` in `MuaddaTests`) reaches it, where the 1/2 cap binds below the pool. No corpus family makes `pool` the binding limit or uses the 2/3 cap, so a mutation there went undetected (deferred-work.md, Epic 8 retrospective, source spec 8.2).

**Approach:** Add three known-answer rows to `SCHOOL_FIXTURES` in `calc/tests.py` for the schools where the grandfather shares with siblings (Maliki, Shafi'i, Hanbali). `SchoolFixtureTests` then pins the legacy path to the textbook answer, and `FixtureParityTests` (which already sweeps every `SCHOOL_FIXTURES` family under every School) pins the engine to the legacy path.

## Boundaries & Constraints

**Always:**
- Expected fractions are the textbook Zaydi answers in the matrix below; they must pass unchanged on the current code.
- Follow the existing `SCHOOL_FIXTURES` row shape: `(title, madhabs, sex, types, expected)`, using `F(...)` and the existing class names.
- Remove the matching item from `_bmad-output/implementation-artifacts/deferred-work.md` (the `summary: No corpus family exercises the cap ...` entry under "Epic 8 retrospective follow-ups"), leaving every other line unchanged.

**Never:**
- No change to `engine/`, `calc/models.py`, `calc/test_engine_parity.py` or any production code. If a row fails on current code, HALT; do not edit an expected value to make it pass.
- Do not touch `LITERAL_CLASSES` / `LITERAL_COUNT` (the new rows are not class literals).
- No user-facing text, translations or migrations.

## I/O & Edge-Case Matrix

Schools: Maliki, Shafi'i, Hanbali (Hanafi's grandfather blocks siblings and is out of scope). Heirs in entry order.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| pool below the half cap | deceased `F`: Husband, GrandFather, Sister, PaternalBrother | 1/2, 1/5, 3/10, 0 (grandfather muqasama 1/5; the sister takes all of the 3/10 left, under her half) | No error expected |
| pool below the half cap, paternal sister | deceased `M`: GrandFather, Sister, PaternalSister | 1/2, 1/2, 0 (grandfather muqasama 1/2; the sister takes the 1/2 left) | No error expected |
| two-thirds cap for two full sisters | deceased `M`: GrandFather, Sister, Sister, PaternalBrother | 1/3, 1/3, 1/3, 0 (grandfather 1/3; the sisters complete 2/3, nothing left for the paternal brother) | No error expected |

</intent-contract>

## Code Map

- `calc/tests.py` L2001-2065 -- `SCHOOL_FIXTURES`; add the three rows near the other grandfather rows (e.g. after `'grandfather, brother', (MALIKI, SHAFII)` ~L2016). Constants `MALIKI, SHAFII, HANBALI` at L1994; `F` is `fractions.Fraction`.
- `calc/tests.py` L2122-2137 -- `SchoolFixtureTests.test_school_fixture_table`: checks fractions, stored amounts and `assert_invariants` for every row (no change).
- `calc/test_engine_parity.py` L110-119 -- `fixture_families()` already includes every `SCHOOL_FIXTURES` family; `FixtureParityTests.test_fixture_families_match_compute` compares engine vs legacy under all schools (no change).
- `engine/single.py` L586-596 -- the branch under test (read-only). None of the three families is "counted out" (`paternal_siblings_counted_out`, L172: no full brother, no female descendant), Akdariyya (needs a mother) or Malikiyya (needs maternal siblings).
- `_bmad-output/implementation-artifacts/deferred-work.md` ~L456-458 -- the entry to remove.

## Tasks & Acceptance

**Execution:**
- `calc/tests.py` -- add the three `SCHOOL_FIXTURES` rows from the matrix with madhabs `(MALIKI, SHAFII, HANBALI)` and short titles naming the case -- pins both paths to the textbook answer for each cap branch.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- delete the resolved three-line entry -- the backlog keeps only open work.

**Acceptance Criteria:**
- Given the new rows, when `calc.tests.SchoolFixtureTests` runs, then every row passes under Maliki, Shafi'i and Hanbali on unchanged production code.
- Given the new rows, when `calc.test_engine_parity.FixtureParityTests` runs, then it passes (engine equals legacy for the new families under every School).
- Given `engine/single.py` L596 mutated to `full_total = max(counted, cap)` (no `min`), or L594 mutated to `cap = Fraction(1, 2)`, when `FixtureParityTests` runs, then it fails; the mutation is reverted afterwards and never committed.

## Spec Change Log

## Review Triage Log

### 2026-11-20 — Review pass
- reviewer: combined five-layer call. Codex hit its usage limit (retry Nov 25), Gemini hit its quota (RESOURCE_EXHAUSTED), so the review ran on the `qwen` agent (fallback chain codex → gemini → qwen).
- verdicts: 9 findings — high 0, medium 0, low 4, false 5, maybe-false 0
- findings:
  - `[low]` `[patch]` blind-hunter: row 2 title says "pool under the half cap" but pool = cap = 1/2 — renamed to "pool equals the half cap" (implementer re-engaged; SchoolFixtureTests OK).
  - `[false]` `[reject]` blind-hunter: `counted` never binds in the new rows — it cannot bind on any input: with only full sisters beside paternal siblings, `counted = pool·n/(n+u) ≤ 2/5` while `cap ≥ 1/2`, and the grandfather always keeps at least a third of the remainder, so `max(counted, cap)` is always `cap`; no fixture can detect a mutation there.
  - `[false]` `[reject]` blind-hunter: ACs ignore the sibling `full_total = pool` branches — those are already pinned by existing rows (`'grandfather, brother'` with no paternal sibling, MUADDA_FIXTURES with a full brother and with a female descendant).
  - `[low]` `[reject]` blind-hunter: no textbook Hanafi row for the new families — Hanafi's grandfather-blocks branch already has its own SCHOOL_FIXTURES rows and the new families run under Hanafi through parity; not part of the cap item.
  - `[low]` `[reject]` blind-hunter: row 3 sits on pool = cap without saying so — the pool can never exceed 2/3 (the grandfather takes at least a third), so 2/3 can only bind at equality; the title "two-thirds cap" is accurate.
  - `[low]` `[reject]` edge-case-hunter: spec 8.2 residual risks still list the item as open — that spec is a historical record; deferred-work.md is the open backlog, and the entry was removed there.
  - `[false]` `[reject]` verification-gap Other: `counted` regression would go undetected — same refutation as the `counted` row above (unreachable).
  - `[false]` `[reject]` intent-alignment: "a mutation there" read broadly includes `counted` — same refutation; every reachable mutation of the cap line changes an answer in the corpus.
  - `[false]` `[reject]` cross-story-contract: no contract shape changed; the fiqh arithmetic check of all three rows agreed with the expected values.

## Verification

**Commands:**
- `uv run python manage.py test calc.tests.SchoolFixtureTests calc.tests.MuaddaTests calc.test_engine_parity.FixtureParityTests --noinput` -- expected: OK.
- Mutation check (parent, temporary, reverted with `git checkout -- engine/single.py`): each of the two mutations above makes `calc.test_engine_parity.FixtureParityTests` fail.

## Auto Run Result

Status: done

**Summary:** Added three known-answer `SCHOOL_FIXTURES` rows (Maliki, Shafi'i, Hanbali) that reach the female full siblings' cap in the grandfather branch: the pool binding below the half cap (husband, grandfather, sister, paternal brother: 1/2, 1/5, 3/10, 0), the pool equal to the half cap (grandfather, sister, paternal sister: 1/2, 1/2, 0) and the two-thirds cap for two sisters (grandfather, two sisters, paternal brother: 1/3 each, 0). They run in `SchoolFixtureTests` (textbook answer, legacy path) and `FixtureParityTests` (engine vs legacy, every School). Removed the resolved deferred-work entry.

**Files changed:**
- `calc/tests.py` — three new SCHOOL_FIXTURES rows.
- `_bmad-output/implementation-artifacts/deferred-work.md` — removed the cap entry.

**Review:** 1 patch (low: row 2 title), 0 deferred, 8 rejected (reasons in the triage log). Review ran on qwen after codex and gemini reported usage limits. Follow-up review recommended: false (patched: high 0, medium 0, low 1).

**Verification:**
- `uv run python manage.py test calc.tests.SchoolFixtureTests calc.tests.MuaddaTests calc.test_engine_parity.FixtureParityTests --noinput`: 15 tests OK (rerun after the patch).
- Mutation check by the parent: `full_total = max(counted, cap)` → FixtureParityTests FAILED (failures=6); `cap = Fraction(1, 2)` → FAILED (failures=6). `engine/single.py` restored and unchanged.

**Residual risks:** The `max(counted, cap)` term is unreachable (cap always wins), so it stays untested by design. Expected values are the standard Zaydi answers and still fall under the general qualified fiqh review items in deferred-work.md.
