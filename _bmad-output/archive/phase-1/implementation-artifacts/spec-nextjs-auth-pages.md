---
title: 'Next.js auth pages replace the Django registration templates'
type: 'feature'
created: '2026-11-13'
status: 'done'
baseline_commit: 'ba719559c2ea7136f82b3ed58c1182681f4c8b87'
review_loop_iteration: 0
context:
  - '{project-root}/web/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sign in, sign up and password reset are still Django templates (`calc/templates/registration/*`). Every Next.js save, share and invite flow sends users out of the app to these pages, which look different.

**Approach:** Add JSON auth endpoints under `/api/v1/auth/` and Next.js pages under `/app/{locale}/` (login, signup, password reset request and confirm). Point `loginHref`/`signupHref`, `LOGIN_URL` and the reset email at the new pages, and redirect every old Django auth URL there, preserving `next`.

## Boundaries & Constraints

**Always:** Session auth with real CSRF (`X-CSRFToken`, as in `web/src/api/case.ts`). Log in with `django.contrib.auth.login` so `user_logged_in` still restores the anonymous case. Validate `next` on the server (`url_has_allowed_host_and_scheme`, same host, relative only); otherwise fall back to the existing `LOGIN_REDIRECT_URL`. Password reset never reveals whether an account exists. All strings in ar/en/fr with Arabic RTL. Keep the existing Facebook and LinkedIn social login (POST to `/social-auth/login/<backend>/` with CSRF and `next`).

**Ask First:** Changing `LOGIN_REDIRECT_URL` or the social pipeline; adding Instagram/Google buttons; deleting `user_auth` profile pages.

**Never:** No token or JWT auth. No Next.js server runtime: the pages stay in the static export, so dynamic segments are replaced by query params. Don't touch the admin login. Don't migrate other legacy pages (deferred).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Login OK | valid credentials, `next=/app/en/results/?resume=save` | 200 `{redirect:"/app/en/results/?resume=save"}`, session set, anonymous case restored | N/A |
| Login bad | wrong password | 400 `{errors:{__all__:[msg]}}` in request language | form shows message, password cleared |
| Unsafe next | `next=https://evil.com/` | `redirect` = `LOGIN_REDIRECT_URL` | N/A |
| Signup OK | valid form | 201, user created and logged in, `{redirect}` | N/A |
| Signup invalid | duplicate username / password mismatch | 400 field errors from `UserCreationForm` | per-field messages |
| Already signed in | open login/signup page | client redirects to the `next` target or the fallback | N/A |
| Reset request | any email | 200 same body whether or not the account exists; email links to `/app/{locale}/password-reset/confirm/?uid=…&token=…` | SMTP failure logged, still 200 |
| Reset confirm | valid uid/token + matching passwords | 200, password set, page shows success and login link | invalid/used token → 400 `invalid_link`, page offers a new request |
| Throttle | >20 auth POSTs/hour from one IP (/64 for v6) | 429 | page shows retry-later message |
| Old URL | GET `/accounts/login/?next=X`, `/{lang}/signup/`, `/accounts/password_reset/…` | 302 to the matching `/app/{lang}/…/` page, query kept | unknown lang → `en` |

</frozen-after-approval>

## Code Map

- `mawareeth/urls.py:33-36,90-94` -- `accounts/` include, logout, `social-auth/`, `calc:signup`; replace with redirect views (keep `accounts/logout/` POST).
- `calc/views.py:898-919` -- `SignUp` view (`RedirectURLMixin`, `user_auth.forms.UserCreationForm`, ModelBackend login); reuse the form, replace the view with a redirect.
- `calc/templates/registration/*.html` -- old pages to delete; `password_reset_email.html:3-15` is the email copy to port.
- `mawareeth/settings.py:232,326-337,360-401` -- LoginRequiredMiddleware, DRF defaults, `LOGIN_URL='login'`, `LOGIN_REDIRECT_URL='calc:index'`, `SOCIAL_AUTH_LOGIN_ERROR_URL`, email config.
- `api/views.py:27-44` -- public base view and `SessionView` (`ensure_csrf_cookie`); pattern for new auth views. `api/permissions.py:5-16` explicit CSRF for anonymous unsafe calls.
- `api/throttling.py:6-52` -- per-IP scope pattern; add an `auth` scope.
- `api/signals.py:7-14` -- `user_logged_in` restores the anonymous case (must keep firing).
- `api/urls.py:15-37` -- routes; catch-all must stay last.
- `web/src/i18n/paths.ts:5-31` -- `loginHref`/`signupHref`/`authLinks`.
- `web/src/app/[locale]/site-nav.tsx:19-45`, `use-session.ts` -- nav; add a logout control.
- `web/src/api/case.ts:324-400` -- CSRF and fetch pattern to reuse; `web/src/api/session.ts` session probe.
- `web/src/app/[locale]/interview/deceased-form.tsx` -- form pattern; `invite/invite-view.tsx` keeps fragment tokens across auth.
- `web/src/i18n/messages.ts` -- typed `Messages`, ar/en/fr.
- Tests that break: `calc/tests.py:935,1131,1395-1399,3580-3644`, `user_auth/tests.py:39-40`, `web/src/i18n/paths.test.ts:19-35`, `web/src/app/[locale]/invite/invite-view.test.tsx:122`.

## Tasks & Acceptance

**Execution:**
- [x] `api/auth_views.py` (new), `api/urls.py`, `api/throttling.py` -- `POST auth/login/`, `auth/signup/`, `auth/logout/`, `auth/password-reset/`, `auth/password-reset/confirm/` (plus `GET` to check a token's validity), `auth` throttle scope, a shared `safe_next()` helper -- the JSON auth surface.
- [x] `api/templates/api/password_reset_email.txt` (new) -- port the email copy with the Next confirm URL built from `https://{request host}/app/{lang}/password-reset/confirm/?uid=&token=`.
- [x] `mawareeth/urls.py`, `mawareeth/web_views.py`, `mawareeth/settings.py`, `calc/views.py` -- redirect views for old login/signup/reset URLs, `LOGIN_URL` pointing at the locale-aware login redirect, remove `SignUp` and the `django.contrib.auth.urls` include; delete `calc/templates/registration/`.
- [x] `web/src/api/auth.ts` (new) -- typed client for the endpoints, reusing the CSRF helper (move it into a shared module if needed).
- [x] `web/src/app/[locale]/login/`, `signup/`, `password-reset/`, `password-reset/confirm/` (new) -- pages and client forms with field errors, social buttons, a pending state and redirect on success.
- [x] `web/src/i18n/paths.ts`, `site-nav.tsx`, `messages.ts` -- new hrefs, a logout button, and ar/en/fr strings.
- [x] `api/tests.py`, `calc/tests.py`, `user_auth/tests.py`, web `*.test.ts(x)` -- cover every matrix row, update the broken tests, and add form tests for each page.

**Acceptance Criteria:**
- Given an anonymous user with an in-progress case, when they sign up or log in from the results auth gate, then they return to the results page with the case intact.
- Given LoginRequiredMiddleware protects a legacy page, when an anonymous user opens it, then they land on `/app/{lang}/login/?next=<that page>`.
- Given a signed-in user, when they press logout in the nav, then the session ends and the nav shows login/signup.
- Given the Arabic locale, when any auth page renders, then it is RTL and every string is Arabic.

## Design Notes

`next` values use the full path including `/app`, as today. The server returns the final `redirect`, and the client only navigates with `window.location.assign`, which lets Django-side (legacy) destinations still work. Language for API error messages comes from an `Accept-Language: {locale}` header sent by the client. Social buttons are plain `<form method="post">` elements with the `csrftoken` cookie value in a hidden input. The login page shows `?error=social` text when social-auth redirects back with an error (set `SOCIAL_AUTH_LOGIN_ERROR_URL` to the new login redirect).

## Verification

**Commands:**
- `uv run python manage.py test api calc user_auth --noinput` -- expected: all pass (start local PG18 first)
- `cd web && npm test && npm run lint && npm run build` -- expected: pass; the export contains `app/{ar,en,fr}/{login,signup,password-reset,password-reset/confirm}/index.html`

**Manual checks (if no CLI):**
- Run Django and `next dev`; complete login, signup, reset (console email) and logout in en and ar.

## Suggested Review Order

**Auth API (the server-side contract)**

- Entry point: `next` is accepted only as a same-host relative path; otherwise the legacy fallback.
  [`auth_views.py:27`](../../api/auth_views.py#L27)

- Shared base: CSRF on writes, per-IP `auth` quota, non-object bodies rejected.
  [`auth_views.py:40`](../../api/auth_views.py#L40)

- Django `login()` keeps `user_logged_in`, so the anonymous case is restored.
  [`auth_views.py:54`](../../api/auth_views.py#L54)

- Signup refuses signed-in callers and maps a username race to a 400.
  [`auth_views.py:63`](../../api/auth_views.py#L63)

- Logout is exempt from the quota so sign-out can't be locked out.
  [`auth_views.py:79`](../../api/auth_views.py#L79)

- Reset always answers the same way; SMTP failure is logged, not surfaced.
  [`auth_views.py:88`](../../api/auth_views.py#L88)

- Token checked on GET (early page state) and again on POST.
  [`auth_views.py:102`](../../api/auth_views.py#L102)

- The email links to the static confirm page with uid/token in the query.
  [`password_reset_email.txt:9`](../../api/templates/api/password_reset_email.txt#L9)

**Legacy URL redirects**

- One view maps every old auth URL to `/app/{lang}/…/`, keeping the query.
  [`web_views.py:28`](../../mawareeth/web_views.py#L28)

- `accounts/` include replaced by named redirects, so `LOGIN_URL='login'` lands on Next.js.
  [`urls.py:34`](../../mawareeth/urls.py#L34)

- Social-auth errors return to the new login page with a flag.
  [`settings.py:398`](../../mawareeth/settings.py#L398)

**Next.js pages**

- One client form drives all four pages: fields, errors, focus, continuation.
  [`auth-form.tsx:9`](../../web/src/app/[locale]/auth-form.tsx#L9)

- Submit: server-provided redirect, throttle and invalid-link handling.
  [`auth-form.tsx:56`](../../web/src/app/[locale]/auth-form.tsx#L56)

- Social buttons stay plain POST forms carrying CSRF and `next`.
  [`auth-form.tsx:95`](../../web/src/app/[locale]/auth-form.tsx#L95)

- App-wide login/signup links now point inside the export.
  [`paths.ts:4`](../../web/src/i18n/paths.ts#L4)

- New nav logout control.
  [`site-nav.tsx:28`](../../web/src/app/[locale]/site-nav.tsx#L28)

**Tests and config**

- API matrix coverage, including email-to-confirm round trip and throttling.
  [`tests.py:3571`](../../api/tests.py#L3571)

- Old URLs redirect with query and language preserved.
  [`tests.py:3569`](../../calc/tests.py#L3569)

- New `auth` throttle rate.
  [`settings.py:331`](../../mawareeth/settings.py#L331)
