---
title: 'Story 9.13: Link a later-estate heir from the edit sheet, and retire the old add form'
type: 'feature'
created: '2026-11-22'
baseline_commit: 'c7c5cbe700937b43c714593c8a191cbb195e0877'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
warnings: ['oversized']
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
  - '{project-root}/web/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** In a later-death estate, the only way to say "this heir is someone already in the Case" is the old "Add an heir" form. That form duplicates the one-press buttons, and its candidate list is worked out in the browser (AD-19 violation). An heir added with the buttons can never be linked afterwards, so the same person is counted twice.

**Approach:** Remove the old form everywhere. Add a server-fed "Same person as…" native select to the edit sheet/panel of later-estate people. Teach `update_heir` to set or clear `same_as` atomically with the same validation as adding.

## Boundaries & Constraints

**Always:**
- Link candidates come only from the server, as a per-row `link_candidates` list of person ids on later-estate rows in the Case response. A person is a candidate when they are in an earlier estate, alive at this death (same rule as `_add_heir`'s `not_alive` check), have the gender of the row's relationship, and are not already represented by another row in this estate. The row's current target, if any, is always included. First-estate rows and `died_before` rows have no list.
- `update_heir`: `same_as` key absent = unchanged; `null` = clear; a string = set. Setting runs the same checks as `_add_heir` (`not_alive`, `already_linked`, `gender_mismatch`, against the relationship in the same command), with the row itself excluded from the "already represented" check. Extract one shared eligibility helper used by add, update and `_decorate`. `same_as` on a first-estate or `died_before` row is refused with `same_as: 'not_allowed'`. Revision handling is the existing `case_commands.execute`: success advances the revision, refusal changes nothing.
- A row that owns a later death or is the `same_as` target of another row cannot be linked: it gets an empty `link_candidates`, and the server refuses with `already_linked`.
- Linking discards the row's own name (the card shows the target's canonical name via `_decorate`), and the `name` in the same command is ignored. Clearing leaves the row as a new person with `name: null`, so it shows its localized default label. Edges on the row are untouched. The snapshot format and `export_snapshot` are unchanged.
- The field sits after the relationship field and saves on change (like relationship). It shows "Nobody else (a new person)" plus each candidate, labelled from `treeDescription` with names in `<bdi dir="auto">`. It uses the shipped native-select styling with a 44px minimum height and a visible label. On the phone sheet and the desktop panel it is reachable by Tab. Errors go through the existing `FieldError`/`FormError` + focus-restore path. Success makes one announcement through the shared status region, and the change is one Undo entry (existing `recorded` snapshot).
- Add relatives shows only the relationship-button groups and count stepper, in every estate. Rare relationships, groups, open-estate scope and "Add relative here" stay on the buttons.

**Never:** No browser kinship or candidate inference. Keep `layers.ts` `linkCandidates` only if a still-live caller needs it; otherwise delete it. No new web font, no new component library, no migration, no snapshot change. Don't touch `RelationshipFields` behavior beyond what removing the wrapper requires. Don't link during add (the add path's `same_as` server support stays for derived additions in `add_death`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Set link | later-estate row, candidate P, current revision | row `same_as`=P, name shows P's, revision+1, one announcement, Undo restores unlinked | N/A |
| Clear link | linked row, `same_as: null` | row unlinked, `name` null, default label | N/A |
| Re-target | linked to P, choose Q | linked to Q | N/A |
| Refusals | P died before this death / P already in estate / wrong gender | Case unchanged, error at the field | `not_alive` / `already_linked` / `gender_mismatch` |
| First estate | `same_as` on a first-estate or died-before row | Case unchanged | `same_as: not_allowed`, field never rendered |
| Row is referenced | row owns a death or is a link target | no field (empty list); direct API call refused | `already_linked` |
| Stale / offline | old `expected_revision`, or offline | nothing changes; existing conflict refresh / offline disable | existing handling, no success claim |

</frozen-after-approval>

## Code Map

Web paths: components under `web/src/app/[locale]/interview/`, the rest under `web/src/`.
- `heir-form.tsx:43` `HeirForm` -- the old add wrapper (draft, link radios/select, name, submit). Delete it. Keep `RelationshipFields` (`:195`), which `EditSheet` uses; move it to its own file if `heir-form.tsx` would hold nothing else. The `heirLinkedHint` markup at `:164` goes.
- `start-case.tsx:339,375,690-702` -- `showHeirForm`, the browser candidate options, the mount. Remove them. `:769` dispatches `saveHeir`; `:452,476,508` announce edits.
- `interview/layers.ts:89` `linkCandidates`, `:121` `rowLabels` -- browser inference. Remove `linkCandidates` and any helper left without callers.
- `interview/answers.ts:22,129,377` -- `HeirValues.same_as`, `LINK_PENDING`, `linkChoice`, and the `validateHeir` pending-link branch. Remove the form-only parts.
- `interview/flow.ts:289,353,358,407,1022` -- form keys, parked drafts, legacy submit reset: remove the form-only state. `:851` `saveHeir` builds `{relationship, name, status?}`: add optional `same_as`. `:1169,866` Undo, `:1240` error/focus. `precheck:689` and `send:833` serve one-press adds; keep them.
- `api/case.ts:293,303` -- live-response parser allowlist: add `link_candidates`. `:650,704,773` `updateHeir` PUT `/api/v1/case/heirs/{id}/`: send `same_as` when present; `HeirFields.same_as` becomes `string | null`.
- `edit-sheet.tsx:69,111,138,153,164,193` -- `EditSheet`. Insert the select after `RelationshipFields` (`:153`) when the row has a non-empty `link_candidates`. Save on change through `save`/`onSave`.
- `interview/tree.ts:190,261` `estateModel`/`treeDescription`; `family-tree.tsx:72,115`; `heir-list.tsx:134,148` -- the card and row already show the server-resolved name as `secondary`. Reuse `treeDescription` for option labels. Show the "linked" hint (moved `heirLinkedHint` text) on card/row only if a linked row lacks it today.
- `i18n/messages.ts:423,485,757,819,1092,1154` (ar/en/fr) -- delete the wrapper-only keys: `heirAddHeading`, `heirAdd`, `heirSave`, `heirCancel`, `heirNameHint`, `heirLinkLegend`, `heirLinkNew`, `heirLinkExisting`, `heirLinkPickLabel`, `heirLinkPickPlaceholder`, `heirLinkRequired`. Keep each one that still has a caller after the change (grep). Add "Same person as…", "Nobody else (a new person)", a link/unlink announcement, and `errors.same_as.not_allowed` in all three locales. Keep `errors.same_as`, `heirNameLabel`, `heirEditHeading`.
- `api/anonymous_case.py` -- `_add_heir:782` link checks: extract the eligibility helper. `update_heir:~862-920` add `same_as` handling. Note it writes the name to the canonical person (`rows.get(person,row)['name']`): skip that when the link changes. `_decorate:513` adds `link_candidates`. `_layers:486` decides first vs later estate (key `None` = first). `_remove_rows:717` already promotes aliases; do not change it.
- `api/views.py:260` `edit_heir` -- pass `same_as` through (absent vs null must survive).
- Tests: `api/tests.py:2816,2925,3010,3224` (add refusals, alias, linked rename) and `api/test_case_commands.py:78,87,140` (accepted/stale/invalid edits): add update-link tests beside them. `heir-form.test.tsx:81` gets retired; move the `RelationshipFields` cases into `edit-sheet.test.tsx` (`:286,417` are similar). `web/e2e/interview.spec.ts:596` has an old-form absence assertion that stays valid. One-press coverage is at `:350,370`. Fixtures are in `web/e2e/family.ts`, case stubs in `web/e2e/api.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `api/anonymous_case.py` + `api/views.py` -- shared eligibility helper; `update_heir` set/clear/refuse per Boundaries; `link_candidates` in `_decorate`.
- [x] `api/tests.py`, `api/test_case_commands.py` -- set, clear, re-target, each refusal (`not_alive`, `already_linked` incl. referenced row, `gender_mismatch`, `not_allowed` first-estate and died-before), stale revision unchanged, `link_candidates` contents (excludes represented/dead/wrong gender, includes current target, absent in first estate), snapshot export unchanged.
- [x] `web/src/api/case.ts` -- parse `link_candidates`; send `same_as`.
- [x] `heir-form.tsx`, `start-case.tsx`, `interview/layers.ts`, `interview/answers.ts`, `interview/flow.ts` -- remove the old form and its state; `saveHeir` carries `same_as`.
- [x] `edit-sheet.tsx` -- the "Same person as…" select.
- [x] `i18n/messages.ts` -- remove unused keys, add new ones (ar/en/fr).
- [x] `heir-form.test.tsx` → fold into `edit-sheet.test.tsx`; add select tests: absent first estate/no candidates, labels with bdi, change sends `same_as`/null, refusal shows field error.
- [x] `web/e2e/interview.spec.ts` -- "Story 9.13" describe: old form absent in first and later estate; link then unlink on phone sheet and desktop panel; card/Heirs row show linked name; Undo restores; refusal stub shows field error; Tab reaches the field; ar RTL mirroring; 320px reflow. `web/e2e/accessibility.spec.ts` -- axe with the field open (en, ar).

**Acceptance Criteria:**
- Given any estate, when Add relatives renders, then no old form controls exist and every relationship, group and "Add relative here" still adds.
- Given a later-estate person with candidates, when their edit sheet opens, then the select follows the relationship field with "Nobody else" plus server candidates. Choosing one updates card, Heirs row and Share preview on the accepted revision, announces once, and Undo restores the prior link state.
- Given a refused, stale or offline link edit, then nothing changes and the reason shows at the field.
- Given unit, Python, lint, typecheck, build and the interview/accessibility/csp Playwright specs, when they run, then all pass.

## Implementation Notes

- Implemented by a Sonnet subagent. `RelationshipFields` moved to `relationship-fields.tsx`, and its tests moved to `relationship-fields.test.tsx` instead of `edit-sheet.test.tsx`. Option labels use U+2068/U+2069 isolates because `<option>` holds text only. `api/views.py` needed no change. `api/contracts/interview.json` documents `link_candidates` and `same_as: not_allowed`.
- Deviation: the legacy add-path draft machinery in `flow.ts` (`heirFormKey`, `resetHeirForm`, `restoreHeirForm`, parked drafts) was kept because edit-sheet close/restore still runs through it. Deferred (see deferred-work.md).
- Playwright runs on this machine were flaky with ENOSPC (C: had about 60 MB free). Failed tests passed on rerun.

## Spec Change Log

## Review Triage Log

Review: one combined codex call (deep tier), covering blind-hunter, edge-case-hunter, verification-gap and cross-story-contract.

| # | Layer | Finding | Verdict | Evidence / route |
|---|-------|---------|---------|------------------|
| 1 | blind, edge, vgap, contract | Unlinking a reopened v2 alias (`wife~2`) promotes an id the engine rejects | high | `snapshots.py:127` builds `{id}~{order}`; `values.py` `ID_RE` excludes `~`. Patch |
| 2 | blind, edge | Linking a row that is a lineage-edge endpoint drops its edges on read | high | `_read_edges` keeps only endpoints in `{_person(row)}` (`anonymous_case.py:389`); the linked row's own id leaves that set. Patch: treat edge endpoints as referenced |
| 3 | blind, edge | Re-sending the current link without a name clears the canonical name | low | Pre-existing `update_heir` semantics (an absent name means None for every edit); the browser always sends the name. Rejected |
| 4 | blind | `link_candidates` persisted in session storage | low | The writer pops `edit_options` but not `link_candidates`. The warning claim is false (only the v1 path logs), but derived data is stored. Direct deletion. Patch |
| 5 | blind | `_link_issue` rebuilds positions and `_layers` for each candidate check | medium | Roughly 50×150×150 dict ops per decorate at capacity, against a 1 s preview budget. Patch: compute once |
| 6 | blind | Duplicate labels in a third estate ("Son 1" in two estates) | low | Needs two later deaths plus unnamed same-label people; the fix adds disambiguation logic. Rejected |
| 7 | blind | A pending rename is lost when the user then picks a link option | low | By design, a link change ignores the name (frozen Boundaries); rare sequence. Rejected |
| 8 | blind | A 101-character draft name blocks a link | low | Rare; the fix adds a branch. Rejected |
| 9 | blind | Unlink plus a gender change in one write gets `gender_locked` | low | The UI never combines them (the select saves alone). Rejected |
| 10 | blind | Link-field refusal not announced live | medium | `FieldError` defaults to non-live (`form-bits.tsx:46`); the relationship field passes `live={immediate}` (`relationship-fields.tsx:117`). Patch |
| 11 | edge | A conflict that changes the layer focuses `"relationship"`, which no longer exists with the sheet closed | medium | `flow.ts:1124`, and the `openLayer` default `"relationship"` (`flow.ts:398`); the old form's control is gone. Patch: `"treeHeading"` |
| 12 | edge | Form-only draft state kept in `flow.ts` | low | Real deviation; the state is entangled with the edit-sheet close/restore paths (17 call sites). Deferred |
| 13 | edge | Offline link attempt gives no explanation at the field | false | Existing `frozen` handling applies to every edit-sheet field, as the spec requires ("existing offline disable") |
| 14 | edge | Stale link edit shows no field-level conflict note | false | Existing conflict refresh (`startEditHeir` conflict=true) applies, as the spec requires |
| 15 | vgap | v2 reopen + unlink not tested | high | Same root cause as #1. Patch adds the test |
| 16 | vgap | Link e2e cannot detect a stale Share preview | medium | Stub preview stays `not_ready`; AC requires the preview on the accepted revision. Patch |
| 17 | vgap | Undo e2e does not check the restore request | medium | Stubbed 201 with a synthetic snapshot; the AC needs the prior link state restored. Patch: assert the restore body's `same_as` |
| 18 | contract | An already-open old tab rejects rows with the new key and drops later heirs | medium | Strict `ROW_KEYS` in the old bundle; a deploy-skew pattern shared by every additive field. Deferred |
| 19 | contract | Many response envelopes lack decorated-row browser fixtures | low | Every path goes through the one `parseCase`, which is tested with the key. Rejected |

## Design Notes

**Why `not_allowed` and not a silent ignore on the first estate:** a crafted request must not quietly become a no-op success that claims a link. `not_allowed` already exists as a field code (`anchor`), so `form-bits.tsx` only needs a `same_as` message for it.

**Name on link/clear:** the stored row name is overwritten by `_decorate` while linked, so keeping a hidden private name would resurface unpredictably on clear. Clearing to `null` gives the numbered default, the same as a fresh one-press add.

## Verification

**Commands:**
- `uv run python manage.py test api.tests api.test_case_commands --noinput` (Postgres 18 via pg_ctl) -- expected: all pass.
- `cd web && npm test` -- expected: all pass.
- `cd web && npm run lint && npm run typecheck` -- expected: 0 errors; at most 12 lint warnings.
- `cd web && npm run build && npx playwright test e2e/interview.spec.ts e2e/accessibility.spec.ts e2e/csp.spec.ts` -- expected: all pass.
