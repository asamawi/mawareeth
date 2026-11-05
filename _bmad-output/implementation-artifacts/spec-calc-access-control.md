---
title: 'Restrict every calculation route to its owner'
type: 'bugfix'
created: '2026-11-05'
status: 'done'
baseline_commit: '572991ea6200af45078974e8ec2b4ebae8528f94'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Production `calc` views do not enforce ownership. Any logged-in user can read any case and its results by ID, and logged-out visitors can change case data through the update, create and delete routes. Cases hold family names and estate amounts.

**Approach:** Require login and ownership on every case-scoped route, answering non-owners with 404. Add a test that walks the URL table so a future route cannot silently skip the check.

## Boundaries & Constraints

**Always:** Check login and ownership before any other work in a view, including `compute()`, which writes to the database. Non-owners get 404, never 403, so case IDs cannot be probed. Anonymous visitors are redirected to login. Owner behavior stays the same, except for the delete crash fix below.

**Ask First:** Any schema change or data migration, and any staff bypass in the app views.

**Never:** Change the engine or `calc/models.py`. Change `calc:delete` to POST-only, or stop `compute()` writing on GET (both deferred). Build anonymous case support (Story 1.1). Touch Django admin access.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Owner | Any case-scoped route, flags on | Same response as today, except the delete fix | N/A |
| Other user | Any case-scoped route, GET or POST | 404, no data change, no `compute()` | N/A |
| Anonymous | Any case-scoped route, GET or POST | 302 to login, no data change, no `compute()` | N/A |
| Nonexistent ID | Logged-in user | 404, identical to another user's case | N/A |
| Null owner | Legacy `Calculation` with `user=None` | 404 for every app user; still reachable in admin | N/A |
| Flag off | Owner, flagged route | 404 from the flag, as today | N/A |
| Anonymous `new` | POST | 302 to login, no row created (was 500) | N/A |
| `new` after login | GET from the login `next` redirect | 302 to `calc:index` (would otherwise be 500) | N/A |
| Owner deletes heir or deceased | POST | Row removed, 302 to `calc:detail`; deleting the deceased also removes the case's heirs (was 500) | N/A |

</frozen-after-approval>

## Code Map

- `mawareeth/urls.py:36-86` -- the live route table (`calc_patterns`). `calc/urls.py` is not included anywhere, so it needs no edit.
- `calc/views.py:687-693` -- `LoginRequired`. It runs only after a subclass's own `dispatch` body, so it cannot guard lookups or `compute()` done there.
- `calc/views.py:37-53`, `78-686` -- 23 create views (`DeceasedCreate` plus 22 heir views). Each `dispatch` loads the case with `get_object_or_404(Calculation, pk=kwargs['calc_id'])`.
- `calc/views.py:56-76` -- `DeceasedUpdate`, `DeceasedDelete`. Pk is a `Deceased` id.
- `calc/views.py:665-686` -- `HeirUpdate`, `HeirDelete`. Pk is a `Heir` id. Both `Deceased` and `Heir` have a `calc` FK (`calc/models.py:733,752`), so filter on `calc__user`.
- `calc/views.py:64-71`, `674-679` -- `delete()` overrides that Django 5.2 no longer calls from `post()`, so `self.calc` is unset and `get_success_url` raises `AttributeError`.
- `calc/views.py:703-785` -- `DetailView`, `NewResultsView`, `ResultsView`. The results views call `compute()` in `dispatch` before the login check.
- `calc/views.py:787-789` -- `CalculationUpdate`, with no checks.
- `calc/views.py:791-801` -- `new`. It passes `request.user` to `create` and reads `request.POST["name"]`.
- `calc/views.py:810-817` -- `delete`. The owner check exists, but non-owners get a redirect to the error page.
- `calc/views.py:803-808` -- `father`. No route points to it; leave it alone.
- `calc/tests.py:24-57` -- existing Client test conventions (`secure=True`).

## Tasks & Acceptance

**Execution:**
- [x] `calc/views.py` -- Add `get_owned_calculation(request, pk)` wrapping `get_object_or_404(Calculation, pk=pk, user=request.user)`, and use it in all 23 create views, both results views and `delete` -- one lookup, so the rule lives in one place.
- [x] `mawareeth/settings.py` -- Add `django.contrib.auth.middleware.LoginRequiredMiddleware` directly after `AuthenticationMiddleware` -- it runs in `process_view`, before each view's own `dispatch`, so login is enforced ahead of the lookup and `compute()`, and new routes are private by default.
- [x] `calc/views.py`, `mawareeth/ops_views.py`, `mawareeth/urls.py` -- Mark public routes with `login_not_required`: `HomePage`, `Terms`, `Privacy`, `About`, `SignUp`, `error`, the three health views and `set_language` (route it directly in place of the `django.conf.urls.i18n` include, keeping the `/i18n/setlang/` path and name) -- these must stay reachable when logged out.
- [x] `calc/views.py` -- Override `get_queryset` on `DetailView`, `NewResultsView`, `ResultsView` and `CalculationUpdate` (`user=request.user`), and on `DeceasedUpdate`, `DeceasedDelete`, `HeirUpdate` and `HeirDelete` (`calc__user=request.user`) -- pk-based views get 404 from the queryset.
- [x] `calc/views.py` -- Move the delete logic from the `delete()` overrides into `form_valid` on `DeceasedDelete` and `HeirDelete` -- the overrides are never called, and owners must be able to delete. Capture `calc` before removing the row, and keep the heir removal in `DeceasedDelete`.
- [x] `calc/views.py` -- Redirect non-POST `new` requests to `calc:index`, and make `delete` answer non-owners with 404.
- [x] `calc/tests.py` -- Add `CalculationAccessControlTests` covering the matrix, with a route-walking test: iterate `calc_patterns` and map each route name to its object (case, deceased or heir id). Any case-scoped route missing from the map fails the test, and a short allowlist names the public routes (`home`, `terms`, `privacy`, `about`, `error`, `signup`). Also assert that public routes, the language switch, the health routes, login, password reset, social login start and the admin login stay reachable when logged out.

**Acceptance Criteria:**
- Given all waffle flags on, when the walker runs, then each case-scoped route returns non-404 for the owner, 404 for another user and 302 to login for anonymous, on both GET and POST.
- Given a non-owner or anonymous POST to any case-scoped route, when it completes, then names, estate and row counts are unchanged.
- Given a non-owner or anonymous GET on a results route, when it completes, then `compute()` was not called.
- Given a new route with an `int` path parameter that is not in the walker's map, when tests run, then the walker fails.
- Given a logged-out visitor, when they load a public page or switch language, then they are not redirected to login.

## Spec Change Log

- Review of the implementation: login redirects for `calc:delete` carry no `next`, because that view still deletes on GET and signing in would otherwise replay it. Logout is exempt from the login gate, and HTTP `DELETE` is rejected on `heir_delete` and `deceased_delete`. KEEP: `LoginRequiredMiddleware` plus owner-filtered lookups.

## Design Notes

Django's access mixins were evaluated and rejected for this job: `LoginRequiredMixin` and `UserPassesTestMixin` run after a view's own `dispatch` body, `UserPassesTestMixin` and `PermissionRequiredMixin` answer 403, and `ModelBackend` returns no permissions for a specific object. The owner chose `LoginRequiredMiddleware` plus owner-filtered lookups.

Enable flags in the walker with `@override_settings(WAFFLE_FLAG_DEFAULT=True)`. With flags off, flagged routes return 404 to everyone, so a missing ownership check would still pass. The owner's non-404 assertion is the control that catches this.

Walk `calc_patterns` rather than a hand-written list. The only hand-kept data is the name-to-object map, and a missing entry fails loudly.

## Verification

**Commands:**
- `python manage.py test calc` -- expected: all pass, including the new class.
- `python manage.py test` -- expected: full suite passes.
- `python manage.py check --deploy --fail-level WARNING` -- expected: no issues.

**Manual checks (if no CLI):**
- Using the app logged in as a second account, open another account's `/en/<id>/` and `/en/<id>/results/`. Expected: 404.
- After deploying, while logged out: the home page loads, the language switcher works, `/health/live/` answers, and a social login completes its round trip.

## Suggested Review Order

**Login by default**

- Start here: every route now requires login unless explicitly exempted.
  [`settings.py:206`](../../mawareeth/settings.py#L206)

- Public non-case routes stay reachable; logout must not get stuck behind login.
  [`urls.py:32`](../../mawareeth/urls.py#L32)

- Health routes stay open for monitoring and deploys.
  [`ops_views.py:64`](../../mawareeth/ops_views.py#L64)

**Ownership**

- The single rule: anything but the owner's own case is a 404.
  [`views.py:23`](../../calc/views.py#L23)

- ID-based views get their 404 from an owner-filtered queryset.
  [`views.py:28`](../../calc/views.py#L28)

- Results views check ownership before `compute()` writes to the database.
  [`views.py:809`](../../calc/views.py#L809)

**Delete behavior**

- This GET still deletes, so its login redirect drops `next` to prevent a replay.
  [`views.py:848`](../../calc/views.py#L848)

- Delete logic moved to `form_valid`, the only path Django 5.2 calls; now atomic.
  [`views.py:85`](../../calc/views.py#L85)

**Tests**

- The route walker fails on any unclassified case route.
  [`tests.py:955`](../../calc/tests.py#L955)
