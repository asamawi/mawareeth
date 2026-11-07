---
title: 'Fix wrong inheritance shares in the calculation engine'
type: 'bugfix'
created: '2026-11-07'
status: 'done'
baseline_commit: 'd725f49eef970f453b152f1ebef2d51bcd6fa138'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `Calculation.compute()` silently gives wrong shares and amounts for common families, and the logged-in results pages show them. Of 441 spouse, parent and child families compared with a reference, 70 differ, 68 of them with two or more wives. In a wider sample, 217 of 891 families do not add up to the whole estate.

The engine also mixes schools: radd follows Hanafi and Hanbali, the grandfather blocking siblings follows Hanafi, and the shared-sibling rule (Mushtaraka) follows Maliki and Shafi'i.

**Approach:** Make the engine follow the Hanbali school throughout, as the project owner chose on 2026-11-07. Keep `get_quote()` as the one place that decides who is blocked, who has a fixed share and who is residuary, after fixing its order and blocking bugs and aligning it to Hanbali. Replace the integer distribution stage with exact fractions, then derive every stored and displayed column from that one result.

## Boundaries & Constraints

**Always:**
- Blocked heirs get zero. Every other family's shares add up to exactly 1, except a spouse with no other heir, who keeps their fixed share as today.
- Heirs of one type and sex get equal shares. Residuaries of mixed sex split 2:1.
- Fixed shares above 1 scale down proportionally (awl). A remainder with no residuary returns to the non-spouse sharers proportionally (radd).
- Father or grandfather with only female descendants and no siblings gets 1/6 plus the remainder.
- No shared-sibling rule: when fixed shares use up the estate, full siblings get nothing.
- The grandfather no longer blocks full or paternal siblings. He takes the best of the options in Design Notes. He still blocks maternal siblings, nephews and uncles.
- Heirs' results do not depend on the order they were added.
- Amounts come from the exact fraction, rounded half-up to 2 decimals.
- Results stay in the existing fields and templates, so saved cases correct themselves the next time they are computed, with no migration.

**Ask First:** Any schema migration. Any change to who inherits beyond the listed bugs. Any fixture a qualified reviewer disputes.

**Never:** Switching rules by Madhab, new relationships or Story 1.5 work. Removing the existing database writes from `compute()`. Any rule from another school. Pushing without the project owner's request.

## I/O & Edge-Case Matrix

Whole-group shares, deceased male unless noted.

| Scenario | Heirs | Expected | Today |
|----------|-------|----------|-------|
| Two wives, one son | 2 wives, son | Wives 1/8 (1/16 each), son 7/8 | Wives 1/4 |
| Three wives, mother, two sons | 3 wives, mother, 2 sons | Wives 1/8, mother 1/6, sons 17/24 | Wives 1/16 |
| Radd with spouse | Wife, mother, 3 daughters | Wife 1/8, mother 7/40, daughters 7/10 | Mother and daughters 7/8 each |
| Radd, deceased female | Husband, 3 daughters | Husband 1/4, daughters 3/4 | Daughters 1/4 |
| Radd, two wives | 2 wives, mother, daughter | Wives 1/8, mother 7/32, daughter 21/32 | Mother and daughter 7/8 each |
| Awl | 2 wives, mother, father, 2 daughters | Wives 1/9, mother 4/27, father 4/27, daughters 16/27 | Daughters 8/27 |
| Father with daughters | 2 wives, father, 2 daughters | Wives 1/8, father 5/24, daughters 2/3 | Daughters 1/3 |
| Mushtaraka, deceased female | Husband, mother, 2 maternal brothers, brother | 1/2, 1/6, maternal brothers 1/3, brother 0 | Husband 1/6 |
| Sister residuary blocks | 2 daughters, 2 sisters, paternal brother | 2/3, 1/3, brother blocked | Totals 4/3 |
| Grandfather, one brother | Grandfather, brother | 1/2, 1/2 | Brother blocked |
| Grandfather, three brothers | Grandfather, 3 brothers | 1/3, brothers 2/3 | Brothers blocked |
| Grandfather, sister | Grandfather, sister | 2/3, 1/3 | Sister blocked |
| Grandfather after a spouse | Wife, grandfather, brother | 1/4, 3/8, 3/8 | Brother blocked |
| Grandfather's minimum, deceased female | Husband, mother, grandfather, brother | 1/2, 1/3, 1/6, brother 0 | Brother blocked |
| Daughter, sister, grandfather | Daughter, grandfather, sister | 1/2, 1/3, 1/6 | Sister blocked |
| Akdariyya, deceased female | Husband, mother, grandfather, sister | 9/27, 6/27, 8/27, 4/27 | Sister blocked |
| Counting paternal siblings | Grandfather, brother, paternal brother | 1/3, 2/3, 0 | Brothers blocked |
| Ashariyya | Grandfather, sister, paternal brother | 2/5, 1/2, 1/10 | Sister and brother blocked |
| Spouse alone | Wife | 1/4, remainder unallocated | Same |
| No heirs yet | Deceased only | No error, nothing to distribute | Same |

</frozen-after-approval>

## Code Map

- `calc/models.py:705-726` -- `compute()`, the pipeline to rework.
- `calc/models.py:451-679` -- integer stage (`set_calc_shares` to `set_shortage_union_share`). `set_calc_correction:513,520` tests `count % heir_share`, the wrong way round. `set_shortage_shares:635-640` gives each wife the whole spouse numerator.
- `calc/models.py:759-955` -- per-heir share, correction and amount. `set_amount` uses float division.
- `calc/models.py:330-332` -- `get_quotes()` runs in `polymorphic_ctype_id` order, so `get_sisters().filter(asaba=True)` at `:1307` and later heirs can read flags not yet set. Use a fixed fiqh order: descendants, then ascendants and spouses, then siblings, then nephews and uncles.
- `calc/models.py:385-386` -- `has_sonOfBrother` counts `PaternalBrother`.
- `calc/models.py:681-685`, `:764-769`, `:839-850`, `:894-898`, `:913-914` -- the `common_quote` rule to remove. The `Calculation.common_quote` column stays, always false, to avoid a migration.
- `calc/models.py:1098-1149`, `:1246-1318` -- `Brother`, `Sister`, `PaternalSister` and `PaternalBrother` blocking by grandfather, to remove. The maternal, nephew and uncle classes keep theirs.
- `calc/models.py:1156-1171` -- `GrandFather.get_quote`, which needs the sibling cases.
- `locale/{ar,en,fr}/LC_MESSAGES/django.po` -- `quote_reason` strings are translated here.
- `calc/templates/calc/results.html:21-108`, `new_results.html` -- read `shares`, `shares_excess`, `shares_shorted`, `shortage_union_share`, `corrected_share`, `amount`. Keep their meaning.
- `calc/tests.py:631-882` -- tests that call intermediate methods directly.
- `calc/views.py:779,810` -- the two `compute()` callers.

## Tasks & Acceptance

**Execution:**
- [x] `calc/models.py` -- fix `get_quotes()` order and `has_sonOfBrother` -- hajb must not depend on entry order.
- [x] `calc/models.py` -- add one exact distribution step using `Fraction`, per Design Notes, and have `compute()` write all result fields from it, removing superseded helpers -- one source of truth for every column.
- [x] `calc/models.py` -- remove the shared-sibling rule, and add the grandfather's share with siblings per Design Notes, with a `quote_reason` for each outcome -- the engine must follow one school.
- [x] `locale/{ar,en,fr}/LC_MESSAGES/django.po` -- add the new reasons in all three languages and rebuild the `.mo` files -- results pages show them.
- [x] `calc/tests.py` -- add a fixture table covering the I/O matrix and the classical cases in Verification, asserting per-heir fractions and amounts.
- [x] `calc/tests.py` -- add table-driven invariant tests over all 22 relationship types: sum is exactly 1, equal shares within a type, 2:1 for mixed residuaries, and results unchanged when entry order is reversed.
- [x] `calc/tests.py` -- adjust a test only where it pins a wrong value or a removed helper, recording each in the Spec Change Log.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- append that results pages do not yet say they follow the Hanbali school, whichever school the visitor follows.

**Acceptance Criteria:**
- Given any family in the I/O matrix, when `compute()` runs, then each heir's fraction and amount match it.
- Given the existing correct cases (asl 24, awl to 27, corrected 81 and 48), when `compute()` runs, then those values are unchanged.
- Given a saved case with wrong results, when its results page is opened, then correct values show with no data migration.
- Given the same family entered in any order, when computed, then every heir's result is identical.

## Design Notes

```text
fixed   = non-blocked groups with a quote (shared_quote divides inside the group)
if sum(fixed) > 1:  scale all by 1/sum                      # excess, shares_excess = awl base
remainder = 1 - sum(fixed)
if residuaries:     split remainder 2:1 by sex              # father/grandfather take it if only female descendants
elif sharers other than spouse: spread remainder on them    # shortage
else:               leave remainder unallocated             # spouse alone
```

`shares` is the LCM of the group quote denominators. `shares_corrected` is the smallest base giving every heir a whole number. Quotes come from the classification as exact fractions, not read back from the 10-decimal field.

`set_share` and related methods may stay as thin wrappers where existing tests call them.

**Grandfather with full or paternal siblings**, and no father or male descendant. `R` is what remains after the fixed shares:

```text
grandfather = max(1/6 of estate, 1/3 of R, his share of R counted as one more brother)
              # with no fixed shares, the options are 1/3 of the estate or that count
siblings    = the rest of R, 2:1 by sex; may be 0
counting    = full siblings count paternal siblings against him, then take back their part:
              full brothers leave paternal siblings nothing
              a lone full sister takes back up to 1/2 of the estate, two or more up to 2/3
              any excess goes to the paternal siblings
akdariyya   = husband, mother, grandfather, one full or paternal sister: sister gets 1/2 by awl,
              then she and the grandfather pool their shares and split them 2:1
```

Full and paternal sisters do not take a fixed share alongside him, except in Akdariyya. With a daughter or son's daughter, sisters stay residuary and the same options apply to what remains.

Hanbali also lets a grandmother inherit alongside the father, which the current code already does, so it stays.

## Verification

**Commands:**
- `DATABASE_URL='sqlite://:memory:' DJANGO_ENV=test .venv/Scripts/python.exe manage.py test calc` -- expected: all pass.
- `DATABASE_URL='sqlite://:memory:' DJANGO_ENV=test .venv/Scripts/python.exe manage.py test` -- expected: all pass.

**Manual checks:**
- A qualified reviewer reads the fixture table. It must be checked against the Hanbali position. Classical cases to include: Umariyyatan (both forms), Minbariyya (awl to 27), Mushtaraka, Akdariyya, Ashariyya, husband with two full sisters (awl to 7), daughter with son's daughter.
- Open the results page in English and Arabic for one each of awl, radd and correction: columns add up and amounts total the estate within rounding.

## Spec Change Log

- No existing test was adjusted. The tests that call the old helpers (`set_calc_shares`, `set_share`, `get_shares`, `set_calc_correction`, `get_corrected_share`, `get_corrected_shares`) still pass against thin wrappers that report what `compute()` stored.
- `compute()` and `Calculation.distribute()` now return each heir's exact fraction keyed by heir id, so tests can assert exact values. Callers that ignore the return value are unaffected.
- Father or grandfather with only female descendants and no siblings keeps showing the remainder in the Shortage column, as before, with `share` holding the fixed 1/6.
- A paternal sister is now also blocked by a full sister who is residuary (with a daughter or son's daughter), the same as the paternal brother. Without this, a family of two daughters, a sister and a paternal sister added up to more than the estate.
- The project owner chose on 2026-11-07 to remove the paternal-sister rule above, because it changed who inherits without the required ask. Paternal sisters follow the existing rules again. All families still total exactly 1, so the earlier reason for the rule did not hold. In some families a paternal sister now gets more than the full sister, so this needs the qualified review. The msgid "Paternal sister/s are blocked by sisters" stays in the catalogs, unused.
- Restored on 2026-11-07: the project owner supplied Al-Mughni's ruling that with a daughter, the full sister takes all the rest and the paternal sister nothing. Fixtures now cite this ruling and Al-Mughni 6/168 on the 1/6 that completes 2/3.

## Suggested Review Order

**One exact calculation**

- Start here: the single step that works out every heir's fraction and every column.
  [`models.py:547`](../../calc/models.py#L547)

- The whole pipeline is now clear, classify, distribute.
  [`models.py:798`](../../calc/models.py#L798)

- Classification runs in a fixed fiqh order, so entry order cannot change results.
  [`models.py:374`](../../calc/models.py#L374)

- Amounts round half up from the exact fraction, replacing float division.
  [`models.py:52`](../../calc/models.py#L52)

**Hanbali rules, for the qualified reviewer**

- When the grandfather shares with full or paternal siblings instead of blocking them.
  [`models.py:528`](../../calc/models.py#L528)

- His best-of-three options, then counting paternal siblings against him.
  [`models.py:587`](../../calc/models.py#L587)

- Akdariyya's narrow conditions.
  [`models.py:536`](../../calc/models.py#L536)

- Grandfather classification with descendants and siblings.
  [`models.py:1048`](../../calc/models.py#L1048)

**Smaller fixes**

- This counted the wrong relative, which changed who was blocked.
  [`models.py:433`](../../calc/models.py#L433)

- Old helpers now report stored values, kept only for existing tests.
  [`models.py:499`](../../calc/models.py#L499)

**Translations**

- New reasons; the Arabic and French are unreviewed. The `.mo` files were built by script.
  [`django.po:2265`](../../locale/ar/LC_MESSAGES/django.po#L2265)

**Tests**

- The expected results table, which the qualified reviewer should read first.
  [`tests.py:1326`](../../calc/tests.py#L1326)

- Totals, fairness and entry order across all 22 relationship types.
  [`tests.py:1599`](../../calc/tests.py#L1599)

- Rendered pages use the right template and show each amount.
  [`tests.py:1494`](../../calc/tests.py#L1494)
