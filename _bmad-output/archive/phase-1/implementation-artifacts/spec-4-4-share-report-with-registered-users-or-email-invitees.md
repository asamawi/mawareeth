---
title: 'Story 4.4: Share a saved case with registered users or email invitees'
type: 'feature'
created: '2026-11-12'
status: 'done'
baseline_commit: '511a1621fab2bcd1f19102f6839c668d798207be'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-3-private-link-sharing-with-explicit-public-consent.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Bind invite acceptance to a verified email address once the auth stack verifies emails.
    evidence: |-
      accept() binds whichever signed-in account first redeems the token, so a forwarded or leaked invite email can be redeemed by someone else. Matching on User.email is not safe today: registration does not verify email, User.email is not unique, and social login uses associate_by_email.
    location: >-
      api/invites.py accept()
    severity: medium
---

<intent-contract>

## Intent

**Problem:** A saved case can only be shared through 4.3 links, which any signed-in holder of the link can open. An owner cannot give access to one chosen person and nobody else.

**Approach:** The owner invites a person by email address from the share panel. The server emails a one-time invite link. The recipient must sign in or register, then redeems it, and from then on only that account can open the case. This works the same way for existing users and for new ones. The recipient sees invited cases under "Shared with me" and opens them read-only, with results and the draft PDF recomputed from the owner's live snapshot. The owner sees each invite's status and can revoke it, and revocation cuts off access at once.

## Boundaries & Constraints

**Always:** The invite token is `secrets.token_urlsafe(32)`. Only its SHA-256 hex is stored. The token never goes in an API response, a log, or a URL path or query: the email link carries it in the `#fragment`, and the client POSTs it. Access is bound to the user who redeems the invite, never to the address on the account (`User.email` is neither unique nor verified). Unknown, revoked, expired and other-user-redeemed tokens all return the same 404 body. A revoked or expired invite denies the view and the PDF straight away. Owner endpoints filter by `owner=request.user`, and recipient endpoints filter by `accepted_by=request.user` (anything else → 404). Invites expire 30 days after creation. The email contains no case data: no deceased name, heirs or amounts. Creating the row, writing the audit row and sending the email happen in one transaction: if sending fails, the response is 503 and nothing is stored. Every created, accepted, revoked, viewed and report_downloaded event writes an append-only audit row. The recipient view shows the draft/not-certified notice and never touches the recipient's session case. New UI text is in ar/en/fr, works RTL and is keyboard-accessible.

**Block If:** The work needs a change to `SavedCase`, the `anonymous_case` session shape, or the 4.3 `ShareLink` access rules.

**Never:** Granting access by matching an account's email address. Changing how 4.3 links resolve. WhatsApp (4.5). Recipient editing or copying a shared case into their session. Frozen snapshots. Anonymization. Scopes other than viewing. `useSearchParams` or dynamic routes (static export). Deleting audit rows.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Invite | Owner POSTs `{email}` for an owned saved case | 201 `{id, email, status: "pending", expires_at}` (no token); one email to that address; audit `created` | Invalid email → 400, nothing stored; send failure → 503, nothing stored; throttled → 429 |
| Accept, anonymous | Valid token, not signed in | 403 `{code: "sign_in_required"}`; page offers sign-in/registration with `next` back to the invite page | Token kept in `sessionStorage` across login |
| Accept | Signed-in user, pending token | 200 `{id}`; invite bound to that user; audit `accepted`; page goes to the received view | N/A |
| Accept again | Same user, already bound | 200 `{id}`, no new audit row | N/A |
| Token reused | Different user, bound invite | 404 same body as unknown | N/A |
| Revoked / expired / unknown | Any | 404 same body | N/A |
| Recipient view | Bound user, live invite | 200 `{status, case, preview}`; audit `viewed` | Preview failure → 503 |
| Other user views | Any id not bound to them | 404 | N/A |
| Revoke | Owner DELETEs the invite | 204; audit `revoked`; recipient view, PDF and list entry disappear | Foreign → 404 |
| Received PDF | Bound user downloads | Draft PDF from the live snapshot; audit `report_downloaded` | 404/409/429/503 as for the draft PDF |

</intent-contract>

## Code Map

- `api/models.py:16` `ShareLink`, `:41` `ShareAuditEvent` — add `ShareInvite(saved_case FK CASCADE related_name='invites', email char254 (stored stripped and lowercased), token_hash unique char64, created_at, expires_at, accepted_by FK user null SET_NULL, accepted_at null, revoked_at null)`. Add `ShareAuditEvent.subject` char8, default `'link'`. Invite events use `subject='invite'`, `share_id=invite.pk` and `visibility='invite'`. Migration `api/migrations/0003_invites.py`.
- `api/sharing.py` — model for the new code: `hash_token`, `audit` (extend it with `subject`), `issue`, `resolve`, `revoke`, `LINK_LIFETIME`. Add the invite functions here or in `api/invites.py`: create+email, resolve by token, accept (`select_for_update`), revoke.
- `api/views.py:268-376` — `_visibility`, `SavedCaseSharesView`, `ShareView` (owner scoping), `SharedCaseMixin` (`read_snapshot(row.snapshot, f'share-{pk}', row.updated_at.isoformat())`, schema check), `SharedViewView` (preview with `_asked_language`, error logging). Mirror these. Use case id `f'invite-{pk}'`.
- `reports/views.py:52` `draft_pdf_response(request, case)`, `:74` `SharedReportView` (throttles) — reuse for the received PDF.
- `api/urls.py` — new routes before the catch-all: `saved-cases/<int:id>/invites/` (GET list, POST create), `invites/<int:id>/` (DELETE), `invites/accept/` (POST), `received/` (GET), `received/<int:id>/view/` (POST), `received/<int:id>/report/` (POST).
- `api/throttling.py` — add `ShareInviteThrottle(UserRateThrottle)` with scope `share_invite`, and `mawareeth/settings.py:331` rate `'share_invite': '30/hour'`. Use `ShareViewThrottle` on the accept/view/report endpoints, and also `ReportDraftThrottle` on the report endpoint.
- Email: `send_mail` with `DEFAULT_FROM_EMAIL` (`mawareeth/settings.py:361-372`; console backend in dev, locmem in tests). The text is gettext-translated under `translation.override(_asked_language(request))`, and the link is `request.build_absolute_uri(f'/app/{lang}/invite/') + '#' + token`. New msgids go into `locale/{ar,en,fr}/LC_MESSAGES/django.po`; compile the `.mo` files.
- `web/src/api/shares.ts` — client pattern (`write()`, CSRF, parse helpers, result kinds); `downloadSharedReport` is the pattern for the PDF blob.
- `web/src/app/[locale]/shared/shared-view.tsx` — pattern for fragment → `sessionStorage` → `replaceState`, sign-in prompt, draft banner and read-only `Available` with an injected `download`. Factor shared pieces out if it keeps both files simple.
- `web/src/app/[locale]/results/share-panel.tsx` — owner share panel; add the invite form and list here.
- `web/src/app/[locale]/cases/cases-view.tsx` — add the "Shared with me" section.
- `web/src/i18n/paths.ts` (`sharedPath`, `shareUrl`), `web/src/i18n/messages.ts` (types, ar/en/fr blocks, `shared` strings).
- Tests: `api/tests.py:3197` `ShareTests(InterviewBase)` — helpers to copy; `web/src/app/[locale]/shared/shared-view.test.tsx`, `results/share-panel.test.tsx`, `cases/cases-view.test.tsx`.

## Tasks & Acceptance

**Execution:**
- [x] `api/models.py`, `api/migrations/0003_invites.py` -- `ShareInvite` and `ShareAuditEvent.subject` as mapped.
- [x] `api/sharing.py` (or `api/invites.py`) -- invite create (token, hash, audit, email in one transaction), resolve, accept, revoke.
- [x] `api/views.py`, `api/urls.py`, `api/throttling.py`, `mawareeth/settings.py`, `reports/views.py` -- endpoints as mapped. The owner list returns `{invites: [{id, email, status: pending|accepted|expired, accepted_by: username|null, created_at, expires_at}]}` and leaves out revoked rows. `received/` returns `{received: [{id, owner: username, updated_at, expires_at}]}` for live invites bound to the user.
- [x] `locale/*/LC_MESSAGES/django.po` (+ compiled `.mo`) -- email subject and body in ar/en/fr.
- [x] `api/tests.py` -- `InviteTests`: every matrix row, plus: only the hash is stored; the token is absent from every JSON response and present in the email; the email has no case data; one audit row per event; an expiry boundary; the recipient's session case is unchanged; a user whose `email` matches the invite gets nothing without redeeming.
- [x] `web/src/api/invites.ts` (+ `.test.ts`) -- create/list/revoke/accept/listReceived/viewReceived/downloadReceivedReport.
- [x] `web/src/app/[locale]/results/share-panel.tsx` (+ test) -- labelled email input with Send, success/error notice, and an invite list (email, Pending/Accepted badge, expiry, Revoke).
- [x] `web/src/app/[locale]/invite/page.tsx`, `invite-view.tsx` (+ test) -- token from the fragment into `sessionStorage` (key `mawareeth.invite-token`), hash stripped; accept; sign-in/register prompt; unavailable state; on success, forget the token and `router.replace` to the received view.
- [x] `web/src/app/[locale]/received/page.tsx`, `received-view.tsx` (+ test) -- id from `location.hash` (digits only); draft banner, owner name, read-only `Available`, PDF via the received report endpoint; sign-in prompt; unavailable state.
- [x] `web/src/app/[locale]/cases/cases-view.tsx` (+ test) -- "Shared with me" list linking to the received view.
- [x] `web/src/i18n/paths.ts`, `messages.ts` -- `invitePath(locale)`, `receivedPath(locale, id)` (`/${locale}/received/#${id}`), and strings in ar/en/fr.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- add an entry asking for native review of the new ar/en/fr UI and email text.

**Acceptance Criteria:**
- Given an invite redeemed by user A, when user B (even one whose account email equals the invited address) requests the received view or PDF for that id, then the response is 404.
- Given an invite revoked by the owner, when the recipient reloads "Shared with me" or the received view, then the case is gone and the view shows "unavailable".
- Given any received view or PDF, then the draft/not-certified status is visible.
- Given `npm run build`, then the export includes `/app/<locale>/invite/` and `/app/<locale>/received/` with no new warnings.

## Spec Change Log

## Review Triage Log

### 2026-11-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 2, medium 2, low 2)
- defer: 1 (medium 1)
- reject: 13 (medium 2, low 11)
- addressed_findings:
  - `[high]` `[patch]` The new ar/fr strings in `messages.ts` and the ar/fr `django.po` were saved with every Arabic character and French accent replaced by `?`. Rewrote them as UTF-8 and recompiled the `.mo` files with `compile_catalog`.
  - `[high]` `[patch]` The invite form only appeared inside `SharePanel`, so inviting someone first minted a bearer link that any signed-in holder could open. Moved `InvitePanel` to `AuthGate`, shown once a saved id is known from Save or Share, and removed it from `SharePanel`.
  - `[medium]` `[patch]` The invite page accepted automatically on load, which could bind the invite to whichever account happened to be signed in. Added an explicit "Accept invitation" button (`invites.accept`, ar/en/fr).
  - `[medium]` `[patch]` Test gaps: the invite-form test now types an address and asserts the exact POST body. The received-view test now covers the read-only success branch and checks that Download posts to `/api/v1/received/<id>/report/`.
  - `[low]` `[patch]` A stale initial invite list could overwrite the list after a send or revoke. The panel now refetches after each mutation and aborts or ignores older list requests.
  - `[low]` `[patch]` The received view now reloads on `hashchange`.

## Design Notes

One mechanism covers both "registered user" and "email invitee". `User.email` is unverified and not unique, and social login uses `associate_by_email`, so looking a person up by address could give the case to whoever registered that address first. The invite link proves the recipient can read that inbox, and redemption binds the grant to one account. This matches the architecture's "private invite resolves against the current session plus the share grant". The 4.3 links stay as they are; they are a separate bearer mechanism.

Recipient URLs: `/app/<locale>/invite/#<token>` (email) and `/app/<locale>/received/#<id>` (the id is not a secret, because access checks `accepted_by`).

## Verification

**Commands:**
- `uv run python manage.py makemigrations --check --dry-run` -- expected: no changes.
- `uv run python manage.py test api reports --noinput` (local PG18) -- expected: pass.
- `cd web; npm test; npm run lint; npm run build` -- expected: pass.

**Manual checks (if no CLI):**
- In ar: invite an address from the results share panel; open the link from the console email in another browser; register; the case shows under "Shared with me" with the draft banner; revoke it; the case is gone.

## Auto Run Result

**Summary:** Owners invite a person by email to view a saved case. The server emails a one-time link (the token is in the `#fragment`, and only its SHA-256 is stored). The recipient signs in or registers and explicitly accepts; access is then bound to that account alone. Recipients see invited cases under "Shared with me" and open them read-only, with the draft banner, live recomputed results and the draft PDF. Owners see each invite's status and can revoke it, and revocation takes effect immediately. Every created, accepted, revoked, viewed and report_downloaded event writes an append-only audit row. The 4.3 links are unchanged.

**Files changed:**
- `api/models.py`, `api/migrations/0003_invites.py`: `ShareInvite` model; `ShareAuditEvent.subject` (`link` or `invite`).
- `api/invites.py`: issue (row, audit and email in one transaction; 503 and nothing stored when sending fails), resolve, accept (row lock, account-bound, idempotent), revoke.
- `api/sharing.py`: `audit()` takes a subject.
- `api/views.py`, `api/urls.py`: owner invite list/create/revoke, accept, received list/view; one 404 body for unknown, revoked, expired and other-user tokens.
- `reports/views.py`: received-case draft PDF endpoint, reusing `draft_pdf_response`.
- `api/throttling.py`, `mawareeth/settings.py`: `ShareInviteThrottle`, a per-user limit of 30/hour.
- `locale/{ar,en,fr}/LC_MESSAGES/django.po/.mo`: invitation email subject and body.
- `api/tests.py`: `InviteTests`, covering every matrix row and the extra checks.
- `web/src/api/invites.ts` (+ test): client calls.
- `web/src/app/[locale]/results/invite-panel.tsx`, `auth-gate.tsx` (+ tests): invite form and list, shown once the case is saved.
- `web/src/app/[locale]/invite/*`: the token-accept page with an explicit Accept button.
- `web/src/app/[locale]/received/*`: the read-only received case.
- `web/src/app/[locale]/cases/cases-view.tsx` (+ test): "Shared with me" list.
- `web/src/i18n/messages.ts`, `paths.ts`: ar/en/fr strings, `invitePath` and `receivedPath`.
- `_bmad-output/implementation-artifacts/deferred-work.md`: native-review entry for the new text.

**Review findings:** 6 patches applied (high 2, medium 2, low 2), 1 deferred, 13 rejected. The rejected findings: email delivery is not durable outside the transaction; duplicate invites on retry; list pagination and retention; concurrency tests; no loading state for the received list; storage-failure token recovery (same behavior as 4.3); unaborted mutation controllers; the expiry check running before the row lock; no invite management on the cases page; full end-to-end journey tests.

**Follow-up review recommendation:** true. Patched findings by severity: high 2, medium 2, low 2. Score 3×2 + 1×2 = 8, and two of the patched findings were high.

**Verification:**
- `uv run python manage.py makemigrations --check --dry-run`: no changes.
- `uv run python manage.py test api.tests.InviteTests api.tests.ShareTests api.tests.SavedCaseTests reports calc.tests.TemplateTagTests --noinput`: 47 tests, OK (1 skipped). This includes the stale-`.mo` and empty-translation catalog checks. The full `api` and `calc` suites were not run; the driver runs them per batch.
- `npm test`: 382 passed. `npm run lint`: 0 errors and 9 warnings, all of which predate this story. `npm run build`: compiled, and the export includes `/app/{ar,en,fr}/invite/` and `/app/{ar,en,fr}/received/`.
- Matrix audit: every I/O row has a covering backend test that passed.

**Residual risks:**
- Whoever holds the invite link can accept it, because the app has no verified email to match against (deferred).
- The new ar/fr text needs native review.
- The manual browser journey (real login round trip and console email) was not run.
- The intent auditor noted another reading of the story: access tied to the account whose email matches the invite. This run chose redemption-binding because emails are unverified and not unique. A human should confirm that choice.