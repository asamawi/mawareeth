# Sprint Change Proposal: Family tree grows sideways instead of wrapping

Date: 2026-11-23
Trigger: Owner report: "the heirs tree doesn't expand horizontally; adding heirs is limited to 2 heirs in a row."
Mode: batch.
Scope: Minor (one new Epic 9 story; one UX-DR line and one UX spine row clarified; no PRD requirement or architecture decision changes).
Status: Approved 2026-11-23 by Ahmad. Edits applied to epics.md, EXPERIENCE.md and sprint-status.yaml.

## 1. Issue summary

When the owner adds several relatives of the same generation (for example four sons), the Family tree puts two cards on a row and starts a new row under them. The canvas only grows downward. It never becomes wider than the visible area, so the 2D scrolling and pan that the UX spec gives the canvas are not used sideways.

**Cause.** `layoutTree(model, width, cardWidth)` in `web/src/interview/tree.ts:87-99` receives the visible canvas width (`family-tree.tsx:51`). It computes how many cards fit on each side of the deceased's spine (`perSide`) and wraps every generation line into rows of `perSide * 2` (`tree.ts:113-114`). The resulting width of the layout is the viewport width (`width: usable`). Measured with the shipped constants (8px gap, 24px spine gap):

| Width | Card | Tree width | Cards per row |
|---|---|---|---|
| 375px phone | 108px | ~343px | **2** |
| 640–1023px | 136px | ~600–990px | 2–6 |
| 1024–1279px | 136px | >=596px flexible column | **2** at the minimum, rising slowly |
| 1280px and up | 136px | ~930px | 6 |

The wrapping was introduced in phase 1 (`6237121`, "draw the family tree as heirs are added"). Story 9.2 kept it. **No planning artifact asks for it.** UX-DR13 and Story 9.2 call the canvas "a labelled 2D scroll region" with drag/swipe pan, pinch zoom and Fit tree, and EXPERIENCE.md places each relative "on their generation line". So the code does not match the spec here. The spec was never changed.

**Owner decision (2026-11-23):** each generation stays on **one horizontal row** at every width. The canvas grows sideways, and the user reaches the rest with the existing pan, zoom and Fit tree. The deceased stays visible (NFR-X1).

## 2. Impact analysis (checklist summary)

| Checklist section | Status | Finding |
|---|---|---|
| 1. Trigger and context | [x] | Spec–code gap in the tree layout; found in owner use after 11.3/9.12. Evidence above. |
| 2. Epic impact | [x] | Epic 9 only. It is still in progress (9.12, 9.13 in review), so a new story 9.14 fits there. No other epic is affected. Epic 11's sticky bar and sheet are unaffected. |
| 3. Artifact conflicts | [x] | PRD: none (NFR-X1 unchanged and still the gate). Architecture: none. UX: UX-DR13 and the EXPERIENCE tree-canvas row are silent on wrapping. Add one clarifying sentence to each so the rule cannot drift again. |
| 4. Path forward | [x] | Direct adjustment. No rollback, no MVP change. |
| 5. Handoff | [x] | Minor: developer implements via bmad-build. |

### Stories

| Item | Status | Impact |
|---|---|---|
| 9.2 | done | Built the wrapping layout. Its text is history and is not edited. The fix is story 9.14. |
| 9.7, 9.9 | done | Drop targets and arrow navigation read node boxes from `layoutTree`; they keep working, but their tests must still pass on the one-row layout. |
| 9.11 | done | Responsive/RTL checks re-run as part of 9.14. |
| 9.12 | review | `web/e2e/capacity-journey.spec.ts` (50 Heirs at 375px and 1280px) must stay green on the new layout. 9.14 re-runs it. 9.12 can be accepted on its current evidence; 9.14 refreshes the root-visibility part. |
| 9.13 | review | Unaffected. |
| **9.14 (new)** | — | The layout change. See §4. |

### Technical impact

- `web/src/interview/tree.ts` — `layoutTree`: drop `perSide`/`capacity` wrapping. Place each generation line as one row split across the spine (odd card on the inline-start side, as now). The layout width becomes `max(visible width, widest row + padding)`, with the spine centred in it so no card has a negative x. The parent-alignment pass (`tree.ts:155-166`) and the edge paths are kept. The `columns` field is removed, or it reports the widest row.
- `web/src/app/[locale]/interview/family-tree.tsx` — the canvas already scrolls (`overflow-auto`) and the inner box is sized from `layout.width * zoom`. When a change shifts the spine, adjust `scrollLeft` by the same amount, so the deceased does not jump on screen. The initial view and Fit tree centre the deceased horizontally. The add-placeholder row (`family-tree.tsx:163`) is unchanged.
- `fitZoom` stays: it picks the largest zoom down to 0.6 that fits the layout, and wider trees scroll beyond that.
- Tests: `tree.test.ts:115` (`columns === 2`) and `tree.test.ts:124` ("wide screens put more nodes in a row and phones wrap") encode the old rule and are replaced. The new tests check one row per line at any width.
- Risk: a 50-sibling generation is ~5,800px wide at 108px cards (~3,500px at 0.6 zoom). Pan and the pinned deceased already handle this. Keyboard Start/End arrows walk the row, and the focused card scrolls into view (`scroll-m-2`).

Effort: about half a day of dev plus tests. Timeline impact: none on other epics.

## 3. Recommended approach

**Direct adjustment:** add Story 9.14 to Epic 9 and clarify UX-DR13 and the EXPERIENCE spine. The spec already describes a sideways-scrolling canvas, so this is a fix to match the spec, not a redesign.

## 4. Detailed change proposals

### 4.1 Epics — UX-DR13 (`epics.md`, Requirements Inventory)

OLD:
> UX-DR13: [changed] Build tree-canvas using components.tree-canvas.*: dotted surface at 18px spacing, 1px top/bottom lines, token padding with at least 6px on every logical side, hint and toolbar above; labelled 2D scrolling, drag/swipe pan with touch-action: pan-y pinch-zoom, pinch zoom and Fit tree reset. Show one estate level; keep the deceased visible with up to 50 Heirs at 375px and 1280px. _(DESIGN Components; EXPERIENCE Component Patterns)_

NEW:
> UX-DR13: [changed] Build tree-canvas using components.tree-canvas.*: dotted surface at 18px spacing, 1px top/bottom lines, token padding with at least 6px on every logical side, hint and toolbar above; labelled 2D scrolling, drag/swipe pan with touch-action: pan-y pinch-zoom, pinch zoom and Fit tree reset. **Each generation line is one horizontal row that never wraps; the canvas grows sideways past the visible width and is reached by scrolling, pan and zoom.** Show one estate level; keep the deceased visible with up to 50 Heirs at 375px and 1280px. _(DESIGN Components; EXPERIENCE Component Patterns)_

Rationale: the missing rule allowed the viewport-fitted wrapping to survive Story 9.2.

### 4.2 UX spine — EXPERIENCE.md, Component Patterns, `tree-canvas` row

OLD (end of the row):
> … A relative with no recorded parent hangs from the deceased on their generation line; a lineage link exists only after adding at a chosen person or editing one. |

NEW:
> … A relative with no recorded parent hangs from the deceased on their generation line; a lineage link exists only after adding at a chosen person or editing one. **A generation line is one horizontal row at every width and never wraps; when it is wider than the canvas, the canvas scrolls sideways.** |

### 4.3 Epics — new Story 9.14 (inserted after Story 9.12, before Epic 10)

```
### Story 9.14: Keep each generation on one row and let the tree grow sideways

As a family member entering a large family,
I want all relatives of one generation side by side on one line,
So that the tree reads as a family tree and I can pan to anyone instead of scrolling down through rows of two.

**Acceptance Criteria:**

**Given** an active estate with more relatives on one generation line than fit in the visible canvas (for example six sons at 375px, or ten at 1024px)
**When** `layoutTree` in `web/src/interview/tree.ts` places them
**Then** every generation line is exactly one row, split across the deceased's spine with the odd card on the inline-start side, at every width; the layout's width is the larger of the visible canvas and the widest row plus logical padding, the spine is centred in it and no card has a negative or clipped position (UX-DR13)
**And** a relative with a recorded parent still sits under that parent when the slot is free, and adding a relative never moves the relatives of another line relative to the spine.

**Given** the one-row layout in `family-tree.tsx`
**When** I add, remove, undo, drop or open a later-death estate
**Then** the canvas grows or shrinks sideways in its existing labelled 2D scroll region, the deceased keeps its on-screen position (scroll is adjusted when the spine shifts) and stays visible during free pan and zoom (NFR-X1)
**And** the first render and Fit tree centre the deceased horizontally, Fit tree zooms no lower than the existing 0.6 floor, and the rest of the row stays reachable by drag/swipe pan, pinch, plus/minus and keyboard.

**Given** keyboard and screen-reader users
**When** Start/End arrows move along a long row in LTR and RTL
**Then** the focused card scrolls into view with its focus ring unclipped, RTL mirrors only the connector layer, and the tree's role=group, roving tab stop and Heirs outline order are unchanged (UX-DR73, UX-DR81).

**Given** the existing tests
**When** the story is complete
**Then** the wrapping assertions in `web/src/interview/tree.test.ts` ("phones wrap", `columns === 2`) are replaced by tests that a line stays one row at 288px, 600px and 1280px in both reading directions, and that no node overlaps another
**And** `web/e2e/capacity-journey.spec.ts` (50 Heirs at 375px and 1280px), the Story 9.7 drop and 9.9 keyboard tests and the Story 9.11 responsive/RTL checks pass unchanged in intent.
```

### 4.4 Sprint status (`implementation-artifacts/sprint-status.yaml`)

Add under `epic-9`, after `9-12-…`:

```
  9-14-keep-each-generation-on-one-row-and-let-the-tree-grow-sideways: ready-for-dev
```

Epic 9 stays `in-progress`.

## 5. Implementation handoff

- **Scope:** Minor.
- **Route:** Developer, via `bmad-build` for Story 9.14 (a Sonnet subagent if delegated, per the owner's working preferences; the change is about 2 source files plus tests).
- **Success criteria:**
  1. At 375px, adding six sons gives one row of six. The canvas scrolls sideways, and no second row of sons appears.
  2. At 1024px, ten relatives on one line sit on one row.
  3. The deceased stays visible and does not jump on screen while adding, during pan/zoom, and in Arabic RTL.
  4. Unit tests, the 50-Heir capacity e2e, and the drop, keyboard and RTL tests pass.
