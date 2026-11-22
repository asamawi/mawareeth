# Epic 11 Context: Clearer results

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give family entry the full Interview workspace and keep shares within reach from the summary bar and sheet at every width. Help users understand when their choice of School affects the result, what belongs in the estate to divide, and how displayed amounts reconcile. Keep Full results easy to reach and make proof, draft PDF, save and sharing actions easy to find.

## Stories

- Story 11.1: Show School agreement and ask for a School only when shares differ
- Story 11.2: Give the Interview's space to family entry and build one readable Share preview body
- Story 11.3: Open the full preview from a sticky summary bar and modal sheet
- Story 11.4: Keep summary controls reachable at narrow widths and high zoom
- Story 11.5: Preserve the results table and make result actions clear
- Story 11.6: Explain the estate input and identify user-supplied facts
- Story 11.7: Make rounding adjustments visible and reconcile displayed totals

## Requirements & Constraints

- Start with all four Sunni Schools compared. State agreement when all four agree. When shares differ, show the differences side by side until a School is chosen, then name the selected School. Keep partial refusals explicit and omit shares for refused outcomes. Family entry has no Basis step. Country selection, activation and notices are later scope.
- Make Full results a primary action in the bar and sheet, visible from the bar without scrolling at 375px once shares exist. The Interview has no Share preview pane at any width.
- Explain before amount entry that debts, funeral costs and bequests come out first and that jointly owned or beneficiary-designated assets may fall outside the estate. Full results and the regenerated draft PDF identify the user-supplied, unverified family and any supplied amount. If the amount is absent, retain exact shares and omit monetary allocations. Keep the calculation-aid disclaimer visible and non-dismissible, and pair any supplied Beta state with its explanation.
- Show every nonzero signed rounding adjustment separately from Heir and legal unallocated or treasury shares in the sheet, Full results and PDF. Omit the rounding row at zero. Displayed minor-unit amounts reconcile exactly to the estate, with exact fractions preserved. Check positive, negative and zero adjustments across 0-, 2- and 3-decimal currencies.
- Meet WCAG 2.1 AA across published Locales, including ar/en/fr keyboard, RTL, light/dark, reduced motion, 320px reflow, 400% zoom and text-spacing checks. Use 44px minimum targets, 4.5:1 text contrast and 3:1 essential boundary/focus contrast. Cover the updated layout and sheet interactions in Playwright and axe. Keep preview p95 under one second end to end for up to 50 Heirs on a mid-range phone over 4G, including School comparison.

## Technical Decisions

- Share preview, Full results and the server-generated draft PDF render the versioned `PresentedResult`. Server presentation owns per-person share/status comparison, labels, notices, half-up allocation rounding to currency minor units and Babel formatting. Compare all four Schools even on a single-School Basis while preserving the selected School's shares. Preserve language and direction metadata and bidi isolation, with LTR fractions.
- The server owns Case inputs. Keep the single preview fetcher, revision reconciliation, tree evidence and shared polite status region mounted outside the dialog. Reconcile tree, Heirs list and shares to the accepted estate and revision, discard obsolete responses and coalesce announcements. Mark pending values without announcing completion. On failure or conflict, preserve the accepted family and use existing recovery and Retry.

## UX & Interaction Patterns

- Below 1024px, retain 16px gutters and stack Add relatives, the Family tree and the Heirs list. From 1024px up, use a 380px Add relatives/Heirs column and a flexible tree with a side edit panel inside the 1360px maximum shell. Check the pane-free layout at 375px, 1100px and 1366px in LTR and RTL.
- The full-width fixed bottom bar shows Heir count, readiness, Full results and a separate expand control. Hide it before shares exist and while a later-death estate is open. Below 360px, wrap status above the controls. In phone landscape under 480px high, an in-flow Share preview button opens the same sheet. Preserve the accepted result and open sheet across viewport changes and keep focus on the available opener when it changes.
- Cap the native modal dialog at 78% of viewport height and scroll its body internally. Focus the heading on open, make the background and bar inert, and restore focus to the opener on Close, Escape or scrim dismissal. Avoid stacked dialogs and disable slides and fades for reduced motion. Measure bar and Undo toast obstruction together and apply matching block-end scroll padding. Move the toast into the page flow if the two would cover more than 25% of viewport height.
- Keep preview values aligned to the logical end and identify blocked shares in text as well as by styling. Preserve the Full results table caption, proof controls and single- and later-estate semantics. Give the table its own labelled horizontal scroll region on phones. Make Download PDF primary and Save, Share link and WhatsApp secondary. Reuse sign-in and action feedback, resuming the requested action for the same Case after successful sign-in.

## Cross-Story Dependencies

- Epic 8 supplies the comparison, presentation and rounding contract and revision-aware commands. Epic 9 supplies the Interview shell, later-estate visibility, shared status region and obstruction handling.
- The 2026-11-22 sprint change sequences 9.13, 11.2, 11.3, then 9.12. Story 11.2 builds one shared Share preview body rendered only in 11.3's summary sheet and can land before 11.1. Story 9.12 checks the two-column Interview and visible summary bar at 1280px with 50 Heirs.
- The reflow work builds on the bar and sheet. Full results reuses Epic 10 naming when available, and rounding verification spans the sheet, Full results and draft PDF.
