---
title: 'Story 11.4: Keep summary controls reachable at narrow widths and high zoom'
type: 'feature'
created: '2026-11-27'
baseline_commit: 'f4374b773c979a0df4f94a0dc0a03baee36fbe96'
status: 'done'
baseline_revision: 'f4374b773c979a0df4f94a0dc0a03baee36fbe96'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
  - '{project-root}/web/AGENTS.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Story 11.3's fixed summary bar does not adapt. Under 360px its text and controls wrap unpredictably. In a short landscape viewport (including 400% zoom on a desktop, about 320×200) it covers a large part of the screen. The page has no block-end padding, so the last Heirs rows and the in-flow Undo toast can sit behind the bar. The toast never sits above the bar, and the combined bar-plus-toast 25% budget is not enforced.

**Approach:** Wrap the bar into two rows under 360px. In a landscape viewport under 480px high, replace the bar with an in-flow "Share preview" button that opens the same sheet. Float the Undo toast just above the bar while the two fit in 25% of the viewport height, and otherwise keep it in the page flow. Pad the Interview's block end by the obstruction so everything can scroll clear. Prove it with Playwright reflow, text-spacing, RTL, light/dark and axe checks.

## Boundaries & Constraints

**Always:**
- **Bar wrap:** below 360px (`max-[360px]:`, i.e. `width < 360px`) the bar is two rows: the text on its own full-width row, then Full results and the chevron on a second row. No horizontal page scroll at 320px, with or without the text-spacing override, in en, ar and fr. Every target stays ≥44px, and labels are not clipped (the text may wrap onto more lines). At 360px and up, the 11.3 single-row layout is unchanged.
- **Compact landscape:** when `(orientation: landscape) and (max-height: 479.98px)` matches, the fixed bar is not rendered and registers no obstruction. In its place, `SharePreviewSummary` renders an in-flow button labelled `previewHeading` ("Share preview"), with `aria-haspopup="dialog"`, `aria-expanded`, `data-summary-open`, ≥44px. It sits where the summary renders today, at the end of the Interview flow. It follows the bar's visibility rule exactly (root estate with shares, or the sheet open). It opens the same `<dialog>` (78dvh cap, internal scroll, heading focus). Close, Escape or the scrim return focus to the in-flow button.
- **Crossing thresholds** (1024px, 640px, the 480px landscape height, the 360px wrap): the one `useSharePreview` view, the accepted result and an open sheet are preserved. The `<dialog>` is never unmounted or re-opened by a layout change. If focus was on the opener that disappears (chevron ↔ in-flow button), focus moves to the opener now visible. When the sheet closes, focus goes to whichever opener is visible then, or to the Interview root if none is. Read the media query through one subscription (`matchMedia` plus a change listener, e.g. `useSyncExternalStore` with a server snapshot of `false`).
- **Toast placement:** the toast floats (`position: fixed`, just above the bar, 8px gap, page gutters, `max-w-xl` centred, above the bar's z-index) only while the bar is rendered and `barHeight + toastHeight + 8 ≤ 0.25 × innerHeight`. Otherwise it stays in the page flow, as today (DOM order after the Heirs list). Decide again on viewport resize and on any change of bar or toast height. For the toast height, use the last height it measured while floating, or its current height if it has never floated, so it does not flip back and forth. Floating changes only the visuals: DOM order, focus order, timer pause on hover and focus, `aria-disabled` and the Undo action stay as they are.
- **Obstruction contract** (`obstruction.ts`): the floating toast registers its height plus the 8px gap under `toast`, so `--interview-obstruction` and `scroll-padding-block-end` equal bar + gap + toast. An in-flow toast registers nothing while the bar is registered, so the padding equals the bar alone. With no bar (later estate, no shares, compact landscape) the in-flow toast keeps registering its height, as in 9.11. To let the toast read the bar's height, add a subscription such as `useObstructionHeight(key): number | null`, and a pure `toastFloats(bar, toast, viewport)` helper. The 25% cap in `obstructionPx` stays.
- **Page end:** the Interview root gets `padding-block-end: var(--interview-obstruction, 0px)`, so the last Heirs row, an in-flow toast and every focused card, row or control can scroll fully clear of the bar and a floating toast.
- Reduced motion: no new animation. Every summary action (bar, in-flow button, sheet) works under `reducedMotion: "reduce"`.
- Existing 16px mobile gutters, the 380px column at ≥1024px, and the labelled canvas as the only nested 2D scroller with ≥6px focus padding are unchanged.

**Never:** No new or changed translations (ar/en/fr msgstrs or `messages.ts` text). No change to Results, the API, the preview request effect or the single status node. No second `useSharePreview` instance, no in-page preview body, and no second dialog. No `left`/`right` CSS, only logical properties. Do not change 11.3's bar-visibility or sheet-persistence rules.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Narrow bar | 320×640, shares ready | text row above; Full results + chevron row below; no page x-scroll | — |
| Bar + toast fit | 375×800, bar ~60px, toast ~70px | toast fixed above bar; obstruction = bar+8+toast | toast expiry → obstruction = bar |
| Bar + toast too tall | 320×400 with text spacing, sum > 100px | toast in page flow; obstruction = bar only; page end padded | — |
| No bar | later estate or no shares, toast shown | toast in flow; obstruction = toast (9.11) | — |
| Compact landscape | 800×400 or 320×200 (400% zoom) | no fixed bar; in-flow "Share preview" button opens the sheet | close → focus button |
| Rotate with sheet open | 400×800 → 800×400 with the sheet open | sheet stays open with the same rows; close → focus in-flow button | — |
| Rotate with focus on opener | chevron focused, rotate to landscape | focus on in-flow button; back to portrait → chevron | — |
| Breakpoint crossing | sheet open, 1366 → 900 → 600 → 375 wide | sheet open, same revision, no extra preview request | — |

</intent-contract>

## Code Map

- `web/src/app/[locale]/interview/share-preview.tsx` -- `SummaryBar` :491 (fixed bar, `flex-wrap justify-between`, `useObstruction("bar", box)` :509, text span :517 opens the sheet, Full results link :521, chevron :524). `SharePreviewSummary` :547 owns `open`, `visible = showBar && (hasShares || open)` :577, refs `dialog/heading/chevron`, open/close effect :591–605 (focus heading; on close focus chevron or `focusRoot`), `<dialog>` :611. Add the compact-landscape mode, the in-flow button and the opener-swap focus here. Keep the dialog mounted across mode changes.
- `web/src/app/[locale]/interview/undo-toast.tsx` -- `UndoToast` :56 renders an in-flow div (`data-undo-toast`) with `useObstruction("toast", box)` :72. Add the float/flow decision and the conditional registration. A wrapper element carrying the 8px gap is fine, as long as `[data-undo-toast]` stays the inverted box.
- `web/src/interview/obstruction.ts` -- `obstructionPx` (sum capped at 25%), module registry `heights`, `setObstruction`, `useObstruction`. Add a listener set and `useObstructionHeight(key)`, plus the pure `toastFloats`. Tests: `obstruction.test.ts`.
- `web/src/app/[locale]/interview/start-case.tsx` -- Interview root div :560 (add the block-end padding). Toast mount :857 sits inside the left column after the Heirs list. Controller mount :871 (`showBar={layer?.id === null}`). `focusRoot` is passed already.
- `web/src/app/[locale]/globals.css` -- :64–65 `scroll-padding-block-end: var(--interview-obstruction, 0px)`. Bar and sheet shadow tokens :58–59. Pinned by `tokens.test.ts:71`.
- `web/src/i18n/messages.ts` -- `previewHeading`, `previewResultsLink`, `editClose`, `undoAction`. Read only.
- `web/src/app/[locale]/results/inheritance-table.tsx:233` -- the Full results table already has a labelled `role="region"` horizontal scroller. Only verify that it holds at 320px.
- `web/src/app/[locale]/interview/share-preview.test.tsx`, `undo-toast.test.tsx`, `edit-sheet.test.tsx` -- happy-dom patterns (`showModal` stub).
- `web/e2e/family.ts` -- `sheetOf` :34, `openPreview` :37 (clicks the chevron), `closePreview` :45. Add an opener-agnostic path, or a `openPreviewFromButton`, for compact landscape.
- `web/e2e/interview.spec.ts` -- 9.11 block :1932 (`spacing` text-spacing CSS :1946, 320px toast test :2119, toast-height test :2143). The bar+toast obstruction test at :2216 uses 320×240, which becomes compact landscape: move it to a portrait size and rewrite it against the new float/flow rules. 11.3 block :2487 (bar geometry and obstruction :2515).
- `web/e2e/accessibility.spec.ts` -- `spacing` :189, bar and sheet axe tests :163–176, 50-Heir axe :237.
- `web/e2e/capacity-journey.spec.ts:15,48,76` -- reads bar geometry at 1280×900. It must keep passing.
- `_bmad-output/planning-artifacts/ux-designs/ux-mawareeth-2026-11-16/DESIGN.md:218,395,451` and `EXPERIENCE.md:91,98,164` -- wrap, reflow, landscape and toast specs.

## Tasks & Acceptance

**Execution:**
- `web/src/interview/obstruction.ts` (+ `obstruction.test.ts`) -- add the listener set, `useObstructionHeight`, and the pure `toastFloats(bar, toast, viewport)` (true only when `bar > 0` and `bar + 8 + toast ≤ 0.25 × viewport`). Unit-test the boundary (equal fits, one px over does not), no bar, a zero viewport, and listener notification on set/remove.
- `web/src/app/[locale]/interview/share-preview.tsx` (+ `share-preview.test.tsx`) -- the under-360px two-row bar classes, the compact-landscape media subscription, the in-flow button, and the opener-swap and close-focus rules. Unit-test (stub `matchMedia`) that compact mode renders the button and no bar, opens the sheet, returns focus to the button on close, keeps the sheet open across a mode change, and moves focus between openers.
- `web/src/app/[locale]/interview/undo-toast.tsx` (+ `undo-toast.test.tsx`) -- float above the bar via `toastFloats`, and register the obstruction per the contract. Unit-test the class or attribute switch (expose `data-toast-placement="float|flow"`) with stubbed heights, and that Undo, the pause and `aria-disabled` behave the same in both placements.
- `web/src/app/[locale]/interview/start-case.tsx` -- Interview root `padding-block-end: var(--interview-obstruction, 0px)`. No other behaviour change.
- `web/e2e/family.ts`, `web/e2e/interview.spec.ts` -- new `Story 11.4` describe block, in en and ar (fr at least for the 320px wrap): the 320px wrap geometry (text row above both controls, both ≥44px, `scrollWidth ≤ clientWidth`), also with the text-spacing override. Bar + toast at 375×800: toast above the bar with no overlap, scroll-padding = bar+8+toast within 1px, and Tab to the last Heirs row leaves it fully clear of both. Too tall at 320×400 with text spacing: toast in flow, padding = bar. The compact landscape at 800×400 and 320×200: no bar, the button opens the sheet, Escape returns focus to the button. Rotating 400×800 ↔ 800×400 with the sheet open, then with the chevron focused. Crossing 1366 → 900 → 600 → 375 with the sheet open, with no new preview request. Reduced motion: the in-flow button and the bar still open and close the sheet. Rewrite the :2216 test for the new rules. Full results at 320px: the page has no x-scroll and the table region scrolls.
- `web/e2e/accessibility.spec.ts` -- axe at 320×640 with text spacing, the bar and then the open sheet, in en/ar/fr × light/dark. The compact-landscape button, in en and ar.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- record that a real browser zoom (rather than a 320px stand-in) and real-device rotation were not run, and that the in-flow button's position at the end of the Interview should be reviewed in Epic 12 copy and UX review.

**Acceptance Criteria:**
- Given the Interview at 320px (en, ar, fr), with and without the text-spacing override, when shares are ready, then the bar shows its text on the first row and Full results and the chevron on a second row, both ≥44px and fully inside the viewport, with no horizontal page scrolling.
- Given the bar and the Undo toast together at 375×800, when the page settles, then the toast sits fully above the bar, `scroll-padding-block-end` equals bar + 8px + toast within 1px and ≤25% of the viewport height, and a keyboard-focused last Heirs row is fully visible above both. Given a viewport where they would exceed 25%, when both are shown, then the toast is in the page flow, the padding equals the bar, and the toast's Undo still works.
- Given a landscape viewport under 480px high, when shares are ready, then no fixed bar exists, an in-flow "Share preview" button opens the same sheet (≤78% of viewport height), and closing it returns focus to that button.
- Given the sheet open or an opener focused, when the viewport crosses 1024px, 640px, 360px or the 480px landscape height, then the sheet stays open with the same accepted revision, no extra preview request is sent, and focus ends on the visible opener.
- Given the summary surfaces at 320px with text spacing in en/ar/fr, light and dark, when the acceptance checks run, then Playwright axe reports no serious or critical violations, focus outlines are visible, and Full results at 320px scrolls its table inside the labelled region, not the page.

## Spec Change Log

## Review Triage Log

### 2026-11-27 — Review pass
- Routing: no `codex`, `gemini`, `hermes` or `qwen` agent type was available in this session, so the five layers ran as one combined read-only sonnet subagent (the last fallback in the routing rule). The diff was 37 kB and excluded this spec. The cross-story-contract layer reported "No contract shape changed".
- verdicts: 40 findings — high 0, medium 8, low 18, false 9, maybe-false 5
- findings:
  - `[low]` `[patch]` blind 1: the float/flow unit test sets `window.innerHeight` and never restores it — confirmed (undo-toast.test.tsx:148,153). It is now saved and restored in `finally`.
  - `[low]` `[reject]` blind 2: `floatHeight` is never cleared, so a toast that got shorter may not float again — the toast is keyed per change and its text does not change while mounted; only a width change could shrink it. Rare, and the fix adds reset branches.
  - `[low]` `[patch]` blind 3: on first mount with a bar, the toast is floating at height 0 and measured in a `useEffect`, so it can paint one frame floating before it moves into the flow — confirmed. The measuring effect is now `useLayoutEffect`.
  - `[false]` `[reject]` blind 4: `setFloatHeight` during render may record a flow height — when `floats` is first true from a flow measurement, the next ResizeObserver callback after the switch to `fixed` re-measures, and `floatHeight` follows because `floats` is still true. The recorded value converges to the floating height.
  - `[low]` `[reject]` blind 5: compact landscape drops the bar's readiness text and Full results link — the AC says the in-flow button *replaces* the bar and opens the same sheet, which holds Full results; the status region still announces readiness. This is what the intent-contract specifies.
  - `[false]` `[reject]` blind 6: a stale `carryFocus` flag could pull focus later — the flag is set only in the matchMedia `change` handler, which fires only when `compact` flips. The `[compact]` effect then runs, even when the component returns null (the hook precedes the early return), and clears it.
  - `[maybe-false]` `[reject]` blind 7: root padding uses the 25%-capped obstruction, so a bar taller than 25% leaves the last rows under it — only in a portrait viewport under about 460px high at 320px wide with text spacing. Landscape short viewports get the in-flow button. If true it is low: rare, and the fix needs a second, uncapped variable.
  - `[low]` `[reject]` blind 8: the e2e stubs hold the next preview request for 20s — test-fixture style. The tests that do it do not depend on the clock for that request.
  - `[medium]` `[patch]` blind 9: the 320px text-spacing axe loop runs en and ar only, while AC5 requires ar/en/fr — confirmed (accessibility.spec.ts:134). "fr" was added to the loop.
  - `[low]` `[reject]` blind 10: `notify()` runs on every `setObstruction`, even for identical values — `useSyncExternalStore` drops renders when the snapshot is unchanged, so there is no visible cost.
  - `[low]` `[patch]` edge 1: first-mount float flash (grouped with blind 3).
  - `[low]` `[reject]` edge 2: stale `floatHeight` (grouped with blind 2).
  - `[low]` `[reject]` edge 3: when the bar registers after the toast, the padding briefly counts the in-flow toast — this lasts one effect tick and only adds harmless scroll padding.
  - `[false]` `[reject]` edge 4: a subscriber calling `setObstruction` inside `notify` loops — no subscriber does. `useObstructionHeight` only reads the store, and the toast writes from an effect, not from the listener.
  - `[false]` `[reject]` edge 5: stale `carryFocus` (grouped with blind 6).
  - `[false]` `[reject]` edge 6: focus lost to body via stale refs on close — React nulls the refs on unmount. The close path then uses `focusRoot`, and a unit test covers close after a mode swap.
  - `[maybe-false]` `[reject]` edge 7: capped page padding (grouped with blind 7).
  - `[medium]` `[patch]` edge 8: fr missing from the 320px axe loop (grouped with blind 9).
  - `[medium]` `[patch]` edge 9 (claim): no test focuses the last Heirs row and checks it is clear of the bar and floating toast — confirmed. The 375x800 e2e now moves focus to the last Heirs row by keyboard and asserts its box ends above the toast and the bar.
  - `[medium]` `[patch]` edge 10 (claim): fr missing (grouped with blind 9).
  - `[low]` `[patch]` edge 11 (claim): the unit test does not check pause or `aria-disabled` in the float placement — the unit test now asserts both while floating.
  - `[low]` `[patch]` edge 12 (claim): no e2e of Full results at 320px — confirmed (results.spec.ts has none). Added an en and ar test: no page x-scroll, and the labelled table region scrolls.
  - `[false]` `[reject]` edge 13: the 1024px and 640px crossings are only CSS — the reviewer's own note: the e2e width loop covers sheet state, revision and request count.
  - `[maybe-false]` `[reject]` edge 14: no Tab test (duplicate of edge 9 wording) — covered by the edge 9 patch.
  - `[medium]` `[patch]` verification-gap 1: the focused last row is not checked against the bar and toast (grouped with edge 9).
  - `[low]` `[patch]` verification-gap 2: toast pause and aria-disabled parity across placements (grouped with edge 11).
  - `[medium]` `[patch]` verification-gap 3: fr locale for the 320px axe check (grouped with blind 9).
  - `[low]` `[patch]` verification-gap 4: the unit test leaks `innerHeight` (grouped with blind 1).
  - `[false]` `[reject]` verification-gap 5: compact-mode obstruction deregistration — the layer itself found e2e coverage (variable ≈ 0 in compact landscape).
  - `[low]` `[reject]` verification-gap 6: no focus check at the 1024px and 640px crossings — no opener changes at those widths (the bar persists), so there is no focus move to verify.
  - `[low]` `[patch]` verification-gap 7: Results at 320px is not verified (grouped with edge 12).
  - `[low]` `[reject]` verification-gap other 1: stale `floatHeight` (grouped with blind 2).
  - `[low]` `[reject]` verification-gap other 2: compact mode drops the text and link (grouped with blind 5).
  - `[low]` `[patch]` intent-alignment 1: AC5's Results surface is untested (grouped with edge 12). The labelled region itself predates this story (inheritance-table.tsx:233).
  - `[medium]` `[patch]` intent-alignment 2: fr axe (grouped with blind 9).
  - `[medium]` `[patch]` intent-alignment 3: keyboard focus clearing the bar and toast is untested (grouped with edge 9).
  - `[maybe-false]` `[reject]` intent-alignment 4: the in-flow button sits at the end of the flow and drops the bar text — the AC names no position; the deferred-work note sends the position to the Epic 12 UX review. The text: grouped with blind 5.
  - `[false]` `[reject]` intent-alignment 5: 1024px/640px canvas padding and columns are untested here — this diff does not change them. 9.11's geometry tests at 7 widths still pass (interview.spec.ts, 196/196).
  - `[false]` `[reject]` intent-alignment 6: "toast in the page flow above the bar" holds only by DOM order — an in-flow toast sits in the document above the fixed bar, and the page-end padding lets it scroll fully clear. This matches AC6.
  - `[maybe-false]` `[reject]` intent-alignment 7: real 400% zoom and device rotation were not run — recorded in deferred-work.md as the viewport stand-in. If true it is low; no browser automation offers real zoom.

## Design Notes

**Why the toast floats.** Story 9.11 kept the toast in flow (owner decision, 2026-11-16) because no bar existed yet. Epic 9 handed the bar-plus-toast budget to this story. The 11.4 ACs and UX-DR35 ("inverted surface above the phone sticky bar") place the toast above the bar, with the in-flow position as the owner's fallback when the two exceed 25%. So in-flow stays the default whenever there is no bar.

**400% zoom.** A 1280×800 desktop at 400% is about 320×200 CSS px, which is landscape and under 480px high. So high zoom gets the in-flow button rather than a bar that would cover most of the screen. Portrait 320px gets the two-row bar.

```ts
export function toastFloats(bar: number, toast: number, viewport: number): boolean {
  return bar > 0 && bar + TOAST_GAP + toast <= OBSTRUCTION_SHARE * viewport;
}
```

## Verification

**Commands (from `web/`, Git Bash glob form):**
- `node --import ./src/test/loader.mjs --test "src/interview/*.test.ts" src/api/case.test.ts "src/app/[[]locale]/interview/*.test.tsx" "src/app/[[]locale]/results/results-view.test.tsx" "src/app/[[]locale]/tokens.test.ts"` -- all pass
- `npm run lint` and `npm run typecheck` -- 0 errors
- `npm run build` then `npm run test:e2e -- --project=chromium interview.spec.ts accessibility.spec.ts capacity-journey.spec.ts` -- all pass, none skipped

## Auto Run Result

Status: done

**Routing:** `/bmad-build-auto epic 11` picked the next backlog story of epic 11, which is 11.4. The implementation ran on a sonnet subagent. No `codex`, `gemini`, `hermes` or `qwen` agent type was available in this session, so the review layers ran as one combined read-only sonnet subagent (the routing rule's last fallback).

**Summary:**
- **Narrow bar:** below 360px the summary bar wraps into two rows: its text, then Full results and the chevron.
- **Compact landscape:** in a landscape viewport under 480px high (this includes 400% zoom on a desktop), the fixed bar is replaced by an in-flow "Share preview" button that opens the same sheet. The dialog stays mounted across mode changes. Focus follows when the focused opener is swapped out, and on close it returns to whichever opener is visible.
- **Undo toast:** it floats 8px above the bar while bar + gap + toast fit in 25% of the viewport height, and otherwise stays in the page flow.
- **Obstruction contract:** a floating toast registers its height plus the gap. An in-flow toast registers nothing while a bar exists, and its own height when there is no bar (9.11).
- **Page end:** the Interview root pads its block end by `--interview-obstruction`.

**Files changed:**
- `web/src/interview/obstruction.ts` (+ test) -- `TOAST_GAP`, `toastFloats`, `subscribeObstruction`, `useObstructionHeight`; the registry notifies subscribers.
- `web/src/app/[locale]/interview/undo-toast.tsx` (+ test) -- float/flow placement (`data-toast-placement`), layout-effect measuring, conditional obstruction registration.
- `web/src/app/[locale]/interview/share-preview.tsx` (+ test) -- the two-row bar under 360px, the compact-landscape subscription, the in-flow button and the opener focus rules.
- `web/src/app/[locale]/interview/start-case.tsx` -- block-end padding on the Interview root.
- `web/e2e/family.ts`, `interview.spec.ts`, `accessibility.spec.ts`, `results.spec.ts` -- the Story 11.4 e2e block, the rewritten 9.11 bar+toast test, axe at 320px with text spacing in en/ar/fr × light/dark and for the compact button, and Full results at 320px.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- the zoom and rotation stand-in note and the in-flow button position for Epic 12.

**Review:** 40 findings (high 0, medium 8, low 18, false 9, maybe-false 5).
- Patched, 6 entries:
  - Medium: fr in the 320px axe loop.
  - Medium: a keyboard-focused last Heirs row is checked clear of the floating toast and the bar.
  - Low: the toast's first-paint float flash (`useLayoutEffect`).
  - Low: the unit test restores `innerHeight`.
  - Low: pause and `aria-disabled` are asserted in the float placement.
  - Low: Full results at 320px.
- Deferred: none.
- Rejected, each with its reason in the triage log: stale `floatHeight` (the toast is keyed per change); compact mode dropping the bar text and link (the AC says the button replaces the bar); padding capped at 25% for very short portrait viewports (rare, and the fix needs a second variable); the 20s stub delays; redundant `notify` calls; false claims about `carryFocus`, ref staleness and notify re-entrancy.

**Follow-up review:** `true`. Two medium entries were patched. The specific unverified risk: proof that a focused control clears the floating toast rests on one 375×800 e2e run with reduced motion (instant scroll). In normal motion, the smooth scroll to a focused control was seen to settle clear only in a diagnostic run, and only for the last Heirs row, not for tree cards or other controls.

**Verification:**
- Node unit tests passed 591/591. Typecheck is clean. Lint has 0 errors and 12 existing warnings. `npm run build` succeeded.
- Chromium Playwright: `interview.spec.ts` 196/196, and `accessibility.spec.ts`, `capacity-journey.spec.ts` and `results.spec.ts` 101/101.
- The first post-patch run failed the new focus-clearance assertion once in en, while the smooth scroll was still running. Diagnostics showed the row settling clear (row bottom 352px against a toast top at 658px). The test now emulates reduced motion before tabbing, and then passed 8/8 under 4 workers.
- Before the patches, one 320px axe test failed once under load, then passed 12/12 in isolation.
- Firefox and WebKit were not run here; CI runs them.

**Residual risks:**
- Real browser zoom and device rotation were stood in for by viewport resizes.
- In a portrait viewport under about 460px high with text spacing, a bar taller than 25% of the viewport is not fully padded.
- The in-flow button sits at the end of the Interview flow, pending the Epic 12 UX review.
- The implementation subagent flipped six LF files to CRLF; the parent restored LF before review.
