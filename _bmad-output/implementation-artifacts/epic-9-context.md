# Epic 9 Context: Build a family fast on an editable Family tree

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make the Interview a fast, editable family workspace where users add relatives without typing names, correct the family on its tree, navigate linked estates and undo mistakes. Tree, Heirs outline and Share preview must represent the same accepted family across phone, desktop, keyboard and screen-reader use. The Interview has no preview pane at any width; the sticky summary bar and sheet (Epic 11) carry the Share preview.

## Stories

- Story 9.1: Establish the Interview shell and accessible tree tokens
- Story 9.1b: Carry lineage and status in the Interview Case
- Story 9.2: Render the family as lineage cards on a navigable canvas
- Story 9.3: Add one relative with one press
- Story 9.4: Edit and remove relatives from the tree
- Story 9.5: Add a group of relatives with a count stepper
- Story 9.6: Undo family changes throughout the page visit
- Story 9.7: Add relatives at a chosen node by touch, keyboard or drag
- Story 9.8: Open and edit later-death estates with a breadcrumb
- Story 9.9: Complete keyboard navigation and the screen-reader outline
- Story 9.10: Coordinate Interview announcements and updating states
- Story 9.11: Verify responsive, RTL and reduced-motion tree interactions
- Story 9.13: Link a later-estate heir to someone already in the Case from the edit sheet, and retire the old add form
- Story 9.12: Prove the complete family-entry journey meets capacity and speed gates

## Requirements & Constraints

- Support immediate/bulk adds, localized numbered defaults, optional names, positioned relatives, relationship/death-status edits, confirmed cascade removal and multi-step Undo. Impossible relationships are unavailable; blocked-but-valid relatives remain addable.
- Limit each Case to 50 Heirs and two later deaths. Keep the deceased visible during pan/zoom at 375px and 1280px; every person/action remains reachable with targets at least 44px.
- Meet WCAG 2.1 AA across published Locales, RTL, 320px reflow, 400% zoom and text-spacing overrides. Release requires keyboard, axe, contrast, root-visibility and Arabic NVDA/Chrome, VoiceOver/Safari iOS and TalkBack evidence.
- Preview p95 stays under one second end to end on a mid-range phone over 4G with up to 50 Heirs; standard-family engine time stays under 200ms. Measure command/network/lock waits and rendering with both deployment slots, School/comparison and supported later-death workloads. Record no names or family payloads.
- A person in a later estate can be marked "same person as" someone already in the Case, so successive-death estates do not count them twice.

## Technical Decisions

- The Case response (read and every command) carries each person once with a stable id (`same_as` aliases resolved), status (alive, died before/with, died later with order), `parent_of`/`spouse_of` edges, and engine-computed allowed relationships per person and for the deceased. Existing Cases without edges or died-before statuses read unchanged (no migration). The v2 snapshot writer stores edges/died-before losslessly; the v1 writer keeps refusing them. Relatives with no recorded parent hang from the deceased; links are created only by positioned add or edit, never guessed.
- The server owns Case inputs. Every mutation uses one atomic command service with `expected_revision`; success advances the revision and returns the whole Case. Conflicts return the current Case without silent overwrite. Reject invalid batches/cascades without partial mutation. Offline edits and Undo are disabled.
- Engine queries alone determine allowed relationships/positions, edit validity, link candidates, deletion impact and refusal reasons; the command service enforces capacity. Do not duplicate fiqh, kinship or cascade logic in the browser.
- `update_heir` accepts `same_as` for later-estate rows only, with the same validation as add (`not_alive`, `already_linked`, `gender_mismatch`), set or clear atomically; no snapshot change.
- Render stable person ids and lineage edges; one active estate at a time. Tree and Heirs outline share `treeDescription`; preview renders server `PresentedResult` without browser share arithmetic. Discard older-revision previews.
- Undo retains prior accepted Case snapshots for the page visit only; each atomic change is one entry; restore preserves ids while advancing revision. Names commit on blur/Enter as one change.
- Shared catalogs own terms/refusals; isolate names with `bdi dir=auto`, Arabic terms with Arabic/RTL metadata, fractions LTR, English fallbacks with English language metadata. Handwritten React components and shared `ui.ts` styles are reused; no new web font.

## UX & Interaction Patterns

- Add relatives contains only the one-press relationship button groups and count stepper (the old "Add an heir" form is retired). Below 1024px the order is Add relatives, tree, Heirs list with 16px gutters; from 1024px there are two columns: a 380px relatives/Heirs list column beside a flexible tree (1360px maximum shell). No preview column or in-flow preview at any width. At 1280px and up the editor uses the side-panel placement.
- Cards are 108px below 640px, otherwise 136px, at least 76px tall. Died-before is a dashed border, died-later solid accent, blocked stripes plus a readable text plate. Root is labelled only as the deceased. Canvas uses an 18px dotted grid and 2px connectors; mirror connectors and layout in RTL, never text. Fit tree, pan and zoom preserve root visibility.
- Count starts at one; Add submits atomically. "Add relative here" and placeholders give touch/keyboard equivalents to drag. Editing uses a phone modal sheet or desktop non-modal panel; a later-estate person with server link candidates shows a "Same person as…" native select after the relationship field. Confirm exact engine-supplied cascade impact. Close restores opener focus; removal selects next sibling, previous sibling, then deceased; Undo focuses the restored card.
- Later-death cards open their estate; a breadcrumb above the canvas returns to earlier estates. The preview is hidden while a later-death estate is open.
- Card buttons form one labelled group with roving tabindex; selection uses `aria-current`. Arrows move by lineage (inline arrows mirrored in RTL), Home/End reach deceased/last card, Enter edits/opens, Delete confirms, Escape closes, +/- zoom. Preserve text-input keystrokes.
- Focus ring is a 2px outline with 2px offset, never a box-shadow; text contrast 4.5:1, essential boundaries 3:1. Graphic/accent-soft/blocked-stripe/scrim/toast-focus tokens have light/dark values; derived dark colours remain assumptions.
- Undo controls and Ctrl/Cmd+Z supplement a toast of at least ten seconds, paused on hover/focus. One polite status region coalesces messages around 800ms; refusals use alerts. Pending shares stay muted and busy. Reduced motion disables movement, slides, fades, shimmer and smooth scrolling. Scroll padding accounts for toast and summary-bar obstruction, jointly capped at 25% of viewport height.

## Cross-Story Dependencies

- 9.1b is backend-only and lands before 9.2; 9.2, 9.3, 9.4 and 9.7 consume its persons/edges/statuses and placement options. Establish shell/tokens and lineage rendering before mutation surfaces; integrate history, focus and announcements before final accessibility/responsive/capacity verification.
- 9.13 extends 9.4's edit sheet and retires the old form; it runs before 9.12.
- Sprint change 2026-11-22: Epic 11 stories 11.2 (remove the desktop preview column, build one shared preview body) and 11.3 (sticky summary bar and sheet at every width) are pulled ahead of 9.12, so its 1280px 50-Heir check runs on the two-column layout with the bar visible. The preview fetcher and single live region stay mounted while the sheet is closed.
- Epic 8 supplies contracts, lineage queries, catalog/registry, revision commands, successive-death composition, presentation and the capacity harness. Epic 10 owns saved-case naming; Epic 11 owns results redesign. New relationship classes and Country rules belong to later scope.
