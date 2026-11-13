# Epic 3 Context: Results & Court-Ready Report

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Let users review deterministic inheritance results and generate a formal draft PDF for preparing a Lebanese Hasr al-Irth filing. Explain who inherits, each share and its mathematical and fiqh basis, including supported successive-death cases. Draft reports must remain unmistakably uncertified; lawyer certification is a later private capability, reached through a narrow status extension point without making public draft reporting depend on it.

## Stories

- Story 3.1: Results View for Eligible Heirs
- Story 3.1b: Scholars' Inheritance Table for Single-Death Cases
- Story 3.2: Draft PDF Report Generation with Certification Disclaimer

## Requirements & Constraints

- Results show each eligible heir with their share. A share can be presented as an amount, a percentage and kirat (24ths) where applicable.
- Every result carries its derivation: the proof for how a share was reached, the fiqh citation behind it, and the visual kinship graph of the calculated case.
- No valid result (unsupported case, refused case, failed calculation, nothing calculated yet) means a clear empty or error state that guides the user back to correct the case input. Never show provisional or stale numbers.
- The draft PDF follows Lebanese Hasr al-Irth formatting, includes heirs, shares, a proof summary, fiqh citations and the visual kinship graph, and carries a prominent, non-removable preliminary/draft disclaimer. Formatting does not confer certification or establish court acceptance. PDF failure must allow retry without losing the calculation result.
- Calculation output cannot be manually overridden anywhere in results or reports.
- Arabic, English and French with correct RTL/LTR; WCAG 2.1 AA (keyboard, focus, screen-reader labels, reduced motion); good performance on mobile over 3G/4G.
- Privacy: calculations default to ephemeral; data persists to an account only on explicit save.

## Technical Decisions

- The approved product architecture uses a Next.js static export under `/app/` and DRF under `/api/v1/` inside one Django/Gunicorn release image. No production Node server or separately deployed frontend is approved; release and rollback remain atomic.
- Keep anonymous calculations ephemeral and account persistence explicitly opt-in. Do not introduce a saved case merely to display results or generate a draft.
- Canonical PDF generation belongs to the Django reports service, using server-controlled HTML templates and engine output rendered through WeasyPrint. The frontend handles preview, progress, download and retry, without becoming the authority for court formatting or status.
- Public AGPL code owns draft results and reports and must build, test and run without the private package. Read report status only through a narrow extension point defaulting to `draft`. No certified seal, signature, registry link or certification wording may be implemented in the public repository.
- Certification, its audit, registry and signing keys belong to the private package. Dependencies flow from private to public only. Story 5.0 chooses the extension/package mechanism; nothing is extracted during Epic 3. Release images containing private code must use a private registry.
- Engine output (shares, structured proof, unsupported/refused reasons, manasikhat layers) is a contract consumed by the results view, the PDF and later verification and audit. Do not reshape it ad hoc; contract tests keep UI and engine aligned.
- Legacy server-rendered Django results pages remain and are not the target of this epic.
- Report generation must complete within a bounded web request. Durable asynchronous report workers are explicitly deferred; revisit them before enabling certified reports that cannot finish safely in-request.
- Before canonical reports launch, choose reproducible regeneration from immutable versioned inputs or durable storage covered by backup/restore. Do not keep durable PDFs in disposable app slots or use in-process background threads.
- No state in a blue-green slot; any migration must stay compatible with both slots.

## UX & Interaction Patterns

- The full results screen combines the family tree, the share breakdown and fiqh citations, and tells the inheritance story rather than dumping numbers.
- Progressive disclosure: summary (tree and shares) first; tap or click to expand the proof and citation detail.
- A share result card shows heir name, relationship, fraction (e.g. 1/6), percentage and a citation summary; expanded, it shows the full mathematical proof and source text (`aria-expanded`). Provide accessible mathematical notation and tap-accessible citations identifying the school and a plain-language explanation. Public draft output shows the slate Preliminary badge; certified rendering belongs to the private package.
- Supported successive-death results explain the per-layer proof and consolidated final shares for living eligible heirs. Show original and cascaded distributions with generation navigation; the report design supports separate pages per generation. Refused cases display the engine's reason without provisional numbers.
- Results may offer Tree / List / Report views; skeletons while loading; toasts for errors.
- Download PDF and share actions start from the results screen, with generation progress and retry feedback. Protected sharing respects authentication and consent gates.

## Cross-Story Dependencies

- 3.1 renders what Epic 2 produces and reuses Epic 1's tree and preview pieces; 3.2 builds on the data and presentation that 3.1 settles.
- Successive-death presentation depends on Story 1.7's layered capture and Story 2.4's recursive engine output. The single-death scholars' table complements the results work; PDF rendering consumes the same valid calculation and proof contract.
- Epic 4 (save and share, e.g. WhatsApp) shares results and reports and must preserve the draft disclaimer.
- Story 5.0 gates private marketplace development and chooses the extension mechanism. Private Story 7.5 later performs certification and Story 7.7 supplies registry/QR verification, following the commercial setup in Epic 6. Public draft reporting must remain independent of those capabilities.
