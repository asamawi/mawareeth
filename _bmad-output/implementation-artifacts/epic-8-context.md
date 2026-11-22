# Epic 8 Context: One calculation core — the same answer everywhere

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Families must see identical shares on screen, in the PDF and in Saved cases, and every phase-1 Saved case must keep opening. This epic builds the phase-2 foundation with unchanged School behaviour: versioned shared domain contracts, a pure in-memory calculation core at full corpus parity, a Case command service with revisions, one presentation layer, and a validated i18n catalog. Later waves (Country law, new Locales, public API) extend it additively.

## Stories

- Story 8.1: Preserve Case meaning through versioned shared contracts
- Story 8.2: Reproduce existing single-estate School answers in memory
- Story 8.3: Preserve successive-death answers and proof inside the core
- Story 8.4: Give every family action one engine decision
- Story 8.5: Keep terms and Locale settings consistent across consumers
- Story 8.6: Produce one presented answer for every renderer
- Story 8.7: Switch existing calculation consumers only after full parity
- Story 8.8: Let every reader open both SavedCase snapshot versions
- Story 8.9: Apply Case changes atomically against one revision
- Story 8.10: Upgrade existing Saved cases without losing their original Basis
- Story 8.11: Prove the foundation meets wave-1 release budgets
- Story 8.12: Purge the empty legacy drafts the import could not convert

## Requirements & Constraints

- Exact answers: shares are exact reduced fractions, never floats or rounded fractions; existing School results, refusals (Ja'fari, Maliki Malikiyya, impossible family) and proofs must not change. No fiqh corrections in this epic.
- Phase-1 and migrated legacy Saved cases, share links, invitations and received views must stay readable throughout deployment; ownership, revocation and expiry rules are unchanged.
- Guest Cases expire 24 hours after last change, enforced on every read/edit; conversion does not extend lifetime.
- Limits: 50 Heirs and two later deaths, enforced server-side in the command service, not in fiqh queries.
- Money: estate is integer minor units, validated with Babel currency precision; allocations round half-up with a signed rounding line summing to the estate, kept separate from legal unallocated/treasury shares. Phase-1 bare-decimal estates convert to currency SAR with explicit true (owner decision).
- Disclaimer is always shown; PDFs are regenerated non-canonical drafts; results are never stored as truth.
- Budgets: engine under 200 ms for a standard family; Share preview p95 under 1 s for 50 Heirs on mid-range phone over 4G; lock waits bounded and included in the budget. Logs never contain names, family data or request bodies.
- Existing 841 no-deceased and 304 no-heirs legacy drafts (1,145 total) are purged by a dry-run-capable command; calculation 2402 is not empty; its duplicated deceased row was removed by hand on 2026-11-19 so it converts. Take a fresh restic backup before the production purge.
- Country execution, Country writes and new Locales/presets stay disabled.

## Technical Decisions

- `engine/` is pure and Django-free: `calculate(family, rule_set) -> Result`, the family queries, and `parse_preset(data) -> RuleSet`. No I/O, clock, global mutable state, ORM or translation imports, directly or transitively; a CI import-graph gate enforces this. Output is codes, Fractions and integer amounts only. Successive deaths (manasikhat) are composed inside the core.
- Switch gate: no consumer moves to the core until the known-answer, School, proof, refusal and later-death corpus passes on core, adapters and presentation. Fixtures are never rewritten to hide a difference. `Calculation.compute` and preview become thin adapters; preview does no temporary DB rows.
- Engine is the sole owner of fiqh: addable relationships, impossible drops/edits, delete-cascade impact, required facts, refusals, share-changing presets. `api/heir_rules.py` and browser eligibility logic stop keeping their own tables.
- Versioned contracts (Family, Basis, Result, Comparison, PresentedResult, preset/catalog) with Python and TypeScript lossless round-trip fixtures; a meaning change needs a version bump. Stable lowercase snake_case codes are never renamed or reused. Family uses stable opaque person ids.
- Basis is exactly `{kind:"compare"}`, `{kind:"school", school}` or `{kind:"country", preset_id, preset_version}`; one shared resolver; Country School is derived. Only a legacy snapshot with no basis falls back via madhab (else compare); malformed input or unavailable pinned version is a typed error.
- `presentation.present(outcome, basis, locale, currency)` is the only producer of PresentedResult: comparison (all four Schools; agreement means identical shares and statuses), labels, notices, rounding, Babel formatting with explicit numbering_system. Consumers (preview, Full results, PDF, legacy templates, `web/src/interview/format.ts`) render its strings with no own arithmetic or Intl formatting.
- Text ownership: fiqh terms, Basis/School labels, refusal reasons and proof templates in `i18n/terms/<locale>.json` as `{text, review}`; locale registry in `i18n/locales.json`; general UI copy stays in `messages.ts` and `.po`. One validator/generator fails CI on missing/empty keys or placeholder mismatch and generates the typed Next.js module; a PDF glyph check gates publication. Do not mark unreviewed text reviewed.
- Case command service: all input mutations take `expected_revision`, apply atomically, bump one monotonic revision and return the whole Case; mismatch returns `{error:"conflict", case}`. PostgreSQL-backed locking and compare-and-swap, not per-worker mutexes. Restore keeps stable ids and bumps the current revision. Previews carry their computed revision; stale ones are discarded. Lock waits time out within the AD-27 budget with a retryable outcome.
- Snapshot conversion is expand, switch, contract: release N readers accept schema 1 and 2 and writers still emit 1; release N+1 writes schema 2 (inputs only) and backfills; schema-1 readers are removed only when rollback eligibility permits. A reader/writer matrix across active and rollback images is a release gate. Migrations are additive: revision column in 8.9, name column in 8.10.
- Names default to "Estate of {Deceased name or label}, {date}" using the original save date, up to 100 characters, any script.

## UX & Interaction Patterns

- Offline edits are blocked while the family and last preview remain visible; no client edit queue.
- Refusals show a localized reason and no shares. Names, fractions and amounts are bidi-isolated; each relationship shows a translated segment plus an Arabic-original segment with language/direction metadata.
- Failures preserve inputs and allow retry; stale numbers must never appear as a new answer.

## Cross-Story Dependencies

- 8.1 contracts underpin everything; 8.2 and 8.3 build the core, 8.4 adds queries and the purity gate, 8.5 the catalog, 8.6 presentation (needs 8.2-8.5).
- 8.7 (consumer switch) requires full parity across 8.2-8.6 and precedes the rest of the epic's switch-dependent work.
- 8.8 (dual readers) precedes 8.9 (revision column, command service), which precedes 8.10 (writer switch, name column, backfill, working-copy CAS).
- 8.11 gates release on everything above; 8.12 is an independent cleanup relying on the `api.0004` import evidence.
- Later epics consume these contracts and the command boundary (bulk add, tree drops, redeem, Country presets); legacy page retirement is decided in Epic 12; Country writes wait on every image reading schema 2.
