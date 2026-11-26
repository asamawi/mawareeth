---
title: 'Story 9.12: Prove the complete family-entry journey meets capacity and speed gates'
type: 'chore'
created: '2026-11-23'
status: 'done'
baseline_commit: '2dc19ff415bd185f0832e4c7a13b650aa3849247'
route: 'dispatch'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
  - '{project-root}/web/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 9's Interview has no repeatable evidence that the six family actions (add, group add, edit, delete, drop, Undo) keep the Share preview under 1 s p95 with up to 50 Heirs. The 50-Heir layout with the summary bar, the capacity refusals in the browser, and the full UJ-2 journey are also unproven. 8.11's `capacity_check` times only an estate-amount change.

**Approach:** Extend 8.11's harness with the Interview action mix so every deploy measures it with both slots running. Add browser tests for 50-Heir reachability, capacity refusals and the UJ-2 journey. Collect the results in one Epic 9 gate evidence file that separates automated from manual evidence.

## Boundaries & Constraints

**Always:**
- Reuse `api/capacity.py` (`Harness`, `sample`, request accounting, preview validation, contention writer, network/render model, budgets). Extend it; do not fork it. Budgets stay the same: standard-family engine p95 < 200 ms, end-to-end p95 < 1000 ms.
- Interview workloads: for each of `school` (5 heirs, Hanbali), `compare` (all four Schools) and `two_later_deaths`, time `add`, `bulk_add`, `edit` (`update_heir`), `delete` (cascade probe plus confirmed remove), `drop` (anchored add) and `undo` (`restore`) through to a validated current-revision preview. Seed each Case to finish at up to 50 Heirs. Resets and seeding happen outside the timer.
- JSON evidence gains `device`, `network` and `workload` metadata and the raw latency samples in ms per action. It holds no names, ids or family payloads.
- The browser tests use the existing fixtures (`web/e2e/family.ts`, `web/e2e/api.ts`) and the existing `data-preview-revision`/`data-preview-state` attributes. Do not add `performance.mark` hooks or telemetry to the app.
- Capacity and later-death limits stay server-owned (`api/anonymous_case.py`). The browser only shows the refusal.
- The journey ends at the existing Save action. It does not add Epic 10's naming flow.

**Decisions (owner, 2026-11-23):**
- *Manual gate.* 9.12 closes when the automated evidence passes. `epic-9-gate-evidence.md` lists these items as **blocking, pending**: the real mid-range phone over 4G p95 run, Arabic NVDA/Chrome, VoiceOver/Safari iOS and TalkBack, and real 400% browser zoom. Epic 9 (its gate and retrospective) stays open until the owner records them. Emulated throttling is supporting evidence only. It never replaces the device run.
- *Live backend.* The UJ-2 journey and the browser-side timings run in a new **local-only** Playwright project `live`. It uses `next dev` (port 3000; its existing rewrite sends `/api/` to Django on 8000) with Django on local PostgreSQL. It is excluded from `npm run test:e2e` and CI. It runs through `npm run test:e2e:live`. The stubbed suites stay as they are in CI.
- *Scope.* Keep the full spec; the owner accepted the size (about 2,100 tokens).
- *Interview mix is report-only in the deploy (review pass 1).* The measured Undo with two later deaths is 1069 ms p95. `capacity_check` still runs and reports the Interview mix by default, with `passed` per action. Only the 8.11 foundation workloads decide the exit code. `capacity_check --enforce-interview` makes Interview misses exit 1 for local and owner runs. Each miss still prints `budget missed: interview …` and sets a top-level `interview_passed: false`. The gate evidence file records the miss as a **blocking failure** for Epic 9 (NFR-3), not waived. A follow-up performance story shrinks the Undo/Case payload.
- *Test gaps (review pass 1).* Fix them in this story.

**Never:** Change engine, presentation, contracts, migrations or the app UI. Change the budgets. Add a telemetry product or the FR-45 usability protocol. Waive a failing manual gate because the backend budget passes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|---|---|---|---|
| Interview mix measured | `capacity_check` on local PG | every action reported with p95 and `passed`; exit follows the foundation workloads | N/A |
| Interview action over budget | any Interview p95 ≥ 1000 ms | `interview_passed: false`, `budget missed: interview …` printed, exit 0 unless `--enforce-interview` (then 1) | the deploy switches; the gate file records a blocking NFR-3 failure |
| Foundation workload over budget | any 8.11 p95 ≥ budget | exit 1, `passed: false` | deploy aborts before switch (8.11) |
| 51st heir / bulk overflow | 50-Heir Case | 400 `over_capacity`, revision unchanged, existing heir still editable | alert, no "added" status |
| Third later death | two later deaths | 400 `death: limit`, nothing mutated, both estates still open | alert |
| Cascade cancel | delete a parent, then cancel | no request sent, family unchanged | N/A |
| Stale / offline / refused | older revision, offline, 400 | never announces success | existing alert paths |

</frozen-after-approval>

## Code Map

- `api/capacity.py:24` budgets, `:49` network/render model, `:74` `Harness.build`, `:81` workloads, `:102` `sample` (write step is a hardcoded `PUT case/deceased/` — parameterize method/path/body/revision), `:151` evidence dict `{commit, model, workloads, passed}`, `:180` retry accounting. Keep importable.
- `api/management/commands/capacity_check.py:10` CLI, exit codes 0/1/2, `--samples`, `--json`, `--no-contention`. Run the Interview mix by default so `deploy/release.sh:563` covers it.
- Endpoints (`api/urls.py:23`, `api/views.py:210,230,329`): `POST case/heirs/` (`add_heir`; drop = `anchor` plus optional `link`), `POST case/heirs/bulk/`, `PUT case/heirs/<id>/` (`update_heir`, incl. `same_as`), `DELETE case/heirs/<id>/?case_id&expected_revision&confirm_cascade`, `POST case/deaths/`, `POST case/restore/` (exported snapshot plus `expected_revision`). Command service is `api/case_commands.py:68,183`.
- Existing refusal tests: `api/tests.py:811`, `api/test_case_commands.py:275,303,738`. Reuse them; do not duplicate.
- `api/test_capacity.py` -- extend with small-sample Interview cases.
- `web/playwright.config.ts` -- static export on 4173/4174, `Desktop Chrome`. `web/e2e/api.ts:66,146` route stubs fail on unstubbed calls. `web/e2e/family.ts:50` `many` (50 sons) and lineage fixtures.
- `web/e2e/interview.spec.ts`: 50-heir root visibility `:1297,1325`; arrows/focus `:1391`; 11.3 bar `:1895,1973`; cards/columns `:2085`; same-person `:2283`; refusal/offline/stale `:305,531,797,1084`; drop equivalence `:1496,1601`; cascade cancel `:1210`; breadcrumb `:1795`. Add a new `web/e2e/capacity-journey.spec.ts` instead of growing this file.
- `web/src/app/[locale]/interview/start-case.tsx:502`, `share-preview.tsx:221,351,469` -- `data-preview-revision`, `data-preview-state`, `[data-preview-body][data-pending]` (pending shares stay visible, so wait on revision plus state, not text).
- `web/next.config.*:25` -- dev rewrites (the route for a real-backend run).
- `deploy/README.md:1108` "Capacity evidence"; `_bmad-output/implementation-artifacts/deferred-work.md:172,427-431,554-576` -- pending manual items to fold into the gate file.

## Tasks & Acceptance

**Execution:**
- [x] `api/capacity.py` -- Interview workloads and per-action timed write step; metadata plus raw samples in evidence -- AC1 on every deploy.
- [x] `api/management/commands/capacity_check.py` -- include the mix; add `--device`/`--network` labels (default `model`) -- evidence labelling.
- [x] `api/test_capacity.py` -- per-action pass, an over-budget fail, a no-payload assertion on the JSON.
- [x] `web/e2e/family.ts` -- a 50-Heir fixture: wide/deep lineage, long Arabic/English names, blocked and predeceased, two later estates.
- [x] `web/e2e/capacity-journey.spec.ts` (new, stubbed, CI) -- (1) at 375 and 1280 px with the bar visible: Fit, pan, zoom, arrows, edit and Undo keep the root visible; every card and action has a target of at least 44 px; card widths are 108 and 136 px; focus is not clipped. (2) The 51st add, a bulk overflow and a third death are refused, then an existing heir and an estate can still be edited.
- [x] `web/playwright.config.ts`, `web/package.json` -- add a `live` project (`testDir: "e2e-live"`) that is only active when `E2E_LIVE=1`. It has its own `webServer` entries for `next dev` and Django `runserver` (reuse servers that are already running), and is excluded from the default run. Add the script `test:e2e:live`. If API throttles refuse the live run, relax them only through an environment or test settings override for the local server. Production defaults stay unchanged.
- [x] `web/e2e-live/journey.spec.ts` (new) -- (3) the UJ-2 Arabic desktop journey, then phone (375 px) and keyboard-only variants. After every accepted step, assert that tree = Heirs outline = current-revision preview. A cascade cancel sends nothing. The breadcrumb return works. The drag and "Add relative here" paths give the same family from the server. The journey ends at Save. (4) Browser timing: for each of the six actions on a 50-Heir School, comparison and two-later-death Case, under Chrome 4× CPU throttling and Fast 4G emulation (supporting evidence), write the per-action samples and p95 as JSON to `web/test-results/live-timings.json`. That file holds no names or ids.
- [x] `web/e2e/accessibility.spec.ts` -- axe on the 50-Heir fixture at 375/1280, en/ar, light/dark.
- [x] `_bmad-output/implementation-artifacts/epic-9-gate-evidence.md` (new) -- the gate table: check, automated/manual, command or runbook, result, blocking. Add the manual phone/4G runbook. List open assumptions. Use no names.
- [x] `deploy/README.md` -- update "Capacity evidence" for the Interview mix and new JSON fields.
- [x] `deferred-work.md` -- add a "Story 9.12" section that points the pending manual items to the gate file.

**Acceptance Criteria:**
- Given local PostgreSQL, when `capacity_check --samples 20` runs, then it reports all six actions for school, compare and two-later-death with `samples_ms`, p95 and `passed`, and sets `interview_passed`. Its exit code depends only on the 8.11 workloads, which are unchanged. With `--enforce-interview`, an Interview miss exits 1.
- Given the review pass 1 fixes, then they are done:
  - [x] `api/capacity.py`, `capacity_check.py`, `api/test_capacity.py`, `deploy/README.md` -- report-only Interview mix with `interview_passed` and `--enforce-interview`. Tests: a literal required workload × action matrix, not the imported constants. The `edit` step also changes the relationship. Read-back tests of the `--json` file: pass and fail, and with and without the Interview mix (with it off, both `interview` and `workload` are absent). An Interview miss exits 0 by default and 1 with the flag.
  - [x] `web/e2e-live/live.ts`, `journey.spec.ts` -- `shapeOf` keeps the parent id, and the drop and Add-here results are checked against the selected cards. The phone journey checks sync after every accepted step. The cascade-cancel check sends no DELETE at all on Cancel.
  - [x] `web/e2e-live/timings.spec.ts` -- validate `E2E_LIVE_SAMPLES` (an integer ≥ 1). Build the two-later-death Case the same way as the harness (same `empty` choice).
  - [x] `web/e2e/capacity-journey.spec.ts` -- the 44 px check also covers the Heirs outline actions and links, with the threshold at 44 (allow only sub-pixel rounding, ≥ 43.99). The third-death test keeps both later estates in its input and opens each one after the refusal. Each refusal test also has a stale-tab variant: a 409 with the newer full Case, reconciled, then controls and both estates checked. The root-visibility check also asserts that the summary bar does not cover the root.
  - [x] `api/test_fifty_heir_fixture.py` -- write only when `WRITE_FIFTY_HEIR_FIXTURE == "1"`. The routine test rebuilds the Case through the real API and compares its shape (counts, edges, statuses) with the committed fixture.
  - [x] `epic-9-gate-evidence.md` -- a plain-JS phone runbook snippet that resets `start`, `end` and `revision` for each sample. Record the 1069 ms Undo miss (two later deaths) as a blocking NFR-3 failure and point to the follow-up performance story. Record the elapsed time of the full command.
  - [x] `deferred-work.md` -- add the follow-up performance story: shrink the Undo (`restore`) request and the whole-Case write responses so Undo with two later deaths meets p95 < 1 s. Then switch the deploy to `--enforce-interview`.
- Given `git diff <baseline> -- engine contracts presentation api/migrations web/src`, then it is empty.
- Given the gate evidence file, when read, then every NFR-1/NFR-3/NFR-X1 check has a result or is marked blocking-pending, and none is waived.

## Implementation Notes

## Spec Change Log

### 2026-11-23: review pass 1 (intent gap resolved by the owner; code kept)
- **Trigger:** the parent rerun of `capacity_check --samples 20` exits 1, because `two_later_deaths undo` p95 is 1069 ms. As built, every deploy would abort.
- **Amended:**
  - the frozen Decisions: Interview mix report-only, plus test gaps fixed here (the owner's answers);
  - the I/O matrix rows for budget misses;
  - the capacity AC;
  - the review-fix task list.
- **Avoids:** a deploy gate that blocks every release on a known product-speed miss, and test checks that cannot catch a wrong parent, a covered root or a lost second estate.
- **KEEP:**
  - the harness extension design (`sample(step=…)`, the `contention()` context manager, `run_interview`, the untimed restore resets);
  - the server-generated 50-Heir fixture approach;
  - the `live` project wiring (its own `distDir`, the env-overridable ports, the `settings_e2e_live` guard);
  - the stubbed 375/1280 checks;
  - the gate evidence file structure.
- **Process deviation:** the code was not reverted for this intent gap. It was sound apart from the routed findings, so the fixes go to the same implementer as targeted changes.

## Review Triage Log

### 2026-11-23: Review pass 1 (blind-hunter, edge-case-hunter, verification-gap and cross-story-contract in one combined read-only codex call, deep tier; diff 99.6 kB)

Parent verification: the backend tests (80) are OK. `capacity_check --samples 20` **exits 1**: `two_later_deaths undo` p95 is 1069 ms (the implementer's run gave 999.9 ms). The whole run takes about 2.5 min.

| # | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| 1 | Undo with two later deaths has no headroom; deploys can abort (blind, verification-gap) | high | Parent rerun exits 1 at 1069 ms. Because the mix runs by default, every deploy would refuse the switch until the Undo/Case payload is smaller. The frozen intent does not say what the deploy should do when the product itself misses. | intent_gap |
| 2 | A cascade delete is modelled with 2 RTTs but makes 3 requests | false | The Interview probes, then waits for the user's confirmation (`web/src/api/case.ts:695`). Latency the user sees from the confirm click is confirm + preview, which is 2 RTTs. Probe server time is still counted, so the figure overstates. | rejected |
| 3 | The full command may overrun the 600 s deploy timeout | low | Measured about 2.5 min locally. It is not demonstrated on the production host. | moot (loopback) |
| 4 | The live `shapeOf` drops the parent id, so the drop/Add-here equivalence cannot catch a wrong brother | medium | `web/e2e-live/live.ts:80` compares only `parent.relationship`. | moot (loopback) |
| 5 | The 44 px selector omits the Heirs outline actions; tolerance is 43.5 | medium | `web/e2e/capacity-journey.spec.ts:71` | moot (loopback) |
| 6 | The third-death test slices `deaths` to one, so "both estates stay open" is not proven | medium | `capacity-journey.spec.ts:132,183` | moot (loopback) |
| 7 | Refusal tests use a scripted 400; a stale tab really gets a 409 with the newer Case | low | `api/case_commands.py:79` checks the revision first. The 400 path still tests the alert copy. | moot (loopback) |
| 8 | The tests import `INTERVIEW_ACTIONS`, so dropping an action passes silently | medium | `api/test_capacity.py:9` | moot (loopback) |
| 9 | The backend edit only renames; the browser changes the relationship | low | `api/capacity.py:254` | moot (loopback) |
| 10 | `empty: true` differs between the browser and the harness for two later deaths | maybe-false | Needs the `deaths/` handling of `empty` read in `api/anonymous_case.py`. | moot (loopback) |
| 11 | The phone runbook snippet is TypeScript and does not reset `start`/`end` | medium | `epic-9-gate-evidence.md:45` vs `timings.spec.ts:26,133` | moot (loopback) |
| 12 | `E2E_LIVE_SAMPLES` is not validated; `WRITE_FIFTY_HEIR_FIXTURE=0` may write | low | `timings.spec.ts:13`; `api/test_fifty_heir_fixture.py:84` | moot (loopback) |
| 13 | The cascade confirm can apply to a newer revision under contention | low | Benchmark-only; the server rechecks impact per request. | rejected |
| 14 | The harness accepts a newer-revision preview, which the browser discards | low | Pre-existing 8.11 behavior (`api/capacity.py:147`). | moot (loopback) |
| 15 | `openFiftyHeirs` waits only for `ready`, while the fixture check admits `choose_school` | low | The committed fixture is `available`; only a regenerated disagreeing fixture would time out. | rejected |
| 16 | Live-port reuse may hit a server with other settings | low | `reuseExistingServer: true`; documented ports override. | rejected |
| 17 | The fixture check compares the committed halves only, not a fresh build | low | `api/test_fifty_heir_fixture.py:96` | moot (loopback) |
| 18 | Full `--json` file variants (pass/fail, with and without Interview) are not read back in tests | low | `api/test_capacity.py:142,175` | moot (loopback) |
| 19 | Live phone journey asserts sync only after five adds | low | `web/e2e-live/journey.spec.ts:112-117` | moot (loopback) |
| 20 | The cascade-cancel filter would miss a redundant unconfirmed DELETE | low | `journey.spec.ts:89-96` | moot (loopback) |

Pass 1 fixes were applied by the same implementer. Parent verification after the fixes:
- backend tests: 84 OK;
- `capacity_check --samples 20`: exit 0, `passed: true`, `interview_passed: false` (`two_later_deaths` `undo` 1080 ms, `bulk_add` 1077 ms; recorded as a blocking NFR-3 failure);
- `npm test`, lint (0 errors, 12 warnings), typecheck and build: OK;
- the four Playwright specs: 286 passed;
- `npm run test:e2e:live` (ports 3100/8100, 3 samples): 6 passed.

## Design Notes

**Why the mix runs on every deploy:** AD-27 asks for measurement with both slots running. That happens only during the deploy handover. The extra time is bounded by `--samples`.

**Timing in the browser:** start `performance.now()` in a test-installed listener before the action. Stop when `data-preview-revision` equals the write response's revision and `data-preview-state` is `ready`/`choose-school`, after one `requestAnimationFrame`.

## Verification

**Commands:**
- `uv run python manage.py test api.test_capacity api.test_case_commands --noinput` -- expected: OK.
- `uv run python manage.py capacity_check --samples 20 --json <scratch>/capacity.json` -- expected: exit 0.
- `cd web && npm test && npm run lint && npm run typecheck` -- expected: pass, at most 12 lint warnings.
- `cd web && npm run build && npx playwright test e2e/capacity-journey.spec.ts e2e/interview.spec.ts e2e/accessibility.spec.ts e2e/csp.spec.ts` -- expected: all pass.
- `cd web && npm run test:e2e:live` (local PostgreSQL running, `uv run python manage.py migrate --noinput` done) -- expected: journey passes; `live-timings.json` p95 < 1000 ms per action.

**Manual checks:**
- The phone/4G run and Arabic screen readers follow the runbook in `epic-9-gate-evidence.md`.
