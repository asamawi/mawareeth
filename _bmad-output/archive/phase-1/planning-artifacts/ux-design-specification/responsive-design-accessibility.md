# Responsive Design & Accessibility

## Responsive Strategy

**Dual-Context Philosophy:** Mawareeth serves two distinct device contexts — mobile heirs (Sami) and desktop professionals (Layla/Mustafa). Rather than a single responsive scale, we design two optimized experiences connected by the same Guided Interview engine.

**Desktop (1024px+) — Professional Context:**
- Full-viewport family tree with SVG connector lines, maximum visual impact
- Floating interview card: fixed bottom-left, max-width 400px
- Heir nodes: 64px circles with name, relationship, and share badge
- Side-by-side form fields where natural (name + gender)
- Dashboard: case list with inline status badges and quick actions
- PDF preview: split-view (tree left, report right)

**Tablet (768px - 1023px) — Hybrid Context:**
- Family tree takes top 60% of viewport
- Interview card expands to full-width bottom panel (bottom sheet style)
- Tree nodes scale to 48px circles
- Single-column form layout within bottom panel
- Dashboard: card-based case list, stacked vertically
- Touch-optimized: all targets 48px minimum

**Mobile (375px - 767px) — Heir Context:**
- Family tree: scrollable top section, simplified vertical cascade layout
- Interview card: fixed bottom sheet (40% viewport), swipeable up/down
- Nodes: 40px circles, relationship text below, share fractions on tap
- All form fields full-width, stacked vertically
- "Expand tree" gesture: swipe up to see full tree, down to return to interview
- Dashboard (if logged in): simple vertical case list with large touch targets

## Breakpoint Strategy

| Breakpoint | Tailwind Class | Target | Layout Shift |
|-----------|---------------|--------|-------------|
| 375px | `min-w-[375px]` | Mobile baseline | Single column, bottom sheet interview |
| 768px | `md:` | Tablet | Tree/panel split, bottom panel interview |
| 1024px | `lg:` | Desktop | Full viewport tree, floating card overlay |
| 1440px | `xl:` | Wide desktop | Max content width, generous margins |

**Approach:** Mobile-first CSS with Tailwind's responsive prefixes. Base styles target 375px, progressive enhancement adds complexity at each breakpoint.

**Critical Responsive Components:**

| Component | Mobile | Tablet | Desktop |
|-----------|--------|--------|---------|
| FamilyTreeVisualizer | Vertical cascade, 40px nodes, pinch-to-zoom | Horizontal tree, 48px nodes, top 60% | Full viewport, 64px nodes, SVG connectors |
| HeirAdder | Bottom sheet (40vh), swipeable | Full-width bottom panel | Floating card, bottom-left, 400px |
| InterviewStepper | Dot stepper in top bar, minimal | Dot stepper top-right | Dot stepper top-right, labels visible |
| ShareResultCard | Full-width stack, tap to expand | 2-column grid | 3-column grid or list view |
| MadhabSelector | Full-width radio cards, vertical | 2-column radio grid | Horizontal radio row |
| Dashboard (CaseListItem) | Vertical card stack | Vertical card stack with more detail | Table-like rows with inline actions |

## Accessibility Strategy

**Target: WCAG 2.1 AA compliance (AAA where achievable without compromise)**

### Color & Contrast

| Element | Contrast Ratio | WCAG Level |
|---------|---------------|------------|
| Primary text (`--foreground` on `--background`) | 16.1:1 | AAA |
| Primary navy on white | 9.6:1 | AAA |
| Accent amber on white | 4.8:1 | AA |
| Muted text (`--muted` on `--background`) | 4.6:1 | AA |
| `--muted-foreground` (Slate-400) | 3.1:1 | Decorative only — never for essential content |

**Rule:** Never convey information by color alone. Error = red + icon + text. Success = green + checkmark + text. Status badges include text labels, not just color.

### Keyboard Navigation

| Context | Keys | Behavior |
|---------|------|----------|
| **Interview card** | `Tab` / `Shift+Tab` | Move between form fields and buttons |
| **Family tree** | `Arrow keys` | Navigate between nodes |
| **Family tree** | `Enter` | Select/expand focused node |
| **Any overlay** | `Escape` | Close overlay, return to previous state |
| **Global** | `Tab` to skip link | "Skip to main content" link on every page |
| **Results** | `Enter` on ShareResultCard | Toggle expanded proof view |

### Screen Reader Support

- **Family tree:** `role="img"` with dynamic `aria-label` describing full family structure (e.g., "Family tree of Ahmad: 2 sons, 1 daughter, 1 wife. Son Sami receives 1/4.")
- **Interview progress:** `aria-live="polite"` region announces step changes ("Step 3 of 5: Add heirs")
- **Heir addition:** `aria-live="polite"` announces "Heir added: Son, Sami" after each addition
- **Share recalculation:** `aria-live="polite"` announces updated totals
- **Validation errors:** `role="alert"` for immediate announcement
- **Fiqh tooltips:** `aria-describedby` linking trigger to tooltip content

### Touch & Motor Accessibility

- All interactive elements: minimum 44x44px touch target
- 8px minimum gap between adjacent touch targets
- No drag-only interactions — every drag action has a button alternative
- Tree pan/zoom: button controls available alongside gesture controls (+/- buttons, fit-to-view button)
- Form inputs: generous padding (12px internal) for easy tapping

### RTL Accessibility

- `dir` attribute set dynamically on `<html>` based on language selection
- Tailwind logical properties throughout: `ms-`/`me-`/`ps-`/`pe-` instead of `ml-`/`mr-`/`pl-`/`pr-`
- Focus order follows visual order in both LTR and RTL
- Arrow key navigation mirrors direction (`→` means "next" in LTR, `←` means "next" in RTL)
- Form labels and error messages positioned correctly for both directions
- Tree layout mirrors: root on right side in RTL mode

### Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```
- All state changes use opacity instead of motion
- Tree node additions appear instantly (no slide/scale)
- Share badge updates swap values without animation
- Essential state changes remain visible — only motion is removed

## Testing Strategy

**Responsive Testing:**

| Method | Tools | Frequency |
|--------|-------|-----------|
| Device emulation | Chrome DevTools responsive mode | Every component |
| Real device testing | BrowserStack or physical devices (iPhone SE, iPhone 14, iPad, Galaxy S21) | Pre-release |
| Network throttling | Chrome DevTools 3G/4G presets | Key flows (interview, PDF download) |
| Viewport coverage | 375px, 768px, 1024px, 1440px at minimum | Every page/component |

**Accessibility Testing:**

| Method | Tools | Frequency |
|--------|-------|-----------|
| Automated scanning | axe-core (via @axe-core/react or Playwright integration) | CI pipeline — every PR |
| Keyboard-only walkthrough | Manual: Tab through all flows without mouse | Every new flow |
| Screen reader testing | VoiceOver (macOS/iOS), NVDA (Windows) | Pre-release, major flow changes |
| Color contrast | Tailwind plugin + Chrome DevTools contrast checker | Design token changes |
| RTL verification | Browser `dir="rtl"` toggle, manual visual review | Every component |

**Automated CI Checks:**
- `axe-core` integrated into Playwright E2E tests — zero accessibility violations allowed in CI
- Lighthouse accessibility audit score target: 95+
- Custom RTL snapshot tests: every page rendered in both `dir="ltr"` and `dir="rtl"`

## Implementation Guidelines

**Responsive Development Rules:**
1. Write mobile-first CSS: base styles for 375px, add complexity with `md:` and `lg:` prefixes
2. Use Tailwind responsive prefixes exclusively — no custom `@media` queries
3. Use `rem` for typography, `px` for borders/shadows, `%`/`vw`/`vh` for layout dimensions
4. Test every component at 375px, 768px, and 1024px before merging
5. Use `aspect-ratio` or explicit dimensions on images and async content to prevent layout shift
6. Lazy-load below-fold content; preload critical fonts and above-fold images

**Accessibility Development Rules:**
1. Semantic HTML first: `<nav>`, `<main>`, `<section>`, `<article>`, `<button>` — never `<div onClick>`
2. Every `<img>` has `alt` text; decorative images use `alt=""`
3. Every icon-only button has `aria-label`
4. Form inputs linked to labels via `htmlFor`/`id` — never floating labels without accessible name
5. Focus visible on every interactive element: `focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2`
6. Test with keyboard before testing with mouse — if you can't tab to it, it's broken
7. `aria-live` regions for dynamic content updates (tree changes, calculation results)
8. Skip link as first focusable element on every page

**RTL Development Rules:**
1. Never use `ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-` — always logical: `ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`
2. Set `dir` on `<html>`, not individual components
3. Icons that imply direction (arrows, chevrons) must flip in RTL via `rtl:rotate-180`
4. Text alignment: use `text-start`/`text-end`, never `text-left`/`text-right`
5. Test every component in both directions before merging
