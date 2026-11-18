# Accessibility review: Mawareeth phase 2 UX spine pair

Scope: `DESIGN.md` (D), `EXPERIENCE.md` (E), `.working/key-interview-b-v2.html` (M). Target WCAG 2.1 AA, all Locales, light and dark. Line numbers refer to those files. Ratios are computed from the hex values (WCAG relative luminance), not estimated.

## Verdict

Not ready to build as written. Text contrast is sound in light and dark, and the behavioural floor in E is thoughtful. But the tree is the core of the product and it fails on two fronts. Its graphics (connectors, dashed border, card borders) are under 3:1 in both modes, and its keyboard and screen-reader model is still an unresolved assumption. The mock renders every card as a non-focusable `role="img"`. Several timing, focus, drag and language rules also need tightening before they are testable.

Counts: Critical 2, High 9, Medium 10, Low 6.

## Contrast table (computed)

| Pair | Light | Dark | Needs | Result |
|---|---|---|---|---|
| foreground on background | 17.9 | 16.9 | 4.5 | pass |
| muted on background / surface / blocked-stripe | 7.56 / 6.98 / 6.47 | 8.94 / 8.02 / 7.32 | 4.5 | pass. D line 268 says "about 7.5", correct for background only. |
| accent-foreground on accent (button, deceased card) | 5.47 | 9.78 | 4.5 | pass |
| accent text on background / surface | 5.47 / 5.06 | 13.4 / 12.0 | 4.5 | pass |
| accent text on accent-soft (badge-died-later, badge-beta, smart prompt) | 4.71 | 10.3 | 4.5 | pass, but thin. D line 273 says 4.9, which is wrong. At 0.68rem (about 10.9px) it has no margin for any tint drift. |
| mock `.node.dec small` `#e3f4f1` on accent | 4.82 | 1.30 if kept as a literal | 4.5 | pass in light, **fail in dark** (M, hard-coded) |
| mock `.badge.before` `#374151` on background | 10.3 | not tokenised | 4.5 | pass; make it `foreground` |
| **connector** on background / surface (tree lines, dashed died-before border, badge-died-before border) | **2.68 / 2.47** | **3.03 / 2.72** (assumed token) | 3.0 | **fail** light, and dark on the surface canvas |
| **line** on background / surface (tree-card border, blocked-card border, stepper and heir borders) | **1.37 / 1.27** | **1.54 / 1.38** | 3.0 where the border is the only boundary | **fail** |
| accent solid border (died-later, placeholder, selected) | 5.47 | 13.4 | 3.0 | pass |
| notice and choice-card border (foreground at 60%) | 4.67 | 6.36 | 3.0 | pass |
| focus ring (accent) on background / surface / soft | 5.47 / 5.06 / 4.71 | 13.4 / 12.0 / 10.3 | 3.0 | pass |
| **focus ring (accent) on undo-toast** (inverted foreground fill) | 3.28 | **1.26** | 3.0 | **fail in dark** |
| stripe vs surface (blocked card) | 1.08 | 1.09 | decorative | ok only because the text badge carries the meaning |

---

## Critical

### C1. Tree graphics fail 3:1 in light and dark
- **Location:** D lines 24, 29 (`connector`), 123-125 and 131-134 (tree-card, died-before borders), 154-156 (tree-connector), 157-162 (badge-died-before). M `.vl` and `.node.before`.
- **WCAG:** 1.4.11 Non-text Contrast.
- **Why it matters:** the connectors are the only visual statement of who is whose child or spouse. At 2.47:1 on the canvas they vanish for low-vision and bright-sun phone users. The linear outline does not help sighted low-vision users, who rely on the lines. Normal and blocked cards have a 1.27-1.37:1 border on a white-on-surface canvas, so a tappable card has almost no visible edge. The dashed died-before border (2.47:1) is the only non-text cue of the state; the text badge saves meaning but not the component boundary. In dark the assumed `connector-dark` is 2.72:1 on `surface-dark`, and `line-dark` cards are 1.38:1.
- **Fix:**
  - Introduce a `graphic` token of at least 3:1 against both background and surface. Light about `#76897F` (3.43 on surface, 3.71 on white). Dark about `#5F7A6E`; verify with a checker.
  - Use it for connectors, the died-before dashed border, the badge-died-before border and every tree-card border.
  - Keep `line` only for decorative hairlines (row dividers).
  - Make the dashed pattern coarse (4px dash, 3px gap) so it survives 400% zoom and Retina downscaling.

### C2. The tree has no operable accessible model yet
- **Location:** E 140-141 ("[ASSUMPTION: structure; to settle in architecture]"), E 78-79. M: every card is `role="img"` with `aria-label`, there is no focusable card, `tabindex` appears only on the scroll region.
- **WCAG:** 2.1.1 Keyboard, 4.1.2 Name/Role/Value, 1.3.1.
- **Why it matters:** the spec says a card is tapped, opened with Enter and navigated by arrows, but the mock and the current shipped tree are non-interactive images. The spine delegates the ARIA pattern to a later step while the Accessibility Floor claims AA. Nothing here is testable as written.
- **Fix:** decide now and write it into E:
  - Each card is a native `<button>` inside a roving-tabindex group (`role="group"`, one tab stop, Arrow keys move, Home goes to the deceased).
  - Do not use `role="application"`. Do not use `role="tree"` as the primary pattern, because the structure (spouses, parents above, children below, deceased in the middle) is not a strict hierarchy.
  - Name = visible text: "Karim, Son, Died before the deceased". State comes from visible text plus `aria-describedby`, not from `aria-label` overriding the content.
  - Selected state = `aria-current="true"` (or `aria-pressed`) on the card. The 3px outline alone (D line 319) is not programmatic.
  - Make the Heirs list the tested primary non-visual path, with identical state strings generated from one function (`treeDescription`).
  - Add to the test plan: NVDA/Chrome, VoiceOver/Safari iOS and TalkBack, each in Arabic.

---

## High

### H1. Keyboard drag pick-up conflicts with the add button
- **Location:** E 125 ("pick up with Space on a chip").
- **WCAG:** 2.1.1, 2.5.7 (2.2, advisory), 4.1.2.
- **Why:** the chip's add button already fires on Space/Enter (E 75, "one press adds one Heir"). Pick-up cannot also be Space.
- **Fix:** make the keyboard path the tap path. Offer "Add {relationship} to {person}" through the edit sheet / node action menu. Drop keyboard pick-up unless a separate grab handle exists, with `aria-grabbed`-free live-region instructions. Mark drag as a pointer enhancement only.

### H2. The tap alternative to drag is incomplete
- **Location:** E 80 (edit-sheet fields: name, relationship, died-before, Delete) vs E 124 ("tapping a node also offers Add relative here"). E 78 and D line 316 make a died-later card open the estate layer, with edit "in the list".
- **WCAG:** 2.5.1, 2.5.7 (advisory), 3.2.4 consistency.
- **Why:** "Add relative here" is missing from the edit-sheet field list. A died-later card has no add path. Dropping a child onto a died-before son (E 161, UJ-1 step 4) must be reachable without a pointer.
- **Fix:** put "Add relative here" explicitly in the edit-sheet and panel for every state. For died-later, add a distinct "Open own estate" action beside edit rather than hijacking the whole card. Same label in EN/AR in both flows.

### H3. Undo toast timing is not a conforming time limit
- **Location:** E 88 and 126, D line 231, FR-5 ("at least 10 seconds").
- **WCAG:** 2.2.1 Timing Adjustable, 2.2.3 intent, 4.1.3.
- **Why:** an auto-dismissing action with a fixed 10s limit cannot be turned off, adjusted or extended. For screen-reader and switch users reaching a toast that sits last in the DOM, 10s is too short. For a grieving user on a bad network, deleting a relative then missing the undo window is costly.
- **Fix:**
  - Pause the timer on hover, focus and while a screen reader reads it. Add "Keep this message" control or a longer default (30s) with no timer while focus is inside.
  - Offer a persistent "Undo last change" in the Heirs list header and Ctrl/Cmd+Z, so undo does not depend on the toast.
  - Place the toast in DOM order right after the control region it relates to, or send focus to Undo only on explicit shortcut, never steal focus.
  - Use `role="status"` (polite), not `alert`.
  - Resolve the contradiction "stacks to one... Undo walks back one step" (E 88): a replaced toast loses the earlier undo. Say whether history is multi-step and visible from the persistent control.

### H4. Focus ring invisible on the inverted toast in dark mode
- **Location:** D lines 115-117, 229-232 (toast = foreground fill; dark foreground `#EDEDED`; ring `accent-dark` `#5EEAD4`).
- **WCAG:** 2.4.7, 1.4.11.
- **Why:** ring contrast is 1.26:1 in dark, 3.28 in light (marginal).
- **Fix:** give the toast its own ring token (`background` colour 2px plus a 2px `foreground` offset), or a dark-toast token pair that keeps 3:1. D line 311 already needs "on accent fills use currentColor"; extend it to the toast and to the deceased card.

### H5. Sheet and bar focus management is ambiguous and leaks to the page behind
- **Location:** E 83, 127, 143; D lines 203-214, 325-326 (the bar becomes the sheet header in place).
- **WCAG:** 2.4.3, 2.4.7, 4.1.2, 1.3.2.
- **Why:**
  - The bar and sheet header are one element being toggled, so "focus moves to the sheet heading" and "returns to the chevron" can mean moving focus away from and back to the same node.
  - "Focus is contained" is stated, but the sheet is a positioned div in the mock and the page behind is not `inert`.
  - No rule for Delete: the edit sheet closes, and "returns focus to the card" now points at an element that no longer exists.
  - No rule for the undo toast restoring a person.
  - The edit side panel on desktop is non-modal, and its focus rules are not written.
  - The mock's sheet has no heading element, only text in `.sbar`, and no `role`.
- **Fix:**
  - Use `<dialog>` with `showModal()` for the phone sheets, so the background is inert and Escape and focus trap are native. The tap-on-scrim close must also have a button.
  - For the desktop panel, a non-modal landmark: focus moves to its heading (`tabindex="-1"`), Escape closes and returns to the card, Tab order places the panel directly after the tree.
  - Define focus after delete: move to the next sibling card, else the previous, else "Add relatives" heading. After undo: focus the restored card.
  - Keep a single heading ("Share preview") in the sheet.

### H6. Live-region plan will flood and double-announce
- **Location:** E 76 (stepper "announces the new count"), 102 (Updating status plus polite announcement), 145 (preview updates plus "Added Son 2"); M `<output>` in steppers.
- **WCAG:** 4.1.3 Status Messages, 2.2.2 (annoyance).
- **Why:** one press of "Son +" yields up to four announcements: stepper `<output>` (implicit live), "Added Son 2", "Updating", then the preview. A user adding eleven relatives in a row (UJ-2) hears about 40.
- **Fix:**
  - One shared polite region (`role="status"`, `aria-atomic`).
  - Debounce about 800ms and coalesce to one sentence: "Added Son 2. 7 heirs, shares ready." Say nothing for the steppers' own changes (the stepper is not a result). Announce "Updating" only if it exceeds 3s.
  - Do not read the share rows. Announce changes, not the table; the user can navigate to the preview.
  - Use `role="alert"` only for refusals.
  - Never rewrite the DOM of unchanged rows, so SRs do not re-read.

### H7. Urdu direction and mixed-language markup are not specified enough to pass 3.1.1/3.1.2
- **Location:** E 19 and 259 (`directionOf` is `ar` only), 146; D line 285; FR-28 "translated term (Arabic term)"; UJ-4 line 200 (English fallback shown visibly).
- **WCAG:** 3.1.1, 3.1.2 Language of Parts, 1.3.2.
- **Why:**
  - Urdu will render LTR until `directionOf` changes.
  - The "Arabic term beside the translation" pattern needs `lang="ar"` plus `dir="rtl"` on the term inside LTR locales (and `lang` on the translated term inside `ur`), otherwise screen readers read it with the wrong voice and the punctuation (`·`, `(`, `›`) reorders.
  - Fallback English strings must carry `lang="en"`.
  - Terms placed only inside `aria-label` cannot carry `lang`.
  - Names in `bdi` need `dir="auto"`.
  - Urdu digits (U+06F0 range) differ from Arabic-Indic; fraction `bdi dir="ltr"` is right, but speech of digits depends on `lang`.
- **Fix:**
  - Fix `directionOf` for `ur` before any Urdu build. Treat every RTL Locale from one list.
  - Define a `<Term arabic="…">` component that emits `<span lang="xx">…</span> (<bdi lang="ar" dir="rtl">…</bdi>)`.
  - Keep Arabic terms in visible text, not only in `aria-label`.
  - Add the fallback rule "wrap untranslated strings in `lang="en"`".
  - Set `lang` to `zh-Hans`, `hi`, etc. from the locale registry. Provide a font plan for Nastaliq, Devanagari and Han with `font-synthesis` off.

### H8. Tree and canvas behaviour at 320px, 400% zoom and in landscape
- **Location:** D lines 126-128 (108px fixed-width cards), E 77, 82, 239-243, D 203-212.
- **WCAG:** 1.4.10 Reflow, 1.4.4, 1.4.12.
- **Why:**
  - At 320px with 16px gutters the usable width is 288px, so only two 108px cards fit per row. Tree and Add-relatives pan sideways, which is acceptable for a 2D diagram, but only if the linear outline reflows fully.
  - The sticky bar carries a text, a primary button and a 44px chevron on one line. At 320px and long Arabic/German/Indonesian strings ("6 ahli waris · bahagian sedia") it will wrap or clip.
  - At 400% on a 1280x1024 viewport the viewport is 320x256 CSS px: the bar (about 62px) plus a toast plus a 78% sheet leaves almost nothing for content. The mock pins its frames at fixed 375x1280px boxes with `overflow:hidden` (M `.phone`), so reflow cannot be inspected.
  - `.pscroll` nests a scroll container inside the page (M), which traps scroll at high zoom.
- **Fix:**
  - Let the bar wrap into two rows under about 360px: text above, button and chevron below. Hide the bar in a landscape phone under 480px height and show a "Share preview" button in the flow instead.
  - Cap bar plus toast at 25% of the viewport height.
  - Use `scroll-padding-bottom` equal to bar plus toast height so a focused card or heir is never hidden behind them.
  - Do not nest scroll regions: let the page scroll, keep only the canvas as a labelled 2D scroll region.
  - Add 320px and 400% to the Playwright pass, in LTR and RTL, with 1.4.12 text-spacing overrides.

### H9. Dark mode is unvalidated for the three mock-only colours and the toast
- **Location:** D lines 28-31, 335, M literal `#e3f4f1`, `#e8efec`, `#374151`.
- **WCAG:** 1.4.3, 1.4.11.
- **Why:** dark values for connector/soft/stripe are `[ASSUMPTION]`, no dark mock exists, literals in M would pass into code and fail (deceased meta text 1.30:1 on dark accent). The scrim `#171717` at 40% is lighter than the `#0A0A0A` page, so it does not dim in dark mode; separation relies on the 2px outline alone.
- **Fix:**
  - Produce a dark mock of the interview before sign-off.
  - Replace every literal with a token. Add `accent-foreground-soft`.
  - Use a dark scrim of `#000` at 60%.
  - Include a contrast table in D, generated by a script in CI.

---

## Medium

### M1. Information carried by border or fill only: selected, drop target, dimmed
- **Location:** D lines 319-320 (selected = outline, drop target = border; the illegal target is "dimmed"), E 102 ("previous shares dimmed").
- **WCAG:** 1.4.1, 1.4.3, 4.1.2.
- **Why:** "dimmed" implemented with opacity will push muted text below 4.5:1. The illegal drop target has no text or announcement. The selected card has no programmatic state.
- **Fix:** dimming means a colour token pair, never `opacity`. Announce "Not allowed here: {reason}" on an illegal target. Expose selected via `aria-current`. Check that each state also has a text or a shape that is not colour alone (already true for the four card states).

### M2. Blocked card is only 'dimmed': check that it stays legible and is not read as disabled
- **Location:** D 144-148, 317, 323; M `.node.blocked`.
- **WCAG:** 1.4.3, 4.1.2.
- **Why:** text passes (6.47:1 light, 7.32 dark) and the badge says it in words, good. But the stripe pattern behind small text hampers reading at 0.72rem and in Arabic diacritics. The card is still tappable, so do not mark it `aria-disabled`.
- **Fix:** put the name and badge on a solid `surface` plate, keeping the stripe only as an edge band. Keep it focusable and enabled. Say in the name: "Full brother, no share in this case".

### M3. Tiny text: badge 0.68rem, meta 0.72rem, hint 0.72rem, sub-lines 0.74rem
- **Location:** D lines 58-70, M `.badge`, `.hint`, `.heirs small`.
- **WCAG:** 1.4.4, 1.4.12 (and a usability concern, not a numerical failure).
- **Why:** about 10.9-11.8px. The key state words ("Died before", "No share in this case") are in the smallest text on the page, read by older family members. Arabic and Urdu at this size lose diacritics and Nastaliq becomes illegible.
- **Fix:** minimum 0.75rem (12px), preferably 0.8125rem for badges; let badges wrap to two lines and grow the card. Raise Urdu to at least 0.9rem in cards. Verify at 200% text-only zoom that cards grow rather than clip.

### M4. Reduced-motion coverage is incomplete
- **Location:** D line 299, E 131, 152.
- **WCAG:** 2.3.3 (AAA), 2.2.2, best practice at AA.
- **Why:** only node reflow is covered. Not covered: sheet slide-in, scrim fade, toast entry, skeleton shimmer, "Fit tree" and zoom animation, smooth scroll into view on focus, pan inertia, drag ghost.
- **Fix:** one rule: all transitions over 100ms and all smooth scrolling are off under `prefers-reduced-motion: reduce`, with no loss of function. State it in D "Elevation" and E "Accessibility Floor".

### M5. RTL arrow semantics are right in principle but under-specified
- **Location:** E 141-142.
- **WCAG:** 2.1.1, 3.2.4.
- **Why:** "Left and Right swap" is correct for horizontal moves, but the spec only covers "sideways to siblings". Home/End, Page keys, and arrow behaviour when the canvas is scrolled are not defined. Rendering the whole tree through `rtl:-scale-x-100` (D line 344) would also mirror text and badges.
- **Fix:** mirror only the connector SVG layer with `scale-x-[-1]`; lay out cards by logical order using `direction`, not transform. Write a table: Up = parent, Down = first child, Start/End arrows (not Left/Right) = previous/next sibling, Home = deceased, End = last card, `+`/`-` = zoom. Add an RTL Playwright keyboard test.

### M6. No keyboard path for pan and zoom discoverability, and pan can steal page scroll
- **Location:** E 77, 129; D 312.
- **WCAG:** 2.1.1, 2.5.1, 1.4.13.
- **Why:** drag-to-pan on a canvas in a scrolling phone page traps vertical swipes (touch-action). The hint line is 0.72rem and may only appear for sighted users. Pinch has button equivalents (good), but arrow keys are claimed by node navigation, so keyboard pan relies on focus movement alone.
- **Fix:** `touch-action: pan-y pinch-zoom` on the canvas with horizontal pan only inside the canvas, a visible "Tree view: scroll sideways" hint kept in the accessibility tree, and zoom buttons that announce the level.

### M7. Sticky bar and toast can hide focused content
- **Location:** D 203-207, 229-232, E 82.
- **WCAG:** 2.4.7 (and 2.4.11 in WCAG 2.2, advisory).
- **Why:** a keyboard user tabbing down the Heirs list will focus rows hidden behind a 62px fixed bar plus toast.
- **Fix:** `scroll-padding-block-end` of the combined height, and `scroll-margin` on focusable rows.

### M8. Focus ring may be clipped
- **Location:** D 311, M `.canvas` and `.scroll` with overflow.
- **WCAG:** 2.4.7.
- **Why:** the ring is 2px plus 2px offset (3px in M) but nodes at the canvas edge sit inside an overflow container.
- **Fix:** canvas padding of at least 6px on all logical sides. Use `outline`, not `box-shadow`, and test selected-plus-focus (3px inset outline plus ring) on the deceased card.

### M9. Name does not contain visible label for add buttons and steppers
- **Location:** M `aria-label="+ Wife"` on a button whose visible text is "Wife +"; `aria-label="− Wife"` on "−"; `aria-label="+ Add parent"` has a literal plus.
- **WCAG:** 2.5.3 Label in Name, 4.1.2.
- **Why:** speech-input users say "click Wife plus". The "+" and "−" characters are read as "plus"/"minus" or skipped depending on the screen reader and locale.
- **Fix:** visible text "Wife", with a decorative `+` icon (`aria-hidden`), accessible name "Add wife". Stepper buttons: "Fewer wives" / "More wives". Keep the name containing the visible word in each Locale.

### M10. Smart prompt: no dismiss control specified, and jargon
- **Location:** D 219-224, E 62, 85.
- **WCAG:** 2.2.1 (n/a), 3.3.2, 1.3.1.
- **Why:** E says "dismissal is remembered" but D lists no dismiss control. It appears dynamically in the middle of the preview, so it must not move focus or shift layout. "Obligatory bequest" is unexplained and a grieving reader may not know it.
- **Fix:** add a labelled "Not now" button (44px) as part of the component. Insert the prompt after, never before, the shares, using `role="status"` content with no focus move. Add a one-line gloss: "an extra share set aside by some countries' laws for grandchildren whose parent died before the deceased".

---

## Low

### L1. Muted-contrast claim in D has small errors
- D 268, 273: `accent on accent-soft` is 4.71, not 4.9. Update and keep the badge minimum size rule (D 273) enforced by a token, not a note.

### L2. "Calculate under a country's law" link is under 44px
- M `a.quiet` (0.84rem, padding 10px 0, about 39px high); also the "Edit" buttons use 0.84rem.
- WCAG 2.5.5 (AAA) and the spec's own 44px rule (D 294). Pad to 44px.

### L3. Colour-mix borders are only just above 3:1 in light
- D 226 and 234: foreground at 60% is 4.67:1; fine, but specify as a solid token so it does not fall under 3:1 if a transparent background changes. The nav border at 20% (1.5:1) is decorative; keep it so.

### L4. `role="note"` and region overuse
- M has six `role="region"` plus nested groups (60 `role="group"`); too many unlabelled landmarks make navigation noisy. Use landmarks for Add relatives, Family tree, Heirs, Share preview only; use plain headings for the rest.

### L5. Chevron "›" in badge text
- D 315, E 54. A text character read as "single right-pointing angle quotation mark" and not guaranteed to mirror. Use an `aria-hidden` inline SVG with `rtl:-scale-x-100`, and put "opens own estate" in the accessible name instead.

### L6. Error and refusal strings
- E 64: "A person cannot be both father and son here" reads as a rebuke. Prefer "That relationship can't be added here, because {reason}. Nothing was changed." Keep error text with `role="alert"` and an associated `aria-describedby` on the control that caused it; E says refusals are in notices, but a refused drop needs focus to stay (E 105, already stated).

---

## Cognitive load and tone (grieving users)

Good: neutral "The deceased" with no funerary symbol, calm tone table (E 46-66), no celebratory copy, no required names, one-press add, Beta and disclaimer always visible, banned silent deletes. Points to fix, none a blocker:
- **"Delete" vs "Removed":** the button says Delete (E 80), the toast says Removed (E 63). A relative is not "deleted". Use "Remove from this case" in both, and a confirmation that names the people, in plain language.
- **Jargon to gloss once, in context:** "Heirs", "shares", "School", "Basis", "obligatory bequest", "own estate". The "Died before" and "Died later" badges lose their referent on their own. Prefer "Died before the deceased" and "Died after the deceased" in the accessible name even if the visual badge is shorter.
- **"6 heirs · shares ready"** is brief; add the disclaimer cue "(illustrative)" next to the count when the user has not yet reviewed, as the mock's pill does. Do not hide that pill on phone.
- **Failure of the first impression:** the empty Interview (E 100) should say in one sentence what to do first, not only "No heirs yet".
- **Save progress:** many families return over several days (E 17). Say that the guest Case lasts 24h at the moment it matters (first add), not only at return.
- **Limit and offline messages:** do not blame ("You exceeded"); the draft strings (E 65, 114) are fine.

## PDF accessibility

E and D mention the PDF only as content (disclaimer, Beta, version, citations, FR-18/20/26) and as RTL (FR-27); there is **no accessibility requirement**. Add to the spine and FR list:
- Tagged PDF with a real document language (`/Lang` per Locale, with `ar` on Arabic terms), a title, headings, reading order that follows logical order in RTL, and the results table with header cells.
- Embedded fonts with full Arabic/Urdu shaping; fractions and digits tested for bidi order; text must be real text, not an image.
- The Beta label, disclaimer and "family supplied by the user" statement as real text at the start, not in a footer image.
- Sufficient contrast (same tokens, light theme only), 4.5:1, no colour-only state; dashed/striped states described in text.
- Run PAC or veraPDF in CI for `ar`, `ur`, `en` at least. WCAG 2.1 AA applies to the PDF as a web document (WCAG2ICT).

## What already works (keep)
- Text pairs, the 5.47:1 teal button, 44px targets, 52px heir rows, a linear Heirs outline mirroring the tree, text badges for every state, `bdi` and `dir=ltr` on fractions, `aria-expanded` on the sheet toggle, `prefers-reduced-motion` and `prefers-color-scheme` stated, no hover-only affordances, banned drag-only actions, modal depth one, no symbols for death.
