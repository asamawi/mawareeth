---
title: 'Lock the case for heir writes, refresh compute after its lock, 404 a vanished case'
type: 'bugfix'
created: '2026-11-10'
baseline_commit: '9546a61e472aa6b19f21e0f922e845a444d1ce87'
status: 'done'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `compute()` locks the `Calculation` row but keeps the instance loaded before the lock, so its full-row saves write back a stale `name`/`user` when a rename commits while the run waits. Heir and deceased views write without that lock, so an heir deleted mid-run is re-inserted by the run's `heir.save()`. A case deleted between a results view's lookup and `compute()` gives a 500.

**Approach:** Reload the instance under the lock inside `compute()`. Run every POST of the heir and deceased create/update/delete views in one transaction that first locks the case's `Calculation` row, the same order `compute()` and case deletion use. Turn `Calculation.DoesNotExist` from `compute()` in the results views into a 404.

## Boundaries & Constraints

**Always:**
- Lock order is always `Calculation` row first, then heir/deceased rows. The lock is taken before the heir or deceased row being changed is loaded for the write, so the write uses committed state.
- Ownership checks stay as they are: another user's case or person still 404s and is never locked.
- Engine results, proof, and every existing `calc` and `api` test stay unchanged.
- New concurrency tests are PostgreSQL-only `TransactionTestCase`s and fail when the new lock is removed.

**Ask First:** A lock timeout (`lock_timeout`) on any of these paths. Turning on `ATOMIC_REQUESTS`. Any schema migration. Changing the session-backed `api/` heir endpoints.

**Never:** Stopping results views computing on GET, or moving the preview off DB writes (deferred separately). Fixing the pre-lock "already exists" count checks in the create views' `dispatch`. Pushing or merging.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Rename during wait | Instance loaded; `name` changed and committed elsewhere; then `compute()` | Stored `name` and `user` are the committed values after the run | N/A |
| Heir delete during run | Run held after `clear()`; owner POSTs heir delete | Delete waits for the run, then commits; the heir stays deleted | N/A |
| Heir edit during run | Run held; owner POSTs heir update | Waits, then saves the name onto the row as the run left it | N/A |
| Heir/deceased add | Owner POSTs a create form | Same redirect and rows as today, inside one locked transaction | Form errors re-render as today |
| Case gone at compute | `compute()` raises `Calculation.DoesNotExist` in `ResultsView`/`NewResultsView` | 404 | No 500 |
| Not owner | Another user POSTs to an heir view | 404, no lock taken | As today |

</frozen-after-approval>

## Code Map

- `calc/models.py:909-911` -- `compute()`: `Calculation.objects.select_for_update().get(pk=self.pk)` discards the fetched row. Replace with `self.refresh_from_db(from_queryset=Calculation.objects.select_for_update())` (Django 5.2), before `self.madhab = madhab`. `madhab`, `proof`, `_proof_steps` are not model fields, so the refresh leaves them alone. Update the docstring.
- `calc/models.py:871-887` `clear()` and `:827-839` `distribute()` -- the two full `self.save()` calls that wrote stale `name`/`user`. Leave as is; the refresh fixes them.
- `calc/views.py:23-37` -- `get_owned_calculation`, `OwnedCalculationMixin`, `OwnedByCalculationMixin`. Put the new lock helper and mixin here.
- `calc/views.py:60-99` -- `DeceasedCreate` (calc in `dispatch` as `self.calc`), `DeceasedUpdate`, `DeceasedDelete` (already `atomic()`, no lock).
- `calc/views.py:101-685` -- 22 heir `*Create` views; each sets `self.calc` in `dispatch` and writes in `form_valid` (`form.save()`, `.save()`, `calc.add_*()`).
- `calc/views.py:686-705` -- `HeirUpdate` (full save of a pre-loaded heir), `HeirDelete`.
- `calc/views.py:771-778`, `:802-809` -- `NewResultsView`/`ResultsView.dispatch` call `self.calc.compute()` unguarded.
- `calc/views.py:838-848` -- `delete()`: the existing eager lock `list(Calculation.objects.select_for_update().filter(pk=calc.pk).values_list('pk', flat=True))`; switch it to the shared helper.
- `calc/tests.py:2702-2830` -- `ComputeConcurrencyTests`: reuse `patched_clear`, `spawn`, `finish`, `second_waits_on_a_lock` for the heir-delete overlap test.
- `api/` `CaseWriteLockMiddleware` locks only session rows for `api:case` routes; it does not cover these views. Not touched.

## Tasks & Acceptance

**Execution:**
- [x] `calc/models.py` -- refresh `self` under the lock in `compute()` as in the Code Map; update the docstring. -- Run writes back committed `name`/`user`.
- [x] `calc/views.py` -- add `lock_calculation(pk)` (eager `select_for_update` on that row) and a `CalculationLockMixin` whose `post()` runs `transaction.atomic()`, locks the case, then calls `super().post()`. For object views, resolve the case id through the owner-filtered queryset (404 if none) before locking, so `get_object()` in `super().post()` re-reads the person after the lock. Apply it to the 22 heir create views, `HeirUpdate`, `HeirDelete`, `DeceasedCreate`, `DeceasedUpdate`, `DeceasedDelete`; use the helper in `delete()`. In both results views catch `Calculation.DoesNotExist` around `compute()` and raise `Http404`. -- One lock order for every case write; no 500.
- [x] `calc/tests.py` -- tests for the matrix: stale-instance rename (no threads; fails without the refresh); Postgres-only heir-delete-during-run that asserts the POST waits on the lock and the heir is not re-created (fails without the mixin); heir update and an heir create via the mixin still behave as before; both results views give 404 when `compute` raises `DoesNotExist`; not-owner POST gives 404.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- remove the two resolved entries under "Django / API" (refresh after lock; heir lock + results 404). -- Backlog removes completed items.

**Acceptance Criteria:**
- Given the full test suite on PostgreSQL, when it runs, then all existing and new tests pass.
- Given the heir-delete overlap test with the mixin removed from `HeirDelete`, when it runs, then it fails.

## Design Notes

```python
class CalculationLockMixin:
    def post(self, request, *args, **kwargs):
        with transaction.atomic():
            lock_calculation(self.locked_calc_id())
            return super().post(request, *args, **kwargs)
```

Create views return `self.calc.pk`; object views look up `calc_id` through `self.get_queryset()`. A heir deleted while the POST waited makes `get_object()` 404, which is correct.

## Verification

**Commands:**
- `uv run python manage.py test calc api` (PostgreSQL via `DATABASE_URL` or local `mydb_mawareeth`) -- expected: all pass, concurrency tests not skipped
- `uv run python manage.py check` -- expected: no issues

## Suggested Review Order

**One lock order for every person write**

- Entry point: each person POST is one transaction that locks the case before anything else.
  [`views.py:44`](../../calc/views.py#L44)

- The case id comes through the owner-filtered queryset, so another user's person 404s unlocked.
  [`views.py:38`](../../calc/views.py#L38)

- Eager row lock; a case deleted during the wait now gives 404, not an FK 500.
  [`views.py:28`](../../calc/views.py#L28)

- Mixin goes first in each base list so its `post()` wraps the generic one.
  [`views.py:713`](../../calc/views.py#L713)

- Case deletion now uses the same helper.
  [`views.py:874`](../../calc/views.py#L874)

**Fresh instance under the lock**

- `compute()` reloads itself under the lock, so a rename committed during the wait survives.
  [`models.py:911`](../../calc/models.py#L911)

**Vanished case on the results pages**

- `Calculation.DoesNotExist` from `compute()` becomes a 404 in both results views.
  [`views.py:802`](../../calc/views.py#L802)
  [`views.py:836`](../../calc/views.py#L836)

**Tests**

- Heir delete overlapping a held run waits on the lock and never loads the person first.
  [`tests.py:2807`](../../calc/tests.py#L2807)

- Every one of the 27 person-writing views posts through the mixin.
  [`tests.py:2959`](../../calc/tests.py#L2959)

- Stale instance keeps the committed name and owner.
  [`tests.py:2692`](../../calc/tests.py#L2692)

- 404 cases: vanished case at compute, deleted case at lock, non-owner never locks.
  [`tests.py:2952`](../../calc/tests.py#L2952)
