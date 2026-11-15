---
title: 'Story 4.5: WhatsApp share for registered users'
type: 'feature'
created: '2026-11-13'
status: 'done'
baseline_commit: 'e648a2314b07367322aa154dd4c9b407989cc343'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-3-private-link-sharing-with-explicit-public-consent.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Owners can save a case and share it through copied links or email invitations, but there is no WhatsApp action, even though the UX makes WhatsApp the main way to share.

**Approach:** Add a WhatsApp button next to Save and Share on the results page. It goes through the same sign-in gate. Once the user is signed in, it saves the case and creates a **private** 4.3 share link, the same way Share does. It then shows an "Open WhatsApp" button that opens `https://wa.me/?text=…`, with a message made of the existing draft disclaimer (`shared.banner`) and the link. If the WhatsApp window cannot be opened, a clear fallback message points the user to the copyable link that is already on the page. The results page stays where it is.

## Boundaries & Constraints

**Always:** The WhatsApp message includes the localized draft/not-certified disclaimer (`messages[locale].shared.banner`) and the private share URL from `shareUrl()`, separated by a newline and encoded with `encodeURIComponent`. The link is created with visibility `private`. Recipients must sign in, and the 4.3 shared view already shows the draft banner. Anonymous users and users whose auth state is still loading get the existing auth dialog, and sign-in/registration resume with `?resume=whatsapp`. Opening WhatsApp happens in a fresh click handler, a separate user gesture after the link is ready, so popup blockers do not swallow it. Use `window.open(url, "_blank")`; when it returns `null`, show the fallback. When it opens, set `opener = null`. The results page, the session case and the SharePanel (link + Copy + list) stay on screen in every outcome. New UI text is in ar/en/fr, works RTL and is keyboard-accessible, with `role="status"` / `role="alert"` used as elsewhere.

**Block If:** The work needs a backend change, a change to the 4.3 `ShareLink` rules, or a public link.

**Never:** Sending the PDF or any case data in the WhatsApp text. Creating a public link. The Web Share API or file sharing. WhatsApp Business API or server-side sending. Automatically opening WhatsApp after the async prepare step. Changing the existing Share, Save or invite behavior. `useSearchParams` or dynamic routes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Anonymous click | Not signed in, clicks WhatsApp | Auth dialog opens. Sign-in and register hrefs carry `next=/app/<locale>/results/?resume=whatsapp`. No save or share request | N/A |
| Resume | Back from login with `?resume=whatsapp`, authenticated | Param stripped; save + private share created; WhatsApp panel shown | Same as prepare failure |
| Prepare | Authenticated, clicks WhatsApp | POST save, then POST share with `{"visibility":"private"}`; SharePanel shown plus the WhatsApp panel (ready status + "Open WhatsApp" button) | Save or create fails → the existing `share.createError` alert; no WhatsApp panel |
| Open | Panel shown, clicks "Open WhatsApp" | `window.open("https://wa.me/?text=" + encodeURIComponent(banner + "\n" + url), "_blank")`; the opened window's `opener` is nulled | N/A |
| Unavailable | `window.open` returns `null` (blocked or no WhatsApp handler window) | `role="alert"` fallback: WhatsApp could not be opened here, copy the link above and send it another way; results and SharePanel unchanged | User can retry the button |

</intent-contract>

## Code Map

- `web/src/app/[locale]/results/auth-gate-state.ts` -- `Action = "save" | "share"`, `parseResume` (accepts only save/share), `authorizedAction`. Add `"whatsapp"` to all three. `authorizedAction` returns the action when authenticated, otherwise `"dialog"`.
- `web/src/app/[locale]/results/auth-gate.tsx` -- The `runShare` callback (save, then `createShare`, then `shareState`) is the prepare step to reuse. Record which action started it (for example `via: "share" | "whatsapp"` in the ready state) so the WhatsApp panel shows only for WhatsApp. Also update `activate`, the pending/resume effect (it maps the trigger button ref by action; add a `whatsapp` ref), and the dialog `onClose` (it currently runs `runShare` for anything other than save; WhatsApp must still prepare with the WhatsApp flag). Add a third button with `text.whatsappAction`. `resultsResumePath(locale, action ?? "save")` builds the auth hrefs.
- `web/src/app/[locale]/results/share-panel.tsx` -- Shows the new link with Copy; leave it unchanged. The WhatsApp fallback depends on it being on screen.
- New `web/src/app/[locale]/results/whatsapp-panel.tsx` -- Props `{ url, locale, text }`. Contains the ready status, the "Open WhatsApp" button and the fallback alert. Builds the message from `messages[locale].shared.banner`.
- `web/src/i18n/paths.ts` -- Widen `resultsResumePath`'s action type to `Action`, or add `"whatsapp"`. Add `whatsappHref(message: string): string` returning `` `https://wa.me/?text=${encodeURIComponent(message)}` ``. `shareUrl(origin, locale, token)` builds the link.
- `web/src/i18n/messages.ts` -- `results` type (line ~175) plus the ar/en/fr `results` blocks (~485, ~784, ~1086): add `whatsappAction`. In the `share` type (line 19) and its ar/en/fr one-line blocks (~265, ~564, ~863), add `whatsappReady`, `whatsappOpen` and `whatsappUnavailable`. `shared.banner` already exists in all three locales; reuse it, do not duplicate it.
- Tests: `auth-gate.test.tsx` (installDom, fetch mocks, `?resume=save` pattern at lines 112-170), `auth-gate-state.test.ts`, `share-panel.test.tsx` (patterns for rendering a panel with jsdom).

## Tasks & Acceptance

**Execution:**
- [x] `web/src/app/[locale]/results/auth-gate-state.ts` (+ test) -- add `"whatsapp"` to `Action`, `parseResume` and `authorizedAction`.
- [x] `web/src/i18n/paths.ts` -- `whatsappHref`; widen the `resultsResumePath` action.
- [x] `web/src/i18n/messages.ts` -- the new keys in the type and in ar/en/fr.
- [x] `web/src/app/[locale]/results/whatsapp-panel.tsx` (+ `whatsapp-panel.test.tsx`) -- the panel described in the matrix. Tests cover: the exact `window.open` URL (decoded text = banner + "\n" + url, in at least en and ar); `opener` nulled on success; the fallback alert when `open` returns null; no alert on success.
- [x] `web/src/app/[locale]/results/auth-gate.tsx` (+ `auth-gate.test.tsx`) -- WhatsApp button and flow. Tests cover: anonymous click opens the dialog with `resume=whatsapp` hrefs and makes no fetch; authenticated click POSTs save, then a private share, and shows SharePanel plus the "Open WhatsApp" button; an authenticated `?resume=whatsapp` prepares and strips the param; a create failure shows `createError` and no WhatsApp panel; the Share button still shows no WhatsApp panel.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- add an entry asking for native review of the new ar/en/fr WhatsApp strings.

**Acceptance Criteria:**
- Given a signed-in owner on the results page, when they click WhatsApp and then "Open WhatsApp", then a `wa.me` window opens whose text contains the draft/not-certified disclaimer and a private share link, and the results page is unchanged.
- Given `cd web; npm run build`, then the build passes with no new warnings, and `npm test` and `npm run lint` pass (no new lint warnings).

## Spec Change Log

## Review Triage Log

### 2026-11-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 2, low 2)
- defer: 0
- reject: 25 (medium 3, low 22)
- addressed_findings:
  - `[medium]` `[patch]` No test checked the link `AuthGate` hands to the WhatsApp panel. The authenticated WhatsApp test now clicks "Open WhatsApp" and asserts the decoded `wa.me` text equals banner + `http://localhost/app/en/shared/#tok123`.
  - `[medium]` `[patch]` No test covered the dialog `onClose` path for the WhatsApp action, where the session resolves while the dialog is open. Added a test asserting a private share POST and the "Open WhatsApp" button after the dialog closes.
  - `[low]` `[patch]` `window.open` throwing (restricted embedded browsers) or a read-only `opener` would skip the fallback. Both are wrapped; a throw now shows the fallback alert (new test).
  - `[low]` `[patch]` `whatsapp-panel.test.tsx` replaced `window.open` without restoring it; `afterEach` now restores it.

## Design Notes

The epic allows "the report or link". The design sends a link because a PDF passed to WhatsApp would put family data in front of people who never signed in, against the epic rule that "only authenticated, authorized recipients can access private reports". The private 4.3 link keeps the gate and shows the draft banner. The token does reach WhatsApp in the message text, and that cannot be avoided when sharing through WhatsApp. It is the same exposure as an owner pasting the link into WhatsApp themselves.

A web page cannot detect whether WhatsApp is installed. `wa.me` sends the user to the app, WhatsApp Web, or WhatsApp's own install page. So the detectable "unavailable" case is `window.open` returning `null` (popup blocked, or an in-app browser with no new windows). The fallback copy should also say that the link above can be copied, which covers the remaining cases.

Two clicks (prepare, then Open) are deliberate. A `window.open` call after `await` loses user activation and is blocked on mobile Safari and Chrome.

## Verification

**Commands:**
- `cd web; npm test` -- expected: all pass, including the new tests.
- `cd web; npm run lint` -- expected: 0 errors, no new warnings (9 existing).
- `cd web; npm run build` -- expected: compiles; static export OK.

**Manual checks (if no CLI):**
- In ar, signed in: WhatsApp → Open WhatsApp opens wa.me with the Arabic disclaimer and link; with popups blocked, the fallback alert shows and the Copy link still works.

## Auto Run Result

**Summary:** The results page has a WhatsApp button next to Save and Share. It goes through the same sign-in gate (the dialog, with `?resume=whatsapp` on sign-in and registration). Once signed in, it saves the case and creates a private 4.3 share link, then shows the usual share panel plus an "Open WhatsApp" button. That button opens `https://wa.me/?text=` with the localized draft/not-certified disclaimer and the private link. If the window cannot be opened (blocked, or forbidden by the browser), a fallback alert points to the copyable link on the same page. The results page and the session case are never left. No backend change.

**Files changed:**
- `web/src/app/[locale]/results/auth-gate-state.ts` (+ test): `"whatsapp"` action, resume parsing and authorization.
- `web/src/app/[locale]/results/auth-gate.tsx` (+ test): the WhatsApp button; `runShare(via)` records which action prepared the link; resume and dialog-close paths keep the WhatsApp action.
- `web/src/app/[locale]/results/whatsapp-panel.tsx` (+ test, new): the ready status, the "Open WhatsApp" button and the fallback alert.
- `web/src/i18n/paths.ts`: `whatsappHref`; `resultsResumePath` accepts `"whatsapp"`.
- `web/src/i18n/messages.ts`: `results.whatsappAction` and `share.whatsappReady/whatsappOpen/whatsappUnavailable` in ar/en/fr. The message reuses `shared.banner`.
- `_bmad-output/implementation-artifacts/deferred-work.md`: native-review entry for the new strings.

**Review findings:** 4 patches applied (medium 2, low 2), 0 deferred, 25 rejected. Rejected findings include:
- A new link is created per click (same as Share, by design).
- WhatsApp cannot be detected as installed from a web page (documented in Design Notes).
- Recipients must sign in (intended privacy rule).
- A dedicated message string instead of reusing `shared.banner`.
- `runShare` has no try/finally (pre-existing; the API helpers return null rather than throw).
- Save is not disabled during share creation (pre-existing).
- Naming and style points.

**Follow-up review recommendation:** true. Patched findings: high 0, medium 2, low 2. Score 3×2 + 1×2 = 8.

**Verification:**
- `npm test`: 393 passed, 0 failed. This includes the WhatsApp tests in `auth-gate.test.tsx` (7) and `whatsapp-panel.test.tsx` (5).
- `npm run lint`: 0 errors, 9 warnings, all of which predate this story.
- `npx tsc --noEmit`: clean.
- `npm run build`: compiled, static export OK.
- Matrix audit: every row (anonymous click, resume, prepare, open, unavailable) has a passing test.

**Residual risks:**
- On a device without WhatsApp, `wa.me` still opens (WhatsApp's own landing page), so the in-app fallback appears only when the window cannot open.
- The share token travels through WhatsApp/Meta in the message text, as it would if the owner pasted it.
- The new ar/fr strings need native review.
- The manual browser check (real popup blocker, real WhatsApp) was not run.
