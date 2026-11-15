---
title: 'Blur check on relationship in the heir edit form'
type: 'feature'
created: '2026-11-12'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'a3dd434a3bcd6371abbbbb6387eb27b2b48a1b3d'
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/web/AGENTS.md'
warnings: []
deferred:
  - summary: >-
      No DOM-level or rendered-component test covers the edit-form blur check;
      only pure-function tests verify it.
    evidence: |-
      The edit form's blur check is exercised in flow.test.ts via blurField()
      calls. No test renders the HeirForm component and confirms the error
      element appears in the DOM on blur. This matches the pre-existing gap
      for the add form (already deferred as a Playwright/axe item in
      deferred-work.md).
    severity: low
  - summary: >-
      Death-layer heirs in layered test fixtures all carry empty edit_options
      (noHeirOptions()), so no layered-case test exercises a death-layer heir
      with a meaningful invalid entry.
    evidence: |-
      LAYERED, TWO_LAYERS and related fixtures were updated mechanically to
      add edit_options: noHeirOptions(). A death-layer family with, e.g., a
      second father among the second deceased's heirs would need a fixture
      where that heir's edit_options.invalid contains a real code. The logic
      path is the same as the first layer, but the specific combination is
      not tested.
    severity: low
---

<intent-contract>

## Intent

**Problem:** The heir edit form runs no blur check on the relationship field: `relationshipIssue` returns `null` whenever `editingHeir` is not null, so an impossible relationship (second father, fifth wife, etc.) is only caught on save. The add form checks on blur using the layer's `heir_options`, but those options describe adding to the whole family, which is wrong for an edit because the heir being edited is already counted.

**Approach:** The server adds per-heir `edit_options` to every heir in the response — the same `heir_options` structure but computed without that heir in the family. The client uses these options in `blurField` and `remember` when an edit is in progress, extending the existing blur check to the edit form.

## Boundaries & Constraints

**Always:**
- The frontend holds no fiqh rules; it only reads what the server sends. `edit_options` is computed server-side, never on the client.
- `edit_options` is computed in `get()` / `read_snapshot` / `_decorate` and never stored (stripped in `_save`, matching the treatment of `heir_options`).
- A blocked relative is never flagged by the blur check — only invalid ones. This is unchanged from the add form.
- An unchanged relationship always passes on save (existing constraint). The blur check is advice only; the server decides every write.
- The edit form continues to show plain labels (no blocked-relative labels). Only the blur check is added.

**Block If:** Any schema migration is needed. Any change to fiqh rules (this change only extends delivery, not rules).

**Never:** Applying any client-side fiqh logic. Changing which relationships are blocked or invalid. Changing the save path.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Edit heir, pick impossible relationship | Editing heir "son"; pick "father" when a father already exists (different heir) | `second_father` shown on blur / pick, same as add form | Relationship error appears |
| Edit heir, pick same as existing relationship | Editing heir is the only "grandfather"; pick "grandfather" | No error (it is excluded from counts) | No error |
| Edit heir, change to another impossible relationship | Edit a wife (1 of 4) to wife again | No error (heir excluded, so only 3 wives counted) | No error |
| Edit heir, pick impossible for deceased gender | Male deceased; edit any heir to "husband" | `husband_of_male` on blur | Relationship error appears |
| Add form unchanged | `editingHeir` is null | Existing add-form blur check unchanged | Unchanged |
| Older client or unknown field | Server sends `edit_options`; client ignores unknown fields | Parsed strictly; unknown field dropped as before | Nothing flagged |

</intent-contract>

## Code Map

- `api/anonymous_case.py:214` -- `heir_options(madhab, deceased, heirs)` — computes blocked/invalid for a family; reuse per-heir by passing `heirs` without that heir.
- `api/anonymous_case.py:248` -- `read_snapshot` — builds the case dict; first-layer heirs need `edit_options` added here after `heirs` is computed.
- `api/anonymous_case.py:359` -- `_decorate` — adds `heir_options` and name resolution to death layers; death-layer heirs need `edit_options` added here.
- `api/anonymous_case.py:290` -- `_save` — strips computed fields before storing; must also strip `edit_options` from first-layer and death-layer heirs.
- `api/contracts/interview.json` -- `errorCodes` and heir shape; `edit_options` is a new heir field with the same shape as `heir_options`.
- `web/src/api/case.ts:60` -- `Heir` type; add `edit_options: HeirOptions`. `parseHeirs:217` — parse `edit_options` per heir. `ROW_KEYS:230` — add `edit_options` so death-row parsing does not drop the field.
- `web/src/api/case.ts:286` -- `parseHeirOptions` — existing, reuse to parse `edit_options` on each heir.
- `web/src/interview/answers.ts:171` -- `relationshipIssue` — currently guards `editingHeir !== null`; change signature to `(options: HeirOptions, relationship: string)` and remove the guard. All callers pass the right options.
- `web/src/interview/flow.ts:423` -- `remember` — calls `relationshipIssue` with `view.editingHeir`; replace with `editOptions(view)` helper (see Design Notes).
- `web/src/interview/flow.ts:450` -- `blurField` — same change.
- `web/src/interview/answers.test.ts:439` -- `relationshipIssue` test block; update for new signature and add edit-form case.
- `web/src/api/case.test.ts` -- add heir with `edit_options` to parsing fixtures.
- `web/src/interview/flow.test.ts:783` -- blur tests; add one for edit-form relationship blur.
- `api/tests.py:1562` -- heir-rules test block; add assertion that each heir's `edit_options` equals `heir_options` computed without it.

## Tasks & Acceptance

**Execution:**
- `api/anonymous_case.py` -- In `read_snapshot`, after computing `heirs`, mutate each heir to add `edit_options` via `heir_options(madhab, deceased, heirs[:i] + heirs[i+1:])`. In `_decorate`, do the same for death-layer heirs using `heir_options(case['madhab'], death, ...)`. In `_save`, strip `edit_options` from every first-layer and death-layer heir before storing.
- `api/contracts/interview.json` -- Add `edit_options` to the heir definition (same shape as `heir_options`).
- `web/src/api/case.ts` -- Add `edit_options: HeirOptions` to `Heir`. In `parseHeirs`, parse `edit_options` with `parseHeirOptions`. Add `"edit_options"` to `ROW_KEYS`. In `parseDeaths`, parse `edit_options` on each `row` after the `Heir` object is built.
- `web/src/interview/answers.ts` -- Change `relationshipIssue` signature to `(options: HeirOptions, relationship: string): string | null`; remove the `editingHeir !== null` guard; return `options.invalid[relationship] ?? null` (guarded by `isRelationshipId`).
- `web/src/interview/flow.ts` -- Import `noHeirOptions` from `../api/case.ts`. Add a module-private helper `function editOptions(view: StartedView): HeirOptions` that returns `layerAt(view.case, view.layer).heirs.find(h => h.id === view.editingHeir)?.edit_options ?? layerAt(view.case, view.layer).options`. In `remember`, call `relationshipIssue(editOptions(view), values.relationship ?? "")`. In `blurField`, call `relationshipIssue(editOptions(view), values.relationship ?? "")`.
- `web/src/api/case.test.ts` -- Add a test that `parseCase` with a heir carrying `edit_options` preserves them, and that a malformed `edit_options` reads as `noHeirOptions()`.
- `web/src/interview/answers.test.ts` -- Update the `relationshipIssue` test block: use the new two-argument call. Add a case that passes options with `father: "second_father"` directly (no `editingHeir` guard to test any more). Remove the "edit is left to the server" assertion.
- `web/src/interview/flow.test.ts` -- Add a blur test: view with `editingHeir` set and that heir's `edit_options.invalid` containing the relationship; `blurField` for `"heir" / "relationship"` must set the error code.
- `api/tests.py` -- Add an assertion in the heir-rules section: for each heir in a test family's response, `heir['edit_options']` equals `heir_options(madhab, deceased, [h for h in heirs if h['id'] != heir['id']])`.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- Remove the entry sourced from `spec-1-6-fiqh-aware-validation-hajb-blocking-heirs.md` with summary "Check the relationship on blur in the edit form too, not only on save."

**Acceptance Criteria:**
- Given a family with a father, when the edit form is open for another heir and the visitor selects "father" and blurs the relationship field, then the `second_father` error appears (same as the add form).
- Given the edited heir is the only heir with a relationship, when the visitor selects that same relationship in the edit form and blurs, then no error appears (the heir is excluded from the counts).
- Given `editingHeir` is null (add form), when the visitor blurs the relationship field, then the existing add-form blur check is unchanged.
- Given a direct API write, the server still validates on save regardless of client-side state — this is unchanged.

## Design Notes

**`editOptions` helper in `flow.ts`:** When `editingHeir` is null (add form), return the layer's `options`. When set, look up that heir in the layer's `heirs` array and return its `edit_options`; if not found (stale view), fall back to `noHeirOptions()` so nothing is flagged.

**Why `fallback = layer.options` for null editingHeir:** The add form logic is unchanged — it always used the layer's `options`.

**Why `fallback = noHeirOptions()` when heir not found:** An unfound heir means the view is stale; flagging something based on wrong counts would be misleading. The server will correct it on save.

**`edit_options` for the add form heir:** The `edit_options` on a saved heir only matters during edit. When the add form is open (`editingHeir = null`), the layer's `options` are used, which include all saved heirs — correct for adding a new one.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` in `web/` — expected: all pass.
- `uv run python manage.py test api.tests --noinput` — expected: all pass.

**Manual checks:**
- In the built export: edit a saved heir and select an impossible relationship (e.g. a second father when a father exists); the error should appear on blur, same as the add form. Select the heir's own relationship; no error should appear.

## Spec Change Log

## Review Triage Log

### 2026-11-12 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 2: (high 0, medium 0, low 2)
- reject: 11
- addressed_findings:
  - none

## Auto Run Result

**Summary:** Added per-heir `edit_options` to every heir in the server response (computed without that heir), and updated the client to use it in `blurField` and `remember` when an edit is in progress. The edit form's relationship field now shows fiqh-rule errors on blur — the same as the add form — and the deferred work entry was removed from `deferred-work.md`.

**Files changed:**
- `_bmad-output/implementation-artifacts/deferred-work.md` — removed the resolved blur-check deferred item
- `api/anonymous_case.py` — `read_snapshot` adds `edit_options` per first-layer heir; `_decorate` adds it per death-layer heir; `_save` strips it before storing
- `api/contracts/interview.json` — documented `edit_options` on the heir shape
- `api/tests.py` — added test asserting per-heir `edit_options` equals `heir_options` without that heir, and is not stored
- `web/src/api/case.ts` — `Heir` type gains `edit_options: HeirOptions`; `parseHeirs` and `parseDeaths` parse it; `ROW_KEYS` updated
- `web/src/interview/answers.ts` — `relationshipIssue` signature simplified to `(options, relationship)`; `editingHeir` guard removed
- `web/src/interview/answers.test.ts` — updated for new signature; added edit-form blur assertions
- `web/src/interview/flow.ts` — added `editOptions()` helper; `remember` and `blurField` updated to use it
- `web/src/interview/flow.test.ts` — added blur test for edit form; updated heir fixtures with `edit_options`
- `web/src/api/case.test.ts` — added parsing tests for `edit_options`; updated layered fixtures
- `web/src/interview/layers.test.ts` — updated heir fixtures with `edit_options`
- `web/src/interview/preview.test.ts` — updated heir fixtures with `edit_options`

**Review findings:** 0 patches applied, 2 deferred (low severity — no DOM-level test for edit-form blur; death-layer fixtures use empty `edit_options` only), 11 rejected.

**Follow-up review score:** 0 patches (0 high, 0 medium, 0 low) → score 0 → `false`.

**Verification:**
- `npm run lint` — 0 errors (9 pre-existing warnings, unchanged)
- `npm run typecheck` — passed
- `npm test` — 371/371 passed
- `npm run build` — passed (static export)
- `uv run python manage.py test api.tests --noinput --keepdb` — passed (exit code 0)

**Residual risks:** None. The blur check is advice only; the server decides every save.
