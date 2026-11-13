# Epic 4 Context: Save, Share, and Privacy

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Let users optionally save draft cases and reports to an account, share them with chosen recipients, and control privacy and anonymization without adding signup friction to calculation. Family and financial information stays off the server until an authenticated user explicitly chooses persistence or protected sharing. Draft saving and sharing remain public capabilities, independent of the later private lawyer marketplace and certification package.

## Stories

- Story 4.1: Account Creation Gate for Save and Sharing
- Story 4.2: Save Draft Report to Registered Account
- Story 4.3: Private Link Sharing with Explicit Public Consent
- Story 4.4: Share Report with Registered Users or Email Invitees
- Story 4.5: WhatsApp Share for Registered Users

## Requirements & Constraints

- Calculation requires no account. Saving or protected sharing requires registration or sign-in before the action completes; successful authentication returns the user to the interrupted action with the current calculation context intact.
- Save a valid draft case and its report under the authenticated owner's account for later retrieval. Saving, reopening or distributing a report preserves its draft/non-certified status and non-removable preliminary disclaimer.
- Calculations default to no server-side PII persistence. Anonymize sensitive financial information while preserving kinship logic; the planning material specifies the outcome but does not define an anonymization algorithm.
- Shared links are private by default. Only authenticated, authorized recipients can access private reports. Email invitees must register or sign in and be authorized before report access is granted.
- Public sharing requires the owner's explicit acceptance of a clear warning that anyone with the link may access private information. Do not create a public link before that acceptance; visibly identify public links wherever displayed.
- Sharing permissions can be changed or revoked, and access must reflect the updated authorization. Links support expiry, revocation and audit logging, with minimum access scopes such as report viewing or case-summary viewing.
- WhatsApp sharing starts from an authenticated account with a saved draft report and preserves the draft disclaimer in the prepared report or link. If unavailable on the device, show a clear fallback and return to the report without losing progress.
- Protect stored data with AES-256 and transit with TLS 1.3. The actual production and backup encryption-at-rest control must be documented before public launch; private database networking alone does not establish encryption at rest.

## Technical Decisions

- Product delivery uses a Next.js static export served under `/app/` and DRF under `/api/v1/` in one Django/Gunicorn release image. There is no production Node server; release and rollback remain atomic.
- Anonymous drafts live in browser-local IndexedDB through a versioned draft repository, keyed by a generated `draft_id`. Invalidate incompatible schemas; expire drafts after 30 days of inactivity and allow manual clearing. On return, offer resume, discard or a new case.
- Authentication alone does not silently promote a local draft. On explicit save, submit the current snapshot to the cases API, receive its canonical persisted identifier and retain the local mapping for resume. Protected sharing also requires authentication and explicit consent before server-side storage or distribution.
- Django owns authentication and authorization. The product auth plan supports Google OAuth and email/password, with email, TOTP and WhatsApp MFA. Private invite resolution checks both the current authenticated session and its share grant; public resolution checks token validity, expiry and report visibility rules.
- A dedicated share-link service owns issuance, permission checks, expiry and revocation. Use opaque random tokens signed for transport integrity, store only their hashes with metadata, and never use tokens as primary case or report identifiers.
- Keep case/heir persistence, read-only engine snapshots and canonical report generation separate. Django's reports service generates authoritative PDFs from controlled templates and engine output; the frontend owns preview, download feedback and retry. API errors use Problem+JSON.
- PostgreSQL owns durable case data and domain audit events. Draft share-link audit remains public and append-only; rotating container logs are not the audit store. Canonical reports require either reproducible regeneration from immutable versioned inputs or durable storage protected by backup/restore, never disposable app-slot storage.
- Draft cases, reports and sharing stay in the public AGPL repository. Public code builds, tests and runs without the private package and reads report status only through an extension point defaulting to `draft`. Certification actions, seals, signatures, registry links and certified rendering belong to the private package. Dependencies run from private to public only; Story 5.0 selects the package mechanism, with no extraction during Epic 4.

## UX & Interaction Patterns

- Save and sharing actions follow the results screen. WhatsApp is the primary sharing action, alongside link and email; keep the path short while preserving authentication and consent gates.
- Account creation uses a dialog at the save/share boundary. Make save and retrieval simple across devices, with clear saved/share-success feedback and actionable error feedback. Local auto-save must remain distinct from account persistence.
- Keep preliminary status visible in saved and shared views. A public link warning must communicate the exposure of private family information plainly before confirmation.
- Support Arabic, English and French, correct RTL/LTR, WCAG 2.1 AA, keyboard access, visible focus, screen-reader labels and reduced motion. Mobile interactions must work well over 3G/4G.

## Cross-Story Dependencies

- Epic 1 supplies the anonymous interview/draft context; Epics 2 and 3 supply valid deterministic results and the draft report being saved or shared.
- Account gating supports every save/share path. Saved draft reports underpin recipient invitations and WhatsApp sharing; link issuance and current authorization underpin controlled recipient access.
- Later private certification and marketplace flows consume persisted cases and reports. Epic 4 must preserve their status seam without depending on Epic 5's bootstrap or implementing certification behavior.
