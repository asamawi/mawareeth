---
title: 'Story 1.5: Real-Time Share Preview from Supported Engine Cases'
type: 'feature'
created: '2026-11-07'
status: 'done'
baseline_commit: 'df6322a8eda0ca5d43bf42345f7dabcc946be98d'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/web/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A visitor adding heirs sees the family grow but not what it means, and has to finish the whole interview before seeing any share.

**Approach:** After each saved change on the heir screen, ask a new read endpoint for shares under the case's chosen school and show them. The endpoint runs the engine in a transaction that is always rolled back. Numbers appear only for a case the engine accepts, and never out of date.

## Boundaries & Constraints

**Always:**
- Numbers come only from `Calculation.compute(madhab=...)`. Nothing in the frontend calculates a share.
- The engine run is always rolled back, so a preview leaves no database rows. It does not touch the session or refresh its expiry.
- Names never reach the engine, logs or analytics. The engine receives relationships, the deceased's gender and a placeholder estate.
- Amounts use the session's estate and the exact fraction, rounded half-up to 2 decimals, and appear only when an estate was entered. There is no currency.
- A preview is shown only while it matches the current saved case. When the case changes, its numbers are replaced at once by a waiting state, and an in-flight request is dropped.
- A preview runs after a successful save, never while typing or after a failed save. It never moves focus or blocks any control.
- The estate hint in all three languages asks for the amount after debts, funeral costs and bequests.
- All new text exists in Arabic, English and French, and the display works in RTL from 320px, in dark mode and forced colors, with no meaning relying on color alone. Fractions stay left to right inside `bdi`.
- The preview says which school it follows and that it is not a final ruling.

**Ask First:** Any schema migration. Any new frontend library. Any change to engine rules or refusals. Showing preview numbers for a case the engine refuses.

**Never:** Shares on tree nodes, fiqh citations or proof (Story 2.2). Fiqh validation messages or hiding blocked heirs (Story 1.6). Saving a result. Results-page changes. Jafari rules. Pushing this work.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Not ready | No heirs yet | No numbers, a short prompt | N/A |
| Add heir, estate entered | Hanbali: wife, son, estate 8000 | Wife 1/8, 12.5%, 1,000; son 7/8, 87.5%, 7,000 | N/A |
| No estate | Same, no estate | Fractions and percentages, no amounts | N/A |
| Two of a type | 2 wives, son | Each wife 1/16; labels match the list | N/A |
| School differs | Grandfather, brother | Hanbali 1/2 each; Hanafi 1 and 0 | N/A |
| Blocked heir | Father, brother | Brother shows no share, in words | N/A |
| Madhab changed | Saved Hanafi after Hanbali | Waiting, then Hanafi numbers | N/A |
| Refused: Jafari | Any heirs | "Unavailable" text, no numbers, interview continues | N/A |
| Refused: radd | Maliki: mother, daughter | Unavailable, says the classical position gives the remainder to the treasury | N/A |
| Refused: grandmother | Hanafi: father, grandmother | Unavailable, says her line is not recorded | N/A |
| Refused: Malikiyya | Maliki family per Story 2.1 | Unavailable text | N/A |
| Impossible family | Male deceased with husband, 2 fathers, 5 wives | Unavailable, no numbers | Reason `invalid_family` |
| Spouse alone | Wife | 1/4 and a line for the unallocated remainder | N/A |
| Slow or failed | Timeout after 5s, network, `5xx` | Graceful message and a retry button, no numbers | One attempt per click |
| Throttled | `429` | Message, no numbers, interview continues | Next save tries again |
| Case replaced in another tab | `409` | No numbers from the other case | Existing handling on next save |
| No case | `404` | No numbers | Existing handling on next save |
| Save in flight | Heir being saved | Earlier numbers replaced only when the save succeeds | Failed save keeps the matching preview |
| 50 heirs on a phone | Any school | List wraps with no horizontal page scroll | N/A |

</frozen-after-approval>

## Code Map

- `calc/models.py` -- `Calculation.compute(madhab)` returns exact fractions by heir pk and raises `UnsupportedCase`. `money()` rounds half-up. Read-only here.
- `calc/schools.py` -- reason codes. `calc/tests.py` `HEIR_SEX`, `build_case` -- how a case is built without the `add_*` methods, which `compute()` does not need.
- `api/anonymous_case.py` -- `RELATIONSHIPS`, `get()`. Reads never touch the session.
- `api/views.py:81-113` -- `CaseWriteView.write` and its `409` and `404` bodies, the shapes to match. `api/urls.py` -- add the route before the catch-all.
- `api/throttling.py`, `mawareeth/settings.py:318` -- `CaseWriteThrottle` never counts reads, so preview needs its own scope.
- `api/contracts/interview.json`, `api/tests.py:30` -- shared contract between Python and TypeScript.
- `web/src/api/case.ts:175-198` -- `fetchCase`, the read to mirror, including its timeout and abort.
- `web/src/interview/answers.ts` -- `heirLabels`. `web/src/app/[locale]/interview/heir-list.tsx` -- `formatEstate`, list patterns and the live region.
- `web/src/app/[locale]/interview/start-case.tsx:369-423` -- heir screen. Order becomes tree, form, preview, list.
- `web/src/i18n/messages.ts:43,139,268,400` -- `estateHint`. `web/src/api/case.test.ts` -- locale test.

## Tasks & Acceptance

**Execution:**
- [x] `api/preview.py` -- add `preview(case)`: reject impossible families, build rows without names inside `transaction.atomic()`, always roll back, and return shares by heir id or a reason code -- the one bridge between session and engine.
- [x] `api/views.py`, `api/urls.py`, `api/throttling.py`, `mawareeth/settings.py` -- add `GET /api/v1/case/preview/?case_id=`, `AllowAny`-style like `CaseView`, `never_cache`, with a `case_preview` throttle of 300/hour per client. An unexpected engine error logs without case data and answers `503`.
- [x] `api/contracts/interview.json`, new `api/contracts/preview-fixtures.json` -- add reason codes and fixtures per Design Notes -- one source of truth for both sides.
- [x] `api/tests.py` -- cover the matrix's API rows and these: no rows remain after any outcome, the session is not modified, names are absent from what the engine receives, every relationship id maps to an engine class, throttling, and responses equal direct `compute()` for each fixture.
- [x] `web/src/api/case.ts`, `web/src/api/case.test.ts` -- add `fetchPreview`, one attempt that never throws, returning a typed result, and validate the body strictly.
- [x] `web/src/interview/preview.ts`, its test -- add pure `previewKey(case)` and `previewRows()` -- staleness and display checkable without a browser, tested against the shared fixtures.
- [x] `web/src/app/[locale]/interview/share-preview.tsx`, `start-case.tsx` -- render the states, request after a save changes `previewKey`, and abort on change or unmount.
- [x] `web/src/i18n/messages.ts`, `web/src/api/case.test.ts` -- add preview text, one per reason, and change `estateHint` in all three languages.
- [x] `web/scripts/check-export.mjs` -- confirm no change is needed; routes are unchanged.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- append shares on tree nodes, and browser tests for this screen.

**Acceptance Criteria:**
- Given a supported case, when a heir is added or edited and saved, then shares from the engine appear without a page reload.
- Given a refused case, when the preview is requested, then the visitor sees why in plain words, no numbers, and can continue.
- Given a failure or timeout, when numbers were showing, then they are gone, a message shows, and the interview still works.
- Given each shared fixture, when tests run, then the API response equals the engine's output and the displayed rows match it.
- Given a preview request of any outcome, when it ends, then no `Calculation`, `Person` or `Marriage` rows were added.
- Given a keyboard or screen-reader user, when the preview updates, then focus stays put and one polite status announces it.

## Spec Change Log

- Review found that a preview was compared only with what the tab asked for, so another tab's saved change could show numbers for a different family as current. Responses now echo a name-free `basis`, and a mismatch shows no numbers. Keep this check.
- Also from review: 404 and 409 have separate messages, an unknown reason code shows the generic text, and the estate label now agrees with the hint.

## Design Notes

**Response:**

```json
{ "status": "available", "madhab": "hanbali",
  "shares": [{ "heir_id": "a1", "numerator": 1, "denominator": 8, "blocked": false, "amount": "1000.00" }],
  "unallocated": null }
{ "status": "unavailable", "madhab": "jafari", "reason": "school_not_supported" }
{ "status": "not_ready" }
```

`unallocated` is `{ "numerator", "denominator" }` for a spouse alone. `amount` is null with no estate. The frontend works out percentages for display only, to one decimal.

**Impossible families**, as reason `invalid_family`: husband with a male deceased, wife with a female deceased, more than one husband, father, mother or grandfather, more than 4 wives. These are stop-gaps until Story 1.6.

**Placeholder estate:** the engine's `estate` field is an integer and the session's may have decimals or 15 digits, so the engine always gets 1 and amounts are worked out here from the exact fraction.

**Staleness:** `previewKey` joins the case id, madhab, deceased gender and estate, and each heir's id and relationship. It excludes names, because a rename changes no share and needs no request. A result is shown only if its key equals the current one.

**Fixtures:** each holds a case, the expected response and the expected display rows, covering every available and refused row above. Python and TypeScript both read the file, so neither side can drift.

**Speed:** the 200ms target is unverified on Postgres, and each preview runs about 65 to 260 queries. `development` does not reach CI under the no-push rule, so measure it locally per Verification. If 6 heirs misses the target, say so before merging rather than tuning here.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` in `web/`, then `node scripts/check-export.mjs` -- expected: all pass.
- `DATABASE_URL='sqlite://:memory:' DJANGO_ENV=test .venv/Scripts/python.exe manage.py test` -- expected: all pass.
- The same suite with CI's production settings, after `collectstatic` -- expected: all pass.

**Manual checks:**
- With the built export in Arabic and English at 320px and desktop: add, edit, remove, change school, a refused case, a failed request, dark mode, forced colors and one keyboard-only run.
- With Docker running, time the endpoint on Postgres for 6 and 50 heirs and record the result here.

**Manual check results, 2026-11-07:** run once in headless Edge against a local server on SQLite, with a throwaway script that is not in the repo. Passed: English at desktop and Arabic at 320px; add; school change; a Jafari refusal; a failed request and retry; another tab changing the family; focus staying in the form; the status text; no horizontal scroll at 320px; dark mode by screenshot. Forced colors was only emulated, and its screenshot looks the same as light mode, so it is not a real check. Not run: edit and remove through this screen, a keyboard-only run, French, 50 heirs on a phone, screen readers, and the Postgres timing, because Docker is not running here.

## Suggested Review Order

**The bridge to the engine**

- Start here: builds nameless rows, runs the engine, and always rolls back.
  [`preview.py:103`](../../api/preview.py#L103)

- Stop-gap for impossible families until Story 1.6.
  [`preview.py:57`](../../api/preview.py#L57)

- Status codes, and a 503 log with no case data.
  [`views.py:162`](../../api/views.py#L162)

**Never showing out-of-date numbers**

- The name-free record of what was actually calculated.
  [`preview.py:72`](../../api/preview.py#L72)

- A response for a different family becomes "changed in another tab".
  [`preview.ts:42`](../../web/src/interview/preview.ts#L42)

- A result shows only for the current key and attempt.
  [`preview.ts:106`](../../web/src/interview/preview.ts#L106)

**The screen**

- States, the announcement and retry; no test renders this component.
  [`share-preview.tsx:41`](../../web/src/app/%5Blocale%5D/interview/share-preview.tsx#L41)

- Placed after the form, so a phone keeps the next question in view.
  [`start-case.tsx:414`](../../web/src/app/%5Blocale%5D/interview/start-case.tsx#L414)

- Strict parsing, except that unknown reasons stay readable.
  [`case.ts:479`](../../web/src/api/case.ts#L479)

**Contract and tests**

- Read by both Python and TypeScript, so the two cannot drift.
  [`preview-fixtures.json:1`](../../api/contracts/preview-fixtures.json#L1)

- No rows left, session untouched, no names, and each fixture equals the engine.
  [`tests.py:1236`](../../api/tests.py#L1236)
