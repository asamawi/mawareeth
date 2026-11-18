---
title: 'Add-heir picker: common heirs one tap away'
type: 'feature'
created: '2026-11-13'
status: 'done'
baseline_revision: '4737904b528f934836b96066697ba3f7f2435e38'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The Next.js interview's heir form asks for the relationship through one native select of 23 relatives, which the project owner finds unintuitive (deferred-work.md, "Product scope / future epics", order 4 of 6).

**Approach:** Replace the select with a picker: a radio group of the common heirs (the spouse who fits the deceased, son, daughter, father, mother) as large tap targets, and a "More relatives" button that reveals a native select with every other relationship.

## Boundaries & Constraints

**Always:**
- Common group, in this order: the spouse (`wife` when the deceased in the active layer is male, `husband` when female), `son`, `daughter`, `father`, `mother`. The other 18 ids, including the other spouse, stay in the "More relatives" select in `RELATIONSHIP_IDS` order, so every relationship remains offered and the server keeps validating as today.
- Labels come from `heirOptionLabels` unchanged: in the add form a blocked relative shows the `heirRelationshipBlocked` label in both the radio group and the select; the edit form shows plain labels.
- The "More relatives" reveal is one-way (no collapse). It starts open when the form's current relationship is not in the common group (editing such an heir, or a remembered draft). Opening it moves focus to the select.
- The form still submits the same `HeirValues`; `onChange(values, "relationship")` fires on every pick; `onBlur("relationship", values)` fires when focus leaves the whole picker (radio group + select), not when moving between radios.
- `data-focus="relationship"` lands on a sensible control: the checked radio, else the select when a rare relationship is chosen, else the first radio — so flow.ts focus requests and first-invalid focus keep working.
- Accessible: a `fieldset`/`legend` (`heirRelationshipLabel`) wraps the group, radios share one `name`, the error stays in `heir-relationship-error` and is referenced via `aria-describedby`; the reveal button has `aria-expanded`/`aria-controls`; tap targets are at least 44px (`min-h-11`); works in RTL and while `saving` (picks ignored, as today).
- New text in ar/en/fr in `web/src/i18n/messages.ts` (and its `Messages` type), recorded for native review in deferred-work.md.

**Block If:**
- Any server, API or `api/` Python change appears necessary.

**Never:**
- No change to the link ("someone already in this case") or name fields, `flow.ts`, `answers.ts` logic, or the server.
- No new npm dependency, no custom combobox/listbox widget.
- Don't remove any relationship from what can be chosen.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Add common heir | Male deceased, blank form; tap "Son" | `son` radio checked, `onChange` with relationship `son`; submit sends `son` | No error expected |
| Spouse fits deceased | Female deceased | Common group shows Husband, not Wife; Wife is in "More relatives" | No error expected |
| Rare heir | Tap "More relatives", choose "Full brother" | Select shown and focused; relationship `brother`; no radio checked | No error expected |
| Edit rare heir | Editing an heir whose relationship is `uncle` | Select already shown with `uncle` selected | No error expected |
| Switch back | Rare chosen, then tap "Mother" | Relationship `mother`, select shows its placeholder | No error expected |
| Blocked relative | Add form, server lists `brother` blocked | Its option carries the blocked label | No error expected |
| Missing relationship | Submit with none chosen | Existing `relationship` required error shows and focus goes to the first radio | Existing error path |

</intent-contract>

## Code Map

- `web/src/app/[locale]/interview/heir-form.tsx` -- the form; lines ~86-111 hold the relationship `<select id="heir-relationship">` to replace. `offered` (line 66) already gives `{id,label,blocked}` per relationship.
- `web/src/app/[locale]/interview/start-case.tsx:474-500` -- renders `HeirForm`; the active layer's deceased gender is `layer?.gender ?? started.case.deceased.gender` (already used at line 468) — pass it as a new required `deceasedGender: Gender` prop.
- `web/src/app/[locale]/interview/start-case.tsx:205-211` -- focus moves via `querySelector('[data-focus="…"]')`; target `relationship` must exist in the DOM.
- `web/src/interview/answers.ts:34,180-190` -- `HEIR_FOCUS_ORDER` and `heirOptionLabels` (read-only; reuse).
- `web/src/api/case.ts:13-49` -- `RELATIONSHIP_IDS`, `RelationshipId`, `Gender`.
- `web/src/i18n/messages.ts:60-75` (type), ~311, ~619, ~927 -- heir form strings per language.
- `web/src/app/[locale]/interview/form-bits.tsx` -- `inputClass`, `buttonClass`, `FieldError`, `errorText`.
- `web/src/app/[locale]/auth-form.test.tsx` + `web/src/test/dom.ts` -- pattern for component tests (`installDom`, `createRoot`, `act`).
- `_bmad-output/implementation-artifacts/deferred-work.md:304-306` -- the item this resolves.

## Tasks & Acceptance

**Execution:**
- `web/src/i18n/messages.ts` -- add `heirMoreRelatives` (button: en "More relatives", ar "أقارب آخرون", fr "Autres parents") and `heirMoreRelativesLabel` (select label: en "Other relationship", ar "صلة قرابة أخرى", fr "Autre lien de parenté") to the type and all three languages -- picker text.
- `web/src/app/[locale]/interview/heir-form.tsx` -- add `deceasedGender` prop; replace the select with the radio group + one-way "More relatives" reveal + select as constrained above; keep everything else -- the change itself.
- `web/src/app/[locale]/interview/start-case.tsx` -- pass `deceasedGender` -- spouse choice per layer.
- `web/src/app/[locale]/interview/heir-form.test.tsx` -- new component tests covering every I/O matrix row plus: blur fires once when leaving the picker, not between radios; `data-focus="relationship"` target rules; picks ignored while `saving`; Arabic renders -- regression guard.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- remove the order-4 entry; add a native-review entry for the two new strings in ar/en/fr -- backlog upkeep.

**Acceptance Criteria:**
- Given the heirs screen of any layer, when the add form shows, then the five common heirs appear as radios without opening anything, and the other 18 relationships are reachable through "More relatives".
- Given a keyboard-only visitor, when they Tab into the picker, then arrow keys move between the common radios, Tab reaches the "More relatives" button, and Enter on it reveals and focuses the select.

## Spec Change Log

## Review Triage Log

### 2026-11-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3 (high 0, medium 1, low 2)
- defer: 0
- reject: 19 (high 0, medium 1, low 18)
- addressed_findings:
  - `[medium]` `[patch]` The picker dropped the old select's required and invalid semantics: the common radios now sit in a `role="radiogroup"` labelled by the legend with `aria-required`, `aria-invalid` and `aria-describedby` (the invalid flag was removed from each radio); the component test asserts them.
  - `[low]` `[patch]` The "More relatives" select was not linked to the relationship error: added `aria-describedby="heir-relationship-error"`.
  - `[low]` `[patch]` French "Autres parents" can read as "other parents": changed to "Autres proches" in `messages.ts` and in the deferred native-review entry.

## Design Notes

Radios with visible inputs inside bordered labels (`has-[:checked]` highlight) keep native semantics and arrow-key navigation without a custom widget. Picker blur: put `onBlur` on the wrapper and fire only when `event.relatedTarget` is outside it.

## Verification

**Commands:**
- `cd web && npm test` -- expected: all tests pass, including the new heir-form tests
- `cd web && npm run lint && npm run typecheck` -- expected: no errors
- `cd web && npm run build` -- expected: succeeds

## Auto Run Result

Status: done

**Summary:** The Next.js interview's heir form now asks for the relationship with a radio group of the five common heirs (the spouse who fits the active layer's deceased, son, daughter, father, mother) as 44px tap targets, plus a one-way "More relatives" button that reveals and focuses a native select of the other 18 relationships. Blocked-relative labels, focus requests, blur validation, saving lock and the submitted values work as before.

**Files changed:**
- `web/src/app/[locale]/interview/heir-form.tsx` -- radio group + "More relatives" select replace the 23-option select; new `deceasedGender` prop.
- `web/src/app/[locale]/interview/start-case.tsx` -- passes the active layer's deceased gender.
- `web/src/i18n/messages.ts` -- `heirMoreRelatives` and `heirMoreRelativesLabel` in ar/en/fr.
- `web/src/app/[locale]/interview/heir-form.test.tsx` -- 12 new component tests covering every I/O matrix row.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- order-4 item removed; native review of the new strings added.

**Review findings:** 3 patches applied (1 medium, 2 low), 0 deferred, 19 rejected (form remounts per heir via `heirFormKey`; `heirOptionLabels` always returns every relationship id; a layer's `gender` is its own deceased's; window-blur validation matches the old select; the rest were style or speculative).

**Follow-up review recommended:** true -- patched counts high 0, medium 1, low 2; score 3x1 + 1x2 = 5.

**Verification:** `npm test` 461/461 pass; `npm run typecheck` clean; `npm run lint` 0 errors (10 pre-existing warnings); `npm run build` succeeds. Re-run after the review patches.

**Residual risks:** Not checked in a real browser: layout, the `has-[:checked]` highlight, RTL at 320px, and Safari click-focus behaviour. No test mounts `StartCase`, so the layer-gender wiring is covered only by type checking and code reading. The two new strings need native ar/fr review (recorded in deferred-work.md).
