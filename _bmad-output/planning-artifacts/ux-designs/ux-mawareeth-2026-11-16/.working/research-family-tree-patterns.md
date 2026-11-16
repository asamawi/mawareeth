# Family-tree interaction patterns (web research, 2026-11-16)

Coverage is thin on Q2, Q5 and Q6. Searches returned no usable results for delete/undo, accessibility or RTL. Ancestry help pages and user reviews were not reached.

## 1. Adding a relative
- Tap a person, then "Add Relative", then a relationship menu (Add Father / Mother / Spouse / Sibling / Son / Daughter; father and mother only offered if the slot is empty) | Ancestry | https://thefhguide.com/project-1-family-tree-app02.html | third-party guide, about 2-3 taps to the form
- Dedicated "add parent" placeholder card appears where parents are missing; can be hidden via the setting "Show cards for adding parents" | MyHeritage app | http://blog.myheritage.com/2025/03/new-improved-family-tree-on-the-myheritage-mobile-app/ | empty slot as call to action
- Dotted-line box with leaf marks a suggested missing relative; user can keep, remove, or fill it | Ancestry | https://thefhguide.com/project-1-family-tree-app02.html | ghost node
- Add from the person page via Parents / Spouses tabs; or "Add Parent" at the end of a line in the tree | FamilySearch mobile | https://www.familysearch.org/en/help/helpcenter/article/how-do-i-add-a-spouse-or-partner-in-family-tree | the search result linked a Georgian-language URL with English content
- The mobile app allows adding a child only when a spouse is listed (no child for a single parent). Relationships are constrained by the model | FamilySearch | same search result, article on adding a child | a cautionary dependency
- "+" symbol on a node opens a simple editor | familienbaum (JS lib) | https://www.github.com/Nicolodemus/familienbaum | minimal OSS pattern

## 2. Edit / delete
- Little evidence found. Edit form (modal/panel) via "EditTree" API | family-chart | https://github.com/donatso/family-chart | the API lists form management; no delete or undo docs found
- Edit Form plus Edit / ReadOnly mode | BALKAN FamilyTree JS | https://balkan.app/FamilyTreeJS2 | commercial
- Confirmation and undo: not found. Gap.

## 3. Navigation
- Generations slider (up to 5+) relative to the main person; toggle to hide cousins | MyHeritage app | http://blog.myheritage.com/2025/03/new-improved-family-tree-on-the-myheritage-mobile-app/ | density control
- Swipe to pan, pinch to zoom | MyHeritage app | same URL | mobile baseline
- Family view and Pedigree view; five charts (ancestor, descendant, hourglass, relationship, fan) as tabs | MyHeritage; Gramps Web | https://www.grampsweb.org/user-guide/tree/ | tabs for views
- Tap a card to re-centre on that person; Home Person button; Back button | Gramps Web | https://www.grampsweb.org/user-guide/tree/ | focus-person pattern
- Chevron on edge cards adds one generation of hidden relatives | Gramps Web | same URL | progressive disclosure
- Pan/zoom plus card types (SVG/HTML) | family-chart | https://github.com/donatso/family-chart | D3-based

## 4. Visual conventions
- Vertical (portrait) profile cards fit more people on a phone; thin coloured frame by gender, with a solid blue/pink option | MyHeritage app | http://blog.myheritage.com/2025/03/new-improved-family-tree-on-the-myheritage-mobile-app/ | the frame is a subtle cue
- Black ribbon marks a deceased person | MyHeritage app | same URL | direct fit for our "deceased" marker
- Each ancestral branch gets its own colour | MyHeritage | same URL | helps tell sides apart
- Living people are flagged and private | FamilySearch | same search result as the FamilySearch add-relative articles | not relevant to us
- Line styles for marriages, half-siblings and multiple spouses: not documented in the sources reached. Gap.

## 5. Accessibility and complaints
- Keyboard shortcuts ("?" shows them) | Gramps Web | https://www.grampsweb.org/features | desktop-oriented
- Arrow-key behaviour flips in RTL for tree widgets | MUI Tree View | https://mui.com/x/react-tree-view/accessibility | reference for RTL keyboard handling
- Mobile editing gaps: the MyHeritage app has a help question "Why can't I edit my tree with the app?", and the tree is read-only for Family Tree Builder users. FamilySearch mobile lacks some adds | https://www.myheritage.com/help/en/collections/17637588-family-tree | feature-parity complaints
- dTree issue asks how to support touch navigation | https://www.github.com/ErikGartner/dTree/issues/115 | mouse-first libraries
- Independent user reviews: not found.

## 6. OSS libraries
- family-chart (D3, MIT, TypeScript) | https://github.com/donatso/family-chart | no RTL or accessibility documentation found
- dTree | https://www.github.com/ErikGartner/dTree/issues/115 | touch issue open
- react-family-tree | no results
- topola-viewer (GEDCOM SVG viewer) | https://GitHub.com/PeWu/topola-viewer | not examined
- Verdict: none document RTL or ARIA. Expect a custom or semantic-HTML tree.

## Implications for an inheritance interview
- Use empty placeholder slots ("Add father", "Add spouse") on the deceased's node instead of a free-form tree editor. This is the MyHeritage/Ancestry ghost-card pattern.
- Build the flow as a guided interview, one relationship type at a time, with a count stepper (for example, how many sons). Keep the tree as a live preview, not the input surface.
- Ask only about relatives who matter for the law. Hide cousins and distant generations, as the generations slider does.
- Enforce model constraints visibly. A child needs a parent or spouse context, and father and mother slots disappear once filled.
- Mark the deceased with a ribbon or badge plus a text label. Do not rely on colour alone, so gender cues need an icon or text too.
- Use portrait cards with initials, a name and a relationship label. Tap a card to open a bottom sheet for edit/delete, with a confirm and an undo toast. No evidence was found, so this is our own design.
- Use logical (start/end) CSS and mirror the tree layout in RTL. Provide a linear list or outline alternative to the graphical tree for screen readers and keyboard users.
- Allow multiple spouses with ordered or labelled marriage lines. Use a distinct line style for half-siblings (unsourced; design it ourselves).
