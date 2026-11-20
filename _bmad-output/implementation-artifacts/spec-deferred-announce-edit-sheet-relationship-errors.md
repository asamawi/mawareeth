---
title: 'Announce relationship errors in the tree edit sheet to screen readers'
type: 'bugfix'
created: '2026-11-20'
status: 'done'
baseline_revision: '71fdf3d564b6c76c5fb6ad36ee71dc2df1474005'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred:
  - summary: >-
      No real browser and screen reader run confirms that the edit sheet's relationship alert is spoken on the first refusal and again on an identical retry.
    evidence: |-
      Tests check the DOM in jsdom only: the paragraph has role="alert", keeps its node, and its inner span is replaced on a repeat refusal. Whether NVDA, JAWS, VoiceOver and TalkBack speak a replaced span with identical text is not verified. Settle with a manual check, or a Playwright accessibility-tree check of the alert, on each target.
    location: >-
      web/src/app/[locale]/interview/form-bits.tsx:41
    severity: low (unverified)
---

<intent-contract>

## Intent

**Problem:** In the tree edit sheet, a relationship pick that is refused locally (`relationshipIssue`) or rejected by the server reverts the picker, and the reason appears only in the plain `FieldError` paragraph (`heir-relationship-error`). A screen reader user hears the selection snap back but not why (deferred item from `spec-deferred-edit-sheet-refuses-invalid-relationships.md`).

**Approach:** In the edit sheet only (`RelationshipFields` with `immediate`), make the relationship error slot a live region that stays mounted: `role="alert"` on the always-present paragraph, so a message appearing in it is announced. A repeated identical local refusal is announced again by replacing the text's inner node (a keyed `<span>` driven by a refusal counter in `EditSheet`). Focus does not move: it stays on the control the visitor pressed.

## Boundaries & Constraints

**Always:** The live paragraph is the existing `#heir-relationship-error` element (it stays mounted with its reserved height, keeps its `id`, and stays referenced by the existing `aria-describedby`s), so the visible text and the announced text are one element. Only the sheet path is live: `RelationshipFields` turns it on from its existing `immediate` prop (true only in `edit-sheet.tsx`). `FieldError` without the new option renders exactly as today (no `role`, no inner wrapper change visible to existing tests). Each local refusal increments the counter, including a refusal with the same code as the one shown. Server-sent relationship errors (`view.errors.relationship`) go through the same live slot.

**Never:** No change to the add form's relationship slot (`heir-form.tsx` `HeirForm` → `RelationshipFields` without `immediate`), the deceased form, the name or status `FieldError`s, `FormError`, or `SaveNotice`. No focus move on refusal. No new message key, translation, `.po` or `messages.ts` change. No change to `relationshipIssue`, `flow.ts`, the API or `engine/`. No duplicate visually-hidden copy of the message.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sheet, no error | edit sheet open, no issue | `#heir-relationship-error` present, `role="alert"`, empty text | none |
| Local refusal | options `invalid: {daughter: "gender_locked"}`; pick `daughter` | same element shows the `gender_locked` text; still `role="alert"`; focus unchanged | none |
| Repeated same refusal | pick `daughter` twice in a row | text unchanged, but the text sits in a new inner node after the second pick (the node from the first pick is no longer in the document) | none |
| Server error | `view.errors = {relationship: <code>}`, no local issue | live slot shows that code's text | as today |
| Recover | valid pick after a refusal | slot empty; `onSave` called as today | as today |
| Add form unchanged | `HeirForm` with a relationship error | `#heir-relationship-error` has no `role` attribute; text as today | as today |

</intent-contract>

## Code Map

- `web/src/app/[locale]/interview/form-bits.tsx:41` `FieldError({ id, text })` -- always-mounted `<p className="min-h-6 ...">`; add optional live mode (`role="alert"`) and an optional key for the inner text node. Shared by deceased, heir and edit forms, so the default must render as today.
- `web/src/app/[locale]/interview/heir-form.tsx:195` `RelationshipFields` -- props include `immediate` (edit sheet only) and `relationshipError`; renders `<FieldError id="heir-relationship-error" .../>` at ~line 301. Add an optional prop carrying the announcement key and pass live mode when `immediate`.
- `web/src/app/[locale]/interview/heir-form.tsx:87` -- the add form's `RelationshipFields` call; must not change.
- `web/src/app/[locale]/interview/edit-sheet.tsx:78` -- `issue` state `{ code, basis, id }`; the `onChange` at ~146 sets it on refusal. Add a counter (e.g. `seq`) incremented on every refusal and pass it down; `save()` (~99) clears the issue as today.
- `web/src/app/[locale]/interview/edit-sheet.test.tsx` -- `mount()` harness with `saves`, `draw(view)`; existing refusal tests (around line 213 and the `gender_locked` tests) show how to pick radios and the select. Add tests here.
- `web/src/app/[locale]/interview/heir-form.test.tsx` -- existing `HeirForm` tests; add the "add form unchanged" assertion there.
- `web/src/app/[locale]/interview/heir-list.tsx:135`, `share-preview.tsx:222` -- existing always-mounted live region precedent (read-only).

## Tasks & Acceptance

**Execution:**
- `web/src/app/[locale]/interview/form-bits.tsx` -- `FieldError` gains optional `live?: boolean` and `announce?: number | string`; when `live`, the paragraph has `role="alert"` and its text is wrapped in a `<span key={announce}>` (only when text is non-null); otherwise unchanged -- one element both shows and announces the error.
- `web/src/app/[locale]/interview/heir-form.tsx` -- `RelationshipFields` gains optional `errorAnnounce?: number` and renders its `FieldError` with `live={immediate}` and `announce={errorAnnounce}` -- live only in the sheet.
- `web/src/app/[locale]/interview/edit-sheet.tsx` -- keep a refusal counter that increments on every local refusal, pass it as `errorAnnounce` -- a repeated identical refusal is announced again.
- `web/src/app/[locale]/interview/edit-sheet.test.tsx` and the add-form test file -- tests for every I/O matrix row -- regression guard.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- remove the "Announce relationship errors in the tree edit sheet to screen readers" entry under "Interview & web UI".

**Acceptance Criteria:**
- Given the existing web tests, when they run, then they pass with no existing assertion edited.
- Given `npm --prefix web run typecheck` and `npm --prefix web run lint`, when they run, then they pass with no new warnings.

## Spec Change Log

## Review Triage Log

### 2026-11-20 — Review pass
- verdicts: 13 findings — high 0, medium 0, low 10, false 0, maybe-false 1 (intent-alignment report descriptive; cross-story-contract: no contract shape changed)
- findings:
  - `[low]` `[patch]` blind-hunter: the live-region test re-queries the paragraph after the click, so a remount would pass — the test now captures the paragraph before the click and asserts the same node survives both refusals.
  - `[low]` `[patch]` blind-hunter: the server-error test seeds the error on first render, never observing an update — the test now mounts empty, redraws with `second_father`, and asserts the same alert node shows the text.
  - `[low]` `[patch]` blind-hunter: the repeat refusal is only exercised through a radio — added a test refusing `husband` twice through the "More relatives" select, asserting a new span and the old one disconnected.
  - `[maybe-false]` `[defer]` blind-hunter: span replacement is checked in the DOM, not as a spoken announcement — needs a real screen reader run; if true it would be low, but recorded as deferred (unverified) because the whole item is about what is spoken.
  - `[low]` `[patch]` blind-hunter: the add-form test would pass if the default renderer started wrapping text — it now also asserts `#heir-relationship-error` has no element children.
  - `[low]` `[reject]` blind-hunter: the diff edits the existing Add-relative-here alert selector despite the "no existing assertion edited" criterion — the expected value is unchanged; only the selector excludes the new always-mounted alert, which the intent's design requires; the remaining fix would be editing this build's spec.
  - `[low]` `[reject]` edge-case-hunter: crossing the phone breakpoint with an error visible remounts the alert, which may re-announce — the whole sheet already swaps section/dialog on that change (pre-existing), crossing the breakpoint mid-error is rare, and keeping one node across the swap would add complexity.
  - `[low]` `[reject]` edge-case-hunter: the selector edit contradicts the acceptance criterion — same as the blind-hunter selector row.
  - `[low]` `[patch]` verification-gap: the persistence assertion passes if the paragraph is replaced — same fix as the first row.
  - `[low]` `[patch]` verification-gap: no check that an arriving server rejection reaches the open sheet's alert — patched at component level (redraw test, second row); a Playwright rejected-PUT test was not added because the flow's error plumbing (`start-case.tsx`, `flow.ts`) is unchanged and covered by `flow.test.ts`.
  - `[low]` `[patch]` verification-gap: repeat-refusal coverage only uses the radio — same fix as the third row.
  - intent-alignment: reading "select and implement one deferred item" implemented; the spoken announcement and the browser path are noted as unverified — covered by the deferred row; no action.
  - cross-story-contract: no contract shape changed.

## Design Notes

A persistent `role="alert"` container whose content changes is the pattern `SaveNotice` and `heir-list.tsx` already rely on for status text; reusing the visible error paragraph avoids a second, visually hidden copy that browse mode would read twice. A live region only announces changes, so an identical second refusal would be silent; replacing the inner `<span>` (new key) is an addition under the default `aria-relevant="additions text"` and is announced. Focus stays put because the visitor is mid-choice in a radio group; moving it would break arrow-key navigation through the options.

## Verification

**Commands:**
- `npm --prefix web test` -- expected: all pass.
- `npm --prefix web run typecheck` -- expected: pass.
- `npm --prefix web run lint` -- expected: 0 errors, no new warnings.

## Auto Run Result

Status: done

**Summary:** In the tree edit sheet, the relationship error paragraph (`#heir-relationship-error`) is now an always-mounted `role="alert"` live region, so a local refusal or a server rejection is announced when the picker reverts. Each local refusal bumps a counter that replaces the message's inner `<span>`, so an identical repeated refusal is announced again. Focus stays on the pressed control. The add form's relationship slot and every other `FieldError` render as before.

**Files changed:**
- `web/src/app/[locale]/interview/form-bits.tsx` — `FieldError` takes optional `live` and `announce`; live mode adds `role="alert"` and a keyed inner span.
- `web/src/app/[locale]/interview/heir-form.tsx` — `RelationshipFields` takes optional `errorAnnounce`; live only when `immediate` (edit sheet).
- `web/src/app/[locale]/interview/edit-sheet.tsx` — refusal counter passed as `errorAnnounce`.
- `web/src/app/[locale]/interview/edit-sheet.test.tsx` — tests for the live slot, node persistence, repeat refusal (radio and select), server error arriving after mount; one existing selector scoped past the new alert (expected value unchanged).
- `web/src/app/[locale]/interview/heir-form.test.tsx` — add form's slot is not live and has no wrapper.
- `_bmad-output/implementation-artifacts/deferred-work.md` — resolved entry removed; screen reader check entry added.

**Review:** one combined codex call (5 layers), 13 rows. Patched 7 low rows (4 root causes, all test strength), deferred 1 maybe-false (no real screen reader run), rejected 3 low (selector edit vs criterion ×2, breakpoint remount), plus descriptive intent-alignment and no contract change. Follow-up review recommended: false (patched: 0 high, 0 medium, 4 low entries).

**Verification:** `npm --prefix web test` — 623/623 pass. `npm --prefix web run typecheck` — pass. `npm --prefix web run lint` — 0 errors, 12 pre-existing warnings. Playwright not run.

**Residual risks:** Announcement is verified in jsdom only, not with a real screen reader (deferred). An alert that already holds text when the sheet opens may be announced on mount by some screen readers.
