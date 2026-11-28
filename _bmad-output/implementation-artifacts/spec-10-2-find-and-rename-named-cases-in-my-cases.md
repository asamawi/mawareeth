---
title: 'Story 10.2: Find and rename named Cases in My cases'
type: 'feature'
created: '2026-11-26'
status: 'done'
baseline_commit: 'a9fb45e14cee3687dbf1dfd50ccf206aabde4e1f'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      A Saved case name with an unpaired UTF-16 surrogate makes the new rename route answer 500 instead of 400 errors.name invalid.
    evidence: |-
      SavedCaseRenameView uses the shared _parse_name, which checks type, NUL and grapheme length only; the same defect on the save routes is already recorded in deferred-work.md (spec 10.1b). Fixing _parse_name fixes all three routes.
    location: >-
      api/views.py SavedCaseRenameView / _parse_name
    severity: medium
---

<intent-contract>

## Intent

**Problem:** My cases (`/{locale}/cases/`) shows a Saved case's name only when it has one, offers no way to sort by name, no way to rename, no Retry after a failed load, and plain "Loading" text. Users with several estates cannot find or relabel the right one.

**Approach:** Each owned row is labelled by its Case name and shows its last change. A sort control offers "Last changed" (default, newest first) and "Name" (current Locale's collation, ties broken by newest change). An inline Rename per row reuses Story 10.1's naming field and calls a new name-only endpoint guarded by the SavedCase revision. Loading uses skeleton lines, and a failed list offers Retry.

## Boundaries & Constraints

**Always:**
- Rename changes only `SavedCase.name`, `revision` (+1) and `updated_at`. It never touches `snapshot`, `schema_version`, `id`, Basis, `created_at`, `ShareLink`/`ShareInvite` rows or the session working Case.
- Rename is a compare-and-swap on `expected_revision` under a row lock. Server name rules are the same as Save's (`_parse_name`: string, no NUL, trimmed, ≤ 100 extended grapheme clusters). A blank name after trimming becomes `default_name(row.created_at, <request language>)`, matching first Save. Invalid input → 400 with the existing `errors.name` codes and no mutation.
- If this session's saved link points at the renamed row with saved revision == `expected_revision`, advance the link's saved revision to the new revision and keep its case revision. The user's own rename must not make their own open Case conflict. Other sessions' links are left alone, so their next Save gets the normal conflict.
- The client shows the new name only after a 200. On failure, invalid input or conflict, the entered text stays in the field for correction or retry.
- Names render in `<bdi dir="auto">`. The Rename, Save and Cancel controls and the sort select are labelled, at least 44 px (`min-h-11`), with visible focus. Rename's accessible name includes the row's name. The layout reflows at 320 px / 400 % zoom without hiding Open or Rename, and uses the existing light/dark tokens.
- New user-facing text exists in en, ar and fr and is recorded in `deferred-work.md` for native review. `npm run i18n` passes.

**Never:**
- No full-snapshot write, no `encode_v2`, no `row.save()` without `update_fields` on the rename path. No migration (the `name` column already exists).
- No merge or force-overwrite on conflict. No change to Save/Share/WhatsApp behaviour, to the NameDialog's visible behaviour, to the received-cases list, or to FR-9's default-name backfill.
- No new "Start a new case" action here (Story 10.3 adds it). The existing nav link to the Interview stays.
- No change to existing translation strings.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Rename OK | `POST saved-cases/7/rename/` `{name:" أسرة  ", expected_revision:3}`, row rev 3 | 200 `{id:7,name:"أسرة",updated_at,revision:4}`, snapshot bytes and links unchanged | — |
| Blank | `{name:"   ", expected_revision:3}` | name = default name from `created_at` in the request language, rev 4 | — |
| Too long / bad type | 101 graphemes, or `name: 5`, or `name` missing | 400 `errors.name` `too_long` / `invalid`; row unchanged | Client shows the 10.1 boundary text and keeps the input |
| Bad revision | `expected_revision` missing, non-int, bool or < 1 | 400 `errors.expected_revision: "invalid"`; row unchanged | Client generic failure text |
| Stale | row rev 5, expected 3 | 409 `{error:"conflict", code:"rename_conflict", detail, revision:5, name:<stored>}`; row unchanged | Client shows the conflict text and the stored name in the row, keeps the entered text and adopts rev 5, so pressing Save again is an explicit retry |
| Not owned / gone | other owner's id, or deleted | 404, nothing written | Client failure text, input kept |
| Signed out / no CSRF | — | 403 as for other saved-case writes | — |
| Sort by name | names "b", "Á", "a", ties on name | locale `Intl.Collator(locale)` order; equal names → newer `updated_at` first, then higher id | — |
| List fails | `listSavedCases` → null | error text + Retry button; Retry refetches and shows skeleton | — |

</intent-contract>

## Code Map

- `api/views.py:380` `SavedCasesView.get` -- builds `{"cases":[...]}` by hand, ordered `-updated_at, -pk`. Add `revision` to each owned row.
- `api/views.py:395` `_parse_name`, `:426`/`:441` Save's name and default-name handling (blank → `default_name(row.created_at, lang)`, with the language from the request when a name is supplied). `api/snapshots.py:16` `default_name`. Reuse them; do not copy the grapheme logic.
- `api/views.py:402-410` Save's locked-row CAS with `F('revision') + 1`. Follow its pattern. Use `QuerySet.update(name=..., revision=F('revision')+1, updated_at=timezone.now())` filtered by owner, pk and expected revision, or `select_for_update` + `save(update_fields=[...])`. Note that `update()` bypasses `auto_now`.
- `anonymous_case.get_saved_link` / `set_saved_link(request, case_id, saved_id, saved_revision, case_revision)` (used at the create route, `api/views.py` `SavedCaseCreateView`) -- for the same-session link advance.
- `api/urls.py:36` -- add `path('saved-cases/<int:id>/rename/', SavedCaseRenameView.as_view(), name='saved-case-rename')` next to `open/`. `mawareeth/middleware.py:49` `CaseWriteLockMiddleware` already locks POSTs under `saved-cases/`. A lock timeout uses the existing `busy_response()` handling.
- `api/models.py:5` `SavedCase` (name text default `""`, revision default 1, `updated_at` auto_now), `:34` `ShareLink`, `:85` `ShareInvite` -- read-only.
- `api/tests.py:3483` `SavedCaseTests` -- home for the rename API tests. `api/test_saved_case_upgrade.py` has two-session conflict helpers for the cross-session case.
- `web/src/api/saved-cases.ts:4,38` `SavedCase` type and `listSavedCases`. Add optional `revision?: number` (accepted only when it is a positive integer; when it is absent, Rename is hidden, for blue-green safety). Add `renameSavedCase(signal, id, {name, expectedRevision, locale})` returning `{id,name,updated_at,revision}` \| `{conflict:{revision,name}}` \| `NAME_TOO_LONG` \| `NAME_INVALID` \| `null`. Follow `saveCase`'s CSRF, `Accept-Language` and error-mapping pattern (`:116`).
- `web/src/app/[locale]/results/name-dialog.tsx:14,44` -- extract the labelled input + grapheme counter + `aria-invalid` + error block into `web/src/app/[locale]/results/case-name-field.tsx`. NameDialog uses it unchanged in behaviour, and its existing tests must still pass.
- `web/src/app/[locale]/cases/cases-view.tsx:41,90` -- owned rows, loading text, empty message, shared error alert. Changes: name as the main label (blank stored name → new `cases.untitled`), last change under it, sort `<select>` above the owned list (shown when there are ≥ 2 rows), inline rename (one row at a time: the field replaces the label, then Save and Cancel; Enter submits; Escape or Cancel restores and refocuses Rename; double submit is guarded; status in `aria-live`), owned-list skeleton (`aria-busy="true"` region, sr-only loading text, decorative `h-3 rounded-full bg-surface` bars as in `interview/start-case.tsx:514`, `motion-reduce:animate-none`), and a Retry button when the owned list fails. The empty owned list keeps its own message, distinct from failure. Open and discard behaviour stays unchanged.
- `web/src/i18n/messages.ts:271` `cases` -- add `sortLabel`, `sortRecent`, `sortName`, `rename` (with `{name}`), `renameSave`, `renameCancel`, `renameSaving`, `renameFailed`, `renameConflict`, `retry`, `loading` (if absent), `untitled` in en, ar and fr. Reuse `results.nameLabel/nameCounter/nameTooLong/nameInvalid` for the field.
- `web/e2e/api.ts:133` -- the saved-cases fixtures gain `revision`. Stub `POST saved-cases/<id>/rename/` and record its bodies.
- Tests: `web/src/api/saved-cases.test.ts`, `web/src/app/[locale]/cases/cases-view.test.tsx` (`:175`), `web/e2e/cases.spec.ts`.

## Tasks & Acceptance

**Execution:**
- `api/views.py`, `api/urls.py` -- add `revision` to list rows; add `SavedCaseRenameView` (POST, authenticated, owner-only, body must be a dict) implementing the matrix and the same-session link advance.
- `api/tests.py` -- in `SavedCaseTests`: every server row of the matrix; snapshot, `schema_version`, `created_at` and ShareLink/ShareInvite rows unchanged and the share token still resolves; `updated_at` advanced and the row first in the list; a list row carries `revision`; same-session open-then-rename-then-Save gives no conflict; another session's later Save gets the 409 conflict.
- `web/src/api/saved-cases.ts` + `saved-cases.test.ts` -- revision parsing (present, absent, invalid) and every `renameSavedCase` outcome, including body, method and `Accept-Language`.
- `web/src/app/[locale]/results/case-name-field.tsx`, `name-dialog.tsx` -- extract the shared field; keep the NameDialog tests green.
- `web/src/app/[locale]/cases/cases-view.tsx` + `cases-view.test.tsx` -- the UI above; tests for the name label and `untitled`, the default order, name sort with ar collation and ties, rename success (new label; another load shows it), the failure, invalid and conflict paths keeping the text, Escape focus return, the double-press guard, Rename hidden without a revision, skeleton `aria-busy`, empty vs failure, and Retry refetch.
- `web/src/i18n/messages.ts` -- new keys (en, ar, fr).
- `web/e2e/api.ts`, `web/e2e/cases.spec.ts` -- en and ar: sort by name, rename success, conflict keeps the text; axe on the list in rename mode; 320 px viewport keeps Open and Rename visible.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- add an entry listing the new en, ar and fr strings for native review.

**Acceptance Criteria:**
- Given an owner with several Saved cases, when they visit My cases, then each row's main label is its name (in `bdi dir=auto`) with its last change, ordered newest change first, and choosing "Name" re-orders by the Locale collation with ties broken by newest change.
- Given a successful rename, when My cases is loaded again, then the new name shows, and opening the case or its share link yields the same family, estate and Basis as before.
- Given a rename that is invalid, fails or conflicts, when the response arrives, then no new name is shown as saved and the entered text remains editable.
- Given the owned list is loading, empty or failed, then a skeleton with `aria-busy`, the empty message, or the error text with a working Retry is shown respectively, and the nav link to the Interview remains reachable.

## Spec Change Log

## Review Triage Log

### 2026-11-26 — Review pass
- verdicts: 41 findings — high 0, medium 14, low 25, false 2, maybe-false 0
- review ran as one combined codex call (deep tier, diff 69 kB) with all five layers
- findings:
  - `[medium]` `[patch]` blind: a late success for row A calls `stopEditing(A)` and discards row B's editor — fixed: other rows' Rename is disabled while a rename saves, and success/failure touch `editing` only when it still belongs to that row
  - `[low]` `[patch]` blind: Cancel/Escape/typing during an in-flight rename are lost or misleading — fixed: Cancel disabled, Escape ignored, input read-only while saving
  - `[low]` `[reject]` blind: the 409 carries no `updated_at`, so the row's date stays stale after a conflict — the date corrects on the next list load; the fix adds a response field
  - `[low]` `[reject]` blind: `Date.parse` ignores sub-millisecond differences in recent order — two changes to one owner's rows within the same millisecond are not realistic
  - `[medium]` `[patch]` blind: Open is described only by the date, not the case name the story requires — fixed: Open's `aria-describedby` names the label and the date
  - `[medium]` `[patch]` blind: a 100-character unbroken name overflows the label and the Rename button at 320 px — fixed: `overflow-wrap:anywhere` on both
  - `[low]` `[patch]` blind: inline Save's `aria-disabled` ignores an over-limit name — fixed: it now includes the grapheme limit, as NameDialog does
  - `[false]` `[reject]` blind: a 200 for a different id would be applied — the view answers with `row.pk` of the requested, owner-filtered row; no reachable path returns another id
  - `[medium]` `[defer]` blind: a lone UTF-16 surrogate in the name makes rename answer 500 — pre-existing `_parse_name` defect, already in deferred-work.md (10.1b); recorded in frontmatter
  - `[low]` `[patch]` blind: a literal NUL byte in `cases-view.test.tsx` makes git and grep treat the file as binary — fixed: replaced with an escaped sentinel
  - `[medium]` `[patch]` edge: late success closes another row's editor — same fix as the first row
  - `[low]` `[patch]` edge: edit, Escape or Cancel while Save is pending — same fix as the second row
  - `[low]` `[patch]` edge: submitting B while A holds the shared flag is silently ignored — resolved by disabling other rows' Rename while one saves
  - `[low]` `[patch]` edge: Escape on Save or Cancel does not close the editor — fixed: the handler moved to the form
  - `[false]` `[reject]` edge: a 200 for a different id would be applied — same refutation as above
  - `[low]` `[reject]` edge: the date and order stay stale after a conflict — same as above
  - `[medium]` `[defer]` edge: a lone surrogate gives 500 on rename — same pre-existing defect
  - `[low]` `[reject]` edge: millisecond tie in recent order — same as above
  - `[low]` `[reject]` edge: without `Intl.Segmenter` the code-point fallback can over-count — pre-existing shared helper; every supported browser has `Intl.Segmenter`
  - `[medium]` `[patch]` edge: the rename test checks the share row's count and pk only — fixed: share token and accepted invite views compared before and after the rename
  - `[low]` `[reject]` edge: the e2e success test never reloads the list — persistence on a fresh list GET is covered by the Django test
  - `[medium]` `[patch]` verification-gap: no test of a stale own working copy plus a rename at the newer revision then Save — fixed: the test asserts 409 and the newer snapshot preserved
  - `[medium]` `[patch]` verification-gap: share and invite continuity checked at the row only — fixed with the edge-case row above
  - `[medium]` `[patch]` verification-gap: the ar sort tests pass under an en collator — fixed: a mixed "a"/"ا" pair whose order differs by locale
  - `[medium]` `[patch]` verification-gap: success test cannot catch a stale date or position — fixed: renaming the oldest row moves it first and updates its date
  - `[medium]` `[patch]` verification-gap: pending-response tests never use a second editor — fixed: two-row delayed-response test
  - `[medium]` `[patch]` verification-gap (other): the two-editor loss is present in the current code — same fix as the first row
  - `[low]` `[reject]` intent-alignment: no browser follow-through of reload, reopen, share token and invite — the server tests now cover the token, invite and list reload; the browser layer uses stubs by design
  - `[medium]` `[patch]` intent-alignment: Open is identified by timestamp; long mixed-script names untested at zoom — same fixes as the Open and overflow rows
  - `[low]` `[reject]` intent-alignment: new-case reachability not asserted per list state — the site nav's Interview link sits outside `CasesView` and renders in every state
  - `[low]` `[reject]` cross-story: a 503 busy answer loses `Retry-After` and shows generic failure — the text is kept and Save can be pressed again, as for Save itself
  - `[low]` `[reject]` cross-story: conflict combines a current name with stale list metadata — same as the stale-date row
  - `[low]` `[reject]` cross-story: list rows with `madhab: null` and `revision` have no web fixture — the parser accepts null unchanged by this diff
  - `[low]` `[reject]` cross-story: a list row with a non-draft status and `revision` has no web fixture — the parser accepts any status string, unchanged
  - `[low]` `[reject]` cross-story: the 400 `too_long` fixture omits `detail` — the parser reads only `errors.name`; extra fields cannot change the outcome
  - `[low]` `[reject]` cross-story: the 400 `invalid` fixture omits `detail` — same reason
  - `[low]` `[reject]` cross-story: the 400 `expected_revision` fixture omits `detail` — maps to generic failure either way
  - `[low]` `[reject]` cross-story: no detail-only 400 fixture — the client always sends an object; the outcome is generic failure either way
  - `[low]` `[reject]` cross-story: 403 on an expired session shows generic failure — the shared write helper behaves this way for every saved-case write
  - `[low]` `[reject]` cross-story: 404 for a vanished row shows generic failure — acceptable; the list reload shows the row gone
  - `[low]` `[reject]` cross-story: 503 envelope not sent through the web test — generic failure is the intended outcome

## Design Notes

Rename bumps `revision` so that a stale rename (another tab renamed first) is detected, and so that a working copy in another session does not silently keep an outdated base. Save on an existing row already preserves the stored name, so the snapshot and the name never overwrite each other. The same-session link advance stops a user's own rename from making their own open Case conflict.

On conflict the client adopts the server's revision and shows the stored name, but keeps the user's text in the field. A second press of Save is then an informed, explicit overwrite of the name only, the minimal recovery control the story allows (an open question in the epic, resolved this way).

## Verification

**Commands:**
- `uv run python manage.py makemigrations --check --dry-run` -- expected: no changes
- `uv run python manage.py test api.tests.SavedCaseTests api.test_saved_case_upgrade api.test_saved_case_unsaved api.test_snapshots --noinput` -- expected: OK
- `cd web && npm test && npm run typecheck && npm run lint && npm run i18n` -- expected: no failures, 0 lint errors
- `cd web && npm run build && npx playwright test e2e/cases.spec.ts e2e/results.spec.ts e2e/accessibility.spec.ts` -- expected: all pass; full suites run in PR CI

## Auto Run Result

Status: done

**Summary.** My cases now labels each owned Saved case by its name (`bdi dir=auto`, "Untitled case" for a blank one) with its last change, defaults to newest change first, and offers a Name sort using the page Locale's collation (ties broken by newest change, then id). Each row has an inline Rename that reuses the 10.1 naming field (now the shared `CaseNameField`). It posts to a new `POST /api/v1/saved-cases/{id}/rename/` that changes only `name`, `revision` (+1) and `updated_at` under a row lock and a compare-and-swap on `expected_revision`. Blank names fall back to the default name in the asked language, and invalid input gets 400 with the existing `errors.name` codes. A stale revision gets 409 `rename_conflict` with the stored revision and name. The client keeps the typed text and adopts the stored revision, so pressing Save again is an explicit retry. The renaming session's saved link advances only when its base equals the renamed revision. Loading shows a skeleton with `aria-busy`, and a failed list shows the error text and a Retry button, distinct from the empty message.

**Files changed**
- `api/views.py` -- list rows carry `revision`; new `SavedCaseRenameView`.
- `api/urls.py` -- `saved-cases/<id>/rename/` route.
- `api/tests.py` -- 9 rename tests in `SavedCaseTests` (matrix, share/invite continuity, list order, same-session and stale-session links).
- `web/src/api/saved-cases.ts` (+ test) -- optional list `revision`; `renameSavedCase` with every outcome.
- `web/src/app/[locale]/results/case-name-field.tsx` -- new shared labelled name field (counter, `aria-invalid`, read-only while saving).
- `web/src/app/[locale]/results/name-dialog.tsx` -- uses the shared field, behaviour unchanged.
- `web/src/app/[locale]/cases/cases-view.tsx` (+ test) -- name labels, sort, inline rename, skeleton, Retry, and Open described by the name and date.
- `web/src/i18n/messages.ts` -- 12 new `cases.*` keys in en, ar, fr.
- `web/e2e/api.ts`, `web/e2e/cases.spec.ts` -- rename stub; sort, rename, conflict, axe/44 px and 320 px specs in en and ar.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- native-review entry for the new strings.

**Review findings.** 41 findings from one combined codex call (deep tier): high 0, medium 14, low 25, false 2.
- Patched (sent back to the implementation subagent):
  - The guard for a late success on another row's editor, plus input, Cancel and Escape locked while saving.
  - Escape handled on the form.
  - `aria-disabled` for an over-limit name.
  - Open described by the name.
  - `overflow-wrap:anywhere` for long names.
  - NUL byte removed from the test.
  - New tests: stale own working copy plus rename then Save gives 409; share token and invite unchanged across a rename; mixed-script ar collation; renaming the oldest row moves it first; two-row pending rename; Escape from Cancel.
- Also fixed before review, during the matrix audit: the stored name stays visible above the rename form after a conflict (a codex light edit; a stray `+` it left was corrected by hand).
- Deferred: a lone surrogate in a name gives a 500 (pre-existing `_parse_name` defect, also on the save routes).
- Rejected, with reasons in the triage log:
  - Stale date after a conflict.
  - Sub-millisecond sort ties.
  - No browser-level reload, reopen or share follow-through.
  - New-case reachability per state.
  - `Intl.Segmenter` fallback.
  - 503, 403 and 404 shown as generic failure.
  - Web fixtures without the server's `detail` field.
  - The two `false` findings: a 200 for a different id cannot happen.

**Follow-up review recommended: true.** 13 medium-verdict entries were patched (0 high). The named unverified risk: the in-flight rename locking (read-only input, disabled Cancel and other rows' Rename, form-level Escape) and the two-editor guard were added in the patch pass and are covered only by component tests, not by a browser test or a fresh review.

**Verification** (after the patches)
- `makemigrations --check`: no changes.
- Django `api.tests.SavedCaseTests api.test_saved_case_upgrade api.test_saved_case_unsaved api.test_snapshots`: 109 tests OK (1 skipped).
- `npm test`: 791/791 pass. `npm run typecheck`: OK. `npm run lint`: 0 errors (12 warnings, none in new non-test code). `npm run i18n`: OK.
- `npm run build`: OK. Playwright `cases.spec.ts results.spec.ts accessibility.spec.ts`: 111 passed.
- An earlier, pre-patch run had intermittent 30 s timeouts in `accessibility.spec.ts` "50-Heir Case at 375px" axe tests (a page this story does not touch). They passed on rerun and in the final run. At the time the C: drive had only ~385 MB free.

**Residual risks**
- New en, ar and fr wording needs native review (recorded in deferred-work.md).
- Rename bumps `revision`, so a rename made in one session makes another session's open working copy conflict on its next Save (by design, see Design Notes).
- When autosave arrives in 10.5, a rename from My cases will likewise send an open Interview elsewhere into the conflict prompt.
