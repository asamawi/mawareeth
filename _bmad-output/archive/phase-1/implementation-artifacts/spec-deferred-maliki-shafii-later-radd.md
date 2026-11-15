---
title: 'Maliki and Shafi''i radd by the later scholars'
type: 'feature'
created: '2026-11-09'
status: 'done'
baseline_commit: 'e31fd0433aaa1df89b3062bca94c0f73a98518d5'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Under Maliki and Shafi'i, every family that needs radd raises `UnsupportedCase('radd_disputed')`. Common families such as a mother and a daughter get no result and no preview.

**Approach:** Follow the position the project owner chose on 2026-11-09, the later scholars' radd. Maliki and Shafi'i return the remainder to the non-spouse sharers in proportion, exactly as Hanbali does. The proof tags those heirs with a new school rule, `radd_later_scholars`. Hanafi and Hanbali keep `radd`. Because `radd_disputed` can no longer be produced, remove it everywhere, as Story 2.3 removed `grandmother_line_unknown`.

## Boundaries & Constraints

**Always:**
- Maliki and Shafi'i shares are identical to Hanbali's for every family that needs radd. Only the school-rule code differs.
- A spouse is never given radd. If a spouse is the only sharer, the remainder stays `unallocated` under every school, as it does today.
- The engine never raises `radd_disputed`. Remove the code from `calc/schools.py`, the API contract, `web/src/api/case.ts` and the web messages in all three languages.
- Add the new label in English, Arabic and French in `locale/*/LC_MESSAGES/django.po`, and rebuild the `.mo` files the way Story 2.3 did (with a script, because `msgfmt` is missing).

**Ask First:**
- Any change to the radd arithmetic, or to which heirs receive radd.
- Any change to the Hanafi or Hanbali proof output.

**Never:**
- Do not touch the Malikiyya refusal, the Jafari refusal or the mu'adda labels. Each is a separate deferred item.
- Do not add a setting that lets a visitor choose between the classical and the later position.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Radd, no spouse | Maliki, deceased F, mother and daughter | mother 1/4, daughter 3/4. Proof has the `radd` step. Both heirs and `school_rules` are `['radd_later_scholars']` | N/A |
| Radd with spouse | Shafi'i, M, wife, mother and 3 daughters | Same fractions and steps as Hanbali. The wife has no school rule. Mother and daughters are tagged `radd_later_scholars` | N/A |
| Spouse alone | Maliki, M, wife only | wife 1/4, `unallocated` 3/4, no radd step, no school rule | N/A |
| Wife and grandmother | Shafi'i, M, wife and (maternal) grandmother | Result equals Hanbali's, the grandmother tagged `radd_later_scholars` | N/A |
| Hanafi or Hanbali radd | any radd family | Unchanged: `radd` | N/A |

</frozen-after-approval>

## Code Map

- `calc/schools.py:22,38` -- `RADD_DISPUTED` and its REASONS message: remove both. `:29-33`: add `RADD_LATER_SCHOLARS = 'radd_later_scholars'` to the codes and to `SCHOOL_RULES`. `:107-109` `radd_rule`: return the later-scholars code for Maliki and Shafi'i and `RADD` for the others. `:124-126` `allows_radd`: delete it, since every Sunni school now allows radd (Jafari is refused earlier, by `check_school`).
- `calc/models.py:705-707` -- delete the refusal. The radd block at `:708-712` already applies to all schools. Tagging at `:858-859` goes through `radd_rule`.
- `calc/proof.py:123-131` -- add a `school_rule` label for the new code, e.g. "Later Maliki and Shafi'i scholars: the remainder is returned to the heirs other than a spouse, in proportion to their shares".
- `locale/{ar,en,fr}/LC_MESSAGES/django.po` (+ `.mo`) -- the new label. Remove the `radd_disputed` msgid.
- `calc/tests.py:1904-1905,1923` -- `RADD_DISPUTED` rows: turn them into results equal to Hanbali's. `:1979` is a test asserting the refusal. `:2060-2061` lists the refusals each school allows. `:2133-2146` is the core-family sweep: drop its `refused` branch so all 446×4 families are checked against the reference. `:2296-2365` holds the proof radd tests, which check `'radd'` per school: expect the new code for Maliki and Shafi'i.
- `api/contracts/interview.json:38` -- remove `radd_disputed` from `previewReasons`.
- `api/contracts/preview-fixtures.json:2299-2345` -- change "Maliki radd is refused" into an available result, retitled "Maliki mother and daughter take radd by the later scholars", with the response body exactly as the engine serves it (proof included).
- `api/tests.py:1394` -- remove that title from the refused list. `:1370` -- add an assertion that the new fixture's `school_rules` is `['radd_later_scholars']`.
- `web/src/api/case.ts:444` -- remove `"radd_disputed"` from the reasons list.
- `web/src/i18n/messages.ts:293,466,639` -- remove the `radd_disputed` messages. They are typed by the reasons list, so the compiler enforces the removal.
- `web/src/interview/preview.test.ts:135` -- remove the "public treasury" assertion.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- add `resolved_by` to the entries at `:353` (decide radd), `:363` (refusal text) and `:418` (this item).

## Tasks & Acceptance

**Execution:**
- [x] `calc/schools.py`, `calc/models.py` -- add the new code, have `radd_rule` choose by school, delete the refusal and `allows_radd` -- this is the engine change.
- [x] `calc/proof.py`, `locale/*` -- add the label in three languages, remove the reason text, rebuild the `.mo` files -- the proof vocabulary must cover every code.
- [x] `calc/tests.py` -- turn the refusal rows into results, add the I/O matrix cases, check every core family under all four schools, and expect the new code in the proof tests -- this proves the result matches Hanbali.
- [x] `api/contracts/*.json`, `api/tests.py` -- remove the reason and turn the fixture into a result -- the contract has to follow the engine.
- [x] `web/src/api/case.ts`, `web/src/i18n/messages.ts`, `web/src/interview/preview.test.ts` -- remove the reason -- no dead code stays.
- [x] `deferred-work.md` -- mark the three entries resolved.

**Acceptance Criteria:**
- Given any family from `families()`, when it is computed under Maliki or Shafi'i, then it never raises `radd_disputed`, and its fractions equal Hanbali's whenever no other school rule applies to it.
- Given `grep -rn radd_disputed` over `calc api web/src locale`, when it is run, then it finds nothing.
- Given a Maliki radd case in the preview API with `Accept-Language: ar`, when it is requested, then `school_rule_labels` holds a translated Arabic label.

## Verification

**Commands:**
- `python manage.py test calc api` -- expected: all pass.
- `cd web && npm run lint && npm run typecheck && npm test` -- expected: all pass.

## Suggested Review Order

**Engine: Maliki and Shafi'i give radd**

- Entry point: the school now picks only the proof code, never whether radd happens.
  [`schools.py:106`](../../calc/schools.py#L106)

- The refusal is gone; the shared radd block now runs for every Sunni school.
  [`models.py:705`](../../calc/models.py#L705)

- The new stable code, listed in `SCHOOL_RULES` so the proof vocabulary covers it.
  [`schools.py:29`](../../calc/schools.py#L29)

**Proof label and translations**

- English label; states the spouse exclusion, unlike the plain `radd` label.
  [`proof.py:129`](../../calc/proof.py#L129)

- Arabic text (French alongside); unreviewed, logged in deferred-work.
  [`django.po:2513`](../../locale/ar/LC_MESSAGES/django.po#L2513)

**Contract and web: `radd_disputed` removed**

- The reason list no longer offers the dead refusal.
  [`interview.json:38`](../../api/contracts/interview.json#L38)

- Web reason list; messages are typed by it, so the compiler enforces the removal.
  [`case.ts:441`](../../web/src/api/case.ts#L441)

- The refused fixture is now an available result, served exactly as the engine computes it.
  [`preview-fixtures.json:2300`](../../api/contracts/preview-fixtures.json#L2300)

**Tests**

- Maliki/Shafi'i proof equals Hanbali's except the code; the wife is never tagged.
  [`tests.py:2308`](../../calc/tests.py#L2308)

- Per-school radd code table drives the existing radd proof tests.
  [`tests.py:2156`](../../calc/tests.py#L2156)

- Former refusal rows are now results equal to Hanbali's.
  [`tests.py:1907`](../../calc/tests.py#L1907)

- All 446 core families now checked against the reference under all four schools.
  [`tests.py:2127`](../../calc/tests.py#L2127)

- Arabic label is served for the new fixture.
  [`api/tests.py:1397`](../../api/tests.py#L1397)
