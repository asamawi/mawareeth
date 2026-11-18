---
title: 'Story 2.1: Standard Share Calculation Across the Sunni Schools'
type: 'feature'
created: '2026-11-07'
status: 'done'
baseline_commit: '701c0bd8c9dd6129336910a0283c2acb79662ede'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The engine follows Hanbali only, so a visitor who chose another school cannot get a result under that school's rules. Story 1.5's preview cannot show those schools until the engine can calculate by school.

**Approach:** Let `compute()` take a school: Hanafi, Maliki, Shafi'i or Hanbali. Keep the rules that differ in one module. Where the data cannot settle a school's answer, or its position is disputed, refuse with an explicit reason and never give a number. Jafari is refused for now and follows in its own story.

## Boundaries & Constraints

**Always:**
- `compute()` with no school behaves exactly as today (Hanbali), so results pages do not change.
- The school is an input to the run. It is never stored, because no schema change is allowed here.
- The same family and school always give the same result, in any entry order.
- A refusal raises `UnsupportedCase` with a stable reason code, distinct from any other failure. An unknown school id raises `ValueError`.
- A case that gets a result follows every invariant from the engine fix: exact fractions, total of exactly 1 except a spouse with no other heir, equal shares within a type, 2:1 for mixed residuaries.
- Each new reason appears in Arabic, English and French.

**Ask First:** Any schema migration. Any school difference not listed in the matrix. Any fixture a qualified reviewer disputes.

**Never:** Jafari rules or new relationships. API, session, interview or results-page changes (Story 1.5 and Epic 3). Removing database writes from `compute()`. Proof output (Story 2.2). Pushing this work.

## I/O & Edge-Case Matrix

Whole-group shares, deceased male unless noted. Anything not listed matches Hanbali.

| School | Family | Expected | Why |
|--------|--------|----------|-----|
| Hanbali | Grandfather, brother | 1/2, 1/2 | Unchanged |
| Hanafi | Grandfather, brother | 1, 0 | Grandfather blocks full and paternal siblings |
| Hanafi | Grandfather, sister | 1, 0 | Same |
| Hanafi | Wife, grandfather, brother | 1/4, 3/4, 0 | Same |
| Hanafi | Daughter, grandfather, sister | 1/2, 1/2, 0 | 1/6 plus the remainder |
| Hanafi, deceased female | Husband, mother, grandfather, sister | 1/2, 1/3, 1/6, 0 | No Akdariyya |
| Hanafi, deceased female | Husband, mother, 2 maternal brothers, brother | 1/2, 1/6, 1/3, 0 | No shared-sibling rule |
| Hanafi | Wife, mother, 3 daughters | 1/8, 7/40, 7/10 | Radd, as Hanbali |
| Maliki, Shafi'i | Grandfather, brother | 1/2, 1/2 | As Hanbali |
| Maliki, Shafi'i, deceased female | Husband, mother, 2 maternal brothers, brother | 1/2, 1/6, then 1/9 per sibling | Mushtaraka shares |
| Maliki, Shafi'i, deceased female | Husband, grandmother, maternal brother, maternal sister, brother, sister | 1/2, 1/6, then 1/12 per sibling | Equal, regardless of sex |
| Maliki, Shafi'i, deceased female | Husband, mother, 2 maternal brothers, sister | 3/9, 1/9, 2/9, 3/9 | No full brother, so no sharing; awl to 9 |
| Shafi'i, deceased female | Husband, mother, grandfather, 2 maternal brothers, paternal brother | 1/2, 1/6, 1/6, 0, 1/6 | Muqasama |
| Maliki, same family | As above | Refused: `malikiyya_disputed` | Malik's own ruling is outside this story |
| Maliki, Shafi'i | Mother, daughter | Refused: `radd_disputed` | Classical position has no radd |
| Maliki, Shafi'i | Wife, grandmother | Refused: `radd_disputed` | Same |
| Maliki, Shafi'i | Wife | 1/4, remainder unallocated | Spouse alone, as Hanbali |
| Hanafi, Maliki, Shafi'i | Father, grandmother | Refused: `grandmother_line_unknown` | The case does not record her line |
| Hanafi, Maliki, Shafi'i | 2 grandmothers | Refused: `grandmother_line_unknown` | Same |
| Jafari | Any family | Refused: `school_not_supported` | Follow-up story |
| Unknown id | Any family | `ValueError` | Caller's bug |

</frozen-after-approval>

## Code Map

- `calc/models.py:798` -- `compute()`, gains `madhab='hanbali'`. `:374` `get_quotes()` runs classification with it available, as a transient attribute on the instance, so `get_quote(calc)` signatures stay.
- `calc/models.py:528` -- `gf_shares_with_siblings()`, false under Hanafi.
- `calc/models.py:990,1014,1140,1187` -- `Brother`, `Sister`, `PaternalSister`, `PaternalBrother`. Their grandfather branch shares today; under Hanafi it blocks. The old "blocked by grandfather" msgids are still in the catalogs (`locale/ar/LC_MESSAGES/django.po:130,147,237,282`), so reuse them.
- `calc/models.py:547` -- `distribute()`. Add the Mushtaraka group here, and read radd from its existing `radd` flag for the refusal.
- `calc/models.py:1241,1274` -- `maternal_quote`, how maternal siblings already share one group.
- `calc/tests.py` -- `FIXTURES`, `build_case`, `families()`, `core_family_reference` to reuse.
- `locale/{ar,en,fr}/LC_MESSAGES/django.po`, `.mo` -- `msgfmt` is not installed here, so build `.mo` from the `.po` with a script and verify nothing else changed.

## Tasks & Acceptance

**Execution:**
- [x] `calc/schools.py` -- add `SUNNI`, `is_known()`, `UnsupportedCase`, the reason codes and pure predicates for each listed difference -- school rules stay isolated, per the epic.
- [x] `calc/models.py` -- add the `madhab` argument and apply the Hanafi and Mushtaraka differences and the refusals from the matrix -- results differ only where schools differ.
- [x] `locale/{ar,en,fr}/LC_MESSAGES/django.po` and `.mo` -- add the new reasons.
- [x] `calc/tests.py` -- add a fixture per matrix row, asserting per-heir fractions or the exact reason code.
- [x] `calc/tests.py` -- run the existing invariants and `core_family_reference` under Hanafi across all families, and under Maliki and Shafi'i wherever no refusal is raised -- schools must only differ as listed.
- [x] `calc/tests.py` -- assert a refused run followed by a normal `compute()` on the same case gives the normal result, and no-argument `compute()` equals Hanbali over `families()`.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- append the Jafari follow-up (rules, plus the relationships it needs), the Malikiyya ruling, and radd for Maliki and Shafi'i, where later scholars permit it.

**Acceptance Criteria:**
- Given a supported family, when computed under two schools whose rules differ for it, then each result follows its own school.
- Given a family the schools agree on, when computed under each Sunni school, then all four results match.
- Given a refused case, when the caller catches `UnsupportedCase`, then it gets a reason code and no number, and can tell this from a generic failure.
- Given existing saved cases, when their results pages open, then results are unchanged.

## Spec Change Log

## Design Notes

**Refusing:** radd is only known after distribution, so the refusal may raise after writes. That is safe only inside a rolled-back transaction, which is how Story 1.5 will call it. Results pages never pass a school, so they never raise. Keep this in the `compute()` docstring.

**Mushtaraka conditions:** husband, mother or grandmother, 2 or more maternal siblings, and at least one full brother. Full sisters then join the group. All of them share the 1/3 equally. Paternal brothers do not qualify.

**Malikiyya family:** husband, mother or grandmother, grandfather, 2 or more maternal siblings, and a paternal brother.

**Why not a pure engine yet:** the epic's target is a module with no database writes. The project owner chose on 2026-11-07 to build on the fixed engine, so this stays a parameter on `compute()`. Isolating the differences in `calc/schools.py` keeps a later move simple.

**Source of the rules:** these positions come from the author's knowledge, and only the sister rules have been checked against a text. The fixtures are the review surface.

## Verification

**Commands:**
- `DATABASE_URL='sqlite://:memory:' DJANGO_ENV=test .venv/Scripts/python.exe manage.py test calc` -- expected: all pass.
- The same suite with CI's production settings, after `collectstatic` -- expected: all pass. CI's settings differ from test settings, as #98 showed.

**Manual checks:**
- A qualified reviewer reads the school fixtures, including each refusal, against each school's position.

## Suggested Review Order

**Where the schools differ**

- Start here: every difference and refusal, as small pure functions.
  [`schools.py:49`](../../calc/schools.py#L49)

- The school enters here, and the docstring explains why refused runs must roll back.
  [`models.py:819`](../../calc/models.py#L819)

- Refusals the data can settle before distribution.
  [`schools.py:107`](../../calc/schools.py#L107)

**Rules in the engine**

- Mushtaraka: full siblings join the maternal third under Maliki and Shafi'i.
  [`models.py:566`](../../calc/models.py#L566)

- Radd is refused here, only known after the shares are worked out.
  [`models.py:682`](../../calc/models.py#L682)

- Under Hanafi the grandfather does not share with siblings.
  [`models.py:537`](../../calc/models.py#L537)

**Tests**

- The expected results per school, which the qualified reviewer should read first.
  [`tests.py:1870`](../../calc/tests.py#L1870)

- Invariants, the core reference and entry order under every school.
  [`tests.py:2021`](../../calc/tests.py#L2021)

**Translations**

- New reasons; the Arabic and French are unreviewed. The `.mo` files were built by script.
  [`django.po:2321`](../../locale/ar/LC_MESSAGES/django.po#L2321)
