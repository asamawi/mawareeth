---
title: 'Story 10.0: Warn before unsaved changes to a Saved case are discarded'
type: 'feature'
created: '2026-11-26'
status: 'done'
baseline_commit: '191ea8e13d241cc446e2538fba8c9f48af061169'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Edits to an opened Saved case stay in the session working copy. Opening a case from My cases replaces that copy without asking, so the edits are lost, and nothing in the Interview says they are not saved.

**Approach:** The server tells the client which Case revision the linked SavedCase holds. The Interview shows "Changes not saved to My cases yet" with a link to Full results when the Case is ahead. My cases asks "Discard unsaved changes?" before opening, and the Interview's existing Start over confirmation says the same. This is a stopgap before autosave (10.5).

## Boundaries & Constraints

**Always:**
- Unsaved means the Case revision differs from the one last opened or saved. An old link with no recorded revision is unsaved until the next save or open.
- If the client cannot read the state (network error, malformed body, older server), My cases asks.
- A never-saved Case with a deceased or any heirs also makes My cases ask before opening a Saved case; the Interview notice is not shown for it (owner decision, 2026-11-26).
- Cancel sends no request and keeps the working copy. Confirm discards only the working copy; no SavedCase changes.
- The safe choice has initial focus; Escape cancels; focus returns to the pressed Open button; targets are at least 44 px; text in en, ar and fr (ar and fr pending native review).
- Old clients keep working: the open endpoint's current body and answer stay valid, and new Case fields are additive. No migration. Saves and commands keep their behaviour.

**Never:**
- No autosave, no new Save button, no naming, no conflict choices, no new-Case button in My cases, no `beforeunload` warning.
- Do not change what is stored in a SavedCase, export the new field in snapshots, or bump the Case revision on save.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh open | open row | `saved.revision` equals Case `revision`; no notice | N/A |
| Edit or Undo | accepted command | revisions differ; notice with Full results link | N/A |
| Refused edit | 400 or 409 | state unchanged | N/A |
| Save | POST saved-cases 200 or 201 | revisions equal; notice gone on next Case read | 400, 409, 503: still unsaved |
| Never saved, with deceased or heirs | no link | `saved` is null; no notice; My cases asks | N/A |
| Never saved and empty, or no Case | no link | no notice; opens with no prompt | N/A |
| Old link | no recorded revision | `saved.revision` null; notice and prompt | N/A |
| Open, clean | My cases Open | opens with no prompt | N/A |
| Open, unsaved | My cases Open | prompt; Cancel sends no open; Confirm opens | Open fails: existing error, copy kept |
| Same row, unsaved | Open the linked row again | same prompt | N/A |
| Changed meanwhile | another tab edits between prompt and Confirm | 409, nothing replaced, asked again | N/A |
| State unreadable | case GET fails | prompt; Confirm opens | Open fails: existing error |

</frozen-after-approval>

## Code Map

- `api/anonymous_case.py` -- `set_saved_link` (add `case_revision`), `get_saved_link`, `_decode` (derive `saved`), `_save` (pop derived keys: add `saved`), `export_snapshot` (whitelist, leave), `load_snapshot`, `start` (clears the link).
- `api/views.py` -- saved-cases POST and `OpenSavedCaseView.post` call `set_saved_link`; `conflict_response` for 409; `_with_snapshot` unchanged. `CaseView.post` shows the existing `case_id` + `expected_revision` pattern to reuse.
- `mawareeth/middleware.py` -- already locks the session for case-API writes. Check that the open and save routes are inside its prefix; do not change it.
- `web/src/api/case.ts` -- `Case`, `parseCase`, `fetchCase`. `web/src/api/saved-cases.ts` -- `openSavedCase` returns null on every failure; it needs a conflict outcome.
- `web/src/app/[locale]/cases/cases-view.tsx` -- `open`; the only caller of `openSavedCase`.
- `web/src/app/[locale]/interview/start-case.tsx:553-593` -- Start over confirmation; place the notice near the summary. `auth-gate.tsx` and `share-preview.tsx` show the `<dialog>` pattern.
- `web/src/i18n/messages.ts` -- texts and the `Messages` type.

## Tasks & Acceptance

**Execution:**
- [x] `api/anonymous_case.py` -- record `case_revision` in the link; add derived `saved`: null without a link, else `{revision: int|null}`; never store or export it.
- [x] `api/views.py` -- pass the saved Case's revision from save and open; open accepts optional `case_id` and `expected_revision` (null `case_id` means no current case) and answers the standard 409 before replacing anything.
- [x] `web/src/api/case.ts`, `saved-cases.ts` -- parse `saved` (absent or malformed is unknown); `hasUnsavedChanges`; open with the optional check and a conflict outcome.
- [x] `web/src/app/[locale]/cases/cases-view.tsx` -- read the Case, prompt, confirm with the revision shown, ask again on 409.
- [x] `web/src/app/[locale]/interview/start-case.tsx` -- notice; Start over confirmation adds the unsaved sentence and focuses the safe choice.
- [x] `web/src/i18n/messages.ts` -- texts in three locales; run the catalog check.
- [x] `api/test_saved_case_unsaved.py`, web unit tests, `web/e2e` -- cover every matrix row, both directions and a reload.

**Acceptance Criteria:**
- Given a Saved case is opened and edited, when the visitor opens any row and cancels, then the edit is still in the Interview.
- Given the prompt in Arabic, when used by keyboard, then order, focus return and direction are correct and axe finds no serious issue.
- Given an old client's open request with body `{}`, when sent, then it behaves as before.

## Implementation Notes

- 2026-11-26: first pass by a Sonnet subagent; the parent audit found no browser test of the My cases prompt and some untested matrix rows, so it was sent back before review.
- 2026-11-26: review pass 1 (codex deep, one combined call) patched by the same subagent. Final local checks: 181 targeted Django tests OK (1 skipped); web 730 unit tests; typecheck, lint, i18n clean; Playwright 334 of 334 on a fresh build. The full Django suite was stopped at the owner's request (2026-11-26) and is left to PR CI.

## Spec Change Log

## Review Triage Log

Pass 1, 2026-11-26 (one combined codex deep call; layers bh, ec, vg, cs; duplicates across layers share a row).

- `[high]` `[patch]` (vg, cs) exact Case key set in `api/tests.py` omits `saved`: read in the code, CI would fail; the Verification list did not run that class.
- `[medium]` `[patch]` (bh, ec, vg, cs) after a 409 a clean or absent refresh opens without asking: `go` calls `begin`, which opens when nothing is unsaved; the frozen matrix says asked again.
- `[medium]` `[patch]` (bh, ec, vg) leaving the page during the state read still opens: no unmount guard.
- `[medium]` `[patch]` (bh, ec, vg) a queued close event can clear a reopened prompt: `onClose` only checks `prompt`.
- `[medium]` `[patch]` (bh, ec, vg) focus lost after a failed open: the pressed button is disabled during the request.
- `[low]` `[patch]` (bh, ec, cs) an unreadable stored Case counts as no Case: removing the catch is the direct fix.
- `[medium]` `[patch]` (vg) matching-check, edit, Undo and conflict tests are weaker than the behaviour they name.
- `[low]` `[reject]` (bh, ec, cs) array, scalar, unknown-key and null-revision open bodies: no client sends them, and the old body must stay valid.
- `[low]` `[reject]` (bh, ec, cs) a linked Case with both revisions null: the server always sends an integer revision.
- `[false]` `[reject]` (bh, ec, cs) a never-saved Case with only a School does not ask: owner decision A names a deceased or any heirs.
- `[low]` `[reject]` (bh) failed-open browser test uses a canned answer: the server refuses before replacing, as before this story.
- `[low]` `[reject]` (cs) an old image ignores the check and drops `case_revision`: inherent in additive compatibility, which the frozen block requires; the result is an extra prompt.
- `[low]` `[reject]` (cs) untested variants: full 409 envelope, ID-only check on a live Case, malformed link revision, other Case-carrying answers, share and received exclusion: read as correct; each needs extra tests for a path that shares the tested parser or never reads the session.
- `[low]` `[defer]` (vg) no test races Save or Open with an edit and checks the stored data; the lock was read as covering both routes.

## Design Notes

The state is revision-based, so an Undo back to the saved family still reads as unsaved. That is safe for a stopgap. `saved` rides on the Case so each command answer updates the notice without another request.

## Verification

**Commands:**
- `uv run python manage.py test api.test_saved_case_unsaved api.test_snapshots api.test_saved_case_upgrade api.test_case_commands api.tests.SavedCaseTests --noinput` -- expected: OK
- `cd web && npm test && npm run typecheck && npm run lint && npm run i18n` -- expected: no failures
- `cd web && npm run build && npx playwright test e2e/interview.spec.ts e2e/accessibility.spec.ts` plus the cases spec -- expected: all pass on the fresh export
