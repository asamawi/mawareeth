---
title: 'Story 10.1 (part B): Resolve a save conflict with two choices'
type: 'feature'
created: '2026-11-26'
status: 'done'
baseline_commit: '9182d02a39b3e2c956927cf22148edd99c62e252'
route: 'dispatch'
review_loop_iteration: 1
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

- `api/models.py` + new migration -- add `SavedCaseCreateRequest(owner FK user CASCADE, request_key UUIDField, saved_case FK SavedCase CASCADE, case_revision PositiveIntegerField, created_at)` with `UniqueConstraint(owner, request_key)`. This is the only place the request key lives; the stored snapshot is never touched for idempotency.
- `api/views.py` -- one shared validation helper for both save routes (name, case_id, completeness, school; export once, encode v2 once, decode check). **Never pass an encoded v2 snapshot back to `encode_v2`.** Add `_conflict_body(case, row)` building `{error:'conflict', code:'saved_case_conflict', detail, revision: row.revision, saved_id: row.pk, saved_name: row.name, working_case_id: case['id'], working_revision: case['revision']}`; the ordinary Save 409 uses it (row fetched with `owner=request.user`).
- `api/views.py` `SavedCaseCreateView` at `POST saved-cases/create/` (`api/urls.py`, before `<int:id>`). Body: `case_id`, `expected_revision`, `saved_id`, `saved_revision`, `request_key` (UUID, canonicalised with `uuid.UUID`), optional `name`. All inside the request's session lock (`CaseLockMiddleware` already holds it for `saved-cases/` writes) and one `transaction.atomic()`, in this order: (1) body shape → 400; (2) replay: a `SavedCaseCreateRequest` for (owner, key) whose row still exists → relink the session to that row with the row's revision and the **recorded** `case_revision`, answer 200 `{id,name,updated_at,revision}`, no other write; (3) stale: current case id ≠ `case_id`, or revision ≠ `expected_revision`, or `anonymous_case.get_saved_link` ≠ `saved_id`, or the owner's linked row missing or its revision ≠ `saved_revision` → 409 `{code:'resolve_stale', conflict: _conflict_body(...) or null when no conflict holds any more, case: _with_snapshot(current)}`, nothing written; (4) shared validation (400/503 as ordinary Save); (5) create one `SavedCase` with the exported snapshot unaltered, name = given name or `default_name` in the asked language; create the request record with the current case revision; `set_saved_link(request, case_id, row.pk, row.revision, case['revision'])`; 201 `{id,name,updated_at,revision}`. The original row and the Case revision never change. Lock timeout → `busy_response()`.
- `web/src/api/saved-cases.ts` -- `saveCase` 409: a `SaveConflict` object only when `saved_id`, `revision`, `working_revision` are integers and `working_case_id`, `saved_name` strings; otherwise the plain `SAVE_CONFLICT` sentinel (text only, no choices). Add `createSavedCase(signal, {caseId, expectedRevision, savedId, savedRevision, requestKey, name?, locale?})` returning `Saved & {revision}` | `{stale: SaveConflict | null, case: Case}` | `SCHOOL_REQUIRED` | `NAME_TOO_LONG` | `NAME_INVALID` | `null`. `openSavedCase` gains an opt-in to return the 409 body's current case (`{kind:'stale', case}`); existing callers keep their behaviour.
- `web/src/app/[locale]/results/auth-gate.tsx` (+ `auth-gate-state.ts` if useful) -- one conflict prompt (status-line text + two buttons, 44 px, keyboard) after Save, Share or WhatsApp; remember which action was interrupted. One synchronous guard shared with Save/Share/WhatsApp; both choices disabled while one is in flight. **Open latest**: checked open with the prompt's working id/revision; success → new `onReplaced()` prop (no router navigation, no `resume=save`), save state reset; stale → update the prompt from the returned case and show it again; 404/null → failure text, prompt kept, Retry resends the same open. **Save as a new case**: NameDialog prefilled with the `copyName` message (`{name}` cut so the whole is ≤ 100 graphemes; the name suggestion when the old name is unknown); Cancel clears the guard and refocuses the choice; submit makes the request key once (`crypto.randomUUID()`), Retry resends identical arguments; success → linked to the new row, status Saved, then an interrupted Share/WhatsApp continues with `createShare(newId)` and its panel; stale → prompt again with fresh state (close the prompt and call `onReplaced()` when `conflict` is null); 404/null → failure text + Retry, copy kept.
- `web/src/app/[locale]/results/results-view.tsx` -- pass `onReplaced` that bumps `attempt` so the stored version reloads.
- `web/src/i18n/messages.ts` -- only the strings the prompt uses: the two labels, busy text, open and create failure texts, `copyName` (en, ar, fr). No case ids or revisions in user text. Run the catalog check.
- `web/e2e/api.ts` -- stub `POST saved-cases/create/` and record its bodies.
- Not changed: `cases-view.tsx`, `package.json` (no `uuid` dependency); no `test-*.ts` scratch files.
- Tests: Django in `api/test_saved_case_upgrade.py` (two sessions, writer 1 and 2): create after conflict → 201, original row unchanged, both listed, the copy reopens with the same heirs, amount and school, a later Save updates the copy; replay with the same key (also upper-case spelling) → 200 same id, one row, with the owner's older original row present; stale working revision, changed link, changed row revision → 409 `resolve_stale`, nothing written. Web unit: `saved-cases.test.ts` (create body incl. key, every outcome, partial 409 → sentinel), `auth-gate.test.tsx` (`makeFetch`): both choices, double press sends one request, cancel re-enables, Retry resends the same URL, body and key, Share and WhatsApp continue to the new id, stale prompts again, open failure text. `results.spec.ts` in en and ar with axe on the prompt: Open latest reloads, Save as new links.

## Tasks & Acceptance

**Execution:**
- [x] `api/models.py`, migration -- `SavedCaseCreateRequest` with the unique constraint.
- [x] `api/views.py`, `api/urls.py` -- shared validation helper, `_conflict_body`, the create-only route in the order above.
- [x] `web/src/api/saved-cases.ts` -- strict conflict parsing, `createSavedCase`, stale-open result.
- [x] `web/src/app/[locale]/results/auth-gate.tsx`, `results-view.tsx` -- the prompt, both choices, Retry, cancel, Share/WhatsApp continuation, reload via `onReplaced`.
- [x] `web/src/i18n/messages.ts` -- texts; run the catalog check.
- [x] `web/e2e/api.ts` and the tests listed in the Code Map.

**Acceptance Criteria:**
- Given a conflict, when the user leaves without choosing, then the stored case and the working copy are both unchanged.
- Given Save as a new case succeeded, when the user opens My cases, then both cases are listed and the original still has its own family.
- Given a Save as a new case whose answer was lost, when Retry resends it, then the same row is returned and only one new row exists.
- Given Open latest version succeeded, when Full results reloads, then it shows the stored family and Save, Share and WhatsApp are enabled.
- Given the conflict came from Share or WhatsApp, when Save as a new case succeeds, then a link for the new case is created and its panel shows.

## Implementation Notes

- Loop 1 patch decision (rows 99, 100, 113, 125, 126): a stale answer that names the **same** working Case shows the prompt again with the fresh revision and does **not** reload Full results, because `onReplaced` bumps `attempt`, which remounts `AuthGate` and would drop the prompt the frozen intent requires. A stale answer naming another Case (or none) closes the prompt and reloads. The edits a same-Case stale answer reports come from the visitor's own working copy in another tab.

## Spec Change Log

- 2026-11-26, review loop 1 (bad_spec). Trigger: review of 26e45084 + cbe37fd0 found (a) idempotency stored as a marker inside the snapshot, which re-encodes v2 snapshots and drops the family on production schema 2, with replay checking only the owner's first row; (b) the create route checking none of the prompt's working or linked state; (c) Open latest navigating with `resume=save` instead of reloading; (d) Retry, cancel and Share/WhatsApp continuation missing or broken; (e) almost no tests for the matrix. Root cause: the Code Map left idempotency storage, the choice's checked arguments, the reload mechanism and the retry/cancel/continuation flow open, and told the create route to "bypass the conflict check". Amended: Code Map (request-record model + migration, ordered create algorithm with a stale 409, strict conflict parsing, `onReplaced` reload, retry/cancel/continuation, localized copy name, e2e stub, no cases-view change, no uuid dependency), Tasks and ACs, Verification (migration expected). Known-bad states to avoid: any write to the snapshot for idempotency; `encode_v2` on encoded data; key lookup not by (owner, key); navigating to `resume=save` after open; a new request key on Retry; Retry falling back to ordinary Save; a guard left set after cancel; case ids or revisions in user text. KEEP: one shared save-validation helper used by both routes; the enriched ordinary-save 409 fields (now via `_conflict_body`); Save/Share/WhatsApp disabled while the prompt is open; the drafted en/ar/fr labels "Open latest version" / "Save as a new case"; `aria-live` on status text.

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
| 53 | Blind | api/views.py:542-544 | v2 copy encodes an encoded snapshot | Read: `{**snapshot, marker}` of a v2 dict passed to `encode_v2`, which reads v1 `heirs` (snapshots.py:89-98); family lost on prod writer 2 | high | bad_spec (A) |
| 54 | Blind | api/views.py:517-518 | Replay inspects only the owner's first row | Read: `.filter(owner=...).first()` with no key filter | high | bad_spec (A) |
| 55 | Blind | api/views.py:470,542 | Key lives in the mutable snapshot; a later Save erases it | Read: ordinary Save replaces `row.snapshot` | medium | bad_spec (A) |
| 56 | Blind | auth-gate.tsx:202,242 | Copy Retry calls ordinary Save with a new key lost | Read: `setRetry({name})` → `runSave` | high | bad_spec (D) |
| 57 | Blind | auth-gate.tsx:187,272 | Cancelling copy naming leaves both choices disabled forever | Read: onCancel never clears `inFlightGuard`/`conflictInFlight` | high | bad_spec (D) |
| 58 | Blind | auth-gate.tsx:169 | Stale open repeats the failed revision | Read: OPEN_CONFLICT only clears busy state | medium | bad_spec (C) |
| 59 | Blind | auth-gate.tsx:169 | Failed open (deleted row) shows nothing | Read: null and stale share a silent branch | medium | bad_spec (C) |
| 60 | Blind | auth-gate.tsx:174,236 | Successful open leaves saveState "conflict", actions disabled | Read: saveState never reset | medium | bad_spec (C) |
| 61 | Blind | auth-gate.tsx:95,215 | Share/WhatsApp not continued after copy | Read: no createShare after create success | high | bad_spec (D) |
| 62 | Blind | saved-cases.ts:38 | Partial 409 accepted as actionable (undefined id, revision 0) | Read: no field checks, `?? 0` | medium | bad_spec (B) |
| 63 | Blind | cases-view.tsx:22,140 | My cases conflict dialog is dead code; its Open does nothing | Read: state only ever set to null | low | bad_spec (E) |
| 64 | Blind | auth-gate.tsx:191 | "(copy)" not localized nor cut at 100 graphemes | Read: literal English suffix, no cut; spec requires both | medium | bad_spec (D) |
| 65 | Edge | api/views.py:518 | Duplicate copies on replay | Same as 54 | high | bad_spec (A) |
| 66 | Edge | api/views.py:525-529 | Replay after edits marks newer working revision saved | Read: relinks with current `case['revision']` | medium | bad_spec (A) |
| 67 | Edge | api/views.py:502 | Copy not checked against the revision the user saw | Read: no expected_revision/saved_id check; intent requires it | high | bad_spec (B) |
| 68 | Edge | api/views.py:238 | Upper/lower-case UUID spellings make different keys | Read: raw string used in marker | low | bad_spec (A) |
| 69 | Edge | auth-gate.tsx:169-171 | Stale open never refreshes | Same as 58 | medium | bad_spec (C) |
| 70 | Edge | auth-gate.tsx:169-171 | Open null shows no failure | Same as 59 | medium | bad_spec (C) |
| 71 | Edge | auth-gate.tsx:272 | Cancel locks both choices | Same as 57 | high | bad_spec (D) |
| 72 | Edge | auth-gate.tsx:176 | Old family stays visible after open | Read: no ResultsView reload | high | bad_spec (C) |
| 73 | Edge | auth-gate.tsx:176 | `resultsResumePath(locale,"save")` triggers an unsolicited save | Read: resume=save path | high | bad_spec (C) |
| 74 | Edge | auth-gate.tsx:223-225 | Separate guards let Save and a choice write concurrently | Read: `saving` vs `inFlightGuard` | medium | bad_spec (D) |
| 75 | Edge | anonymous_case.py:338 | Claimed linked id in `saved` not implemented | Read: `_saved_state` returns only revision; amended plan uses the owner-checked 409 body instead | low | bad_spec (B) |
| 76 | Edge | api/views.py:544 | v2 copy reopens with no heirs | Same as 53 | high | bad_spec (A) |
| 77 | Edge | auth-gate.tsx:242 | Retry of copy goes to ordinary Save | Same as 56 | high | bad_spec (D) |
| 78 | Edge | auth-gate.tsx:215-221 | No share continuation | Same as 61 | high | bad_spec (D) |
| 79 | Edge | web/e2e/results.spec.ts:131-140 | Browser test never selects a choice | Read: stops at conflict text | high | bad_spec (E) |
| 80 | VerifGap | api/views.py:542 | No test that a copy keeps the family | Pre-verified gap | high | bad_spec (E) |
| 81 | VerifGap | api/views.py:518; auth-gate.tsx:242 | No replay / lost-response test | Pre-verified gap | high | bad_spec (E) |
| 82 | VerifGap | auth-gate.tsx:166,187,272 | No test of either choice, cancel or reload | Pre-verified gap | high | bad_spec (E) |
| 83 | VerifGap | auth-gate.tsx:94,215 | No Share/WhatsApp continuation test | Pre-verified gap | high | bad_spec (E) |
| 84 | VerifGap | api/views.py:542; snapshots.py:60 | v1 marker makes backfill count the copy malformed | Read: lossless comparison of raw vs export | medium | bad_spec (A) |
| 85 | Contract | saved-cases.ts:38 | saveCase accepts incomplete conflict bodies | Same as 62 | medium | bad_spec (B) |
| 86 | Contract | saved-cases.ts:75; auth-gate.tsx:169 | Checked open drops the 409's current case | Read: sentinel only; new consumer needs it | medium | bad_spec (C) |
| 87 | Contract | api/views.py:252; saved-cases.ts:93 | Create route never emits `saved_case_conflict`; its `{detail}` 409 becomes generic Retry | Read | medium | bad_spec (B) |
| 88 | Contract | web/e2e/api.ts:134-152 | E2E harness aborts every create request | Read: unstubbed route aborts | medium | bad_spec (E) |
| 89 | Contract | api/views.py:544 | v2 encoder misreads encoded input | Same as 53 | high | bad_spec (A) |
| 90 | Contract | backfill_saved_cases.py:36 | v1 upgrade rejects marked copies | Same as 84 | medium | bad_spec (A) |
| 91 | Contract | coverage table: enriched 409, create request (named/blank/omitted), 201, replay 200 | No full-envelope test at the consumer | Read: no create fixtures anywhere | medium | bad_spec (E) |
| 92 | Contract | coverage table: create 400 (detail / name invalid / too_long / school_required / unsupported_content), 403, 404 expired, 409 `{detail}` | No create-route test per refusal; most become generic Retry | Read | medium | bad_spec (E) |
| 93 | Contract | coverage table: create 422 (invalid_basis, preset_unavailable, unsupported_version, invalid_snapshot, unsupported_content), 503 comparison, 503 busy | Same generic-failure path; untested; Retry switches endpoint | Read | low | bad_spec (D/E) |

| 94 | Blind (loop 1) | api/views.py:526 | Replay relinks with the copy's current revision, hiding edits made elsewhere | Read: `set_saved_link(..., row.revision, ...)` after refetch | medium | patch |
| 95 | Blind (loop 1) | api/models.py:21; views.py:525 | Request record lacks the originating case id; reused key links another family | Read: replay only compares body case_id to current | low | patch (same record change as 94) |
| 96 | Blind (loop 1) | views.py:527; auth-gate.tsx:157 | Replay without relink still reports Saved | Read: needs lost response + case replaced in another tab; the copy was created as asked | low | reject (unlikely; fix adds branches) |
| 97 | Blind (loop 1) | api/views.py:536 | Create does not require an outstanding conflict | Only reachable by a crafted request; worst case a duplicate of the owner's own case | low | reject |
| 98 | Blind (loop 1) | api/views.py:534 | Stale body built from the old saved_id can report null while another link conflicts | null → client reloads; the next Save shows the conflict again | low | reject |
| 99 | Blind (loop 1) | auth-gate.tsx:128 | Stale Open with a different case re-prompts against the old target | Read: only id/revision replaced | medium | patch |
| 100 | Blind (loop 1) | auth-gate.tsx:154 | Stale Create drops the returned case; copy can include unseen edits | Read | medium | patch |
| 101 | Blind (loop 1) | saved-cases.ts:73 | Malformed nested conflict treated as explicit null | Same server emits both; needs a broken producer | low | reject |
| 102 | Blind (loop 1) | api/views.py:443 | Unpaired surrogate in name → DB encoding error | Same check existed in baseline ordinary Save | medium | defer (pre-existing) |
| 103 | Blind (loop 1) | auth-gate.tsx:259 | `crypto.randomUUID` missing loses the name | Only absent in insecure contexts; production is HTTPS | low | reject |
| 104 | Blind (loop 1) | saved-cases.ts:34 | No-Segmenter fallback can split a grapheme | Supported browsers ship `Intl.Segmenter` | low | reject |
| 105 | Blind (loop 1) | web/e2e/results.spec.ts:151 | Open latest e2e serves the same family | Read | medium | patch |
| 106 | Edge (loop 1) | views.py:525-527 | Replay base revision | Same as 94 | medium | patch |
| 107 | Edge (loop 1) | views.py:519-526 | Key reused with another case id | Same as 95 | low | patch |
| 108 | Edge (loop 1) | views.py:525-527 | Delayed replay overrides a newer link of the same case | Needs two creates for one case + a lost response; recorded-revision fix (94) keeps it detectable as a conflict | low | reject |
| 109 | Edge (loop 1) | views.py:536-545 | No outstanding-conflict requirement | Same as 97 | low | reject |
| 110 | Edge (loop 1) | views.py:534-544 | Stale conflict from old row | Same as 98 | low | reject |
| 111 | Edge (loop 1) | views.py:506-509 | saved_id ≤ 0 accepted | Crafted input only; answers stale, writes nothing | low | reject |
| 112 | Edge (loop 1) | views.py:443-447 | Surrogate name | Same as 102 | medium | defer |
| 113 | Edge (loop 1) | auth-gate.tsx:125-129 | Stale open with another family | Same as 99 | medium | patch |
| 114 | Edge (loop 1) | saved-cases.ts:70-74 | Malformed nested conflict | Same as 101 | low | reject |
| 115 | Edge (loop 1) | auth-gate.tsx:157-163 | Old Share panel stays after switching to the copy | Read: shareState untouched on create success | medium | patch |
| 116 | Edge (loop 1) | auth-gate.tsx:259 | randomUUID | Same as 103 | low | reject |
| 117 | Edge (loop 1) | views.py:525-527 | Replay 200 without relink | Same as 96 | low | reject |
| 118 | Edge (loop 1) | views.py:524 | Replay reads the session first; unreadable session → 422 | Needs an unreadable session after a lost response; nothing is written | low | reject |
| 119 | VerifGap (loop 1) | results-view.tsx:123 | Reload after open untested | Pre-verified | medium | patch (with 105) |
| 120 | VerifGap (loop 1) | test_saved_case_upgrade.py:373 | Replay test can't tell recorded from current revision | Pre-verified | medium | patch |
| 121 | VerifGap (loop 1) | views.py:519 | Owner isolation of keys untested | Pre-verified | medium | patch |
| 122 | VerifGap (loop 1) | test_saved_case_upgrade.py:347 | Copy round trip compares counts only | Pre-verified | medium | patch |
| 123 | VerifGap (loop 1) | views.py:554 | Localized default name on create untested | Pre-verified | low | patch |
| 124 | VerifGap (loop 1) | auth-gate.tsx:161,263 | Share panel after copy | Same as 115 | medium | patch |
| 125 | Contract (loop 1) | auth-gate.tsx:128 | Stale open id | Same as 99 | medium | patch |
| 126 | Contract (loop 1) | auth-gate.tsx:154 | Stale create drops case | Same as 100 | medium | patch |
| 127 | Contract (loop 1) | saved-cases.ts:73 | Nested conflict | Same as 101 | low | reject |
| 128 | Contract (loop 1) | saved-cases.ts:75; auth-gate.tsx:171 | 403/422 get a Retry | The frozen intent asks for Retry of a failed choice; copy kept | low | reject |
| 129 | Contract (loop 1) | saved-cases.ts:20,77 | Ids beyond 2^53 | Unreachable row counts | low | false |
| 130 | Contract (loop 1) | mawareeth/middleware.py:142,171 | Create route missing from outcome logging | Read | low | patch (direct one-line addition) |
| 131 | Contract (loop 1) | coverage: empty `saved_name` conflict | Copy dialog path for unnamed rows untested | Read | low | patch (one unit test) |
| 132 | Contract (loop 1) | coverage: remaining create/open envelope variants (blank name, stale variants, 400/403/404/422/503 bodies) | Fixtures omit `detail`/`error` | The parsers read only status, `code`, `errors.name`, `conflict`, `case`; the omitted fields cannot change an outcome, and the producers are asserted in Django | low | reject |
Groups: (A) idempotency storage and snapshot handling; (B) checked arguments and conflict envelope; (C) Open latest reload and stale/failure handling; (D) Retry, cancel, guard, continuation, copy name; (E) test coverage. All route to bad_spec → loop 1.

## Verification

**Commands:**
- `uv run python manage.py makemigrations --check --dry-run` -- expected: no changes (the new `SavedCaseCreateRequest` migration is committed)
- `uv run python manage.py test api.tests.SavedCaseTests api.test_saved_case_upgrade api.test_saved_case_unsaved api.test_snapshots --noinput` -- expected: OK
- `cd web && npm test && npm run typecheck && npm run lint && npm run i18n` -- expected: no failures, 0 lint errors
- `cd web && npm run build && npx playwright test e2e/results.spec.ts e2e/cases.spec.ts e2e/accessibility.spec.ts` -- expected: all pass on the fresh export; full suites run in PR CI
