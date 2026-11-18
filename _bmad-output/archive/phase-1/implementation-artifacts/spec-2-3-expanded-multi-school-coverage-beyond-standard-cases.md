---
title: 'Story 2.3: Expanded Multi-School Coverage Beyond Standard Cases'
type: 'feature'
created: '2026-11-09'
status: 'done'
baseline_commit: '0aa889275ef818988ceb8bc1da7e3ba309dceb6e'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Hanafi, Maliki and Shafi'i refuse every family with a father and a grandmother, or with two grandmothers (`grandmother_line_unknown`). These are common families, refused only because the case does not record which line the grandmother is on.

**Approach:** The existing grandmother becomes the paternal grandmother (father's mother), as the engine's grandfather is already the father's father. A new maternal grandmother (mother's mother) is added through the engine, API, contracts and web, and the line-unknown refusal is removed. Sunni schools only.

## Boundaries & Constraints

**Always:**
- At most one paternal and one maternal grandmother: a second one is refused with kinship codes `second_paternal_grandmother` and `second_maternal_grandmother`.
- The mother blocks both grandmothers. The grandfather blocks neither.
- The father blocks the paternal grandmother under Hanafi, Maliki and Shafi'i (school rule `father_blocks_his_mother`). He does not under Hanbali (`grandmother_inherits_with_her_son`). A proof names whichever rule decided the family.
- Grandmothers who are not blocked share one 1/6 equally. They never get 1/6 each.
- The mushtaraka and Malikiyya checks accept a grandmother of either line, or both, wherever they accept the mother.
- The id `grandmother` and the `GrandMother` class now mean the paternal grandmother:
  - The API accepts `grandmother` as an alias for `paternal_grandmother`, both on write and when it reads stored session heirs.
  - Saved results pages (Hanbali, no school) look exactly as before.
- `grandmother_line_unknown` can no longer be produced. Remove it from the engine, the contracts and the web text.
- The hajb labels equal the engine for both grandmothers under every school.
- Each new id, code and label has ar/en/fr text, enforced by test. The proof stays `version: 1`.

**Ask First:** Any data migration of existing rows. Any grandmother rule not in the matrix. Any change to the proof's shape.

**Never:** Jafari, which stays `school_not_supported`. Grandparents beyond one degree, or the mother's father. Radd or mu'adda changes, which are deferred. Showing the proof in the UI. Pushing this work.

## I/O & Edge-Case Matrix

Deceased male unless noted. PGM is the paternal grandmother and MGM the maternal grandmother. Shares are per heir.

| School | Family | Expected |
|--------|--------|----------|
| Any Sunni | Mother, MGM, PGM, son | 1/6, 0, 0, 5/6; both grandmothers blocked by the mother |
| Hanbali | Father, PGM, MGM | 5/6, 1/12, 1/12; tagged `grandmother_inherits_with_her_son` |
| Hanafi, Maliki, Shafi'i | Same | 5/6, 0, 1/6; tagged `father_blocks_his_mother` |
| Hanbali | Father, PGM | 5/6, 1/6 |
| Hanafi, Maliki, Shafi'i | Father, PGM | 1, 0 |
| Any Sunni | PGM, MGM, son | 1/12, 1/12, 5/6 |
| Any Sunni | Grandfather, PGM | 5/6, 1/6 |
| Hanafi, Hanbali | Wife, MGM | 1/4, 3/4 (radd) |
| Maliki, Shafi'i | Wife, MGM | Refused: `radd_disputed`, unchanged |
| Maliki, Shafi'i, deceased female | Husband, MGM, PGM, 2 maternal brothers, brother | Mushtaraka: 1/2, 1/12, 1/12, 1/9 each sibling |
| Any | Adding a second MGM or PGM | Kinship error with the matching `second_*` code |
| Any | Session heir stored as `grandmother` | Read, labelled and previewed as `paternal_grandmother` |

</frozen-after-approval>

## Code Map

- `calc/schools.py:23,37` -- `GRANDMOTHER_LINE_UNKNOWN`, to remove. `:115-122` `grandmother_line_is_unknown` and `:134-139` `check_family`. `:62-74` `is_mushtaraka_family` and `:98-107` `is_malikiyya_family` count `'GrandMother'`. Add the codes to `SCHOOL_RULES` `:26-31`.
- `calc/models.py:1226-1244` -- `GrandMother.get_quote`: blocked only by the mother (`has_mohter`, `:418`, the real misspelled name). Add the father branch by school. A new `MaternalGrandMother` subclass goes beside it. `Person.add_grandMother` `:197` is a no-op, so no tree FK is needed. `FIQH_ORDER`/`MALE_HEIRS` `:1817-1823`.
- `calc/models.py:576-591` -- **trap:** fixed groups are keyed by `type(heir)`. Give both grandmothers one shared key, like `'maternal'` at `:585`. `get_shares` `:517` groups by ctype. The radd groups and the `extra` lookup `:681` are also per class.
- `calc/models.py:830-844` -- `_tag_school_rules`. `:893-901` `live_counts`, keyed by class name.
- `calc/migrations/0026_*` -- latest. Add a CreateModel for `MaternalGrandMother` only.
- `calc/proof.py:40-44` `BLOCKED_BY`, `:60-69` `RELATIONSHIPS` (map `GrandMother` to `paternal_grandmother`), `:71-157` `LABELS`.
- `api/anonymous_case.py:21-45` -- `RELATIONSHIPS`. `:149` `clean_heir` and `:176-198` `_read_heirs`, which is where the alias goes.
- `api/heir_rules.py:15-20` `SECOND_OF`, `:121-122` grandmother blocking, `:162-171` `_facts`, `:175-179` `BLOCKABLE`, `:182` `blocked_relationships(madhab, …)`.
- `api/preview.py:24-47` -- `HEIR_CLASSES`.
- `api/contracts/interview.json:12,29-31,37`, `heir-options-fixtures.json:98,337-346`, `preview-fixtures.json:2347-2390` (Hanafi line unknown, which becomes a result).
- `web/src/api/case.ts:13-38` `RELATIONSHIP_IDS`, `:79-87` `KINSHIP_CODES`, `:438-444` `PREVIEW_REASONS`. `web/src/interview/tree.ts:8-25`: both grandmothers go on line 1.
- `web/src/i18n/messages.ts` -- relationship labels ar `:211`, en `:379`, fr `:550` (typed `Record`, so they are compiler-enforced). `second_grandfather` `:246/414/585`. Line-unknown reason `:291/462/633`.
- Tests: `calc/tests.py` `HEIR_SEX` `:1423`, `ALL_HEIR_TYPES` `:1428`, `families()` `:1705`, `SCHOOL_FIXTURES` `:1889-1910`, `:1975`, `:1992`, the allowed refusals `:2027-2031`. `api/tests.py:1466-1478` (id to class table), `:1499`, `:1687-1710` (rules equal the engine), `:1726`, `:1852`. `web/src/interview/tree.test.ts:63`, `preview.test.ts:136`, `answers.test.ts:188`.

## Tasks & Acceptance

**Execution:**
- [x] `calc/schools.py` -- add the two school-rule codes and one pure predicate for the father rule, let mushtaraka and Malikiyya accept either grandmother, and remove the line-unknown refusal.
- [x] `calc/models.py`, `calc/migrations/0027_*` -- add `MaternalGrandMother`, the father branch by school, one shared grandmother group, and tagging.
- [x] `calc/proof.py`, `locale/{ar,en,fr}/LC_MESSAGES/django.po` + `.mo` (built by script, since `msgfmt` is missing) -- the relationships, codes and labels.
- [x] `api/anonymous_case.py`, `api/heir_rules.py`, `api/preview.py` -- the two ids, the alias, the `second_*` limits, and hajb rules that equal the engine by school.
- [x] `api/contracts/*.json`, `web/src/api/case.ts`, `web/src/interview/tree.ts`, `web/src/i18n/messages.ts` -- ids, labels and kinship codes, without the line-unknown reason.
- [x] `calc/tests.py`, `api/tests.py`, web tests -- one test per matrix row, add `MaternalGrandMother` to `families()`, and turn the line-unknown tests into result tests.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- mark the grandmother-line entry resolved, and note that the new labels and positions need qualified review.

**Acceptance Criteria:**
- Given any family from `families()`, including both grandmothers, when it is computed under each Sunni school, then it never raises `grandmother_line_unknown`, and every invariant and proof check holds.
- Given a saved case with a grandmother, when its results page opens, then it looks exactly as before.
- Given any family and school, when heir options are requested, then the grandmothers' blocked labels equal the engine.

## Design Notes

The grandmother becomes paternal, not a new class. The engine's `GrandFather` is already the father's father, and under Hanbali (the results pages' school) the father does not block his mother. So existing rows keep their results with no data migration.

## Verification

**Commands:**
- `DATABASE_URL='sqlite://:memory:' DJANGO_ENV=test .venv/Scripts/python.exe manage.py test calc api` -- expected: all pass.
- `.venv/Scripts/python.exe manage.py makemigrations --check --dry-run` -- expected: no changes.
- In `web/`, run `npm test`, `npm run lint` and `npx tsc --noEmit` -- expected: all pass.

**Manual checks:**
- A qualified reviewer reads the matrix, the two school-rule codes, and the Arabic and French labels.

## Suggested Review Order

**Where the schools differ on grandmothers**

- Start here: the father rule by school, as one pure predicate plus its proof code.
  [`schools.py:63`](../../calc/schools.py#L63)

- Mushtaraka now accepts a grandmother of either line, or both.
  [`schools.py:74`](../../calc/schools.py#L74)

**Engine**

- The legacy class becomes the paternal grandmother; the father blocks her outside Hanbali.
  [`models.py:1251`](../../calc/models.py#L1251)

- The new maternal grandmother is blocked only by the mother.
  [`models.py:1264`](../../calc/models.py#L1264)

- Both lines share one fixed group, so they split one 1/6.
  [`models.py:597`](../../calc/models.py#L597)

- Counts only grandmothers who are not blocked, so `shared_quote` stays honest (review patch).
  [`models.py:418`](../../calc/models.py#L418)

- Proof tag: names the father rule when a father and his mother meet without the mother.
  [`models.py:857`](../../calc/models.py#L857)

- Create-only migration; existing rows keep meaning paternal, so there is no data migration.
  [`0027_maternal_grandmother.py:1`](../../calc/migrations/0027_maternal_grandmother.py#L1)

**API and contract**

- The `grandmother` alias, applied on write and on every session read via `clean_heir`.
  [`anonymous_case.py:152`](../../api/anonymous_case.py#L152)

- One of each line; hajb labels mirror the engine by school.
  [`heir_rules.py:123`](../../api/heir_rules.py#L123)

- Preview maps each id to its engine class.
  [`preview.py:34`](../../api/preview.py#L34)

- The proof uses the new relationship names.
  [`proof.py:63`](../../calc/proof.py#L63)

**Web**

- New ids and `second_*` kinship codes.
  [`case.ts:23`](../../web/src/api/case.ts#L23)

- Both grandmothers sit on the grandparents' line of the tree.
  [`tree.ts:9`](../../web/src/interview/tree.ts#L9)

**Tests**

- The matrix rows by school; the qualified reviewer should read these first.
  [`tests.py:1912`](../../calc/tests.py#L1912)

- A blocked grandmother no longer makes the other one shared.
  [`tests.py:1966`](../../calc/tests.py#L1966)

- Alias on write and edit, and a stored legacy heir read as paternal.
  [`tests.py:1946`](../../api/tests.py#L1946)

- Hajb labels for the paternal grandmother by school.
  [`tests.py:1981`](../../api/tests.py#L1981)
