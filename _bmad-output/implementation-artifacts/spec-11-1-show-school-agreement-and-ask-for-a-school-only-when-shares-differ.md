---
title: 'Story 11.1: Show School agreement and ask for a School only when shares differ'
type: 'feature'
created: '2026-11-27'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
warnings: ['oversized']
deferred: []
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
