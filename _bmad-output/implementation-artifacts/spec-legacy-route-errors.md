---
title: 'Stop three legacy Django routes failing with 500 or writing on rejected requests'
type: 'bugfix'
created: '2026-11-10'
status: 'done'
baseline_commit: '84fa4eddc12aae008c8ab979baa7c9b20c5f6935'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Three production routes misbehave on unusual requests: `calc:new` raises `MultiValueDictKeyError` (500) on a POST with no `name` field; `calc:results` and `calc:new_results` run `compute()` (a database write) in `dispatch` before the waffle-flag and HTTP-method checks, so an owner's flag-off 404 or POST 405 still writes; `social:complete` returns 500 on a request with no OAuth state, because `SocialAuthExceptionMiddleware` only redirects when `SOCIAL_AUTH_LOGIN_ERROR_URL` is set, and it is not.

**Approach:** Read `name` with a default so a missing field takes the existing empty-name path; move the `compute()` call out of `dispatch` into `get()` so it runs only after the flag and method checks pass; set `SOCIAL_AUTH_LOGIN_ERROR_URL = 'login'` so social-auth errors redirect to the login page with the library's message.

## Boundaries & Constraints

**Always:** Work on branch `fix/legacy-route-errors` from `master` (already created). Ownership still 404s before any write, as today. An owner's GET of `calc:results` (and `calc:new_results` with the flag on) still recomputes and renders as today. Stage only named paths.

**Ask First:** Changing the social-auth pipeline, backends or package versions. Any production action, merging or deploying. Changing what the empty-name error says or where it redirects.

**Never:** Include anything from `development`. Stop the results GET from writing (a separate deferred item). Touch the language switcher or other deferred items. Set `SOCIAL_AUTH_RAISE_EXCEPTIONS`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New case, no `name` field | Logged-in POST to `calc:new` with no `name` | 302 to `calc:error`, error message queued, no `Calculation` created | No 500 |
| New case, empty name | POST `name=""` | Unchanged: 302 to `calc:error` | N/A |
| Results POST | Owner POSTs to `calc:results` / `calc:new_results` (flag on) | 405; `compute()` not called | N/A |
| New results, flag off | Owner GETs `calc:new_results` with flag off | 404; `compute()` not called | N/A |
| Results GET | Owner GETs `calc:results` | 200; `compute()` called once | N/A |
| Social complete, no state | GET `social:complete/linkedin-openidconnect` with no `state`/`code`, DEBUG off | 302 to `login`; message shown on the login page | No 500 |

</frozen-after-approval>

## Code Map

- `calc/views.py:748-778` -- `NewResultsView`: MRO is `OwnedCalculationMixin, WaffleFlagMixin, LoginRequired, DetailView`; its own `dispatch` (line 777) calls `compute()` before `WaffleFlagMixin.dispatch` and `View.dispatch`'s method check. Keep `get_owned_calculation` in `dispatch`; move `compute()` to a `get()` override that calls `super().get()`.
- `calc/views.py:780-809` -- `ResultsView`: same pattern, `compute()` at line 808; no waffle flag.
- `calc/views.py:815-829` -- `new()`: `request.POST["name"]` at line 819. Use `.get("name", "")`.
- `mawareeth/settings.py:340-371` -- login and social-auth settings. Add `SOCIAL_AUTH_LOGIN_ERROR_URL = 'login'` near `LOGIN_URL`. Note `LOGIN_REDIRECT_URL`/`LOGOUT_REDIRECT_URL` are also set earlier at lines 300-301; do not touch them.
- `.venv` `social_django/middleware.py` -- `process_exception` redirects to `strategy.setting("LOGIN_ERROR_URL")` only if set, else returns `None` (500); it re-raises when `DEBUG` is on, so the test needs `DEBUG=False` (Django's test runner already forces it).
- `calc/templates/calc/base.html` -- renders Django messages, so the login page shows the social-auth message.
- `calc/tests.py:929` `CalculationAccessControlTests` -- home for the `calc:new` and results tests; uses `mock.patch.object(Calculation, 'compute')`, `force_login`, `secure=True`, `override_settings(WAFFLE_FLAG_DEFAULT=True)`, and `cache.clear()` in `setUp`.
- `user_auth/tests.py:18` `SocialLoginTestCase` -- home for the social-complete test; class-level `oidc_config` mock and backend keys are already in place.

## Tasks & Acceptance

**Execution:**
- [x] `calc/views.py` -- In `new()`, read `name` with `request.POST.get("name", "")`. In `NewResultsView` and `ResultsView`, drop `self.calc.compute()` from `dispatch` and add `def get(self, request, *args, **kwargs): self.calc.compute(); return super().get(request, *args, **kwargs)` -- writes only after flag and method checks pass.
- [x] `mawareeth/settings.py` -- Add `SOCIAL_AUTH_LOGIN_ERROR_URL = 'login'` with a one-line comment that without it social-auth errors become 500s -- the middleware returns `None` when unset.
- [x] `calc/tests.py` -- Add tests to `CalculationAccessControlTests` for the first five matrix rows, patching `Calculation.compute` to assert calls -- covers the `calc:new` and results fixes.
- [x] `user_auth/tests.py` -- Add a test in `SocialLoginTestCase` that GETs `social:complete` for `linkedin-openidconnect` with no query string and asserts a 302 to `reverse('login')` -- covers the last matrix row.

**Acceptance Criteria:**
- Given the new tests, when run against `master` without the code changes, then the `calc:new` no-name, results POST, flag-off and social-complete tests fail, and with the changes they pass.
- Given the full suite, when run, then all existing tests still pass, including `test_owner_reaches_every_case_route` and `test_other_user_gets_404_on_every_case_route`.

## Spec Change Log

## Design Notes

`compute()` moves to `get()` rather than `get_object()`: Django maps HEAD to `get`, and both run only after `WaffleFlagMixin.dispatch` and `View.dispatch` have accepted the request. On `development`, these `dispatch` methods also wrap `compute()` in `try/except Calculation.DoesNotExist -> Http404`; when this branch is merged into `development`, keep that wrapper inside the new `get()`.

## Verification

**Commands:**
- `uv run python manage.py test calc user_auth` -- expected: all pass.
- `uv run python manage.py test` -- expected: all pass.
- `uv run python manage.py check` -- expected: no issues.

## Suggested Review Order

**Results views write only after the request is accepted**

- `compute()` moved from `dispatch` to `get()`, so flag and method checks run first.
  [`views.py:779`](../../calc/views.py#L779)

- Same move for the flag-free results view; ownership 404 stays in `dispatch`.
  [`views.py:813`](../../calc/views.py#L813)

**Missing form field and social-auth error no longer 500**

- A missing `name` now takes the existing empty-name error path.
  [`views.py:825`](../../calc/views.py#L825)

- Without this setting, social-auth's middleware returns `None` and the error becomes a 500.
  [`settings.py:339`](../../mawareeth/settings.py#L339)

**Tests**

- Missing and empty name each give one ERROR message and create nothing.
  [`tests.py:933`](../../calc/tests.py#L933)

- POST 405, flag-off 404 and GET 200 with `compute()` call counts.
  [`tests.py:947`](../../calc/tests.py#L947)

- `social:complete` with no state redirects to login and shows one error.
  [`tests.py:28`](../../user_auth/tests.py#L28)
