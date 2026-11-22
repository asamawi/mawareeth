---
title: 'Story 9.11: Verify responsive, RTL and reduced-motion tree interactions'
type: 'feature'
created: '2026-11-22'
baseline_revision: '7451b30e531c79ea3322ffa978bb7acc1ef2e9f2'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
  - '{project-root}/web/AGENTS.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Real 400% browser zoom of the Interview, with focus exposure checked there, is not yet evidenced.
    evidence: |-
      The Playwright reflow tests set a 320px CSS viewport, which stands in for 400% zoom of 1280px but does not run the browser zoom path. The blind-hunter and intent-alignment layers both note this. The check is listed as pending for a person in deferred-work.md under "Story 9.11".
    location: >-
      web/e2e/interview.spec.ts (Story 9.11 320px tests); _bmad-output/implementation-artifacts/deferred-work.md (Story 9.11)
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Stories 9.1–9.10 built the Interview editor, but four of its responsive, RTL and motion promises do not hold. (1) At 1024px the tree column is 580px, not the required 596px or more. (2) The desktop edit panel sits under the canvas instead of in the inline-end column at 1280px and up. (3) Nothing sets `scroll-padding-block-end` for the Undo toast or a bottom-summary obstruction. (4) Cards jump with no 300ms reflow. The Undo toast also uses `bg-foreground text-background`, but the `@theme` block does not define those utilities, so the toast fill and its 17.93:1 / 16.91:1 contrast are not rendered. There is no 320px / 400% zoom / text-spacing proof, no motion proof, and no proof that RTL comes from the registry.

**Approach:** Make small layout, CSS and token fixes in the existing components. Add a small obstruction contract: a pure function plus a hook that sets one CSS variable. Add 300ms motion-safe card transitions. Wrap Arabic term segments in `<bdi>`. Then prove every acceptance clause with Playwright geometry, reflow, RTL, motion and contrast checks, plus unit tests.

## Boundaries & Constraints

**Always:**
- **Ranges** (Tailwind defaults sm 640, lg 1024, xl 1280; no new breakpoints):
  - Below 1024px: unchanged. One column in the order Add relatives, tree, Heirs list. 16px inline padding (`px-4`). Buttons wrap. Cards are 108px wide below 640px and 136px from 640px. Below 640px editing is the modal bottom sheet. At 640–1023px the non-modal panel stays below the canvas.
  - 1024–1279px: the shell keeps 24px inline padding. Columns are a 380px relatives/list column and a tree column whose box is **at least 596px wide at a 1024px viewport**. Remove the column gap, and divide the columns with a 1px `border-line` inline-start border on the tree column plus inner padding. The edit panel stays non-modal in the tree column, which is the inline-end column here.
  - 1280px and up: a shell of at most 1360px. Columns are 380px, flexible tree and 340px preview, with 1px `border-line` dividers. The preview column has 24px padding. While a person is being edited, the non-modal edit panel renders in the **inline-end (third) column above the Share preview**, which stays mounted below it. In a later estate (two columns, preview hidden) the panel stays in the tree column. Its DOM order stays after the tree and before the Heirs list, so tab order is unchanged.
  - Focus rules from 9.4, 9.6 and 9.9 are unchanged: close restores focus to the opener, and Escape closes.
- **Reflow.** At a 320px CSS width (which is also what 400% zoom of 1280px gives), in en and ar, with the WCAG 1.4.12 overrides applied (line-height 1.5, paragraph spacing 2em, letter spacing 0.12em, word spacing 0.16em):
  - `document.documentElement.scrollWidth <= clientWidth`.
  - The canvas is the only element with both horizontal and vertical scrolling, and it keeps its accessible name.
  - The canvas padding is at least 6px, and a focused card's outline lies inside the canvas's visible box.
  - No card's text is clipped (`scrollHeight <= clientHeight` for each card). If the fixed 112px card height cannot hold the text, raise the layout's card height. Never shrink text or badge typography.
  - Navigating, editing and Undo all still work with the toast visible.
- **Obstruction contract** (`web/src/interview/obstruction.ts`):
  - A pure `obstructionPx(heights: number[], viewportHeight: number) = min(sum, 0.25 × viewportHeight)`.
  - A `useObstruction(key, element | null)` hook measures with `ResizeObserver`, keeps a module-level registry of heights by key, and writes the result to `--interview-obstruction` (px) on `document.documentElement`. Removing an entry recomputes. Viewport resize recomputes.
  - `globals.css` sets `html { scroll-padding-block-end: var(--interview-obstruction, 0px) }`.
  - The Undo toast registers under the key `toast`. Epic 11's summary bar will register under `summary`; this story only supplies the API. The toast stays in flow (owner decision, 2026-11-16).
- **RTL.**
  - `lang` and `dir` come from the registry through `directionOf`.
  - Add a test-only registry fixture with an RTL `ur` entry. It proves that the direction derivation and the RTL e2e helpers are driven by the registry, not by a hard-coded `ar`. No Urdu locale or messages are published.
  - Only the connector SVG is transformed. Cards, badges and text are never mirrored. Chevrons flip as they do now.
  - Arabic term segments rendered by `relationship-text.tsx` use `<bdi lang="ar" dir="rtl">` (and `<bdi lang="en">` for English fallback segments) in place of `<span lang dir>`.
  - Names stay in `<bdi>` (implicit `dir=auto`). Fractions stay `dir="ltr"`.
  - No browser `Intl` or share formatting.
- **Motion.**
  - Positioned cards transition `inset-inline-start` and `top` over exactly 300ms, using `motion-safe:` only.
  - Under `prefers-reduced-motion: reduce` there is no transition or animation in the Interview: card movement, sheet or scrim, toast, skeleton and zoom. Every `scrollIntoView` or `scrollBy` uses `instant` or `auto`. Every action still works.
- **Contrast and tokens.**
  - Add `--color-foreground` and `--color-background` to `@theme inline`, so the toast renders foreground fill on background text, with a `toast-focus` ring.
  - Pin these ratios in `tokens.test.ts` for light and dark: accent on accent-soft 4.71 / 10.29, toast-focus on foreground 17.93 / 16.91, text ≥4.5, and graphic on surface and background ≥3.
  - Essential card, sheet and focus boundaries use `graphic`, `accent` or `current`, never `line`. `line` stays decorative (dividers, dots).
  - Badge font size stays `text-badge` at every width.

**Never:**
- Epic 11 work: the sticky bar or sheet, bar wrapping below 360px, the under-480px landscape in-flow preview, or the Full results redesign.
- Server, API, command or engine changes.
- Changing any message text or translation, or publishing a new Locale.
- New breakpoints, opacity-based muting, spinners, or new colours outside the existing tokens.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 1024px | lineage fixture, en and ar | relatives/list column = 380px, tree column ≥596px, 1px divider, no page overflow | — |
| 1280px edit | open a card editor | non-modal panel in the inline-end column above the preview; Escape returns focus to the card | — |
| 1280px later estate | edit inside an opened estate | panel in the tree column; preview hidden | — |
| 375px edit | tap card | modal bottom sheet (unchanged) | — |
| 320px + spacing, ar | navigate, edit, Undo with toast | no page horizontal scroll; canvas is the only 2D scroller; focus outline visible | — |
| Toast shown | add relative | `--interview-obstruction` = toast height; html `scroll-padding-block-end` equals it | toast gone → 0px |
| Tall obstruction | heights sum > 25% of viewport | value capped at `0.25 × innerHeight` | — |
| Reduced motion | add (cards shift) | card `transition-duration` computes 0s; positions final immediately | — |
| Normal motion | add | shifted card `transition-duration` 0.3s on inset/top | — |
| `ur` fixture | registry with RTL `ur` | direction derivation returns `rtl` | non-locale → `ltr` |

</intent-contract>

## Code Map

Paths under `web/src/app/[locale]/interview/` unless stated.
- `page.tsx:19` -- `<main>` shell: `max-w-[1360px] px-4 lg:px-6`. Keep it.
- `start-case.tsx:649-800` -- the grid:
  - `:651` `gap-4 lg:grid-cols-[380px_minmax(0,1fr)]`, and `xl:...340px` only when `layer?.id == null`. The 16px gap is why the tree is 580px at 1024px.
  - `:707` tree column (`lg:col-start-2 lg:row-span-2`). `:737-750` `EditSheet` is rendered inside that column. Move it into its own grid child: tree column at lg; `xl:col-start-3 xl:row-start-1` when the preview column exists, with the preview moved to the next row.
  - `:787` preview wrapper (`xl:col-start-3 xl:row-span-2`).
  - `:770-783` `UndoToast` mount.
- `edit-sheet.tsx` -- `:13-15,70` `matchMedia("(width < 640px)")` decides phone or panel. `:104` `showModal()`. `:197-201` dialog vs `<section className="mt-3 rounded-sheet border border-graphic bg-surface p-4">`. No change to the phone path.
- `family-tree.tsx`:
  - `:110-111` positioned cards: inline style `insetInlineStart/top/width/height`. Add a `motion-safe:transition-[inset-inline-start,top] motion-safe:duration-300` class.
  - `:88` focus `scrollIntoView` (default behavior). `:125-129` zoom buttons.
  - `:133-134` canvas `overflow-auto p-2` (8px), dotted grid. `:150-152` scale wrapper, and the connector SVG `rtl:-scale-x-100`. `:162-163` empty add cards, `min-h-[76px]`.
- `web/src/interview/tree.ts:43-45,131,148` -- card width 108/136 and height 112. Raise the height here only if the reflow check proves clipping.
- `start-case.tsx:285-304` -- reveal `scrollBy`/`scrollIntoView`, smooth or instant by `matchMedia(reduce)`. Keep it.
- `undo-toast.tsx:76-91` -- toast `bg-foreground text-background`. Attach `useObstruction("toast", ref)`.
- `relationship-text.tsx:4-13` -- `<span lang dir>` segments → `<bdi>`.
- `web/src/app/[locale]/globals.css`:
  - `:3-34` tokens. `:36-55` `@theme inline`: add foreground and background.
  - `:57-66` scroll-behavior and the reduced-motion rule: add `scroll-padding-block-end`.
- `web/src/i18n/messages.ts:11-14` -- `directionOf`. `web/src/i18n/validate.test.ts:18-19` has an `entry(code, direction)` fixture helper to reuse. For the `ur` fixture, extract a pure `directionFrom(registry, code)` used by `directionOf`.
- `../i18n/locales.json` -- read-only.
- `web/src/app/[locale]/tokens.test.ts:21,26,44` -- token, typography and contrast pins. Extend it.
- E2E:
  - `web/e2e/interview.spec.ts`: `:202-219` reduced-motion `test.use`; `:604,628` panel and sheet; `:833` toast; `:861-914` shell geometry at 375, 1100 and 1366px and Arabic at 1100px; `:926,937` token and focus; `:1223` card states and canvas; `:1272,1300,1366` 50 heirs, arrows, focus ring.
  - `web/e2e/accessibility.spec.ts:13-62` axe.
  - `web/e2e/family.ts:20,33,62` fixtures `openHeirsScreen`, `lineageFixture`, the empty fixture and the 50-son fixture.
  - `web/e2e/api.ts:38,67,147` case stubs.
- `../_bmad-output/implementation-artifacts/deferred-work.md:197,209,217` -- existing RTL, 320px and dark-mode items. Mark them addressed by 9.11 where this story proves them, and add a "Story 9.11" section.

## Tasks & Acceptance

**Execution:**
- `web/src/interview/obstruction.ts` + `obstruction.test.ts` -- pure `obstructionPx` with the cap, plus the hook and registry. Unit-test the sum, the cap, removal and a zero viewport.
- `web/src/app/[locale]/globals.css` -- `@theme` foreground and background; `scroll-padding-block-end` variable.
- `undo-toast.tsx` -- register the obstruction.
- `start-case.tsx` -- grid: no column gap at lg and up, divider borders and inner padding, edit panel as its own grid child placed by the rules above, preview column 24px padding.
- `edit-sheet.tsx` -- drop the `mt-3` that the panel placement no longer needs. The phone path is unchanged.
- `family-tree.tsx` (and `web/src/interview/tree.ts` only if needed) -- 300ms motion-safe card transitions; reduced-motion safety for focus scrolling; no clipping under text spacing.
- `relationship-text.tsx` -- bdi segments.
- `web/src/i18n/messages.ts` + a test -- `directionFrom` with the `ur` RTL fixture.
- `web/src/app/[locale]/tokens.test.ts` -- the contrast pins above.
- Component tests (`family-tree.test.tsx`, `undo-toast.test.tsx`, `edit-sheet.test.tsx`) -- update them for the class and placement changes.
- `web/e2e/interview.spec.ts` -- a "Story 9.11" describe:
  - geometry at 320, 639, 640, 1023, 1024, 1279 and 1280px (column widths, tree ≥596px at 1024px, dividers, card widths, panel location, sheet vs panel), in en and ar;
  - 320px with the text-spacing stylesheet in en and ar (overflow, single 2D scroller, focus inside the canvas, no clipping, edit and Undo with the toast);
  - toast obstruction variable and `scroll-padding-block-end`, plus the cap, through an injected tall toast or `page.setViewportSize`;
  - normal vs reduced motion computed transitions on a shifted card;
  - RTL: inline arrow keys mirrored, connector SVG transformed, card and badge text not transformed, stepper and chevron order, `bdi` markup for names, terms and fractions. Iterate RTL locales from `i18n/locales.json`, not a literal `ar`.
- `web/e2e/accessibility.spec.ts` -- axe at 320px with text spacing (en, ar) and at 1280px with the side panel open, light and dark.
- `deferred-work.md` -- "Story 9.11": real-device NVDA, VoiceOver and TalkBack plus real 400% browser zoom stay pending for a person. Update the lines 197, 209 and 217 items.

**Acceptance Criteria:**
- Given each width range, when the Interview renders in en and ar, then column order, widths, gutters, dividers, card widths and the edit surface (sheet below 640px, panel in the inline-end column from 1024px) match the Boundaries, and the tree column is at least 596px at 1024px.
- Given 320px with text-spacing overrides in LTR and RTL, when the visitor navigates, edits and uses Undo with the toast visible, then there is no horizontal page scroll, the canvas alone scrolls in 2D with its label, focus outlines show inside it, no card text is clipped, and `scroll-padding-block-end` equals the capped obstruction.
- Given reduced motion vs normal motion, when cards reflow or a sheet, toast or zoom changes, then reduced motion computes no transition or animation and every action still works, and normal motion uses 300ms card transitions.
- Given the token and contrast tests and the axe scans, when they run, then the pinned ratios hold in light and dark and there are no serious or critical findings.
- Given unit tests, lint, typecheck, build and the interview, accessibility and csp Playwright specs, when they run, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-11-22 — Review pass (all five layers in one combined read-only codex call, standard tier; diff 54 kB)
- verdicts: 26 findings — high 0, medium 7, low 12, false 7, maybe-false 0
- findings (blind-hunter):
  - `[false]` `[reject]` The edit panel sits below the tree at 1024–1279px, not beside it. DESIGN.md:440 places the desktop panel in the "right-column", which at 1024–1279px is the tree column. Also, 1024 − 48 − 380 = 596 leaves no width for a separate panel column beside a tree of at least 596px.
  - `[medium]` `[patch]` The Urdu fixture tests `directionFrom`, while the layout uses `directionOf`, which reads the catalog by itself. Fixed: `directionOf` now delegates to `directionFrom` over the generated catalog.
  - `[low]` `[patch]` The 2D-scroller check passes when there are zero matches. Fixed: it asserts exactly one match, `[data-tree-area]`.
  - `[low]` `[patch]` The focus check compares element boxes, so a clipped outline can pass. Fixed: the rect is expanded by the outline width and offset before the comparison.
  - `[low]` `[reject]` The 320px Undo test never checks that a focused target stays exposed while the toast is shown. The toast is in flow (owner decision, 2026-11-16), so it cannot cover a target. Scroll padding is asserted. Adding the test would only add complexity.
  - `[low]` `[reject]` The normal-motion test never watches a mounted card move. The computed 0.3s transition on inset-inline-start and top is what produces the movement. A frame-sampling test adds complexity without a named failure it would catch.
  - `[false]` `[reject]` The reduced-motion scan skips the phone dialog, the skeleton and zoom. None of those has a transition or animation to suppress: the investigation found no sheet, scrim, toast or skeleton animation, and zoom applies its scale immediately. So nothing there can animate.
  - `[low]` `[patch]` The contrast pins use expected palette values, not rendered colours. Fixed: an e2e test now asserts the toast's computed fill and the focused Undo outline colour in light and dark.
  - `[medium]` `[defer]` Real 400% browser zoom is unverified. This needs a person with a real browser, so it is recorded in frontmatter `deferred` and deferred-work.md.
- findings (edge-case-hunter):
  - `[medium]` `[patch]` The reveal measures a moving card mid-transition, so the card can settle outside the canvas. Fixed: when motion is not reduced, the reveal measures after the node's `transitionend`, with a timeout fallback. An e2e test was added.
  - `[false]` `[reject]` There is no remeasure without ResizeObserver. Every supported browser has ResizeObserver, and the hook guards its absence, so no reachable path is shown.
  - `[false]` `[reject]` Two registrations on one key, where cleanup deletes the survivor. Only one UndoToast is mounted at a time (it is keyed). React runs the old toast's unmount cleanup before the new toast's mount effect, so the survivor's height is set after the delete.
  - `[false]` `[reject]` (claim) The panel is below the tree at 1024–1279px. Same refutation as the first blind row.
  - `[low]` `[patch]` (claim) The 2D-scroller check accepts zero matches. Same root cause as the blind scroller row.
  - `[low]` `[patch]` (claim) An outline can be clipped. Same root cause as the blind outline row.
  - `[low]` `[reject]` (claim) The normal-motion test sees no existing card move. Same as the blind normal-motion row.
- findings (verification-gap):
  - `[medium]` `[patch]` A card can finish its reflow outside the canvas after the reveal. Same root cause as the edge reveal row; the fix and the e2e test are applied there.
  - `[low]` `[patch]` Toast height changes after mount are not tested. Fixed: the e2e test changes the mounted toast's height with the viewport fixed and asserts the variable follows it.
  - `[low]` `[patch]` The light and dark pins are disconnected from the rendered toast. Same root cause as the blind contrast row.
  - `[medium]` `[patch]` The Urdu fixture bypasses the route's direction lookup. Same root cause as the blind Urdu row.
  - `[false]` `[reject]` (other) The panel is below the canvas at 1024–1279px. Same refutation as the first blind row.
- findings (intent-alignment):
  - `[false]` `[reject]` The side panel at 1024–1279px diverges from the story. Same refutation as the first blind row: the inline-end column at that range is the tree column.
  - `[medium]` `[defer]` Real browser zoom and focus exposure under obstruction rest on a 320px stand-in. Same as the blind 400% zoom row.
  - `[medium]` `[patch]` The Urdu fixture calls an isolated lookup. Same root cause as the blind Urdu row.
  - `[low]` `[reject]` The motion checks inspect computed styles. Same as the blind normal-motion row.
  - `[low]` `[reject]` The combined obstruction is exercised only by the unit test. The story leaves the summary bar to Epic 11, so the toast is the only surface on the page. The registry's sum and cap are covered by unit tests.
- findings (cross-story-contract): none ("No contract shape changed").

## Design Notes

**Panel placement.** DESIGN.md (edit-sheet) puts the desktop fields in a "right-column edit panel", meaning the inline-end column. At 1024–1279px the inline-end column is the tree column, so the panel stays where 9.4 put it. At 1280px and up it is the 340px column, so the panel stacks above the Share preview there.

**Why 596px needs the gap removed.** 1024 − 2×24 − 380 = 596. Any column gap pushes the tree below 596px, so the 1px dividers and inner padding take the gap's place (DESIGN.md lines 398–399).

**The toast is in flow, but still registers.** The owner chose an in-flow toast. Registering it anyway keeps the contract single-sourced for Epic 11's fixed bar, which will overlay. Registering an in-flow element only adds harmless scroll padding.

## Verification

**Commands:**
- `cd web && npm test` -- expected: all pass.
- `cd web && npm run lint && npm run typecheck` -- expected: 0 errors; at most 12 lint warnings.
- `cd web && npm run build && npx playwright test e2e/interview.spec.ts e2e/accessibility.spec.ts e2e/csp.spec.ts` -- expected: all pass.

**Manual checks (if no CLI):**
- Real 400% browser zoom and the screen-reader runs stay pending in `deferred-work.md` for a person.

## Auto Run Result

Status: done

**Summary.** The Interview editor now meets the 9.11 layout, reflow, RTL, motion and contrast clauses, and Playwright proves each one.
- At 1024px the tree column is 596px. The column gap was replaced by 1px `line` dividers.
- From 1280px the edit panel sits in the inline-end column above the Share preview. The preview column has 24px padding.
- A new obstruction contract (`--interview-obstruction`, capped at 25vh) drives `scroll-padding-block-end`. The Undo toast registers under `toast`.
- Cards reflow over 300ms only when motion is allowed, and the reveal waits for the reflow to end.
- The toast fill utilities are now defined.
- Arabic and fallback term segments use `<bdi>`.
- `directionOf` derives from the registry through `directionFrom`, which a `ur` RTL fixture proves.

**Files changed**
- `web/src/interview/obstruction.ts` + `.test.ts` (new) -- obstruction sum and cap, the registry, and a `useObstruction` hook (border-box ResizeObserver).
- `web/src/app/[locale]/globals.css` -- `--color-foreground` and `--color-background` theme colours; `scroll-padding-block-end` variable.
- `web/src/app/[locale]/interview/start-case.tsx` -- grid without a gap, dividers and padding, panel placement at xl, preview padding, reveal after reflow, `relative` root.
- `web/src/app/[locale]/interview/family-tree.tsx` -- motion-safe 300ms card transitions (the deceased is excluded, because it is pinned to the scroll); instant focus scroll.
- `web/src/app/[locale]/interview/undo-toast.tsx` -- registers the obstruction.
- `web/src/app/[locale]/interview/edit-sheet.tsx` -- the margin moved to the panel wrapper.
- `web/src/app/[locale]/interview/relationship-text.tsx` -- `<bdi lang dir>` segments.
- `web/src/app/[locale]/ui.ts` -- buttons have no transition under reduced motion.
- `web/src/app/[locale]/results/inheritance-table.tsx` -- `relative` scroller, so sr-only children no longer overflow the page at 320px. This fix was needed for the no-overflow clause.
- `web/src/i18n/messages.ts`, `web/src/i18n/validate.test.ts` -- `directionFrom` and the `ur` fixture.
- `web/src/app/[locale]/tokens.test.ts`, `family-tree.test.tsx`, `received-view.test.tsx` -- contrast pins, transition classes, `bdi`.
- `web/e2e/interview.spec.ts`, `web/e2e/accessibility.spec.ts` -- the Story 9.11 suite (geometry at 7 widths in en and ar, 320px text-spacing reflow, obstruction, motion, RTL from the registry, bidi markup, rendered toast colours, reveal after reflow) and the 320px and side-panel axe scans. Three earlier shell assertions were adjusted for the new padding.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- "Story 9.11" section; three older items marked as addressed.

**Review.** 26 findings: high 0, medium 7, low 12, false 7.
- Patched, all by the implementation subagent:
  - 2 medium: the reveal measured a card mid-reflow; the Urdu fixture bypassed `directionOf`.
  - 4 low: the scroller assertion, the outline check, the toast-height test, and the rendered-colour test.
  - The toast-height test exposed a real bug: ResizeObserver watched the content box. It now watches the border box.
- Deferred, 1 medium: real 400% browser zoom.
- Rejected:
  - 7 false. The 1024–1279px "side panel" findings, because DESIGN puts the panel in the right column, which at that range is the tree column, and 596px leaves no room for another. The phone, skeleton and zoom animations, because they have none. ResizeObserver absence and same-key cleanup, because neither can be reached.
  - 5 low. Focus exposure behind the in-flow toast. Two items asking to watch a card move. The combined obstruction outside unit tests, because the bar belongs to Epic 11.

**Follow-up review recommended: true.** Two medium entries were patched (patched counts: high 0, medium 2, low 4). The specific unverified risk is the new reveal timing. It measures on the first `transitionend` or after 350ms. Its e2e test was not shown to fail without the fix, and the effect is not cancelled when it re-runs.

**Verification (2026-11-22, after the review patches)**
- `npm test`: 676/676 pass.
- `npm run lint`: 0 errors, 12 warnings.
- `npm run typecheck`: clean.
- `npm run build`: OK.
- `npx playwright test e2e/interview.spec.ts e2e/accessibility.spec.ts e2e/csp.spec.ts`: 234/234 pass.

**Residual risks**
- Real 400% browser zoom and the NVDA, VoiceOver and TalkBack runs are pending for a person (deferred-work.md).
- The geometry tests depend on the lineage and 50-son fixtures keeping their shape.
- The preview column's 340px now includes its padding, so its content is 292px wide.
