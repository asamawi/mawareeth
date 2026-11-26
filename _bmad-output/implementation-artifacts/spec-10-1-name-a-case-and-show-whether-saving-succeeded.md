---
title: 'Story 10.1 (part A): Name a Case and show whether saving succeeded'
type: 'feature'
created: '2026-11-26'
status: 'done'
baseline_commit: 'b959b6e7189bec943ae815be6703820a64b2b8c0'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Save on Full results stores a case under a generic default name the user never sees, and it reports every failure, including a conflict, with the same vague error. Users cannot name a case or tell whether it reached My cases.

**Approach:** The first Save of a case opens a naming dialog prefilled with a suggestion; the name travels with the save. Save shows a truthful inline status with Retry, and a conflict gets its own message. Part B (conflict choices) is deferred (owner decision, 2026-11-26).

## Boundaries & Constraints

**Always:**
- Decisions (owner, 2026-11-26): Save lives on Full results only. Only Save asks for a name; Share and WhatsApp save with the default name on a first save and never change an existing name. The name column becomes an unlimited text column (owner, 2026-11-26, revised after review: 400 code points could not hold 100 graphemes); the rule is 100 user-perceived characters (grapheme clusters).
- The dialog appears only when the case has no saved link (a first save). Saving an opened or already saved case does not ask and keeps its name.
- Suggestion: "Estate of the deceased, {date}" in the visitor's Locale, formatted on the server (a deceased has no name). A suggestion over 100 is cut at 100.
- Trim; a blank name becomes the suggestion; duplicates are allowed. Client and server count graphemes the same way. Over 100, or a non-string name, answers 400 `name: too_long` / `invalid` with nothing stored.
- Status line (`role="status"`): "Saving", then "Saved to My cases" only on a 200 or 201 whose answer carries the stored name; "Could not save. Your family is still here. Try again." with Retry on failure; "This case changed elsewhere. Your family is still here." on `saved_case_conflict`, without Retry; school required keeps its message. The family and the typed name survive any failure.
- A signed-out Save goes through the existing sign-in dialog; after sign-in it resumes into the naming dialog for the same case, never with both dialogs open. Cancelling sign-in or naming claims nothing.
- Name dialog: labelled input, `dir="auto"`, live 100-character counter in typography.small, 1px colors.muted boundary meeting 3:1, rounded.lg, at least 44 px; Escape and Cancel return focus to Save; en, ar and fr (ar and fr pending native review; wording drafts).
- Compatibility: `{case_id}` without `name` behaves as today. The migration only changes the column to text.

**Never:** Conflict choices, a force-create or relink operation (part B). Rename (10.2). Autosave (10.5). A Save button in the Interview. Changing an existing name on save.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First save | no link; Save | dialog with suggestion; submit; 201 with name | N/A |
| Edited name | " Mother's estate " | stored "Mother's estate" | N/A |
| Blank | "   " | stored suggestion | N/A |
| Arabic or mixed | 100 graphemes incl. combining marks | accepted; counter 100/100 | N/A |
| Too long | 101 graphemes | client blocks; server 400 too_long | nothing stored |
| Linked case | Save | no dialog; 200; name unchanged | N/A |
| Share first | Share, no link | saved with suggestion; no dialog | N/A |
| Conflict | 409 saved_case_conflict | conflict message; no Saved | inputs kept |
| Failure | 500, 503, network | failure text and Retry; Retry resends | name kept |
| Signed out | Save | sign-in; after it, naming dialog | cancel: nothing claimed |
| Old client | `{case_id}` only | as today | N/A |

</frozen-after-approval>

## Code Map

- `api/models.py:10` -- `SavedCase.name` max_length 100 → 400; new migration after `api/migrations/0006_savedcase_name.py`.
- `api/views.py:391-451` -- `SavedCasesView.post`: create vs update, `saved_case_conflict`, `school_required`; reads no name today. Answer gains `name`.
- `api/snapshots.py:16-27` -- `default_name(created_at)` uses the site language; reuse with the request Locale for the suggestion.
- `api/urls.py:33-39` -- add a GET that returns the suggestion for the current case (session, Accept-Language or locale param).
- `web/src/api/saved-cases.ts:9` -- `saveCase` collapses 409 to null; return a conflict outcome and accept `name`; add the suggestion read.
- `web/src/app/[locale]/results/auth-gate.tsx` and `auth-gate-state.ts` -- `runSave`, `runShare`, resume `?resume=save`, dialog pattern; status line at ~112.
- `web/src/i18n/messages.ts` -- results texts (`save`, `saving`, `saved`, `saveError`, `saveNeedsSchool`).
- `web/src/api/case.ts:543-585` -- `write` helper (CSRF, one attempt).
- Tests: `api/tests.py:3482` `SavedCaseTests`, `api/test_saved_case_upgrade.py`, `api/test_saved_case_unsaved.py`; `web/.../results/auth-gate.test.tsx`, `auth-gate-state.test.ts`, `web/src/api/saved-cases.test.ts`; `web/e2e/api.ts` stubs.

## Tasks & Acceptance

**Execution:**
- [x] `api/models.py`, migration -- widen `name`.
- [x] `api/views.py`, `api/urls.py`, `api/snapshots.py` -- name validation (trim, grapheme count, blank → suggestion, create only), `name` in the answer, Locale-aware suggestion GET.
- [x] `pyproject.toml`, `uv.lock` -- add `regex` for `\X` grapheme counting (Python's `re` has none).
- [x] `web/src/api/saved-cases.ts` -- name, conflict outcome, suggestion read; grapheme count with `Intl.Segmenter`.
- [x] `web/src/app/[locale]/results/` -- naming dialog, status line, Retry, resume into naming.
- [x] `web/src/i18n/messages.ts` -- texts; run the catalog check.
- [x] Tests for every matrix row: Django, web unit, and a Playwright spec for the dialog and statuses in en and ar with axe.

**Acceptance Criteria:**
- Given the dialog in Arabic, when used by keyboard, then focus order, focus return and direction are correct, and axe finds no serious issue in light and dark.
- Given a first save, when it succeeds, then My cases lists the case under the stored name.

## Implementation Notes
- 2026-11-26: implemented by a Sonnet subagent; review pass 1 (codex deep) patched by the same subagent, including the owner's switch to a text column. The test emoji is a 5-code-point family sequence (100 of them = 500), not 7 as first estimated. Final local checks: makemigrations clean; 161 targeted Django tests OK (1 skipped); web 751 unit tests; typecheck, lint (0 errors), i18n clean; Playwright results, cases, accessibility and interview specs 274 of 274 on a fresh build. Full suites are left to PR CI. Story 10.1 stays in progress until part B (deferred-work.md) ships.

## Spec Change Log

## Review Triage Log

Pass 1, 2026-11-26 (one combined codex deep call; layers bh, ec, vg, cs; duplicates share a row).

- `[high]` `[intent_gap]` (bh, ec, vg) 100 graphemes can exceed 400 code points (a family emoji is 7; 100 of them are 700), so PostgreSQL refuses a name the dialog accepts: checked by computation. Owner chose an unlimited text column (2026-11-26); frozen block updated; patched without reverting, since no other code depends on the width.
- `[medium]` `[patch]` (bh, ec) a NUL in the name gives a 500.
- `[medium]` `[patch]` (bh, ec, vg, cs) the save POST sends no Locale, so a blank name gets the browser's language.
- `[medium]` `[patch]` (bh, ec, cs) `errors.name` collapses to a generic failure; Retry repeats it.
- `[low]` `[patch]` (bh, ec, cs) a legal stored `""` reads as failure after a committed write.
- `[medium]` `[patch]` (bh, ec, cs) Retry after a failed unnamed update adds the old name.
- `[medium]` `[patch]` (vg, cs) Save and Share have separate in-flight guards.
- `[low]` `[patch]` (bh, ec) no `Intl.Segmenter` makes the dialog throw.
- `[medium]` `[patch]` (ec, vg, cs) My cases never shows the saved name; the spec AC requires it.
- `[high]` `[patch]` (vg, cs) `restore_check` rejects names over 100 code points, so a backup restore check fails on valid data.
- `[medium]` `[patch]` (vg, cs) the migration test leaves the database at 0006 for later tests.
- `[medium]` `[patch]` (bh, vg) browser success stubs ignore the submitted name.
- `[low]` `[reject]` (bh, cs) a new client against a rolled-back server reads success without `name` as failure: rare, needs a rollback of this release.
- `[low]` `[reject]` (bh, ec, cs) a second tab that names a case after another tab's first save keeps the other name: rare, and part B reworks conflict handling.
- `[low]` `[reject]` (bh, ec) U+0085 trims differently in JS and Python.
- `[low]` `[reject]` (ec, cs) Accept-Language q=0 is not honoured.
- `[low]` `[reject]` (cs) the operations log does not separate `too_long` or list the suggestion route.
- `[low]` `[defer]` (ec, vg, cs) the sign-in resume names an action, not a case, so a case switched during sign-in is saved instead: true before this story too.
- `[low]` `[reject]` (ec, cs) a detail-only 409 for a different working case reads as a generic failure: true before this story too; part B handles conflicts.

## Design Notes

Grapheme counts: server `len(regex.findall(r'\X', name))`; client `[...new Intl.Segmenter(locale, {granularity: 'grapheme'}).segment(name)].length`. Both follow Unicode extended grapheme clusters; add a shared fixture of tricky names (combining marks, ZWJ emoji, Arabic with tashkeel) tested on both sides.

## Verification

**Commands:**
- `uv run python manage.py makemigrations --check --dry-run` -- expected: no changes after the new migration
- `uv run python manage.py test api.tests.SavedCaseTests api.test_saved_case_upgrade api.test_saved_case_unsaved api.test_snapshots --noinput` -- expected: OK
- `cd web && npm test && npm run typecheck && npm run lint && npm run i18n` -- expected: no failures
- `cd web && npm run build && npx playwright test e2e/results.spec.ts e2e/cases.spec.ts e2e/accessibility.spec.ts` (or the spec holding the new tests) -- expected: all pass on the fresh export; full suites run in PR CI (owner, 2026-11-26)
