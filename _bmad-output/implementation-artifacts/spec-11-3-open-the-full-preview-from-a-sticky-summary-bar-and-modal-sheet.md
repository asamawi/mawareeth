---
title: 'Story 11.3: Open the full preview from a sticky summary bar and modal sheet'
type: 'feature'
created: '2026-11-22'
baseline_commit: '57fd94e20d5421c6357ace6c1281f853a525180d'
status: 'done'
review_loop_iteration: 1
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
  - '{project-root}/web/AGENTS.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Moving the one status node into the sheet remounts it with its last sentence, and on close the slot goes one tick before the status is re-hosted.
    evidence: |-
      start-case.tsx renders the status through createPortal into the dialog's slot while open. A remount, not a DOM move. Settle with NVDA/Chrome and VoiceOver/Safari: open and close the sheet after an announcement and listen for a repeat or a lost update.
    location: >-
      web/src/app/[locale]/interview/start-case.tsx:504
    severity: medium (unverified)
  - summary: >-
      The save notice and offline status stay in the inert background while the summary sheet is open.
    evidence: |-
      SaveNotice (form-bits.tsx:67) and the offline status keep role=status outside the dialog. The phone EditSheet has the same pattern since Epic 9. Settle with a screen reader under inert, then move or mirror them into the active dialog if they are missed.
    location: >-
      web/src/app/[locale]/interview/form-bits.tsx:67
    severity: medium (unverified)
  - summary: >-
      The preview lifecycle receives the later estate's heir count while a later estate is open, so a status sentence can quote it.
    evidence: |-
      start-case.tsx passes layer?.heirs.length to the controller, unchanged since 11.2. The bar is root-only, so it is unaffected.
    location: >-
      web/src/app/[locale]/interview/start-case.tsx:794
    severity: low
---

<intent-contract>

## Intent

**Problem:** Since 11.2 the Interview has no visible Share preview. `useSharePreview` runs headless and `SharePreviewBody` is rendered nowhere, so users cannot see shares, choose a School, Retry a failed preview, or reach Full results from the Interview.

**Approach:** Add a full-width fixed summary bar at every width. It shows the heir count, readiness, a primary Full results link and a 44px expand chevron. The chevron, or a tap on the bar's expandable area, opens `SharePreviewBody` in a native modal `<dialog>` summary sheet. Both are fed by the one existing `useSharePreview` owner, which stays mounted. Restore the preview e2e coverage that 11.2 turned off, through the sheet.

## Boundaries & Constraints

**Always:**
- Keep one hook owner (`useSharePreview`), mounted as today across estate switches and sheet open/close. The root `data-preview-state`/`data-preview-revision` signal, tree and Heirs-list blocked evidence (`onPresented`), and the single polite status keep their behaviour. The bar and sheet add no live region and announce nothing themselves. **Owner decision 2026-11-22 (a):** while the sheet is open, the Interview's one existing `role="status"` node is rendered inside the open dialog (for example with a React portal into a slot in the dialog), and it moves back when the sheet closes. There is always exactly one status node, so nothing is announced twice and screen readers hear updates while the background is inert.
- **Bar visibility (UX "Hidden until the Share preview has shares"):** the bar is visible only when the root estate is open (`layer?.id === null`) and `view.content.kind` is `available` or `choose`, including `kept` last-good rows during pending or offline error. It is hidden for `prompt`, `waiting`, `none`, `refused`, an online `error` without kept rows, and in any later-death estate. **Owner decision 2026-11-22:** this rule only decides when the bar *appears*. Once the sheet is open in the root estate, it stays open through every later state (`waiting`, online `error` with Retry, `refused`, `prompt`) and shows the body's own content for it, with the bar kept (inert) behind it. On close, the bar hides if the content no longer has shares. No grace timer.
- **Bar text** comes from existing messages only: `previewReadyCount` with the root heir count when `view.state` is `ready` or `choose-school`, `previewWaiting` while `pending`, and `previewFailed` (or `previewThrottled` when the existing body would show it) on error. It never shows `previewReadyCount` while pending or in error. Full results uses `previewResultsLink` to `/{locale}/results/` with `prefetch={false}`, and is a separate link that never opens the sheet. The chevron's accessible name is `previewHeading`, with `aria-haspopup="dialog"` and `aria-expanded`. Close uses `editClose`.
- **Sheet:** native `<dialog>` opened with `showModal()`, `aria-labelledby` its title-bar `<h2 id="preview-heading">` (`previewHeading`) plus a Close button. The title bar has a hairline divider and no shadow, and the body scrolls inside with the dialog at most 78dvh. Top-only 18px corners (`rounded-t-sheet`), 2px foreground top border, shadow `0 -8px 24px rgba(0,0,0,.2)`, `backdrop:bg-scrim`. In normal motion the sheet slides up and the scrim fades in briefly (about 200ms). Both are off under `motion-reduce:`. On open, focus the heading (`tabIndex=-1`). On Close, Escape or a scrim click, close and return focus to the chevron, or to the Interview root if the bar is hidden by then. The fixed bar gets `inert` while the sheet is open. No dialog opens on top of another.
- **Bar styling:** `position: fixed`, block-end 0, full viewport width (outside the 1360px shell's width), background, 2px foreground top border, shadow `0 -6px 16px rgba(0,0,0,.12)`, min-height 44px, every target ≥44px. Register its height with `useObstruction("bar", el)` so `--interview-obstruction` covers bar plus toast. At 375px, Full results and the chevron are inside the viewport.
- Reduced motion: any sheet slide or scrim fade is disabled under `prefers-reduced-motion` (`motion-reduce:`), and interaction still works.
- `SharePreviewBody` stays the single presentation. Render it in the sheet with the full hook view and the existing School-choice wiring (`onChooseSchool`, `saving`, `failed`). Add one optional prop so the body omits its own heading when hosted by the sheet. The disclaimer, Beta notice, Retry and School choice all work inside the sheet.
- Opening or closing the sheet never changes the Case and sends no request.

**Never:** No new or changed translations (ar/en/fr msgstrs or `messages.ts` text). No client share arithmetic. No under-360px wrap, landscape in-flow button or toast-into-flow logic (story 11.4). No change to Results, the API or the preview request effect. School choice in the sheet uses the Interview's `frozen` (saving or offline) as `saving`. No second `useSharePreview` instance and no in-page preview region.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Shares ready | root estate, state `ready`, available rows | bar visible: "Heirs: N. Shares ready.", Full results, chevron | — |
| Schools differ | state `choose-school` | bar visible; sheet shows comparison and School choice; choosing a School saves | save failure uses existing `failed` handling |
| Refresh | state `pending` with kept rows | bar visible with `previewWaiting`; sheet shows muted busy rows | stale responses discarded (unchanged) |
| Error with kept rows | `error`, kept rows (offline) | bar shows `previewFailed`; sheet shows rows plus error and Retry | Retry restarts pending |
| No shares, sheet closed | `prompt`/`waiting`/`none`/`refused`/online `error` without rows | no bar | status region announces as today |
| Sheet open, shares go | sheet open, then online `error`, `waiting` after a School choice, or `refused` | sheet stays open with the body's error and Retry, waiting or refusal content; bar stays inert behind it | Retry starts a new request; on close with no shares the bar hides and focus goes to the Interview root |
| Announcements with the sheet open | sheet open, an update settles or fails | the one status node is inside the dialog and speaks once | moves back to the Interview on close |
| Later estate | later-death layer open | no bar; sheet closed | lifecycle stays mounted |
| Dismiss | sheet open → Close / Escape / scrim | closed, bar no longer inert, focus on chevron | chevron gone → focus Interview root |

</intent-contract>

## Code Map

- `web/src/app/[locale]/interview/share-preview.tsx` -- exports `PreviewState` :32, `PreviewContent` :35 (`prompt|waiting|none|available|choose|refused|error`), `SharePreviewView` :45 (`state, revision, pending, kept, slowLevel, heirCount, content, reserve, bodyRef, retry`), `useSharePreview` :67, `SharePreviewBody` :255 (owns `#preview-heading` and `aria-busy` at :325–337, primary results link :405), `SharePreviewController` :451 (renders `null`, `onSignal`). State derivation :220–239. Extend the controller, or replace it with a started-only component, so the one hook view also renders the bar and sheet.
- `web/src/app/[locale]/interview/start-case.tsx` -- root div with the `data-preview-*` signal, `ref={target}` and `tabIndex={-1}` at :491–495. Polite status and coalescer at :151–156. Controller mount at :771–781 (passes `onPresented`, `post`, `drop`, heirCount). `layer = layerAt(...)` at :323–330, root when `layer?.id === null`. School-choice handler at :175/:605. EditSheet at :718–731. Undo toast at :733–769.
- `web/src/app/[locale]/interview/edit-sheet.tsx:114–121` -- the `showModal()` bottom-dialog pattern (initial focus, `backdrop:bg-scrim`, cancel handling). `web/src/app/[locale]/results/auth-gate.tsx:91,122` -- focus restored to the trigger.
- `web/src/interview/obstruction.ts:43` -- `useObstruction(key, el)` (sums keyed heights, caps at 25%). Usage: `undo-toast.tsx:72`. Consumed in `web/src/app/[locale]/globals.css:60–64`. Tokens: `scrim` and `rounded-t-sheet` are in `globals.css`. No summary shadows exist yet, so add bar and sheet shadow tokens there (with a reduced-motion precedent at :66–70).
- `web/src/i18n/messages.ts` -- interview keys `previewHeading`, `previewWaiting`, `previewReadyCount` ("Heirs: {count}. Shares ready."), `previewFailed`, `previewThrottled`, `previewResultsLink`, `editClose`. Read only.
- `web/src/app/[locale]/interview/share-preview.test.tsx` -- happy-dom pattern for the body. `edit-sheet.test.tsx:108` -- modal test pattern.
- `web/e2e/interview.spec.ts` -- fixme'd preview tests at 235, 248, 291, 304, 1669, 1705, 1726, 1743, 1773, 2190 (each preceded by an 11.3 comment). Mixed-test `// 11.3:` removals at 334, 419, 439, 1074, 1277, 2272. `rowsOf` :1648 scopes to `section[aria-labelledby='preview-heading']`. Heading query :316.
- `web/e2e/accessibility.spec.ts:132–152` -- fixme'd pending-preview axe test using the section selector.
- `_bmad-output/implementation-artifacts/deferred-work.md:585–590` -- the 11.2 list of what 11.3 restores.
- `_bmad-output/planning-artifacts/ux-designs/ux-mawareeth-2026-11-16/DESIGN.md:212–225` and `EXPERIENCE.md:91–93,150,162` -- bar and sheet specs.

## Tasks & Acceptance

**Execution:**
- `web/src/app/[locale]/interview/share-preview.tsx` -- add `SummaryBar` and `SummarySheet` (or one `SharePreviewSummary`) driven by the hook view, following the Boundaries. Add the body's optional no-heading prop. Keep `onSignal` behaviour.
- `web/src/app/[locale]/interview/start-case.tsx` -- render the bar and sheet from the single hook owner, pass root-estate visibility, the School-choice wiring and the root heir count. Leave the lifecycle and status unchanged.
- `web/src/app/[locale]/globals.css` -- add bar and sheet shadow tokens and any reduced-motion rule.
- `web/src/app/[locale]/interview/share-preview.test.tsx` -- happy-dom tests for every matrix row (visibility, bar text per state, Full results href and `prefetch` per locale, chevron attributes, `showModal` called, heading focus, close via Close and cancel event returns focus to the chevron, bar inert while open). happy-dom may lack `showModal`; stub it as `edit-sheet.test.tsx` does.
- `web/e2e/interview.spec.ts`, `web/e2e/accessibility.spec.ts`, `web/e2e/family.ts` -- add an `openPreview(page)` helper (click chevron, wait for dialog heading). Point `rowsOf` and the heading query at the dialog. Re-enable every 11.3 fixme by opening the sheet first. Restore the removed `// 11.3:` assertions through the sheet. Rewrite :1074 to "bar visible at root, hidden in later estate" and :1277 to "no bar while the estate is empty". Add tests for the bar at 375px (Full results and chevron in the viewport, full-width, ≥44px), 1366px (bar present with the two-column layout), Escape and scrim close with focus back on the chevron, and an axe run with the sheet open in en and ar.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- mark the 11.2 restore items done. Record that a full refusal or first-load error with no shares has no visible bar (status-only, per the UX rule), for review in 11.4/11.1.

**Acceptance Criteria:**
- Given the Interview at 375px and 1366px in en and ar with shares in the root estate, when the page settles, then the fixed bar spans the viewport width, shows the heir count and readiness, and Full results and the chevron are visible without scrolling and are ≥44px.
- Given the bar, when I activate the chevron or the bar's expandable area, then a modal dialog titled "Share preview" opens with focus on its heading, the background and bar are inert, and the rows, disclaimer, School choice and Full results inside it work. Activating the bar's Full results navigates to `/{locale}/results/` without opening the sheet.
- Given the open sheet, when I press Escape, click Close or click the scrim, then it closes, focus returns to the chevron, and the case revision is unchanged.
- Given an edit while the sheet is open or closed, when the preview is pending or fails, then the bar shows waiting or failure text, never "Shares ready", the sheet shows the body's pending or error state with Retry, and the polite status announces exactly as before.
- Given a later-death estate open, or a root estate without shares, then no bar is shown.

## Spec Change Log

### 2026-11-22 — intent gap resolved by the owner
- Trigger: review pass 1 (blind 1/2/6, edge 1/2/6/9, verification-gap 3, intent-alignment 3). An open sheet closed on an online error or a slow School-choice calculation, and the only status region was inert while the sheet was open.
- Amended, with owner approval of the recommended options: the bar-visibility rule now governs only appearance, and an open sheet persists through every root-estate state. The single status node moves into the open dialog. Matrix rows were added. The review's trivial items were added: `78dvh`, `frozen` for School choice, and the sheet slide and scrim fade.
- Known-bad state avoided: losing the error, Retry or the School-choice result mid-read, and silent updates for screen-reader users.
- KEEP: re-implement on top of [spec-11-3-attempt-1.patch](spec-11-3-attempt-1.patch) (re-applied to the tree). Keep the one controller owning the hook, `SummaryBar`/`SharePreviewSummary`, the shadow tokens, the `hideHeading` prop, the kept-rows error and Retry in the body, the e2e helpers `openPreview`/`closePreview`/`sheetOf`, all restored fixme tests, and the new bar, sheet and axe tests. Remove `HIDDEN_GRACE`.
- Extra tests from the review: the pending axe test waits for `data-preview-state='ready'` before adding. An e2e test scrolls an overflowing School-comparison sheet at a short viewport to Continue and clicks it. Another clicks the bar's Full results and asserts `/{locale}/results/`. Another does manual Retry after an online failure with the sheet open, expecting a new request and pending. Add computed-style checks of the bar and sheet shadows and the scrim in light and dark.

## Review Triage Log

### 2026-11-22 — Review pass
- One combined read-only codex call (deep tier, diff 66 kB) covered blind-hunter, edge-case-hunter, verification-gap, intent-alignment and cross-story-contract. The contract layer reported "No contract shape changed". The intent-alignment readings (its items 1–2) are logged through items 3–6.
- The attempted change is saved as [spec-11-3-attempt-1.patch](spec-11-3-attempt-1.patch). Code was reverted to the baseline.
- verdicts: 28 findings — high 0, medium 10, low 18, false 0, maybe-false 0 (7 of the low rows are rejected)
- findings:
  - `[medium]` `[intent_gap]` blind 1: an online refresh failure while the sheet is open removes the sheet and its Retry — confirmed: an online `error` has no kept rows, so `visible` goes false and after `HIDDEN_GRACE` the sheet closes (share-preview.tsx `SharePreviewSummary`). AC5 says an error while the sheet is present shows the error handling in the sheet. The cause is the intent-contract's "Bar visibility" rule and its matrix rows, which tie the sheet to "has shares".
  - `[medium]` `[intent_gap]` blind 2: after choosing a School, the sheet closes if the next calculation takes more than 300 ms — confirmed: `choose` content is not kept as `available`, so the pending render is `waiting`, the bar hides and the sheet is given up. Same root cause.
  - `[low]` `[intent_gap]` blind 3: School choice in the sheet uses `started.saving`, not `frozen`, so Continue stays enabled offline — confirmed (start-case.tsx:259 defines `frozen`). Pre-11.2 also passed `started.saving` (old start-case.tsx:602), but the contract named `saving`. Trivial fix (`saving={frozen}`) to fold into the re-run.
  - `[low]` `[reject]` blind 4: Ctrl/Cmd+Z reaches the window Undo listener while the sheet is open — real, but Undo is a deliberate user command, and the sheet then shows the updated accepted state. Guarding it adds a modal check for a rare path.
  - `[low]` `[reject]` blind 5: resizing below 640px with the desktop edit panel and the sheet both open makes the edit sheet `showModal()` over the preview — real but needs a deliberate resize with both open. The fix is a cross-component modal guard.
  - `[medium]` `[intent_gap]` blind 6: while the sheet is open, the single polite status is in the inert background, so screen readers may not hear updates — real. The phone EditSheet already has this pattern since Epic 9, but the summary sheet is where updates are read. The contract's "status unchanged, no new live region" rule decides it, so the owner must choose.
  - `[low]` `[reject]` blind 7: the bar drops the heir count while pending or failed — this is what the contract specifies (`previewWaiting`/`previewFailed`), and no existing message combines them.
  - `[low]` `[intent_gap]` blind 8: `78vh` can exceed the visible mobile viewport; the edit sheet uses `dvh` — confirmed (edit-sheet.tsx:227). Trivial fix (`78dvh`) to fold into the re-run.
  - `[low]` `[intent_gap]` blind 9: the pending axe test clicks Add before the first preview is ready, so it can wait for a chevron that never appears — confirmed (accessibility.spec.ts:152). Wait for `data-preview-state='ready'` first. Fold into the re-run.
  - `[medium]` `[intent_gap]` edge 1: online failure dismisses the open sheet (grouped with blind 1).
  - `[medium]` `[intent_gap]` edge 2: slow selected-School calculation closes the sheet (grouped with blind 2).
  - `[low]` `[intent_gap]` edge 3: School choice offline (grouped with blind 3).
  - `[low]` `[reject]` edge 4: clicking the dialog's 2px top border counts as a scrim click — real, since the target is the dialog itself. Rare in everyday use, and the fix adds a coordinate check.
  - `[low]` `[intent_gap]` edge 5: pending axe test race (grouped with blind 9).
  - `[medium]` `[intent_gap]` edge 6: the failed-preview e2e never activates Retry — confirmed (interview.spec.ts:1768 checks status only). It depends on the sheet-on-error decision.
  - `[low]` `[reject]` edge 7: the unit test does not observe `prefetch` — `next/link` emits no DOM attribute for it, so a unit test cannot observe it without mocking Link.
  - `[low]` `[reject]` edge 8: the unit close test dispatches `close` rather than `cancel` — Escape is exercised in Playwright (interview.spec.ts:2424).
  - `[medium]` `[intent_gap]` edge 9: status region inert while the sheet is open (grouped with blind 6).
  - `[low]` `[intent_gap]` verification-gap 1: no test scrolls an overflowing sheet to its last action — add a short-viewport School-comparison case that scrolls to and clicks Continue. Fold into the re-run.
  - `[low]` `[intent_gap]` verification-gap 2: the bar's Full results link is never activated in the browser — click it and assert `/{locale}/results/`. Fold into the re-run.
  - `[medium]` `[intent_gap]` verification-gap 3: manual Retry is never exercised with the real lifecycle (grouped with edge 6).
  - `[low]` `[intent_gap]` verification-gap 4: no computed-style check of the bar and sheet shadows or the scrim in light and dark — add one to the layout case. Fold into the re-run.
  - `[low]` `[intent_gap]` verification-gap other 1: pending axe test race (grouped with blind 9).
  - `[medium]` `[intent_gap]` verification-gap other 2: the slow-preview test reads an inert status node (grouped with blind 6).
  - `[medium]` `[intent_gap]` intent-alignment 3: the diff implements "the sheet exists only while shares exist", and AC5 is read as "an open sheet follows the update" (grouped with blind 1).
  - `[low]` `[intent_gap]` intent-alignment 4: navigation and overflow are tested one interaction short (grouped with verification-gap 1 and 2).
  - `[low]` `[reject]` intent-alignment 5: the window Undo handler and the responsive edit sheet stay active under the modal (grouped with blind 4 and 5, rejected for the same reasons).
  - `[low]` `[intent_gap]` intent-alignment 6: no sheet slide or scrim fade exists in normal motion. EXPERIENCE.md:150 lists "sheet slide, scrim fade" as motion to turn off under reduced motion, so they should exist. Add a short slide and fade with `motion-reduce:` off. Fold into the re-run.

### 2026-11-22 — Review pass 2 (after the owner's intent decisions)
- One combined read-only codex call (deep tier, diff 79 kB). The cross-story-contract layer reported "No contract shape changed".
- verdicts: 27 findings — high 0, medium 0, low 19, false 5, maybe-false 3
- findings:
  - `[low]` `[reject]` blind 1: the bar drops the heir count while pending or failed — carried: the contract specifies `previewWaiting`/`previewFailed`, and no existing message combines them.
  - `[low]` `[reject]` blind 2: a click on the dialog's 2px border counts as a scrim click — carried (pass 1 edge 4).
  - `[maybe-false]` `[defer]` blind 3: moving the status host remounts the paragraph with its last sentence, and on close the slot is removed one tick before the parent re-hosts the status — the remount is real. Whether a screen reader re-reads text already in a live region it has just met, or whether an announcement can land in that one-tick window, needs a real NVDA/VoiceOver check. Medium if true.
  - `[low]` `[patch]` blind 4: the deferred-work note says Retry is reachable only after an offline failure — out of date since the open sheet persists. The note was reworded.
  - `[low]` `[reject]` blind 5: the restored schools-agree test accepts any first row — the agreement sentence is story 11.1 and is not rendered yet. Tightening the row check adds little.
  - `[low]` `[reject]` blind 6: the linked-heir test accepts any sheet row after revision 2 — the revision-2 wait on the root already binds it to the accepted revision. Unlikely to hide a defect in everyday use.
  - `[low]` `[reject]` blind 7: the short-viewport test forces the Add Son click — the obstruction is measured separately, and the 375px bar test checks the controls are reachable.
  - `[low]` `[reject]` blind 8: the unchanged-Case check counts only POSTs — opening and closing the sheet issues no request (the sheet has no fetch of its own). Widening the stub counter is test-only and low value.
  - `[low]` `[reject]` blind 9: the School-choice stub does not advance the revision — a fixture realism point. Revision handling is covered by the 9.10 stale-revision tests.
  - `[low]` `[reject]` edge 1: border click as scrim — carried (pass 1 edge 4).
  - `[false]` `[reject]` edge 2: reopening before the queued native close event runs closes the new sheet — reopening needs a new click, which is dispatched after the queued close event, so the close cannot land on a reopened sheet.
  - `[low]` `[reject]` edge 3: an `available` outcome with no `presented` shows the bar with no rows — the server always sends `presented` with an answer (api/case.ts maps `available` from `PresentedResult.state === "answer"`), and the body already handles empty rows as before.
  - `[low]` `[reject]` edge 4: the desktop editor can `showModal()` over the preview after resizing below 640px — carried (pass 1 blind 5).
  - `[low]` `[reject]` edge 5: Ctrl/Cmd+Z works behind the modal — carried (pass 1 blind 4).
  - `[low]` `[reject]` edge 6: the unit test cannot observe `prefetch` — carried (pass 1 edge 7).
  - `[low]` `[reject]` edge 7: the unit test dispatches `close`, not `cancel` — carried (pass 1 edge 8).
  - `[low]` `[defer]` edge 8: the controller gets the later estate's heir count while a later estate is open, so a status sentence can use it — pre-existing since 11.2 (start-case passes `layer?.heirs.length`). The bar shows only in the root estate, where the count is the root's.
  - `[low]` `[reject]` edge 9: the agreement assertion was not restored — same as blind 5. It waits for 11.1.
  - `[maybe-false]` `[defer]` verification-gap 1: the save notice (`SaveNotice`) and the offline status stay in the inert background while the sheet is open — real, and outside the owner's decision, which moves the one routine announcer. The phone edit sheet has had the same pattern since Epic 9, so it is pre-existing. Whether a screen reader misses these depends on its handling of live regions under `inert`. Medium if true.
  - `[low]` `[reject]` verification-gap 2: no test of the editor and preview stacking across a resize — carried (pass 1 blind 5).
  - `[low]` `[patch]` verification-gap 3: reduced motion was never checked on the summary sheet — added an e2e test asserting `animation-name: none` on the sheet and its `::backdrop` under `reducedMotion: "reduce"`, closed with Escape.
  - `[low]` `[patch]` verification-gap 4: a whole-preview refusal arriving with the sheet open is only covered by an injected component view — added an e2e test with a served refusal reason, checking the sheet stays modal and the bar inert.
  - `[false]` `[reject]` intent-alignment 1: appearance and persistence — no divergence. The diff implements the owner's decision 1.
  - `[maybe-false]` `[defer]` intent-alignment 2: "one status" across the whole Interview — grouped with verification-gap 1.
  - `[false]` `[reject]` intent-alignment 3: dimensions and scrolling — no divergence. Reduced motion is covered by the verification-gap 3 patch.
  - `[low]` `[reject]` intent-alignment 4: modality of the composed Interview — grouped with the carried stacking and Undo rejections.
  - `[false]` `[reject]` intent-alignment 5: throttled or expired outcomes show no Retry — this is the existing lifecycle's behaviour, which the contract keeps unchanged.

## Design Notes

Hosting: the simplest shape is to have `SharePreviewController` (already started-only and mounted where the lifecycle must live) render `<SummaryBar/>` and `<SummarySheet/>` from its own `view`, taking extra props `showBar` (root estate), `onChooseSchool`, `saving` and `failed`. Then nothing else needs the view lifted.

```tsx
const view = useSharePreview(props);
const visible = props.showBar && (view.content.kind === "available" || view.content.kind === "choose");
return <>{visible && <SummaryBar view={view} onOpen={open} chevronRef={chevron} />}
  <SummarySheet ref={dialog} onClose={restore}><SharePreviewBody {...view} hideHeading ... /></SummarySheet></>;
```

Keep the `<dialog>` mounted, closed, whenever the bar can show, so `showModal()` has a node. Visibility is `showBar && (hasShares || open)`: an open sheet keeps itself and the bar mounted. Close it only on Close, Escape, a scrim click, or when the root estate stops being open.

## Verification

**Commands (from `web/`):**
- `node --import ./src/test/loader.mjs --test "src/interview/*.test.ts" src/api/case.test.ts "src/app/??locale??/interview/*.test.tsx" "src/app/??locale??/results/results-view.test.tsx"` -- all pass
- `npm run lint` and `npm run typecheck` -- 0 errors
- `npm run build` then `npm run test:e2e -- --project=chromium interview.spec.ts accessibility.spec.ts` -- pass, with no remaining 11.3 fixme

## Auto Run Result

Status: done

**Routing:** `/bmad-build-auto epic 9` halted because 9.12 waits for 11.3, and the owner chose 11.3. Pass 1 halted on an intent gap: the sheet was tied to "has shares", which conflicted with AC5. The owner chose the recommended options (an open sheet persists; the one status moves into the open sheet). The rework was built on top of the saved [spec-11-3-attempt-1.patch](spec-11-3-attempt-1.patch).

**Summary:** A fixed, full-width summary bar appears in the root estate once the preview has shares. It shows the heir count and readiness, a primary Full results link and a 44px chevron. The chevron or the bar's text opens a native modal sheet (`showModal()`) titled "Share preview" with a Close button. It is capped at 78dvh, scrolls internally, has 18px top corners, a 2px top border, the shadow and scrim tokens, and a 200ms slide and fade that are off under reduced motion. Once open, the sheet persists through waiting, error with Retry and refusal. The bar stays inert behind it and hides on close if no shares remain. Leaving the root estate closes it. Close, Escape and a scrim click return focus to the chevron, or to the Interview root. The Interview's one status node is portalled into the open sheet. One `useSharePreview` owner drives the root signal, the bar and the sheet.

**Files changed:**
- `web/src/app/[locale]/interview/share-preview.tsx` -- `SummaryBar`, `SharePreviewSummary`, the controller rendering them, `hideHeading`, and the kept-rows error with Retry in the body.
- `web/src/app/[locale]/interview/start-case.tsx` -- passes root-estate visibility, `frozen` School-choice wiring and `focusRoot`, and portals the one status node into the sheet's slot.
- `web/src/app/[locale]/globals.css` -- bar and sheet shadow tokens, and sheet slide and scrim fade keyframes, off under reduced motion.
- `web/src/app/[locale]/interview/share-preview.test.tsx` -- happy-dom tests for visibility, bar text, links, chevron, focus, inert, dismissal, persistence and the single status node.
- `web/e2e/family.ts`, `interview.spec.ts`, `accessibility.spec.ts` -- sheet helpers, every 11.2 fixme restored through the sheet, and new tests for bar geometry, dismissal, overflow scroll, Full results navigation, online-failure Retry, whole-preview refusal, computed styles in light and dark, reduced motion, the single status node, and axe with the sheet open.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- 11.2 restore items marked done. Retry and no-bar conditions recorded.

**Review:**
- Pass 1: 28 findings. Routed as an intent gap; the owner decided, and the review's trivial items were folded into the re-run.
- Pass 2: 27 findings.
  - Patched: 3 low (the deferred-work wording, a reduced-motion e2e test, a refusal-while-open e2e test).
  - Deferred: 3 (status remount re-read risk and other status regions behind the modal, both medium if true, unverified; the later-estate heir count in the status, low, pre-existing).
  - Rejected: the rest, each with its reason in the triage log. Main ones: stacked editor dialog after resizing, Ctrl+Z behind the modal, a click on the sheet's border counting as a scrim click, test-fixture realism.

**Follow-up review:** `false`. Pass 2 patched only low entries, and no high or medium entries were patched.

**Verification:** Node unit tests passed 526/526 (with the glob `src/app/[[]locale]/...`; the spec's `??locale??` form matches nothing in Git Bash). Typecheck is clean. Lint has 0 errors and 12 existing warnings. `npm run build` succeeded. Chromium Playwright `interview.spec.ts accessibility.spec.ts` passed 220/220 with none skipped. Firefox, WebKit and the other specs were not run here; CI runs them.

**Residual risks:** The status remount and the background status regions have not been checked with a real screen reader (deferred). The under-360px wrap, the landscape button and moving the toast into the page flow are story 11.4. The agreement sentence is story 11.1. `sprint-status.yaml` still shows 9.13 as `review`.
