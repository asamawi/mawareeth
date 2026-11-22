---
title: 'Story 9.9: Complete keyboard navigation and the screen-reader outline'
type: 'feature'
created: '2026-11-22'
baseline_revision: 'fd1ec15310d4dc4d42ae3c1ba236567d199bc09b'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
  - '{project-root}/web/AGENTS.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The story's screen-reader acceptance (Arabic NVDA/Chrome, VoiceOver/Safari iOS and TalkBack over the canonical Heirs outline) is not yet evidenced.
    evidence: |-
      The intent-alignment review notes that AC 4 places acceptance on non-visual use of the outline for add, edit, cascade delete, Undo and estate navigation. Automation cannot prove this. The runs are recorded as pending under "Story 9.9" in deferred-work.md and need a person with the three readers.
    location: >-
      _bmad-output/implementation-artifacts/deferred-work.md (Story 9.9)
    severity: medium
---

<intent-contract>

## Intent

**Problem:** The Family tree already has a roving tab stop, `aria-current`, visible-text card names, Home/End, Enter, Delete and Ctrl/Cmd+Z, and the Heirs list already repeats the tree's `treeDescription` words. But Left/Right walk a flat list of every card instead of siblings. Up/Down (parent and first child) and the `+`/`-` zoom keys do not exist. Delete does nothing on a died-later card. Nothing guarantees that the focus ring of a card scrolled into view is unclipped. There is no browser test of lineage navigation in LTR and RTL. Axe does not scan the removal confirmation or French. FR/NFR-1, NFR-X1 and UX-DR72/73/74 ask for complete keyboard parity.

**Approach:** Add one pure navigation helper over the drawn tree hierarchy and wire it into the card key handler, together with `+`/`-` zoom and Delete on died-later cards. Add a scroll margin so the focus ring stays visible. Prove the result with unit tests, Playwright keyboard tests on real lineage in en and ar, and axe scans of every Interview state in ar, en and fr. Screen-reader evidence stays a manual release item.

## Boundaries & Constraints

**Always:**
- **Tree hierarchy for navigation** (the drawn tree, not kinship):
  - A card's *tree parent* is the card in the active estate whose `personId` equals the card's `parentId`. If the card has no `parentId`, or that person has no card in the active estate, its tree parent is the deceased (`root`). Relatives without a recorded parent hang from the deceased (architecture rule).
  - The *tree children* of a card are the cards whose tree parent it is. Its *siblings* are the cards that share its tree parent. Both are ordered by the existing keyboard order `["root", ...layout.nodes]`.
  - The deceased has no tree parent and no siblings.
- **Keys on a focused card** (unmodified keys only; Alt, Ctrl and Meta combinations still pass through):
  - ArrowUp: go to the tree parent. ArrowDown: go to the first tree child.
  - Inline-end arrow: go to the next sibling. Inline-start arrow: go to the previous sibling. In LTR the inline-end arrow is ArrowRight; in RTL it is ArrowLeft.
  - Home: go to the deceased. End: go to the last card in keyboard order (unchanged).
  - When the neighbour is absent (no parent, child or sibling in that direction), focus stays on the current card. The key is still `preventDefault`ed, so the canvas does not scroll.
  - Moving focus selects the target card through the existing focus path. `aria-current` and the roving `tabIndex` follow it as they do today.
  - Enter keeps its native activation: it edits an ordinary card and opens a died-later estate.
  - Delete opens the removal confirmation for every person card that is not the deceased, including a died-later card. A died-later card goes through the same confirmation path, with server cascade impact, that the Heirs-row Remove uses for that person. The deceased, and any card while the tree is frozen, ignore Delete.
  - `+` and `=` zoom in; `-` and `_` zoom out. Both behave exactly like the toolbar buttons: the same `ZOOM_LEVELS` step, the same `announceZoom` message, and nothing beyond 1.5 or below 0.6. These keys are handled only on tree cards, never in text inputs.
- **Focus visibility:** every card, the deceased card included, gets a scroll margin of at least 8px, so `scrollIntoView({block: "nearest", inline: "nearest"})` reveals the 2px ring and its 2px offset inside the canvas. The deceased's existing `pinBox` behaviour is unchanged.
- **Semantics kept:**
  - The single `role="group"` labelled by the tree heading.
  - Native `<button>` cards with names from visible text and badges.
  - `aria-current="true"` for the selection.
  - Exactly one card with `tabIndex=0`. Tab leaves the tree without trapping.
  - No `role="tree"`/`application` and no `aria-label` on cards.
  - The empty-state parent/spouse placeholders stay ordinary buttons. They are add controls, not cards, and are not part of the roving set.
- **The canonical outline:** the Heirs list keeps listing the deceased first and then every person, with the same `treeDescription` relationship, secondary text and badge as the matching tree card.
- **Kept focus rules:** removal (next sibling, then previous sibling, then the deceased), Undo (the restored card), estate open and breadcrumb return (`treeHeading`), Escape closing the edit surface and restoring the opener, and Ctrl/Cmd+Z skipping text inputs all stay unchanged.

**Never:**
- New or changed user-facing copy or translations. The existing `treeHint`, zoom and badge strings are enough.
- Changes to the server, the API contract, flow commands, layout geometry or connector drawing.
- Kinship-based navigation (for example Up from the deceased to the father card).
- 9.10 announcement coalescing, or 9.11 responsive and reduced-motion work beyond the scroll margin.
- Claiming screen-reader verification. NVDA/Chrome, VoiceOver/Safari iOS and TalkBack runs are manual and are recorded as pending release evidence.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Down from the deceased | lineage fixture, focus `root`, ArrowDown | focus goes to the first card (keyboard order) with no parent link | — |
| Up to a linked parent | grandchild `s2` with `parent_of` from died-before `before`; focus `s2`, ArrowUp | focus `before` | — |
| Down to a linked child | focus `before`, ArrowDown | focus `s2` | — |
| Sibling LTR | en, focus on a root child, ArrowRight / ArrowLeft | next / previous root child, skipping `s2` | — |
| Sibling RTL | ar, same card, ArrowLeft | next sibling (the same card ArrowRight reached in en) | — |
| Absent neighbour | focus on the last sibling, inline-end arrow; focus `root`, ArrowUp; leaf card, ArrowDown | focus unchanged; page and canvas do not scroll | — |
| Parent outside the estate | `parentId` names a person with no card in the active estate | tree parent = `root` | — |
| Zoom keys | focus on a card, `+` at 1.5 / `-` at 0.6 | no change at the limits; otherwise one step and the zoom status announced | — |
| Keys in an input | edit-sheet name field, type `+`, `-`, Home, arrows | ordinary text editing; no zoom, no tree focus move | — |
| Delete on died-later | focus on a died-later card, Delete | removal confirmation with that person's cascade impact; Cancel restores focus as the row flow does | frozen → ignored |
| Delete on the deceased | focus `root`, Delete | nothing | — |

</intent-contract>

## Code Map

- `web/src/app/[locale]/interview/family-tree.tsx:53` -- `ids = ["root", ...layout.nodes.map(n => n.id)]` is the keyboard order.
  - `:82-98` is the card `onKeyDown`. Today it handles flat Left/Right (mirrored by `rtl`), Home/End and Delete only when `editable`. Replace its arrow logic with the helper.
  - `:78` `onFocus` selects the card and calls `scrollIntoView` for non-root cards. `:57` `announceZoom`; `:117-122` the toolbar zoom buttons, which step `ZOOM_LEVELS`. Extract one `stepZoom(delta)` that both the buttons and the keys use.
  - `:99` is the card className; add a scroll margin there (for example `scroll-m-2`).
  - `:150` placeholders, kept as they are.
  - Props: `onRemoveRequest(id)` and `onOpenEstate(personId)`.
- `web/src/interview/tree.ts` -- `estateModel` (people with `id`, `personId`, `parentId`, `state`); `layoutTree` (ordered `nodes`); `treeDescription`; `focusAfterRemoval` (a model for sibling logic). Add an exported pure `treeNeighbour(model, order, id, key: "up"|"down"|"prev"|"next"|"home"|"end"): string` that returns the target card id, or `id` itself when the neighbour is absent. Map `parentId` (a person id) to a card id through `model.people`.
- `web/src/app/[locale]/interview/start-case.tsx:687-701,722-723` -- the `onRemoveRequest` wiring (`requestCardRemoval`) and the Heirs-row remove for died-later people. Make sure a died-later card's Delete reaches the same confirmation the row Remove opens. `:196-215` is the Ctrl/Cmd+Z listener (unchanged).
- `web/src/interview/flow.ts:447-490,1036-1060,1222-1231` -- the removal request and confirmation, and the focus rules. Read only, unless the died-later Delete needs a flow entry point. Prefer reusing the row action.
- `web/src/app/[locale]/interview/heir-list.tsx:143-164,195-255` -- the canonical outline (deceased first, `treeDescription` words). Unchanged.
- `web/src/app/[locale]/interview/family-tree.test.tsx:10-49` -- the existing en/ar keyboard DOM test. Update its flat-arrow expectations to sibling semantics.
- `web/src/interview/tree.test.ts` -- add the helper tests.
- `web/e2e/family.ts:32-71` -- `lineageFixture` (died-before `before` with a `parent_of` edge to blocked grandchild `s2`) and `openCanvasFixture` (lineage, empty or 50 heirs, en/ar). `web/e2e/api.ts:37,43,141` -- `fullCase`, the API stubs and the fixture.
- `web/e2e/interview.spec.ts:548-645,694-729,1156-1253` -- the existing keyboard, Delete, Undo and lineage matrix tests. Add the lineage arrow sequence here.
- `web/e2e/accessibility.spec.ts:13-116` -- axe scans that assert zero serious or critical findings. Removal confirmation and `fr` are missing.
- `i18n/locales.json:5-45` -- the published locales: ar (RTL), en and fr.
- `_bmad-output/implementation-artifacts/deferred-work.md:172-174,200-202` -- the existing manual screen-reader and browser-coverage items.

## Tasks & Acceptance

**Execution:**
- `web/src/interview/tree.ts` -- add `treeNeighbour` as defined in Boundaries. Pure, with no DOM and no direction handling: the caller maps physical arrows to `prev`/`next` using `rtl`.
- `web/src/interview/tree.test.ts` -- cover every helper row of the matrix: down and up through a linked parent, root children as siblings skipping linked children, clamping at the ends, root up/prev/next unchanged, a parent outside the estate falling back to root, and home/end.
- `web/src/app/[locale]/interview/family-tree.tsx` -- use the helper in `onKeyDown` (ArrowUp/Down, mirrored inline arrows, Home/End). Add `+`/`=`/`-`/`_` through the shared `stepZoom`. Let Delete call `onRemoveRequest` for died-later cards too (not for root, not while frozen). Add the scroll margin.
- `web/src/app/[locale]/interview/start-case.tsx` -- route `onRemoveRequest` for a died-later card id to the same confirmation and cascade path the Heirs-row Remove uses. Keep the existing focus restore on Cancel and after removal.
- `web/src/app/[locale]/interview/family-tree.test.tsx` -- update the en/ar keyboard test to sibling semantics. Add Up/Down, the absent-neighbour cases, `+`/`-` at and between the limits with the announcement, Delete on a died-later card (the callback is called), Delete on root (not called), and exactly one `tabIndex=0`. Assert that each card's text and badge equal the matching Heirs-list row (an outline-parity test, in this file or `heir-list.test.tsx`).
- `web/e2e/interview.spec.ts` -- on `lineageFixture`, in en and ar (desktop width), drive Home, Down, inline arrows, Up and End. Assert the focused `data-node` after each key, with ArrowLeft/ArrowRight swapped in ar. Assert that an absent neighbour keeps focus. After arrowing to a card outside the scrolled view, assert that the card's bounding box grown by 4px lies inside the `[data-tree-area]` client box. Assert that `+`/`-` change zoom like the toolbar. Assert that Tab from the current card leaves the group in one press, or in at most one press per visible empty-state placeholder. Assert Delete on a died-later card opens the confirmation and Cancel changes nothing.
- `web/e2e/accessibility.spec.ts` -- run axe (zero serious or critical) for the Interview's empty, populated (lineage), edit-surface and removal-confirmation states in ar, en and fr. Reuse the existing scans and add the missing state/locale combinations.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- under a "Story 9.9" heading, record the manual release evidence still owed: Arabic NVDA/Chrome, VoiceOver/Safari iOS and TalkBack runs over the canonical outline (add, edit, delete with cascade, Undo, open/return estate) with normal, blocked, died-before and died-later people. Each finding records browser, reader and action.

**Acceptance Criteria:**
- Given the Interview with a lineage family, when a keyboard user Tabs into the tree, then exactly one card is focusable. Arrows, Home and End move along the drawn tree as specified, mirrored in Arabic. Tab leaves the group. The focused card's ring is fully visible inside the canvas.
- Given a focused card, when Enter, Delete or `+`/`-` is pressed, then an ordinary card opens its edit surface, a died-later card opens its estate (Enter) or the removal confirmation (Delete), and zoom steps exactly as the toolbar does. Escape closes the edit surface and returns focus to the opener, and text inputs keep their ordinary keystrokes.
- Given the web unit tests, lint, typecheck, build and the interview and accessibility Playwright specs, when run, then all pass, and axe reports no serious or critical violations for the empty, populated, edit and confirmation states in ar, en and fr.

## Spec Change Log

## Review Triage Log

### 2026-11-22 — Review pass (all five layers in one combined read-only codex call, standard tier; diff 33 kB)
- verdicts: 14 findings — high 0, medium 4, low 7, false 3, maybe-false 0
- findings (blind-hunter):
  - `[low]` `[reject]` Cancel after Delete on a died-later card focuses the Heirs-row `remove:w` button instead of the card. This matches the intent contract ("Cancel restores focus as the row flow does"). Focus lands on that same person's Remove action. Delete-then-cancel on a died-later card is rare, and returning to the card would need a new opener parameter on `removeHeir`.
  - `[low]` `[patch]` The 375px ring test measured whichever card was focused. Fixed: it now asserts each destination id (w, s1, before, s2), and pans or zooms so s2's ring starts clipped before the final key.
  - `[low]` `[patch]` The zoom-key e2e checked only the announcement and toolbar state. Fixed: it now asserts that the canvas wrapper width grows after `+` and shrinks below its start after the `-` keys.
  - `[low]` `[patch]` The Tab test focused the root programmatically and checked only exit. Fixed: Shift+Tab back into the group must land on the roving root card.
  - `[medium]` `[patch]` The outline-parity unit test never rendered the Heirs list. Fixed: a new en/ar e2e matches every card's relationship and badge to a Heirs-outline row, and checks that the first row is the deceased.
  - `[false]` `[reject]` Cancel could lose a descendant or estate. Cancel sends no request (the test asserts no `confirm_cascade` DELETE), and the client never mutates the Case locally, so nothing can be dropped.
- findings (edge-case-hunter):
  - `[false]` `[reject]` An inherited key name such as `constructor` resolves to a direction. `KeyboardEvent.key` from a real keyboard never takes that value, so only a hand-made synthetic event could reach it.
  - `[false]` `[reject]` Offline Delete on a died-later card is consumed silently. Frozen cards ignore Delete by spec, exactly as ordinary cards did before this story, and the frozen (offline) state already shows its own notice.
  - `[low]` `[reject]` (claim) Cancel focus lands in the Heirs list: the same root cause as the first blind row.
  - `[medium]` `[patch]` (claim) The parity test does not mount the Heirs list: the same root cause as the blind parity row, fixed by the same e2e.
- findings (verification-gap):
  - `[low]` `[patch]` Keyboard zoom can announce without rescaling: the same root cause as the blind zoom row.
  - `[low]` `[patch]` The narrow ring test can measure a card that never moved: the same root cause as the blind ring row.
  - `[medium]` `[patch]` The outline parity cannot detect a missing row badge: the same root cause as the blind parity row.
- findings (intent-alignment):
  - `[medium]` `[defer]` Acceptance lives on the canonical outline under three real screen readers, and the diff exercises only the canvas plus automation. It is recorded as pending manual release evidence in `deferred-work.md` and in the frontmatter `deferred`. No automation can close it.
- findings (cross-story-contract): none ("No contract shape changed").

## Design Notes

**Why the drawn tree, not kinship.** UX-DR73 says "Up = parent, Down = first child". The architecture hangs every unlinked relative from the deceased, and the canvas draws them that way with spine connectors. Navigating that same hierarchy gives one rule a sighted keyboard user can see. Home already reaches the deceased, and Down from the deceased reaches its first drawn child.

**Placeholders.** The empty-state parent/spouse placeholders are add controls, and 9.7 made them reachable by Tab. The story's "only the current card is the roving tab stop" concerns cards, so they stay separate buttons. Add relative here also offers the same outcomes.

```ts
// family-tree.tsx onKeyDown sketch
const dir = { ArrowUp: "up", ArrowDown: "down", Home: "home", End: "end",
  ArrowRight: rtl ? "prev" : "next", ArrowLeft: rtl ? "next" : "prev" }[event.key];
if (dir) { event.preventDefault(); const next = treeNeighbour(model, ids, id, dir);
  if (next !== id) { setSelected(next); buttons.current.get(next)?.focus(); } }
```

## Verification

**Commands:**
- `cd web && npm test` -- expected: all pass.
- `cd web && npm run lint && npm run typecheck` -- expected: 0 errors; at most 12 lint warnings.
- `cd web && npm run build && npx playwright test e2e/interview.spec.ts e2e/accessibility.spec.ts` -- expected: all pass.

**Manual checks (if no CLI):**
- The screen-reader runs listed in `deferred-work.md` stay pending until a person records them. They are not part of this run.

## Auto Run Result

Status: done

**Summary:** The Family tree now has full keyboard navigation along the drawn tree.
- **Arrows, Home and End.** Up goes to a card's tree parent: its linked parent, otherwise the deceased. Down goes to the first child, and the inline arrows go to siblings, mirrored in Arabic. Home and End reach the deceased and the last card. An absent neighbour keeps focus and does not scroll.
- **Zoom keys.** `+`/`=` and `-`/`_` on a card zoom exactly like the toolbar buttons, through one shared `stepZoom`.
- **Delete.** Delete now also works on a died-later card, through the Heirs-row removal and cascade confirmation. It is still ignored on the deceased and while the tree is frozen.
- **Focus ring.** Cards have an 8px scroll margin, so a focused card's ring is never clipped.
- **Unchanged.** The canonical Heirs outline, the semantics, the copy and the server.
- **Screen-reader runs.** Release evidence with real screen readers is recorded as pending manual work.

**Files changed:**
- `web/src/interview/tree.ts` (+ `tree.test.ts`): the pure `treeNeighbour` helper and its matrix tests.
- `web/src/app/[locale]/interview/family-tree.tsx` (+ test): the key handler, `stepZoom`, Delete on died-later cards and `scroll-m-2`. The tests cover sibling semantics, Up/Down, absent neighbours, zoom limits, Delete rules and card text parity.
- `web/src/app/[locale]/interview/start-case.tsx`: Delete on a died-later card goes to the Heirs-row `removeHeir` path.
- `web/e2e/interview.spec.ts`: en/ar lineage navigation, ring visibility from off-screen, zoom rescale, Tab exit and Shift+Tab re-entry, died-later Delete and Cancel, text inputs keeping their keystrokes, and tree-to-outline parity.
- `web/e2e/accessibility.spec.ts`: axe in fr, plus a removal-confirmation scan in ar, en and fr.
- `web/e2e/family.ts`: an `s2` person row in the lineage fixture so the `parent_of` edge survives parsing, and the locale types widened to fr.
- `_bmad-output/implementation-artifacts/deferred-work.md`: the "Story 9.9" list of manual screen-reader evidence still owed.

**Run history:**
- Planning investigation by codex (standard).
- Implementation by a Sonnet subagent.
- Matrix-audit test additions by codex (light), with one selector fixed by the parent.
- Review by one combined codex call (standard).
- Review patches (test-only, one file) by codex (standard).
- No fallbacks were needed.

**Review:** 14 findings: medium 4, low 7, false 3.
- **Patched entries:** medium 1 (outline parity checked against the rendered Heirs list) and low 3 (ring-test destinations, zoom rescale, Shift+Tab re-entry).
- **Deferred:** the manual NVDA/VoiceOver/TalkBack evidence (medium).
- **Rejected:**
  - Cancel focus on the Heirs-row Remove: it matches the intent contract and is rare, and the fix would need a new parameter.
  - Cancel losing family data: false, because no request is sent.
  - A synthetic `constructor` key: false, because no real key has that value.
  - Silent offline Delete: false, because it is specified and matches existing behaviour.

**Follow-up review recommended:** false. One medium and no high entries were patched, and all patches were test-only.

**Verification** (final tree):
- `npm test`: 653/653.
- Lint: 0 errors, 12 warnings.
- Typecheck clean. Build OK (the app code is unchanged since the build; the later patches were test-only).
- `npx playwright test e2e/interview.spec.ts e2e/accessibility.spec.ts`: 130 passed (chromium).

**Residual risks:**
- Only chromium ran.
- Screen-reader usability is unproven until the manual runs.
- Delete on a died-later card was tested only against a stubbed 409 cascade. With an empty estate, the server may remove the person at once, as the Heirs-row Remove does, with Undo available.
