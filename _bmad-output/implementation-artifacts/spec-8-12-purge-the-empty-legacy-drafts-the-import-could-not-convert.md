---
title: 'Story 8.12: Purge the empty legacy drafts the import could not convert'
type: 'chore'
created: '2026-11-18'
status: 'done'
baseline_revision: '141b1cd94f9e739cb6fd75b3996c5cb4bb08b54e'
review_loop_iteration: 1
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
warnings: [oversized]
deferred:
  - summary: >-
      Purging a calculation could cascade into an unselected calculation that references one of its heirs through Heir.same_person or Deceased.heir.
    evidence: |-
      Both foreign keys use NON_POLYMORPHIC_CASCADE. Legacy views only link heirs within one calculation tree, so cross-tree references are not expected. Settle it with a production query counting same_person and Deceased.heir references whose target heir sits in a different root tree than the referencing row.
    location: >-
      calc/models.py:1008
    severity: medium (unverified)
---

<intent-contract>

## Intent

**Problem:** The `api.0004` import left 1,146 root legacy calculations unconverted on production: 841 "no deceased", 304 "no heirs" and calculation 2402 ("multiple deceased"). All 1,146 are empty drafts with nothing to compute (owner decision 2026-11-18: 2402 is empty and can be deleted too).

**Approach:** Add a dry-run-capable management command that selects the root calculations the import could not convert whose own rows are empty (no root Deceased, or no root Heir), lists counts and ids, and on a real run deletes them and only their dependent legacy rows in one transaction. Document the production procedure (fresh restic backup first) and update the deferred-work entry.

## Boundaries & Constraints

**Always:**
- Selection = root calculations (`parent_id IS NULL`) with an owner (`user_id IS NOT NULL`) for which `api.legacy_cases.convert` raises `Unconvertible` (any reason, so the import never produced a SavedCase from it) AND the root itself has no Deceased row (reason `no_deceased`) or, having one or more, has no Heir row (reason `no_heirs`). Only rows whose `calc_id` is the root count; later-death layers are not consulted (owner 2026-11-18: layers arrived in v3 and the old drafts have none). Expected production result: `no_deceased=841 no_heirs=305 total=1146`, with 2402 among the `no_heirs` ids.
- Convertible calculations, unconvertible roots that have both a root Deceased and a root Heir (e.g. `invalid deceased sex`, `unknown relationship`, `invalid name`, `not representable`, or multiple deceased with heirs), ownerless calculations and child layers (`parent_id` set) are never selected, deleted or modified.
- Real run: one `transaction.atomic()`; lock the candidate root rows with `select_for_update()` (legacy edits of root rows take the same lock via `CalculationLockMixin`), re-classify them after the lock is held, delete only those still matching via the ORM so Django cascades remove their layers, Deceased/Heir rows and the Person parent rows (the existing `NON_POLYMORPHIC_CASCADE` path used by `CalculationDelete`). Report the number of root calculations deleted. A rerun deletes nothing and reports `deleted=0`.
- Optional `--expect N`: on a real run, if the selected count differs from N, raise `CommandError` and delete nothing. Dry run prints counts regardless and also fails (CommandError, after printing) on a mismatch so the owner sees it.
- Output contains only reason keys, counts and integer ids — never calculation names, person names, estates or any other family data (AD-27, NFR-4).
- SavedCase, share, invite and user rows are untouched.

**Never:**
- No schema migration, no change to `api/legacy_cases.py` classification semantics, no change to `api.0004`.
- No running anything against production; no deleting by raw SQL; no translation or `.po` changes.
- Do not delete or alter any convertible calculation or any calculation whose root has both a Deceased and an Heir; no special-casing of id 2402.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Dry run | 2 no-deceased roots, 1 no-heirs root, 1 multiple-deceased root without heirs, 1 multiple-deceased root with heirs, 1 convertible, 1 ownerless empty | Prints `no_deceased=2 no_heirs=2 total=4`, `no_deceased_ids=a,b`, `no_heirs_ids=c,d` (ascending); all rows unchanged | No error |
| Real run | same state | Deletes the 4 roots and their Deceased/Heir/Person/layer rows; prints the dry-run lines plus `deleted=4`; other calcs, their people and all SavedCases byte-identical | No error |
| Rerun | after real run | `no_deceased=0 no_heirs=0 total=0`, `deleted=0` | No error |
| No-deceased root with a later layer | root without Deceased, child layer rows | Root and its layers deleted together (cascade) | No error |
| Populated root, broken layer | root with deceased+heirs but a layer lacking a Deceased (import reason `no deceased`) | Not selected; root and layer unchanged | No error |
| Concurrent edit | purge waits on a candidate root lock held by another connection that adds a Deceased and Heir, then commits | That root is not deleted (classified after the lock) | No error |
| Expect mismatch | `--expect 5`, selection 4 | Prints counts, raises `CommandError`, nothing deleted (both modes) | CommandError message names expected vs actual counts only |
| Names present | selected calc has `name` "Secret", heir first_name "Layla" | Neither string appears in output | — |

</intent-contract>

## Code Map

- `api/legacy_cases.py` -- `convert(calc, ContentType, Heir, Deceased)` raises `Unconvertible('no deceased'|'no heirs'|...)`; `import_all` iterates roots `filter(parent_id=None).order_by('pk')`, skips `user_id is None`. Reuse `convert` and `Unconvertible`; read-only.
- `api/migrations/0004_import_legacy_calculations.py` -- the import whose report is the evidence; read-only.
- `calc/models.py:258` -- `Calculation` (`parent` CASCADE `related_name='layers'`, `user` nullable, `name`); `:1006` `Deceased.calc` and `:1035` `Heir.calc` use `NON_POLYMORPHIC_CASCADE`; `Person` is polymorphic with `CascadeDeletePolymorphicManager`. ORM delete of `Calculation` cascades correctly (as `calc/views.py` `CalculationDelete`).
- `api/management/commands/backfill_saved_cases.py` -- style reference for a dry-run command printing `key=value` lines.
- `api/test_legacy_cases.py` -- test patterns: `build_case(sex, [HeirClasses], estate=...)` and `build_layer(...)` from `calc.tests`; `legacy_rows()` snapshot helper; how to make a no-deceased calc (create `Calculation` directly), a multiple-deceased one, and an ownerless one.
- `deploy/README.md` -- `## Capacity evidence` section (end of file) is the precedent for documenting a manage.py command run inside a slot via `docker compose -p mawareeth exec -T app-blue python manage.py ...`; backup is `sudo deploy/backup.sh backup` (section near line 471).
- `_bmad-output/implementation-artifacts/deferred-work.md:283-285` -- the entry for the 1,146 unconverted calculations.

## Tasks & Acceptance

**Execution:**
- `api/management/commands/purge_empty_legacy_drafts.py` -- new command `purge_empty_legacy_drafts` with `--dry-run` and `--expect N`, implementing the selection, output and transactional delete above (selection helper usable both before and under lock) -- AC 1, 2, 4.
- `api/test_legacy_purge.py` -- new `TestCase` covering every I/O matrix row, including: other-reason, convertible, ownerless and child-layer calcs and all SavedCase rows unchanged (compare row snapshots like `legacy_rows()`), dependent Person/Heir/Deceased rows of purged calcs gone, and no names in output -- proves the matrix.
- `deploy/README.md` -- add a short `## Legacy draft purge` section after `## Capacity evidence`: run `sudo deploy/backup.sh backup` and confirm it succeeded, then `python manage.py purge_empty_legacy_drafts --dry-run --expect 1146` in the active slot, check counts 841/305 and that 2402 is in `no_heirs_ids`, then run without `--dry-run` with `--expect 1146`; output has only ids and counts -- AC 4.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- rewrite the entry at lines 283-285: summary becomes running the production purge of the 1,146 empty drafts; evidence keeps the import numbers, records the owner decision of 2026-11-18 that 2402 is empty and is purged too, names `purge_empty_legacy_drafts` (Story 8.12, procedure in `deploy/README.md`), and says the owner records the purge date and deleted count here when the production run happens -- AC 3.

**Acceptance Criteria:**
- Given legacy calculations of every import outcome, when `purge_empty_legacy_drafts --dry-run` runs, then it prints per-reason counts, the total and the ascending ids per reason, and deletes nothing.
- Given the same state, when the command runs without `--dry-run`, then exactly the selected root calculations and their dependent legacy rows are deleted in one transaction, it prints `deleted=<n>`, and a rerun prints `deleted=0`.
- Given a convertible calculation or an unconvertible one whose root has both a Deceased and an Heir, when the purge runs, then its Calculation, Person, Heir and Deceased rows are unchanged; an empty multiple-deceased root like 2402 is purged, and the deferred-work entry records that owner decision.
- Given the production procedure in `deploy/README.md`, when the owner follows it, then a fresh restic backup runs before the purge and the command output contains only ids and counts.

## Spec Change Log

### 2026-11-18 — Owner answer to the intent gap
- Trigger: review found the import-reason selection deletes a populated root whose later layer lacks a deceased (high, intent_gap).
- Owner decision: later-death layers arrived in v3 and old saved calcs have none; calculation 2402 is empty and can be deleted.
- Amended (intent-contract included, by owner decision): selection is now "unconvertible AND root has no Deceased, or root has no Heir", layers are not consulted, 2402 is purged, expected total 1,146 (841/305); matrix gained the populated-root and concurrent-edit rows; runbook and deferred-work tasks follow.
- Known-bad state avoided: deleting a root that has a deceased and heirs; locking only the root while selection depends on layer rows.
- KEEP: command shape (`--dry-run`, `--expect`, `key=value` output with ascending ids, CommandError `expected=N actual=M` after printing), locked re-classification and ORM cascade delete in one transaction, row-snapshot preservation tests, rollback test, no-names test, runbook structure from `spec-8-12-attempt-1.patch`.

## Review Triage Log

### 2026-11-18 — Review pass
- verdicts: 13 findings — high 2, medium 3, low 5, false 0, maybe-false 3
- attempted change saved as [spec-8-12-attempt-1.patch](spec-8-12-attempt-1.patch); code reverted
- findings:
  - `[high]` `[intent_gap]` (blind) A root with a deceased and heirs is deleted when a later layer lacks its deceased, because `convert()` reports `no deceased` for the whole tree — confirmed: `legacy_cases.convert` builds `later = [deceased(layer) ...]` before root heirs, and `test_later_layer_reason_matches_import` deletes `self.good`. The intent-contract matrix row "Later-layer reason" selects it on purpose; the story's "empty drafts with nothing to compute" suggests it must not be. Two defensible readings, observably different deletions.
  - `[medium]` `[intent_gap]` (blind) Only root rows are locked, but legacy edits lock the edited layer (`calc/views.py:53`), so a layer can change between reclassification and delete — real under the import-reason selection; disappears if selection depends only on root-level rows. Depends on the gap above.
  - `[maybe-false]` `[defer]` (blind) Cascade via `Heir.same_person` / `Deceased.heir` could delete people of an unselected calculation that references a purged heir — legacy views only link heirs within a tree; settle with a production query for cross-root references. Medium if true (unverified).
  - `[low]` `[reject]` (blind) No explicit exclusion of id 2402; README says it "is never selected" — true for its current multiple-deceased state; an id special-case adds a guard for an unlikely change, and `--expect` plus the dry-run id list let the owner check.
  - `[low]` `[reject]` (intent) Selection is current classification, not the historical cohort; post-import drafts can qualify — documented in Design Notes and the runbook; `--expect 1145` and the 841/304 dry-run check catch differences.
  - `[low]` `[reject]` (intent) A root converted by the import and later emptied would be selected although it has a SavedCase — no data loss (the SavedCase is an independent copy; the legacy row is empty) and SavedCase has no source link to detect it.
  - `[high]` `[intent_gap]` (intent) Whole-tree conversion failure vs. literal "empty calculation" reading — same as the first row.
  - `[low]` `[reject]` (intent) 2402 protected by classification only — same as the 2402 row above.
  - `[low]` `[reject]` (intent) The production purge, backup and dated record are not done — this run must not touch production; the deferred-work entry was to hand that to the owner.
  - `[medium]` `[intent_gap]` (verification-gap) The reclassification test does not prove the lock is taken before reclassifying — pre-verified gap; patch would be a two-connection `TransactionTestCase`. Moot until the selection rule is decided.
  - `[medium]` `[intent_gap]` (edge) A child layer gaining its deceased after reclassification is still deleted — same as the descendant-lock row.
  - `[maybe-false]` `[defer]` (edge) Deletion can cascade into unselected calculations via `same_person` / `Deceased.heir` — same as the cascade row.
  - `[maybe-false]` `[defer]` (edge) Claim that preservation of unselected rows can break via those cascades — same as the cascade row.

### 2026-11-18 — Review pass (after owner answer)
- verdicts: 12 findings — high 0, medium 0, low 8, false 1, maybe-false 3
- findings:
  - `[low]` `[reject]` (blind) Post-import empty drafts can stand in for historical candidates because `--expect` checks only the count — any such row is also an empty draft (no root deceased or heirs, unconvertible), so deleting it loses nothing; the runbook has the owner review the dry-run ids and the 841/305 split.
  - `[maybe-false]` `[defer]` (blind) Cross-tree cascade via `Heir.same_person` / `Deceased.heir` — carried: already deferred in the first pass (frontmatter `deferred`), code unchanged there.
  - `[low]` `[reject]` (blind) No lock-wait bound on the purge's root locks — a one-off operator command; legacy editing is rare and a wait only delays a legacy request; a timeout adds a new failure path and parameter for an unlikely case.
  - `[low]` `[reject]` (blind) No test of `--expect` combined with a concurrent change — `--expect` and the locked reclassification are each tested; the composition is one comparison on the re-selected total.
  - `[low]` `[patch]` (blind) deferred-work says the drafts "are purged" while no production purge has run — reworded to "are approved for purging".
  - `[low]` `[reject]` (intent) Historical cohort vs current eligibility — same as the first row.
  - `[low]` `[reject]` (intent) Present convertibility vs conversion history — carried: rejected in the first pass (SavedCase is an independent copy; no source link exists).
  - `[low]` `[reject]` (intent) Tests use a structural analogue of 2402, not the record — the runbook makes the owner confirm 2402 is in `no_heirs_ids` before the real run.
  - `[false]` `[reject]` (intent) "Old-format saved calculations" not exercised — there is no separate old format: pre-v3 calculations are the same `calc_calculation`/`calc_person` rows, just without child layers, which the fixtures already include.
  - `[low]` `[reject]` (intent) Production backup, purge and dated record not done — carried: owner action, recorded in deferred-work.
  - `[maybe-false]` `[defer]` (edge) Cascade into retained calculations via `same_person` / `Deceased.heir` — carried (same deferred item).
  - `[maybe-false]` `[defer]` (edge) Preservation claim can break through those cascades — carried (same deferred item).

## Design Notes

SavedCase has no back-reference to its source calculation, so "has no SavedCase conversion" is known only from `convert()` raising (the import's deterministic classification). The root-row emptiness test is added on top so a real family is never deleted. Because selection depends only on the root's own rows, locking the root row is enough: legacy edits of root rows lock it via `CalculationLockMixin`, and the purge re-classifies after acquiring the lock.

Legacy creation (`/<lang>/new/`) is still routed, so empty drafts created after 2026-11-13 also match; `--expect 1146` in the runbook makes the owner see and decide on any such difference before anything is deleted.

## Verification

**Commands:**
- `uv run python manage.py test api.test_legacy_purge api.test_legacy_cases --noinput` -- expected: all pass
- `uv run python manage.py check` -- expected: no issues

## Auto Run Result

Status: blocked
Blocking condition: intent gap

The intent-contract selects roots by the import's whole-tree reason, so a root that has a deceased and heirs but a later-death layer without a deceased counts as "no deceased" and would be deleted. The story says the purge removes "empty drafts with nothing to compute". Questions for the owner:

1. Should the purge select only roots whose own rows are empty (no root Deceased, or no root Heirs) and that the import could not convert, keeping a populated root whose later layer is broken? Recommended: yes. It never deletes a real family, and if the deferred-work claim holds (all 1,145 are empty drafts), the production counts are unchanged; `--expect 1145` shows any difference.
2. If yes, should the command also lock every layer of a candidate (legacy edits lock the edited layer), or is locking the root enough because selection then depends only on root rows?

The attempted implementation (command, tests, runbook section, deferred-work edit; 12 targeted tests passed) is saved at `_bmad-output/implementation-artifacts/spec-8-12-attempt-1.patch` and was reverted. Review also deferred one unverified cross-tree cascade risk (see triage log) and found the lock-before-reclassify test gap.

### 2026-11-18 — Final result (after owner answer)

Status: done

**Summary:** `purge_empty_legacy_drafts` selects owned root legacy calculations that `convert()` cannot convert and whose root has no Deceased (`no_deceased`) or no Heir (`no_heirs`). It prints counts and ascending ids only and fails with `--expect` mismatches before deleting. A real run locks the candidate roots, re-classifies them under the lock and deletes them with their dependent legacy rows in one transaction. Populated roots with a broken later layer are kept. Per the owner, 2402 is an empty draft and is purged; production expects 841/305/1146.

**Files changed:**
- `api/management/commands/purge_empty_legacy_drafts.py` — the new command.
- `api/test_legacy_purge.py` — matrix tests, including a two-connection PostgreSQL concurrency test and a rollback test.
- `deploy/README.md` — `## Legacy draft purge` runbook: restic backup, dry run with `--expect 1146`, real run, record result.
- `_bmad-output/implementation-artifacts/deferred-work.md` — legacy-import entry now tracks the pending production purge and the 2402 decision.
- `_bmad-output/implementation-artifacts/spec-8-12-attempt-1.patch` — first attempt, kept for the triage-log reference.

**Review:** pass 1 found the intent gap (resolved by the owner); pass 2 had 12 findings: 1 low patched (deferred-work wording), 1 deferred item carried (unverified cross-tree cascade, medium if true), 8 rejected as recorded in the triage log (7 low, 1 false). Follow-up review recommended: false (patched: high 0, medium 0, low 1).

**Verification:** `uv run python manage.py test api.test_legacy_purge api.test_legacy_cases --noinput` — 13 tests OK; `uv run python manage.py check` — no issues.

**Residual risks:** the production purge has not run (owner action; backup first); the cross-tree cascade risk is unverified until a production query checks for cross-root `same_person` / `Deceased.heir` references.
