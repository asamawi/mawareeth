# Sprint Change Proposal: Interview without a Share preview pane

Date: 2026-11-22
Trigger: Owner review of the Interview after Story 9.11 shipped.
Mode: batch.
Scope: Moderate (one new Epic 9 story; two Epic 11 stories rewritten and pulled ahead of 9.12; UX spec and epics edited; one small API extension; no PRD requirement or architecture decision changes).
Status: Approved 2026-11-22 by Ahmad.

## 1. Issue summary

While adding Heirs, the Share preview takes space away from the two things the user is working with: the quick-add relationship buttons and the Family tree.

- At 1280px and up the preview is a fixed 340px third column (UX-DR79). The tree only gets what is left of the 1360px shell after the 380px relatives column.
- Below 1280px the UX spec puts the preview in a sticky summary bar and sheet (UX-DR38/77/78). Those are Epic 11 backlog (11.3, 11.4), so the shipped code still renders the preview **in the page flow** under the tree (`web/src/app/[locale]/interview/start-case.tsx:812-828`). On phone and tablet the user scrolls past it to reach the Heirs list.

**Owner decision (2026-11-22):** the Interview has no preview pane at any width. The sticky summary bar and its sheet carry the Share preview at every width. At 1024px and up the Interview has two columns: Add relatives with the Heirs list, then the tree. The 340px that the preview column used goes to the tree.

Evidence: the codex impact scan of 2026-11-22, summarised in §2.

**Second trigger (same review): the old "Add an heir" dropdown form.** `HeirForm` (`web/src/app/[locale]/interview/heir-form.tsx`) still mounts below the relationship buttons (`start-case.tsx:702`) while a later-death estate is open, whenever someone in the Case could be linked. It shows five radios, a **More relatives** native `<select>` and an optional name. It duplicates the one-press buttons, which already cover all 23 relationships, counts and the open estate. But it is the only Interview path that sends `same_as`, which records that a new heir of the later estate is **someone already in the Case** (for example, the first deceased's son who also inherits from his mother, who died later). Without that link, the same person is counted as two people across the successive-death estates.

**Owner decision (2026-11-22):** remove the old form. Linking moves to the **edit sheet**: add the relative with the normal buttons, open them, and choose "Same person as…" from a native select. The field is shown only for a person in a later estate when link candidates exist. This keeps the Add relatives panel free of extra controls.

## 2. Impact analysis

### Epics and stories

| Item | Status | Impact |
|---|---|---|
| 9.1, 9.11 | done | They built and verified the 340px slot. Their story text is history and is not edited. The code change is carried by 11.2 below. |
| 9.8 | done | Its owner decision stays: the preview is hidden while a later-death estate is open. This now means the bar is hidden in that state. |
| 9.12 | backlog | Its 1280px 50-Heir check now runs on the two-column layout with the bar visible. It runs **after** the new 11.2/11.3. |
| 11.2 | backlog | **Rewritten.** The desktop column is replaced by one shared preview body, and the third column and the in-flow preview are removed. Pulled ahead of 9.12. |
| 11.3 | backlog | **Rewritten.** The bar and sheet are used at every width, not only below 1280px. Pulled ahead of 9.12. |
| 11.4 | backlog | The breakpoint-crossing AC is simplified: there is no desktop column to switch to. |
| **9.13 (new)** | — | **Added.** It removes `HeirForm` and adds "Same person as…" to the edit sheet, with a small `update_heir` extension. Runs before 9.12. |
| 9.3, 9.4, 9.5, 9.8 | done | They are not edited. 9.13 extends 9.4's edit sheet. |
| 11.1, 11.5–11.7 | backlog | 11.7 is reworded ("desktop Share preview" becomes "summary-sheet"). The others are unchanged. |
| 16.3 | backlog | No change. It already names "preview and summary-sheet" as one slot pair. |
| Epic 11 summary | — | "phones get the sticky summary bar and sheet" becomes "every width gets…". |

### Artifacts

- **PRD:** one glossary wording change (line 132, "beside the Interview"). FR-11 and NFR-3 are unchanged: the bar shows Full results without scrolling at 375px.
- **Architecture:** none. AD-19/AD-20 (shared presentation, revision ordering) and the single status region are unaffected.
- **UX (DESIGN.md, EXPERIENCE.md):** the three-column layout, `interview-col-right`, `breakpoint-three-col` and the "desktop third column" wording are removed. The bar and sheet apply at all widths. The desktop frame of `mockups/interview-layout-b.html` is out of date; mark it superseded rather than redraw it.
- **epics.md:** UX-DR37, UX-DR38, UX-DR78, UX-DR79 and UX-DR4 are reworded, along with stories 11.2, 11.3, 11.4 and 11.7.

### Technical

- `start-case.tsx`: remove `previewColumn`, the `xl:` third-column grid, `xl:contents` and the column-3 placement of the editor and preview. At ≥1280px the editor uses the 1024–1279px side-panel placement.
- `share-preview.tsx`: becomes the sheet body. Fetching, revision reconciliation and announcements stay mounted outside the dialog, so tree evidence and the single live region keep working while the sheet is closed.
- `obstruction.ts`: register the bar's measured height alongside the Undo toast.
- **Tests to change:**
  - `e2e/interview.spec.ts` 880–912, 1060–1085, 1838–1928 (column geometry, editor placement, later-estate visibility);
  - every test that reads preview rows directly (`e2e/family.ts:29`, `interview.spec.ts` 415–434, 1269, 1509, 1639–1790, 2175–2184; `accessibility.spec.ts` 132–154) must open the sheet or read the bar.
- **Old form and linking (9.13):**
  - delete the `HeirForm` mount (`start-case.tsx:702`), `heir-form.tsx`'s add wrapper, `heirFormKey`, the form-only state and the `LINK_PENDING` branch (`answers.ts:133,377`);
  - keep `linkCandidates` (`layers.ts:89`), which now feeds the edit-sheet field, and the shared `RelationshipFields`;
  - remove the form-only i18n keys `heirAddHeading`, `heirAdd`, `heirSave`, `heirCancel`, `heirNameHint`. `heirLinkedHint` and the `heirLink…` keys are reused for the edit-sheet field;
  - retire `heir-form.test.tsx`, folding anything still relevant into `edit-sheet.test.tsx`. No Playwright or Python test drives the form.
- **Backend (9.13):**
  - `api/anonymous_case.py` `update_heir` (line 862) does not accept `same_as` today; only `_add_heir` (line 782) does. Extend `update_heir` to set or clear `same_as` on a later-estate row, reusing `_add_heir`'s checks (`not_alive`, `already_linked`, `gender_mismatch`);
  - setting the link takes the linked person's name (as at line 523);
  - add Python tests next to the existing `same_as` tests (`api/tests.py:2820`);
  - there is no schema or snapshot change, because `same_as` is already stored and read back (lines 594–599).
- No data migration or deployment impact.

## 3. Recommended approach

**Direct adjustment.** Add 9.13, rewrite 11.2 and 11.3, and run them next (9.13, then 11.2, then 11.3), before 9.12 and Epic 10. 9.12's UJ-2 journey then covers the final add and link controls.

- **Why reorder:** removing the pane without the bar would leave no live shares and no Full results action, which breaks FR-11. 9.12's speed and capacity gate should measure the layout that will ship.
- **Why not roll back:** 9.1/9.11 code is mostly kept. Only the `xl:` column wiring goes.
- **Effort:** medium. Two stories: about a third of the work is one component and layout change, and the rest is test rework.
- **Risk:** low to medium. The main risks are the focus and obstruction rules of a fixed bar and keeping one preview fetcher while the sheet is closed. Both are already specified in 11.3 and 11.4.
- **Timeline:** Epic 9 closes about two stories later. Epic 11 gets about two stories shorter.

## 4. Detailed change proposals

### 4.1 Stories (epics.md)

**New Story 9.13, inserted after 9.11**

> ### Story 9.13: Link a later-estate heir to someone already in the Case from the edit sheet, and retire the old add form
>
> As a family member entering successive deaths,
> I want to mark a relative in a later estate as a person already in the Case,
> So that the same person is not counted twice, and adding relatives stays on the one-press buttons.
>
> **Acceptance Criteria:**
>
> **Given** Stories 9.3–9.5 and 9.8 and any estate open in the Interview
> **When** Add relatives renders
> **Then** only the relationship-button groups and count stepper appear. The old "Add an heir" form (relationship radios, More relatives `<select>`, optional name, "Someone already in this case" select) is not rendered anywhere in the Interview (UX-DR27)
> **And** every relationship, group adds and the open-estate scope remain available on the buttons and "Add relative here".
>
> **Given** a person in a later-death estate and a non-empty server list of link candidates for them (same gender, alive in the earlier estate, not already linked in this estate)
> **When** I open their edit sheet or panel
> **Then** a "Same person as…" native select appears after the relationship field, offering "Nobody else (a new person)" and each candidate by tree label (`treeDescription`, names in `bdi dir=auto`), with at least a 44px target and the shipped form styling (UX-DR29, UX-DR91)
> **And** the field is absent in the first estate and when there are no candidates; candidates come only from the server, without browser kinship inference (AD-19).
>
> **Given** I choose a candidate, or choose "Nobody else" for a linked person
> **When** the revision-aware edit command succeeds with `same_as` set or cleared
> **Then** the card and Heirs row show the linked person's name and the existing linked hint (or drop them), the tree, list and Share preview stay on the accepted revision, the shared status region announces one sentence, and Undo restores the previous link state (FR-3, FR-4, UX-DR75, AD-20)
> **And** a refused (`not_alive`, `already_linked`, `gender_mismatch`), conflicting or offline edit changes nothing, shows the reason at the field through the existing field-error and recovery handling, and does not claim the link was made.
>
> **Given** the server's `update_heir` command
> **When** it receives `same_as` for a later-estate row
> **Then** it applies the same validation as adding with `same_as`, sets or clears the link atomically against the Case revision, and refuses `same_as` on a first-estate row
> **And** Python tests cover set, clear, each refusal and a stale revision. The snapshot format is unchanged.
>
> **Given** keyboard, screen-reader, RTL, 320px/400% zoom and reduced-motion use, on the phone bottom sheet and the desktop side panel
> **When** the field is used in en/ar/fr
> **Then** it is reachable by Tab, has a visible label, mirrors through logical properties and passes the existing axe and reflow checks (NFR-1, UX-DR74, UX-DR80)
> **And** `HeirForm`'s add wrapper, form-only state and validation branch and unused i18n keys are removed, with `heir-form.test.tsx` retired or folded into the edit-sheet tests.

Rationale: the second owner decision (option 1, chosen over a quick-add link group to keep the Add relatives panel clear). Field copy is [ASSUMPTION: draft wording, reviewed in Epic 12].

**Story 9.12: third AC.** It adds: "…removes a duplicate, marks a later-estate son as the same person as the first estate's son from his edit sheet, and undoes a mistaken removal".

**Story 11.2: title, story statement and first AC**

OLD:
> ### Story 11.2: Present one readable Share preview in the desktop slot
> As a family member editing a Case, I want readable shares beside my family on a wide screen, so that I can review the latest result and open Full results easily.
>
> **Given** Story 11.1, Epic 8's presented output and Epic 9's reserved preview slot
> **When** the Interview is at least 1280px wide
> **Then** the Share preview occupies the 340px third column inside the existing maximum 1360px shell, with 24px padding, background token and a 1px inline-start decorative divider (UX-DR37, UX-DR79)
> **And** it uses the existing editor layout without rebuilding the 380px relatives column or flexible tree, and no sticky summary bar is shown.

NEW:
> ### Story 11.2: Give the Interview's space to family entry and build one readable Share preview body
> As a family member adding relatives, I want the relationship buttons and the Family tree to have the room, and the shares one tap away, so that I can build my family quickly and still check the latest result.
>
> **Given** Epic 8's presented output and Epic 9's Interview shell
> **When** the Interview renders at any width
> **Then** no Share preview pane appears in the page: the ≥1280px 340px third column and the below-1280px in-flow preview are removed, and at 1024px and up the layout is two columns (380px Add relatives/Heirs list · flexible tree) inside the 1360px shell, with the side edit panel placed as at 1024–1279px (UX-DR78, UX-DR79)
> **And** the Share preview body is one component rendered only inside Story 11.3's summary-sheet, while its fetching, revision reconciliation, tree evidence and announcements stay mounted when the sheet is closed; the later-estate rule from 9.8 (no preview while a later-death estate is open) is kept.

Rationale: the owner decision. The remaining 11.2 ACs (share-rows, disclaimer, primary Full results, revision handling) are kept as written, except "desktop preview" becomes "Share preview body". The dependency on 11.1 is dropped: the agreement line appears once 11.1 lands.

**Story 11.2: Full results AC, second line**

OLD: "**And** the shared content can also render inside Story 11.3's sheet without duplicating result meaning or numeric formatting; navigation Links retain prefetch=false."
NEW: "**And** the same primary Full results action also appears in Story 11.3's bar; neither duplicates result meaning or numeric formatting, and navigation Links retain prefetch=false."

**Story 11.3: story statement and first AC**

OLD:
> As a family member using a phone or tablet, …
> **Given** Story 11.2's shared preview content and an Interview below 1280px
> **When** shares become available
> **Then** a fixed bottom bar spans the full viewport width, including the 1024–1279px two-column layout, and shows heir count, "shares ready", primary Full results and a 44px expand toggle (FR-11, UX-DR38, UX-DR77, UX-DR78)

NEW:
> As a family member on any screen, …
> **Given** Story 11.2's Share preview body and an Interview at any width
> **When** shares become available in the first estate
> **Then** a fixed bottom bar spans the full viewport width at every breakpoint and shows heir count, "shares ready", primary Full results and a 44px expand toggle (FR-11, UX-DR38, UX-DR77–79)
> **And** the existing second line about the border, shadow, hidden-before-shares state and the 375px visibility is kept, with one addition: the bar is also hidden while a later-death estate is open.

**Story 11.3: last AC.** "as the desktop preview" becomes "as the accepted Share preview state".

**Story 11.4: breakpoint AC**

OLD:
> **Given** below-1024px, 1024–1279px and at-least-1280px layouts
> **When** the viewport crosses a preview breakpoint
> **Then** preview placement follows bar/sheet, bar/sheet and desktop column respectively, …
> **And** … [ASSUMPTION: sources do not specify focus on a breakpoint change] focus stays on an equivalent visible preview control if its original control is removed.

NEW:
> **Given** below-1024px and at-least-1024px layouts
> **When** the viewport crosses the 1024px or 640px breakpoint, or the 480px landscape-height threshold
> **Then** the preview stays in the bar/sheet (or the in-flow "Share preview" button under 480px landscape height), preserving the accepted result and any open sheet (UX-DR77–80)
> **And** the existing 16px mobile gutters, editor column structure and labelled canvas-only 2D scrolling with at least 6px focus padding remain intact; when the bar is swapped for the in-flow button, focus moves to whichever opener is visible.

The last AC's "focus retention across breakpoint changes follows the draft assumptions" becomes "focus retention follows the AC above".

**Story 11.7: rounding-line AC.** "desktop Share preview, summary-sheet, Full results and draft PDF" becomes "summary-sheet, Full results and draft PDF".

**Story 9.12: second AC.** "50-Heir Cases at 375px and 1280px" becomes "50-Heir Cases at 375px and 1280px (two-column layout with the summary bar visible)".

**Epic 11 summary (lines 711 and 1698):** "phones get the sticky summary bar and sheet" becomes "every screen gets the sticky summary bar and sheet, leaving the Interview to family entry".

### 4.2 UX design requirements (epics.md)

- **UX-DR37.** "desktop third column and identical summary-sheet content" becomes "one Share preview body shown in the summary-sheet".
- **UX-DR38.** "using components.sticky-summary-bar.* below 1280px" becomes "using components.sticky-summary-bar.* at every width (hidden while a later-death estate is open)".
- **UX-DR78** is re-scoped to all widths from 1024px:
  - OLD: "Implement 1024–1279px two columns: … sticky preview/sheet without a third preview column."
  - NEW: "Implement ≥1024px two columns inside a 1360px maximum Interview: 380px Add relatives/Heirs list plus flexible tree at least 596px (two 136px cards), side edit panel and sticky preview bar/sheet; there is no preview column."
- **UX-DR79** is replaced:
  - NEW: "[removed 2026-11-22] The ≥1280px three-column layout is withdrawn; ≥1280px follows UX-DR78. Preserve public 1024px max content, 24px gutters and 48px/64px vertical rhythm on non-Interview pages."
- **UX-DR4.** Drop the 1280px three-column breakpoint from the Interview token list. 640px and 1024px remain.
- **UX-DR91 (new).** "Implement a 'Same person as…' field in the edit-sheet for a later-estate person when the server offers link candidates: a native select with 'Nobody else (a new person)' and candidates by tree label, saved on change through the revision-aware edit, undoable, with field-level refusal reasons. There is no separate add form in the Interview." _(EXPERIENCE Component Patterns; Key Flows UJ-2)_

### 4.3 PRD (prd.md:132)

OLD: "**Share preview:** the live share table beside the Interview."
NEW: "**Share preview:** the live share table for the Interview, opened from its summary bar."

### 4.4 UX specification

**DESIGN.md**
- **Tokens (99, 103).** Remove `interview-col-right: 340px` and `breakpoint-three-col: 1280px`. Keep `interview-max: 1360px`.
- **Component token `share-preview` (275–277).** Remove `border-inline-start` and `width`, and keep `background` and `padding`.
- **Line 219.** "full viewport width at every breakpoint below 1280px" becomes "full viewport width at every breakpoint".
- **Line 398.** "1024px to 1279px" becomes "1024px and up". The line keeps "there is no third column" and adds "inside `{spacing.interview-max}`".
- **Line 399.** Delete it (the 1280px three-column layout).
- **Line 438.** "Fixed to the bottom of the viewport below 1280px" becomes "Fixed to the bottom of the viewport at every width".
- **Line 442.** "The desktop third column: white, 24px padding, inline-start 1px line, 340px wide at 1280px and up." becomes "The content of the summary-sheet: 24px padding."

**EXPERIENCE.md**
- **Line 26.** Add: "The mock's desktop three-column frame is superseded (2026-11-22): every width uses the sticky bar and sheet."
- **Line 89.** The edit-sheet fields become "name, relationship, **Same person as… (later-estate person only, when the server offers candidates)**, a status choice…". Desktop editing keeps its wording; the side panel now sits beside the tree at all widths of 1024px and up.
- **Line 139 (relationship-button).** Add: "There is no separate add form; linking a later-estate heir to an existing person is done in the edit-sheet."
- **Line 91.** "Interview below 1280px" becomes "Interview, every width".
- **Line 92.** "Share preview below 1280px" becomes "Share preview, every width".
- **Line 93.** The location becomes "Inside the summary-sheet (no in-page pane)".
- **Line 270.** "1024 to 1279px" becomes "1024px and up".
- **Line 271.** Delete it (the 1280px three-column row).
- **Line 273.** "(640, 1024, 1280)" becomes "(640, 1024)", and "The mock only shows 375 and 1280" becomes "The mock shows 375 and an outdated 1280 frame".

## 5. Implementation handoff

- **Scope:** Moderate.
- **Developer (this session, after approval):**
  - apply §4 to `epics.md`, `prd.md`, `DESIGN.md` and `EXPERIENCE.md`;
  - in `sprint-status.yaml`, add `9-13-link-a-later-estate-heir-from-the-edit-sheet-and-retire-the-o: backlog` and move `11-2-…` and `11-3-…`, all above `9-12-…`. Existing story keys are unchanged; only the order changes.
- **Build:** 9.13, then 11.2, then 11.3, through `bmad-build` (Sonnet subagent for implementation, codex review), then 9.12.
- **Success criteria:**
  - at 375px, 1100px and 1366px, in LTR and RTL, the Interview shows no preview pane;
  - at ≥1024px the tree column fills everything beside the 380px column;
  - once shares exist, the bar shows Full results without scrolling at 375px;
  - the sheet shows the same accepted presentation, with one live region and no duplicate fetches;
  - the bar is hidden while a later-death estate is open;
  - the Playwright and axe suites pass with the updated geometry and preview-reading tests;
  - no "Add an heir" form renders in any estate;
  - in a later estate, a person added with a button can be linked and unlinked from the edit sheet, and Undo reverses it;
  - `update_heir` refuses invalid links with the same reasons as adding with `same_as`.
