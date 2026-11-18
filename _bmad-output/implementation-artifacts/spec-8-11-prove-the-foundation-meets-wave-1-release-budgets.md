---
title: 'Story 8.11: Prove the foundation meets wave-1 release budgets'
type: 'feature'
created: '2026-11-18'
status: 'done'
baseline_revision: '8b27b7ab16f8ba16750b83180396acd8075c3055'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
warnings: [multiple-goals, oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** Epic 8's foundation (pure engine, presentation, command service with revision locks, schema-2 snapshots) has no repeatable proof that it meets the AD-27 budgets. Its requests emit no structured outcomes, so failures cannot be seen. Readiness checks only the database and migrations. Nothing in the image blocks the slot switch when a foundation gate fails. The restore runbook never checks that restored Saved cases still open, keep their names and revisions, and that their shares and invites still resolve.

**Approach:** Add four things, all as code that runs from the release image:
- `capacity_check`: a management command that measures the engine and end-to-end preview workloads against the budgets;
- a middleware that logs one redacted, low-cardinality outcome record per foundation request, and a foundation check in readiness;
- `release_check`: a database-free in-image gate. It runs before the switch in `release.sh` (with `capacity_check`) and in the CI image smoke test;
- `restore_check`: a read-only application-level check that the restore runbook runs on the restored database.

## Boundaries & Constraints

**Always:**
- **Capacity (`python manage.py capacity_check [--samples N] [--json PATH] [--no-contention]`, default 20 samples per workload).**
  - **Workloads:**
    - `standard_school`: wife, father, mother, one son, one daughter; school hanbali; estate 120000.
    - `standard_compare`: the same family with no school (the four-School comparison).
    - `fifty_compare`: 50 Heirs in the first layer (wife, 25 sons, 24 daughters), no school.
    - `later_deaths_compare`: a family with the two supported later deaths, no school.
  - **Engine phase:** time `evaluate_outcome(family, basis)` in memory. Build the family the way `api.preview.preview` does (`family_from_session(..., names=False)` and `basis_from_madhab`). Use `time.perf_counter`.
  - **End-to-end phase:** use an in-process `django.test.Client` through the full middleware stack, PostgreSQL included.
    - Build each case through the real `/api/v1/case/...` command endpoints.
    - One sample is one command write (toggle the estate through `case/deceased/`, alternating two values) followed by `GET case/preview/`. Wall time includes retries after 409 conflict or 503 busy.
    - Unless `--no-contention` is given, a second thread writes to the same session for the whole phase, so the session row lock is really contended. Lock waits are inside the sample; they are never subtracted.
    - The Client sends a host from `ALLOWED_HOSTS` and `secure=True`.
    - Throttles are disabled for the command's own Client only, through `unittest.mock.patch` of the throttle classes' `allow_request` inside the command. Settings are never changed.
    - Every Session row the command created is deleted at the end, including on failure. SavedCase is never touched.
  - **Network model** (constants recorded in the evidence; the real device is measured by Story 9.12):
    - `rtt_ms=150`, `down_kbps=1600`, `up_kbps=750`, `render_ms=100`;
    - `client_ms = 2*rtt_ms + request_bytes*8/up_kbps + response_bytes*8/down_kbps + render_ms`, from the measured bytes of each sample.
  - **Budgets:**
    - the engine p95 under 200 ms for both `standard_*` workloads;
    - the p95 of (server sample + client_ms) under 1000 ms for every workload;
    - the other engine workloads are reported only.
  - **Output and exit:**
    - Output is counts and timings only: for each workload and phase, n, p50, p95 and max ms; busy and conflict counts; and pass/fail. `--json` writes the same evidence plus the image commit (`settings.RELEASE_COMMIT_SHA`) and the model constants.
    - It exits 0 when every budget passes, 1 on a budget miss and 2 on a setup error.
    - The harness lives in a reusable module (`api/capacity.py`) that Story 9.12 can call.
- **Observability.**
  - `mawareeth.middleware.FoundationOutcomeMiddleware` logs one record on logger `mawareeth.foundation` per request whose resolved `url_name` (namespace `api`) is one of: `case`, `case-preview`, `case-deceased`, `case-deaths`, `case-death`, `case-heirs`, `case-heirs-bulk`, `case-restore`, `case-heir`, `saved-cases`, `saved-case-open`, `share-view`, `share-report`, `received-view`, `received-report`, `report-draft`.
  - Message: `foundation route=<url_name> method=<M> status=<int> outcome=<o> latency_ms=<int> bucket=<le_100|le_250|le_500|le_1000|gt_1000>`, with the same fields in `extra`. It logs at INFO, and at WARNING for `busy`, `error` and `unavailable`. It wraps the lock middleware, so latency includes lock waits.
  - Outcome is one of a fixed set, derived only from the status and the response's code fields:
    - 2xx → `ok`. A preview 200 whose `status` is `unavailable` → `refused`, `choose_school` → `choose_school`, `not_ready` → `not_ready`.
    - 409 → `conflict`, or `confirm` when `error == "cascade_unconfirmed"`.
    - 400 → `limit` when `error == "over_capacity"` or any `errors` value equals `"limit"`; otherwise `invalid`.
    - 401/403 → `denied`; 404/410 → `not_found`; 429 → `throttled`.
    - 503 → `busy` when `error == "busy"`; otherwise `unavailable`.
    - other 5xx, or an exception → `error` (the exception is re-raised).
  - The record never contains a body, query string, path parameters, ids, tokens, names, family data or exception text.
- **Readiness.** `/health/ready/` also requires a foundation check:
  - the locale registry loads, and every published locale's term catalog loads non-empty;
  - `engine` and `presentation` import;
  - `snapshots.write_version()` is in `READ_VERSIONS`.
  - The result is cached per process after the first success. Success adds `"foundation": "ok"`. Failure returns the existing `{"status":"error"}` 503, and the cause is logged server-side only.
- **Release gate (`python manage.py release_check`).** It runs inside the image, opens no database connection and writes nothing. These gates run in-process, and any failure exits 1 and names the failed gates only:
  - the engine purity import graph (the `engine.tests.test_purity` logic);
  - the engine known-answer, layered, contract and query suites (`engine.tests`, loaded with `unittest`, never the Django test runner);
  - the contract fixture lock (`scripts/contract_fixtures_lock.py` check mode, or the logic `engine.tests.test_contracts` uses);
  - the snapshot fixture round trips and the matrix gate (the logic of `api.test_snapshots.test_fixture_and_release_matrix`, with no database);
  - the term catalog validation for every published locale;
  - the PDF glyph check (`i18n.glyphs.main()`), skipped with a printed notice only when `fc-list` is missing (exit 2 from main);
  - the presentation fixtures in `presentation/tests/fixtures/display-changes.json`, if their test is database-free.
- **The switch is blocked.** `deploy/release.sh deploy` runs, after the candidate's readiness and identity gates and before `journal switching`:
  - `python manage.py release_check`;
  - `python manage.py capacity_check --json /tmp/capacity.json`.
  - Both run in the candidate with `exec -T`, bounded by a new `MAWAREETH_DEPLOY_CHECK_TIMEOUT` (default 600s). Their output goes to the root-only deploy log. A non-zero exit calls `abort_candidate` with a reason naming the check.
  - The prior slot is still serving, so both slots run during the measurement.
- **CI.**
  - `.github/workflows/django.yml` adds a `Release gate` step running `python manage.py release_check` in `validate`.
  - `.github/workflows/deploy.yml` image smoke runs `docker exec <container> python manage.py release_check`.
  - The full test suite, slow-tagged parity corpus included, stays unrestricted in CI and keeps gating Publish Release Image.
- **Restore (`python manage.py restore_check`).** It is read-only and prints counts only. It exits 1 if any check fails:
  - every migration this release ships is applied;
  - every SavedCase decodes through `snapshots.decode(schema_version, ...)`, with counts per version and failing pks only;
  - `schema_version` is in `READ_VERSIONS`, `name` has at most 100 characters, and `revision` is at least 1;
  - every SavedCase owner exists;
  - every ShareLink and ShareInvite references an existing SavedCase, an accepted invite's `accepted_by` exists, and the active, revoked and expired counts are printed;
  - the term catalogs and locale registry of this image load.
  - Epic 8 added no tables (only the `api_savedcase` columns `revision` and `name`). `deploy/README.md`'s manual restore runbook gains a step after deploying the matching release: run `restore_check` in the routed slot before reopening writes. It also states that no Ticket, API-key, counter or prefill table exists yet.

**Never:**
- Log or print request bodies, names, family data, ids, tokens, emails or exception messages.
- Write SavedCase, Share or Invite rows from any of the new commands. Change the throttle settings or rates.
- Use the Django test runner or a test database inside `release_check`.
- Add a Prometheus or metrics dependency (log-based counts, as `mawareeth.case_lock` in 8.9).
- Create Ticket, API-key, counter or prefill tables, or any migration.
- Edit `engine/`, `contracts/`, `presentation/` logic, or the fixtures (only imports from them).
- Change translations.
- Weaken any existing test.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Capacity pass | local PostgreSQL, `--samples 5` | exit 0; a JSON with 4 workloads × 2 phases, each with n, p50, p95, max, busy, conflicts and pass; a commit key | — |
| Capacity miss | the engine budget patched to 0 ms | exit 1; the failing workload is named | budget miss |
| Contention | default contention | the busy/conflict counts are present; sample times include the retries | retried |
| Capacity cleanup | after the run, success or exception | no Session row created by the run remains; the SavedCase count is unchanged | finally |
| Capacity redaction | names in the workloads | stdout and the JSON contain no person name or session key | — |
| Outcome ok | a command 200 | one `mawareeth.foundation` INFO with `outcome=ok` and a bucket | — |
| Outcome limit | a 51st heir; a third death | `outcome=limit` | — |
| Outcome busy | a lock timeout 503 | WARNING `outcome=busy`; latency includes the wait | — |
| Outcome conflict | a stale `expected_revision` | `outcome=conflict` | — |
| Outcome refused | a preview of a refused family | `outcome=refused` | — |
| Outcome error | the view raises | WARNING `outcome=error`; the exception propagates | re-raised |
| Redaction | a body containing a sentinel name, an email and a token | no log record of any logger contains the sentinels | — |
| Non-foundation path | `/api/v1/auth/login/` | no foundation record | — |
| Ready ok | normal | 200 `{"status":"ok","database":"ok","schema":"ok","foundation":"ok"}` | — |
| Ready catalog broken | `i18n.catalog` raises | 503 `{"status":"error"}`; no details | logged |
| Release gate pass | a clean tree | exit 0; no DB connection opened (asserted) | — |
| Release gate fail | the purity check reports a forbidden import (patched) | exit 1, naming `purity` | — |
| Switch blocked | the stub `release_check` or `capacity_check` exits 1 | the deploy aborts the candidate; the route is unchanged; the prior slot keeps serving | abort_candidate |
| Restore ok | v1 and v2 rows, shares, accepted invites | exit 0; the counts per version and per share/invite state | — |
| Restore bad row | one undecodable v2 row | exit 1; only its pk is printed | — |
| Restore unapplied | a migration not applied | exit 1 | — |

</intent-contract>

## Code Map

- `mawareeth/middleware.py`:
  - `CaseWriteLockMiddleware` (`:65`) with the redacted log style to copy (`:100-124`);
  - `is_lock_timeout` (`:127`) and `busy_response` (`:134`);
  - `HealthCheckMiddleware`.
  - The `MIDDLEWARE` order is in `mawareeth/settings.py`. The new middleware must sit outside (before) `CaseWriteLockMiddleware`.
- `mawareeth/ops_views.py` -- `_checks_pass` (`:36`), `ready` (`:76`). The public failure body stays `{"status":"error"}`. The release.sh stub only checks `status: ok` (`deploy/tests/test_release.sh:276`).
- `mawareeth/settings.py` -- `LOGGING` (`:450`, plain console, root INFO), `CASE_LOCK_TIMEOUT_MS` (`:354`, 500), `DEFAULT_THROTTLE_RATES` (`:332`), `RELEASE_COMMIT_SHA`.
- `api/urls.py:24-45` -- route names; mounted under `/api/v1/`.
- `api/views.py`:
  - `respond_to_command` (`:147`) holds the 400/409 codes: `over_capacity`, `invalid_revision`, `cascade_unconfirmed`, `invalid_input`;
  - `PreviewView` (`:287`, GET with `case_id`, 503 on a core error);
  - `throttle_classes` come from `api/throttling.py`.
- `api/anonymous_case.py` -- `MAX_HEIRS` (`:52`); the later-death limit `FieldErrors({'death':'limit'})` (`:537`).
- `api/preview.py:241` `preview(case)`: `family_from_session`, `basis_from_madhab`, `evaluate_outcome`, `present`.
- `api/snapshots.py` -- `READ_VERSIONS`, `WRITE_VERSION`, `write_version()`, `decode`, `encode_v2`.
- `api/models.py` -- `SavedCase` (owner, schema_version, revision, name), `ShareLink` (`revoked_at`, `expires_at`), `ShareInvite` (`accepted_by`, `revoked_at`, `expires_at`).
- `api/management/commands/` -- exists (8.10 `backfill_saved_cases.py`, the output style to copy).
- `i18n/__init__.py` -- `registry()`, `published_codes()`, `catalog(code)`. `i18n/glyphs.py:77` `main()` returns 0, 1 or 2.
- `engine/tests/test_purity.py`, `engine/tests/test_core.py`, `test_layered.py`, `test_contracts.py`, `test_queries.py` -- `unittest.TestCase`s, database-free. `scripts/contract_fixtures_lock.py` -- the fixture lock.
- `api/test_snapshots.py:65` -- the matrix and fixture round-trip logic (`api/fixtures/snapshots/`).
- Parity corpus (database-backed, CI only): `calc.test_engine_parity`, `calc.test_switch_gate`, `presentation.tests.test_parity`; the slow tags are in those files.
- `deploy/release.sh`:
  - candidate start, migrate and ready/identity at `:504-535`; `journal switching` at `:537`; `abort_candidate`;
  - `compose_bounded`, and the timeouts `MAWAREETH_DEPLOY_*`.
  - Tests: `deploy/tests/test_release.sh` (docker/curl stubs; the stubbed `exec` must answer the new commands).
- `.github/workflows/django.yml:44-134` (validate), and `deploy.yml:85-130` (the image smoke container `mawareeth-release-smoke`, sqlite).
- `deploy/README.md` -- the release steps (`:381` area), "Manual restore runbook" (`:517`; step 8 deploys the matching release, step 9 reopens writes), "Known limits" (`:592`).
- Story 9.12 reuses the capacity harness, so keep it importable (`api/capacity.py`).

## Tasks & Acceptance

**Execution:**
1. `api/capacity.py` (new) -- the workloads, the engine and end-to-end phases, contention, the network model, the budgets, and the evidence dict.
2. `api/management/commands/capacity_check.py` (new) -- CLI, the exit codes and Session cleanup.
3. `mawareeth/middleware.py`, `mawareeth/settings.py` -- `FoundationOutcomeMiddleware`, registered outside the lock middleware.
4. `mawareeth/ops_views.py` -- the foundation readiness check with the per-process cache.
5. `api/management/commands/release_check.py` (new), plus any helper module (e.g. `mawareeth/release_gates.py`) -- the database-free gates.
6. `api/management/commands/restore_check.py` (new) -- the read-only restore checks.
7. `deploy/release.sh`, `deploy/tests/test_release.sh` -- the pre-switch checks, the timeout variable, and stub cases for pass and for each failure (route unchanged, candidate stopped).
8. `.github/workflows/django.yml`, `.github/workflows/deploy.yml` -- the release gate steps.
9. `deploy/README.md` -- the deploy pre-switch checks and timeout; a "Capacity evidence" section (how to read the deploy log JSON and run `capacity_check` by hand in a slot); the restore runbook `restore_check` step; the Epic 8 tables note.
10. Tests (new): `api/test_capacity.py` (TransactionTestCase, small samples), `api/test_foundation_outcomes.py`, `api/test_release_restore_checks.py`, plus readiness cases in `mawareeth/tests.py`. Cover every I/O matrix row.
11. `_bmad-output/implementation-artifacts/deferred-work.md` -- an 8.11 section:
    - counts are log-based, with no Prometheus export or alert rules yet;
    - the network/render model constants stand in for the real-device measurement of 9.12;
    - the production capacity evidence comes from the first deploy log;
    - a restore rehearsal on the production backup is an operator step.

**Acceptance Criteria:**
- Given a deploy with the new release.sh, when `release_check` or `capacity_check` fails in the candidate, then the switch never happens and the prior slot keeps serving (asserted by `deploy/tests/test_release.sh`).
- Given local PostgreSQL, when `capacity_check --samples 20` runs, then it exits 0 and reports all four workloads within budget.
- Given `git diff 8b27b7a -- engine contracts presentation web api/migrations '*/migrations/*' locale`, then it is empty.
- Given a local `pg_dump` of the development database restored into a fresh database, when `restore_check` runs against it, then it exits 0 with the same counts as against the source.

## Spec Change Log

## Review Triage Log

### 2026-11-18 — Review pass
- verdicts: 37 findings — high 0, medium 0, low 25, false 12, maybe-false 0
- note: all four layers ran on Claude subagents at the session model, because codex cannot read the `_bmad/render` review prompts. Investigation and implementation ran on codex; the review patches were applied directly.
- findings:
  - **Intent-alignment auditor**
    - `[low]` `[reject]` (intent) AC1 is measured in-process with a modeled 4G network and render constant, not on a real phone through Caddy. — The model is explicit, recorded in the evidence and documented. Story 9.12 owns the real-device measurement, and 8.11 builds the harness that 9.12 reuses. Recorded in deferred-work.
    - `[false]` `[reject]` (intent) It measures the owner case preview, not the Share/received view. — NFR-3's "Share preview" is the live preview panel of the interview (`/api/v1/case/preview/`), the exact surface the harness drives. Shared views are read-only renderings.
    - `[false]` `[reject]` (intent) The parity corpus and the revision/concurrency suites are not in the in-image gate, and the rollback image is not run. — Those suites need a test database, so they run in unrestricted Django CI, which gates Publish Release Image and therefore every deploy. The snapshot matrix gate checks each image against its neighbours (active and rollback) in `matrix.json`.
    - `[low]` `[reject]` (intent) The unit tests do not assert the real 200 ms / 1 s budgets. — The budgets are enforced by `capacity_check` in every deploy. A local 20-sample run passed (engine p95 under 10 ms; end-to-end p95 440–575 ms). Fixed-budget timing assertions in unit tests would be flaky.
    - `[low]` `[reject]` (intent) The counts are log-derived, with no metrics endpoint. — By design (Design Notes): gunicorn workers share no memory and there is no app scraping. This follows 8.9's `mawareeth.case_lock` and is recorded in deferred-work.
    - `[false]` `[reject]` (intent) The restore rehearsal exists only as tests and a README step. — It was rehearsed locally: `pg_dump -Fc` of the development database was restored into a fresh database and `restore_check` ran on both, with identical counts and `failures=0` (see Verification).
    - `[false]` `[reject]` (intent) Readiness never re-verifies after the first success. — The spec makes the cache per-process on purpose. The checked files are immutable in the image, so a later failure cannot arise without a new image.
  - **Verification-gap reviewer**
    - `[low]` `[patch]` (verification-gap) Nothing asserts that the checks run in the candidate slot, in order, before the switch. — Patched: the happy-deploy case in `deploy/tests/test_release.sh` now asserts that `$S/checks` ends with `app-green` `release_check` then `capacity_check --json`, and that the call-log order is migrate < release_check < capacity_check < caddy reload. The suite passes.
    - `[low]` `[patch]` (verification-gap) The end-to-end budget is never seen failing. — Patched: `test_end_to_end_budget_miss` patches `TOTAL_BUDGET_MS` to 0 and expects exit 1, every `end_to_end` phase failing, every engine phase passing, and a named miss line.
  - **Blind hunter**
    - `[false]` `[reject]` (blind) Bare `assert`s vanish under `python -O`. — No Dockerfile, compose, Procfile or deploy script sets `-O` or `PYTHONOPTIMIZE`, so this cannot happen.
    - `[low]` `[reject]` (blind) The glyph gate skips in the image (no `fc-list`). — The spec allows the skip with a printed notice. The CI `PDF glyph check` step installs fontconfig and blocks publication, so the release still passed a real glyph gate.
    - `[false]` `[reject]` (blind) Gate inputs (tests, fixtures) may not ship in the image. — `.dockerignore` excludes neither, and `COPY . .` ships them.
    - `[low]` `[reject]` (blind) 3xx/405/413/422 are logged as `invalid`. — Foundation API routes do not redirect, and those statuses are rare client errors. A new outcome would extend the spec's fixed set.
    - `[low]` `[patch]` (blind) The middleware JSON-parses large binary PDF bodies. — Patched: only `application/json` responses are parsed. A second `resolve()` is microseconds, so that part is rejected.
    - `[false]` `[reject]` (blind) The `mawareeth.foundation` logger may emit nothing in production. — It propagates to the root logger, which has the console handler at INFO (`settings.LOGGING`). The case_lock records already appear the same way.
    - `[false]` `[reject]` (blind) `foundation_ready` is weak: it imports unused modules, caches forever, and changed the probe contract. — The imports are the check. The cache is spec-defined over immutable image files. The `foundation` key is additive (release.sh and the probes key on `status`), and the public failure body is tested.
    - `[low]` `[reject]` (blind) `restore_check` runs N+1 queries, and a null `expires_at` would crash. — `expires_at` is non-null on both models. The per-row queries cover a few thousand rows in a one-off operator command, so they are not worth batching.
    - `[low]` `[reject]` (blind) Session rows are orphaned when the check is killed mid-run. — They are ordinary sessions with the default expiry, and the daily `mawareeth-clear-sessions` timer deletes expired ones. No SavedCase is ever written.
    - `[low]` `[reject]` (blind) The capacity model is thin: no TLS/slow start, and p95 at 20 samples. — The model is documented and recorded in the evidence. The real device is 9.12.
    - `[low]` `[reject]` (blind) The capacity evidence is not durable. — The full JSON goes to stdout, which release.sh keeps in the root-only deploy log for every release.
    - `[low]` `[patch]` (blind) The tests miss check ordering and the route switch. — Grouped with the verification-gap ordering row; patched there.
    - `[low]` `[reject]` (blind) README step wording, the hard-coded `app-blue`, and that step 8 now runs capacity on the restored database. — Step 9 says to replace the slot, and the capacity run writes only its own short-lived sessions.
  - **Edge-case hunter**
    - `[low]` `[reject]` (edge) A writer thread still alive after `join(30)` could rewrite a session after cleanup. — The thread stops within one sample (milliseconds). A 30-second hang already fails the run (exit 2), and any such row expires and is cleared daily.
    - `[low]` `[reject]` (edge) A timeout kill skips cleanup. — Grouped with the blind orphan-session row: rejected for the same reason.
    - `[low]` `[reject]` (edge) An unwritable `--json` path turns a valid run into exit 2. — `/tmp` in the container is writable. A setup failure is the correct, fail-closed result.
    - `[low]` `[reject]` (edge) There is no warm-up, and p95 at a small n is the max. — The default is 20 samples, and the engine p95 is about 1 ms against a 200 ms budget.
    - `[low]` `[reject]` (edge) Unlisted statuses map to `invalid`. — Same as the blind row.
    - `[low]` `[patch]` (edge) Binary report responses are JSON-parsed. — Grouped with the blind PDF row; patched there.
    - `[false]` `[reject]` (edge) A gate raising `SystemExit` aborts `release_check`. — `i18n.glyphs.main()` returns its code, and the unittest suites never raise `SystemExit`.
    - `[low]` `[reject]` (edge) `restore_check` runs N+1 queries. — Same as the blind row.
    - `[low]` `[reject]` (edge) The outer `except` hides which phase failed. — Only database/setup errors reach it, because row-level failures are counted inside. The redaction is intended.
    - `[false]` `[reject]` (edge) `docker exec` may run before the smoke container is running. — `docker run --detach` returns after the container has started. A container that exits fails the smoke either way.
    - `[false]` `[reject]` (edge) Another throttle class could 429 the harness. — Every exercised view declares `throttle_classes` explicitly (CaseWriteThrottle or CasePreviewThrottle), and a 20-sample run with contention made more than 80 previews without a 429.
    - `[low]` `[reject]` (edge) The 200 retries have no backoff. — Each busy retry already waited out the 500 ms server-side lock timeout. Retries stay inside the sample by design.
    - `[false]` `[reject]` (edge) The contract fixture lock is not checked. — `engine.tests.test_contracts.test_lock_matches_the_files` (`:147`) enforces it, and it is in the `contracts` and `engine` gates.
    - `[low]` `[patch]` (edge) A budget miss does not name the failing workload. — Patched: `capacity_check` prints `budget missed: <workload> <phase>` for each failing phase, which the tests assert.
    - `[low]` `[reject]` (edge) The stated outcome mapping is incomplete for other 4xx/3xx. — Same as the blind status row.

## Design Notes

- **Why the capacity run sits in the deploy:** the old slot keeps serving only during handover. That is the one time both slots run against the production PostgreSQL, and it makes the evidence repeatable on every release (AD-27, "measured with both slots running before the wave ships").
- **Why log-based counts:** gunicorn workers do not share memory, and there is no app scraping. Low-cardinality key=value records follow 8.9's `mawareeth.case_lock` and can be counted from the logs. A metrics export is deferred.
- **Why a database-free `release_check`:** the database-backed parity corpus needs a test database, which must never be created on the production cluster. It already gates image publication through Django CI. The in-image gate proves that the shipped files (fixtures, catalogs, fonts, engine) are the ones that passed.

## Verification

**Commands:**
- `uv run python manage.py test api.test_capacity api.test_foundation_outcomes api.test_release_restore_checks mawareeth api.test_snapshots api.test_case_commands --noinput` -- expected: OK.
- `uv run python manage.py release_check` -- expected: exit 0.
- `uv run python manage.py capacity_check --samples 20 --json <scratch>/capacity.json` -- expected: exit 0, all pass.
- `uv run python manage.py restore_check` -- expected: exit 0.
- `bash deploy/tests/test_release.sh` (if it can run on this host) -- expected: passes.
- `uv run python manage.py makemigrations --check --dry-run` -- expected: no changes.

**Manual checks:**
- `pg_dump -Fc` the local database, `pg_restore` it into a new database, and run `restore_check` with `DATABASE_URL` pointing at it. The counts match the source run.

## Auto Run Result

Status: done

**Summary:**
- **Capacity.** `manage.py capacity_check` (module `api/capacity.py`, reusable by Story 9.12) measures four workloads: standard family under a School and under the four-School comparison, 50 Heirs, and two later deaths.
  - Engine phase: in-memory `evaluate_outcome`, budget p95 under 200 ms for the standard family.
  - End-to-end phase: a real command write and the Share preview through the full middleware stack, with a contending writer, so lock waits and retries stay in the sample. The budget is p95 under 1 s once the modeled 4G client time is added.
  - It writes JSON evidence, names any missed budget, exits 0, 1 or 2, deletes its own sessions and never touches Saved cases.
- **Observability.** `FoundationOutcomeMiddleware` logs one redacted `mawareeth.foundation` record per foundation request: route, method, status, outcome from a fixed set, latency_ms and a latency bucket. It sits outside the case lock, so latency includes lock waits.
- **Readiness.** Readiness also checks the foundation: catalogs, the engine and presentation imports, and the snapshot writer version. On success it reports `"foundation":"ok"`; failure stays the opaque 503.
- **Release gate.** `manage.py release_check` runs database-free in the image: purity, the engine suites, the contract lock, the snapshot matrix and fixture round trips, catalogs, glyphs and the presentation fixtures. It runs:
  - in CI;
  - in the release image smoke;
  - in `release.sh deploy` on the candidate, together with `capacity_check`, after readiness and before the switch. Either failure aborts the candidate while the prior slot serves.
- **Restore.** `manage.py restore_check` is read-only. It checks migrations, that every SavedCase decodes, names, revisions, owners, share/invite references and acceptors, and the catalogs, and prints counts and failing pks only. The restore runbook runs it before writes reopen.

**Files changed:**
- `api/capacity.py`, `api/management/commands/capacity_check.py` (new) -- capacity harness and command.
- `api/management/commands/release_check.py`, `mawareeth/release_gates.py` (new) -- in-image release gates.
- `api/management/commands/restore_check.py` (new) -- application-level restore check.
- `mawareeth/middleware.py`, `mawareeth/settings.py` -- foundation outcome middleware, registered outside the case lock.
- `mawareeth/ops_views.py` -- foundation readiness check.
- `deploy/release.sh`, `deploy/tests/test_release.sh` -- pre-switch checks with `MAWAREETH_DEPLOY_CHECK_TIMEOUT`; tests for the abort, slot and order.
- `.github/workflows/django.yml`, `.github/workflows/deploy.yml` -- release gate in CI and in the image smoke.
- `deploy/README.md` -- the capacity evidence section, the restore runbook step and the Epic 8 tables note.
- `api/test_capacity.py`, `api/test_foundation_outcomes.py`, `api/test_release_restore_checks.py` (new), `mawareeth/tests.py` -- tests.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- 8.11 follow-ups.

**Review findings:** 37 findings across four layers (high 0, medium 0, low 25, false 12, maybe-false 0).
- **Patched (6 rows, 4 fixes, all low):**
  - assert that the checks run in the candidate, in order, before the switch;
  - a test where the end-to-end budget is missed;
  - JSON-parse only JSON responses;
  - name the failing workload on a budget miss.
- **Deferred:** none.
- **Rejected:** the rest, each with its reason in the Review Triage Log.

**Follow-up review recommended: false.** No high or medium entry was patched.

**Verification:**
- `uv run python manage.py test api.test_capacity api.test_foundation_outcomes api.test_release_restore_checks mawareeth api.test_snapshots api.test_case_commands reports --noinput`: 193 tests, OK (1 skipped), after the patches.
- `capacity_check --samples 20` on local PostgreSQL: exit 0. Engine p95 under 10 ms on every workload. End-to-end p95 (server plus model):
  - standard_school 460 ms;
  - standard_compare 440 ms;
  - fifty_compare 575 ms;
  - later_deaths 473 ms.
  - The first run counted uncompressed bodies, and fifty_compare missed at 1086 ms. The server time was only about 40 ms; the 92 KB raw preview body dominated. The model now counts gzip-5 bodies, as Caddy's `encode zstd gzip` sends them.
- `bash deploy/tests/test_release.sh`: "release offline checks passed" (Git Bash, slow but complete), before and after the patches.
- `release_check`: every gate passes except `glyphs`, which fails only because this Windows host has no Noto fonts. `python -m i18n.glyphs` fails identically without this change. CI installs the fonts.
- `restore_check` on the local database and on a `pg_dump -Fc` → `pg_restore` copy: identical counts, `failures=0`.
- `makemigrations --check`: no changes.
- `git diff 8b27b7a -- engine contracts presentation web locale '*/migrations/*'`: empty.
- No CRLF in changed files.
- I/O matrix audit: every row has a covering test that ran and passed. The switch-blocked row is covered by the release.sh suite; the all-logger redaction test was added during verification.

**Residual risks:**
- The production capacity numbers come from the first deploy that runs this release.sh. A budget miss there blocks the switch by design. If the 50-Heir preview body grows, or the production CPU is slower, the deploy is refused until it is investigated. The legacy preview fields, due to be removed (8.7 deferred), are most of the body size.
- In the release image the glyph gate skips (no `fc-list`), so the real glyph gate is the CI step.
- The network/render model stands in for Story 9.12's real-device measurement. Counts are log-derived, with no metrics export or alerts yet.
- A rehearsal on a restored production backup remains an operator step.
