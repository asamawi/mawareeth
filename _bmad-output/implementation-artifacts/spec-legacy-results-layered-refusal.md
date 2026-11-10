---
title: 'Legacy results pages refuse layered cases instead of failing with 500'
type: 'bugfix'
created: '2026-11-10'
status: 'done'
baseline_commit: 'eddf26e1fd0c562e1f9e94151630306fb49f23ad'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `ResultsView` and `NewResultsView` call `Calculation.compute()` and catch only `Calculation.DoesNotExist`. Since Story 2.4, `compute()` raises `UnsupportedCase('manasikhat_unsupported')` for any case with a later death (the root, a child layer, or a case whose heir died later). That exception goes uncaught and the owner gets a 500.

**Approach:** Catch `UnsupportedCase` in both views and show the owner the refusal's translated message on the existing `calc/error.html` page with HTTP 200. Do not compute anything else. `compute()` already rolls back every write when it refuses.

## Boundaries & Constraints

**Always:**
- Catch `calc.schools.UnsupportedCase` generally, not only the manasikhat reason, so any engine refusal reaching these pages is shown and does not crash.
- The message is `exc.message`, which is already translated in ar/en/fr. Add no new strings.
- Ownership and the 404 checks stay as they are: a non-owner still gets 404, and a case deleted mid-compute still gets 404.
- A refused GET leaves every heir row of the case unchanged.

**Ask First:** Running `compute_manasikhat()` from these pages, or adding a layered results display. Changing `compute()`, `calc/schools.py` or the templates' result layout.

**Never:** API, contract, web (`web/`) or engine changes. Hiding layered cases from the case list. New translations.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Single-layer case | Owner GETs `results` or `new_results` (flag on) | Unchanged: 200, results template | N/A |
| Layered root | Owner GETs either route on a case whose heir has a later `Deceased` | 200, `calc/error.html` showing "This successive inheritance case is not supported"; heir rows unchanged | `UnsupportedCase` caught |
| Child layer | Owner GETs either route on a layer (`parent` set) | Same as the layered root | `UnsupportedCase` caught |
| Vanished case | `compute()` raises `DoesNotExist` | 404 (existing behaviour) | unchanged |
| Non-owner | Another user GETs a layered case | 404, no compute | unchanged |

</frozen-after-approval>

## Code Map

- `calc/views.py:770-806` `NewResultsView` -- `get()` at `:801` calls `self.calc.compute()` and catches only `DoesNotExist`. It's waffle flag-gated (`new_results`).
- `calc/views.py:808-843` `ResultsView` -- same pattern, with `get()` at `:838`.
- `calc/views.py:888-890` `error` view and `calc/templates/calc/error.html` -- render `messages` as alerts. Reuse the template with `messages.error(request, exc.message)` and `render(request, 'calc/error.html')`. Messages added in the same request are displayed.
- `calc/views.py:17` imports `from .models import *`. Import `UnsupportedCase` explicitly from `.schools`.
- `calc/schools.py:48-57` `UnsupportedCase`, which has `.reason` and `.message`. `LAYERED_REASONS[MANASIKHAT_UNSUPPORTED]` is "This successive inheritance case is not supported".
- `calc/models.py:890-917` `compute()` -- refuses layered cases inside `transaction.atomic()`, so writes roll back. This file is read-only for this change.
- `calc/tests.py:3031` `build_layer(parent, earlier, sex, heir_types, links, order)` and `:1485` `build_case` -- fixtures, all owned by the user `fixture-owner`. `:1499` `stored(heir)` reloads a row.
- `calc/tests.py:2972` `CalculationWriteViewTests` and its `:2997` `test_results_return_404_if_case_vanished_at_compute` -- the pattern for route loops with `override_flag('new_results', active=True)` and `secure=True`.

## Tasks & Acceptance

**Execution:**
- [x] `calc/views.py` -- in both `ResultsView.get` and `NewResultsView.get`, add `except UnsupportedCase as exc:` and return the error page with the message. The DoesNotExist branch stays. A small shared helper is fine.
- [x] `calc/tests.py` -- add tests next to `CalculationWriteViewTests`. For a 2-layer fixture built with `build_case` plus `build_layer`, log in as `fixture-owner`, GET both routes for the root and for the layer, and assert status 200, template `calc/error.html`, the refusal text in the content, and every heir row unchanged (compare the `stored()` fields before and after). Assert a non-owner still gets 404 on the layered root.

**Acceptance Criteria:**
- Given any single-layer case, when its owner opens either results page, then the response and the stored heir rows are as before this change. The existing results tests still pass.
- Given a layered case, when it is opened on either results page, then no 500 is raised and no row is written.

## Design Notes

HTTP 200 matches how the legacy app already reports user-facing problems on `calc/error.html`. A refusal is a valid answer about a valid case, not a server or request error. Rendering in place keeps the URL, so a reload shows the same answer.

## Verification

**Commands:**
- `DATABASE_URL='sqlite://:memory:' DJANGO_ENV=test .venv/Scripts/python.exe manage.py test calc api` -- expected: all pass.
- `.venv/Scripts/python.exe manage.py makemigrations --check --dry-run` -- expected: no changes.

## Suggested Review Order

- Start here: a refusal from `compute()` renders the translated reason on the error page.
  [`views.py:847`](../../calc/views.py#L847)

- The same handling in the flag-gated new results view.
  [`views.py:807`](../../calc/views.py#L807)

- Root and child layer on both routes: the error page appears and heir rows are unchanged.
  [`tests.py:3030`](../../calc/tests.py#L3030)

- Ownership still answers 404 before any compute.
  [`tests.py:3054`](../../calc/tests.py#L3054)

- Any engine refusal reason is shown, not only manasikhat.
  [`tests.py:3063`](../../calc/tests.py#L3063)
