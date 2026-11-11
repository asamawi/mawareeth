---
title: 'Story 4.2: Save draft case to a registered account'
type: 'feature'
created: '2026-11-11'
status: 'done'
baseline_commit: '5022b558b86b5df6bbfc02df74ce1636addc2099'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A signed-in user's Save button (story 4.1) is a "coming soon" stub, so a case lives only in the Django session and is lost when the session ends.

**Approach:** Save stores the case inputs (madhab, deceased, heirs, later deaths — as entered, incl. names and estate) under the user's account; shares, amounts and the PDF are never stored and are always regenerated. Saving again updates the same record. A signed-in "My saved cases" page lists records; opening one loads it into the session and goes to the interview page.

## Boundaries & Constraints

**Always:** Store only the input snapshot (`madhab`, `deceased`, `heirs`, `deaths` incl. `same_as`) plus a schema version; strip derived `heir_options`. Every saved-case read/write filters by `owner=request.user`; another user's id returns 404. Save requires an authenticated session and the current session `case_id` (mismatch → 409, like other case writes). Saved records are always draft: the list's status comes from `reports.status` (default `draft`). The save link lives in its own session key bound to the session case uuid, never inside `anonymous_case`. New UI text in ar/en/fr with correct RTL; list and buttons keyboard accessible. Draft PDF download unchanged.

**Ask First:** Changing the `anonymous_case` stored shape or normalization; reusing legacy `calc` models; adding a Problem+JSON handler.

**Never:** Store shares, amounts, preview output or PDFs; anonymize names/estate (FR-19 deferred); rename/delete saved cases; implement Share (4.3–4.5); IndexedDB/local drafts; `useSearchParams` or ungenerated dynamic routes (static export).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First save | Signed in, valid result, click Save | New record for user; session link set; "Saved" notice | Network/5xx → error notice, retry possible |
| Save again | Session linked to user's record | Same record updated (inputs + `updated_at`), no new row | N/A |
| Resume after auth | Return with `?resume=save` | Save runs once, same as clicking | Still anonymous → dialog (4.1) |
| Incomplete case | No madhab, deceased or heirs | 400 `{detail}`, nothing stored | Error notice |
| Stale case | `case_id` ≠ session case | 409, nothing stored | Error notice |
| Foreign link | Session link points to another user's record / deleted id | Treated as unlinked → new record for current user | N/A |
| Anonymous API call | Not signed in | 403, nothing stored | N/A |
| List | Signed in | Own records, newest `updated_at` first: updated date, madhab, heir count, status | Empty → empty-state text |
| Open | Click a listed record | Session case replaced by snapshot (new uuid), link set to it; navigate to interview | Foreign/missing id → 404, stay on list with error |
| List anonymous | Not signed in | Sign-in prompt with `next` back to the list | Never treat session error as signed in |

</frozen-after-approval>

## Code Map

- `api/anonymous_case.py:18` -- session key `anonymous_case`; `start()` `:261`, `get()` `:235` adds `heir_options`, `_save()` `:279` strips them; validators `:84-161`, limits `:43`. Add here: snapshot export, load-from-snapshot (new uuid + `started_at`), and the separate link key (e.g. `saved_case_link = {case_id, saved_id}`), cleared on start/replace.
- `api/views.py:23` `ApiView` (IsAuthenticated, `{detail}` errors, 409/404 patterns `:90`); anonymous writes use `api/permissions.py:5`. `api/urls.py:9` routes; catch-all must stay last `:19`.
- `api/preview.py:179` `preview(case)` and `reports/views.py:31,50` -- regeneration path; unchanged.
- `reports/status.py:5` -- `report_status(case)` extension point, default `draft`.
- `calc/models.py:258` legacy `Calculation` -- do NOT reuse (mixes outputs, no madhab). `api` has no models/migrations yet.
- `mawareeth/middleware.py:62` -- session write locking; respect it.
- `api/tests.py:535` `InterviewHelpers` (CSRF client, start/deceased/heir helpers), `force_login` `:259`.
- `web/src/api/case.ts:328` read, `:359` private `write()` (CSRF, timeout, credentials) -- reuse for new client calls.
- `web/src/app/[locale]/results/auth-gate.tsx:37,56,67-68` Save stub, `:23` resume handling, `:50` auth transition; `auth-gate-state.ts:3` decision; `results-view.tsx:166` mounts AuthGate (pass `case_id`).
- `web/src/app/[locale]/results/page.tsx:7` server-shell + client-view pattern; `web/src/app/[locale]/use-session.ts` auth state; `site-nav.tsx:21,28` signed-in links; `web/src/i18n/paths.ts` `loginHref`.
- `web/src/app/[locale]/interview/start-case.tsx:179` loads session case on mount.
- `web/src/i18n/messages.ts:15` types, nav `:20`, results `:170`, locales from `:251`.

## Tasks & Acceptance

**Execution:**
- [x] `api/models.py`, `api/migrations/0001_initial.py`, `api/admin.py` (optional) -- `SavedCase(owner FK, snapshot JSONField, schema_version, created_at, updated_at)`, index on `(owner, -updated_at)`.
- [x] `api/anonymous_case.py` -- snapshot export, load-from-snapshot, link get/set/clear; start/replace clears link.
- [x] `api/views.py`, `api/urls.py` -- `saved-cases/` GET list / POST save-current (`{case_id}` → 201 created or 200 updated, `{id, updated_at}`); `saved-cases/<int:id>/open/` POST → loads into session, returns case.
- [x] `api/tests.py` -- every matrix row, plus snapshot has no shares/amounts/`heir_options`, round trip keeps deaths and `same_as`, list ordering and owner isolation.
- [x] `web/src/api/saved-cases.ts` (+ `.test.ts`) -- `saveCase`, `listSavedCases`, `openSavedCase` via shared write helper (export it from `case.ts` if needed).
- [x] `web/src/app/[locale]/results/auth-gate.tsx`, `auth-gate-state.ts` (+ test) -- signed-in Save calls `saveCase`; saving/saved/error states; Share stays "coming soon".
- [x] `web/src/app/[locale]/cases/page.tsx`, `cases-view.tsx` -- list, empty, error, signed-out states; Open → `openSavedCase` → `/app/<locale>/interview/`.
- [x] `web/src/app/[locale]/site-nav.tsx`, `web/src/i18n/paths.ts`, `web/src/i18n/messages.ts` -- signed-in "My saved cases" link; new strings ar/en/fr.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- entry: FR-19 anonymization not implemented; names and estate stored as entered.

**Acceptance Criteria:**
- Given a saved case, when the user later signs in on another device and opens it from the list, then the interview shows the same madhab, deceased, heirs and later deaths, and the results recompute.
- Given any saved record, then the database row contains no shares, fractions, amounts or PDF bytes.
- Given `npm run build`, then the static export includes `/app/<locale>/cases/` with no new warnings.

## Design Notes

Link example: session `saved_case_link = {"case_id": "<session uuid>", "saved_id": 42}`. Save updates `saved_id` only if `case_id` matches the current session case and the record is owned by the user; otherwise it creates. Opening a record writes a fresh session case (new uuid) and links it, so later saves update that record.

## Verification

**Commands:**
- `uv run python manage.py test api reports calc --noinput` (local PG18) -- expected: pass.
- `cd web; npm test; npm run lint; npm run build` -- expected: pass.

**Manual checks (if no CLI):**
- In ar: save from results, see "Saved"; open "My saved cases", open the record, interview is filled and RTL.

## Suggested Review Order

**Saving under the account**

- Entry point: save validates, finds the session-linked owned row or creates one, stores inputs only
  [`views.py:237`](../../api/views.py#L237)

- Link honoured only when bound to this session case and owned by the user
  [`views.py:246`](../../api/views.py#L246)

- Snapshot whitelist: madhab, deceased, heirs, deaths incl. `same_as`; no shares or options
  [`anonymous_case.py:655`](../../api/anonymous_case.py#L655)

- Link lives in its own session key; starting or replacing a case clears it
  [`anonymous_case.py:672`](../../api/anonymous_case.py#L672)

- Model: owner FK, JSON snapshot, schema version, timestamps
  [`models.py:5`](../../api/models.py#L5)

**Listing and reopening**

- List skips rows this version cannot open, status via the report-status extension
  [`views.py:228`](../../api/views.py#L228)

- Open: owner-scoped 404, rejects unknown schema, loads a fresh session case and links it
  [`views.py:259`](../../api/views.py#L259)

- Loading starts a new uuid, then writes the snapshot
  [`anonymous_case.py:683`](../../api/anonymous_case.py#L683)

**Session write lock**

- Saved-case writes now take the same per-session lock as case writes
  [`middleware.py:47`](../../mawareeth/middleware.py#L47)

**Frontend**

- Signed-in Save (click, resume, dialog close) calls the real save
  [`auth-gate.tsx:15`](../../web/src/app/[locale]/results/auth-gate.tsx#L15)

- Pure decision: only authenticated save persists; share stays a notice
  [`auth-gate-state.ts:14`](../../web/src/app/[locale]/results/auth-gate-state.ts#L14)

- My saved cases page: list, empty, error, signed-out; Open goes to the interview
  [`cases-view.tsx:24`](../../web/src/app/[locale]/cases/cases-view.tsx#L24)

- Client calls reuse the shared CSRF write helper
  [`saved-cases.ts:5`](../../web/src/api/saved-cases.ts#L5)

- Signed-in nav link
  [`site-nav.tsx:39`](../../web/src/app/[locale]/site-nav.tsx#L39)

**Tests and strings**

- Save, update, cross-device open, owner isolation, schema, lock tests
  [`tests.py:3035`](../../api/tests.py#L3035)

- New strings in ar/en/fr
  [`messages.ts:17`](../../web/src/i18n/messages.ts#L17)
