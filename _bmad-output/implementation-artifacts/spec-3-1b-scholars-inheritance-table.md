---
title: "Story 3.1b: The scholars' inheritance table for results and the interview preview"
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: '88c507b16d50e497767a9a7ab9c85565c3fafd09'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/web/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent â€” do not modify unless human renegotiates">

## Intent

**Problem:** The results page and the interview preview show shares as cards and a list. Scholars and court clerks expect the recognised problem table (Ø¬Ø¯ÙˆÙ„ Ø§Ù„Ù…Ø³Ø£Ù„Ø©): the prescribed share, the base, and the 'awl, radd and correction columns with their totals, as on the legacy results page.

**Approach:** The engine also returns a language-free table: the legacy columns with their totals and each heir's parts, with group cells merged. The preview API passes it on with session ids and column labels. One table component replaces the cards on the results page and the list in the interview preview for single-death cases. Percentage and kirat are extra columns. A heir's explanation is a hidden side note shown on hover or click.

## Boundaries & Constraints

**Always:** The columns, totals and cells are the engine's own values: `share`, `shorted_share`, `shortage_calc_share`, `shortage_union_share`, `corrected_share`, and `shares`, `shares_excess`, `shares_shorted`, `shortage_calc_shares`, `shortage_union_shares`, `shares_corrected`. Only columns that apply are listed, in legacy order: base, awl, shortage (coded `radd` when radd applies, otherwise `remainder`), radd_calc, radd_union, correction. A cell that falls back to its group's total (`_Group.column`) is one merged cell spanning that group's consecutive rows. Blocked heirs' cells are empty. Percentage and kirat come from the existing client formatting, the amount from `shares[].amount`. The table is not stored and not versioned with the proof. Its shape is strict on both sides. Text in ar/en/fr. RTL table order. Numbers in `bdi`. The table scrolls inside its own container, never the page. The side note opens on hover, keyboard focus or click/Enter, closes on Escape, and its toggle has `aria-expanded`.

**Ask First:** Any change to engine numbers, the legacy `Calculation`/`Heir` fields or the proof shape. A migration. A new dependency.

**Never:** Layered (successive-death) tables or the v2 proof (Story 3.1c). Layered cases keep today's display, with `table: null`. Client-side arithmetic for the base or the parts. Changes to the legacy Django templates.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Plain | Fixture "Hanbali wife and son with an estate" | Base column only; prescribed share 1/8 and "residuary"; amount and percentage | N/A |
| 'Awl | "Husband and two sisters need awl" | Base 6, 'awl 7 | N/A |
| Radd | "Hanafi mother and daughter need radd" | Base and radd columns | N/A |
| Radd with a spouse, several radd groups | Engine sets `shortage_calc` | Radd, radd_calc and radd_union columns | N/A |
| Correction | A group whose parts do not divide (e.g. wife, three sons) | That group's base cell is merged; the correction column gives each son's own parts | N/A |
| Blocked heir | Fixture with a blocked heir | Row with "blocked" as the prescribed share and empty cells | N/A |
| Bad table | Unknown column, a total that is not a positive whole number, the first column not `base`, rows unlike `shares`, a broken span, a table on a layered case | Whole preview rejected | Existing failed-preview state |

</frozen-after-approval>

## Code Map

- `calc/models.py:17-47` `_Group` and `column()` (fall back means a merged group total). `:746-800` columns, `put()` and the totals. `:813-840` writes them to the rows. `:909-928` `compute()` sets `self.proof`; set `self.table` the same way (reset at start).
- `calc/proof.py:174` `build` -- add a pure `build_table` beside it (pk-keyed; rows in group order, then blocked heirs).
- `calc/templates/calc/results.html`, `new_results.html` -- legacy layout and column captions to mirror (read-only).
- `api/preview.py:82` `_labelled`, `:102` `_compute` -- translate `calc.table` row heirs to session ids and add `label` per column; `preview()` adds `table` (null for layered).
- `api/contracts/preview-fixtures.json` -- every available response gains `table`. Regenerate the responses with `preview.preview(case)` under `translation.override('en')` using a throwaway script (not committed). `api/tests.py:1294-1352` uses them.
- `web/src/api/case.ts:663-687` types, `:874` `parsePreview` -- add a strict `parseTable`.
- `web/src/interview/preview.ts` `previewRows` (percent, kirat) and `web/src/interview/format.ts` formatters -- reuse.
- `web/src/app/[locale]/results/results-view.tsx:125` `Available`, `:239` `HeirCard` (the proof `<dl>` becomes the side note). `web/src/app/[locale]/interview/share-preview.tsx:70-105` list to replace.
- `web/src/i18n/messages.ts` -- the `results` and `interview` sections.

## Tasks & Acceptance

**Execution:**
- [x] `calc/proof.py`, `calc/models.py` (+ `calc/tests.py`) -- `build_table` and `calc.table`. Test each matrix case, and that totals and cells equal the saved `Calculation`/`Heir` fields.
- [x] `api/preview.py` (+ `api/tests.py`) -- `table` in available previews; labels follow the request language; layered gives `null`.
- [x] `api/contracts/preview-fixtures.json` -- regenerate.
- [x] `web/src/api/case.ts` (+ `case.test.ts`, `web/src/interview/preview.test.ts`) -- types and `parseTable`; rejection table for the matrix's bad shapes.
- [x] `web/src/interview/table.ts` (+ test) -- pure view model: header rows (caption, total), body rows with the prescribed-share text key, cells with `rowSpan`, percent, kirat, amount.
- [x] `web/src/app/[locale]/results/inheritance-table.tsx` -- the shared table with side notes: beside the table at `md` and up, below the row on narrow screens; hover previews, click pins.
- [x] `results-view.tsx`, `share-preview.tsx` -- use it for single-death cases; keep the cards and list for layered ones; results keeps steps and school rules below.
- [x] `web/src/i18n/messages.ts` -- captions (name, relation, prescribed share, base, 'awl, radd, remainder, radd calculation, combined base, correction, percentage, kirat, amount, residuary, blocked) in ar/en/fr.

**Acceptance Criteria:**
- Given an available single-death preview, when the results page or the interview preview renders, then the same table appears with the engine's columns and totals, merged group cells, and percentage, kirat and amount columns.
- Given the table, when the visitor hovers, focuses or clicks a heir row, then that heir's labelled explanation appears as a side note, and Escape closes it.
- Given a layered case, when either page renders, then it looks as before Story 3.1b.

## Verification

**Commands:**
- `python manage.py test calc api` -- expected: all pass
- `cd web && npm test && npm run lint && npm run typecheck && npm run build` -- expected: all pass

**Manual checks:**
- In `next dev` (ar, en, phone width): 'awl, radd, correction and blocked cases on both pages; RTL column order; side note by mouse, keyboard and touch.

## Suggested Review Order

**Engine table**

- Entry point: the language-free table, columns in legacy order, merged group cells.
  [`proof.py:217`](../../calc/proof.py#L217)

- Built inside `distribute()` from the same columns the legacy fields get; numbers unchanged.
  [`models.py:861`](../../calc/models.py#L861)

- A group's fallback to its total is what becomes a merged cell.
  [`models.py:751`](../../calc/models.py#L751)

**Preview API**

- Session ids and legacy column captions in the request language; layered gives null.
  [`preview.py:111`](../../api/preview.py#L111)

**Strict parsing**

- Shape, spans, blocked tied to the proof rule, zero-share residuary allowed.
  [`case.ts:912`](../../web/src/api/case.ts#L912)

- Only column combinations the engine can produce.
  [`case.ts:932`](../../web/src/api/case.ts#L932)

- Last column must reproduce the shares exactly, merged cells as sums.
  [`case.ts:979`](../../web/src/api/case.ts#L979)

**Table and side note**

- Pure view model: prescribed text, cells with rowSpan, percent, kirat, amount.
  [`table.ts:35`](../../web/src/interview/table.ts#L35)

- Side-note state: focus, then hover, then pin; Escape closes; tested as a reducer.
  [`table.ts:97`](../../web/src/interview/table.ts#L97)

- Shared table component; note sits outside the row grid so spans stay true.
  [`inheritance-table.tsx:81`](../../web/src/app/[locale]/results/inheritance-table.tsx#L81)

- One aside beside the table at md, below it on phones.
  [`inheritance-table.tsx:228`](../../web/src/app/[locale]/results/inheritance-table.tsx#L228)

- Results page uses the table for single deaths; layered keeps cards.
  [`results-view.tsx:172`](../../web/src/app/[locale]/results/results-view.tsx#L172)

- Interview preview uses the same table.
  [`share-preview.tsx:110`](../../web/src/app/[locale]/interview/share-preview.tsx#L110)

**Peripherals**

- Captions in ar/en/fr.
  [`messages.ts:201`](../../web/src/i18n/messages.ts#L201)

- Engine table matches the legacy fields and the exact shares across families and schools.
  [`tests.py:2685`](../../calc/tests.py#L2685)

- Labels follow the language; layered has no table.
  [`tests.py:1364`](../../api/tests.py#L1364)

- Rejection table for bad tables.
  [`case.test.ts:599`](../../web/src/api/case.test.ts#L599)

- View-model, merged-cell and side-note tests over the fixtures.
  [`table.test.ts:24`](../../web/src/interview/table.test.ts#L24)
