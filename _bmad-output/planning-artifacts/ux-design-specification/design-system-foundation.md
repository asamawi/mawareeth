# Design System Foundation

## Design System Choice

**Stack:** Next.js 14+ App Router + shadcn/ui + Tailwind CSS + React Hook Form + Zod

**Why shadcn/ui:**
- Built on Radix UI primitives with native RTL and WCAG accessibility support
- Tailwind-based theming aligns with "Trust & Authority" style from UI UX Pro Max
- Components are copied into the project (not imported from node_modules), giving full control for Mawareeth-specific customization
- React Hook Form + Zod integration provides type-safe, performant form handling — critical for the Guided Interview engine
- Follows `cn()` and `cva` patterns for consistent custom component development

## Rationale for Selection

| Requirement | How shadcn/ui Delivers |
|------------|----------------------|
| **Sacred seriousness** | Restrained, typography-driven design; no opinionated visual decoration |
| **RTL/Bilingual** | Radix primitives support RTL natively; Tailwind logical properties (`ms-`, `me-`) for automatic layout mirroring |
| **WCAG 2.1 AA** | Built-in ARIA labels, keyboard navigation, focus management, color contrast compliance |
| **Guided Interview** | Form + FormField + FormMessage pattern with React Hook Form provides step-by-step interview architecture |
| **Solo developer** | Copy-paste components with full ownership; no dependency lock-in; strong community and documentation |
| **Performance** | Tree-shakeable, minimal bundle; SSG-compatible for SEO landing pages |

## Implementation Approach

**Design Tokens (Tailwind + CSS Variables):**

```css
/* Mawareeth V3 Design Tokens */
--primary: #1E3A8A;        /* Authority Navy */
--primary-foreground: #FFFFFF;
--secondary: #1E40AF;      /* Deep Blue */
--accent: #B45309;         /* Trust Gold/Amber */
--background: #F8FAFC;     /* Clean Slate */
--foreground: #0F172A;     /* Near-Black Text */
--muted: #64748B;          /* Slate-500 for secondary text */
--border: #E2E8F0;         /* Slate-200 for borders */
--destructive: #DC2626;    /* Error Red */
--success: #16A34A;        /* Validation Green */
```

**Typography System:**

| Context | Font | Weights | Usage |
|---------|------|---------|-------|
| **English/French Headings** | Lexend | 500, 600, 700 | H1-H4, navigation, buttons |
| **English/French Body** | Source Sans 3 | 300, 400, 500 | Body text, form labels, descriptions |
| **Arabic Headings & Body** | Noto Sans Arabic | 400, 500, 600, 700 | All Arabic text — headings and body |
| **Monospace (Math Proofs)** | JetBrains Mono | 400, 500 | Calculation proofs, share fractions |

**RTL Implementation Strategy:**
- Set `dir` attribute dynamically based on selected language (`dir="rtl"` for Arabic, `dir="ltr"` for English/French)
- Use Tailwind logical properties exclusively: `ms-4` (margin-start) not `ml-4` (margin-left)
- Tailwind `rtl:` variant for RTL-specific overrides where logical properties aren't sufficient
- shadcn/ui Radix components handle RTL focus management, dropdown positioning, and dialog layout automatically
- Test every component in both directions during development

## Customization Strategy

**shadcn/ui Base Components (Install via CLI):**
- Button, Card, Dialog, Form, Input, Select, Tabs, Tooltip, Badge, Progress, Separator, Sheet, Skeleton, Toast

**Custom Mawareeth Components (Built following shadcn patterns with `cn()` + `cva`):**

| Component | Purpose | Complexity |
|-----------|---------|-----------|
| **HeirAdder** | Interactive component for adding/removing heirs with type selection, relationship validation, and dynamic form fields based on Madhab rules | High — Core custom component |
| **FamilyTreeVisualizer** | Real-time SVG/Canvas kinship graph that grows as heirs are added during the Guided Interview | High — Emotional anchor of the experience |
| **InterviewStepper** | Multi-step wizard engine powering the Guided Interview with smart branching, progress tracking, and back navigation | High — Product-defining flow |
| **ShareResultCard** | Displays individual heir's share with fraction, percentage, fiqh citation, and expandable mathematical proof | Medium — Trust-building pattern |
| **FiqhCitationTooltip** | Contextual tooltip displaying Islamic legal source, Madhab, and plain-language explanation | Medium — Transparency pattern |
| **CertificationBadge** | Visual badge displaying "Preliminary" or "Mawareeth-Certified" status with verification details | Low — Trust signal |
| **MadhabSelector** | School of jurisprudence selection with brief explanation of each option | Low — Interview entry point |

**Component Development Rules:**
- All custom components follow shadcn conventions: `cn()` for className merging, `cva` for variants
- Every component supports `dir="rtl"` and `dir="ltr"` — test both during development
- Form components integrate with React Hook Form via `FormField` + `FormControl` pattern
- Validation schemas defined in Zod with bilingual error messages
- All interactive elements include `cursor-pointer`, visible focus states, and smooth transitions (150-300ms)
