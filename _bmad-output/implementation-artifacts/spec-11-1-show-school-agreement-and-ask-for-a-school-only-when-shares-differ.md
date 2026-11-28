---
title: 'Story 11.1: Show School agreement and ask for a School only when shares differ'
type: 'feature'
created: '2026-11-27'
status: 'done'
baseline_revision: '46af4d11da211c4d21e4fcc4aa23bfeb82327f53'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The browser preview parser accepts an outer madhab that differs from the presented School.
    evidence: |-
      web/src/api/case.ts:1533 checks presented state and heir IDs only; the e2e refusal fixture at web/e2e/interview.spec.ts:2622 sends madhab hanafi with a Maliki PresentedResult and expects success. Pre-existing, found in the story 11.1 review.
    location: >-
      web/src/api/case.ts:1533
    severity: low
  - summary: >-
      Shared-link and received-invite views turn unavailable and choose_school previews into a generic error, with no wrapper tests for those variants.
    evidence: |-
      web/src/app/[locale]/shared/shared-view.tsx:92 and web/src/app/[locale]/received/received-view.tsx:73 show text.error for any non-available preview; tests cover only available and not_ready. Pre-existing, found in the story 11.1 review.
    location: >-
      web/src/app/[locale]/shared/shared-view.tsx:92
    severity: low
---

<intent-contract>

## Intent

**Problem:** Agreement between the four Sunni Schools is only proven when the Basis is "compare all four"; on a single-School Basis the preview and Full results always say "Calculated under the {school} school", even when every School gives the same shares. Where the Schools differ, the choice is an instruction-style legend with cards that miss the UX-DR43 group, target and question requirements, and the agreement line sits below the preview rows in plain text.

**Approach:** Server presentation also runs the four-Sunni-School comparison on a single Sunni School Basis (reusing the selected School's evaluation, never changing its shares) and reports the outcome in a new `PresentedResult` v4. Share preview and Full results render agreement, the School question and choice-cards, and the chosen School strictly from `presented`.

## Boundaries & Constraints

**Always:**
- Agreement comes only from `presented` (`comparison_outcome`, `school_line`, `comparison`); the browser never infers it from a null `madhab`, the legacy `agreement` flag, or by comparing shares itself (AD-19).
- Agreement means what `presentation/compare.py` already defines: four calculated outcomes with identical exact final shares and blocked flags per person across all estates, plus identical unallocated shares. Any refusal among the four means no agreement.
- The selected School's rows, proof, table, rounding and unallocated values are byte-identical to today's for the same Case.
- School choice uses the existing revision-aware `set_basis` command (`setMadhab`) and existing recovery: success adopts the returned Case; conflict reconciles to the accepted Case without resending; failure/throttle keeps the current Case and Retry. Never show the attempted School as applied before the matching presentation arrives.
- Server-provided strings and bidi isolation stay as they are; fractions stay LTR.
- Preview p95 stays under 1 s (NFR-3), checked by `capacity_check`.

**Never:**
- No upfront Basis step, no Country selector, no change to Country or Jafari Basis behaviour (their `comparison_outcome` stays null).
- No new browser-side comparison, no second preview fetcher, no change to later-death estate handling.
- Do not alter existing ar/en/fr translations to make a test pass. The one new question string (below) is new copy and must be recorded for native review.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Compare Basis, all agree | `madhab=None`, four equal outcomes | `state=answer`, `comparison_outcome=agreement`, `school_line=same_in_all_schools`; preview shows teal agreement line above the rows; no "Calculated under" line on either surface | — |
| Compare Basis, shares differ | four outcomes, ≥1 person differs | `state=selection_required`; both surfaces show question + choice-cards with per-School shares side by side; no rows | — |
| Sunni School Basis, all agree | `madhab=hanafi` (say), four equal | `state=answer`, `comparison_outcome=agreement`, `school_line=same_in_all_schools`; selected School's rows unchanged | — |
| Sunni School Basis, differ | `madhab=maliki`, outcomes differ | `state=answer`, `comparison_outcome=difference`, `school_line=school` naming Maliki; Maliki's rows | — |
| Sunni School Basis, another School refuses | selected answers, one other refuses | `comparison_outcome=difference`; never agreement | — |
| Selected School refuses | `madhab=X`, X refuses | `state=refused`, `comparison_outcome=null`, no shares, refusal reason shown | existing Retry/error keeps family |
| Compare, partial refusal | some Schools refuse | `selection_required`, `difference`; refused cards show their refusal text and no shares; still selectable | — |
| Compare, all refuse, mixed reasons | four refusals, ≥2 distinct reasons | legacy envelope `status=unavailable` (not `choose_school`); `presented.state=refused`; every distinct presented refusal shown; no shares | — |
| Choose School succeeds | click card, PATCH ok | adopt Case; once matching-revision presentation arrives, both surfaces name the chosen School (if differ) and show its rows | — |
| Choose School conflicts/fails | 409 / 5xx / throttle | accepted Case kept; existing alert/Retry; cards not shown as applied | existing recovery |
| Jafari or Country Basis | non-Sunni Basis | `comparison_outcome=null`, `school_line=school` as today | — |

</intent-contract>

## Code Map

Server (Python):
- `presentation/compare.py:22,67` -- `outcome`, `compare`: four-School comparison; today evaluates one School for School Basis. Extend so a Sunni School Basis evaluates the other three and reuses the selected School's evaluation (no re-evaluation of it).
- `presentation/present.py:75,139,155` -- `present`, sole `PresentedResult` producer; sets `state`, `comparison_outcome`, `school_line`, `comparison`, `refusals`.
- `engine/contracts/presented.py:224-300` -- validator. Lines 293-299 forbid a comparison outcome for School Basis; relax for v4 as in Design Notes.
- `engine/contracts/codes.py:3` -- `CONTRACT_VERSIONS["presented_result"]: 3` → 4.
- `contracts/fixtures/presented_result/*.json` (`agreement`, `difference`, `partial-refusal`, `refused`, `school-answer`, `selection-required`, `later-deaths`) and `contracts/fixtures/invalid/presented_result.json` -- bump `version` to 4; add School-Basis agreement and School-Basis difference fixtures; add invalid cases for the new rules.
- `api/preview.py:257-290` -- `preview`. Line 273 takes `out.evaluations[0]` for a School Basis: must take the selected School's evaluation explicitly once more Schools are evaluated. Line 282: all-refused must return the `unavailable` body regardless of the number of distinct reasons.
- `calc/adapters.py:13,168` -- `basis_from_madhab`, `present_calculation` (shares the pipeline; Full results/PDF path).
- `api/capacity.py:28,174,392` -- p95 model (1,000 ms preview, 200 ms engine); covers single-School workloads, which now do 4 evaluations.
- Tests: `presentation/tests/test_present.py`, `presentation/tests/test_parity.py`, `engine/tests/test_contracts.py`, `api/tests.py` (`PreviewTests`, `LayeredPreviewTableTests`; `:1737` asserts the selected School survives and no legacy `agreement` flag — keep), `api/test_preview_performance.py:91`, `api/test_capacity.py`, `calc/test_switch_gate.py`, `i18n/tests.py`.

Browser (paths under `web/src/`; components under `app/[locale]/`):
- `contracts/codes.ts:3` -- `presented_result: 3` → 4. `contracts/presented.ts:202-260` -- TS validator mirror of the Python rules; keep identical.
- `interview/share-preview.tsx:256,374,421` -- `SharePreviewBody`, `AvailableShares`; agreement text currently rendered below rows in plain text; School line via `messages.previewSchool`. Hosted in the modal by `SummaryBar`/`SharePreviewSummary`/`SharePreviewController` (`:483,539,648`) from story 11.3.
- `results/results-view.tsx:43,129,157,187,216,271` -- Full results; `ChooseSchool` reloads on success/conflict/expiry, shows failures locally; renders agreement or `results.school`.
- `interview/school-choice.tsx:16,57,80` -- shared School choice: comparison grid (server fractions or per-School refusal) and radio cards (2px 60% currentColor border, checked border, 10% tint, focus outline already inline).
- `interview/start-case.tsx:871`, `interview/flow.ts:799` -- `perform("choose")` and conflict/failure handling. `interview/preview.ts:69,81,93` -- revision and family/Basis identity checks.
- `api/case.ts:639` -- `setMadhab`; `:1524,1566` legacy envelope parsing (`agreement`, `madhab`).
- `app/[locale]/globals.css:9,42,55` -- `--accent` teal (`text-accent`), `--radius-node: 10px` (`rounded-node`).
- `i18n/messages.ts:596-600,950-954,1306-1310` -- `previewSchool`, `schoolsAgree`, `chooseSchool` (ar/en/fr). Server copy `comparison.same_in_all_schools` in `i18n/terms/{ar,en,fr}.json:525` (mirrored in `i18n/catalog.generated.ts`).
- Tests: `contracts/contracts.test.ts`, `api/case.test.ts`, `interview/{preview,results,flow}.test.ts`, colocated `share-preview.test.tsx`, `results-view.test.tsx`; e2e `web/e2e/interview.spec.ts`, `results.spec.ts`, `accessibility.spec.ts`.

Constraints from earlier stories: 11.2 keeps one preview lifecycle owner, revision signals, blocked evidence and the last accepted rows while pending; 11.3 hosts the body in a root-only modal kept open through Retry/refusal and portals the single status node, and explicitly left the agreement-text assertion to this story.

## Tasks & Acceptance

**Execution:**
- `engine/contracts/codes.py`, `web/src/contracts/codes.ts` -- bump `presented_result` to 4 -- the accepted shape changes; earlier shape changes (8.6, 8.7) bumped it.
- `engine/contracts/presented.py`, `web/src/contracts/presented.ts` -- apply the v4 School-Basis rules from Design Notes, identically in both -- validators guard every renderer.
- `contracts/fixtures/presented_result/*.json`, `contracts/fixtures/invalid/presented_result.json` -- version 4; add `school-agreement.json` and `school-difference.json`; add invalid cases (School Basis answer with agreement but `school` line; with difference but `same_in_all_schools` line; with a `comparison` object; Jafari/Country with a non-null outcome) -- fixture round-trip in both languages.
- `presentation/compare.py`, `presentation/present.py` -- for a Sunni School Basis evaluate the other three Schools, reuse the selected evaluation, compute agreement with the existing rule, set `comparison_outcome` and `school_line` per Design Notes; keep `comparison` null for an answer -- backs the agreement line with a real comparison.
- `api/preview.py` -- select the chosen School's evaluation by School, not by index; return the `unavailable` body whenever all four refuse, whatever the reasons -- avoids the `choose_school` + `refused` mismatch the browser rejects.
- `presentation/tests/test_present.py`, `api/tests.py`, `engine/tests/test_contracts.py` -- cover every server row of the I/O matrix, including that the selected School's rows/table/rounding are identical with and without the extra comparison, and the mixed-reason all-refused case.
- `api/capacity.py` / `api/test_capacity.py` -- keep single-School workloads asserting usable, revision-matched v4 presentations; adjust expectations only where they assert one evaluation for a School Basis.
- `web/src/app/[locale]/interview/share-preview.tsx` -- render the agreement line (server `school_line.text` when code `same_in_all_schools`) above the rows in `text-accent`; render no "Calculated under" line then; when code `school`, keep `previewSchool` -- AC1/AC3.
- `web/src/app/[locale]/results/results-view.tsx` -- same agreement/School-line logic from `presented`; no "Calculated under"/`results.school` line on agreement -- AC1/AC3.
- `web/src/app/[locale]/interview/school-choice.tsx` -- question as the group legend (`chooseSchool`), cards in a `rounded-node` group with 12px padding (`p-3`), each card `min-h-11` (44px) with existing border/tint/focus styles kept; per-School shares side by side; refused Schools show their refusal text and no shares and stay selectable -- AC2.
- `web/src/i18n/messages.ts` -- change `chooseSchool` to a question: en "Which school of law do you follow?", fr "Quelle école juridique suivez-vous ?", ar "أي مذهب فقهي تتبع؟" -- UX asks for a short question.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- append an entry that the three new `chooseSchool` strings need native review.
- `web/src/contracts/contracts.test.ts`, `web/src/app/[locale]/interview/share-preview.test.tsx`, `web/src/app/[locale]/results/results-view.test.tsx`, `web/src/interview/flow.test.ts` -- agreement line above rows with accent class and no School line; School line on difference; selection prompt with cards; refused card without shares; failed/conflicting choose keeps the accepted Case and does not render the attempted School as applied.
- `web/e2e/results.spec.ts` or `web/e2e/interview.spec.ts` -- one journey: agreement family shows the agreement line on preview and Full results; differing family shows cards, choosing a School names it on both surfaces.

**Acceptance Criteria:**
- Given a family where all four Sunni Schools agree, when Share preview or Full results renders under either a compare Basis or a single Sunni School Basis, then "Same result in all four Sunni schools" appears (preview: teal, above the rows) and no "Calculated under the {school} school" line appears.
- Given presentation `state=selection_required`, when either surface renders, then a short question and School choice-cards show the differing shares side by side in a 10px-radius group with 12px padding, each card at least 44px tall with a visible focus ring, and no Basis step or Country selector appears.
- Given a user chooses a School from the prompt, when the command succeeds and the matching-revision presentation arrives, then both surfaces name the chosen School and show its rows; when it fails or conflicts, the accepted Case and its prior view remain and the existing recovery is shown.
- Given a single Sunni School Basis, when the preview is computed, then the selected School's shares, table and rounding equal today's output and `uv run python manage.py capacity_check --samples 20` passes the 1 s preview p95.

## Spec Change Log

## Review Triage Log

### 2026-11-27 — Review pass
- verdicts: 42 findings — high 0, medium 13, low 20, false 9, maybe-false 0
- layers: all five ran as one combined read-only codex call (`Codex tier: deep`, diff 438 KiB); no fallback needed.
- findings:
  - `[medium]` `[patch]` blind-hunter 1: a Country Basis resolving to a Sunni School entered the four-School branch and emitted an outcome both v4 parsers reject — restricted `outcome()` and `present()` to `basis.kind == 'school'`; added a Country round-trip test and a Country invalid fixture.
  - `[low]` `[reject]` blind-hunter 2: a Sunni School Outcome with one evaluation yields a null outcome — not reachable: `outcome()` always evaluates four for a Sunni School Basis; only a test builds the one-evaluation reference, and it compares rows, not a parse. The fix would add a guard.
  - `[medium]` `[patch]` blind-hunter 3: mixed-reason all-refused shows only Hanbali's outer reason — both surfaces now render each distinct presented refusal (see cross-story-contract 6/7).
  - `[low]` `[reject]` blind-hunter 4: a refused selected School still evaluates three more Schools — capacity_check standard_school p95 452 ms; `evaluate` returns refusals rather than raising, so no delivery risk was shown.
  - `[low]` `[patch]` blind-hunter 5: parity test did not check which School is first — now asserts `evaluations[0][0]` is the selected School.
  - `[low]` `[patch]` blind-hunter 6: mixed-refusal API test asserted only a count — now asserts the exact two codes and the outer reason (the test now plants a compare Basis).
  - `[low]` `[patch]` blind-hunter 7: `school-agreement.json` declared fr with English text — French term from `i18n/terms/fr.json`; lock regenerated.
  - `[low]` `[patch]` blind-hunter 8: new test class after `unittest.main()` — moved above it.
  - `[low]` `[patch]` blind-hunter 9: Share preview difference test relabelled Hanbali rows as Maliki — now built from `school-difference.json`.
  - `[low]` `[patch]` blind-hunter 10: difference test did not check line order — asserts the School line follows the rows.
  - `[low]` `[reject]` blind-hunter 11: report locale test takes its expectation from the presentation — presenter localization is covered in `presentation/tests/test_present.py`; a locale-specific report fixture would add test machinery for an unlikely regression.
  - `[medium]` `[patch]` edge-case-hunter 1: same as blind-hunter 1.
  - `[low]` `[reject]` edge-case-hunter 2: same as blind-hunter 2.
  - `[medium]` `[patch]` edge-case-hunter 3: same as blind-hunter 3.
  - `[low]` `[patch]` edge-case-hunter 4: `api/preview.py` read the selected School by index — now `dict(out.evaluations)[resolved.school]`.
  - `[false]` `[reject]` edge-case-hunter 5: legend, reasons and IDs not taken from presented — the legend is UI copy, agreement and selection state come from `presented`, and `preview.rules` is the pre-existing legacy envelope; AD-19 concerns agreement, which is never inferred.
  - `[false]` `[reject]` edge-case-hunter 6: shares are not inside the selectable cards — EXPERIENCE.md:97 specifies "a choice-card group to pick a School; until picked, the Share preview shows the Schools side by side", which is what ships.
  - `[low]` `[patch]` edge-case-hunter 7: no Country invalid fixture — added with blind-hunter 1.
  - `[medium]` `[patch]` edge-case-hunter 8: the choose-School e2e stopped at the PATCH — the journey now checks that the refreshed Share preview and Full results name Hanafi and show the brother's (blocked) share.
  - `[medium]` `[patch]` verification-gap 1: Country round-trip untested — covered by the blind-hunter 1 fix.
  - `[medium]` `[patch]` verification-gap 2: same as edge-case-hunter 8.
  - `[medium]` `[patch]` verification-gap 3: mixed refusal never reached a renderer — unit tests on Share preview, Full results and `resultsState`, and a full `fetchPreview` envelope test.
  - `[low]` `[defer]` verification-gap 4: the browser envelope accepts an outer `madhab` that differs from the presented School — pre-existing parser behaviour (`web/src/api/case.ts:1533`).
  - `[false]` `[reject]` intent-alignment 1: descriptive reading, no defect claimed.
  - `[false]` `[reject]` intent-alignment 2: descriptive reading, no defect claimed.
  - `[false]` `[reject]` intent-alignment 3: describes the implemented reading, no defect claimed.
  - `[false]` `[reject]` intent-alignment 4: choice-card divergence — see edge-case-hunter 6.
  - `[medium]` `[patch]` intent-alignment 5: post-selection and mixed-refusal transitions unproven on both surfaces — fixed by the e2e and mixed-refusal patches.
  - `[false]` `[reject]` intent-alignment 6: p95 unverified — `capacity_check --samples 20` passed all 34 checks, standard_school p95 452 ms.
  - `[false]` `[reject]` cross-story-contract 1: shape inventory, no defect.
  - `[false]` `[reject]` cross-story-contract 2: consumer coverage table, no defect.
  - `[medium]` `[patch]` cross-story-contract 3: the Python parser rejects a produced Country answer — blind-hunter 1 fix.
  - `[medium]` `[patch]` cross-story-contract 4: the TypeScript parser rejects the same — blind-hunter 1 fix.
  - `[low]` `[defer]` cross-story-contract 5: same as verification-gap 4.
  - `[medium]` `[patch]` cross-story-contract 6: Share preview dropped the additional refusals — now renders each distinct presented refusal.
  - `[medium]` `[patch]` cross-story-contract 7: Full results dropped them — `resultsState` now carries them and the view renders them.
  - `[low]` `[reject]` cross-story-contract 8: the mixed all-refused case now passes the save gate — identical to the existing single-reason all-refused case, which already returned `unavailable`; mixed reasons across all four Schools is hypothetical.
  - `[low]` `[patch]` cross-story-contract 9: no browser test for the mixed `unavailable` envelope — added in `web/src/api/case.test.ts`.
  - `[low]` `[defer]` cross-story-contract 10: the shared-link view shows a generic error for `unavailable` — pre-existing for every refusal.
  - `[low]` `[defer]` cross-story-contract 11: the received-invite view does the same — pre-existing.
  - `[low]` `[defer]` cross-story-contract 12: no read-only wrapper test for `choose_school`; both views show a generic error — pre-existing.
  - `[low]` `[reject]` cross-story-contract 13: the report 409 carries one reason — previously this case returned `choose_school` with a null reason; listing all reasons adds response surface for a hypothetical case.

## Design Notes

v4 validator rules for `basis.kind == 'school'` (compare and Country rules unchanged; Country keeps `comparison_outcome` null):
- Sunni School (hanafi, maliki, shafii, hanbali), `state=answer`: `comparison_outcome` ∈ {`agreement`, `difference`}; `school_line.code` is `same_in_all_schools` iff `agreement`, else `school`; `comparison` null; no refusals.
- Sunni School, `state=refused`: `comparison_outcome` null (no comparison claim when the chosen School refuses).
- Non-Sunni School (Jafari): `comparison_outcome` null and `school_line.code == 'school'`, as today.
- `selection_required` stays compare-only.

The extra three evaluations are why the capacity check matters: reuse the selected School's evaluation and, if the capacity check fails, compare without building presentation rows for the non-selected Schools (only exact shares, blocked flags and unallocated are needed) before considering anything else.

## Verification

**Commands:**
- `uv run python manage.py test presentation.tests.test_present presentation.tests.test_parity engine.tests.test_contracts api.tests.PreviewTests api.tests.LayeredPreviewTableTests api.test_case_commands.RevisionTests api.test_case_commands.PreviewRevisionTests api.test_preview_performance api.test_capacity calc.test_switch_gate i18n.tests --noinput` -- expected: all pass
- `uv run python manage.py capacity_check --samples 20` -- expected: preview p95 < 1,000 ms, engine p95 < 200 ms, PASS
- `cd web && npm test` -- expected: all pass
- `cd web && npm run build` -- expected: success, no type errors
- `cd web && npm run test:e2e -- --project=chromium interview.spec.ts results.spec.ts accessibility.spec.ts` -- expected: all pass

## Auto Run Result

Status: done

**Change:** Server presentation also runs the four-Sunni-School comparison on a single Sunni School Basis, reusing the selected evaluation, and `PresentedResult` v4 reports agreement or difference for it. Share preview shows "Same result in all four Sunni schools" in teal above the rows and drops the "Calculated under" line on agreement; Full results follows the same presented line. The School prompt is a question with a 10px-radius, 12px-padded card group and 44px cards. When all four Schools refuse for different reasons the preview is `unavailable`, and both surfaces list every distinct refusal.

**Files:**
- `engine/contracts/codes.py`, `web/src/contracts/codes.ts`, `contracts/manifest.json` — `presented_result` 3 → 4.
- `engine/contracts/presented.py`, `web/src/contracts/presented.ts` — v4 School-Basis rules.
- `presentation/compare.py`, `presentation/present.py` — extra comparison for a Sunni School Basis only; Hanbali picked by name.
- `api/preview.py` — selected evaluation looked up by School; all-refused is `unavailable` whatever the reasons.
- `contracts/fixtures/**`, `contracts/fixtures.lock.json`, `api/contracts/preview-presented-fixtures.json`, `web/e2e/fixtures/fifty-heirs.json` — v4 fixtures, two new School-Basis fixtures, new invalid cases.
- `web/src/app/[locale]/interview/share-preview.tsx`, `school-choice.tsx`, `results/results-view.tsx`, `web/src/interview/results.ts` — agreement line, card group, distinct refusals.
- `web/src/i18n/messages.ts` — `chooseSchool` is now a question (en/ar/fr; native review logged in deferred-work.md).
- Tests: `presentation/tests/test_present.py`, `api/tests.py`, `i18n/tests.py`, `web/src/api/case.test.ts`, `web/src/interview/results.test.ts`, `web/src/test/preview-fixtures.ts`, `share-preview.test.tsx`, `results-view.test.tsx`, `received-view.test.tsx`, `web/e2e/interview.spec.ts`.

**Review:** 42 findings from one combined deep codex call (five layers). Patched: 13 medium and 9 low rows, forming three medium groups (Country Basis, mixed refusals, choose-School journey) plus test tightening. Deferred: 5 low rows as 2 frontmatter items, all pre-existing. Rejected: 6 low and 9 false, with reasons in the triage log.

**Follow-up review recommended: true** — three medium groups were patched (patched by entry verdict: high 0, medium 3, low 5). Unverified risk: the mixed-refusal rendering is new UI on Share preview and Full results, covered only by unit tests (no e2e sends a mixed all-refused envelope), and the Country path is covered only at the presentation layer.

**Verification (after patches):**
- `uv run python manage.py test presentation.tests.test_present presentation.tests.test_parity engine.tests.test_contracts api.tests.PreviewTests api.tests.LayeredPreviewTableTests api.test_case_commands.RevisionTests api.test_case_commands.PreviewRevisionTests calc.test_switch_gate i18n.tests --noinput --keepdb --parallel 2 --exclude-tag slow` — 130 tests OK in 77 s. Before the patches, the full Verification list including `api.test_preview_performance` and `api.test_capacity` ran serially: 158 tests OK in 34.5 min.
- `uv run python manage.py capacity_check --samples 20` — exit 0, all 34 checks passed; standard_school end-to-end p95 452 ms.
- `npm test` — 852 pass. `npm run build` — success.
- e2e chromium interview/results/accessibility — 254 passed; 2 failed with `ENOSPC` (C: drive about 480 MB free) and passed on rerun (9 runs).
- Matrix audit: every I/O row has a passing covering test.

**Residual risks:** the C: drive is nearly full and makes e2e runs fail at random with ENOSPC. Browser tabs still running v3 code will show the preview error until reloaded (contract bump). The three new `chooseSchool` strings need native review.
