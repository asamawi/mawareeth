---
title: "Story 3.1c: Successive deaths in the scholars' table"
type: 'feature'
created: '2026-11-11'
status: 'done'
baseline_commit: 'e856e233d017b18545ec01cb3c182cf095ae0f8d'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-1b-scholars-inheritance-table.md'
  - '{project-root}/web/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Successive-death (manasikhat) cases show only final-share cards and a list, with `proof: null` and `table: null`. Scholars expect the classic side-by-side manasikhat table and each death's explanation.

**Approach:** The engine keeps each death's 3.1b table and combines them in the classic way. For each later death it records the deceased's parts in the running jami'a, the GCD with that death's base, the two multipliers and the new jami'a. It then checks that the final jami'a reproduces the engine's final fractions exactly. The preview API sends the v2 proof and this layered table with session ids and labels. One table component shows it on the results page and in the interview preview, with each death's explanation as row side notes.

## Boundaries & Constraints

**Always:** All arithmetic is on the server, in integers, from each layer's own 3.1b table (its last column, a merged cell split equally among its rows). For each later death: `p` = deceased's parts in the current jami'a `J`, `B` = that death's base, `g = gcd(p, B)`. The old jami'a is multiplied by `B/g` and the new problem by `p/g`, and `J' = J·B/g`. Relation: `tamathul` when B divides p, `tawafuq` when g > 1, otherwise `tabayun`. When p = 0, the death shows "no share" and J stays unchanged. Rows are persons (earliest session row, via `same_as`), in order of first appearance. An "unallocated" row appears only when nonzero. The final jami'a must give each person's `final` fraction and `unallocated` exactly. If it does not, or any layer has no table, the result is `table: null` and an error is logged. The API carries no engine pks. Layer `heir` is the session death's heir, matched by `order` (null for the first death). Text in ar/en/fr. RTL order, numbers in `bdi`, the table scrolls in its own container, side-note behaviour as in 3.1b.

**Ask First:** Any change to engine numbers, the v1 proof or 3.1b single-death output. A migration. A new dependency.

**Never:** Client-side arithmetic. Reducing the final jami'a. Changes to legacy Django templates. Storing the table or v2 proof. Any change to how single-death cases display.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Two deaths | Fixture "Layered two under hanafi" | Problem 1 \| p, multiplier, problem 2 \| jami'a; final column equals `final` | N/A |
| Three deaths | "Layered three under …" | Two combinations, a jami'a after each | N/A |
| Heir in several deaths | Person inherits from death 1 and death 2 | One row, parts summed in the jami'a | N/A |
| Zero estate | Later deceased blocked in an earlier death | "No share" for that death; J unchanged | N/A |
| Blocked in one death only | Blocked in death 1, inherits in death 2 | "Blocked" cell for death 1, parts for death 2 | N/A |
| Unallocated | School that sends a remainder to no heir | Unallocated row carried through each combination | N/A |
| Mismatch | Combination disagrees with `final` | `table: null`, cards as today | Error logged |
| Bad layered table / v2 proof | Unknown key, mismatching totals, order gaps, a row not in `shares`, a pk-looking id | Whole preview rejected | Existing failed-preview state |

</frozen-after-approval>

## Code Map

- `calc/manasikhat.py:93-110` -- layer loop. It keeps `layer.proof` but drops `layer.table` (`:106`). Keep both. Identity resolution is at `:47`.
- `calc/proof.py:217` `build_table` (reuse per layer). `:265` `build_layered` gives v2 `{version, people, madhab, layers[{order, deceased, heir, estate, proof}], final, base}`, keyed by pks. Add a pure `build_layered_table` here.
- `api/preview.py:83` `_labelled`, `:122` `_compute` (single, maps table rows). `:139` `_compute_layered` currently discards the v2 proof and returns `(outcome, None, None)`. `:168` treats empty later layers as `not_ready`. `preview` is at `:175`.
- `api/anonymous_case.py:334` `_layers` and `:358-405` death order (contiguous from 2).
- `api/contracts/preview-fixtures.json:3953-5336` -- 12 layered fixtures. Regenerate them all with a throwaway script, as in 3.1b. Checked by `api/tests.py:1294`, `:1357`, `:1364` (null layered table) and `:1398` (null layered proof). The last two flip.
- `web/src/api/case.ts:617` basis deaths, `:664` `PreviewProof` (v1 only), `:704` `Preview`, `:746` death parsing, `:912-979` `parseTable`. `:1029` `parsePreview` rejects layered responses unless proof and table are null.
- `web/src/interview/table.ts:15` `TableView`, `:78` side-note reducer (keyed by heir only; needs per-person notes grouped by layer and unique column keys across layers).
- `web/src/app/[locale]/results/inheritance-table.tsx:229` header rows. `results-view.tsx:170,231` layered note, cards and layer trees. `interview/share-preview.tsx:79` layered list.
- `web/src/i18n/messages.ts:201,477,746,1018` -- `results.table` type, ar, en, fr.
- Tests: `calc/tests.py:3196-3390` (manasikhat matrix, siblings, zero estate). `api/tests.py:2502,2711,2923`. `web/src/api/case.test.ts:752`, `interview/preview.test.ts:69`, `results.test.ts:59`, `table.test.ts:47`.

## Tasks & Acceptance

**Execution:**
- [x] `calc/manasikhat.py`, `calc/proof.py` (+ `calc/tests.py`) -- keep the layer tables and add `build_layered_table`. Test every matrix row, and check across all layered fixtures and schools that the final column equals `final`.
- [x] `api/preview.py` (+ `api/tests.py`) -- labelled v2 proof and layered table with session ids, `heir` matched by order, and labels in the request language; null on mismatch.
- [x] `api/contracts/preview-fixtures.json` -- regenerate.
- [x] `web/src/api/case.ts` (+ tests) -- strict `parseLayeredProof` and `parseLayeredTable`, with a rejection table.
- [x] `web/src/interview/table.ts` (+ test) -- layered view model: group header per death (deceased, p, multipliers, relation), column labels, totals, jami'a columns, notes per person per layer.
- [x] `inheritance-table.tsx`, `results-view.tsx`, `share-preview.tsx` -- render the layered table on both pages. Results keeps the layer trees.
- [x] `web/src/i18n/messages.ts` -- death N, deceased's share, multiplier, jami'a, no share, unallocated, tamathul/tawafuq/tabayun, in ar/en/fr.

**Acceptance Criteria:**
- Given an available layered preview, when the results page or the interview preview renders, then the manasikhat table shows each death's columns side by side with p, the multipliers and each jami'a, and its last column matches the shares.
- Given a row, when the visitor hovers, focuses or clicks it, then that person's explanation from each death appears, grouped by death, and Escape closes it.
- Given a single-death case, when either page renders, then it is unchanged from 3.1b.

## Design Notes

Per death the columns are those of its 3.1b table (prescribed share through correction). A jami'a column follows each later death. Example: problem 1 has base 4 and the deceased holds p = 1. Problem 2 has base 2, so g = 1, tabayun, ×2 and ×1, and J = 8.

## Verification

**Commands:**
- `python manage.py test calc api` -- expected: all pass
- `cd web && npm test && npm run lint && npm run typecheck && npm run build` -- expected: all pass

**Manual checks:**
- In `next dev` (ar, en, phone width): two- and three-death fixtures on both pages, side notes by mouse, keyboard and touch, RTL order.

## Suggested Review Order

**Engine combination**

- Entry point: classic combination from each death's own table; fails closed to `None`.
  [`proof.py:281`](../../calc/proof.py#L281)

- Each death's parts must match its own proof before combining.
  [`proof.py:326`](../../calc/proof.py#L326)

- p, gcd, the two multipliers and the relation; p = 0 leaves the jami'a unchanged.
  [`proof.py:334`](../../calc/proof.py#L334)

- Final jami'a must give `final` and the unallocated remainder exactly.
  [`proof.py:354`](../../calc/proof.py#L354)

- Layer tables are kept and combined after the layer loop.
  [`manasikhat.py:112`](../../calc/manasikhat.py#L112)

**Preview API**

- v2 proof and layered table with session ids; death heir matched by order.
  [`preview.py:158`](../../api/preview.py#L158)

**Strict parsing**

- v2 proof: exact keys, order sequence, references checked against the basis.
  [`case.ts:1042`](../../web/src/api/case.ts#L1042)

- Layered table: re-checks every multiplier, jami'a and part the server sent.
  [`case.ts:1161`](../../web/src/api/case.ts#L1161)

**Table view**

- Layered view model: per-death column groups, jami'a columns, notes per person.
  [`table.ts:67`](../../web/src/interview/table.ts#L67)

- A merged cell stays merged only when its members remain adjacent and in order.
  [`table.ts:109`](../../web/src/interview/table.ts#L109)

- Death group headers above the column labels.
  [`inheritance-table.tsx:247`](../../web/src/app/[locale]/results/inheritance-table.tsx#L247)

- Per-death prescribed cells, with members named when a group is split.
  [`inheritance-table.tsx:209`](../../web/src/app/[locale]/results/inheritance-table.tsx#L209)

- Both pages use the table whenever the server sends one.
  [`results-view.tsx:155`](../../web/src/app/[locale]/results/results-view.tsx#L155)
  [`share-preview.tsx:110`](../../web/src/app/[locale]/interview/share-preview.tsx#L110)

**Peripherals**

- Death, deceased's share, multiplier, jami'a and relation names in ar/en/fr.
  [`messages.ts:207`](../../web/src/i18n/messages.ts#L207)

- Engine: relations, merged parts, unallocated carry and fail-closed cases.
  [`tests.py:3408`](../../calc/tests.py#L3408)

- API: exact final parts and session ids across all layered fixtures; labels; mismatch.
  [`tests.py:2991`](../../api/tests.py#L2991)

- Parser rejection table for malformed layered data.
  [`case.test.ts:941`](../../web/src/api/case.test.ts#L941)

- View model: exact notes per person, final parts, unique column keys.
  [`table.test.ts:173`](../../web/src/interview/table.test.ts#L173)
