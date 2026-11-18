---
title: 'Story 1.4: Family Tree Visualization (Basic Render + Updates)'
type: 'feature'
created: '2026-11-07'
status: 'done'
baseline_commit: '42e20eb21963d50c19e8028d74cfd1b4e5cded8f'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/web/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The heir screen shows the family only as a list, so the visitor cannot see at a glance that the system has understood their family.

**Approach:** Draw the saved deceased and heirs as a connected tree on the heir screen, updated from each saved answer without a page reload. Use a small layout function and plain SVG and HTML, with no new library.

## Boundaries & Constraints

**Always:**
- The tree draws only what the session case holds. It changes when a save succeeds, never while typing or after a failed save.
- The case records relationship to the deceased only, not who descends from whom. Every heir connects to the deceased through one shared spine, and no heir is ever drawn as another heir's parent.
- Heirs sit on generation lines per Design Notes, using the same labels as the list. A named heir also shows the relationship. A label that does not fit is clipped, and the list keeps the full text.
- The tree mirrors in RTL and has no horizontal page scroll from 320px wide. A taller tree scrolls inside its own keyboard-focusable area, capped at 45% of viewport height.
- Screen readers get one text description of the structure, by relationship and count, with no names. The list stays the interactive equivalent, and its live region stays the only announcer.
- All text exists in Arabic, English and French. Motion respects reduced-motion. Lines and states stay visible in dark mode and forced colors, and no meaning relies on color alone.
- Names stay out of logs and analytics.

**Ask First:** Any new frontend library, backend or session-shape change, or schema migration.

**Never:** Shares, fractions or kirat on nodes (1.5). Fiqh checks (1.6). Parent links between heirs. Selecting or editing from a node, arrow-key navigation, pan or pinch zoom, the full-viewport layout, floating card or bottom sheet. Manasikhat. Pushing this work.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No heirs | Saved deceased, no heirs | Single deceased node and a prompt to add the first heir | N/A |
| Add heir | Save succeeds | Node appears on its line, tree in view and new node visible, focus stays on the relationship field | N/A |
| Edit heir | Relationship or name saved | Node updates and moves line if needed, same `id` | N/A |
| Heir being edited | Form open for an heir | Node marked by a thicker border as well as `aria-current` on its list row | Cancel clears the mark |
| Remove heir | Removal saved | Node gone, others reflow, focus stays with the list as in 1.3 | N/A |
| Save fails or is throttled | `400`, `429`, network | Tree unchanged | Existing form messages |
| Deceased edited | Gender changed | Deceased node text follows after the save | N/A |
| Editing the deceased | Deceased form open | No tree, as on the selector screen | N/A |
| Two unnamed sons | Same relationship | Numbered labels matching the list | N/A |
| 100-character name | Any language | Clipped inside its node, no overlap | N/A |
| Mixed-direction name | Latin name in Arabic | Isolated in `bdi`, words keep order | N/A |
| 50 heirs on one line | Phone width | Wraps to more rows, area scrolls | N/A |
| Language switch or reload | Heirs saved | Same tree in the new language and direction | N/A |

</frozen-after-approval>

## Code Map

- `web/src/app/[locale]/interview/start-case.tsx:337-385` -- heir screen. Render the tree first, then form, then list. Move `DeceasedSummary` under the madhab bar as is. `started.case` is already the saved truth, including during saves.
- `web/src/app/[locale]/interview/start-case.tsx:179-184` -- focus effect. Bring the tree into view only after a successful add or heir edit, keeping the form focus. Removal keeps focus on the list, so it must not scroll.
- `web/src/app/[locale]/interview/start-case.tsx:218` -- the `[&>*:not(form)]` narrow rule. Exempt the tree, for example through a `data-wide` attribute in the selector, so it can use the page's `max-w-6xl`.
- `web/src/app/[locale]/interview/heir-list.tsx:69-73` -- `heirLabels` call to mirror. `:92` is the live region, which stays as is.
- `web/src/interview/answers.ts:192-222` -- `heirLabels`, `heirLabel`. Reuse them, no second labelling rule.
- `web/src/api/case.ts:13-38,59-66` -- `RELATIONSHIP_IDS`, `Heir`, `Deceased`. `parseCase` already drops unknown relationships.
- `web/src/interview/flow.ts:67-82` -- `StartedView.editingHeir`. `flow.ts` needs no change.
- `web/src/i18n/messages.ts`, `web/src/api/case.test.ts:131-150` -- typed dictionary and locale test.
- `web/src/app/[locale]/globals.css` -- no palette yet: `currentColor` and `border-current` are the convention, and body sets the theme colors.
- `web/src/app/[locale]/interview/form-bits.tsx:26` -- `WithHeir`, for templates with a name in `bdi`.
- `_bmad-output/planning-artifacts/ux-design-specification/component-strategy.md:28-40` -- target component, read with the deviations below.

## Tasks & Acceptance

**Execution:**
- [x] `web/src/interview/tree.ts`, `web/src/interview/tree.test.ts` -- add `generationLines()`, `layoutTree(heirs, width)` and `treeSummary()` as pure functions, table-tested at widths 272, 327, 576 and 1104 -- layout and summary are checkable without a browser. Assert: every relationship id has one line, no nodes overlap, none cross the spine, nothing exceeds the width, one edge per heir, stable order, and a new heir never reorders earlier heirs on other lines.
- [x] `web/src/app/[locale]/interview/family-tree.tsx` -- add the `FamilyTree` component per Design Notes, measuring width with `ResizeObserver` -- HTML nodes over an SVG of connectors.
- [x] `web/src/app/[locale]/interview/start-case.tsx` -- render the tree on the heir screen, reorder per Code Map, scroll it into view after an add or edit, exempt it from the narrow rule.
- [x] `web/src/i18n/messages.ts`, `web/src/api/case.test.ts` -- add `treeHeading`, `treeDeceasedMale`, `treeDeceasedFemale`, `treePrompt`, `treeSummary` and extend the locale test.
- [x] `web/scripts/check-export.mjs` -- confirm no change is needed; the route list is unchanged.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- append entries for node selection with arrow keys and zoom, and for the full-viewport layout with floating card and bottom sheet -- cut from this story, and the UX spec expects them.

**Acceptance Criteria:**
- Given a saved deceased and no heirs, when the heir screen shows, then one deceased node and a clear prompt to add heirs appear.
- Given a saved deceased, when the visitor adds heirs, then each appears as a node connected to the deceased by a visible line, without a page reload.
- Given an heir is added or edited on a phone, when the save succeeds, then the tree and new node are on screen and focus remains in the form.
- Given Arabic, when the tree renders, then its layout mirrors English, and heirs keep the same line.
- Given a keyboard user, when tabbing through the heir screen, then the tree area receives one visible focus stop, can be scrolled by arrow keys, and contains no other tab stops.
- Given a screen reader, when the tree area is reached, then it reads the description, such as "Family tree. The deceased, male. Son: 2. Wife: 1.", in the page language.
- Given reduced motion, when the tree changes, then nodes move without animation; otherwise they reflow in about 300ms.

## Spec Change Log

## Design Notes

**Generation lines**, top to bottom. Order within a line follows this table, then the order added:

| Line | Relationships |
|------|---------------|
| 1 | `grandfather`, `grandmother` |
| 2 | `father`, `mother`, `uncle`, `paternal_uncle` |
| - | The deceased, on the spine |
| 3 | `husband`, `wife`, `brother`, `sister`, `paternal_brother`, `paternal_sister`, `maternal_brother`, `maternal_sister`, `son_of_uncle`, `son_of_paternal_uncle` |
| 4 | `son`, `daughter`, `son_of_brother`, `son_of_paternal_brother` |
| 5 | `son_of_son`, `daughter_of_son` |

**Why a spine:** With two sons and one son's son, the data does not say whose child he is. A vertical spine runs through the centre, with the deceased on it. Each line, wrapped to as many rows as needed, has nodes split evenly to both sides of the spine, and the odd one goes on the inline-start side. A horizontal bar joins each row to the spine, with a short stub to each node. Nothing sits on the spine except the deceased, so no line ever seems to pass through a person.

**Layout:** Column count is even, the most that fit, and at least 2, so a phone still shows one node each side. At 2 columns, node width shrinks to fit from 320px. Nodes are rounded cards of fixed size, with up to 2 clamped lines for the label and 1 for the relationship.

**Deviation from UX spec:** Cards instead of 40-64px circles, because labels like "Paternal uncle (father's full brother)" cannot fit inside a circle. The deceased card is filled with the text color and inverted, since there is no navy token yet. The UX `role="img"` and arrow-key navigation conflict, because children of an image cannot take focus. This story makes the focusable scroll area itself `role="img"`, so its description is read on focus, and leaves actions on the list.

**Order on the screen:** Tree, then form, then list, so that a phone shows the tree and the next question together.

**Library:** Architecture says React Flow first, with custom SVG as the fallback. This tree needs no drag, pan, zoom or edge routing, React Flow does not mirror for RTL, and its bundle matters on 3G. A later story can adopt it, as the layout is isolated in one module.

**Summary text:** "Son: 2" avoids Arabic and French plural rules. `treeSummary` lists relationships in table order.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` in `web/`, then `node scripts/check-export.mjs` -- expected: all pass.
- `DJANGO_ENV=production python manage.py test` -- expected: all pass, as no backend code changes.

**Manual checks:**
- With the built export at Arabic and English, at 320px, 375px and desktop: empty tree, add, edit, remove, throttled save, 50 heirs, language switch and reload, dark mode, forced colors and reduced motion, with one keyboard-only run.

## Suggested Review Order

**Drawing the tree without inventing kinship**

- Start here: the spine layout, which never draws one heir as another's parent.
  [`tree.ts:96`](../../web/src/interview/tree.ts#L96)

- The generation table; check each relationship sits where you expect.
  [`tree.ts:8`](../../web/src/interview/tree.ts#L8)

- Rows split across the spine; ancestors connect downward into the deceased.
  [`tree.ts:125`](../../web/src/interview/tree.ts#L125)

- HTML cards over mirrored SVG connectors, with labels shared with the list.
  [`family-tree.tsx:18`](../../web/src/app/%5Blocale%5D/interview/family-tree.tsx#L18)

**Keeping the tree in view after a save**

- Decides what to reveal: only a successful add or edit, never a removal.
  [`flow.ts:582`](../../web/src/interview/flow.ts#L582)

- Runs after focus, once per announcement, so returning to the screen never scrolls.
  [`start-case.tsx:197`](../../web/src/app/%5Blocale%5D/interview/start-case.tsx#L197)

- Uses the node's final position, because it may still be animating.
  [`tree.ts:213`](../../web/src/interview/tree.ts#L213)

- Behaviour change from 1.3: after an edit, focus returns to the form, not the list row.
  [`flow.ts:628`](../../web/src/interview/flow.ts#L628)

**Screen layout**

- Check this order: tree, then form, then list, changed so phones show tree and question together.
  [`start-case.tsx:379`](../../web/src/app/%5Blocale%5D/interview/start-case.tsx#L379)

- Lets the tree use the full page width while other content stays narrow.
  [`start-case.tsx:250`](../../web/src/app/%5Blocale%5D/interview/start-case.tsx#L250)

**Accessibility and wording**

- The focusable area is the image, so its description is read on focus.
  [`family-tree.tsx:59`](../../web/src/app/%5Blocale%5D/interview/family-tree.tsx#L59)

- Name-free description by relationship and count, avoiding plural rules.
  [`tree.ts:187`](../../web/src/interview/tree.ts#L187)

- The editing mark is an outline, so it survives forced colors and keeps the box size.
  [`family-tree.tsx:101`](../../web/src/app/%5Blocale%5D/interview/family-tree.tsx#L101)

- Check this wording in all three languages; Arabic and French are unreviewed.
  [`messages.ts:154`](../../web/src/i18n/messages.ts#L154)

**Tests**

- Geometry checks: connectors reach spine and node, nothing overlaps at any width.
  [`tree.test.ts:32`](../../web/src/interview/tree.test.ts#L32)

- The generation table pinned literally against the spec.
  [`tree.test.ts:62`](../../web/src/interview/tree.test.ts#L62)

- Reveal rules at flow level.
  [`flow.test.ts:1164`](../../web/src/interview/flow.test.ts#L1164)
