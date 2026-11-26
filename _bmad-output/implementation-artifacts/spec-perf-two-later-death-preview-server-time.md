---
title: 'Cut the case preview server time so two-later-death actions pass the capacity gate on production'
type: 'bugfix'
created: '2026-11-26'
status: 'done'
baseline_commit: '63c9e2089ec8b708fdcb22b49212a8d86c28365d'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-perf-two-later-death-capacity-on-production.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The production deploy of 6e065c81 (PR #114) failed `capacity_check --enforce-interview` again: `two_later_deaths` p95 1035–1111 ms against the p95 < 1000 ms budget (p50 880–994; `compare`/`school` pass at 560–650). The per-attempt timings show the preview GET is now the largest server cost: 208–252 ms on production (compare ~82), ~61–71 ms locally. Profiling (codex, local): 4 school evaluations each solve all 3 estates; engine `freeze`/`thaw` round-trips the evidence (~26k calls per GET); `dump_presented_result` deep-copies the presented tree; all four legacy school bodies are built though only Hanbali's is returned when the schools agree; number formatting and term lookups repeat.

**Approach:** Make the preview request do less repeated work while returning the exact same response, targeting ≥30% less preview server time locally on the `two_later_deaths` workload (estimate ~35%; ≈150 ms on production).

## Boundaries & Constraints

**Always:**
- The preview response body (`api:case-preview`, every status: available, unavailable, choose_school, not_ready, refused) and the draft report (`reports/views.py`, which also calls `api/preview.py:preview`) stay byte-for-byte identical for the same session and revision, in English and Arabic.
- Engine results (`Result`, `Evaluation`, frozen proof/table) stay equal and immutable to their callers; general `dump_presented_result`/`parse_presented_result` keep their copy semantics for other callers.
- Caches live only within one request or are pure module-level lookups keyed by all their inputs (locale, key, value).

**Never:** Change the response contract, payload size, budget, network model, or capacity-harness behaviour; change inheritance rules or which schools are solved; cache across requests anything derived from the session case; touch `web/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Schools agree | `two_later_deaths`, `compare` workloads, madhab None | identical body; only the Hanbali legacy body is built | — |
| Schools disagree | `disagree_compare` workload | identical `choose_school` body with per-school bodies and differences | — |
| Fixed school | madhab hanbali / hanafi | identical body | — |
| Refused / impossible | impossible family, unsupported school | identical refusal body | existing path |
| Arabic locale | any of the above with `ar` | identical body | — |

**Decision (owner, 2026-11-26):** Keep solving all four schools. Do not evaluate once and copy the result across schools, even when no school-specific rule can apply; that can be proposed later as its own change if production still misses the budget.

</frozen-after-approval>

## Code Map

- `engine/core.py:36-51` `freeze`/`thaw`; `:81-105` `_estate` freezes evidence and table; `:139-166` `evaluate` immediately thaws them per estate (`'proof': thaw(evaluation.proof)`, `tables.append(thaw(...))`) and freezes the layered proof/table again. Keep the plain dicts from `_estate` for the layered build and freeze once; check `proof_module.build_layered`/`build_layered_table` do not mutate their inputs (copy if they do).
- `engine/contracts/presented.py:301,308` `parse_presented_result`/`dump_presented_result` -- `deepcopy(vars(presented))`. Add a non-copying dump used only where the `PresentedResult` was just built in the request (`api/preview.py:preview`); keep the general function unchanged.
- `api/preview.py:169` `_body`, `:205` `compare`, `:241` `preview` -- when madhab is None, `compare` builds four full legacy bodies (proof labelling, `_table`, formatting) and `_signature` compares them. Decide agreement from each evaluation's exact final shares (`engine/core.py:final_shares`) and unallocated before building bodies; build only the Hanbali body on agreement; keep the four-body path on disagreement or any refusal. `:130` `_evidence` thaws proof/table again.
- `presentation/formatting.py` `Formatter`, `i18n/__init__.py` `term` -- repeated `babel.numbers.format_decimal`/`format_currency` (429/48 calls per GET) and `term` (1,425 calls): memoize per Formatter instance / per (locale, key).
- `presentation/table.py:32` -- thaws the table; read the frozen mapping directly if trivial.
- `api/capacity.py` `Harness.build_interview` -- reuse to build the `two_later_deaths`, `compare`, `disagree_compare` sessions in tests; do not change the harness.

## Tasks & Acceptance

**Execution:**
- [x] `engine/core.py` -- avoid the per-estate freeze→thaw round trip inside `evaluate`; freeze once at the end -- removes most freeze/thaw calls.
- [x] `engine/contracts/presented.py`, `api/preview.py` -- non-copying dump for the freshly built presented result; agreement decided from exact shares before building legacy bodies; only the shown body built on agreement -- removes deepcopy and three of four legacy bodies.
- [x] `presentation/formatting.py`, `i18n/__init__.py` -- memoize number formatting per formatter and term text per (locale, key) -- removes repeated babel/term work.
- [x] `api/test_preview_performance.py` (new) -- golden-equality test: for the matrix scenarios, the response bytes from the optimized path equal those from a reference built with the pre-change functions (keep reference helpers inside the test), in `en` and `ar`; a timing-free work-count test (e.g. one legacy body built on agreement, `deepcopy` not called by the preview dump).
- [x] `_bmad-output/implementation-artifacts/spec-perf-two-later-death-preview-server-time.md` -- record before/after local median preview ms for `compare` and `two_later_deaths` (20 GETs each).

**Acceptance Criteria:**
- Given the `two_later_deaths` workload locally, when 20 preview GETs are timed, then the median is at least 30% below the pre-change median and `compare`/`school` previews are not slower.
- Given the existing preview, report and engine tests, when they run, then they pass unchanged.

## Implementation Notes

Local median preview GET ms (20 timed GETs after 3 warm-ups, Django test client, `Harness.build_interview` sessions, `madhab` None except `school`):

| Workload | Before | After |
|---|---|---|
| compare | 29.4 | 17.2 |
| school | 18.1 | 10.8 |
| two_later_deaths | 69.5 | 41.7 (-40%) |

Changes: `engine/core.py` keeps plain evidence inside `evaluate` and freezes once (`_solve_estate`; `_estate` still returns a frozen Evaluation); `dump_fresh_presented_result` (no deepcopy) used only by `api/preview.py:preview`; agreement decided from exact `final_shares` (`_schools_agree`), one Hanbali body built on agreement, four-body path kept on disagreement/refusal/impossible; `Formatter` memoizes its texts per instance and `i18n.term` is `lru_cache`d. `presentation/table.py` and `_evidence` thaws were left as is.

Verification (parent): spec command 458 tests OK (1 skipped). One-off baseline check: the 10 parity cases rendered by `api.preview.preview` in en and ar at the baseline commit (git worktree) and in the working tree are byte-identical (20/20). Local `capacity_check --enforce-interview`: `interview_passed` true; `two_later_deaths` preview_ms median 42.3, p50 612–662, p95 664–738 (compare preview 18.2, school 23.4).

## Spec Change Log

## Review Triage Log

Pass 1 (one combined codex call, standard tier; all four layers). Cross-story contract: no contract shape changed. Codex confirmed the agreement shortcut matches the old `_signature` check (`_body` derives `blocked` from a zero final share and unallocated from the same map; its only `unavailable` paths, impossible and refused, are guarded).

| # | Layer | Finding | Verdict | Evidence / route |
|---|---|---|---|---|
| 1 | blind, edge, verification | `term` `lru_cache` can serve stale text after a catalog or published-locale change | low → reject | `i18n.registry()` and `i18n.catalog()` are already process-lifetime `lru_cache`s, so production sees no new staleness; the only tests that patch `i18n.catalog` (`mawareeth/tests.py:1110`) go through `release_gates.catalogs`, which never calls `term`. Unlikely, and the fix adds invalidation machinery. |
| 2 | blind, edge | `term` cache keyed on the raw locale tag grows without bound | false | Callers pass `get_language()` or a published code: a small fixed set. |
| 3 | blind, edge, verification | `Formatter.integer` memo key makes `Decimal('-0')` and `Decimal('0')` share an entry | low → patch | Reproduced by codex; current callers pass ints, but the fix is a direct key correction. |
| 4 | blind, edge | Memo ignores the active Decimal context | false | Percent/kirat round in integer arithmetic and `scaleb` is exact; nothing in the codebase changes the Decimal context. |
| 5 | blind, edge, verification | Parity test's reference reuses the changed `evaluate` and `Formatter`, so a shared regression passes | medium → patch | True: only `preview()` differs between sides. Add an old-loop `evaluate` reference and a direct-Babel formatter check. |
| 6 | blind, edge | Parity test compares `sort_keys` dumps, hiding member-order changes | low → patch | Direct correction: compare unsorted dumps. |
| 7 | blind | Matrix row "unsupported school" untested; status assertions omit `unavailable` | medium → patch | Matrix audit requires a covering test. |
| 8 | blind | `_impossible` repeated; disagreement path recomputes final shares | low → reject | Microseconds, and reuse would add plumbing. |

## Verification

**Commands:**
- `uv run python manage.py test api.test_preview_performance api.tests engine presentation reports --noinput` -- expected: all pass
- `uv run python manage.py capacity_check --json` (local) -- expected: `interview_passed` true; `two_later_deaths` preview_ms medians lower than before
