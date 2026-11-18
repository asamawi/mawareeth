---
title: 'Story 9.1b: Carry lineage and status in the Interview Case'
type: 'feature'
created: '2026-11-19'
status: 'done'
baseline_revision: '7916a0bc513f7ff459cbc7e86f7d0ce5f2081e31'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-11-19.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The Interview Case sends only `deceased`, `heirs`, `heir_options` and `deaths`. The session cannot hold lineage edges or a died-before person, the adapter always builds the Family with `edges: []`, the v2 snapshot refuses edges and `died_before_or_with`, and no engine query answers "which relationships can be added at this person". Stories 9.2, 9.4 and 9.7 need all four.

**Approach:**
- Store optional `edges` and `died_before` lists beside the existing rows in the session Case.
- Build the Family from them, and expose `persons`, `edges` and engine-computed per-anchor `placement` options in every Case response.
- Let the v2 snapshot carry them losslessly, and refuse to persist them while the snapshot writer is 1.
- Parse the new fields in `web/src/api/case.ts`.
- No new command and no UI.

## Boundaries & Constraints

**Always:**
- **Response fields** (read and every command response):
  - `Case.persons`: every canonical person once, in the Family `Person` shape (`id, gender, name, relationship, status, death_order`), the same list `family_from_session()` produces.
  - `Case.edges`: Family `Edge` objects. The first deceased is `"root"`.
  - `Case.placement`, and the same on each `Death` for its estate: an object keyed by anchor id, where the estate's own deceased is always `"root"`. Each value is an ordered list of `{relationship, link, blocked}`, where `link` ∈ `parent|child|spouse` is the new person's role relative to the anchor.
- **Placement** comes only from a new pure `engine/queries.py` function, `placement_options(family, rule_set, *, estate=1, deceased_gender=None)`. It uses one table in the engine: anchor relationship → `(link, added root-relative relationship)`. See Design Notes.
  - Drop candidates that `relationship_options` for that estate marks impossible.
  - Set `blocked` from its `blocked` tuple.
  - A died-before person with a root relationship counts toward cardinality: no second father while a died-before father exists.
  - Died-before persons are anchors in estate 1 only.
  - Unknown, unmapped or later-only anchors get `[]`.
  - Madhab null: use the same rule-set fallback the existing `heir_options` uses.
- **Session storage:** optional top-level `edges` (list of `{kind, from, to}`) and `died_before` (list of `{id, gender, name, relationship}`, ids unique and not used by any row). Absent means empty.
  - A died-before person is never an estate member.
  - `family_from_session()` emits them with status `died_before_or_with`, and passes the edges through.
- **Legacy cases:** a case without these keys must produce byte-identical Case JSON, apart from the added `persons`, `edges` and `placement`. It must also produce identical previews, `PresentedResult`, proofs and deletion impact.
- **Identity:** stable ids are the earliest row id, as now. When `_remove_rows` promotes an alias to canonical (`api/anonymous_case.py:586`), remap every edge endpoint and `died_before` reference with it. Removing a person drops their edges.
- **Snapshots:** v2 `decode` accepts edges and died-before persons and restores them to `edges` and `died_before`. It still refuses answers, gifts and bequests, and still requires exact re-encoding. `encode_v2` writes them.
- **Writer 1:** while `SNAPSHOT_WRITE_VERSION == 1`, any persist of a Case with a non-empty `edges` or `died_before` raises the existing `unsupported_content` `SnapshotError`, and nothing is written. That covers the session write in `_save`, SavedCase save, share and invite creation, and loading a v2 snapshot into the session.

**Never:**
- Add or extend a command, view route, UI component, message or translation.
- Put kinship or fiqh tables in `api/` or the browser.
- Import `api` from `engine`.
- Infer a parent edge for an existing relative. Unlinked relatives stay unlinked (owner decision, 2026-11-19).
- Change `heir_options`/`edit_options` semantics or the stored shape of existing rows and deaths.
- Migrate stored data.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Legacy case | session with wife + 2 sons, no new keys | `edges: []`; persons all `alive`; placement `root` lists father, mother (parent), wife (spouse), son, daughter (child), and no husband for a male deceased; each son anchor lists son_of_son, daughter_of_son; preview unchanged | — |
| Died-before son with link | v2 snapshot: son S `died_before_or_with`, son_of_son G, edge `parent_of S→G` | GET shows S in `persons` (not in `heirs`), edge present, `placement[S]` = son_of_son, daughter_of_son (child) | writer 1: loading it raises `unsupported_content`, session unchanged |
| Second father | father alive (or died-before) | `placement.root` has no `father` entry | — |
| Blocked candidate | sons present, anchor brother | `son_of_brother` present with `blocked: true` | — |
| Later estate | death of wife (order 2) | `deaths[0].placement.root` computed for estate 2 with that estate's relationships | — |
| Alias promotion | remove earliest row of a person who has an alias and an edge | edge endpoint now the promoted id | — |
| Writer 1 save | case with an edge, SavedCase save | `unsupported_content`, nothing stored | typed error as today |

</intent-contract>

## Code Map

- `api/anonymous_case.py` -- the session Case.
  - `read_snapshot():300` builds the Case and decorates `heir_options`/`edit_options` (`:328`, `:332`); `_read_heirs()` drops unknown keys.
  - `_decorate():434` adds later-estate options and is the place to add `persons`/`edges`/`placement`.
  - `_save():357` strips derived fields (also strip `persons` and `placement` there, and keep `edges`/`died_before`).
  - `export_snapshot():740` whitelists the stored inputs (add `edges`, `died_before`); `_remove_rows():586` handles alias promotion; `load_snapshot():775`; `_decode():278`.
- `calc/adapters.py:17` `family_from_session()` -- add died-before persons and edges; keep the person and membership order exactly as now for legacy cases. Callers that must stay identical: `api/preview.py:200,208,251`, `api/snapshots.py:67`, `api/case_commands.py:117`, `api/capacity.py:163`, `calc/adapters.py:139`.
- `api/snapshots.py` -- `encode_v2():60`; `decode():72` (refusal at `:104-106`; `rows():115` rebuilds rows; the exact re-encode check is at `:126`); `write_version():11`; `mawareeth/settings.py:348` (default 1).
- `api/views.py:360` -- SavedCase save; also the share and invite creation paths that write snapshots.
- `engine/queries.py:70` `relationship_options`, `Options`, `_counts` -- reuse them in `placement_options`. `engine/rule_set.py:51` RuleSet. `engine/contracts/family.py:117` edge parsing (`parent_of`/`spouse_of`, endpoints known, no self-links).
- `api/kinship.py:8` `PATHS` -- the reference for the meaning of each code (`uncle` = ffs+fms, `paternal_uncle` = ffs, `paternal_brother` = fs, and so on). Do not import it from the engine.
- `web/src/api/case.ts` -- `Case:117`, `Death:80`, `parseCase():315`, strict key allowlists at `:238`. Add optional `persons`, `edges`, `placement`; absent means `[]`/`{}`.
- Tests:
  - `api/test_snapshots.py` -- `roundtrip:58`, `test_fixture_and_release_matrix:65`; the edges-unsupported expectation is at `:153`; fixtures in `api/fixtures/snapshots/`.
  - `api/test_case_commands.py`, `api/tests.py` -- interview tests.
  - `engine/tests/test_queries.py:21` -- unittest.
  - `web/src/api/case.test.ts` -- `CASE` fixture at `:44`, layered fixture at `:857`.
  - `api/capacity.py:24,79,149`, `api/test_capacity.py` -- the NFR-3 harness.

## Tasks & Acceptance

**Execution:**
- `engine/placement.py` (new) or `engine/kinship.py` -- the anchor table from Design Notes, as data.
- `engine/queries.py` -- `placement_options()` returning an immutable mapping, built on `relationship_options` with died-before cardinality.
- `engine/tests/test_queries.py` -- table coverage; second father and fifth wife excluded; blocked flagged; died-before anchor; later estate; immutability; unknown estate rejected like the other queries.
- `calc/adapters.py` -- died-before persons and edges into the Family.
- `api/anonymous_case.py` -- read, decorate, strip, export and remap the new keys; add `persons`, `edges` and `placement` to the Case and each Death; the writer-1 guard in `_save` and `load_snapshot`.
- `api/snapshots.py`, `api/views.py` -- v2 encode/decode of edges and died-before; the writer-1 refusal on every snapshot write.
- `api/test_snapshots.py` plus new fixtures `v2-lineage-*.json` in `api/fixtures/snapshots/` and the `matrix.json` entry -- lossless v2 round trip; v1 refusal; legacy fixtures unchanged.
- `api/test_case_commands.py` or `api/tests.py` -- the matrix rows through `GET /api/v1/case/` and one command response; legacy preview byte-equality.
- `api/capacity.py`, `api/test_capacity.py` -- time `placement_options` for the 50-heir workload; it must fit the 200ms engine budget.
- `web/src/api/case.ts`, `web/src/api/case.test.ts` -- types, parsing, absent→empty, malformed values rejected like the other fields, round-trip fixture.

**Acceptance Criteria:**
- Given an existing guest or saved Case without the new keys, when it is read, previewed, shared or saved under writer 1 or 2, then everything behaves as before, and the only change in the Case JSON is the added `persons`, `edges` and `placement`.
- Given writer 2 and a v2 snapshot with edges and a died-before person, when it is loaded, read, saved and loaded again, then it round-trips byte-identically through the session, SavedCase, share and invite paths.
- Given the full Django test labels touched and the engine and web tests, when run, then they pass, and the capacity check reports the placement timing within budget.

## Spec Change Log

## Review Triage Log

### 2026-11-19 — Review pass (reviewers run on codex, read-only)
- verdicts: 21 findings — high 0, medium 3, low 10, false 8, maybe-false 0
- findings:
  - `[false]` `[reject]` (intent-alignment) the diff implements prerequisite Story 9.1b, not all of Epic 9 — the loop builds one story per iteration; 9.1b is the next backlog story by the 2026-11-19 sprint change.
  - `[low]` `[patch]` (verification-gap) no test pins the mother anchor's options — confirmed; `test_placement_table_and_kinship` now asserts the exact ordered list (maternal_grandmother blocked under Hanafi by the mother).
  - `[low]` `[patch]` (blind) restore of a snapshot without `died_before` keeps the old died-before persons (`_save` merges) — confirmed in `case_commands.restore`; fixed with `value.setdefault('died_before', [])`, plus a test.
  - `[medium]` `[patch]` (blind) deletion confirmation lists edge-linked descendants that the removal keeps — confirmed: `remove_impact` passed edges to `delete_impact`, but `_remove_rows` only drops edges; the impact family is now built without edges, plus a test. Reachable only with planted or loaded lineage today.
  - `[low]` `[reject]` (blind) a relationship edit can leave an edge that no longer fits (son→daughter) — real, but only for lineage that no UI can create yet. Edit validity against lineage is Story 9.4's engine-query work, so this is more than a direct correction.
  - `[false]` `[reject]` (blind) the writer-1 guard is missing from share and invite creation — `SavedCaseSharesView`/`SavedCaseInvitesView` write no snapshot (no snapshot write in either `post`); they reference the stored row, and their reads are covered.
  - `[false]` `[reject]` (blind) a died-before person with a null relationship is dropped — the Family contract refuses a null relationship for anyone who is not only a later-estate relative (`engine/contracts/family.py:169`), so no valid snapshot carries one.
  - `[low]` `[reject]` (blind) v2 decode refuses snapshots that order died-before persons between estate members — the encoder always appends them last, so every snapshot the system writes round-trips; supporting foreign orderings needs order-preserving storage, which is more than a direct correction.
  - `[low]` `[patch]` (blind) `parsePlacement` with a `__proto__` anchor sets the prototype — confirmed; it now assigns with `Object.defineProperty`, plus a test.
  - `[low]` `[reject]` (blind) `parseEdges` keeps duplicate edges — the server's `_read_edges` deduplicates, so only a tampered response carries one; adding a dedup guard is more than a direct correction.
  - `[low]` `[reject]` (blind) the release matrix checks version numbers, not content, against the rollback reader — true, but no command creates lineage until 9.4/9.7, and the rollback floor for those stories is recorded in Design Notes; a content-level matrix is more than a direct correction.
  - `[false]` `[reject]` (blind) legacy byte-identical previews are untested — the existing preview, legacy-case and foundation-outcome suites assert concrete outputs for legacy cases and pass unchanged (348 tests in `api.tests` and the snapshot, command and capacity labels).
  - `[medium]` `[patch]` (edge-case) the delete cascade disagrees with execution — same root cause as the blind delete row; same patch.
  - `[low]` `[reject]` (edge-case) a died-before id outside the contract's identifier format empties persons and placement — only a tampered session reaches it, and the case still reads; an id-format guard is more than a direct correction.
  - `[low]` `[patch]` (edge-case) `__proto__` anchor — same as the blind row; same patch.
  - `[low]` `[patch]` (contract) `__proto__` anchor — same as the blind row; same patch.
  - `[medium]` `[patch]` (contract) the release gate only iterates `v1-*.json`, so the v2-only lineage fixtures skip its decode/re-encode check — confirmed at `mawareeth/release_gates.py:42`; v2 fixtures without a v1 counterpart are now checked too, and `test_database_free` passes.
  - `[false]` `[reject]` (contract) lineage with an `available` preview is not exercised through `viewShare`/`viewReceived` — both delegate to the same `parseCase`, which is tested with full lineage; no consumer reads the new fields differently.
  - `[false]` `[reject]` (contract) the same gap for the `unavailable` variant — same delegation; the preview parser is unchanged by this diff.
  - `[false]` `[reject]` (contract) the same gap for `choose_school` — same refutation.
  - `[false]` `[reject]` (contract) the same gap for `not_ready` — same refutation.

## Design Notes

The anchor table maps an anchor's relationship to its estate's deceased onto the candidates that can be added at it. Each candidate is written as link → root-relative relationship. It covers only the codes in `RELATIONSHIPS`; paths with no code (a daughter's children, a son's wife) are simply absent.

```
root:          parent → father, mother · spouse → husband, wife · child → son, daughter
son:           child → son_of_son, daughter_of_son
father:        parent → grandfather, paternal_grandmother · child → brother, sister, paternal_brother, paternal_sister
mother:        parent → maternal_grandmother · child → brother, sister, maternal_brother, maternal_sister
grandfather:   child → uncle, paternal_uncle
brother:       child → son_of_brother
paternal_brother: child → son_of_paternal_brother
uncle:         child → son_of_uncle
paternal_uncle:   child → son_of_paternal_uncle
```

Edge orientation for 9.7: `parent_of` always runs from parent to child, and `spouse_of` from the anchor to the new person.

Rollout risk: gating on writer 2 matches the approved proposal (AD-20 note). This story creates no edges, so nothing is persisted that a rollback image cannot read. Stories 9.4 and 9.7, which create edges, should confirm that their rollback floor includes this release.

## Verification

**Commands:**
- `uv run python -m unittest engine.tests.test_queries engine.tests.test_contracts -v` -- expected: pass.
- `uv run python manage.py test api.test_snapshots api.test_case_commands api.test_capacity --noinput`, plus any `api.tests` classes touched -- expected: pass (Postgres on 5432; run serially).
- `cd web && node --import ./src/test/loader.mjs --test src/api/case.test.ts && npm run typecheck && npm run lint` -- expected: pass.

## Auto Run Result

Status: done

**Summary:** The Interview Case now carries lineage. Every Case response, and each later death, includes:
- `persons`: every person once, with status alive, died before/with or died later;
- `edges`: `parent_of`/`spouse_of` links;
- `placement`: the relationships the engine allows at each person, with `root` for the estate's deceased.

The session stores optional `edges` and `died_before` lists. The v2 snapshot keeps them losslessly, and while the snapshot writer is 1 every persist refuses them as `unsupported_content`. A new pure engine query, `placement_options`, reads an anchor table to work out the options. The browser parses all three fields. Legacy cases store and export exactly as before. No command and no UI were added.

**Files changed:**
- `engine/placement.py` (new): the anchor table, as data.
- `engine/queries.py`, `engine/__init__.py`: `placement_options` and `Placement`. `relationship_options` now shares an `_options` helper with unchanged behaviour.
- `calc/adapters.py`: died-before persons and edges go into the Family.
- `api/anonymous_case.py`:
  - reads and validates `edges` and `died_before`;
  - adds `persons`, `edges` and `placement` to the Case and each death;
  - strips derived and empty keys on save;
  - exports lineage only when present;
  - remaps edges when an alias is promoted;
  - checks writability before a load.
- `api/snapshots.py`: `ensure_writable` (the writer-1 refusal); v2 decode restores edges and died-before persons.
- `api/views.py`: the SavedCase save is guarded, and a refused open returns 400.
- `api/case_commands.py`: restore replaces `died_before` and maps a writer-1 refusal to `invalid_snapshot`; remove impact ignores edges so it matches what removal does.
- `api/capacity.py`, `api/test_capacity.py`: placement timing for every workload under the 200ms engine budget.
- `mawareeth/release_gates.py`: v2-only fixtures get the decode/re-encode check.
- `api/fixtures/snapshots/v2-lineage-*.json`, `matrix.json`: lineage fixtures and the matrix image.
- Tests: `engine/tests/test_queries.py`, `api/tests.py` (`InterviewLineageTests`), `api/test_snapshots.py`, `web/src/api/case.test.ts`.
- `web/src/api/case.ts`: the `Person`, `Edge` and `Placement` types and strict parsers; absent fields read as empty.
- `epic-9-context.md`: updated for Story 9.1b.

**Review** (one pass, five codex reviewers): 21 findings.
- **Patched:**
  - medium: the delete confirmation followed edges that removal does not follow;
  - medium: the release gate skipped the v2-only fixtures;
  - low: restore kept stale died-before persons;
  - low: a `__proto__` placement anchor set the prototype;
  - low: the mother anchor's options were unpinned.
- **Deferred:** none.
- **Rejected:** 8 false (the scope-only-9.1b row; share/invite creation, which writes no snapshot; null-relationship died-before persons, which the contract forbids; legacy previews, which existing suites cover; four browser-envelope rows, all of which share `parseCase`) and 5 low (an edge invalidated by a relationship edit, which is 9.4's job; foreign person ordering; duplicate edges in the browser; content-level rollback compatibility; malformed died-before ids). The reasons are in the Review Triage Log.

**Follow-up review recommended:** true. This first pass patched two medium entries (2 medium, 3 low, 0 high). The unverified risk is the remove-impact change: once 9.4 brings real lineage cascades, the confirmation will deliberately ignore edges, and that interaction has not been reviewed after the patch.

**Verification** (run by the parent after the patches):
- `uv run python -m unittest engine.tests.test_queries engine.tests.test_contracts`: OK.
- `uv run python manage.py test api.test_snapshots api.test_case_commands api.test_capacity api.test_release_restore_checks api.tests --noinput`: 361 tests OK.
- `node --import ./src/test/loader.mjs --test src/api/case.test.ts`: 62 of 62 pass.
- `npm run typecheck`: clean.
- `npm run lint`: 0 errors and 12 warnings, unchanged from 9.1.
- Matrix audit: every row is covered by a named test that ran:
  - legacy: `test_legacy_case_adds_only_persons_edges_and_placement`;
  - died-before with a link, and writer 1: `test_died_before_person_and_edges_are_read`, `test_writer_1_refuses_to_persist_lineage`;
  - second father: `test_second_father_and_wives_are_not_offered`, `test_placement_died_before_anchor_and_cardinality`;
  - blocked candidate: `test_blocked_candidate_is_flagged_not_dropped`;
  - later estate: `test_later_estate_placement_uses_that_estates_relationships`;
  - alias promotion: `test_alias_promotion_remaps_edges_and_removal_drops_them`;
  - writer-1 save: `test_saved_case_save_with_lineage_follows_the_writer`.

**Residual risks:**
- Rollback to an image older than 9.1b cannot read v2 lineage snapshots. No command creates lineage yet; 9.4 and 9.7 must confirm their rollback floor first.
- If the writer is switched from 2 back to 1 while a session holds lineage, every later command on that session raises `unsupported_content`.
- With no madhab, placement reports no blocked relatives, matching `heir_options`.
- A Case with died-before persons carries a top-level `died_before` key, which the browser ignores.
- Wider suites, `calc` and the full `api`, were not run; the driver runs them once per batch.
