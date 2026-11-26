---
title: 'Story 10.1 (part B): Resolve a save conflict with two choices'
type: 'feature'
created: '2026-11-26'
status: 'draft'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-10-1-name-a-case-and-show-whether-saving-succeeded.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When the Saved case changed elsewhere since it was opened, Save, Share and WhatsApp stop with "This case changed elsewhere. Your family is still here." and offer no way forward.

**Approach:** The conflict offers exactly two choices: "Open latest version" (discards the working edits and opens the stored case) and "Save as a new case" (keeps the edits as a new Saved case and links the working copy to it). There is no merge and no overwrite, and nothing changes until a choice succeeds (owner decision, 2026-11-16).

## Boundaries & Constraints

**Always:**
- The same prompt follows a conflict from Save, Share or WhatsApp. It is the status line's conflict text plus the two buttons, keyboard reachable, 44 px targets, en, ar and fr (ar and fr pending native review; wording drafts).
- Each choice names the working Case id and revision and the linked Saved case it was shown; the server checks them under the session lock. If any changed, nothing changes and the prompt is shown again with fresh state.
- Open latest version reuses the checked open (`POST saved-cases/{id}/open/` with `case_id` and `expected_revision`). The working copy is replaced only by a successful open.
- Save as a new case uses a new create-only route, so an older server answers 404 and cannot update the linked row. It reuses the save's snapshot, School and name validation; it creates one row, relinks the working copy to it with the new row's revision and the current Case revision, and never changes the original row or the Case revision.
- Decisions (owner, 2026-11-26): Save as a new case opens the naming dialog prefilled with "{old name} (copy)" in the page's language (cut at 100 graphemes; the default suggestion when the old name is unknown), then saves with that name. Open latest version stays on Full results, reloaded with the stored version.
- A client-made request key makes a retried Save as a new case return the same row instead of creating a second one.
- Both buttons are disabled while a choice is in flight; a failed choice keeps the prompt, the family and a Retry of that same choice.
- After Save as a new case succeeds, an interrupted Share or WhatsApp continues with the new case.
- The linked Saved case id the client needs reaches it only for the session's own link, checked against the owner on every use.

**Never:** Merge, force-overwrite, rebase and resubmit, or an automatic choice. Rename (10.2). Autosave (10.5). Changes to how the conflict is detected.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Conflict on Save | 409 saved_case_conflict | text and two choices; no write | N/A |
| Conflict on Share or WhatsApp | same | same prompt; no link created | N/A |
| Open latest | choose | checked open; stored family loaded | stale: prompt again, copy kept |
| Save as new | choose | 201; new row with the edits; original row unchanged; later saves update the new row | stale: prompt again |
| Retry after timeout | same request key | same row returned; one row only | N/A |
| Double press | two presses | one request | N/A |
| Old server | new route missing | 404: failure text, copy kept, original row unchanged | N/A |
| Original row deleted | choose Open latest | 404: failure text, copy kept | N/A |
| Another tab edits meanwhile | choose either | 409: prompt again with fresh state | N/A |

</frozen-after-approval>

## Code Map

- `api/views.py:392-470` -- `SavedCasesView.post` (create vs update, 409 body with the stored revision, school and name checks); `OpenSavedCaseView.post` (10.0 check). Factor the shared validation and snapshot export rather than copy it.
- `api/anonymous_case.py:333-338, 1091-1107` -- `_saved_state`, `get_saved_link`, `set_saved_link`; add the linked id to `saved` only from the session link.
- `api/urls.py:33-39` -- add the create-only route before `<int:id>` routes.
- `mawareeth/middleware.py:53-109` -- confirms `/saved-cases/` writes take the session lock; do not change.
- `web/src/api/saved-cases.ts` -- `saveCase` (`SAVE_CONFLICT`), `openSavedCase` (`check`, `OPEN_CONFLICT`); add the create call.
- `web/src/app/[locale]/results/auth-gate.tsx`, `name-dialog.tsx`, `results-view.tsx` -- conflict branch (~62), one in-flight guard, Retry of exact arguments, `linked` prop; NameDialog currently always submits through `runSave`.
- `web/src/app/[locale]/cases/cases-view.tsx:59-84` -- checked-open handling to mirror.
- Tests: `api/test_saved_case_upgrade.py:238` (two working copies), `api/test_saved_case_unsaved.py:134` (checked open), `web/src/api/saved-cases.test.ts`, `web/src/app/[locale]/results/auth-gate.test.tsx` (`makeFetch`), `web/e2e/results.spec.ts:131` and `web/e2e/api.ts:134` stubs.

## Tasks & Acceptance

**Execution:**
- [ ] `api/anonymous_case.py`, `api/views.py`, `api/urls.py` -- linked id in `saved`; create-only route with the checks, request key and relink.
- [ ] `web/src/api/saved-cases.ts` -- create call and outcomes.
- [ ] `web/src/app/[locale]/results/` -- the prompt, both choices, Retry, Share and WhatsApp continuation.
- [ ] `web/src/i18n/messages.ts` -- texts; run the catalog check.
- [ ] Tests for every matrix row: Django (including two sessions and the original row unchanged), web unit, and `results.spec.ts` in en and ar with axe.

**Acceptance Criteria:**
- Given a conflict, when the user leaves without choosing, then the stored case and the working copy are both unchanged.
- Given Save as a new case succeeded, when the user opens My cases, then both cases are listed and the original still has its own family.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `uv run python manage.py makemigrations --check --dry-run` -- expected: no changes
- `uv run python manage.py test api.tests.SavedCaseTests api.test_saved_case_upgrade api.test_saved_case_unsaved api.test_snapshots --noinput` -- expected: OK
- `cd web && npm test && npm run typecheck && npm run lint && npm run i18n` -- expected: no failures, 0 lint errors
- `cd web && npm run build && npx playwright test e2e/results.spec.ts e2e/cases.spec.ts e2e/accessibility.spec.ts` -- expected: all pass on the fresh export; full suites run in PR CI
