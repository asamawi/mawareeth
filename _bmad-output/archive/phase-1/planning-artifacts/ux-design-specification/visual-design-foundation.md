# Visual Design Foundation

## Color System

**Primary Palette — "Sacred Authority"**

The Mawareeth V3 color system draws from two traditions: the restrained authority of legal/financial institutions and the dignified warmth of Islamic scholarly tradition. No ornamental "Islamic green" — instead, a navy-and-amber palette that communicates institutional trust.

| Token | Value | Usage | Contrast on White |
|-------|-------|-------|-------------------|
| `--primary` | `#1E3A8A` (Authority Navy) | Primary buttons, headings, nav active states | 9.6:1 (AAA) |
| `--primary-foreground` | `#FFFFFF` | Text on primary backgrounds | — |
| `--secondary` | `#1E40AF` (Deep Blue) | Secondary actions, links, selected states | 7.2:1 (AAA) |
| `--accent` | `#B45309` (Trust Amber) | CTAs, highlights, certification badges, fiqh citation markers | 4.8:1 (AA) |
| `--background` | `#F8FAFC` (Clean Slate) | Page backgrounds | — |
| `--foreground` | `#0F172A` (Near-Black) | Primary body text | 16.1:1 (AAA) |
| `--muted` | `#64748B` (Slate-500) | Secondary text, placeholders, labels | 4.6:1 (AA) |
| `--muted-foreground` | `#94A3B8` (Slate-400) | Disabled states, metadata | 3.1:1 (decorative only) |
| `--border` | `#E2E8F0` (Slate-200) | Card borders, dividers, input borders | — |
| `--card` | `#FFFFFF` | Card backgrounds, elevated surfaces | — |
| `--destructive` | `#DC2626` (Red-600) | Error states, invalid inputs, warnings | 5.1:1 (AA) |
| `--success` | `#16A34A` (Green-600) | Valid states, completed steps, checkmarks | 4.5:1 (AA) |
| `--info` | `#0284C7` (Sky-600) | Informational tooltips, fiqh citation backgrounds | 4.5:1 (AA) |

**Semantic Color Usage:**
- **Navy (#1E3A8A)** = Authority, institution, primary actions
- **Amber (#B45309)** = Warmth, certification, attention, scholarly tradition
- **Slate scale** = Content hierarchy, from foreground (#0F172A) to borders (#E2E8F0)
- **No green as primary** — deliberately avoiding "Islamic website" green cliché. Green used only semantically for success/valid states.

**Dark Mode (Phase 2):**
- Not in MVP scope, but color system designed with CSS variables for easy future dark mode implementation
- All tokens defined as HSL values in `:root` and overridden in `.dark` class

## Typography System

**Type Scale (8px base unit, 1.25 ratio):**

| Level | Size | Weight | Line Height | Usage |
|-------|------|--------|-------------|-------|
| `display` | 48px / 3rem | 700 | 1.1 | Landing page hero |
| `h1` | 36px / 2.25rem | 700 | 1.2 | Page titles |
| `h2` | 28px / 1.75rem | 600 | 1.3 | Section headings |
| `h3` | 22px / 1.375rem | 600 | 1.4 | Card titles, subsections |
| `h4` | 18px / 1.125rem | 500 | 1.4 | Form group labels |
| `body` | 16px / 1rem | 400 | 1.6 | Body text, form inputs |
| `body-sm` | 14px / 0.875rem | 400 | 1.5 | Captions, metadata, tooltips |
| `caption` | 12px / 0.75rem | 500 | 1.4 | Badges, tags, fine print |
| `mono` | 14px / 0.875rem | 400 | 1.5 | Math proofs, fractions (JetBrains Mono) |

**Arabic Typography Adjustments:**
- Arabic text renders ~20% larger visually at the same font size — no size adjustment needed
- Line height increased to 1.8 for Arabic body text (diacritics need vertical space)
- Noto Sans Arabic at weight 400 for body, 600 for headings (Arabic fonts appear bolder)
- `word-spacing: 0.05em` for improved Arabic readability

**Font Loading Strategy:**
- `font-display: swap` for all web fonts — prevent invisible text
- Preload critical fonts (Lexend 600, Source Sans 3 400, Noto Sans Arabic 400)
- System font fallback stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`

## Spacing & Layout Foundation

**Spacing Scale (4px base unit):**

| Token | Value | Usage |
|-------|-------|-------|
| `space-0` | 0px | Reset |
| `space-1` | 4px | Tight internal spacing (icon-to-text gap) |
| `space-2` | 8px | Minimum touch gap, compact element spacing |
| `space-3` | 12px | Form field internal padding |
| `space-4` | 16px | Standard element spacing, card padding |
| `space-5` | 20px | Form group spacing |
| `space-6` | 24px | Section internal spacing |
| `space-8` | 32px | Section gaps, major breaks |
| `space-10` | 40px | Page section spacing |
| `space-12` | 48px | Major layout sections |
| `space-16` | 64px | Hero sections, page top/bottom padding |

**Layout Grid:**
- **12-column grid** with `gap: 1rem` (16px)
- **Max-width:** `max-w-6xl` (1152px) for content, `max-w-7xl` (1280px) for full layouts
- **Container padding:** 16px mobile, 24px tablet, 32px desktop
- **Breakpoints:** 375px (mobile), 768px (tablet), 1024px (desktop), 1440px (wide)

**Z-Index Scale (managed, no arbitrary values):**

| Layer | Z-Index | Usage |
|-------|---------|-------|
| `base` | 0 | Normal flow |
| `dropdown` | 10 | Dropdowns, tooltips |
| `sticky` | 20 | Sticky nav, floating elements |
| `modal-backdrop` | 30 | Dialog backdrop overlay |
| `modal` | 40 | Dialogs, sheets |
| `toast` | 50 | Toast notifications |

**Border Radius Scale:**
- `radius-sm`: 4px — inputs, small buttons
- `radius-md`: 8px — cards, containers
- `radius-lg`: 12px — modal dialogs, hero cards
- `radius-full`: 9999px — badges, avatar circles, pills

**Shadow Scale (minimal, banking-clean):**
- `shadow-sm`: `0 1px 2px rgba(0,0,0,0.05)` — subtle card elevation
- `shadow-md`: `0 4px 6px rgba(0,0,0,0.07)` — interactive card hover
- `shadow-lg`: `0 10px 15px rgba(0,0,0,0.1)` — modals, dropdowns
- No excessive shadows — trust comes from content and typography, not visual depth

## Accessibility Considerations

**WCAG 2.1 AA Compliance (minimum target, AAA where possible):**

| Standard | Implementation |
|----------|---------------|
| **Color Contrast** | All text meets 4.5:1 minimum; primary navy on white = 9.6:1 (AAA). Muted text at 4.6:1 (AA). Never use `--muted-foreground` for essential content. |
| **Focus States** | `focus:ring-2 focus:ring-primary focus:ring-offset-2` on all interactive elements. Never `outline-none` without replacement. |
| **Touch Targets** | Minimum 44x44px for all interactive elements. 8px minimum gap between adjacent targets. |
| **Keyboard Navigation** | Tab order matches visual order. Skip-to-content link on every page. All functionality keyboard-accessible. |
| **Screen Readers** | `aria-label` on icon-only buttons. `aria-live="polite"` on calculation results. `role="alert"` on validation errors. |
| **Reduced Motion** | `prefers-reduced-motion: reduce` disables all animations. Essential state changes use opacity, not motion. |
| **Font Loading** | `font-display: swap` prevents invisible text. Fallback fonts sized to match web fonts. |
| **Content Jumping** | `aspect-ratio` or fixed dimensions on all async content. Skeleton loading states for interview steps. |
| **Color Independence** | Never convey information by color alone. Error = red + icon + text. Success = green + checkmark + text. |
| **RTL Accessibility** | Logical reading order verified in both directions. Focus management tested in RTL. Form labels positioned correctly for RTL. |
