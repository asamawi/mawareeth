---
title: 'Update stale layered-preview proof assertion'
type: 'bugfix'
created: '2026-11-12'
status: 'done'
route: 'one-shot'
---

# Update stale layered-preview proof assertion

## Intent

**Problem:** `api.tests.InterviewDeathsTests.test_write_matrix_and_rollback` still asserted that a layered (successive-death) preview returns `proof: None`, but Story 3.1c made layered previews return the engine's v2 layered proof, so the test failed on every full run.

**Approach:** Replace the stale `assertIsNone` with the v2 check the suite already uses for layered fixtures: `version == 2` and one layer per death, the first with `heir: None` and the rest naming each session death's `heir_id`.

## Suggested Review Order

- The stale `None` assertion becomes the v2 layered-proof check, matching the fixture convention at line 1410.
  [`tests.py:2510`](../../api/tests.py#L2510)
