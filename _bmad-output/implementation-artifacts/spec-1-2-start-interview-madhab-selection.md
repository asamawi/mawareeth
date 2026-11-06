---
title: 'Story 1.2: Start Interview + Madhab Selection'
type: 'feature'
created: '2026-11-06'
status: 'done'
baseline_commit: '27215dc169bec21453c709b766a128c9fec010ae'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/web/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A started case has no Madhab, so the interview has nothing to begin from and later stories cannot adapt to a school.

**Approach:** After a case exists, the interview route asks the visitor to confirm the default Madhab or choose another of the five. It stores the choice in the session case through a new write on the case endpoint, then shows the first interview question.

## Boundaries & Constraints

**Always:**
- The choice lives only in the session case, through `api/anonymous_case.py`. A write refreshes the idle expiry for anonymous sessions, and no case rows are created.
- When no Madhab is stored, the selector opens with Hanbali selected, the project owner's chosen default (the main school in Saudi Arabia), and a notice saying so. It is stored only when the visitor continues, never silently.
- The server accepts only `hanafi`, `maliki`, `shafii`, `hanbali` and `jafari`, and returns `madhab` as `null` when none is stored or the stored value is invalid.
- Starting over clears the Madhab. A failed write keeps the visitor's selection on screen.
- All text exists in Arabic, English and French, and the selector works in RTL and by keyboard.

**Ask First:** Any schema migration, new frontend library, or change to `deploy/` or Caddy.

**Never:** Deceased or heir fields (Story 1.3). Questions that vary by Madhab, or any shares or results (Stories 1.3, 1.5 and 1.6). Varying the default by the visitor's region or language. Pushing this work.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New case | Case with `madhab: null` | Selector shown, Hanbali selected, default notice visible, nothing stored yet | N/A |
| Accept default | Continue without changing the selection | `hanbali` stored, first question shown | N/A |
| Choose | `PATCH /api/v1/case/ {"madhab": "hanafi"}`, valid CSRF | `200` with the case including `madhab`, first question shown | N/A |
| Invalid value | Unknown, missing or non-string `madhab`, or non-object body | Case unchanged | JSON `400` |
| No live case | `PATCH` with no case or an expired one | No session row created, UI shows the expired view | JSON `404` |
| Missing or bad CSRF | Anonymous `PATCH` | No state change | JSON `403` |
| Over the limit | Shares the existing 30 writes per hour | No state change | JSON `429`, selection kept, UI asks to retry later |
| API unreachable | Write fails or times out | Selection kept, retry offered | One attempt per click |
| Resume with a choice | `GET` returns a Madhab, visitor resumes | First question shown | N/A |
| Resume without a choice | `GET` returns `madhab: null`, visitor resumes | Selector shown, Hanbali selected | N/A |
| Change choice | Visitor chooses to change on the first question | Selector shown with the current choice selected | N/A |
| Language switch | Selected but not submitted, then language changes | Labels and direction update, selection kept | Storage blocked: selection is lost, page still works |
| Login | Case with a Madhab, then login | Case and Madhab kept | N/A |

</frozen-after-approval>

## Code Map

- `api/anonymous_case.py:14-34` -- sole owner of the session key. `get()` builds its return dict by hand, so it must add `madhab`. Reassign the session key on write, because changing the nested dict does not mark the session modified.
- `api/views.py:37-52` -- `CaseView`. `CsrfProtectedWrites` already covers any unsafe method, and `CaseWriteThrottle` already counts `PATCH`.
- `api/tests.py:135-330` -- `CaseTests` and its CSRF helper. `test_start_creates_a_case_with_a_24_hour_session` pins the case keys to `{'id', 'started_at'}` and must gain `madhab`.
- `web/src/api/case.ts` -- `Case`, `isCase`, `parseCase` (which drops unknown fields) and `startCase` (CSRF probe pattern). Treat a missing `madhab` as `null`, for a tab or slot on the older shape.
- `web/src/interview/flow.ts` -- `runAction`, `View`, `Deps`. `flow.test.ts` shows the stubbed `Deps` pattern.
- `web/src/app/[locale]/interview/start-case.tsx` -- the `started` view holds the placeholder and the only storage notice (`intro`), which must stay visible on the selector for a new case. The focus effect fires on each settled view.
- `web/src/app/[locale]/interview/page.tsx` -- `max-w-xl` is too narrow for the desktop row.
- `web/src/app/[locale]/site-nav.tsx` -- the language switch is a `Link` into another `[locale]`, so expect the page to remount and lose local state. Confirm this in a browser.
- `web/src/i18n/messages.ts` -- typed dictionary. `web/src/api/case.test.ts:131` requires each interview string to differ across locales, so non-string values need a change to that test.
- `_bmad-output/planning-artifacts/ux-design-specification/component-strategy.md:100` and `responsive-design-accessibility.md:50` -- selector: one-line descriptions, vertical on mobile, 2 columns on tablet, a row on desktop.

## Tasks & Acceptance

**Execution:**
- [x] `api/anonymous_case.py` -- add `MADHABS`, `set_madhab()`, and `madhab` in `get()` -- one owner of the session shape.
- [x] `api/views.py` -- add `CaseView.patch` -- matrix responses and the stale-tab `409`, using `set_madhab()`'s `None` as the only source of `404`.
- [x] `api/tests.py` -- test each API row, including list and object values returning `400`, a tampered stored value reading as `null`, start over clearing the choice, expiry refresh, no session row on `404`, malformed JSON answering JSON `400`, the stale-tab `409`, and a logged-in `PATCH` keeping the login session expiry.
- [x] `web/src/api/case.ts`, `web/src/api/case.test.ts` -- add `madhab: MadhabId | null` to `Case`, with `parseCase` reading a missing or unknown value as `null`, and add `setMadhab()` returning `updated`, `gone`, `replaced`, `throttled` or `failed`, sharing the CSRF handling with `startCase`.
- [x] `web/src/interview/madhabs.ts` -- add the ordered id list, the default id, and the selection record and its lifecycle from Design Notes, with storage errors caught and tests -- keeps the selection across a language switch.
- [x] `web/src/interview/flow.ts`, `web/src/interview/flow.test.ts` -- add the choose action, which keeps the view's `resumed` value, the load shortcut for a selection in progress, and the pure functions in Design Notes, and test the matrix rows at flow level.
- [x] `web/src/app/[locale]/interview/madhab-selector.tsx` -- add the radio cards, default notice and cancel button, with an unsaved selection taking priority over the stored choice and the default -- see Design Notes.
- [x] `web/src/app/[locale]/interview/start-case.tsx`, `web/src/app/[locale]/interview/page.tsx` -- route a case by its Madhab to the selector or the first question, with a change action, and widen only what the desktop row needs.
- [x] `web/src/i18n/messages.ts`, `web/src/api/case.test.ts` -- add the text in Design Notes, with `interview.madhabs` keyed by `MadhabId`, and extend the locale test.

**Acceptance Criteria:**
- Given a started case, when the visitor selects a Madhab and continues, then it is stored in the session and the first question appears in the current language and direction, with focus moved to it.
- Given no stored Madhab, when the visitor continues without changing anything, then Hanbali is stored and the first question names it, with the change button available.
- Given the selector, when the language changes, then all labels update and the direction switches.
- Given a keyboard or screen-reader user, when they use the selector, then it is reachable, has visible focus, and announces its label, descriptions and default notice.

## Spec Change Log

**Loop 1 (2026-11-06).** Trigger: review found that a language switch mid-selection landed on the resume-or-start-over prompt, and that resuming wiped an unsent change, against the Language switch row. Also: a stale tab could write a school onto a replaced case, Change had no exit, a failed change depended on untested component logic, and `resumed` was lost on choosing. Amended: Design Notes (Selection in progress, Stale tab, Testable logic, Selector), Tasks, French copy. Known-bad state avoided: a visitor loses or silently stores the wrong school.

KEEP: `set_madhab()` in `api/anonymous_case.py` validating before storing and reassigning the session key. `get()` normalizing an invalid stored value to `null`. `pendingView` keeping the selector on screen while saving. One shared CSRF and timeout helper for `startCase` and `setMadhab`. A throttled or failed write staying on the `started` view with a `notice`. The madhabs helpers taking an injectable storage. Message structure under `interview.madhabs`, and the wording for `firstQuestionHeading`, `firstQuestionText`, `madhabLabel` and `madhabChange` in all locales (English: "First question", "Who has passed away? We will ask for their details in the next step.", "School of law", "Change Madhab"; Arabic: "السؤال الأول", "من هو المتوفى؟ سنسألك عن بياناته في الخطوة التالية.", "المذهب", "تغيير المذهب").

## Design Notes

**Selection in progress:** Keep one `sessionStorage` record per tab, `{caseId, madhab}`, written when the selector opens (`madhab: null` until the visitor picks). While it exists for the live case, a page load goes straight to the selector with that selection, with no resume prompt, whether or not a Madhab is stored. So a language switch or reload in that tab continues the selection. A visit with no record, such as a new tab or a return, still gets the resume prompt. Remove the record only on a successful save, on cancel, on `gone`, and on start over. Resuming must not remove it.

**Change flow:** The selector shows a cancel button when a Madhab is stored, returning to the first question with nothing written. Continuing with the stored school selected also writes nothing.

**Stale tab:** The client sends `{"madhab", "case_id"}`. When `case_id` is present and differs from the live case, answer JSON `409` with the live case and change nothing. The UI then shows the existing-case view. Without `case_id` the matrix row applies unchanged.

**Testable logic:** No `.tsx` is rendered in tests, so keep decisions out of components as pure functions in `web/src/interview/`, table-tested: which screen a view shows, the next change state after a result, the record's lifecycle, and when the default notice shows.

**Selector:** Use native radio inputs in a `<fieldset role="radiogroup">` with a `<legend>`, which gives arrow-key behavior for free. Mark a selected card with a heavier border and the visible radio dot, so color is not the only signal, without shifting layout on selection. Unselected borders meet 3:1 contrast. Descriptions sit inside the `<label>`, so do not also add `aria-describedby` to the radios. Link the default notice to the group with `aria-describedby`, and show it only while the visitor has made no pick, so choosing Hanbali deliberately does not read as a default. Clear a failure notice when a save starts or the selection changes. A failed save keeps focus on the form. Only the card grid is wider than `max-w-xl`; all text, including the `<noscript>` message, keeps that width.

**Default Madhab:** The project owner chose Hanbali on 2026-11-06. This replaces the epic's acceptance criterion for a validation message, because a preselected radio group cannot be empty. `epic-list.md` still states the old criterion. The notice reads:
- English: Hanbali is selected by default. Choose another school if it applies to this case.
- Arabic: تم اختيار المذهب الحنبلي افتراضيًا. اختر مذهبًا آخر إذا كان ينطبق على هذه الحالة.
- French : L'école hanbalite est sélectionnée par défaut. Choisissez une autre école si elle s'applique à ce dossier.

**First question:** Story 1.3 owns the fields. This story shows the question as text, the chosen Madhab and a change button, with no inputs, so it collects no personal data.

**Madhab copy** (neutral, for owner review):

| id | English | Arabic | French |
|----|---------|--------|--------|
| `hanafi` | Hanafi: Sunni school named after Imam Abu Hanifa | الحنفي: مذهب سني ينتسب إلى الإمام أبي حنيفة | Hanafite : École sunnite nommée d'après l'imam Abu Hanifa |
| `maliki` | Maliki: Sunni school named after Imam Malik ibn Anas | المالكي: مذهب سني ينتسب إلى الإمام مالك بن أنس | Malikite : École sunnite nommée d'après l'imam Malik ibn Anas |
| `shafii` | Shafi'i: Sunni school named after Imam al-Shafi'i | الشافعي: مذهب سني ينتسب إلى الإمام الشافعي | Chaféite : École sunnite nommée d'après l'imam al-Shafi'i |
| `hanbali` | Hanbali: Sunni school named after Imam Ahmad ibn Hanbal | الحنبلي: مذهب سني ينتسب إلى الإمام أحمد بن حنبل | Hanbalite : École sunnite nommée d'après l'imam Ahmad ibn Hanbal |
| `jafari` | Jafari: Shia school named after Imam Jafar al-Sadiq | الجعفري: مذهب شيعي ينتسب إلى الإمام جعفر الصادق | Jaafarite : École chiite nommée d'après l'imam Jafar al-Sadiq |

**Disclosure before the multi-school engine:** This story shows no shares and `development` is not deployed until all epics are complete, so no visitor can see a result calculated without Madhab logic. The open decision in `deferred-work.md` stays open for Story 1.5, where numbers first appear.

**Privacy:** A Madhab can indicate religious affiliation. It sits in the anonymous session, so it falls under the owner's 2026-11-06 acceptance of session rows in backups for about 6 months, but that decision discussed personal data in general, not this field. It must not appear in logs or analytics.

## Verification

**Commands:**
- `python manage.py test` -- expected: all pass, with `DJANGO_ENV=production` as CI runs it.
- `python manage.py makemigrations --check` -- expected: no changes.
- `npm run lint && npm run typecheck && npm test && npm run build` in `web/`, then `node scripts/check-export.mjs` -- expected: all pass.

**Manual checks:**
- With the built export at Arabic and English, try accepting the default, each Madhab, reload, language switch with an unsaved selection, change, and start over, using only the keyboard for one full run.

## Suggested Review Order

**Choosing and storing a school**

- Start here: the choose action, including the stale-tab, expired and failed outcomes.
  [`flow.ts:179`](../../web/src/interview/flow.ts#L179)

- The API boundary: `404` only for no case, `409` for a stale tab, `400` for bad input.
  [`views.py:53`](../../api/views.py#L53)

- Sole owner of the session shape; validates first and reassigns the key so the session saves.
  [`anonymous_case.py:47`](../../api/anonymous_case.py#L47)

- An invalid stored value reads as no school, so the visitor is asked again.
  [`anonymous_case.py:23`](../../api/anonymous_case.py#L23)

**The default school**

- The owner's Hanbali default, shown only until the visitor picks; never stored silently.
  [`madhabs.ts:58`](../../web/src/interview/madhabs.ts#L58)

- Check this wording, along with the school descriptions below it.
  [`messages.ts:139`](../../web/src/i18n/messages.ts#L139)

**Keeping a selection in progress**

- Per-tab record that makes a language switch or reload continue instead of prompting.
  [`madhabs.ts:23`](../../web/src/interview/madhabs.ts#L23)

- Load and resume leave the record alone; only a save, cancel, expiry or start over clears it.
  [`flow.ts:126`](../../web/src/interview/flow.ts#L126)

- Cancel returns to the question with nothing written.
  [`flow.ts:98`](../../web/src/interview/flow.ts#L98)

**Screen and keyboard behavior**

- Focus moves only when the screen changes, so a pick after a failed save stays put.
  [`flow.ts:61`](../../web/src/interview/flow.ts#L61)

- Which screen a view shows: selector or first question.
  [`flow.ts:51`](../../web/src/interview/flow.ts#L51)

- Native radios in a labelled group; the notice is linked to the group.
  [`madhab-selector.tsx:57`](../../web/src/app/%5Blocale%5D/interview/madhab-selector.tsx#L57)

- `aria-disabled` while saving, because a natively disabled button would lose focus.
  [`madhab-selector.tsx:108`](../../web/src/app/%5Blocale%5D/interview/madhab-selector.tsx#L108)

- Wires the flow into the page and renders the selector.
  [`start-case.tsx:156`](../../web/src/app/%5Blocale%5D/interview/start-case.tsx#L156)

- Only the card grid is wider; all text keeps the centered column.
  [`page.tsx:19`](../../web/src/app/%5Blocale%5D/interview/page.tsx#L19)

**API client**

- `caseId` is required here, so dropping the stale-tab guard fails the typecheck.
  [`case.ts:165`](../../web/src/api/case.ts#L165)

- One CSRF and timeout helper shared by both writes.
  [`case.ts:103`](../../web/src/api/case.ts#L103)

**Tests**

- The stale-tab rule at the API.
  [`tests.py:421`](../../api/tests.py#L421)

- Table of previous and next views for the focus decision.
  [`flow.test.ts:221`](../../web/src/interview/flow.test.ts#L221)
