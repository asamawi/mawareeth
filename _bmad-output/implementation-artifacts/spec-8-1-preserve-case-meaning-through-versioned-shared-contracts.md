---
title: 'Story 8.1: Preserve Case meaning through versioned shared contracts'
type: 'feature'
created: '2026-11-16'
status: 'done'
baseline_revision: 'ee27ce64ae7fdb67688b13647219cbcdf257855b'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-mawareeth-2026-11-16/ARCHITECTURE-SPINE.md'
warnings: [oversized]
deferred:
  - summary: >-
      No test maps a real phase-1 session or SavedCase snapshot (or its legacy madhab) into the new Family and Basis contracts.
    evidence: |-
      maybe-false. The fixtures are hand-written, and api/test_contract_codes.py ties only the vocabularies. Settle by round-tripping real stored schema-1 snapshots through the dual readers in story 8.8.
    location: >-
      engine/contracts/family.py, engine/contracts/basis.py
    severity: medium (unverified)
---

<intent-contract>

## Intent

**Problem:** Phase 2 needs one meaning for a family, a Basis, a Result, a School comparison, a presented answer, a preset file and a term catalog. Today each consumer has its own ad-hoc shape: the session dict, the preview `basis`, proof v1/v2 and the SavedCase snapshot. Later stories could silently reinterpret a family's inputs or shares.

**Approach:** Commit versioned contracts (AD-25) as strict parse/dump code in a new pure, stdlib-only `engine/contracts/` package, mirrored in TypeScript in `web/src/contracts/`. Shared JSON fixtures in a top-level `contracts/` folder must round-trip byte-for-meaning identically in both languages. Add the one shared AD-18 Basis resolver. A version manifest, a code vocabulary file and a fixture lock make a meaning change impossible without a version bump.

## Boundaries & Constraints

**Always:**
- `engine/` imports only itself and the Python standard library. That means no Django, no `calc`/`api` imports and no I/O in non-test code.
- Parsers are strict:
  - They reject unknown keys, wrong types, bools-as-ints and floats.
  - They reject unreduced fractions, a denominator ≤ 0, negative shares and integers outside ±(2^53−1). JS must not lose precision.
  - They reject unknown codes and unknown versions.
- Every error is a typed `ContractError` whose `to_dict()` returns the convention `{error: code, detail}`, where `detail` is a string.
- `dump(parse(x)) == x` for every valid fixture, in both languages.
- Codes are lowercase snake_case (`^[a-z][a-z0-9_]*$`). Existing vocabularies are copied verbatim:
  - the 23 relationship codes in `api/anonymous_case.py`;
  - the schools in `calc/schools.py`;
  - the refusal reasons, including `invalid_family`;
  - the `calc/proof.py` RULES, CONDITIONS, BLOCKED_BY, OPTIONS, SCHOOL_RULES and STEPS.
- Top-level documents carry their own version:
  - Family, Result, Comparison and PresentedResult carry `"version": 1`.
  - Preset and catalog carry `"schema_version": 1`.
  - Basis has no envelope (it is exactly the AD-18 shape) and is versioned only in the manifest.

**Never:**
- No database fields or migrations.
- No consumer switch: `calc`, `api`, `reports` and the web pages stay untouched, except for new test modules.
- No renaming or reuse of any code.
- Later-wave features (Country execution, bequests, gifts) are only *representable*. Nothing computes them.
- No new runtime dependencies. In particular, no jsonschema library: the parsers are the schema.
- No display text in Result or preset documents.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Basis compare/school | `{kind:"compare"}`, `{kind:"school",school:"maliki"}` | ResolvedBasis(kind, school or None) | — |
| Basis country | `{kind:"country",preset_id:"zz",preset_version:"2026-01-01"}` with the lookup containing the preset (`default_school: hanbali`) | resolved `school="hanbali"` (derived) | — |
| Basis country unavailable | same input, lookup empty | — | `preset_unavailable` |
| Basis malformed | country with `school`, school without `school`, compare with extra key, unknown kind, bad date, `preset_id:"SA"` | — | `invalid_basis` |
| Legacy snapshot, no `basis` key | `madhab:"shafii"` / `"jafari"` / `None` / `"x"` | school shafii / school jafari / compare / compare; never country | — |
| Snapshot with `basis` key | any value, including None | resolved strictly as current input | `invalid_basis` if malformed |
| Fraction | `{numerator:2,denominator:4}`, `0.5`, `{numerator:1.0,…}`, `2**53` | — | `invalid_contract` |
| Version | Family with `version:2` | — | `unsupported_version` |
| Family integrity | duplicate person id, edge to a missing id, `died_later` without `death_order`, `alive` with an order, layer heir missing | — | `invalid_contract` |
| Result stage | allocation whose share × stage base is not an integer | — | `invalid_contract` |
| Comparison consistency | `agreement` with differing persons; refusal of some Schools but outcome `agreement` | — | `invalid_contract` |

</intent-contract>

## Code Map

- `api/anonymous_case.py:15-43,216,272-282,402-455` -- source vocabularies: `MADHABS`, the 23 `RELATIONSHIPS`, `GENDERS` and uuid4-hex heir ids. `export_snapshot` gives the phase-1 snapshot `{madhab, deceased:{gender,estate}, heirs:[{id,relationship,gender,name[,same_as]}], deaths:[{heir_id,order:2|3,gender,heirs}]}`. Read-only.
- `calc/schools.py` -- the school ids `hanafi/maliki/shafii/hanbali/jafari` and `SUNNI`, plus the refusal codes `school_not_supported` and `malikiyya_disputed`. Read-only.
- `calc/manasikhat.py` -- `manasikhat_unsupported`. `api/preview.py` -- `invalid_family`, the compare semantics (agreement when every (person, blocked, n, d) and the unallocated share match; otherwise `choose_school`), and refusals as `{status:'unavailable', reason}`. Read-only.
- `calc/proof.py` -- `RULES`, `CONDITIONS`, `BLOCKED_BY`, `OPTIONS`, `SCHOOL_RULES` and `STEPS` (base, awl, radd, correction, unallocated). Verse codes `4:11`/`4:12`/`4:176` become citation keys `quran_4_11`, `quran_4_12` and `quran_4_176`. Read-only.
- `api/contracts/*.json` + `api/tests.py:42` + `web/src/api/case.test.ts:974` -- the existing pattern for shared fixtures. Web tests read files outside `web/` with `readFileSync(new URL("../../../…", import.meta.url))`. Copy that pattern.
- `web/src/test/loader.mjs` -- the node test loader. It has no JSON-import hook, so use `readFileSync` and never `import … with {type:"json"}`.
- `.github/workflows/django.yml` -- CI runs `manage.py test` with no labels, so `engine/tests/test_*.py` is discovered when `engine/` and `engine/tests/` have an `__init__.py`. The web job runs `npm run lint`, `typecheck` and `test` in `web/` from a full checkout.

## Tasks & Acceptance

**Execution:**
- `contracts/manifest.json` -- `{"family":1,"basis":1,"result":1,"comparison":1,"presented_result":1,"preset":1,"catalog":1}`. This is the single source of contract versions.
- `contracts/codes.json` -- vocabularies by name:
  - relationships, genders, schools, sunni_schools, basis_kinds;
  - person_statuses `alive`, `died_before_or_with` and `died_later`;
  - refusal_reasons;
  - allocation_kinds `fixed`, `residue`, `bequest`, `blocked` and `refused`;
  - proof_rules, proof_conditions, blocked_by, proof_options, school_rules, proof_steps;
  - comparison_outcomes `agreement`, `difference` and `all_refused`;
  - error_codes `invalid_contract`, `unsupported_version`, `invalid_basis` and `preset_unavailable`;
  - review_states `reviewed` and `pending`;
  - param_types `int`, `fraction`, `person`, `code` and `citation`.
- `engine/__init__.py`, `engine/contracts/__init__.py` -- package. Re-export `CONTRACT_VERSIONS`, `ContractError` and each `parse_*`/`dump_*`.
- `engine/contracts/codes.py` -- tuples identical to `codes.json`, and `CONTRACT_VERSIONS`. No file reads.
- `engine/contracts/errors.py` -- `ContractError(code, detail)` with `to_dict()`.
- `engine/contracts/values.py` -- shared strict readers: object with exact keys, int (safe range, not bool), code in vocabulary, id (`^[A-Za-z0-9_-]{1,64}$`), ISO date, and Fraction ↔ `{numerator, denominator}`.
- `engine/contracts/family.py` -- frozen dataclasses with `parse_family` and `dump_family`. The shape:
  - `{version, root, persons:[{id, gender, name|null, relationship|null, status, death_order|null}], edges:[{kind:"parent_of"|"spouse_of", from, to}], estates:[{order, deceased, heirs:[{person, relationship}]}], answers:[{question, person|null, value: code|bool}], gifts:[{branch, amount_minor}], bequests:[{branch, amount_minor}], estate:{amount_minor|null, currency:{code:^[A-Z]{3}$, explicit:bool}|null}}`.
  - `relationship` on a person is root-relative, and is null only for a relative of a later deceased alone. Layer heir `relationship` is relative to that layer's deceased.
  - `estates[0]` is order 1 with `deceased == root`. A later layer's deceased must be `died_later` with a matching `death_order` (2 or 3).
  - `died_before_or_with` and `alive` carry `death_order: null`.
- `engine/contracts/basis.py` -- `parse_basis`, `dump_basis`, plus the resolver:
  - `resolve_basis(data, presets: Mapping[tuple[str,str], str]) -> ResolvedBasis(basis, school|None)`. The map takes `(preset_id, version)` to `default_school`.
  - `basis_for_snapshot(snapshot, presets)`. The AD-18 legacy fallback applies only when the `basis` key is absent.
  - Schools accepted: all 5. `preset_id` matches `^[a-z]{2}$`. The version must be a valid `YYYY-MM-DD`.
- `engine/contracts/result.py` -- the Result shape:
  - `{version, school, status:"calculated"|"refused", refusal:{reason}|null, allocations:[Allocation], unallocated: fraction|null, steps:[{step, params:{name:{type, value}}}], layers:[{order, deceased, inherited: fraction, allocations, steps, unallocated}]}`.
  - Allocation is `{person, kind, share: fraction, stage:{step, base:int}|null, rule, condition|null, blocked_by|null, school_rule|null, option|null, citations:[key]}`.
  - A refused result has empty allocations, steps and layers.
  - A blocked allocation has a zero share.
  - The `stage` check is that share × base is an integer.
- `engine/contracts/comparison.py` -- the Comparison shape:
  - `{version, outcome, schools:[{school, result: Result}], differing_persons:[id], refusals:[{school, reason}], selection_required: bool, selected_school|null}`.
  - Consistency rules:
    - `agreement` means no differing persons, no refusals and no selection required.
    - `difference` means at least one differing person or a partial refusal (a partial refusal is some Schools refused and some calculated). `selection_required` is true exactly when `selected_school` is null.
    - `all_refused` means every School refused.
- `engine/contracts/presented.py` -- the PresentedResult shape:
  - `{version, locale, direction:"ltr"|"rtl", basis, state:"answer"|"selection_required"|"refused", comparison_outcome|null, rows:[{person, name:{text}|null, relationship:{translated:{text, lang, dir}, original:{text, lang:"ar", dir:"rtl"}}, kind, share:{fraction, text}, amount:{amount_minor, currency, text}|null}], rounding:{amount_minor (signed), currency, text}|null, unallocated:{fraction, text}|null, refusals:[{school|null, reason, text}], notices:[{code, text}]}`.
  - `state:"refused"` means no rows.
- `engine/contracts/preset.py` -- `{schema_version, id, version, default_school, default_currency, settings:{code: bool|int|code}, rules:{code: bool|int|code}, citations:{rule_key: {statute_id, article, checked_on} | {gap_school}}, reviewed_by|null, reviewed_on|null}`.
  - `reviewed_by` and `reviewed_on` are both null or both set.
  - Every `rules` key needs a citation.
- `engine/contracts/catalog.py` -- `{schema_version, locale, terms:{dotted.snake.key: {text, review, placeholders:{name: param_type}}}}`.
  - Text must be non-empty.
  - The `{name}` placeholders in the text must equal the declared placeholders exactly.
- `contracts/fixtures/<contract>/*.json` -- the valid fixtures:
  - family: `single-estate` (Arabic and Latin names, answers, estate + currency) and `later-deaths` (two later deaths, a `died_before_or_with` child, edges, gifts and bequests, null estate);
  - basis: `compare`, `school`, `country`;
  - result: `blocked`, `refused`, `later-deaths` (typed params of every `param_type`);
  - comparison: `agreement`, `difference-selection-required`, `difference-selected`, `partial-refusal`, `all-refused`;
  - presented_result: `agreement`, `difference`, `selection-required`, `partial-refusal`, `refused`;
  - preset: `zz-2026-01-01` (fictional country `zz`);
  - catalog: `en`.
- `contracts/fixtures/invalid/<contract>.json` -- a list of `{name, input, error}`, covering every error row of the I/O matrix and the `basis` resolver cases (with a `presets` field).
- `contracts/fixtures.lock.json` -- `{path: {contract, version, sha256}}` for every fixture file, hashed over LF-normalised bytes.
- `scripts/contract_fixtures_lock.py` -- rewrites the lock. It adds new files and refuses to change or drop an entry unless the manifest version for that contract is greater than the locked version.
- `engine/tests/__init__.py`, `engine/tests/test_contracts.py` -- unittest only, with no Django import. Tests:
  - every valid fixture round-trips;
  - every invalid fixture raises its exact code;
  - the resolver and legacy-snapshot matrix;
  - codes.py equals codes.json and the manifest equals `CONTRACT_VERSIONS`;
  - the lock matches the files;
  - an AST scan of `engine/**/*.py` (tests excluded) allows only stdlib and `engine` imports.
- `api/test_contract_codes.py` -- a Django `SimpleTestCase` asserting that each copied vocabulary equals its source constant in `api/anonymous_case.py`, `calc/schools.py`, `calc/proof.py` and `api/preview.py`.
- `web/src/contracts/{errors,values,codes,family,basis,result,comparison,presented,preset,catalog,index}.ts` -- TS mirrors of the same parse/dump rules and types. They hold no resolver logic beyond parse, and use `Number.isSafeInteger`.
- `web/src/contracts/contracts.test.ts` -- the same fixtures read via `readFileSync`. Tests:
  - round-trip deep-equal;
  - the exact error code for every invalid case except the resolver-only ones;
  - codes.ts equals codes.json and the versions equal the manifest.

**Acceptance Criteria:**
- Given the committed fixtures, when the Python and web suites run, then every Family, Basis, Result, Comparison, PresentedResult, preset and catalog fixture parses and re-dumps to an equal document in both languages.
- Given a locked fixture is edited without raising its contract version in `manifest.json`, when the engine tests run, then the lock test fails, naming the file and the contract.
- Given a vocabulary code is renamed or removed in `codes.json` relative to the source constants, when `api/test_contract_codes.py` runs, then it fails.
- Given the repository after this story, when `uv run python manage.py makemigrations --check --dry-run` runs, then no changes are detected, and `git diff` touches no `calc/`, `api/` or `web/src/app` file except `api/test_contract_codes.py`.

## Spec Change Log

## Review Triage Log

### 2026-11-16 — Review pass
- verdicts: 40 findings — high 0, medium 15, low 14, false 9, maybe-false 2
- findings:
  - `[maybe-false]` `[defer]` (intent) No test maps a real phase-1 session or SavedCase snapshot into Family or Result. Settle with 8.8's dual-reader round-trip of real stored snapshots. The field-by-field mapping looks representable: id, `same_as` → shared person, deaths → estates 2/3.
  - `[maybe-false]` `[defer]` (intent) The legacy Basis fallback is tested only with synthetic dicts, not real SavedCase rows. This is grouped with the previous row and settled the same way.
  - `[false]` `[reject]` (intent) TS has no resolver. AD-18 wants one resolver, and it lives on the server. The TS side only needs parsing.
  - `[false]` `[reject]` (intent) The version gate may not run. `manage.py test engine` ran 21 tests, and CI's unlabelled run discovers `engine/tests`.
  - `[medium]` `[patch]` (verification-gap) The web `MADHAB_IDS`, `RELATIONSHIP_IDS` and genders are not tied to `codes.json`. Added equality assertions in `contracts.test.ts`.
  - `[false]` `[reject]` (verification-gap) Web skips the `preset_unavailable` fixtures. This is intended (the resolver is server-only), and Python covers those cases.
  - `[medium]` `[patch]` (verification-gap) The lock test never checks the entry's contract or version against the manifest. Grouped with the lock fixes and patched.
  - `[false]` `[reject]` (verification-gap) TS does not verify the lock. The lock is language-neutral and is checked once by the Python suite.
  - `[false]` `[reject]` (verification-gap) The discovery note confirms the tests run. That is not a defect.
  - `[false]` `[reject]` (verification-gap) The resolver has no callers. The story forbids switching consumers.
  - `[false]` `[reject]` (blind) The resolver is Python-only. Same refutation as the intent row above.
  - `[low]` `[reject]` (blind) The TS dumps return copies. The TS parse rejects unknown and missing keys, so a copy of a parsed value is already canonical. Not worth a rewrite.
  - `[medium]` `[patch]` (blind) Python regexes use `$`, which accepts a trailing newline. Switched to fullmatch, with an invalid fixture.
  - `[medium]` `[patch]` (blind) The Python `\d` accepts non-ASCII digits in dates. Switched to `[0-9]`, with an invalid fixture.
  - `[low]` `[reject]` (blind) The integral float `1.0` and duplicate JSON keys are indistinguishable in JS. Inputs come from Python `json.dumps`, which never emits either, and a fix would need a custom JSON parser.
  - `[false]` `[reject]` (blind) The matrix-coverage test is hollow. Deleting any invalid case changes the file hash, so the lock test fails.
  - `[medium]` `[patch]` (blind) Family cross-field rules are missing. Now required: each `died_later` person owns exactly one estate, and an estate heir is alive at that estate. Edge cycles and spouse genders are rejected as fiqh validity, which AD-16 assigns to the engine queries.
  - `[medium]` `[patch]` (blind) Result invariants are missing. Now required: shares plus unallocated sum to 1 per level, layer orders are unique and ascending, and kind `blocked` goes with rule `blocked`.
  - `[medium]` `[patch]` (blind) PresentedResult state is not cross-checked. Now enforced: the state-to-outcome mapping, refused requiring a refusal and null amounts, and unique row persons.
  - `[low]` `[reject]` (blind) Preset citation gaps (dangling or gap_school). The registry gate (AD-17) owns publication checks, and the fix adds guards.
  - `[low]` `[reject]` (blind) Catalog brace parsing is brittle. The 8.5 validator owns the catalog content checks.
  - `[low]` `[reject]` (blind) Basis errors from presented_result lose their path prefix. This is cosmetic, and the error code is still correct.
  - `[medium]` `[patch]` (blind) Lock weaknesses. The test now checks the manifest version, and the script uses the highest locked version per contract.
  - `[low]` `[reject]` (blind) Hygiene: duplicate `ID_RE`, a hand-copied codes file, `stdlib_module_names`. Equality tests guard the copies, and the project requires Python 3.12.
  - `[medium]` `[patch]` (edge) Regex trailing newline and Unicode digits. Same group as the blind rows above.
  - `[low]` `[patch]` (edge) TS `Date.UTC` maps years below 100 to 19xx. A direct correction: use `setUTCFullYear`.
  - `[low]` `[reject]` (edge) TS accepts `1.0`. Same reasoning as the blind float row.
  - `[false]` `[reject]` (edge) `resolve_basis` with a presets map holding a non-School value. The map is built by the shell registry, and no such input was shown to be reachable.
  - `[medium]` `[patch]` (edge) A later-estate heir already dead at that estate is accepted. Patched with the Family rules above.
  - `[medium]` `[patch]` (edge) An orphan `died_later` person is accepted. Patched. Duplicate answers and gifts are rejected as unlikely, and the fix would add guards.
  - `[low]` `[reject]` (edge) Edge cycles and same-gender spouses. Fiqh validity belongs to the AD-16 engine queries.
  - `[low]` `[reject]` (edge) Comparison `differing_persons` is not checked to be a subset of the allocations, and an agreement may carry `selected_school`. Harmless, and the fix adds guards.
  - `[medium]` `[patch]` (edge) Result layers and sums. Same as the blind Result row.
  - `[medium]` `[patch]` (edge) PresentedResult state. Same as the blind PresentedResult row.
  - `[low]` `[reject]` (edge) Direction versus lang. The Locale registry (8.5) owns the lang-to-direction mapping.
  - `[low]` `[reject]` (edge) Catalog unbalanced braces. Same as the blind catalog row.
  - `[low]` `[reject]` (edge) The purity test misses dynamic imports. The 8.4 CI import-graph gate owns full purity enforcement.
  - `[medium]` `[patch]` (edge) A hand-deleted lock entry re-locks freely. The script now compares against the highest locked version per contract.
  - `[medium]` `[patch]` (edge, claim) After one bump, older-locked fixtures can be edited again. Fixed by the same per-contract maximum rule.
  - `[low]` `[reject]` (edge, claim) TS float parity. Same as the blind float row.

## Auto Run Result

Status: done

**Summary:** This story adds the AD-25 versioned shared contracts:
- Family, Basis, Result, Comparison, PresentedResult, preset and catalog are strict parse/dump code in a new stdlib-only `engine/contracts/` package, mirrored in TypeScript in `web/src/contracts/`.
- Both languages round-trip the same shared fixtures under `contracts/`.
- The one AD-18 Basis resolver is `resolve_basis`. The legacy no-basis fallback is `basis_for_snapshot`.
- A meaning change needs a version bump. This is enforced by `contracts/manifest.json`, `contracts/codes.json` and a sha256 fixture lock, which `scripts/contract_fixtures_lock.py` maintains.
- No database fields were added and no consumer was switched.

**Files:**
- `contracts/manifest.json`, `contracts/codes.json`: contract versions and stable code vocabularies.
- `contracts/fixtures/**`, `contracts/fixtures/invalid/*.json`, `contracts/fixtures.lock.json`: shared valid and invalid fixtures and their lock.
- `engine/contracts/{codes,errors,values,family,basis,result,comparison,presented,preset,catalog}.py`: the pure contract parsers and dumpers and the Basis resolver.
- `engine/tests/test_contracts.py`: round-trip, exact error codes, the resolver and legacy matrix, codes and manifest parity, the lock, and the import-purity scan.
- `api/test_contract_codes.py`: pins the shared vocabularies to the app's existing constants.
- `web/src/contracts/*.ts`, `web/src/contracts/contracts.test.ts`: the TS mirrors and the same fixtures, plus the web app's code lists pinned to `codes.json`.
- `scripts/contract_fixtures_lock.py`: rewrites the lock and refuses edits to locked fixtures unless the contract's version has been raised.

**Review:** 40 findings.
- Patched (8 groups):
  - regex fullmatch and ASCII digits;
  - the TS `isoDate` for years below 100;
  - Family rules on later deaths and living heirs;
  - Result sum-to-1, layer order and blocked kind/rule;
  - PresentedResult state consistency;
  - lock test and lock script version rules;
  - web code-list parity.
  These are 15 medium and 1 low, at entry verdict.
- Deferred (1): mapping real phase-1 snapshots, now with story 8.8.
- Rejected: 9 false and 13 low, each with its reason in the Review Triage Log.

**Follow-up review recommended: true.** The patch round added new cross-field invariants after review. These are Result shares plus unallocated summing to exactly 1 per level, and an estate heir having to be alive at that estate. They are checked only against hand-written fixtures. When story 8.2 adapts real engine output (awl, radd, spouse-only, manasikhat layers), these rules may reject legitimate results. Patched counts: high 0, medium 15, low 1.

**Verification:**
- `uv run python manage.py test engine api.test_contract_codes --noinput`: 21 OK.
- `node --import ./src/test/loader.mjs --test src/contracts/contracts.test.ts`: 5 pass.
- Full `npm test`: 482/482 pass.
- `npm run typecheck`: clean.
- `npm run lint`: 0 errors. The 10 warnings were already there, outside `src/contracts`.
- `makemigrations --check --dry-run`: No changes detected.
- `scripts/contract_fixtures_lock.py`: exit 0, lock unchanged.
- The full ~45-minute Django suite was not run. This story touches no existing module, and the driver runs the batch suite.

**Residual risks:**
- JS `JSON.parse` cannot tell `1.0` from `1` or catch duplicate keys, so float rejection is Python-only.
- The TS dumps return copies, which is canonical because the parse is strict.
- Fiqh-level graph validity (cycles, spouse genders) is left to the AD-16 engine queries.
- Catalog brace hygiene is left to the 8.5 validator.

## Design Notes

Fraction golden: `{"numerator":1,"denominator":6}` ↔ `Fraction(1,6)`. Dump always emits reduced fractions, so a parse of `2/4` is rejected rather than normalised. Normalising would hide a meaning change.

Typed proof param example: `{"step":"correction","params":{"base":{"type":"int","value":24},"from":{"type":"code","value":"radd"}}}`.

Basis resolver example: `resolve_basis({"kind":"country","preset_id":"zz","preset_version":"2026-01-01"}, {("zz","2026-01-01"):"hanbali"})` gives `ResolvedBasis(basis=CountryBasis(...), school="hanbali")`. Production has no presets yet, so callers pass `{}`, which keeps Country execution disabled.

## Verification

**Commands:**
- `uv run python manage.py test engine api.test_contract_codes --noinput` -- expected: all pass.
- `cd web; npm test -- src/contracts` (or `node --import ./src/test/loader.mjs --test src/contracts/contracts.test.ts`) -- expected: all pass.
- `cd web; npm run lint; npm run typecheck` -- expected: clean.
- `uv run python manage.py makemigrations --check --dry-run` -- expected: No changes detected.
