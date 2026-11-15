# Design Direction Decision

## Design Directions Explored

Six distinct design directions were created and evaluated for the Guided Interview screen:

1. **Split Panel Classic** — Two-column: form left, tree right. Balanced but conventional.
2. **Centered Wizard** — Single centered card, mobile-first, step-by-step. Simple but tree is secondary.
3. **Dashboard Professional** — Three-column CRM-style. Information-rich but overwhelming for non-experts.
4. **Bento Grid** — Card-based grid layout. Modern but fragments the experience across cards.
5. **Conversational Flow** — Chat-like interface. Approachable but tree feels disconnected from conversation.
6. **Full-Screen Immersive** — Tree dominates the viewport with floating interview overlay. Maximum visual impact.

Visual mockups: [ux-design-directions.html](ux-design-directions.html)

## Chosen Direction

**Direction 6: Full-Screen Immersive — "The Tree IS the Interface"**

The family tree visualization occupies the full viewport as the primary interface element. A floating interview card overlays the bottom-left corner, and heir pills with share fractions appear at the top of the tree. The tree grows organically as heirs are added, creating a living visual representation of the family.

**Key Layout Characteristics:**
- Full-viewport height, no unnecessary scroll
- Family tree visualization takes ~70% of visual space
- Floating interview card (add-heir form) in bottom-left — compact, non-intrusive
- Heir pills with live share fractions displayed as badges above/around tree nodes
- Minimal navigation chrome — progress indicator and language switcher only
- Subtle background gradient (slate to white) grounds the tree visualization

## Design Rationale

| Decision | Rationale |
|----------|-----------|
| **Tree as primary element** | Aligns with our "Real-Time Family Tree as Trust Anchor" principle. The tree IS the product — users came to understand their family's inheritance, and the tree makes it visual and real. |
| **Floating form overlay** | Keeps data entry minimal and non-threatening. One small card asking one question at a time. Sami on mobile doesn't feel overwhelmed; Layla on desktop has the full tree context while entering data. |
| **Heir pills with fractions** | Live share preview integrated directly into the tree visualization. Users see shares update as they add heirs — "Show, Don't Ask to Trust" in action. |
| **Minimal chrome** | "Sacred seriousness" through restraint. No decorative elements, sidebars, or visual noise. Every pixel serves the family tree or the interview. Banking-clean aesthetic. |
| **Full viewport** | Immersive experience communicates importance and focus. This isn't a calculator widget — it's a full-screen application handling matters of divine law. |

## Implementation Approach

**Desktop (1024px+):**
- Full-viewport family tree with SVG connector lines
- Floating interview card: fixed position, bottom-left, max-width 400px, `shadow-lg`, `radius-lg`
- Heir nodes: 64px circles with name and relationship, connected by SVG paths
- Deceased node: prominent, navy-filled center node
- Share fractions: amber badge pills adjacent to each heir node
- Progress stepper: minimal dots in top-right corner
- Language switcher + Mawareeth logo: minimal top bar (transparent background)

**Tablet (768px - 1023px):**
- Family tree takes top 60% of viewport
- Interview card expands to full-width bottom panel (bottom sheet style)
- Tree nodes scale down to 48px circles
- Heir pills stack horizontally with horizontal scroll if needed

**Mobile (375px - 767px):**
- Family tree: scrollable top section, simplified node layout (vertical cascade)
- Interview card: fixed bottom sheet (40% viewport height), swipeable
- Nodes: 40px circles, relationship text below
- Share fractions: visible on tap (progressive disclosure)
- "Expand tree" gesture: pull up to see full tree, push down to return to interview

**Interaction Flow:**
1. Tree starts with single deceased node (center)
2. User adds heir via floating card → node animates into position with SVG connector
3. Share fractions appear/update on all nodes simultaneously (200ms transition)
4. Tree auto-layouts to accommodate new nodes (smooth 300ms reflow)
5. On completion, tree fully populated → interview card transforms into "Review & Generate Report" CTA
6. Pinch-to-zoom on mobile for complex multi-generational trees (Manasikhat)

**Technical Notes:**
- Tree rendering: React Flow or custom SVG with d3-hierarchy for auto-layout
- Animation: Framer Motion for node entry/exit and tree reflow
- Performance: Canvas fallback for trees with 20+ nodes (Manasikhat cases)
- Touch: Hammer.js or native gesture API for pinch-zoom on mobile
