# Architecture spine rubric review

Verdict: **CHANGES REQUIRED before feature/epic teams use this as their phase-2 build substrate.**

Date: 2026-11-16. Reviewed the child spine and decision log, the read-only parent AD-1–14, PRD FR-1–45 and addendum, and the specified brownfield files. No skill/workflow was loaded. This is a local document/code review, not runtime or external vendor validation.

Totals: **0 critical, 10 high, 6 medium, 2 low.** No immediate catastrophic exposure is established by this draft review. High findings block a consistent implementation substrate.

## Checklist verdicts

| Check | Result |
| --- | --- |
| 1. Fixes all next-level divergence points | Partial: strong ownership boundaries; missing shared input semantics, migration/rollout contracts, share immutability, public protection and metering semantics. |
| 2. Every Rule enforceable and sufficient | Partial: per-AD assessment below. Some rules conflict internally or lack the mechanism needed to prevent their stated divergence. |
| 3. Deferred cannot permit divergence | Fails: prefill lifecycle and country-header trust are shared contracts parked as assumptions; legacy consumer transition lacks a gate. |
| 4. Brownfield ratification | Mostly accurate; false concurrency claim and demonstrably incompatible snapshot migration. Pure-engine extraction is an intentional change authorized in the log, not existing functionality. |
| 5. FR-1–45 coverage | All mapped nominally; substantive gaps and legitimate feature-level details distinguished below. |
| 6. Preserves inherited ADs | Fails AD-5/6 through AD-20. AD-11's canonical-artifact choice needs explicit scope. Other inherited boundaries can remain unchanged. |
| 7. Initiative operational envelope | Partial: parent covers deployment, environments, edge, basic monitoring, off-host restore gate and host security. Wave activation, new endpoint observability/protection, delivery failures and new-data recovery need decisions. |

## High findings

### H1 — AD-20 snapshot migration breaks inherited blue-green compatibility

**Evidence:** AD-20 bumps `schema_version`, dual-writes `madhab` for one release, then stops. `api/views.py` filters listings to schema 1 (233), rejects other versions on load (274), and requires schema 1 for shares/invites (351, 454). Keeping a JSON key does not make these readers accept a new schema. Country Basis cannot be represented by School/null, and old readers can drop new relationships. Parent AD-5 leaves the old slot live during migration; AD-6 prohibits contraction until no deployed or rollback-eligible image depends on the old shape.

**Impact:** Existing cases disappear/fail during handover or rollback; new Country cases silently become School/compare calculations. This directly contradicts inherited rules and FR-9.

**Suggested fix:** Ship an expand release teaching every session, SavedCase, share, invitation and legacy reader/writer to preserve the new shape before producing it. Gate Country/new-input writes until active and rollback-eligible images support them. Specify a compatible rollback floor and lossless round-trip tests. Contract by verified image eligibility, never merely “the release after”. Include names/backfill and guest sessions.

### H2 — AD-20 invents an existing optimistic edit-version check

**Evidence:** `api/anonymous_case.py:_live` (283–289) compares only case identity. `_save` replaces session data without a revision predicate. `StaleCase` means another Case was started, not that a same-case edit is old. AD-20 says an existing check rejects edits against older versions.

**Impact:** Concurrent tabs, edits and Undo can overwrite newer state despite satisfying that check; returning a version alone does not prevent it.

**Suggested fix:** Decide a monotonic revision and atomic compare-and-swap/serialization on the authoritative guest and saved state, including Django session persistence. Specify conflict responses, refresh behavior and Undo's expected revision. Verify overlapping same-case edits and stale Undo.

### H3 — New family facts have no shared canonical input contract

**Evidence:** AD-15 names `family`; AD-20 names whole-family snapshots. Neither defines predeceased/simultaneous versus later deaths, ancestor branches/depth, lifetime gifts/voluntary bequests, required sect/religion facts, or missing-fact handling. FR-6/16/21 require these. AD-17's `gift_offset` is a rule setting, not a family's gift amounts. Current `anonymous_case` has a fixed relationship map, heirs and later-death layers; `_read_heirs` drops unknown relationships.

**Impact:** Tree, core, persistence and public API teams can build incompatible graphs or compute without necessary facts.

**Suggested fix:** Decide a versioned canonical semantic model shared by engine adapters, edits, snapshots, Undo, public API and prefill: stable person/branch identities, relationship paths, death timing/order, Country eligibility answers, gift/bequest inputs and currency. Assign normalization/validation ownership; missing required facts produce questions/refusals, not silent defaults. Define migration behavior before delegating field syntax.

### H4 — AD-18 does not freeze a shared link's Basis against source edits

**Evidence:** FR-19 requires a link to show the version it was shared with. `api/models.py:ShareLink` holds a SavedCase FK, token and access metadata, with no snapshot/revision. Current share readers use the current SavedCase snapshot. Saying a link “carries” Basis does not choose immutable versus live semantics; the structural seed retains the FK alone.

**Impact:** Changing the source Case's Basis can silently change a previously shared preset version; teams can implement different interpretations.

**Suggested fix:** Require immutable family-plus-Basis at share creation or an immutable Case revision reference. Decide existing-link migration and family-edit semantics; retain visibility, revocation and access checks. Verify source preset updates cannot change the previously shared version.

### H5 — New public surfaces lack a binding security/resource envelope

**Evidence:** Hashed keys, random tokens and an “authenticated and idempotent” webhook do not decide trusted IP derivation, payload/depth/batch limits, pre-engine admission, webhook authentication/replay mechanism, key issuance authorization, CSRF/origin handling or sensitive-data redaction. Settings use `NUM_PROXIES=2`; Deferred accepts `CF-IPCountry` when present without establishing a trusted chain. FR-34 needs spam protection. Parent AD-7/13 secure host/edge, not these application contracts.

**Impact:** Spoofable quotas, unbounded token/Ticket growth and expensive requests can exhaust the sole host; webhook/API teams can implement incompatible protection. Unvalidated country values can also explode aggregate cardinality.

**Suggested fix:** Establish Caddy-only forwarded identity, stripped/rebuilt trusted headers, bounded country allowlist/unknown, body/graph/MCP batch/execution/DB limits, pre-work free/key admission, contact/token-creation abuse controls, admin-only issuance, webhook verification/replay/rotation, endpoint-specific origin/CSRF policy, token entropy/storage policy, and redaction of bodies, keys, names, reply tokens and prefill URLs. Choose mechanisms or assign blocking open questions and launch gates.

### H6 — Persistence and billable metering contracts conflict or remain undefined

**Evidence:** FR-43 says no database write per request; AD-23 requires PostgreSQL writes for quota/usage and AD-22/FR-41 persists prefill state. The log frames the prohibited writes as temporary calculation rows, but the spine does not reconcile the literal PRD conflict. Atomic upserts do not define atomic quota admission, chargeable outcomes, retries, monthly boundaries, shared MCP/API quota or revoked-key fallback.

**Impact:** Teams either violate the no-write claim or omit required durable functions; billing/fair-use counts disagree or overshoot under concurrency.

**Suggested fix:** Record a PRD clarification: core calculation is write-free, bounded metering/admission/prefill writes are allowed. Define atomic admit/count semantics, charged outcomes, UTC billing month, retry behavior, shared API/MCP buckets, quota precedence, revoked-key fallback to free use and counter-store failure behavior. Numeric limits/pricing may remain configuration.

### H7 — Independently releasable waves lack dependency/activation gates

**Evidence:** PRD §6 requires four independent waves. Wave 1 changes edits, rounding, support and metrics, while AD-15/19 bind all consumers to a new core/presentation and Country schemas arrive later. No wave sequencing contract connects extraction, legacy adapters, backfills, static export, catalogs/presets and live/rollback images. Parent AD-4–6 govern deployment mechanics, not these dependencies.

**Impact:** Teams can switch consumers at different times, expose incomplete features or require unreleased later-wave work for wave 1. Known-answer core tests do not prove adapter/presentation parity.

**Suggested fix:** Add a wave matrix of prerequisites, activation flags, migration/backfill owner, compatibility floor, rollback behavior and smoke gates. Require core/adapter/presentation parity before switches, preserved proofs/refusals/later deaths, and preset/Locale publication gates. Reuse inherited deployment/environment mechanisms.

### H8 — New endpoint observability and capacity are unassigned

**Evidence:** Parent AD-8 supplies generic signals/log rotation/outage alerts; AD-23 supplies cleanup commands. Neither assigns API/MCP latency/failure monitoring, webhook rejects/retries, SMTP failures, counter contention, token growth or timer failure alerts. Core corpus parity does not verify NFR-3's 50-Heir p95 or worker headroom under public API/PDF/mail concurrency. The 120-second drain upper bound is not an endpoint execution budget.

**Impact:** Generic readiness stays green while a new capability fails or starves the monolith.

**Suggested fix:** Bind endpoints to redacted structured outcomes and bounded-cardinality latency/error/limit metrics; name probes, operator, thresholds and timer failure reporting. Gate relevant waves on 50-Heir preview/API performance and representative concurrent workloads with both slots running. Decide timeout/overload behavior within the inherited upper bound.

### H9 — Ticket/email consistency and recovery are undecided

**Evidence:** AD-24 commits Ticket/message rows and sends synchronous SMTP; settings bound SMTP to 10 seconds. No ordering/delivery-state/retry rule exists. Inbound “idempotent” has no durable dedupe key or acknowledgement transaction. PostgreSQL and SMTP cannot commit atomically.

**Impact:** Acknowledgements can precede rolled-back Tickets; committed messages can remain unsent; retries can duplicate replies. First-reply metrics can count failed sends.

**Suggested fix:** Decide commit/send ordering and durable delivery status. For example commit pending delivery, attempt bounded send after commit, retain failures for management-command/systemd retry or operator action under AD-11. Document retry/possible duplicate semantics. Atomically persist inbound dedupe and message before acknowledgement; define the first-reply clock.

### H10 — Currency/rounding lacks shared monetary semantics

**Evidence:** AD-19 chooses minor-unit integers/Babel but no rounding mode, excess-decimal policy, currency persistence/default/override, or distinction between numerical remainder and legally unallocated estate. `anonymous_case.clean_estate` accepts two decimals; `calc.models.Deceased.estate` is integer; `preview._single` formats two decimals and separately calculates unallocated fractions. FR-23 requires currency-dependent minor units.

**Impact:** Adapters lose precision or disagree on validation; a rounding line can misleadingly absorb a genuine treasury/no-heir remainder.

**Suggested fix:** Make currency a persisted input with default/override semantics; validate precision by currency, define legacy conversion, rounding mode and signed numerical remainder. Keep legal unallocated/treasury and bequest allocations separate. Test zero-, two- and three-decimal currencies plus genuinely unallocated estate.

## Medium findings

### M1 — Dependency rules contradict the pure-core boundary

The diagram has `ENG -->|loader| DATA` despite AD-15 prohibiting I/O. “Arrows are the only allowed dependency directions” omits needed API-to-engine options and public-API-to-metrics dependencies. AD-15 exposes “one entry point” while AD-16 requires additional engine functions. **Suggested fix:** Put file loading in the shell, pass immutable rules into core, distinguish calculation from validation/query interfaces and scope or complete the allowed-dependency diagram.

### M2 — Invalid Basis silently becomes compare

AD-18 conflates legacy absence with malformed new input, unavailable pinned versions and invalid presets. **Suggested fix:** Restrict fallback to recognized legacy absence, preserving a valid legacy School. Reject invalid new Basis/unknown pinned versions with structured errors; define required/exclusive fields for each kind.

### M3 — Preset eligibility only gates discovery explicitly

“Not offered/selectable” does not expressly prohibit submitting unchecked ids through API, restore or prefill. Schema validity/citation dates alone do not establish how named unresolved research blockers fail the gate. **Suggested fix:** Centralize eligibility checks for listing and execution across consumers; distinguish eligible historical versions from unchecked files, require complete rule checks and explicit blocker resolution, validate paired reviewer fields and audit metadata-only review changes.

### M4 — New-data recovery/retention interaction is unspecified

The parent already requires off-host backup/restore and encrypted future off-host backups; PostgreSQL placement covers new rows broadly. Restore may nevertheless resurrect revoked keys, consumed tokens or deleted Tickets; inputs also require matching preset/catalog artifacts. **Suggested fix:** Extend the existing restore runbook with new-table checks, matching archived artifacts, recovery-point/retention expectations, revocation reconciliation and deletion reapplication. Rehearse before new irreplaceable data is accepted; no additional backup service is implied.

### M5 — Aggregate schema omits required Basis dimensions and event ownership

AD-23 keys events by day/event/Locale/country; FR-44 requires Basis choices by type/preset. First-preview semantics, emission ownership, API/MCP double counting and owner reporting are unspecified. “No per-person rows” also needs separation from deliberately subject-specific IP rate windows and per-key billing. **Suggested fix:** Declare bounded Basis dimensions, authoritative event emission/first-occurrence rules, retry behavior and an admin aggregate view. Use existing Case state for first-preview suppression rather than analytics identities; distinguish retention for abuse subjects, billing and anonymous aggregates.

### M6 — Prefill lifecycle/minimization is deferred despite crossing teams

AD-22 drops names after response yet persists `family` without excluding names. Expiry/first-open deletion live only in Deferred/log assumptions; atomic redemption and prefetch/crawler behavior are undecided. **Suggested fix:** Bind a minimal name-free payload and explicit persistence exception, seven-day expiry policy, atomic consume-plus-guest-creation, retry/failure semantics and whether GET navigation or explicit redemption consumes the token.

## Low findings

### L1 — Historical artifact reproducibility needs a scope statement

The log intentionally chooses no engine stamp and deliberate corrections shown as-is; this review respects that choice. Immutable preset files alone do not reproduce historical PDFs after engine/catalog/reviewer changes. Parent AD-11 demands a choice before canonical PDFs. **Suggested fix:** State phase-2 PDFs are noncanonical draft renderings with current correction/metadata behavior; gate canonical artifacts on immutable render inputs/engine or durable artifacts. Keep version-stamp deferral conditional on that boundary.

### L2 — Capability ownership references overstate coverage

AD-21 governs translations, not FR-8 name persistence; only the ER seed adds a name. Legal-page and WhatsApp integration ownership are implicit. **Suggested fix:** Assign SavedCase name/backfill ownership and legal/WhatsApp integration owners while leaving layout/copy below this altitude. State all parent AD-1–14 remain binding despite the frontmatter/table subset.

## Per-AD Rule audit

| AD | Assessment |
| --- | --- |
| 15 | Strong pure-core boundary and pre-switch corpus gate; H3/H7/M1 prevent it being fully executable. Enforce transitive shell independence, not only a literal Django import ban. |
| 16 | Correct single fiqh authority; missing facts/query contract creates H3/M1 risk. |
| 17 | Correct immutable versioned data choice; execution eligibility needs M3. Research blockers are legitimate data deferrals only behind that gate. |
| 18 | Useful Basis propagation/no persisted share truth; H4/M2/L1 qualify frozen shares, invalid inputs and historical artifacts. |
| 19 | Correct single presentation owner; H10 leaves incompatible money interpretations. |
| 20 | Correct server/full-snapshot direction; H1/H2/H3 invalidate compatibility/concurrency claims and leave representation open. |
| 21 | Appropriate registry/catalog ownership and nonempty-key CI. Shared presentation should explicitly compose Arabic originals and review labels; downstream tests must cover RTL/font rendering. |
| 22 | Useful independent public contract and stateless WSGI boundary; H5/H6/H8/M6 leave security, writes, operation and lifecycle unresolved. Official-client CI does not replace these contracts. |
| 23 | Correct shared counter store, hashing and timers; H5/H6/H8/M5 leave admission, identity, telemetry and event semantics open. |
| 24 | Appropriate in-app store/provider and minimal Case linkage; H5/H9/M4 affect webhook security, delivery and recovery. |

## FR coverage

Mapping an FR is not equivalent to deciding its cross-team contracts. Local UX and numerical implementation details need not be repeated here.

| FRs | Coverage and gaps |
| --- | --- |
| 1–5 | AD-16/20 assign edit/Undo ownership; H2/H3/H7 remain. Gestures, layout and keyboard controls belong in feature/UX specifications. |
| 6 | Rule ownership exists; canonical relationship/death/fact representation missing (H3). |
| 7–9 | SavedCase direction exists; H1/H2/L2 affect compatibility, naming/backfill and concurrency. Direct-open navigation is local work. |
| 10–12 | AD-19 owns meaning/rendering. Result contract must carry agreement/differences, supplied-facts notices and disclaimer. Button placement/estate hint copy remain local. |
| 13 | Central rounding owner chosen; H10 blocks consistent amounts/balances. |
| 14–17 | Core/preset/warning owners chosen; H3/H7/M3 cover facts, release ordering and gates. Worked-example algorithms stay in engine specifications. |
| 18–20 | Citations/version/review labels assigned; H4/M2/M3/L1 qualify preservation and validity. |
| 21–22 | Refusal/go-live direction correct; H3/M3 must prevent missing facts or direct unchecked execution. |
| 23–26 | Presentation/catalog/notices assigned; currency persistence/default/precision missing (H10). |
| 27–30 | Registry/catalog/build gate appropriate. Downstream acceptance must cover Arabic originals, RTL fonts/PDF, Beta placement, static routes, hreflang and sitemap together. |
| 31–33 | Content work can use established translation boundaries. L2 clarifies legal integration; analytics removal must agree with actual privacy copy. |
| 34–37 | Store/mail/delete owners assigned; H5/H9/M4 cover spam, reliable replies and restored deletions. WhatsApp number type can remain configuration. |
| 38–40 | Single core/result and API/MCP contract chosen; H3/H5/H6/H8 affect schema, protection, billing and operation. Tool instructions and localized OpenAPI names need contract acceptance tests. |
| 41 | Token store chosen; H5/M6 leave lifecycle and minimization unresolved. |
| 42–43 | Durable shared store/key hashing chosen; H5/H6 leave consistent admission/revocation/billing unresolved. Numeric pricing/limits can remain configuration. |
| 44 | Privacy-conscious aggregates; M5 leaves required dimensions and emission/reporting ownership open. |
| 45 | Correctly assigned to documents; bilingual moderated test protocol needs no further architecture AD. |

## Brownfield evidence

- `calc/models.py:Calculation.compute` (924 onward) reloads under row lock in an atomic transaction and writes distribution fields. Hanbali is the default. Heir subclasses carry fiqh. Pure extraction is a deliberate logged refactor, not an inaccurate claim that current code is pure.
- `calc/schools.py` has constants/predicates, lazy Django translations and refusals. `calc/proof.py` has lazy translation plus structured versioned proof payloads. Extraction must preserve codes/proofs/refusals while moving labels.
- `api/preview.py` builds temporary ORM rows and rolls back, compares Schools, formats two-decimal amounts and separately computes unallocated fractions. These substantiate the core extraction rationale and H10.
- `api/anonymous_case.py` owns session family state, sanitizes names, caps Heirs at 50 and accepts at most two decimal places. Invalid legacy madhab becomes comparison. `StaleCase` checks identity only (H2).
- `api/heir_rules.py` duplicates School blocking logic, supporting AD-16 consolidation.
- `api/models.py` has schema-1 input snapshots, no SavedCase name and live-FK ShareLinks. New names/revisions/frozen shares require deliberate migration.
- `mawareeth/settings.py` defines ar/en/fr, Brevo SMTP with a 10-second timeout, request/security logging and no explicit shared cache. Per-process throttle concern is consistent with configuration. `NUM_PROXIES=2` requires trusted-edge reconciliation.
- `web/src/i18n/messages.ts` independently declares ar/en/fr, Arabic-only direction and typed relationship/School copy including Hanbali-default notices. Registry/catalog generation correctly targets real drift sources.

## Inherited and Deferred disposition

All parent ADs remain binding. AD-1/2 fix one image/host; AD-3 owns durable rows; AD-4 fixes immutable release manifests, builds and locked artifacts; AD-5/6 fix deployment/migration compatibility; AD-7 fixes Caddy/HTTPS/private networks; AD-8 supplies basic health/logs/alerts; AD-9 gates restore/capacity; AD-10 isolates local/CI/on-demand staging/production; AD-13 fixes secrets/host baseline. These are existing operational decisions, not missing ones. H7/H8/M4 identify feature-specific extensions rather than proposing replacement infrastructure.

AD-20 violates AD-5/6 until H1 is resolved. The child's AD-8 paraphrase overstates the 120-second release/drain bound as an endpoint policy; H8 supplies actual endpoint budgets. AD-11 prohibits background threads and requires durable decisions for long jobs; it does not itself require all work to be synchronous. Phase-2 public API metering is compatible with AD-14's separate private certification/marketplace scope.

Safe deferrals: Ja'fari/non-Muslim future rules, multi-step Undo, measured need for Redis, separate MCP process/ASGI behind an explicit boundary amendment, in-app payments and browser-owned guest cases. Preset research blockers are safe only behind M3's centralized production gate. Pricing/free-limit numbers, language order and WhatsApp number type can remain configuration. Engine-version omission is a deliberate owner choice subject to L1's artifact boundary.

Unsafe shared-contract deferrals: country-header trust (H5), prefill lifecycle (M6) and ungated legacy result transition (H7). The decision log documents intent but does not substitute for enforceable Rules shared by independent teams.
