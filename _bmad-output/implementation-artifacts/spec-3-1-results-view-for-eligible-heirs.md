---
title: 'Story 3.1: Results view for eligible heirs'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: 'b4dc518e00115f044e98ab8637198e4d7ecdf79d'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/web/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent Ã¢â‚¬â€ do not modify unless human renegotiates">

## Intent

**Problem:** The interview shows only a small share preview (fraction, percentage, amount). The engine already returns a labelled proof for every heir, but nothing displays it, and there is no results screen where the user can review the full distribution with its derivation.

**Approach:** Add a static page at `/app/<locale>/results/` that loads the session case and its preview. It shows every heir with fraction, percentage, kirat and amount, an expandable "how this share was derived" section per heir (rule, condition, blocked-by, school rule, grandfather option, prescribed fraction, Quran verse reference), the case-level calculation steps and school rules, and the case's family tree. Every empty or error state links back to the interview. The interview gets a "See full results" link once a preview is available.

## Boundaries & Constraints

**Always:** Numbers and proof come only from the existing preview endpoint (`GET /api/v1/case/preview/`), never computed or overridden in the client beyond formatting. Kirat = share Ãƒâ€” 24, always 2 decimals, rounded half up, computed exactly (BigInt, as in `percentOf`). A result is shown only while its basis matches the loaded case (`reconcile`). Proof labels are shown as the server sent them. All text exists in ar/en/fr. RTL/LTR correct; numbers in `bdi`. WCAG: one heading structure, `aria-expanded` disclosure buttons, keyboard-operable, no focus theft. Successive-death (layered) cases show shares and trees plus one sentence saying the explanation for successive deaths is not available yet.

**Ask First:** Any change to the API, engine, proof shape or preview contract. Adding a dependency (shadcn/ui, React Flow, etc.).

**Never:** Showing provisional or stale numbers. Quran verse text (reference and label only). The layered v2 proof (Story 3.1b). PDF, save, share or certification UI (3.2, Epic 4, Epic 7). Changes to the legacy Django results pages.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Single death, available | Case ready, preview `available` with proof | Heir cards: fraction, %, kirat, amount if estate; blocked heirs say no share plus their blocked-by label; expandable proof; steps and school rules; tree; unallocated part if any | N/A |
| Layered, available | Preview `available`, `proof: null` | Shares and a tree per death; "explanation not available yet" note; no disclosure buttons | N/A |
| No case | `fetchCase` Ã¢â€ â€™ null | Empty state, link to start the interview | N/A |
| Incomplete case | `previewReady` false | Empty state saying the case is incomplete, link back to the interview | N/A |
| Unsupported | Preview `unavailable` | Generic unavailable text plus the reason sentence when known; link back | No numbers |
| Failures | `failed`/`throttled`/`gone`/`replaced`, or `fetchCase` throws | Matching message (reuse preview texts); retry button for failed/replaced/case-load failure; link back | No numbers |
| Kirat | 1/8, 1/7, 2/3 | 3.00, 3.43, 16.00 | N/A |

</frozen-after-approval>

## Code Map

- `api/preview.py:140` `preview()` -- source of `shares`, `unallocated`, `proof` (v1, labelled; `None` for layered). Read-only.
- `web/src/api/case.ts:328` `fetchCase`, `:917` `fetchPreview`, `:630-687` `PreviewProof*` types -- reuse as is.
- `web/src/interview/preview.ts` -- `previewKey`, `previewReady`, `reconcile`, `shown`, `previewRows`, `percentOf`; add `kiratOf` beside `percentOf` and a `kirat` field in `PreviewRow`.
- `web/src/app/[locale]/interview/share-preview.tsx` -- request/reconcile/outcome-to-text pattern and `localFraction`/`localPercent` to reuse (move the two formatters to a shared module).
- `web/src/app/[locale]/interview/family-tree.tsx` -- `FamilyTree` (pass `editingId={null}`); `start-case.tsx:~460` shows how layer gender, `rootText` and heirs are derived via `web/src/interview/layers.ts`.
- `web/src/interview/layers.ts` `rowLabels` -- heir labels across layers.
- `web/src/app/[locale]/interview/page.tsx` -- page shell to mirror (locale check, `noscript`).
- `web/src/i18n/messages.ts` -- typed dictionaries for ar/en/fr; add a `results` section.
- `web/scripts/check-export.mjs:9` -- `pages` list; add `"results"`.

## Tasks & Acceptance

**Execution:**
- [x] `web/src/interview/preview.ts` (+ `preview.test.ts`) -- add exact `kiratOf(numerator, denominator)` and the `kirat` row field; test the matrix values and half-up rounding.
- [x] `web/src/interview/results.ts` (+ `results.test.ts`) -- pure helpers: join each heir's proof entry to its row by heir id, and pick the state to show (empty/incomplete/unavailable/error/available). Test against `api/contracts/preview-fixtures.json`, including layered fixtures.
- [x] `web/src/app/[locale]/results/page.tsx` and `results-view.tsx` -- the page and client component per the matrix; a heading, school name, heir cards with disclosure, steps and school-rule list, trees, back link.
- [x] `web/src/app/[locale]/interview/share-preview.tsx` -- "See full results" link to `/<locale>/results/` when available; use the shared formatters.
- [x] `web/src/i18n/messages.ts` -- `results` texts in ar/en/fr, including proof field captions ("Rule", "Condition", "Verse", ...) and the layered note.
- [x] `web/scripts/check-export.mjs` -- add `results` to `pages`.

**Acceptance Criteria:**
- Given a single-death case with an available preview, when the visitor expands a heir's entry, then they see that heir's rule, any condition, blocked-by, school rule and option labels, the prescribed fraction if any, and the verse reference with its label.
- Given an available preview, when the results page loads, then the case's family tree is drawn with the same component as the interview.
- Given the interview has an available preview, when the visitor follows "See full results", then the results page shows the same shares.
- Given any state without valid numbers, when the page renders, then no share, percentage, kirat or amount is visible and a link leads back to the interview.

## Design Notes

Keep the page a client component that loads once on mount (like `StartCase`'s `load`) and offers retry; no polling. A heir card's disclosure is a `button` with `aria-expanded` and `aria-controls`. Blocked heirs still get a disclosure, because their proof explains the blocking.

## Verification

**Commands:**
- `cd web && npm test` -- expected: all pass, including the new kirat and results tests
- `cd web && npm run lint && npm run typecheck` -- expected: no errors
- `cd web && npm run build` -- expected: export check passes with `results` in every locale

**Manual checks:**
- In `next dev` (ar and en), build a single-death case and a layered case; open results; check the disclosure, RTL layout, keyboard use and the back links.

## Suggested Review Order

**Results page and its states**

- Entry point: loads the session case, then its preview once; retry bumps an attempt.
  [`results-view.tsx:36`](../../web/src/app/[locale]/results/results-view.tsx#L36)

- Pure state choice: no numbers unless the preview matches the loaded case.
  [`results.ts:27`](../../web/src/interview/results.ts#L27)

- Which text and whether Retry appears, per state; kept pure so it is tested.
  [`results.ts:64`](../../web/src/interview/results.ts#L64)

**Shares, kirat and proof**

- Available view: shares, steps, school rules, one tree per death, layered note.
  [`results-view.tsx:125`](../../web/src/app/[locale]/results/results-view.tsx#L125)

- Heir card: share rows, blocked-by label, labelled proof disclosure per heir.
  [`results-view.tsx:239`](../../web/src/app/[locale]/results/results-view.tsx#L239)

- Joins each share row to its proof entry by heir id; layered cases get none.
  [`results.ts:40`](../../web/src/interview/results.ts#L40)

- Exact kirat: share × 24, 2 decimals, half up, BigInt only.
  [`preview.ts:117`](../../web/src/interview/preview.ts#L117)

- Shared locale formatters moved out of the preview, plus kirat digits.
  [`format.ts:19`](../../web/src/interview/format.ts#L19)

**Entry and shell**

- "See full results" link from the interview preview.
  [`share-preview.tsx:109`](../../web/src/app/[locale]/interview/share-preview.tsx#L109)

- Static page shell mirroring the interview page.
  [`page.tsx:7`](../../web/src/app/[locale]/results/page.tsx#L7)

- Tree heading id from useId so several trees can share one page.
  [`family-tree.tsx:35`](../../web/src/app/[locale]/interview/family-tree.tsx#L35)

**Peripherals**

- Results texts in ar/en/fr (Arabic and French not natively reviewed).
  [`messages.ts:427`](../../web/src/i18n/messages.ts#L427)

- Export check now requires the results page in every locale.
  [`check-export.mjs:9`](../../web/scripts/check-export.mjs#L9)

- State, join and presentation tests over the shared fixtures.
  [`results.test.ts:27`](../../web/src/interview/results.test.ts#L27)

- Kirat rounding tests.
  [`preview.test.ts:199`](../../web/src/interview/preview.test.ts#L199)
