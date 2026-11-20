---
title: 'Story 9.6: Undo family changes throughout the page visit'
type: 'feature'
created: '2026-11-20'
baseline_revision: '8324d1decf9c3bdb2cb88bb7a76ce783c9b7494a'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
  - '{project-root}/web/AGENTS.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** A mistaken add, bulk add, edit or removal in the Interview cannot be taken back. The server already has an atomic `restore` command (Story 8.9, `POST /api/v1/case/restore/`), but the browser has no history, no Undo control and no way to obtain the snapshot that restore requires. FR-5 and AD-20 ask for multi-step, page-only Undo.

**Approach:** Every response that hands the browser its live Case also carries `case.snapshot`, the server's own `export_snapshot` of that Case. The Interview keeps an in-memory stack of prior snapshots, one per successful family change. "Undo last change" (two persistent header controls, a toast action, Ctrl/Cmd+Z) sends one restore at the current revision with the top snapshot.

## Boundaries & Constraints

**Always:**
- **Server snapshot field.** One helper in `api/views.py` adds `snapshot = anonymous_case.export_snapshot(case)` to the `case` object of every response that returns the visitor's live session Case: `CaseView` (read, start, its 409), `conflict_response`, `respond_to_command` (success, `cascade_unconfirmed` 409, missing-heir 404), the preview conflict in `PreviewView`, and `OpenSavedCaseView`. Add it only at serialization. It is never written into the session or a SavedCase. Shared and received views do not get it. A null case stays null.
- **Client field.** `Case.snapshot?: Record<string, unknown>` in `web/src/api/case.ts`. `parseCase` keeps it as an opaque JSON object when it is a plain object, otherwise leaves it absent. The browser never builds or edits a snapshot.
- **New client call** `restoreCase(signal, caseId, revision, snapshot)` → `AnswerResult`. It posts `{case_id, expected_revision, snapshot}` with the same CSRF and throttle handling as `addHeir`. 200 `{case}` → `saved`; 409 → `replaced`; 404 / no case → `gone`; 400 (`invalid_snapshot`, `invalid_revision`) and malformed bodies → `failed`.
- **History** lives in the flow state (`StartedView`, `web/src/interview/flow.ts`), in memory only. Nothing goes in localStorage, sessionStorage, IndexedDB or the URL, so a reload starts empty.
  - An entry is `{snapshot, person?}`: the prior accepted Case's `snapshot`, and the id of the person the change touched.
  - A success (`saved`) of `addHeir` (single or bulk), `saveHeir`, `removeHeir` (confirmed cascades included) or `markDeath` / `unmarkDeath` pushes exactly one entry. `person`: the edited or removed id for `saveHeir` and `removeHeir`; the heir id for the death answers; none for adds. A prior Case without a snapshot pushes nothing.
  - These push nothing: refusals, `cascade` impact answers (no change yet), `failed`, `throttled`, `gone`, and an unchanged-name blur (no command is sent, as today).
  - A name edit is already one `saveHeir` on blur or Enter (Story 9.4). Keep that, and make it exactly one entry.
  - History is **cleared** when the Interview adopts a Case it did not produce itself: any `replaced` conflict (on any command, Undo included), a different case, `gone`, or a new case. It is also cleared by a successful non-family command (`saveDeceased`, the school of law), because a later restore would silently revert it.
- **Undo** is a new `Answer` `{kind: "undo", from}`. It does nothing when the history is empty. It sends one `restoreCase` with `from.case.revision` and the top entry's snapshot.
  - Success: pop that entry, adopt the returned Case (tree, list and the current-revision preview follow, as for any save), announce `undoDone` politely, and focus `card:<person>` when that card is present in the rendered estate, otherwise `card:root`.
  - `failed` or `throttled`: keep the entry and the family, and show `undoFailed` as a `role="alert"`.
  - `replaced`: adopt the current Case, show `conflictNotice`, clear the history, and never resend.
- **Persistent controls.** A 44px (`min-h-11 min-w-11`) text button `undoLastChange` ("Undo last change") in the Interview header (`start-case.tsx`) and in the Heirs list header (`heir-list.tsx`).
  - Both are rendered only while the history is non-empty, regardless of the toast.
  - While saving or offline they are `aria-disabled="true"` (never natively `disabled`) and a press does nothing. The existing `offlineEditing` line already explains offline.
- **Toast.** Shown after each change that pushed an entry.
  - It shows the change's announcement text plus a text button `undoAction` ("Undo").
  - Styling: inverted surface `bg-foreground text-background`, rounded `rounded-sheet`, and the button uses `focusRingOnToast` (`web/src/app/[locale]/ui.ts`).
  - It sits in DOM order right after the Heirs list. It is **not** a live region (no `role="status"`, `alert` or `aria-live`). The change is announced only by the existing polite region in `heir-list.tsx`.
  - Lifetime: at least 10 000 ms. The timer pauses while the toast has pointer hover or focus within it, and restarts at the full 10 s when both end. A new change replaces it (fresh 10 s). History is not touched when it expires.
  - It never moves focus. A successful Undo, or an emptied history, hides it.
- **Keyboard.** Ctrl+Z (Cmd+Z on macOS: `metaKey`), without Shift or Alt, runs Undo and calls `preventDefault`, but only when the history is non-empty, the controls are enabled, and the event target is not an `input`, `textarea`, `select` or `[contenteditable]`. Otherwise the event passes through untouched, so text fields keep native undo.
- **Copy:** new `interview` keys in ar, en and fr, listed in `deferred-work.md` under "Story 9.6" for native review:
  - `undoLastChange`: "Undo last change" / "تراجع عن آخر تغيير" / "Annuler la dernière modification"
  - `undoAction`: "Undo" / "تراجع" / "Annuler"
  - `undoDone`: "Last change undone." / "تم التراجع عن آخر تغيير." / "Dernière modification annulée."
  - `undoFailed`: "That change could not be undone. Try again." / "تعذّر التراجع عن هذا التغيير. حاول مرة أخرى." / "Impossible d’annuler cette modification. Réessayez."

**Never:**
- Change the `restore` command, its validation, the snapshot writers or the stored session or SavedCase shape. Share, preview and proof bytes stay identical.
- Build, diff or edit snapshots in the browser, or keep a client edit queue.
- Store history across reloads, or auto-retry a failed or conflicting restore.
- Add redo, Undo for the school of law or the deceased form, positioned adds (9.7), estate breadcrumbs (9.8), or announcement coalescing (9.10).
- Change existing translations.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Undo an add | 2 heirs at rev N; add Son → rev N+1; press header Undo | one POST `/case/restore/` `{expected_revision: N+1, snapshot: <rev N case.snapshot>}`; 2 heirs at rev N+2 with the original ids; `undoDone`; focus `card:root`; Undo hidden | — |
| Multi-step | add Son, rename Son 1 to "Ali", remove Daughter 1; Undo ×3 | each press one restore; walks back remove → rename → add; after the third, the original family and the controls are hidden | — |
| Bulk add | 4 daughters in one bulk add; Undo | one entry, one restore, all four gone | — |
| Cascade | confirmed removal that dropped a later-death estate; Undo | one restore brings back the person and estate with the same ids; focus `card:<id>` | — |
| Refusal / impact | refused add; unconfirmed remove answered with impact | no entry | — |
| Unchanged name | blur the name field with no change | no request, no entry | — |
| Restore fails | network error, 400 or throttled | entry kept, family unchanged, `undoFailed` alert | — |
| Restore conflict | 409 with the current Case | Case adopted, `conflictNotice`, history cleared, no resend | — |
| Offline | history non-empty, offline | both controls `aria-disabled`, Ctrl+Z does nothing, offline line shown | — |
| Ctrl+Z in a text field | focus in the name input | native text undo; no restore | — |
| Toast | change at t=0; hover from 5 s to 20 s | still visible at 29 s; gone after 30 s; header Undo still present | — |
| Reload | history non-empty, reload | no Undo controls | — |
| Server field | GET case; any command | `case.snapshot` equals `export_snapshot(case)`; the session holds no `snapshot` key | — |

</intent-contract>

## Code Map

- `api/case_commands.py:183` `restore` -- read-only. It takes `{case_id, expected_revision, snapshot}` and checks a strict round trip (`_canonical(export_snapshot(read_snapshot(s))) == _canonical(s)`), so the browser must send the server's own export verbatim. It keeps the case id, `started_at` and heir ids, and moves the revision forward by one. `api/views.py:240` `RestoreView` answers 200 `{case}`; `:141` `conflict_response` gives 409 `{error: "conflict", case}`; `:180` gives 400 `invalid_snapshot`; `:162` gives 400 `invalid_revision`. Tests: `api/test_case_commands.py:352` `RestoreTests`.
- `api/anonymous_case.py:881` `export_snapshot` -- the snapshot shape (`madhab`, `deceased`, `heirs`, `deaths`, optional `edges` and `died_before`). `:410` `_save(request, **case)` merges the case dict into the session. That is why the field must not go into `_decode` or `get` results; add it only in the views.
- `api/views.py` -- `CaseView:59` (read `:69`, start `:100`, 409 `:99`), `conflict_response:141`, `respond_to_command:147` (`:169` cascade, `:186` missing, `:190` success), `PreviewView:287` (conflict `~:305`), `OpenSavedCaseView:413` (`:425`). The shared views (`:526`, `:629`) stay unchanged.
- `web/src/api/case.ts` -- `Case:119`, `parseCase:431`, `AnswerResult:206`, `write:528`, `answer()` (409 handling `:668`), `addHeir:719`, `addHeirs:729`. Tests: `case.test.ts`.
- `web/src/interview/flow.ts` -- `StartedView:~104` (add `history`), `announce:55/805` (`seq`), focus targets `:71-87`, `Answer:564`, `precheck:615`, `send:751`, `saved:830-928` (adopts a Case, reconciles the layer and focus), `save:980-1112` (`replaced` handling `:1037-1074`), `Deps` (add `restoreCase`). Tests: `flow.test.ts`.
- `web/src/app/[locale]/interview/start-case.tsx` -- the Interview header `:428-435`; the offline line `:469-471`, from `useOnline()`; `conflictNotice` `:549`; the deps wiring. Add the header control, the Ctrl/Cmd+Z listener and the toast placement.
- `web/src/app/[locale]/interview/heir-list.tsx` -- the header `<h3 id="heirs-heading">` `:124`; the polite region `:128-134` (`key={announcement.seq}`). Add the second control. The toast renders after this list.
- `web/src/app/[locale]/interview/family-tree.tsx:53` -- cards are `data-focus="card:<id>"` and `data-node`, with roving `tabIndex`; `root` is the deceased.
- `web/src/app/[locale]/interview/edit-sheet.tsx` (test `edit-sheet.test.tsx`) -- the 9.4 edit surface; the name commits on blur or Enter as one `saveHeir`. No change needed beyond tests.
- `web/src/app/[locale]/globals.css:15,32,46` -- the `--toast-focus` token. `ui.ts:4` `focusRingOnToast`. The inverted surface is `bg-foreground text-background`.
- `web/src/i18n/messages.ts` -- the interview type `:56-227`; `heirsAdded` at ar `:404`, en `:714`, fr `:1025`. Key-parity tests are in `case.test.ts`.
- `web/e2e/api.ts:79-102` -- the heir and bulk mocks with recorded posts. Add a `/api/v1/case/restore/` route recording `restorePosts`, and include `snapshot` in the mocked cases. `web/e2e/interview.spec.ts` -- the `add relatives` suite `:339`; add an `undo` describe. `web/e2e/accessibility.spec.ts` -- axe runs over the panel.

## Tasks & Acceptance

**Execution:**
- `api/views.py` -- a `_with_snapshot(case)` helper (returns `None` for `None`) applied at each live-Case response listed above.
- `api/test_case_commands.py` -- tests:
  - `snapshot` is on the read, start and add responses, and on 409 conflict bodies;
  - it equals `export_snapshot` of the case;
  - the session holds no `snapshot` key after a command;
  - posting the snapshot from before an add to `/case/restore/` returns the earlier family with the same ids and revision + 1;
  - shared and received responses have no `snapshot`.
- `web/src/api/case.ts` (+ test) -- `Case.snapshot`, `parseCase`, `restoreCase` and its mapping (200, 409, 404, 400, malformed, network).
- `web/src/interview/flow.ts` (+ test) -- `history`, the push and clear rules, the `undo` answer, its outcomes and focus, and `Deps.restoreCase`. Unit-test every matrix row that has no UI.
- `web/src/app/[locale]/interview/start-case.tsx`, `heir-list.tsx`, a new `undo-toast.tsx` (+ tests) -- the two controls, the toast (fake timers for 10 s, pause and restart, replacement, not a live region, never moves focus) and the Ctrl/Cmd+Z listener (ignored in text fields, offline or while saving).
- `web/src/i18n/messages.ts` -- the four keys in ar, en and fr. `_bmad-output/implementation-artifacts/deferred-work.md` -- a "Story 9.6" copy list.
- `web/e2e/api.ts`, `web/e2e/interview.spec.ts` -- on the mocked API:
  - add, then header Undo → exactly one restore POST carrying the prior snapshot and the current revision; the family is back; focus on a card; the controls are hidden;
  - two changes, then two Ctrl+Z presses outside inputs walk back both;
  - Ctrl+Z inside the name input sends no restore;
  - a failed restore keeps Undo and shows the alert;
  - a restore 409 shows `conflictNotice` and hides Undo;
  - after a reload there is no Undo;
  - the toast is after the Heirs list, has an Undo button, and Undo is still available after the toast is dismissed.
- `web/e2e/accessibility.spec.ts` -- an axe run with the toast and controls visible, in en and ar.

**Acceptance Criteria:**
- Given any successful add, bulk add, edit, confirmed removal or death change, when it settles, then exactly one history entry holds the prior accepted snapshot, and refusals, impact prompts and failures add none.
- Given at least one entry, when Undo is invoked from either header control, the toast or Ctrl/Cmd+Z, then one restore at the current revision brings back the exact prior family with stable ids, the preview follows the new revision, and focus lands on the restored card.
- Given a reload, when the Interview loads, then no Undo control is shown and no Case or history is read from browser storage.
- Given the server tests, web unit tests, lint, typecheck, build and the interview and accessibility e2e specs, when run, then they pass with no new serious or critical axe violations.

## Spec Change Log

## Review Triage Log

### 2026-11-20 — Review pass (all five layers in one combined read-only gemini call at the deep tier; codex was over its usage limit until 2026-11-25)
- verdicts: 24 findings — high 0, medium 3, low 12, false 9, maybe-false 0
- findings:
  - `[medium]` `[patch]` (blind) Ctrl+Z tests only `event.key === "z"`, so an Arabic keyboard layout (`key: "ئ"`) gets no Undo — the listener now uses an `isUndoShortcut` helper that accepts "z", or `code === "KeyZ"` when the key is not a Latin letter (so AZERTY's physical KeyZ, "w", is still refused); unit-tested.
  - `[low]` `[reject]` (blind) the `undone` announcement carries a placeholder heir — no reader uses it (`start-case.tsx` skips the heir label for `undone`); removing it would widen the `Announcement` type for no user-visible change.
  - `[false]` `[reject]` (blind) both Undo buttons share `data-focus="undoLastChange"` — no focus request ever targets that value; focus after Undo goes to a card.
  - `[false]` `[reject]` (blind) `export_snapshot` can raise and turn a 409/404 into a 500 — every case passed to `_with_snapshot` comes from `_decode`/`read_snapshot`, which always sets the keys `export_snapshot` reads.
  - `[low]` `[patch]` (blind) the restore test omits `expected_revision`, so stale-restore conflicts are untested — added a RestoreTests case posting a stale revision, asserting 409 with the current case and an unchanged family.
  - `[low]` `[reject]` (blind) the `undoFailed` alert stays until the next action — the same lifetime as every other Interview refusal; `pendingView` clears it on the next command.
  - `[low]` `[reject]` (blind) toast blur with a null `relatedTarget` (window switch) restarts the countdown — it restarts at the full 10 s and focus returning pauses it again; the suggested guard would leave the toast paused forever after a click on the page background.
  - `[false]` `[reject]` (blind) undoing an add focuses the deceased rather than the add controls — the specified rule (Design Notes, "Focus after Undo"): the added card is gone, and the deceased card is always present.
  - `[false]` `[reject]` (blind) `top.snapshot` is not validated before sending — entries are pushed only from `Case.snapshot`, which `parseCase` keeps only when it is a plain object.
  - `[medium]` `[patch]` (edge-case) the Arabic-layout Ctrl+Z — same root and patch as the blind row.
  - `[false]` `[reject]` (edge-case) a family change from a Case without a snapshot wipes older history — intended: keeping older entries would let a later Undo silently revert this unrecorded change; every live response now carries a snapshot, so it is unreachable in practice.
  - `[low]` `[reject]` (edge-case) toast blur on window deactivation — same as the blind row.
  - `[false]` `[reject]` (edge-case) `_with_snapshot` can 500 — same as the blind row.
  - `[low]` `[patch]` (edge-case, claim) the spec's "shared and received responses have no snapshot" test is missing — added `assertNotIn('snapshot', …)` to existing shared-view and received-view tests in `api/tests.py`.
  - `[false]` `[reject]` (edge-case, claim) the restore test asserts revision + 2 where the spec says + 1 — `before` is read before the add, so + 2 is the add plus the restore, i.e. + 1 over the current revision.
  - `[low]` `[patch]` (verification-gap) no stale `expected_revision` restore test — same patch as the blind row.
  - `[low]` `[patch]` (verification-gap) no test that shared and received views omit `snapshot` — same patch as the edge-case claim row.
  - `[medium]` `[patch]` (verification-gap) no test of Ctrl+Z on a non-Latin layout — covered by the `isUndoShortcut` unit test from the blind row.
  - `[low]` `[reject]` (intent) the name-commit-as-one-Undo-step path is verified only in parts — the edit sheet's one PUT per blur/Enter and no request on an unchanged blur are Story 9.4's tests (unchanged surface), and one `saveHeir` = one entry is the flow test; together they cover AC2.
  - `[low]` `[patch]` (intent) no e2e focuses a restored card after undoing an edit or removal — added an e2e test: remove a heir, Undo, the card is back and focused.
  - `[low]` `[patch]` (intent) the polite `undoDone` announcement is not asserted at the surface — the same new e2e test asserts the Heirs-list status region text.
  - `[false]` `[reject]` (contract) a malformed snapshot is dropped and then clears history — same as the edge-case row: clearing is the intended safe rule, and the server always sends an object.
  - `[low]` `[reject]` (contract) no test sends the saved-case open response with `snapshot` — it goes through the same `_with_snapshot` helper the read/command tests cover, and `parseCase` is unit-tested for the field; a saved-case fixture adds setup for no new path.
  - `[false]` `[reject]` (contract) the cascade 409 is untested with `snapshot` — `parseCase` is the same parser for that body, and its snapshot handling is unit-tested; the cascade mapping ignores extra case fields.

## Design Notes

**Why the server sends the snapshot.** `restore` accepts only the exact canonical `export_snapshot` output. Rebuilding it in the browser from the Case response would copy the server's input schema (`same_as`, died-before rows, edge rules) into TypeScript and break with every schema change. Carrying the server's own export is lossless and keeps AD-20's "the server owns the Case". The field is added at the response layer because `_save(request, **case)` would otherwise persist it.

**Why history clears on non-family and foreign changes.** A snapshot is the whole Case: estate, school of law and family. Restoring one taken before a later estate edit, or before another tab's change, would silently revert that newer state, which AD-20 forbids ("a stale Undo overwriting newer state"). Clearing is the only rule that never reverts something the stack did not record.

**Focus after Undo.** Undoing a removal or edit brings back that person, so their card is focused. Undoing an add removes the card, so focus goes to the deceased (`card:root`), which is always present.

## Verification

**Commands:**
- `uv run python manage.py test api.test_case_commands --noinput` -- expected: pass.
- `cd web && npm test` -- expected: all pass.
- `cd web && npm run lint && npm run typecheck` -- expected: 0 errors; at most 12 lint warnings.
- `cd web && npm run build && npx playwright test e2e/interview.spec.ts e2e/accessibility.spec.ts` -- expected: all pass.

## Auto Run Result

Status: done

**Summary:** The Interview now has multi-step, page-only Undo. Every response that returns the visitor's live Case also carries `case.snapshot`, the server's own `export_snapshot` of it. The snapshot is added only at serialization and never stored, and shared and received views don't get it. Each successful family change pushes one entry onto an in-memory history: an add or bulk add, an edit (a name commits on blur or Enter, so one entry), a confirmed removal or cascade, or a death change. Refusals, impact prompts and failures push nothing. Another revision, a saved deceased form or a school-of-law change clears the history, so a restore never silently reverts something it did not record. "Undo last change" sends one `POST /case/restore/` at the current revision with the top snapshot. It appears in the Interview header and the Heirs list header (44px, `aria-disabled` while saving or offline, hidden when the history is empty), on the toast, and as Ctrl/Cmd+Z outside text fields, Arabic layout included. The toast uses the inverted surface, sits after the Heirs list and is not a live region; it lasts 10 s, pauses on hover or focus, and never moves focus. A successful restore pops the entry, adopts the returned Case, announces `undoDone` politely and focuses the restored card, or the deceased when that card is gone. A failed restore keeps the entry and shows an alert. A conflict adopts the live Case with `conflictNotice`, clears the history and does not resend.

**Files changed:**
- `api/views.py`: the `_with_snapshot` helper, applied to every live-Case response.
- `api/test_case_commands.py`: tests for the snapshot on read, add and 409 responses (never stored), a restore from a response snapshot, and a stale-revision restore.
- `api/tests.py`: the shared and received views carry no snapshot.
- `web/src/api/case.ts` (+ test): `Case.snapshot` and `restoreCase`.
- `web/src/interview/flow.ts` (+ test): the history, its push and clear rules, the `undo` answer and its outcomes.
- `web/src/app/[locale]/interview/undo-toast.tsx` (+ test), new: `UndoButton`, `UndoToast` and `isUndoShortcut`.
- `web/src/app/[locale]/interview/start-case.tsx`: the header control, the failure alert, the toast and the Ctrl/Cmd+Z listener.
- `web/src/app/[locale]/interview/heir-list.tsx`: the Heirs-list header control.
- `web/src/i18n/messages.ts`: `undoLastChange`, `undoAction`, `undoDone` and `undoFailed` in ar, en and fr.
- `web/e2e/api.ts`, `web/e2e/interview.spec.ts`, `web/e2e/accessibility.spec.ts`: the restore mock, nine Undo e2e tests and an axe run per locale. Four older lineage tests now find the Heirs section directly, because the heading now has a wrapper.
- `_bmad-output/implementation-artifacts/deferred-work.md`: the Story 9.6 copy, for native review.

**Run history:**
- Codex was over its usage limit until 2026-11-25, so investigation, e2e fixes and review used the gemini agent.
- The first Sonnet implementation run was cut off when the session ended with the machine low on memory, then resumed from its partial tree.
- The gemini e2e-fix run hit its 9.5-minute print timeout before reporting. The parent checked that its edits stayed in the two allowed test files, then verified them. Later fixes went to the Sonnet implementer.

**Review:** one pass, 24 findings: high 0, medium 3, low 12, false 9.
- **Patched** (5 entries; 1 medium, 4 low):
  - Ctrl+Z on non-Latin layouts (medium; three layers reported it);
  - the stale-revision restore test;
  - the shared and received no-snapshot test;
  - an e2e that undoes a removal (restored card focused, polite `undoDone`).
- **Deferred:** none.
- **Rejected:** every reason is in the Review Triage Log. The main ones:
  - the placeholder heir on the `undone` announcement;
  - the toast countdown on a window switch;
  - clearing history when a snapshot is missing, which is the intended safe rule;
  - extra saved-case and cascade envelope tests, which go through the same tested helper and parser.

**Follow-up review recommended:** false. One medium entry and no high entries were patched.

**Verification** (on the final tree):
- `uv run python manage.py test api.test_case_commands` plus the two shared and received view tests: 49 tests, OK.
- `npm test`: 582 of 582 pass.
- `npm run typecheck`: clean. `npm run lint`: 0 errors and 12 warnings.
- `npm run build`: OK.
- `npx playwright test e2e/interview.spec.ts e2e/accessibility.spec.ts`: 89 of 89 pass.

**Matrix audit:**
| Row | Covering tests |
|---|---|
| Undo an add | e2e "header Undo sends one restore…"; flow undo tests |
| Multi-step | e2e "two changes then two Ctrl+Z…"; flow push tests for edits and removals |
| Bulk add | flow "a saved bulk add pushes exactly one entry" |
| Cascade, removal focus | e2e "undoing a removal…"; flow focus test |
| Refusal, impact | flow "refusals, impact answers and failures push nothing" |
| Unchanged name | the 9.4 edit-sheet blur test (no request, so no entry) |
| Restore fails | flow test; e2e "a failed restore…" |
| Restore conflict | flow test; e2e "a restore conflict…" |
| Offline | e2e "offline, both Undo controls and Ctrl+Z do nothing…" |
| Ctrl+Z in a text field | e2e; `isUndoShortcut` unit test |
| Toast | `undo-toast.test.tsx` (lifetime, focus pause, restart, replacement); e2e toast order and lifetime |
| Reload | e2e "no Undo control … after a reload" |
| Server field | `RestoreTests` snapshot tests; shared and received assertions |

**Residual risks:**
- The full `api.tests` suite was not run in this story: two attempts were cut off by low memory or a timeout. The driver's batch run covers it. Only additive `snapshot` fields changed on responses.
- The toast hover-pause unit test uses simulated mouseover and mouseout. The focus pause and the e2e lifetime are covered properly.
- The new copy awaits native review.

**Follow-up (2026-11-20, after the run):** the first residual risk was real. An extra review with Qwen Code and ERNIE 5.5 Flash Preview found that four `api.tests` tests compared whole Case bodies or key sets without `snapshot`. A full `api.tests` run confirmed it: 8 failures in 4 tests, out of 289. The tests now expect `snapshot` (key set) and update it like `madhab` (body comparisons). `api.tests.CaseTests` and the madhab answer test pass, 42 tests.
