# Epic 9 Context: Build a family fast on an editable Family tree

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Let families enter relatives in a few actions, see their lineage and estate status, and correct mistakes directly in the Interview. One-press and group adds, editing at a person, and multi-step Undo keep the Family tree, Heirs list and Share preview in sync. A wide family stays readable by generation and editable on phone and desktop with touch, mouse, keyboard or a screen reader.

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
- Story 9.14: Keep each generation on one row and let the tree grow sideways

## Requirements & Constraints

- Add one relative or a group from relationship buttons with optional names and numbered labels in the current Locale. Offer eligible relationships for the current estate and position. Touch and keyboard users can reproduce every valid drop through Add relative here.
- Edit names, relationships and death status in place. Confirm removals that affect descendants or later estates and show exactly who will be removed. Show one estate at a time, with breadcrumb navigation and editing scoped to the open estate. An eligible later-estate Heir can be linked to or unlinked from an existing person through the edit surface.
- Support 50 Heirs and two later deaths per Case. Reject invalid changes and over-limit batches atomically. Undo restores the exact previous family, one accepted change at a time for the current visit.
- Keep every generation on one horizontal row at every width. The canvas expands sideways beyond its viewport. Keep the deceased visible during free pan and zoom and verify reachability with 50 Heirs at 375px and 1280px.
- Release gates include WCAG 2.1 AA, 44px targets, unclipped keyboard focus, and reflow at 320px and 400% zoom. Verify both reading directions, reduced motion, light and dark contrast, axe and the Arabic screen-reader path. With both deployment slots running, the 50-Heir Share preview must update in under 1 s at p95 end to end on a mid-range phone over 4G, including lock waits and rendering. The standard-family engine budget is under 200 ms.

## Technical Decisions

- The server owns the Case. The engine supplies placement eligibility, refusal reasons and cascade impact for the applicable rule set. The Case command service enforces capacity, checks the expected revision, applies each accepted change atomically and returns the complete Case at a new revision. Conflicts return the current Case. Offline edits and Undo are disabled while the last accepted family stays visible.
- Use stable person IDs with aliases resolved, explicit death status and parent/spouse edges. A person without a recorded parent connects to the deceased on their generation line. Snapshot schema 2 preserves lineage and predeceased status across session, saved and shared Case readers. Legacy Cases keep their existing meaning, and new lineage/status writes require schema 2 support across active and rollback-eligible releases.
- Keep the tree, outline and presented shares on the accepted revision. Discard stale preview results. Use the shared presentation contract, term catalog and Locale registry. Store prior accepted snapshots in a page-local Undo stack and restore through the command service against the current revision, preserving IDs. A bulk add or cascade is one history entry.
- Size the canvas from the greater of the viewport width and the widest padded generation row. Centre the deceased's spine, preserve recorded parent alignment where space permits, and compensate for spine shifts so edits do not move the deceased on screen. Layout coordinates support drop targets and keyboard navigation as well as painting the cards.

## UX & Interaction Patterns

- Stack Add relatives, Family tree and Heirs list below 1024px. At 1024px and above, put entry and list in one column and the flexible tree in the other. Edit in a modal bottom sheet on phone and a non-modal side panel on desktop.
- Use a labelled two-dimensional scroll region inside the reflowing page. Drag or swipe to pan while allowing vertical page swipes. Pinch and plus/minus zoom. Centre the deceased horizontally on entry and with Fit tree, which has a 0.6 zoom floor. Scroll a focused card into view with its ring visible.
- Make the canvas a labelled group of native buttons with one roving tab stop. Tab exits, Up/Down follow parent and first child, and logical Start/End arrows move between siblings. Home goes to the deceased and End to the last card. Mirror connectors and directional controls in RTL, using logical card placement. Keep card text upright and bidi-isolate names. The Heirs list is the canonical screen-reader outline and shares the cards’ visible relationship and status descriptions.
- Use text alongside styling to distinguish the deceased, died-before, died-later and no-share states. Restore focus after closing or Undo, move to an adjacent card or the deceased after removal, and focus the canvas heading on estate navigation. Disable animated transitions and smooth scrolling in reduced motion.
- Keep Undo in the Interview and Heirs list headers while history remains, with Ctrl/Cmd+Z and a toast lasting at least 10 seconds that pauses on hover or focus. Use one polite status region for accepted changes and localized alerts for refusals. Mark the previous preview pending during recalculation.

## Cross-Story Dependencies

- Epic 8 provides Case and Family contracts, engine queries, revision-aware commands, snapshot compatibility, presentation, localization and the capacity harness. Adds, edits, drops, linking and Undo share these foundations.
- The capacity journey exercises the final add/link controls and the every-width summary bar and sheet delivered by Epic 11. Epic 10 owns Saved case naming. The one-row layout must preserve the positioned-drop, keyboard, responsive/RTL and 50-Heir journey checks.
