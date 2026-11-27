---
title: 'Story 11.6: Explain the estate input and identify user-supplied facts'
type: 'feature'
created: '2026-11-28'
baseline_commit: '12a8bc8c47e6797d5e91f0a9d9f43765be255d3f'
baseline_revision: '12a8bc8c47e6797d5e91f0a9d9f43765be255d3f'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
  - '{project-root}/web/AGENTS.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The Interview's estate hint says debts, funeral costs and bequests come out first, but not that jointly owned or beneficiary-designated assets may fall outside the estate. Neither Full results nor the draft PDF says that the family and the amount were typed in by the user and not checked. The PDF also never shows the calculation-aid / not-a-fatwa disclaimer text; it shows only "Draft / not certified".

**Approach:** Extend the existing estate hint in ar, en and fr. Add two catalog notices, one for "family and amount supplied" and one for "family supplied, no amount". Show the matching one next to the disclaimer on Full results and in the draft PDF. Also add the disclaimer itself to the PDF.

## Boundaries & Constraints

**Always:**
- **Estate hint:** keep the existing `<p id="deceased-estate-hint">` (always rendered, linked through `aria-describedby`, shown before any input and while an estate error shows). Change only the `estateHint` text in `web/src/i18n/messages.ts` for ar, en and fr, to this exact text:
  - en: `Optional; you can add it later. Enter the amount left after debts, funeral costs and bequests. Jointly owned assets and assets with a named beneficiary may not form part of the estate.`
  - fr: `Facultatif ; vous pourrez l'ajouter plus tard. Indiquez le montant restant après les dettes, les frais funéraires et les legs. Les biens détenus en commun et les biens attribués à un bénéficiaire désigné peuvent ne pas faire partie de la succession.`
  - ar: `اختياري، ويمكنك إضافته لاحقًا. أدخل المبلغ المتبقي بعد سداد الديون ونفقات التجهيز والدفن والوصايا. قد لا تكون الأموال المملوكة بالاشتراك أو التي حُدِّد لها مستفيد جزءًا من التركة.`
- **Supplied-facts notices:** two new catalog terms in `i18n/terms/{ar,en,fr}.json`, each with `"review": "pending"` and `"placeholders": {}`:
  - `notice.supplied_facts`:
    - en: `The family and the estate amount were entered by the user and have not been verified by Mawareeth.`
    - fr: `La famille et le montant de la succession ont été saisis par l'utilisateur et n'ont pas été vérifiés par Mawareeth.`
    - ar: `أدخل المستخدم أفراد الأسرة ومبلغ التركة، ولم تتحقق منها مواريث.`
  - `notice.supplied_facts_no_amount`:
    - en: `The family was entered by the user and has not been verified by Mawareeth. No estate amount was entered, so shares are shown without money amounts.`
    - fr: `La famille a été saisie par l'utilisateur et n'a pas été vérifiée par Mawareeth. Aucun montant de succession n'a été saisi : les parts sont indiquées sans montants.`
    - ar: `أدخل المستخدم أفراد الأسرة، ولم تتحقق منها مواريث. لم يُدخَل مبلغ للتركة، لذا تظهر الأنصبة دون مبالغ مالية.`
  - Add both keys to the required-key lists: `web/src/i18n/validate.ts` `requiredKeys` and `i18n/tests.py` `required_keys`. Then regenerate `web/src/i18n/catalog.generated.ts` with `npm run i18n:write`; never hand-edit it.
- **Which notice:** the amount is supplied when the first deceased's stored estate is not null. On the web that is `kase.deceased?.estate`. In the PDF it is `body['basis']['estate']`, the same value `with_amount` already uses. Amount present → `supplied_facts`; absent → `supplied_facts_no_amount`. The no-amount wording never mentions zero or any money figure.
- **Full results** (`Available`, `gate` true only): directly after the disclaimer `<p data-notice="disclaimer">`, render `<p data-notice="supplied-facts" className="rounded-[6px] border border-current/60 p-3">` with the catalog text for the locale. It is not semibold (only the disclaimer is, per UX-DR47), has no dismiss control, and is always present for an available result. Put the lookup in `web/src/interview/notices.ts` (e.g. `suppliedFactsText(locale, withAmount)` reading `terms`), and unit-test it there. Read-only pages (`gate={false}`) are unchanged.
- **Draft PDF** (`reports/templates/reports/draft.html` + `reports/report.py` `build_context`): directly after the "Generation date" line, add one notice block holding two paragraphs:
  - the disclaimer: the served `presented['notices']` text for `disclaimer`, else `i18n.term('notice.disclaimer', locale)`;
  - the supplied-facts text: `i18n.term('notice.supplied_facts' or 'notice.supplied_facts_no_amount', locale)`.
  - Styling: a 1px solid border with ~3mm padding, and the disclaimer paragraph bold. Keep the fixed "Draft / not certified" header and the DRAFT watermark exactly as they are. This applies to every path that calls `draft_pdf_response`: the session draft, the shared PDF and the received PDF.
- Errors and retries stay exactly as they are: estate validation errors (`FieldError`, `FormError`), `DraftDownload` Retry, and the PDF 409/503 responses. An invalid estate is never stored, so no notice can call it supplied.

**Never:**
- No change to the `PresentedResult` contract, its notice codes, `presentation/notices.py`, or the API/JSON fixtures.
- No new `.po` msgids.
- No calculator for debts, joint assets or beneficiary assets, and no new validation arithmetic.
- No Country selection.
- No "certified", "verified by" or "court-approved" claim.
- No `left`/`right` CSS.
- No change to any other existing message text.
- No supplied-facts notice in the Interview sheet or on the shared and received web pages.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Hint before entry | Interview, estate field empty, en/ar/fr | hint text visible, includes joint/beneficiary sentence; field's accessible description contains it | — |
| Invalid estate | `12.345` blurred | error shown; hint still shown and still in `aria-describedby` | existing typed error |
| Results with amount | case `deceased.estate = "1200"` | disclaimer then `supplied_facts` notice, before the action row | — |
| Results without amount | `deceased.estate = null` | `supplied_facts_no_amount` notice; no amount column/value invented | — |
| PDF with amount | session case with estate | HTML has disclaimer text and `supplied_facts` text in its locale | — |
| PDF without amount | estate null | `supplied_facts_no_amount` text; no Amount column (existing) | — |
| PDF fails | 503 | no notice claims a report; Retry, family and table still shown | existing Retry |

</intent-contract>

## Code Map

- `web/src/i18n/messages.ts` -- `estateHint` at :399 (ar), :752 (en), :1106 (fr). Change only these three values.
- `web/src/app/[locale]/interview/deceased-form.tsx:94-116` -- estate input with `aria-describedby="deceased-estate-hint deceased-estate-error"`, and the hint `<p>` that is always rendered. No markup change is expected.
- `web/src/interview/preview.test.ts:266-268` -- asserts the hint regexes (debts/funeral/bequests). Add joint/beneficiary assertions per locale.
- `i18n/terms/{en,ar,fr}.json` -- the term format is `{text, review, placeholders}` (see `notice.disclaimer`, en.json ~:519). `web/src/i18n/validate.ts:66-83` `requiredKeys` rejects keys outside the required list ("extra key"). `i18n/tests.py:34-44` `required_keys` mirrors it. Regenerate with `web/package.json` `i18n:write`.
- `web/src/interview/notices.ts` -- `noticeText` reads the served notice, else catalog `terms[locale]["notice.<code>"]`. Add the supplied-facts lookup here.
- `web/src/app/[locale]/results/results-view.tsx` -- `Available` :218. The disclaimer notice is at :277 (`gate && disclaimer`), the action row at :278. `kase.deceased` is `Deceased | null` with `estate: string | null` (`web/src/api/case.ts:57,128`).
- `web/src/app/[locale]/results/results-view.test.tsx` -- the existing disclaimer tests from 11.5 (served and catalog text). Mirror them for supplied-facts with and without an amount, and check that `gate={false}` has no supplied-facts notice.
- `reports/report.py` `build_context` -- has `presented`, `locale` and `estate = body['basis']['estate']`, and returns the context dict. Add `disclaimer` and `supplied_facts`.
- `reports/templates/reports/draft.html` -- the fixed `.disclaimer` header :16, the h1 and generation date :18-19. Add the notice block after :19 with a CSS class. Note: the file contains `·` and `—` characters; keep its UTF-8 bytes intact.
- `reports/tests.py` -- the HTML tests use `render_html` (e.g. :255 per-language disclaimer loop, :105). Add tests for the disclaimer and supplied-facts in en/ar/fr, with and without an estate. `api/test_snapshots.py:176` expects PDF text lines `['Ali', 'Draft / not certified', ...]`; check that it still passes and adjust only if the new block legitimately changes the extracted text.
- `web/e2e/results.spec.ts` -- the `Story 11.5` block (stubResults, `serious()` axe). `web/e2e/interview.spec.ts` -- the Interview deceased form flow.

## Tasks & Acceptance

**Execution:**
- `i18n/terms/en.json`, `ar.json`, `fr.json` -- add the two `notice.supplied_facts*` terms with the exact text above.
- `web/src/i18n/validate.ts`, `i18n/tests.py` -- add both keys to the required lists. Fix any `validate.test.ts` expectation that counts the keys.
- `web/src/i18n/catalog.generated.ts` -- regenerate (`cd web && npm run i18n:write`).
- `web/src/i18n/messages.ts` -- the three new `estateHint` texts.
- `web/src/interview/notices.ts` (+ a unit test next to it, or in an existing interview test) -- the supplied-facts lookup by locale and amount presence.
- `web/src/app/[locale]/results/results-view.tsx` -- the supplied-facts notice after the disclaimer, gate only.
- `web/src/app/[locale]/results/results-view.test.tsx` -- with an amount: the exact en text. Without an amount: the no-amount text, with no amount figure. In DOM order: disclaimer, then supplied-facts, then the action row. No button inside the notice. `gate={false}`: no notice.
- `web/src/interview/preview.test.ts` -- the hint covers joint and beneficiary assets in all three locales.
- `reports/report.py`, `reports/templates/reports/draft.html` -- the notice block.
- `reports/tests.py` -- `render_html` in ar/en/fr shows the disclaimer text and the right supplied-facts text, with and without an estate. With no estate, the HTML has no supplied-amount wording and no "Amount" column.
- `web/e2e/interview.spec.ts` -- for en, ar and fr, before typing an amount, the estate field's hint is visible and the input's accessible description (`toHaveAccessibleDescription`, regex) includes the joint/beneficiary sentence. After an invalid amount the hint is still visible.
- `web/e2e/results.spec.ts` -- in the Story 11.5-style block (or a new `Story 11.6` block), in en, ar and fr: the supplied-facts notice is visible after the disclaimer and before Download PDF, with the amount variant when the stub case has an estate and the no-amount variant when it does not. Run axe (`serious()`) at 320px.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- add a native-review entry for the new and changed ar/en/fr texts: `estateHint`, `notice.supplied_facts` and `notice.supplied_facts_no_amount`.

**Acceptance Criteria:**
- Given the Interview estate field before any amount is entered, when it is reached visually or with a screen reader, then its visible associated hint says that debts, funeral costs and bequests come out first and that jointly owned or beneficiary-designated assets may not form part of the estate, in ar, en and fr, without any Country selection.
- Given a user-entered family and estate, when Full results or the draft PDF is read, then it says that the family and estate amount were entered by the user and not verified by Mawareeth, next to the calculation-aid/not-a-fatwa disclaimer, and with no certified, verified or court-approved claim.
- Given no estate amount, when results or the draft PDF are produced, then exact shares still show, and the notice names the supplied family and says that no amount was entered, without inventing zero money.
- Given invalid estate input or a failed PDF request, when the existing validation or retry path runs, then the hint and the family stay visible, and nothing describes the input as a verified estate or the report as successful.

## Spec Change Log

## Review Triage Log

### 2026-11-28 — Review pass
- Routing: no `codex`, `gemini`, `hermes` or `qwen` agent type was registered in this session, so the five layers ran as one combined read-only sonnet subagent (the routing rule's last fallback). The diff was 25 kB, excluding the spec and the generated catalog. The review fixes went back to the implementation subagent. The cross-story-contract layer reported "No contract shape changed".
- verdicts: 24 findings — high 0, medium 0, low 11, false 13, maybe-false 0
- findings:
  - `[low]` `[reject]` blind 1: the PDF now has three overlapping warnings (the header, the watermark and the notice block), and their layout is untested in a real render. The spec asks for the header and watermark to stay and the block to be added. The real-PDF tests need WeasyPrint, which CI runs.
  - `[false]` `[reject]` blind 2: `suppliedFactsText` can return null and silently hide the notice. Both keys are now required by `validate.ts` and `i18n/tests.py`, and the results route accepts only published locales (`isLocale`).
  - `[false]` `[reject]` blind 3: the web reads the case estate and the PDF reads `basis.estate`, so they could disagree. `api/preview.py:69` builds `basis.estate` from `deceased['estate']`, so both read the same value.
  - `[false]` `[reject]` blind 4: in multi-death cases the notice uses only the first deceased's estate. Only the first deceased has an entered amount. Later estates are parts of it, so the statement about "the estate amount" is exact.
  - `[low]` `[reject]` blind 5: the Arabic wording is ambiguous. It is already logged for native review in deferred-work.md.
  - `[low]` `[reject]` blind 6: the no-amount e2e does not check that no money value appears. The unit test checks that the notice has no digit, and amount rendering for `amount: null` shares is unchanged.
  - `[low]` `[patch]` blind 7: the Interview e2e never checks that the estate error appears after `12.345`. Patched: it now asserts that `#deceased-estate-error` is not empty.
  - `[low]` `[reject]` blind 8: the Arabic hint is checked by a regex only. The en and fr checks are the same kind of check, and the wording goes to native review.
  - `[false]` `[reject]` edge 1: an empty-string or undefined estate could pick the wrong variant. `parseDeceased` (web/src/api/case.ts:299-307) turns anything that is not a stored amount into null.
  - `[false]` `[reject]` edge 2: a null notice text (grouped with blind 2).
  - `[false]` `[reject]` edge 3: `presented` might lack `notices`. The contract parser requires the field (engine/contracts/presented.py:271), and every available result carries it.
  - `[false]` `[reject]` edge 4: an empty served disclaimer would not be honoured. Falling back to the catalog is the intended behaviour, the same as the web's `noticeText`, and the disclaimer must never be blank.
  - `[low]` `[patch]` edge 5: the PDF notice block could split across pages. Patched: `break-inside: avoid` on `.notice`.
  - `[false]` `[reject]` edge 6: the multi-death mismatch (grouped with blind 4).
  - `[false]` `[reject]` edge 7: an estate of "0" is called an entered amount. The user entered 0, so the statement is true.
  - `[low]` `[patch]` verification-gap 1: the PDF placement is unchecked. Patched: the test now asserts that the block comes after the generation date and before the School line, in en, ar and fr. The shared and received PDFs go through the same `draft_pdf_response` and `render_pdf` (reports/views.py) and use one template, so no extra path test was added.
  - `[false]` `[reject]` verification-gap 2: the web and PDF amount sources are not cross-checked (grouped with blind 3: one source).
  - `[low]` `[patch]` verification-gap 3: the invalid-estate error is not asserted (grouped with blind 7).
  - `[low]` `[reject]` verification-gap 4: the ar and fr e2e expectations come from the same catalog JSON. That JSON is the source of truth, and the variant choice is covered by the en unit test and by `notices.test.ts` for every locale.
  - `[false]` `[reject]` verification-gap other: `catalog.generated.ts` may not have been regenerated. It was left out of the review diff on purpose. `npm run i18n`, which fails on a stale generated file, passed.
  - `[false]` `[reject]` intent-alignment 1: the notice appears only on the gated page. The AC names Full results and the draft PDF. The shared and received web pages are not Full results, and their PDFs carry the notice.
  - `[false]` `[reject]` intent-alignment 2: there are two sources for the amount flag (grouped with blind 3).
  - `[low]` `[patch]` intent-alignment 3: error and retry are exercised only partly. The invalid-estate error assertion was added (grouped with blind 7). The failed-PDF path is covered by the existing 11.5 e2e, which ran and passed.
  - `[low]` `[reject]` intent-alignment 4: the ar and fr copy is not reviewed. It is logged in deferred-work.md, as the workflow rules require.

## Design Notes

**Why catalog terms, not a new presentation notice code.** Notice codes are a closed enum in the versioned `PresentedResult` contract (`engine/contracts/presented.py:275`, `web/src/contracts/presented.ts`). A new code would need a contract version bump and fixture churn across Python, TypeScript and JSON. The supplied-facts sentence depends only on the stored Case (whether there is an amount), not on the calculation. Keeping it as catalog terms gives the web page and the PDF one source of text through the same catalog that `noticeText` already falls back to.

**Beta state.** The epic context mentions explaining "any supplied Beta state", but `locale_beta` is not in `ENABLED_NOTICES` and has no copy. No Beta state is supplied today, and the story's ACs do not ask for one. This story leaves it alone.

## Verification

**Commands (from `web/`, Git Bash glob form):**
- `npm run i18n` -- catalog valid, generated file up to date
- `node --import ./src/test/loader.mjs --test "src/interview/*.test.ts" "src/i18n/*.test.ts" "src/app/[[]locale]/results/*.test.tsx" "src/app/[[]locale]/interview/*.test.tsx"` -- all pass
- `npm run lint` and `npm run typecheck` -- 0 errors
- From the repo root: `uv run python manage.py test reports i18n api.test_snapshots --noinput --keepdb --parallel 2 --exclude-tag slow` -- all pass
- `npm run build` then `npm run test:e2e -- --project=chromium results.spec.ts interview.spec.ts` -- all pass

## Auto Run Result

Status: done

**Routing:** `/bmad-build-auto epic 11` resolved to Story 11.6, the next backlog story in epic 11 (11.1–11.5 are done). The cached `epic-11-context.md` was valid. A sonnet subagent implemented the story and applied the review fixes. No `codex`, `gemini`, `hermes` or `qwen` agent type was registered in this session, so the review layers ran as one combined read-only sonnet subagent, the routing rule's last fallback.

**Summary:**
- **Estate hint:** in ar, en and fr, the hint now also says that jointly owned and beneficiary-designated assets may not form part of the estate. It is the same always-visible hint, linked by `aria-describedby`.
- **Supplied-facts notice:** two new catalog terms, `notice.supplied_facts` and `notice.supplied_facts_no_amount`.
  - Full results (gated) shows the matching one right after the disclaimer, before the actions.
  - The draft PDF has a new bordered block after the generation date. It holds the served or catalog disclaimer, in bold, and the supplied-facts text. The block covers the session, shared and received PDFs.
- **No contract change:** `PresentedResult`, the API and the fixtures are unchanged.

**Files changed:**
- `i18n/terms/{en,ar,fr}.json` -- the two new terms (review pending).
- `i18n/tests.py`, `web/src/i18n/validate.ts`, `web/src/i18n/validate.test.ts` -- both keys added to the required lists.
- `web/src/i18n/catalog.generated.ts` -- regenerated.
- `web/src/i18n/messages.ts` -- the new `estateHint` in ar, en and fr.
- `web/src/interview/notices.ts` (+ new `notices.test.ts`) -- `suppliedFactsText(locale, withAmount)`.
- `web/src/app/[locale]/results/results-view.tsx` (+ test) -- the supplied-facts notice, gate only.
- `web/src/interview/preview.test.ts` -- the hint covers joint and beneficiary assets.
- `reports/report.py`, `reports/templates/reports/draft.html`, `reports/tests.py` -- the PDF notice block and its tests: en/ar/fr, with and without an amount, a served disclaimer, and placement.
- `web/e2e/interview.spec.ts`, `web/e2e/results.spec.ts` -- the Story 11.6 e2e tests: the hint before and after an invalid amount, and the notice order with axe at 320px.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- a native-review entry for the new and changed text.

**Review:** 24 findings (high 0, medium 0, low 11, false 13, maybe-false 0).
- Patched, 3 entries, all low:
  - the e2e asserts the estate error;
  - the PDF test asserts the block placement;
  - `break-inside: avoid` on the PDF notice.
- Deferred: none.
- Rejected, each with its reason in the triage log:
  - false claims: a second source for the amount flag, a null catalog text, empty-string estates, missing `notices`, multi-death and zero estates, a stale generated catalog, and a gate-only surface;
  - lows that are already logged or not worth the churn: overlapping PDF warnings, Arabic wording, extra variant and regex checks.

**Follow-up review:** `false`. No high or medium entry was patched (patched: low 3).

**Verification:**
- `npm run i18n`: OK.
- Web unit tests: 593/593 passed.
- Typecheck: clean. Lint: 0 errors, 12 existing warnings.
- Django tests on Postgres (`reports i18n api.test_snapshots`): 47 OK, 2 skipped. The skipped tests need WeasyPrint's native libraries, which this host lacks.
- `npm run build`, then the chromium e2e for `results.spec.ts` and `interview.spec.ts`: 256 passed.
- After the review patches: Django 47 OK, typecheck and lint clean, and the Story 11.6 e2e 9/9 passed.
- The parent fixed one typecheck error in the new results e2e (an untyped `agreeResponse.basis` / `.shares` read).

**Residual risks:**
- The real WeasyPrint PDF render of the new block is not exercised locally. CI runs `test_real_pdf_bytes_and_repeated_disclaimer` and the snapshot PDF test, which checks text by substring and is unaffected by added text.
- The ar and fr copy is machine-written, pending native review.
- Postgres was stopped at the start of the run, and the parent started it with `pg_ctl` (as `scripts/auto-dev.ps1` does).
- Firefox and WebKit were not run here.
