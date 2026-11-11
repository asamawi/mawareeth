---
title: 'Story 3.2: Draft PDF report with the not-certified disclaimer'
type: 'feature'
created: '2026-11-11'
status: 'done'
baseline_commit: '955728f4418b0d7009c115927eca29714f544b4c'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-1c-successive-deaths-scholars-table.md'
  - '{project-root}/web/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A visitor can see results on screen but cannot keep or share them as a formal document.

**Approach:** A new public `reports` Django app renders the visitor's current session case as a draft PDF. It builds the existing preview body and passes it through a server-side HTML template to WeasyPrint, inside the request. Nothing is stored. Report status is read only through a `report_status` extension point that returns `"draft"`. The results page gets a "Download PDF" action with inline progress, error and retry.

## Boundaries & Constraints

**Always:** Use a formal, neutral layout in ar (RTL), en and fr, chosen by Accept-Language as in the preview. The sections are:

- title, generation date, and school
- deceased and estate
- heirs and shares table: relationship, fraction, percentage, kirat, amount, and "blocked" where it applies
- scholars' table (3.1b single death, 3.1c layered), from the server `table`, when it is non-null
- proof summary per heir from the v1 proof labels: rule, condition or blocker, Quran reference, school rule; per death for a v2 proof
- unallocated remainder, when there is one

Every page carries a prominent draft / not-certified disclaimer and a "DRAFT" watermark through fixed-position elements. They are not removable options. Compute percentages and kirat in Python with the same integer half-up rules as `percentOf` and `kiratOf`. All numbers come from the preview body and none are recomputed. Response headers: `Content-Disposition: attachment`, `Cache-Control: no-store`. Log failures with the error type and traceback only, never case content.

**Ask First:** Any change to the preview body, the engine, or 3.1b/3.1c output. A migration. Any dependency beyond `weasyprint` and the image packages listed below.

**Never:** A kinship graph in the PDF (left out by decision on 2026-11-11). Certified status, seal, signature, registry link, QR code, or any wording beyond "draft / not certified". Storing PDFs or cases. Background workers or threads. Client-side PDF generation. Changes to legacy templates. Manual overrides of any number.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Single death | Available preview | 200 `application/pdf` with every section | N/A |
| Successive deaths | Layered fixture | Final shares, layered table, proof per death | N/A |
| Arabic | `Accept-Language: ar` | `dir="rtl"`, Arabic labels, numbers isolated | N/A |
| Missing / stale case | No `case_id`, no case, or a different id | 400 / 404 / 409, as in preview | Client shows error + retry |
| Not ready / unavailable | Preview status ≠ available | 409 `{status, reason}` and no PDF | Client message guides back to the interview |
| Status not draft | Provider returns another value | 503, logged | Public code never renders it |
| Render failure | WeasyPrint raises | 503 `{detail}` | Logged; client retry; results stay on screen |
| Throttled | > 30/hour per client | 429 | Client message |

</frozen-after-approval>

## Code Map

- `api/views.py:177-208` `PreviewView` -- copy its case_id/404/409 checks, `_asked_language` (`:162`), translation override and 503 logging. `ApiView` base, `AllowAny`, `never_cache`.
- `api/preview.py:179` `preview(case)` -- the only data source (shares, unallocated, proof, table, basis). `basis` is at `:62`. Names and estate come from the session case (`api/anonymous_case.py` `get`, `_rows`).
- `api/throttling.py:34` `CasePreviewThrottle` -- add `ReportDraftThrottle` (scope `report_draft`). Rates are at `mawareeth/settings.py:328`.
- `api/urls.py:7` -- add `reports/draft/` before the catch-all `not-found` route.
- `mawareeth/settings.py:180` `INSTALLED_APPS` -- add `reports`. Templates use `APP_DIRS=True` (`:240`).
- `web/src/interview/preview.ts:108-125` -- `percentOf` / `kiratOf` rules to port.
- `api/contracts/preview-fixtures.json` -- available fixtures (single and layered) for tests. Type reference: `web/src/api/case.ts:606-734`.
- `calc/proof.py:52-149` -- verse codes and rule labels (already translated in the v1 proof `labels`).
- `locale/{ar,en,fr}/LC_MESSAGES/django.po|.mo` -- the gettext catalogs. Report strings go here and the `.mo` files are recompiled.
- `Dockerfile:72` runtime stage -- no apt packages today. gunicorn timeout 60s (`:103`).
- `web/src/api/case.ts:319-395,1245-1274` -- fetch helpers, timeouts and status mapping to mirror for a blob download.
- `web/src/app/[locale]/results/results-view.tsx:82-97` (inline error/retry pattern), `:163-166` (actions beside the school summary: place the button here).
- `web/src/i18n/messages.ts` -- `results` block type plus ar/en/fr.
- Tests: `api/tests.py` (`TransactionTestCase` preview tests near `:1260`). Web uses `node --test` (`*.test.ts`).

## Tasks & Acceptance

**Execution:**
- [x] `pyproject.toml`, `uv.lock` -- add pinned `weasyprint`.
- [x] `Dockerfile` runtime stage -- `apt-get install --no-install-recommends libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz-subset0 fonts-noto-core`, then clean the apt lists.
- [x] `reports/` (new app: `apps.py`, `status.py`, `report.py`, `views.py`, `templates/reports/draft.html`) -- `report_status(case)` returns `"draft"` unless `settings.REPORT_STATUS_PROVIDER` (a dotted path, default `None`) names a callable. `report.py` builds the template context from the preview body and the case, and renders HTML, then PDF. `DraftReportView` follows the matrix.
- [x] `api/urls.py`, `api/throttling.py`, `mawareeth/settings.py` -- route, throttle, rate `30/hour`, app registration.
- [x] `locale/*/django.po|.mo` -- report strings in ar/en/fr.
- [x] `reports/tests.py` -- matrix rows; HTML context and content tests that need no WeasyPrint (sections, disclaimer, RTL, no certification wording, percent/kirat parity with the TS rules on fixtures). PDF byte tests (`%PDF` magic, disclaimer text extracted) skip when WeasyPrint cannot load.
- [x] `web/src/api/case.ts` (+ test) -- `downloadDraftReport(caseId, locale)`: GET as a blob with a 30s timeout, mapping 404/409/429/503/timeout to typed failures.
- [x] `results-view.tsx`, `messages.ts` -- "Download PDF (draft)" button for available results only, with busy state, inline `role="alert"` error and retry. Save via an object URL named `mawareeth-draft-YYYY-MM-DD.pdf`.

**Acceptance Criteria:**
- Given an available result, when the visitor downloads the PDF, then it contains the heirs, shares, proof summary and Quran/school citations, and every page shows the draft disclaimer.
- Given no private package, when a report is rendered, then its status comes from `report_status` and is `"draft"`, and a search of the public repo finds no seal, signature, registry or certified rendering.
- Given a failed download, when the visitor retries, then the on-screen results remain unchanged and a new request is made.

## Spec Change Log

## Design Notes

The disclaimer is a `position: fixed` block, which WeasyPrint repeats on every page, plus a rotated low-contrast "DRAFT" watermark. Use `@page` A4 with margins wide enough that body text never sits under the banner. Set `font-family: "Noto Naskh Arabic", "Noto Sans", sans-serif`. A provider-returned status other than `"draft"` fails closed, because public code has no certified template.

`weasyprint==70.0` is already added to `pyproject.toml`/`uv.lock`. Import it lazily inside the render function: on Windows dev, `import weasyprint` raises `OSError` (no GTK), and Django must still start. Tests that need it skip on that `OSError`.

## Verification

**Commands:**
- `uv run python manage.py test reports api calc --noinput` -- expected: all pass (PDF byte tests may skip on Windows)
- `cd web && npm test && npm run lint && npm run typecheck && npm run build` -- expected: all pass
- `docker build .` -- expected: success; then generate a PDF in the container for an ar fixture

**Manual checks:**
- Open the ar and en PDFs: Arabic shaping and RTL, disclaimer on every page, layered table legible.

## Suggested Review Order

**Endpoint and open-core seam**

- Entry point: session case → status check → preview → PDF, failing closed to 503.
  [`views.py:37`](../../reports/views.py#L37)

- Report status read only here; anything but "draft" refuses to render.
  [`status.py:5`](../../reports/status.py#L5)

- Accept-tolerant negotiation so `Accept: application/pdf` never gets 406; errors stay JSON.
  [`views.py:22`](../../reports/views.py#L22)

- Not-ready and unavailable cases return 409 and never render.
  [`views.py:52`](../../reports/views.py#L52)

**Report content**

- Context built only from the preview body; percent/kirat ported with TS half-up rules.
  [`report.py:63`](../../reports/report.py#L63)

- WeasyPrint imported lazily so Django starts without GTK on Windows.
  [`report.py:113`](../../reports/report.py#L113)

- Fixed disclaimer and watermark repeat on every page.
  [`draft.html:16`](../../reports/templates/reports/draft.html#L16)

- Later-death combination: p, GCD, relation, multipliers, new jami'a; none for death 1.
  [`draft.html:35`](../../reports/templates/reports/draft.html#L35)

**Download UI**

- Bounded blob fetch with typed failures and external abort.
  [`case.ts:1294`](../../web/src/api/case.ts#L1294)

- Button with busy/alert/retry; no save after unmount or locale change.
  [`results-view.tsx:334`](../../web/src/app/[locale]/results/results-view.tsx#L334)

**Peripherals**

- Pango, HarfBuzz and Noto fonts (Arabic) in the runtime image.
  [`Dockerfile:91`](../../Dockerfile#L91)

- 30/hour throttle; WeasyPrint/fontTools logs at WARNING.
  [`settings.py:331`](../../mawareeth/settings.py#L331)

- Rendered values and rowspans checked across fixtures.
  [`tests.py:115`](../../reports/tests.py#L115)

- Endpoint matrix: stale, 409, 503 with private-safe logs, throttle, Accept headers.
  [`tests.py:212`](../../reports/tests.py#L212)

- Download helper: statuses, timeout, retry, abort.
  [`draft-report.test.ts:56`](../../web/src/api/draft-report.test.ts#L56)
