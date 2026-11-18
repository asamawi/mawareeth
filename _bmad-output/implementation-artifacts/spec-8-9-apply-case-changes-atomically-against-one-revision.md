---
title: 'Story 8.9: Apply Case changes atomically against one revision'
type: 'feature'
created: '2026-11-17'
status: 'done'
baseline_revision: '707fc6bedab0ec2f2974763acb7491cd5d37738c'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** Session Case writes are serialized by `CaseWriteLockMiddleware` (a PostgreSQL row lock on the `django_session` row), but nothing versions the Case. A slow tab whose `case_id` still matches overwrites newer edits, a late preview can show numbers for an older family, the lock wait is unbounded, guest expiry relies only on Django's session expiry (a logged-in session keeps an unsaved guest Case for weeks), a heir delete silently cascades, and there is no all-or-nothing bulk add or restore. `SavedCase` has no revision column for story 8.10's compare-and-swap.

**Approach:** Add `api/case_commands.py`, the one Case command service. Every session-Case input mutation goes through it with `expected_revision`. It checks the revision under the existing session row lock, runs the mutation on the session, rolls the session dict back on any failure, and on success bumps one monotonic `revision`, stamps `changed_at` and returns the whole Case. Add bulk-add and restore commands, cascade confirmation, explicit guest expiry, a bounded lock wait with a retryable 503 and redacted measurements, a revision on preview responses, and an additive `SavedCase.revision` migration. The web sends `expected_revision`, discards older-revision previews and blocks edits while offline.

## Boundaries & Constraints

**Always:**
- **Revision.** The session Case dict stores `revision` (int ≥ 1) and `changed_at` (ISO UTC). `start` and `load_snapshot` (open a SavedCase) create revision 1. A stored Case with no `revision` reads as 1. `anonymous_case.get` adds `revision` to the returned dict. `export_snapshot`, the SavedCase readers and the shared/received bodies never carry it, so 8.8's twin comparisons are unchanged.
- **Commands.** These are the commands and the endpoints that call them. Each endpoint keeps its URL, method, status codes and `{"case": …}` success body:

  | Command | Endpoint |
  |---|---|
  | `set_basis` | `PATCH case/` (`madhab`) |
  | `set_deceased` | `PUT case/deceased/` (gender plus estate) |
  | `add_heir` | `POST case/heirs/` |
  | `bulk_add` | `POST case/heirs/bulk/`, new: `{case_id, expected_revision, layer?, heirs:[{relationship, name?}, …]}`, 1–50 items |
  | `edit_heir` | `PUT case/heirs/<id>/` |
  | `remove_heir` | `DELETE case/heirs/<id>/` |
  | `mark_death` | `POST case/deaths/` |
  | `unmark_death` | `DELETE case/deaths/<id>/` |
  | `restore` | `POST case/restore/`, new: `{case_id, expected_revision, snapshot}` |

  `expected_revision` travels in the JSON body, or in the query string for a DELETE, next to `case_id`. Once a session Case exists, every command requires it. A missing, non-integer or bool value is 400 `{"error":"invalid_revision","detail":…}` with no mutation. `POST case/` (start or replace) accepts an optional `expected_revision`; when it is given and does not match the existing Case, the result is a conflict.
- **Conflict.** A `case_id` mismatch (today's `StaleCase`) or a revision mismatch returns 409 `{"error":"conflict","detail":"That case is no longer the current one.","case":<current Case>}`. The stored Case is untouched. The existing `detail` text stays the same.
- **Atomic.** Each command runs inside the middleware's transaction and session lock. The service deep-copies the stored session Case before it runs, and restores that copy on any exception or refusal. A failure therefore leaves the Case, `revision` and `changed_at` byte-identical and never bumps the revision. Success bumps the revision by exactly 1, even when a command creates several rows or layers.
- **Engine decides.** Add, edit and death validity keep coming from the existing engine-backed checks (`api/heir_rules.py` → `engine.queries.relationship_options`, and the kinship rules). `remove_heir` computes its impact with `engine.queries.delete_impact` on `calc.adapters.family_from_session(case)`. `unmark_death` computes its impact as the persons the removal would drop (a before/after diff on a working copy), because no engine query models un-marking.
  - When the impact names any person other than the target, or any estate, the command needs `confirm_cascade: true`. Without it, the command returns 409 `{"error":"cascade_unconfirmed","impact":{"persons":[ids],"estates":[orders]},"case":…}` with no mutation.
- **Limits.** The server keeps the existing limits: 50 Heirs per layer (`MAX_HEIRS`) and two later deaths. `bulk_add` checks capacity before it adds anything; going over returns 400 `{"error":"over_capacity","detail":…}`. `bulk_add` is all-or-nothing: an invalid item returns 400 `{"error":"invalid_input","errors":{"<index>":{…field errors}}}` and nothing is added. A third later death keeps today's 400 field error.
- **Restore.** The `snapshot` uses the `export_snapshot` input shape (`madhab`, `deceased`, `heirs`, `deaths`). It is valid only when `export_snapshot(read_snapshot(snapshot, case_id, started_at))` equals the submitted inputs after canonical JSON comparison, so nothing is silently dropped or truncated. Otherwise it is 400 `{"error":"invalid_snapshot"}`. A valid restore keeps the current `id` and `started_at` and the snapshot's heir ids, and sets `revision = current + 1`, never the snapshot's old number.
- **Guest expiry.** A session Case with no saved link is a guest Case. It is expired when `now - changed_at ≥ ANONYMOUS_CASE_IDLE_SECONDS`, or `started_at` when `changed_at` is missing. Expiry is checked on every read and edit:
  - `GET case/` → 200 `{"case": null, "code": "expired"}`;
  - commands, preview and draft PDF → 404 `{"detail":"There is no current case.","case":null,"code":"expired"}`;
  - `POST case/` without `replace` starts a fresh Case (201).

  Only a successful command updates `changed_at`. Reads, previews, login and schema conversion never do.
- **Lock budget.** `CaseWriteLockMiddleware` runs `SET LOCAL lock_timeout = '<CASE_LOCK_TIMEOUT_MS>ms'` before it takes the row lock. The new setting `CASE_LOCK_TIMEOUT_MS` defaults to 500, chosen from the AD-27 1 s preview p95 (see Design Notes). SQLSTATE 55P03 returns 503 `{"error":"busy","detail":"The case is busy. Try again.","retryable":true}` with `Retry-After: 1`, and nothing is mutated. Every locked write logs one redacted record on logger `mawareeth.case_lock` with `outcome` (`acquired`|`timeout`) and integer `wait_ms`, and no session key, Case id, name or body. `SavedCasesView.post` takes `select_for_update()` on the linked row under the same timeout.
- **SavedCase.** The migration `api/migrations/0005_savedcase_revision.py` adds `revision = PositiveIntegerField(default=1)`, so existing rows get 1. Each save sets `revision = F('revision') + 1` atomically, under the row lock, in the same `save`. It keeps writing `schema_version=1` with `export_snapshot`. The response adds `revision`.
- **Preview.** The preview body gains top-level `revision`: the revision of the Case it was computed from. The web keeps a preview only when its `revision` equals the revision of the Case the page shows. An older one is discarded and never displayed.
- **Web.**
  - `web/src/api/case.ts` parses `revision` (an integer; `null` for shared or received bodies). Every write sends the `expected_revision` of the Case the page shows. `removeHeir` and `unmarkDeceased` send `confirm_cascade: true`, which keeps today's behaviour until the Epic 9 impact dialog exists.
  - A 409 conflict or `cascade_unconfirmed` that carries a `case` takes the existing stale path, which refreshes from the returned Case. A 503 busy response takes the existing failed path.
  - While `navigator.onLine` is false, the interview disables add, edit, delete and mark/unmark death, and shows "You're offline. Reconnect to keep editing." (new `messages.ts` key in en, ar and fr). The family and the last preview stay visible, and nothing is queued.

**Never:** Write schema 2, or change `api/snapshots.py` READ/WRITE versions or `matrix.json`. Add the SavedCase name column, the working-copy base-revision CAS (8.10), currency or eligibility-answer state, tree-drop, redeem or a prefill table. Add a web Undo UI or impact dialog (Epic 9). Edit `engine/` or `contracts/`. Change existing user-facing text, or reuse/rename message keys. Touch the legacy `calc/` write lock.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Edit at current revision | rev 4, `expected_revision: 4` | 200, the whole Case, rev 5, `changed_at` updated | — |
| Stale tab | rev 5, `expected_revision: 4` | 409 conflict with the rev 5 Case; stored dict unchanged | conflict |
| Missing revision | add heir without `expected_revision` | 400 `invalid_revision`; unchanged | typed |
| Impossible edit | edit to a second father | 400 field errors; rev unchanged | — |
| Bulk over capacity | layer has 48; bulk of 3 | 400 `over_capacity`; 48 heirs, rev unchanged | — |
| Bulk with one bad item | 3 items, item 1 an unknown relationship | 400 `invalid_input` keyed `"1"`; none added | — |
| Bulk ok | 3 valid items at rev 2 | 201, 3 heirs added, rev 3 | — |
| Third later death | two deaths exist | 400; rev unchanged | — |
| Unconfirmed cascade | remove a heir who has a later-death layer, no `confirm_cascade` | 409 `cascade_unconfirmed` with impact; unchanged | — |
| Confirmed cascade | same with `confirm_cascade: true` | 200, the layer is gone, rev +1 | — |
| Simple remove | a heir with no dependants, no confirm | 200, rev +1 | — |
| Restore | rev 7, snapshot from rev 3 | 200, ids preserved, rev 8 | — |
| Invalid restore | snapshot with 51 heirs or an unknown relationship | 400 `invalid_snapshot`; unchanged | — |
| Out-of-order previews | preview computed at rev 3 arrives after the rev 4 Case | the web discards it; the rev 4 preview shows | — |
| Expired guest | `changed_at` 24 h + 1 s ago, no saved link | GET → `{case:null, code:"expired"}`; edit/preview → 404 `expired` | — |
| Saved working copy older than 24 h | a saved link exists | readable and editable | — |
| Lock held | another transaction holds the session row | 503 busy within about 500 ms plus overhead; no mutation; `timeout` log record | retryable |
| SavedCase save | existing row at revision 1 | snapshot written, revision 2, `schema_version` 1 | — |
| Migration | existing rows | `revision` = 1 | — |

</intent-contract>

## Code Map

- `mawareeth/middleware.py:63` `CaseWriteLockMiddleware`. It locks the session row (`select_for_update`, `:89-91`) inside `transaction.atomic()` for POST/PUT/PATCH/DELETE on the `api:case` and `api:saved-cases` prefixes. Add the `lock_timeout`, the 55P03 → 503 handling and the measurement here. `calc/views.py:38-62` (`lock_busy_response`, `lock_calculation`) is the legacy pattern to mirror: `SET LOCAL lock_timeout`, then catch `OperationalError` with `pgcode == '55P03'` (check how it detects that).
- `mawareeth/settings.py:343` `ANONYMOUS_CASE_IDLE_SECONDS`. Add `CASE_LOCK_TIMEOUT_MS = 500` next to it, with a comment giving the budget derivation. The session engine is Django's default DB backend (asserted at `api/tests.py:2405`).
- `api/anonymous_case.py`:
  - the read side: `get:236`, `read_snapshot:254` (the case keys `id, started_at, madhab, deceased, heirs, heir_options, deaths`), `start:279`, `_live:288` (the case_id check → `StaleCase:60`), `_save:298` (reassigns the session dict and calls `touch`), `touch:351`, `_store_case:423`;
  - the mutations: `set_madhab:314`, `set_deceased:327`, `mark_deceased:463` (the third-death refusal at `:474`), `unmark_deceased:555`, `add_heir:572`/`_add_heir:581` (`MAX_HEIRS` at `:601`), `update_heir:628`, `remove_heir:666`, `_remove_rows:523` (the recursive pruning);
  - `export_snapshot:677`, `get_saved_link:694`, `set_saved_link:701`, `load_snapshot:705`.

  Make `_save`/`_store_case` preserve `revision`/`changed_at`. Let the service do the bump, rather than every mutation.
- `api/views.py`:
  - `ApiView:29`, `CaseView:54` (`post` replace logic `:63-87`, `patch` `:89`), `CaseWriteView.write:116` (the single exception-mapping point; route it through the service), `DeceasedView:146`, `HeirsView:153`, `HeirView:162`, `PreviewView:201` (adds `revision`, and `code` when expired), `DeathsView:234`, `DeathView:241`;
  - `SavedCasesView.post:262`, which writes at `:282-290`, and `OpenSavedCaseView:294`, which loads a new revision-1 session.
- `api/urls.py:23-32` -- add `case/heirs/bulk/` and `case/restore/`. Both fall under the `api:case` prefix, so the middleware locks them.
- `api/models.py:5` `SavedCase`. The latest migration is `api/migrations/0004_import_legacy_calculations.py`.
- `engine/queries.py:105` `delete_impact(family, person, *, estate=None) -> Impact(persons, estates)`. It is read-only. `calc/adapters.py:17` `family_from_session(case)` gives `(Family, Currency)`. Person ids equal heir row ids, except alias rows with `same_as`, which map to their person.
- `reports/views.py:40` -- the session draft PDF goes through `anonymous_case.get`, so expiry must make it 404.
- Web:
  - `web/src/api/case.ts`: `parseCase:307`, `write:365` and its 409/404 handling `:485-505`, `startCase:406`, `setMadhab:433`, `saveDeceased:528`, `addHeir:537`, `updateHeir:546`, `removeHeir:556`, `markDeceased:571`, `unmarkDeceased:590`, `fetchPreview:1343` (409 → `replaced`).
  - `web/src/interview/flow.ts`: the deps interface `:148`, the `saved` apply `:754,886`, the stale refresh `:924-943`.
  - `web/src/app/[locale]/interview/share-preview.tsx:51-67`, which tracks preview attempts and `web/src/interview/preview.ts` (freshness) — add the revision guard here.
  - `web/src/app/[locale]/interview/start-case.tsx:83-91`, which wires the deps.
  - `web/src/i18n/messages.ts` gets the new offline key.
  - Tests run on Node's test runner: `web/src/api/case.test.ts`, `web/src/interview/*.test.ts`, and Playwright `web/e2e/interview.spec.ts` (its API stubs in `web/e2e/api.ts` must include `revision`).
- Tests:
  - `api/tests.py`: `CaseTests:153`, `InterviewDeathsTests:2705`, `SavedCaseTests:3246`, `PreviewTests:1285`, and `CaseWriteLockTests(TransactionTestCase):2410`, whose threaded pattern is at `:2490`. Existing write tests must add `expected_revision`; the `InterviewHelpers` `send` helper is the place to do that centrally.
  - `api/test_snapshots.py`, the 8.8 twins, must stay green.

## Tasks & Acceptance

**Execution:**
1. `api/case_commands.py` (new) -- the command service. It provides `Conflict`, `CascadeUnconfirmed`, `OverCapacity`, `InvalidRevision` and `InvalidSnapshot` exceptions; `execute(request, command, *, case_id, expected_revision, run)`, which loads, checks expiry, checks the id and revision, deep-copies, runs, bumps the revision and stamps `changed_at`, rolling back on any exception; plus `bulk_add`, `restore`, and the impact helpers for remove/unmark. It is the only place that bumps a revision.
2. `api/anonymous_case.py` -- add `revision`/`changed_at` storage and reading, an `is_expired(request)` helper, expiry in `get` (returns None), revision 1 on `start`/`load_snapshot`, and preserve both keys in `_save`/`_store_case`.
3. `api/views.py` + `api/urls.py` -- route every mutation through `case_commands`, map the typed errors to the bodies above, add `BulkHeirsView` and `RestoreView`, add the preview `revision` and the expired `code`s, the CaseView expiry/start behaviour, and the SavedCase save under row lock with the revision increment.
4. `mawareeth/middleware.py` + `mawareeth/settings.py` -- the lock timeout, the 503 busy body, the `mawareeth.case_lock` records and the `CASE_LOCK_TIMEOUT_MS` setting.
5. `api/models.py` + `api/migrations/0005_savedcase_revision.py` -- the additive revision column, default 1.
6. `api/test_case_commands.py` (new) -- a test for every I/O matrix row against the real endpoints. Assert that the stored session dict is byte-identical after each failure. Add a `TransactionTestCase` that holds the session row lock in a second thread and asserts a 503 within `CASE_LOCK_TIMEOUT_MS + 1500` ms, no mutation, and a `timeout` log record with no key or id (use `assertLogs`). Add two threaded same-revision edits: exactly one succeeds and the other gets a 409 conflict. Add a migration test (or a row created before the field default) that shows existing rows read revision 1.
7. `api/tests.py`, `reports` tests -- send `expected_revision` in the existing write helpers, and update the assertions that compare whole case bodies to allow the additive `revision`. Do not weaken any other assertion.
8. Web (`web/src/api/case.ts`, `web/src/interview/flow.ts`, `share-preview.tsx`/`preview.ts`, `start-case.tsx` or the interview components, `messages.ts`, the e2e stubs) -- add `revision` parsing, `expected_revision` on writes, `confirm_cascade: true` on removals, the stale-preview discard by revision, and the offline block with the new message. Add unit tests for the parse/send, the preview discard and the offline disable.
9. `_bmad-output/implementation-artifacts/deferred-work.md` -- add an 8.9 section:
   - the new offline message (ar/fr) needs native review;
   - removals send `confirm_cascade: true` until the Epic 9 impact dialog;
   - currency, answers, tree-drop and redeem commands plug into `case_commands` later;
   - an expired guest Case is not deleted from the session on read;
   - the limit stays 50 per layer (AD-26 says 50 Heirs);
   - old web bundles open across the deploy get 400 `invalid_revision` until reload;
   - the lock measurements are logs, not metrics yet.

**Acceptance Criteria:**
- Given any write endpoint and any failure outcome (invalid input, conflict, cascade, over capacity, busy, expired), when it returns, then `request.session['anonymous_case']` is unchanged and no later read shows a higher revision.
- Given N successful commands from revision r, when the Case is read, then its revision is r+N, and each command's response carried the whole Case at its new revision.
- Given the finished change, when `git diff 707fc6b -- engine contracts api/snapshots.py api/fixtures/snapshots` runs, then it is empty, and SavedCase saves still write `schema_version=1`.
- Given migration `0005`, when `makemigrations --check` runs, then no changes are pending.

## Spec Change Log

## Review Triage Log

### 2026-11-18 — Review pass
- verdicts: 34 findings — high 0, medium 5, low 21, false 8, maybe-false 0
- note: the four codex layers failed on the codex usage limit before reading anything, so all four layers ran on Claude subagents.
- findings:
  - **Intent-alignment auditor**
    - `[medium]` `[patch]` (intent) The offline block has no behavioural test; only the non-empty `offlineEditing` text is checked. — Grouped with the verification-gap offline row. Patched: a Playwright test sets the context offline on the heirs screen. It checks the notice, the disabled add control, that no write is sent and the family stays visible, then re-enables everything once back online.
    - `[low]` `[reject]` (intent) The results page's School choice is not gated while offline. — The contract scopes the offline block to the interview's add, edit, delete and death controls. A choice sent while offline fails on the existing failed path and mutates nothing. Recorded in deferred-work.
    - `[false]` `[reject]` (intent) No web code calls the new bulk and restore endpoints. — By design: the contract makes them server commands for Epic 9 to consume. The contract's Never list excludes an Undo UI.
  - **Verification-gap reviewer**
    - `[medium]` `[patch]` (verification-gap) `flow.ts` sends the shown revision to every write, but `log.revisions` was never asserted. — Patched: a `flow.test.ts` case at revision 3 asserts that every answer kind, `choose` and start-over pass 3.
    - `[medium]` `[patch]` (verification-gap) The `acceptRevision` wiring in `SharePreview` is untested; deleting the call passes every test. — Patched: a Playwright test where the case is at revision 2 and the preview answers revision 1 asserts the stale shares are not shown. The implementer confirmed it fails when the call is removed.
    - `[medium]` `[patch]` (verification-gap) The offline block is untested. — Grouped with the intent-alignment offline row; patched there.
    - `[low]` `[patch]` (verification-gap) The expired branch of `SavedCasesView.post` is untested. — Patched: a logged-in save of an expired guest Case asserts 404 with `code: "expired"` and no row.
    - `[low]` `[reject]` (verification-gap, other) The web always sends `confirm_cascade=true`, so `cascade_unconfirmed` is unreachable from the UI. — Mandated by the contract until the Epic 9 impact dialog; the server path is tested. Recorded in deferred-work.
    - `[false]` `[reject]` (verification-gap, other) A body `confirm_cascade: "true"` string is ignored. — Only DELETEs carry a cascade, and `_query_data` turns the query string into a real bool. No body path takes it.
    - `[false]` `[reject]` (verification-gap, other) Other writers of the live session Case. — The reviewer itself found none outside `execute`, `start`, `_save`/`_store_case` and `load_snapshot`, and those go through `start`.
  - **Blind hunter**
    - `[low]` `[reject]` (blind) Restore replaces the Case, dropping later deaths, without cascade confirmation. — Restore is the Undo command (AD-20). The contract defines it as replacing the inputs with a prior page snapshot, and confirming an Undo would defeat it.
    - `[low]` `[reject]` (blind) The web client's default `confirm_cascade=true` defeats confirmation. — The same claim as the verification-gap row above.
    - `[low]` `[patch]` (blind) Start-over compares `expected_revision` with a bare `!=`, so `true` matches revision 1 and a string gives 409. — Patched: a present value is validated with `valid_revision` first, returning the commands' 400 `invalid_revision` body, and tests cover `true` and `"two"`. A missing value stays allowed, because the contract makes it optional on `POST case/`.
    - `[low]` `[reject]` (blind) A guest session from before the deploy, with no `changed_at`, expires from `started_at` even if edited recently. — Real, but it happens once at deploy and only to a guest who started over 24 hours ago and is still editing. The `started_at` fallback is the contract's rule. Recorded in deferred-work.
    - `[false]` `[reject]` (blind) `SavedCase.revision` is never compared, so saves still overwrite. — The intent's Story 8.10 owns the working-copy compare-and-swap ("the session link includes SavedCase id and base revision"). This story adds the column and its atomic increment.
    - `[low]` `[reject]` (blind) The 503 `busy` response has no client retry. — The contract routes it to the existing failed path. It is retryable by the user, and nothing is mutated. Recorded in deferred-work.
    - `[low]` `[reject]` (blind) A same-Case revision 409 shows the existing-case screen as if the Case were replaced. — Verified: `flow.ts:922` goes to `existing`, which clears the unsent form. The contract chose the existing stale path, and only two tabs editing at once reach it. Refreshing in place belongs to Epic 9's conflict-outcome story. Recorded in deferred-work.
    - `[low]` `[reject]` (blind) The offline guard is incomplete: silent submit, `ChooseSchool`, and `navigator.onLine` being only a hint. — The submit guard is backed by disabled controls and a visible notice. `ChooseSchool` is the row above. Without a client queue, a false "online" just fails as before.
    - `[false]` `[reject]` (blind) The INFO lock measurements are dropped by default logging. — `settings.py:472` sends the root logger at INFO to the console handler, so `mawareeth.case_lock` INFO records are emitted.
    - `[low]` `[reject]` (blind) The lock tests assume PostgreSQL and are timing-sensitive, with no test for the saved-case lock timeout. — The project runs on PostgreSQL only. The 1.5 s margin and the joins are generous, and the saved-case path shares `is_lock_timeout`/`busy_response` with the tested middleware path.
    - `[low]` `[reject]` (blind) `execute` has an unused `command` parameter and loose docs, and a `touch()` inside a failed `run` is not undone. — The name is kept for the future command registry and logging. `touch` only refreshes Django's idle expiry; the guest expiry reads `changed_at`, which is restored, so nothing user-visible changes.
    - `[low]` `[patch]` (blind) Small test smells, starting with `assertIsNotNone(case)` asserting nothing. — Patched: deleted. The rest of this bundle: `_layer_order`'s `next()` cannot miss because layer keys come from `deaths`; the injected `expected_revision` in `send` is by design, and the missing-revision path is tested directly; pinning 0005 in the legacy migration test is required by the new leaf.
    - `[low]` `[reject]` (blind) Expired guest data lingers in logged-in sessions. — Already a recorded 8.9 follow-up in deferred-work. The data is never returned.
    - `[low]` `[reject]` (blind) `api/contracts/interview.json` does not list the new error codes or endpoints. — That file lists field `errorCodes` the web maps to messages. The new top-level `error` codes are handled structurally, not by message key, so nothing reads them from it.
  - **Edge-case hunter**
    - `[low]` `[reject]` (edge) A pre-deploy session with no `changed_at` expires from `started_at`. — The same claim as the blind-hunter row.
    - `[low]` `[patch]` (edge) Start-over accepts `true`/`1.0` and rejects strings with 409. — The same claim as the blind-hunter row; patched there.
    - `[false]` `[reject]` (edge) A malformed restore snapshot gives a 500. — Probed: `read_snapshot` absorbs non-list heirs and deaths, non-dict items, bad ids, orders and genders, and bad deceased and madhab values without raising. The strict comparison then returns 400 `invalid_snapshot`.
    - `[false]` `[reject]` (edge) `remove_impact`/`unmark_impact` raise for an incomplete family. — Probed: with no madhab and a death layer with no heirs, both return without error, because `read_snapshot` drops an empty layer before `family_from_session` sees it.
    - `[low]` `[reject]` (edge) A failed command's `touch()` still refreshes the idle expiry. — The same claim as the blind `execute` row.
    - `[false]` `[reject]` (edge) An older-revision preview leaves `SharePreview` waiting forever. — The effect depends on `revision`, so a revision change aborts the old request first. A fetch started at revision R cannot be answered with an older revision, because the session revision only grows.
    - `[low]` `[reject]` (edge) PATCH with no Case now returns the typed "There is no current case." body instead of DRF's "Not found.". — The status is still 404. The web maps every 404 to `gone` without reading the body.
    - `[low]` `[patch]` (edge) The `not_ready` assertions went through `legacy_fields`, so a stray `presented` would no longer be caught. — Patched: they strip only `revision` and assert it is an int.
    - `[medium]` `[patch]` (edge) No unit test of the offline disable. — Grouped with the intent-alignment offline row; patched there with a Playwright test.
    - `[low]` `[patch]` (edge) The madhab-loop assertion takes its expected revision from the response. — Patched: it asserts previous revision + 1 independently, and that the stored revision matches.

## Design Notes

- **Lock budget (AD-27).** The preview p95 budget is 1 s end to end on 4G. Allow about 300 ms for the network round trip and about 200 ms for the engine and presentation. That leaves 500 ms for any lock wait, which matches the legacy `lock_calculation` budget users already see. A write that waits longer gets an explicit retryable 503 instead of holding a Gunicorn worker toward its 120 s bound.
- **Why roll back the session dict:** the existing mutations validate before they `_save`, but some prune recursively. A deep-copy snapshot restored on any exception makes "no partial mutation" a property of the service rather than of every helper.
- **Why the revision lives in the session and not a table:** the session row is already the PostgreSQL-serialized unit (row lock plus the middleware's transaction). A separate table would add a second write per command without changing the guarantee.
- Example conflict body: `{"error":"conflict","detail":"That case is no longer the current one.","case":{"id":"…","revision":5,"started_at":"…",…}}`.

## Verification

**Commands:**
- `uv run python manage.py test api.test_case_commands api.tests api.test_snapshots reports --noinput` -- expected: OK.
- `uv run python manage.py makemigrations --check --dry-run` -- expected: no changes.
- `cd web; npm test` and `npx tsc --noEmit` -- expected: pass.
- `cd web; npx playwright test e2e/interview.spec.ts` -- expected: pass, if a browser is available locally; otherwise record this as a residual risk.
- `git diff 707fc6b --stat -- engine contracts api/snapshots.py api/fixtures/snapshots` -- expected: empty.

## Auto Run Result

Status: done

**Summary:** `api/case_commands.py` is the one Case command service. Every session-Case mutation goes through `execute`. It checks the expiry, the Case id and `expected_revision` under the existing session row lock, deep-copies the stored Case and runs the command. On success it bumps the revision by exactly one and stamps `changed_at`. On any failure it puts the stored Case back byte for byte.
- **Responses:** a conflict returns 409 `{"error":"conflict", case}`; a missing or invalid revision returns 400 `invalid_revision`.
- **New commands:** `case/heirs/bulk/` adds Heirs all or nothing, with a capacity check first. `case/restore/` is a strict round-trip restore that keeps ids and moves the revision forward.
- **Cascades:** removing a Heir uses `engine.queries.delete_impact`, and un-marking a death uses a before/after diff. Either one needs `confirm_cascade` when it would drop other people.
- **Expiry:** guest expiry is explicit (`changed_at` plus 24 h), and a saved working copy never expires this way.
- **Lock budget:** the session lock waits at most 500 ms (`CASE_LOCK_TIMEOUT_MS`). A timeout returns a retryable 503 `busy`, and each wait logs a redacted `mawareeth.case_lock` record. SavedCase saves lock their row and increment the new `revision` column (migration 0005, default 1) while still writing schema 1.
- **Web:**
  - Previews carry their revision, and the web drops an older one.
  - Every write sends `expected_revision`, and removals send `confirm_cascade=true`.
  - While offline, the interview disables editing and shows a notice.

**Files changed:**
- `api/case_commands.py` (new) -- the command service, the typed errors, bulk add, restore and the impact helpers.
- `api/anonymous_case.py` -- stores `revision`/`changed_at`; adds `is_expired`; `get` hides an expired guest Case.
- `api/views.py`, `api/urls.py` -- every mutation goes through the service, plus the error bodies, the bulk and restore views, the preview `revision`, the expired codes, the start-over revision check and the locked SavedCase save.
- `api/models.py`, `api/migrations/0005_savedcase_revision.py` (new) -- the additive SavedCase revision.
- `mawareeth/middleware.py`, `mawareeth/settings.py` -- the lock timeout, the 503 busy response, the lock records and `CASE_LOCK_TIMEOUT_MS`.
- `reports/views.py` -- the draft PDF returns 404 `expired`.
- `api/test_case_commands.py` (new) -- every I/O matrix row, the threaded lock-timeout and same-revision races, and the migration.
- `api/tests.py`, `api/test_legacy_cases.py`, `reports/tests.py` -- send the revision, and allow the additive key without weakening other checks.
- `web/src/api/case.ts`, `web/src/interview/flow.ts`, `web/src/interview/preview.ts`, `share-preview.tsx`, `start-case.tsx`, `results-view.tsx`, `web/src/i18n/messages.ts` -- revision parse and send, stale-preview discard, offline block, `offlineEditing` text.
- Web tests (`case.test.ts`, `flow.test.ts`, `layers.test.ts`, `madhabs.test.ts`, `preview.test.ts`, `e2e/api.ts`, `e2e/interview.spec.ts`) -- the revision stubs and assertions, plus the stale-preview and offline Playwright tests.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- the 8.9 follow-ups.

**Review findings:** 34 findings from four layers. They ran on Claude, because codex was over its usage limit.
- **Patched (8 entries):** medium 3 (the flow revision assertions; the stale-preview wiring e2e; the offline e2e, which three layers reported) and low 5 (start-over revision validation; the expired-save test; a no-op assertion; the `not_ready` exactness; the tautological madhab-loop assertion).
- **Deferred:** none in frontmatter. Four rejected-but-real lows are recorded in deferred-work: the same-Case conflict UX, pre-deploy guest expiry, no 503 retry, and the results-page School choice while offline.
- **Rejected:** the rest, each with its reason in the Review Triage Log.

**Follow-up review recommended: true.** Three medium entries were patched. The specific unverified risk is that the revision protocol never runs end to end against the real Django API. The Playwright tests use route mocks, and the Python tests drive the API directly. So the agreement between the web client's `expected_revision`/`confirm_cascade` placement (body vs. DELETE query string) and the server's parsing is checked only by separate unit tests on each side.

**Verification:**
- `uv run python manage.py test api.test_case_commands api.tests api.test_snapshots api.test_legacy_cases reports --noinput --exclude-tag slow`: 344 tests, OK (1 skipped), after the patches.
- `makemigrations --check`: no changes.
- `npm test`: 507 pass. `tsc --noEmit` is clean. After `npm run build`, Playwright `e2e/interview.spec.ts` passes 29 of 29.
- `git diff 707fc6b --stat -- engine contracts api/snapshots.py api/fixtures/snapshots`: empty. Every changed file is LF.
- I/O matrix audit: every row has a covering test that ran and passed. The stale-preview row is covered by the `preview.test.ts` `acceptRevision` tests and the new Playwright test.

**Residual risks:**
- The `slow`-tagged engine sweeps were not run in this story. The batch driver runs the full suite.
- PDF rendering stays mocked locally.
- A browser tab open across the deploy gets 400 `invalid_revision` on writes until it reloads.
- The ar and fr `offlineEditing` text needs native review.
