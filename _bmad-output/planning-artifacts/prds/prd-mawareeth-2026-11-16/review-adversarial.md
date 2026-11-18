# Adversarial review: Mawareeth phase 2 PRD (2026-11-16)

Scope: prd.md and addendum.md only. Severity: critical, high, medium, low. No findings are claimed from files not read.

Scope count (what one owner must ship): 36 FRs, 7 country presets (each needing statute verification, a new engine step, tests), 9 new locales across 4 scripts (2 RTL), a drag-and-drop tree editor, a ticketing system with inbound email, a public API + OpenAPI + MCP server + prefilled links + rate limiting + billable keys, server-side analytics, legal rewrite, and an Arabic/French/fiqh review backlog. Roughly 9 epics, each of which would be a normal quarter for a small team. The PRD's only prioritisation is "candidate if time allows" for one deferred item.

## Critical

### C1. Seven country presets, no outside review, shipped as the headline feature
- Location: 4.4, 6.2 NOTE FOR PM, 9 Review model, 10 Open questions, Addendum A
- Why: The PRD itself admits the Country law content rests on "not finding" things (Lebanon), lists "to confirm" cells for UAE grandfather, UAE mushtaraka, Algeria grandfather and mushtaraka, Egypt mushtaraka "not found", Jordan article numbers, and rates Algeria "low-medium". Yet each of these is built into an engine that outputs exact fractions with article citations. A cited article number next to a wrong share lends false authority to a figure a grieving family may take to a lawyer or court. The Beta label is the only mitigation, and the PRD itself calls the absent review "the biggest trust risk". The release gate in the 4.4 Notes ("owner checks the cited articles against the official text") is a single non-specialist check, and it is a note, not an FR with a testable consequence.
- Fix: Ship fewer presets (Egypt, Morocco, Saudi Arabia, the high-confidence ones) and withhold the rest until the open questions in section 10 are closed. Make "no preset goes live with any `to confirm` cell" a testable FR. Make refusal ("this rule is not confirmed for this country") the default for any unconfirmed setting rather than falling back to a Hanafi default silently.

### C2. Silent "default school for gaps" produces country-labelled results that are not that country's law
- Location: FR-12, Glossary "Country preset", Addendum A row "Default school for gaps"
- Why: UAE and Algeria defaults are "Sharia, unnamed"; Saudi Arabia is "law's own preferences". The engine needs a concrete school there, but the PRD never says which, and FR-7 then displays "Country preset name and version date" as the producing basis. The result reads as "Algerian law" while actually being an unnamed school fallback. FR-16 refusal only covers "needs a rule the preset does not cover", with no definition of when a gap is detected.
- Fix: Require every result to list which steps used the fallback school and which used a cited article. Add an FR that the fallback school is stated per preset and shown in the proof.

### C3. AI machine translation of fiqh terms into nine languages, reviewed by one owner who cannot read most of them
- Location: 4.6, FR-20 to FR-22, 9 Review model, 5 Non-goals
- Why: "AI drafts, owner reviews" is not a review for Urdu, Hindi, Turkish, Indonesian, Malay, German, Spanish, Italian, Chinese. Mistranslating "radd", "awl", "obligatory bequest", or kinship terms (paternal vs maternal uncle, full vs consanguine sibling, which have no one-word equivalents in several of these languages) can change the meaning of who inherits. A footer Beta label is not read by a user who reaches the share table. FR-21 requires "one agreed translation" per term but defines no source of agreement and no check beyond existence of a list.
- Fix: Ship at most two or three locales where a native reviewer is known (Urdu, Turkish, Indonesian by community demand), keep fiqh terms in transliterated Arabic with a gloss, put the Beta notice on the result itself and the PDF body rather than footer only, and gate each locale on a named native reviewer in data, as FR-15 does for presets.

### C4. Prefilled Case link carries family data in the URL
- Location: FR-34, UJ-7
- Why: "The link carries the family in the URL or in a short-lived token" is an unresolved either/or. A URL with family structure, names and estate leaks into browser history, server access logs, Cloudflare logs and analytics, the Referer header sent to any third-party resource, WhatsApp link previews, and the AI assistant vendor's logs and conversation storage. It also contradicts NFR-4 and SM-C3. "Expires after 7 days" is unspecified for a URL that embeds the payload itself (a self-contained URL cannot expire). Data concerns a deceased person and living relatives, with PDPL/GDPR exposure.
- Fix: Token only (server stores payload keyed by random id, 7-day TTL, delete on first open or on expiry), stripped names, `Referrer-Policy: no-referrer`, excluded from analytics and log retention, and fragment-based if client-side.

## High

### H1. AI assistants quoting API output as rulings
- Location: FR-33, SM-C4, UJ-7
- Why: "Tool descriptions tell the assistant to show the disclaimer" is a request to a language model, not a control. Assistants paraphrase, drop disclaimers, round fractions, and merge the Beta state away. The API returns exact fractions and an authoritative-looking proof for a Beta Country preset, with no human in the loop and no ability for the family to see the "grief context". The `calculate_inheritance` entry point also lets the assistant guess the family structure from a vague chat message (for example "uncles" ambiguity: paternal or maternal, full or half), and the engine then answers confidently on a wrong input. UJ-7 itself shows this: "my mother and two uncles" is underspecified.
- Fix: Require the API to reject ambiguous relationship input, return a `must_display` block (Beta state, disclaimer, assumptions made) and a machine-readable `confidence`/`input_assumptions` field, make MCP default to Schools-only (no unreviewed Country presets) until reviewed, and add a test with ambiguous input.

### H2. Paid API keys inside an AGPL, "free" product
- Location: FR-35, FR-36, NFR-5, 10 Q9
- Why: AGPL-3.0 allows commercial use, so a commercial competitor can run the whole engine itself; the paid tier sells nothing they cannot self-host, and the per-IP free tier invites abuse behind rotating IPs. The PRD states no key-management model (hashing, rotation), no SLA, no liability terms for paid output used by a law firm, and no tax or invoicing entity. It also contradicts Vision ("calculation ... stay free") unless the API is explicitly outside that promise. NFR-5 "no third-party service may make the source offer impossible" is untested. Manual billing for "commercial apps" is a standing support burden. Pricing is an open question (Q9) while FR-36 is committed scope.
- Fix: Drop FR-36 from phase 2 (free keyless tier plus a contact route is enough), or state the business and liability model explicitly. Add that API outputs for Beta presets are excluded from any paid SLA.

### H3. Preset version drift in Saved cases is under-specified
- Location: FR-14, FR-15, Glossary, UJ-3
- Why: "Offers to recalculate" does not say what happens to a PDF or a shared link that already circulated with old shares, or to a Saved case when a Beta label is lifted or when the engine (not preset) changes. FR-14 stores only the preset version, not the engine version, while NFR-2 and FR-31 promise determinism "for the same engine and preset version". A case shared with siblings that silently shows different numbers after recalculation causes a family dispute, the exact outcome the product is meant to prevent. There is no retention or immutability rule for shared results.
- Fix: Store engine version and preset version; make shared links and PDFs immutable snapshots with an explicit "superseded by a newer version" banner; show a diff of shares on recalculation, never overwrite silently.

### H3b. Basis change and successive deaths
- Location: FR-10, FR-11, Glossary "Case"
- Why: A Case may include later deaths, but the Obligatory bequest is defined only for the first Deceased. The PRD does not say whether the second estate uses the same Basis, whether a bequest recipient's own death is handled, or how the bequest interacts with the 864/864 successive-death fixture. FR-10 lets the Basis change after data is entered, but Egypt's rule "moves" heirs out of the heir list (UJ-1 edge case) and switching back is not defined (is the moved data restored?).
- Fix: Specify successive-death behaviour per Basis, and make the heir-to-bequest move reversible and non-destructive.

### H4. Drag-and-drop and the tree on mobile
- Location: FR-2, FR-3, NFR tree (375px, 50 Heirs)
- Why: Press-and-hold drag on a touch screen conflicts with scrolling, text selection and iOS long-press callouts; dropping onto a specific node among 50 at 375px is not a reliable target; and a dropped chip's position ("in the right line") is inferred, so a mis-drop creates a plausible but wrong family (e.g. a daughter's child entered as a son's child, which flips whether a bequest or a share applies). The desktop primary persona (UJ-1) is a phone user. The tap-to-add alternative is listed as a consequence of FR-2 rather than the primary mode. RTL mirroring of the tree and drag direction is not mentioned.
- Fix: Make tap-to-add on a selected node the primary path, drag an enhancement; require a confirmation line after any add stating the inferred relationship in words ("added as son of Karim"); test with RTL, 200% zoom, and screen reader.

### H5. Urdu RTL PDF, and PDFs in nine more scripts
- Location: FR-20, FR-18, NFR-1
- Why: Nastaliq-style Urdu, Arabic-Indic vs Extended Arabic-Indic digits (Urdu uses different digit forms from Arabic), bidirectional mixing of fractions and Latin numerals, Devanagari conjuncts, and CJK all depend on the PDF engine and font embedding. The PRD only says "Urdu renders RTL in screen and PDF, like Arabic", but Urdu is not "like Arabic" for digits and fonts. Bidi fractions ("1/6") routinely render reversed in RTL PDFs, which silently misstates shares. FR-18 requires screen/PDF consistency and has no test method.
- Fix: Add per-script PDF acceptance tests with golden-file snapshots of fractions and amounts, require that fraction rendering is verified against exact values programmatically, and drop Hindi/Chinese from wave 1 if font embedding is not proven.

### H6. Metrics cannot be measured with stated analytics
- Location: Section 7, SM-1 to SM-6, assumption line under section 7
- Why: Only Cloudflare Web Analytics page views exist today. SM-1 (actions per family, "moderated tests"), SM-2 (completion relative to baseline, which does not exist since no event data), SM-3 ("15% of Cases from those countries" needs the user's country, which the product deliberately does not collect, and country inferred from IP is a proxy for the visitor, not the estate), SM-4 (completed Case per locale per week, needs events), and SM-5 are unmeasurable without new tracking. The footnote admits this as an assumption but still states numeric targets. "vs 90 days before where a baseline exists" means SM-2 has none. SM-C2 (undo requests) assumes an undo feature that has no FR. SM-C3 conflicts with adding event tracking.
- Fix: Add an FR for cookie-free server-side counters (event list, retention, no identifiers) or delete the targets; define SM-3 by Basis chosen not user country; add undo/restore as an FR or drop SM-C2.

### H7. Scope is not shippable by one owner
- Location: 6.1, whole document
- Why: See the scope count above. There is no priority order, no MoSCoW, no wave plan (Open question 8 asks the question and leaves it open), and the largest-risk items (presets, translations, API) are in scope while content review of existing Arabic/French (FR-25, FR-26) is in the same bucket as new work. With the owner as sole reviewer of all content (C1, C3) the review load alone exceeds capacity. A half-shipped country preset or locale is worse than none, because partial strings and Beta labels teach users to ignore warnings.
- Fix: Cut to waves with exit criteria: Wave 1 = FR-1 to FR-9 plus FR-24 to FR-26 (legal accuracy first), Wave 2 = Egypt/Morocco/Saudi presets plus two locales, Wave 3 = contact, Wave 4 = API/MCP. Move FR-36 and four locales to a later phase.

### H8. Legal and privacy pages are fixed after, not before, new data flows
- Location: FR-24, FR-27, FR-30, FR-34, FR-31, NFR-4
- Why: The terms currently contradict the licence (a live legal inaccuracy, as the PRD itself says) and the privacy page still has advertising-partner text. Both are fixed in the same phase that adds support tickets (email content about deceased persons, health or family conflict), WhatsApp contact (number sent to a US processor), a public API and prefilled links. No data protection assessment, lawful basis, processor list, cross-border transfer statement (Hetzner EU host, WhatsApp, helpdesk vendor) or DPIA-style check is required. "Saudi PDPL principles" is cited without stating whether Mawareeth is actually in scope or who the controller is. Rights of the deceased's relatives whose data is entered by a third party is a hard problem that FR-24 covers in one clause.
- Fix: Sequence FR-24 as a release gate before FR-27, FR-31, FR-34. Add a controller/processor statement and breach-contact route.

## Medium

### M1. FR numbering, Glossary and UJ inconsistencies
- Location: Section 0, 4.9, FR-1 to FR-36, Glossary, Section 11
- Why: UJ-7 is defined inside 4.9, not in 2.3, so section 2.3 lists six journeys while FRs "realize UJ-7". Section 0 says Glossary words are "used exactly", but: "Case" is also used for the API's non-stored request ("The API stores no Case"), "Heir" includes the Deceased's descendants who are not heirs under a Country law (they are moved to the bequest), "Basis" is a Case-level choice but FR-31 sends it per request, and "Saved case" vs "Case" is used interchangeably in FR-14. "Obligatory bequest" glossary says "died before (or with)", FR-11 says "before or with" while Egypt's rule per Addendum is differently bounded and Jordan "son's line only" (glossary says grandchildren generally). The Glossary calls the bequest "capped at one third and taken out before the heirs share the rest", but the Addendum says the "method" may be two-pass or two-phase, so "taken out before" is not uniformly true. "Beta label" is defined for presets and locales but the API Beta state (FR-31) is a third use. Section 11 lists assumptions but omits several `[ASSUMPTION]` tags (FR-20 Chinese is in; FR-35 free tier assumption is listed but FR-35 has no tag). FR-12 says "grandfather with siblings" and "special cases" as settings, but Addendum section A's engine settings list does not define these switches, only bequest settings. The mention in section 6.1 of "FR-1 to FR-6" matches, but the headline in 4.4 calls "seven Country presets" while FR-10 lists "four Schools and seven Country laws" (11 options, but the default "compare all four" is a twelfth state not in the list).
- Fix: Move UJ-7 to 2.3, add "API request" to the glossary or stop calling it a Case, add a "Fallback school" and "Engine version" term, and have each FR cite its glossary terms only.

### M2. Obligatory bequest amount: the "gift offset" and method are unresolved, yet marked testable
- Location: FR-11, Addendum A (method row, settings list)
- Why: `gift_offset` requires entering lifetime gifts and voluntary bequests, which the Interview has no field for (FR-9 even tells users to subtract debts and bequests themselves). The addendum itself says "check whether two-pass and two-phase give identical results", so FR-11's pass-criteria (fatwa 8330 and Moroccan 49/960) are fixtures for two different methods the PRD has not shown to agree. Egypt's art. 76 generation limits are an open question (Q5) while the settings list assumes `lines` and `depth` are known.
- Fix: Add an input field FR for gifts and voluntary bequests or say the offset is not computed and the result is flagged; resolve the method equivalence on paper before writing FR-11.

### M3. Egypt "constitutional challenge" notice and legal-risk wording
- Location: FR-19, 9 Law change
- Why: A notice that a challenge "has been reported" on a statute is itself a legal claim sourced from the research, with no named source or date in the product and no process for removing it when stale. It will tell Mona the result may be unconstitutional with no guidance.
- Fix: State the source and date in the notice, and add a review date per notice in preset data.

### M4. Contact form and support tickets
- Location: FR-27 to FR-30, UJ-5, Addendum C
- Why: "It never requires case data" but users will paste it; free text about deaths and family disputes lands in the owner's mailbox and (per Addendum C) maybe a US helpdesk. Inbound email threading and spam protection without a captcha is a non-trivial build and a spam and phishing target (mail loops, auto-replies, header injection). SM-5 promises a reply in 2 business days by a sole owner who is also the translator reviewer, legal pages author and engine developer. Deleting after 12 months is an assumption; PDPL/GDPR erasure on request has no SLA. WhatsApp support number exposes the owner's personal number (Q7) and WhatsApp replies are unlogged outside the Ticket system.
- Fix: Use the simplest option (a form to a monitored mailbox, no inbound threading) for phase 2; use a business number; state the SLA as best effort, not a metric.

### M5. API operational and abuse risks
- Location: FR-31, FR-35, NFR performance
- Why: A public, accountless, per-IP-limited calculation endpoint behind a single Hetzner host can be hit by MCP clients that share IPs (hosted assistants send all traffic from vendor IP ranges, so one vendor can exhaust the free limit for everyone). "p95 under 1 s for 50 heirs" is promised for an unauthenticated endpoint with no mention of algorithmic-complexity limits (successive deaths and 50 heirs could be costly) or request size caps. CORS, versioning and deprecation policy are not stated. The "names dropped after response" assumption conflicts with the request being logged by reverse proxy and Cloudflare.
- Fix: Add per-client-id limits for known MCP vendors, request size and depth caps, an API version in the path, and a statement that access logs exclude request bodies.

### M6. Single "Same result in all four Sunni schools" claim
- Location: FR-7, UJ-4
- Why: The statement is true for the engine's modelled rules but is read by a family as "all scholars agree"; where the engine refuses a school (Malikiyya refusal exists today) "all four" is false. FR-7 does not say what is shown when one school refuses, nor when schools agree on shares but differ on reasoning or on the heirs (blocked vs share).
- Fix: Define the display when a school refuses, and the exact wording ("shares are identical in the four modelled schools").

### M7. Estate guidance and PDF footer
- Location: FR-9
- Why: The hint is only about the estate amount; it says nothing about wills over a third, debts exceeding the estate, or a Country law's own estate rules. The PDF footer "not verified by Mawareeth" is at the foot, a place users ignore, for a document likely to be shown to relatives.
- Fix: Move the "supplied by the user" statement into the PDF header block next to the Basis and Beta label.

### M8. Existing user data when Basis default or labels change
- Location: FR-5, FR-6, FR-7, FR-10
- Why: Existing Saved cases (phase 1) have no Basis or preset version. The PRD does not say how they migrate, what FR-14 shows for them, and whether the removal of the school line (FR-7) changes shared links already sent. Default labels ("Son 2") in the current Locale: if the user later changes Locale, are stored labels translated or frozen? Case name 100 characters in any script, with no mention of bidi control characters or injection in PDFs and emails.
- Fix: Add a migration requirement and a label-storage rule (store relationship key, render label per Locale).

## Low

### L1. Chinese script assumption and Malay/Indonesian pairing
- Location: FR-20
- Why: Simplified for Chinese is an assumption, but Hong Kong/Taiwan/Hui community usage is not considered; Indonesian and Malay are treated as two locales with different fiqh vocabulary conventions (Shafi'i-dominant) while Hindi and Urdu are separate locales with shared term lists that FR-21 does not allow to be shared.
- Fix: State the term-list ownership per Locale and allow explicit sharing.

### L2. hreflang and sitemap for locales with Beta label
- Location: FR-23
- Why: Publishing indexed public pages in nine unreviewed locales invites search engines to show unreviewed fiqh text as the authoritative page; the Beta label is in the footer only.
- Fix: Add `noindex` to unreviewed locales until reviewed, or a visible banner at top.

### L3. Accessibility acceptance is generic
- Location: NFR-1, FR-8
- Why: "WCAG 2.1 AA" for a custom tree widget and drag interaction needs a named pattern (tree view, listbox, or grid) and WCAG 2.2 target-size and dragging-movement criteria; 2.1 lacks the 2.2 "Dragging Movements" criterion that this feature most directly needs.
- Fix: Target WCAG 2.2 AA.

### L4. Open questions that block FRs are not tied to them
- Location: Section 10
- Why: Q1 to Q5 block FR-11 to FR-13 for specific presets, Q6 blocks FR-27 to FR-28, Q9 blocks FR-36, Q8 blocks scheduling. None carries an owner, deadline or "blocks FR-n" marker, and section 9 says to re-check law by 2027-01 which is about 6 weeks away with no capacity allotted.
- Fix: Add a blocking-FR and a due date to each question.

### L5. Success metric SM-1 baseline arithmetic
- Location: SM-1
- Why: "about 15 (3 per Heir)" for five heirs is an unsourced estimate, and "5 or fewer" ignores that tapping relationship buttons still requires per-heir naming for any family where the default labels are ambiguous (two sons and two daughters-in-law).
- Fix: Measure the baseline from the current flow once and restate.
