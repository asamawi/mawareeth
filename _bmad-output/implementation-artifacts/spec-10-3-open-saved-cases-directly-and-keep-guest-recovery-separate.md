---
title: 'Story 10.3: Open Saved cases directly and keep guest recovery separate'
type: 'feature'
created: '2026-11-26'
status: 'done'
baseline_commit: '32106297fafdef897bba254b3fc838693f9a2fda'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      After a failed Interview edit, the reconciliation GET treats a server-coded expiry like a read failure and keeps showing the cached (expired) family.
    evidence: |-
      refreshed() in web/src/interview/flow.ts returns from.case when the live read is not the same Case; before this story fetchCase returned null for expiry and took the same branch, so the behaviour is pre-existing. The edit itself already reaches the expired view through its own gone result.
    location: >-
      web/src/interview/flow.ts refreshed()
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Opening a Saved case from My cases pushes a bare `/{locale}/interview/`. The Interview ignores the saved link and, with no tab record for the fresh working id, shows the guest "Resume / Start over" prompt. My cases has no New Case action. When the user's sign-in has expired, Open gives only a generic error and drops the selection. The expired-guest screen has no "This case has expired" title and does not explain the guest lifetime.

**Approach:** This is a web-only change; the server already loads, links, exempts and clears Cases. A successful Open or New Case writes a one-shot hand-off holding the expected working id. The Interview consumes the hand-off and enters the Case directly when the id matches. It shows a visible failure when the id does not match, and it never auto-starts a blank Case in that situation. A linked working copy (`saved !== null`) also bypasses the guest prompt on later loads. When Open is refused for lost authentication, the user is sent through the shipped login `next` pattern with `?open=<id>`, and My cases resumes that Open after sign-in. The `expired` code from the Case API is carried through to a titled expiry screen with one new-Case action.

## Boundaries & Constraints

**Always:**
- Navigation to the Interview happens only after a 2xx Open or Start response. The Interview shows a loaded family only when the GET's working `id` equals the hand-off id. If the ids differ or there is no Case, it shows the open-failed notice with a link to My cases. It shows no family data, and it never calls Start.
- The guest resume prompt (`existing`) appears only for an unlinked Case (`saved === null`) with no hand-off and no matching tab record. That is today's rule for guests, unchanged.
- New Case reuses the Story 10.0 discard dialog and the same preflight as Open: read the current Case, then prompt if it is unreadable or unsaved. It calls `startCase` with `replace: true` plus the displayed `case_id`/`expected_revision` when a Case exists, or plain Start when none exists. On 409, re-read and re-prompt, the same as Open's conflict handling. It never writes a SavedCase row; the server's `start` clears the saved link.
- The resumed Open after sign-in runs only after auth reports signed-in. It runs through `begin(id)`, so the discard prompt still applies. A server 404 shows the existing open failure. Ownership stays enforced by the server (`owner=request.user`), so the retained id grants nothing to another account. The `open` param is removed from the URL (`history.replaceState`) once it has been read. A non-positive-integer `open` value is ignored.
- Expiry is decided only by the server's `code: 'expired'` (plus the existing `mawareeth.case-seen` fallback for a vanished session). A linked SavedCase copy is never expired. That exemption already exists server-side; do not change it.
- New text exists in en, ar and fr, and is recorded in `deferred-work.md` for native review. `npm run i18n` passes. Buttons and links are at least 44 px (`min-h-11`), labelled, with visible focus. Names render in `<bdi dir="auto">`.

**Never:**
- No server, API-shape or migration change. Do not change `OpenSavedCaseView`, `CaseView` or `anonymous_case`.
- Do not change existing translation strings. Do not change the Save/Share `AuthGate` resume flow, the received/invite lists, or rename.
- No autosave (that is 10.5) and no browser leave warning.
- Do not change the Interview `<h1>` heading text (residual, see Design Notes).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open OK | Open 200 `case.id=W`; hand-off W; GET returns W, `saved:{revision}` | Interview shows the family (heirs screen) directly; no Resume/Start over | â€” |
| Reload linked | No hand-off; GET returns linked Case, no tab record | Direct family view, no prompt | â€” |
| Hand-off mismatch | Hand-off W; GET returns X or `case:null` | Open-failed notice + "Back to My cases" link; no family, no Start call | Hand-off cleared |
| Guest returning | Unlinked live Case, no hand-off, no tab record | Shipped Resume / Start over prompt | â€” |
| New Case, clean | Saved state clean or no Case | `startCase` â†’ 201 â†’ hand-off new id â†’ Interview new-case screen, no prompt | Failure: My cases error text, stays on the list |
| New Case, unsaved | Working copy unsaved/unreadable | Discard dialog (safe choice focused); confirm â†’ replace Start; cancel â†’ nothing | 409 â†’ re-read and re-prompt |
| Auth lost on Open | Open 401/403 and session probe says signed out | Navigate to `loginHref('/{locale}/cases/?open=7')` | 403 while still signed in â†’ existing generic failure |
| Return after sign-in | `/{locale}/cases/?open=7`, signed in | Param stripped; `begin(7)` â†’ Open â†’ Interview | 404 (other account/deleted) â†’ existing failure text, no navigation |
| Return still signed out | `?open=7`, signed out | Shipped sign-in link, its `next` keeping `?open=7`; no Open call | â€” |
| Expired guest | GET `{case:null, code:'expired'}` | Title "This case has expired", lifetime explanation, one Start button; no family | â€” |

</intent-contract>

## Code Map

- `web/src/app/[locale]/cases/cases-view.tsx:128-215` -- `open` â†’ `begin(id, again?)` (preflight `fetchCase`, `hasUnsavedChanges`, prompt) â†’ `go` (`openSavedCase`, `OPEN_CONFLICT` re-begin, `router.push`, `setError`). Line `:181` holds the empty-list message, `:159` the signed-out `loginHref(casesPath(locale))`, and `:227` the inline discard `<dialog>`. Generalise the pending action from "open id" to `{kind:'open', id} | {kind:'new'}` so the dialog serves both actions.
- `web/src/api/saved-cases.ts:127` `openSavedCase` -- returns a parsed Case, `OPEN_CONFLICT` or `null`. Add an `OPEN_AUTH` sentinel for 401/403. The caller then probes the session with the existing `use-session.ts` probe/helper; when signed out it redirects, otherwise it shows the generic failure.
- `web/src/api/case.ts:478` `parseCase`, `:517` `fetchCase`, `:589` `startCase`, `:152` `hasUnsavedChanges` -- `fetchCase` must expose `code === 'expired'` (for example a `{case:null, expired:true}` result or an `EXPIRED` sentinel). Keep existing callers compiling and behaving the same.
- `web/src/interview/flow.ts:736-760` -- load decision (`inProgress` â†’ `startedFor` / `existing`; no-Case branch using the `case-seen` flag â†’ expired or auto-start). Add the hand-off and `saved !== null` rules before `inProgress`. Add an `openFailed` screen/state for a mismatch. Use the server expired code ahead of the flag. Line `:762` `startOver` is unchanged.
- `web/src/interview/madhabs.ts:20`, `web/src/interview/answers.ts:281` -- sessionStorage key pattern (`mawareeth.*`). Put the hand-off helpers (`writeOpenHandoff(id)`, `takeOpenHandoff()`, both tolerant of missing storage) next to these, using the key `mawareeth.open-handoff`.
- `web/src/app/[locale]/interview/start-case.tsx:93,238,538-567` -- the load effect, the expired branch (add a title and explanation above the existing message and Start button) and the new open-failed branch (notice + `casesPath(locale)` link).
- `web/src/i18n/paths.ts:4` `loginHref`, `casesPath`. `web/src/app/[locale]/auth-form.tsx:67` follows `next` -- no change.
- `web/src/i18n/messages.ts` -- new keys in en, ar and fr. `cases.newCase` "Start a new case", `cases.newCaseFailed` "Could not start a new case. Please try again.", `interview.expiredTitle` "This case has expired", `interview.expiredLifetime` "Cases that are not saved to My cases are kept for 24 hours after the last change.", `interview.openFailed` "The selected case could not be opened.", `interview.backToCases` "Back to My cases". Put them in the namespaces that hold the neighbouring keys (`:710` cases, `:723`/`:920` interview).
- Server (read-only evidence): `api/views.py:624` Open (404 for missing or foreign rows, 403 signed out), `:77,:214` expired code, `api/anonymous_case.py:318` `is_expired` with the linked exemption, `:420` `start` clears the link.
- Tests: `web/src/app/[locale]/cases/cases-view.test.tsx` (`:50,:92,:224,:247,:273`), `web/src/api/saved-cases.test.ts:100-176`, `web/src/api/case.test.ts`, `web/src/interview/flow.test.ts:177-198,433,449`, `web/e2e/api.ts:79-161`, `web/e2e/cases.spec.ts:14-103`, `web/e2e/interview.spec.ts:78-132`. `web/e2e/results.spec.ts:148-169` has a stateful fixture example that asserts the loaded heir.

## Tasks & Acceptance

**Execution:**
- `web/src/interview/*` (hand-off helpers + `flow.ts`) + `flow.test.ts` -- add the hand-off and linked bypass, `openFailed` and server-coded expiry. Tests: hand-off match, mismatch, null Case with a hand-off (no Start), linked reload, unlinked guest prompt unchanged, expired code, and the flag fallback.
- `web/src/api/case.ts` + `case.test.ts` -- surface the expired code from `fetchCase`.
- `web/src/api/saved-cases.ts` + `saved-cases.test.ts` -- the `OPEN_AUTH` sentinel for 401 and 403.
- `web/src/app/[locale]/cases/cases-view.tsx` + `cases-view.test.tsx` -- write the hand-off before `router.push` on Open success. Add the New Case button, visible with an empty list or with rows (signed in), routed through the discard dialog and `startCase`, with a conflict re-prompt and visible failure. Redirect on auth loss. Resume `?open=` after sign-in. Tests cover each matrix row, including the param being stripped and the param being ignored when signed out or invalid.
- `web/src/app/[locale]/interview/start-case.tsx` (+ its tests if present) -- the expiry title and explanation, and the open-failed branch.
- `web/src/i18n/messages.ts` -- the new keys (en, ar, fr).
- `web/e2e/api.ts`, `web/e2e/cases.spec.ts`, `web/e2e/interview.spec.ts` -- en and ar: Open shows the stored heir with no Resume button (stateful GET after Open); New Case from an empty list and with an unsaved copy (discard); `?open=` resume when signed in; mismatch notice; expired title from the `code:'expired'` stub; axe on the new states.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- list the new en, ar and fr strings for native review.

**Acceptance Criteria:**
- Given an owned Saved case (including an Epic 8 converted one), when Open succeeds, then the Interview shows that Case's family with no Resume/Start over screen, and reloading the Interview keeps showing it.
- Given My cases with zero or more Saved cases, when the user chooses Start a new case and confirms any discard prompt, then a fresh Case opens in the Interview and no SavedCase is changed or deleted. A later Save of it creates a new SavedCase, because the link was cleared.
- Given expired authentication during Open, when the user signs in, then My cases reopens that same Case directly. Cancelling or failing sign-in reports no open success.
- Given a returning guest with an unsaved Case under 24 hours old, when the Interview loads, then the shipped Resume/Start over prompt shows. When the guest Case has expired, the titled expiry screen shows with one Start action and no family.

## Spec Change Log

## Review Triage Log

### 2026-11-27 — Review pass
- verdicts: 34 findings — high 0, medium 16, low 18, false 0, maybe-false 0
- review ran as one combined codex call (deep tier, diff 85 kB) with all five layers; cross-story-contract reported "No contract shape changed"
- findings:
  - `[low]` `[reject]` blind: a failed sessionStorage write loses the hand-off, and another tab's family could show — needs a storage failure plus a concurrent replacement in another tab; without a hand-off the page behaves as it did before this story; a fix adds a failure branch
  - `[low]` `[reject]` blind: a reload during the Interview GET loses the taken hand-off — needs a reload inside one request plus a concurrent replacement; the fix needs a deferred-removal protocol
  - `[low]` `[reject]` blind: after an unreadable preflight, New Case replaces without an id or revision — this matches Open's shipped Story 10.0 unreadable path, and the user has just confirmed "Discard unsaved changes?"
  - `[medium]` `[patch]` blind: the session probe after a refused Open uses a signal that is never aborted, so a stall leaves the buttons disabled — fixed: the probe times out after `PROBE_TIMEOUT_MS`
  - `[low]` `[reject]` blind: `parseOpenParam` rejects 16-digit ids — SavedCase ids are nowhere near 10^15
  - `[low]` `[reject]` blind: a `replaceState` failure leaves `?open=` to replay — replaceState does not fail in supported browsers, and a replay still runs through the discard prompt and server ownership
  - `[medium]` `[patch]` blind: New Case's discard confirmation reads "Yes, discard and open" — fixed: new key `cases.discardConfirmNew` (en, ar, fr), used for New Case only; the existing string is unchanged
  - `[medium]` `[patch]` blind: the Open browser test never identifies an heir — fixed: a distinctive heir is asserted on arrival and after reload
  - `[medium]` `[patch]` blind: the unsaved New Case browser test passes on the open-failed screen — fixed: GET follows the Start, and the fresh first screen is asserted
  - `[medium]` `[patch]` blind: no browser test follows a refused Open through login back to the case — fixed: an end-to-end login journey, plus a failed login that makes no Open
  - `[low]` `[reject]` blind: no test saves the fresh case to show the old SavedCase is untouched — `api/test_saved_case_unsaved.py` already asserts that Start clears the saved link; the server is unchanged
  - `[low]` `[reject]` edge: storage write failure — same as the blind row
  - `[low]` `[reject]` edge: reload before the GET settles — same as the blind row
  - `[low]` `[reject]` edge: unconditional replace after an unreadable preflight — same as the blind row
  - `[low]` `[reject]` edge: a Start 409 with an unparseable body shows the generic failure instead of re-prompting — the failure is visible, nothing is discarded, and pressing New Case again re-reads and re-prompts
  - `[medium]` `[patch]` edge: probe stall — same fix as the blind row
  - `[low]` `[reject]` edge: 16-digit id — same as the blind row
  - `[low]` `[reject]` edge: replaceState failure — same as the blind row
  - `[medium]` `[defer]` edge: `refreshed()` maps `EXPIRED` to the cached Case, so a failed edit can reconcile against an expired family — pre-existing: before this story, `fetchCase` returned null for expiry and the same branch kept `from.case`; recorded in frontmatter
  - `[medium]` `[patch]` edge: Open e2e identifies no heir — same fix as the blind row
  - `[medium]` `[patch]` edge: New Case e2e destination shows failure — same fix as the blind row
  - `[low]` `[patch]` edge: the expiry state has no axe scan — fixed: axe runs in the expiry browser test
  - `[medium]` `[patch]` verification-gap: Open never verifies whose family appears — same fix as the heir row
  - `[medium]` `[patch]` verification-gap: the discard-and-start test passes on the failure screen — same fix as the New Case e2e row
  - `[medium]` `[patch]` verification-gap: the sign-in tests skip the return from login — same fix as the login journey row
  - `[medium]` `[patch]` verification-gap: the New Case conflict test stops before the second confirmation — fixed: the unit test confirms again and asserts the newer revision and the navigation
  - `[medium]` `[defer]` verification-gap (other): reconciliation GET keeps cached data on expiry — same pre-existing defect as the edge row
  - `[low]` `[reject]` intent-alignment: converted rows, later-death links and preview revision are not observed through this Open journey — the server Open and the editor are unchanged and covered by Epic 8/9 tests; this diff only routes to them
  - `[low]` `[reject]` intent-alignment: New Case write-back preservation is not exercised end-to-end — covered server-side, as in the blind row
  - `[medium]` `[patch]` intent-alignment: sign-in return not followed to the family — same fix as the login journey row
  - `[low]` `[reject]` intent-alignment: the recovery prompt is chosen by link and tab record, not by sign-in state — an unlinked working copy of a signed-in user is an unsaved Case too; this is unchanged shipped behaviour
  - `[medium]` `[defer]` intent-alignment: a reconciliation GET can keep an expired family — same pre-existing defect as the edge row
  - `[low]` `[reject]` intent-alignment: the identity guarantee weakens on storage failure or a mid-read reload — same as the blind storage and reload rows
  - `[low]` `[reject]` intent-alignment: a literal reading in which the "Start an inheritance case" title should also go — the story names the resume-or-start-over screen, which is bypassed; the shared `<h1>` is a cross-cutting copy change (Design Notes)

## Design Notes

The hand-off closes the race codex found: `CaseWriteLockMiddleware` releases the lock before the Interview's GET, so another tab can replace the copy in between. Matching the hand-off id prevents showing a different family as the selected case, and it prevents falling through to auto-start. The hand-off lives in sessionStorage because it belongs to one tab, and it is taken (read and removed) once.

The `?open=` resume reuses the shipped login `next` pattern rather than adding storage. The server's owner filter is the access guarantee.

The Interview `<h1>` "Start an inheritance case" also shows on the family screen for guests today. Retitling it is a cross-cutting copy change and is left out of this story.

## Verification

**Commands:**
- `cd web && npm test && npm run typecheck && npm run lint && npm run i18n` -- expected: no failures, 0 lint errors
- `cd web && npm run build && npx playwright test e2e/cases.spec.ts e2e/interview.spec.ts e2e/results.spec.ts e2e/accessibility.spec.ts` -- expected: all pass; full suites run in PR CI
- `uv run python manage.py test api.test_saved_case_unsaved api.test_case_commands.ExpiryTests --noinput` -- expected: OK (server unchanged; a regression guard)

## Auto Run Result

Status: done

**Summary.** Opening a Saved case from My cases now goes straight into the Interview with its family loaded. A successful Open (or New Case) writes a one-tab hand-off (`mawareeth.open-handoff`) holding the returned working id. The Interview takes it once and enters the Case only when the GET returns that id; otherwise it shows "The selected case could not be opened" with a link back, and starts nothing. A linked working copy (`saved != null`) also skips the guest Resume/Start over prompt on later loads, so only an unlinked guest Case still sees it. My cases has a "Start a new case" button (empty or populated list). It uses the same preflight and discard dialog as Open (confirm label "Yes, discard and start a new case"), replaces the working copy through the existing Start boundary and re-prompts on a 409. An Open refused with 401/403 while signed out sends the user to sign-in with `next=/{locale}/cases/?open=<id>`. After sign-in My cases strips the parameter and resumes that Open through the same prompt; the server's owner filter keeps another account out. The server's `code: "expired"` now reaches the Interview, which shows "This case has expired", the 24-hour guest lifetime and one Start action. No server change.

**Files changed**
- `web/src/api/case.ts` (+ test) -- `EXPIRED` sentinel and `fetchCaseOrExpired`; `fetchCase` unchanged for its callers.
- `web/src/api/saved-cases.ts` (+ test) -- `OPEN_AUTH` for a 401/403 Open.
- `web/src/interview/open-handoff.ts` (+ test, new) -- hand-off write/take helpers.
- `web/src/interview/flow.ts` (+ test) -- hand-off match/mismatch, linked bypass, `openFailed`, server-coded expiry first.
- `web/src/app/[locale]/interview/start-case.tsx` -- hand-off taken once per mount; expiry title and lifetime; open-failed notice.
- `web/src/app/[locale]/cases/cases-view.tsx` (+ test) -- New Case, open/new pending action, hand-off on success, sign-in redirect with `?open=`, resume after sign-in, probe timeout.
- `web/src/i18n/messages.ts` -- 7 new keys in en, ar, fr.
- `web/e2e/api.ts`, `web/e2e/cases.spec.ts`, `web/e2e/interview.spec.ts` -- Open with a named heir and reload, New Case (empty, unsaved), mismatch, `?open=` resume, the full login round trip and failed login, the expiry screen with axe; three older tests now expect a linked Case to open directly.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- native-review entry for the new strings.

**Review findings.** 34 findings from one combined codex call (deep tier): high 0, medium 16, low 18, false 0.
- Patched (6 medium entries, 1 low; sent back to the implementation subagent):
  - The sign-in probe times out.
  - New Case has its own confirm label.
  - The Open e2e asserts a named heir.
  - The New Case e2e asserts the fresh first screen.
  - A login round-trip e2e, plus a failed login.
  - The New Case 409 unit test confirms a second time with the newer revision.
  - (low) axe on the expiry screen.
- Deferred: `refreshed()` keeps an expired family after a failed edit. This is pre-existing and recorded in frontmatter.
- Rejected, with reasons in the triage log:
  - Storage-write failure, and a reload mid-GET, losing the hand-off.
  - Unchecked replace after an unreadable preflight (same as Open's shipped path).
  - 16-digit ids.
  - `replaceState` failure.
  - A Start 409 with no readable body.
  - No Save-after-New-Case e2e (the server test covers it).
  - Converted or later-death data not re-tested through Open.
  - A prompt chosen by link rather than by sign-in state.
  - The shared `<h1>` heading.

**Follow-up review recommended: true.** Six medium entries were patched. The named unverified risk: the patch-pass changes are covered by their own new tests but no fresh review has checked them. They are the probe timeout, the New Case label switch and the rewritten e2e journeys (login stub flipping the session).

**Verification** (after the patches)
- `npm test`: 813/813 pass. `npm run typecheck`: OK. `npm run lint`: 0 errors (12 warnings, none in new non-test code). `npm run i18n`: OK.
- `npm run build`: OK. Playwright `cases.spec.ts interview.spec.ts results.spec.ts accessibility.spec.ts`: 307 passed.
- Django `api.test_saved_case_unsaved api.test_case_commands.ExpiryTests`: 26 tests OK (server unchanged; run before the patches, which touched web files only).

**Residual risks**
- The new en, ar and fr wording needs native review (recorded in deferred-work.md).
- The Interview `<h1>` still reads "Start an inheritance case" above a loaded family.
- If sessionStorage is unavailable, the Open identity check is skipped and the page falls back to the pre-story behaviour.
