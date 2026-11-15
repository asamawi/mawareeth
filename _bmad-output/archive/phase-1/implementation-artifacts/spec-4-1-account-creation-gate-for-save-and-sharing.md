---
title: 'Story 4.1: Account creation gate for save and sharing'
type: 'feature'
created: '2026-11-11'
status: 'done'
baseline_commit: 'c407bbe823b9da6be596c974d77c514ec097d1e4'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Visitors can calculate without an account, but nothing stops them from reaching save or protected sharing while signed out. Signup also loses the user's place: it ignores `next`, doesn't sign the new user in, and sends them to the login page.

**Approach:** Add Save and Share buttons to the results screen. When signed out, they open a sign-in / create-account dialog and block the action. Both auth paths return to `/app/<locale>/results/?resume=save|share`, where the action resumes against the same session case. Save and Share themselves are stubs ("coming soon") until stories 4.2–4.5.

## Boundaries & Constraints

**Always:** The anonymous case stays in the Django session (`anonymous_case`) and must survive login and signup. Validate every `next` the way Django's `LoginView` does (allowed host incl. `request.get_host()`, HTTPS required on secure requests, POST before GET); an invalid `next` falls back to the current default. Login↔signup switch links carry `next`. All new UI text in ar/en/fr with correct RTL. The dialog is accessible: focus moves into it and returns on close, Escape closes it, it has a label, and it works with reduced motion. Keep the draft PDF download behaviour unchanged.

**Ask First:** Adding a Problem+JSON exception handler or changing DRF's default permissions; any change to social-auth pipeline/providers; moving the case out of the session.

**Never:** Implement real save or share (4.2–4.5); add IndexedDB/browser draft storage; silently persist the case on login; add Google OAuth or email verification; add `useSearchParams` (static export) — read and strip `resume` from `window.location` in an effect.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Signed-out click | Anonymous, valid result, click Save | Dialog with "Sign in" (`/accounts/login/?next=…resume=save`) and "Create account" (`/<locale>/signup/?next=…`); no save happens | Close returns focus to the Save button |
| Signed-in click | Authenticated, click Share | Non-blocking "coming soon" notice, no dialog | N/A |
| Session unknown | `/api/v1/session/` still loading or failed | Click treated as signed out (dialog shown) | Never treat failure as authenticated |
| Signup with next | Valid form + `next=/app/en/results/?resume=save` | User created, logged in (ModelBackend), redirected to `next`; session case intact | Form errors re-render with `next` kept |
| Bad next | `next=https://evil.example/` on signup | Signed in, redirected to the existing default destination | N/A |
| Resume on return | Authenticated load with `?resume=save` | Same coming-soon notice as clicking Save; `resume` removed via `history.replaceState`, other params kept | Unknown `resume` value is ignored and stripped |
| Resume while anonymous | Auth abandoned, `?resume=share` | Dialog reopens for Share | N/A |

</frozen-after-approval>

## Code Map

- `calc/views.py:900` -- `SignUp(CreateView)`, `success_url=reverse_lazy('login')`, no `form_valid`. Mounted as `calc:signup` at `/<locale>/signup/` (`mawareeth/urls.py:82,90-94`); `calc/urls.py:45` is not the mounted one.
- `user_auth/forms.py:8,16` -- signup form; `save()` stores email. Reuse.
- `.venv/Lib/site-packages/django/contrib/auth/views.py:35-55` -- `RedirectURLMixin`: reference for `next` validation (reuse `url_has_allowed_host_and_scheme`).
- `mawareeth/settings.py:387-392` -- multiple `AUTHENTICATION_BACKENDS`, so `login()` needs `backend="django.contrib.auth.backends.ModelBackend"`; `:397` default `LOGIN_REDIRECT_URL`.
- `calc/templates/registration/signup.html:85` -- login link without `next`; `login.html:64,69,78` hidden `next` fields, `:86` signup link drops `next`.
- `api/signals.py:8` `reset_session_expiry`, `api/anonymous_case.py:18` session key; `api/tests.py:276` proves the case survives login.
- `web/src/i18n/paths.ts:5` `loginHref(pathname)`, `:12` `authLinks(authenticated, locale, pathname)` (signup href bare). `web/next.config.ts:5,33` `/app` basePath; Django auth URLs are plain `<a>`.
- `web/src/app/[locale]/site-nav.tsx:20-32` -- inline session probe; `web/src/api/session.ts:6` `fetchSession(signal)`.
- `web/src/app/[locale]/results/results-view.tsx:127` `Available`, `:165` `<DraftDownload>` (impl `:334`, markup `:378-383`). No dialog/toast component exists in `web/src`.
- `web/src/i18n/messages.ts:15` `Messages`, results keys `:170-177`; ar `:465`, en `:750`, fr `:1038`.
- `api/views.py:23` `ApiView` already defaults to `IsAuthenticated` (403 JSON, see `api/tests.py:42,104`) -- 4.2+ endpoints reuse it; no server change here.
- Tests: `calc/tests.py:1340-1353` login-`next` pattern; `web/src/i18n/paths.test.ts`, `web/src/api/session.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `calc/views.py` -- `SignUp`: read/validate `next` (POST then GET), pass it to the template, `login()` the new user with ModelBackend, redirect to `next` or the existing fallback -- continuation.
- [x] `calc/templates/registration/signup.html`, `login.html` -- hidden `next` on signup form; switch links carry encoded `next` -- no lost context.
- [x] `locale/{ar,en,fr}/LC_MESSAGES/django.po` (+ compiled `.mo`) -- only if new template strings are added.
- [x] `web/src/i18n/paths.ts` -- add `signupHref(locale, pathname)` with `next`; `authLinks` uses it; add a helper building the results resume URL -- one place for auth URLs.
- [x] `web/src/api/session.ts` (or new `web/src/app/[locale]/use-session.ts`) -- shared `useAuthState()` returning `loading | anonymous | authenticated | error`; `site-nav.tsx` uses it -- shared gate state.
- [x] `web/src/app/[locale]/results/auth-gate.tsx` (new) -- Save/Share buttons, accessible dialog, coming-soon notice, `resume` read/strip; rendered next to `<DraftDownload>` in `results-view.tsx` only when a valid result is shown -- the gate.
- [x] `web/src/i18n/messages.ts` -- new results keys in all three locales.
- [x] Tests -- `calc/tests.py`: signup logs in + redirects to valid `next`, rejects external `next`, keeps `next` on form error, keeps `anonymous_case`, switch links carry `next`. `paths.test.ts`: signup/resume hrefs incl. encoding. A pure `parseResume`/state-decision helper with its own `*.test.ts` covering the matrix rows.

**Acceptance Criteria:**
- Given an anonymous user with a calculated case, when they sign up via the dialog, then they land back on results with that case and its shares shown and the Save notice displayed.
- Given the results screen shows an empty/error/refused state, then no Save/Share buttons render.
- Given `npm run build` (static export), then it succeeds with no new Suspense/`useSearchParams` warnings.

## Design Notes

Keep the gate decision in a pure function, e.g. `decide(auth, action) -> "dialog" | "notice"`, so the matrix is unit-tested without rendering React. The stubbed signed-in path is the single place 4.2–4.5 replace.

## Verification

**Commands:**
- `uv run python manage.py test calc api --noinput` (local PG18 per memory) -- expected: pass.
- `cd web; npm test; npm run lint; npm run build` -- expected: pass.

**Manual checks (if no CLI):**
- In ar, the dialog is RTL, keyboard-trappable, Escape closes, and focus returns to the trigger.

## Suggested Review Order

**The gate on the results screen**

- Entry point: Save/Share buttons, dialog vs notice, resume and close handling
  [`auth-gate.tsx:53`](../../web/src/app/[locale]/results/auth-gate.tsx#L53)

- A `?resume=` return is read once, stripped, then waits for the session check before acting
  [`auth-gate.tsx:22`](../../web/src/app/[locale]/results/auth-gate.tsx#L22)

- An open dialog closes into the notice if the session turns out signed in
  [`auth-gate.tsx:48`](../../web/src/app/[locale]/results/auth-gate.tsx#L48)

- Pure decision: only a confirmed signed-in session skips the dialog
  [`auth-gate-state.ts:3`](../../web/src/app/[locale]/results/auth-gate-state.ts#L3)

- Mounted only in the valid-result branch
  [`results-view.tsx:166`](../../web/src/app/[locale]/results/results-view.tsx#L166)

**Shared sign-in state**

- One hook with loading/anonymous/authenticated/error and a 10s timeout
  [`use-session.ts:7`](../../web/src/app/[locale]/use-session.ts#L7)

- Nav now uses the shared hook instead of its inline probe
  [`site-nav.tsx:21`](../../web/src/app/[locale]/site-nav.tsx#L21)

**Signup continuation (server)**

- Validated `next` via Django's `RedirectURLMixin`, then auto-login with ModelBackend
  [`views.py:918`](../../calc/views.py#L918)

- Signed-in users skip signup so the session (and case) is not flushed
  [`views.py:905`](../../calc/views.py#L905)

- Fallback is the signed-in default, not the login page
  [`views.py:910`](../../calc/views.py#L910)

- Hidden `next` on the form and on the switch links in both directions
  [`signup.html:40`](../../calc/templates/registration/signup.html#L40)
  [`login.html:86`](../../calc/templates/registration/login.html#L86)

**URLs, strings, tests**

- Signup and resume URL builders
  [`paths.ts:26`](../../web/src/i18n/paths.ts#L26)

- New results strings in ar/en/fr
  [`messages.ts:173`](../../web/src/i18n/messages.ts#L173)

- Signup redirect, bad-next, form-error, switch-link and already-signed-in tests
  [`tests.py:3502`](../../calc/tests.py#L3502)