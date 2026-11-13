---
title: 'Optional estate: shares-only draft PDF'
type: 'feature'
created: '2026-11-13'
status: 'done'
baseline_revision: '69bb77161d8f543c49ea11ed5db73b95f6e0e07e'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** deferred-work.md ("Product scope / future epics", order 5 of 6) asks that the estate amount be optional in the interview, results and draft report so a case can be computed and saved as shares/fractions only. Investigation shows the interview, preview API, save/load and results page already accept a missing estate (`clean_estate` returns `None` for blank, `previewReady()` and save completeness ignore estate, the results table hides Amount when every amount is null). The draft PDF alone still treats the estate as always present: it prints `Estate: —` and an Amount column full of `—`.

**Approach:** When the case has no estate, the draft PDF renders shares only: no `Estate:` text after the deceased, no Amount column, and blocked rows span the remaining three value columns. This matches the results page. With an estate, the PDF is unchanged. Close the deferred-work entry.

## Boundaries & Constraints

**Always:**
- The decision is driven by `body['basis']['estate'] is None` (the preview body passed to `build_context`), exposed in the context as one boolean (for example `with_amount`) the template uses for both the header cell and each row.
- With an estate: output byte-for-byte the same columns and text as today (blocked rows `colspan="4"`, Amount cell present).
- Without an estate: header columns Name, Relationship, Fraction, Percentage, Kirat; non-blocked rows have 5 cells; blocked rows have Name, Relationship and one `colspan="3"` "Blocked" cell; the deceased line shows only the gender in `<bdi>`, no "Estate" label and no dash.
- Keep the existing `Deceased and estate` heading and all existing msgids; no new translatable text.

**Block If:**
- Any change to `api/`, `calc/`, `web/`, the preview contract or fixtures appears necessary.
- A new or changed user-facing string (ar/en/fr msgid/msgstr) appears necessary.

**Never:**
- No change to the legacy Django calc form (`calc/forms.py` still requires estate; legacy pages are retired by a later item).
- No change to the scholars' table, proof, or unallocated sections of the PDF.
- Do not edit `.po` files or compile messages.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Estate given | fixture with `basis.estate` "1200.00" | PDF as today: `Estate: 1200.00`, 6 header columns, Amount per row, blocked `colspan="4"` | No error expected |
| No estate | fixture with `basis.estate` null | No "Estate:" text, 5 header columns, no amount cell, blocked `colspan="3"` | No error expected |
| No estate, blocked + layered | a layered/table fixture with estate forced to null (copy.deepcopy, set `basis.estate` and each `amount` to None) | first table rows follow the no-estate shape; scholars' tables unchanged | No error expected |

</intent-contract>

## Code Map

- `reports/report.py:63-111` -- `build_context(case, body)`; returns `'estate': body['basis']['estate']`. Add the boolean here.
- `reports/templates/reports/draft.html:22-26` -- deceased/estate line (`{{ estate|default_if_none:"—" }}`), share table header and rows (`<th>Amount</th>`, blocked `colspan="4"`, `row.amount|default_if_none:"—"`).
- `reports/tests.py:26-60` -- `RenderedReport` HTML parser (tables -> rows -> `[attrs, text]` cells); reuse for assertions.
- `reports/tests.py:115-140` -- `test_rendered_values_and_rowspans`: currently expects `share['amount'] or '—'` as last cell and `colspan '4'` for blocked rows; must branch on whether the fixture has an estate.
- `api/contracts/preview-fixtures.json` -- read-only; has fixtures with and without estate (`basis.estate` null, `amount` null). `AVAILABLE` in tests filters to available ones.
- `web/src/app/[locale]/results/inheritance-table.tsx:113,267` -- read-only reference: `withAmount = rows.some(amount !== null)` hides the Amount column; the PDF mirrors this.
- `_bmad-output/implementation-artifacts/deferred-work.md:307-309` -- the "Make the estate amount optional..." entry to remove.

## Tasks & Acceptance

**Execution:**
- `reports/report.py` -- add `'with_amount': body['basis']['estate'] is not None` to the returned context -- single source for the template.
- `reports/templates/reports/draft.html` -- wrap `· Estate: <bdi>…</bdi>` and the Amount `<th>`/`<td>` in `{% if with_amount %}`; blocked `colspan` is `4` with amount, `3` without -- shares-only PDF.
- `reports/tests.py` -- update `test_rendered_values_and_rowspans` to expect the no-amount shape when `body['basis']['estate']` is None; add a test that renders one blocked fixture both with its estate and with estate/amounts forced to None (deep copy) and asserts header cells, row cell counts, blocked colspan, and presence/absence of `Estate` text before the first `<table>` -- cover the I/O matrix.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- delete the order-5 "Make the estate amount optional" entry (lines 307-309) -- resolved.

**Acceptance Criteria:**
- Given an anonymous case without an estate that the preview reports as available, when the visitor downloads the draft PDF (`render_html` of that case and preview body), then the report contains no "Estate:" label, no Amount header and no `—` placeholder in the shares table.
- Given a case with an estate, when the draft is rendered, then its shares table and deceased line are identical to the output before this change.

## Spec Change Log

## Review Triage Log

### 2026-11-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 0
- reject: 20: (high 0, medium 1, low 19)
- addressed_findings:
  - `[low]` `[patch]` The no-estate test checked for "Estate" in everything before the first table, which passes only because the heading says "estate" in lowercase; it now checks the deceased line itself, for both "Estate:" and the dash.
  - `[low]` `[patch]` The `build_context` return line had become over-long; it is now split across two lines.

## Auto Run Result

**Summary:** The draft PDF now renders shares only when the case has no estate. It omits the "Estate:" text, the Amount column and the dash placeholders, and blocked rows span 3 columns. This matches the results page, which hides Amount when no amount exists. Investigation confirmed the interview (`clean_estate`, `answers.ts`), preview API, save/load and results page already accept a missing estate, so the backlog item (order 5 of 6) is closed.

**Files changed:**
- `reports/report.py` -- `with_amount` context flag from `body['basis']['estate'] is not None`.
- `reports/templates/reports/draft.html` -- Estate text, Amount header/cell and blocked colspan depend on `with_amount`.
- `reports/tests.py` -- `test_rendered_values_and_rowspans` branches on estate; new `test_shares_only_report_without_estate` renders blocked fixtures with and without an estate.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- removed the resolved order-5 entry.

**Review findings:** 2 patches applied (both low), 0 deferred, 20 rejected. Rejected findings included a KeyError on `basis.estate`, which the preview body always carries. They also included amounts in the scholars' tables, which have no amount column; a zero estate, which the API rejects with `not_positive`; and a notice that amounts were omitted, which would need new text that the spec forbids. The intent-alignment auditor noted that only the report surface changed in the diff. This is by design, because the other surfaces were verified as already supporting a missing estate.

**Follow-up review recommendation:** false. Patched: high 0, medium 0, low 2. Score 3×0 + 2 = 2.

**Verification:** `uv run python manage.py test reports --noinput` gave 15 tests, OK, 1 skipped. The skip is `test_real_pdf_bytes_and_repeated_disclaimer`: WeasyPrint's native libraries are not installed on this machine, so the actual PDF bytes were not generated. The rendered HTML was fully checked.

**Residual risks:** Real PDF rendering was not exercised locally; CI or the image run covers it. Only the English locale is asserted in the new test, and the Arabic RTL layout of the 5-column table was not checked by eye.

## Verification

**Commands:**
- `uv run python manage.py test reports --noinput` -- expected: all tests pass (Postgres on localhost:5432 must be running).
- `git diff --stat` -- expected: only `reports/report.py`, `reports/templates/reports/draft.html`, `reports/tests.py`, `deferred-work.md` and this spec changed.
