---
title: 'Mawareeth phase 2 experience'
status: final
created: '2026-11-16'
updated: '2026-11-16'
sources:
  - ../../prds/prd-mawareeth-2026-11-16/prd.md
design: ./DESIGN.md
---

# Mawareeth phase 2 — Experience Spine

Spines win over any mock. Mock reference: [mockups/interview-layout-b.html](mockups/interview-layout-b.html) (Interview, layout B v2; phone and desktop, English and Arabic). Layouts A and B v1 are superseded. Requirements are referenced by FR id and are not restated; where this spine and the PRD differ on the Basis step, this spine follows the owner's decisions (memlog) and the difference is listed under Key Flows.

## Foundation

- **Form factor:** responsive web, mobile first (families on phones, often over several days). One codebase, no native app (PRD §5).
- **UI system:** Next.js 16 with React 19 and Tailwind CSS 4. No component library: `package.json` has only `next`, `react`, `react-dom` plus Tailwind; components are hand-written with shared class strings in `ui.ts`. Both spines therefore specify components fully; nothing is inherited from shadcn/MUI. Pages are statically exported and served by Django (every `Link` sets `prefetch={false}`).
- **Locales:** shipped `ar`, `en`, `fr`. The PRD adds `ur`, `hi`, `tr`, `id`, `ms`, `de`, `es`, `it`, `zh` (FR-27). RTL Locales: `ar` and `ur` (Urdu is RTL exactly like Arabic). Direction today is `locale === "ar"` in `directionOf`; it must cover `ur` from one RTL list before any Urdu build.
- **Appearance:** system light/dark (`prefers-color-scheme`), no manual toggle.
- **Visual identity:** [DESIGN.md](./DESIGN.md). Tokens are referenced here as `{colors.accent}` and so on.
- **Review labelling:** the UI never claims scholarly sign-off. Unreviewed Country laws and Locales carry the Beta label (FR-20, FR-29).

## Information Architecture

> **Visual reference:** [mockups/interview-layout-b.html](mockups/interview-layout-b.html) shows the Interview in layout B: English and Arabic phones with the sticky summary bar, an expanded preview, the desktop three-column view, and the three tree-card states. Numbers in it are illustrative. Where the mock and these documents differ, the documents win. The mock's desktop three-column frame is superseded (2026-11-22): every width uses the sticky bar and sheet. Every other surface is built from the spine tables alone, by owner decision.

| Surface | Route (shipped unless noted) | Reached from | Purpose | Journey |
|---|---|---|---|---|
| Landing | `/{locale}/` | Search, direct, language switch | Say what Mawareeth is, start an Interview | UJ-1, UJ-4 |
| Interview | `/{locale}/interview/` | Landing, nav, My cases, prefilled link | Enter the Deceased, estate and Heirs; live Share preview | UJ-1, UJ-2, UJ-3, UJ-7 |
| Full results | `/{locale}/results/` | Sticky summary bar and Share preview ("Full results") | Shares, proof, PDF, save, share, notices | UJ-1, UJ-4, UJ-6 |
| My cases | `/{locale}/cases/` | Nav (signed in), after Save | Named Saved cases; new Case; received invites | UJ-3 |
| Shared case | `/{locale}/shared/` | Private link from a user | Read-only result with banner and version | UJ-6 |
| Received / Invite | `/{locale}/received/`, `/{locale}/invite/` | Invite link, My cases | Open a Case shared with the user | UJ-6 |
| Contact us | new, `/{locale}/contact/` [ASSUMPTION: route] | Footer, results refusal, Full results help link | Ticket form and WhatsApp | UJ-5 |
| API page | new, `/{locale}/api/` [ASSUMPTION: route] | Footer; API terms | OpenAPI link, MCP setup, usage terms, key request | UJ-7 |
| Account: Log in, Sign up, Password change, Password reset (+ confirm) | shipped | Nav, sign-in dialog on Save or Share | Registered features | UJ-2 |
| Legal and about: About, Terms, Privacy | shipped | Footer | What Mawareeth is, licence, data handling (FR-31) | **No PRD journey lands here** (see gaps) |
| Language switcher | in nav | Every page | Each language in its own script | UJ-4 |

Global shell: top nav (Home, Interview, My cases and account links when signed in, language list) and footer (About, Terms, Privacy, plus Contact us, WhatsApp, API, and the Beta note for an unreviewed Locale). Modal depth is one: a sheet or dialog never opens on another.

Closure notes: every stated need has a surface. Gaps are listed at the end of this file.

## Voice and Tone

Calm, plain, compassionate. The reader may be grieving, may not read Arabic well, and is on a phone. Short sentences. Say what happened and what to do. Mawareeth is a calculation aid, not a fatwa or legal advice, and it says so without apology or alarm. Never "certified", never "court-approved", never "what the law means for your estate" (PRD §10). The deceased is always "The deceased" / "المتوفى".

Arabic strings below are drafts for owner review [ASSUMPTION: wording; the "The deceased", "Died before", "Died later", "No share", "Same result", "Full results" strings come from the mock; the later-death edit option and breadcrumb are new drafts]. Terms used in this spine: Heirs list (the Heirs rows beside the tree), Add relatives (the relationship-button panel), later death (PRD: successive death), own estate (the estate of a person who died after the deceased).

| Moment | English | Arabic | Not |
|---|---|---|---|
| Deceased node | The deceased | المتوفى | Father; "Deceased (male)" |
| Died before | Died before | توفي قبله | A symbol or "Dead" |
| Died later | Died later · own estate | توفيت لاحقاً · تركة مستقلة | "Deceased" for the second person |
| Edit sheet: later death | Died after the deceased, before division | توفي بعد المتوفى وقبل قسمة التركة | "Deceased" for the second person |
| Death breadcrumb | The deceased › Wife's estate | المتوفى › تركة الزوجة | A symbol |
| Blocked heir | No share in this case | لا نصيب في هذه الحالة | "Excluded", "Disinherited" |
| Schools agree | Same result in all four Sunni schools | النتيجة نفسها في المذاهب السنية الأربعة | "Calculated under the Hanbali school" |
| Preview | 6 heirs · shares ready | ٦ ورثة · الحصص جاهزة | "Calculation complete!" |
| Primary action | Full results | النتائج الكاملة | "Click here" |
| Disclaimer | A calculation aid, not a fatwa or legal advice. Take it to a qualified scholar, lawyer or court. | أداة حساب وليست فتوى ولا استشارة قانونية. اعرضها على عالم أو محامٍ أو محكمة مؤهلة. | "Verified", "Official" |
| Beta (law) | Beta: this country preset has not yet been reviewed by a qualified scholar. | تجريبي: لم يراجع عالم مؤهل هذه القواعد بعد. | Hiding it |
| Beta (language) | This translation has not yet been reviewed by a native speaker. | لم يراجع متحدث أصلي هذه الترجمة بعد. | |
| Smart prompt | In some countries' laws, Karim's children would also receive an obligatory bequest. See the result under a country's law? | في قوانين بعض الدول يرث أبناء كريم وصية واجبة أيضاً. هل تريد رؤية النتيجة وفق قانون دولة؟ | "You are wrong" |
| Undo | Removed Hassan. Undo | حُذف حسن. تراجع | A silent delete |
| Add refused | A person cannot be both father and son here. Nothing was changed. | لا يمكن إضافة هذه العلاقة هنا. لم يتغير شيء. | Error codes |
| Limit | This case has 50 heirs, the most Mawareeth can calculate. | بلغت الحد الأقصى: ٥٠ وارثاً. | |

Rules: relationships are named as relatives, not roles ("Son", "Wife"); default labels are numbered in the current Locale ("Son 2"); names are optional and never required; the Share preview never says "wrong" about a family the user entered.

## Component Patterns

Behavioural. Visual specs are in DESIGN.md Components, under the same names.

| Component | Use | Behavioural rules |
|---|---|---|
| relationship-button | Interview add panel | One press adds one Heir of that relationship (FR-1) with a default label and no further input. Disallowed relationships are not offered (e.g. a second father). The Share preview updates after each add. Focus stays on the button after an add. At 50 Heirs, adds stop with a message (FR-1). Its accessible name contains the visible word ("Add wife"); the "+" is a decorative icon. This is the keyboard route for adding: with "Add relative here" it is the only add path a keyboard needs. |
| count-stepper | Beside each relationship-button | Plus and minus set a count n; pressing the add button adds n Heirs at once (FR-4, [ASSUMPTION: stepper form per PRD; adds on the add press, not on each plus]). Minimum 1, capped by the 50-Heir limit. Buttons are named "Fewer wives" / "More wives". The count is not announced on each press (the Share preview's single live region reports the result once the add is pressed). |
| tree-canvas | Interview | The visible, tappable Family tree: one labelled group of cards (roving tabindex, see Accessibility Floor). Pan by drag or swipe (`touch-action: pan-y pinch-zoom`, so vertical swipes still scroll the page), pinch or the zoom-toolbar to zoom, "Fit tree" resets. Deceased stays visible for up to 50 Heirs at 375px and 1280px (FR-6 NFR). Shows one estate level at a time; later-death levels open from a died-later card with the death-breadcrumb above the tree. A relative with no recorded parent hangs from the deceased on their generation line; a lineage link exists only after adding at a chosen person or editing one. A generation line is one horizontal row at every width and never wraps; when it is wider than the canvas, the canvas scrolls sideways. |
| zoom-toolbar | Above tree-canvas | Fit tree, plus, minus as buttons; each press announces the zoom level through the live region. The only keyboard alternative to pinch. |
| tree-card, tree-card-deceased, tree-card-died-before, tree-card-died-later, tree-card-blocked | Tree | A native button. Tap or Enter opens the edit-sheet / panel for that person (FR-3). A died-later card instead opens that person's own estate level (see Interaction Primitives "Open a died-later person"); editing that person stays in the Heirs list and in the edit-sheet's "Open own estate" companion action. Selected card has `aria-current="true"`. Drop targets (pointer only): the deceased and any Heir. Name = visible text, e.g. "Karim, Son, Died before the deceased". |
| add-relative-action | Edit-sheet / panel, focused tree-card | The "Add relative here" button (FR-2): lists the relationships the engine allows for that person and adds one. It is the keyboard and touch alternative to drag; the label is identical in every state and Locale. |
| death-breadcrumb | Above the tree-canvas, in a later-death estate only | "The deceased › Wife's estate". Each earlier level is a link back to that level; the current level is text. Shown only when the open level is not the deceased's. After activating a link focus moves to the tree-canvas heading. At most three levels. |
| heirs-list-header | Heirs list | Heading plus the persistent undo-control. |
| undo-control | Heirs list header and Interview header | "Undo last change" stays available until the next change, so undo never depends on the toast; Ctrl/Cmd+Z does the same. History is multi-step: each press walks back one change. |
| tree-card-placeholder | Empty parent or spouse slots on a node | Tap adds that relative (same result as a relationship-button); also a drop target. Only slots the engine allows are shown. |
| edit-sheet | Tapped person | Fields: name, relationship, **Same person as… (later-estate person only, when the server offers candidates)**, a status choice (Alive at death, "Died before the deceased", "Died after the deceased, before division"), the add-relative-action ("Add relative here", present in every state), "Open own estate" for a died-later person, and Remove (Delete). The later-death choice is offered only if fewer than two later deaths exist in the Case; at two, it is not offered and a line says why. Phone: modal bottom sheet. Desktop: non-modal right-column edit panel. Saves on change. Opening moves focus to the first field; Close returns focus to the card; after Remove, focus moves to the next sibling card, else the previous, else the deceased; after Undo, focus goes to the restored card. Remove of a person with descendants or a later-death link asks to confirm and lists exactly what else goes (FR-3). |
| heir-row | Heirs list | Mirrors the tree: same label, same state, from one `treeDescription` function. Edit opens the same sheet. A blocked Heir is listed dimmed with "No share in this case". A died-later row carries the same badge and an "Open own estate" action. |
| sticky-summary-bar | Interview, every width | Shows heir count and "shares ready", a Full results button and an expand chevron. Hidden until the Share preview has shares. Expanding opens the summary-sheet. Visible without scrolling on 375px (FR-11). Wraps to two rows under 360px; replaced by a "Share preview" button in the flow in a landscape viewport under 480px high. |
| summary-sheet | Share preview, every width | The full Share preview, a modal `<dialog>` with the heading "Share preview" and a Close button. Opens on the chevron (the bar is then `inert`); closes by Close, scrim tap or Escape; focus returns to the chevron. |
| share-preview | Inside the summary-sheet (no in-page pane) | Live shares per Heir (fraction, percent, amount when an estate is given, FR-13 rounding line), blocked rows dimmed, the "Same result in all four Sunni schools" line, the optional "Calculate under a country's law" link, Beta label, disclaimer, a primary Full results button. School or Country law is named only per FR-10. |
| smart-prompt | Share preview and Full results | Appears only when a Country law would change shares for this family (FR-14), listing the live presets. The action recalculates under the chosen Country law; "Not now" dismisses it and the dismissal is remembered for the Case (the country-law-link stays). Never blocks the Share preview, never moves focus, and is inserted after the shares. It carries a one-line gloss of "obligatory bequest": an extra share some countries' laws set aside for grandchildren whose parent died before the deceased. |
| country-law-link | Share preview | Optional "Calculate under a country's law" opens the country-law-list of live presets (FR-15, FR-22). Choosing one sets the Basis and recalculates. A "Back to all four Schools" control resets. |
| country-law-list | Share preview | The live presets as choice-cards, each with its name and version date and a badge-beta where unreviewed. |
| school-prompt | Share preview | Only when the Schools differ: a choice-card group to pick a School; until picked, the Share preview shows the Schools side by side. No upfront Basis step. |
| undo-toast | After any add, edit, delete | At least 10 seconds (FR-5); the timer pauses while the pointer hovers it or focus is inside it, and restarts after. Restores the previous family exactly. `role="status"`, never steals focus, placed in DOM order after the Heirs list. A new change replaces the toast, but the undo-control keeps the multi-step history, so the earlier change is not lost. |
| notice | Preview, Full results, PDF | Disclaimer always. Country notice only under that Country law (FR-25); civil-law notice under a School Basis in every Locale (FR-26). Notices are text, never dismissible. |
| badge-beta | Basis list, preview, results, footer, PDF | Always paired with an explanation in the nearby notice. Cannot be hidden by the user. |
| case-name-field | Save, My cases | Prefilled "Estate of {Deceased name or label}, {date}" (FR-8); up to 100 characters, any script; rename inline in My cases. |
| contact-form | Contact us | Topic (incl. "API access"), message, email, optional Case link; never requires case data (FR-34). Success shows the Ticket number and says an email was sent. |
| language-switcher | Nav | Lists each language in its own script, each item with its own `lang` and `dir`; current is not a link. |
| full-results-actions | Results | Download PDF, Save, Share link, WhatsApp. Save and Share by a guest open the sign-in dialog, then continue the action after sign-in (shipped behaviour). |
| status-line | Share preview, all pages | Plain one-line status. Variants: Updating, "Still working", offline. Not a modal; never blocks input. |
| shared-case-banner | Shared case | Read-only statement, preset name and version date line, and "A newer version exists" when it applies (FR-19). |
| skeleton-line | Cold load | Bars in the shape of the layout while data loads; `aria-busy` on the region. |
| live-region | Interview (no visual) | One shared polite region (`role="status"`, `aria-atomic`) for all preview and add/remove/undo announcements; see Accessibility Floor. |

## State Patterns

| State | Surface | Treatment |
|---|---|---|
| Empty Interview | Interview | Tree shows only "The deceased" and placeholder slots; the Heirs list says "No heirs yet. Press a relationship to add one."; the Share preview is blank and the sticky bar is hidden. |
| Cold load | Interview, results, cases | skeleton-lines in the layout's shape; the page stays usable; `aria-busy` on the Share preview region. |
| Preview updating | Share preview | Previous shares stay visible in a muted colour pair (not reduced opacity) with an "Updating" status-line shown only if the update exceeds 3 s; `aria-busy="true"`. The live-region announces once, after a debounce of about 800 ms; the result swaps without a layout jump and unchanged rows are not rewritten. Under 1 s p95 (NFR-3). |
| Later death added | Interview | The person's card gains `badge-died-later`; the live-region says "Wife marked as died after the deceased. Open her estate to add her heirs." Her estate level starts empty (placeholders only). |
| Later-death estate open | Interview | The death-breadcrumb shows above the tree; the tree, Heirs list and preview now show that person's estate, and the heading names it ("Wife's estate"). The Add relatives panel adds to this estate. |
| Later-death limit | Edit sheet | At two later deaths in the Case the later-death choice is not offered; a line says "A case can hold up to two later deaths." The existing ones stay editable. |
| Saving, saved, save failed | Results, Interview | Inline status-line: "Saving", "Saved to My cases", or "Could not save. Your family is still here. Try again." with a Retry button. PDF generating or failed and share-link created or copied use the same line. (Wording drafts.) |
| Preview error | Share preview | Plain message with a Retry button (shipped pattern); the family is never lost. |
| Refusal | Preview, results, API | The engine's reason in the current Locale, in a notice, with no numbers (FR-21). Offers Contact us. Cases: unsupported school, Malikiyya case, impossible family, Lebanon with a Shia or non-Muslim Deceased (the Interview asks "Was the deceased Sunni?" under that preset). |
| Impossible drop or add | Tree, buttons | Tree unchanged, message states why (FR-2); focus stays. |
| Schools differ | Preview | School-prompt appears; until chosen, the differing shares are shown per School. Same-result runs show no School line (FR-10). |
| Country-law prompt | Preview, results | smart-prompt (FR-14); under a Country law the preset name and version date are always shown (FR-10). |
| Preset updated | Saved case, shared link | Stored version shown with "A newer version exists. Recalculate?" Nothing recalculates silently (FR-19). |
| Beta | Law and Locale | badge-beta plus notice on Basis list, preview, results, PDF, footer. |
| Heir limit | Interview | Add buttons stop and a message states 50 (FR-1). |
| Undo available | Interview | undo-toast for at least 10 seconds (paused while hovered or focused) and the persistent undo-control until the next change. |
| Guest Case, 24 hours | Interview | A returning guest sees the shipped "resume or start over" prompt for an unsaved Case (FR-7 [ASSUMPTION]); a Saved case never does. |
| Expired case | Interview, shared link, prefilled link | "This case has expired" with a plain explanation (guest Cases last 24 hours; prefilled links 7 days, FR-41 [ASSUMPTION]); one button to start a new Case. No family data is shown. |
| Offline or slow | All | A persistent status-line "You're offline. Reconnect to keep editing." The family and the last Share preview stay visible; add, edit, delete and Undo are disabled until the connection returns (architecture AD-20: edits are blocked offline, no client queue). Slow (over about 3 s): the Updating state stays and a "Still working" status-line appears. |
| Rate limited | API page, Contact | "Too many requests; try again after {time}" with the way to request a key (FR-42). |
| Not signed in | Save, Share, My cases | The sign-in dialog; the action resumes afterwards. |
| Contact sent | Contact us | Ticket number in the page and email; WhatsApp link stays visible. |

## Interaction Primitives

- **One-press add.** A relationship-button adds one Heir. No form, no name. There is no separate add form; linking a later-estate heir to an existing person is done in the edit-sheet. Fixed 44px targets.
- **Count stepper.** Set n, press add; adds n Heirs (FR-4).
- **Tap node → edit.** Tap a tree-card or an Edit button: bottom sheet on phone, side panel on desktop. Name, relationship, status (including "Died after the deceased, before division"), Add relative here, Remove.
- **Add where you are.** Adding by keyboard (and by touch without dragging) is always "Add relative here" on the focused card or in the edit-sheet / panel, plus the relationship-buttons (FR-2). A placeholder slot adds the same way.
- **Drag and drop (pointer only).** Drag a relationship chip onto the deceased or an Heir with a mouse or touch (dropping "Son" on a died-before son adds his child, FR-2). There is no keyboard pick-up: Space and Enter only press buttons. Every result of a drag is reachable by "Add relative here", so drag is an enhancement, never required. An illegal target announces "Not allowed here: {reason}" and the tree is unchanged.
- **Undo.** After every add, edit, delete: the undo-toast (at least 10 seconds, paused on hover and focus) and the persistent undo-control in the Heirs list header and Interview header, plus Ctrl/Cmd+Z.
- **Sticky bar expand.** Chevron or bar tap opens the summary-sheet; Close, Escape or the scrim closes it.
- **Country-law link and smart prompt.** Optional link always available; the smart prompt appears on its own only when the shares would change.
- **Pan and zoom.** Drag or swipe to pan, pinch or the zoom-toolbar to zoom, Fit tree to reset. Keyboard: arrow keys move focus between cards; the canvas never traps focus (Tab leaves it).
- **Mark a later death.** In the edit sheet choose "Died after the deceased, before division"; the card gets `badge-died-later` (max two later deaths in a Case).
- **Open a died-later person.** Tap or press Enter on the died-later card (or "Open own estate"): that person's estate opens with the death-breadcrumb ("The deceased › Wife's estate") above the tree. Activating an earlier breadcrumb level returns to it.
- **Motion.** Node reflow 300ms; sheet slide, scrim fade, toast entry, skeleton shimmer, zoom and smooth scroll are all off under `prefers-reduced-motion`, with no loss of function.

Banned: drag as the only way to do anything, hover-only affordances, colour-only state, infinite modal stacks, silent deletes of a person with descendants.

## Accessibility Floor

Behavioural. Visual contrast and focus-ring specs are in DESIGN.md.Colors and Components.

- WCAG 2.1 AA in every Locale, including RTL (NFR-1). Axe runs in Playwright on the Interview and results.
- **Tree accessibility model (decided).** No tree library documents ARIA or RTL support (research), so the tree is custom. Each tree-card is a native `<button>` inside one `role="group"` labelled "Family tree"; the group is a single tab stop with a roving tabindex. Not `role="application"`, not `role="tree"` (the structure is not a strict hierarchy). The selected card has `aria-current="true"`. The card's name is its visible text ("Karim, Son, Died before the deceased"); state comes from visible text, not an `aria-label` override. The **Heirs list is the canonical screen-reader outline**: it lists the deceased and every Heir with relationship, state badges and no-share status from the same `treeDescription` function as the cards, and is the tested non-visual path (NVDA/Chrome, VoiceOver/Safari iOS, TalkBack, each in Arabic).
- **Keyboard tree navigation** (FR-6 NFR): Tab enters the group on the current card; Up = parent, Down = first child, Start/End arrows (not Left/Right) = previous/next sibling, Home = the deceased, End = last card; Enter opens the edit sheet or panel (for a died-later card, opens its estate); Delete asks to confirm; Escape closes. `+` and `-` zoom. **RTL:** Start/End follow the mirrored layout, so Left and Right swap; an RTL Playwright keyboard test covers it.
- **Adding by keyboard** is always "Add relative here" on the focused card (or in the edit sheet / panel) and the relationship-buttons. Drag and drop is pointer-only, with that action as its alternative (FR-2); there is no keyboard pick-up.
- **Focus management:** the phone edit-sheet and summary-sheet are modal `<dialog>`s (`showModal()`: background inert, Escape and focus trap native, plus a Close button). Opening moves focus to the first field (edit sheet) or the sheet heading (summary-sheet); closing returns focus to the card or chevron that opened it. The desktop edit panel is non-modal: focus moves to its first field, Escape closes it and returns to the card, and it follows the tree in Tab order. After Remove, focus goes to the next sibling card, else the previous, else the deceased; after Undo, to the restored card. Opening a later-death estate focuses the tree-canvas heading. Dialog behaviour is shipped for sign-in.
- **Live region:** one shared polite region (`role="status"`, `aria-atomic`). Preview updates are debounced (about 800 ms) and coalesced into one sentence per change ("Added Son 2. 7 heirs, shares ready."), never the share rows themselves. Steppers and the Updating state say nothing on their own (Updating only past 3 s). `role="alert"` is for refusals only. Unchanged rows are never rewritten.
- **Reflow:** WCAG 1.4.10 holds at 320px and at 400% zoom; see DESIGN Layout & Spacing (sticky bar wraps, bar plus toast capped at 25% of viewport height, `scroll-padding-block-end`). Playwright runs 320px and 400% in LTR and RTL with text-spacing overrides.
- **Language markup:** Urdu is RTL like Arabic (`directionOf` must cover `ur` from one RTL list). The page sets `dir` and `lang` per Locale. Numerals, fractions and amounts follow the Locale (FR-24). An Arabic term beside a translation is emitted as `<bdi lang="ar" dir="rtl">` in visible text (not only in `aria-label`); an English fallback string carries `lang="en"`; `lang` comes from the Locale registry.
- Targets 44px; label every input; names in `<bdi dir="auto">`; fractions `dir="ltr"` inside RTL text, so a fraction never reorders.
- Never convey state by colour alone; text badges are mandatory. Graphic borders and lines meet 3:1 (DESIGN `{colors.graphic}`).
- Respect `prefers-reduced-motion` and `prefers-color-scheme`.

## Key Flows

Protagonists and names mirror the PRD. The decided UX replaces the PRD's upfront "pick Basis" step: the Basis defaults to all four Schools, a School is asked only when Schools differ, and a Country law is reached by the "Calculate under a country's law" link or the smart prompt (FR-14, FR-15).

### UJ-1. Mona settles her father's estate under Egyptian law.

Mona, 41, Cairo; Arabic UI on a phone, guest, from a search.

1. She opens the Landing and starts the Interview. No Basis step appears.
2. She enters her father (as "the deceased") and the estate. The estate hint explains debts and jointly owned assets (FR-12).
3. In Add relatives she presses *Wife*, *Daughter*, *Son*. Her mother, herself and Hassan appear on the tree and the Heirs list; the sticky bar shows "3 heirs · shares ready".
4. She adds Karim as a son and opens his card to mark "Died before the deceased"; the card turns dashed with the badge. She drops *Son* and *Daughter* onto his card, or taps it and uses "Add relative here", to add his two children.
5. A smart prompt appears: in some countries' laws Karim's children also receive an obligatory bequest (FR-14). She taps the Egypt option.
6. **Climax:** the Share preview shows an "Obligatory bequest" line for Karim's children, capped at a third, with "Egyptian Wills Law 71/1946, art. 76" beneath it; a Beta label says the Egypt preset is not yet scholar-reviewed (FR-16, FR-18, FR-20).
7. She taps the prominent *Full results* button, downloads the draft PDF and sends it on WhatsApp.

Failure and edge: a drop that makes an impossible family is refused with a message and the tree is unchanged. If she dismisses the prompt, the Share preview stays under all four Schools and the "Calculate under a country's law" link remains. If the Egypt preset is not live (FR-22), the prompt does not list it.

### UJ-2. Yusuf builds a big family in minutes and fixes a slip on the tree.

Yusuf, 55, Amman, registered, desktop, Arabic UI, eleven relatives.

1. He presses relationship buttons to add relatives with no name typing, using count steppers for groups.
2. He drags a relationship chip onto the tree for his nephews.
3. He spots a sister added as a half-sister, taps her node, and changes the relationship in the side panel.
4. He deletes a duplicate brother; the undo toast appears. He deletes another by mistake and taps Undo.
5. **Climax:** the Share preview updates after every change, and the Family tree, Heirs list and shares always match.
6. He taps Save, names it "Mother's estate, 2026" (prefilled name edited) and the Case appears in My cases.

Failure: deleting an Heir with descendants asks for confirmation and states exactly what else is removed; he cancels and nothing changes. Over 50 Heirs, adds stop with a message.

Sub-flow of UJ-2, a relative who died after the deceased: Yusuf's aunt died a week after his mother, before the estate was divided.

1. He opens the aunt's card (or her Heirs row) and, in the edit sheet, chooses "Died after the deceased, before division" (the choice is not offered once two later deaths exist). Focus stays in the sheet; closing returns it to her card.
2. Her card keeps a solid teal border and gains the badge "Died later · own estate". The Share preview shows her share as part of the first estate and says her own estate is calculated separately.
3. He taps her card (or "Open own estate"). Her estate opens with the death-breadcrumb "The deceased › Aunt's estate" above the tree. He adds her heirs there with the same buttons and "Add relative here".
4. **Climax:** the Share preview for her estate updates beside the first; the breadcrumb returns him to the deceased's estate with one tap.

Failure: a third later death is refused with "A case can hold up to two later deaths." and nothing changes. Removing the person with a later-death estate asks for confirmation and lists her estate's people.

### UJ-3. Yusuf comes back three days later.

1. He opens My cases and sees "Mother's estate, 2026" sorted by last change.
2. He taps it.
3. **Climax:** the Case opens straight into the Interview with his family loaded; there is no "resume or start over" screen (FR-7).
4. He renames it "Mother's estate (final)" in My cases.

Failure: if the Country preset changed since saving, the stored version is shown with "A newer version exists. Recalculate?" and nothing recalculates silently (FR-19). A session expiry sends him to sign-in and then back to the same Case.

### UJ-4. Bilal reads his result in Urdu.

Bilal, 34, Birmingham.

1. He switches the Locale to اردو from the nav; the page turns right-to-left.
2. He enters the family; relationship names show in Urdu with the Arabic term beside them (FR-28).
3. A Beta label says the translation is not yet reviewed (FR-29).
4. **Climax:** the results read naturally; the Schools agree, so the line "Same result in all four Sunni schools" replaces any "Calculated under..." line, and a notice says UK law may decide what forms the estate (FR-10, FR-26).
5. He downloads the PDF in Urdu.

Failure: a missing Urdu string falls back to English visibly (marked `lang="en"`), never blank; CI blocks releases with missing keys (FR-27).

### UJ-5. Huda asks for help and gets an answer.

Huda, Algiers.

1. She taps *Contact us* in the footer.
2. She picks "Question about my result", writes her question and gives her email. Attaching the Case is optional.
3. **Climax:** she gets an email with a Ticket number, and later the owner's reply, in the same thread (FR-34, FR-35).
4. She can also tap *WhatsApp* to message the support number directly (FR-36).

Failure: form errors are shown inline in plain text; if sending fails, the form keeps her text and offers WhatsApp.

### UJ-6. Maître Benali checks a Moroccan case.

Maître Benali, notary's clerk, Casablanca; French UI.

1. In the Interview, they enter the family and open the "Calculate under a country's law" link, choosing "Loi marocaine (Code de la famille 2004)".
2. They open the proof on Full results.
3. **Climax:** every share cites its article, for example the Obligatory bequest articles, and a notice says that a reform of the Family Code is pending (FR-18, FR-25).
4. They save the Case under a client name and share it by private link; the recipient sees the Shared case with its banner and version.

Failure: a Shared link to a case under an older preset shows the version and "A newer version exists" (FR-19). Sharing as a guest opens the sign-in dialog first.

### UJ-7. Salma asks her assistant, and the assistant asks Mawareeth.

Salma, 29, Kuala Lumpur, with an AI assistant. The assistant uses the API; Salma meets Mawareeth on arrival.

1. The assistant looks up relationship codes, asks Salma to clarify "uncles", then calls `calculate_inheritance` with "compare all four Schools" and returns the exact fractions, the "Same in all four Schools" fact, the disclaimer and an "Open this case on Mawareeth" link (FR-38 to FR-41).
2. Salma opens the link: the Interview loads prefilled, no family data in the URL.
3. **Climax:** the Interview shows her family on the tree and the Share preview already holds the same numbers the assistant gave.
4. She downloads the draft PDF.

Failure: an expired link shows the Expired case state. If the family needs a rule Mawareeth refuses (e.g. Ja'fari), the tool returns the reason and no numbers. The API page (Surface: API page) is where a developer or heavy user reads the OpenAPI document, MCP setup and terms, and how to request a key; it lands there from the footer and from the rate-limit message (FR-39, FR-42, FR-43).

## Responsive & Platform

| Width | Interview | Other surfaces |
|---|---|---|
| Under 640px (phone) | Single column: Add relatives, tree (narrow cards), Heirs list. Share preview in the full-width sticky summary bar and its sheet. Edit in a bottom sheet. | Single column; Full results table scrolls horizontally with a labelled region. |
| 640 to 1023px | Single column, wider tree canvas (wide cards); buttons wrap; full-width summary bar stays. | `max-w-5xl` content. |
| 1024px and up | Two columns: Add relatives and Heirs list · tree. The Share preview stays in the sticky summary bar and its sheet. Edit in a side panel. | Same as tablet. |

Breakpoint values (640, 1024) are Tailwind defaults and are tokens in DESIGN (`breakpoint-*`), with card and column widths. The mock shows 375 and an outdated 1280 frame. Reflow rules at 320px and 400% zoom are in DESIGN Layout & Spacing. RTL mirrors every layout, including column order. Touch is primary; mouse and keyboard are fully supported. Print is only through the PDF.

## Inspiration & Anti-patterns

Genealogy sites (Ancestry, MyHeritage, FamilySearch, Gramps Web) per research `.working/research-family-tree-patterns.md`.

- **Borrowed:** tap a card, then a relationship menu (Ancestry); placeholder "add" cards where a relative is missing (MyHeritage, Ancestry ghost nodes); a generations or density idea reduced here to a Fit tree control; pan by drag and zoom by pinch (MyHeritage); portrait cards; a deceased marker; constrained adds (FamilySearch: only what the model allows); a linear outline alongside the graph.
- **Adapted:** the deceased marker is text, not a ribbon (a black ribbon is a funerary symbol and this is a Muslim calculator); the tree is the live preview and an input, because the relationship panel stays the fastest way in.
- **Avoided:** free-form tree editing (the engine limits who can exist); initials avatars and gender-coloured frames; mouse-only libraries (dTree touch issue); read-only mobile trees (the MyHeritage mobile edit gap); stacked modals; icons or symbols for death; a "calculation complete" celebration.
- **Open gap in the research:** no source covers delete-undo, accessibility or RTL; those patterns here are our own design.

## Gaps and open items

- Legal and about pages have no PRD journey landing on them; either add a journey or accept them as supporting surfaces.
- Account pages, Shared case, Received/Invite are covered only indirectly by UJ-2 and UJ-6.
- The Basis step is dropped; the PRD's UJ-1 and FR-15 describe an upfront choice. The PRD needs an update (memlog decision) to say the default is all four Schools and a Country law is reached by link or prompt.
- `directionOf` is `ar` only; Urdu RTL is not in code. The nav language list has three Locales.
- The code has gendered deceased labels ("The deceased, male" / "المتوفاة (أنثى)"); the owner decision is a single neutral "The deceased" / "المتوفى". Needs confirmation for female deceased in Arabic.
- No error or success colour exists in the code; no dark-mode dialog; Urdu font and line height not chosen; Contact, API page, offline and rate-limit routes and wording are new.
- Country presets and Locale lists are data; the UI must read them rather than hard-code them.

### Deferred review findings

Medium and low findings not applied in this pass (review-rubric.md = RR, review-accessibility.md = RA).

- RR: `line` as input boundary (fixed only for case-name-field; shipped inputs keep the debt).
- RR: no distinct error or refusal notice variant.
- RR: no `body-ur` token or Urdu font stack; heading-xl and heading-lg line heights.
- RR: non-standard value syntax (`at N%`, rgba, px outside the scale); unused spacing tokens.
- RR: offline behaviour resolved 2026-11-16 by architecture AD-20: edits are blocked while offline (no client queue).
- RR: My cases empty or failed, Shared case revoked or invalid, Received/Invite invalid, and Contact form validation states.
- RR: disabled look for stepper minus at 1 and relationship buttons at 50 Heirs; hover only on button-secondary.
- RR: only the Interview has a visual reference; other surfaces rely on DESIGN.md.
- RR: Voice table carries 14 drafted Arabic strings that belong in i18n files; shipped components (Full results table, site-nav, site-footer, dialog) could shrink to one-line rows.
- RR: UJ-1 failure wording versus PRD UJ-1 on prompt persistence after dismissal.
- RR: UI-only terms (Heirs list, Add relatives, school-prompt, country-law-link) are not in the PRD glossary; Arabic for a female deceased is still open.
- RR: DESIGN rows with no EXPERIENCE rule (button, card, focus-ring, share-row, site-nav, site-footer, dialog, Full results table, choice-card, tree-connector).
- RA: no dark mock exists; mock literals (`#e3f4f1`, `#e8efec`, `#374151`) must become tokens; add `accent-foreground-soft`; generate the contrast table in CI.
- RA: dropped-state info (drop target, dimmed) must use colour pairs not opacity and announce illegal targets; blocked card plate legibility.
- RA: tiny text (badge 0.68rem, meta 0.72rem) should be 12px or more, Urdu 0.9rem or more in cards.
- RA: pan can steal page scroll on touch (hint text kept in the accessibility tree); focus-ring clipping checks; selected-plus-focus on the deceased card.
- RA: add-button and stepper accessible names per Locale (Label in Name) in the mock.
- RA: country-law-link and Edit buttons under 44px in the mock; foreground-at-60% borders as solid tokens; too many unlabelled landmarks in the mock.
- RA: chevron in badge text as a character; refusal copy tone ("cannot be both father and son") and `aria-describedby` for refused drops.
- RA: "Delete" versus "Removed" wording and plain-language glosses (heirs, shares, School, Basis); empty Interview first-step sentence; 24-hour guest-Case notice at first add; "(illustrative)" cue near the count.
- RA: PDF accessibility requirements (tagged PDF, language, reading order, PAC/veraPDF in CI) are not yet in the spine or the PRD.
