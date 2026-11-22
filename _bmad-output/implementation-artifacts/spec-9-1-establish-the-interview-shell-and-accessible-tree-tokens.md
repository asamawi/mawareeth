---
title: 'Story 9.1: Establish the Interview shell and accessible tree tokens'
type: 'feature'
created: '2026-11-19'
status: 'done'
baseline_revision: '2b53d98dc6b333f4f0a80b7a25e5e9e926eebbb1'
review_loop_iteration: 1
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-mawareeth-2026-11-16/DESIGN.md'
  - '{project-root}/web/AGENTS.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The inline dotted-underline term buttons in the shared inheritance table are about 20px tall, below the 44px target that applies to every Interview control.
    evidence: |-
      Found in review of Story 9.1: the preview's InheritanceTable renders inside the Interview shell (the third column at 1280px and up, in the flow below), and the 44px e2e check had to exclude `table` descendants. The component is shared with the results page and predates this story.
    location: >-
      web/src/app/[locale]/results/inheritance-table.tsx
    severity: medium
  - summary: >-
      The preview's inline "Full results" link and other preview links are text-height targets, below the 44px target for every Interview control, and the 44px e2e check does not measure links.
    evidence: |-
      Found in review pass 2 of Story 9.1: `share-preview.tsx:150` renders the link with only `underline underline-offset-4`; SharePreview predates this story and the spec forbids changing it here. Epic 11 redesigns the preview and its Full results button (DESIGN: Full results is a button-primary).
    location: >-
      web/src/app/[locale]/interview/share-preview.tsx:150
    severity: medium
---

<intent-contract>

## Intent

**Problem:** The Interview's family-entry screen is one narrow `max-w-xl` column (heir form, tree, preview, heirs list stacked), and the phase-2 tree, edit and undo work has no colour, type, radius or focus tokens to build on. Interview buttons are below the 44px target.

**Approach:** Arrange the existing family-entry components into three named regions (Add relatives, Family tree, Heirs list) plus a preview slot, in a responsive CSS grid inside a 1360px shell; add the phase-2 DESIGN tokens to `globals.css` as Tailwind theme values with light/dark pairs; add focus-ring variants to `ui.ts`; bring every focusable Interview control to a 44px target. No behaviour, text or result meaning changes.

## Boundaries & Constraints

**Always:**
- Regions in DOM order Add relatives → Family tree → Heirs list → Share preview, so mobile order, reading order and tab order agree. Each region is a `<section>` named by an existing visible heading (`aria-labelledby`); no new user-facing text.
- Breakpoints: below 1024px one column with 16px side gutters; 1024–1279px a 380px column (Add relatives above Heirs list) beside a flexible tree column, preview full-width below both; ≥1280px a 1360px-max shell with 380px · flexible tree · 340px preview columns.
- Tokens exactly as DESIGN: light `graphic #76887F`, `accent-soft #E3F1EE`, `blocked-stripe #E8EFEC`, `scrim #171717` at 40%, `toast-focus #FFFFFF`; dark `graphic #5F7A6E`, `accent-soft #0F2A26`, `blocked-stripe #16231F`, `scrim #000000` at 60%, `toast-focus #0A0A0A`, under the existing `prefers-color-scheme: dark` block. Mark the derived dark values `[ASSUMPTION]` in a CSS comment.
- Type tokens node-name 0.84rem/700, node-meta 0.72rem, badge 0.68rem/600 line-height 1.3; radii node 10px, sheet 18px, full 9999px; breakpoints 640/1024/1280 (Tailwind `sm`/`lg`/`xl` already match — keep them, do not redefine).
- RTL documents (`[dir="rtl"]`) use the body-rtl stack `"Segoe UI", Tahoma, "Noto Naskh Arabic", "Geeza Pro", system-ui, sans-serif`; LTR keeps `system-ui, sans-serif`.
- Focus ring: 2px `outline` with 2px offset, never box-shadow; variants for accent fills (foreground/currentColor) and toast surfaces (toast-focus).
- Logical properties only (`ms-`, `ps-`, `start-`); no left/right.

**Never:**
- Change any existing token value (background, foreground, muted, surface, line/border, accent, accent-foreground and their dark pairs), `primaryButton`, `secondaryButton`, `cardClass`, `focusRing`, or choice-card classes.
- Load a web font, publish a Locale, set an Urdu line-height or font (Urdu 1.7 stays an `[ASSUMPTION]` comment only).
- Build Epic 11's sticky summary bar/sheet, the 9.2 canvas/lineage cards, edit panels or undo; change SharePreview, results meaning, messages, or interview flow logic.
- Use `line`/`--border` for an essential boundary in new code.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Phone | 375px, started case with deceased + heirs | Regions stacked add → tree → list → preview; page side padding 16px | No error expected |
| Laptop | 1100px | Add relatives and Heirs list share a 380px column at inline-start; tree beside them; preview spans below | No error expected |
| Desktop | 1366px | Shell ≤1360px; 380px / tree / 340px preview columns | No error expected |
| RTL | `/ar/interview/` at 1100px | 380px column at the inline-start (right) side; body font is the body-rtl stack | No error expected |
| Dark mode | `prefers-color-scheme: dark` | New tokens resolve to their dark values; existing tokens unchanged | No error expected |
| Pre-deceased screens | loading/none/existing/selector/deceased views | Unchanged narrow centred layout (shell only wraps the heirs screen) | No error expected |

</intent-contract>

## Code Map

- `web/src/app/[locale]/interview/page.tsx:18` -- `<main>` is `max-w-6xl px-6 py-10`; becomes the 1360px shell with `px-4 lg:px-6`. `h1`/noscript stay `max-w-xl` centred.
- `web/src/app/[locale]/interview/start-case.tsx:351` -- root div centres every child not `form`/`[data-wide]` at `max-w-xl`; the shell grid must carry `data-wide`.
- `web/src/app/[locale]/interview/start-case.tsx:478-563` -- heirs screen: `madhabBar`, `DeceasedSummary` and (when `layered`) `DeathBreadcrumb` stay above the shell grid, in that order, so the active estate is announced before any region; `FamilyTree` → tree region; `heirGone` alert + `HeirForm` → Add relatives region; `HeirList` → Heirs list region; `SharePreview` → preview slot. Props and handlers unchanged.
- `web/src/app/[locale]/interview/heir-form.tsx:106-107` -- form is `mx-auto max-w-xl`; inside the region it should fill the column (drop the max/centring there or override). Its `<h3>` needs a stable id to name the Add relatives region.
- `web/src/app/[locale]/interview/family-tree.tsx:57` -- already `<section data-tree aria-labelledby>`; keep it as the Family tree region (do not double-wrap a second named section).
- `web/src/app/[locale]/interview/heir-list.tsx:122` -- already `<section aria-labelledby="heirs-heading">`; it is the Heirs list region.
- `web/src/app/[locale]/interview/form-bits.tsx:5,8` and `madhab-selector.tsx:14` -- interview `buttonClass` / `inputClass` (currentColor outline ring, ~40px tall): add `min-h-11`; keep the rest.
- `web/src/app/[locale]/interview/heir-form.tsx:188-199` -- link radio labels `flex items-center gap-2` lack a 44px target: add `min-h-11`.
- `web/src/app/[locale]/globals.css` -- `:root` vars, dark block, `@theme inline` colour map; add new vars, theme colours (`graphic`, `accent-soft`, `blocked-stripe`, `scrim`, `toast-focus`), `--text-node-name/--text-node-meta/--text-badge` (+ line-height/weight companions), `--radius-node/--radius-sheet`, and the RTL font stack.
- `web/src/app/[locale]/ui.ts` -- add `focusRingOnAccent` (outline-current) and `focusRingOnToast` (outline-toast-focus) next to unchanged `focusRing`.
- `web/e2e/interview.spec.ts`, `web/e2e/accessibility.spec.ts`, `web/e2e/api.ts` -- Playwright with mocked API (`startedCase()`, `sessionAnonymous`); axe check exists for the started screen in ar/en.

## Tasks & Acceptance

**Execution:**
- `web/src/app/[locale]/globals.css` -- add phase-2 colour vars with dark pairs (scrim as `rgb(23 23 23 / 0.4)` light, `rgb(0 0 0 / 0.6)` dark, or equivalent), theme colour/text/radius tokens, `[dir="rtl"] body` font stack, Urdu `[ASSUMPTION]` comment -- tokens for 9.2+ components.
- `web/src/app/[locale]/ui.ts` -- add `focusRingOnAccent` and `focusRingOnToast` class strings (2px outline, 2px offset) -- focus contract for accent cards and the undo toast.
- `web/src/app/[locale]/interview/page.tsx` -- shell `main`: `max-w-[1360px]`, `px-4 lg:px-6` -- 1360px shell, 16px mobile gutters.
- `web/src/app/[locale]/interview/start-case.tsx` -- keep `DeathBreadcrumb` outside and before the grid (after `DeceasedSummary`); re-indent the moved JSX properly; wrap the remaining heirs-screen components in a `data-wide` grid (`grid-cols-1`; `lg:grid-cols-[380px_minmax(0,1fr)]` with tree spanning rows; `xl:grid-cols-[380px_minmax(0,1fr)_340px]` with preview as third column), regions in the order above; Add relatives is a `<section aria-labelledby>` pointing to the HeirForm heading id -- named responsive regions.
- `web/src/app/[locale]/interview/heir-form.tsx` -- heading id; form fills its region; link radio labels `min-h-11` -- region naming and 44px targets.
- `web/src/app/[locale]/interview/form-bits.tsx`, `madhab-selector.tsx` -- `min-h-11` on `buttonClass` (and `inputClass` in form-bits) -- 44px targets.
- `web/src/app/[locale]/tokens.test.ts` (new, node test runner) -- parse `globals.css`, assert every DESIGN token value above in light and dark, existing values unchanged, and compute WCAG ratios: graphic/background ≥3 (3.75/4.24), graphic/surface ≥3 (3.46/3.80), graphic/accent-soft ≥3, accent/accent-soft ≥4.5, toast-focus vs toast fill (foreground) ≥3 -- locks token values and contrast.
- `web/e2e/interview.spec.ts` -- new tests on a started case with deceased + heirs: region order/positions at 375, 1100 and 1366px (en) and 1100px (ar, columns mirrored); 16px gutter at 375px; computed `--graphic` etc. under light and dark `emulateMedia`; every visible button/input/select/label-wrapped radio in the shell ≥44px tall; Tab to an interview button shows `outline-style: solid`, `outline-width: 2px`, `outline-offset: 2px`, `box-shadow: none`; RTL body font-family contains `Noto Naskh Arabic` -- observes the shell at its outermost surface.
- `web/e2e/interview.spec.ts` -- add a layered-case test (a case with a marked later death, e.g. built from an existing successive-death fixture or the mocked API) at 1100px: the breadcrumb is visible, precedes the Add relatives region in DOM order and sits above the grid, and clicking an earlier crumb still opens that estate -- the breadcrumb placement is otherwise untested.
- `web/e2e/accessibility.spec.ts` -- extend the axe check to the heirs screen (deceased saved, heirs present) in ar and en, light and dark -- no serious/critical violations.

**Acceptance Criteria:**
- Given the heirs screen, when it renders at any width, then Add relatives, Family tree and Heirs list are each a named region (accessible name from an existing heading) in that DOM order, and the existing flows (add/edit/remove heir, later death, school choice, preview) behave as before.
- Given the shipped tokens and button/card/choice-card classes, when this story lands, then their values and class strings are byte-for-byte unchanged and no `@font-face` or font `<link>` is added.
- Given any focusable control in the Interview shell, when measured, then its box is ≥44px tall and its focus-visible style is a 2px solid outline with 2px offset and no box-shadow, in light and dark.
- Given the existing web unit tests, lint and typecheck, when run, then they all pass.

## Spec Change Log

### 2026-11-19 — Review loop 1
- **Trigger:** review found `DeathBreadcrumb` moved into the tree region, after `HeirForm` in DOM order, so keyboard, screen-reader and phone users reach the add form before learning which estate they are adding to (the previous layout put the breadcrumb first). The Code Map had prescribed that placement.
- **Amended:** Code Map and Execution now keep the breadcrumb above the grid after `DeceasedSummary`; added a layered-case e2e task; Execution asks for proper re-indentation.
- **Known-bad state avoided:** active-estate context announced after the form it governs; breadcrumb placement untested.
- **KEEP (from attempt 1, saved at `spec-9-1-attempt-1.patch`; reuse it):** the `globals.css` tokens, `@theme` entries and `[dir="rtl"] body` stack; `focusRingOnAccent`/`focusRingOnToast`; `page.tsx` main classes; the grid classes and region wrappers (Add relatives `<section aria-labelledby="heir-form-heading">` with the `heirGone` alert; tree spanning two rows at `lg`; preview spanning both columns at `lg` and third column at `xl`); `min-h-11` additions; `heir-form.tsx` id and width changes; `tokens.test.ts`, `e2e/family.ts` `openHeirsScreen`, the shell e2e tests and heirs-screen axe tests. Fix while reusing: write `e2e/interview.spec.ts` and `e2e/accessibility.spec.ts` with LF line endings (attempt 1 converted them to CRLF, rewriting every line); build the token regex with `String.raw` or `\\s` (a bare `\s` in a template literal is `s`); in the focus-ring e2e test assert that the Tab loop actually reached a button before reading the ring.

## Review Triage Log

### 2026-11-19 — Review pass
- verdicts: 27 findings — high 0, medium 5, low 11, false 11, maybe-false 0
- findings:
  - `[medium]` `[bad_spec]` (verification-gap) Layered case layout has no rendered test; breadcrumb placement unchecked — confirmed: every new e2e test uses the non-layered "Agree" fixture. Amendment: layered-case e2e task added.
  - `[low]` `[reject]` (verification-gap) New type/radius/scrim tokens and focus-ring variants verified only by source text — real but they have no consumer yet; a rendered check needs the 9.2+ components that use them, more than a direct correction.
  - `[low]` `[bad_spec]` (verification-gap) `\s` in the `tokens.test.ts` template-literal regex is a literal `s` — confirmed at line 11; folded into the change-log KEEP fix list.
  - `[medium]` `[bad_spec]` (verification-gap) e2e specs rewritten wholesale by a CRLF conversion — confirmed with `file` (HEAD is LF, working copy CRLF); folded into the change-log fix list.
  - `[false]` `[reject]` (verification-gap) 44px test leaves HeirList row buttons unchecked — the filter excludes only `table` and `[data-tree-area]`; HeirList renders a `<ul>` (heir-list.tsx:139), so its buttons are measured.
  - `[false]` `[reject]` (verification-gap) heir list buttons unchecked "whether or not the list renders as a table" — same refutation; the list is never a table.
  - `[false]` `[reject]` (intent-alignment) diff covers only 9.1 of the epic — this is one iteration of the per-story loop; 9.1 is the first backlog story and the others are later iterations.
  - `[false]` `[reject]` (edge-case) empty 340px preview column at xl — SharePreview always renders a body (prompt, waiting or result; share-preview.tsx:82-86).
  - `[false]` `[reject]` (edge-case) empty HeirList cell — HeirList always renders its section and heading (heir-list.tsx:122).
  - `[low]` `[bad_spec]` (edge-case) focus-ring test never asserts the Tab loop found a button — confirmed; folded into the change-log fix list.
  - `[false]` `[reject]` (edge-case) heir-list/breadcrumb controls may be undersized unnoticed — HeirList buttons are measured (ul, not table); the breadcrumb uses `buttonClass`, which now has `min-h-11`.
  - `[low]` `[bad_spec]` (edge-case) regex `\s` — duplicate of the verification-gap row; same fold-in.
  - `[low]` `[reject]` (edge-case) `indexOf` slicing in `tokens.test.ts` unguarded — a missing marker makes the value assertions fail loudly; test-only, no silent pass.
  - `[low]` `[reject]` (edge-case) `family.ts` non-null `!` on fixture lookup — a renamed fixture fails loudly at test load; test-only.
  - `[false]` `[reject]` (edge-case) `h1` centred above the wide grid — the h1 serves every Interview screen, most of which stay a centred `max-w-xl` column; no design rule asks it to align with the grid.
  - `[medium]` `[defer]` (edge-case) "every focusable Interview control ≥44px" does not hold for the inline term buttons in the preview's inheritance table (~20px) — real, but pre-existing in the shared results component, which this story does not touch; deferred.
  - `[false]` `[reject]` (edge-case) form-bits/madhab `buttonClass` strings changed though AC says shipped class strings are unchanged — the AC names `primaryButton`, `secondaryButton`, `cardClass`, `focusRing` and choice-card classes, not the interview `buttonClass`.
  - `[medium]` `[bad_spec]` (blind) CRLF whole-file churn — duplicate of the verification-gap row; same fold-in.
  - `[low]` `[bad_spec]` (blind) regex `\s`; `import.meta.dirname` needs Node ≥20.11 — regex folded in; `package.json` pins Node 26.13.0, so the dirname part does not occur.
  - `[low]` `[reject]` (blind) declared tokens/helpers unused — by design: the story supplies tokens for 9.2+; same as the verification-gap token row.
  - `[false]` `[reject]` (blind) 44px test skips HeirList; madhab radio labels unchanged — HeirList is measured; madhab labels are `p-3` + 2px border around a name and description, well above 44px (madhab-selector.tsx:67).
  - `[low]` `[reject]` (blind) layout tested only at 375/1100/1366, not 1024/1279/320 reflow — boundary and 320px reflow verification is Story 9.11's scope; adding a width matrix here is more than a direct correction.
  - `[false]` `[reject]` (blind) h1 misaligned; other states stretch to 1360px — non-grid children of the root keep `max-w-xl` via start-case.tsx:351 and DeceasedForm keeps its own `mx-auto max-w-xl`.
  - `[medium]` `[bad_spec]` (blind) breadcrumb moved after the add form in reading order — confirmed in the diff; caused by the Code Map. Amendment: breadcrumb stays above the grid.
  - `[low]` `[bad_spec]` (blind) moved JSX not re-indented; tests rely on pre-existing hooks — indentation confirmed (lint passes but readability suffers), folded into Execution; `section[data-tree]`, `heirs-heading` and `data-wide` already exist (family-tree.tsx:57, heir-list.tsx:122, start-case.tsx:351).
  - `[false]` `[reject]` (blind) Arabic/Urdu font handling incomplete — Urdu font and line-height stay open by the story's own AC; the RTL stack is the DESIGN fallback order.
  - `[low]` `[reject]` (blind) focus-ring/contrast tests thin; fixture loading duplicated — the ring variants have no consumer to render yet; duplication in test setup has no named harm.

### 2026-11-19 — Review pass 2 (after loop 1; reviewers run on codex, read-only)
- verdicts: 13 findings — high 0, medium 7, low 4, false 2, maybe-false 0
- findings:
  - `[false]` `[reject]` (intent-alignment) diff implements only Story 9.1, not the whole epic — one story per iteration of the loop; 9.1 is the first backlog story.
  - `[medium]` `[patch]` (intent-alignment) preview placement asserted indirectly at 1100px/1366px — grouped with the preview-geometry rows below; same patch.
  - `[medium]` `[defer]` (intent-alignment) 44px/focus checks cover a narrower surface than "every focusable control" (links, table controls excluded) — pre-existing SharePreview/InheritanceTable controls; recorded in `deferred`.
  - `[low]` `[reject]` (intent-alignment) token and font evidence is declaration-level, not rendering-level — no web font is loaded by design, so glyph rendering is platform-dependent; a rendering harness is more than a direct correction.
  - `[false]` `[reject]` (blind) preview must become a sticky bar/sheet below 1280px — the story's own AC excludes Epic 11's summary bar/sheet.
  - `[low]` `[patch]` (blind) long unbroken names overflow the 380px Heirs list column — confirmed: names allow 100 characters (answers.ts:13) and heir-list.tsx:151 has no wrapping; exposed by the narrower column. Patch: `min-w-0 [overflow-wrap:anywhere]` on the name span.
  - `[medium]` `[patch]` (blind) 1100px test "the preview spans below" never measures the preview — confirmed at interview.spec.ts:366. Patch: measure the preview section.
  - `[medium]` `[patch]` (blind) 1366px test infers the 340px column from empty space — confirmed at interview.spec.ts:378. Patch: measure the preview's width and placement.
  - `[medium]` `[defer]` (blind) 44px test excludes links and tables — same pre-existing preview controls; deferred.
  - `[low]` `[reject]` (blind) Arabic font assertion is string-only — same as the intent-alignment font row.
  - `[medium]` `[patch]` (verification-gap) preview placement untested; removing `lg:col-span-2` passes — confirmed; same patch as the blind preview rows.
  - `[low]` `[patch]` (edge-case) `openHeirsScreen` returns before the preview renders, so axe can scan an empty preview — confirmed: family.ts waits only for the heir form. Patch: also wait for preview content.
  - `[medium]` `[defer]` (edge-case) preview links and proof buttons below 44px while the test passes — pre-existing; deferred with the term-button item.

## Design Notes

Share preview placement: Epic 11 moves the preview below 1280px into a sticky bar/sheet, which this story must not build. Until then the preview stays in the flow — after the Heirs list on phones and spanning both columns below the grid at 1024–1279px — and takes the 340px third column at ≥1280px. This keeps results visible and unchanged at every width.

The tree column uses `minmax(0,1fr)`, not a 596px minimum: at exactly 1024px, 380px + 596px + gutters does not fit with any gap, and card sizing is 9.2's job.

Grid sketch (Tailwind arbitrary areas are fine; explicit `col-start`/`row-span` also fine):
```
base: "add" "tree" "list" "preview"
lg:   "add tree" "list tree" "preview preview"   cols 380px minmax(0,1fr)
xl:   "add tree preview" "list tree preview"     cols 380px minmax(0,1fr) 340px
```

## Verification

**Commands:**
- `cd web && npm test` -- expected: all node tests pass, including `tokens.test.ts`.
- `cd web && npm run lint && npm run typecheck` -- expected: no errors.
- `cd web && npm run build && npx playwright test e2e/interview.spec.ts e2e/accessibility.spec.ts` -- expected: all pass (build produces `out/` that `e2e/serve.mjs` serves).

## Auto Run Result

Status: done

**Summary:** The Interview heirs screen is now a responsive shell inside a 1360px page. The death breadcrumb sits above the grid. The grid holds three named regions, Add relatives, Family tree and Heirs list, followed by a slot for the share preview.
- Below 1024px everything is one column with 16px side gutters.
- From 1024px a 380px column sits beside the tree, and the preview spans below both.
- From 1280px the preview takes a 340px third column.

The phase-2 DESIGN tokens are added: graphic, accent-soft, blocked-stripe, scrim and toast-focus, each with a dark pair, plus node, badge and type sizes, the node and sheet radii, and the RTL font stack. Two focus-ring variants are added, and every Interview button, input and link radio is at least 44px. No text, flow, result meaning or existing token changed.

**Files changed** (under `web/`):
- `src/app/[locale]/globals.css`: phase-2 colour, type and radius tokens with dark pairs; RTL body font stack; Urdu `[ASSUMPTION]` comment.
- `src/app/[locale]/ui.ts`: `focusRingOnAccent` and `focusRingOnToast`.
- `src/app/[locale]/interview/page.tsx`: 1360px shell, `px-4 lg:px-6`.
- `src/app/[locale]/interview/start-case.tsx`: breadcrumb above a `data-wide` grid of regions; Add relatives is a labelled section.
- `src/app/[locale]/interview/heir-form.tsx`: heading id; the form fills its region; 44px link radios.
- `src/app/[locale]/interview/form-bits.tsx`, `madhab-selector.tsx`: `min-h-11` on the interview button and input classes.
- `src/app/[locale]/interview/heir-list.tsx`: long names wrap inside the narrower column.
- `src/app/[locale]/tokens.test.ts` (new): token values in light and dark, existing values unchanged, WCAG contrast ratios, no `@font-face`.
- `e2e/family.ts` (new): the `openHeirsScreen` helper, which waits for the preview content.
- `e2e/interview.spec.ts`: shell tests:
  - region order and positions at 375, 1100 and 1366px, and in Arabic at 1100px;
  - preview geometry;
  - 16px gutter and RTL font;
  - tokens in light and dark;
  - 44px targets and the 2px outline ring;
  - layered-case breadcrumb placement and navigation.
- `e2e/accessibility.spec.ts`: axe on the heirs screen in ar and en, light and dark.

**Review:**
- **Pass 1:** 27 findings, routed to a bad_spec loopback. The breadcrumb had been placed after the add form in reading order because the Code Map put it in the tree region. The attempt was saved as `spec-9-1-attempt-1.patch`, the spec was amended and the code was re-derived. The CRLF, regex and Tab-loop fixes were folded into that re-derivation. One finding was deferred, and the rest were rejected with the reasons logged above.
- **Pass 2** (codex reviewers): 13 findings.
  - Patches applied: the preview geometry assertions at 1100 and 1366px (medium); long-name wrapping in the Heirs list (low); `openHeirsScreen` waits for the preview (low).
  - Deferred: preview links and table controls below 44px. They are pre-existing and shared with Epic 11.
  - Rejected: the sticky bar (Epic 11 by the story's AC), the scope-only-9.1 row (one story per iteration), and the font-rendering evidence (no web font by design).
- **Follow-up review recommended:** false. Pass 2 patched one medium entry and two lows, with no high.

**Verification** (run by the parent after the last patch):
- `npm test`: 512 of 512 pass.
- `npm run lint`: 0 errors and 12 warnings, the same count as attempt 1.
- `npm run typecheck`: clean.
- `npm run build`: OK.
- `npx playwright test e2e/interview.spec.ts e2e/accessibility.spec.ts`: 46 of 46 pass in Chromium.
- Matrix audit: the phone, laptop, desktop, RTL and dark rows are each covered by a shell test that ran. The pre-deceased screens are covered by the existing interview tests, which still pass.

**Residual risks:**
- The e2e tests run in Chromium only.
- The type, radius and scrim tokens and the two focus-ring variants have no consumer until 9.2 and later, so they are checked as CSS only.
- The 100-character unbroken-name wrap has no dedicated test.
- The derived dark colours and the Urdu font and line height remain `[ASSUMPTION]`.
- The 12 lint warnings were not compared against the baseline.
