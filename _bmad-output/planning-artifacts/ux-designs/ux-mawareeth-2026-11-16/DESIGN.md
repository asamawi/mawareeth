---
name: Mawareeth
description: Calm, plain, teal-on-green-grey identity for a careful Islamic inheritance calculation aid. Phase 2 documents the shipped look and adds the interactive Family tree, sticky summary bar and notices.
status: final
created: '2026-11-16'
updated: '2026-11-16'
colors:
  # Shipped tokens: web/src/app/[locale]/globals.css. Tailwind names: bg-accent, border-line, bg-surface, text-muted.
  background: '#FFFFFF'
  foreground: '#171717'
  muted: '#4B5563'
  surface: '#F2F7F5'
  line: '#D3DFD9'
  accent: '#0F766E'
  accent-foreground: '#FFFFFF'
  background-dark: '#0A0A0A'
  foreground-dark: '#EDEDED'
  muted-dark: '#A8B0AD'
  surface-dark: '#101A17'
  line-dark: '#25352F'
  accent-dark: '#5EEAD4'
  accent-foreground-dark: '#042F2E'
  # Added by the phase-2 mock (mockups/interview-layout-b.html); the shipped app has no value for these.
  # graphic replaces the mock's `connector`: >=3:1 against background and surface (computed, see Colors).
  graphic: '#76887F'
  accent-soft: '#E3F1EE'
  blocked-stripe: '#E8EFEC'
  scrim: '#171717'
  # Focus ring used inside the inverted undo-toast (ring = page background colour).
  toast-focus: '#FFFFFF'
  # [ASSUMPTION] dark pairs for the mock-only colors; derived, not in code or mock. graphic-dark is computed (3.80 on surface-dark).
  graphic-dark: '#5F7A6E'
  accent-soft-dark: '#0F2A26'
  blocked-stripe-dark: '#16231F'
  scrim-dark: '#000000'
  toast-focus-dark: '#0A0A0A'
typography:
  # System fonts only; no web font is loaded (layout.tsx, globals.css).
  body:
    fontFamily: 'system-ui, sans-serif'
    fontSize: 1rem
    fontWeight: '400'
    lineHeight: '1.5'
  body-rtl:
    fontFamily: '"Segoe UI", Tahoma, "Noto Naskh Arabic", "Geeza Pro", system-ui, sans-serif'
    note: 'Mock stack for Arabic and Urdu (both RTL). [ASSUMPTION] Production keeps system-ui; the named fonts are the fallback order if a platform lacks Arabic glyph quality. Urdu needs a Nastaliq or Naskh-capable fallback, not yet chosen.'
  heading-xl:
    fontFamily: 'system-ui, sans-serif'
    fontSize: 1.25rem
    fontWeight: '600'
  heading-lg:
    fontFamily: 'system-ui, sans-serif'
    fontSize: 1.125rem
    fontWeight: '600'
  label:
    fontFamily: 'system-ui, sans-serif'
    fontSize: 1rem
    fontWeight: '600'
  small:
    fontFamily: 'system-ui, sans-serif'
    fontSize: 0.875rem
    fontWeight: '400'
  node-name:
    fontFamily: 'system-ui, sans-serif'
    fontSize: 0.84rem
    fontWeight: '700'
  node-meta:
    fontFamily: 'system-ui, sans-serif'
    fontSize: 0.72rem
    fontWeight: '400'
  badge:
    fontFamily: 'system-ui, sans-serif'
    fontSize: 0.68rem
    fontWeight: '600'
    lineHeight: '1.3'
rounded:
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
  node: 10px
  sheet: 18px
  full: 9999px
spacing:
  # Tailwind 4px scale inherited; only named layout values listed.
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '6': 24px
  page-gutter: 24px
  page-gutter-mobile: 16px
  section-y: 48px
  section-y-md: 64px
  content-max: 1024px
  interview-max: 1360px
  tap-target: 44px
  interview-col-left: 380px
  interview-col-right: 340px
  # Breakpoints (shared with EXPERIENCE Responsive & Platform).
  breakpoint-wide-card: 640px
  breakpoint-two-col: 1024px
  breakpoint-three-col: 1280px
components:
  button-primary:
    background: '{colors.accent}'
    foreground: '{colors.accent-foreground}'
    radius: '{rounded.lg}'
    minHeight: '{spacing.tap-target}'
    padding: '12px 24px'
    typography: '{typography.label}'
  button-secondary:
    background: 'transparent'
    foreground: '{colors.foreground}'
    border: '1px solid {colors.line}'
    radius: '{rounded.lg}'
    minHeight: '{spacing.tap-target}'
    hover-background: '{colors.surface}'
  card:
    background: '{colors.surface}'
    border: '1px solid {colors.line}'
    radius: '{rounded.xl}'
    padding: '24px'
  focus-ring:
    outline: '2px solid {colors.accent}'
    offset: '2px'
  tree-canvas:
    background: '{colors.surface}'
    dot: '{colors.line}'
    dot-spacing: '18px'
    padding: '8px'
  tree-card:
    background: '{colors.background}'
    border: '1.5px solid {colors.graphic}'
    radius: '{rounded.node}'
    width: '108px'
    width-wide: '136px'
    minHeight: '76px'
    name: '{typography.node-name}'
    meta: '{typography.node-meta}'
  tree-card-deceased:
    background: '{colors.accent}'
    foreground: '{colors.accent-foreground}'
    border: '{colors.accent}'
    radius: '{rounded.node}'
  tree-card-died-before:
    background: '{colors.surface}'
    border: '2px dashed {colors.graphic}'
    dash: '4px dash, 3px gap'
    badge: '{components.badge-died-before}'
  tree-card-died-later:
    background: '{colors.background}'
    border: '2px solid {colors.accent}'
    badge: '{components.badge-died-later}'
  tree-card-blocked:
    background: 'repeating-linear-gradient(135deg, {colors.surface} 0 6px, {colors.blocked-stripe} 6px 12px)'
    border: '1.5px solid {colors.graphic}'
    foreground: '{colors.muted}'
    badge: '{components.badge-no-share}'
  tree-card-placeholder:
    background: 'transparent'
    border: '1.5px dashed {colors.accent}'
    foreground: '{colors.accent}'
    typography: '{typography.label}'
  tree-connector:
    stroke: '{colors.graphic}'
    width: '2px'
  badge-died-before:
    border: '1px dashed {colors.graphic}'
    foreground: '{colors.foreground}'
    background: '{colors.background}'
    radius: '{rounded.full}'
    typography: '{typography.badge}'
  badge-died-later:
    border: '1px solid {colors.accent}'
    foreground: '{colors.accent}'
    background: '{colors.accent-soft}'
    radius: '{rounded.full}'
    typography: '{typography.badge}'
  badge-no-share:
    border: '1px solid {colors.graphic}'
    foreground: '{colors.muted}'
    background: '{colors.background}'
    radius: '{rounded.full}'
    typography: '{typography.badge}'
  badge-beta:
    border: '1px solid {colors.accent}'
    foreground: '{colors.accent}'
    background: '{colors.accent-soft}'
    radius: '{rounded.full}'
    typography: '{typography.badge}'
  relationship-button:
    background: '{colors.background}'
    border: '1px solid {colors.graphic}'
    radius: '{rounded.node}'
    add-background: '{colors.accent}'
    add-foreground: '{colors.accent-foreground}'
    add-radius: '{rounded.lg}'
    minHeight: '{spacing.tap-target}'
  count-stepper:
    button-background: '{colors.surface}'
    border: '1px solid {colors.graphic}'
    radius: '{rounded.lg}'
    button-size: '{spacing.tap-target}'
    value-weight: '700'
  heir-row:
    border-top: '1px solid {colors.line}'
    minHeight: '52px'
    meta-foreground: '{colors.muted}'
  share-row:
    border-top: '1px solid {colors.line}'
    value-weight: '700'
    dim-foreground: '{colors.muted}'
  sticky-summary-bar:
    background: '{colors.background}'
    border-top: '2px solid {colors.foreground}'
    shadow: '0 -6px 16px rgba(0,0,0,.12)'
    minHeight: '{spacing.tap-target}'
    width: 'full viewport width at every breakpoint below 1280px'
    reflow: 'under 360px wraps to two rows: text above, button and chevron below'
  summary-sheet:
    background: '{colors.background}'
    border-top: '2px solid {colors.foreground}'
    radius: '{rounded.sheet} {rounded.sheet} 0 0'
    shadow: '0 -8px 24px rgba(0,0,0,.2)'
    max-height: '78%'
    scrim: '{colors.scrim} at 40%'
  edit-sheet:
    background: '{colors.background}'
    border-top: '2px solid {colors.foreground}'
    radius: '{rounded.sheet} {rounded.sheet} 0 0'
  smart-prompt:
    background: '{colors.accent-soft}'
    border: '1px solid {colors.accent}'
    border-start-width: '5px'
    radius: '{rounded.node}'
    action-foreground: '{colors.accent}'
  notice:
    border: '1px solid {colors.foreground} at 60%'
    radius: '{rounded.md}'
    padding: '12px'
  undo-toast:
    background: '{colors.foreground}'
    foreground: '{colors.background}'
    radius: '{rounded.lg}'
    focus-ring: '2px solid {colors.toast-focus}'
    focus-ring-dark: '2px solid {colors.toast-focus-dark}'
    pause: 'timer pauses on hover and focus'
  undo-control:
    background: 'transparent'
    foreground: '{colors.foreground}'
    border: '1px solid {colors.foreground} at 60%'
    radius: '{rounded.lg}'
    minHeight: '{spacing.tap-target}'
  heirs-list-header:
    border-bottom: '1px solid {colors.line}'
    minHeight: '{spacing.tap-target}'
    typography: '{typography.label}'
  death-breadcrumb:
    background: '{colors.surface}'
    border-bottom: '1px solid {colors.graphic}'
    link-foreground: '{colors.accent}'
    current-foreground: '{colors.foreground}'
    current-weight: '600'
    separator: 'chevron, mirrored in RTL, aria-hidden'
    minHeight: '{spacing.tap-target}'
    typography: '{typography.small}'
  add-relative-action:
    background: '{colors.accent}'
    foreground: '{colors.accent-foreground}'
    radius: '{rounded.lg}'
    minHeight: '{spacing.tap-target}'
  share-preview:
    background: '{colors.background}'
    border-inline-start: '1px solid {colors.line}'
    padding: '24px'
    width: '{spacing.interview-col-right}'
  school-prompt:
    group: '{components.choice-card}'
    radius: '{rounded.node}'
    padding: '12px'
  country-law-link:
    foreground: '{colors.accent}'
    underline: 'always'
    minHeight: '{spacing.tap-target}'
  country-law-list:
    item: '{components.choice-card}'
    badge: '{components.badge-beta}'
  case-name-field:
    border: '1px solid {colors.muted}'
    radius: '{rounded.lg}'
    minHeight: '{spacing.tap-target}'
  contact-form:
    field: '{components.case-name-field}'
    submit: '{components.button-primary}'
    error-foreground: '{colors.foreground}'
  language-switcher:
    current-weight: '600'
    item-minHeight: '{spacing.tap-target}'
  status-line:
    foreground: '{colors.muted}'
    typography: '{typography.small}'
    border: '1px solid {colors.graphic}'
    radius: '{rounded.md}'
    padding: '8px 12px'
  shared-case-banner:
    background: '{colors.accent-soft}'
    border: '1px solid {colors.accent}'
    radius: '{rounded.node}'
    padding: '12px'
  skeleton-line:
    background: '{colors.line}'
    radius: '{rounded.sm}'
    height: '12px'
  zoom-toolbar:
    button: '{components.button-secondary}'
    gap: '8px'
  full-results-actions:
    primary: '{components.button-primary}'
    others: '{components.button-secondary}'
    gap: '12px'
  choice-card:
    border: '2px solid currentColor at 60%'
    checked-border: '2px solid currentColor'
    checked-background: 'currentColor at 10%'
    radius: '{rounded.lg}'
    minHeight: '{spacing.tap-target}'
  site-nav:
    border-bottom: '1px solid currentColor at 20%'
    padding: '12px 24px'
  site-footer:
    background: '{colors.surface}'
    border-top: '1px solid {colors.line}'
    padding: '32px 24px'
---

## Brand & Style

Mawareeth looks like a careful reference, not a product pitch. Surfaces are white or a faint green-grey, text is near-black, and one teal accent marks the thing to press or read next. The owner's verdict on the shipped look is "okay", so phase 2 keeps it and adds only what the interactive Family tree needs. This file documents the code in `web/src/app/[locale]/` and the chosen Interview mock. Where they differ, the mock is the target for the Interview. The code stays the reference everywhere else (Full results, My cases, Contact us, API page, legal pages).

The posture is calm and plain: no ornament, no illustration, no celebratory motion. The subject is death and money in a family, so the interface stays quiet. Mawareeth is a calculation aid, never a fatwa, and the look never claims authority it does not have. Beta labels and notices stay visible.

Dark mode follows the system setting (`prefers-color-scheme`); there is no manual toggle in the shipped app.

Visual references (the spines win on any conflict):
- Chosen Interview layout (phone and desktop, Arabic RTL, all card states): [mockups/interview-layout-b.html](mockups/interview-layout-b.html).
- Superseded, not to be built: `layout-a-tree-canvas.html` (rejected) and `layout-b-tree-beside-list.html` (v1; it wrongly labelled the Deceased as Father or Mother).

## Colors

Defined in `globals.css` as CSS variables, exposed to Tailwind as `accent`, `accent-foreground`, `surface`, `line` (the `--border` variable) and `muted`. Dark values apply under `prefers-color-scheme: dark`.

- **Accent teal (`{colors.accent}` light, `{colors.accent-dark}` dark).** The single brand color. Primary buttons, focus ring, the deceased card, "add" buttons on relationship chips, the "Died later" outline, the Beta label and the smart prompt edge. Not used for destructive actions or for errors.
- **Foreground and background.** Body text and page. Also the outline of the summary bar and sheets, and the fill of the undo toast (inverted).
- **Surface (`{colors.surface}`).** Green-grey panel: cards, footer, the tree canvas, secondary-button hover.
- **Line (`{colors.line}`).** Decorative hairlines only: row dividers, canvas dots, card and footer edges. It is 1.37:1 on white, so it never carries a boundary that must be perceived.
- **Muted (`{colors.muted}`).** Secondary text, hints, "No share in this case" rows. 7.56:1 on `{colors.background}` in light, 8.94:1 in dark (4.5:1 required).
- **Graphic (`{colors.graphic}` light, `{colors.graphic-dark}` dark).** Every non-text boundary that must be seen (WCAG 1.4.11, 3:1): tree connectors, the dashed died-before border, tree-card, blocked-card, relationship-button and count-stepper borders, the badge-died-before and badge-no-share borders. Replaces the mock's `connector`. Computed: light 3.75:1 on background, 3.46:1 on surface, 3.23:1 on accent-soft; dark 4.24:1 on background-dark, 3.80:1 on surface-dark, 3.26:1 on accent-soft-dark. Dashes are coarse (4px dash, 3px gap) so they survive 400% zoom.
- **Accent soft (`{colors.accent-soft}`).** Tint behind the Beta label, the Died-later badge and the smart prompt.
- **Blocked stripe (`{colors.blocked-stripe}`).** Second stripe colour of the blocked card; decorative, the text badge carries the meaning.
- **Toast focus (`{colors.toast-focus}` light, `{colors.toast-focus-dark}` dark).** The focus ring of controls inside the inverted undo-toast: the page background colour, so it is 17.93:1 on the light toast fill and 16.91:1 on the dark one. The accent ring would be 1.26:1 on the dark toast.
- **Scrim.** `{colors.scrim}` at 40% in light; `{colors.scrim-dark}` at 60% in dark (a light scrim does not dim a dark page).

Load-bearing contrast (computed from the hex values with the WCAG relative-luminance formula):

| Pair | Light | Dark | Needs |
|---|---|---|---|
| foreground on background | 17.93 | 16.91 | 4.5 |
| muted on background | 7.56 | 8.94 | 4.5 |
| accent-foreground on accent (button, deceased card) | 5.47 | 9.78 | 4.5 |
| accent text on background | 5.47 | 13.4 | 4.5 |
| accent text on surface | 5.06 | 12.01 | 4.5 |
| accent text on accent-soft (badges, smart prompt) | 4.71 | 10.29 | 4.5 |
| graphic on background / surface | 3.75 / 3.46 | 4.24 / 3.80 | 3 |
| accent ring and borders on background / surface | 5.47 / 5.06 | 13.4 / 12.01 | 3 |
| toast-focus on toast fill | 17.93 | 16.91 | 3 |

Accent on accent-soft has the least margin (4.71:1), so keep `{typography.badge}` text on that pair at its stated size or larger, never smaller, and do not tint the fill.

Meaning is never carried by colour alone: every tree state also has a border style and a text badge (see Components).

The shipped app uses no red/green/amber status colours. There is no error colour token in the code (errors are plain text with `role="alert"`). [ASSUMPTION: phase 2 adds none; error and refusal states use the notice component with text and an icon-free label.]

## Typography

System fonts only. Body is `{typography.body}`; the app loads no web font. Headings are the same family at weight 600: page and section titles `{typography.heading-xl}`, panel titles `{typography.heading-lg}`, labels and buttons `{typography.label}`, helper text `{typography.small}`.

Tree and badge text is smaller (`{typography.node-name}`, `{typography.node-meta}`, `{typography.badge}`) and appears only inside cards and badges.

Arabic and Urdu are both RTL. Every font stack must include an Arabic-capable face; `{typography.body-rtl}` lists the mock's fallback order. Urdu in Nastaliq is wider and taller than Naskh, so line height for Urdu is raised [ASSUMPTION: 1.7]. The Urdu font is an open item. Direction, `lang` and `<bdi>` markup, and number formats (FR-24), are in EXPERIENCE.md Accessibility Floor. An Arabic term shown beside a translation carries `lang="ar" dir="rtl"` on its own `<bdi>`; an English fallback string carries `lang="en"`.

## Layout & Spacing

Spacing is the Tailwind 4px scale. Public pages sit in `{spacing.content-max}` (`max-w-5xl`) with `{spacing.page-gutter}` side padding and `{spacing.section-y}` / `{spacing.section-y-md}` vertical rhythm. The shipped interview is a single column at `max-w-xl`.

Phase-2 Interview (layout B):
- **Below `{spacing.breakpoint-two-col}` (1024px):** one column with a `{spacing.page-gutter-mobile}` gutter. Order: Add relatives (relationship buttons grouped Spouse, Parents, Children, Siblings, More relatives), the Family tree on its dotted canvas, the Heirs list. The Share preview is not in the flow; it lives in the sticky summary bar and its expanded sheet. The bar is full viewport width at every width in this range. Tree cards are 108px wide below `{spacing.breakpoint-wide-card}` (640px) and 136px from 640px up.
- **1024px to 1279px:** two columns, `{spacing.interview-col-left}` (relationship buttons and Heirs list) · flexible tree (at least 596px, so two 136px cards fit side by side). The Share preview stays in the sticky summary bar and its sheet; there is no third column.
- **1280px and up:** three columns, `{spacing.interview-col-left}` · flexible (tree) · `{spacing.interview-col-right}` (Share preview), inside `{spacing.interview-max}`. No sticky bar. Column dividers are 1px `{colors.line}`.
- **Reflow:** at 320px the sticky bar wraps into two rows (text above; Full results and chevron below). At 400% zoom (a 320px viewport) bar plus toast are capped at 25% of the viewport height, and the page uses `scroll-padding-block-end` equal to their combined height so a focused card or heir is never hidden behind them. The page scrolls; only the tree-canvas is a nested, labelled 2D scroll region. In a phone landscape viewport under 480px high the bar is replaced by a "Share preview" button in the flow. The canvas keeps at least 6px padding so focus rings are not clipped.
- Every interactive target is at least `{spacing.tap-target}` (44px), matching `min-h-11` in the shipped buttons.
- Use logical properties only (`ms-`, `ps-`, `start-0`, `inset-inline-*`, `border-inline-*`). No `left`/`right`.

## Elevation & Depth

Flat by default: depth comes from 1px lines and `{colors.surface}` panels, not shadows. Two exceptions, both from the mock: the sticky summary bar carries `{components.sticky-summary-bar.shadow}`, and the open summary sheet / edit sheet carry `{components.summary-sheet.shadow}` over a 40% `{colors.scrim}`. The shipped sign-in dialog uses a black 50% backdrop. [ASSUMPTION: dark mode keeps the same shadows; they are barely visible and the 2px foreground outline carries the separation.] Selected-card emphasis is a 3px outline, not a shadow. Motion is specified in EXPERIENCE.md Interaction Primitives.

## Shapes

Radii used in code: `{rounded.sm}` (inline link focus), `{rounded.md}` (list rows, notices, the tree scroll area), `{rounded.lg}` (buttons, choice cards, tree cards in the shipped tree), `{rounded.xl}` (cards). Mock-only: `{rounded.node}` for phase-2 tree cards and relationship chips, `{rounded.sheet}` top corners for bottom sheets, `{rounded.full}` for badges and the "illustrative" pill. Sheets round only their top corners.

## Components

> Visual reference for the Interview components: [mockups/interview-layout-b.html](mockups/interview-layout-b.html). Where the mock and this document differ, this document wins.

Visual specs only. Behaviour is in EXPERIENCE.md Component Patterns, under the same names. Class strings for shared pieces live in `web/src/app/[locale]/ui.ts` (`primaryButton`, `secondaryButton`, `cardClass`, `focusRing`).

- **button-primary / button-secondary.** Teal fill with white text, or 1px line with surface hover. 44px minimum height, `{rounded.lg}`, label weight 600. One primary button per view region. Full results is a `button-primary`, not a text link (FR-11).
- **card.** `{colors.surface}` with a line border and `{rounded.xl}`; the landing and info blocks.
- **focus-ring.** 2px accent outline, 2px offset, on every focusable element (`focus-visible`). The mock uses 3px; the shipped 2px is the contract. On accent fills (the deceased card) the ring uses `currentColor` or foreground so it stays visible; inside the undo-toast it uses `{colors.toast-focus}`. The ring is an `outline`, never a `box-shadow`, and is not clipped by overflow containers.
- **tree-canvas.** `{colors.surface}` with a dotted `{colors.line}` grid, 18px spacing, 1px line above and below, at least 6px padding on every logical side. Holds tree-connectors (2px `{colors.graphic}`) and cards. In RTL only the connector layer is mirrored (`scale-x-[-1]`); cards are placed by logical order, so text and badges are never mirrored. The zoom-toolbar sits above the canvas, with a hint line.
- **zoom-toolbar.** Fit tree, plus and minus: 44px secondary buttons in a row with an 8px gap; the zoom level is announced on change.
- **tree-card (normal).** White card, 1.5px `{colors.graphic}` border, `{rounded.node}`, 108px wide (136px from 640px up), at least 76px tall. Every card is a native button. Shows the relationship label (bold) and the name (small) when a name exists, otherwise the default label such as "Son 2". No avatar or initials (memlog).
- **tree-card-deceased.** Teal fill, white text, reads only "The deceased" / "المتوفى". It is never labelled Father, Mother or by relationship, and carries no symbol of any kind.
- **tree-card-died-before.** Dashed 2px `{colors.graphic}` border on `{colors.surface}` plus `badge-died-before` ("Died before" / "توفي قبله"). The dashed line plus text carries the meaning; no icon. The person is not an heir, but their descendants may hang below.
- **tree-card-died-later.** Solid 2px teal border plus `badge-died-later` ("Died later · own estate ›" / "توفيت لاحقاً · تركة مستقلة ›"). The trailing chevron is an `aria-hidden` icon that mirrors in RTL. The Arabic gender form follows the person. It differs from died-before by border style, fill and badge text.
- **death-breadcrumb.** A row directly above the tree-canvas, shown only inside a later-death estate: "The deceased › Wife's estate" / "المتوفى › تركة الزوجة". Earlier levels are accent text links (44px high), the current level is semibold foreground text and not a link; separators are mirrored chevrons, `aria-hidden`. The row sits in a `nav` labelled "Estate level". At most three levels (the deceased plus two later deaths).
- **tree-card-blocked.** Diagonal stripe in surface and blocked-stripe on the card edge, with the name and badge on a solid surface plate, muted text, `badge-no-share` ("No share in this case" / "لا نصيب في هذه الحالة"). The meaning is stated in text; the stripe is secondary.
- **tree-card-placeholder.** Dashed teal outline, teal text, "+ Add parent" / "+ إضافة أحد الوالدين". An empty slot.
- **Selected state.** 3px outline in `currentColor`, inset, on any tree card; the heir being edited keeps it (as shipped). The card also has `aria-current="true"`, so the state is not visual only.
- **Drop target state.** [ASSUMPTION] While dragging, a legal drop target shows a 2px solid teal border; an illegal one is dimmed. Not in the mock or the code.
- **relationship-button.** A pill-row: a teal "Son +" add button (44px, `{rounded.lg}`) inside a 1px `{colors.graphic}` outlined `{rounded.node}` wrapper, followed by the count-stepper. Wrappers wrap onto lines.
- **count-stepper.** Minus button, a live count (`<output>`, 700 weight), plus button; each button 44px square on `{colors.surface}` with a `{colors.graphic}` border.
- **heirs-list-header.** The Heirs list heading row with the persistent undo-control at its inline end (hidden when there is nothing to undo).
- **undo-control.** A 44px outlined secondary button "Undo last change" in the heirs-list-header.
- **heir-row.** One row per Heir, 52px minimum, hairline top border, label with muted relationship below, an Edit button (44px). A blocked Heir's label is muted.
- **share-row.** Label (with optional muted sub-line such as "Residue, 2 parts") and a bold value, right-aligned in LTR and left-aligned in RTL (`text-align: end`). Blocked Heirs show a dimmed row with a smaller value. The line "Same result in all four Sunni schools" is teal text above the rows.
- **sticky-summary-bar.** Fixed to the bottom of the viewport below 1280px, full width: "6 heirs · shares ready", a primary "Full results" button and a 44px chevron toggle. 2px foreground top border and shadow. Under 360px it wraps to two rows.
- **summary-sheet.** The expanded Share preview: rounded top corners, 78% max height, scrim behind. Its title bar reads "Share preview" with a Close button, a hairline bottom border and no shadow.
- **edit-sheet.** On phone, the same surface as summary-sheet. On desktop, the same fields sit in a right-column edit panel. Fields use the shipped form styling (`form-bits.tsx`): label above input, 44px minimum. Below the fields sit the `{components.add-relative-action}` and, for a died-later person, "Open own estate".
- **add-relative-action.** The "Add relative here" button: 44px, teal fill, in the edit-sheet and panel and on every focused tree-card's action row; the same label and look everywhere.
- **share-preview.** The desktop third column: white, 24px padding, inline-start 1px line, 340px wide at 1280px and up. Holds share-rows, the "Same result" line, the country-law-link, `badge-beta`, a notice and a primary Full results button. The summary-sheet shows the same content.
- **school-prompt.** Shown only when the Schools differ: a group of choice-cards (one per School) in a `{rounded.node}` box with 12px padding and a short question line above.
- **country-law-link.** Teal underlined text "Calculate under a country's law", 44px high.
- **country-law-list.** A stack of choice-cards (one per live Country preset, with `badge-beta` where unreviewed) and a "Back to all four Schools" secondary button.
- **case-name-field.** Shipped text input styling with a 1px `{colors.muted}` border (an input boundary needs 3:1; `{colors.line}` fails it), label above, 100-character counter in `{typography.small}`.
- **contact-form.** Stack of labelled fields (topic select, message, email, optional Case link) using the case-name-field input style, inline plain-text errors, one primary submit.
- **language-switcher.** The nav language list: each name in its own script, current semibold with `aria-current`, each item 44px high; each item carries its own `lang` and `dir`.
- **status-line.** One-line muted text in a 1px `{colors.graphic}` box. Variants: Updating, "Still working", and offline ("You're offline..."). Plain text, no icon, no animation under reduced motion.
- **shared-case-banner.** `{colors.accent-soft}` box with a 1px teal border at the top of the Shared case.
- **skeleton-line.** 12px bars in `{colors.line}` in the shape of the layout; a shimmer, off under reduced motion.
- **full-results-actions.** Row of Download PDF (primary), Save, Share link, WhatsApp (secondary), wrapping with 12px gaps.
- **smart-prompt.** `{colors.accent-soft}` box, 1px teal border, 5px teal inline-start edge, `{rounded.node}`, body text, a list of the live Country presets as outlined teal buttons (full width, 44px, one per preset) and a "Not now" 44px text button.
- **notice.** 1px border at 60% foreground, `{rounded.md}`, 12px padding, semibold text for the disclaimer. Plain text only; an optional `badge-beta` sits beside the title. Notice types are in EXPERIENCE.md.
- **badge-beta.** Teal outline pill, soft teal fill. Text "Beta"; the reason is in the nearby notice (FR-20, FR-29). [ASSUMPTION: the exact pill label text per Locale is "Beta" / "تجريبي".]
- **undo-toast.** Inverted foreground-on-background bar near the bottom edge, above the sticky bar on phone, with a text "Undo" button. Its focus ring is `{colors.toast-focus}` (2px, at least 3:1 in both modes).
- **choice-card.** The shipped School and radio option: 2px border at 60% current colour, checked is full border and 10% tint, 44px minimum, focus ring on `:has-focus-visible`.
- **site-nav / site-footer.** Nav: wrapped links, 1px bottom border at 20% current colour, home link semibold, language list showing each language in its own script, current language semibold with `aria-current`. Footer: surface band, links underlined, note in muted. Contact us, API and WhatsApp links join the footer in the same style (FR-36, FR-39).
- **Full results table.** The shipped `inheritance-table.tsx`: bordered table with a screen-reader caption, active row at 10% current colour, dotted-underline buttons for proof steps, fractions in `<bdi dir="ltr">`. The Obligatory bequest line is its own row with an article citation in small text. Unchanged visually.
- **dialog.** The shipped sign-in dialog is `bg-white text-black` with a 50% black backdrop. [ASSUMPTION: phase 2 should make it follow `{colors.background}` and `{colors.foreground}` so dark mode is not a white box; flagged for implementation.]

## Do's and Don'ts

| Do | Don't |
|---|---|
| Label the deceased card "The deceased" or "المتوفى" in every Locale, in the tree, the list, the outline and the PDF | Label the deceased "Father", "Mother" or by relationship, or by a placeholder name |
| Mark died-before with a dashed card plus the text badge "Died before" | Use a cross, crescent, ribbon, candle, black band or any religious or funerary symbol for death. This is a Muslim calculator |
| Mark died-later with a solid teal card plus the text badge "Died later · own estate" | Mark died-before and died-later with the same style, or by colour alone |
| Mirror the connector layer and every directional chevron in RTL; place cards by logical order and use logical properties (`start`, `end`, `inset-inline`) | Hard-code `left`/`right`, leave arrows, steppers and the SVG connectors un-mirrored, or flip the whole tree with a transform (it mirrors text and badges; the shipped `rtl:-scale-x-100` on the tree is replaced) |
| Draw every line or border that must be seen in `{colors.graphic}` (3:1 or more) | Use `{colors.line}` for a connector, card edge or input boundary |
| Use an Arabic-capable font in every stack and set `lang` and `dir` per Locale; wrap fractions, amounts and typed names in `<bdi>` | Rely on a Latin-only font, or let an RTL fraction reorder |
| Keep all targets at 44px or larger and keep the focus ring visible on every control | Shrink the tree cards or steppers below 44px to fit more people; hide the ring |
| Show every state in text as well as style (badge, label, "No share in this case") | Convey blocked, died-before or beta by colour or stripe alone |
| Keep the Beta label and the "calculation aid, not a fatwa" notice visible wherever they apply | Remove or collapse them to make a screen cleaner |
| Use the teal accent for the next action and for state edges | Introduce a second brand colour, status reds or greens, gradients or illustration |
| Keep Full results a primary button, and the single primary action in its region | Put Full results as a text link under the table |
| Give the tree no initials avatar and no gendered colour frames | Add photos, avatars or gender-coloured frames (the research pattern was rejected) |
| Respect `prefers-reduced-motion` and `prefers-color-scheme` | Animate node motion for reduced-motion users, or ship a light-only dialog |
