---
title: 'Case write integrity: serialize anonymous case writes'
type: 'bugfix'
created: '2026-11-08'
baseline_commit: '7cf49e2a8a99ea51ff97008403b0b56ffc453c1f'
status: 'done'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Django saves the whole session dict, so two simultaneous case writes from one browser (two tabs, or a start over overlapping a `PATCH`) each read the old case and the last save wins. That loses an answer or undoes the start over. The project owner marked this a release blocker on 2026-11-06.

**Approach:** For every unsafe request to the case API, lock the visitor's session row for the whole request: from before the session is loaded until after `SessionMiddleware` saves it. Simultaneous writes then run one after another, and each reads the case the previous one saved.

## Boundaries & Constraints

**Always:**
- The session load, the view and the session save all happen inside the same lock. A lock taken only in the view is not enough, because the middleware saves after the view returns.
- Only unsafe methods (`POST`, `PUT`, `PATCH`, `DELETE`) under the case API prefix take the lock. `GET`s, including the preview, never wait on it.
- Responses, status codes, cookies and the idle-expiry refresh stay exactly as they are. All existing `api` tests pass unchanged.
- The race test must fail when the middleware is removed.

**Ask First:** Changing the session engine or adding a cache or lock service. Adding a lock timeout. Any schema migration. Turning on `ATOMIC_REQUESTS` globally.

**Never:** Client-side queuing as the fix. Moving cases out of the session. Locking non-API pages. The `compute()` transaction (deferred separately). The in-memory preview path. Pushing this work.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Two adds at once | Live case; two `POST heirs/` overlap | Both heirs stored | N/A |
| Add and Madhab at once | `POST heirs/` overlaps `PATCH case/` | Heir and Madhab both stored | N/A |
| Start over vs write | Start over overlaps an old-tab `PUT deceased/` | Whichever runs second sees the other: the old tab gets `409` with the new case, or the start over replaces the case that already holds the write. A write never lands on a replaced case. | N/A |
| No session cookie | First `POST case/` | Case created as today; nothing to lock | N/A |
| Cookie names a missing or expired session | Any write | Same response as today | N/A |
| Write refused | `400` validation, `409` stale case, `404` no case | Same response; lock released | N/A |
| Preview during a write | `GET preview/` while a write holds the lock | Answers without waiting | N/A |

</frozen-after-approval>

## Code Map

- `api/anonymous_case.py:223-270` -- `get()` reads `request.session[SESSION_KEY]`, and `_save()` reassigns the whole dict and calls `touch()` (`set_expiry`). Every write is read-check-save with no lock. Leave this logic alone.
- `api/views.py:41-148` -- the writes are `CaseView.post/patch` and `CaseWriteView.write` (deceased, heirs, heir). `PreviewView` (GET) stays unlocked.
- `api/urls.py`, `mawareeth/urls.py:36` -- case routes live under `/api/v1/case/` (`reverse('api:case')`).
- `mawareeth/settings.py:214-232` -- `MIDDLEWARE`. The default DB session engine is in use (`django.contrib.sessions.models.Session`). The new middleware goes directly before `SessionMiddleware`.
- `mawareeth/middleware.py` -- the project's middleware module (`HealthCheckMiddleware`). Put the new class here.
- `api/tests.py` -- the existing API tests are `TestCase` and run on Postgres in CI (`.github/workflows/django.yml`). Overlap tests need `TransactionTestCase` with threads, and each thread must close its DB connection.

## Tasks & Acceptance

**Execution:**
- [x] `mawareeth/middleware.py` -- add `CaseWriteLockMiddleware`. For unsafe methods whose `path_info` starts with the case API prefix and that carry a session cookie: open `transaction.atomic()`, evaluate a `select_for_update()` on that `Session` row, then call `get_response` inside the block. Every other request passes straight through. -- Makes the session load, the view and the middleware save atomic per session.
- [x] `mawareeth/settings.py` -- insert the middleware directly before `SessionMiddleware`, with a comment saying why the order matters. -- The session must load only after the lock is held.
- [x] `api/tests.py` -- add `TransactionTestCase` tests covering the matrix:
  - two overlapping heir adds both persist;
  - an add overlapping a Madhab change keeps both;
  - start over versus an old-tab write.

  Force each overlap deterministically, for example by holding the first request inside the lock with a patched hook and a barrier. Also test that the preview and requests without a cookie do not take the lock. Skip the overlap tests on non-Postgres backends. -- Proves the fix.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- append one entry recording that the session write race (from Stories 1.2 and 1.3) is resolved by this spec. Do not edit the old entries. -- Keeps the log accurate.

**Acceptance Criteria:**
- Given the full `api` suite on Postgres, when it runs, then every existing test and every new test passes.
- Given the overlap tests with the middleware removed from `MIDDLEWARE`, when they run, then they fail.

## Design Notes

Why not lock inside the view: `SessionMiddleware.process_response` saves after the view returns. If the lock is released before that save, a second request can commit in the gap and then be overwritten by the first request's stale copy. Saving inside the view and clearing `modified` would skip the cookie refresh that the idle expiry relies on. Wrapping the middleware avoids both problems:

```python
with transaction.atomic():
    list(Session.objects.select_for_update().filter(session_key=key).values_list('pk', flat=True))
    return self.get_response(request)  # session loads after the lock and saves before the commit
```

Under Postgres READ COMMITTED, the session `SELECT` that runs after the lock is granted sees the previous writer's committed row. `SessionMiddleware` skips saving on a `500`, so an unexpected error leaves the stored case unchanged.

## Verification

**Commands:**
- `uv run python manage.py test api` (Postgres) -- expected: all pass
- `uv run python manage.py check` -- expected: no issues

## Suggested Review Order

**The lock**

- Entry point: the lock wraps the session load, the view and the session save in one transaction.
  [`middleware.py:77`](../../mawareeth/middleware.py#L77)

- The lock query is evaluated eagerly; a lazy `select_for_update` would lock nothing.
  [`middleware.py:88`](../../mawareeth/middleware.py#L88)

- The prefix comes from `reverse('api:case')` on first use; a test URLconf passes through.
  [`middleware.py:47`](../../mawareeth/middleware.py#L47)

- Placed directly before `SessionMiddleware`, so the session loads only once the lock is held.
  [`settings.py:223`](../../mawareeth/settings.py#L223)

**Proof**

- Holds the first request until the second reaches the case or waits on the row lock.
  [`tests.py:2059`](../../api/tests.py#L2059)

- Patched `_live` and `start` gate the first request on a release event, not a timer.
  [`tests.py:2008`](../../api/tests.py#L2008)

- Matrix rows: two adds, an add with a Madhab change, and start over against an old tab.
  [`tests.py:2079`](../../api/tests.py#L2079)

- The preview answers while a write is still held.
  [`tests.py:2136`](../../api/tests.py#L2136)

- Lock routing, plus a missing session and refused writes (`400`, `404`, `409`) releasing the lock.
  [`tests.py:2162`](../../api/tests.py#L2162)

- Guards the middleware order and the DB session engine, on any backend.
  [`tests.py:1949`](../../api/tests.py#L1949)
