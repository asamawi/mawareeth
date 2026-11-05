# Epic 1 Context: Guided Interview & Family Tree Capture

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Let a visitor with no account start an inheritance case, choose a Madhab, enter the deceased and heirs through a guided interview, see the family tree grow, and preview shares live. This is the first product epic after the Heroku-to-Hetzner migration. It removes the signup wall from the moment of need: an emotionally charged, non-expert person, often on a phone, should get to a first answer with no friction.

## Stories

- Story 1.1: Zero-Signup Case Start
- Story 1.2: Start Interview + Madhab Selection
- Story 1.3: Deceased Info + Add Heirs via Guided Interview Form
- Story 1.4: Family Tree Visualization (Basic Render + Updates)
- Story 1.5: Real-Time Share Preview from Supported Engine Cases
- Story 1.6: Fiqh-Aware Validation + Hajb (Blocking Heirs)

## Requirements & Constraints

- No signup before calculation. Signup stays optional and available in the navbar, and must never block progress.
- Family data is captured through step-by-step kinship discovery, and the interview adapts to the selected Madhab (four Sunni schools plus Jafari).
- Invalid kinship inputs are flagged against fiqh constraints, with an explanation and a suggested correction. Heirs blocked by hajb are not offered.
- Live previews come from the deterministic engine only. Cases outside the supported ruleset say that preview is unavailable and never show provisional numbers. A failed or timed-out preview shows a graceful message and never presents a stale result as current.
- Standard calculations return in under 200ms. Calculation output cannot be manually overridden.
- Arabic, English and French, with correct RTL/LTR switching.
- WCAG 2.1 AA: full keyboard use, visible focus, screen-reader labels, RTL-correct focus order, reduced-motion support, high-legibility Arabic fonts.
- Must perform well on mobile browsers over 3G/4G networks.
- Privacy: calculations default to ephemeral. Case data is persisted only when the user explicitly saves.

## Technical Decisions

- **Delivery stack:** Next.js and DRF, approved by the project owner on 2026-11-05 as the Epic 1 stack. A foundation piece must come first, because the repo today is one server-rendered Django application.
- **Anonymous state:** held in the Django session with a short expiry, chosen by the project owner on 2026-11-05 over a browser-local IndexedDB draft. This is an accepted exception to "no PII on the server until explicit save". Story 1.1 must reconcile the short expiry with the resume-on-return behavior below.
- **Access control:** every route requires login unless marked `login_not_required`, and case lookups return 404 to anyone but the owner, so `user=None` cases are unreachable. Anonymous routes must opt out explicitly and define their own ownership rule, and `calc/tests.py` classifies every case route.
- **Engine boundary (target):** a pure domain module with no database writes that works from read-only case snapshots. Engine updates are versioned for determinism.
- **Testing:** contract tests align UI and engine output, and representative fixtures confirm that displayed previews match the engine. End-to-end coverage emphasizes keyboard and reduced-motion flows.

## UX & Interaction Patterns

- Flow: landing call to action, Madhab, deceased info, heirs one at a time while the tree grows, review ("Is this complete?"), then calculate.
- The interview lives in an immersive full-screen tree view. On desktop, the question appears as a floating card over the tree.
- Fiqh errors are gentle and explanatory, for example "A deceased cannot have two fathers — would you like to edit?", and entered data is never lost.
- A network interruption preserves local state, and an accidental close prompts the user to resume on return.

## Cross-Story Dependencies

- 1.1 establishes the anonymous case state that every later story reads and writes.
- 1.2 and 1.3 feed 1.4 (tree) and 1.5 (preview). 1.6 constrains the heir options offered in 1.3.
- 1.5 depends on the Epic 2 engine for anything beyond its supported ruleset, and 1.2's Madhab choice only affects results once the engine is multi-school.
- Epic 4 (save and share) picks up the anonymous case state at the account gate.
