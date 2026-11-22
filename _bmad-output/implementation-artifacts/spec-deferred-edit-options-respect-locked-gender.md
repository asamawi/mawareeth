---
title: 'Case API edit options do not offer a gender-locked person a relationship of the other gender'
type: 'bugfix'
created: '2026-11-20'
status: 'done'
baseline_revision: '7fd3c7645465b778e140c4a9fcef81a88ff42434'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred:
  - summary: >-
      The tree edit sheet's relationship picker ignores edit_options.invalid and saves on selection, so an invalid relationship (including gender_locked) is explained only after the rejecting PUT.
    evidence: |-
      Pre-existing for every kinship code: edit-sheet.tsx RelationshipFields onChange calls onSave directly and heirOptionLabels reads only `blocked`. Raised by edge-case-hunter, verification-gap, intent-alignment and cross-story-contract. Recorded in deferred-work.md (Interview & web UI).
    location: >-
      web/src/app/[locale]/interview/edit-sheet.tsx:133
    severity: low
---

<intent-contract>

## Intent

**Problem:** The case API's per-heir `edit_options` (`api/anonymous_case.py`, root and later-estate heirs) is computed from relationship counts only, so for a gender-locked person (a person linked into another row, or named as a later deceased) it lists relationships of the other gender as allowed, which the heir PUT then rejects with `relationship: gender_locked` (deferred item from `spec-deferred-queries-respect-replaced-person-gender.md`). The web parser also throws away the whole options object if it ever sees `gender_locked`.

**Approach:** Reuse the write path's lock predicate when decorating heir rows: for a locked person, every relationship whose `RELATIONSHIPS` gender differs from the row's gender is reported in `edit_options.invalid` as `gender_locked` (taking precedence over any kinship code, as the PUT checks the lock first) and removed from `blocked`. The web's `parseHeirOptions` accepts `gender_locked` as an `invalid` code so the existing error text shows.

## Boundaries & Constraints

**Always:** The HTTP shape stays `{"blocked": [...], "invalid": {relationship: code}}`, `blocked` and `invalid` disjoint. The lock predicate is the one `update_heir` uses (one shared helper, not a copy): same identity resolution (`same_as` or row id), same "other row resolves to this identity, or a later death names it as `heir_id`" rule, same gender source (the row's normalized `gender`). Unlocked heirs and the case-level `heir_options` (add path) keep exactly today's options. `gender_locked` precedence over kinship codes matches the PUT. Options remain derived on read and are never persisted. Reuse the existing `gender_locked` contract code and its ar/en/fr text.

**Never:** No new error code, catalog key, translation, `.po` or `messages.ts` text change. Do not change the PUT/write validation, `engine/`, `api/heir_rules.py` `blocked_relationships`'s signature semantics for existing callers, `died_before` records (they carry no `edit_options`), placement options, or `api/contracts/heir-options-fixtures.json`. Do not change the edit sheet's or form's UI components; they already render `invalid` codes through `errorText`/`relationshipIssue`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unlocked root heir | root `son`, not linked, not a later deceased | `edit_options` identical to today (`daughter` not `gender_locked`; root sonÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢daughter PUT still succeeds) | No error expected |
| Linked root person | root `son` S linked as `same_as` into a later estate | root row's `edit_options.invalid['daughter'] == 'gender_locked'`, every female relationship likewise; none of them in `blocked`; male relationships keep today's codes | No error expected |
| Later alias row | the later-estate row with `same_as` = S | its `edit_options.invalid` marks every female relationship `gender_locked` | No error expected |
| Later deceased | root `daughter` D marked as died later (`heir_id` = D) | D's root row: every male relationship `gender_locked` | No error expected |
| Precedence | locked male person, a female relationship that also has a kinship code (e.g. `wife` with a male deceased) | code is `gender_locked` | No error expected |
| Agreement with write | for a locked row, PUT each relationship its `edit_options.invalid` marks `gender_locked` | each PUT answers 400 with `relationship: gender_locked`; a relationship not marked `gender_locked` does not fail with `gender_locked` | as today |
| Web parser | `parseHeirOptions({blocked: [], invalid: {son: 'gender_locked'}})` | returns `{blocked: [], invalid: {son: 'gender_locked'}}`; any other unknown code still yields no options | strict as today |

</intent-contract>

## Code Map

- `api/anonymous_case.py:263` `read_snapshot()` -- computes root heirs' `edit_options` before later deaths are read; the lock is only knowable after links and deaths are known, so decorate (or re-decorate) root rows after `_read_deaths()`.
- `api/anonymous_case.py:359` `heir_options()` -- returns `{"blocked", "invalid"}` from counts via `api.heir_rules`; give it an optional locked-gender parameter that adds `gender_locked` for opposite-gender relationships and drops them from `blocked`.
- `api/anonymous_case.py:425` `_read_deaths()` / `:495` `_decorate()` -- computes later-estate rows' options (including `same_as` rows); pass the lock here too.
- `api/anonymous_case.py:546` -- options stripped before persistence (read-only; must stay so).
- `api/anonymous_case.py:211` `_person(row)`, `:846`/`:869` `update_heir()` lock check -- extract the "is this identity locked" predicate into a helper used by both the write and the decorator; write behavior unchanged.
- `api/anonymous_case.py` `RELATIONSHIPS` -- relationship ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ gender map the write compares against.
- `api/views.py:257` heir PUT; `api/snapshots.py:145` schema-2 decode ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ `read_snapshot()` (saved-case open gets the fix for free); `api/case_commands.py:148` reuses the same case path (read-only).
- `api/contracts/interview.json:30` -- `gender_locked` already in `errorCodes.relationship` (read-only).
- `web/src/api/case.ts:350` `parseHeirOptions()` -- accept `gender_locked` alongside `KINSHIP_CODES` in `invalid`.
- `web/src/interview/answers.test.ts:479` -- currently asserts `gender_locked` is discarded; flip to assert it is kept, and keep the `KINSHIP_CODES`-vs-contract assertion as is.
- `web/src/interview/flow.ts:482-534`, `web/src/app/[locale]/interview/edit-sheet.tsx` `RelationshipFields` -- consume `edit_options.invalid` via `relationshipIssue`/`errorText` (read-only; `messages.ts:827` already has the text).
- Tests to reuse: `api/tests.py:2709` `InterviewDeathsHelpers` (`setup_family()`, `mark()`, `add_layer()`, `two()`, `refused()`), `:2780` `InterviewDeathsTests` (existing gender_locked write tests), `:2155` `HeirRulesApiTests`, `:822` `InterviewAnswerTests` (plain sonÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢daughter change).

## Tasks & Acceptance

**Execution:**
- `api/anonymous_case.py` -- extract the write's lock predicate into one helper used by `update_heir`; add an optional locked gender to `heir_options()`; apply it to root rows (after deaths are read) and later rows in `_decorate()` -- options agree with the write.
- `api/tests.py` -- add tests in `InterviewDeathsTests` covering every API row of the I/O matrix, including the write-agreement row (PUT each `gender_locked` relationship and check the 400 code) -- regression guard.
- `web/src/api/case.ts` -- `parseHeirOptions` accepts `gender_locked` as an `invalid` code -- without it the fixed options are discarded.
- `web/src/interview/answers.test.ts` -- flip the `gender_locked` parse assertion to expect it kept; add an assertion that an unknown code still yields no options.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- remove the "case API's `edit_options` still computes options from countsÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦" entry under "Epic 8 retrospective follow-ups".

**Acceptance Criteria:**
- Given the existing API test suites, when they run, then they pass with no existing assertion edited (only the web parser test assertion about `gender_locked` changes, by design).
- Given a case with no linked people and no later deaths, when it is read, then every row's `edit_options` and the case `heir_options` equal today's.

## Spec Change Log

## Review Triage Log

### 2026-11-20 â€” Review pass
- verdicts: 17 findings â€” high 0, medium 1, low 16, false 0, maybe-false 0
- findings:
  - `[low]` `[reject]` blind-hunter: `heir_options` returns empty options when the deceased is missing even with a locked gender â€” a lock needs a later death or a link, both of which need the root deceased; unlikely in use, and the fix adds a branch.
  - `[low]` `[reject]` blind-hunter: web parser accepts `gender_locked` in add-level options too â€” the server never sends it there; restricting it per call site adds a parser parameter.
  - `[low]` `[patch]` blind-hunter: same-gender PUT check passed on any non-400 status â€” now asserts 200 or 400.
  - `[low]` `[patch]` blind-hunter: test used stale rows and the female root row by position after successful PUTs â€” rows now fetched by id from a fresh read before each check; no-op `assertTrue` removed.
  - `[low]` `[reject]` blind-hunter: unlocked test would pass if maps lost their kinship codes â€” `HeirRulesApiTests` already pins per-row option values for unlinked families, and it passes unchanged.
  - `[low]` `[patch]` blind-hunter: web assertion only parses a bare options object â€” added a `parseCase` envelope test in `web/src/api/case.test.ts` (root and later row keep `gender_locked`).
  - `[low]` `[reject]` edge-case-hunter: locked root row with no deceased â€” same as the first blind-hunter row.
  - `[medium]` `[patch]` edge-case-hunter: every snapshot read decorated twice (`_read_deaths` and `read_snapshot` both call `_decorate`), doubling engine runs â€” removed the trailing `_decorate(case)` from `_read_deaths` (its only caller is `read_snapshot`).
  - `[low]` `[defer]` edge-case-hunter: edit sheet offers and submits the relationship without consulting `edit_options.invalid` â€” pre-existing for every kinship code; recorded in `deferred` and deferred-work.md.
  - `[low]` `[reject]` edge-case-hunter: no female later deceased locked only by the death record â€” the predicate is gender-agnostic and the death-record branch is exercised by the male later deceased; the female path is exercised by the linked wife.
  - `[low]` `[patch]` verification-gap: reopened saved case not checked for derived locks â€” extended `test_save_updates_and_open_roundtrip_on_another_device` to assert `gender_locked` on the canonical row and its alias.
  - `[low]` `[patch]` verification-gap: nothing checks a lock is lifted after unmarking â€” extended `test_promote_remove_and_unmark` to assert no root row carries `gender_locked` afterwards.
  - `[low]` `[defer]` verification-gap other: active edit sheet gives no advance feedback â€” same root cause as the edit-sheet defer row.
  - `[low]` `[defer]` intent-alignment: diff implements reading 1 (case API parity); reading 3 (picker stops offering the choice) diverges at the edit sheet â€” same root cause as the edit-sheet defer row.
  - `[low]` `[defer]` cross-story-contract: relationship picker drops the distinction and submits immediately â€” same root cause as the edit-sheet defer row.
  - `[low]` `[patch]` cross-story-contract: no web fixture sends a locked root-row envelope â€” covered by the new `parseCase` test.
  - `[low]` `[patch]` cross-story-contract: no web fixture sends a locked later-estate row â€” covered by the same `parseCase` test.

## Design Notes

Precedence differs from `engine/queries.py` (estate code first) on purpose: the HTTP options describe what the PUT will answer, and the PUT checks the lock before kinship.

## Verification

**Commands:**
- `uv run python manage.py test api.tests.InterviewDeathsTests api.tests.HeirRulesApiTests api.tests.InterviewAnswerTests api.test_snapshots --noinput` -- expected: all pass.
- `npm --prefix web test` -- expected: all pass.
- `npm --prefix web run typecheck` and `npm --prefix web run lint` -- expected: pass.

## Auto Run Result

Status: done

**Summary:** The case API's per-heir `edit_options` now agree with the heir PUT for gender-locked people (linked into another row, or named as a later deceased): every relationship of the other gender is reported in `invalid` as `gender_locked`, ahead of any kinship code, and is not in `blocked`. Root and later-estate rows, live reads and reopened saved cases all use one shared lock predicate with the write. The web parser keeps `gender_locked`, so the existing ar/en/fr text shows. Unlocked heirs and add options are unchanged.

**Files changed:**
- `api/anonymous_case.py` â€” `_is_locked` shared by `update_heir` and the decorator; `heir_options(locked_gender=None)`; `_edit_options`; root rows decorated after deaths are read; one decoration per read.
- `api/tests.py` â€” locked-gender options with PUT agreement (linked root, alias, later deceased, linked wife), unlocked row, saved-case reopen, lock lifted after unmark.
- `web/src/api/case.ts` â€” `parseHeirOptions` accepts `gender_locked`.
- `web/src/api/case.test.ts`, `web/src/interview/answers.test.ts` â€” parser envelope and options tests.
- `_bmad-output/implementation-artifacts/deferred-work.md` â€” resolved entry removed; edit-sheet picker entry added.

**Review:** one combined codex call (5 layers), 17 rows. Patched 9 rows (1 medium: double decoration per read; 8 low test strengthenings), deferred 4 rows (one root cause: the edit sheet ignores `edit_options.invalid`, pre-existing), rejected 4 low (unreachable no-deceased lock, add-level parser tightening, values already pinned by `HeirRulesApiTests`, female death-record path covered by gender-agnostic predicate). Follow-up review recommended: false (patched: 0 high, 1 medium, 8 low).

**Verification:** `uv run python manage.py test api.tests.InterviewDeathsTests api.tests.HeirRulesApiTests api.tests.InterviewAnswerTests api.tests.SavedCaseTests api.test_snapshots --noinput` â€” 109 tests OK (1 skipped). `npm --prefix web test` â€” 607/607 pass. `npm --prefix web run typecheck` â€” pass. `npm --prefix web run lint` â€” 0 errors, 12 pre-existing warnings.

**Residual risks:** The edit sheet still lets the visitor pick an invalid relationship and explains it only after the PUT (deferred). The full calc+api suite was not run here (the driver runs it per batch). Precedence of `gender_locked` over kinship codes intentionally differs from `engine/queries.py`.
