---
title: 'Block the results page school choice while offline'
type: 'bugfix'
created: '2026-11-20'
status: 'done'
baseline_revision: 'af32332f5bc9ea9828cf9eaa22f8bb526fb29f6a'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Story 8.9 blocks every interview edit while the browser is offline (nothing is queued; the edit controls are frozen and `offlineEditing` is shown), but the results page's school choice (`results-view.tsx` `ChooseSchool`) still sends `setMadhab` offline. The visitor gets a generic failure for a write the interview would have refused up front. Deferred-work entry: "Story 8.9 follow-ups: The results page's School choice (`results-view.tsx` `ChooseSchool`) is not blocked while offline. Only the interview screens are."

**Approach:** Share the interview's `useOnline` hook. In `ChooseSchool`, treat offline like a save in flight (the choice does nothing and its button is `aria-disabled`) and show the existing `offlineEditing` status line while offline, as the interview's heirs screen does next to its own school choice.

## Boundaries & Constraints

**Always:** Reuse the existing `messages.interview.offlineEditing` string; add no new user-facing text in any locale. Block offline the same way the interview does: `navigator.onLine` read through `useSyncExternalStore` on the `online`/`offline` window events, with a server snapshot of `true`. Guard the write path itself (`choose`), not only the rendered control, so no `setMadhab` request is sent while `navigator.onLine` is false. Reconnecting re-enables the choice without a reload, and the visitor's picked radio is kept.

**Never:** No queueing or retry of an offline choice. No change to `SchoolChoice`'s props or markup beyond what `disabled` already does, no change to the interview's behavior, and no blocking of the read-only parts of the results page (draft PDF download, save/share gate, retry buttons): this story covers only the school choice. No change to translations or `.po` files.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Online choice | Results page in `choose_school`, online, school picked, Continue pressed | One `setMadhab` request; on `updated`/`replaced`/`gone` the page reloads as today | Unchanged `failed`/`throttled` alerts |
| Offline choice | Same, `navigator.onLine === false` | No request is sent; Continue is `aria-disabled="true"`; a `role="status"` line reads `offlineEditing` | None shown beyond the status line |
| Goes offline on the page | Online page, then an `offline` window event | Status line appears and the button becomes `aria-disabled` with no reload | n/a |
| Reconnects | Offline page, then an `online` window event | Status line disappears; picked radio kept; Continue sends one request | n/a |

</intent-contract>

## Code Map

- `web/src/app/[locale]/interview/start-case.tsx:92-104` -- `subscribeOnline` and `useOnline()` (private today). Used at :266 (`online`), :268 (`frozen`), :416 and :529-531 (offline notice `<p role="status" className="text-sm">{messages.offlineEditing}</p>`). Move both into a new shared module and import it here unchanged in behavior.
- `web/src/app/[locale]/results/results-view.tsx:153-208` -- `ChooseSchool`: `choose()` at :183 guards only `saving`; `SchoolChoice` gets `disabled={saving}` at :201. The target of the fix.
- `web/src/app/[locale]/interview/school-choice.tsx` -- `SchoolChoice`; `disabled` makes `submit` return early and sets `aria-disabled` on Continue. Read-only reuse; do not change.
- `web/src/app/[locale]/interview/share-preview.tsx:162-171` -- how the interview passes `saving={frozen}` into the same `SchoolChoice`. Reference for parity.
- `web/src/i18n/messages.ts:218-219` -- `offlineEditing` in `Messages["interview"]` (ar :554, en :880, fr :1208). Read-only.
- `web/src/app/[locale]/results/auth-gate.test.tsx` -- pattern for component tests: `installDom`/`teardownDom` from `@/test/dom` (happy-dom), `createRoot` + `act`, a mocked `globalThis.fetch` that records calls.
- `web/src/interview/preview.test.ts:271-320` and `web/src/interview/results.test.ts:~149` -- existing `choose_school` preview bodies (`differ`) and case fixtures to build the test's mocked `/case` and preview responses from.

## Tasks & Acceptance

**Execution:**
- `web/src/app/[locale]/interview/online.ts` (new) -- export `useOnline()` (with its private `subscribeOnline`), moved verbatim from `start-case.tsx`, keeping the doc comment -- one source of truth for the offline rule.
- `web/src/app/[locale]/interview/start-case.tsx` -- delete the local `subscribeOnline`/`useOnline` and import `useOnline` from `./online`; remove `useSyncExternalStore` from the React import only if it is then unused -- no behavior change.
- `web/src/app/[locale]/results/results-view.tsx` -- in `ChooseSchool`, call `useOnline()`; return early from `choose()` when `!navigator.onLine` (alongside `saving`); pass `disabled={saving || !online}`; render `<p role="status" className="text-sm">{interview.offlineEditing}</p>` above `SchoolChoice` while offline -- the fix.
- `web/src/app/[locale]/results/results-view.test.tsx` (new) -- render `ResultsView` with mocked fetch returning a `choose_school` case and preview; override `navigator.onLine` with a configurable getter and dispatch `offline`/`online` window events; cover all four I/O matrix rows, asserting the count of `setMadhab` (PATCH/POST to the case) requests, the button's `aria-disabled`, and the status line text -- proves the matrix at the rendered surface.

**Acceptance Criteria:**
- Given the interview, when the browser goes offline, then its existing offline behavior (frozen edits, notice on deceased/heirs screens, undo disabled) is unchanged; the existing web test suite passes without edits to interview tests.
- Given the web app, when `npm run lint`, `npm run typecheck` and `npm test` run in `web/`, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-11-20 — Review pass
- verdicts: 12 findings — high 0, medium 1, low 9, false 1, maybe-false 0 (one combined codex call, standard tier; layers blind-hunter, edge-case-hunter, verification-gap, intent-alignment, cross-story-contract; the contract layer reported "No contract shape changed")
- findings:
  - `[low]` `[reject]` blind-hunter: a save started online that fails after the connection drops shows the generic failure beside the offline notice — real but harmless (both messages are true); suppressing it adds a branch, and the intent forbids retry/queueing.
  - `[medium]` `[patch]` blind-hunter: no test submits while the form still looks enabled but `navigator.onLine` is false, so the `choose()` guard is unguarded — added "a submit after the connection dropped, before any offline event, sends nothing"; mutating the guard away now fails it (checked by the parent).
  - `[low]` `[patch]` blind-hunter: PATCH assertions count by method only — added `assertOnePatch()` checking URL `/api/v1/case/` and body `madhab` equal to the picked radio.
  - `[low]` `[reject]` blind-hunter: the reload after a successful save serves the unchanged case, so the test never shows results appear — the `onChosen` reload path is unchanged by this diff; covering it needs a new fixture pair for no benefit to this change.
  - `[low]` `[reject]` edge-case-hunter: connection drops during `setMadhab`'s CSRF probe (`web/src/api/case.ts:525-532`) and the PATCH is still attempted — pre-existing helper shared with the interview; the fetch simply fails into the existing failed alert; closing it needs a new parameter.
  - `[low]` `[reject]` edge-case-hunter: same as the first blind-hunter row (generic error beside offline notice) — same reason.
  - `[low]` `[reject]` edge-case-hunter: PATCH succeeds just before going offline, then the reload shows the load error — pre-existing reload behavior with its own retry button; deferring the reload adds state for a rare race.
  - `[low]` `[patch]` edge-case-hunter: write counters ignore the URL — same root cause as the PATCH-assertion row; fixed by `assertOnePatch()`.
  - `[medium]` `[patch]` verification-gap: the submit-time `!navigator.onLine` check can be removed without a test failure — pre-verified; same root cause and fix as the second blind-hunter row.
  - `[low]` `[patch]` verification-gap: no test keeps a save in flight across offline→online, so `disabled={saving || !online}` → `disabled={!online}` would pass — added a gated-PATCH test asserting Continue stays `aria-disabled="true"` after reconnecting; the mutation now fails it (checked by the parent).
  - `[low]` `[reject]` verification-gap (other): the CSRF-probe race in `web/src/api/case.ts:525-532` — duplicate of the edge-case-hunter row; same reason.
  - `[false]` `[reject]` intent-alignment: reading 2 ("the results route opened while offline") diverges because the tests mock successful reads — an offline visit fails `fetchCase` and renders the existing load-failed state with retry (`results-view.tsx:108`); no chooser mounts and no write is possible, so no write-blocking gap exists there.

## Verification

**Commands:**
- `cd web && npm test` -- expected: all tests pass, including the new `results-view.test.tsx`
- `cd web && npm run lint` -- expected: no errors
- `cd web && npm run typecheck` -- expected: no errors

## Auto Run Result

Status: done

**Change:** The results page's school choice (ChooseSchool) is now blocked while the browser is offline, as interview edits already were. `choose()` returns early when `navigator.onLine` is false. Continue is `aria-disabled` while offline or while a save is in flight. The existing `offlineEditing` status line shows above the choice. Reconnecting re-enables it and keeps the picked school. The interview's `useOnline` hook moved to a shared module, and the interview's behavior is unchanged. No new text and no translation changes.

**Files changed:**
- `web/src/app/[locale]/interview/online.ts` (new): `useOnline()`, moved verbatim from `start-case.tsx`.
- `web/src/app/[locale]/interview/start-case.tsx`: imports the shared hook; the local copy and the unused import are removed.
- `web/src/app/[locale]/results/results-view.tsx`: `ChooseSchool` offline guard, disabled state and status line.
- `web/src/app/[locale]/results/results-view.test.tsx` (new): 6 tests covering the 4 I/O matrix rows, a submit made before the offline event arrives, and a save in flight across a reconnect. They also assert the PATCH URL and body.
- `_bmad-output/implementation-artifacts/deferred-work.md`: the resolved Story 8.9 follow-up is removed.

**Review findings:** 12 findings from one combined codex call (standard tier). Patched: 3 entries (1 medium, 2 low), all test-only. Deferred: none. Rejected: 6 low, either pre-existing races or harmless double messages whose fixes add branches (reasons are in the triage log), and 1 false (an offline route visit renders the existing load-failed state, so no write is possible). No fallback agents were needed.

**Follow-up review recommended:** false. One medium entry and two low entries were patched, all as test additions.

**Verification:** `npm test` in `web/` passes 629 of 629. `npm run typecheck` passes. `npm run lint` reports 0 errors (the 12 warnings are in files this change did not touch, and ESLint on the changed files is clean). The parent mutation-checked both guards: removing `!navigator.onLine` from `choose()` fails 1 test, and changing `disabled={saving || !online}` to `disabled={!online}` fails 1 test.

**Residual risks:** `navigator.onLine` only reports that the browser has a network connection. If the browser reports online but the server is unreachable, the save fails with the existing generic alert, as it does in the interview. Screen-reader announcement of the status line was not checked with real assistive technology.
