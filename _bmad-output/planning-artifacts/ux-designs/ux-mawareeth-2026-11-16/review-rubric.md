# Spine Pair Review — mawareeth

Reviewed: `DESIGN.md` + `EXPERIENCE.md` (both draft, 2026-11-16) against the PRD (`../../prds/prd-mawareeth-2026-11-16/prd.md`), `.memlog.md` and the bmad-ux examples and design-md spec. Severity = downstream impact (Critical: blocks extraction or breaks a build; High: two consumers would build different things; Medium: consumer must guess or rework; Low: polish).

## Overall verdict

**Adequate, close to strong.** A consumer can extract almost everything cleanly: all 7 UJs have full flows, every token reference resolves, every light color has a dark pair, section order and required defaults are correct, and the owner decisions (deceased label, no symbols, died-before and died-later markers, no Basis step) are committed in both files. What stops it from being a clean contract: the successive-death ("died-later") feature is a card state with no way to create it and no flow; the desktop breakpoint contradicts itself between the two files; about ten components named in EXPERIENCE have no DESIGN row; and several states (save, empty My cases, error versus info notice) are unspecified. No critical findings.

Counts: Critical 0 · High 3 · Medium 12 · Low 15.

## 1. Flow coverage — strong

All 7 UJ headings are verbatim from the PRD (UJ-1 to UJ-7), each with a named protagonist, numbered steps, a bolded **Climax**, and a failure or edge line. UJ-6 drops the PRD's "(secondary)" tag; harmless. The Basis deviation from the PRD is declared and the PRD was synced (memlog).

### Findings
- **[High]** The successive-death journey has no flow. The PRD glossary says a Case holds "up to two later deaths", DESIGN defines `tree-card-died-later` and EXPERIENCE says a died-later card opens "that person's own estate layer" via a "death breadcrumb", but no Key Flow shows how a user marks someone as died-later, what the layer screen looks like, or how they return (EXPERIENCE Interaction Primitives "Open a died-later person"; Key Flows). *Fix:* add a short flow (or extend UJ-2) and name the entry point; see section 3.
- **[Low]** UJ-1 step 5 "taps the Egypt option", but the `smart-prompt` visual is a single "full-width outlined teal button" (DESIGN Components smart-prompt) while behaviour says it lists "the live presets" (EXPERIENCE Component Patterns). *Fix:* state which; a list needs a layout in DESIGN.
- **[Low]** UJ-1 failure says the "Calculate under a country's law" link remains after dismissal, but PRD UJ-1 edge case says the prompt itself remains in the Share preview and Full results, and the smart-prompt row says dismissal "is remembered for the Case". *Fix:* reconcile with the PRD (collapse to a persistent one-line prompt rather than hide).

## 2. Token completeness — adequate

All YAML color tokens have hex values. Light/dark pairs exist for the 7 shipped tokens and the 3 mock-only tokens (those dark values are labelled assumption). `scrim` has no dark pair (acceptable). Every `{path.to.token}` in prose and in `components` resolves. The `badge:` fields use bare strings (`'badge-died-before'`), which are names, not `{components.…}` refs; a resolver will not follow them.

### Findings
- **[Medium]** Contrast targets are stated for light only, and one number is off: "about 4.9:1" for accent on accent-soft computes to 4.71:1 (still passes 4.5). No dark pair is stated: muted-dark on background-dark 8.94, accent-dark on surface-dark 12.0, accent-dark on accent-soft-dark 10.3 (all pass, but the contract is silent) (DESIGN Colors). *Fix:* correct to 4.7 and add one dark line.
- **[Medium]** `connector` (#8DA39A) defines the died-before border and the tree lines: 2.68:1 on white, 2.47:1 on surface (light); 3.03 and 2.72 in dark. Below the 3:1 non-text contrast of WCAG 1.4.11 for the state-defining dashed border, while NFR-1 requires AA. The text badge rescues meaning, not perceivability of the lines (DESIGN `connector`, `tree-card-died-before`, `tree-connector`). *Fix:* darken light connector (about #6B8077) and lighten the dark one, or record an explicit exemption.
- **[Medium]** `line` is 1.37:1 on white and is the boundary of `relationship-button`, `count-stepper` and form fields (shipped). Input boundaries need 3:1. Not addressed (DESIGN relationship-button, count-stepper, edit-sheet fields). *Fix:* name a stronger border token for inputs, or record the shipped debt.
- **[Medium]** No distinct treatment for errors or refusals. DESIGN says errors and refusals use the plain `notice` ("icon-free label"), so error, refusal, disclaimer and the offline line look identical (DESIGN Colors last paragraph; `notice`). A story-dev cannot style Preview error or Refusal distinctly. *Fix:* add a notice variant (heavier border or bold prefix word) or state they are identical on purpose.
- **[Medium]** Urdu type is load-bearing for UJ-4 but not tokenized: line height 1.7 is prose-only [ASSUMPTION] and the font is "not yet chosen" (DESIGN Typography, `body-rtl.note`). *Fix:* add a `body-ur` token and a default stack.
- **[Low]** Typography tokens omit lineHeight except `body` and `badge`; `heading-xl` (1.25rem) and `heading-lg` (1.125rem) are barely distinct. *Fix:* add lineHeight or note inheritance from `body`.
- **[Low]** Non-standard value syntax: `'currentColor at 60%'`, `'{colors.scrim} at 40%'`, `'{colors.foreground} at 60%'`, literal `rgba()` shadows and px sizes (108, 136, 76, 52, 18, 78%) outside a scale. *Fix:* one line stating `at N%` means alpha.
- **[Low]** Spacing tokens `'1'`,`'2'`,`'3'`,`'4'`,`'6'` are defined but never referenced; the scale looks complete while `5` and `8` are absent.

## 3. Component coverage — thin

Many names are shared exactly (relationship-button, count-stepper, tree-canvas, tree-card and its states, tree-card-placeholder, edit-sheet, heir-row, sticky-summary-bar, summary-sheet, smart-prompt, notice, badge-beta, undo-toast). The gap is the rest.

### Findings
- **[High]** EXPERIENCE Component Patterns rows with no DESIGN.Components row: `share-preview (desktop column)` (DESIGN has only `share-row`), `country-law link`, `school-prompt` (nearest is `choice-card`, not linked), `Case name field`, `Contact form`, `language switcher` (only inside `site-nav` prose), `Full results actions`. Also referenced but defined nowhere: the **death breadcrumb**, the "Updating" status, skeleton lines, the offline status line, the Shared case banner and version line, the "Still working" line, and the zoom toolbar (inline in `tree-canvas` only). A consumer styling these invents the look. *Fix:* add one-line DESIGN rows (reusing `notice` or secondary button) and cross-link names.
- **[Medium]** "Add relative here" (FR-2, the touch and keyboard alternative to drag) has no home: the tree-card row says tap opens the edit-sheet, whose field list has no such action, while Interaction Primitives says "tapping a node also offers" it (EXPERIENCE Component Patterns tree-card, edit-sheet; Interaction Primitives). *Fix:* name the component (node action menu or an edit-sheet action) and give it both rows.
- **[Medium]** The edit-sheet fields (name, relationship, "Died before the deceased", Delete) have no died-later control, so that state cannot be set (ties to section 1).  *Fix:* add the field or a separate path.
- **[Low]** DESIGN rows with no behavioural rule in EXPERIENCE: `button-primary/secondary`, `card`, `focus-ring`, `share-row`, `site-nav`, `site-footer`, `dialog`, `Full results table`, `choice-card`, `tree-connector`. Mostly shipped; listed so none is assumed to have a rule.
- **[Low]** Naming drift: "estate layer" / "death layer" / "later-death layer" / "died-later" versus PRD "later deaths" / "successive deaths"; "edit panel" has no token row.

## 4. State coverage — adequate

The State Patterns table is broad: empty, cold load, updating, error, refusal, impossible add, limit, undo, guest 24 h, expired, offline/slow, rate limited, not signed in, preset updated, Beta, contact sent. Focus, motion and RTL are covered in the Accessibility Floor and DESIGN.

### Findings
- **[Medium]** Offline is an unresolved assumption but behaviour-critical: the preview is server-calculated, so "changes are kept on this page and calculated when you reconnect" implies a client queue and undo interplay that is not committed (State Patterns Offline or slow, flagged [ASSUMPTION]). *Fix:* decide, or state that edits are blocked while offline.
- **[Medium]** No save feedback states: Save in progress, saved confirmation, save failure, PDF generating or failed, share link created or copied. UJ-2's resolution and the PDF steps of UJ-1, UJ-4 and UJ-7 depend on them (State Patterns; Full results actions). *Fix:* add rows (a toast or inline status suffices).
- **[Medium]** Surface states missing: My cases empty list and load failure; Shared case revoked or invalid (only "expired" is covered); Received/Invite invalid or already used; Contact form validation (only in UJ-5 failure) (IA vs State Patterns). *Fix:* add one-line rows.
- **[Low]** Disabled and limit visuals unspecified: count-stepper minus at 1, relationship buttons at 50 Heirs ("add buttons stop"): disabled look or pressable with a message? Drag-in-progress is a DESIGN assumption only.
- **[Low]** Hover is specified only for `button-secondary`; acceptable under "no hover-only affordances".

## 5. Visual reference coverage — adequate

Files: `mockups/`, `wireframes/`, `imports/` do not exist yet. `.working/` holds `key-interview-b-v2.html` (chosen), `layout-a-tree-canvas.html` (rejected), `layout-b-tree-beside-list.html` (v1, superseded), `research-family-tree-patterns.md`. Both spines link the chosen mock inline and state that spines win (DESIGN Brand & Style; EXPERIENCE intro). Layout A and B v1 are named as superseded but not linked; the research file is a path in code ticks, not a link. No effective orphans.

### Findings
- **[Medium]** Both spines link `.working/key-interview-b-v2.html`; DESIGN says it will be "promoted to `mockups/` at finalize". Links break at promotion unless both files are updated, and `.working/` is not a stable path for consumers. *Fix:* promote now, or add the link update to the finalize checklist.
- **[Low]** The mock covers only the Interview (phone and desktop, EN and AR). Full results, My cases, Contact us, API page and Landing have no visual reference by decision (memlog); DESIGN.md alone is their contract.

## 6. Bloat & overspecification — adequate

### Findings
- **[Low]** The Voice and Tone table carries 14 drafted Arabic strings; these are i18n content, not UX contract. Keep the owner-decided strings (deceased, died before, died later, no share, Same result) and move the rest to the translation files.
- **[Low]** DESIGN documents shipped unchanged components (Full results table, site-nav, site-footer, dialog) at length; one-line "unchanged, see `ui.ts`" rows would do.
- Otherwise lean: FRs are cited by id, not restated. About 20 `[ASSUMPTION]` tags are honest; several are load-bearing (sections 3, 4, 8) and read as open decisions rather than overspecification.

## 7. Inheritance discipline — strong

Sources resolve (PRD path and `./DESIGN.md` exist). UJ titles are verbatim. Cited FR ids exist (checked FR-14, 15, 19, 41, 42). Token refs resolve. PRD glossary terms (Case, Saved case, Case name, Deceased, Heir, Interview, Family tree, Share preview, Full results, School, Country law, Basis, Country preset, Obligatory bequest, Beta label, Locale, Ticket) are used with PRD meanings; EXPERIENCE has no glossary of its own and defers to the PRD, which is acceptable.

### Findings
- **[Low]** UI-only terms outside the PRD glossary: "Heirs list", "Add relatives", "school-prompt", "death breadcrumb", "country-law link". Define once or add to the PRD glossary so architecture and stories share one name.
- **[Low]** "The deceased" (UI label) deliberately differs from glossary "Deceased"; the Voice table says so. The Arabic form for a female deceased is still open (Gaps); one confirmed string is needed.

## 8. Shape fit — strong

DESIGN.md body is in canonical order (Brand & Style through Do's and Don'ts); frontmatter has name, description, colors, typography, rounded, spacing, components; extra `status/created/updated` keys are harmless. EXPERIENCE.md has every required default section in the examples' order, plus "Gaps and open items", which earns its place (records PRD divergences and unknowns).

### Findings
- **[High]** DESIGN Layout says three-column desktop at "1280px+" (380 / flexible / 340); EXPERIENCE Responsive says three columns from 1024px. At 1024px the tree column is about 256px (1024 − 2×24 − 380 − 340), narrower than two 136px cards, while the PRD requires the Deceased visible for 50 Heirs at 1280 (DESIGN Layout & Spacing; EXPERIENCE Responsive & Platform). *Fix:* pick one threshold (likely 1280 for three columns, with 1024 to 1279 using two columns or a sheet for the Share preview) and state it in both files.
- **[Medium]** The 640 to 1023px row says "summary bar stays", but DESIGN does not say the bar is full width on tablet, and the 108 versus 136px card switch point is unstated. *Fix:* one sentence each.
- **[Low]** The Accessibility Floor includes test-process intent (Playwright/axe) and a research citation; process content, not a shape violation.

## Mechanical notes

- UJ count 7/7 with named protagonist, numbered steps, climax and failure. All `{…}` refs resolve; no undefined token paths.
- Contrast computed by script (WCAG relative luminance): muted/background 7.56, accent-foreground/accent 5.47, accent-foreground-dark/accent-dark 9.78, accent/accent-soft 4.71, connector/background 2.68, connector/surface 2.47, line/background 1.37, muted-dark/background-dark 8.94.
- Folder contents: DESIGN.md, EXPERIENCE.md, .memlog.md, .working/{key-interview-b-v2.html, layout-a-tree-canvas.html, layout-b-tree-beside-list.html, research-family-tree-patterns.md}. No mockups/, wireframes/ or imports/.
- The mock HTML files were not opened; claims about them rely on the spines and memlog.
