---
title: 'Story 2.4: Full Recursive Manasikhat Calculation'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: '5218aa911fd69beb5fd1b9dfae58ba672f68beee'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The engine computes one deceased at a time. When a heir dies before the estate is divided (manasikhat), nothing carries that heir's share into a second calculation, so such cases cannot be computed at all.

**Approach:** A heir who died later gets a linked child calculation for their own death. A new engine entry point computes each layer in death order with the existing `compute()`, carries exact fractions forward, sums them per living person, and returns one combined result plus a version 2 proof. The work covers the engine and its tests only.

## Boundaries & Constraints

**Always:**
- A case has at most 3 deceased: the first one and up to two later deaths. Each later death has a distinct death order of 2 or 3.
- A later deceased's estate is exactly the sum of what that person inherited in every earlier layer, as a `Fraction` of the first estate. Their own stored `estate` is ignored. Rounded amounts are never carried between layers.
- One school applies to every layer, and it must be passed explicitly: `compute_manasikhat(calc, madhab)` has no default. Jafari stays `school_not_supported`. A refusal in any layer refuses the whole run with that layer's reason.
- A person who appears in several layers is linked explicitly: a heir row in a later layer points to the heir row of the same person in an earlier layer. Their shares are summed under the earliest row's pk.
- Every refusal specific to this feature uses one new reason, `manasikhat_unsupported`, with ar/en/fr text. That covers: more than 3 deceased, duplicate or invalid death orders, a heir who died at or before the death of the layer's deceased, a broken or cyclic person link, a person linked twice within one layer, and calling plain `compute()` on a case that has a later death.
- The result is deterministic. Running twice, or creating heirs in a different order, gives an identical result and proof.
- A single-layer `compute()` and its version 1 proof stay byte-for-byte unchanged.

**Ask First:** Any change to the version 1 proof, to `compute()`'s signature or behaviour for single-layer cases, or to the preview contract. Any fiqh rule specific to manasikhat that the existing per-layer engine does not already apply.

**Never:** API, contract, preview or web changes. Supporting Jafari, simultaneous or unknown-order deaths (gharqa), or a later deceased's own separate property. Running manasikhat from the legacy results pages. Pushing this work.

## I/O & Edge-Case Matrix

Final fractions are of the first estate and summed per living person. Later deceased are not listed.

| Scenario | Layers | Expected |
|----------|--------|----------|
| 2 layers, any Sunni school | (1) male: wife W, sons S1, S2. (2) S1 dies: mother W, brother S2 | W 13/48, S2 35/48; base 48 |
| 3 layers, any Sunni school | The same, then (3) W dies: son S2, her mother M (new person) | S2 275/288, M 13/288; base 288 |
| School differs in a layer, Hanbali | (1) female: husband H, sons S1, S2. (2) S1 dies: father H, PGM (new), brother S2 | H 9/16, PGM 1/16, S2 6/16. Layer 2 proof names `grandmother_inherits_with_her_son` |
| Same, Hanafi, Maliki or Shafi'i | Same | H 5/8, PGM 0, S2 3/8. Layer 2 proof names `father_blocks_his_mother` |
| A layer is refused | Maliki, and a layer is the Malikiyya family | `UnsupportedCase('malikiyya_disputed')` |
| Jafari | Any layered case | `school_not_supported` |
| Out of bounds | 4 deceased; two deaths with order 2; a person who died 2nd listed as heir in layer 3; a cyclic link | `manasikhat_unsupported` |
| Plain compute | `compute()` on a first case that has a later death | `manasikhat_unsupported` |

</frozen-after-approval>

## Code Map

- `calc/models.py:83` `Person`, `:239` `Marriage`, `:256` `Calculation`, `:937` `Deceased` (int `estate`, nullable `calc`), `:943` `Heir`. There are no fields today for death order, layer links or person identity. The calc FKs use `NON_POLYMORPHIC_CASCADE`, and the cascade workaround at `:61-81` must also cover new links.
- `calc/models.py:889` `compute(madhab=DEFAULT)` returns `{heir_pk: Fraction of that layer's estate}` for every heir, zero shares included. It runs in one `atomic` block with `select_for_update`, writes heir rows, and leaves the proof on `self.proof`. It reloads heirs from the DB in `get_quotes()` `:380`. The money conversion is at `:801-821`.
- `calc/schools.py:20-49` holds the reason constants, `REASONS`, and `UnsupportedCase` (`.message` reads `REASONS`). `:123` is `check_school`. `api/tests.py:1429` requires the preview contract to equal `schools.REASONS` plus `invalid_family`.
- `calc/proof.py:174` `build(madhab, heirs, steps)` returns `{version: 1, madhab, school_rules, heirs, steps}`. Fractions there are `{numerator, denominator}`.
- `calc/migrations/0027_maternal_grandmother.py` is the latest migration.
- `locale/{ar,en,fr}/LC_MESSAGES/django.po` holds the reason texts (around `:2305/2355/2425`). The `.mo` files are built by script, because `msgfmt` is missing.
- `calc/tests.py:1485` `build_case(sex, heir_types, estate)` returns `(calc, heirs)`. `:1999` `run`, `:2274` `proof_run`, `:1793` the invariants, `:2562-2692` the proof tests.

## Tasks & Acceptance

**Execution:**
- [x] `calc/models.py`, `calc/migrations/0028_manasikhat.py` -- add nullable `Calculation.parent` (cascades, so deleting the first case deletes every layer), `Deceased.heir` (the earlier-layer heir row who died later), `Deceased.death_order` (default 1) and `Heir.same_person` (an earlier-layer heir row). In `compute()`, refuse with `manasikhat_unsupported` when any heir of the case has a later death.
- [x] `calc/schools.py` -- add `MANASIKHAT_UNSUPPORTED` in a separate `LAYERED_REASONS` table, which the preview can never produce, and have `UnsupportedCase.message` read both tables.
- [x] `calc/manasikhat.py` (new) -- `compute_manasikhat(calc, madhab) -> (final, proof)`. Validate the bounds before computing anything. Run every layer in death order inside one transaction, each through `compute(madhab)`. Return `final` as `{earliest heir pk: Fraction}` for living persons, plus the version 2 proof.
- [x] `calc/proof.py` -- add `build_layered(madhab, layers, final, identities)`, which returns `{version: 2, madhab, layers: [{order, deceased, heir, estate, proof}], people: [{row, person}], final: [{heir, fraction}], base}`. Each layer's `heir` is the deceased person's earliest-row pk (null for order 1); `people` lists identity aliases sorted by row pk. Each layer's `proof` is that layer's unchanged version 1 proof, and `base` is the least common multiple of the final denominators.
- [x] `locale/{ar,en,fr}/LC_MESSAGES/django.po` + `.mo` -- the `manasikhat_unsupported` text.
- [x] `calc/tests.py` -- add a layered-case builder on top of `build_case`, one test per matrix row under each school it names, and determinism and order-independence tests. Add conservation (living shares plus any unallocated remainder equal 1), a cascade-delete test, and a three-layer run under 1s.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- add one entry for manasikhat input in the API, contracts and web interview, and one for qualified review of the matrix and the Arabic and French text.

**Acceptance Criteria:**
- Given any single-layer family from `families()`, when computed under each Sunni school, then the result and the version 1 proof equal what they were before this story.
- Given a supported layered case, when computed twice, then the final fractions and the version 2 proof are identical, and the version 2 proof's base turns every final fraction into an integer.
- Given a layered case, when it is refused, then no heir row is left changed by the run.

## Design Notes

Each layer reuses `compute()` unchanged, so every school rule, refusal and version 1 proof applies per layer for free. Only the carrying and the summing are new. A child layer's stored amounts are relative to its ignored `estate`, so they mean nothing. Only the returned fractions count, and persisting layered results is left for the API story.

Identity: resolve each heir row by following `same_person` to its earliest row. The later deceased's estate equals the sum of `layer_fraction × layer_estate` over every earlier row of that person.

## Verification

**Commands:**
- `DATABASE_URL='sqlite://:memory:' DJANGO_ENV=test .venv/Scripts/python.exe manage.py test calc api` -- expected: all pass.
- `.venv/Scripts/python.exe manage.py makemigrations --check --dry-run` -- expected: no changes.

**Manual checks:**
- A qualified reviewer checks the matrix fractions and the ar/fr texts of `manasikhat_unsupported`.

## Suggested Review Order

**Carrying shares across deaths**

- Start here: every layer runs through the unchanged `compute()`, in death order, inside one transaction.
  [`manasikhat.py:10`](../../calc/manasikhat.py#L10)

- A later deceased's estate is everything that person inherited from earlier layers, as an exact fraction.
  [`manasikhat.py:97`](../../calc/manasikhat.py#L97)

- Person identity follows `same_person` to the earliest row, refusing cycles, forward links and sex mismatches.
  [`manasikhat.py:47`](../../calc/manasikhat.py#L47)

**Bounds and refusals**

- Death orders must be exactly 1..n with n ≤ 3, and the first death must be the root.
  [`manasikhat.py:38`](../../calc/manasikhat.py#L38)

- A later deceased must be an earlier heir of the same sex, and no dead person inherits afterwards.
  [`manasikhat.py:77`](../../calc/manasikhat.py#L77)

- Plain `compute()` refuses the root and every child layer of a layered case.
  [`models.py:915`](../../calc/models.py#L915)

- The new refusal code is kept out of the preview contract's reason table.
  [`schools.py:43`](../../calc/schools.py#L43)

**Data model and proof**

- Layers hang off the first case and cascade with it; a death points at the earlier heir row.
  [`models.py:258`](../../calc/models.py#L258)

- Frees the inherited `Person.heir` accessor so `Deceased.heir` can exist; nothing used the old name.
  [`models.py:954`](../../calc/models.py#L954)

- Version 2 proof: unchanged version 1 proofs per layer, identity aliases, funding heir, combined base.
  [`proof.py:217`](../../calc/proof.py#L217)

- Additive migration; existing rows default to a single first death.
  [`0028_manasikhat.py:1`](../../calc/migrations/0028_manasikhat.py#L1)

**Tests**

- The matrix rows under every Sunni school, with determinism and the version 2 base.
  [`tests.py:3059`](../../calc/tests.py#L3059)

- Layered fixture builder with explicit identity links.
  [`tests.py:3031`](../../calc/tests.py#L3031)

- Sibling layers and the school difference in layer 2; the qualified reviewer should read these.
  [`tests.py:3089`](../../calc/tests.py#L3089)

- Every topology refusal leaves the heir rows unchanged.
  [`tests.py:3131`](../../calc/tests.py#L3131)
