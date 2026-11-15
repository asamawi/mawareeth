---
title: 'Story 4.3: Private link sharing with explicit public consent'
type: 'feature'
created: '2026-11-12'
status: 'done'
baseline_commit: '4d052fd53bf4a370568a71f436dcf457134411e5'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The signed-in Share button is a "coming soon" stub, so a saved case cannot be shown to anyone else.

**Approach:** The owner creates a share link for a saved case. Links are private by default: any signed-in user holding the link can view it, and anonymous visitors are asked to sign in. The owner can make a link public only after explicitly accepting a warning, and can make it private again or revoke it. Links expire after 30 days. The link always shows the saved case's current inputs, with results and the draft PDF recomputed from them, read-only, with the draft status always visible. Create, visibility change, revoke and every view are written to an append-only audit table.

## Boundaries & Constraints

**Always:** The token is `secrets.token_urlsafe(32)`. Only its SHA-256 hex is stored; the token is never a primary key and is never logged. The token reaches the server only in a POST body, never in a URL path or query (the share URL carries it in the `#fragment`). Missing, revoked, expired and unknown tokens all return the same 404. Owner endpoints filter by `owner=request.user` (foreign → 404). A public visibility, at creation or by change, requires `accept_public_warning: true`, else 400 with nothing created or changed. The viewer response and PDF use `report_status` and show the draft/not-certified notice. Results are computed via `preview.preview` from the saved snapshot, never from the viewer's session, and the viewer's session case is never touched. New UI text in ar/en/fr, RTL-correct, keyboard-accessible; the public warning is a modal with focus trap and an explicit confirm. Public links are labelled "Public" wherever listed.

**Ask First:** Changing `SavedCase` or the `anonymous_case` session shape; recording per-recipient grants; adding a Problem+JSON handler.

**Never:** Grants or email invites (4.4); WhatsApp (4.5); recipient editing or copying a shared case into their session; frozen snapshots; anonymization (FR-19, deferred); `useSearchParams` or dynamic routes (static export); deleting audit rows.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Share default | Signed in, results, click Share | Case saved (4.2 save), private link created, URL shown once with Copy | Save/create failure → error notice, retry |
| Create public without consent | `visibility: public`, no accept | 400, no link | N/A |
| Make public | Owner opens warning, confirms | Visibility public, audit `visibility_changed` | Cancel → stays private, no request |
| Private, signed in | Any user, valid token | 200 `{status, visibility, case, preview}`, audit `viewed` | N/A |
| Private, anonymous | Valid token, not signed in | 403 `{code: "sign_in_required"}` → page shows sign-in with `next` to the shared page | Token kept in `sessionStorage` across login |
| Public, anonymous | Valid public token | 200, viewable | N/A |
| Revoked / expired / unknown | Any | 404 "link unavailable" | Same body for all |
| Live content | Owner re-saves after sharing | Viewer sees new inputs and recomputed results | N/A |
| Shared PDF | Viewer clicks Download | Draft PDF from snapshot | 404/409/429/503 as draft PDF |
| Foreign manage | Non-owner PATCH/DELETE share | 404 | N/A |

</frozen-after-approval>

## Code Map

- `api/models.py:5` `SavedCase` — add `ShareLink(saved_case FK CASCADE, token_hash unique char64, visibility private|public, created_at, expires_at, revoked_at null)` and `ShareAuditEvent(share_id int, saved_case_id int, actor_id int null, action, at)`: plain ints, no FKs, so user or case deletion never removes audit rows. Migration `api/migrations/0002_*.py`.
- `api/anonymous_case.py:236` `get()` parses the session through `_read_deceased`/`_read_heirs`/`_read_deaths` (`:180,189,360`) and computes `heir_options`. Extract a session-free `read_snapshot(snapshot) -> case dict` (id = `f"share-{share.pk}"`, `started_at` = row.updated_at) reused by `get()`. `export_snapshot` `:655`.
- `api/views.py:26` `ApiView` (default IsAuthenticated, `{detail}`); `:228-266` saved-case views to mirror; `PreviewView:181` shows preview error handling and `_asked_language:166`. `api/permissions.py:5` `CsrfProtectedWrites` for anonymous POSTs.
- `api/urls.py:9` — add routes before the catch-all `:21`.
- `reports/views.py:31` `DraftReportView` — factor the preview → status check → `render_pdf(case, body)` → response into a helper reused by the shared PDF endpoint. `reports/report.py:113` `render_pdf`. `reports/status.py:5`.
- `api/throttling.py` — add a `ShareViewThrottle` (scope `share_view`, e.g. 300/hour) and register the rate in `mawareeth/settings.py:331`. `SECURE_REFERRER_POLICY='same-origin'` `:380` is already set.
- `mawareeth/middleware.py:47` — the session lock covers the `saved-cases/` prefix; `shares/` endpoints must not write the session, so no lock needed.
- `web/src/api/case.ts:359` `write()` (CSRF and timeouts), `:1283` `downloadDraftReport` (pattern for the blob download); `web/src/api/saved-cases.ts` — `saveCase`.
- `web/src/app/[locale]/results/auth-gate.tsx:69,81,83` Share stub; `auth-gate-state.ts:14` `authorizedAction` returns `notice` for share.
- `web/src/app/[locale]/results/results-view.tsx:128` `Available({messages, locale, kase, preview, back})` renders AuthGate `:165` and DraftDownload `:166`/`:338`. Add props so the shared page reuses it without the AuthGate and with an injected download action.
- `web/src/i18n/paths.ts` `loginHref`, `casesPath`; `web/src/i18n/messages.ts:15` types, `cases :17`, `results :172` (ar `:480`, en `:777`, fr `:1077`).
- Tests: `api/tests.py:3035` `SavedCaseTests(InterviewBase)` (helpers and `force_login`); `web/src/app/[locale]/results/auth-gate-state.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `api/models.py`, `api/migrations/0002_sharing.py` — `ShareLink` and `ShareAuditEvent` as mapped; `api/sharing.py` — issue (token + hash), resolve (hash lookup, live + not expired + not revoked), audit helper.
- [x] `api/anonymous_case.py` — `read_snapshot`, with `get()` refactored onto it.
- [x] `api/views.py`, `api/urls.py` — `saved-cases/<id>/shares/` GET list (no tokens) / POST create `{visibility, accept_public_warning}` → 201 `{id, token, visibility, expires_at}`; `shares/<int:id>/` PATCH visibility / DELETE revoke (owner-scoped); `shares/view/` POST `{token}` (AllowAny + CSRF + throttle); `shares/report/` POST `{token}` → PDF.
- [x] `reports/views.py` — shared PDF helper used by both endpoints.
- [x] `api/tests.py` — every matrix row, plus: only the hash is stored, the token is absent from list responses, an audit row per action, an expiry boundary, and the viewer's session case unchanged.
- [x] `web/src/api/shares.ts` (+ `.test.ts`) — create/list/update/revoke/view/report client calls.
- [x] `web/src/app/[locale]/results/auth-gate.tsx`, `auth-gate-state.ts` (+ test), new `share-panel.tsx` — signed-in Share saves, then creates a private link; the panel shows the new URL with Copy, lists links (Private/Public badge, expiry), Make public (warning modal), Make private, Revoke.
- [x] `web/src/app/[locale]/shared/page.tsx`, `shared-view.tsx` — reads the token from `location.hash` (stashes it in `sessionStorage` and strips the hash), calls view, renders the draft banner and the read-only `Available`; sign-in prompt; unavailable state.
- [x] `web/src/app/[locale]/results/results-view.tsx` — make `Available` reusable (optional gate, injectable download).
- [x] `web/src/i18n/messages.ts`, `paths.ts` — strings ar/en/fr; `sharedPath(locale)`.

**Acceptance Criteria:**
- Given a new link, then the DB holds no raw token, and its default visibility is private.
- Given a link made public, when listed in the share panel, then it shows a "Public" badge.
- Given any shared view or shared PDF, then the draft/not-certified status is visible.
- Given `npm run build`, then the export includes `/app/<locale>/shared/` with no new warnings.

## Design Notes

Share URL: `https://<host>/app/<locale>/shared/#<token>`. The fragment never reaches the server, access logs or `Referer`. The shared page moves the token into `sessionStorage` and calls `history.replaceState` to drop the hash, so the token survives a login round trip whose `next` is `/app/<locale>/shared/` without the token. Hashing is plain SHA-256: the 256-bit random token makes a keyed hash unnecessary, and stored links survive a `SECRET_KEY` rotation. The raw token is returned only in the create response; a lost URL means creating a new link.

## Verification

**Commands:**
- `uv run python manage.py test api reports calc --noinput` (local PG18) — expected: pass.
- `cd web; npm test; npm run lint; npm run build` — expected: pass.

**Manual checks (if no CLI):**
- In ar: share from results, copy the link, open it in a private window, sign in and see the results with the draft banner; make it public after the warning; it now opens without sign-in; revoke it and it shows as unavailable.

## Suggested Review Order

**Resolving a link**

- Entry point: one 404 for unknown/revoked/expired/unsupported; private needs sign-in
  [`views.py:331`](../../api/views.py#L331)

- Hash lookup, expiry and revocation check; unencodable tokens become None
  [`sharing.py:36`](../../api/sharing.py#L36)

- Viewer response recomputed from the live snapshot; session never touched
  [`views.py:348`](../../api/views.py#L348)

- Session-free snapshot reader, now also backing `get()`
  [`anonymous_case.py:248`](../../api/anonymous_case.py#L248)

**Issuing and managing links**

- Token minted once, only its SHA-256 stored, audit in the same transaction
  [`sharing.py:25`](../../api/sharing.py#L25)

- Public visibility rejected unless the warning was accepted
  [`views.py:268`](../../api/views.py#L268)

- Owner-scoped list/create; tokens never listed
  [`views.py:286`](../../api/views.py#L286)

- PATCH/DELETE owner-scoped and limited to live, unexpired links
  [`views.py:302`](../../api/views.py#L302)

**Data model and audit**

- Link model: hash, visibility, expiry, revocation
  [`models.py:16`](../../api/models.py#L16)

- Append-only audit: plain big-int ids, queryset delete/update raise
  [`models.py:33`](../../api/models.py#L33)

**Shared PDF**

- Draft PDF pipeline factored out and reused by both endpoints
  [`views.py:52`](../../reports/views.py#L52)

- Token-resolved PDF endpoint
  [`views.py:74`](../../reports/views.py#L74)

**Frontend**

- Token moved from fragment to sessionStorage; hash always stripped
  [`shared-view.tsx:17`](../../web/src/app/[locale]/shared/shared-view.tsx#L17)

- Shared page: banner, sign-in prompt, unavailable state, read-only results
  [`shared-view.tsx:44`](../../web/src/app/[locale]/shared/shared-view.tsx#L44)

- Make public only after the warning dialog's explicit confirm
  [`share-panel.tsx:63`](../../web/src/app/[locale]/results/share-panel.tsx#L63)

- Share saves the case, then mints a private link
  [`auth-gate.tsx:27`](../../web/src/app/[locale]/results/auth-gate.tsx#L27)

- `Available` reusable without the gate and with injected download
  [`results-view.tsx:129`](../../web/src/app/[locale]/results/results-view.tsx#L129)

- Client calls through the shared CSRF write helper
  [`shares.ts:28`](../../web/src/api/shares.ts#L28)

- Share URL carries the token in the fragment
  [`paths.ts:39`](../../web/src/i18n/paths.ts#L39)

**Peripherals**

- Routes before the catch-all
  [`urls.py:23`](../../api/urls.py#L23)

- Throttle scope and rate
  [`throttling.py:45`](../../api/throttling.py#L45)
  [`settings.py:332`](../../mawareeth/settings.py#L332)

- Backend tests: matrix rows, hash-only, audit, expiry, throttle, schema
  [`tests.py:3181`](../../api/tests.py#L3181)

- New share and shared strings in ar/en/fr
  [`messages.ts:18`](../../web/src/i18n/messages.ts#L18)
