# UX Consistency Patterns

## Button Hierarchy

**Three-tier button system across all screens:**

| Tier | Style | Usage | Example |
|------|-------|-------|---------|
| **Primary** | Navy fill (`--primary`), white text, `shadow-sm` | One per screen — the single most important action | "Start Calculation", "Add Heir", "Download PDF" |
| **Secondary** | White fill, navy border, navy text | Supporting actions alongside primary | "Back", "Edit Tree", "Save as Preliminary" |
| **Ghost** | No fill, no border, navy text, underline on hover | Tertiary or navigational actions | "Skip", "Learn more", "View audit trail" |

**Button Rules:**
- Maximum ONE primary button visible at a time — forces clear hierarchy
- Primary button always answers "What should I do next?"
- Amber accent (`--accent`) reserved exclusively for certification actions ("Certify", "Mawareeth-Certified" badge)
- Destructive actions (delete heir, remove case) use `--destructive` with confirmation dialog
- All buttons: min-height 44px, `radius-sm` (4px), `font-weight: 500`, 150ms hover transition
- Mobile: full-width primary buttons, stacked layout for primary + secondary pairs

**Interview-Specific Button Patterns:**
- "Add Heir" = Primary inside HeirAdder card
- "Done Adding Heirs" = Secondary, appears after 1+ heirs added
- "Back" = Ghost with left arrow, always top-left of interview card

## Feedback Patterns

**Toast Notifications (non-blocking):**

| Type | Color | Icon | Duration | Usage |
|------|-------|------|----------|-------|
| **Success** | `--success` green left border | Checkmark | 3s auto-dismiss | "Heir added", "Case saved", "PDF downloaded" |
| **Error** | `--destructive` red left border | Alert triangle | Persistent until dismissed | "Network error — your progress is saved locally" |
| **Info** | `--info` blue left border | Info circle | 5s auto-dismiss | "Auto-saved", "Shares recalculated" |

**Inline Validation (within forms):**
- **Valid input:** Green checkmark appears to the right of the field (subtle, no border change)
- **Invalid input:** Red border + red text below field with fiqh-aware explanation
- **Pattern:** Never just "Invalid input." Always explain *why* from Islamic legal context: "A deceased person cannot have two living fathers according to kinship rules"
- Validation triggers on blur (not on keystroke) to reduce cognitive noise

**Fiqh-Aware Error Pattern:**
Every validation error that relates to Islamic inheritance rules follows this structure:
1. **What's wrong** — plain language ("This heir combination isn't valid")
2. **Why** — fiqh reference ("According to [Madhab], a deceased cannot have...")
3. **What to do** — clear action ("Would you like to edit the relationship?")

**Tree Feedback (visual, no text):**
- Heir added → node animates in with 200ms fade + scale, SVG connector draws
- Share recalculated → amber pulse ripple across affected nodes (300ms)
- Heir removed → node fades out, tree reflows smoothly (300ms)
- Error state → node border turns red with gentle shake (200ms)

**Empty States:**
- **Empty tree** (interview start): Single deceased node centered with pulsing ring + "Add your first heir" prompt in the floating card
- **Empty dashboard** (Layla, no cases): Centered message: "No cases yet. Start your first calculation." + Primary CTA
- **No search results** (dashboard filter): "No cases match your search. Try different filters."

## Form Patterns

**Guided Interview Form Rules:**

| Pattern | Implementation |
|---------|---------------|
| **One question per view** | Each interview step shows one form group. Never multiple unrelated inputs on screen. |
| **Smart defaults** | Pre-fill where possible: Madhab based on region, gender based on relationship type (wife → female) |
| **Label position** | Labels above inputs (not inline placeholders). Placeholder text for format hints only ("e.g., Ahmad") |
| **Required fields** | All interview fields are required — no optional markers needed. If truly optional, mark with "(optional)" suffix |
| **Input sizing** | Full-width inputs within the floating card. No side-by-side fields on mobile. Desktop: side-by-side only for name + gender |
| **Select vs. Radio** | 2-3 options → Radio buttons (visible choices). 4+ options → Select dropdown. Madhab (5 options) → Radio with descriptions |

**Form Submission Pattern:**
- Primary button at bottom of floating card: "Add Heir" / "Next" / "Calculate"
- Button disabled until form is valid (with `aria-disabled` + tooltip explaining what's missing)
- On submit: button shows brief loading spinner (200ms minimum to feel intentional), then success feedback

**RTL Form Considerations:**
- Labels align to the start (right in Arabic, left in English)
- Input text direction follows content language, not UI language
- Error messages appear below and aligned to start
- Select dropdown opens in the correct direction

## Navigation Patterns

**Global Navigation (minimal chrome):**
- **Top bar:** Mawareeth logo (left/start) + Language switcher (right/end) — transparent background over tree
- **No hamburger menu** — the product is single-purpose; no navigation complexity needed
- **Dashboard access:** Logo click returns to dashboard (if authenticated) or landing page (if not)

**Interview Navigation:**
- **Back:** Ghost button with arrow, always available, top-left of floating card
- **Progress:** Minimal dot stepper in top-right corner of viewport (not inside card)
- **Exit interview:** "X" in card header → confirmation dialog ("Your progress is saved. Leave interview?")

**Tree Navigation:**
- **Pan:** Click-and-drag on desktop, touch-drag on mobile
- **Zoom:** Scroll wheel on desktop, pinch on mobile
- **Fit-to-view:** Double-click/double-tap on empty area resets zoom to fit entire tree
- **Node selection:** Single click/tap highlights node + shows details in floating card

**Keyboard Navigation:**
- `Tab` moves between interactive elements in the floating card
- `Arrow keys` navigate between tree nodes when tree is focused
- `Enter` on a tree node opens its details
- `Escape` closes any overlay or returns to previous state

## Loading & Transition Patterns

**Loading States:**
- **Initial page load:** Skeleton of tree viewport + floating card outline (< 1s target)
- **Calculation processing:** Tree nodes show subtle pulse animation while API responds (< 200ms standard, < 1s Manasikhat)
- **PDF generation:** Progress bar in toast notification ("Generating your court-ready report...")

**Transition Animations (all respect `prefers-reduced-motion`):**

| Transition | Duration | Easing | Usage |
|-----------|----------|--------|-------|
| Node enter | 200ms | ease-out | New heir added to tree |
| Node exit | 150ms | ease-in | Heir removed from tree |
| Tree reflow | 300ms | ease-in-out | Layout adjustment after add/remove |
| Card slide | 200ms | ease-out | Interview card appears/transforms |
| Share update | 300ms | ease-in-out | Badge values recalculate |
| Page transition | 150ms | ease-out | Landing → Interview, Interview → Results |

**Rule:** No animation exceeds 300ms. No decorative animations. Every animation communicates state change.
