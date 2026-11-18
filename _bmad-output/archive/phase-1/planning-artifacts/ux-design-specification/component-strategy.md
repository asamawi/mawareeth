# Component Strategy

## Design System Components

**shadcn/ui Base Components (install via CLI, customize with Mawareeth tokens):**

| Component | Mawareeth Usage |
|-----------|----------------|
| **Button** | CTAs ("Start Calculation", "Download PDF", "Share"), form actions, navigation |
| **Card** | Floating interview card, result cards, case list items |
| **Dialog** | Confirmation dialogs ("Is this your complete family?"), account creation |
| **Form + FormField + FormMessage** | All Guided Interview inputs, heir data entry |
| **Input** | Text fields (names, dates) |
| **Select** | Madhab selection, relationship type, gender |
| **Tooltip** | Fiqh citation previews, field help text |
| **Badge** | Share fractions on tree nodes, case status indicators |
| **Progress** | Interview completion indicator |
| **Sheet** | Mobile bottom sheet for interview card |
| **Skeleton** | Loading states for tree visualization and results |
| **Toast** | Auto-save confirmation, share success, error notifications |
| **Separator** | Section dividers in results and reports |
| **Tabs** | Results view tabs (Tree / List / Report) |

No customization needed — these components work as-is with Mawareeth design tokens applied via CSS variables.

## Custom Components

### 1. FamilyTreeVisualizer

**Purpose:** The full-viewport interactive kinship graph — the product's visual core.
**Content:** Heir nodes (circles with name + relationship), SVG connector lines, share fraction badges.
**States:**
- `empty` — Single deceased node, waiting for first heir
- `building` — Heirs being added, tree growing with animations
- `complete` — All heirs added, review mode active
- `manasikhat` — Multi-generational view with generation layer indicators

**Interaction:** Click node to select/edit. Pinch-to-zoom on mobile. Auto-layout reflows on add/remove (300ms). Canvas fallback at 20+ nodes.
**Accessibility:** `role="img"` with `aria-label` describing family structure. Keyboard navigation between nodes via arrow keys.
**Tech:** React Flow or custom SVG with d3-hierarchy. Framer Motion for animations.

### 2. HeirAdder (Floating Interview Card)

**Purpose:** Compact overlay card for adding one heir at a time during the Guided Interview.
**Content:** Relationship selector, name input, gender, deceased toggle.
**States:**
- `default` — Ready for next heir input
- `adding` — Form active with validation
- `manasikhat-trigger` — Deceased toggle activated, prompting sub-heir entry
- `review` — Transforms into "Review & Generate Report" CTA on completion

**Variants:**
- `desktop` — Fixed bottom-left, max-width 400px, `shadow-lg`
- `mobile` — Bottom sheet (40% viewport), swipeable

**Accessibility:** `aria-live="polite"` announces new heirs added. Focus trapped within card during input. ESC closes without losing data.

### 3. InterviewStepper

**Purpose:** Multi-step wizard engine powering the Guided Interview flow with smart branching.
**Content:** Current step indicator (dot stepper), back/next navigation, step-specific form content.
**States:**
- `active` — Current step highlighted
- `completed` — Past steps checkmarked, clickable for review
- `upcoming` — Future steps dimmed

**Interaction:** Steps branch dynamically based on Madhab selection and heir inputs. Back button always available. Progress persists in localStorage.
**Tech:** React Hook Form multi-step pattern with Zod schema per step.

### 4. ShareResultCard

**Purpose:** Displays one heir's inheritance share with fiqh backing.
**Content:** Heir name, relationship, share fraction (e.g., 1/6), percentage, fiqh citation summary.
**States:**
- `preliminary` — Standard display
- `certified` — Green border + "Mawareeth-Certified" badge
- `expanded` — Shows full mathematical proof and fiqh source text

**Interaction:** Tap/click to expand proof. Long-press to copy share details.
**Accessibility:** `aria-expanded` for expandable section. Mathematical notation in `aria-label`.

### 5. FiqhCitationTooltip

**Purpose:** Contextual tooltip showing Islamic legal source for any share, rule, or validation message.
**Content:** Citation text, Madhab name, plain-language explanation.
**States:** `hidden`, `visible` (on hover/tap), `pinned` (user clicked to keep open)
**Variants:** `inline` (within text), `node-attached` (on tree nodes)
**Accessibility:** `role="tooltip"`, `aria-describedby` on trigger element.

### 6. CertificationBadge

**Purpose:** Visual indicator of report verification status.
**Content:** Status text + icon.
**Variants:**
- `preliminary` — Slate badge, "Preliminary" text
- `certified` — Amber badge with checkmark, "Mawareeth-Certified" text

**Accessibility:** `aria-label` with full status description.

### 7. MadhabSelector

**Purpose:** School of jurisprudence selection at interview start.
**Content:** Radio group with 5 options (4 Sunni + Jafari), brief one-line description per option.
**States:** `default`, `selected` (navy highlight on chosen)
**Accessibility:** `role="radiogroup"` with descriptive labels.

### 8. ManasikhatBreadcrumb

**Purpose:** Generation depth navigator for multi-generational cascade interviews.
**Content:** Clickable breadcrumb trail: "Original → Gen 2 → Gen 3"
**States:** `hidden` (simple cases), `visible` (when Manasikhat triggered)
**Interaction:** Click any level to navigate back to that generation's sub-tree.

### 9. CaseListItem

**Purpose:** Single case row in Layla's dashboard.
**Content:** Client/deceased name, date, status badge (In Progress / Preliminary / Certified), quick actions (open, export PDF).
**States:** `default`, `hover` (subtle highlight), `selected`
**Interaction:** Click to open case. Action buttons on hover/tap.

## Component Implementation Strategy

**Build Pattern:** All custom components follow shadcn conventions:
- `cn()` for className merging
- `cva` for variant definitions
- React Hook Form integration via `FormField` + `FormControl`
- Zod validation with bilingual error messages (Arabic/English/French)
- RTL tested: every component works with `dir="rtl"` and `dir="ltr"`

**Composition over Configuration:**
- Components are small, composable units — not monolithic widgets
- `ShareResultCard` composes `Card` + `Badge` + `FiqhCitationTooltip`
- `HeirAdder` composes `Card` + `Form` + `Select` + `Input` + `Button`
- `CaseListItem` composes `Card` + `Badge` + `Button`

## Implementation Roadmap

**Phase 1 — Core Interview (MVP):**

| Component | Priority | Rationale |
|-----------|----------|-----------|
| FamilyTreeVisualizer | Critical | The product IS the tree |
| HeirAdder | Critical | Primary data input mechanism |
| InterviewStepper | Critical | Drives the guided flow |
| MadhabSelector | Critical | Interview entry point |
| ShareResultCard | Critical | Results display |

**Phase 2 — Trust & Professional:**

| Component | Priority | Rationale |
|-----------|----------|-----------|
| FiqhCitationTooltip | High | Trust-building transparency |
| CertificationBadge | High | Lawyer certification flow |
| CaseListItem | High | Lawyer dashboard |
| ManasikhatBreadcrumb | High | Multi-generation navigation |

**Phase 3 — Enhancement:**

| Component | Priority | Rationale |
|-----------|----------|-----------|
| Report PDF generator | Medium | Court-ready output |
| Share/export actions | Medium | WhatsApp, link, email sharing |
