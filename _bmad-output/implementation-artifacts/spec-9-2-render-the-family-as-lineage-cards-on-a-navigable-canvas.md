---
title: 'Story 9.2: Render the family as lineage cards on a navigable canvas'
type: 'feature'
created: '2026-11-19'
status: 'done'
baseline_revision: '9ea7c7467cbffb678ca6fcac0a174d86ecb9288a'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-mawareeth-2026-11-16/DESIGN.md'
  - '{project-root}/web/AGENTS.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The Interview tree is a `role="img"` picture. Every heir hangs from one shared spine, and the picture ignores the 9.1b `persons`/`edges`/`placement` data. It cannot show died-before, died-later or blocked people, cannot be panned or zoomed, and its cards are not buttons. The Heirs list does not list the deceased or any person's state.

**Approach:** Build a read-only lineage model and layout of the active estate in `web/src/interview/tree.ts`. Feed both the tree and the Heirs list from one extended `treeDescription`. Render the tree as one labelled `role="group"` of native card buttons with a roving tab stop, on a dotted canvas that can be panned and zoomed. A toolbar above the canvas holds Fit tree, zoom in and zoom out. The deceased card stays pinned inside the viewport. Card presses only select the card; edit, add and estate actions come in 9.3–9.9.

## Boundaries & Constraints

**Always:**
- **Active estate model** (pure, in `tree.ts`):
  - **Estate 1.** The people shown are the `kase.heirs` rows, plus every `kase.persons` entry with status `died_before_or_with`. Died-before people appear in estate 1 only.
  - **Later estate (a `Death`).** The people shown are `death.heirs`. Relationships are relative to that estate's deceased.
  - **Ids.** A card's key is the row id. Its person id is `personOf(heir)` from `layers.ts`.
  - **Edges.** Use only `parent_of` edges whose endpoints are both shown people. In a later estate, an endpoint equal to `death.heir_id` reads as `"root"`.
  - **Unlinked people.** An edge from or to `"root"` creates no link. A person with no shown parent hangs from the deceased's spine on their generation line, exactly as today (`LINES`).
  - **Linked children** sit on their generation line, ordered under their parent's position. A connector runs from the parent card to the child card.
  - **Missing data.** Absent `persons`, `edges` or `placement` read as empty, so legacy cases render exactly the spine layout they render today, but with the new cards.
- **States**, one per card:
  - `died_before`: the person status is `died_before_or_with`.
  - `died_later`: the person has a death of their own (`kase.deaths[].heir_id`) and is not the active estate's deceased.
  - `blocked`: the active estate's preview evidence lists the person with `rule.code === "blocked"`. The evidence is the `presented.evidence` entry whose `order` is the estate order: 1 for the first estate, or `death.order`. Evidence comes only from an `available` preview of the current key. With any other preview there are no blocked cards.
  - Otherwise `normal`.
  - The browser never computes blocking or shares itself.
- **`SharePreview`** reports the shown `PresentedResult` (or `null`) to `start-case.tsx` through a new optional callback. It reports `null` whenever its shown outcome is not an `available` preview for the current key.
- **`treeDescription`** is extended to return the text of every card and row. That covers the deceased label, and for each person: the relationship term, the secondary line, the state badge text and the no-share flag.
  - The secondary line is the name, or else the numbered default label when it differs from the bare term.
  - `FamilyTree` and `HeirList` read their text from it and from nothing else.
  - The deceased is labelled only with the new `treeDeceased` message: "The deceased" / "المتوفى" / "La personne décédée". Later estates keep their existing root text (`crumbTextOf`).
- **Canvas.** The canvas is the `role="group"` element itself, with `aria-labelledby` set to the tree heading. It is a 2D scroll region, and its styles are:
  - `bg-surface`, with a dotted `line` grid at 18px spacing;
  - 1px `line` borders on the block-start and block-end edges only;
  - padding of at least 6px on every logical side;
  - `touch-action: pan-y pinch-zoom`.

  Connectors are 2px `graphic`. In RTL only the SVG connector layer is mirrored (`rtl:-scale-x-100`, as now). Cards are positioned with `insetInlineStart` and are never mirrored.
- **Cards.**
  - Every card, the deceased included, is a native `<button type="button">`, with a 10px node radius and a minimum height of 76px.
  - The width is 108px below a 640px viewport and 136px from 640px up (Tailwind `sm`). The layout takes the card width as a parameter.
  - The relationship is bold (`text-node-name`). The secondary line is small (`text-node-meta`). Names sit in `<bdi>`.
  - No card has an avatar, initials, gender frame or symbol.
  - Card styles by state:

    | State | Fill | Border | Badge |
    |---|---|---|---|
    | normal | `background` | 1.5px solid `graphic` | — |
    | died-before | `surface` | 2px dashed `graphic`, 4px dash / 3px gap | `badge-died-before`: 1px dashed `graphic`, background fill |
    | died-later | `background` | 2px solid `accent` | `badge-died-later` (accent on `accent-soft`), with a trailing `aria-hidden` chevron that is mirrored in RTL |
    | blocked | stripes: `repeating-linear-gradient(135deg, surface 0 6px, blocked-stripe 6px 12px)` | 1.5px `graphic` | `badge-no-share`; text sits on solid `surface` plates in `muted` |
    | deceased | `accent` | — | text in `accent-foreground`; focus uses `focusRingOnAccent` |

  - A browser cannot draw a 4/3 dashed border with `border-style: dashed`. Draw the died-before edge with an SVG or `background` dash pattern, or a `border-image`, that gives exactly a 4px dash and a 3px gap at 2px width.
  - Badges use `text-badge` and a full radius.
- **Roving tab stop.**
  - Exactly one card has `tabIndex=0`: the selected card, otherwise the deceased. All others have `-1`.
  - Pressing a card selects it: it gets `aria-current="true"` and becomes the tab stop.
  - The card named by the existing `editingId` also gets `aria-current="true"`.
  - Keys: inline arrows go to the previous or next card in reading order and are mirrored in RTL. Home goes to the deceased, End to the last card. A focused card is scrolled into view.
  - Tab leaves the group.
  - Up/Down, Enter, Delete and +/- are left to 9.9.
- **Placeholders.**
  - When the active estate has no people, render the deceased plus one placeholder per link (`parent`, then `spouse`) for which `placement.root` (or `death.placement.root`) has at least one option. The labels are "+ Add parent" and "+ Add spouse".
  - Style: 1.5px dashed `accent` edge, accent text.
  - Placeholders are not buttons in this story. They are plain items inside the group, and 9.7 makes them actionable.
- **Toolbar.** It sits above the canvas and holds:
  - a hint line;
  - Fit tree, zoom in and zoom out, as 44px secondary buttons with 8px gaps. Zoom in and zoom out show a `+`/`−` glyph with `aria-hidden` and have sr-only names.

  Zoom levels are `[0.6, 0.8, 1, 1.25, 1.5]`, starting at 1; at 0.6, 76px cards are still at least 44px. Each zoom press announces "Zoom {percent}", formatted with `Intl.NumberFormat(locale, {style: "percent"})`, through the existing polite region in `HeirList`. Do not add a second live region: `start-case.tsx` passes a zoom note that the region shows until the next flow announcement replaces it.
- **Pan and zoom.**
  - Dragging with a pointer pans the scroll position. Mouse drags pan both axes; touch drags pan horizontally, and the browser handles vertical scrolling and pinch.
  - A drag of more than 6px suppresses the click that follows.
  - Zoom scales the content around its block-start/inline-start corner inside a sizer of the scaled size.
  - Fit tree picks the largest level of at most 1 at which the whole tree fits, or else 0.6. It then scrolls to the block-start and centres the deceased inline.
  - Reduced motion disables every transition, the same way as now.
- **Deceased always visible.** At every scroll and zoom, the deceased card is rendered at its layout position, clamped so its whole box stays at least 6px inside the visible viewport. A pure helper does this, and it handles RTL's negative `scrollLeft`.
- **Heirs list (canonical outline).**
  - The first row is the deceased: the `treeDescription` label, with no actions.
  - Then every shown person, heirs and died-before, in tree reading order. Each row shows the relationship, the secondary line and the state badge text, which includes "No share in this case" when blocked.
  - Rows are at least 52px. Existing heir row actions stay unchanged and at least 44px. Died-before rows have no actions.
  - The heading count still counts heirs only.
  - The empty text is the new `heirsEmpty` copy.
- **Copy.** New or changed `interview` messages in ar, en and fr. Every string goes in `deferred-work.md` for native review.
  - `treeDeceased`: "The deceased" / "المتوفى" / "La personne décédée".
  - `treeDiedBefore`: male / female forms: "Died before" / "توفي قبله" / "توفيت قبله" / "Décédé avant" / "Décédée avant".
  - `treeDiedLater`: male / female forms: "Died later · own estate" / "توفي لاحقاً · تركة مستقلة" / "توفيت لاحقاً · تركة مستقلة" / "Décédé plus tard · succession propre" / "Décédée plus tard · succession propre".
  - `treeNoShare`: "No share in this case" / "لا نصيب في هذه الحالة" / "Aucune part dans ce cas".
  - `treeAddParent`: "+ Add parent" / "+ إضافة أحد الوالدين" / "+ Ajouter un parent".
  - `treeAddSpouse`: "+ Add spouse" / "+ إضافة الزوج أو الزوجة" / "+ Ajouter un conjoint".
  - `treeFit`: "Fit tree" / "ملاءمة الشجرة" / "Ajuster l'arbre".
  - `treeZoomIn` / `treeZoomOut`: "Zoom in" / "Zoom out", "تكبير" / "تصغير", "Zoom avant" / "Zoom arrière".
  - `treeZoomStatus`: "Zoom {percent}" / "التكبير {percent}" / "Zoom {percent}".
  - `treeHint`: "Drag to move around the tree. Use the buttons to zoom." / "اسحب للتنقل في الشجرة. استخدم الأزرار للتكبير والتصغير." / "Faites glisser pour parcourir l'arbre. Utilisez les boutons pour zoomer."
  - `heirsEmpty`: "No heirs yet. Press a relationship to add one." / "لا يوجد ورثة بعد. اضغط على صلة قرابة لإضافة وارث." / "Aucun héritier pour l'instant. Appuyez sur une relation pour en ajouter un."
  - Remove `treeDeceasedMale`, `treeDeceasedFemale`, `treePrompt`, `treeSummary` and `treeCount`, together with their tests, if nothing else reads them.

**Never:**
- Use `role="img"`, `role="tree"`, `role="application"`, or an `aria-label` that overrides a card's visible text.
- Wire card presses to edit, remove, add or open-estate. Do not drop, drag-add, add Up/Down keys or keyboard zoom (9.3–9.9).
- Compute shares or blocking in the browser. Do not fetch the preview a second time. Do not change `SharePreview`'s rendering.
- Guess a parent link. Do not change the API, the server or the `case.ts` parsers.
- Use physical left/right CSS properties. Do not load a font.
- Use `line` for an essential boundary.
- Build Epic 11's sticky bar.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Legacy case | wife + 2 sons, no persons/edges/placement | deceased + 3 normal cards on the spine; list = deceased row + 3 rows | — |
| Lineage | died-before son S, `son_of_son` G, edge `parent_of S→G` | S dashed with "Died before" on line 4; G on line 5, with a connector from S, not from the spine; list rows for S (no actions) and G | — |
| Blocked | available preview whose estate-1 evidence has a brother with rule `blocked` | brother card striped, with "No share in this case"; same text in his row | other preview states → no blocked cards |
| Died later | wife with a death (order 2), active estate 1 | solid accent card, "Died later · own estate" with chevron; female Arabic form | — |
| Later estate | active = wife's estate | her estate's heirs; root text from `crumbTextOf`; her card is not shown as died-later | — |
| Empty estate | no people; `placement.root` has parent and spouse options | deceased + "+ Add parent" + "+ Add spouse"; list says "No heirs yet…"; preview shows its prompt, no shares | link with no options → no placeholder |
| 50 heirs | 375px and 1280px, pan to every edge, zoom 0.6–1.5, Fit tree | deceased box fully inside the canvas viewport at every step; every card reachable; card boxes ≥44px | — |
| RTL | `/ar/` | connector SVG mirrored; cards and text not mirrored; inline arrows reversed | — |

</intent-contract>

## Code Map

- `web/src/interview/tree.ts` -- `LINES` and `lineOf` give generation lines. `layoutTree():96` is the current spine layout: rows wrap per line by width, start/end are split around the spine, x is measured from inline-start, and SVG paths are in LTR coordinates. `treeDescription():187` returns a summary string today, and `scrollTopFor():212`. Rework these into the model, layout, description, pin and fit helpers, keeping the spine geometry for unlinked people. Change `NODE_WIDTH`/`NODE_HEIGHT` to parameters or constants: width 108/136, card height ≥76 (pick a fixed layout height, such as 88, that fits three lines plus a badge).
- `web/src/interview/tree.test.ts` -- existing layout and summary tests. Update them, and add tests for the matrix model, layout, pin and fit.
- `web/src/interview/layers.ts` -- `layerAt()` (active layer: `id`, `heirs`, `gender`, `options`), `personOf()` and `breadcrumb()`. Reuse them; do not duplicate them.
- `web/src/interview/answers.ts` -- `heirLabels()` (numbered default labels).
- `web/src/api/case.ts:119-172` -- `Case.persons/edges/placement`, `Death.placement`, `Person.status`, `Edge`, `PlacementOption.link`. These are read-only.
- `web/src/contracts/presented.ts:23-41` -- `PresentedResult.evidence[]` (`order`, and `heirs[].person` with `rule.code`).
- `web/src/app/[locale]/interview/family-tree.tsx` -- the current `role="img"` tree. Rewrite it into the toolbar, the canvas group, the cards, the placeholders and the pinned deceased. Keep `section[data-tree]` with `aria-labelledby` set to its heading (9.1 e2e relies on it).
- `web/src/app/[locale]/interview/heir-list.tsx:86-269` -- `HeirList`, with its polite region at `:127` and the empty text at `:137`. Add the deceased row, died-before rows, badges, the 52px rows and the zoom note.
- `web/src/app/[locale]/interview/share-preview.tsx:52-73` -- the fetch/`shown` outcome. Add the optional `onPresented` callback, fired from an effect.
- `web/src/app/[locale]/interview/start-case.tsx:264-271, 534-563` -- `layer`, `layerText`, `deceasedIds`, and the `FamilyTree`/`HeirList`/`SharePreview` props. Hold the `presented` and zoom-note state, and pass the model.
- `web/src/app/[locale]/ui.ts` -- `focusRing`, `focusRingOnAccent` and `secondaryButton`, used for the toolbar and the deceased card.
- `web/src/app/[locale]/globals.css` -- 9.1 tokens: `graphic`, `accent-soft`, `blocked-stripe`, `surface`, `line`, `text-node-name/meta`, `text-badge`, `radius-node`.
- `web/src/i18n/messages.ts:79-111` -- interview message type, ar `:338`, en `:619`, fr `:901`. `web/src/api/case.test.ts:193` checks the tree keys; update it.
- `web/src/app/[locale]/interview/heir-form.test.tsx` and `web/src/test/dom` -- the pattern for component tests (`installDom`, `createRoot`, `act`).
- `web/e2e/api.ts` (`fullCase`, `json`), `web/e2e/family.ts` (`openHeirsScreen`, presented fixtures from `api/contracts/preview-presented-fixtures.json`), `web/e2e/interview.spec.ts:342-430` -- 9.1 shell tests. The 44px check excludes `[data-tree-area]` at `:429`; remove that exclusion, because cards must now be at least 44px. `web/e2e/accessibility.spec.ts` holds the heirs-screen axe tests.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- add the new copy for native review.

## Tasks & Acceptance

**Execution:**
- `web/src/interview/tree.ts` -- add:
  - `estateModel(kase, layerId, presented)`: people, with row id, person id, relationship, gender, name, state and parent person id;
  - the lineage-aware `layoutTree(model, width, cardWidth)`: nodes, connector paths and the deceased box;
  - the extended `treeDescription(messages, model, rootText?)`;
  - `placeholders(model)`;
  - `pinBox(box, view, zoom, pad, rtl)`;
  - `fitZoom(layout, view)`;
  - `ZOOM_LEVELS`.

  All of them are pure.
- `web/src/interview/tree.test.ts` -- cover every I/O row at model, layout or description level:
  - legacy layout unchanged, apart from card size;
  - linked child under the parent, with a connector from the parent;
  - edges to an unshown endpoint ignored;
  - later-estate `heir_id`→root;
  - blocked only from `available` evidence of the right order;
  - placeholders only for links with options;
  - pin clamping in LTR and RTL at zoom 0.6 and 1.5;
  - fit level choice.
- `web/src/i18n/messages.ts`, `web/src/api/case.test.ts` -- new and changed keys in ar/en/fr as listed; remove unused keys; update key tests.
- `web/src/app/[locale]/interview/share-preview.tsx` -- `onPresented?: (p: PresentedResult | null) => void`.
- `web/src/app/[locale]/interview/family-tree.tsx` -- toolbar, canvas group, cards, placeholders, pinned deceased, drag pan, zoom, roving tab stop.
- `web/src/app/[locale]/interview/family-tree.test.tsx` (new) -- with the jsdom helpers:
  - `role="group"` named by the heading, and no `role="img"`;
  - every card is a button, with exactly one `tabIndex=0`;
  - a click sets `aria-current`;
  - ArrowRight/ArrowLeft/Home/End move focus, reversed under `dir="rtl"`;
  - badge texts and the Arabic gender forms;
  - placeholders are not buttons;
  - zoom buttons call the announce callback with the formatted percent.
- `web/src/app/[locale]/interview/heir-list.tsx` -- deceased row, died-before rows, badges, `min-h-[52px]` rows, empty copy, zoom note in the existing region.
- `web/src/app/[locale]/interview/start-case.tsx` -- `presented` and zoom-note state; build the model once per render and pass it to the tree and the list.
- `web/e2e/interview.spec.ts` -- new tests on a mocked case with lineage (persons/edges/placement) and an `available` preview whose evidence blocks one heir:
  - computed card styles per state: border width and style, widths of 108 at 375px and 136 at 1280px, height of at least 76;
  - badge texts in en and ar;
  - canvas `touch-action`, background-image and padding;
  - in RTL, only the SVG has a transform;
  - the empty-estate placeholders and list text;
  - a 50-heir case at 375px and 1280px: pan by mouse drag to the far corners and press zoom in/out/Fit; after each step the deceased card's bounding box lies inside the canvas's;
  - the zoom status text appears in the polite region.

  Remove the `[data-tree-area]` exclusion from the 44px check.
- `web/e2e/accessibility.spec.ts` -- axe on the lineage fixture and on the empty estate, in ar and en.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- list every new or changed string per Locale for native review.

**Acceptance Criteria:**
- Given an existing guest Case, when the heirs screen renders, then the tree shows the deceased and every shown person as native buttons, in one `role="group"` named "Family tree", with one tab stop, and the existing add/edit/remove/later-death flows behave as before.
- Given any Interview state, when the Heirs list renders, then its first row is the deceased, labelled only by `treeDeceased` or the later-estate root text. Every card and row text comes from `treeDescription`.
- Given the web unit tests, lint, typecheck, build and the interview and accessibility e2e specs, when run, then they pass, with no new serious or critical axe violations.

## Spec Change Log

## Review Triage Log

### 2026-11-19 — Review pass (codex reviewers hit their usage limit; the five layers ran as Claude subagents, read-only)
- verdicts: 42 findings — high 0, medium 2, low 17, false 23, maybe-false 0
- findings:
  - `[false]` `[reject]` (intent-alignment) the diff implements Story 9.2 only, not all of Epic 9 — one story per iteration of the loop; 9.2 is the next backlog story after 9.1b.
  - `[low]` `[reject]` (intent-alignment) the Results page's `FamilyTree` call is changed but untested — confirmed: no test renders `Available`. The page's table states the same shares, and a test harness for `Available` is more than a direct correction; recorded as a residual risk.
  - `[false]` `[reject]` (intent-alignment) the backend's lineage fields are only exercised through client-built fixtures — 9.1b's `InterviewLineageTests` and snapshot tests cover the server shape; `parseCase` and `parsePresentedResult` validate every e2e fixture (`e2e/family.ts`).
  - `[false]` `[reject]` (intent-alignment) no pinch handler — the spec assigns pinch to the browser through `touch-action: pan-y pinch-zoom`, which the e2e asserts.
  - `[false]` `[reject]` (intent-alignment) the French `treeZoomStatus` equals the English one — "Zoom {percent}" is correct French; the test exemption names that single key and pins both values.
  - `[false]` `[reject]` (blind) placeholders vanish once a person exists — the AC asks for placeholders in an empty active estate only; 9.7 owns placeholders beside people.
  - `[false]` `[reject]` (blind) list rows without an heir record silently lose actions — only died-before persons have no heir row: 9.1b never makes a died-before person an estate member, and `estateModel` builds every other person from `layer.heirs`.
  - `[false]` `[reject]` (blind) "No heirs yet" beside a one-item list — the AC asks for both the deceased row and that sentence; the copy is the AC's own text.
  - `[low]` `[reject]` (blind) `lineageFixture` mutates contract fixtures in place and discards one parse result — test-only; a drifting fixture fails `parsePreview` loudly.
  - `[medium]` `[patch]` (blind) `scrollTopFor` and its test are dead code after the reveal change — confirmed: only the test imported it. Replaced by `scrollDelta` in `tree.ts`, used by `start-case.tsx` and unit-tested (see the verification-gap row).
  - `[false]` `[reject]` (blind) a11y gaps: group and section share a name; no Up/Down/Enter; chevron mirrored by class; hint mentions drag only — the spec names the group by the tree heading; Up/Down/Enter belong to 9.9/9.4; the chevron mirror is DESIGN's rule; the zoom buttons sit next to the hint.
  - `[low]` `[patch]` (blind) a drag can leave click suppression armed, and a mouse drag can keep panning — confirmed with the edge-case rows below; same patch. The per-move re-render in the same bullet is rejected as low: 50 cards render well inside the e2e drag test, and capacity timing is 9.12.
  - `[false]` `[reject]` (blind) layout: stale parent x for later children; NaN comparator; magic sizes — nodes are placed line by line top-down, so a parent is final before its children; the sort specification treats a NaN comparator result as 0, which keeps unlinked people stable; the sizes are DESIGN values.
  - `[false]` `[reject]` (blind) zoom: `indexOf` -1, Fit never zooms in, rAF not cancelled — the buttons disable at both ends and `fitZoom` returns only listed levels; the spec caps Fit at 1; the rAF callback checks its ref for null.
  - `[low]` `[reject]` (blind) i18n: "+" read aloud in placeholders, gendered English duplicates, French register — the copy is the spec's; all of it is in `deferred-work.md` for native review.
  - `[low]` `[patch]` (blind) the `onChooseSchool` doc comment now sits on `onPresented` — confirmed; each prop has its own comment again. The other coverage items in this bullet (French canvas e2e, axe on the 50-heir case) are rejected as low: the canvas has no locale branch beyond direction, which en/ar cover.
  - `[low]` `[reject]` (verification-gap) Results-page tree untested — same as the intent-alignment row.
  - `[medium]` `[patch]` (verification-gap) the reveal scroll has no test and the old test covers dead code — confirmed; extracted `scrollDelta(start, end, viewStart, viewEnd)` into `tree.ts` with seven cases (inside, below, above, partial both ways, larger than the view, offset view); `start-case.tsx` uses it on both axes.
  - `[false]` `[reject]` (verification-gap) the 44px audit now covers the tree — intended: cards and toolbar buttons must be at least 44px, and the audit passes.
  - `[low]` `[patch]` (verification-gap) misplaced doc comment — same as the blind row.
  - `[false]` `[reject]` (verification-gap) `indexOf` may yield NaN — unreachable, as the reviewer notes; the end buttons are disabled.
  - `[false]` `[reject]` (edge-case) self-parent or cyclic edges — `engine/contracts/family.py` refuses self-links and the server builds the Family before any response; no producer sends a cycle.
  - `[false]` `[reject]` (edge-case) a parent below its child — no code path creates such an edge; 9.1b's placement table only adds children below and parents above.
  - `[false]` `[reject]` (edge-case) `edges.find(...)!` may miss — `placeLine` pushes one edge per node it places, so every node has one.
  - `[low]` `[reject]` (edge-case) two parent edges for one child: the last wins — no current producer creates two; 9.7 adds one link per add.
  - `[false]` `[reject]` (edge-case) 136px cards overflow a 264px layout — 136px cards apply from a 640px viewport, where the canvas is at least about 580px wide.
  - `[false]` `[reject]` (edge-case) placeholders overflow — same width argument.
  - `[false]` `[reject]` (edge-case) a real heir row with died-before status loses its actions — a died-before person is never an estate member (9.1b), so no heir row has that status.
  - `[low]` `[patch]` (edge-case) a mouse released outside before the threshold keeps panning — confirmed; `onPointerMove` now drops a mouse drag with no button held.
  - `[low]` `[patch]` (edge-case) suppression survives a drag without a click — confirmed for a cancelled touch drag; `onPointerCancel` now clears it.
  - `[low]` `[patch]` (edge-case) Alt/Ctrl/Meta+Arrow is cancelled — confirmed; modified arrows now return early, plus a test.
  - `[low]` `[reject]` (edge-case) focus calls `scrollIntoView`, which can scroll the page — focusing an element already scrolls the page to it, so the extra call adds no new movement.
  - `[low]` `[patch]` (edge-case) the deceased reports `aria-current` before any press — confirmed; nothing is current until a card is pressed or edited, plus a test. Two current cards (pressed plus edited) is what the spec asks for.
  - `[low]` `[reject]` (edge-case) an identical zoom note is not re-announced — only when Fit lands on the current level; re-keying the region is more than a direct correction.
  - `[low]` `[reject]` (edge-case) zoom does not keep the viewport centre — a UX refinement; 9.11 verifies zoom interactions.
  - `[low]` `[reject]` (edge-case) zoom is silent on the Results page — that page has no live region to share; adding one is more than a direct correction, and the Interview's status region works.
  - `[false]` `[reject]` (edge-case) died-later hides blocked — the spec defines one state per card with died-later before blocked; the person's own estate opens from the card.
  - `[false]` `[reject]` (edge-case) placeholders for blocked-only links — the epic keeps blocked-but-valid relatives addable.
  - `[false]` `[reject]` (edge-case) stale evidence paired with a new key — when the key changes `shown()` yields null, and the parent compares `presented.key` with the current key before using it.
  - `[false]` `[reject]` (edge-case, claim) existing flows lose actions for died-before heirs — same refutation as the heir-row finding.
  - `[false]` `[reject]` (edge-case, claim) two transformed layers in RTL — the zoom wrapper scales uniformly and mirrors nothing; the e2e checks that no card has a `scale`.
  - `[low]` `[reject]` (edge-case, claim) `treeDescription` runs twice — both calls receive the same model and root text; a shared prop is more than a direct correction.

## Design Notes

Why the deceased is pinned: with 50 heirs at 375px, the tree is far taller than the canvas. Clamping the scroll would make cards unreachable, so the deceased card itself follows the viewport, like `position: sticky`, while connectors keep their layout positions. Here `p` is padding, `s` is scroll, `v` is the viewport size and `z` is zoom; all numbers are in unscaled content units:

```
inline = rtl ? -scrollLeft : scrollLeft
x = clamp(box.x, (inline + p)/z, (inline + v.width - p)/z - box.width)
y = clamp(box.y, (scrollTop + p)/z, (scrollTop + v.height - p)/z - box.height)
```

The layout width is the canvas content width at zoom 1, so zoom 1 never scrolls horizontally, and zooming in creates horizontal pan room.

Card press is select-only. The AC says actions are connected in later stories, and 9.4 owns the edit sheet for card presses.

Spouse connectors: the only `spouse_of` edges the engine allows run from the root (see the 9.1b placement table), so spouses stay on the spine.

## Verification

**Commands:**
- `cd web && npm test` -- expected: all node tests pass.
- `cd web && npm run lint && npm run typecheck` -- expected: no errors; lint warnings no more than 12.
- `cd web && npm run build && npx playwright test e2e/interview.spec.ts e2e/accessibility.spec.ts` -- expected: all pass.

## Auto Run Result

Status: done

**Summary:** The Interview tree is a lineage-aware canvas of native card buttons.

- **What it shows.** It draws the active estate from 9.1b's `persons` and `edges`:
  - A linked child hangs under its parent. Unlinked people stay on the spine.
  - Each card shows one state: normal, died-before (dashed), died-later (accent, with a chevron) or blocked (striped, "No share in this case"). Blocking comes only from the current `available` preview's evidence for that estate.
  - The deceased is labelled only "The deceased".
- **Group and keys.** One `role="group"` named by the tree heading holds every card, with a roving tab stop. Inline arrows (mirrored in RTL), Home and End move between cards. Pressing a card selects it; edit and add actions come in later stories.
- **Canvas.** The canvas is a dotted surface with `touch-action: pan-y pinch-zoom`. It has drag pan, a toolbar (Fit tree, zoom in and zoom out) and a deceased card pinned inside the viewport. Zoom levels run from 0.6 to 1.5, and each change is announced through the existing polite region.
- **Empty estate.** It shows the parent and spouse placeholders that `placement` allows.
- **Heirs list.** It is now the canonical outline. The first row is the deceased, then died-before rows (no actions), then badges, all from one `treeDescription`.

**Files changed** (under `web/`):
- `src/interview/tree.ts`: `estateModel`, lineage-aware `layoutTree`, structured `treeDescription`, `placeholders`, `pinBox`, `fitZoom`, `ZOOM_LEVELS`, `scrollDelta`.
- `src/app/[locale]/interview/family-tree.tsx`: the toolbar, canvas group, cards, placeholders, pinned deceased, drag pan and roving tab stop.
- `src/app/[locale]/interview/heir-list.tsx`: the deceased row, died-before rows, badges, 52px rows and the zoom note.
- `src/app/[locale]/interview/share-preview.tsx`: the `onPresented` callback.
- `src/app/[locale]/interview/start-case.tsx`: builds the model once from the reported PresentedResult; holds the zoom note; the reveal scroll now moves only the canvas, on both axes.
- `src/app/[locale]/results/results-view.tsx`: the new `FamilyTree` props.
- `src/i18n/messages.ts`: new tree copy in ar, en and fr; the gendered deceased, prompt and summary keys are removed; new `heirsEmpty` text.
- Tests: `src/interview/tree.test.ts`, `src/app/[locale]/interview/family-tree.test.tsx` (new), `src/api/case.test.ts`, `e2e/interview.spec.ts`, `e2e/accessibility.spec.ts`, `e2e/family.ts`.
- `_bmad-output/implementation-artifacts/deferred-work.md`: every new or changed string, for native review.

**Fixes after implementation and before review:**
- The dotted grid used an undefined `--line` variable; it is now `--color-line`.
- `bg-background` is not a theme colour; it is now `bg-[var(--background)]`.
- The reveal effect's `node.scrollIntoView` scrolled the whole page; the canvas alone now scrolls.
- Corrected e2e assertions:
  - Chromium snaps 1.5px borders at device scale 1, so the declared border is checked.
  - Tailwind's mirror sets `scale`, not `transform`.
  - A shell test measured two tops while the page was still smooth-scrolling; both are now read in one frame.
- Added matrix assertions: the legacy list rows, the died-before row with no actions, and an empty estate with no preview shares.

**Review:** one pass. The codex reviewers hit their usage limit, so the five layers ran as Claude subagents. They raised 42 findings.
- **Patched:**
  - medium: `scrollTopFor` was dead, and the reveal scroll was untested. It is now `scrollDelta`, with seven unit cases.
  - low: a mouse drag released outside the canvas kept panning, and a cancelled touch drag kept the click suppression armed.
  - low: Alt/Ctrl/Meta+Arrow is no longer cancelled.
  - low: the deceased no longer reports `aria-current` before any press.
  - low: the misplaced doc comment.
- **Deferred:** none.
- **Rejected:** 23 false and 12 low. The reasons are in the Review Triage Log. The main ones:
  - the scope is one story per iteration;
  - actions, Up/Down keys and placeholders beside people are later stories;
  - several edge cases are unreachable because the contract and server forbid them;
  - the Results-page tree test and the Results-page zoom announcement each need new harness or region work.

**Follow-up review recommended:** true. This first pass patched two medium entries (2 medium, 6 low, 0 high). The unverified risk is the pointer handling: drag pan, click suppression and pointer capture are tested with a mouse in Chromium only, and touch behaviour (horizontal swipe, pointercancel when the browser takes over a vertical scroll) has no automated check.

**Verification** (run by the parent after the last patch):
- `npm test`: 522 of 522 pass, including `tree.test.ts` and `family-tree.test.tsx`.
- `npm run lint`: 0 errors and 12 warnings, unchanged.
- `npm run typecheck`: clean.
- `npm run build`: OK.
- `npx playwright test e2e/interview.spec.ts e2e/accessibility.spec.ts`: 62 of 62 pass in Chromium, including axe on the lineage and empty canvases in ar and en.

Matrix audit: every row has a covering test that ran.
- Legacy: `legacy cards retain normal styles` plus the layout tests.
- Lineage: `lineage includes died-before people…` and the canvas e2e row checks.
- Blocked: `blocked state uses only supplied evidence…` and the e2e.
- Died later: `family-tree.test.tsx` and the e2e.
- Later estate: `later estate resolves person aliases…`.
- Empty estate: `empty placement creates only permitted…` and `empty estate placeholders`.
- 50 heirs: `50 heirs stay reachable…` at 375px and 1280px.
- RTL: the e2e `scale` check and the mirrored arrow keys.

**Residual risks:**
- No test renders the Results page's tree. That page also has no live region, so zoom changes there are silent.
- Touch pan and pinch are untested; the e2e drives a mouse in Chromium only.
- The pinned deceased card moves off its connector while pinned. This is by design (Design Notes).
- Two cards can be `aria-current` at once (pressed and edited), as the spec asks. 9.4 and 9.9 may want to revisit this.
- All new copy awaits native review (`deferred-work.md`).
- Wider suites were not run; the driver runs them once per batch.
