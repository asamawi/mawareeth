# Adversarial divergence review

Verdict: NOT SAFE TO DECOMPOSE — the spine constrains deployment and dependency direction, but leaves shared domain contracts and mutation ownership open enough for individually compliant epics to produce incompatible systems.

## Scope and method

Reviewed the 2026-11-16 architecture spine, the inherited 2026-09-02 spine (including its AD-1 addendum), and the 2026-11-16 PRD. No skills or workflows were invoked. This is a contract-divergence attack, not a code audit or a review of the underlying inheritance law.

Each finding constructs two plausible units one level below the initiative. Both can follow AD-15–AD-24 and inherited AD-1–AD-14 literally, yet disagree at integration. Names, example fields, and payloads below are counterexamples, not claims about existing implementation. A common module name or shared function does not establish its schema, lifecycle, or accountable owner. All examples assume the prescribed monolith, PostgreSQL persistence, ORM mutations, immutable release artifacts, compatible database evolution, and production gates; changing infrastructure is unnecessary to trigger them.

Severity ranks integration consequences: Critical means incompatible calculation identity or loss of authoritative state; High means a shared capability cannot integrate reliably or returns inconsistent meaning; Medium means measurement or delivery contracts diverge. Ranking within each tier reflects breadth and likely implementation order. Proposed AD text is deliberately short; referenced schemas must be committed contracts, not prose deferred independently to each epic.

## Critical

### 1. Family-tree editing × Country presets/public API: no canonical family graph

**Anchors:** AD-15 immutable `family`; AD-16 engine-owned relationship validity; AD-20 whole-family snapshots; PRD FR-2, FR-3, FR-6, FR-16, FR-38 and Glossary.

**Compliant pair:** Tree editing represents every node by a stable person ID with `parent_id` and a predeceased flag. Country presets/public API represent relatives by root-relative relationship codes and counts, with predeceased branches nested under each relationship. Both use immutable engine inputs and engine-provided validity decisions; neither AD defines the input object or requires a particular topology. Each can build an engine adapter without duplicating fiqh.

**Collision:** Two grandchildren through different predeceased children collapse into the same relationship/count, so branch-specific bequest and gift offsets cannot round-trip. Later-death references and delete cascades cannot identify the same people across API, tree, undo and saved snapshots.

**Proposed AD — tighten AD-15/20:** The engine-contract owner shall publish one versioned canonical Family schema covering stable person/death IDs, lineage edges, root-relative relationship codes, death ordering, eligibility facts, gifts, estates and later-death links; all snapshot and transport adapters must preserve its identity and information. Tree mutations, save/load, restore and public-prefill conversion must pass shared lossless round-trip fixtures, including distinct predeceased branches and successive deaths.

### 2. Tree editing × named saved cases: two authoritative working copies

**Anchors:** AD-20 first two bullets; Structural Seed `api`; PRD FR-7–FR-9.

**Compliant pair:** Tree editing edits the server-side session family and returns its session version, copying it to SavedCase on Save. Named cases treats a saved Case's snapshot as the live family and updates it directly after opening, using a SavedCase version. Both keep family exclusively on the server and use stale-version checks for their edits; AD-20 does not define the transition between its two stores or version namespaces.

**Collision:** Reopening a named case can overwrite newer session edits, or Save can replace newer SavedCase edits with an older session copy. Each request has passed the version check against its own authoritative copy.

**Proposed AD — tighten AD-20:** The `api` Case-state owner shall define one active Case identity and revision namespace, explicitly specifying whether saved-case editing is direct or uses a working copy and when ownership transfers. Open, save, save-as, rename, start-new and guest-to-account transitions must use that protocol, with atomic revision checks wherever a snapshot can replace authoritative state.

### 3. Basis selection × Undo: family-only revision checks do not protect calculation context

**Anchors:** AD-18 explicit preset-version changes; AD-20 edit/restore rules; PRD FR-5, FR-15, FR-19, FR-23.

**Compliant pair:** Tree editing increments the case version for family edits and sends a prior whole-family snapshot for Undo. Country-law/results stores Basis and currency on separate server-side fields and changes them without incrementing the family version, because those actions are not among AD-20's enumerated edits. Both honor explicit Basis changes and family stale-version rejection.

**Collision:** A delayed family response replaces a newer Basis selection in the client, or a save serializes family and Basis from different revisions. Undo implementations also disagree whether restoring a family rolls back its accompanying Basis.

**Proposed AD — tighten AD-18/20:** All mutations of calculation inputs, including family, estate, currency and Basis, shall pass one Case command boundary and increment the same revision atomically; responses and calculations identify that revision. Undo shall restore only its explicitly defined field set against the current expected revision, preserving other fields and rejecting cross-Case, stale or unauthorized snapshots.

### 4. Country presets × public API: Basis is a field sketch, not a discriminated contract

**Anchors:** AD-18 optional fields and invalid-to-compare fallback; Consistency Conventions Basis; AD-22 versioned contract.

**Compliant pair:** Country presets accepts `{kind: country, preset_id: eg, preset_version: …, school: hanafi}` as a country Basis with an informational school. Public API treats that combination as invalid and therefore normalizes it to `compare`, exactly as AD-18 permits. They can also disagree about missing country versions, unknown dates, and whether a country Basis's School is authoritative or derived.

**Collision:** A valid saved or prefilled Country case silently becomes compare mode through another consumer; serialized objects have the listed fields yet imply different rules.

**Proposed AD — tighten AD-18:** A single domain-contract owner shall publish a discriminated Basis schema with required and forbidden fields per kind, canonical serialization and one shared resolver for pinned preset versions and derived default Schools. Restrict invalid-to-compare normalization to explicitly identified legacy migrations; malformed current inputs and unavailable pinned versions must return typed errors without substituting a different Basis.

### 5. Results clarity × public API/PDF: compare-all-four has no result envelope

**Anchors:** AD-15 shell calls `calculate` four times; AD-19 `Result + basis` presentation signature; refusal convention; PRD FR-10, FR-15, FR-38–FR-40.

**Compliant pair:** Results clarity builds a School-keyed map and asks for a School before exposing one share table when Schools differ. Public API builds four presented results and supplies a `differences` list; PDF accepts one `Result`. Each calculation uses the same engine and each single result uses the same presentation layer. The spine never types the composition, equality test or unresolved-choice state.

**Collision:** A compare Basis cannot be passed to the single-result renderer unambiguously. A refusal in one School can erase valid results in another implementation, and equality can mean equal fractions only or equal statuses/proofs as well; the same family gets different agreement banners and School prompts.

**Proposed AD — tighten AD-15/19:** One shared calculation orchestrator shall own a versioned comparison envelope containing ordered per-School outcomes, per-person exact shares/statuses, agreement/difference semantics and an explicit selection-required state, including partial refusals. Web, PDF, internal API, public API and MCP must consume that envelope through the same presenter, with fixtures for agreement, disagreement and mixed refusal.

## High

### 6. Engine extraction × results/PDF: `Result` lacks identity, proof and money-stage semantics

**Anchors:** AD-15 codes/Fractions/integer amounts; AD-19 presented result; PRD FR-16, FR-18, FR-38; deferred layered manasikhat proof.

**Compliant pair:** Engine extraction emits positional heir shares relative to each death's distributable residue and proof codes with positional parameters. Results/PDF expects stable-person shares relative to the original estate and proof steps linked to beneficiary IDs, including a separate bequest allocation. Neither reimplements fiqh or formats inside the engine; both obey the specified primitive types.

**Collision:** A fraction such as `1/2` is applied to different bases; reordered heirs receive the wrong proof or amount. Obligatory-bequest recipients and later-death carry-forwards cannot be rendered consistently even without implementing the deferred elaborate proof UI.

**Proposed AD — tighten AD-15/19:** The engine-contract owner shall define Result and proof-step schemas with stable beneficiary/death IDs, allocation kinds, explicit fraction denominators/bases, estate stages, exclusion statuses, proof parameters and rule/citation references. Presentation must derive every displayed amount and citation from these fields, with shared fixtures for bequest-plus-residue and successive deaths.

### 7. Results clarity × Country localisation: `presentation` has consumers but no accountable owner

**Anchors:** AD-19; Capability map assigns FR-10–FR-13 and FR-23–FR-26 to `presentation`; Structural Seed.

**Compliant pair:** Results clarity defines `present(result, basis, locale, currency)` returning a labeled table. Country localisation extends the same layer with notice, review-state and formatting objects, using a different argument/value representation. Both place all semantic formatting in one presentation package and all consumers call it; nothing allocates contract authority between these epics.

**Collision:** Parallel changes to the common interface are individually correct but unmergeable without redesign; UI and PDF build against different versions of the single shared object.

**Proposed AD — tighten AD-19:** Assign one presentation-contract owner before decomposition, responsible for the callable interface and versioned PresentedResult schema, including comparison state, proof, notices, review flags, raw values and formatted fields. Every consumer and contributor must target that contract, and changes require coordinated compatibility fixtures rather than consumer-specific extensions that alter meaning.

### 8. Locales × PDF/results: one catalog per Locale still permits incompatible formats

**Anchors:** AD-21 catalog, registry and CI gate; PRD FR-28–FR-30, FR-32–FR-33.

**Compliant pair:** Locales chooses flat JSON string values, including interpolated proof templates; PDF/results expects records containing translated text, Arabic original and typed template parameters. Both have one file per Locale keyed by stable codes, one registry, runtime Django reads, typed Next.js generation and complete nonempty keys.

**Collision:** Presence checks pass while runtime interpolation and code generation fail. Arabic originals, ordinal labels and proof pluralization are assembled differently. Registry `digit_system` values may also mean Babel numbering systems to one consumer and custom digit substitution to another.

**Proposed AD — tighten AD-21:** The i18n owner shall publish exact catalog and registry paths and schemas, including value types, Arabic-original references, typed placeholders/plural rules, Locale-to-Babel mapping and numbering-system semantics. One validator and generator must enforce schema and placeholder parity as well as key completeness for all consumers.

### 9. Country presets × engine extraction: the loader boundary is unspecified

**Anchors:** AD-15 no engine I/O; AD-17 schema/loader at startup; diagram engine-to-data loader edge; Structural Seed.

**Compliant pair:** Country presets puts filesystem discovery and environment gating in a shell startup loader, returning frozen rule objects. Engine extraction provides a pure loader/parser for already-read TOML data and expects callers to resolve built-in Schools and country defaults. Both keep `calculate` free of I/O and validate presets at startup, but use different resolved rule-set representations and own different halves of resolution.

**Collision:** The API cannot tell whether it should supply parsed settings, a School plus overrides, or a fully resolved rule set; defaults and schema versions are interpreted twice or omitted.

**Proposed AD — tighten AD-15/17:** Preset-contract ownership shall cover the serialized schema and its conversion to a single immutable resolved RuleSet type, with all fallback/default semantics fixed there. Filesystem discovery and environment policy belong to the shell; parsing/resolution is pure, and every calculation receives the same resolved type rather than a path or unresolved reference.

### 10. Country presets × public discovery: “latest”, “live” and historical resolution diverge

**Anchors:** AD-17 immutable versions/go-live; AD-18 pinned versions; AD-22 live-list CI gate; PRD FR-14, FR-19, FR-22, FR-39.

**Compliant pair:** Preset selection lists the newest checked version per country. Public API lists every checked version as live, or chooses by greatest effective date including future dates. Both agree with their engine-provided lists and pass the OpenAPI comparison gate; both retain old files for pinned cases.

**Collision:** The API's default differs from the browser's, warnings offer different presets, and “newer available” has different meanings. The existing list-equality check cannot settle which list was intended.

**Proposed AD — tighten AD-17/22:** One shell registry shall define current selectable versions, historical resolvable versions, future-effective eligibility and environment-specific publication status, with a deterministic current-version policy. UI selection, warnings, API/MCP discovery and OpenAPI generation must use that registry while pinned inputs resolve by exact version without automatic advancement.

### 11. Country versioning × named cases/share links: snapshot versus live-reference sharing

**Anchors:** AD-18 Basis everywhere and explicit version switching; ER SavedCase-to-ShareLink; PRD FR-19.

**Compliant pair:** Named cases updates a SavedCase's family and Basis in place. Sharing stores the Basis pinned when shared but resolves family through the SavedCase foreign key; another implementation captures the entire family at sharing time. Both transmit a pinned Basis and recompute rather than persist shares.

**Collision:** The same link can mean an old country version applied to a newly edited family, or an immutable shared calculation. The ER relation does not choose the link's semantic identity.

**Proposed AD — tighten AD-18:** Define ShareLink as either a frozen calculation-input snapshot or an explicitly live view; for FR-19 adopt a frozen canonical snapshot of family, estates, currency and Basis with its schema version. SavedCase edits and Basis switches shall not mutate existing shared snapshots, and ownership/revocation remains separate from their immutable calculation content.

### 12. Snapshot migration × release/rollback: compatibility lifetime and representability are unbound

**Anchors:** inherited AD-5/6; AD-20 one-release dual-write and `madhab` null for Country; PRD FR-9, waves 1–2.

**Compliant pair:** Migration retains legacy and new readers until rollback-eligible images no longer depend on old fields, then contracts, following inherited AD-6 even if that exceeds AD-20's nominal release cadence. Country-law delivery waits until the rollback image can preserve and read `basis`, then enables Country writes; another team regards storage read compatibility as sufficient while its older UI understands only `madhab`. The parent does not define semantic-read compatibility, and the child does not specify how an old School-only slot can represent a Country calculation.

**Collision:** Rollback can read the JSON yet present compare/School for a country-pinned Case, or teams block each other's wave because their meanings of “read every stored Case” differ. Strict calendar-based contraction that actually breaks a rollback reader would already violate AD-6; the hole is the missing semantic contract and activation gate, not permission to break it.

**Proposed AD — tighten AD-20:** Snapshot compatibility means preserving and correctly interpreting every supported calculation input, not merely parsing the document; publish and test a reader/writer matrix across active and rollback-eligible images for sessions, SavedCases, shares and tokens. Enable Country writes only after eligible readers support them or explicitly refuse unsupported editing without rewriting inputs, and end legacy dual-writing only when the matrix permits contraction rather than after a fixed number of releases.

### 13. Public API × tree editing: prefill redemption has no transfer transaction

**Anchors:** AD-22 random single-purpose PostgreSQL token; AD-20 server Case; AD-23 cleanup; PRD FR-41.

**Compliant pair:** Public API owns token consumption/deletion; Interview owns guest creation and existing-session behavior. One deletes the token after reading and asks the Interview endpoint to create a guest Case; another creates the guest before a separate token deletion. Both implement first-open deletion and server persistence in the normal successful flow; no shared transaction or retry rule is specified.

**Collision:** Concurrent opens create two guest Cases, or a failed handoff loses the only input snapshot. A returning guest may have their working Case overwritten because neither epic owns the replacement policy.

**Proposed AD — tighten AD-22/20:** Token redemption shall use a single Case-service operation that atomically claims an unexpired token, creates the guest snapshot and consumes its payload, with defined concurrent/retry outcomes. Specify how redemption selects a new active Case without silently replacing an existing unsaved Case, and make expiry, schema conversion and redemption share the same contract.

### 14. Support/API keys × metrics: duplicate credential and usage authorities

**Anchors:** AD-23 shared counters, hashing/revocation; AD-24 Ticket workflow; Structural Seed puts keys in `public_api` and usage in `metrics`; PRD FR-43.

**Compliant pair:** Support's API-access workflow adds a hashed key/quota record attached to a Ticket and an admin issuance action. Public API adds its own hashed credential and revocation model with metrics counters. Both use PostgreSQL, public AGPL code, immediate revocation checks and no automatic Case copying; no AD makes either credential model authoritative or defines a handoff.

**Collision:** The owner changes the Ticket-side quota while request admission reads the public-api quota; issuance, revocation and invoice totals refer to different keys. No prohibited private pricing subsystem is required for this failure.

**Proposed AD — tighten AD-23/24:** `public_api` shall own the sole API credential, quota and revocation lifecycle, with `metrics` owning counters keyed by that credential's stable ID; support may invoke that lifecycle through an explicit service and optional Ticket reference only. Admin issuance, quota changes, revocation and usage display must use those same records and authorization rules.

### 15. Fair-use enforcement × usage metering: atomic increments do not define atomic admission

**Anchors:** AD-23 atomic upserts; AD-22 shared API/MCP functions; PRD FR-42–FR-43.

**Compliant pair:** Fair use reads the shared count, admits a request and atomically increments afterward. Metering increments before calculation and counts both API view and MCP wrapper invocations, or counts successful calculations only. Each upsert is atomic and durable and each rate-limit decision uses PostgreSQL; the AD never fixes check-and-consume atomicity, the counted unit, or the effect of failures.

**Collision:** Concurrent requests exceed quota; MCP is billed twice; retries, invalid families and refusals consume different units. A revoked key's fallback to free use is also subject to different wrapper policies.

**Proposed AD — tighten AD-23:** One admission service shall atomically check and consume the applicable IP/key allowance exactly once per external invocation, defining endpoint coverage, trusted subject derivation, window boundaries, quota-change/revocation behavior and failure policy. Publish which outcomes count toward billable monthly usage and ensure API and MCP wrappers cannot meter the same invocation twice.

### 16. Currency selection × rounding/results: defaults have no persisted provenance

**Anchors:** AD-19 rounding and Babel; Money convention; PRD FR-13, FR-23–FR-24.

**Compliant pair:** Localisation recomputes an unset currency from the current Locale or Country preset every render. Saved-case/results materializes the resolved currency on first render and retains it after Locale/Basis changes. Both follow “defaults from Country law, or else Locale” and use the same presentation rounding function.

**Collision:** Reopening a case or following a prefill link changes its estate currency in one implementation; another retains the old default as though explicitly selected. Presenters can also choose half-even versus half-up rounding and different residual scope for bequests/later deaths while respecting ISO minor units and a separate remainder line.

**Proposed AD — tighten AD-18/19:** Define and persist estate currency plus whether it was explicitly chosen, with one default-resolution and Basis/Locale-change policy; estate input must use canonical integer minor units with specified excess-precision validation. Presentation shall specify the rounding mode and residual scope/order for each estate stage and compare result, tested with shared tie, zero-decimal, three-decimal and successive-death fixtures.

### 17. Country presets × content review: citations and Beta state lack a common evidence contract

**Anchors:** AD-17 citation map and mutable reviewer fields; AD-19 citations/Beta; AD-21 codes-only presets; PRD FR-18, FR-20, FR-22, FR-33.

**Compliant pair:** Presets treats `citations[rule_key].article` as a string identifier, with checked dates evidencing the owner's statutory check. Presentation/content expects a statute reference plus article and proof-step mapping, and uses reviewer metadata to decide whether to remove Beta. Both keep translated display text outside preset files and can validate complete citations; the shape of `article`, proof association and qualified-versus-owner review are unspecified.

**Collision:** An article number cannot identify which of Egypt's two laws applies; proof fallback versus statutory citation cannot be rendered consistently. Owner checks can be mistaken for qualified sign-off, and an old pinned preset's permitted metadata edit changes displayed Beta state without a defined review-history rule.

**Proposed AD — tighten AD-17/19/21:** Define a citation/evidence schema with stable statute IDs, article locators, explicit School-gap references and proof-rule associations, distinguishing owner statutory checks from qualified scholarly sign-off and translation review. One registry shall resolve publication and Beta state for every consumer, recording reviewer changes with provenance and specifying whether historical displays use current or captured review metadata.

## Medium

### 18. Support × metrics: first reply is not one agreed event

**Anchors:** AD-23 aggregate counters; AD-24 webhook idempotency; PRD FR-35, FR-44, SM-5.

**Compliant pair:** Support records a first reply when the admin submits a message; metrics counts when SMTP accepts it, or when the authenticated inbound webhook receives a reply. Each uses atomic aggregates and stores no person IDs in those aggregates; webhook idempotency does not cover admin sends or the domain-to-counter handoff.

**Collision:** Failed sends and resubmissions distort first-reply counts. Locale/country can be the original visitor's context or the replying operator's context; “two business days” has no agreed timezone/calendar or denominator.

**Proposed AD — tighten AD-23/24:** Support shall own a defined first-successful-owner-reply transition and its timestamp, atomically emitting the aggregate increment once using the Ticket's captured reporting dimensions; automatic acknowledgements and visitor replies do not qualify. Specify the SM-5 cohort, business-day calendar/timezone and reporting calculation, with per-Ticket timing retained only within the existing retention policy.

### 19. Interview/results × metrics: aggregates cannot define their own counting semantics

**Anchors:** AD-23 day × event × Locale × country; PRD FR-44, SM-2–SM-4, SM-C2.

**Compliant pair:** Interview counts each successful preview response, including edits, as preview reached; results counts the first preview per Case. Basis selection encodes the preset into the event code; metrics treats `event` as a closed enum without a preset dimension. All store only the permitted aggregate dimensions and increment within a request.

**Collision:** Completion can exceed 100%; preset adoption is unrecoverable from type-only counts; delete-to-Undo ratios count retries differently. Static Full-results views and downloads can also be counted at request arrival or successful delivery by different owners.

**Proposed AD — tighten AD-23:** Publish a versioned event registry defining each event's trigger, dimensions, denominator and deduplication scope, including Basis type/preset and delete/Undo relationships required by the PRD. Put once-per-Case/transition markers on existing domain state where necessary, increment aggregates with the successful transition, and prohibit person/Case identifiers in aggregate rows.

### 20. Wave-1 results/tree × wave-2 engine/Country law: no shared-foundation dependency gate

**Anchors:** AD-15 corpus before adapter switch; AD-19 shared presentation; AD-20 Basis migration; Capability map; PRD §6.1 independently releasable waves.

**Compliant pair:** Wave-1 tree/results plans the pure engine adapters, presentation and snapshot migration as prerequisites before switching. Wave-2 Country law plans to own those same foundations because they introduce `engine`, `presets` and Basis. Both can eventually satisfy every AD and perform migration safely, yet produce different interfaces and a dependency cycle in the delivery plan.

**Collision:** Wave 1 waits for wave 2, or builds an interim shared layer that wave 2 replaces; translations required by the global completeness gate can similarly wait on unowned future catalog keys. The AD-15 test gate alone does not establish which epic must deliver the interfaces first.

**Proposed AD — add foundation/order rule:** Assign foundation owners and a dependency DAG before epic implementation: canonical Family/Basis/Result/comparison contracts, pure School engine plus corpus, Case mutation service, presentation and i18n schemas, then their consumers and Country extensions. Wave 1 must ship those foundations with backward-compatible School behavior; each later wave extends published contracts and activates registered Locales/presets only after their completeness and compatibility gates pass.

## Closure criterion

These holes are not closed by adding package names or saying that teams should coordinate. Before decomposition, assign one accountable contract owner for each shared entity/interface and attach executable schema, round-trip, concurrency or cross-consumer fixtures appropriate to the finding. Infrastructure invariants remain necessary, but their single database, single artifact and compatible migrations do not determine the domain contracts above.
