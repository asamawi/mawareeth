---
title: 'Story 1.3: Deceased Info + Add Heirs via Guided Interview Form'
type: 'feature'
created: '2026-11-06'
status: 'done'
baseline_commit: '3a0ab0db756c5b3ab1348490df0d12b233caae13'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/web/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After choosing a Madhab the visitor reaches a placeholder question, so the case holds no family data for the tree (1.4), preview (1.5) or fiqh checks (1.6) to work from.

**Approach:** Replace the placeholder with a deceased form, then a repeating heir form with a list of added heirs. Both are stored in the session case and can be corrected, and heirs can be removed.

## Boundaries & Constraints

**Always:**
- Answers live only in the session case, owned by `api/anonymous_case.py`. A write refreshes the idle expiry for anonymous sessions, and no case rows are created.
- Deceased: `gender` (`male` or `female`) is required, and `estate` is optional. "Bequest" means the whole estate. It is a positive amount with up to 15 whole digits and 2 decimals, sent as a string, with no currency. Eastern Arabic digits are accepted on input.
- Heir: `relationship` is required, from the 22 ids in Design Notes, the same for every Madhab. `name` is optional, trimmed, up to 100 characters, with no control characters. An unnamed heir is labelled by relationship. `gender` is derived from the relationship on the server and is never asked.
- A case holds at most 50 heirs, enforced on the server.
- Every new write requires `case_id` and answers `409` with the live case when it does not match. Rules are validated on both client and server, and nothing invalid is stored.
- Changing the Madhab keeps the answers. Starting over clears them, and now needs an explicit confirmation.
- A failed or throttled write keeps what the visitor typed on screen. All text exists in Arabic, English and French, and the forms work in RTL and by keyboard, with field errors tied to their inputs.
- Names and amounts never appear in logs or analytics.
- The case write limit becomes 120 per hour per client.

**Ask First:** Any schema migration, new frontend library, or change to `deploy/` or Caddy.

**Never:** The deceased's name or date. Fiqh checks, such as two fathers or a husband of a male deceased (1.6). Questions that vary by Madhab. Tree rendering (1.4). Shares, percentages or kirat (1.5 and later). The heir "deceased" toggle or manasikhat. A review or calculate step. Pushing this work.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Save deceased | `PUT /case/deceased/` with `case_id`, `gender`, optional `estate` | `200` with the case, heir screen shown | N/A |
| Missing or bad deceased field | No gender, or estate zero, negative, a number type, over the limit or with 3 decimals | Field-level message, nothing stored | JSON `400` with `errors` by field |
| Add heir | `POST /case/heirs/` with `case_id`, `relationship`, optional `name` | `201` with the case, form cleared, focus on relationship, addition announced | N/A |
| Heir before deceased | `POST` with no stored deceased | Nothing stored | JSON `400`, `errors.case` |
| Bad heir field | Unknown relationship, non-string or over-long name, control characters | Field-level message, nothing stored | JSON `400` with `errors` by field |
| 51st heir | `POST` with 50 stored | Nothing stored, limit message shown, input kept | JSON `400`, `errors.heirs` |
| Edit heir | `PUT /case/heirs/<id>/` | `200` with the case, gender re-derived, id kept | N/A |
| Remove heir | `DELETE /case/heirs/<id>/`, after an inline confirm | `200` with the case, heir gone | N/A |
| Heir no longer exists | `PUT` or `DELETE` with an unknown id, live case | List refreshed from the response, notice shown | JSON `404` with `case` set |
| No live case | Any new write with no case or an expired one | No session row created, expired view shown | JSON `404` with `case: null` |
| Stale tab | `case_id` differs from the live case | Nothing stored, existing-case view shown | JSON `409` with live case |
| Missing `case_id` or non-object body | Any new write | Nothing stored | JSON `400` |
| Bad CSRF | Any new write | Nothing stored | JSON `403` |
| Over the limit | 121st write in an hour | Nothing stored, input kept, retry-later notice | JSON `429` |
| API unreachable | Write fails or times out | Input kept, retry offered | One attempt per click |
| Tampered stored data | Invalid deceased or heir in the session | Invalid deceased reads as `null`, invalid heirs are omitted | N/A |
| Change Madhab | Case with answers | Answers kept, returns to the same screen | N/A |
| Language switch or reload | Form half filled in this tab | Same screen with values kept, no resume prompt | Storage blocked: values lost, page works |
| New tab or return | Case with answers, no record in this tab | Resume prompt, then heir screen | N/A |
| Start over | Visitor chooses it on the existing-case view | Confirmation first; cancel changes nothing, confirm replaces the case | N/A |
| Login | Case with answers, then login | Case and answers kept | N/A |

</frozen-after-approval>

## Code Map

- `api/anonymous_case.py:24-66` -- sole owner of the session shape. `get()` builds its dict by hand and normalizes invalid values; `set_madhab` shows the validate, `StaleCase`, copy, reassign, `touch` pattern to reuse.
- `api/views.py:36-71` -- `CaseView`. New views take the same `permission_classes`, `throttle_classes` and `never_cache`. `patch` shows the `400`, `409` and `404` shapes.
- `api/urls.py:9-12` -- add routes above the catch-all, which must stay last.
- `mawareeth/settings.py:318` -- `case_write` rate.
- `api/tests.py:135-175` -- `CaseTests` helpers (`csrf`, `stored`, `remaining`). `test_start_creates_a_case_with_a_24_hour_session` pins the case keys. Check for tests that assume 30 writes.
- `calc/models.py:974-1596` -- the 22 `Heir` subclasses that the relationship ids map to. Read-only: this story does not connect to the engine.
- `web/src/api/case.ts:39-61,103-140,165-189` -- `parseCase` must tolerate the older shape. `write()` posts to one fixed URL and needs a URL parameter. `setMadhab` is the result-mapping pattern.
- `web/src/interview/flow.ts` -- `View`, `screenOf`, `shouldFocus`, `runAction`, `choose`. `flow.test.ts` shows the stubbed `Deps` pattern.
- `web/src/interview/madhabs.ts:15-65` -- injectable, error-swallowing per-tab store to copy for the form record.
- `web/src/app/[locale]/interview/start-case.tsx:125-140,172-189` -- `existing` view (start over) and the placeholder this story replaces. `perform()` aborts the previous call, so block a second submit while saving. The wrapper's `[&>*:not(form)]` rule keeps non-form children narrow.
- `web/src/app/[locale]/interview/madhab-selector.tsx` -- markup, focus and `aria-disabled` conventions for the new forms.
- `web/src/i18n/messages.ts`, `web/src/api/case.test.ts:131-150` -- typed dictionary and the locale test.
- `_bmad-output/planning-artifacts/ux-design-specification/ux-consistency-patterns.md:60-75` -- full-width inputs, validation on blur, primary button at the bottom.

## Tasks & Acceptance

**Execution:**
- [x] `api/anonymous_case.py` -- add `RELATIONSHIPS` (id to gender), `MAX_HEIRS`, `FieldErrors`, `set_deceased()`, `add_heir()`, `update_heir()`, `remove_heir()`, and return `deceased` and `heirs` from `get()` -- one owner of the shape and its rules.
- [x] `api/views.py`, `api/urls.py` -- add `DeceasedView` and `HeirsView`/`HeirView` under `/api/v1/case/` -- matrix responses, each write returning the whole case.
- [x] `mawareeth/settings.py` -- set `case_write` to `120/hour` -- owner decision 2026-11-06.
- [x] `api/tests.py` -- test each API row, including `set_madhab` keeping answers, `start` clearing them, expiry refresh, no session row on `404`, a logged-in write keeping the login expiry, and the 120 limit.
- [x] `web/src/api/case.ts`, `web/src/api/case.test.ts` -- extend `Case`, give `write()` a URL, add `saveDeceased`, `addHeir`, `updateHeir`, `removeHeir` with required `caseId`.
- [x] `web/src/interview/answers.ts`, `web/src/interview/answers.test.ts` -- add validators, digit normalization, amount and heir-label formatting, and the form record store, table-tested -- no form library.
- [x] `web/src/interview/flow.ts`, `web/src/interview/flow.test.ts` -- add the screens, save and remove actions, start-over confirmation and focus rules, and test the matrix at flow level.
- [x] `web/src/app/[locale]/interview/deceased-form.tsx`, `heir-form.tsx`, `heir-list.tsx` -- add the forms and list per Design Notes.
- [x] `web/src/app/[locale]/interview/start-case.tsx` -- route by screen, replace the placeholder, add the confirmation, keep the change-Madhab button.
- [x] `web/src/i18n/messages.ts`, `web/src/api/case.test.ts` -- add text, with `interview.relationships` keyed by id, remove `firstQuestionText`, extend the locale test.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- append a release-blocker entry for overlapping writes from two tabs, which can now lose an answer -- owner decision 2026-11-06.

**Acceptance Criteria:**
- Given a chosen Madhab and no deceased, when the visitor saves a gender with or without an estate, then it is stored and the heir screen appears with focus moved to it.
- Given a saved deceased, when the visitor adds an heir, then the heir appears in the list by name or relationship and the form is ready for the next one.
- Given missing or invalid fields, when the visitor leaves a field or submits, then each invalid field shows its message, is marked `aria-invalid`, submit moves focus to the first invalid field, and nothing is saved.
- Given a saved deceased or heir, when the visitor edits and saves, then the change is stored and shown, and cancel changes nothing.
- Given a saved estate, when it is displayed, then it shows as an amount formatted for the current language, with no percentage or kirat.
- Given a keyboard or screen-reader user, when they complete the whole flow, then every control is reachable with visible focus and each heir added, updated or removed is announced.

## Spec Change Log

## Design Notes

**Bequest change to the epic:** The owner decided on 2026-11-06 that "bequest" means the whole estate, which is always 100% or 24 kirat of itself. The derived percentage and kirat move to the heir share display at `epic-list.md:281`. `epic-list.md:90` still states the old criterion.

**Session shape:** `deceased: {gender, estate}` or `null`, and `heirs: [{id, relationship, gender, name}]`, where `id` is a UUID hex, `estate` a string or `null`, and `name` a string or `null`. Errors are `{"errors": {"<field>": "<code>"}}`, and the client maps each code to text.

**Form record:** One `sessionStorage` record per tab, `{caseId, form, heirId, values}`, written when a form opens and on each change. Like the 1.2 selection record, it makes a page load continue without the resume prompt. Saving a new heir resets it to a blank heir form. It clears on start over and `gone`, and stays out of logs. It can hold a name or amount, and it lasts only as long as the tab.

**Screens:** No Madhab or changing goes to the selector, no deceased or editing goes to the deceased form, and otherwise the heir screen shows, with a deceased summary, its edit button, the heir list, the add form and the change-Madhab button. Editing an heir uses the same form, filled in, with a cancel button.

**Forms:** Use native `<select>` and `<input>` with visible labels, and `inputMode="decimal"` for the estate. Gender uses native radios as in the selector. Each error is linked with `aria-describedby`. Keep heir additions announced in one `aria-live="polite"` region, and let the amount sit in `<bdi>`. Removal confirms inline, on the row. The estate hint reads: "Optional. You can add this later."

**Relationships** (for owner review; "Uncle" is the father's full brother, and "half" means the same father only, matching `calc/models.py`):

| id | gender | English | Arabic | French |
|----|--------|---------|--------|--------|
| `father` | male | Father | أب | Père |
| `mother` | female | Mother | أم | Mère |
| `husband` | male | Husband | زوج | Époux |
| `wife` | female | Wife | زوجة | Épouse |
| `son` | male | Son | ابن | Fils |
| `daughter` | female | Daughter | بنت | Fille |
| `son_of_son` | male | Son's son | ابن الابن | Fils du fils |
| `daughter_of_son` | female | Son's daughter | بنت الابن | Fille du fils |
| `grandfather` | male | Grandfather | جد | Grand-père |
| `grandmother` | female | Grandmother | جدة | Grand-mère |
| `brother` | male | Full brother | أخ شقيق | Frère germain |
| `sister` | female | Full sister | أخت شقيقة | Sœur germaine |
| `paternal_brother` | male | Half-brother (same father) | أخ لأب | Frère consanguin |
| `paternal_sister` | female | Half-sister (same father) | أخت لأب | Sœur consanguine |
| `maternal_brother` | male | Half-brother (same mother) | أخ لأم | Frère utérin |
| `maternal_sister` | female | Half-sister (same mother) | أخت لأم | Sœur utérine |
| `son_of_brother` | male | Full brother's son | ابن الأخ الشقيق | Fils du frère germain |
| `son_of_paternal_brother` | male | Half-brother's son (same father) | ابن الأخ لأب | Fils du frère consanguin |
| `uncle` | male | Paternal uncle (father's full brother) | عم شقيق | Oncle paternel germain |
| `paternal_uncle` | male | Paternal uncle (father's half-brother) | عم لأب | Oncle paternel consanguin |
| `son_of_uncle` | male | Son of father's full brother | ابن العم الشقيق | Fils de l'oncle germain |
| `son_of_paternal_uncle` | male | Son of father's half-brother | ابن العم لأب | Fils de l'oncle consanguin |

**Privacy:** Names and estate amounts join the session data the owner accepted on 2026-11-06, kept in encrypted backups for about 6 months. Collecting no deceased name and making heir names optional keeps this to the minimum.

**Overlapping writes:** Each tab sends one write at a time, and `case_id` blocks writes to a replaced case. Only truly simultaneous writes from two tabs can lose an answer, and that stays deferred as a release blocker.

## Verification

**Commands:**
- `DJANGO_ENV=production python manage.py test` -- expected: all pass.
- `python manage.py makemigrations --check` -- expected: no changes.
- `npm run lint && npm run typecheck && npm test && npm run build` in `web/`, then `node scripts/check-export.mjs` -- expected: all pass.

**Manual checks:**
- With the built export at Arabic and English: save the deceased with and without an estate, add, edit and remove heirs, submit invalid fields, switch language mid-form, reload, change Madhab, and confirm and cancel start over, using only the keyboard for one full run.

## Suggested Review Order

**Storing answers on the server**

- Start here: the one owner of the case shape; every write validates, then reassigns the session key.
  [`anonymous_case.py:269`](../../api/anonymous_case.py#L269)

- Refuses surrogates and bidi controls, keeps ZWNJ and ZWJ, and treats invisible names as empty.
  [`anonymous_case.py:129`](../../api/anonymous_case.py#L129)

- Canonical amounts: leading zeros stripped, comma decimals accepted, three decimals still refused.
  [`anonymous_case.py:77`](../../api/anonymous_case.py#L77)

- Damaged stored answers read as absent instead of breaking the page.
  [`anonymous_case.py:174`](../../api/anonymous_case.py#L174)

- Shared write path: required `case_id` and the matrix's 400, 404 and 409 answers.
  [`views.py:81`](../../api/views.py#L81)

- DELETE reads `case_id` from the query, because proxies may drop request bodies.
  [`views.py:132`](../../api/views.py#L132)

**Protecting a visitor's data**

- A stale tab can no longer replace a newer case it never showed.
  [`views.py:46`](../../api/views.py#L46)

- Start over now asks first, and is reachable from every started screen.
  [`flow.ts:227`](../../web/src/interview/flow.ts#L227)

- After a failed add, one read shows whether the heir was stored, avoiding duplicates.
  [`flow.ts:643`](../../web/src/interview/flow.ts#L643)

- Per-tab form record, falling back to memory when storage is blocked.
  [`answers.ts:259`](../../web/src/interview/answers.ts#L259)

- Starting an edit parks a half-typed new heir; finishing it restores the draft.
  [`flow.ts:298`](../../web/src/interview/flow.ts#L298)

**The interview flow**

- Maps every write result to errors, focus, announcements and notices.
  [`flow.ts:652`](../../web/src/interview/flow.ts#L652)

- Which screen shows: selector, deceased form or heirs.
  [`flow.ts:140`](../../web/src/interview/flow.ts#L140)

- The heir form rebuilds only when it must be cleared, so other actions keep typing.
  [`flow.ts:197`](../../web/src/interview/flow.ts#L197)

- Client rules mirror the server's, checked before anything is sent.
  [`answers.ts:37`](../../web/src/interview/answers.ts#L37)

- Amounts format through BigInt, so large estates never round in older browsers.
  [`answers.ts:162`](../../web/src/interview/answers.ts#L162)

**Screens and wording**

- Wires the flow to the forms and adds the start-over control.
  [`start-case.tsx:282`](../../web/src/app/%5Blocale%5D/interview/start-case.tsx#L282)

- Gender validates only when focus leaves the whole radio group.
  [`deceased-form.tsx:65`](../../web/src/app/%5Blocale%5D/interview/deceased-form.tsx#L65)

- Unnamed heirs get a number only when two would otherwise read the same.
  [`answers.ts:192`](../../web/src/interview/answers.ts#L192)

- Check this wording: all three languages, including relationship names and the "Total estate" label.
  [`messages.ts:129`](../../web/src/i18n/messages.ts#L129)

**Tests and config**

- Shared contract both test suites read, so client and server cannot drift apart.
  [`interview.json:1`](../../api/contracts/interview.json#L1)

- Python side of the contract check.
  [`tests.py:682`](../../api/tests.py#L682)

- TypeScript side of the contract check.
  [`answers.test.ts:395`](../../web/src/interview/answers.test.ts#L395)

- The new write limit, your decision on 2026-11-06.
  [`settings.py:318`](../../mawareeth/settings.py#L318)
