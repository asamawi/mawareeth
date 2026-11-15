---
title: 'Next.js password-change page for signed-in users'
type: 'feature'
created: '2026-11-13'
status: 'done'
baseline_commit: 'eb337b2388ce327561662a1b2ca3aa61dfbc89ce'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/web/AGENTS.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Limit current-password attempts on auth/password-change/ per account, not only by the per-IP auth quota.
    evidence: |-
      Review found a holder of a stolen session who rotates IPs can keep guessing the current password; folded into the existing auth-abuse entry in deferred-work.md.
    location: >-
      api/auth_views.py:PasswordChangeView
    severity: low
---

<intent-contract>

## Intent

**Problem:** The Next.js auth pages removed Django's `accounts/password_change/` routes, so a signed-in user can change their password only through the reset email (deferred-work.md, "Product scope / future epics", source `spec-nextjs-auth-pages.md`).

**Approach:** Add a session-authenticated `GET/POST /api/v1/auth/password-change/` endpoint backed by Django's `PasswordChangeForm`, a static Next.js page `/app/{locale}/password-change/` that reuses `AuthForm`, a nav link for signed-in users, and a redirect from the old Django URL.

## Boundaries & Constraints

**Always:** Session auth with CSRF on POST (`CsrfProtectedWrites`, `X-CSRFToken` via the existing `write()` helper). The `auth` per-IP throttle on POST. Require the current password (`django.contrib.auth.forms.PasswordChangeForm`, so `AUTH_PASSWORD_VALIDATORS` apply). After success call `update_session_auth_hash` so the current session stays signed in (other sessions are invalidated by Django's session hash). Errors in the request language via `Accept-Language`. All new strings in ar/en/fr, Arabic RTL. Record new strings for native review in deferred-work.md.

**Block If:** The work would require letting social-only accounts set a first password (an owner security decision); this story only tells them they have no password.

**Never:** No token/JWT auth, no Next.js server runtime (static export only). Don't change login, signup or reset behavior. Don't let a user without a usable password set one here. Don't edit existing ar/en/fr strings.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Probe, signed in | GET, user with usable password | 200 `{"has_password": true}` | N/A |
| Probe, social-only | GET, `has_usable_password()` false | 200 `{"has_password": false}`; page shows `noPassword` text, no form | N/A |
| Anonymous | GET or POST, no session | 403; page redirects to `/app/{locale}/login/?next=/app/{locale}/password-change/` | N/A |
| Change OK | POST correct `old_password`, matching valid `new_password1/2` | 200 `{"complete": true}`; password changed; same session still authenticated; page shows `auth.complete` | N/A |
| Wrong current password | POST bad `old_password` | 400 `{"errors": {"old_password": [msg]}}` in request language | field error, focus on field |
| Weak / mismatched | POST failing validators or mismatch | 400 field errors from the form | per-field messages |
| Social-only POST | POST, no usable password | 400 `{"error": "no_password"}`, password unchanged | page shows `noPassword` |
| No CSRF | POST without token | 403 | generic error |
| Throttle | >20 auth POSTs/hour from one IP | 429 | `auth.throttled` |
| Old URL | GET `/accounts/password_change/` (and `done/`) | 302 to `/app/{lang}/password-change/`, query kept | unknown lang → `en` |

</intent-contract>

## Code Map

- `api/auth_views.py:39-47` -- `AuthView` base (CSRF writes, `AuthThrottle`, mapping-body check); add `PasswordChangeView(AuthView)` with `permission_classes = [CsrfProtectedWrites, IsAuthenticated]`, GET probe and POST. Pattern: `PasswordResetConfirmView` (`SetPasswordForm`, `{'complete': True}`).
- `api/urls.py:16-20` -- add `auth/password-change/` (name `auth-password-change`) before the catch-all.
- `mawareeth/urls.py:33-38` + `mawareeth/web_views.py:auth_redirect` -- add `accounts/password_change/` and `accounts/password_change/done/` → `{'page': 'password-change'}` (names `password_change`, `password_change_done`).
- `web/src/api/auth.ts:5` -- add `"password-change"` to `AuthAction`; add `passwordChangeStatus(locale, signal)` doing the GET (returns status + `has_password`).
- `web/src/app/[locale]/auth-form.tsx` -- one client form for all auth pages. For `password-change`: title `t.change`; fields `old_password, new_password1, new_password2` (`old_password` autocomplete `current-password`, the others `new-password`, requirements hint on `new_password1` as today); in the mount effect GET the probe: 403 → `window.location.assign(loginHref(`/${locale}/password-change/`))`, `has_password:false` → show `t.noPassword` instead of the form, other failure → `t.error`/`t.throttled`; submit disabled until the probe says `has_password:true`; `error === "no_password"` → `noPassword`; success → `t.complete`. No social buttons; bottom links show only the reset link.
- `web/src/app/[locale]/password-change/page.tsx` (new) -- copy of `password-reset/page.tsx` with `action="password-change"`.
- `web/src/app/[locale]/site-nav.tsx:43-44` -- when authenticated, a link to `/app/{locale}/password-change/` labeled `messages[locale].auth.change`, beside the logout button (plain `<a>` like `authLinks`).
- `web/src/i18n/messages.ts:16,261,562,863` -- add `change`, `old_password`, `noPassword` to the `auth` type and ar/en/fr objects. en: "Change password", "Current password", "This account signs in with Facebook or LinkedIn and has no password to change." ar: "تغيير كلمة المرور", "كلمة المرور الحالية", "هذا الحساب يسجّل الدخول عبر فيسبوك أو لينكد إن وليست له كلمة مرور لتغييرها." fr: "Modifier le mot de passe", "Mot de passe actuel", "Ce compte se connecte avec Facebook ou LinkedIn et n’a pas de mot de passe à modifier."
- `web/src/i18n/paths.ts:4-7` -- reuse `loginHref`.
- Tests: `api/tests.py:3571-3725` (auth API class, `self.post` helper), `calc/tests.py:3569-3585` (old-URL redirects), `web/src/app/[locale]/auth-form.test.tsx` (`mount`, `ui.respond`), site-nav test if one exists.

## Tasks & Acceptance

**Execution:**
- [x] `api/auth_views.py`, `api/urls.py` -- add `PasswordChangeView` and route -- the JSON surface.
- [x] `mawareeth/urls.py` -- old `accounts/password_change/` URLs redirect to the new page.
- [x] `web/src/api/auth.ts`, `web/src/app/[locale]/auth-form.tsx`, `web/src/app/[locale]/password-change/page.tsx`, `web/src/app/[locale]/site-nav.tsx`, `web/src/i18n/messages.ts` -- page, probe, nav link and strings.
- [x] `api/tests.py`, `calc/tests.py`, `web/src/app/[locale]/auth-form.test.tsx` -- cover every matrix row (API: all rows; web: anonymous redirect, no-password, success, field error, throttle; nav link only when signed in).
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- remove the password-change entry and the stale language-switcher entry (fixed in `89f7ec1`); add a native-review entry for the three new strings.

**Acceptance Criteria:**
- Given a signed-in user, when they open the nav's "Change password" link and submit a correct current password and a valid new one, then they see the success text, stay signed in, and can sign in later only with the new password.
- Given the Arabic locale, when the page renders, then it is RTL and every string is Arabic.
- Given `npm run build`, then the export contains `app/{ar,en,fr}/password-change/index.html`.

## Spec Change Log

## Review Triage Log

### 2026-11-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3 (high 0, medium 0, low 3)
- defer: 1 (high 0, medium 0, low 1)
- reject: 40 (high 0, medium 0, low 40)
- addressed_findings:
  - `[low]` `[patch]` A 403 on the password-change POST (session ended mid-form) showed the generic connection error; `auth-form.tsx` now redirects to login with the page as `next`, and the web test asserts the redirect (500 still shows the error).
  - `[low]` `[patch]` `auth/password-change/` was listed first in `api/urls.py`; moved after the other auth routes.
  - `[low]` `[patch]` deferred-work.md: removed a stray blank line and named the new native-review strings by key path; the per-account password-change limit is folded into the existing auth-abuse entry.

## Verification

Implementation verification (2026-11-13): Python AST syntax checks and direct `tsc --noEmit --incremental false` passed. `npm run lint` passed with 10 warnings and no errors. `npm test` was blocked by sandbox `spawn EPERM`; Django tests were blocked by access denied to the uv cache. `npm run build` compiled successfully, then was blocked by `spawn EPERM` during its TypeScript phase. Full test execution and the three exported HTML paths remain for caller verification. Native-language review is recorded in deferred-work.md.

**Commands:**
- `uv run python manage.py test api.tests calc.tests --noinput` (narrow to the auth test classes where possible) -- expected: pass
- `cd web && npm test && npm run lint && npm run build` -- expected: pass, export contains the three `password-change/index.html`

## Auto Run Result

Status: done

**Summary:** Signed-in users can change their password at `/app/{ar,en,fr}/password-change/`, linked from the nav. `GET/POST /api/v1/auth/password-change/` uses Django's `PasswordChangeForm` (current password required, validators applied) and `update_session_auth_hash`, so the current session survives and other sessions end. Social-only accounts get `has_password: false` / `no_password` and a short explanation instead of the form. Old `/accounts/password_change/` and `done/` redirect to the new page. Backlog: the password-change entry and the stale language-switcher entry (fixed in `89f7ec1`) were removed; a native-review entry was added.

**Files changed:**
- `api/auth_views.py` -- `PasswordChangeView` (probe + change).
- `api/urls.py` -- `auth/password-change/` route.
- `mawareeth/urls.py` -- legacy `accounts/password_change/` redirects.
- `web/src/api/auth.ts` -- `password-change` action and `passwordChangeStatus` probe.
- `web/src/app/[locale]/auth-form.tsx` -- password-change branch: probe, anonymous/403 redirect, no-password state, fields.
- `web/src/app/[locale]/password-change/page.tsx` -- new static page.
- `web/src/app/[locale]/site-nav.tsx` -- "Change password" link for signed-in users.
- `web/src/i18n/messages.ts` -- `change`, `old_password`, `noPassword` in ar/en/fr.
- `api/tests.py`, `calc/tests.py`, `web/src/app/[locale]/auth-form.test.tsx` -- matrix coverage.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- backlog updates.

**Review:** 4 reviewers (blind, edge-case, verification-gap, intent-alignment). Codex hit its usage limit, so the reviews ran as Claude subagents. 3 low patches applied, 1 low deferred, 40 rejected. Rejected included: claims already handled by existing code (`never_cache`, POST-only throttle, non-object body guard, `login_not_required` on `auth_redirect`, status >= 400 never shown as success), the language-switcher removal (fixed in `89f7ec1`), a reset link for social-only users (Django's reset form skips unusable-password accounts, and setting a first password is Block If), hiding the nav link for social-only users, and style/refactor suggestions.

**Follow-up review recommended:** false (patched: high 0, medium 0, low 3; score 3).

**Verification:** `uv run python manage.py test api.tests.AuthApiTests api.tests.PasswordChangeApiTests calc.tests.PasswordChangeRedirectTests calc.tests.SignupContinuationTests --noinput` -- 23 tests OK. `npm test` -- 434 pass, 0 fail. `npm run lint` -- 0 errors (warnings pre-existing; the changed files lint clean). `npx tsc --noEmit` clean. `npm run build` -- compiled; `out/{ar,en,fr}/password-change/index.html` present. Matrix audit: every row has a passing API or web test.

**Residual risks:** The new ar/fr strings are unreviewed (recorded in deferred-work.md). Old-password guessing is limited per IP only (deferred). Not deployed; committed locally on `development`.
