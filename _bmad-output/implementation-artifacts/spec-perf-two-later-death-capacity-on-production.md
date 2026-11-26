---
title: 'Cut Interview server time so two-later-death actions pass the capacity gate on production'
type: 'bugfix'
created: '2026-11-26'
status: 'done'
baseline_commit: '966b76bf85504932de14a09eec72a9378f334d6a'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-9-15-bring-two-later-death-interview-actions-under-the-one-second-budget.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The production deploy of e4d2f699 failed `capacity_check --enforce-interview` (`deploy/release.sh:563`): every `two_later_deaths` Interview action measured p50 1332–1574 ms, p95 1425–1695 ms against the 1000 ms budget, while `compare`/`school` passed. Server CPU dominates (local 281–383 ms vs 48 ms for `compare`; production ~2.5–3× slower): a write decodes the case 5× and decorates it 6–7×, and link-candidate eligibility (~55% of profiled time) rescans every estate's heirs per candidate.

**Approach:** (1) Index link-candidate eligibility once per decoration; (2) decode once per request and decorate only when a case is returned, with a lighter matching-preview read path; (3) add per-attempt phase timings to the capacity JSON so the next production run shows where time goes. Owner-approved scope; production is verified separately before any master merge.

## Boundaries & Constraints

**Always:**
- Every response body stays byte-for-byte equivalent in content: decorated case shape, `link_candidates` (same members, same order, current link appended only if absent), `edit_options`, `heir_options`, placement, `saved`, snapshot, preview body, and all 409/cascade/missing-heir replies (which still carry the full decorated case).
- Writes keep revision checks, cascade confirmation, rollback-on-exception, `_anchor_edge` placement validation, and v2 snapshot lossless-round-trip checks.
- Capacity changes are additive fields only: `NETWORK`, budgets (200/1000 ms), sample counts, retry limits, the contention writer and its `stop.wait(.002)`, `passed`/`interview_passed` logic and exit codes stay unchanged.

**Never:** Change the budget, network model, sample count or contention writer. Change API contracts, `web/` code, the checked-in `web/e2e/fixtures/fifty-heirs.json`, migrations, the engine, or presentation. Cache across requests (sessions change under the lock). Compact preview/response payloads or change the delete-confirmation flow (deferred option 3/4).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Link candidates | case with linked, referenced, deceased-later and lineage-edge rows | identical candidate lists and order to before | — |
| Matching preview | GET preview, current `case_id` | same body; no decoration/placement work | — |
| Stale preview | GET preview, old `case_id` | 409 with full decorated case + snapshot (unchanged) | existing path |
| Write then failure | mutation raises mid-write | session restored, nothing changed | existing rollback |
| Capacity JSON | `capacity_check --json` | existing fields unchanged plus per-attempt `write_ms`, `preview_ms`, `validation_ms`, `lock_wait_ms`, `request_bytes`, `response_bytes` (incl. retries and cascade probe) | — |

</frozen-after-approval>

## Code Map

- `api/anonymous_case.py:527,551,561` `_is_referenced`, `_link_issue`, `_link_candidates` -- the quadratic part: per row rescans aliases/death owners/edge ends, and per candidate rescans the destination estate for an already-represented identity. Index reference IDs and per-estate canonical identity counts once in `_decorate` (`:575`); preserve canonical traversal order, skip-self, gender/lifetime checks, refusal precedence, `[]` for referenced rows.
- `api/anonymous_case.py:500-534` `_layers`, `_rows`, `_person`, `_link_context` -- reuse these id→row, `same_as`, position and death-order maps; build once per decoration.
- `api/anonymous_case.py:514` `_is_locked` -- scans identity peers and death targets per row; index alongside.
- `api/anonymous_case.py:299,341,364` `_stored`, `_decode`, `get`; `:188-247,376,629` `read_snapshot`, `_read_*`; `:589,595` `_placement`, `_describe` -- decode = normalize + `_decorate` + `_describe`. Split so callers can get undecorated inputs and decorate on demand.
- `api/anonymous_case.py:417,427,454-470,669` `_live`, `_save`, `_store_case` -- `_save` decodes before and after storing; `_store_case` decorates before `_save`. Remove redundant decodes; keep `_anchor_edge` (`:892,898`) placement validation.
- `api/snapshots.py:89,101,169` `encode_v2`, `decode` -- v2 decode re-runs `read_snapshot` for its round-trip check; that check must stay, but it needs no decoration.
- `api/case_commands.py:68-96` `execute`; `:148,183,191` `bulk_add`, `restore` -- entry read + post-write read; pass the decoded case through instead of re-reading where the session has not changed.
- `api/views.py:338` `PreviewView.get`; `api/preview.py:63-241`; `calc/adapters.py:18` -- matching preview needs only school, deceased, ordered heir ids/relationships/aliases/genders, deaths, died-before and edges; not names, `saved`, `persons`, options, candidates or placement. `reports/views.py:34,44` also reads the live case.
- `mawareeth/middleware.py:84-120` `CaseWriteLockMiddleware` -- already computes `wait_ms`; expose it to the harness (e.g. response header or request attribute read by the test client) without changing lock behaviour.
- `api/capacity.py:60,69,107-167` `Harness.request`, `sample` -- add per-attempt records next to existing metrics; keep the outer timer and byte sums as the modeled-total inputs. `:172-182` contention writer uses the same `sample()` (Story 9.15: a faster shared path also speeds the writer).

## Tasks & Acceptance

**Execution:**
- [x] `api/anonymous_case.py` -- index link eligibility and lock checks once per decoration; split decode into undecorated read + on-demand decorate; drop redundant decodes in `_save`/`_store_case` -- removes the quadratic scans and repeat work.
- [x] `api/case_commands.py`, `api/snapshots.py` -- reuse the decoded case within a request; decorate once for the response -- fewer decodes per write.
- [x] `api/views.py`, `api/preview.py`, `reports/views.py` -- matching preview and draft report use the undecorated read; stale-preview 409 stays decorated -- lighter read path.
- [x] `api/capacity.py`, `mawareeth/middleware.py` -- per-attempt phase records in the JSON -- production diagnostics.
- [x] `api/tests.py`, `api/test_case_commands.py`, `api/test_capacity.py` -- add a parity test that compares link candidates/edit options/placement from the new code with a straightforward reference implementation on a three-estate later-death case (linked, referenced, deceased and lineage-edge rows); a decode-count test for one write and one preview; JSON-shape test for the new fields -- regression safety.

**Acceptance Criteria:**
- Given the existing suites (`api.tests`, `api.test_case_commands`, `api.test_capacity`, `api.test_snapshots`, `api.test_fifty_heir_fixture`, `reports.tests`), when run, then all pass with no fixture rewrite.
- Given one Interview write on the `two_later_deaths` case, when executed, then the case is decoded at most twice and decorated once; a matching preview decorates zero times.
- Given `capacity_check --samples 20` locally (contention on), when run before and after, then `two_later_deaths` local server time per action drops to ≤ 170 ms p50 (the level that fits production's ~2.7× factor), `compare`/`school` do not regress, and before/after numbers are recorded in Implementation Notes; if the target is missed, record the numbers and the new per-phase breakdown instead of tuning the harness.

## Design Notes

Contention: Story 9.15 showed a faster shared path also speeds the contention writer. Report conflicts per action before/after; a large rise is a finding to record, not a reason to touch the writer.

Production estimate: allowed budget minus modeled network (300 ms RTT, 100 ms render, ~130 ms transfer for later deaths) leaves ~470 ms server time on production ≈ 170 ms locally.

## Verification

**Commands:**
- `uv run python manage.py test api.tests api.test_case_commands api.test_capacity api.test_snapshots api.test_fifty_heir_fixture reports.tests --noinput --parallel 1` -- expected: OK.
- `uv run python manage.py capacity_check --samples 20 --json <scratch>/capacity.json` before and after -- expected: exit code reported, per-phase fields present, numbers recorded.

## Implementation Notes

Local `capacity_check --samples 20` (contention on), before (commit 966b76bf, with only the harness/middleware phase fields applied) and after. Server time = write + preview + validation, p50 per action.

| Case / action | Total p50 before -> after | write ms | preview ms | validation ms |
|---|---|---|---|---|
| two_later_deaths add | 825 -> 653 | 141 -> 18 | 113 -> 79 | 10.7 -> 9.4 |
| two_later_deaths bulk_add | 839 -> 654 | 146 -> 17 | 113 -> 82 | 10.5 -> 10.6 |
| two_later_deaths edit | 824 -> 648 | 130 -> 17 | 102 -> 77 | 12.9 -> 9.2 |
| two_later_deaths drop | 822 -> 657 | 129 -> 19 | 103 -> 77 | 12.5 -> 10.1 |
| two_later_deaths undo | 898 -> 698 | 166 -> 25 | 101 -> 72 | 10.3 -> 10.2 |
| two_later_deaths delete | 958 -> 706 | 121 -> 51 | 35 -> 28 | 5.7 -> 6.3 |
| compare add | 506 -> 499 | 19 -> 11 | 32 -> 31 | 5.2 -> 5.5 |
| school add | 578 -> 525 | 82 -> 36 | 36 -> 30 | 6.0 -> 6.3 |

- Local server time per `two_later_deaths` write action is about 105-125 ms after (was about 255-290 ms), under the 170 ms target. `compare` and `school` did not regress. After the change `interview_passed` is true (it was false before: delete p95 1004-1012 ms).
- Delete conflicts per 20 samples: 20 before, 19 after (the cascade probe); no rise in any other action.
- What changed: link-candidate/lock/referenced checks are indexed once per decoration (`_Index`); a command reads the case once undecorated (`get(decorate=False)`), hands it to `_live`, stores without decoding before or after (`_save(_base=...)`), and decodes+decorates once for the response; v2 decode's round-trip uses undecorated reads; the matching preview and the draft report read undecorated. Errors that carry a case (`Conflict`, `StaleCase`, `HeirNotFound`, `CascadeUnconfirmed`) decorate it in their constructor, so 409/404 bodies are unchanged. An anchored add describes placement on demand.
- The remaining server time is mostly the preview (engine, about 75 ms on later deaths).
- Verification: `api.tests api.test_case_commands api.test_capacity api.test_snapshots api.test_fifty_heir_fixture reports.tests --parallel 1` ran 441 tests OK (3 skipped) before the three new tests; the new `DecorationPerformanceTests` and extended `api.test_capacity` also pass.

## Spec Change Log

## Review Triage Log

### 2026-11-26 — Review pass 1 (combined codex: blind-hunter, edge-case-hunter, verification-gap, cross-story-contract)
- `[medium]` `patch` Undo decorates twice: `restore()` (`api/case_commands.py:198`) calls `read_snapshot` decorated before `execute` decorates the response — breaks "decorated once" for writes. (edge-case, verification-gap other)
- `[medium]` `patch` A lock-timeout attempt records `lock_wait_ms: null`: `lock()` raises before returning, so the middleware never sets the attribute; the busy wait is exactly the production diagnostic. Grouped with the edge-case note that a real timeout could fail the timing-shape test and the contract note on the unserialized busy retry. (blind-hunter, edge-case, cross-story-contract)
- `[low]` `patch` 409 attempt records do not distinguish a revision conflict from the expected cascade probe (`api/capacity.py:132`); the branch already knows. (blind-hunter, cross-story-contract)
- `[low]` `patch` Matching-preview test accepts any 200 and counts only `_decorate`; a second undecorated decode or a wrong status would pass. (blind-hunter, edge-case, verification-gap)
- `[low]` `patch` Stale draft-report 409 test checks only status; the body now redecorates explicitly (`reports/views.py:50`). (verification-gap)
- `[low]` `patch` Capacity attempts test accepts constant durations and swapped byte counts; no assertion on the cascade-probe sequence. (blind-hunter, verification-gap, cross-story-contract)
- `[low]` `reject` Attempts are lost when a sample raises SetupError (`api/capacity.py:148`): failed samples abort the run already; carrying attempts into SetupError adds new error surface for a rare path.
- `[low]` `reject` Busy preview JSON parse is outside `validation_ms` (`api/capacity.py:154-178`): sub-millisecond, and preview GETs bypass the write lock, so busy previews do not occur in the workload.
- `[false]` `reject` Placement parity compares the new code with itself: `_placement`/`_describe` are unchanged by the diff; the test checks decorate-at-read equals decorate-later, and placement values stay pinned by `InterviewLineageTests`.
- `[low]` `reject` Implementation Notes show only `add` for compare/school and delete conflicts only: the fix edits this build's spec.
