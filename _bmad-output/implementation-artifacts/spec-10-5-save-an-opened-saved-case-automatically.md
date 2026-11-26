---
title: 'Story 10.5: Save an opened Saved case automatically'
type: 'feature'
created: '2026-11-27'
status: 'done'
baseline_commit: '85a8fb8417f4a98f993cd2ad9853fc6ed2951a49'
baseline_revision: '85a8fb8417f4a98f993cd2ad9853fc6ed2951a49'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Edits to an opened Saved case reach My cases only when the user presses Save on Full results. The Interview shows the 10.0 stopgap notice "Changes not saved to My cases yet". The only save endpoint (`POST /api/v1/saved-cases/`) creates a new SavedCase when the link is absent, deleted or foreign. It does not name the working Case revision it saves, so a client cannot tell whether a save covered the latest edit.

**Approach:** (1) Server: a new update-only endpoint `POST /api/v1/saved-cases/autosave/`. It takes `case_id` and `case_revision`, checks both against the session working copy under the existing session lock, and writes only to the linked, owned SavedCase with the existing row compare-and-swap. Its answer names the working revision it covered. (2) Web: an autosave coordinator, shared across pages, that debounces accepted changes, keeps at most one request in flight and sends the newest revision next. It reports one settled outcome at a time on an Interview status line that replaces the stopgap notice for linked Cases. It reuses the 10.1/10.1b messages and conflict choices, and is flushed before Open, New Case, Start over and sign-out.

## Boundaries & Constraints

**Always:**
- Autosave runs only when the Case has a SavedCase link (`case.saved` is an object) and the user is signed in. A never-saved Case (`saved: null` or unknown) is never autosaved. Its first save stays the explicit Save with naming and sign-in (10.1), after which the link exists and autosave applies.
- Endpoint contract. Request: `{case_id, case_revision}`. Session lock prefix: the same as Save (`mawareeth/middleware.py`). Responses:
  - 403: unauthenticated (DRF shape), as today.
  - 404 `{code: "saved_case_unavailable", detail}`: no session link, a link for another `case_id`, a missing row or a row owned by another account. This is one uniform body. Nothing is created or written.
  - 409 `{code: "case_revision_stale", case_revision: <current>}`: the session working revision differs from `case_revision`. Nothing is written.
  - 409, existing `saved_case_conflict` body: the row revision differs from the link `base_revision`. Nothing is written.
  - 400 `{code: "case_incomplete", detail: "Complete the case before saving."}`: no deceased or heirs. The same `code` is added to explicit Save's existing body, so the change is additive.
  - 400 existing `school_required`. 503 existing comparison failure.
  - 200 `{id, name, updated_at, revision, case_revision}`: the snapshot and row revision are updated, and the link's `base_revision` and `case_revision` advance.
  - Autosave never changes `name`, never creates a row, never changes the session Case revision, and never alters the stored Basis intent. It writes the working copy's Basis exactly as the explicit Save path does.
- Client coordinator (`web/src/interview/autosave.ts`, framework-free, fake-timer testable):
  - `notify(caseId, revision)` is called after every accepted command, Undo, School change or name write. It debounces 1000 ms after the last call.
  - At most one request is in flight. A change during flight queues the newest revision only.
  - A `case_revision_stale` answer, or a 200 whose `case_revision` is older than the newest accepted revision, is never shown as saved. The newest revision is sent next.
  - "Saved to My cases" is shown only when `case_revision` equals the latest accepted revision.
- States and status-line text (Interview, `role="status"`, one announcement per settled save):
  - `saving` → `results.saving`.
  - `saved` → `results.saved`.
  - `needs-heirs` → new `interview.autosaveNeedsHeirs`. `needs-school` → `results.saveNeedsSchool`. The edits stay, and the next accepted change tries again.
  - `failed` (network, timeout, 5xx, 429) → `results.saveError` with a Retry button (`results.saveRetry`). There is no automatic retry. The next accepted change or Retry sends again.
  - `signed-out` (403 and the session probe says signed out) → `results.saveError` plus the 10.1 sign-in dialog/flow. That flow returns to the same Interview and retries once.
  - `unavailable` (404) → new `interview.autosaveUnavailable`, with the link to Save on Full results. Autosave stops for this Case.
  - `conflict` → `results.saveConflict` plus the two 10.1b choices with their shipped behaviour. Autosave sends nothing until a choice succeeds. Editing continues, and the choice uses the current working revision at click time.
- `flush()` sends a pending, debounced or failed revision immediately (one attempt) and awaits any request in flight. It resolves `saved` or `unsaved`. These callers await it before acting:
  - My cases Open and New Case: the existing revision-based check runs after the flush.
  - Interview Start over: its existing confirmation runs after the flush.
  - SiteNav sign-out.
  If the result is `unsaved` (the conflict state included), the 10.0 discard prompt (`cases.discardTitle`/`discardBody`/`discardNo`, safe choice focused) appears before anything is discarded. Sign-out confirms with the new key `nav.discardAndSignOut`. Navigating Interview → Full results also flushes (fire-and-forget on unmount).
- An explicit Save on Full results awaits `flush()` before sending its own request, so two writes never race.
- Reuse existing keys. New keys only: `interview.autosaveNeedsHeirs`, `interview.autosaveUnavailable` and `nav.discardAndSignOut`, in en/ar/fr. Record them in `deferred-work.md` for native review. `npm run i18n` passes.
- Capacity: the harness gains an autosave worker that writes a linked SavedCase alongside the existing contention writer. Every Interview action's p95 stays below 1000 ms.

**Never:**
- No migration and no change to the SavedCase or session schema (the existing link fields suffice).
- No create path from autosave. No `mode` flag on the explicit Save endpoint, because an old blue-green image would ignore it and create a row.
- No merge, no force-overwrite, no endless or automatic retry loop. No browser `beforeunload` warning. No autosave on shared or received views, or for guests.
- Do not change existing message text, the 10.1b resolution endpoints, the share or PDF status events of 10.4, or preset-version messaging (Epic 14). Pinned Country presets are not representable on this Case path today. Autosave must only round-trip the working Basis unchanged.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | Linked Case rev 7, add heir → rev 8 | After 1 s one POST `{case_id, case_revision: 8}`; line Saving → Saved to My cases | — |
| Edit during flight | POST rev 8 in flight, edits → rev 10 | One POST rev 10 after rev 8 settles; Saved shown only after the rev-10 200 | rev-8 200 shows Saving, not Saved |
| Stale on server | POST rev 8 but session at 9 | 409 `case_revision_stale`, nothing written; client sends the newest | — |
| Never-saved | `saved: null` | No autosave request; 10.0 notice and Save link stay | — |
| Link missing/foreign/deleted | Row deleted or other owner | 404 `saved_case_unavailable`; no row created; line shows unavailable | Autosave stops |
| Conflict | Row changed elsewhere | 409 conflict; message + Open latest / Save as new; editing continues; no sends | Choice resolves as 10.1b |
| No heirs | Last heir removed | 400 `case_incomplete`; line shows needs-heirs; next change tries again | — |
| Schools differ | No School, schools differ | 400 `school_required`; line asks for a School | — |
| Network/timeout/5xx | fetch rejects | Save error + Retry; family kept; no auto retry | Retry sends the newest |
| Session expired | 403, probe signed out | Save error + sign-in; return to same Case, retry once | — |
| Open another case | Pending save | flush sends it; saved → open; unsaved → 10.0 prompt | — |
| Sign out | Failed save | flush one attempt; unsaved → prompt; confirm → logout | — |
| Basis unchanged | Compare basis or School case | Stored basis/madhab after autosave equal the working copy; name unchanged | — |

</intent-contract>

## Code Map

- `api/views.py:395-438` -- explicit Save (`saved_cases` create/update, create fallback when the owned row is missing). `:453-479` eligibility refusals (`Complete the case before saving.`, `school_required`, 503). `:482-487` conflict body. `:496-574` save-as-new (`/saved-cases/create/`). `:624-654` Open (sets the link, `expected_revision`). Add the autosave view here, reusing the save preparation and the owner-scoped `select_for_update` CAS. Factor out the shared helpers rather than copying them.
- `api/urls.py:33-37` -- saved-case routes. Add `saved-cases/autosave/` before any `<id>` route.
- `mawareeth/middleware.py:63-106` -- session lock prefixes. Confirm that `saved-cases/autosave/` is covered by the lock.
- `api/anonymous_case.py:333-361` -- `saved_case_link` `{case_id, saved_id, base_revision, case_revision}`. `:1166-1183` export (madhab/basis). `:1186-1206` `saved` marker on case reads.
- `api/snapshots.py:89-129,170-176` -- schema-2 encoding of the basis (read-only evidence that Save keeps the Basis intent).
- `web/src/api/saved-cases.ts:4-78` -- save wire types and decoders. Add `autosaveCase(signal, caseId, caseRevision, opts)` with a typed result union (`saved{caseRevision,revision}` / `stale` / `unavailable` / `conflict{...existing}` / `incomplete` / `schoolRequired` / `forbidden` / `failed`). Use the same timeout option as the other clients (`timeoutMs`).
- `web/src/interview/autosave.ts` (new) -- the coordinator (state machine, debounce, single flight, `flush`, `subscribe`). Keep it as a module-level singleton keyed by case id, so My cases and SiteNav can flush it.
- `web/src/interview/flow.ts:799-825,1145-1239` and `web/src/app/[locale]/interview/start-case.tsx:169-216` -- where commands, Undo and School selection are accepted. Call `notify` with the accepted server revision, including a name write that succeeds before a later command fails. `start-case.tsx:633-640` holds the `savedBehind` notice. For linked Cases render the autosave status line + Retry/sign-in/conflict choices in its place, and keep the notice for never-saved Cases. `:590-602` Start over: await `flush()` first. `:510-516` is the sr-only routine status (do not double-announce; the autosave line is its own `role=status` with one announcement per settled save).
- `web/src/app/[locale]/results/auth-gate.tsx:130-177,257-287` -- the 10.1/10.1b save state, the conflict UI and the sign-in dialog. Extract the conflict choices (and, if practical, the sign-in resume) into a reusable component used by AuthGate and the Interview, with AuthGate's behaviour and the 10.4 status-line events unchanged. The explicit Save awaits `flush()`.
- `web/src/app/[locale]/cases/cases-view.tsx:140-189,287-295` -- Open/New Case and the discard dialog. Await `flush()` before the revision check. It also holds the session-probe pattern used for the 403 signed-out decision.
- `web/src/app/[locale]/site-nav.tsx:21-27` -- `logout()`. Await `flush()`. If `unsaved`, show the discard dialog (reuse the cases dialog keys, confirm `nav.discardAndSignOut`) before `submitAuth("logout")`.
- `web/src/i18n/messages.ts` -- existing `results.saving/saved/saveError/saveRetry/saveConflict/conflictOpenLatest/conflictSaveAsNew/saveNeedsSchool` (en around `:938-976`) and `cases.discard*` (`:718`). Add the three new keys (type + ar/en/fr).
- `api/capacity.py:26-45,194-221,288-310`, `api/test_capacity.py:148,240`, `api/management/commands/capacity_check.py:10-39` -- the capacity harness (six actions, contention writer). Add an authenticated, linked SavedCase fixture and an autosave worker thread that posts autosave after accepted changes. Record the autosave successes in the JSON. Clean up the fixture.
- Tests: `api/tests.py:3483` `SavedCaseTests`, `:2443` `CaseWriteLockTests`; `api/test_saved_case_unsaved.py:13`; `api/test_saved_case_upgrade.py:239,480-485`. Web: `web/src/api/saved-cases.test.ts`, `web/src/interview/flow.test.ts`, `auth-gate.test.tsx`, `cases-view.test.tsx`, `start-case` tests if present, `site-nav` tests if present. E2E: `web/e2e/api.ts:145-154` (stub router; unhandled calls abort), `web/e2e/interview.spec.ts`, `web/e2e/cases.spec.ts`.

## Tasks & Acceptance

**Execution:**
- `api/views.py`, `api/urls.py` (+ middleware check) -- the autosave view per the contract, plus `code: "case_incomplete"` on the incomplete refusal for both endpoints.
- `api/tests.py` (new `SavedCaseAutosaveTests` near `SavedCaseTests`) -- one test per contract row:
  - 200 covers the revision and advances the link.
  - Stale revision writes nothing.
  - Absent link, other case id, deleted row and foreign owner each give the uniform 404 and the row count is unchanged.
  - Row conflict gives the existing 409 body and nothing is written.
  - `case_incomplete` and `school_required`.
  - Unauthenticated 403.
  - The name, madhab/basis (compare and School) and session Case revision are unchanged by the save.
  - The share view reflects the autosaved family.
- `api/capacity.py`, `api/management/commands/capacity_check.py`, `api/test_capacity.py` -- the autosave worker and the fixture. The test asserts that the worker ran and wrote at least one autosave.
- `web/src/api/saved-cases.ts` + test -- `autosaveCase` decoding for every response row, plus timeout.
- `web/src/interview/autosave.ts` + `autosave.test.ts` -- the coordinator with fake timers. Cover every matrix row that does not need the DOM: debounce, single flight, newest next, stale 200 not saved, no auto retry, conflict pause, needs-heirs retry on next change, flush outcomes, never-saved no-op.
- `web/src/interview/flow.ts`, `web/src/app/[locale]/interview/start-case.tsx` + tests -- notify on accepted changes, the status line with Retry/sign-in/conflict choices for linked Cases, the notice kept for never-saved Cases, and flush before Start over.
- `web/src/app/[locale]/results/auth-gate.tsx` (+ extracted conflict component) + tests -- reuse on the Interview. The explicit Save awaits flush. The 10.4 tests still pass.
- `web/src/app/[locale]/cases/cases-view.tsx`, `web/src/app/[locale]/site-nav.tsx` + tests -- flush, then prompt when unsaved.
- `web/src/i18n/messages.ts` -- the three new keys. `_bmad-output/implementation-artifacts/deferred-work.md` -- record them for native review.
- `web/e2e/api.ts`, `web/e2e/interview.spec.ts` (and `cases.spec.ts`) -- stub `saved-cases/autosave/`. Cover in en and ar:
  - A linked Case edit shows Saving then Saved to My cases with exactly one request.
  - A conflict shows the two choices and editing still works.
  - A failure shows Retry, and Retry succeeds.
  - A never-saved Case sends no autosave request.
  - Opening another Case with a failing save shows the discard prompt.

**Acceptance Criteria:**
- Given an opened Saved case, signed in and online, when several changes or an Undo are accepted quickly, then exactly one autosave request follows about one second after the last change, at most one is in flight, the newest revision is sent next, and the Interview status line shows Saving and then "Saved to My cases" only when the answer's `case_revision` equals the latest accepted revision, with one announcement per settled save.
- Given any autosave refusal (unavailable, conflict, incomplete, School required, failure, signed out), when it settles, then no SavedCase is created, the family stays on screen, the matching message appears on the line, and no automatic retry loop runs.
- Given a pending or failed autosave, when the user opens another Case, starts a new Case, presses Start over or signs out, then the save is attempted first and the 10.0 discard prompt appears if it did not succeed.
- Given the capacity check with the autosave worker and the contention writer running, when it runs against PostgreSQL, then every Interview action's p95 is below 1000 ms.

## Spec Change Log

## Review Triage Log

### 2026-11-27 — Review pass
- verdicts: 28 findings — high 0, medium 0, low 12, false 16, maybe-false 0 (blind 11, edge 7, verification-gap 3 + 1 other, intent-alignment 3, contract 3; a row naming several layers stands for one finding from each)
- review: one combined five-layer call. Codex (deep tier) reported a usage limit before producing output, so the same prompt ran on the `gemini` agent (deep tier, read-only), per the fallback routing. Gemini's line numbers point into the diff file; each claim was checked against the working tree.
- findings:
  - `[low]` `[reject]` blind: `onChanged={() => {}}` in `start-case.tsx`, so the view is not refreshed after Save as a new case — the coordinator is relinked through `autosave.relinked`, and the next accepted change follows the tracked Case. A stale `view.case.saved.revision` only feeds `attach`, which takes the max. No user-visible effect.
  - `[false]` `[reject]` blind: a stale answer with a newer server revision makes the client save state it never rendered — the server owns the Case, and that revision is this session's own working copy, so saving it is correct. A row change elsewhere is the `saved_case_conflict` path, not stale.
  - `[false]` `[reject]` blind: `updated_at` is stale in the 200 body — `SavedCase.updated_at` is `auto_now=True` (`api/models.py:12`), so `save()` sets it on the instance.
  - `[false]` `[reject]` blind+edge: an edit during flight is dropped when the flight fails — `settle` returns true on failure when `latest > target` (`autosave.ts`, default branch), so `drive` sends the newest revision.
  - `[false]` `[reject]` blind: a missing `base_revision` gives `None` and a false 409 — `get_saved_base_revision` defaults to 1 (`api/anonymous_case.py:1199`).
  - `[low]` `[reject]` blind: the unmount flush has no `keepalive` — in-app navigation does not abort fetches. Tab close is outside scope: the spec forbids a leave warning.
  - `[false]` `[reject]` blind: a stale `case_revision` of 0 is decoded as null — the server only sends `case['revision']`, which `valid_revision` requires to be at least 1.
  - `[low]` `[reject]` blind: extra request fields are ignored — this matches every other case endpoint, and nothing reads them.
  - `[false]` `[reject]` blind: sign-out can hang on `flush()` — every `write` has a 10 s timeout (`CASE_TIMEOUT_MS`, `web/src/api/case.ts:270,570`).
  - `[low]` `[reject]` blind: the `copyName` truncation can empty the name — this is copied unchanged from the shipped AuthGate logic, the shipped catalog keeps `{name}`, and blank names fall back to the default server side.
  - `[false]` `[reject]` blind+contract: the capacity worker raises `SetupError` on a 404 — the fixture is owned by the harness, so a 404 means setup broke, and failing loudly is the intended behaviour.
  - `[false]` `[reject]` edge: `attach` keeps a stale saved/idle state when stored < latest — `saved` is only set when `lastSaved >= latest`, `lastSaved` only grows, and every raise of `latest` goes through `notify`, which sets `saving`.
  - `[false]` `[reject]` edge: stale with a newer server revision should be a conflict — same refutation as the blind row.
  - `[false]` `[reject]` edge: a missing `base_revision` gives 409 — same refutation (default 1).
  - `[false]` `[reject]` edge: capacity 404 — same refutation.
  - `[low]` `[reject]` edge (claim) + verification-gap: AuthGate does not reuse `ConflictChoices`, so two copies exist — real deviation from the Code Map's extraction note. Both copies call the same `openSavedCase` and `createSavedCase` APIs with the same messages, so users see the same behaviour today. The harm is drift on a future edit. Extraction means reworking 10.4's stamped status-line events, which is more than a direct correction. Recorded as a residual risk.
  - `[false]` `[reject]` edge: a linked Case with a null revision shows neither notice nor line — a started Case always carries an integer revision from the server. A null *saved* revision (old link) attaches as `unsaved`, and the line shows the notice and link.
  - `[low]` `[reject]` verification-gap: a failed unmount flush is not shown on Full results — real: Full results renders no autosave line. Nothing is lost: Save is on that page and flushes first, the 10.0 prompt guards Open, New Case, Start over and sign-out, and returning to the Interview shows the failure with Retry. The fix would add a new results surface.
  - `[false]` `[reject]` verification-gap: missing `base_revision` → 409 with null fields — the default is 1, so no null fields are produced.
  - `[false]` `[reject]` verification-gap (other): capacity 404 — same refutation.
  - `[low]` `[reject]` intent-alignment: autosave runs only from the Interview — every Case edit (family commands, Undo, School choice) is accepted on the Interview, and the other pages flush before acting.
  - `[low]` `[reject]` intent-alignment: a separate `role=status` instead of the Interview coalescer — the line speaks once per settled outcome (plus Saving, the same as 10.1's shipped save line), and the coalescer carries family and preview announcements.
  - `[low]` `[reject]` intent-alignment: conflict UI not unified — same as the ConflictChoices row.
  - `[low]` `[patch]` contract: no test sends the new `case_incomplete` 400 envelope through `saveCase` — fixed: `saved-cases.test.ts` serves that exact body and asserts the unchanged result (`null`).
  - `[low]` `[reject]` contract: the 404 unit fixture omits `detail` — the client reads only `code`, never `detail`.

## Design Notes

A dedicated endpoint, rather than a flag on Save, fails closed during blue-green: an old image returns 404 for the new route instead of creating a row. The client already treats 404 as `unavailable`, which shows a visible outcome.

Coverage rule: the server answers with the working revision it saved. The client keeps `latestAccepted` and compares the two. A response for an older revision is progress, not success:
```ts
if (r.kind === "saved" && r.caseRevision === latestAccepted) setState("saved");
else if (r.kind === "saved" || r.kind === "stale") sendNext(latestAccepted);
```

## Verification

**Commands:**
- `uv run python manage.py test api.tests.SavedCaseTests api.tests.SavedCaseAutosaveTests api.tests.ShareTests api.tests.CaseWriteLockTests api.test_saved_case_unsaved api.test_saved_case_upgrade api.test_capacity --noinput` -- expected: OK
- `cd web && npm test && npm run typecheck && npm run lint && npm run i18n` -- expected: no failures, 0 lint errors
- `cd web && npm run build && npx playwright test e2e/interview.spec.ts e2e/cases.spec.ts e2e/results.spec.ts` -- expected: all pass
- `uv run python manage.py capacity_check --samples 20 --enforce-interview --json <scratch>/capacity-10-5.json` -- expected: exit 0, every action p95 < 1000 ms, autosave successes > 0 (record the numbers; local timings are evidence, the release gate is authoritative)

## Auto Run Result

Status: done

**Summary.** An opened Saved case now saves itself.
- **Server:** a new update-only endpoint, `POST /api/v1/saved-cases/autosave/`, takes `{case_id, case_revision}`. Under the session lock it writes only the linked, owned SavedCase, using the row compare-and-swap.
  - Its answers: 200 with `case_revision` (the working revision it covered); 409 `case_revision_stale`; the existing 409 `saved_case_conflict`; one uniform 404 `saved_case_unavailable` for an absent, mismatched, deleted or foreign link; 400 `case_incomplete` or `school_required`; 403.
  - It never creates a row, never renames, and never changes the Basis or the session Case revision.
  - Explicit Save's incomplete refusal gains the same `code`.
- **Web coordinator:** `web/src/interview/autosave.ts` is a framework-free singleton.
  - It sends one request 1000 ms after the last accepted change, keeps at most one in flight and sends the newest revision next.
  - "Saved to My cases" appears only when the answer covers the latest accepted revision. Failed saves are never retried automatically.
  - A conflict or an unavailable link pauses sending. A Case that was never saved is never tracked.
- **Interview status line:** for linked Cases it replaces the 10.0 notice. It shows Saving and Saved, says what is missing, shows the error with Retry, offers sign-in after an expired session (which returns to the same Case and retries once), and offers the two conflict choices.
- **Flush first:** My cases Open and New Case, Interview Start over, sign-out, and AuthGate's Save and Share all try the pending save first. If it is not saved, the 10.0 discard prompt appears.
- **Capacity:** the harness runs an authenticated autosave worker beside the contention writer.

**Files changed**
- `api/views.py`, `api/urls.py` -- `SavedCaseAutosaveView` and its route; `case_incomplete` code on the incomplete refusal.
- `api/tests.py` -- `SavedCaseAutosaveTests` (8 tests), and the incomplete test updated for the new code.
- `api/capacity.py`, `api/test_capacity.py` -- the `autosaving()` worker and fixture; the test asserts it wrote.
- `web/src/api/saved-cases.ts` (+ test) -- `autosaveCase` and its typed result union; a `case_incomplete` envelope test for `saveCase`.
- `web/src/interview/autosave.ts` (+ `autosave.test.ts`, 15 tests) -- the coordinator.
- `web/src/app/[locale]/interview/autosave-line.tsx` (new) -- the status line, Retry, the sign-in dialog with a one-shot resume marker, and `ConflictChoices`.
- `web/src/app/[locale]/interview/start-case.tsx`, `page.tsx` -- follow accepted changes, show the line, flush before Start over and on unmount.
- `web/src/app/[locale]/cases/cases-view.tsx` (+ test), `site-nav.tsx`, `results/auth-gate.tsx` -- flush before acting; the sign-out discard dialog.
- `web/src/i18n/messages.ts` -- `interview.autosaveNeedsHeirs`, `interview.autosaveUnavailable`, `nav.discardAndSignOut` (en, ar, fr).
- `_bmad-output/implementation-artifacts/deferred-work.md` -- those keys recorded for native review.
- `web/e2e/api.ts`, `web/e2e/cases.spec.ts`, `web/e2e/interview.spec.ts` -- the autosave stub, and eight journeys in en and ar:
  - Saving, then Saved after one request.
  - Conflict choices, with editing still possible.
  - Failure, then Retry.
  - A never-saved Case sends no request.
  - Opening another Case after a failed save shows the discard prompt.
  - Sign-out after a failed save asks first; after a successful save it does not.
  - An expired sign-in returns to the Case and retries once.

**Planning and fallbacks.**
- Planning investigation ran on the `codex` agent. Implementation ran on a Sonnet subagent.
- It wrote 14 files with CRLF line endings. I normalized them to LF, and fixed a lost space in `api/urls.py`.
- The matrix audit found the sign-out and expired-session rows untested, and the expired-session return not retrying. Codex (standard tier, allowed to edit) added the one-shot resume marker and three e2e journeys.
- The review's codex call hit a usage limit, so it ran on the `gemini` agent.

**Review findings.** 28 findings: high 0, medium 0, low 12, false 16.
- Patched (1 low): the `case_incomplete` envelope test for `saveCase`.
- Deferred: none.
- Rejected, with reasons in the triage log:
  - 16 false. Among them: `updated_at` is `auto_now`, `base_revision` defaults to 1, writes have a 10 s timeout, an edit made in flight is still sent after a failure, a stale answer saves the server's own working copy, and the capacity 404 means setup broke.
  - 11 low:
    - the `onChanged` no-op;
    - `keepalive` on unmount;
    - extra request fields ignored;
    - the copied `copyName` logic;
    - `ConflictChoices` not extracted into AuthGate (2 rows);
    - no unmount-failure notice on Full results;
    - autosave only on the Interview;
    - the separate status region;
    - the conflict UI not unified;
    - the 404 fixture without `detail`.

**Follow-up review recommended: false.** Only one low entry was patched.

**Verification**
- Django `api.tests.SavedCaseTests api.tests.SavedCaseAutosaveTests api.tests.ShareTests api.tests.CaseWriteLockTests api.test_saved_case_unsaved api.test_saved_case_upgrade api.test_capacity`: 140 tests OK.
- `npm test`: 843/843. `typecheck`: OK. `lint`: 0 errors (12 existing warnings). `i18n`: OK.
- `npm run build`: OK. Playwright `cases.spec.ts interview.spec.ts results.spec.ts`: 273 passed.
- `capacity_check --samples 20 --enforce-interview`: exit 0, `interview_passed` true, max p95 754 ms (`two_later_deaths` delete).
  - The autosave worker wrote 4, 3 and 16 times across the three workloads; most other attempts were answered stale because the contention writer edits constantly.
  - The subagent ran it on a scratch database, because the local dev database is missing migrations 0007 and 0008.
  - The release gate on the candidate slot is authoritative; the last production gate passed with about 2 ms of margin.

**Residual risks**
- The conflict choices exist twice, in AuthGate and in `ConflictChoices` on the Interview, and can drift on a future edit.
- If the save sent when leaving the Interview fails, Full results does not say so. The Interview line, Save on Full results and the 10.0 prompt still cover it.
- Closing the tab during the 1 s debounce loses that pending save. No leave warning, by design.
- No component-level unit tests cover the `start-case.tsx` and `site-nav.tsx` wiring; e2e covers the journeys.
- The new ar and fr strings need native review (recorded in `deferred-work.md`).
- Pinned Country presets are not representable on this Case path yet (Epic 14). Autosave round-trips the working Basis unchanged.
- Production capacity with autosave is unproven until the release gate runs.
