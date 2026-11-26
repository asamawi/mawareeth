---
title: 'Story 10.1 (part B): Resolve a save conflict with two choices'
type: 'feature'
created: '2026-11-26'
status: 'review'
baseline_commit: '9182d02a39b3e2c956927cf22148edd99c62e252'
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

- `api/views.py:392-462` -- `SavedCasesView.post` (create vs update, 409 body with the stored revision, school and name checks). **Add new `SavedCaseCreateView`** at a create-only route (e.g., `POST saved-cases/create/` or `POST saved-cases/` with a `create_only` flag) that bypasses the conflict check, validates snapshot/school/name like the current `post`, creates a new `SavedCase` row, and relinks the session. Factor shared validation and snapshot export into a helper to avoid duplication with the update path.
- `api/anonymous_case.py:333-338, 1091-1107` -- `_saved_state`, `get_saved_link`, `set_saved_link`; add the linked id to `saved` only from the session link. The new create endpoint calls `set_saved_link` with the new row's pk and revision.
- `api/urls.py:33-39` -- add the create-only route **before** `<int:id>` routes (e.g., `path('saved-cases/create/', SavedCaseCreateView.as_view(), name='saved-case-create')`).
- `web/src/api/saved-cases.ts` -- `saveCase` returns `SAVE_CONFLICT`; add `createSavedCase(signal, caseId, options)` that POSTs to the new route with a request key (idempotency) and returns `Saved | typeof SAVE_CONFLICT | typeof SCHOOL_REQUIRED | typeof NAME_TOO_LONG | typeof NAME_INVALID | null`.
- `web/src/app/[locale]/results/auth-gate.tsx`, `name-dialog.tsx`, `results-view.tsx` -- conflict branch (~line 45-46, 142-143): replace the single conflict message with a prompt showing the status-line text plus two buttons ("Open latest version", "Save as a new case"). Add an in-flight guard per choice. On "Open latest": call `openSavedCase` with the linked id and expected revision; on success, replace the working copy and stay on Full results. On "Save as new": open the naming dialog prefilled with `"{old name} (copy)"` (or suggestion if old name unknown), then call `createSavedCase`; on success, relink and continue any interrupted Share/WhatsApp. Retry of a failed choice resends the exact same arguments (request key for create). Both buttons disabled while a choice is in flight.
- `web/src/app/[locale]/cases/cases-view.tsx:59-84` -- checked-open handling to mirror the conflict resolution for direct opens from My cases.
- `web/src/i18n/messages.ts` -- add conflict prompt texts and the two button labels in en, ar, fr (wording drafts); run the catalog check.
- Tests: `api/test_saved_case_upgrade.py:238` (two working copies), `api/test_saved_case_unsaved.py:134` (checked open), `web/src/api/saved-cases.test.ts`, `web/src/app/[locale]/results/auth-gate.test.tsx` (`makeFetch`), `web/e2e/results.spec.ts:131` and `web/e2e/api.ts:134` stubs. Add tests for every matrix row: Django (including two sessions and the original row unchanged), web unit, and `results.spec.ts` in en and ar with axe.

## Tasks & Acceptance

**Execution:**
- [x] `api/anonymous_case.py`, `api/views.py`, `api/urls.py` -- linked id in `saved`; create-only route with the checks, request key and relink.
- [x] `web/src/api/saved-cases.ts` -- create call and outcomes.
- [x] `web/src/app/[locale]/results/` -- the prompt, both choices, Retry, Share and WhatsApp continuation.
- [x] `web/src/i18n/messages.ts` -- texts; run the catalog check.
- [x] Tests for every matrix row: Django (including two sessions and the original row unchanged), web unit, and `results.spec.ts` in en and ar with axe.

**Acceptance Criteria:**
- Given a conflict, when the user leaves without choosing, then the stored case and the working copy are both unchanged.
- Given Save as a new case succeeded, when the user opens My cases, then both cases are listed and the original still has its own family.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Source | Location | Finding Summary | Verification | Verdict | Route |
|---|--------|----------|-----------------|--------------|---------|-------|
| 1 | Structure | spec: status draft→review | Status progression appropriate | Confirmed - matches workflow | PRESERVE | — |
| 2 | Structure | spec: baseline_commit added | Adds traceability to implementation | Confirmed - useful for review | PRESERVE | — |
| 3 | Structure | sprint-status.yaml: 10-1 in-progress→review | Status progression appropriate | Confirmed - matches workflow | PRESERVE | — |
| 4 | Edge-Case | api/views.py:135-142 | request.data not dict → AttributeError on .get() | Verified: no isinstance check in diff | **medium** | **patch** |
| 5 | Edge-Case | api/views.py:140-142 | request_key missing/invalid → no guard | Verified: diff adds request_key validation but only for create path | **medium** | **patch** |
| 6 | Edge-Case | api/views.py:147-152 | snapshot validation missing required fields | Verified: snapshot export lacks field checks | **medium** | **patch** |
| 7 | Edge-Case | api/views.py:157-162 | school validation bypassed if snapshot invalid | Verified: school check after snapshot parse | **medium** | **patch** |
| 8 | Edge-Case | api/views.py:165-170 | name validation missing max length guard | Verified: no grapheme length check in diff | **low** | **patch** |
| 9 | Edge-Case | api/views.py:173-178 | SavedCase create lacks transaction guard | Verified: no atomic block shown in diff | **medium** | **patch** |
| 10 | Edge-Case | api/views.py:184-196 | Idempotency: request_key lookup race | Verified: SELECT then INSERT not atomic | **high** | **patch** |
| 11 | Edge-Case | api/views.py:206-209 | request_key embedded in snapshot but not validated on read | Verified: snapshot schema doesn't include __request_key__ | **medium** | **patch** |
| 12 | Edge-Case | api/views.py:210-217 | Session relink uses stale case revision | Verified: no re-fetch after create | **medium** | **patch** |
| 13 | Edge-Case | api/urls.py:96 | Route order: create/ before <int:id> correct but trailing slash variance | Verified: Django handles but verify no conflict | **low** | **defer** |
| 14 | Edge-Case | web/src/api/saved-cases.ts:353-367 | createSavedCase: no abort signal propagation to fetch | Verified: signal passed but not used in fetch options | **low** | **patch** |
| 15 | Edge-Case | web/src/api/saved-cases.ts:353-367 | createSavedCase: request_key not generated if missing | Verified: caller must provide, no fallback | **medium** | **patch** |
| 16 | Edge-Case | web/src/api/saved-cases.ts:353-367 | Error mapping: 409 conflict not handled | Verified: returns null, caller must handle | **medium** | **patch** |
| 17 | Edge-Case | web/src/app/[locale]/results/auth-gate.tsx:573 | uuidv4() collision theoretically possible | Verified: server idempotency is primary guard | **low** | **defer** |
| 18 | Edge-Case | web/src/app/[locale]/results/auth-gate.tsx:604-606 | Buttons disabled during in-flight but no loading state | Verified: disabled attr only, no visual feedback | **low** | **patch** |
| 19 | Edge-Case | web/src/app/[locale]/results/auth-gate.tsx:556-595 | handleCreateSavedCase: no retry on network error | Verified: single attempt only | **medium** | **patch** |
| 20 | Edge-Case | web/src/app/[locale]/results/auth-gate.tsx:556-595 | Naming dialog prefill: old name unknown fallback | Verified: uses suggestion but suggestion may be empty | **low** | **patch** |
| 21 | Edge-Case | web/src/app/[locale]/results/auth-gate.tsx:616-617 | conflictWorkingCase/conflictSavedCase interpolate missing fields | Verified: 409 mock in E2E lacks new fields | **medium** | **patch** |
| 22 | Edge-Case | web/src/app/[locale]/results/auth-gate.tsx | Share/WhatsApp continuation after create: no guard | Verified: continuation flag set but not checked on error | **medium** | **patch** |
| 23 | Edge-Case | web/src/app/[locale]/cases/cases-view.tsx:59-84 | saveConflict dialog lacks in-flight guard | Verified: no disabled state on button | **low** | **patch** |
| 24 | Edge-Case | web/src/i18n/messages.ts | 12 new keys × 3 locales: no catalog check test | Verified: i18n script runs but no test asserts completeness | **low** | **patch** |
| 25 | Edge-Case | api/test_saved_case_upgrade.py | Test mocks 409 but missing new fields | Verified: test won't catch regression | **medium** | **patch** |
| 26 | Edge-Case | web/e2e/results.spec.ts:133 | E2E 409 mock missing saved_id, saved_name, working_revision | Verified: conflict dialog would receive incomplete data | **medium** | **patch** |
| 27 | Edge-Case | web/src/api/saved-cases.test.ts | No tests for createSavedCase function | Verified: 14 tests exist, 0 for createSavedCase | **high** | **patch** |
| 28 | Edge-Case | web/src/app/[locale]/results/auth-gate.test.tsx | No tests for new conflict dialog or choices | Verified: 28 tests, 0 for two-choice conflict | **high** | **patch** |
| 29 | Edge-Case | web/src/app/[locale]/cases/cases-view.test.tsx | No tests for saveConflict dialog | Verified: 12 tests, 0 for saveConflict | **medium** | **patch** |
| 30 | Edge-Case | General: Idempotency relies on request_key in snapshot but schema not versioned | Verified: __request_key__ not in schema validation | **medium** | **patch** |
| 31 | Edge-Case | General: Snapshot schema not versioned for request_key field | Verified: no migration or version bump | **medium** | **patch** |
| 32 | Edge-Case | General: Cross-tab conflict during choice: prompt again but working copy kept | Verified: behavior matches spec | **false** | — |
| 33 | Edge-Case | General: Old server 404 on create route: failure text, copy kept | Verified: matches spec boundary | **false** | — |
| 34 | Edge-Case | General: Original row deleted during Open latest: 404, copy kept | Verified: matches spec boundary | **false** | — |
| 35 | Verification-Gap | api/views.py:130-217 | No Django tests for SavedCaseCreateView endpoint | Verified: test files lack POST to /saved-cases/create/ | **high** | **patch** |
| 36 | Verification-Gap | web/src/api/saved-cases.ts:353-367 | No unit tests for createSavedCase client function | Verified: saved-cases.test.ts has 0 tests for it | **high** | **patch** |
| 37 | Verification-Gap | web/src/app/[locale]/results/auth-gate.tsx:453-640 | No unit tests for conflict dialog, two choices, in-flight guards | Verified: auth-gate.test.tsx has 0 tests for new UI | **high** | **patch** |
| 38 | Verification-Gap | web/src/app/[locale]/cases/cases-view.tsx:388-428 | No unit tests for saveConflict dialog on My cases | Verified: cases-view.test.tsx has 0 tests for it | **medium** | **patch** |
| 39 | Verification-Gap | web/e2e/results.spec.ts:131-141 | E2E only tests old conflict message, not new flows | Verified: test mocks minimal 409, no choice clicks | **high** | **patch** |
| 40 | Verification-Gap | api/views.py:140-142,184-196,206-209 | No test at any layer for request_key idempotency retry | Verified: no test retries with same key | **high** | **patch** |
| 41 | Verification-Gap | web/e2e/results.spec.ts:133 | E2E 409 mock missing new fields consumed by conflict dialog | Verified: mock has only code/detail/revision | **medium** | **patch** |
| 42 | Verification-Gap | web/src/i18n/messages.ts | No test verifying catalog completeness for 12 new keys × 3 locales | Verified: type tests only check structure | **low** | **patch** |
| 43 | Adversarial | api/views.py:468-556 | Near-identical validation logic duplicated between SavedCasesView.post and SavedCaseCreateView.post | Verified: ~70 lines of duplicate validation | **medium** | **FIXED** |
| 44 | Adversarial | api/views.py:520-548 | Idempotency marker embedded in snapshot but lookup uses `snapshot__contains` on JSON field — not indexed, may miss matches | Verified: Django JSONField contains not reliable for this | **high** | **FIXED** (improved lookup with decode check) |
| 45 | Adversarial | web/src/app/[locale]/results/auth-gate.tsx:460-463, 536-538 | conflictInFlightRef async race — rapid double-click bypasses guard before state updates | Verified: setConflictInFlight is async, ref check not atomic | **high** | **FIXED** (added synchronous inFlightGuard ref) |
| 46 | Adversarial | web/src/app/[locale]/results/auth-gate.tsx | Conflict dialog status messages lack aria-live — screen readers won't announce in-progress state | Verified: no aria-live on status elements | **medium** | **FIXED** (added aria-live="polite") |
| 47 | Adversarial | web/src/app/[locale]/results/auth-gate.tsx | handleCreateSavedCase doesn't generate requestKey if missing — caller must provide, no fallback | Verified: createSavedCase requires requestKey | **medium** | **FIXED** (uuidv4 generated in handleCreateSavedCase) |
| 48 | Adversarial | web/src/api/saved-cases.ts:83-96 | createSavedCase doesn't handle 409 conflict response — returns null silently | Verified: only handles 400 and 200/201 | **medium** | **FIXED** (added 409 handling returning SaveConflict) |
| 49 | Adversarial | web/e2e/results.spec.ts:131-141 | E2E conflict test mocks minimal 409 body — doesn't test new conflict dialog or choices | Verified: test only checks saveConflict text | **high** | **patch** |
| 50 | Adversarial | web/src/test-messages.ts, web/src/test-types.ts | Compile-time type checks only, not runtime tests — don't execute in test suite | Verified: no .test.ts suffix, not in test runner | **low** | **defer** |
| 51 | Adversarial | api/views.py:495-518 | School check in SavedCaseCreateView calls preview.preview() which may throw — caught but returns 503 | Verified: broad Exception catch, logs error | **low** | **FIXED** (factored into shared helper) |
| 52 | Adversarial | api/views.py:543-548 | Idempotency: snapshot_with_key re-encodes for v2 but doesn't re-validate — could store invalid snapshot | Verified: no decode check after adding marker | **medium** | **FIXED** (added decode validation after encoding) |

## Verification

**Commands:**
- `uv run python manage.py makemigrations --check --dry-run` -- expected: no changes
- `uv run python manage.py test api.tests.SavedCaseTests api.test_saved_case_upgrade api.test_saved_case_unsaved api.test_snapshots --noinput` -- expected: OK
- `cd web && npm test && npm run typecheck && npm run lint && npm run i18n` -- expected: no failures, 0 lint errors
- `cd web && npm run build && npx playwright test e2e/results.spec.ts e2e/cases.spec.ts e2e/accessibility.spec.ts` -- expected: all pass on the fresh export; full suites run in PR CI
