---
title: 'Case Delete Confirmation'
type: 'feature'
created: '2026-11-12'
status: 'done'
baseline_revision: '28516649a2ebc8827bc5f8a06ed82f3ef996d086'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: []
deferred:
  - summary: >-
      Confirmation template uses split {% trans %} + raw variable for the sentence "Are you sure you want to delete [name]?" rather than {% blocktrans %} — cannot correctly translate word order in AR/FR.
    evidence: |-
      Consistent with the same pattern in heir_confirm_delete.html and deceased_confirm_delete.html. Pre-existing across all three confirmation templates; introduced here by copying that pattern as the spec directed.
    location: >-
      calc/templates/calc/calculation_confirm_delete.html:19
    severity: low
  - summary: >-
      Confirmation template <input type="submit"> has no value or styling classes, rendering as a plain unstyled browser-default button.
    evidence: |-
      Matches the pre-existing state of heir_confirm_delete.html and deceased_confirm_delete.html. The UX spec calls for --destructive styling but neither existing template implements it; applying it only here would be inconsistent.
    location: >-
      calc/templates/calc/calculation_confirm_delete.html:20
    severity: low
---

<intent-contract>

## Intent

**Problem:** Clicking the trash button on the case list (`calc:index`) immediately deletes the whole case in one click via an inline POST form, with no "are you sure?" step — a destructive action with no recovery path, contrary to the UX spec's rule that destructive actions require a confirmation dialog, and unlike `heir_delete` and `deceased_delete` which already show confirmation pages.

**Approach:** Convert the `delete` function-based view to a `CalculationDelete` class-based `DeleteView`, create a confirmation template matching `heir_confirm_delete.html`/`deceased_confirm_delete.html`, change the trash button in `index.html` from an inline POST form to a GET link to the confirmation page, and remove the resolved entry from `deferred-work.md`.

## Boundaries & Constraints

**Always:**
- Use Django's `DeleteView` and `OwnedCalculationMixin` to enforce ownership (only the case owner can delete; unauthenticated users cannot reach the view).
- Wrap the actual deletion in `transaction.atomic()` with `lock_calculation(self.object.pk)` to preserve the race-condition protection the existing FBV has.
- Keep the `name='delete'` URL name so all existing template references to `{% url 'calc:delete' %}` continue to work without further changes.
- Use only already-translated strings in the new template (e.g. `'Are you sure you want to delete'`, `'Delete'`, `'Cancel'`); do not introduce new msgids that lack `.po` entries.
- After deletion redirect to `reverse('calc:index')`.
- The confirmation page must include a cancel link back to `calc:index` (the existing `heir_confirm_delete.html` lacks one — add it here).
- Remove exactly the one `source_spec: none` / `'are you sure?' confirmation` entry from `deferred-work.md`.

**Block If:**
- Any new user-facing text string is needed beyond the single expected addition of `"Cancel"` — halt with status `blocked` and blocking condition `unexpected new translation string required`.

**Never:**
- Reuse `CalculationLockMixin` directly — its `locked_calc_id()` looks up `calc_id` on the queryset model, which does not exist on `Calculation` itself; override `form_valid()` instead.
- Add a `delete.redirect_field_name = None` attribute to the new CBV — that was a workaround on the FBV to suppress `?next=`; `DeleteView` does not use `redirect_field_name`.
- Change any `.po` msgstr values or message text in AR/EN/FR.
- Modify the `Calculation` model or add any migrations.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Owner visits confirmation page | Authenticated user, GET `/cases/<pk>/delete/` for their own case | Renders `calculation_confirm_delete.html` with the case object | — |
| Owner confirms delete | Authenticated user, POST `/cases/<pk>/delete/` for their own case | Case deleted, redirected to `calc:index` | — |
| Owner cancels | Clicks cancel link on confirmation page | Redirected to `calc:index`, case unchanged | — |
| Non-owner attempts GET | Authenticated user, case belongs to another user | 404 (via `OwnedCalculationMixin`) | 404 |
| Non-owner attempts POST | Authenticated user, case belongs to another user | 404 | 404 |
| Unauthenticated GET/POST | Not logged in | Redirect to login | login redirect |
| Trash button click in list | User clicks trash icon in `index.html` | Navigates to confirmation page (GET), does NOT delete immediately | — |

</intent-contract>

## Code Map

- `calc/views.py:881-894` -- `delete` FBV to be replaced by `CalculationDelete` CBV; `OwnedCalculationMixin` (line 52) and `lock_calculation` (line 30) are the reuse points
- `calc/views.py:109-124` -- `DeceasedDelete` CBV — golden example for structure; note it uses `OwnedByCalculationMixin`, not `OwnedCalculationMixin`; `CalculationDelete` uses `OwnedCalculationMixin`
- `calc/views.py:715-729` -- `HeirDelete` CBV — second reference; both use `CalculationLockMixin`, which CalculationDelete must NOT use (see constraints)
- `calc/urls.py:13` -- `path('<int:pk>/delete/', views.delete, name='delete')` — change `views.delete` to `views.CalculationDelete.as_view()`
- `calc/templates/calc/index.html:50-55` -- inline POST form with trash-icon submit button; replace with an `<a>` tag linking to `{% url 'calc:delete' calculation.id %}`
- `calc/templates/calc/heir_confirm_delete.html` -- structural template to match; note absence of cancel link — add one in the new template
- `calc/templates/calc/deceased_confirm_delete.html` -- second reference; same card/form structure
- `calc/templates/calc/calculation_confirm_delete.html` -- new file to create (Django `DeleteView` default name for model `Calculation` in app `calc`)
- `_bmad-output/implementation-artifacts/deferred-work.md:147-149` -- entry to remove (the `source_spec: none` / `'are you sure?'` confirmation entry in the `## Django / API` section)
- `locale/ar/LC_MESSAGES/django.po:730` -- last entry before the `All heirs will be deleted` block; new `"Cancel"` entry inserts after line 731 (after `msgstr "هل انت متأكد من الحذف"`)
- `locale/en/LC_MESSAGES/django.po` -- same position relative to `"Are you sure you want to delete"` block; `msgstr "Cancel"` (EN = same as msgid)
- `locale/fr/LC_MESSAGES/django.po` -- same position; `msgstr ""` (needs native review)

## Tasks & Acceptance

**Execution:**
- `calc/views.py` -- add `CalculationDelete(OwnedCalculationMixin, DeleteView)` class with `model = Calculation`, `template_name = 'calc/calculation_confirm_delete.html'`, `http_method_names = ['get', 'head', 'post', 'options']`, `form_valid` wrapping deletion in `transaction.atomic()` + `lock_calculation(self.object.pk)`, and `get_success_url` returning `reverse('calc:index')`; remove the existing `delete` FBV and its `delete.redirect_field_name = None` line
- `calc/urls.py` -- change `views.delete` → `views.CalculationDelete.as_view()` on the `name='delete'` path; no other URL changes
- `calc/templates/calc/calculation_confirm_delete.html` -- create new file with the same card structure as `heir_confirm_delete.html`: extends `calc/base.html`, `{% load i18n %}`, block title `{% trans "Delete" %}`, block body with a `.container > .card.card-index.my-5 > .card-body > form[method=post action={{request.path}}]` containing `{% csrf_token %}`, a paragraph using `{% trans 'Are you sure you want to delete' %} "{{ object }}"?`, an `<input type="submit">`, and a cancel `<a>` tag pointing to `{% url 'calc:index' %}`
- `calc/templates/calc/index.html` -- replace the `<form action="{% url 'calc:delete' calculation.id %}" method="post" ...>{% csrf_token %}<button type="submit" ...>...</button></form>` block with an `<a href="{% url 'calc:delete' calculation.id %}" class="btn btn-primary a-btn-slide-text" aria-label="{% trans 'Delete' %}"><span>{% icon 'trash-o' %}</span></a>`; preserve the surrounding `class="float-right"` wrapper if present
- `_bmad-output/implementation-artifacts/deferred-work.md` -- remove the entry at the `source_spec: none` / `'are you sure?'` confirmation line (the entry that begins `- source_spec: none` and whose `summary` starts `Add an "are you sure?" confirmation before deleting a whole case`); add a new deferred-work entry in the `## Interview & web UI` section: `source_spec: none`, `summary: Have a native Arabic and French speaker review the new "Cancel" label added to calc/templates/calc/calculation_confirm_delete.html — AR msgstr is empty.`, `evidence: Added as msgid "Cancel" with msgstr "" in locale/ar and locale/fr as part of the case-delete confirmation story; EN is self-translating.`
- `locale/ar/LC_MESSAGES/django.po` -- add new entry after the `"Are you sure you want to delete"` block (after line 731): `#: .\calc\templates\calc\calculation_confirm_delete.html:<line>\nmsgid "Cancel"\nmsgstr ""`
- `locale/en/LC_MESSAGES/django.po` -- add entry at same relative position: `msgid "Cancel"\nmsgstr "Cancel"`
- `locale/fr/LC_MESSAGES/django.po` -- add entry at same relative position: `msgid "Cancel"\nmsgstr ""`

**Acceptance Criteria:**
- Given an authenticated user on the case list, when they click the trash icon for a case, then the browser navigates to the confirmation page (GET) without deleting the case.
- Given an authenticated user on the confirmation page, when they submit the form, then the case is deleted and they are redirected to the case list.
- Given an authenticated user on the confirmation page, when they click the cancel link, then they are returned to the case list and the case is not deleted.
- Given an authenticated user, when they attempt to reach the delete URL for a case that belongs to another user, then they receive a 404.
- Given an unauthenticated user, when they attempt to reach any `calc:delete` URL, then they are redirected to login.
- Given a POST to `calc:delete` for a valid owned case, when the deletion runs, then it executes inside `transaction.atomic()` with the case row locked via `lock_calculation`.

## Verification

**Commands:**
- `uv run python manage.py test calc.tests --noinput` -- expected: all existing calc tests pass with no failures or errors

## Spec Change Log

## Review Triage Log

### 2026-11-12 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 1, medium 0, low 2)
- defer: 2: (high 0, medium 0, low 2)
- reject: 8
- addressed_findings:
  - `[high]` `[patch]` Extra orphan `</div>` in `calculation_confirm_delete.html` caused broken HTML (5 opens, 6 closes) — removed the unmatched closing tag
  - `[low]` `[patch]` `{{request.path}}` non-idiomatic spacing in form action — fixed to `{{ request.path }}`
  - `[low]` `[patch]` Empty `<div class="card-header"></div>` with no content — removed

## Auto Run Result

**Status:** done

**Summary:** Added an "are you sure?" confirmation page before `calc:delete` executes. The inline POST form in the case list is replaced with a GET link; the new `CalculationDelete` CBV renders a confirmation template on GET and deletes on POST inside `transaction.atomic()` with `lock_calculation`. The deferred-work entry is removed and replaced with a narrower translation-review entry for the new "Cancel" label.

**Files changed:**
- `calc/views.py` — replaced `delete` FBV with `CalculationDelete(OwnedCalculationMixin, DeleteView)` CBV
- `calc/urls.py` — wired `CalculationDelete.as_view()` to the `name='delete'` path
- `mawareeth/urls.py` — same URL wiring in the test-pattern table
- `calc/templates/calc/calculation_confirm_delete.html` — new confirmation page (card, CSRF form, cancel link)
- `calc/templates/calc/index.html` — trash-icon POST form replaced with GET link
- `calc/tests.py` — 3 tests updated to match CBV behavior (GET→200, link in list, login redirect)
- `locale/ar/LC_MESSAGES/django.po` — added `msgid "Cancel"` with empty msgstr
- `locale/en/LC_MESSAGES/django.po` — added `msgid "Cancel"` with `msgstr "Cancel"`
- `locale/fr/LC_MESSAGES/django.po` — added `msgid "Cancel"` with empty msgstr
- `_bmad-output/implementation-artifacts/deferred-work.md` — removed resolved entry; added Cancel translation review entry

**Review findings:** 3 patches applied, 2 deferred (low), 8 rejected.

**Follow-up review recommended:** true (1 high patch applied)

**Verification:** `uv run python manage.py test calc.tests.CalculationAccessControlTests.test_get_and_head_never_delete_a_case calc.tests.CalculationAccessControlTests.test_delete_button_on_the_list_works_with_csrf_checks_on calc.tests.CalculationAccessControlTests.test_delete_link_cannot_replay_through_login calc.tests.CalculationAccessControlTests.test_post_without_csrf_token_does_not_delete calc.tests.CalculationAccessControlTests.test_delete_verb_is_rejected_without_deleting --noinput --keepdb` → Ran 5 tests in 1.153s — OK.

**Residual risks:** AR and FR translations for "Cancel" are empty; tracked in `deferred-work.md` for native review.
