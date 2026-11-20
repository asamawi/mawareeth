---
title: 'The tree edit sheet explains an invalid relationship at once instead of saving it'
type: 'bugfix'
created: '2026-11-20'
status: 'done'
baseline_revision: 'd5c2491b8157c9890ab6b81b8a3bab102b2c32bb'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred:
  - summary: >-
      A relationship error in the edit sheet (local refusal or server rejection) appears in a plain FieldError paragraph with no live announcement, so a screen reader user whose pick reverts may not hear why.
    evidence: |-
      FieldError (form-bits.tsx:41) is a plain <p>; the sheet's FormError excludes `relationship`. A server-rejected pick before this change was shown the same way, so this is pre-existing for every relationship error in the sheet. Raised by edge-case-hunter and verification-gap.
    location: >-
      web/src/app/[locale]/interview/edit-sheet.tsx:139
    severity: low
---

<intent-contract>

## Intent

**Problem:** In the tree edit sheet (`web/src/app/[locale]/interview/edit-sheet.tsx`), picking a relationship calls `onSave` (a heir PUT) at once, even when the edited row's `edit_options.invalid` already says the server will refuse it (any kinship code such as `husband` for a male deceased, or `gender_locked`). The visitor only learns why after a rejected round trip (deferred item from `spec-deferred-edit-options-respect-locked-gender.md`).

**Approach:** Keep every relationship offered, as the add form does (`heir-form.tsx`: "Every relative stays offered"; `answers.ts` `relationshipIssue`: "advice only"). When the picked relationship has a code in the row's options `invalid` map (`relationshipIssue(options, id)`), the sheet does not call `onSave`; it shows that code's existing relationship error text under the picker, and the picker keeps showing the saved relationship. A pick with no `invalid` code saves exactly as today and clears the local message.

## Boundaries & Constraints

**Always:** The options source is the one the sheet already uses (`layer.heirs[...].edit_options ?? view.case.heir_options`). The code comes from `relationshipIssue` (no fiqh rule in the component). The message text is `errorText(messages, "relationship", {relationship: code})`, the same text a rejected PUT shows today, so a server error and a local one read identically. A server-sent relationship error (`view.errors.relationship`) still shows when no local issue is pending. The local issue is cleared by a valid pick, and by a change of edited person or of `view.case` (same basis pattern as the name `draft`). A frozen sheet does nothing on pick, as today. Blocked (hajb) relationships are not invalid and still save.

**Never:** No new error code, message key, translation, `.po` or `messages.ts` change. Do not hide, disable (`disabled`/`aria-disabled`) or relabel options. Do not change `RelationshipFields`' behaviour for the add form (`heir-form.tsx` callers), `relationshipIssue`, `heirOptionLabels`, `flow.ts`, the API, or `engine/`. No change to the status radios, name field, remove or add-here parts of the sheet.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid pick | row `son`, options `invalid` has no `daughter`; pick `daughter` | `onSave` called once with `relationship: "daughter"`, focus `editRelationship:daughter`; no local message | as today |
| Kinship-invalid pick | male deceased, options `invalid: {husband: "husband_of_male"}`; pick `husband` from the "more" select | `onSave` not called; the relationship error text for that code shows in the picker's error slot; `son` stays checked | none |
| Gender-locked pick | row `son`, options `invalid: {daughter: "gender_locked"}`; pick `daughter` | `onSave` not called; the `gender_locked` text shows | none |
| Invalid pick from the "more" select | a rare relationship with an `invalid` code chosen in the select | `onSave` not called; message shows; select shows the saved value (or empty if the saved one is common) | none |
| Recover | after an invalid pick, pick a valid relationship | message gone; `onSave` called | as today |
| Server error kept | `view.errors.relationship` set, no local issue | that error text shows as today | as today |
| Frozen | `frozen` true; pick an invalid one | nothing saved, no message | none |

</intent-contract>

## Code Map

- `web/src/app/[locale]/interview/edit-sheet.tsx:61` `EditSheet` -- `options` (line ~80), `draft`/`basis` pattern for state that resets on a new `view.case`; `RelationshipFields` call at ~133 with `relationshipError` and `onChange` that calls `onSave` directly -- the only file whose behaviour changes.
- `web/src/app/[locale]/interview/heir-form.tsx:195` `RelationshipFields` -- controlled radios (`checked={value === option.id}`) and the "more" select (`rareValue` from `value`), so keeping `value={person.relationship}` reverts the shown choice; renders `relationshipError` in `heir-relationship-error` (read-only).
- `web/src/interview/answers.ts:169` `relationshipIssue(options, relationship)` -- returns the `invalid` code or null; reuse it (read-only).
- `web/src/app/[locale]/interview/form-bits.tsx:12` `errorText(messages, field, errors)` -- maps a code to text via `messages.fieldErrors.relationship` (read-only).
- `web/src/interview/flow.ts:493-540` `remember`/`blurField` -- the add/full-form equivalent that already flags `invalid` codes; precedent only (read-only).
- `web/src/app/[locale]/interview/edit-sheet.test.tsx:53` -- existing render harness collecting `saves`; add the new tests here.
- `api/contracts/interview.json` `errorCodes.relationship` -- the codes that can appear in `invalid` (read-only; pick test codes from here).

## Tasks & Acceptance

**Execution:**
- `web/src/app/[locale]/interview/edit-sheet.tsx` -- hold a local relationship issue (code + basis case + person id); in the relationship `onChange`, when `relationshipIssue(options, relationship)` is non-null set it and skip `onSave`, else clear it and save as today; pass the local text (or else the server text) as `relationshipError` -- the sheet stops sending PUTs it knows will fail and explains them at once.
- `web/src/app/[locale]/interview/edit-sheet.test.tsx` -- add tests for every row of the I/O matrix (radio and select paths, gender_locked and a kinship code, recover, server error kept, frozen) -- regression guard.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- remove the "tree edit sheet's relationship picker ignores the edited row's `edit_options.invalid`…" entry under "Interview & web UI".

**Acceptance Criteria:**
- Given the existing web tests, when they run, then they pass with no existing assertion edited.
- Given the add form (`heir-form.tsx`) and its tests, when they run, then its relationship behaviour is unchanged.

## Spec Change Log

## Review Triage Log

### 2026-11-20 — Review pass
- verdicts: 14 findings — high 0, medium 0, low 13, false 0, maybe-false 0 (1 intent-alignment report, descriptive)
- findings:
  - `[low]` `[patch]` blind-hunter: local message outranks a later server relationship error for the same case and person (status save rejected with `second_father` keeps the case object) — every sheet save now goes through `save()`, which clears the local issue first.
  - `[low]` `[patch]` blind-hunter: picking the "more" select's placeholder after a refusal keeps the abandoned message — the early return in `onChange` now clears the local issue.
  - `[low]` `[patch]` blind-hunter: no test for the case-replacement reset — added a same-row new-case rerender test.
  - `[low]` `[patch]` blind-hunter: select refusal only tested from a common relationship — added a refusal from saved `brother`, select keeps `brother`.
  - `[low]` `[patch]` blind-hunter: fixtures never have a `blocked` relationship — added a test that a blocked-only pick still saves.
  - `[low]` `[patch]` edge-case-hunter: status save with a relationship error masked by the local message — same root cause and fix as the first row.
  - `[low]` `[patch]` edge-case-hunter: placeholder pick keeps the message — same fix as the second row.
  - `[low]` `[defer]` edge-case-hunter: refusal text is not announced to screen readers — pre-existing: a server-rejected relationship showed in the same non-live FieldError; recorded in `deferred` and deferred-work.md.
  - `[low]` `[patch]` verification-gap: no later-estate refusal exercised through the sheet — added a sheet test with `view.layer` set whose later row's own `gender_locked` options refuse the pick (unit level, not Playwright).
  - `[low]` `[patch]` verification-gap: case-replacement reset untested — same as the third row.
  - `[low]` `[patch]` verification-gap: rare select retention untested — same as the fourth row.
  - `[low]` `[patch]` verification-gap other: local warning masks a later server refusal — same as the first row.
  - `[low]` `[defer]` verification-gap other: no live announcement of the refusal — same as the defer row above.
  - `[low]` `[reject]` intent-alignment: diff gives feedback after an attempted pick, while disable/advance-label/hide readings act before interaction; its test-surface remark is covered by the later-estate test row — the choice follows the add form's existing rule (every relationship stays offered, `invalid` is advice) recorded in Design Notes; changing it would mean editing this build's spec.
  - cross-story-contract: no contract shape changed.

## Design Notes

The deferred entry left open "disable, label or hide". The codebase already chose for the add form: every relationship stays offered and an `invalid` code is flagged as advice, never by hiding or disabling. The edit sheet saves on selection, so its version of "flag" is "flag instead of saving"; the message and code are the ones the rejected PUT already produced, so nothing visible changes except that the round trip and the transient wrong selection disappear.

## Verification

**Commands:**
- `npm --prefix web test` -- expected: all pass.
- `npm --prefix web run typecheck` -- expected: pass.
- `npm --prefix web run lint` -- expected: 0 errors.

## Auto Run Result

Status: done

**Summary:** The tree edit sheet no longer sends a relationship PUT the row's `edit_options.invalid` already refuses (any kinship code or `gender_locked`). The pick is explained at once with the same text the rejected PUT showed, the saved relationship stays shown, and nothing is saved. Valid and blocked-only picks save as before. The local message clears on a valid pick, any other sheet save, a placeholder or same-value pick, a new case revision, or a different person.

**Files changed:**
- `web/src/app/[locale]/interview/edit-sheet.tsx` — local relationship issue from `relationshipIssue`; `save()` wrapper clears it; relationship error slot prefers it.
- `web/src/app/[locale]/interview/edit-sheet.test.tsx` — tests for every matrix row plus case reset, rare select retention, blocked pick, later-estate lock, status save and placeholder clearing.
- `_bmad-output/implementation-artifacts/deferred-work.md` — resolved edit-sheet entry removed; screen reader announcement entry added.

**Review:** one combined codex call (5 layers), 14 rows. Patched 11 low rows (5 root causes: stale local message after other saves, stale message after placeholder pick, three test gaps), deferred 2 low rows (one root cause, pre-existing non-live relationship error), rejected 1 (intent-alignment UX reading, settled by the add form's rule). Follow-up review recommended: false (patched: 0 high, 0 medium, 5 low entries).

**Verification:** `npm --prefix web test` — 618/618 pass. `npm --prefix web run typecheck` — pass. `npm --prefix web run lint` — 0 errors, 12 pre-existing warnings. Playwright not run.

**Residual risks:** The refusal is not announced through a live region (deferred, pre-existing). No browser test covers the refusal end to end; coverage is at the component level.
