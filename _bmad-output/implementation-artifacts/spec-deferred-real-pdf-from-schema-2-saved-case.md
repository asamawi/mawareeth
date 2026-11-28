---
title: 'Render a real PDF from a schema-2 Saved case (single and layered) in CI'
type: 'chore'
created: '2026-11-20'
status: 'done'
baseline_revision: '18264758f3537a835d316750b958248c4bb14061'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred:
  - summary: >-
      The real-PDF test skips on hosts without WeasyPrint's native libraries, so only CI proves the render and pdftotext text path.
    evidence: |-
      Windows dev host lacks Pango/GObject; the test fails rather than skips only when GITHUB_ACTIONS=true. The first CI run of this commit is the real check (watch the apostrophe in "jami'a" under pdftotext).
    location: >-
      api/test_snapshots.py test_schema_2_saved_cases_render_real_pdfs
    severity: low
---

<intent-contract>

## Intent

**Problem:** No test renders a real PDF from a schema-2 Saved case. Stories 8.8–8.10 only compared the arguments passed to a mocked `reports.views.render_pdf` (`api/test_snapshots.py` `test_twins_list_open_share_received_and_pdfs`), so a template or WeasyPrint failure on a decoded schema-2 case (for example the layered tables of a later death) would pass every test (deferred-work.md, Epic 8 retrospective, source spec 8.10).

**Approach:** Add one test that stores the schema-2 `estate` (single estate) and `later-deaths` (layered) fixtures as `SavedCase` rows, downloads each through the real public share report endpoint with no mock, and checks the PDF bytes and extracted text. In CI (the `validate` job, which installs the Noto fonts) the test must run, not skip; on hosts without WeasyPrint's native libraries it skips like the existing `reports/tests.py` real-PDF test.

## Boundaries & Constraints

**Always:**
- Go through the endpoint (`POST /api/v1/shares/report/` with a public share token), so the decode → preview → `render_pdf` path is the production one. Request English (`HTTP_ACCEPT_LANGUAGE='en'`).
- Skip when `import weasyprint` raises `OSError`/`ImportError`, or when `pdftotext` is not on PATH — except when the environment variable `GITHUB_ACTIONS` equals `true`, where either condition fails the test (`self.fail(...)`) so CI can never skip silently.
- Text assertions normalize whitespace (collapse runs of whitespace to one space) on both sides before `assertIn`.
- Add `poppler-utils` to the existing `apt-get install` line of the "Install PDF fonts" step in `.github/workflows/django.yml` so `pdftotext` exists in CI.
- Remove the matching entry from `_bmad-output/implementation-artifacts/deferred-work.md` (the three-line `summary: No test renders a real PDF from a schema-2 Saved case ...` item, ~L472-474), leaving every other line unchanged.

**Never:**
- No production code, template, fixture, migration or translation change. If the real render fails on current code, HALT and report; do not change the template or the fixture to make it pass.
- Do not change existing tests' mocks or the existing `reports/tests.py` skip behaviour.
- Do not add a Python PDF library dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| single estate | `SavedCase(schema_version=2, snapshot=fixture('estate', 2))`, public share, POST report | 200, `Content-Type: application/pdf`, body starts `b'%PDF'`; text contains `Ali`, `Draft / not certified`, and each presented row's `relationship.translated.text` and `percent.text` | No error expected |
| layered (later death) | same with `fixture('later-deaths', 2)` | as above, plus the layered combination labels `Old jami'a multiplier` and `New jami'a` | No error expected |
| no native libs, local | WeasyPrint import fails, `GITHUB_ACTIONS` unset | test skipped with the error type in the reason | skip |
| no native libs, CI | WeasyPrint import fails or no `pdftotext`, `GITHUB_ACTIONS=true` | test fails with a message naming what is missing | fail |

</intent-contract>

## Code Map

- `api/test_snapshots.py` L25-26 -- `fixture(name, version)` loads `api/fixtures/snapshots/v{version}-{name}.json`; schema-2 fixtures `v2-estate.json` (wife + son "Ali", estate 120050 minor SAR, Hanbali) and `v2-later-deaths.json` (son "Ali" dies second; heirs wife-as-mother and grandson).
- `api/test_snapshots.py` L48-56 -- `SnapshotTests.setUp` (owner logged in on `self.client`); L94-98 `readers()` creates the `SavedCase`, a public share via `sharing.issue(row, ShareLink.PUBLIC, self.owner)` and an invite; L100-133 the mocked twin test whose share-report call (`self.send('post', '/api/v1/shares/report/', {'token': token})`) the new test reuses unmocked. Add the new test method to `SnapshotTests` after it. `self.send` comes from `api.tests.InterviewHelpers`.
- To get the expected presented texts, POST `/api/v1/shares/view/` with the same token and read `response.json()['preview']['presented']['rows']` (each row has `relationship.translated.text`, `percent.text`), under the same `HTTP_ACCEPT_LANGUAGE='en'`. Check how `self.send` passes headers; if it cannot, call `self.client.post(..., content_type='application/json', secure=True, HTTP_ACCEPT_LANGUAGE='en')` directly, matching how `send` builds its request.
- `reports/views.py` L54-73 -- `draft_pdf_response`: language from `_asked_language` (Accept-Language), then `preview.preview(case)` and `render_pdf(case, body)`; any exception becomes a 503, so a 503 in the test means the real render failed.
- `reports/report.py` L95-98 -- `render_pdf` imports WeasyPrint lazily; template `reports/templates/reports/draft.html` (L41-44 combination labels for layered tables).
- `reports/tests.py` L268-297 -- `test_real_pdf_bytes_and_repeated_disclaimer`: pattern to copy for the WeasyPrint skip, `pdftotext` via `subprocess.run([... , '-'])` on a temp file, and page splitting.
- `.github/workflows/django.yml` L91-94 -- "Install PDF fonts" step; tests run later in the same `validate` job (`python manage.py test --parallel auto`). GitHub sets `GITHUB_ACTIONS=true` on runners.
- WeasyPrint's native libraries (Pango/GObject) are absent on the Windows dev host, so locally the new test skips; CI is the run that proves it.

## Tasks & Acceptance

**Execution:**
- `api/test_snapshots.py` -- add `test_schema_2_saved_cases_render_real_pdfs` to `SnapshotTests` per the matrix, with a small helper for the skip-or-fail-in-CI rule -- proves the decoded schema-2 case renders through the real renderer.
- `.github/workflows/django.yml` -- add `poppler-utils` to the "Install PDF fonts" apt line -- gives CI `pdftotext`.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- delete the resolved entry.

**Acceptance Criteria:**
- Given the CI `validate` job, when the test suite runs, then the new test executes (not skipped) for both fixtures and passes on current code.
- Given a host without WeasyPrint's native libraries and no `GITHUB_ACTIONS`, when `api.test_snapshots` runs, then the new test is reported as skipped and every other test in the module passes.
- Given the diff, when inspected, then only `api/test_snapshots.py`, `.github/workflows/django.yml` and `deferred-work.md` changed.

## Spec Change Log

## Review Triage Log

### 2026-11-20 — Review pass
- reviewer: codex hit its usage limit (resets 2026-11-25), gemini hit its quota (resets in ~6.8 days); the combined five-layer review ran on the qwen agent.
- verdicts: 18 findings — high 0, medium 0, low 6, false 12, maybe-false 0
- findings:
  - `[false]` `[reject]` blind: CI guarantee rests on GITHUB_ACTIONS, which could be unset — GitHub sets GITHUB_ACTIONS=true for every step on hosted runners; the validate job runs on ubuntu-latest.
  - `[low]` `[patch]` blind: compare path (no school) not rendered — added the `compare` fixture to the loop; its needles pass against the real rendered HTML.
  - `[false]` `[reject]` blind: `flat(None)` on a null presented text — PresentedResult rows carry text strings; a None would still fail the test loudly, not hide a defect.
  - `[low]` `[reject]` blind: no test forces the skip branch — a test of a test helper; unlikely to matter and adds code.
  - `[low]` `[reject]` blind: empty pdftotext output gives a "needle not found" message — `check=True` catches tool failure and assertIn prints the extracted text, so the cause is visible.
  - `[low]` `[patch]` blind: other schema-2 fixtures not rendered — added `no-estate` (no-amount template branch); `jafari` is refused (409) and `lineage-*` duplicate covered shapes.
  - `[false]` `[reject]` blind: no negative check that single estates lack combination labels — `reports/tests.py` pins `len(parsed.combinations) == len(layers) - 1` on the rendered HTML.
  - `[false]` `[reject]` blind: any `%PDF` body accepted — reviewer notes the per-row needles already tie the text to the case.
  - `[low]` `[reject]` edge: pdftotext empty stdout (same as above) — see that row.
  - `[false]` `[reject]` edge: None text fields (same as above) — see that row.
  - `[low]` `[reject]` edge: runtime render failure shows as a 503 status mismatch — the view logs the exception type and traceback in the test output; extra diagnostics would add code for no correctness gain.
  - `[false]` `[reject]` edge: misconfigured CI without GITHUB_ACTIONS — same refutation as the first row.
  - `[false]` `[reject]` edge: empty rows — reviewer confirms `assertTrue(rows)` guards it.
  - `[false]` `[reject]` edge: single-estate negative check (same as blind row) — pinned in `reports/tests.py`.
  - `[false]` `[reject]` edge: Windows path quoting — reviewer confirms list-form subprocess handles it.
  - `[low]` `[defer]` verification-gap: test skips locally, so only CI proves the render — inherent to the host; recorded in `deferred` with the first CI run as the check.
  - `[false]` `[reject]` verification-gap: swapped percentages across rows would pass — row placement is pinned cell by cell by `RenderedReport` tests in `reports/tests.py` on the same template.
  - `[false]` `[reject]` intent-alignment: divergence on non-GitHub CI hosts — the project's CI is GitHub-hosted only (`.github/workflows/django.yml`); diff otherwise implements reading A exactly. cross-story-contract: no contract shape changed (0 findings).

## Verification

**Commands:**
- `uv run python manage.py test api.test_snapshots --noinput` -- expected: OK, with the new test skipped (WeasyPrint native libraries unavailable on this host).
- `GITHUB_ACTIONS=true uv run python manage.py test api.test_snapshots.SnapshotTests.test_schema_2_saved_cases_render_real_pdfs --noinput` -- expected: FAIL with a message naming the missing WeasyPrint libraries (proves CI cannot skip).
- `git diff --stat` -- expected: only the three files above.

## Auto Run Result

Status: done

- Summary: `SnapshotTests.test_schema_2_saved_cases_render_real_pdfs` stores the schema-2 `estate`, `no-estate`, `compare` and `later-deaths` fixtures as Saved cases and downloads each through `POST /api/v1/shares/report/` with no mock, checking status, content type, `%PDF` bytes and pdftotext text (heir name, draft notice, every presented row's relationship and percent, and the layered combination labels). It skips without WeasyPrint's native libraries or pdftotext, but fails under `GITHUB_ACTIONS=true`.
- Files: `api/test_snapshots.py` (new test and `require_pdf_tools` helper); `.github/workflows/django.yml` (`poppler-utils` for pdftotext); `_bmad-output/implementation-artifacts/deferred-work.md` (resolved entry removed).
- Implementation: Sonnet subagent. Review: codex usage limit, then gemini quota, so the combined review ran on qwen (fallback recorded).
- Review: 18 findings; 2 low patched (added `no-estate` and `compare` fixtures, applied by the parent), 1 low deferred (CI-only proof), 3 low rejected and 12 false (reasons in the triage log). Patched counts: high 0, medium 0, low 2.
- Follow-up review recommended: false.
- Verification: `uv run python manage.py test api.test_snapshots --noinput` → Ran 15, OK (skipped=1). `GITHUB_ACTIONS=true` run of the new test → FAIL naming the missing libgobject (CI cannot skip). A throwaway variant (deleted) fed the real `render_html` output through the endpoint for all four fixtures and found every needle, e.g. estate Wife 12.5% / Son 87.5%, later-deaths Wife 27.1% / Son 72.9%.
- Residual risk: no real PDF was produced on this host; pdftotext extraction (e.g. the apostrophe in "jami'a") is first proven by CI.
