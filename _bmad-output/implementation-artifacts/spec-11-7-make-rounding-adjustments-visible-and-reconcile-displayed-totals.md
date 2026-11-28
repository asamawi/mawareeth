---
title: 'Story 11.7: Make rounding adjustments visible and reconcile displayed totals'
type: 'feature'
created: '2026-11-28'
baseline_commit: 'b6838ac75cfde0f1bc65665aee05c1fc9c691a13'
baseline_revision: 'b6838ac75cfde0f1bc65665aee05c1fc9c691a13'
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

**Problem:** The server already presents a signed `rounding` money value (nonzero only), but the Interview summary sheet and Full results never show it. The draft PDF shows it under an untranslated `{% translate "Rounding" %}` label (no `.po` entry), so ar and fr readers see English. Nothing checks that displayed minor-unit amounts add up to the estate across 0-, 2- and 3-decimal currencies.

**Approach:** Render the served `presented.rounding.text` as its own labelled line, after the unallocated line, in the sheet and on Full results. Give the PDF row a translated label. Add tests that prove reconciliation (rows + unallocated + rounding = estate) for positive, negative and zero adjustments in USD/SAR (2), KWD (3) and JPY (0), in ar/en/fr.

## Boundaries & Constraints

**Always:**
- **One source:** every surface shows `presented.rounding.text` verbatim, in `<bdi dir="auto">` (the money's `dir` is `auto`). No browser `Intl`, no float, no recomputation, no redistribution of the adjustment into any Heir row or the unallocated line.
- **Zero:** the presenter emits `rounding: null` at zero (contract-enforced). Every surface renders nothing when it is null, including when there is no estate and for refusals or selection-required results.
- **Label text** (new; native review pending):
  - Web, new key `previewRounding` in `web/src/i18n/messages.ts` (type at ~:245, next to `previewUnallocated`, and in ar ~:605, en ~:959, fr ~:1315): en `Rounding adjustment`, fr `Ajustement d'arrondi`, ar `فرق التقريب`.
  - PDF: change the template label to `{% translate "Rounding adjustment" %}`. Add the msgid `Rounding adjustment` to `locale/{ar,en,fr}/LC_MESSAGES/django.po` (reference comment `#: reports/templates/reports/draft.html`) with the same three texts. Recompile with `uv run python manage.py compile_catalog` and commit the `.mo` files.
- **Sheet** (`AvailableShares` in `web/src/app/[locale]/interview/share-preview.tsx`): directly after the unallocated `<p>` and before the School line, render `<p data-rounding>{messages.previewRounding}: <bdi dir="auto">{rounding}</bdi></p>`. Read the value from `previewRows(preview).rounding`.
- **Full results** (`Available` in `web/src/app/[locale]/results/results-view.tsx`): inside the shares section, directly after the unallocated `<p>`, render the same `<p data-rounding>` line with `interview.previewRounding`. This applies with or without the inheritance table and on read-only pages (`gate={false}`) too, because it is part of the shares. Extend `resultEntries` (`web/src/interview/results.ts:49`) to also return `rounding` from `previewRows`.
- **PDF** (`reports/templates/reports/draft.html:30`): keep the existing row, its placement after the unallocated row, and its colspan. Only the label msgid changes.
- Exact fractions, percentages and amounts stay the served strings, with their existing `bdi` direction.

**Never:**
- No change to `presentation/`, `engine/contracts/`, `web/src/contracts/presented.ts`, the API, or any JSON fixture.
- No `+` sign added on the client: a positive adjustment shows the server text as served (see Design Notes).
- No currency selector, and no change to `calc/adapters.py` (session cases stay SAR).
- No PDF-side or client-side allocation arithmetic in production code (tests may sum minor units).
- No change to any other existing message text. No `left`/`right` CSS.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Negative adjustment | fixture `Two wives and a son, rounded half up` (rounding −1, `-SAR0.01`) | sheet, Full results and PDF show the label and `-SAR0.01`, separate from Heir rows | — |
| Positive adjustment | fixture `Hanbali wife and three sons need correction` (rounding +1) | the label and the served positive text | — |
| Zero adjustment | fixture `Agree: wife, son and daughter in every school` | no rounding line in the sheet, Full results or PDF | — |
| Unallocated plus rounding | wife alone, estate 6 minor (Hanbali) | unallocated 5 and rounding −1 are two separate lines | — |
| No estate | `estate = null` | no amounts and no rounding line anywhere | — |
| 0/3-digit currencies | presenter with `Currency('JPY'/'KWD', True)` | rows + unallocated + rounding minor = estate minor; text = Babel format for that precision | — |
| Refused / selection | refused or differing schools | no shares and no rounding line | existing paths |

</intent-contract>

## Code Map

- `presentation/present.py:196-206` -- read-only. `rounding = estate − Σ row minor − unallocated minor`, emitted only when nonzero, as `money.value(rounding)` (`{amount_minor, currency, text, dir:'auto'}`).
- `presentation/tests/test_present.py:114-148` -- the existing `test_rounding`, `test_negative_rounding`, `test_unallocated_is_separate_from_rounding`, `test_no_estate` and `test_precision_follows_the_currency`. Helpers: `run(fam, basis, locale, currency)` and `family(relationships, estate)`, with the estate given in minor units. Add the reconciliation matrix here.
- `web/src/interview/preview.ts:127-160` -- `previewRows` already returns `rounding: string | null`.
- `web/src/interview/results.ts:49-57` -- `resultEntries` returns `{entries, unallocated}`. Add `rounding`.
- `web/src/app/[locale]/interview/share-preview.tsx:373-430` -- `AvailableShares`: the rows `<ul>`, the unallocated `<p>` at :417, then the School line.
- `web/src/app/[locale]/results/results-view.tsx:245,309-314` -- the `resultEntries` call and the unallocated `<p>` inside `section[aria-labelledby=results-shares]`.
- `web/src/i18n/messages.ts` -- the `interview` type (:245) and the ar/en/fr values (:605/:959/:1315).
- `web/src/app/[locale]/interview/share-preview.test.tsx` -- `available(title)`, `view(...)`, `render(...)`, `labelsOf`. Fixtures come from `@/test/preview-fixtures`, which merges the presented bodies.
- `web/src/app/[locale]/results/results-view.test.tsx` -- the fetch stub uses `previewBody`/`caseBody`, with `previewFixture(title)`.
- `reports/templates/reports/draft.html:30` -- the rounding row (`{% translate "Rounding" %}`).
- `reports/tests.py` -- `served(fixture, language)`, `render_html`, `build_context`, `AVAILABLE`. `calc/tests.py:1353-1384` fails on a stale `.mo`.
- `calc/management/commands/compile_catalog.py` -- `.po` → `.mo`.
- `calc/adapters.py:47` -- read-only. Session cases are always SAR. For the PDF 0/3-digit test, patch `api.preview.family_from_session` to wrap the real function and return `Currency(code, True)` in place of its currency.
- `web/e2e/results.spec.ts` -- `stubResults(api, {getCase, getPreview})`, the `served.presented[title]` map, `serious(page)` and the Story 11.6 block (:348+).

## Tasks & Acceptance

**Execution:**
- `presentation/tests/test_present.py` -- add `test_displayed_minor_units_reconcile_to_the_estate`. For each of USD (2), KWD (3) and JPY (0), in ar, en and fr, run three estates:
  - three sons, 100 minor → +1;
  - two sons, 101 minor → −1;
  - two sons, 100 minor → None.
  Also run the Hanbali wife, 6 minor → unallocated 5, rounding −1. Assert that Σ row minor + unallocated minor + rounding minor (0 when None) == estate. Assert that `rounding.text` equals Babel `format_currency(Decimal(minor).scaleb(-digits), code, locale, numbering_system)`, the way `test_precision_follows_the_currency` builds it via `babel_of(locale)`, and that the negative text differs from the positive. Assert that exact fractions in `share` are unchanged (`numerator/denominator` reduced).
- `web/src/i18n/messages.ts` -- add `previewRounding` (type plus three locales).
- `web/src/interview/results.ts` -- return `rounding` from `resultEntries`.
- `web/src/app/[locale]/interview/share-preview.tsx` -- add the `data-rounding` line.
- `web/src/app/[locale]/results/results-view.tsx` -- add the `data-rounding` line in the shares section.
- `web/src/app/[locale]/interview/share-preview.test.tsx` -- the negative fixture shows `[data-rounding]` with the en label and `-SAR0.01`, after the rows `<ul>`, and outside every `li`. The positive fixture shows its served text. The agree fixture has no `[data-rounding]`.
- `web/src/app/[locale]/results/results-view.test.tsx` -- the same three checks on Full results, plus `gate={false}` (or the shared path, if one is simpler to render) still shows the line.
- `web/src/interview/preview.test.ts` / `results` unit test -- `resultEntries(...).rounding` equals `presented.rounding.text`, or null.
- `locale/{ar,en,fr}/LC_MESSAGES/django.po` + `.mo` -- the msgid `Rounding adjustment`, then compile.
- `reports/templates/reports/draft.html` -- the label msgid.
- `reports/tests.py` -- add `test_rounding_row_is_separate_labelled_and_reconciles`:
  - For the negative and positive fixtures in en, ar and fr (`served(f, lang)` under `translation.override(lang)`), the HTML has exactly one row whose first cell is the translated label and whose last cell is `presented['rounding']['text']`. That row is not one of the share rows.
  - For the agree fixture and a no-estate case, no label appears.
  - With `family_from_session` patched to KWD and JPY, Σ row `amount_minor` + unallocated + rounding == the family estate minor, and the PDF row shows the presented text.
- `web/e2e/results.spec.ts` -- add a `Story 11.7` block. In en, ar and fr, stub the negative fixture: the `[data-rounding]` line is visible inside the shares section, has the locale label and the served text, and sits after the table. Stub the agree fixture: no line. Run axe `serious()` at 320px.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- a native-review entry for `previewRounding` and the `Rounding adjustment` msgstrs in ar, en and fr.

**Acceptance Criteria:**
- Given an estate with a nonzero rounding remainder, when the summary sheet, Full results or the draft PDF is shown, then each shows one separate labelled rounding line with the server's signed text. The line is distinct from Heir rows and from the unallocated line, in ar, en and fr.
- Given the same presentation, when its minor units are summed, then Heir amounts + unallocated + rounding equal the estate exactly, for positive, negative and zero adjustments in 0-, 2- and 3-digit currencies.
- Given a zero adjustment, no estate, a refusal or a selection-required result, when any surface renders, then there is no rounding line and no invented amount.
- Given any surface, then fractions, percentages and amounts are the served strings, inside their existing `bdi` isolation, and no client or PDF code computes money.

## Spec Change Log

## Review Triage Log

### 2026-11-28 — Review pass
- Routing: no `codex`, `gemini`, `hermes` or `qwen` agent type was registered in this session, so the five layers ran as one combined read-only sonnet subagent (the routing rule's last fallback). The review fixes went back to the implementation subagent. The cross-story-contract layer reported "No contract shape changed".
- verdicts: 26 findings — high 0, medium 0, low 22, false 4, maybe-false 0
- findings:
  - `[false]` `[reject]` blind 1: the old `Rounding` msgid is left orphaned. No `Rounding` entry ever existed in `locale/*/django.po` (grep before the change), and the edge layer confirmed this independently. The old label was simply untranslated, which is the bug this story fixes.
  - `[low]` `[patch]` blind 2: the positive adjustment text is never pinned. Patched: `share-preview.test.tsx` now asserts the literal `Rounding adjustment: SAR0.01`, with no `-`.
  - `[low]` `[patch]` blind 3: no web or PDF render shows unallocated and rounding together. Patched:
    - `reports/tests.py` runs the real pipeline on the wife-alone case at estate 0.06 (unallocated 5, rounding −1) and asserts two separate rows;
    - `results-view.test.tsx` asserts two distinct `<p>` elements, with rounding after unallocated;
    - the sheet's JSX is the same pattern but is not separately tested with both lines.
  - `[low]` `[patch]` blind 4: the PDF no-estate check mutated a served body. Patched: it now runs the real pipeline with `estate: None` and asserts no rounding and no label.
  - `[low]` `[reject]` blind 5: the rounding line has no aria association, and the minus sign could reorder in RTL. It uses the same `<bdi dir="auto">` isolation as every other amount on the page, around the server's Babel text (AD-19). The label sits before the value in the same paragraph. Changing this would be a cross-surface bidi rework.
  - `[false]` `[reject]` blind 6: nothing checks `previewRounding` in all locales. `messages` is typed `Record<Locale, Messages>`, so typecheck fails if any locale lacks the key.
  - `[low]` `[reject]` blind 7: the rounding JSX is duplicated in the sheet and Full results. It mirrors the existing duplicated unallocated line (two lines of JSX each). A shared component is churn with no named harm.
  - `[low]` `[reject]` blind 8: the e2e position locator's `.last()` may match a nested element. The assertion still requires the line to sit below the matched element, which is weaker but never false. Not worth the churn.
  - `[low]` `[patch]` blind 9: the zero e2e never asserts its stub is a zero case. Patched: it asserts the agree fixture's served `rounding` is null.
  - `[low]` `[reject]` blind 10: the sheet has no e2e. The sheet renders `AvailableShares`, which the node render test covers. The spec chose the results page for e2e and axe.
  - `[low]` `[patch]` edge 1: the PDF no-estate check is faked (grouped with blind 4).
  - `[low]` `[patch]` edge 2: positive and negative paths are indistinguishable (grouped with blind 2).
  - `[low]` `[patch]` edge 3: the sheet never renders both lines (grouped with blind 3; covered for Full results and the PDF).
  - `[low]` `[reject]` edge 4: layered and blocked-row previews are untested for the line. The line depends only on `presented.rounding`, not on the table or card layout. Both the table and the card layout are exercised, by the fixtures and the e2e.
  - `[low]` `[reject]` edge 5: the sheet has no e2e (grouped with blind 10).
  - `[low]` `[reject]` edge 6: the `.last()` locator (grouped with blind 8).
  - `[false]` `[reject]` edge 7: deleting the msgid orphans a `.po` entry. The layer itself found no `Rounding` entry.
  - `[low]` `[patch]` verification-gap 1: the positive text is unpinned (grouped with blind 2).
  - `[low]` `[patch]` verification-gap 2: unallocated and rounding are never rendered together (grouped with blind 3).
  - `[low]` `[patch]` verification-gap 3: no-estate and refusal paths do not reach the new surfaces. No-estate is patched (grouped with blind 4). Refused and selection-required bodies cannot carry `rounding`: `engine/contracts/presented.py:285-290` and `web/src/contracts/presented.ts:253-256` reject them.
  - `[low]` `[reject]` verification-gap 4: the sheet has no e2e (grouped with blind 10).
  - `[low]` `[reject]` verification-gap other 1: the PDF is verified only through `render_html`. CI runs the WeasyPrint byte tests, and the label is plain text like the existing labels.
  - `[low]` `[patch]` verification-gap other 2: the zero e2e stub is not asserted (grouped with blind 9).
  - `[false]` `[reject]` intent-alignment 1: 0- and 3-digit reconciliation is not verified on the web. The web renders only served strings and does no money arithmetic, and session cases are always SAR (`calc/adapters.py:47`, with no currency selector by the AC). The presenter and PDF tests cover 0, 2 and 3 digits.
  - `[low]` `[patch]` intent-alignment 2: separate unallocated and rounding lines are checked at the presenter only (grouped with blind 3).
  - `[low]` `[patch]` intent-alignment 3: no-estate and refusal are checked by the contract only (grouped with verification-gap 3).

## Design Notes

**Signed text.** The presenter formats money with Babel, which writes a minus sign for negatives and no sign for positives. The AC asks for the "server-presented signed amount". A client-side `+` would be browser formatting, and changing the presenter would change the Epic 8 contract and its fixtures. So positive adjustments show as served, and the label ("Rounding adjustment") carries the meaning. If the owner later wants an explicit `+`, it belongs in `presentation/` behind a contract version bump.

**Label source.** The web uses `messages.ts` (like `previewUnallocated`), and the PDF uses gettext (like `Unallocated remainder`). This follows the existing split, so neither the catalog contract nor `requiredKeys` changes.

## Verification

**Commands (from `web/`, Git Bash glob form):**
- `npm run i18n` -- passes
- `node --import ./src/test/loader.mjs --test "src/interview/*.test.ts" "src/i18n/*.test.ts" "src/app/[[]locale]/results/*.test.tsx" "src/app/[[]locale]/interview/*.test.tsx"` -- all pass
- `npm run lint` and `npm run typecheck` -- 0 errors
- From the repo root: `uv run python manage.py test presentation reports calc.tests.TemplateTagTests api.test_snapshots --noinput --keepdb --parallel 2 --exclude-tag slow` -- all pass
- `npm run build` then `npm run test:e2e -- --project=chromium results.spec.ts` -- all pass

## Auto Run Result

Status: done

**Routing:** `/bmad-build-auto 11-7` resolved to Story 11.7. The cached `epic-11-context.md` was valid, and Story 11.6 supplied continuity. A sonnet subagent implemented the story and applied the review fixes. No `codex`, `gemini`, `hermes` or `qwen` agent type was registered, so the five review layers ran as one combined read-only sonnet subagent, the routing rule's last fallback.

**Summary:**
- **Rounding line:** the summary sheet and Full results (gated and read-only) now show a separate `Rounding adjustment: <served text>` line, after the unallocated line, only when the server presents a nonzero `rounding`.
- **PDF label:** the draft PDF's existing rounding row now has a translated label in ar, en and fr; before, it was English-only.
- **Tests:** they prove that Heir amounts + unallocated + rounding equal the estate in minor units. They cover +1, −1 and zero adjustments in USD, KWD and JPY, in ar, en and fr, at the presenter, and the PDF reconciliation for KWD and JPY.
- **No contract change:** there are no presenter, contract, API or fixture changes. Positive adjustments show the served text, with no `+` (see Design Notes).

**Files changed:**
- `web/src/i18n/messages.ts` -- `interview.previewRounding` in ar, en and fr.
- `web/src/interview/results.ts` (+ `results.test.ts`) -- `resultEntries` returns `rounding`.
- `web/src/app/[locale]/interview/share-preview.tsx` (+ test) -- the rounding line in the sheet.
- `web/src/app/[locale]/results/results-view.tsx` (+ test) -- the rounding line in the Full results shares section.
- `reports/templates/reports/draft.html` -- the `Rounding adjustment` msgid.
- `locale/{ar,en,fr}/LC_MESSAGES/django.po` and `.mo` -- the new msgid, compiled with `compile_catalog`.
- `presentation/tests/test_present.py` -- the reconciliation matrix across 0, 2 and 3 digits and ar, en and fr.
- `reports/tests.py` -- the PDF rounding row: label, separation, zero, no-estate, unallocated plus rounding, and KWD/JPY reconciliation.
- `web/e2e/results.spec.ts` -- the Story 11.7 e2e block in en, ar and fr at 320px with axe.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- a native-review entry for the new labels.

**Review:** 26 findings (high 0, medium 0, low 22, false 4, maybe-false 0).
- Patched, 4 entries, all low:
  - the positive text is pinned to a literal;
  - real-pipeline unallocated plus rounding tests on Full results and the PDF;
  - a real-pipeline no-estate PDF test;
  - the zero e2e asserts its stub is a zero case.
- Deferred: none.
- Rejected, each with its reason in the triage log:
  - false claims: an orphaned msgid (twice), the locale key check, and 0/3-digit reconciliation on the web;
  - lows that are equivalent to existing patterns or not worth the churn: the RTL/aria line, the duplicated JSX, the `.last()` locator, a sheet e2e, layered/blocked layouts, and real PDF bytes.

**Follow-up review:** `false`. No high or medium entry was patched (patched: low 4).

**Verification (after the review patches):**
- Django on Postgres (`presentation reports calc.tests.TemplateTagTests api.test_snapshots`): 90 tests OK, 2 skipped (WeasyPrint native libraries are absent on this host).
- `npm run i18n`: OK.
- Web unit tests: 597/597.
- Lint: 0 errors, 12 existing warnings. Typecheck: clean.
- `npm run build`, then the chromium `results.spec.ts`: 63/63 passed.

**Residual risks:**
- The ar and fr labels are machine-written, pending native review (logged in deferred-work.md).
- The sheet is checked by a node render test only, with no browser e2e. Its unallocated-plus-rounding combination is not rendered by a test.
- The real WeasyPrint render of the relabelled row runs only in CI.
- The implementation subagent converted three test files to CRLF. The parent restored LF before review.
- Firefox and WebKit were not run.
