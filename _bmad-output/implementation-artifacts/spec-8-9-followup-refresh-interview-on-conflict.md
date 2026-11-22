---
title: 'Story 8.9 follow-up: refresh the Interview in place on a same-case revision conflict'
type: 'bugfix'
created: '2026-11-22'
baseline_revision: '5c581f6a663af37a1ab63a74e6037785b89f16c7'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/web/AGENTS.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The edit sheet's typed name is still lost on a same-case conflict, including the preliminary name write of a sheet-origin "died later".
    evidence: |-
      The sheet's name draft requires `draft.basis === view.case` (edit-sheet.tsx:83), so adopting the live Case hides it. Before this change these paths lost it too (existing `saveHeir` branch, or the existing-case screen). Keeping it safely needs an explicit-retry design because the sheet saves on blur; recorded in deferred-work.md.
    location: >-
      web/src/app/[locale]/interview/edit-sheet.tsx:83; web/src/interview/flow.ts:1207
    severity: medium
---

<intent-contract>

## Intent

**Problem:** When another tab changed the same Case first, the server answers a write with 409 `{error:"conflict", case}` carrying the live Case. Panel, bulk, tree adds, edit/delete from the sheet and Undo already refresh in place. But the deceased form, the legacy heir form (`addHeir` without `origin`), mark/unmark death and the school choice still fall through to the existing-case screen ("You already have a case in progress…"). That screen also clears the tab's form and selection records, so the visitor loses unsent input.

**Approach:** In the web Interview flow, treat a `replaced` result whose `case.id` equals the submitted case id as a same-case conflict for every answer kind and for `choose`. Adopt the live Case in place, keep the screen, the open form and its stored values, and show the existing `conflictNotice` alert. Never resend automatically. A different case id keeps today's existing-case behaviour.

## Boundaries & Constraints

**Always:**
- Tell the two cases apart by comparing `result.case.id` with `from.case.id`, because the server sends the same 409 body for both.
- A same-case conflict leaves `deps.forms` and `deps.selection` as they are, except when the person being edited is gone from the live Case: then use the existing `restoreHeirForm` and close the edit (`editingHeir: null`, `formEpoch + 1`), as the sheet branch does today.
- Adopt the live Case through `reconcileFresh`, with `saving: false`, `errors: null`, `notice: null`, `confirming: undefined`, `conflict: true`. Keep `editingDeceased` and `changing` so the visitor stays on the same screen.
- Show `messages.conflictNotice` as `role="alert"` on the selector and deceased screens as well as on the heirs screen, where it already appears.
- Leave the existing same-case branches (panel, tree, `saveHeir`/`removeHeir`, Undo) unchanged in behaviour.

**Never:**
- No API, server or wire-format change. No new message keys and no change to any ar/en/fr text.
- Do not resubmit, rebase or merge the visitor's values into the live Case.
- Do not change `fetchPreview`'s `replaced` handling or the start/exists flow.
- Do not keep the edit sheet's unsent draft across a conflict (see Design Notes).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Deceased save, same case | Deceased form open with typed values; POST returns 409 with live case of the same id at a newer revision | Still the deceased form, typed values kept, conflict alert, view case is the live case; one write | Not resent |
| First deceased save, live case already has a deceased | `case.deceased === null` in tab, live case has a deceased | Stays on the deceased form (`editingDeceased: true`) with typed values and alert | — |
| Legacy heir form add, same case | Heir form with typed name and relationship | Heirs screen, form keeps its values (no remount), alert, live case shown | — |
| Mark/unmark death, same case | Row or sheet action | Heirs screen with live case, alert, pending order/relatives questions cleared; if the edited person is gone the sheet closes and the parked new-heir draft is restored | — |
| School change, same case | Selector open, another school picked | Selector stays open with the visitor's pick, alert, live case adopted | Not resent |
| Any of the above, different case id | 409 case with another id | Existing-case screen, form/selection records cleared, as today | — |

</intent-contract>

## Code Map

- `web/src/interview/flow.ts` -- view logic.
  - `choose` (~line 783): `case "replaced"` at ~816 always goes to `existing`. Add the same-id branch.
  - `settled` `case "replaced"` (~1272-1307): same-id branches exist for `saveHeir`/`removeHeir` and panel/tree. Everything else falls through to `existing` at ~1303. Add a general same-id branch before that fallthrough.
  - `undone` (~1133) is the closest model for the generic branch: `estateModel(...).people.some(...)` gone check, `restoreHeirForm`, `reconcileFresh`, `conflict: true`.
  - Helpers: `reconcileFresh` (~1107), `restoreHeirForm` (~358), `keepLayer`, `estateModel`, `nextFocus`. `screenOf` (~230) decides the screen from `changing` and `editingDeceased`.
  - Answer kinds: union at ~611-624.
  - `conflict` is cleared by later actions (~306, 421, 459, 471, 478, 1033, 1040, 1235). Check that a later successful save on the deceased and selector screens also clears it.
- `web/src/app/[locale]/interview/start-case.tsx`
  - The selector renders at ~587 and the deceased form at ~608. The heirs-screen conflict alert is at ~678 (`started.conflict && !editingPerson`).
  - `DeceasedForm` is keyed `deceased-${case.id}` and `MadhabSelector` is keyed `case.id`. `HeirForm` uses `heirFormKey(started)`. These keys must not change on a same-case conflict, so local values survive.
- `web/src/interview/flow.test.ts`
  - Existing tests "Choose: a replaced case shows the existing-case view" (~399) and "Stale tab: the existing-case view…" (~836) use `NEW_CASE`, a different id, and must keep passing.
  - Helpers: `deps`, `runAction`, `startedOf`.
- `web/e2e/interview.spec.ts` -- the "a stale revision with the same case id shows the returned case and an alert" test (~510) is the model for route fixtures (`json(409, {case: live})`). The fixture helpers are in `web/e2e/api.ts`.
- `web/src/i18n/messages.ts` -- `conflictNotice` (~750) is reused as is (read-only).
- `_bmad-output/implementation-artifacts/deferred-work.md` -- the "Story 8.9 follow-ups" bullet about same-Case revision conflicts.

## Tasks & Acceptance

**Execution:**
- `web/src/interview/flow.ts`
  - In `settled`, add a same-id `replaced` branch for the remaining answer kinds (`saveDeceased`, legacy `addHeir`, `markDeath`, `unmarkDeath`), per Boundaries.
  - In `choose`, add a same-id branch that keeps `changing` and `deps.selection`.
  - Make sure a later successful save on those screens clears `conflict`.
- `web/src/app/[locale]/interview/start-case.tsx` -- render the `conflictNotice` alert on the selector and deceased screens when `started.conflict`.
- `web/src/interview/flow.test.ts`
  - Add unit tests for each matrix row: `saveDeceased` including the first-deceased case, legacy `addHeir`, `markDeath`, `unmarkDeath` including the person-gone case, and `choose`.
  - Each test asserts the live case, `conflict: true`, the unchanged screen, the form or selection record kept, and no second write.
  - Keep the different-id tests.
- `web/e2e/interview.spec.ts` -- add Playwright tests:
  - **Deceased:** edit the deceased, answer 409 with the same-id live case. Assert the deceased form is still shown with the typed value, the conflict alert is visible, there was exactly one write, and the existing-case screen is absent.
  - **School:** do the same for a school change on the selector.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- mark the Story 8.9 same-Case conflict bullet resolved (state what now refreshes in place), and add a bullet for the edit-sheet draft that is still not kept.

**Acceptance Criteria:**
- Given the Interview on any screen and a write that returns 409 with the same case id, when it settles, then the visitor stays on that screen with the live Case, their unsent form or school pick is kept, `conflictNotice` is announced as an alert, and nothing is resent.
- Given a 409 carrying a different case id, when it settles, then the existing-case screen appears exactly as before.
- Given the unit tests, lint, typecheck, build and the interview Playwright spec, when run, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-11-22 — Review pass (all five layers in one combined read-only codex call, standard tier; diff 15.85 kB)
- verdicts: 16 findings — high 3, medium 7, low 6, false 0, maybe-false 0
- findings (blind-hunter):
  - `[high]` `[patch]` A school conflict adopts the live revision but keeps this tab's Undo history, so a later Undo restores an old snapshot at the live revision and overwrites the other tab. `choose` never runs `recorded()`. Fix: clear history and toast in the `choose` same-id branch, with a unit assertion.
  - `[low]` `[reject]` If another tab removed the active later estate, `reconcileFresh` blanks the legacy heir draft. The draft's estate no longer exists, so it has no target, and before this change the existing-case screen dropped it too. Parking per-estate drafts adds state for a rare race.
  - `[medium]` `[patch]` A death conflict removes the focused order/relatives question controls without requesting focus. Fix: focus the sheet's died-later status, the row's also-died control or the root card, as `deathRefused` does.
  - `[medium]` `[defer]` A name typed in the edit sheet is lost when the preliminary name write of a sheet-origin "died later" conflicts. This was already the case before the change (existing-case screen; the `saveHeir` branch reseeds too). Recorded in frontmatter `deferred` and deferred-work.md.
  - `[low]` `[patch]` Continuing with a school that the live case already has keeps `conflict: true`, so the next screen shows a stale alert. Fix: the no-write path sets `conflict: false`.
- findings (edge-case-hunter):
  - `[high]` `[patch]` Undo after a school conflict: same root cause as the first blind row.
  - `[low]` `[reject]` Draft lost when the active estate disappears: same as the blind row.
  - `[medium]` `[patch]` Focus falls to the body when a death question closes: same root cause as the blind focus row.
  - `[medium]` `[defer]` Sheet-origin death name write: same as the blind row.
  - `[low]` `[patch]` Stale conflict alert after a no-write Continue: same as the blind row.
  - `[low]` `[reject]` (claim) Death order and relatives answers are cleared on conflict. The live Case can ask different questions, so the old answers may no longer apply. Before this change they were lost with the whole Interview, and reconciling them against new server questions adds logic.
  - `[low]` `[patch]` (claim) The unmarkDeath test never asserts that the form record is kept when the person survives. Fix: assertion added.
- findings (verification-gap):
  - `[medium]` `[patch]` Nothing checks that an explicit second submit after a conflict uses the live revision and the kept input. Fix: both Playwright tests now resubmit and assert the second request body.
  - `[medium]` `[patch]` Focus after a death conflict is unverified. Fix: unit assertions on `view.focus` with the focus fix.
  - `[high]` `[patch]` (other) School choice bypasses Undo invalidation: same root cause as the first blind row.
- findings (intent-alignment):
  - `[medium]` `[defer]` The diff implements the narrower reading (close the remaining existing-case fallbacks). The broader reading (every unsent input, including edit-sheet text, death answers and a draft for a removed estate) diverges at the rendered inputs. Edit-sheet text loss predates this change and is deferred. Death answers and the removed-estate draft are rejected above.
- findings (cross-story-contract): none ("No contract shape changed").

## Design Notes

The edit sheet's unsent name draft is excluded. The sheet saves on blur, so keeping a stale value in a field could resend it on the next blur and silently overwrite the other tab's change. Keeping it safely needs an explicit-retry design, which is recorded in deferred-work.md.

## Verification

**Commands:**
- `cd web && npm test` -- expected: all pass.
- `cd web && npm run lint && npm run typecheck` -- expected: 0 errors; at most 12 lint warnings.
- `cd web && npm run build && npx playwright test e2e/interview.spec.ts e2e/accessibility.spec.ts` -- expected: all pass.

## Auto Run Result

Status: done

**Summary:** A same-case revision conflict (409 whose live Case has the submitted id) now refreshes the Interview in place for the deceased form, the legacy heir form, mark/unmark death and the school choice. These already worked in place: panel, bulk and tree adds, sheet edit/delete, and Undo. The visitor keeps their screen, open form values and school pick. The live Case is adopted, the existing `conflictNotice` alert shows, and nothing is resent. A different case id still shows the existing-case screen.

**Files changed:**
- `web/src/interview/flow.ts`:
  - Same-id branches in `choose` (clears Undo history and toast) and in `settled`'s `replaced` fallthrough (keeps the screen and form records, clears death questions and moves focus).
  - A no-write Continue clears `conflict`.
- `web/src/app/[locale]/interview/start-case.tsx`: the conflict alert also shows on the selector and deceased screens.
- `web/src/interview/flow.test.ts`: unit tests for each matrix row, Undo clearing, focus and the no-write Continue.
- `web/e2e/api.ts`: a `PUT /api/v1/case/deceased/` stub.
- `web/e2e/interview.spec.ts`: deceased and school conflict tests, each with a resubmit that sends the live revision and the kept value.
- `_bmad-output/implementation-artifacts/deferred-work.md`: the Story 8.9 bullet is marked resolved, and the edit-sheet draft gap is recorded.

**Review findings:** 16 findings. 5 patch groups were applied:
- high, 1: Undo after a school conflict.
- medium, 2: focus after a death conflict; resubmit not verified.
- low, 2: stale alert after a no-write Continue; unmarkDeath record assertion.

1 item is deferred (the edit sheet's typed name, which was already lost before this change). Rejected:
- The removed-estate draft: its estate is gone, it was lost before too, and keeping it needs per-estate parking.
- Death answers cleared on conflict: the live Case may ask different questions, and keeping them needs reconciliation logic.

**Follow-up review recommended: true.** A high entry was patched. The Undo-clearing on a school conflict, and the `alsoDied:<row>` focus target after an unmark conflict, are checked only by unit tests, not in a browser.

**Verification (after patches):**
- `npm test`: 668/668 pass.
- `npm run lint`: 0 errors, 12 warnings.
- `npm run typecheck`: clean.
- `npm run build`: ok.
- `npx playwright test e2e/interview.spec.ts e2e/accessibility.spec.ts`: 145/145 pass.

The implementation subagent had converted three files to CRLF. They were restored to LF before review.

**Residual risks:** see the follow-up recommendation, plus the deferred edit-sheet draft.
