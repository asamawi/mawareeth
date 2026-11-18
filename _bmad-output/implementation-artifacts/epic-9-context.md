# Epic 9 Context: Build a family fast on an editable Family tree

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make the Interview a fast, editable family workspace where users add relatives without typing names, correct the family on its tree, navigate linked estates and undo mistakes. Tree, Heirs outline and Share preview must represent the same accepted family across phone, desktop, keyboard and screen-reader use.

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
- Story 9.12: Prove the complete family-entry journey meets capacity and speed gates

## Requirements & Constraints

- Support immediate/bulk adds, localized numbered defaults, optional names, positioned relatives, relationship/death-status edits, confirmed cascade removal and multi-step Undo. Impossible relationships are unavailable; blocked-but-valid relatives remain addable.
- Limit each Case to 50 Heirs and two later deaths. Keep the deceased visible during pan/zoom at 375px and 1280px; every person/action remains reachable with targets at least 44px.
- Meet WCAG 2.1 AA across published Locales, RTL, 320px reflow, 400% zoom and text-spacing overrides. Release requires keyboard, axe, contrast, root-visibility and Arabic NVDA/Chrome, VoiceOver/Safari iOS and TalkBack evidence.
- Preview p95 stays under one second end to end on a mid-range phone over 4G with up to 50 Heirs; standard-family engine time stays under 200ms. Measure command/network/lock waits and rendering with both deployment slots, School/comparison and supported later-death workloads. Record no names or family payloads.

## Technical Decisions

- The Case response (read and every command) must carry each person once with a stable id (earliest row id, `same_as` aliases resolved), status (alive, died before/with, died later with order), `parent_of`/`spouse_of` edges, and engine-computed allowed relationships per person and for the deceased (including parent/spouse slots). `family_from_session()` builds the Family from these. Existing Cases without edges or died-before statuses read unchanged (no migration; shares/proofs/previews byte-identical). The v2 snapshot writer stores edges/died-before losslessly across session, saved, share, invite and received views; the v1 writer keeps refusing them as `unsupported_content`. `web/src/api/case.ts` treats the new fields as absent when missing. Relatives with no recorded parent hang from the deceased on their generation line; links are created only by positioned add (9.7) or edit (9.4), never guessed.
- The server owns Case inputs. Every mutation uses one atomic command service with `expected_revision`; success advances the revision and returns the whole Case. Conflicts return the current Case without silent overwrite. Reject invalid batches/cascades without partial mutation. Offline edits and Undo are disabled; retain family/last preview without an edit queue.
- Engine queries alone determine allowed relationships/positions, edit validity, deletion impact and refusal reasons. The command service enforces capacity. Do not duplicate fiqh or cascade tables in the browser.
- Render stable person ids and lineage edges, with alive, died-before/with and ordered died-later statuses. Show one active estate at a time. Tree and canonical Heirs outline share `treeDescription`; preview renders server `PresentedResult` without browser share arithmetic/number formatting. Discard older-revision previews.
- Undo retains prior accepted Case snapshots for the page visit only. Each atomic change contributes one entry; restore preserves ids while advancing revision. Failed restores retain history. Names commit on blur/Enter as one change. Reload clears history.
- Shared catalogs own terms/refusals; general UI copy retains its existing owner. Locale registry supplies language/direction. Isolate names with `bdi dir=auto`, Arabic terms with Arabic/RTL metadata, fractions with LTR direction and English fallbacks with English language metadata.

## UX & Interaction Patterns

- Below 1024px, order Add relatives, tree, Heirs list with 16px gutters. At 1024–1279px use a 380px relatives/list column beside a tree at least 596px wide. At 1280px reserve a 340px preview slot within a maximum 1360px shell. Cards are 108px below 640px, otherwise 136px, and at least 76px tall.
- Preserve existing identity, system fonts and system dark mode. Use graphic for essential boundaries, line for decoration, accent-soft for badges, blocked-stripe decoratively and toast-focus on inverted surfaces. Text contrast is at least 4.5:1; graphics/focus 3:1. Focus uses a 2px outline with 2px offset. Node/sheet/badge radii are 10px/18px/full. Derived dark colours remain assumptions; Urdu font and proposed 1.7 line height remain open.
- Cards express died-before through dashed borders, died-later through solid accent and blocked through stripes plus readable text plates. Label the root only as the deceased; omit avatars/death symbols. Canvas uses an 18px dotted grid, 2px connectors and at least 6px padding. Mirror connectors and logical layout in RTL, never text. Fit tree, pan and zoom preserve root visibility and page scrolling.
- Count starts at one; stepper sets quantity and Add submits atomically. Add relative here and allowed placeholders provide touch/keyboard equivalents to pointer drops. Editing uses a phone modal dialog or desktop non-modal panel. Confirm exact engine-supplied cascade impact. Close restores opener focus; removal selects next sibling, previous sibling, then deceased; Undo focuses the restored card.
- Later-death cards open their estate; row Edit retains access to the person. Breadcrumb above the canvas returns to earlier estates and focuses the tree heading. The single preview follows the active estate while preserving the original share.
- Native card buttons form one labelled group with roving tabindex and visible-text names; selection uses `aria-current`. Tab leaves freely. Up/Down reach parent/first child; inline arrows reach siblings, mirrored in RTL; Home/End reach deceased/last card. Enter edits/opens an estate, Delete confirms, Escape closes, +/- zoom. Preserve text-input keystrokes.
- Persistent Undo controls and Ctrl/Cmd+Z supplement a toast lasting at least ten seconds, paused on hover/focus. One polite atomic status region coalesces change/preview messages around 800ms without delaying calculation. Refusals use alerts. Pending shares stay muted and busy; slow status appears after three seconds. Reduced motion disables movement, slides, fades, shimmer, animated zoom and smooth scrolling. Scroll padding accounts for toast/summary obstruction, jointly capped at 25% of viewport height.

## Cross-Story Dependencies

Story 9.1b is backend-only (no new command, no UI) and must land before 9.2; 9.2, 9.3, 9.4 and 9.7 consume its persons/edges/statuses and placement options (9.4 sets died-before through the command service, persisted only under the schema 2 writer; 9.7 creates links). Epic 8 supplies contracts, lineage queries, catalog/registry, revision commands, successive-death composition, presentation and the capacity harness. Establish shell/tokens and lineage rendering before mutation surfaces; integrate shared history, focus and announcements before final accessibility/responsive/capacity verification. Epic 10 owns saved-case naming; Epic 11 owns sticky summary/sheet and results redesign, consuming this epic's preview slot and obstruction contract. New relationship classes and Country rules belong to later scope.
