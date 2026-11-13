---
title: 'Run Calculation.compute() in one locked transaction'
type: 'bugfix'
created: '2026-11-09'
baseline_commit: '27e625953dc89345824c066a6d61119df71f6beb'
status: 'done'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `Calculation.compute()` zeroes every heir and the calculation (`clear()`), then saves each heir and the calculation one by one, each in its own autocommit. A failure partway through, or two results-page views of one case at once, can leave heir columns that disagree with the calculation columns, and other readers can see the zeroed half-way state. A school refusal (`UnsupportedCase`) comes after those writes, so today it is undone only when the caller rolls back.

**Approach:** Run the whole of `compute()` inside one `transaction.atomic()` that first takes a row lock on its own `Calculation` row. Simultaneous runs on one case then go one after another, readers see only complete results, and any exception, including a refusal, rolls back every write the run made.

## Boundaries & Constraints

**Always:**
- The lock is taken before `clear()` and before any heir row is read or written, and is held until the run commits.
- Results, proof and the return value of a successful run are unchanged. Every existing `calc` and `api` test passes unchanged.
- A run that raises leaves the stored calculation and heir columns exactly as they were before the call. The exception still reaches the caller.
- Nested use keeps working: inside a caller's transaction (the preview, tests) the block is a savepoint, and the preview still rolls everything back.
- The new concurrency tests fail when the lock is removed.

**Ask First:** Changing the results views, the delete view, or the preview. Turning on `ATOMIC_REQUESTS`. Adding a lock timeout. Any schema migration.

**Never:** Changing engine rules or results. Moving `compute()` off database writes (the in-memory preview path is deferred separately). Stopping results views writing on GET (deferred separately). Pushing this work.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Normal run | Saved case, no caller transaction | Same result and stored columns as today | N/A |
| Two runs at once | Two `compute()` calls on one case overlap | The second waits for the lock before `clear()`, then runs on the first's committed rows; both return the same result | N/A |
| Reader during a run | Another connection reads the case while a run is held after `clear()` | Sees the previous committed result, never the zeroed state | N/A |
| Mid-run failure | `distribute()` raises after `clear()` | Stored columns as before the call | Exception propagates |
| Refusal, no caller transaction | `compute(madhab=MALIKI)` on a Malikiyya family after a Hanbali run | Stored columns are the Hanbali run's | `UnsupportedCase` propagates |
| Case deleted | Row deleted after the instance was loaded | Nothing written, no row re-created | `Calculation.DoesNotExist` propagates |

</frozen-after-approval>

## Code Map

- `calc/models.py:889-916` -- `compute()`: sets transient `proof`/`_proof_steps`, `check_school`, `clear()`, `get_quotes()`, `check_family`, `distribute()`, `proof.build`. Wrap from just before `clear()` to the end; `check_school(madhab)` (pure, raises `ValueError`) may stay outside. Update the docstring: a refusal no longer needs a caller rollback.
- `calc/models.py:871-887` -- `clear()` saves every heir then `self.save()`; heir order from `heir_set.all()` is unordered, so two unlocked runs inside transactions could deadlock on heir rows. The up-front calc row lock prevents that.
- `calc/models.py:577` -- `distribute()`, the patch point for the mid-run failure and the "hold after clear" tests.
- `calc/views.py:771-778`, `:802-809` -- `NewResultsView`/`ResultsView.dispatch` call `compute()` with no transaction (no `ATOMIC_REQUESTS` in `mawareeth/settings.py`). Leave as is.
- `api/preview.py:95-130` -- `_compute` runs `compute(madhab=...)` inside `transaction.atomic()` + `set_rollback(True)` on a fresh row; the inner atomic becomes a savepoint. Leave as is.
- `calc/tests.py:2045-2054` -- `SchoolFixtureTests` refusal tests (`build_case`, `fingerprint`, `run`, `MALIKIYYA`); reuse these helpers. All `calc` test classes are `TestCase`.
- `api/tests.py:2110-2215` -- `CaseWriteLockTests`: the pattern for Postgres-only `TransactionTestCase` overlap tests (`skipUnless(connection.vendor == 'postgresql')`, named threads, `threading.Event` gates, `connections.close_all()` per thread, `pg_stat_activity` lock-wait probe). Copy the approach, not the class.

## Tasks & Acceptance

**Execution:**
- [x] `calc/models.py` -- in `compute()`, open `transaction.atomic()`, evaluate `Calculation.objects.select_for_update().get(pk=self.pk)` (eagerly; a missing row raises `DoesNotExist`), then run `clear()` through `proof.build` inside the block and return `final`. Update the docstring. -- One atomic, serialized run per case.
- [x] `calc/tests.py` -- add tests for the matrix: mid-run failure, refusal without a caller transaction and deleted case as `TransactionTestCase` (so no outer test transaction hides the rollback); two runs at once and reader during a run as Postgres-only `TransactionTestCase` with threads, where the "two runs" test asserts the second thread does not reach `clear()` while the first is held. -- Proves the fix and fails without the lock.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- append one entry recording that the `compute()` transaction entries (from `spec-fix-engine-share-distribution.md` and `spec-deferred-case-write-integrity.md`) are resolved by this spec. Do not edit old entries. -- Keeps the log accurate.

**Acceptance Criteria:**
- Given the full `calc` and `api` suites on Postgres, when they run, then every existing and new test passes.
- Given the concurrency tests with the `select_for_update` line removed, when they run, then the two-runs test fails.

## Design Notes

Lock first, then work:

```python
schools.check_school(madhab)
with transaction.atomic():
    Calculation.objects.select_for_update().get(pk=self.pk)
    self.madhab = madhab
    self.clear()
    ...
    return final
```

`self` is not refreshed after the lock: `compute()` rewrites every result column itself, and `name`/`user` going stale under a concurrent rename predates this change.

Known residual: deleting a case cascades heirs before the calculation row, so a delete overlapping a results-page view can now deadlock with it; PostgreSQL aborts one side (a 500 on a case that is being deleted anyway). Today the same overlap can instead re-create a deleted case through `save()`.

## Verification

**Commands:**
- `uv run python manage.py test calc api` (Postgres) -- expected: all pass
- `uv run python manage.py check` -- expected: no issues

## Suggested Review Order

**The locked run**

- Entry point: one transaction around the whole run, so a failure or refusal undoes every write.
  [`models.py:909`](../../calc/models.py#L909)

- The row lock is taken eagerly before `clear()`, so runs take turns and heir-row deadlocks cannot happen.
  [`models.py:910`](../../calc/models.py#L910)

- `check_school` stays outside: it is pure and raises before any write.
  [`models.py:908`](../../calc/models.py#L908)

- Docstring: PostgreSQL-only ordering, unbounded wait, instance not restored, savepoint when nested.
  [`models.py:897`](../../calc/models.py#L897)

**Proof**

- The first run is held after `clear()` while it holds the lock.
  [`tests.py:2678`](../../calc/tests.py#L2678)

- The second run must not reach `clear()` and must be seen waiting; fails without the lock.
  [`tests.py:2725`](../../calc/tests.py#L2725)

- The lock-wait probe watches only the second thread's backend.
  [`tests.py:2716`](../../calc/tests.py#L2716)

- A reader during a held run sees the previous result, not zeros.
  [`tests.py:2745`](../../calc/tests.py#L2745)

- Failure, refusal and deleted case, with no outer test transaction hiding a rollback.
  [`tests.py:2626`](../../calc/tests.py#L2626)
