---
title: 'Ask for the school of law only when it matters'
type: 'feature'
created: '2026-11-13'
status: 'done'
baseline_revision: '8168f724b35855289e59f44b29a636909a08af00'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: [oversized, multiple-goals]
deferred:
  - summary: >-
      api.tests.InterviewAnswerTests.test_edit_heir_keeps_id_and_place_and_derives_gender_again fails on development.
    evidence: |-
      It fails identically at baseline 8168f72 (checked in a clean worktree): the API now returns an `edit_options` object on the edited heir that the test's expected dict lacks. Pre-existing and unrelated to the school change; recorded in deferred-work.md.
    location: >-
      api/tests.py InterviewAnswerTests
    severity: medium
---

<intent-contract>

## Intent

**Problem:** The interview asks for the school of law (madhab) before anything else. Yet most families get the same shares in all four Sunni schools; they differ only where `calc/schools.py` has a school rule (grandfather with siblings, grandmother with her son, mushtaraka, radd, Malikiyya). The owner decided on 2026-11-13 to ask only when it matters.

**Approach:** A case starts with no school (`madhab: null`).
- While it has none, the preview computes the family under all four Sunni schools.
- If all four agree, the case shows one result labelled as the same in all four Sunni schools, and it can be saved, shared and printed with no school.
- If they differ, the preview names the rules behind the difference, shows each school's result and asks the visitor to choose. The chosen school then works exactly as today.
- A case that already has a school keeps it, and that school always wins.

## Boundaries & Constraints

**Always:**
- **Agreement.** The four Sunni schools are hanafi, maliki, shafii and hanbali.
  - They agree only when all four previews are `available` and have, for every heir id, the same `blocked` flag and the same `numerator`/`denominator`, plus equal `unallocated`.
  - Layered (successive-death) cases compare the final `shares` of the whole chain, computed under each school.
  - A refusal from any school (for example `malikiyya_disputed`) means they differ.
- **Preview API** (`api/preview.py` `preview()`).
  - With `case['madhab']` set, behaviour and the response are unchanged.
  - With `madhab` null and the family otherwise ready (deceased, heirs, every later layer non-empty), compute four previews with the case copied and `madhab` overridden (existing rollback-isolated path), then answer:
    - **All agree:** the Hanbali `available` body with `"madhab": null`, `"basis": {..., "madhab": null}` and an added `"agreement": "all"`.
    - **They differ:** `{"status": "choose_school", "basis": {...madhab null...}, "schools": {"hanafi": <available|unavailable body>, "maliki": …, "shafii": …, "hanbali": …}, "rules": [{"code": …, "label": …}]}`. `rules` holds the school-rule codes that appear in some but not all of the available schools' proofs (all layers), in `calc.schools.SCHOOL_RULES` order, plus each refusal reason code with its existing label. Labels are in the request language, reusing the existing translated proof and refusal labels.
  - Not ready stays `{"status": "not_ready"}`.
- **Contracts.** Update `api/contracts/interview.json` (add the `choose_school` status and the `agreement` field) and add `preview-fixtures.json` fixtures: one all-agree single death, one all-agree layered case, one differing case (grandfather with full brother), and one with a Malikiyya refusal. `test_every_fixture_is_served_as_the_engine_computes_it` (or its equivalent) must cover them.
- **Save** (`api/views.py` completeness). A case is complete when it has deceased and heirs, and either a school or `madhab` null with an all-agree comparison. A null-school case whose schools differ is refused with a stable error code `school_required`, and the web shows the choose-school UI. Snapshots store `madhab: null` for all-agree saves.
- **Draft PDF** (`reports/report.py`). The School line shows the new Django msgid "Same result in all four Sunni schools" when `madhab` is null. Add it to `locale/{ar,fr,en}/LC_MESSAGES/django.po`: ar "النتيجة نفسها في المذاهب الأربعة"; fr "Même résultat dans les quatre écoles sunnites"; en identical. Compile the `.mo` files if the repo commits them (follow the existing practice).
- **Web interview** (`web/src/interview/flow.ts`, `start-case.tsx`, `madhabs.ts`, `preview.ts`, `results.ts`):
  - A case with no school opens on the deceased screen; `screenOf` shows the selector only while `changing`.
  - `previewReady` no longer requires a school.
  - The share preview and the results page render the `agreement: "all"` body with the label "Same result in all four Sunni schools".
  - For `choose_school` they render the differ notice, the `rules` labels, and a compact per-school summary (each heir's fraction, or the refusal sentence), followed by a radio choice of the four Sunni schools (no Jafari) with a Continue button. Continue calls the existing `setMadhab` PATCH; after that, everything is as today.
  - The school bar ("Change Madhab") shows only when a school is stored. The existing change/cancel flow and its session-storage record keep working for cases with a school.
- **Web parser and views** (`web/src/api/case.ts`, `saved-cases.ts`, results/shared/received views, share preview). The parser accepts `madhab: null` together with `agreement: "all"`, and the new `choose_school` body. Saved, shared and received lists and views show "Same result in all four Sunni schools" where a school name would appear for a null-school case. Comparisons use heir ids and fractions only.
- **New web text** in `messages.ts` (type + ar/en/fr):
  - `schoolsAgree`: en "Same result in all four Sunni schools", ar "النتيجة نفسها في المذاهب الأربعة", fr "Même résultat dans les quatre écoles sunnites".
  - `schoolsDiffer`: en "The schools of law differ for this family", ar "تختلف المذاهب في هذه الحالة", fr "Les écoles juridiques divergent pour cette famille".
  - `schoolsDifferBecause`: en "Because of:", ar "بسبب:", fr "En raison de :".
  - `chooseSchool`: en "Choose the school of law to follow", ar "اختر المذهب الذي تتبعه", fr "Choisissez l'école juridique à suivre".
  - `saveNeedsSchool`: en "Choose a school of law before saving.", ar "اختر المذهب قبل الحفظ.", fr "Choisissez une école juridique avant d'enregistrer."
  Record all new web and `.po` text for native and fiqh review in deferred-work.md.
- **Tests.**
  - API: agreement true/false, refusal means differ, the layered comparison, save complete and incomplete, unchanged behaviour with a school set, and the PDF label.
  - Web unit: `screenOf` without a school, parser cases, readiness.
  - Playwright (`web/e2e/interview.spec.ts` and the stubs): auto-start lands on the deceased screen (update the old radiogroup expectation); an all-agree preview shows the label; a `choose_school` preview shows the rules and schools, and choosing one PATCHes `madhab`.
- **Backlog.** Add a deferred-work entry noting that null-school previews cost four engine runs per request (it extends the existing "move the preview off database writes" item).

**Block If:**
- The comparison cannot be built from the existing `preview()` path without engine changes in `calc/`.
- Legacy Django pages (`calc/`) break because a session case has a null school.

**Never:**
- No change to the engine's rules, proofs or fixtures for single schools. No Jafari in the late choice.
- No removal of an existing case's stored school. No automatic choice of a school when they differ.
- No new npm or Python dependency. No change to amounts or estate handling.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Agree | null school; wife, son, daughter | `available`, `madhab: null`, `agreement: "all"`; UI label "Same result in all four Sunni schools" | none |
| Differ | null school; grandfather + full brother | `choose_school`; `rules` includes `grandfather_blocks_siblings` and `grandfather_shares_with_siblings`; four school bodies | none |
| Refusal | null school; Malikiyya family | `choose_school`; `schools.maliki.status == "unavailable"`; `rules` includes `malikiyya_disputed` | none |
| School set | `madhab: "hanafi"` | response identical to before this change | none |
| Layered agree | null school; two deaths agreeing in every school | `available` layered body with `agreement: "all"` | none |
| Save differ | null school, schools differ | save refused with `school_required` | UI shows the choose-school block |
| Save agree | null school, all agree | saved; snapshot `madhab: null`; list shows the agree label | none |
| PDF agree | null school, all agree | School line "Same result in all four Sunni schools" | none |

</intent-contract>

## Code Map

- `api/preview.py:121-219` -- `preview()` (readiness at ~185, single/layered paths, rollback isolation at 121/194, proof labels at 85). Add the comparison here or in a helper beside it.
- `calc/schools.py:16-36,163` -- `SUNNI`, `SCHOOL_RULES`, refusal reasons (read-only).
- `calc/proof.py:217` -- proof `school_rules` per layer (read-only source for `rules`).
- `api/anonymous_case.py:20,248,308,671` -- case parsing (null madhab allowed), `set_madhab`, snapshot export.
- `api/views.py:79,246` -- madhab PATCH endpoint; save completeness.
- `api/contracts/interview.json:56`, `api/contracts/preview-fixtures.json` -- vocabulary and fixtures; `api/tests.py:1296` fixture test; `api/tests.py:337,951,1424,1508,3173` tests that pin school behaviour.
- `reports/report.py:103` -- `SCHOOLS[body['madhab']]` School line.
- `locale/*/LC_MESSAGES/django.po` -- new msgid.
- `web/src/interview/flow.ts:175,199,252,509,566-651` -- `screenOf`, `pick`, change/cancel, restore, `choose`.
- `web/src/interview/madhabs.ts:13,53` -- selection store; selector precedence (default Hanbali).
- `web/src/app/[locale]/interview/madhab-selector.tsx:46`, `start-case.tsx:311,401` -- selector and school bar.
- `web/src/interview/preview.ts:8,80`, `web/src/interview/results.ts:27` -- preview keys/readiness.
- `web/src/api/case.ts:432,771,816,1200` -- `setMadhab`, the strict preview parser.
- `web/src/app/[locale]/interview/share-preview.tsx:43`, `results/results-view.tsx:51,159`, `shared/shared-view.tsx:92`, `received/received-view.tsx:87`, `web/src/api/saved-cases.ts:26` -- consumers that index the school name.
- `web/src/i18n/messages.ts:762` -- selector keys; add the new keys.
- `web/src/interview/flow.test.ts:462`, `web/e2e/interview.spec.ts:40`, `web/e2e/api.ts` -- tests pinning school-first.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- review and cost entries.

## Tasks & Acceptance

**Execution:**
- `api/preview.py` (+ helper) -- the four-school comparison and the two response shapes.
- `api/views.py`, `api/anonymous_case.py` -- save completeness with `school_required`; snapshot with a null school.
- `api/contracts/interview.json`, `api/contracts/preview-fixtures.json`, `api/tests.py` -- contract, fixtures and the matrix tests.
- `reports/report.py`, `reports/tests.py`, `locale/*/django.po` -- the PDF label.
- `web/src/api/case.ts`, `web/src/api/saved-cases.ts` -- parser and types.
- `web/src/interview/{flow,preview,results,madhabs}.ts` + tests -- flow without the school gate.
- `web/src/app/[locale]/interview/{start-case,share-preview,madhab-selector}.tsx`, `results/results-view.tsx`, `shared/shared-view.tsx`, `received/received-view.tsx`, cases list -- rendering and the late choice.
- `web/src/i18n/messages.ts` -- new keys.
- `web/e2e/*` -- updated and new browser scenarios.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- review and cost entries.

**Acceptance Criteria:**
- Given a new visitor, when the interview starts, then the first screen asks about the deceased, not the school.
- Given a family on which all four schools agree, when heirs are added, then the preview and results show one result labelled "Same result in all four Sunni schools", and save, share and PDF work without a school.
- Given a family on which the schools differ, when heirs are added, then the visitor sees which rules differ and each school's result, and must choose a school before results can be saved. After choosing, everything behaves as before this change.

## Spec Change Log

## Review Triage Log

### 2026-11-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 2, low 5)
- defer: 1: (high 0, medium 1, low 0)
- reject: 70: (high 0, medium 6, low 64)
- addressed_findings:
  - `[medium]` `[patch]` When the schools differ but no school-rule code differs, the server sent `rules: []`, and the web parser rejected it, so the visitor saw a generic failure. The parser now accepts an empty list and the choice hides "Because of:". Parser and API tests added.
  - `[medium]` `[patch]` The save-comparison failure (503), the draft PDF for a differing null-school case (409 `choose_school`, nothing rendered) and the all-agree case, and shared/received views of a null-school snapshot were untested. Tests added.
  - `[low]` `[patch]` The Arabic agree label omitted "Sunni" while en/fr said it. It is now "النتيجة نفسها في المذاهب السنية الأربعة" in `messages.ts` and the ar `.po`/`.mo`.
  - `[low]` `[patch]` The "choose a school before saving" message stayed after a school was chosen. `AuthGate` is keyed on case and school, and `onSchoolRequired` is a stable callback.
  - `[low]` `[patch]` An unrelated failed action showed a school-choice error. The failure is now passed only when it came from the choose action.
  - `[low]` `[patch]` Continue with no school picked did nothing. It now shows the choose prompt in `role="alert"`, covered by e2e.
  - `[low]` `[patch]` The results-page choice left its request running after unmount. It now aborts on unmount and skips later state updates.

## Auto Run Result

**Summary:**
- New cases start the interview with the deceased; there is no school question.
- While a case has no school, the preview computes all four Sunni schools.
  - **All agree:** it returns one result marked `agreement: "all"`, labelled "Same result in all four Sunni schools" in the interview, the results page, the saved list, shared/received views and the draft PDF, and the case saves with `madhab: null`.
  - **They differ:** it returns `choose_school` with each school's result and the school rules behind the difference. The visitor picks one of the four (no Jafari), and the existing school PATCH then drives everything as before.
- Saving a differing null-school case is refused with `school_required`.
- Cases with a stored school behave exactly as before.
- One addition beyond the spec: when all four schools refuse for the same reason, the preview returns that single refusal instead of a pointless choice.

**Files changed:**
- **API:** `api/preview.py` (comparison and agreement), `api/views.py` (save completeness and `school_required`), `api/contracts/interview.json` and `preview-fixtures.json` (new statuses, fields and four fixtures), `api/tests.py`.
- **PDF:** `reports/report.py` and `reports/tests.py`; `locale/{ar,en,fr}/LC_MESSAGES/django.po` and `.mo` (the PDF label; `.mo` compiled with polib because `msgfmt` is unavailable).
- **Web parsers and flow:** `web/src/api/case.ts` and `saved-cases.ts`; `web/src/interview/{flow,preview,results}.ts` and their tests.
- **Web views:** `web/src/app/[locale]/interview/{start-case,share-preview,school-choice}.tsx`, `results/{results-view,auth-gate}.tsx`, `cases/cases-view.tsx`.
- **Text and tests:** `web/src/i18n/messages.ts` (five new keys), `web/e2e/{api,interview.spec}.ts`.
- **Backlog:** `_bmad-output/implementation-artifacts/deferred-work.md`, with native/fiqh review of the new text and the four-engine-runs cost.

**Review findings:** 7 patches applied (2 medium, 5 low), 1 deferred (an already failing test), 70 rejected. The main rejections:
- The agreeing result shows the Hanbali proof and table: the numbers are identical by definition.
- "Available schools agree but one refuses" is treated as differ: the intent says agreement requires that no school refuses.
- An all-refuse null-school case can be saved: before this change such a case could be saved with a school.
- Jafari has no late-choice path: it stays unsupported by the intent.
- Cost: four engine runs per preview, save, shared view and PDF; already deferred.
- One school's engine error gives a 503 for the whole preview: same as the single-school behaviour.

**Follow-up review recommendation:** true. Patched: high 0, medium 2, low 5. Score 3×2 + 5 = 11.

**Verification:**
- `uv run python manage.py test api reports mawareeth --noinput`: 398 tests, 1 failure, 1 skipped. The only failure is the pre-existing `InterviewAnswerTests.test_edit_heir_keeps_id_and_place_and_derives_gender_again`, which also fails at baseline 8168f72.
- In `web/`: `npm run lint` (0 errors), `npm run typecheck`, `npm test` (477 pass), `npm run build`, `npm run test:e2e` (47 pass).
- `calc` was not run: there are no engine changes.

**Residual risks:**
- Four engine runs per null-school request: latency and database load (deferred).
- All new ar/en/fr and `.po` text needs native and fiqh review.
- A saved null-school case is re-compared when opened. If the engine's rules ever change so the schools stop agreeing, it will ask for a school.
- The results-page choice and the save-needs-school path have unit coverage but no browser test.

## Verification

**Commands:**
- `uv run python manage.py test api reports mawareeth --noinput` -- expected: pass.
- `uv run python manage.py test calc --noinput` -- expected: pass (unchanged engine).
- `cd web && npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e` -- expected: pass.
