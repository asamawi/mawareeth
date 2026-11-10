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
- Story 1.7: Successive Deaths (Manasikhat) in the Interview

## Requirements & Constraints

- No signup before calculation. Signup stays optional and available in the navbar, and must never block progress.
- Successive deaths (manasikhat) are captured in the same interview: an heir can be marked as also deceased, gets their own layer of heirs, and people already in the case are linked rather than entered twice. The engine bounds a case to the first death plus up to two later deaths, with a known order of death; Jafari, simultaneous or unknown order (gharqa) and a later deceased's own property are refused or out of scope.
- Family data is captured through step-by-step kinship discovery, and the interview adapts to the selected Madhab (four Sunni schools plus Jafari).
- Invalid kinship inputs are flagged against fiqh constraints, with an explanation and a suggested correction. Heirs blocked by hajb stay offered and are labelled (project owner decision, 2026-11-08), because a blocked heir can still change other shares.
- Live previews come from the deterministic engine only. Cases outside the supported ruleset say that preview is unavailable and never show provisional numbers. A failed or timed-out preview shows a graceful message and never presents a stale result as current.
- Standard calculations return in under 200ms. Calculation output cannot be manually overridden.
- Arabic, English and French, with correct RTL/LTR switching.
- WCAG 2.1 AA: full keyboard use, visible focus, screen-reader labels, RTL-correct focus order, reduced-motion support, high-legibility Arabic fonts.
- Must perform well on mobile browsers over 3G/4G networks.
- Privacy: calculations default to ephemeral. Case data is persisted to an account only when the user explicitly saves.

## Technical Decisions

- **Delivery stack:** Next.js and DRF, approved by the project owner on 2026-11-05 as the Epic 1 stack, with the design confirmed on 2026-11-06. The foundation is built and sits on `development`, not yet on `master`. Stories extend it. Product work stays on `development` until all epics are complete.
- **Deployment shape:** a Next.js static export inside the one release image, served by WhiteNoise under `/app/<locale>/`, with DRF in the same Gunicorn process under `/api/v1/`, same-origin. A Node server or separately deployed frontend needs its own approval. Server-rendered Django pages remain, and marketing pages stay on Django.
- **Static export limits:** no SSR, Next middleware or image optimization, and every route must be known at build time.
- **API rules:** JSON-only and session-authenticated, not the JWT of the older baseline. Permissions default to `IsAuthenticated`, so a public endpoint must opt in with `AllowAny`. New views extend the `ApiView` base, which answers in JSON instead of redirecting to login.
- **Anonymous state:** held in the Django session with a short expiry, chosen by the project owner on 2026-11-05 over the browser-local IndexedDB draft the older baseline describes. This is an accepted exception to "no PII on the server until explicit save". Story 1.1 must:
  - Set the expiry. The project owner chose 24 hours idle on 2026-11-06, which is also the resume-on-return window. The site-wide default stays Django's two weeks for logged-in users.
  - Handle cleanup. Sessions are database-backed and nothing runs `clearsessions` yet. The project owner accepted on 2026-11-06 that session rows stay in encrypted backups for the normal retention of about 6 months.
- **Before the first anonymous write (Story 1.1):** enforce CSRF explicitly, because DRF's `SessionAuthentication` checks it only for logged-in users. Add throttling to the public API, which has none. Allow the `next dev` origin for CSRF, or the first write may be rejected in development.
- **Shell gaps to close:** `/app/` is unlinked and `noindex` today. Real routes and linking it need a fallback when JavaScript is off or chunks fail, a language switcher, handling for tabs left open across a deploy (old chunks can 404), browser-level tests and a Content-Security-Policy.
- **Libraries:** React Query, Zustand, React Hook Form + Zod, shadcn/ui, React Flow (dynamically imported, with custom SVG/d3 as the fallback) and drf-spectacular are planned, and each arrives with the first story that uses it. Use Tailwind logical properties. Planning names next-intl, but the shell uses typed message dictionaries and has no such dependency.
- **Access control:** every Django route requires login unless marked `login_not_required`, and case lookups return 404 to anyone but the owner, so `user=None` cases are unreachable. Anonymous routes must opt out explicitly and define their own ownership rule. The route classification in `calc/tests.py` covers `calc` routes only, so API routes need their own access tests.
- **Engine boundary (target):** a pure domain module with no database writes that works from read-only case snapshots. Engine updates are versioned for determinism. Today's results views write to the database through `compute()`, so Story 1.5 needs an engine that can calculate from unpersisted session data.
- **Shared state and schema:** no state may live in a blue-green slot, and migrations must stay compatible with both slots.
- **Testing:** contract tests align UI and engine output, and representative fixtures confirm that displayed previews match the engine. End-to-end coverage uses Playwright with axe checks and emphasizes keyboard and reduced-motion flows.

## UX & Interaction Patterns

- Flow: landing call to action, Madhab, deceased info, heirs one at a time while the tree grows, review ("Is this complete?"), then calculate.
- The interview lives in an immersive full-screen tree view, one question per view. On desktop, the question is a floating card over the tree. On tablet and mobile, it is a bottom panel or sheet.
- Madhab uses radio options with descriptions. The UX docs suggest preselecting by region, but Story 1.2 expects a validation message when none is selected.
- Fiqh errors are gentle and explanatory: what is wrong, why, and what to do, for example "A deceased cannot have two fathers — would you like to edit?". Entered data is never lost. Validation runs on blur.
- A network interruption preserves state, and an accidental close prompts the user to resume on return. The UX docs describe this as local browser storage, which predates the session decision above.
- Every drag action has a button alternative, and the tree mirrors in RTL.

## Cross-Story Dependencies

- 1.1 establishes the anonymous case state that every later story reads and writes.
- 1.2 and 1.3 feed 1.4 (tree) and 1.5 (preview). 1.6 constrains the heir options offered in 1.3.
- 1.7 builds on the 1.3 interview, 1.4 tree, 1.5 preview and 1.6 rules, and on the Epic 2 layered engine (Story 2.4), which computes layers from database rows and refuses out-of-bounds topologies with one `manasikhat_unsupported` reason. The legacy Django results pages stay out of scope.
- 1.5 depends on the Epic 2 engine for anything beyond its supported ruleset, and 1.2's Madhab choice only affects results once the engine is multi-school.
- Open decision: what users are told about Madhab selection before the engine is multi-school, because choosing Jafari today would show shares calculated without any Madhab logic.
- Epic 4 (save and share) picks up the anonymous case state at the account gate.
