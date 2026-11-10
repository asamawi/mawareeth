# Epic 3 Context: Results & Court-Ready Report

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Let a user see the finished calculation on screen and produce a formal PDF report whose certification status cannot be misread. Epic 1 gets a visitor to a live preview and Epic 2 makes the engine deterministic, multi-school and proof-producing; this epic turns that engine output into the product's deliverable: the answer to the court's "Hasr al-Irth" step (who inherits and what share), with the *why* (proof and fiqh citations) next to the *what*. A draft report must always say plainly that it is not certified, and a certified one must say so too, because families, lawyers and court clerks will act on it.

## Stories

- Story 3.1: Results View for Eligible Heirs
- Story 3.2: Draft PDF Report Generation with Certification Disclaimer

## Requirements & Constraints

- Results show each eligible heir with their share. A share can be presented as an amount, a percentage and kirat (24ths) where applicable.
- Every result carries its derivation: the proof for how a share was reached, the fiqh citation behind it, and the visual kinship graph of the calculated case.
- No valid result (unsupported case, refused case, failed calculation, nothing calculated yet) means a clear empty or error state that guides the user back to correct the case input. Never show provisional or stale numbers.
- The PDF follows Lebanese Hasr al-Irth formatting, includes heirs, shares, a proof summary and fiqh citations, and carries a "Preliminary" or "Verified" watermark or status according to review status. An uncertified report must carry a prominent draft/not-certified disclaimer that cannot be mistaken for certification.
- Calculation output cannot be manually overridden anywhere in results or reports.
- Arabic, English and French with correct RTL/LTR; WCAG 2.1 AA (keyboard, focus, screen-reader labels, reduced motion); good performance on mobile over 3G/4G.
- Privacy: calculations default to ephemeral; data persists to an account only on explicit save.

## Technical Decisions

- Stack and deployment are those in `epic-1-context.md`: Next.js static export served under `/app/<locale>/`, DRF under `/api/v1/` in the same Gunicorn process, session auth, JSON-only, `AllowAny` opt-in for public endpoints, CSRF and throttling on anonymous writes. Static export means every route is known at build time (no dynamic route segments).
- The anonymous case lives in the Django session (24-hour idle expiry). Results for an anonymous case must come from that session state, not from a saved `Case` row.
- Engine output (shares, structured proof, unsupported/refused reasons, manasikhat layers) is a contract consumed by the results view, the PDF and later verification and audit. Do not reshape it ad hoc; contract tests keep UI and engine aligned.
- Legacy server-rendered Django results pages remain and are not the target of this epic.
- Report generation must complete within a bounded web request. Durable asynchronous report workers are explicitly deferred; revisit them before enabling certified reports that cannot finish safely in-request.
- No state in a blue-green slot; any migration must stay compatible with both slots.

## UX & Interaction Patterns

- The full results screen combines the family tree, the share breakdown and fiqh citations, and tells the inheritance story rather than dumping numbers.
- Progressive disclosure: summary (tree and shares) first; tap or click to expand the proof and citation detail.
- A share result card shows heir name, relationship, fraction (e.g. 1/6), percentage and a citation summary; expanded, it shows the full mathematical proof and source text (`aria-expanded`). Certification state is a badge: "Preliminary" (slate) or "Mawareeth-Certified" (amber, check).
- Results may offer Tree / List / Report views; skeletons while loading; toasts for errors.
- Download PDF and share actions start from the results screen.

## Cross-Story Dependencies

- 3.1 renders what Epic 2 produces and reuses Epic 1's tree and preview pieces; 3.2 builds on the data and presentation that 3.1 settles.
- Epic 4 (save and share, e.g. WhatsApp) shares results and reports and must preserve the draft disclaimer.
- Epic 7 (lawyer certification, Story 7.5) later swaps the draft disclaimer for certified status indicators; Epic 6 commercial setup gates the certified path.
