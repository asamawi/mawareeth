# PRD Quality Review — Mawareeth phase 2

## Overall verdict
The PRD is specific and honest where it matters most: the Vision could not swap into another product, the Non-Goals do real work, the counter-metrics (SM-C1 to SM-C4) are unusually good, and the testable "Consequences" under most FRs are concrete. What is at risk is focus and release-readiness. It bundles five or more distinct bets (UX speed, seven country laws, nine languages, support desk, AI/API with billing) with no priority order and one owner reviewing all of it, and it has no go/no-go rule for country presets whose legal basis is still "to confirm". It is usable as a launch PRD after a pass on scope, the preset release gate, migration of phase-1 data, and the FRs that have no testable consequence.

## Decision-readiness — adequate
Decisions are mostly stated as decisions (Ja'fari deferred, seven presets only, no outside scholar review, Beta labels mandatory), and §6.2 has a real `[NOTE FOR PM]` on the trust risk. But the hardest decision is left implicit: §4.4 Notes say "Release gate per Country preset: the owner checks the cited articles", and §10 Q2–Q5 plus addendum §A cells ("to confirm", "not found", confidence "low-medium" for Algeria) show several presets may not clear it. Nothing says what happens then (ship with a stronger warning, drop the preset, delay the phase).

Open Questions 6 and 7 are legitimately open. Q8 (locale order) and Q9 (API pricing, free limit) are open but are the inputs to planning and to FR-35/FR-36, and carry no recommendation.

### Findings
- **high** No go/no-go rule for under-verified Country presets (§4.4 Notes, §10 Q2–Q5, addendum §A) — Jordan, UAE and Algeria have "known open points", and FR-11/FR-12 tests depend on settings still marked "to confirm". The PRD does not say whether a preset ships, ships with a stronger notice, or is cut if the gate fails. *Fix:* state the gate criteria and the fallback per preset (for example, Algeria ships only if Q4 is resolved, otherwise deferred).
- **medium** Open Q8 and Q9 are planning inputs with no recommendation (§10) — "Which Locale order to ship in?" and "the free limit itself" are asked without a proposed default. *Fix:* propose a default wave order and a provisional free limit, tagged `[ASSUMPTION]`.
- **medium** Free-versus-paid tension is not surfaced (§1 "The calculation, comparison, proof and draft PDF stay free" vs FR-36 "billable key") — API monetisation is a revenue move, presented as plumbing, and Non-Goals say no sale of reviewed calculations. Commercial apps would also be paying for content that carries Beta labels. *Fix:* add a `[NOTE FOR PM]` stating that API access is the one paid surface, and why that is consistent with the Vision.

## Substance over theater — adequate
Little theater. Seven personas is a lot, but each drives a distinct decision (country law, RTL, mobile, lawyer citations, support, AI). NFR-1 to NFR-5 and the feature NFRs have thresholds (p95 under 1 s, 50 Heirs, 375px and 1280px). The Vision is specific. Weak spots: no operational NFRs for a sold API, and one unsupported claim.

### Findings
- **medium** API-as-product has no availability, abuse or key-handling NFRs (§4.9 NFRs, §8) — FR-36 sells keys to "a law firm or a commercial app", yet there is no uptime target, no statement of support level, no key storage or rotation requirement. *Fix:* add a short NFR set (availability target or an explicit "best effort", key hashing, abuse response) or state that none is promised.
- **low** Unsupported claim (§4.9 Description) — "Those assistants often guess the shares, and they get hard cases wrong" is the motivation for a whole feature group but cites no evidence. *Fix:* cite a test or soften.

## Strategic coherence — thin
The Vision title names three things ("easier for families, right for their country, in their language"), then says "Phase 2 has three aims" and lists four. Support desk, legal-page fixes, copy review, and an API with billable keys sit beside the thesis rather than under it, and nothing ranks them. 36 FRs across 9 features all land in §6.1 with no sequencing, while §9 says the owner alone reviews copy, fiqh wording, nine AI-drafted languages, seven presets and tickets. SM-5 promises "a real person" answering within 2 business days on top of this. The PRD reads closer to a backlog with headings than to one bet.

Metrics: SM-1 and SM-2 validate the UX thesis. Nothing validates "right for the country" except adoption (SM-3); correctness appears only as a counter-metric.

### Findings
- **high** No thesis hierarchy or sequencing for a very broad scope (§1 "three aims" listing four; §6.1; §9 Review model) — nine locales, seven presets, a support desk and an API are all in scope for one reviewer. *Fix:* state what the phase bets on, rank the feature groups, and mark the cut line (for example, which locale wave and which presets are first).
- **medium** SM-C2 relies on a feature that does not exist (§7 SM-C2) — "Undo and restore requests after Family-tree deletes" is measured, but no FR provides undo or restore; FR-3 offers only a confirmation. *Fix:* add an undo FR or change the metric to a measurable proxy (for example, deletes followed by re-add of the same relationship within 60 seconds).
- **medium** Baselines and targets are thin (§7) — SM-2 "rises by 20% relative" has no baseline and the stated assumption says instrumentation does not yet exist; SM-3's "at least 15%" and SM-4's "one completed Case per week" per locale are unexplained and weak for nine locales; nothing measures trust in a result. *Fix:* establish baselines first, justify or tag targets, and add a trust or accuracy-review measure for presets.

## Done-ness clarity — adequate
Most FRs carry a "Consequences (testable)" list with verifiable conditions (FR-1, 3, 7, 8, 14, 15, 20, 31, 36). A group of FRs has no consequence at all, and several that do lean on adjectives or on addendum cells that are not settled.

### Findings
- **high** FRs with no testable consequence (§4.2–4.8) — FR-23 (no consequence), FR-25 ("reviewed and corrected by the owner, and marked reviewed" with no definition of the set or the marker), FR-26 ("reviewed for accuracy and plain language"), FR-29 (WhatsApp link, no consequence), FR-17/FR-19 weak on defaults and fallbacks. Engineers cannot tell when FR-25 and FR-26 are done. *Fix:* give each a countable done-condition (for example, "all N strings in deferred-work list X carry reviewed=true").
- **medium** Behaviours in journeys have no requirement (UJ-1 edge case, FR-4, FR-2) — UJ-1 says the tree "flags that they inherit through the obligatory bequest... and moves them there", and Karim is entered "as a son who died before his father", yet no FR covers either a predeceased-heir status or the auto-move. FR-4 uses "up to the case limit", which is not defined anywhere. *Fix:* add FRs for predeceased marking and for conflicting entries under a Country law, and define the limit (the 50-Heir figure from NFR-3 is a candidate).
- **medium** FR-34 contradicts itself (§4.9 FR-34 vs FR-31, NFR-4) — "the family in the URL or in a short-lived token" are two different designs; a URL-carried family cannot "expire after 7 days", and a token implies server storage while FR-31 says "The API stores no Case". Family data in URLs also reaches logs and referrers, against NFR-4. *Fix:* choose one mechanism and state its privacy and expiry behaviour.
- **low** Vague conditions (FR-2 "in the right line"; FR-18 "the Locale's conventions"; FR-26 "plain language") — *Fix:* name an example per Locale or a reference test.

## Scope honesty — adequate
Non-Goals (§5) and §6.2 are explicit and mostly honest, including the Ja'fari deferral and the Beta-label trade-off. Open-items density is high for a launch-grade PRD: 13 indexed assumptions, 9 Open Questions and only 1 `[NOTE FOR PM]`. Several assumptions are policy decisions rather than UI details (keyless free tier, 12-month retention, 7-day link expiry, manual billing). The notes are missing at real tensions (AI-drafted translations of religious terms, paid API vs free product, solo review capacity).

### Findings
- **high** Phase-1 data and behaviour changes are not addressed (§4.2, §4.4, FR-6, FR-10, FR-14) — existing Saved cases have only a case reference and no Basis or preset version; the PRD does not say what name, Basis or version they get, nor what happens to live guest Cases at release. *Fix:* add a short migration requirement (default name, Basis = "compare all four Schools", version null) and a non-goal if no backfill is planned.
- **medium** Callouts do not sit at the real tensions (§6.2, §4.9, §4.6) — only one `[NOTE FOR PM]` exists. Policy assumptions in FR-30, FR-34, FR-35 and FR-36 should be owner decisions with a recommended value, not buried tags. *Fix:* add `[NOTE FOR PM]` for the paid API, AI-translated fiqh terms, and review capacity; promote the policy assumptions to Open Questions.

## Downstream usability — adequate
FR IDs run FR-1 to FR-36 without gaps; NFR, SM and UJ IDs resolve. The Glossary is good and terms are mostly used exactly. Problems are placement, traceability and self-containment.

### Findings
- **medium** UJ-7 lives in §4.9, not §2.3, and many FRs map to no journey (§4.9, §2.3) — FR-9, 12, 14–16, 24–26, 29, 30, 32, 35 and 36 carry no "Realizes". FR-25, FR-26 and two feature NFRs (§4.1) rely on `deferred-work.md` for their content, so the PRD is not self-contained for story creation. *Fix:* move UJ-7 into §2.3; add a UJ or an explicit "no journey: operational" marker; inline or attach the deferred-work items the FRs depend on.
- **medium** Glossary conflicts and gaps (§3) — Basis is defined as one School or Country law and a Case is "calculated under exactly one Basis", but FR-10 and its assumption make the default "compare all four Schools", which is neither. Terms used but undefined: API, MCP, API key, Case link, Country notice, Heirs list, case limit. *Fix:* add a "compare all Schools" Basis value to the Glossary and define the missing terms.

## Shape fit — adequate
A consumer product with a secondary professional audience, so named-protagonist journeys are right and the density (7 UJs) is proportionate. It is brownfield: UJ-3 and UJ-4 change existing flows and are described as such, but the PRD never marks which UJs are new versus changed, and the existing data issue is covered above.

### Findings
- **low** Protagonist context uneven (§2.3 UJ-3, UJ-5) — UJ-3 has no persona line (relies on UJ-2) and UJ-5 has no entry state. *Fix:* add one line of context each so they can be extracted alone.

## Mechanical notes
- Placeholder left in §0: "globally numbered requirements (FR-1 to FR-N)". Should be FR-1 to FR-36.
- §0 says assumptions are "indexed in §9"; the index is §11 (§9 is Constraints and Guardrails).
- Assumptions Index roundtrip: the §4.9 FR-35 entry ("the free tier is keyless, with per-IP limits") has no inline `[ASSUMPTION]` tag in FR-35. All other index entries appear inline; inline tags in FR-4, 5, 10, 20, 27, 30, 31, 33, 34, 36, SM-6 and §7 are all indexed.
- Vision says "Phase 2 has three aims" and lists four bullets.
- UJ-7 is out of order (defined after UJ-6's section, inside §4.9), which breaks extraction of the journey list.
- Casing drift: "School" (Glossary) vs "{school}" in the FR-7 example string; "Heirs list" vs defined "Heir". Minor.
- FR-31 and §4.9 reference "NFR-2" correctly; no other broken cross-references found.
