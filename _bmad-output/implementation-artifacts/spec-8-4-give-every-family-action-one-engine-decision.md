---
title: 'Story 8.4: Give every family action one engine decision'
type: 'feature'
created: '2026-11-17'
status: 'done'
baseline_revision: 'fdcb2f2af795a55e34127ed6e026781a4778315f'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-8-3-preserve-successive-death-answers-and-proof-inside-the-core.md'
warnings: [multiple-goals, oversized]
deferred:
  - summary: >-
      Blocked labels and the engine proof disagree when the full sisters' cap exhausts the paternal siblings' pool beside a grandfather.
    evidence: |-
      engine/kinship.py keeps the wave-1 label (paternal siblings counted out only with a full brother, or full sisters plus a female descendant, matching calc.models paternal_siblings_counted_out and api/tests.py's ORM sweeps). engine/single.py gives such a paternal sibling condition excluded_by_full_siblings and share 0 in further cases (sisters' cap exhausted with no brother or female descendant), so the add-relative label says "not blocked" while the answer gives nothing. engine/tests/test_queries.py test_solver_consistency asserts this one-sided exception. Settle with a fiqh/UX decision on labelling that case, then align kinship.blocked and the ORM sweep.
    location: >-
      engine/kinship.py _is_blocked / _paternal_counted_out; engine/tests/test_queries.py test_solver_consistency
    severity: medium
  - summary: >-
      Queries accept a replacing person's new relationship that contradicts that person's gender or their relationship in another estate.
    evidence: |-
      engine/queries.py relationship_options and change_impossible use only the estate's relationship counts, as the wave-1 shell did; a person id shared across estates can be offered a relationship of the other sex. Same root cause as the 8.3 deferral (Family v1 has no relationship/gender cross-check). Settle in the Family contract or the 8.9 command service.
    location: >-
      engine/queries.py relationship_options
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Fiqh decisions outside the share calculation live in shell tables. `api/heir_rules.py` re-implements kinship impossibility and School blocking (hajb) by School name, and `engine/core.py` keeps a second copy of `SECOND_OF`/`MAX_WIVES`. No engine query answers delete impact, required facts, refusals or share-changing presets. The 8.1 purity test only scans direct absolute imports, so a transitive Django import, file I/O, a clock read or mutable global state would pass.

**Approach:**
- Add a pure `engine/queries.py` (AD-16) over `Family` + `RuleSet`. Every answer is a stable code, never text. Move the kinship tables into one engine module used by both the queries and `core.evaluate`.
- Reduce `api/heir_rules.py` to a thin adapter with no fiqh tables. It keeps its public signatures, so `api/anonymous_case.py`, `api/preview.py` and the parity tests are routed through the engine unchanged.
- Add an engine purity gate (transitive import graph, I/O, clock, global state, forbidden importers) that runs as its own CI step.

## Boundaries & Constraints

**Always:**
- `engine/` stays stdlib-only and pure. Query results are frozen dataclasses or tuples of codes, person ids and estate orders.
- Wave-1 behaviour is unchanged for every caller. Same codes: six `second_*`, `fifth_wife`, `husband_of_male`, `wife_of_female`, `has_husband`, `has_wife`, `has_both_spouses`. Same blocked sets, including mu'adda counted-out paternal siblings. Ja'fari, or an unknown madhab at the shim, still blocks nothing. The existing `api/tests.py` heir-rule tests and blocking-vs-ORM sweeps (around lines 1850-1990) pass unedited.
- Blocking reads rule values (`grandfather_with_siblings == 'blocks'`, `father_blocks_his_mother`), never School names. The only School check is the Ja'fari refusal, through `rule_set.school == 'jafari'`, as in `core`.
- Impossible always beats blocked: a relationship is in `impossible` or `blocked`, never both.
- Family has no root gender, so the root's gender is an explicit query argument `deceased_gender`. When it is None, the spouse-sex rules are skipped. For a later estate the deceased's own `Person.gender` is used, and passing `deceased_gender` is a `ContractError('invalid_contract')`.
- A query never mutates or returns a modified Family. An invalid target, an unknown estate order or a non-member raises `ContractError('invalid_contract')`.

**Never:**
- No change to `engine/contracts/**`, `contracts/**` fixtures or manifest, migrations, `calc/`, `reports/` or `web/`. No contract version bump and no new contract vocabulary. The query codes are engine constants that reuse the existing shell code strings.
- No change to `api/anonymous_case.py` deletion (`_remove_rows`) or to the limits (`MAX_HEIRS`, two later deaths). Routing deletes through `delete_impact` and enforcing limits are command-service work (8.9). The browser renders server `blocked`/`invalid`/`errors`. Its remaining checks are limits, parse validation, identity-link topology and display-only grouping, so `web/` is untouched.
- No user-facing text, translations or `.po` changes. No new dependencies (no import-linter/grimp). No fiqh corrections. No consumer calls `calculate` for shares through these queries.

## I/O & Edge-Case Matrix

The Family is built with the 8.3 helpers. "Root" means estate 1. The rule set is hanafi unless named.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Second parent | root heirs father; `relationship_options` | `impossible['father'] == 'second_father'`; father not in `blocked` | — |
| Fifth wife | four wives | `impossible['wife'] == 'fifth_wife'` | — |
| Spouse sex (root) | empty root, `deceased_gender='male'` | `impossible['husband'] == 'husband_of_male'`; with `deceased_gender=None` husband is allowed | — |
| Spouse sex (later) | estate 2 deceased female, `estate=2` | `impossible['wife'] == 'wife_of_female'` | passing `deceased_gender` with `estate=2` → `ContractError` |
| Blocked but valid | root heirs son | `son_of_son`, `brother`, … in `blocked`; not in `impossible` | — |
| School rule | root heirs grandfather; hanafi vs shafii | `brother` blocked under hanafi only | — |
| Mu'adda | grandfather + brother, shafii | `paternal_brother` in `blocked` | — |
| Ja'fari | any family, jafari | `blocked == ()`; kinship `impossible` still reported | — |
| Edit | root heirs father F; `change_impossible('father', replacing=F)` | None (F's own row excluded from counts) | `replacing` not a heir of that estate → `ContractError` |
| Gender change | root heirs husband; `deceased_gender_conflict(family, 'male')` | `has_husband`; husband + wife → `has_both_spouses` for either gender | — |
| Delete with descendants | person P with `parent_of` edges P→C→G | `Impact(persons=(P, C, G), estates=())` in `family.persons` order | — |
| Delete later deceased | 8.3 fixture, delete S1 | S1 and his estate (2) removed. W and S2 stay (root heirs) | — |
| Delete orphaning | fixture with `third`, delete W | W, estate 3 and N (only in estate 3) removed. S2 stays | — |
| Delete one membership | delete W only from estate 2 (`estate=2`) | `Impact((), ())`: W survives in root | — |
| Delete last membership | person only in estate 3, `estate=3` | that person and any estate they own are removed | — |
| Invalid target | unknown id, or the root id | `ContractError('invalid_contract')`; Family unchanged | — |
| Refusal | maliki malikiyya family / jafari | `refusal(...)` equals `calculate(...).refusal` (`malikiyya_disputed` / `school_not_supported`); None when calculated | — |
| Required facts | any wave-1 School | `()` | — |
| Share-changing presets | presets `[school_rule_set('hanafi'), school_rule_set('shafii')]` for a root grandfather + brother family under hanafi | `(school_rule_set('shafii'),)`: only rule sets whose `final_shares` or refusal differ, in input order | a non-RuleSet item → `ContractError` |

</intent-contract>

## Code Map

- `api/heir_rules.py:1-205` -- today's tables: `SECOND_OF`, `MAX_WIVES`, code constants, `kinship_code`, `gender_conflict`, `is_impossible_family`, `_is_blocked`, `LATER_BLOCKERS`, `BLOCKABLE`, `blocked_relationships(madhab, counts)`. These are the behaviour to port into the engine, then the file becomes the adapter. Callers: `api/anonymous_case.py:223-229` (`heir_options`), `:337` (gender change), `:592` (add), `:648` (edit); `api/preview.py:59,189` (`is_impossible`); `calc/test_engine_parity.py:131,134,306`; `api/tests.py:1850-1986` (examples, ORM sweeps, `RELATIONSHIP_CODES`/`GENDER_CODES` vocab check).
- `api/anonymous_case.py:23-47` -- relationship→gender table (shell, also used for validation). Leave it untouched. The adapter uses the engine-owned `RELATIONSHIP_GENDERS`, and `api/test_heir_rules_engine.py` asserts the two are equal.
- `engine/core.py:18-27,63-74` -- duplicate `SECOND_OF`, `MAX_WIVES`, `is_impossible`. Import them from the new kinship module instead. Behaviour unchanged.
- `engine/core.py:121-188` -- `evaluate`, `calculate`, `final_shares`. These are reused by `refusal` and `share_changing_presets`.
- `engine/single.py:128-131,589-608` -- the engine's rule-value reads and the mu'adda `excluded_by_full_siblings` condition. These are the consistency reference for blocked queries.
- `engine/rule_set.py:16-90` -- `RuleSet`, `RULE_SCHEMA`, `school_rule_set`, `parse_preset`.
- `engine/contracts/family.py:12-77` -- `Person`, `Edge(kind parent_of|spouse_of, from_, to)`, `Estate`, `LayerHeir`, `Family`. The root is not in `persons`.
- `engine/tests/test_layered.py` / `engine/tests/test_core.py` -- Family-building helpers to reuse in the new tests.
- `engine/tests/test_contracts.py:164-184` -- the existing `PurityTests` (direct imports only). Keep it.
- `.github/workflows/django.yml:83-123` -- `validate` job. Add the gate step after "Install dependencies".
- `contracts/fixtures/preset/zz-2026-01-01.json` -- the existing preset fixture, usable with `parse_preset` in tests.

## Tasks & Acceptance

**Execution:**
- `engine/kinship.py` (new) -- Holds the single home of `SECOND_OF`, `MAX_WIVES`, the code constants, `RELATIONSHIP_CODES`, `GENDER_CODES`, `RELATIONSHIP_GENDERS`, `BLOCKABLE` and `LATER_BLOCKERS`. It also has pure functions over a relationship-count mapping: `kinship_code(relationship, gender, counts)`, `gender_conflict(gender, counts)`, `is_impossible(counts, gender=None)` (gender None = the current gender-free `core.is_impossible`), and `blocked(rules, school, counts) -> frozenset`, ported from `heir_rules` with rule values instead of School names. Use read-only constants (tuples, `MappingProxyType`/frozenset).
- `engine/core.py` -- Use `kinship.is_impossible` / `SECOND_OF`, and drop the local copies. Output is unchanged.
- `engine/queries.py` (new) -- Public functions, each validating its arguments and raising `ContractError('invalid_contract')` per Boundaries:
  - `relationship_options(family, rule_set, *, estate=1, replacing=None, deceased_gender=None) -> Options(impossible: Mapping[str,str], blocked: tuple)`, in `codes.RELATIONSHIPS` order;
  - `change_impossible(family, rule_set, relationship, *, estate=1, replacing=None, deceased_gender=None) -> Optional[str]`;
  - `deceased_gender_conflict(family, gender, *, estate=1) -> Optional[str]`;
  - `delete_impact(family, person, *, estate=None) -> Impact(persons: tuple, estates: tuple)`, which removes a person, their `parent_of` descendants transitively, estates owned by removed persons, and recursively persons left with no estate membership by a removed estate. Persons are in `family.persons` order and estates ascending;
  - `refusal(family, rule_set) -> Optional[str]`;
  - `required_facts(family, rule_set) -> tuple` (`()` for every current rule set);
  - `share_changing_presets(family, rule_set, presets) -> tuple`.
- `engine/__init__.py` -- Re-export the queries, `Options` and `Impact`.
- `api/heir_rules.py` -- Rewrite as the adapter. Keep `counts`, `kinship_code`, `gender_conflict`, `is_impossible_family`, `blocked_relationships(madhab, counts)` and the exported code constants. They are aliases of or delegates to `engine.kinship`/`engine.queries`: build a single-estate `Family` from `counts` (one person per heir, genders from `RELATIONSHIP_GENDERS`) and use `school_rule_set(madhab)`. An unknown madhab returns an empty set. No relationship tables remain in this file. Update the module docstring.
- `engine/tests/test_queries.py` (new) -- Cover every I/O-matrix row. Add a consistency sweep: for families of up to four heirs (deterministic seeded random over `RELATIONSHIPS`) under each Sunni rule set, a relationship is in `blocked` iff adding it and calling `single.solve` gives that heir rule `blocked` or condition `excluded_by_full_siblings` (skip `Refused`). Assert `RELATIONSHIP_GENDERS` keys equal `codes.RELATIONSHIPS` (same order) with values in `codes.GENDERS`, and add a test that queries leave the Family equal to a deep copy taken before the call.
- `api/test_heir_rules_engine.py` (new) -- Assert `engine.kinship.RELATIONSHIP_GENDERS == anonymous_case.RELATIONSHIPS`, and that `api/heir_rules.py` source defines no dict/set literal tables (AST: no module-level Dict/Set/List assignments other than re-exported names).
- `engine/tests/test_purity.py` (new, Django-free, runnable by `python -m unittest`) -- Five checks:
  - (a) Spawn `sys.executable -I -c` that puts the repo root on `sys.path`, imports every non-test `engine` module, and prints the top-level names of all modules newly added to `sys.modules`. Assert each is in `sys.stdlib_module_names` or `engine`. This is the transitive gate.
  - (b) An AST scan of non-test engine files rejects imports of `os`, `io`, `pathlib`, `shutil`, `tempfile`, `glob`, `time`, `datetime`, `random`, `secrets`, `socket`, `subprocess`, `threading`, `multiprocessing`, `asyncio`, `logging`, `sqlite3`, `urllib`, `http`, `gettext`, `locale`, `importlib`, `builtins`. It also rejects calls to `open`, `__import__`, `exec`, `eval`, `compile`, `input` and `print`, and relative imports that escape the `engine` package.
  - (c) It rejects `global`/`nonlocal` statements, `functools.lru_cache`/`cache`, and, inside functions, assignment, augmented assignment or deletion on a subscript or attribute of a module-level name, plus calls of `append`/`extend`/`insert`/`update`/`setdefault`/`pop`/`popitem`/`add`/`discard`/`remove`/`clear` on a module-level name.
  - (d) No Python file under `support/` or `metrics/` (if those directories exist) imports `engine`.
  - (e) Every check self-tests on an inline bad-source sample so the gate cannot pass vacuously.
- `.github/workflows/django.yml` -- In `validate`, after "Install dependencies", add the step `Engine purity gate` with `run: python -m unittest engine.tests.test_purity -v`.

**Acceptance Criteria:**
- Given the repository after this story, when `api/heir_rules.py` is inspected, then it holds no relationship tables and only delegates to `engine`. When the existing `api.tests` heir-rule/blocking tests and `calc.test_engine_parity` run, then they pass with no edits to them.
- Given `anonymous_case` responses (`heir_options`, `edit_options`, `errors.relationship`, `errors.gender`) and preview `invalid_family`, when produced after this story, then they are identical to before for the same session (proven by the unchanged `api.tests`).
- Given a module under `engine/` that imports Django transitively, opens a file, reads the clock or mutates module state, when `python -m unittest engine.tests.test_purity` runs, then it fails. On the current tree it passes, and CI runs it as its own step.
- Given the repository after this story, when `git diff fdcb2f2 --stat` is inspected, then only `engine/**`, `api/heir_rules.py`, `api/test_heir_rules_engine.py`, `.github/workflows/django.yml` and this spec have changed, and `makemigrations --check --dry-run` reports no changes.

## Spec Change Log

## Review Triage Log

### 2026-11-17 — Review pass
- verdicts: 25 findings — high 0, medium 3, low 14, false 8, maybe-false 0
- findings:
  - `[low]` `[reject]` (verification-gap other) `test_forbidden_importers` checks no real files because `support/` and `metrics/` do not exist yet. This is by design: the spec says "if those directories exist", and the inline self-tests prove the check works. Nothing to fix until those packages appear.
  - `[low]` `[defer]` (verification-gap other) The solver sweep's cap-exhausted branch is one-sided. Grouped with the medium blocked-label row below and deferred.
  - `[low]` `[reject]` (verification-gap other) New imports and `__all__ +=` sit below the original `__all__` in `engine/__init__.py`. Style only, with no named harm.
  - `[false]` `[reject]` (edge) `is_impossible_family` now flags husband+wife when the gender is unset. Every caller (`api/preview.py:59,189`) passes the session deceased's or the death's required `gender` (male/female), and with either gender the old function already returned True for husband+wife.
  - `[false]` `[reject]` (edge) A missing rule key raises KeyError. `RuleSet.__post_init__` requires every `RULE_SCHEMA` key, and `parse_preset` lays its rules over the full School defaults, so a RuleSet cannot lack them.
  - `[low]` `[reject]` (edge) A later estate whose deceased is not in `persons` raises StopIteration. `parse_family` rejects such a Family, so only a hand-built invalid Family reaches it, and the fix adds a guard.
  - `[low]` `[reject]` (edge) One preset whose calculation raises ContractError aborts `share_changing_presets`. calculate only raises for invalid inputs, which are already validated, and there is no caller yet.
  - `[low]` `[reject]` (edge) A huge count makes the shim allocate one Person per heir. Counts come from sessions capped at `MAX_HEIRS` = 50.
  - `[low]` `[reject]` (edge) Mutation through lambdas, class bodies or shadowed locals evades the `state` scan. The gate is a static guard on reviewed engine code, not an adversarial sandbox, and covering these adds a lot of analysis.
  - `[low]` `[reject]` (edge) Calls reached through `getattr`/`__builtins__` indirection evade the `effects` scan. Same reasoning.
  - `[false]` `[reject]` (edge) The transitive probe should reject forbidden stdlib modules such as `os`. The stdlib's own modules (dataclasses → inspect → os) import them, so that assertion would always fail. Direct use is caught by the AST scan of engine files.
  - `[low]` `[defer]` (edge) The cap-exhausted sweep branch is one-sided. Grouped with the deferred blocked-label row.
  - `[medium]` `[patch]` (blind) With no root gender, adding a wife beside a husband (or the reverse) was allowed while `evaluate` refuses husband+wife as `invalid_family`. Fixed: `relationship_options` reports `husband_of_male` / `wife_of_female` in that case, and both are tested in `test_kinship_matrix`.
  - `[medium]` `[defer]` (blind) A replacing person can be offered a relationship of the other sex across estates. This predates the story (it is the 8.3 deferral's root cause); see frontmatter `deferred`.
  - `[low]` `[reject]` (blind) Mutation through a local alias of module state evades the gate. Same reasoning as the edge `state` row.
  - `[low]` `[reject]` (blind) Nested-scope parameter names mask an outer global mutation. Same reasoning.
  - `[low]` `[reject]` (blind) Mutable default arguments are not rejected. No engine function uses one, and the fix adds another check.
  - `[low]` `[reject]` (blind) `__builtins__['open']` evades the gate. Same reasoning as the edge indirection row.
  - `[low]` `[patch]` (blind) A delayed third-party import inside a function escaped the CI gate. Fixed: `effects()` flags any absolute import that is neither stdlib nor `engine`, with delayed-import self-tests.
  - `[false]` `[reject]` (intent) No browser or anonymous_case code changed. The investigation found that the browser renders server `blocked`/`invalid`/`errors` and keeps no fiqh table, and the anonymous_case decisions now come from engine code through the adapter, which unchanged `api.tests` proves.
  - `[false]` `[reject]` (intent) The adapter calls engine kinship helpers rather than full Family queries. The AC is that the shell keeps no independent fiqh tables; the helpers and tables are engine-owned and `api/test_heir_rules_engine.py` asserts the adapter holds no literal tables.
  - `[medium]` `[defer]` (intent) Blocking is a second implementation beside the solver, held together by a sweep with one legacy exception. Keeping wave-1 labels unchanged is required; the exception is the deferred blocked-label row.
  - `[false]` `[reject]` (intent) It is not asserted that state is unchanged after an invalid call. `Family` and its parts are frozen dataclasses of tuples, so a query cannot mutate them, and valid calls are asserted unchanged.
  - `[false]` `[reject]` (intent) `required_facts` always returns `()`. Wave-1 rule sets have no facts (the settings schema is empty), and the intent requires current behaviour preserved.
  - `[false]` `[reject]` (intent) Deferred imports were outside the transitive probe. This is addressed by the blind delayed-import patch, which now covers it in the AST scan.

## Design Notes

**Why port, not probe the solver.** Blocked status could be derived by solving the family plus the candidate. But a Maliki malikiyya family raises `Refused` and then gives no answer, where today it still labels. So the queries use the ported kinship/blocking rules on the same rule values the solver reads, and the sweep in `test_queries.py` holds the two together, as `api/tests.py` already holds the shell against the ORM.

**Delete semantics.** These are person-level, matching `anonymous_case._remove_rows` at row level: a person survives while they keep an estate membership. Losing an estate (its deceased removed) removes its members' memberships, which can cascade. With `estate=k` only that membership goes, and the person goes only if it was their last. The root is never deletable.

## Verification

**Commands:**
- `uv run python -m unittest engine.tests.test_purity -v` -- expected: OK
- `uv run python manage.py test engine --noinput` -- expected: all pass
- `uv run python manage.py test api.tests --noinput` -- expected: all pass, with heir-rule tests unedited
- `uv run python manage.py test calc.test_engine_parity --noinput` -- expected: all pass (slow, ~9 min)
- `uv run python manage.py makemigrations --check --dry-run` -- expected: No changes detected

## Auto Run Result

Status: done

**Summary:** The engine now answers every family action itself, with codes only (AD-16).
- `engine/queries.py` provides `relationship_options`, `change_impossible`, `deceased_gender_conflict`, `delete_impact`, `refusal`, `required_facts` and `share_changing_presets`.
- The kinship and blocking rules (wave-1 behaviour, read from rule values rather than School names) live once in `engine/kinship.py`, and `core.evaluate` shares them.
- `api/heir_rules.py` is now a thin adapter with no tables. `anonymous_case` options and errors and the preview's `invalid_family` come from the engine, unchanged.
- A Django-free purity gate checks the transitive import probe, I/O, clock and effectful calls, mutable global state, delayed third-party imports, and forbidden importers. CI runs it as its own step.

**Files:**
- `engine/kinship.py`: the single home of the kinship codes, relationship genders, impossibility, gender conflict and rule-value blocking.
- `engine/queries.py`: the pure AD-16 queries with frozen `Options`/`Impact` results.
- `engine/core.py`: uses `kinship` instead of its own `SECOND_OF`/`MAX_WIVES` copy.
- `engine/__init__.py`: re-exports the queries.
- `api/heir_rules.py`: the compatibility adapter onto the engine. It ignores unknown relationship ids, as before.
- `api/test_heir_rules_engine.py`: checks that relationship genders equal `anonymous_case`, that the adapter has no literal tables, and the unknown-relationship and unknown-school cases.
- `engine/tests/test_queries.py`: the I/O matrix, invalid arguments, immutability, and a solver-consistency sweep (about 450 families per Sunni School).
- `engine/tests/test_purity.py`: the purity and import-graph gate with self-tests.
- `.github/workflows/django.yml`: the `Engine purity gate` step in `validate`.

**Review:** 25 findings.
- Patched (2): opposite spouse with no root gender (medium), and delayed non-stdlib imports in the gate (low).
- Deferred (2 entries): blocked label vs proof when the full sisters' cap exhausts the paternal pool; cross-estate relationship/gender of a replaced person. See frontmatter `deferred`.
- Rejected: 8 false and 13 low, each with its reason in the triage log.

**Follow-up review recommended: false.** This first pass patched one medium and one low entry and no high one. Patched counts: high 0, medium 1, low 1.

**Verification:**
- `uv run python -m unittest engine.tests.test_purity`: 4 OK (re-run after the patches).
- `manage.py test engine api.test_heir_rules_engine`: 60 OK (re-run after the patches).
- `manage.py test api.tests`: 272 OK. This ran before the review patches; the four heir-rule classes (8 tests) were re-run after the patches and passed.
- `manage.py test calc.test_engine_parity`: 8 OK. It ran before the review patches, which touch only `engine/queries.py` and a test file, neither on the parity path.
- `makemigrations --check --dry-run`: No changes detected.
- Every I/O-matrix row is covered in `engine/tests/test_queries.py` and ran.

**Residual risks:**
- `engine/contracts/values.py` imports `datetime` for deterministic `date.fromisoformat`. The gate allows this one exact use, with no `now`/`today`.
- Deletes still use `anonymous_case._remove_rows`. `delete_impact` is consumed from 8.9/9.4.
- The browser still enforces limits and link topology (no fiqh). Those move to the 8.9 command service.
