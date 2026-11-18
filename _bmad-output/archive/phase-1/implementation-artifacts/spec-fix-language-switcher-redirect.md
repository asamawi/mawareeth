---
title: 'Fix language switcher redirect to use translated URL'
type: 'bugfix'
created: '2026-11-12'
status: 'done'
baseline_revision: 'd44a8296aca4be07dc8c678e821f3218439db45d'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred:
  - summary: >-
      No test for deep language-prefixed path (e.g. /ar/calc/123/ → /fr/calc/123/)
    evidence: |-
      Current test only verifies /ar/ root; deeper paths rely on Django's translate_url which is not independently exercised.
    location: >-
      calc/tests.py
    severity: low
  - summary: >-
      No guard verifying request context processor presence in TEMPLATES config
    evidence: |-
      If django.template.context_processors.request is ever removed, next= silently becomes empty with no test catching it.
    location: >-
      mawareeth/settings.py
    severity: low
  - summary: >-
      No test switching away from /en/ prefix (only /ar/ covered)
    evidence: |-
      Additional regression coverage for English-language pages switching to French or Arabic.
    location: >-
      calc/tests.py
    severity: low
---

<intent-contract>

## Intent

**Problem:** The language switcher form posts `next=` (empty) to `set_language` because the template renders `{{ redirect_to }}` which is never set in context. The view then falls back to the `HTTP_REFERER` header; when that header is stripped or unavailable, the fallback redirect goes to the old-language URL (e.g. `/en/` after choosing French) while the cookie is correctly set.

**Approach:** Replace the empty `{{ redirect_to }}` placeholder in the switcher form with `{{ request.get_full_path }}` so the current page path is always posted as `next`; Django's `translate_url` will then rewrite the prefix to the chosen language. Add a regression test covering the case where `next` carries a language-prefixed path.

## Boundaries & Constraints

**Always:**
- Use `request.get_full_path` (already available via `django.template.context_processors.request`, confirmed in settings) — no new context variable or view change needed.
- The fix touches only the hidden `next` input in the language-switcher form; do not restructure the form or middleware.
- The regression test must post a real language-prefixed path as `next` and assert the redirect lands on the same path under the new language prefix.

**Block If:**
- Any discovered evidence that `request` is not available in the template context (would require a view-layer fix instead).

**Never:**
- Do not change `set_language` view behaviour or override it.
- Do not change translation strings (.po/.mo files).
- Do not add JavaScript — the fix is purely in the template.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Switch language from prefixed page | POST `language=fr`, `next=/en/calc/` | 302 → `/fr/calc/`, `LANGUAGE_COOKIE_NAME=fr` | No error expected |
| Switch language from default-lang page (no prefix) | POST `language=fr`, `next=/calc/` | 302 → `/fr/calc/` | No error expected |
| Switch to current language | POST `language=en`, `next=/en/calc/` | 302 → `/en/calc/`, cookie unchanged | No error expected |

</intent-contract>

## Code Map

- `calc/templates/calc/base.html:70` -- language switcher form; `<input name="next" type="hidden" value="{{ redirect_to }}">` is the broken line
- `mawareeth/urls.py:32` -- `set_language` registered at `/i18n/setlang/`; uses stock Django view unchanged
- `mawareeth/settings.py:222` -- `django.template.context_processors.request` confirmed in `TEMPLATES[0]['OPTIONS']['context_processors']`; `request` is available in all templates
- `calc/tests.py:1116-1120` -- existing `test_language_switch_works_when_logged_out`; hardcodes `next='/en/'` and does not cover the empty-next bug path

## Tasks & Acceptance

**Execution:**
- `calc/templates/calc/base.html:70` -- change `value="{{ redirect_to }}"` to `value="{{ request.get_full_path }}"` -- passes the current page URL so `translate_url` can rewrite the language prefix
- `calc/tests.py` -- in `CalculationAccessControlTests`, add `test_language_switch_redirects_to_translated_path`: post to `set_language` with `language='fr'` and `next='/en/'` (simulating a real page URL), assert 302 to `/fr/`, assert `LANGUAGE_COOKIE_NAME` value is `fr` -- regression test for empty-next bug

**Acceptance Criteria:**
- Given a visitor is on `/en/calc/`, when they submit the language switcher form with `language=fr`, then the response is a 302 redirect to `/fr/calc/` and the language cookie is set to `fr`.
- Given `next` contains a path with an unknown or missing language prefix, when the form is submitted, then `set_language` falls back gracefully (unchanged Django behaviour).
- Given `test_language_switch_redirects_to_translated_path` runs, then it passes without hardcoding `next` to match the redirect destination.

## Verification

**Commands:**
- `uv run python manage.py test calc.tests.CalculationAccessControlTests.test_language_switch_redirects_to_translated_path calc.tests.CalculationAccessControlTests.test_language_switch_works_when_logged_out --noinput` -- expected: 0 errors, 0 failures

## Spec Change Log

## Review Triage Log

### 2026-11-12 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 3: (high 0, medium 0, low 3)
- reject: 7
- addressed_findings:
  - `[medium]` `[patch]` Template change not pinned by any test — reverting base.html:70 would not break existing tests. Added `test_language_switch_form_next_field_contains_current_path` which GETs `/ar/about/` and asserts the hidden `next` input renders the current path value; passes green.

## Auto Run Result

**Status:** done

**Summary:** Fixed language switcher bug where `{{ redirect_to }}` (never set in context) caused an empty `next` POST parameter, making `set_language` fall back to `HTTP_REFERER` and sometimes redirect to the old-language URL. Replaced with `{{ request.get_full_path }}` so the current path is always posted and `translate_url` rewrites it to the chosen language prefix.

**Files changed:**
- `calc/templates/calc/base.html` — line 70: changed `value="{{ redirect_to }}"` to `value="{{ request.get_full_path }}"`
- `calc/tests.py` — added two tests in `CalculationAccessControlTests`: `test_language_switch_redirects_to_translated_path` (regression: prefix rewrite works) and `test_language_switch_form_next_field_contains_current_path` (pins template output)

**Review findings:** 1 patch applied (medium), 3 deferred (low), 7 rejected.

**Follow-up review recommendation:** false
Patched counts: medium=1, low=0. Score: 3×1 + 1×0 = 3 (threshold 5). No high-severity patches.

**Verification:** `uv run python manage.py test calc.tests.CalculationAccessControlTests.test_language_switch_redirects_to_translated_path calc.tests.CalculationAccessControlTests.test_language_switch_works_when_logged_out calc.tests.CalculationAccessControlTests.test_language_switch_form_next_field_contains_current_path --noinput` — 3 tests, 0 failures, 0 errors.

**Residual risks:** None. `request.get_full_path` is a core Django method; `translate_url` is Django's stock prefix-rewriting function used by `set_language`. Both are well-tested in Django itself.

## Design Notes

`request.get_full_path` returns the path including query string but no scheme/host, which is exactly what `set_language` expects for the `next` parameter. Using `request.build_absolute_uri` would include the host and may cause Django to reject the redirect on ALLOWED_HOSTS; `get_full_path` is the correct choice.
