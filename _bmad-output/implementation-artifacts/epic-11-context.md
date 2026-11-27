# Epic 11 Context: Clearer results

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give families room to enter and edit relatives in the Interview, with shares one tap away from a summary bar and sheet. Make it clear when a School choice changes the result, what belongs in the estate to divide, which facts the family supplied, and how displayed amounts reconcile. Keep Full results easy to reach so families can inspect proof, download a draft PDF, save a Case or share it.

## Stories

- Story 11.1: Show School agreement and ask for a School only when shares differ
- Story 11.2: Give the Interview's space to family entry and build one readable Share preview body
- Story 11.3: Open the full preview from a sticky summary bar and modal sheet
- Story 11.4: Keep summary controls reachable at narrow widths and high zoom
- Story 11.5: Preserve the results table and make result actions clear
- Story 11.6: Explain the estate input and identify user-supplied facts
- Story 11.7: Make rounding adjustments visible and reconcile displayed totals

## Requirements & Constraints

- Start by comparing all four Sunni Schools. State all-four agreement when each person's share and status agree. When shares differ, show the differences side by side until the user chooses a School, then name that School. Keep refusals explicit and render shares only for available outcomes. Family entry starts directly. Country selection and Country-specific notices are deferred.
- Make Full results a primary action in the bar and sheet, visible from the bar without scrolling at 375px once shares exist. The Interview has no Share preview pane at any width.
- Associate visible guidance with the estate field before entry. Explain that debts, funeral costs and bequests come out first and that jointly owned or beneficiary-designated assets may fall outside the estate. Full results and the regenerated draft PDF identify the family and any amount as user-supplied and unverified. When the amount is absent, identify the supplied family and keep the exact shares without monetary allocations. Keep the calculation-aid disclaimer visible and non-dismissible, and explain any supplied Beta state.
- Show every nonzero signed rounding adjustment separately from Heir and legal unallocated or treasury shares in the sheet, Full results and PDF. Omit the rounding row at zero. Displayed minor-unit amounts reconcile exactly to the estate, with exact fractions preserved. Check positive, negative and zero adjustments across 0-, 2- and 3-decimal currencies.
- Meet WCAG 2.1 AA across published Locales, including ar/en/fr keyboard, RTL, light/dark, reduced motion, 320px reflow, 400% zoom and text-spacing checks. Use 44px minimum targets, 4.5:1 text contrast and 3:1 essential boundary/focus contrast. Cover the updated layout and sheet interactions in Playwright and axe. Keep preview p95 under one second end to end for up to 50 Heirs on a mid-range phone over 4G, including School comparison.

## Technical Decisions

- Share preview, Full results and the server-generated draft PDF render the versioned `PresentedResult`. Server presentation owns per-person share/status comparison, labels, notices, half-up allocation rounding to currency minor units and Babel formatting. Compare all four Schools even on a single-School Basis while preserving the selected School's shares. Preserve language and direction metadata and bidi isolation, with LTR fractions.
- The server owns Case inputs. Keep the single preview fetcher, revision reconciliation, tree evidence and shared polite status region mounted outside the dialog. Reconcile tree, Heirs list and shares to the accepted estate and revision, discard obsolete responses and coalesce announcements. Mark pending values without announcing completion. On failure or conflict, preserve the accepted family and use existing recovery and Retry.
- A never-saved Case needs an explicit first Save. For an opened Saved case, accepted edits are written back by a separate, update-only autosave that checks the Saved case's base revision. Reuse the shared save status and conflict recovery. Report the latest edits as saved only when the save covers their Case revision. Shared links follow accepted explicit saves and autosaves.

## UX & Interaction Patterns

- Below 1024px, stack Add relatives, the Family tree and the Heirs list with 16px gutters. At 1024px and up, use a 380px Add relatives and Heirs column beside the flexible tree and side editor in the 1360px shell. Keep each generation on one row and contain sideways overflow within the labelled tree canvas.
- The full-width fixed bottom bar shows Heir count, readiness, Full results and a separate expand control. Hide it before shares exist and while a later-death estate is open. Below 360px, wrap status above the controls. In phone landscape under 480px high, an in-flow Share preview button opens the same sheet. Preserve the accepted result and open sheet across viewport changes and keep focus on the available opener when it changes.
- Cap the native modal dialog at 78% of viewport height and scroll its body internally. Focus the heading on open, make the background and bar inert, and restore focus to the opener on Close, Escape or scrim dismissal. Avoid stacked dialogs and disable slides and fades for reduced motion. Measure bar and Undo toast obstruction together and apply matching block-end scroll padding. Move the toast into the page flow if the two would cover more than 25% of viewport height.
- Keep preview values aligned to the logical end and identify blocked shares in text as well as by styling. Preserve the Full results table caption, proof controls and single- and later-estate semantics. Give the table its own labelled horizontal scroll region on phones. Make Download PDF primary and Save, Share link and WhatsApp secondary. Reuse sign-in and action feedback, resuming the requested action for the same Case after successful sign-in.

## Cross-Story Dependencies

- Epic 8 supplies comparison, presentation, rounding and revision-aware commands. Epic 9 supplies the Interview shell, later-estate visibility, tree-canvas scrolling, shared announcements and obstruction handling.
- The pane-free preview body and modal are the base for summary reflow. The 50-Heir capacity journey exercises the two-column Interview with the summary bar at 1280px. Rounding verification spans the sheet, Full results and draft PDF.
- Epic 10 owns Saved case naming, persistence, live shared links and save recovery. Full results remains the explicit Save destination from the Interview's unsaved-changes notice and shares the save status used by autosave.
