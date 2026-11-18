---
status: final
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-mawareeth-2026-11-16/prd.md
  - _bmad-output/planning-artifacts/prds/prd-mawareeth-2026-11-16/addendum.md
  - _bmad-output/planning-artifacts/architecture/architecture-mawareeth-2026-11-16/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-mawareeth-2026-11-16/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-mawareeth-2026-11-16/EXPERIENCE.md
---

# mawareeth - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for mawareeth phase 2, decomposing the requirements from the PRD, UX Design, and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

FR-1: A user can add an Heir by pressing one relationship button. _(§4.1 Faster family entry and an editable Family tree; wave 1)_
  - Pressing a relationship button adds an Heir of that relationship to the Case and the Family tree, with no further input.
  - The new Heir gets a default label in the current Locale ("Son 1", "Son 2"), editable later.
  - Relationships the engine says cannot apply (for example a second father) are not offered, as today.
  - The Share preview updates after each add.
  - Adding stops at the 50-Heir Case limit with a message saying so.

FR-2: A user can drag a relationship onto the Family tree, onto the Deceased or onto an Heir, to add a relative in that position. _(§4.1 Faster family entry and an editable Family tree; wave 1)_
  - Dropping "Son" on a son marked as having died before the Deceased adds that son's child (a grandchild) in the right line.
  - Every drag action has a keyboard and screen-reader equivalent that reaches the same result.
  - On touch screens, a tap on a node opens "Add relative here", so dragging is never required. Press-and-hold drag works but is optional.
  - A drop that would create an impossible family is refused with a message, and the tree is unchanged.

FR-3: A user can select an Heir on the Family tree and change their name or relationship, mark them as having died before the Deceased, or delete them. _(§4.1 Faster family entry and an editable Family tree; wave 1)_
  - Selecting a node opens an edit panel (desktop) or bottom sheet (mobile) with name, relationship, "died before the Deceased" and delete.
  - Deleting an Heir who has descendants in the Case, or who is linked into a later death, asks for confirmation and states exactly what else is removed.
  - The Heirs list, the Family tree and the Share preview show the same family after any edit.

FR-4: A user can add several Heirs of the same relationship at once (for example "4 daughters"). _(§4.1 Faster family entry and an editable Family tree; wave 1)_
  - Entering a count adds that many Heirs with default labels, up to the 50-Heir Case limit.
  - [ASSUMPTION: a count stepper on each relationship button is acceptable UI; the UX pass may choose another form.]

FR-5: A user can undo adds, edits and deletes in the Interview, one change at a time, back through the changes made since the page was opened. _(§4.1 Faster family entry and an editable Family tree; wave 1)_
  - An "Undo" control appears for at least 10 seconds after each change and restores the previous family exactly.
  - Each further Undo walks back one more change. The history covers the current page visit only and is cleared on reload (architecture AD-20).
  - Undo works by keyboard and screen reader.

FR-6: The relationship list covers every relative that the Obligatory bequest and the Country presets' distant-kin rules can reach. _(§4.1 Faster family entry and an editable Family tree; wave 2)_
  - The list includes at least: a predeceased child marker; grandchildren through a son, at any depth; grandchildren through a daughter (first degree); and the maternal grandfather. It also includes the distant-kin classes used by the Country presets in addendum §A.
  - Each new relationship has labels in every Locale and a test under each School and Country preset that uses it.

FR-7: A registered user can open a Saved case from *My cases* straight into the Interview, with its family loaded. _(§4.2 Saved cases that open directly, with names; wave 1)_
  - No "resume or start over" prompt appears when opening a Saved case.
  - Starting a new Case is a separate, explicit action in *My cases*.
  - [ASSUMPTION: the resume/start-over prompt stays only for a guest returning to an unsaved Case within 24 hours.]

FR-8: A registered user can name a Saved case and rename it at any time. _(§4.2 Saved cases that open directly, with names; wave 1)_
  - Saving prompts for a Case name, prefilled with a suggestion: "Estate of {Deceased name or label}, {date}".
  - *My cases* lists and sorts by Case name and last change; the case reference is no longer the main label.
  - A Case name accepts any Locale's script, up to 100 characters.

FR-9: Saved cases from before phase 2, including migrated legacy cases, keep working. _(§4.2 Saved cases that open directly, with names; wave 1)_
  - Each existing Saved case gets the default Case name from FR-8, using its save date.
  - Each gets the Basis it was saved with: its School, or "compare all four Schools". None gets a Country law.
  - Guest Cases in progress at release keep working until they expire.

FR-10: The system names the School or Country law behind a result only when it changes the shares, or when the user chose a Country law. _(§4.3 Clearer results; wave 1)_
  - When all four Schools agree, the Share preview and Full results show "Same result in all four Sunni schools" and no "Calculated under the {school} school" line.
  - When Schools differ, the user's chosen School is named.
  - Under a Country law, the Country preset name and version date are always shown.

FR-11: The user can reach Full results from the Share preview through a primary button, not a text link under the table. _(§4.3 Clearer results; wave 1)_
  - The button is visible without scrolling on a 375px screen once the Share preview has shares.
  - It meets WCAG 2.1 AA target size and contrast.

FR-12: The system explains what "estate to divide" means before the user enters an amount, and the results say which facts the user supplied. _(§4.3 Clearer results; wave 1)_
  - The estate hint states that debts, funeral costs and bequests come out first, and that jointly owned or beneficiary-designated assets may not form part of the estate.
  - The PDF states that the estate amount and the family were supplied by the user and not verified by Mawareeth.

FR-13: Amounts are rounded consistently and always add up to the estate. _(§4.3 Clearer results; wave 1)_
  - Each amount is rounded to the currency's minor unit. Any rounding remainder is shown as a separate "rounding" line, so the amounts sum exactly to the estate.
  - Exact fractions are never rounded.

FR-14: When the Basis is a School or "compare all four Schools", and the family has an Heir marked as having died before the Deceased with descendants, the system says that some countries' laws give those descendants an Obligatory bequest, and offers to change the Basis. _(§4.3 Clearer results; wave 2)_
  - The warning appears in the Share preview and Full results, and lists the live Country presets that would give an Obligatory bequest for this family.
  - Choosing one recalculates under that Country law.

FR-15: Every Case starts on "compare all four Schools". There is no Basis step in the Interview. A user changes the Basis only from the Share preview or Full results. _(§4.4 Country law; wave 2)_
  - When the four Schools give different shares, the user is asked to choose a School, as today. When they agree, no School question appears.
  - A quiet "Calculate under a country's law" link in the Share preview and Full results lists the live Country presets in the current Locale. Only presets that have passed FR-22 appear.
  - The FR-14 prompt offers the same choice when a Country law would change this family's shares.
  - The user can return to "compare all four Schools" at any time. Changing the Basis recalculates the Share preview.

FR-16: Under a Country law that has one, the engine gives an Obligatory bequest to the qualifying descendants of an Heir who died before or with the Deceased. _(§4.4 Country law; wave 2)_
  - The qualifying lines, depth, one-third cap, lifetime-gift offset and split between descendants follow the Country preset settings (`addendum.md` §A).
  - The bequest is taken out before the Heirs share the rest. The Share preview and Full results show it as its own line, with its article citation.
  - The Dar al-Ifta worked example (fatwa 8330) and the Moroccan commentary example (49/960) pass as automated tests.
  - Under a School Basis, no Obligatory bequest is applied (FR-14 warns instead).
  - (addendum §A) Shared settings: lines = son / son and daughter; daughter_line_depth = 0, 1 or unlimited; son_line_depth usually unlimited; cap = 1/3; split = 2:1 male:female (confirm per preset); gift_offset subtracts lifetime gifts and voluntary bequests and tops up shortfalls; excluded_if_heir applies in Egypt, Jordan, UAE and Morocco, with Algeria to confirm. Compare Egypt two-pass and Morocco two-phase results; one implementation suffices only if identical.
  - (addendum §A) Obligatory bequest: Saudi Arabia — none [8]; Egypt — son's and daughter's lines; each ancestor blocks only his own descendants [2]; Jordan — son's line only [11]; UAE — son's and daughter's children [15][16]; Morocco — son's line any depth; daughter's children first degree [21]; Algeria — yes; daughter's line disputed [25][26]; Lebanon (Sunni) — none found [L1][L2].
  - (addendum §A) Bequest cap and split: Saudi Arabia — —; Egypt — 1/3; 2:1; gift offset [2][3]; Jordan — 1/3; 2:1; gift offset [11]; UAE — 1/3; 2:1 [15]; Morocco — 1/3; 2:1; gift/bequest offset [21]; Algeria — 1/3; 2:1 [25]; Lebanon (Sunni) — —.
  - (addendum §A) Bequest method: Saudi Arabia — —; Egypt — two-pass, taken out first (fatwa 8330) [1]; Jordan — parent's share per branch; UAE — parent's share; Morocco — two-phase (commentary) [21]; Algeria — parent's share; Lebanon (Sunni) — —.

FR-17: The engine applies each Country preset's settings for leftover estate (*radd*), distant kin, grandfather with siblings, the special cases (mushtaraka, akdariyya), and its default School for gaps. _(§4.4 Country law; wave 2)_
  - Each Country preset has at least one passing test case per setting that differs from its default school.
  - The research examples (for example Saudi Arabia: the grandfather excludes siblings, and the mushtaraka is not shared) pass as tests.
  - Each preset names a concrete default School for gaps. The UAE and Algeria use Maliki `[ASSUMPTION: to confirm]`, because their statutes refer only to "Islamic Sharia".
  - (PRD §4.4 notes; addendum §A) Lebanon is Sunni-only, Hanafi with every country switch off and no Obligatory bequest found: under the 1962 Sharia courts law art. 242 (amended 2011), apply Supreme Sunni Islamic Council decisions, then the 1917 Ottoman Family Rights Law, then the preferred Hanafi opinion.
  - (addendum §A) Leftover estate (radd): Saudi Arabia — spouse last [8]; Egypt — spouse last [4]; Jordan — spouses excluded; lone spouse gets the rest [11]; UAE — spouses excluded [15]; Morocco — to all fixed-share Heirs, spouse included (commentary) [21]; Algeria — spouses excluded unless no other heir [27]; Lebanon (Sunni) — Hanafi default.
  - (addendum §A) Distant kin: Saudi Arabia — 3 classes, parent's place, equal shares [8]; Egypt — 4 classes, ranked, 2:1 [4]; Jordan — 4 classes, 2:1 [11]; UAE — inherit, also beside a sole spouse [15]; Morocco — none; treasury [21]; Algeria — inherit [27]; Lebanon (Sunni) — Hanafi default.
  - (addendum §A) Grandfather with siblings: Saudi Arabia — grandfather excludes siblings [8]; Egypt — better of sharing or residue; floor 1/6 [4]; Jordan — same as Egypt [11]; UAE — codified, article to confirm; Morocco — best of 1/3 or sharing [21]; Algeria — to confirm; Lebanon (Sunni) — Hanafi: grandfather excludes siblings.
  - (addendum §A) Mushtaraka: Saudi Arabia — no sharing [8]; Egypt — not found; Jordan — sharing [11]; UAE — art. 240, to confirm; Morocco — equal sharing, art. 365 [21]; Algeria — to confirm; Lebanon (Sunni) — Hanafi: no sharing.
  - (addendum §A) Default School for gaps: Saudi Arabia — law's own preferences [8]; engine uses Hanbali (owner decision); Egypt — Hanafi [6]; Jordan — Hanafi [11]; UAE — Sharia, unnamed [15]; engine uses Maliki (assumption); Morocco — Maliki [21]; Algeria — Sharia [28]; engine uses Maliki (assumption); Lebanon (Sunni) — Hanafi, after Council decisions and the 1917 Ottoman law (1962 law art. 242, am. 2011) [L1].

FR-18: For each share under a Country law, the proof and the PDF cite the statute and article. _(§4.4 Country law; wave 2)_
  - Every proof step under a Country law cites either an article of the Country preset, or "default School for gaps: {school}" when the statute is silent.
  - The PDF header names the Country preset and its version date.

FR-19: A Saved case, a share link and a PDF store the Basis and the Country preset version they were calculated with. _(§4.4 Country law; wave 2)_
  - Opening a Saved case after its Country preset changes shows the stored version and offers to recalculate under the current one. Nothing recalculates silently.
  - A shared link is a live view of its Saved case: it shows the Case's current family and its pinned Country preset version, and says when a newer version exists. The pinned version changes only when the owner explicitly switches (architecture AD-18).
  - (addendum §B) Saved cases store basis plus preset_id@version; the engine reads presets read-only and changes are data releases with tests, not code branches.

FR-20: Each live Country preset shows a Beta label until a qualified reviewer signs it off. _(§4.4 Country law; wave 2)_
  - The Beta label appears in the country-law list, the Share preview, Full results and the PDF.
  - Removing the label is a data change recorded with the reviewer's name and date.

FR-21: When a family needs a rule the Country preset does not cover, the system says so instead of showing a number. _(§4.4 Country law; wave 2)_
  - The refusal names the reason in the current Locale, as the engine already does for the Ja'fari school and the Malikiyya case.
  - Under the Lebanon preset, the Interview asks whether the Deceased was Sunni. If the answer is Shia, the system refuses and explains that Ja'fari courts apply rules Mawareeth does not yet support. If the answer is another religion, it explains that the 1959 law for non-Muslims applies.

FR-22: A Country preset becomes selectable in production only when the owner has checked every rule in it against the official statute text. _(§4.4 Country law; wave 2)_
  - Each rule in a Country preset records its article and a "checked against official text" date. A preset with any unchecked rule is hidden in production and visible only in test environments.
  - Known open points block go-live until resolved (§11): Jordan's numbering, the UAE mushtaraka and grandfather articles, the Algerian daughters' line, and Egypt's art. 76 generation limits.
  - (addendum §E) Unborn child (reserve), simultaneous deaths, killer and apostate bars, difference of religion, and the no-heir outcome differ by country (research §Shortlist notes). Each preset records them, with an article, before go-live (FR-22):
    - **Unborn child:** reserve the better of the two shares (Egypt, Saudi Arabia, the UAE). Egypt caps pregnancy at 365 days; Saudi Arabia and the UAE require a medical report.
    - **Simultaneous deaths:** no mutual inheritance (Saudi Arabia, the UAE, Qatar). Algeria brings deaths "with" the grandparent into *tanzil*.
    - **Killer:** Saudi Arabia lets an accidental killer inherit from the estate but not from the blood money.
    - **Apostate:** Jordan's art. 281(c) as summarised says an apostate inherits; verify before go-live.
    - **No heir:**
      - Saudi Arabia: property of unknown owner
      - Jordan: Ministry of Awqaf
      - UAE: charitable waqf
      - Morocco and Algeria: treasury
  - (addendum §E scope note) Qatar is mentioned as simultaneous-death research context only; it is not an eighth phase-2 preset.

FR-23: A user can choose the estate currency. It defaults from the Country law, or else from the Locale. _(§4.5 Country localisation; wave 2)_
  - Amounts show in the chosen currency's symbol and minor-unit rules in the Share preview, Full results and PDF, rounded per FR-13.

FR-24: Numbers and dates follow the Locale's conventions, for example Arabic-Indic digits where the Locale uses them. _(§4.5 Country localisation; wave 2)_
  - Fractions, percentages and amounts render per Locale in screen and PDF, identically in both, including in right-to-left Locales.

FR-25: Each Country law carries a short notice in every Locale. _(§4.5 Country localisation; wave 2)_
  - The notice shows on Full results and in the PDF under that Country law. Examples:
    - **Morocco:** "Family Code of 2004; a reform is pending."
    - **Egypt:** "A constitutional challenge to the bequest article has been reported."
    - **UAE:** "Non-Muslims may follow a separate civil law."
    - **Lebanon:** "Lebanese Sunni courts apply Hanafi rules; Shia families follow Ja'fari courts; changing sect changes the applicable law."

FR-26: When the Basis is a School, the results carry, in every Locale, a notice that local civil law may decide what forms the estate and who may claim, and that a local lawyer should confirm. _(§4.5 Country localisation; wave 2)_
  - The notice appears on Full results and in the PDF in those Locales, and does not appear under a Country law.

FR-27: Add Urdu (ur), Hindi (hi), Turkish (tr), Indonesian (id), Malay (ms), German (de), Spanish (es), Italian (it) and Chinese (zh), alongside Arabic (ar), English (en) and French (fr); a user can use the whole product in each new Locale: the Interview, results, proof, PDF, account pages, emails and public pages. _(§4.6 New languages; wave 3 (ur, hi, tr, id, ms) and 4 (de, es, it, zh))_
  - Every UI string, email, PDF label and server-side message has a non-empty value in every Locale. A CI check fails on missing or empty keys, in both the web app and the Django translation files.
  - Urdu renders right-to-left in screen and PDF, like Arabic, including fractions and digits.
  - Chinese uses Simplified script `[ASSUMPTION]`.

FR-28: Fiqh terms (relationship names, Obligatory bequest, *radd*, School names) use one agreed translation per Locale. Relationship names in a non-Arabic Locale also show the Arabic term beside them. _(§4.6 New languages; wave 3 (ur, hi, tr, id, ms) and 4 (de, es, it, zh))_
  - A per-Locale term list exists, and every UI and PDF string uses it.
  - In Full results and the PDF, each relationship shows "{translated term} ({Arabic term})".

FR-29: An unreviewed Locale shows a Beta label: "This translation has not yet been reviewed by a native speaker". _(§4.6 New languages; wave 3 (ur, hi, tr, id, ms) and 4 (de, es, it, zh))_
  - The label appears on Full results, in the footer and on the PDF for that Locale.

FR-30: Public pages exist in every Locale and can be found. _(§4.6 New languages; wave 3 (ur, hi, tr, id, ms) and 4 (de, es, it, zh))_
  - Each public page has `hreflang` links for every Locale and appears in the sitemap per Locale.
  - The language switcher lists each language in its own script.

FR-31: The terms and privacy pages match the product. _(§4.7 Content review; wave 1)_
  - The terms no longer claim "all intellectual property rights reserved" or forbid redistribution; they state the AGPL-3.0 licence.
  - The privacy page drops the advertising-partner text and covers accounts, sharing, email, WhatsApp, support Tickets, API use, retention, and the rights of the families whose data is entered.
  - Typos ("webste") are fixed in every Locale.

FR-32: The owner reviews and corrects every Arabic and French string that deferred-work lists as unreviewed. _(§4.7 Content review; wave 1)_
  - Each listed string is either corrected or confirmed, and recorded as "owner-reviewed" with a date.
  - The French Interview is tested end to end, with an automated browser test like the Arabic and English ones.

FR-33: The owner reviews the proof texts, refusal sentences and kinship labels that deferred-work lists, for accuracy and plain language. _(§4.7 Content review; wave 1)_
  - Each listed item is corrected or confirmed, and recorded as "owner-reviewed".
  - Items that deferred-work says need a qualified scholar stay recorded as "awaiting scholar review". They are not marked reviewed by the owner.
  - The proof explains a shared fixed share (for example, two wives share 1/8, so 1/16 each).
  - Public pages say plainly that the Ja'fari school is not supported yet.

FR-34: Any visitor can send a question through a Contact form, which creates a Ticket and emails them its number. _(§4.8 Contact and support; wave 1)_
  - The form asks for a topic (including "API access"), a message, an email and, optionally, a link to their Case. It never requires case data.
  - The visitor receives an email with the Ticket number in the current Locale.
  - The form is protected against spam without a third-party tracking captcha `[ASSUMPTION]`.

FR-35: The owner can answer a Ticket, and the visitor sees the whole exchange in one email thread. _(§4.8 Contact and support; wave 1)_
  - Replies from the owner reach the visitor, and the visitor's email replies attach to the same Ticket.
  - The owner can see open and closed Tickets in one place, with their first-reply time.

FR-36: A *WhatsApp* link on the Contact page and in the footer opens a chat with the support number. _(§4.8 Contact and support; wave 1)_
  - The link opens WhatsApp (app or web) with the support number and a greeting prefilled in the current Locale.
  - (addendum §C) Use a wa.me click-to-chat link without an API; automated replies requiring the WhatsApp Business API are out of scope.

FR-37: Ticket data is kept only as long as needed and is deletable on request. _(§4.8 Contact and support; wave 1)_
  - Closed Tickets are deleted after a set period [ASSUMPTION: 12 months], and the privacy page states it.
  - A visitor can ask for their Ticket to be deleted, and it is deleted within 30 days.

FR-38: Any client can send a family, an optional estate amount and a Basis, and receive the calculation. No account is needed. _(§4.9 AI tools can use Mawareeth; wave 4)_
  - The family is described only with the relationship codes from FR-39. A request with an unknown or ambiguous relationship is rejected with a message that lists the possible codes.
  - For each Heir, the response gives an exact fraction, a percentage, an amount if an estate was given, and a no-share or blocked status. It also gives the proof steps, any School difference, the Basis with its Country preset version, the Beta label state, and the disclaimer text.
  - Refusals (unsupported school, Malikiyya, impossible family) come back as structured reasons, never as numbers.
  - The API stores no Case and logs no names [ASSUMPTION: names are optional in the request and dropped after the response].
  - The same input gives the same output as the web app for the same engine and preset version (NFR-2).

FR-39: The API is described in a public OpenAPI document. Every relationship, School and live Country preset is listed with its code and its names in each Locale. _(§4.9 AI tools can use Mawareeth; wave 4)_
  - A CI check fails if the OpenAPI document and the engine's relationship or preset list disagree.
  - An "API" page in the footer links to the document, the MCP setup and the usage terms.

FR-40: An AI assistant can connect to a Mawareeth MCP server and use its tools: `calculate_inheritance`, `list_relationships` and `list_bases`. _(§4.9 AI tools can use Mawareeth; wave 4)_
  - The tools return the same content as FR-38, written so an assistant can relay it faithfully: fractions as text and numbers, the disclaimer, and the Case link.
  - The tool descriptions tell the assistant to look up relationship codes first, to ask the user when a relative is ambiguous, to show the disclaimer, and not to round or restate shares as rulings.
  - The server works over the standard remote MCP transport `[ASSUMPTION]`, so hosted assistants can connect with a URL.

FR-41: Each API and MCP result includes a link that opens the Interview prefilled with that family and Basis. _(§4.9 AI tools can use Mawareeth; wave 4)_
  - The family is stored on the server behind a random, single-purpose token. The link carries only the token; no family data appears in the URL.
  - The stored family is deleted when the token expires [ASSUMPTION: 7 days] or when the link is first opened and a guest Case is created, whichever comes first.

FR-42: Anyone may use the API and MCP server without a key, within a free limit. This includes commercial apps. _(§4.9 AI tools can use Mawareeth; wave 4)_
  - Requests over the free limit get a clear "too many requests" response with a retry time and instructions to request an API key.
  - The free limit is per IP address `[ASSUMPTION]`.

FR-43: A heavy user, such as a law firm or a commercial app above the free limit, can request an API key by opening a Ticket with the topic "API access". The owner can issue a billable key with a higher limit. _(§4.9 AI tools can use Mawareeth; wave 4)_
  - Requests carrying a valid key are limited by that key's quota, not by the free limit.
  - The owner can issue, change the quota of, and revoke a key, and see each key's monthly usage.
  - Revoking a key stops its requests at once and returns them to the free limit.
  - The usage terms on the API page say: free within the limit, a paid key above it, and the disclaimer and attribution must be shown.
  - [ASSUMPTION: in phase 2 billing is manual. The owner invoices from the monthly usage, and there is no in-app payment.]

FR-44: The system counts product events on the server without cookies or personal data. _(§4.10 Measurement; wave 1)_
  - Counted events: Case started, first Share preview with shares, Full results opened, PDF downloaded, Case saved, Basis chosen (by type and preset), Locale used, Ticket opened and first reply, API and MCP calls, and prefilled links opened.
  - Counts are aggregated per day, Locale and country (from the request, not stored per person), and visible to the owner.

FR-45: The owner can run a repeatable usability test for SM-1. _(§4.10 Measurement; wave 1)_
  - A written five-Heir test family and task script exist in Arabic and English, with a way to record the number of actions and time per participant.

FR-X1: Support exactly seven Country presets: Saudi Arabia Personal Status Law 2022; UAE Federal Decree-Law 41/2024; Egypt Laws 77/1943 and 71/1946; Jordan Personal Status Law 15/2019; Morocco Family Code 70-03, 2004; Algeria Family Code; Lebanon Sunni courts/Hanafi rules. Use one shared Obligatory-bequest step and rule switches, with versioned preset data rather than separate engines. _(§4.4 Country law; wave 2: Saudi Arabia, Egypt, Morocco, Lebanon; wave 3: Jordan, UAE, Algeria)_

### NonFunctional Requirements

NFR-1: Accessibility: WCAG 2.1 AA in every Locale, including right-to-left (Arabic, Urdu), the Family tree, and keyboard alternatives for every drag action. _(§9 Cross-Cutting NFRs)_

NFR-2: Determinism: the same Case, Basis and Country preset version always give the same exact fractions on screen, in the PDF and from the API. _(§9 Cross-Cutting NFRs)_

NFR-3: Performance: the Share preview updates within 1 s at the 95th percentile for families of up to 50 Heirs, on a mid-range phone over 4G. This needs the in-memory preview path and bounded lock waits from deferred-work. The engine itself stays under 200 ms for a standard family. _(§9 Cross-Cutting NFRs)_

NFR-4: Privacy: no new personal data beyond what the calculation needs. Ticket data is minimised, and Case data never goes into a Ticket automatically. The rules follow GDPR and Saudi PDPL principles, including for data about the Deceased. _(§9 Cross-Cutting NFRs)_

NFR-5: Licence: all code stays AGPL-3.0, including API-key handling and metering. No third-party service may make the source offer impossible. Invoicing is done outside the product. _(§9 Cross-Cutting NFRs)_

NFR-X1: Keep the Deceased visible in the Family tree for up to 50 Heirs at 375px and 1280px; support arrow-key navigation between nodes. _(PRD §4.1 Feature-specific NFRs)_

NFR-X2: API p95 response time is under 1 s for up to 50 Heirs. Calculate in memory without database writes except fair-use/usage counters and optional prefill tokens. Return text in any supported Locale on request. _(PRD §4.9 Feature-specific NFRs)_

NFR-X3: Every result retains the calculation-aid, not-a-fatwa-or-legal-advice notice. Country presets never claim certified/court-approved status and never interpret law for a particular estate. _(PRD §10 Legal standing)_

NFR-X4: AI drafts and the owner reviews; no outside sign-off this phase. Country and Locale Beta labels are mandatory; every preset is held until its articles are checked. _(PRD §10 Review model)_

NFR-X5: Re-check Morocco reform, Kuwait overhaul and Egypt constitutional challenge by 2027-01; re-check Lebanon findings by 2027-05. Versioning must keep old results explainable. _(PRD §10 Law change)_

NFR-X6: Use tracking-free contact spam protection; API requests log no names, store no Case, and drop optional names after responding (assumption). _(PRD §4.8 FR-34; §4.9 FR-38)_

NFR-X7: Screen/PDF numeric and date formats must agree, including RTL; CI rejects missing or empty UI/email/PDF/server-message translation keys in the web app and Django files. _(PRD §4.5 FR-24; §4.6 FR-27)_

### Additional Requirements

- No starter template: brownfield extension of existing app. _(Architecture Structural Seed)_
- AD-15: **Interface.** `engine/` exposes pure functions over immutable value objects (AD-25):
  - `calculate(family, rule_set) -> Result`;
  - the AD-16 queries;
  - `parse_preset(data) -> RuleSet`.
- AD-15: **Purity.** It does no I/O (files included), holds no global mutable state and reads no clock. It never imports Django or any translation function, directly or through another package. A CI import-graph check enforces this.
- AD-15: **Output.** Codes, `Fraction`s and integer minor-unit amounts only; no display text.
- AD-15: **Adapters.** `Calculation.compute` and the preview become thin adapters onto the core. Successive deaths (`manasikhat`) are composed inside the core.
- AD-15: **Switch gate.** No consumer switches to the core until the existing known-answer, School, proof, refusal and later-death corpus passes on core, adapters and presentation alike.
- AD-16: These answers come only from `engine` queries that take a rule set:
  - which relationships can be added where;
  - whether a drop or edit is impossible;
  - what a delete cascades to (the FR-3 impact list);
  - which facts the rule set still needs, such as the Lebanon sect question (FR-21);
  - which refusals apply, with reason codes;
  - which live Country presets would change this family's shares (FR-14);
  - the shares themselves.
- AD-16: The Case limits (50 Heirs, two later deaths) are enforced in the shell's Case command service (AD-20), not in the browser.
- AD-16: No shell module and no browser code decides any of these from its own tables.
- AD-17: **Rule sets.** A rule set is a School plus settings, and each School is a built-in rule set.
- AD-17: **Preset files.** A Country preset is `presets/<iso2>/<YYYY-MM-DD>.toml`. It holds:
  - `id`, `version` (effective date) and `default_school`;
  - every addendum §A setting and every addendum §E rule;
  - `default_currency`;
  - a `citations` map from each rule key to `{statute_id, article, checked_on}`, where a rule left to the default School cites `gap_school: <school>` instead;
  - `reviewed_by` / `reviewed_on`, both null meaning Beta.
- AD-17: **No display text** in preset files (AD-21).
- AD-17: **Immutability.** A merged version file is never edited or deleted; a rule change is a new file. The one permitted edit is the paired `reviewed_by` / `reviewed_on` fields, which change no number. CI enforces this against the merge base, and git history is the review audit.
- AD-17: **Loading.** `engine.parse_preset` turns parsed data into one resolved, immutable `RuleSet` with all defaults applied. The shell **presets registry** does the file discovery.
- AD-17: **Eligibility.** The registry is the only authority on eligibility, for listing *and* for execution in every consumer (UI, internal API, public API, MCP, restore, prefill, saved Cases). A version runs in production only if every rule is cited and checked and no listed blocker for it is open. A pinned historical version that was once eligible always resolves. The **current** version of a country is the newest eligible version whose effective date is not in the future.
- AD-17: **Tests.** Each preset ships with its known-answer tests (FR-16, FR-17).
- AD-18: **Basis shape.** The Basis is exactly one of:
  - `{kind:"compare"}`;
  - `{kind:"school", school}`;
  - `{kind:"country", preset_id, preset_version}`.
  Any other combination is a typed error. A country Basis's School is always derived from the preset, never stored.
- AD-18: **One resolver.** A single shared resolver validates and resolves a Basis for every consumer.
- AD-18: **Legacy fallback.** Only a legacy snapshot with *no* `basis` falls back. It derives from its legacy `madhab`: a valid School gives `school`, and otherwise `compare`. Malformed current input and an unavailable pinned version return typed errors, never a substituted Basis.
- AD-18: **Results are never persisted as truth.** They are recomputed from inputs plus Basis every time.
- AD-18: **Pinned versions.** A country Basis keeps its `preset_version` until the user explicitly switches. When a newer current version exists, the Case and its share links show the pinned version and offer the switch (FR-19).
- AD-18: **Share links are a live view of their SavedCase.** They show its current family and Basis, and its pinned version changes only by the owner's explicit action.
- AD-18: **No engine version stamp.** The known-answer corpus guards engine changes, and a result change from engine code ships only as a deliberate, tested correction.
- AD-19: **One function.** `presentation.present(outcome, basis, locale, currency)` is the only producer of the versioned `PresentedResult` (AD-25), and every consumer renders it without adding meaning.
- AD-19: **Comparison.** It runs each School for a `compare` Basis and builds the comparison envelope: agreement means identical per-person shares *and* statuses; difference lists the persons affected; a selection-required state appears when Schools differ; partial refusals are explicit.
- AD-19: **Text.** It attaches catalog labels, emitting each relationship as a translated segment plus an Arabic-original segment with language and direction metadata (FR-28). Names, fractions and amounts are bidi-isolated.
- AD-19: **Notices.** It selects the disclaimer (always), the Country notice, the civil-law notice (School Basis, every Locale), the Beta states, the FR-14 prompt and statute citations. None is dismissible except the FR-14 prompt, whose dismissal is Case state (AD-20).
- AD-19: **Money.**
  - Currency is a persisted Case input `{code, explicit}`. Its default comes from the Country preset, otherwise from the Locale, and it is re-defaulted only while `explicit` is false.
  - The estate is integer minor units validated against the currency's precision (Babel `get_currency_precision`).
  - Each allocation, Obligatory bequest included, is rounded half-up to the minor unit. A signed **rounding** line makes the amounts sum to the estate. It is kept separate from any legal unallocated or treasury share.
  - Fractions are never rounded (FR-13).
- AD-19: **Formatting.** Formatting happens once, on the server, with Babel, passing `numbering_system` from the Locale registry explicitly. The browser and PDF show the server's strings, and the browser no longer formats amounts with `Intl`.
- AD-20: **Ownership.** A Case's inputs live only on the server: family, estate, currency, Basis, eligibility answers and FR-14 prompt dismissal.
  - **Guest Case:** in the session, expiring 24 hours after its last change. Expiry is enforced on every read and edit, and an expired Case returns no family.
  - **Opened SavedCase:** the session holds a working copy linked to the SavedCase id and its base revision. Save writes back with a compare-and-swap on that revision, and a conflict is reported, never overwritten.
- AD-20: **Command service.** Every input mutation goes through one Case command service: add, bulk add, tree drop, edit, delete with cascade, Basis, currency, answers, restore and redeem (AD-22). Each takes the expected revision and applies atomically. On success it bumps one monotonic revision and returns the whole Case with the new revision. On a mismatch it returns a conflict carrying the current Case.
- AD-20: **Previews.** Preview responses carry the revision they were computed for, and the browser discards results for any older revision.
- AD-20: **Undo.** Undo is multi-step and page-only. The browser keeps a stack of prior Case snapshots for the visit, and each Undo is a `restore` command against the current revision. The stack is lost on reload. Stable person ids survive restore, so focus can return to the restored node.
- AD-20: **Offline.** While offline, edits are blocked and the family stays visible. There is no client edit queue.
- AD-20: **Conversion (expand → switch → contract).**
  1. Release N makes every reader accept snapshot schema 1 and 2 and still writes 1. "Every reader" means session, SavedCase list and load, share, invite and received views.
  2. Release N+1 writes 2 and backfills SavedCases and their default names (FR-8, FR-9). Live guest sessions convert on read.
  3. Country-Basis writes are enabled only when every active and rollback-eligible image reads schema 2.
  4. Schema-1 readers are removed only by AD-6 eligibility, never by release count.
- AD-20: **Proof.** A reader/writer round-trip matrix across active and rollback images is a release gate.
- AD-21: **Fiqh term catalog.** `i18n/terms/<locale>.json`, keyed by stable code, holds relationships, Schools, Basis kinds, `preset.<id>.name` and `preset.<id>.notice`, refusal reasons and proof templates. Each value is `{text, review}`. Proof templates use typed named placeholders, and the Arabic original is referenced by code, never copied.
- AD-21: **Locale registry.** `i18n/locales.json` gives each Locale its code, direction, Babel locale, `numbering_system`, own-script name, PDF font stack, publication state and review state (the FR-29 Beta label). Django `LANGUAGES`, Next.js `locales` and direction, the PDF, `hreflang` and the sitemap all derive from it.
- AD-21: **General UI copy** stays in `messages.ts` (Next.js) and `.po` (emails, PDF chrome, server pages).
- AD-21: **One validator and generator.** It checks schema, placeholder parity, and missing or empty keys for every registered Locale across catalog, `messages.ts` and `.po`. It generates the typed Next.js module. CI fails on any gap.
- AD-21: **Publication.** A Locale is published in production only when the validator passes and the CI PDF glyph check passes for its font stack.
- AD-22: **Contract.** The public API lives at `/api/public/v1/`, with no login and an optional API key, and changes only by a new version path.
- AD-22: **No stored state.** It calls the core in memory through `presentation` (AD-19). It never touches the session or creates Case rows. Its only writes are admission counters (AD-23) and prefill tokens. Names are never persisted or logged.
- AD-22: **Input errors.** Unknown or ambiguous relationship codes return a typed error listing the candidate codes.
- AD-22: **MCP.**
  - It is a stateless Streamable-HTTP endpoint with JSON responses, implemented as a Django view, targeting MCP protocol revision **2026-07-28**.
  - It validates `Origin` and the `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` headers, and answers 405 to GET and DELETE.
  - Its tools (`calculate_inheritance`, `list_relationships`, `list_bases`) call the same functions as the public API and return fractions as both text and numbers, the disclaimer and the Case link.
  - CI runs the official MCP Python SDK client against it.
  - Acceptance by hosted Claude and ChatGPT connectors is a manual wave-4 gate.
- AD-22: **OpenAPI.** It is generated from the same registry and catalog, and CI fails if its relationship, School or live-preset lists differ from the engine and registry (FR-39).
- AD-22: **Prefill (FR-41).**
  - It stores a name-free canonical family plus Basis behind a random 256-bit token, kept hashed.
  - Opening the link shows a confirm page. Only an explicit POST redeems it, so link prefetchers and crawlers don't consume it.
  - Redemption is one Case command: claim the unexpired token, create a new guest Case, delete the payload, all atomically. A second redemption gets "already used". It never replaces an existing unsaved Case without asking.
  - Unredeemed tokens expire after 7 days.
- AD-23: **Keys.** `public_api` alone owns API keys: issue, quota, revoke and hash. Issuance is admin-only. A Ticket may reference a key, never hold one.
- AD-23: **Admission.** One admission service atomically checks and consumes one unit per external invocation before any engine work.
  - API and MCP share the same bucket.
  - A valid key uses its quota; no key, or a revoked or invalid key, uses the per-IP free limit.
  - Billable usage counts admitted requests that returned a result or a refusal; validation errors don't count.
  - Months are UTC calendar months.
  - If the counter store fails, admission fails closed with 503.
  - Over-limit responses carry `Retry-After` and the API-access Ticket route.
- AD-23: **Throttles.** Existing DRF throttles move to the same shared store.
- AD-23: **Event registry.** `metrics/events.py` defines each event's trigger, allowed dimensions and dedup scope. Dimensions are day, event, Locale, country, and Basis kind or preset id where relevant. "Once per Case" events are deduplicated by markers in Case state, never by analytics ids. Aggregate rows never hold an IP, user, session, key or Case id. Abuse windows and per-key billing rows are separate tables with their own retention.
- AD-23: **Cleanup.** Expiry is done by management commands on systemd timers. It covers windows, prefill tokens, guest sessions, delivered outbox rows, and closed Tickets older than 12 months.
- AD-24: **Storage.** A Ticket and its messages are PostgreSQL rows, worked in the Django admin. A Ticket stores its Locale, its first-reply time and only what the visitor typed, plus an optional Case link they chose to give. Case data is never copied in automatically.
- AD-24: **Spam.** The contact form uses tracking-free controls: a honeypot, a time check and per-IP admission (AD-23).
- AD-24: **Outbound mail.** Each message is written to an **outbox** row in the same transaction as the Ticket change. A bounded send to Brevo SMTP is tried after commit, and failures are retried by a timer command. The first-reply time is set when the owner's first reply is successfully sent.
- AD-24: **Inbound mail.**
  - Each Ticket has a reply-to address `t-<token>@reply.<domain>`.
  - Brevo's inbound-parse webhook is authenticated by a secret in the URL path, compared in constant time and rotatable.
  - The Ticket is read from the `Recipients` field, never from the subject or threading headers.
  - The webhook stores the message and its `MessageId` dedupe key atomically before acknowledging.
- AD-24: **Retention.** Closed Tickets are deleted 12 months after closing, and on request within 30 days.
- AD-25: **The contracts.** These are versioned, committed schemas with lossless round-trip fixtures:
  - **Family:** stable person ids; lineage edges; root-relative relationship codes; status of alive, died before or with the Deceased, or died later (with order); eligibility answers such as sect or religion; lifetime gifts and voluntary bequests per branch; estate and currency.
  - **Basis** (AD-18).
  - **Result:** per stable person id, allocation kind (fixed, residue, bequest, blocked, refused), exact fraction with its stage base, proof steps with typed parameters and rule and citation keys, and later-death layers.
  - **Comparison envelope** (AD-19).
  - **PresentedResult.**
  - **Preset and catalog schemas** (AD-17, AD-21).
- AD-25: **Ownership.** The wave-1 **foundation epic** owns these schemas and delivers:
  - the pure School engine with full corpus parity;
  - the Case command service with revisions;
  - presentation;
  - the i18n validator.
- AD-25: **Order.** The foundation ships first with unchanged School behaviour. Wave-1 features consume it. Later waves extend the published contracts additively and switch on presets and Locales only through their registry gates.
- AD-25: **Changes.** A change that alters meaning is a contract version bump with fixtures across every consumer.
- AD-26: **Trusted headers.** Client IP and country come only from headers Caddy strips and rebuilds. `CF-IPCountry` is trusted only when the origin is reachable solely through Cloudflare. Otherwise, and for `XX`, `T1` or any invalid value, the country is `unknown`. Country values are validated against ISO 3166-1.
- AD-26: **Bounds before work.** Body size, Heirs (50), later deaths (2), graph depth and MCP batch size are bounded. Admission (AD-23) runs before parsing into the engine. Each calculation request has an execution budget well inside the inherited 120 s bound.
- AD-26: **Cross-site and webhook.** Session endpoints keep CSRF. Public API and MCP endpoints are CSRF-exempt but never read the session cookie. The webhook takes no cookies.
- AD-26: **Logging.** Logs never contain request bodies, names, family data, API keys, reply tokens or prefill URLs.
- AD-27: **Budgets.** These are acceptance gates measured with both slots running before the wave that introduces them ships:
  - engine under 200 ms for a standard family;
  - Share preview p95 under 1 s end to end for 50 Heirs on a mid-range phone over 4G;
  - public API p95 under 1 s;
  - lock waits bounded inside those budgets.
- AD-27: **Observability.** Each new endpoint and timer emits redacted structured outcomes and low-cardinality latency, error and limit counts. A timer failure, outbox backlog or webhook rejection spike alerts the AD-8 operator.
- AD-27: **Recovery.** The restore runbook gains checks for the new tables. After a restore it reapplies Ticket deletions and API-key revocations. The matching release's preset and catalog files must be present.
- AD-27: **Drafts.** Phase-2 PDFs are non-canonical drafts, regenerated from current inputs. A canonical artifact still needs the inherited AD-11 decision.
- AD-1 + 2026-11-05 addendum: Public API, MCP, Ticket webhook, counters and timers all live in the one Django/Gunicorn image. Next.js stays a static export. A new process or container needs an AD-1 amendment. _(Inherited Invariants)_
- AD-2: One Hetzner host. No new managed service for counters, queues or tickets. _(Inherited Invariants)_
- AD-3: Cases, revisions, Tickets, outbox, API keys, counters and prefill tokens are PostgreSQL rows. Nothing durable lives in a container or a per-process cache. _(Inherited Invariants)_
- AD-5, AD-6: Snapshot and schema changes are expand → switch → contract. Every active and rollback-eligible image must preserve and correctly interpret every stored Case (AD-20). _(Inherited Invariants)_
- AD-7: Caddy is the only edge. Client IP and country are trusted only from headers Caddy rebuilds (AD-26). _(Inherited Invariants)_
- AD-8, AD-9: New endpoints add to readiness, logs and alerts; waves pass capacity gates (AD-27). _(Inherited Invariants)_
- AD-10: Presets with unchecked rules and unpublished Locales are usable only outside production. _(Inherited Invariants)_
- AD-11: No in-process threads. Deferred work (email retry, cleanup) is a durable row plus a management command on a systemd timer. Phase-2 PDFs are non-canonical drafts. _(Inherited Invariants)_
- AD-14: All phase-2 code, including API-key metering, is public AGPL-3.0 (NFR-5). _(Inherited Invariants)_
- AD-25: Codes: Relationship, School, refusal, proof, event and statute ids: stable lowercase snake_case, never renamed or reused; labels only from the catalog. _(Consistency Conventions)_
- AD-25: Preset identity: `preset_id` = ISO 3166-1 alpha-2 lowercase; `preset_version` = effective date `YYYY-MM-DD`. _(Consistency Conventions)_
- AD-25: Person identity: Stable opaque id per person within a Case, kept through edits, restore, save and share. _(Consistency Conventions)_
- AD-25: Revision: One monotonic integer per Case; every mutating request sends `expected_revision`. _(Consistency Conventions)_
- AD-25: Fractions: `{numerator, denominator}` integers, reduced, with the stage base named; never floats. _(Consistency Conventions)_
- AD-25: Money: `{amount_minor: int, currency: ISO 4217}` plus a server-formatted string; rounding half-up per allocation. _(Consistency Conventions)_
- AD-25: Locale and country: Locale = registry code; country = ISO 3166-1 alpha-2 or `unknown`. _(Consistency Conventions)_
- AD-25: Errors and refusals: Refusal `{status:"refused", reason}` with no shares; input error `{error: code, detail, candidates?}`; conflict `{error:"conflict", case}`. _(Consistency Conventions)_
- AD-25: Time: UTC in storage and in billing months; Locale formatting only at presentation. _(Consistency Conventions)_
- AD-25: Deferred work: Durable row + `manage.py` command + systemd timer; never a thread. _(Consistency Conventions)_
- AD-25: State mutation: Cases through the command service only; schema via Django ORM and committed migrations (inherited); presets and catalogs via git commits with tests. _(Consistency Conventions)_
- AD-1 / AD-21 / AD-22: Retain brownfield stack constraints: Python: 3.12 (`>=3.12,<3.13`); Django: 5.2.17 (LTS to 2028-04; 5.2.19 available); Django REST framework: 3.18.3; django-polymorphic: 4.1.0 (legacy `calc` models only); WeasyPrint: 70.0; Babel: 2.18.0; MCP protocol revision: 2026-07-28; MCP Python SDK: 2.3.0 (CI test client only); Next.js: 16.4.5 (static export; 16.4.6 available); React: 19.3.0; TypeScript: 5.9.3; PostgreSQL: 17.11 (inherited; 17.12 available); PDF fonts: Noto core + Noto CJK + an Urdu Nastaliq face, selected per Locale; Email: Brevo SMTP + inbound-parse webhook. Patch upgrades belong to code; TypeScript stays 5.x. _(Stack)_
- AD-3 / AD-20 / AD-23 / AD-24: Commit Django ORM migrations for SavedCase snapshot/schema_version/revision/name; PrefillToken token_hash/name-free family_and_basis/expires_at; Ticket, TicketMessage, optional API-key reference, transactional Outbox, APIKey, UsageCounter, RateWindow and EventCount. Explicitly backfill phase-1 SavedCase names and Basis, migrate guest snapshots on read and preserve legacy/share/invite/received readers and rollback compatibility through AD-20 expand — switch — contract. _(Structural Seed; AD-20)_
- AD-15 / AD-25: Enforce the dependency graph: engine imports only itself and the Python standard library; support/metrics never import engine; web computes no fiqh, shares, rounding or formatting; API/public API/reports render the shared presentation contracts; preset discovery and all I/O stay in shell modules. Retain engine, presets registry, i18n, calc adapter, api, presentation, public_api, support, metrics, reports and web module boundaries. _(Design Paradigm; Structural Seed)_

### UX Design Requirements

**Tokens & theming**

UX-DR1: [kept] Verify the shipped colour CSS custom properties and Tailwind mappings for background, foreground, muted, surface, line, accent and accent-foreground, including their dark pairs; follow prefers-color-scheme without a manual toggle. _(DESIGN tokens colors.*; Brand & Style; Colors)_

UX-DR2: [new] Implement the phase-2 colour properties graphic, accent-soft, blocked-stripe, scrim and toast-focus with dark pairs; retain the source's assumption status for derived dark colours. Use line only decoratively and graphic for perceptible boundaries; scrims are 40% light and 60% dark. _(DESIGN tokens colors.*; Colors)_

UX-DR3: [kept] Verify typography.body, heading-xl, heading-lg, label and small, the inherited rounded.sm/md/lg/xl and spacing scale, using system fonts without web-font loading; retain public-page layout tokens. _(DESIGN tokens typography.*, rounded.*, spacing.*; Typography; Shapes; Layout & Spacing)_

UX-DR4: [new] Implement phase-2 typography.node-name/node-meta/badge/body-rtl, rounded.node/sheet/full and Interview spacing/breakpoint tokens; preserve their source assumptions and open Urdu-font decision rather than treating deferred suggestions as approved changes. _(DESIGN tokens typography.*, rounded.*, spacing.*; Typography; Shapes; EXPERIENCE Gaps and open items)_

**Shared components & shell**

UX-DR5: [kept] Verify button-primary using components.button-primary.*: accent fill, label typography, minimum 44px height, one primary action per region; use it for Full results wherever that action appears. _(DESIGN Components)_

UX-DR6: [kept] Verify button-secondary using components.button-secondary.*: outlined resting state and surface hover, minimum 44px height. _(DESIGN Components)_

UX-DR7: [kept] Verify card using components.card.* for landing and information blocks, with surface, line border and rounded.xl. _(DESIGN Components)_

UX-DR8: [changed] Implement focus-ring using components.focus-ring.*: 2px outline and 2px offset on every focus-visible control, foreground/currentColor on accent fills and toast-focus inside the inverted toast; never clip the outline or replace it with box-shadow. _(DESIGN Components)_

UX-DR9: [kept] Verify choice-card using components.choice-card.*: resting, checked and focus-visible states, 2px border at 60% currentColor, full checked border with 10% tint, minimum 44px height and :has-focus-visible. _(DESIGN Components)_

UX-DR10: [changed] Extend site-nav using components.site-nav.* while retaining wrapped links, home/current-language emphasis and 1px bottom border at 20% currentColor; expose Home, Interview, signed-in My cases/account links and the language-switcher. _(DESIGN Components; EXPERIENCE Information Architecture)_

UX-DR11: [changed] Extend site-footer using components.site-footer.* while retaining its surface band, underlined links and muted note; include About, Terms, Privacy, Contact us, WhatsApp, API and the unreviewed-Locale Beta note. _(DESIGN Components; EXPERIENCE Information Architecture)_

UX-DR12: [changed] Update dialog to follow colors.background/foreground in dark mode [ASSUMPTION in source], preserving the shipped sign-in modal behaviour and 50% black backdrop; guest Save/Share and unauthenticated My cases resume the requested action after sign-in. Modal depth is one. _(DESIGN Components; Elevation & Depth; EXPERIENCE State Patterns; Information Architecture)_

**Family tree & Interview**

UX-DR13: [changed] Build tree-canvas using components.tree-canvas.*: dotted surface at 18px spacing, 1px top/bottom lines, token padding with at least 6px on every logical side, hint and toolbar above; labelled 2D scrolling, drag/swipe pan with touch-action: pan-y pinch-zoom, pinch zoom and Fit tree reset. Show one estate level; keep the deceased visible with up to 50 Heirs at 375px and 1280px. _(DESIGN Components; EXPERIENCE Component Patterns)_

UX-DR14: [changed] Implement tree-connector using components.tree-connector.*: 2px graphic strokes; mirror only the connector layer in RTL, placing cards by logical order without mirroring their text or badges. _(DESIGN Components; Do's and Don'ts)_

UX-DR15: [new] Implement zoom-toolbar using components.zoom-toolbar.*: Fit tree, plus and minus secondary buttons, 44px targets and 8px gaps; announce changed zoom through the shared live-region, providing a keyboard alternative to pinch. _(DESIGN Components; EXPERIENCE Component Patterns)_

UX-DR16: [changed] Implement normal tree-card using components.tree-card.*: native button with 1.5px graphic border, 108px width below 640px and 136px thereafter, minimum 76px height, bold relationship and optional smaller name/default numbered label; no avatars, initials or gender frames. Tap/Enter opens editing. _(DESIGN Components; EXPERIENCE Component Patterns)_

UX-DR17: [changed] Implement tree-card-deceased using components.tree-card-deceased.*: accent fill and contrasting text, labelled only "The deceased" / "المتوفى" across tree, outline, list and PDF; no relationship label or death symbol. _(DESIGN Components; Do's and Don'ts)_

UX-DR18: [new] Implement tree-card-died-before using components.tree-card-died-before.*: surface fill, dashed 2px graphic border with 4px dash/3px gap surviving 400% zoom and badge-died-before; person is not an heir but may have descendants below; Tap/Enter edits. _(DESIGN Components; Colors; EXPERIENCE Component Patterns)_

UX-DR19: [new] Implement tree-card-died-later using components.tree-card-died-later.*: solid 2px accent border and badge-died-later; Tap/Enter opens the person's estate, while the Heirs row remains the editing route. _(DESIGN Components; EXPERIENCE Component Patterns)_

UX-DR20: [changed] Implement tree-card-blocked using components.tree-card-blocked.*: decorative diagonal edge stripes, muted label and badge-no-share on a solid plate; text explicitly states no share, and Tap/Enter edits. _(DESIGN Components; EXPERIENCE Component Patterns)_

UX-DR21: [new] Implement tree-card-placeholder using components.tree-card-placeholder.*: dashed accent empty parent/spouse slot, "+ Add parent" or corresponding label; only engine-allowed slots appear, and tapping or dropping adds that relative. _(DESIGN Components; EXPERIENCE Component Patterns)_

UX-DR22: [kept] Verify selected tree-card state: 3px inset currentColor outline persists on the heir being edited, with aria-current="true". _(DESIGN Components, Selected state)_

UX-DR23: [new] Implement pointer drop-target states: deceased and Heirs accept engine-allowed relationship-chip drops, legal targets have a 2px accent border and illegal targets are dimmed [ASSUMPTION in source]. Refused drops/adds announce "Not allowed here: {reason}", preserve focus and leave the tree unchanged. No keyboard pick-up; Space/Enter press buttons. _(DESIGN Components, Drop target state; EXPERIENCE Interaction Primitives; State Patterns)_

UX-DR24: [new] Implement badge-died-before separately using components.badge-died-before.*: dashed graphic pill and visible "Died before" / "توفي قبله" text, without an icon. _(DESIGN tokens components.badge-died-before.*; Components)_

UX-DR25: [new] Implement badge-died-later separately using components.badge-died-later.*: accent outline/soft fill and "Died later · own estate" text, person-appropriate Arabic gender and an aria-hidden trailing chevron mirrored in RTL. _(DESIGN tokens components.badge-died-later.*; Components)_

UX-DR26: [new] Implement badge-no-share separately using components.badge-no-share.*: graphic outline, muted text and "No share in this case" / "لا نصيب في هذه الحالة". _(DESIGN tokens components.badge-no-share.*; Components)_

UX-DR27: [changed] Implement relationship-button using components.relationship-button.*: wrapping outlined wrappers with 44px add buttons grouped Spouse, Parents, Children, Siblings and More relatives. One press adds one by default without name entry, updates preview and retains focus; hide disallowed relationships and stop adds at 50 Heirs with a message. Accessible names contain visible relationship words; plus icons are decorative. _(DESIGN Components; Layout & Spacing; EXPERIENCE Component Patterns; State Patterns, Heir limit)_

UX-DR28: [new] Implement count-stepper using components.count-stepper.*: 44px square minus/plus, output at weight 700 and localized "Fewer/More {relationship}" names; minimum 1 and cap at 50-Heir capacity. Set n then press Add to add n [ASSUMPTION]; stepper presses do not independently announce preview changes. _(DESIGN Components; EXPERIENCE Component Patterns)_

UX-DR29: [new] Implement add-relative-action using components.add-relative-action.* on every focused card action row and in all edit states: identical "Add relative here" label, 44px target, list engine-allowed relationships and add one. This keyboard/touch path must reach every drag outcome. _(DESIGN Components; EXPERIENCE Component Patterns; Accessibility Floor)_

UX-DR30: [new] Implement heirs-list-header using components.heirs-list-header.*: heading row with persistent undo-control at its inline end, hidden when no undo exists. _(DESIGN Components; EXPERIENCE Component Patterns)_

UX-DR31: [new] Implement undo-control using components.undo-control.* in both Heirs list and Interview headers: 44px "Undo last change" button, independent of toast expiry; Ctrl/Cmd+Z performs the same multi-step history walk, one change per press. _(DESIGN Components; EXPERIENCE Component Patterns; State Patterns, Undo available)_

UX-DR32: [changed] Implement heir-row using components.heir-row.*: minimum 52px row with 44px Edit action and muted relationship, matching card labels/states through treeDescription; blocked rows say no share, died-later rows include badge and Open own estate. _(DESIGN Components; EXPERIENCE Component Patterns)_

UX-DR33: [changed] Implement edit-sheet using components.edit-sheet.* and shipped labelled 44px form styling: name, relationship, Alive at death/Died before/Died after before division status, Add relative here, conditional Open own estate and Remove. Save on change; phone modal sheet and desktop non-modal panel. Removing descendants or a linked later-death estate requires confirmation listing exactly everyone removed; cancellation changes nothing. _(DESIGN Components; EXPERIENCE Component Patterns; Key Flows UJ-2)_

UX-DR34: [new] Implement death-breadcrumb using components.death-breadcrumb.* directly above the canvas only within later-death estates: nav labelled "Estate level", 44px earlier-level links, current level plain semibold text and aria-hidden mirrored chevrons. At most three levels (deceased plus two later deaths); navigating focuses the tree heading. _(DESIGN Components; EXPERIENCE Component Patterns)_

UX-DR35: [new] Implement undo-toast using components.undo-toast.* after each add/edit/delete: inverted surface above the phone sticky bar, text Undo action, DOM order after Heirs list, no focus theft and status announcement via the shared region. At least 10 seconds, pause on hover/focus and restart afterwards; restore the exact family. New changes replace the toast without losing persistent multi-step history. _(DESIGN Components; EXPERIENCE Component Patterns; Interaction Primitives)_

**Share preview & Full results**

UX-DR36: [changed] Implement share-row using components.share-row.*: label, optional muted sub-line, bold end-aligned value; blocked rows are dimmed with smaller values and explicit no-share status. Show the teal agreement line above rows when all four Schools agree. _(DESIGN Components; EXPERIENCE Component Patterns)_

UX-DR37: [changed] Implement share-preview using components.share-preview.*: desktop third column and identical summary-sheet content, fraction/percentage/estate amount per Heir, FR-13 rounding line, blocked rows, agreement line, Basis link, Beta, disclaimer and primary Full results button. Synchronize tree, list and shares after every change; name School/Country only per FR-10. _(DESIGN Components; EXPERIENCE Component Patterns; Key Flows UJ-2)_

UX-DR38: [new] Implement sticky-summary-bar using components.sticky-summary-bar.* below 1280px: fixed full-viewport width, 2px foreground top border and token shadow, heir count/shares-ready text, primary Full results and 44px expand toggle. Hide until shares exist; visible without scrolling at 375px; bar tap or chevron opens summary-sheet. _(DESIGN Components; EXPERIENCE Component Patterns)_

UX-DR39: [new] Implement summary-sheet using components.summary-sheet.*: full Share preview, top-only rounded corners, 78% maximum height, token shadow/scrim and 2px foreground separation; heading and Close title bar has hairline divider and no shadow. Modal dialog makes sticky bar inert; Close, Escape or scrim closes and returns focus to chevron. _(DESIGN Components; Elevation & Depth; EXPERIENCE Component Patterns)_

UX-DR40: [kept] Verify Full results table retains inheritance-table.tsx styling, screen-reader caption, bordered table, active row at 10% currentColor, dotted-underlined proof buttons and LTR-isolated fractions. _(DESIGN Components, Full results table)_

UX-DR41: [changed] Implement full-results-actions using components.full-results-actions.*: Download PDF primary, Save/Share link/WhatsApp secondary, wrapping with 12px gaps; preserve shipped guest Save/Share sign-in-and-resume behaviour. _(DESIGN Components; EXPERIENCE Component Patterns)_

UX-DR42: [new] Implement case-name-field using components.case-name-field.*: labelled input with 1px muted boundary meeting 3:1, 100-character counter and limit, any script; prefill "Estate of {Deceased name or label}, {date}" and support inline rename in My cases. _(DESIGN Components; EXPERIENCE Component Patterns)_

**Basis / Country law UI**

UX-DR43: [changed] Implement school-prompt using components.school-prompt.* and choice-cards, with short question and 12px padding: default to comparison of all four Schools without an upfront Basis step. Only prompt when Schools differ, showing differing shares side by side until selection; agreement uses "Same result in all four Sunni schools" rather than a calculated-under line. _(DESIGN Components; EXPERIENCE Component Patterns; State Patterns, Schools differ; Key Flows)_

UX-DR44: [new] Implement country-law-link using components.country-law-link.*: always available optional underlined 44px "Calculate under a country's law" action opening the live preset list; choice sets Basis/recalculates and Back to all four Schools resets it. _(DESIGN Components; EXPERIENCE Component Patterns)_

UX-DR45: [new] Implement country-law-list using components.country-law-list.*: data-driven choice-cards for live presets only, each with name/version date and Beta where unreviewed, plus secondary Back to all four Schools. Do not hard-code preset lists. _(DESIGN Components; EXPERIENCE Component Patterns; Gaps and open items)_

UX-DR46: [new] Implement smart-prompt using components.smart-prompt.* after shares in preview/results only when a Country law changes them: 1px accent border, 5px inline-start edge, full-width 44px live-preset actions and 44px Not now. Include the obligatory-bequest gloss; selecting recalculates, dismissal persists for the Case while link remains. Never block preview or move focus. _(DESIGN Components; EXPERIENCE Component Patterns; State Patterns, Country-law prompt)_

UX-DR47: [changed] Implement notice using components.notice.*: plain text, 1px border at 60% foreground, 12px padding and semibold disclaimer; non-dismissible disclaimer on preview/results/PDF, Country notice only for that law and civil-law notice for School Basis in every Locale. No new error/status colours [ASSUMPTION]; refusal/error notice has an icon-free text label. _(DESIGN Components; Colors; EXPERIENCE Component Patterns)_

UX-DR48: [new] Implement badge-beta using components.badge-beta.*: accent outline/soft-fill pill with nearby explanation of unreviewed law/translation, never user-hideable, shown where applicable in Basis list, preview, results, footer and PDF. "Beta" / "تجريبي" label is a source assumption. _(DESIGN Components; EXPERIENCE Component Patterns; State Patterns, Beta)_

**Locales, RTL & typography**

UX-DR49: [changed] Implement language-switcher using components.language-switcher.*: retain ar/en/fr and add ur/hi/tr/id/ms/de/es/it/zh from Locale data, each name in its own script with lang/dir and 44px target; current language is semibold, aria-current and not a link. _(DESIGN Components; EXPERIENCE Foundation; Component Patterns; Gaps and open items)_

UX-DR50: [changed] Implement Locale markup/formatting from one registry and RTL list covering ar and ur: page lang/dir; Locale numerals/fractions/amounts/dates matching PDF; Arabic terms visibly in <bdi lang="ar" dir="rtl"> beside translations, names in <bdi dir="auto">, fractions dir="ltr" and amounts isolated. English fallback has lang="en", never blank; CI blocks missing keys. _(DESIGN Typography; Do's and Don'ts; EXPERIENCE Accessibility Floor; Key Flows UJ-4)_

UX-DR51: [changed] Apply Arabic-capable font stacks to all text and typography.body-rtl fallback order; retain Urdu font as open and Urdu line-height 1.7 as an assumption. Keep node-name/node-meta/badge text confined to cards/badges and badge text at its stated size or larger on accent-soft, without tint changes. _(DESIGN Typography; Colors)_

**Contact & support**

UX-DR52: [new] Implement contact-form using components.contact-form.* and case-name-field styling: labelled topic (including API access and Question about my result), message, email, optional Case link and one primary submit; never require case data. Inline plain-text validation; send failure preserves text and offers WhatsApp. Contact route /{locale}/contact/ is an assumption; link from footer, refusal and results help. _(DESIGN Components; EXPERIENCE Component Patterns; Information Architecture; Key Flows UJ-5)_

UX-DR53: [new] Implement Contact sent state: display Ticket number and email-sent confirmation, keep WhatsApp visible, send the number by email and keep subsequent owner reply in the same thread; support direct WhatsApp contact. _(EXPERIENCE State Patterns; Key Flows UJ-5)_

**States (empty/loading/error/offline)**

UX-DR54: [new] Implement Empty Interview state: deceased plus allowed placeholders only, "No heirs yet. Press a relationship to add one." in Heirs list, blank preview and hidden sticky bar. _(EXPERIENCE State Patterns)_

UX-DR55: [new] Implement skeleton-line using components.skeleton-line.* for Cold load on Interview/results/cases: 12px layout-shaped bars, region aria-busy, usable page and reduced-motion-safe shimmer. _(DESIGN Components; EXPERIENCE Component Patterns; State Patterns)_

UX-DR56: [changed] Implement Preview updating state: preserve old shares in a muted colour pair without opacity reduction, aria-busy=true, Updating only after 3 s; about 800 ms announcement debounce, no layout jump or rewriting unchanged rows, update under 1 s p95. _(EXPERIENCE State Patterns; Accessibility Floor)_

UX-DR57: [new] Implement Later death added state: badge and shared live announcement explaining Open own estate; initialize that estate empty with placeholders. _(EXPERIENCE State Patterns)_

UX-DR58: [new] Implement Later-death estate open state: named estate heading and breadcrumb, tree/list/preview switched to that estate and Add relatives scoped to it; preserve the person's share in the first estate and explain separate calculation. _(EXPERIENCE State Patterns; Key Flows UJ-2)_

UX-DR59: [new] Implement Later-death limit state: at two later deaths hide the additional choice with "A case can hold up to two later deaths."; existing ones stay editable, a third is refused without mutation. _(EXPERIENCE State Patterns; Key Flows UJ-2)_

UX-DR60: [new] Implement status-line using components.status-line.*: plain one-line boxed muted Updating/Still working/offline variants, no modal or focus theft and no animation under reduced motion; the line itself never blocks input. _(DESIGN Components; EXPERIENCE Component Patterns)_

UX-DR61: [new] Implement Saving/saved/save-failed states with inline Saving/Saved to My cases/failure text and Retry, retaining the family; use the same line for PDF generating/failed and share-link created/copied states, preserving draft wording status. _(EXPERIENCE State Patterns)_

UX-DR62: [kept] Verify Preview error uses the shipped plain message and Retry pattern without losing family data. _(EXPERIENCE State Patterns)_

UX-DR63: [new] Implement Refusal state across preview/results/API: localized engine reason in notice, no numbers and Contact us action; cover unsupported School, Malikiyya, impossible family and Lebanon Shia/non-Muslim cases, with "Was the deceased Sunni?" question under that preset. _(EXPERIENCE State Patterns)_

UX-DR64: [new] Implement Preset updated state on saved/shared cases: show stored version and "A newer version exists. Recalculate?"; never silently recalculate. _(EXPERIENCE State Patterns; Key Flows UJ-3, UJ-6)_

UX-DR65: [kept] Verify returning unsaved Guest Case shows shipped resume/start-over prompt within 24 hours [ASSUMPTION]; Saved cases open directly without it. _(EXPERIENCE State Patterns; Key Flows UJ-3)_

UX-DR66: [new] Implement Expired case state on Interview/shared/prefilled links: plain "This case has expired", explain guest 24-hour/prefill 7-day lifetimes [ASSUMPTIONS], one new-Case action and no family data. _(EXPERIENCE State Patterns)_

UX-DR67: [new] Implement Offline/slow state: persist family and last preview with "You're offline. Reconnect to keep editing."; disable add/edit/delete/Undo until reconnection, without a client queue. After about 3 s slow work retain Updating and show Still working. _(EXPERIENCE State Patterns)_

UX-DR68: [new] Implement Rate limited state on API page/Contact: "Too many requests; try again after {time}" and route to request an API key. _(EXPERIENCE State Patterns)_

**Accessibility**

UX-DR69: [changed] Verify WCAG 2.1 AA in every Locale including RTL with Playwright axe on Interview/results; every interactive target is at least 44px, every input is labelled and visible state text/badges accompany styling. _(EXPERIENCE Accessibility Floor; DESIGN Do's and Don'ts)_

UX-DR70: [changed] Verify text contrast >=4.5:1 in both modes: foreground/background 17.93/16.91, muted/background 7.56/8.94, accent-foreground/accent 5.47/9.78, accent/background 5.47/13.4, accent/surface 5.06/12.01 and accent/accent-soft 4.71/10.29. _(DESIGN Colors)_

UX-DR71: [changed] Verify essential graphic/focus boundaries >=3:1: graphic/background 3.75/4.24, graphic/surface 3.46/3.80, graphic/accent-soft 3.23/3.26; accent ring/background 5.47/13.4 and surface 5.06/12.01; toast-focus/fill 17.93/16.91. Decorative line is only 1.37:1 on white; accent ring on dark toast is only 1.26:1, so use toast-focus. _(DESIGN Colors; EXPERIENCE Accessibility Floor)_

UX-DR72: [changed] Implement custom tree accessibility model: native buttons in one Family tree role=group with a single roving tab stop, visible-text names and aria-current selection, not role=tree/application. Heirs list is the canonical outline including deceased/all Heirs, relationships, badges and no-share state from treeDescription; test Arabic with NVDA/Chrome, VoiceOver/Safari iOS and TalkBack. _(EXPERIENCE Accessibility Floor)_

UX-DR73: [new] Implement tree keyboard navigation: Tab enters current card and leaves without trapping; Up parent, Down first child, Start/End arrows previous/next sibling mirrored in RTL, Home deceased, End last card, Enter edit or died-later estate, Delete confirmation, Escape close, +/- zoom. Cover RTL in Playwright; relationship-buttons/Add relative here provide all add operations. _(EXPERIENCE Accessibility Floor)_

UX-DR74: [changed] Implement focus management: phone sheets use showModal(), inert background/native trap/Escape plus Close; edit opens first field, summary opens heading, close returns to opener. Desktop edit panel follows tree in Tab order, opens first field and Escape returns to card; Remove focuses next sibling, else previous, else deceased; Undo restored card; estate navigation tree heading. _(EXPERIENCE Accessibility Floor)_

UX-DR75: [new] Implement live-region (no visual token group): one shared polite role=status, aria-atomic for preview/add/remove/undo/zoom, about 800 ms coalescing into one sentence per change; never announce share rows or stepper presses separately, announce Updating only past 3 s, reserve role=alert for refusals and avoid rewriting unchanged rows. _(EXPERIENCE Component Patterns; Accessibility Floor)_

UX-DR76: [changed] Implement 300ms node reflow and disable node motion, sheet slides, scrim fade, toast entry, skeleton shimmer, zoom animation and smooth scroll under prefers-reduced-motion without loss of function; retain prefers-color-scheme support. _(EXPERIENCE Interaction Primitives; Accessibility Floor)_

**Responsive**

UX-DR77: [changed] Implement below-1024px single-column Interview in Add relatives/tree/Heirs list order with 16px gutter; under 640px use narrow 108px cards and phone bottom edit sheet, 640–1023px use 136px cards and wrapping buttons; preview remains full-width sticky bar/sheet. Other phone surfaces are single column with labelled horizontal results-table scroll; tablet surfaces use max-w-5xl. _(DESIGN Layout & Spacing; EXPERIENCE Responsive & Platform)_

UX-DR78: [changed] Implement 1024–1279px two columns: 380px Add relatives/Heirs list plus flexible tree at least 596px (two 136px cards), side edit panel and sticky preview/sheet without a third preview column. _(DESIGN Layout & Spacing; EXPERIENCE Responsive & Platform)_

UX-DR79: [changed] Implement >=1280px three columns in a 1360px maximum Interview: 380px relatives/list, flexible tree and 340px preview with 24px padding and 1px dividers; no sticky bar, Full results in preview and side edit panel. Preserve public 1024px max content, 24px gutters and 48px/64px vertical rhythm. _(DESIGN Layout & Spacing; Components; EXPERIENCE Responsive & Platform)_

UX-DR80: [new] Implement WCAG 1.4.10 reflow at 320px/400% zoom: bar wraps below 360px into text then button/chevron rows; bar plus toast <=25% viewport height with equal scroll-padding-block-end. Page scrolls, canvas alone is labelled nested 2D scroll region with >=6px focus padding. Under 480px landscape height replace bar with in-flow Share preview button. Test 320px/400% LTR/RTL with text-spacing overrides. _(DESIGN Layout & Spacing; EXPERIENCE Accessibility Floor)_

UX-DR81: [changed] Mirror layouts including columns, directional chevrons and steppers in RTL using only logical properties; never transform the whole tree. Support touch first plus full mouse/keyboard use; print only via PDF. _(DESIGN Do's and Don'ts; EXPERIENCE Responsive & Platform)_

**Voice & copy**

UX-DR82: [kept] Verify calm, plain, compassionate short copy and flat reference identity: one teal accent, surface panels and 1px lines; no ornament, illustration, death symbols, gender frames, celebratory motion or authority claims. Keep calculation-aid/not-fatwa/not-legal-advice wording and qualification advice visible; no certified/court-approved/official claims or status reds/greens/amber. _(DESIGN Brand & Style; Colors; Elevation & Depth; EXPERIENCE Voice and Tone; Inspiration & Anti-patterns)_

UX-DR83: [changed] Implement/review the Voice and Tone table's English/Arabic message pairs for deceased, before/later death, edit status, breadcrumb, blocked, agreement, preview, Full results, disclaimer, law/translation Beta, smart prompt, Undo, refused add and 50-Heir limit, retaining Arabic draft/owner-review status and the open female-deceased Arabic question. Name relatives plainly, number defaults in current Locale, require no names and never call a user's family wrong; no hover-only controls or stacked modals. _(EXPERIENCE Voice and Tone; Gaps and open items; Interaction Primitives)_

**Journey-specific behaviour**

UX-DR84: [new] Implement UJ-1 estate guidance and Egyptian bequest presentation: debts/joint assets hint; descendants beneath died-before Karim; obligatory bequest capped at 1/3 with "Egyptian Wills Law 71/1946, art. 76" citation and unreviewed-law Beta. Exclude non-live Egypt preset; dismissal keeps all-four-Schools preview/link; draft PDF can be sent by WhatsApp. _(EXPERIENCE Key Flows UJ-1)_

UX-DR85: [changed] Implement My cases return/save flow at /{locale}/cases/: saved named family opens straight into Interview, sorted by last change, supports rename/new Case/received invites; session expiry signs in then returns to the same Case. Preserve Landing /{locale}/, Interview /{locale}/interview/, results /{locale}/results/ and shipped account/legal/about navigation. _(EXPERIENCE Information Architecture; Key Flows UJ-2, UJ-3)_

UX-DR86: [new] Implement UJ-4 Urdu results/PDF path: اردو switch produces RTL with translated relationships and Arabic terms, unreviewed-translation Beta, all-four-Schools agreement line and the UK civil-law estate notice under the specified journey conditions; visible English fallback never blank. _(EXPERIENCE Key Flows UJ-4)_

UX-DR87: [new] Implement Country-law proof/bequest result extension: obligatory bequest has its own table row and small article citation; UJ-6 Moroccan choice "Loi marocaine (Code de la famille 2004)" leads to article-cited shares/proof and pending-reform notice, with private sharing and pinned version visible. _(DESIGN Components, Full results table; EXPERIENCE Key Flows UJ-6)_

UX-DR88: [new] Implement shared-case-banner using components.shared-case-banner.* on /{locale}/shared/: read-only statement, preset name/version date and newer-version message; preserve /{locale}/received/ and /{locale}/invite/ entry paths from invites/My cases. _(DESIGN Components; EXPERIENCE Information Architecture; Component Patterns)_

UX-DR89: [new] Implement UJ-7 prefilled arrival: token-only URL loads Interview family/Basis with matching tree and assistant fractions/preview, disclaimer, agreement fact and draft PDF path; expired token uses Expired case and unsupported rules return reason without numbers. Assistant looks up relationship codes and clarifies ambiguous relatives before calculate_inheritance. _(EXPERIENCE Key Flows UJ-7)_

UX-DR90: [new] Implement API information surface /{locale}/api/ [ASSUMPTION: route] linked from footer/rate-limit message: OpenAPI, MCP setup, usage terms and key request via API access Ticket. Retain responsive web on Next.js 16/React 19/Tailwind CSS 4 with handwritten shared ui.ts components, static export served by Django and prefetch=false on every Link. _(EXPERIENCE Information Architecture; Foundation; Key Flows UJ-7)_

### FR Coverage Map

FR-1: Epic 9 - One-press relationship buttons
FR-2: Epic 9 - Drag relationships onto the tree
FR-3: Epic 9 - Select, edit, delete on the tree
FR-4: Epic 9 - Add several Heirs at once
FR-5: Epic 9 - Multi-step undo
FR-6: Epic 14 - Relationships reachable by bequest and distant-kin rules
FR-7: Epic 10 - Open Saved case straight into the Interview
FR-8: Epic 10 - Name and rename Saved cases
FR-9: Epic 8 - Pre-phase-2 and legacy Saved cases keep working
FR-10: Epic 11 - Name the School or Country law only when it matters
FR-11: Epic 11 - Full results as a primary button
FR-12: Epic 11 - Explain "estate to divide"; state supplied facts
FR-13: Epic 11 - Consistent rounding that adds up
FR-14: Epic 15 - School-Basis prompt about the Obligatory bequest
FR-15: Epic 14 - Start on all four Schools; change Basis from results
FR-16: Epic 15 - Obligatory bequest engine
FR-17: Epic 14 - Preset rule switches and default School for gaps
FR-18: Epic 14 - Statute and article citations in proof and PDF
FR-19: Epic 14 - Store Basis and preset version with results
FR-20: Epic 14 - Country preset Beta label
FR-21: Epic 14 - Refuse when the preset does not cover a rule
FR-22: Epic 14 - Owner go-live gate per preset
FR-23: Epic 16 - Estate currency choice and defaults
FR-24: Epic 16 - Locale number and date formats
FR-25: Epic 16 - Country law notice in every Locale
FR-26: Epic 16 - Civil-law notice under a School Basis
FR-27: Epics 18, 19 - Nine new Locales across the product
FR-28: Epics 18, 19 - Agreed fiqh terms per Locale
FR-29: Epics 18, 19 - Unreviewed-Locale Beta label
FR-30: Epics 18, 19 - Findable public pages per Locale
FR-31: Epic 12 - Terms and privacy match the product
FR-32: Epic 12 - Owner review of Arabic and French strings
FR-33: Epic 12 - Owner review of proof, refusal and kinship texts
FR-34: Epic 13 - Contact form creates a Ticket
FR-35: Epic 13 - Owner replies in one email thread
FR-36: Epic 13 - WhatsApp support link
FR-37: Epic 13 - Ticket retention and deletion
FR-38: Epic 20 - Public calculation API
FR-39: Epic 20 - OpenAPI document with codes and names
FR-40: Epic 20 - MCP server tools
FR-41: Epic 20 - Prefilled Interview link in results
FR-42: Epic 20 - Keyless free-limit access
FR-43: Epic 20 - Billable API keys via Ticket
FR-44: Epic 12 - Cookie-free server event counts
FR-45: Epic 12 - Repeatable SM-1 usability test
FR-X1: Epics 14, 15, 17 - Seven Country presets (SA, LB / EG, MA / JO, AE, DZ)

## Epic List

Phase 2 continues phase-1 numbering (Epics 1–4 shipped here; 5–7 live in the private marketplace repo). Waves follow PRD §6.1; each wave is releasable on its own.

**Dependencies:** Epic 8 precedes all others (AD-25 foundation). Epics 9–13 need only 8. Epic 14 needs 8 and 11. Epic 15 needs 14. Epic 16 needs 8 (its Country notices go live with 14). Epic 17 needs 14 and 15. Epic 19 needs 18. Epic 20 needs 8, 13 and 14. No epic depends on a later one.

### Wave 1 — Easier and correct

### Epic 8: One calculation core — the same answer everywhere
Families get identical shares on screen, in the PDF and in Saved cases, and every phase-1 Saved case keeps opening. Delivers the AD-25 foundation with unchanged School behaviour: versioned Family/Basis/Result/Comparison/PresentedResult contracts, the pure `engine/` core at full corpus parity (AD-15 switch gate), the Case command service with revisions (AD-20), the presentation layer (AD-19) and the i18n catalog validator (AD-21).
**FRs covered:** FR-9 (also NFR-2)

### Epic 9: Build a family fast on an editable Family tree
Users add Heirs with one press, drag relationships onto the tree, select and edit or delete on the tree, add several at once, and undo any change — on phone and desktop, by keyboard and screen reader.
**FRs covered:** FR-1, FR-2, FR-3, FR-4, FR-5 (also NFR-1, NFR-3, NFR-X1)

### Epic 10: Named Saved cases that open directly
Registered users open a Saved case from *My cases* straight into the Interview with its family loaded, and name or rename it.
**FRs covered:** FR-7, FR-8

### Epic 11: Clearer results
Results name the School only when it matters, Full results is a primary button, users understand "estate to divide" and see which facts they supplied, amounts add up to the estate, and phones get the sticky summary bar and sheet.
**FRs covered:** FR-10, FR-11, FR-12, FR-13

### Epic 12: Honest pages and privacy-safe measurement
Terms and privacy pages match the product; the owner's Arabic/French, proof, refusal and kinship-label review passes land; product events are counted on the server without cookies or personal data; the owner can rerun the SM-1 usability test. Decides retirement of the legacy results pages and the Google Analytics tag.
**FRs covered:** FR-31, FR-32, FR-33, FR-44, FR-45

### Epic 13: Ask for help and get an answer
Any visitor sends a question through the Contact form, gets a Ticket number by email, and continues the exchange in one email thread; a WhatsApp link reaches support; Ticket data is minimised and deletable.
**FRs covered:** FR-34, FR-35, FR-36, FR-37

### Wave 2 — Country law, first presets

### Epic 14: Calculate under a country's law — Saudi Arabia and Lebanon
Users switch the Basis from the Share preview or Full results to a live Country law and get shares with statute citations, a Beta label, version stamps on saved, shared and PDF results, and honest refusals where the preset is silent. Ships the preset machinery (versioned TOML presets; rule switches for *radd*, distant kin, grandfather with siblings, mushtaraka and akdariyya; default School for gaps, Saudi Arabia Hanbali), the extended relationship list, the owner go-live gate, and the two presets without an Obligatory bequest: Saudi Arabia and Lebanon (Sunni, with the sect question).
**FRs covered:** FR-6, FR-15, FR-17, FR-18, FR-19, FR-20, FR-21, FR-22, FR-X1 (Saudi Arabia, Lebanon)

### Epic 15: Obligatory bequest for grandchildren — Egypt and Morocco
Descendants of an Heir who died before or with the Deceased receive their Obligatory bequest under the Country law (1/3 cap, 2:1 split, gift offset, each country's method), and users on a School Basis are told when a country's law would give those descendants a share. Adds the Egypt and Morocco presets.
**FRs covered:** FR-14, FR-16, FR-X1 (Egypt, Morocco)

### Epic 16: Money, numbers and notices that fit the country
Users choose the estate currency (defaulting from the Country law or Locale), see numbers and dates in their Locale's conventions on screen and in the PDF, read each Country law's notice, and get the civil-law notice under a School Basis in every Locale.
**FRs covered:** FR-23, FR-24, FR-25, FR-26

### Wave 3 — More countries and first languages

### Epic 17: Jordan, UAE and Algeria presets
Users in Jordan, the UAE and Algeria can calculate under their Country law, each preset going live only through the FR-22 gate.
**FRs covered:** FR-X1 (Jordan, UAE, Algeria); reuses FR-16 to FR-22

### Epic 18: Use Mawareeth in Urdu, Hindi, Turkish, Indonesian and Malay
Users use the whole product (Interview, results, proof, PDF, account pages, emails) in five new Locales, with Urdu right-to-left, agreed fiqh terms with the Arabic term beside relationship names, Beta labels for unreviewed translations, and findable public pages.
**FRs covered:** FR-27, FR-28, FR-29, FR-30 (ur, hi, tr, id, ms)

### Wave 4 — More languages and AI access

### Epic 19: German, Spanish, Italian and Chinese
The same Locale pipeline delivers the remaining four languages.
**FRs covered:** FR-27, FR-28, FR-29, FR-30 (de, es, it, zh)

### Epic 20: AI assistants can calculate with Mawareeth
Any client or AI assistant calculates through the public API or MCP server without a key within a free limit, gets a link that opens the prefilled Interview, and heavy users request a billable API key through a Ticket.
**FRs covered:** FR-38, FR-39, FR-40, FR-41, FR-42, FR-43

## Epic 8: One calculation core — the same answer everywhere

Families get identical shares on screen, in the PDF and in Saved cases, and every phase-1 Saved case keeps opening. Delivers the AD-25 foundation with unchanged School behaviour: versioned Family/Basis/Result/Comparison/PresentedResult contracts, the pure `engine/` core at full corpus parity (AD-15 switch gate), the Case command service with revisions (AD-20), the presentation layer (AD-19) and the i18n catalog validator (AD-21).

### Story 8.1: Preserve Case meaning through versioned shared contracts

As the owner/maintainer,
I want versioned domain schemas and lossless fixtures shared by every consumer,
So that later changes cannot silently reinterpret a family's inputs or shares.

**Acceptance Criteria:**

**Given** the existing session, preview, proof and SavedCase contracts
**When** the foundation schemas are committed
**Then** Family, Basis, Result, Comparison, PresentedResult, preset and catalog schemas have explicit versions and Python/TypeScript boundary fixtures (AD-25)
**And** Family retains stable opaque person ids, lineage edges, root-relative relationship codes, alive/died-before-or-with/died-later status and order, eligibility answers, branch gifts and voluntary bequests, estate and currency without enabling later-wave features; parsing validates structure only, and whether a family's relationships and edges make sense is decided by the engine queries of Story 8.4 (reconciled 2026-11-18).

**Given** a Result containing blocked people, a refusal or later-death layers
**When** it is serialized and parsed again
**Then** reduced integer numerator/denominator pairs, stage bases, allocation kinds, typed proof parameters, rule/citation keys and person identities round-trip without floats or loss (NFR-2, AD-25)
**And** Comparison and PresentedResult fixtures represent agreement, difference, selection-required and partial-refusal states.

**Given** input to the shared Basis resolver
**When** it supplies compare, School or pinned Country fields
**Then** exactly the AD-18 discriminated shape is accepted, with a Country School derived rather than stored (AD-18)
**And** malformed current input or an unavailable pinned version returns a typed error; only a legacy snapshot with no basis derives a valid School from madhab or otherwise compare, never Country.

**Given** contract consumers and fixtures
**When** a meaning-changing change is proposed
**Then** a version bump and fixtures across affected consumers are required (AD-25)
**And** stable lowercase snake_case codes are never renamed or reused, typed errors/refusals/conflicts follow the consistency conventions, and this story adds no database fields or switches any consumer.

### Story 8.2: Reproduce existing single-estate School answers in memory

As a family member using Mawareeth,
I want the existing School calculations to work without temporary database rows,
So that the faster calculation path preserves the answer I already rely on.

**Acceptance Criteria:**

**Given** existing single-estate rules in calc/models.py, calc/schools.py and calc/proof.py
**When** engine.calculate(family, rule_set) evaluates a built-in School rule set
**Then** it returns immutable Result values with exact fractions, blocked statuses, proof codes and scholars-table evidence matching the existing single-estate corpus (NFR-2, AD-15, AD-25)
**And** extraction preserves awl, radd, shared fixed shares, grandmother rules, grandfather options and special-case behaviour without a fiqh correction.

**Given** the existing distribution, School, proof, invariant and entry-order fixtures in calc/tests.py
**When** those fixtures exercise the new single-estate core alongside the original path
**Then** every supported School's fractions, statuses and deterministic proof/table evidence match after explicit stable-id mapping (AD-15)
**And** the comparison includes unallocated estate rather than testing only inheriting people.

**Given** unsupported Ja'fari, the existing Maliki Malikiyya case, an impossible family or an unknown School code
**When** the core evaluates the input
**Then** existing refusal behaviour and stable reason codes are preserved, with no shares on a refusal and a typed input error for an invalid code (AD-15, AD-25)
**And** deferred scholarly questions, including Shibh al-Malikiyya, do not change School behaviour.

**Given** parsed preset data or a built-in School definition
**When** the core constructs its immutable RuleSet
**Then** parse_preset(data) applies schema defaults and rejects invalid data without file discovery or I/O (AD-15, AD-25)
**And** no production Country preset is introduced and existing consumers remain on the original engine until the complete switch gate passes.

### Story 8.3: Preserve successive-death answers and proof inside the core

As a family member using Mawareeth,
I want successive deaths calculated by the same in-memory core,
So that a person's final share and its explanation stay consistent across estate layers.

**Acceptance Criteria:**

**Given** the current calc/manasikhat.py implementation and ManasikhatTests and LayeredTableTests corpus
**When** engine.calculate evaluates equivalent layered Family fixtures
**Then** composition occurs entirely inside engine and matches all existing final fractions, death-order decisions, layered proof and scholars-table evidence (NFR-2, AD-15)
**And** linked rows resolve to stable person identities with the existing earliest-row naming identity retained at the presentation boundary.

**Given** a family with two later deaths and people linked between estates
**When** its Result round-trips and the calculation is repeated
**Then** the root estate plus both later-death layers retain their stage bases, deceased identities, multipliers and combined exact fractions (AD-25)
**And** entry-order variations supported by the existing corpus produce the same semantic answer.

**Given** an unsupported, incomplete or inconsistent later-death family from the current corpus
**When** the core evaluates it
**Then** existing refusal or incomplete-state semantics are preserved without leaking partial shares as a completed answer (AD-15)
**And** no School rule or later-death product limit is redefined in this extraction.

**Given** the complete single-estate and later-death corpus
**When** it is run against the candidate pure core
**Then** full core parity is demonstrated and engine has no ORM or translation dependency (AD-15)
**And** adapters and presentation still require their own parity evidence before any consumer switches.

### Story 8.4: Give every family action one engine decision

As a family member using Mawareeth,
I want relationship choices, refusals and calculation decisions to agree,
So that changing the same family through different controls cannot produce contradictory answers.

**Acceptance Criteria:**

**Given** a Family and resolved rule set
**When** engine queries ask what relationships can be added at a position or whether a drop/edit is impossible
**Then** the answer uses the same rules as calculate, including second-parent/spouse conflicts and blocked relatives (AD-16)
**And** blocked-but-valid relatives remain distinguishable from impossible additions, with stable codes and no translated text.

**Given** descendants or a linked later-death estate
**When** the delete-impact query is called
**Then** it returns the complete deterministic set of affected stable person ids for a subsequent atomic command (AD-16, AD-25)
**And** querying alone leaves the Family unchanged, including on an invalid target.

**Given** a rule set and an explicitly supplied eligible-preset collection
**When** required-facts, refusal or share-changing-preset queries are called
**Then** their answers come from engine rules and use typed codes (AD-16)
**And** wave-1 Schools preserve current behaviour, Country execution remains disabled, and later-wave sect questions and bequest comparisons use these interfaces rather than shell tables.

**Given** api/heir_rules.py, anonymous_case relationship options and browser eligibility logic
**When** their decisions are routed through the query boundary
**Then** they no longer maintain independent fiqh tables, while display-only grouping remains in the shell (AD-16)
**And** the 50-Heir and two-later-death limits remain command-service responsibilities, not fiqh queries.

**Given** a direct or transitive forbidden dependency or an engine I/O/clock/global-state operation
**When** CI checks the foundation
**Then** an import-graph gate rejects engine imports outside engine and the Python standard library, including indirect Django/translation imports (AD-15)
**And** purity checks cover file access, clock reads and mutable global state; shell file discovery stays outside engine and support/metrics cannot import it.

### Story 8.5: Keep terms and Locale settings consistent across consumers

As the owner/maintainer,
I want one validated term catalog and Locale registry,
So that screen, proof, email and PDF text cannot silently diverge or become blank.

**Acceptance Criteria:**

**Given** existing ar/en/fr terms in calc/proof.py, calc/schools.py, web/src/i18n/messages.ts and locale/*/LC_MESSAGES/django.po
**When** their ownership is consolidated
**Then** fiqh terms, Basis/School labels, refusal reasons and typed proof templates live under stable codes in i18n/terms/<locale>.json as {text, review} (AD-21)
**And** general UI copy stays in messages.ts and .po, Arabic originals are referenced by code, and existing unreviewed text is not marked reviewed; the legacy heir-class msgids, report combination labels and the results/table fiqh copy in messages.ts and .po stay outside the catalog until Epic 12 (reconciled 2026-11-18; tracked in deferred-work).

**Given** i18n/locales.json
**When** Django, Next.js, PDF and SEO consumers obtain Locale configuration
**Then** code, direction, Babel locale, numbering_system, own-script name, font stack, publication and review state derive from that registry (AD-21)
**And** only current ar/en/fr publication is retained; future Locale/preset schema support does not publish new languages or laws.

**Given** a missing/empty catalog, UI, email, PDF or server-message key, or mismatched typed named placeholder
**When** the single validator/generator runs
**Then** it reports the precise Locale/key error and CI fails (AD-21, NFR-X7, UX-DR50)
**And** valid input generates a deterministic typed Next.js module, with generated-output drift rejected.

**Given** current catalogs containing empty translations or gettext metadata
**When** they are brought under the gate
**Then** actual message gaps are resolved without silently exempting a Locale or erasing review status, while non-message PO headers are treated as metadata (AD-21)
**And** publication requires the validator and PDF glyph check to pass for the registered font stack; missing glyphs block publication.

### Story 8.6: Produce one presented answer for every renderer

As a family member using Mawareeth,
I want one server-produced interpretation of my calculation,
So that labels, comparisons and amounts mean the same thing on screen and in a draft PDF.

**Acceptance Criteria:**

**Given** core outcomes, resolved Basis, Locale and persisted currency input
**When** presentation.present(outcome, basis, locale, currency) produces PresentedResult
**Then** it alone owns comparison, labels, notices, rounding and numeric formatting (AD-19, AD-25)
**And** comparison runs all four Schools for compare, agrees only on identical per-person shares and statuses, identifies affected people, requires selection on difference and explicitly represents partial refusals.

**Given** catalog terms, names, proof parameters and exact fractions
**When** the presentation is produced in ar/en/fr
**Then** it preserves existing School answers and proof semantics and supplies language/direction metadata, translated and Arabic-original segments, and isolated names/fractions/amounts (NFR-2, AD-19, UX-DR50)
**And** refused outcomes contain a localized reason and no shares, including unsupported School, Malikiyya and impossible-family cases (UX-DR63, School scope).

**Given** an estate and currency precision
**When** amounts are presented
**Then** integer minor-unit validation uses Babel get_currency_precision, allocations round half-up, exact fractions stay exact and a signed rounding line makes the total equal the estate (AD-19)
**And** the rounding line remains separate from legal unallocated/treasury shares; absent estate yields no invented amounts and invalid precision yields a typed error.

**Given** currency {code, explicit} and Locale registry numbering_system
**When** presentation formats fractions, percentages, kirat, amounts and relevant dates
**Then** Babel produces strings once on the server and explicit currency is not re-defaulted (AD-19, AD-21, NFR-X7)
**And** default currency follows Locale for current School cases, with the Country-default extension per AD-19 ready but not enabled as a product choice.

**Given** the presentation notice slots
**When** a current School or comparison result is presented
**Then** the disclaimer is always supplied and notice/Beta selection has one owner per AD-19 (NFR-X3)
**And** future Country notice, citation, civil-law notice and FR-14 prompt capabilities are represented per AD-19 without publishing presets or taking over the later epics' user-facing copy/flows.

**Given** the existing known-answer, School, proof, refusal and later-death corpus
**When** it is passed through candidate presentation
**Then** all exact fractions, statuses, stage evidence and School choices retain parity (AD-15)
**And** presentation fixtures separately identify AD-19 display/rounding changes without disguising them as engine-answer changes.

### Story 8.7: Switch existing calculation consumers only after full parity

As a family member using Mawareeth,
I want preview, results and draft PDF to use the same verified calculation path,
So that opening another view cannot change my answer.

**Acceptance Criteria:**

**Given** candidate core, queries and presentation from earlier stories
**When** the existing known-answer, School, proof, refusal and later-death corpus exercises core, adapters and presentation
**Then** all three pass the AD-15 switch gate before any consumer changes paths (NFR-2, AD-15)
**And** failed parity leaves consumers on the existing path; fixtures are not rewritten to hide a School difference.

**Given** api/preview.py and Calculation.compute callers
**When** the gated adapters replace the ORM calculation path
**Then** preview calculates in memory without creating/rolling back Calculation, Deceased or Heir rows, and Calculation.compute maps existing inputs/outputs as a thin core adapter (AD-15)
**And** successive deaths use core composition, stable ids map explicitly to legacy ids where needed, and requests no longer advance calculation sequences merely to preview.

**Given** reports/report.py, web/src/interview/format.ts, results/table helpers and surviving calc result templates
**When** preview, Full results, saved/shared/received views and PDF render a calculation
**Then** each renders PresentedResult strings/evidence without independent share arithmetic, comparison, rounding or Intl formatting (AD-19, NFR-2)
**And** existing scholars tables, proofs, notices and RTL isolation remain available; legacy pages also consume presentation until their retirement is decided in Epic 12.

**Given** results GETs and repeated concurrent views
**When** they recompute the current inputs
**Then** computation no longer persists derived shares as truth or takes an unbounded calculation write lock, resolving the deferred GET-write path (AD-18, AD-27)
**And** School and compare behaviour remains unchanged, while any necessary legacy write operation is explicit and has a bounded wait.

**Given** an incomplete Case, refused calculation or unexpected calculation failure
**When** a consumer requests preview or draft PDF
**Then** existing not-ready/refusal/error semantics are mapped to the shared contract without stale numbers masquerading as a new answer (AD-25, UX-DR62, UX-DR63)
**And** failures preserve inputs and retry behaviour, PDFs remain regenerated non-canonical drafts, and no result is stored as authoritative truth (AD-18, AD-27).

### Story 8.8: Let every reader open both SavedCase snapshot versions

As a registered user,
I want my phase-1 or migrated legacy Saved case to remain readable during deployment,
So that a release cannot hide it from My cases or break an existing invitation or share.

**Acceptance Criteria:**

**Given** SavedCase already has snapshot and schema_version but current views filter/reject anything other than schema 1
**When** the expand release N is delivered
**Then** session, SavedCase list/load, share, invite, received and PDF readers accept schemas 1 and 2 through a shared decoder (FR-9, AD-20)
**And** all writers still emit schema 1 in this release; no destructive migration or Country write is enabled.

**Given** phase-1 and api/test_legacy_cases.py migrated-case fixtures, including layered identities
**When** either schema is read and round-tripped
**Then** family, stable person identity, death links, estate and original School/compare intent survive (FR-9, NFR-2, AD-18)
**And** a legacy no-basis snapshot alone uses the madhab fallback; malformed current Basis is a typed error rather than a silently changed answer.

**Given** owner-only cases, live private/public links and accepted invitations
**When** the dual reader loads them
**Then** existing ownership, invitation, revocation and expiry rules still apply (FR-9, AD-20)
**And** unknown schema versions return a typed unsupported-version error without overwriting or partially converting the stored snapshot.

**Given** active and rollback-eligible release images
**When** the schema-1/schema-2 reader/writer round-trip matrix is checked
**Then** release evidence demonstrates each permitted writer's data remains interpretable by all eligible readers before progressing to the writer switch (AD-5, AD-6, AD-20). As built, this evidence is a declared image matrix (`api/fixtures/snapshots/matrix.json`) checked between neighbouring rows by the release gate; before the writer switch it must be checked against the actual rollback target image, because production goes straight from the schema-1-only phase-1 image (reconciled 2026-11-18; Epic 8 retro F2)
**And** schema-1 readers are retained until AD-6 eligibility permits removal, irrespective of release count.

### Story 8.9: Apply Case changes atomically against one revision

As a family member using Mawareeth,
I want every change checked against the current Case revision,
So that concurrent tabs, slow previews or a stale restore cannot overwrite my family.

**Acceptance Criteria:**

**Given** the dual-reader release and the existing server session Case
**When** the Case command service is introduced
**Then** all input mutation passes through one service with expected_revision, atomically returning the whole Case and one monotonically incremented revision on success (AD-20)
**And** this story first adds the SavedCase revision column by an additive Django migration, with existing rows initialized consistently; snapshot writers remain gated until Story 8.10.

**Given** current add/edit/remove, School, deceased and later-death mutations plus foundation bulk-add/drop/cascade/Basis/currency/answers/restore operations
**When** commands execute
**Then** shared engine queries decide validity and impact, with server enforcement of 50 Heirs per estate layer and two later deaths (AD-16, AD-20)
**And** an impossible edit, over-capacity bulk add, third later death or unconfirmed cascade makes no partial mutation or revision bump; future redeem plugs into this command boundary without creating a prefill table now. As built, bulk add, cascade and restore exist; the drop, Basis, currency and eligibility-answer commands plug into the same boundary in the epics that introduce them (reconciled 2026-11-18; tracked in deferred-work).

**Given** a stale expected_revision or competing changes
**When** the command checks its revision under the server lock
**Then** it returns {error:"conflict", case} with the current Case and never overwrites it (AD-20, AD-25)
**And** session serialization and SavedCase compare-and-swap use PostgreSQL-backed state, not a per-worker mutex or browser authority.

**Given** preview requests completing out of order
**When** the browser receives them
**Then** each response names its computed revision and older-revision previews are discarded (AD-20)
**And** offline edits are blocked while family and last preview remain visible, with no client edit queue (UX-DR67, foundation scope).

**Given** a restore command with a prior page snapshot or an expired guest
**When** it is applied against the current revision
**Then** valid restore preserves stable ids and increments the current revision rather than restoring an old revision number (AD-20)
**And** guest expiry is checked on every read/edit at 24 hours after last change with no expired family returned; conversion alone does not extend lifetime (FR-9, UX-DR66, guest scope).

**Given** a held Case write lock
**When** a competing command reaches the configured wait budget
**Then** it terminates within the AD-27 budget with an explicit retryable outcome and no mutation (NFR-3, AD-27)
**And** redacted lock-wait/timeout measurements are emitted; the actual timeout is chosen and recorded from the end-to-end budget per AD-27, not left to Gunicorn's 120-second bound.

### Story 8.10: Upgrade existing Saved cases without losing their original Basis

As a registered user,
I want my old Saved cases upgraded with their original family, Basis and a useful default name,
So that I can keep opening and saving them after phase 2 arrives.

**Acceptance Criteria:**

**Given** all active and rollback-eligible readers accept both versions
**When** release N+1 switches writers
**Then** schema 2 persists only inputs including family, estate, currency, Basis and Case state, with schema_version and revision maintained consistently (FR-9, AD-18, AD-20)
**And** this story first adds the name column and its Django migration because the name backfill first needs it; the existing snapshot/schema_version fields are reused.

**Given** every phase-1 SavedCase, including successfully migrated legacy cases
**When** the resumable backfill runs
**Then** it assigns the preserved School or compare Basis and a default "Estate of {Deceased name or label}, {date}" name using the original save date, never a Country Basis (FR-9)
**And** names support any Locale script within 100 characters, original timestamps/ownership/share links/invites/ids are preserved, and reruns do not replace already assigned user names or converted inputs.

**Given** a phase-1 SavedCase whose estate is a bare decimal amount with no currency
**When** the backfill converts it
**Then** the estate is stored as integer minor units with currency `{code: "SAR", explicit: true}` (owner decision, 2026-11-16), so it is never re-defaulted from the Locale (AD-19)
**And** a case with no estate amount stays without an estate, and a live guest schema-1 snapshot converted on read gets the same SAR currency.

**Given** a live guest schema-1 snapshot at release
**When** it is read before expiry
**Then** it converts losslessly on read and stays usable until its existing expiry, with no forced restart (FR-9, AD-20)
**And** malformed current data is reported without destructive normalization or resetting lifetime. As built, the read is tolerant: a malformed legacy piece is left out of the returned Case and logged as a redacted normalization warning, while the stored snapshot is unchanged (reconciled 2026-11-18).

**Given** a working copy opened from a SavedCase
**When** the registered user saves it
**Then** the session link includes SavedCase id and base revision and a compare-and-swap writes back only when that revision still matches (AD-20)
**And** a competing save returns a conflict without overwriting either the current stored Case or losing the user's working inputs.

**Given** schema-2 SavedCases and their existing share/invite/received entry paths
**When** users reopen, share or regenerate a draft PDF
**Then** inputs resolve through the same Basis resolver and recompute through presentation, with share links remaining live views of the SavedCase (FR-9, NFR-2, AD-18)
**And** unavailable pinned versions are never substituted, Country writes remain disabled pending later-wave eligibility and compatible images, and schema-1 reader removal remains gated by AD-6.

### Story 8.11: Prove the foundation meets wave-1 release budgets

As the owner/maintainer,
I want repeatable capacity, compatibility and recovery evidence for the foundation,
So that wave 1 can ship without losing Cases or tying up the shared host.

**Acceptance Criteria:**

**Given** both deployment slots running
**When** the repeatable wave-1 capacity scenario measures the pure engine and end-to-end preview
**Then** the engine stays under 200 ms for a standard family and Share preview p95 stays under 1 s for up to 50 Heirs on a mid-range phone over 4G (NFR-3, AD-27). As built, the phone and 4G are modelled (in-process requests plus fixed RTT, bandwidth and render constants); the real-device measurement belongs to Story 9.12 (reconciled 2026-11-18)
**And** evidence covers School and four-School comparison paths, including a family whose Schools disagree, plus supported two-later-death workloads, with bounded lock waits included rather than subtracted; a sample counts only when the preview body is usable (expected status, valid PresentedResult, current revision).

**Given** contention, refusals, invalid commands and preview failures
**When** the foundation endpoints are exercised
**Then** redacted structured outcomes and low-cardinality latency/error/limit counts make calculation and lock failures visible (AD-8, AD-9, AD-27)
**And** no request body, name, family or secret is logged and readiness covers the new foundation dependencies without exposing Case data.

**Given** the candidate release and its active/rollback images
**When** release checks run
**Then** the full core/adapter/presentation parity corpus, contract round-trips, revision/concurrency checks, schema reader/writer matrix, catalog/glyph gates and import-graph purity gate pass (NFR-2, AD-15, AD-20, AD-21, AD-25)
**And** any failing gate blocks the switch or release; no deferred 1,000-case scholarly suite is required as a substitute for the existing complete corpus.

**Given** a restored database and matching release files
**When** the updated restore runbook is rehearsed
**Then** schema versions, names, revisions, linked identities and existing sharing/invite access survive, and matching catalog files are present (FR-9, AD-27)
**And** recovery checks cover any tables actually introduced by this epic; no Ticket, API-key, counter or prefill table is created for a future epic.

### Story 8.12: Purge the empty legacy drafts the import could not convert

As the owner/maintainer,
I want the empty legacy calculations that the `api.0004` import reported as unconvertible removed,
So that the database holds no dead drafts with nothing to compute.

(Reconciled 2026-11-18: later-death layers only exist since v3, so emptiness is judged on the calculation's own rows. The production dry run found 1,145 empty drafts. Calculation 2402 is not empty (the same deceased entered twice, plus four heirs), so the command keeps it; on 2026-11-19 the owner had its extra, unlinked deceased row removed by hand so it converts.)

**Acceptance Criteria:**

**Given** the legacy calculations reported but not converted by `api.0004` on production (841 with no deceased, 304 with no heirs)
**When** the owner runs the purge management command with `--dry-run --expect 1145`
**Then** it lists the count per reason and the affected calculation ids, deletes nothing, and the counts match (`no_deceased=841 no_heirs=304 total=1145`)
**And** it selects only owned root calculations that cannot be converted and whose own rows have no deceased or no heirs.

**Given** the same selection
**When** the owner runs the command without `--dry-run`
**Then** those calculations and only their dependent legacy rows are deleted in one transaction, after each candidate is locked and re-checked, and the command reports the number deleted
**And** rerunning it deletes nothing further, and a count that differs from `--expect` deletes nothing.

**Given** any converted calculation, or an unconvertible one whose own rows have both a deceased and an heir
**When** the purge runs
**Then** it is never deleted or modified by the command; calculation 2402 is one of these, repaired by hand separately by owner decision
**And** the deferred-work entry records the procedure, the 2402 repair and, after the production run, its date and deleted count.

**Given** the production purge
**When** it is about to run
**Then** a fresh restic backup exists first, and the command logs only ids and counts, never names or family data (AD-27, NFR-4)

## Epic 9: Build a family fast on an editable Family tree

Users add Heirs with one press, drag relationships onto the tree, select and edit or delete on the tree, add several at once, and undo any change — on phone and desktop, by keyboard and screen reader.

### Story 9.1: Establish the Interview shell and accessible tree tokens

As a family member using Mawareeth,
I want a clear Interview layout with readable controls in both colour modes,
So that I can find family entry, the tree and the Heirs list on my device.

**Acceptance Criteria:**

**Given** Epic 8's contracts, catalog/registry and switched consumers (8.1, 8.5–8.7, 8.9) and the existing `web/src/app/[locale]/interview/page.tsx` and `start-case.tsx`
**When** the family-entry shell is arranged
**Then** named Add relatives, Family tree and Heirs list regions replace the narrow family-entry layout using the existing handwritten React components and shared `ui.ts` styles (UX-DR77–79)
**And** below 1024px their order is Add relatives/tree/Heirs list with 16px gutters; at 1024–1279px relatives/list occupy 380px beside a flexible tree; at >=1280px a 1360px maximum shell reserves a 340px preview slot, without implementing Epic 11's summary bar/sheet or changing existing result meaning.

**Given** `globals.css`, `ui.ts` and DESIGN's phase-2 tokens
**When** tree, edit and undo components consume the shell styles
**Then** graphic, accent-soft, blocked-stripe, scrim and toast-focus have light/dark properties, with system colour-scheme selection and line used only decoratively (UX-DR2, UX-DR70, UX-DR71)
**And** derived dark colours retain [ASSUMPTION] status; scrims use 40% light/60% dark, text meets >=4.5:1 and essential boundaries >=3:1, including graphic/surface 3.46:1 light and 3.80:1 dark.

**Given** the typography, radius and Interview spacing tokens
**When** the shell and its controls render
**Then** node-name 0.84rem/700, node-meta 0.72rem, badge 0.68rem/600 with 1.3 line height, node/sheet/full radii 10px/18px/9999px and 640/1024/1280px breakpoints are available (UX-DR4)
**And** text uses system fonts with the Arabic-capable body-rtl fallback order; Urdu line-height 1.7 remains [ASSUMPTION] and its font remains open, with no new Locale published by this story.

**Given** any focusable Interview control, including an accent-filled card
**When** it receives keyboard focus
**Then** its target is at least 44px and its focus-visible ring is a 2px outline with 2px offset, using foreground/currentColor on accent fills and toast-focus on inverted toast surfaces (NFR-1, UX-DR8, UX-DR69, UX-DR71)
**And** the outline remains unclipped and is never substituted by a box-shadow; labels and state text remain visible in light and dark modes.

**Given** the phase-1 visual identity that phase 2 keeps
**When** the Interview shell and its controls are built
**Then** the shipped colour properties (background, foreground, muted, surface, line, accent, accent-foreground and dark pairs), typography and spacing scales, button-primary, button-secondary and choice-card (resting, checked, focus-visible; 44px minimum) are reused unchanged and verified in light and dark modes (UX-DR1, UX-DR3, UX-DR5, UX-DR6, UX-DR9)
**And** no new web font is loaded and no existing token value changes.

### Story 9.2: Render the family as lineage cards on a navigable canvas

As a family member reviewing an existing Case,
I want the tree and Heirs outline to show the actual family and each person's state,
So that I can understand the family before changing it.

**Acceptance Criteria:**

**Given** Story 9.1 and Epic 8 Family/PresentedResult data for the active estate
**When** `family-tree.tsx` and `web/src/interview/tree.ts` render an existing Case
**Then** cards and connectors follow stable person ids and lineage edges rather than attaching all relatives to the old shared spine, showing one estate level at a time (AD-19, AD-20, UX-DR13, UX-DR14)
**And** the canvas has a surface/dotted line grid at 18px spacing, 1px top/bottom decorative lines, 2px graphic connectors and >=6px logical padding in a labelled 2D scroll region; only the connector layer is mirrored in RTL.

**Given** normal, died-before, blocked and died-later people in a read-only family fixture
**When** cards and badges render
**Then** normal native-button cards have 1.5px graphic borders, 108px widths below 640px/136px thereafter and >=76px height, with bold relationship and optional smaller name or numbered default label (UX-DR16, UX-DR18–20, UX-DR24–26)
**And** died-before uses surface fill and a 2px dashed graphic edge (4px dash/3px gap) plus “Died before”; blocked uses decorative stripes with readable solid label/badge plates and “No share in this case”; died-later uses a solid 2px accent edge and “Died later · own estate” with person-appropriate Arabic gender and an aria-hidden mirrored chevron; no card has an avatar, initials, gender frame or death symbol.

**Given** the deceased and all people shown in the active estate
**When** the tree and `heir-list.tsx` obtain their text from the extended shared `treeDescription`
**Then** the deceased is labelled only “The deceased” / “المتوفى”, and the canonical Heirs outline includes the deceased and every entered person with relationships, state badges and no-share status (UX-DR17, UX-DR32, UX-DR72)
**And** the Family tree is one labelled role=group of native card buttons with a roving tab stop and visible-text accessible names, never role=tree/application or the shipped role=img; rows are >=52px with 44px Edit targets, with actions connected in subsequent stories.

**Given** an empty active estate and engine query results supplied through the Epic 8 command-service boundary
**When** the tree and list render
**Then** only the deceased and engine-allowed parent/spouse placeholders appear, with dashed accent edges and labels such as “+ Add parent” (AD-16, UX-DR21, UX-DR54)
**And** the list says “No heirs yet. Press a relationship to add one.” and the existing preview remains blank; the empty-state contract exposes no shares for Epic 11's future sticky bar.

**Given** the canvas has up to 50 Heirs at 375px or 1280px
**When** I pan by drag/swipe, pinch to zoom or use Fit tree/plus/minus
**Then** the deceased remains visible at all times, including during free pan and zoom (the deceased card is pinned or clamped inside the viewport; owner decision, 2026-11-16), and the family remains reachable without shrinking interactive targets below 44px; Fit tree resets the view (NFR-X1, UX-DR13, UX-DR15)
**And** the toolbar sits above the canvas with its hint, 44px secondary buttons and 8px gaps, zoom changes report through one shared polite status region, and `touch-action: pan-y pinch-zoom` preserves vertical page scrolling.

### Story 9.3: Add one relative with one press

As a family member entering a Case,
I want relationship buttons that immediately add a relative without a name form,
So that I can build my family quickly.

**Acceptance Criteria:**

**Given** Stories 9.1–9.2 and allowed relationships from Epic 8.4 queries through 8.9's command service
**When** the Add relatives panel renders
**Then** wrapping relationship-button wrappers use graphic borders and 44px accent add actions grouped Spouse, Parents, Children, Siblings and More relatives (FR-1, AD-16, UX-DR27)
**And** impossible relationships such as a second father are not offered, blocked-but-valid relatives remain addable, and display grouping contains no independent browser fiqh rules.

**Given** an allowed relationship and available Case capacity
**When** I tap or press Space/Enter on its add button
**Then** one add command sends the current expected_revision and creates one Heir without further input, with an optional name and a numbered default label in the current Locale (FR-1, AD-20, AD-21, UX-DR27)
**And** focus stays on the add action, its accessible name contains the visible relationship words, the plus icon is decorative and catalog terms/general UI copy come from their Epic 8 owners rather than copied labels.

**Given** a successful add response
**When** the returned whole Case is accepted
**Then** tree, Heirs list and the existing preview consume the returned revision, and preview recalculation uses Epic 8's presentation path without client share arithmetic (FR-1, AD-19, AD-20, UJ-2)
**And** the shared polite status reports the add once without moving focus; obsolete preview responses are discarded by the foundation revision integration rather than displayed as the new answer.

**Given** 50 Heirs, a stale revision, an impossible command or an offline connection
**When** an add is attempted
**Then** the UI consumes the foundation's no-mutation limit/conflict/refusal/offline outcomes and never creates a local authoritative Heir or queues an offline edit (FR-1, AD-16, AD-20, UX-DR27, UX-DR60, UX-DR67)
**And** capacity displays the 50-Heir message and stops adds, conflict presents the returned current Case without overwriting it, and refusal explains why with focus retained; the server remains the limit authority.

### Story 9.4: Edit and remove relatives from the tree

As a family member correcting a Case,
I want a focused edit sheet with safe removal,
So that I can fix a relationship or name without losing related people unexpectedly.

**Acceptance Criteria:**

**Given** Stories 9.1–9.3 and a normal, died-before or blocked card or its Heirs-row Edit action
**When** I tap the card, press Enter or choose Edit
**Then** `heir-form.tsx`/`form-bits.tsx` supply labelled >=44px name, relationship and Alive at death/Died before the deceased fields in a phone modal bottom sheet or desktop non-modal panel (FR-3, UX-DR16, UX-DR18, UX-DR20, UX-DR22, UX-DR33)
**And** the edited card retains a 3px inset currentColor selected outline and aria-current="true"; the later-death creation/status extension is delivered by Story 9.8.

**Given** an open edit surface and Epic 8's edit-validity query/command interfaces
**When** I change a name, relationship or died-before status
**Then** saves occur on change against the current revision, and only a successful command's whole Case updates tree, list and preview together (FR-3, AD-16, AD-20, UJ-2)
**And** a refused relationship/status change shows the localized engine reason and leaves the accepted family unchanged, with no browser fiqh decision or focus loss; a name is never required.

**Given** a phone sheet or desktop panel is opening or closing
**When** I edit, use Close or press Escape
**Then** opening focuses the first field, phone uses `dialog.showModal()` with native inert background/trap/Escape, and desktop follows the tree in Tab order without a focus trap (NFR-1, UX-DR33, UX-DR74)
**And** closing returns focus to the opening card or Edit control, dark/light sheet surfaces follow tokens, and confirmation replaces the sheet's interaction state rather than stacking modals.

**Given** a person with descendants or a linked later-death estate, including an existing loaded estate
**When** I choose Remove or press Delete on that person's card
**Then** the confirmation lists exactly the affected people and estate members returned by Epic 8's delete-impact query through the command-service boundary, and only confirmation sends the atomic cascade command (FR-3, AD-16, AD-20, UX-DR33, UX-DR73)
**And** cancellation changes nothing; a changed revision or rejected/unconfirmed cascade removes nobody, and the confirmation is refreshed from authoritative impact rather than using a browser cascade table.

**Given** a confirmed removal or a simple Remove without a cascade
**When** the command succeeds
**Then** the returned Case removes exactly the authorized people and updates list/tree/preview from that revision (FR-3, AD-20, UX-DR32, UX-DR74)
**And** focus moves to the next sibling card, otherwise the previous sibling, otherwise the deceased; keyboard Delete asks for confirmation even when no cascade is present, and failures preserve the accepted family.

### Story 9.5: Add a group of relatives with a count stepper

As a family member entering several children or siblings,
I want to choose a count before adding a relationship,
So that a group takes one add action.

**Acceptance Criteria:**

**Given** Story 9.3's relationship buttons and the approved DESIGN stepper specification
**When** a count stepper is shown alongside each allowed relationship
**Then** it has 44px square minus/plus buttons, surface fill, graphic boundaries and an output at weight 700, with localized “Fewer {relationship}”/“More {relationship}” names (FR-4, UX-DR28)
**And** the count starts at 1 (owner decision, 2026-11-16), plus/minus set n and the add press adds n; the mock's zero counts are not the interaction contract.

**Given** capacity and engine-valid repeated relationships
**When** I set 4 daughters and press Add
**Then** one bulk-add command against the current revision adds four separately identified Heirs with current-Locale numbered defaults (FR-4, AD-16, AD-20, UX-DR28)
**And** one returned Case synchronizes the list/tree/preview, with no form per person and no intermediate partial family.

**Given** a minimum count of 1 and remaining capacity below the chosen count
**When** I decrease below 1, increase above remaining capacity or submit after capacity/relationship validity changes elsewhere
**Then** the stepper never offers below 1 or above the current 50-Heir capacity, and the foundation command service atomically rejects an over-capacity or invalid batch with no partial addition (FR-4, AD-16, AD-20, UX-DR28)
**And** the UI explains the limit, preserves focus and accepted family, and at 50 Heirs stops adds with the same message as one-press entry; controls alone are not trusted to enforce capacity or repeated-relationship legality.

**Given** keyboard or screen-reader use of the stepper
**When** I adjust n and then add the group
**Then** visible count and accessible button names identify the relationship, and stepper presses create no separate live preview announcements (NFR-1, UX-DR28, UX-DR75)
**And** the completed group produces one change announcement and becomes one Undo history entry when Story 9.6 connects the page history.

### Story 9.6: Undo family changes throughout the page visit

As a family member who made a mistake,
I want persistent multi-step Undo as well as a temporary toast,
So that I can recover the exact family even after the toast disappears.

**Acceptance Criteria:**

**Given** Stories 9.3–9.5 and Epic 8.9's restore command
**When** an add, bulk add, edit or delete succeeds
**Then** the browser's page-only history retains the prior accepted Case snapshot once per atomic family change, not once per rendered component (FR-5, AD-20)
**And** unsuccessful commands add no entry, a bulk add or cascade is one change, and reload clears the stack without storing it as durable browser Case authority; subsequent family command UI uses this same history integration.

**Given** I change a person's name in the edit surface
**When** I type and then leave the field or press Enter
**Then** the name is saved as one command when the field is committed (blur or Enter), not on every keystroke, and that whole name change is exactly one Undo step (owner decision, 2026-11-16) (FR-5, AD-20)
**And** leaving the field without changing the name creates no command and no Undo entry.

**Given** at least one history entry
**When** I press the 44px “Undo last change” control in either the Heirs list header or Interview header, use the toast's Undo, or press Ctrl/Cmd+Z outside text-entry editing
**Then** each invocation sends one restore command with the current expected_revision and the prior snapshot, restoring the exact family and stable ids while advancing the current revision (FR-5, AD-20, UX-DR30, UX-DR31)
**And** repeated invocations walk back the page visit one change at a time, both persistent controls stay available while entries remain independently of toast expiry, and they are hidden when there is nothing to undo.

**Given** any successful family change
**When** the Undo toast appears
**Then** it uses the inverted surface, text Undo action and toast-focus outline, is in DOM order after the Heirs list, lasts at least 10 seconds, pauses on hover/focus and restarts afterwards (FR-5, UX-DR35, UX-DR71)
**And** a new change replaces the toast without losing older history, the toast never steals focus, and its status is delivered through the shared polite region rather than a duplicate announcement region.

**Given** a successful Undo or a rejected restore
**When** the restore response arrives
**Then** success renders the returned Case and current-revision preview and focuses the restored card, while failure does not pop the history entry or pretend the restore succeeded (FR-5, AD-20, UX-DR74)
**And** conflict uses the foundation's current Case without silently retrying a stale restore over it; offline Undo is disabled with the existing offline line and no client edit queue.

### Story 9.7: Add relatives at a chosen node by touch, keyboard or drag

As a family member adding nephews or grandchildren,
I want to choose the person a new relative belongs to,
So that the tree places the relative in the right lineage without requiring a drag.

**Acceptance Criteria:**

**Given** Stories 9.2–9.6 and the allowed-at-position query from Epic 8.4 through the command-service boundary
**When** I focus a card or open its edit surface
**Then** the same 44px accent “Add relative here” action appears in the card action row and all edit states, listing only engine-allowed relationships for that position (FR-2, AD-16, UX-DR29, UX-DR33)
**And** tapping or using Space/Enter to choose a relationship adds one through the command service with the same lineage and history result as a drop, including on the deceased; touch never requires press-and-hold dragging.

**Given** an allowed placeholder parent/spouse slot
**When** I tap/activate it or drop its allowed relationship there
**Then** it adds the relative at that exact position using the same command boundary as the other add paths (FR-1, FR-2, AD-16, UX-DR21)
**And** only engine-allowed slots are offered, invalidated slots are rejected without mutation, and keyboard focus remains recoverable after the placeholder becomes a person.

**Given** a relationship chip and a deceased or Heir target
**When** I drag with a pointer over the tree and drop
**Then** engine query results control target legality and the drop command validates the position against the current revision, with no browser relationship-validity table (FR-2, AD-16, AD-20, UX-DR23)
**And** per the UX spec (assumptions accepted by the owner, 2026-11-16) legal targets show a 2px accent edge and illegal targets are dimmed using a readable colour pair, with state text rather than colour alone; an illegal drop announces “Not allowed here: {reason}”, retains focus and leaves the tree unchanged.

**Given** a son marked Died before the deceased
**When** I drop Son onto him or choose Son from his Add relative here action
**Then** the new person is that son's child in the correct line, as determined by the engine query and accepted command (FR-2, AD-16, UX-DR18, UX-DR29)
**And** matching pointer, keyboard and touch fixtures produce the same lineage, whole Case revision update, preview and one Undo entry; no new FR-6 relationship class or Country rule is invented here.

**Given** keyboard use, cancelled pointer dragging, stale revision or no remaining capacity
**When** an addition is attempted or cancelled
**Then** Space/Enter remain ordinary button activation with no keyboard pick-up mode, and every drag result remains reachable through Add relative here (FR-2, NFR-1, UX-DR23, UX-DR73)
**And** cancelled drags change nothing, while refusals/conflicts/50-Heir limits consume the foundation outcomes without partial additions or losing the accepted family.

### Story 9.8: Open and edit later-death estates with a breadcrumb

As a family member entering successive deaths,
I want a later-death person's own estate to open separately,
So that I can enter that family without confusing it with the first estate.

**Acceptance Criteria:**

**Given** Stories 9.4–9.7 and Epic 8's successive-death contracts, queries, composition and commands (8.1, 8.3, 8.4, 8.6–8.9)
**When** I choose “Died after the deceased, before division” in an Heir's edit surface
**Then** the status change goes through the existing command service, focus stays in the edit surface, and the accepted person gains the solid 2px accent card/badge state and an initially empty estate with allowed placeholders (FR-3, AD-16, AD-20, UX-DR19, UX-DR25, UX-DR57)
**And** the shared announcement explains “Open own estate to add her/his heirs”; the original estate preserves the person's share and the presented text explains separate calculation, without reimplementing the core composition.

**Given** a died-later card or its Heirs row/edit surface
**When** I tap/press Enter on the card or activate “Open own estate”
**Then** the named estate opens, tree/list and the single Share preview switch to that estate's presentation (no second preview panel; owner decision, 2026-11-16), and Add relatives/Add relative here are scoped to it (UX-DR19, UX-DR29, UX-DR32, UX-DR58, UJ-2)
**And** the died-later person's editing route remains the Heirs-row Edit action, the original estate's share is preserved, and opening the estate focuses its tree heading.

**Given** an open later-death estate
**When** `death-breadcrumb.tsx` renders and I choose an earlier level
**Then** a nav labelled “Estate level” sits directly above the canvas, with >=44px earlier-level accent links, current-level semibold non-link text and aria-hidden RTL-mirrored chevrons (UX-DR34, UX-DR74)
**And** the breadcrumb is absent at the root, contains at most three levels (deceased plus two later deaths), returns to the chosen estate in one activation and focuses its tree heading.

**Given** two later deaths already exist anywhere in the Case
**When** I edit another living person or attempt a third later-death command
**Then** the additional later-death choice is hidden with “A case can hold up to two later deaths.”, while existing later deaths remain editable (AD-16, AD-20, UX-DR59)
**And** a third command is refused atomically by the foundation service, with no family/revision mutation or lost focus; the UI does not redefine the server's Case-wide limits.

**Given** a later-death estate has people entered
**When** I remove its linked person, cancel removal or Undo an accepted status/add/remove change
**Then** Story 9.4's engine-supplied cascade confirmation explicitly includes that estate's affected people, cancellation changes nothing and Story 9.6 restores the exact linked family with stable ids (FR-3, FR-5, AD-16, AD-20, UJ-2)
**And** tree/list/preview reconcile to an estate still present in the returned Case, and focus follows the existing removal/restore rules rather than remaining in a removed estate.

### Story 9.9: Complete keyboard navigation and the screen-reader outline

As a keyboard or screen-reader user,
I want predictable movement and the same family actions as pointer users,
So that I can complete the Interview independently.

**Acceptance Criteria:**

**Given** Stories 9.2–9.8 and the single labelled Family tree role=group
**When** I Tab into and out of the tree
**Then** only the current card is the group's roving tab stop and Tab leaves without trapping, while the canonical Heirs outline exposes the deceased and every person with the same treeDescription labels/states (NFR-1, NFR-X1, UX-DR72, UX-DR73)
**And** card names come from visible text including status badges, selection uses aria-current="true", and there is no role=tree/application or replacement aria-label that hides visible relationship words.

**Given** a focused card with relatives
**When** I press Up, Down, inline-start/end arrows, Home or End
**Then** focus moves respectively to parent, first child, previous/next sibling, deceased or last card, with physical Left/Right swapped for RTL (NFR-X1, UX-DR73)
**And** absent neighbours do not lose focus, the focused card stays visible with an unclipped ring, and Playwright covers the same navigation over real lineage in LTR and Arabic RTL.

**Given** a focused ordinary/died-later card or an open edit surface
**When** I press Enter, Delete, Escape or +/-
**Then** Enter edits ordinary cards or opens a died-later estate, Delete invokes the removal confirmation, Escape closes the edit surface and +/- zoom through the toolbar behaviour (NFR-1, UX-DR73, UX-DR74)
**And** text inputs retain ordinary editing keystrokes, Add relative here/relationship buttons reach all add outcomes, and removal/Undo/estate navigation retain the focus destinations defined by earlier stories.

**Given** Arabic fixtures with normal, blocked, died-before and died-later people and a cascade deletion
**When** the non-visual Interview is exercised with NVDA/Chrome, VoiceOver/Safari iOS and TalkBack
**Then** the canonical outline supports add/edit/delete/Undo and opening/returning from estates, with visible labels, state text and all input names understandable (NFR-1, UX-DR69, UX-DR72)
**And** Playwright axe checks pass for the Interview's empty, populated and edit/confirmation states in published Locales; manual findings record browser/reader and action rather than assuming axe proves keyboard or screen-reader usability.

### Story 9.10: Coordinate Interview announcements and updating states

As a family member making several changes,
I want clear, restrained progress and change messages,
So that I can follow the latest accepted family without repeated or stale announcements.

**Acceptance Criteria:**

**Given** Stories 9.3–9.9 and existing announcement/preview wiring in `start-case.tsx`, `heir-list.tsx` and `share-preview.tsx`
**When** add/remove/edit/Undo/zoom and preview completion messages occur
**Then** one shared polite role=status with aria-atomic coalesces them after about 800 ms into one sentence per change, such as “Added Son 2. 7 heirs, shares ready.” (UX-DR35, UX-DR75)
**And** rows, steppers and toast do not create competing status regions or repeated announcements, unchanged preview rows are not rewritten, and refusal alerts remain distinct from routine status.

**Given** an accepted family command with a preview in flight
**When** the preview updates
**Then** previous shares remain visibly pending in a muted colour pair without opacity reduction, the region has aria-busy=true, and completion swaps the accepted revision without a layout jump (NFR-3, AD-19, AD-20, UX-DR56)
**And** stale preview responses are discarded using Epic 8's integration, old numbers are never presented as the new family's completed answer, and the 800 ms announcement debounce does not delay requesting or displaying the preview.

**Given** an update lasts beyond 3 s or the connection becomes offline
**When** progress status is displayed
**Then** the boxed one-line muted status uses Updating/Still working only after that delay and has no focus theft, modal or reduced-motion animation (UX-DR56, UX-DR60, UX-DR67)
**And** offline reuses the foundation's blocked-edit state with “You're offline. Reconnect to keep editing.”, visible family/last preview and disabled add/edit/delete/Undo, with no client queue; the status line itself is not the input-blocking authority.

**Given** cold load, an empty estate, a preview error or a refused action
**When** the Interview renders that state
**Then** cold load uses 12px layout-shaped skeleton bars and regional aria-busy while the page remains usable, empty state follows Story 9.2, and preview failure retains the family with the shipped plain message/Retry pattern (UX-DR54, UX-DR55, UX-DR62)
**And** refused additions/drops use localized reasons and role=alert without numbers masquerading as success; [ASSUMPTION: source] no new red/green/amber status palette is introduced, and Contact/Country refusal flows remain outside this story.

### Story 9.11: Verify responsive, RTL and reduced-motion tree interactions

As a family member on a phone, using zoom or reading Arabic,
I want the entire family editor to adapt without hiding actions,
So that I can keep editing comfortably at every supported layout.

**Acceptance Criteria:**

**Given** Stories 9.1–9.10
**When** the Interview is checked below 640px, at 640–1023px, 1024–1279px and >=1280px
**Then** the first two ranges retain Add relatives/tree/Heirs list in one column with 16px gutters and wrapping buttons, using 108px then 136px cards; 1024–1279px uses 380px relatives/list plus a >=596px flexible tree and side edit panel; >=1280px uses a <=1360px shell with 380px relatives/list, flexible tree and 340px preview slot with 24px padding and 1px dividers (UX-DR77–79)
**And** phone editing is a bottom sheet and desktop editing a side panel; this story verifies the editor slots and existing preview integration without implementing Epic 11's sticky bar/sheet or Full results redesign.

**Given** 320px width/400% zoom in LTR and RTL, including text-spacing overrides
**When** I navigate, edit or Undo with a toast visible
**Then** the page reflows without horizontal page scrolling, the canvas alone remains the labelled nested 2D region, and >=6px canvas padding keeps focus outlines visible (NFR-1, UX-DR80)
**And** editor scroll-padding-block-end tracks the toast and any supplied bottom-summary obstruction so focused cards/rows remain exposed; the shared obstruction contract budgets bar plus toast at <=25% viewport height, leaving bar wrapping below 360px and the under-480px landscape in-flow preview replacement to Epic 11.

**Given** Arabic RTL or a registry-provided RTL test fixture for future Urdu
**When** every tree/editor layout, stepper and directional chevron is inspected
**Then** column order, inline navigation and controls mirror through logical properties, only connectors are transformed, and card text/badges are never mirrored (AD-21, UX-DR14, UX-DR81)
**And** lang/dir derive from the registry, names use bdi dir=auto, Arabic term segments use bdi lang=ar dir=rtl, presented fractions use dir=ltr isolation and English fallback is marked lang=en; no browser Intl/share formatting or new Locale publication is introduced (AD-19, UX-DR50, UX-DR51).

**Given** ordinary motion settings or prefers-reduced-motion
**When** a change reflows nodes or opens a sheet/toast, zooms or scrolls
**Then** ordinary node reflow is 300 ms, while reduced motion disables node movement, sheet slides, scrim fades, toast entry, skeleton shimmer, zoom animation and smooth scrolling without losing any action (UX-DR76)
**And** light/dark contrast checks retain text >=4.5:1 and graphics/focus >=3:1, including accent/accent-soft 4.71:1 light/10.29:1 dark and toast-focus/fill 17.93:1 light/16.91:1 dark; badge typography is not shrunk or its fill tinted to fit (UX-DR70, UX-DR71).

### Story 9.12: Prove the complete family-entry journey meets capacity and speed gates

As the owner/maintainer,
I want repeatable evidence for a fast, accessible 50-Heir Interview,
So that the editable tree can ship without slowing the foundation calculation path.

**Acceptance Criteria:**

**Given** Stories 9.1–9.11 and Epic 8.11's capacity harness with both deployment slots running
**When** add, group add, edit, delete, drop and Undo are measured on a mid-range phone over 4G with up to 50 Heirs
**Then** Share preview updates in under 1 s at p95 end to end, including command/network/lock waits and browser rendering, and the standard-family engine remains under 200 ms (NFR-3, AD-27)
**And** evidence records device/network/workload and latency samples for School and all-four-School comparison plus supported two-later-death Cases, reusing the foundation harness without rebuilding its engine, locks or budget enforcement.

**Given** 50-Heir Cases at 375px and 1280px with wide/deep lineage, long names and blocked/predeceased people
**When** Fit tree, pan/zoom, arrow navigation and edit/Undo are exercised
**Then** the deceased stays visible and every person/action remains reachable with >=44px targets, correct 108/136px base card widths and unclipped focus (NFR-1, NFR-X1, UX-DR13, UX-DR16)
**And** adding beyond capacity or creating a third later death is refused without partial mutation, with existing relatives/estates still editable and no browser fiqh or limit authority replacing Epic 8's service.

**Given** Yusuf's eleven-relative Arabic desktop UJ-2 family and equivalent phone/keyboard paths
**When** he adds without typing names, bulk-adds a group, adds nephews at a node, corrects a half-sister's relationship, removes a duplicate and undoes a mistaken removal
**Then** tree, canonical Heirs outline and current-revision preview agree after every accepted change, and equivalent drag/Add relative here paths yield the same family (FR-1–5, UJ-2)
**And** cancelling a descendant cascade changes nothing, later-death navigation returns through the breadcrumb, stale/offline/refused responses cannot report success, and the journey ends at the existing save integration without adding Epic 10's naming flow.

**Given** candidate release evidence from the Interview checks
**When** the Epic 9 gate is assessed
**Then** failed p95/root-visibility/keyboard/axe/RTL/reflow/contrast or required Arabic screen-reader checks block acceptance rather than being waived by the passing backend budget alone (NFR-1, NFR-3, NFR-X1, UX-DR69–81)
**And** results distinguish automated from manual evidence and record remaining source assumptions/open product questions; measurements contain no names or family payloads and no new telemetry product or FR-45 usability protocol is created here.

## Epic 10: Named Saved cases that open directly

Registered users open a Saved case from *My cases* straight into the Interview with its family loaded, and name or rename it.

### Story 10.1: Name a Case and show whether saving succeeded

As a registered family member,
I want to name my Case when saving and see the save outcome,
So that I can recognise it later and know whether my work reached My cases.

**Acceptance Criteria:**

**Given** Epic 8's SavedCase name field, schema-2 writers, command service and save boundary, and the existing Interview/results Save actions
**When** I save a new Case
**Then** saving prompts for a Case name prefilled with "Estate of {Deceased name or label}, {date}" and lets me edit the suggestion before submitting (FR-8, UX-DR42, UX-DR85)
**And** the accepted name accompanies the saved inputs through the existing persistence boundary; this story consumes the foundation rather than adding its columns, backfill or snapshot conversion again.

**Given** the case-name-field on Save
**When** I enter a name in any script, including Arabic or mixed-direction text
**Then** the labelled input accepts up to 100 characters and shows the 100-character counter in typography.small, with a 1px colors.muted boundary meeting 3:1, rounded.lg and a minimum 44px height (FR-8, UX-DR42, NFR-1)
**And** an over-limit request is rejected by the server without a saved mutation, the entered family remains available, and the input and displayed name respect the current Locale and bidi isolation.

**Given** I invoke Save while signed out
**When** the shipped sign-in dialog completes successfully
**Then** the requested Save resumes into the naming flow for the same working Case (FR-8, UX-DR85, UX-DR12, UX-DR41)
**And** authentication and naming never stack dialogs, and cancelling authentication does not claim a successful save or discard the family.

**Given** a named save is in progress from Interview or results
**When** its response succeeds or fails
**Then** the inline status-line shows "Saving", then "Saved to My cases" only after success, or "Could not save. Your family is still here. Try again." with Retry on failure (UX-DR61, FR-8)
**And** the family and entered name survive failure, success makes the Case available in My cases, and these source strings retain their wording-draft status rather than being marked owner-reviewed.

**Given** an opened SavedCase working copy linked to its SavedCase id and base revision
**When** I save edits, including after another working copy has saved
**Then** the UI uses Epic 8.10's compare-and-swap outcome: a matching revision updates that SavedCase, while a conflict is visibly reported and never shown as "Saved to My cases" (AD-20, FR-7, UX-DR61)
**And** conflict retains my working inputs and the stored Case is not overwritten; Retry does not silently rebase and resubmit stale inputs over the current revision.

**Given** a name entered on Save or Rename
**When** it is submitted
**Then** leading and trailing whitespace is trimmed, a blank result falls back to the suggested default name, duplicate names are allowed, and the 100-character limit counts user-perceived characters (grapheme clusters); a generated suggestion longer than 100 is cut at 100 (owner decision, 2026-11-16) (FR-8, UX-DR42)
**And** the counter uses the same grapheme count as the server validation.

**Given** a save is rejected because the SavedCase changed elsewhere since I opened it
**When** the conflict is shown
**Then** it says "This case changed elsewhere" and offers exactly two choices: "Open latest version" (discards my working edits) and "Save as a new case" (keeps them as a new SavedCase) (owner decision, 2026-11-16) (AD-20, UX-DR61)
**And** there is no merge and no force-overwrite, and nothing is discarded until I choose.

### Story 10.2: Find and rename named Cases in My cases

As a registered family member with several Saved cases,
I want to find Cases by name and last change and rename them inline,
So that I can keep returning to the right estate as my work develops.

**Acceptance Criteria:**

**Given** Epic 8's list readers and populated names, including default names backfilled from original save dates
**When** I visit /{locale}/cases/
**Then** each owned Saved case uses its Case name as the main label and shows its last change, with the default list ordered by last change as in UJ-3 (FR-8, UX-DR85)
**And** Case-name sorting is also available, the case reference is no longer the main label, and this story does not repeat FR-9's default-name or Basis migration; [ASSUMPTION: UJ-3's last-change order means most recently changed first, consistent with the shipped list].

**Given** an owned Saved case in My cases
**When** I activate inline Rename
**Then** the same labelled case-name-field starts with its current name, accepts any script up to 100 characters and displays the counter and accessible boundary from Story 10.1 (FR-8, UX-DR42, UX-DR85)
**And** successful submission shows the accepted name on subsequent list loads and leaves family, estate, Basis, stable identity and existing share/invite links intact.

**Given** a rename is invalid, fails, or competes with a newer stored change
**When** its server response arrives
**Then** no successful rename is shown unless accepted, and failure keeps the entered name available for correction or retry without replacing the stored family (FR-8, AD-20)
**And** mutation consumes the foundation's revision/conflict boundary rather than writing a stale full snapshot; the exact blank-name policy and conflict-recovery controls remain open questions below.

**Given** keyboard use, a screen reader, or an Arabic RTL phone layout
**When** I identify a row, open Rename, edit and submit
**Then** visible names identify the associated Open/Rename controls, every input is labelled, controls have at least 44px targets and visible focus, and mixed-script names use bdi dir=auto (NFR-1, UX-DR42, UX-DR85)
**And** the list reflows at 320px/400% zoom without hiding those actions, follows system light/dark tokens and uses published Locale copy through Epic 8's catalog/UI-copy ownership.

**Given** the owned list is loading, empty or unavailable
**When** My cases renders
**Then** loading uses layout-shaped 12px skeleton-lines with regional aria-busy and reduced-motion-safe treatment, and an empty result is distinguishable from a failed request (UX-DR55, UX-DR85)
**And** the explicit new-Case action remains reachable; [ASSUMPTION: the shipped empty/error messages are retained and a failed list offers Retry, because EXPERIENCE lists detailed My cases empty/failed treatment as a deferred gap].

**Given** My cases with several Saved cases
**When** I sort the list
**Then** the default order is most recently changed first, and name sorting uses the current Locale's collation (owner decision, 2026-11-16) (FR-8, UX-DR85)
**And** ties are broken by most recent change.

### Story 10.3: Open Saved cases directly and keep guest recovery separate

As a returning family member,
I want my selected Saved case to open immediately and authentication to return me to it,
So that I can continue the same estate without a resume-or-start-over detour.

**Acceptance Criteria:**

**Given** an owned Saved case selected in My cases, including one already converted by Epic 8
**When** opening succeeds
**Then** /{locale}/interview/ displays that Case's loaded family directly, without the "Start an inheritance case / resume or start over" screen (FR-7, UX-DR65, UX-DR85, UJ-3)
**And** it consumes the server working copy linked to SavedCase id/base revision and Epic 9's tree/list editor with Epic 8's revision-tagged preview, preserving stored School/compare intent, estate, currency, stable ids and later-death links (AD-18, AD-20).

**Given** My cases has one or more Saved cases or none
**When** I choose its separate, explicit new-Case action
**Then** a new Case opens through the existing Case-start boundary rather than treating Open as start-over (FR-7, UX-DR85)
**And** the new Case is not linked as a write-back to the previously opened SavedCase, and creating it does not delete or overwrite any Saved case.

**Given** authentication has expired while I am opening a selected Saved case
**When** I sign in successfully
**Then** the pending selection returns me to that same authorised Case and opens it directly in the Interview (FR-7, UX-DR85, UJ-3)
**And** cancellation or failed sign-in never reports an open success, and a different account cannot acquire access merely from the retained selection; unauthenticated My cases and Save retain the shipped sign-in-and-resume pattern.

**Given** opening is pending or returns an unavailable, missing or unauthorised Case
**When** My cases handles the outcome
**Then** navigation to the selected Interview occurs only after a successful authorised load, with a visible failure otherwise (FR-7, UX-DR85)
**And** it neither displays a different session family's data as the selected Saved case nor substitutes a new blank Case for an unsuccessful open; existing ownership and typed-error outcomes from Epic 8 are preserved.

**Given** a guest returns to an unsaved Case before 24 hours have elapsed since its last change
**When** the Interview loads
**Then** the shipped resume/start-over prompt remains available only for that returning unsaved guest path, while Saved cases bypass it (FR-7, UX-DR65)
**And** [ASSUMPTION: retained explicitly from FR-7 and EXPERIENCE] this guest-only prompt policy is preserved; the 24-hour lifetime itself is enforced by Epic 8's AD-20 service on every read/edit, not by browser state.

**Given** the guest Case has expired 24 hours after its last change
**When** the Interview reads it or an edit reaches the service
**Then** it consumes the foundation's expired outcome and displays "This case has expired", a plain explanation of the guest lifetime and one new-Case action, without family data (AD-20, UX-DR66, guest scope)
**And** it offers no resume of the expired family, while an enduring SavedCase remains reopenable after sign-in rather than being treated as an expired guest Case.

**Given** the current working Case has unsaved changes
**When** I open a Saved case or start a new Case from My cases
**Then** I am asked "Discard unsaved changes?" first, and cancelling keeps the current working Case untouched (owner decision, 2026-11-16) (FR-7, UX-DR85)
**And** confirming discards only the unsaved working copy, never any Saved case.

### Story 10.4: Preserve received invitations and label shared Cases as read-only

As a family member receiving a Case,
I want My cases to retain my invitation entry paths and shared views to state their read-only status,
So that I can inspect the owner's current saved estate without confusing it with my own editable Case.

**Acceptance Criteria:**

**Given** My cases now lists named owned Cases
**When** I view its received-invites section or follow an invitation
**Then** the shipped /{locale}/received/ and /{locale}/invite/ entry paths remain available with existing invitation acceptance, authentication, expiry and revocation rules (UX-DR85, UX-DR88, non-Country scope)
**And** the named owned-Case Open/Rename actions do not grant ownership or rename access to received Cases, and existing route identifiers/tokens continue to reach their intended Case.

**Given** a valid share link to a School or compare SavedCase
**When** /{locale}/shared/ renders
**Then** a shared-case-banner at the top explicitly states that the view is read-only, using components.shared-case-banner colors.accent-soft, 1px colors.accent border, rounded.node and 12px padding (UX-DR88, non-Country scope)
**And** the banner invents no Country name/version for that Basis, and editing/renaming the owner's Case is not exposed by this read-only view.

**Given** the owner has a saved family and then changes only its working copy
**When** a valid shared link is opened before and after the owner successfully saves
**Then** the view reads the current persisted SavedCase through Epic 8's live-view reader and shared presentation, reflecting only accepted saves (AD-18, AD-20, UX-DR88)
**And** it does not expose unsaved working inputs or treat a cached result as canonical; preset-version messaging and switching remain Epic 14 work.

**Given** a shared link or received/invite entry is expired, revoked, invalid or inaccessible
**When** the existing access boundary refuses it
**Then** the view retains the shipped access/error outcome and returns no protected family or editable fallback (UX-DR88, NFR-4)
**And** a genuine expired-case outcome uses the plain expired treatment and one new-Case action without claiming that Saved cases or all share links have the guest's 24-hour lifetime; detailed revoked/invalid copy remains a documented source gap (UX-DR66, applicable shared scope).

**Given** PDF generation or share-link creation/copy is invoked through the existing saved-Case actions
**When** progress, success or failure is presented
**Then** those outcomes use the same inline status-line as Story 10.1's save states, including PDF generating/failed and share-link created/copied states (UX-DR61)
**And** the family stays available on failure, "copied" appears only after a successful copy, source wording retains draft status, and this story does not redesign Full results actions or regenerate the PDF calculation pipeline.

## Epic 11: Clearer results

Results name the School only when it matters, Full results is a primary button, users understand "estate to divide" and see which facts they supplied, amounts add up to the estate, and phones get the sticky summary bar and sheet.

### Story 11.1: Show School agreement and ask for a School only when shares differ

As a family member reviewing a calculation,
I want agreement stated plainly and a School choice only when it matters,
So that I understand why my result depends on a School.

**Acceptance Criteria:**

**Given** Epic 8.6–8.7's PresentedResult and existing preview/results School-choice consumers
**When** the server presentation indicates agreement
**Then** Share preview and Full results show “Same result in all four Sunni schools”, with the preview line in teal above the rows and no “Calculated under the {school} school” line (FR-10, UX-DR36, UX-DR43)
**And** agreement is consumed from presentation, including its per-person share/status comparison, rather than inferred from a null School or recomputed in the browser (AD-19).

**Given** presentation requires a School selection
**When** Share preview or Full results renders the choice
**Then** a short question and School choice-cards show the differing shares side by side until selection, in a 10px-radius group with 12px padding (FR-10, UX-DR43)
**And** cards retain their 2px border at 60% currentColor, full checked border, 10% checked tint, visible focus and minimum 44px targets; this School-only flow adds no upfront Basis step or Country selector.

**Given** a user selects a School from that prompt
**When** the existing revision-aware command succeeds and the matching presentation arrives
**Then** both surfaces name the chosen School when the shares differ and display its presented result (FR-10, UX-DR43, AD-20)
**And** a failed or conflicting command preserves the accepted Case and uses existing recovery handling without claiming the attempted School was applied.

**Given** a partial School refusal, a wholly refused calculation or a failed preview
**When** the presentation is rendered
**Then** explicit refusal reasons remain distinguishable from available comparisons and no false all-four agreement is asserted (FR-10, AD-19)
**And** refused outcomes show no shares, while existing error/Retry handling preserves the family; no replacement School answer is invented.

**Given** the Basis is a single School rather than "compare all four Schools"
**When** presentation produces the result
**Then** it also runs the four-School comparison (extending Epic 8.6's presentation) so the agreement line is backed by an actual comparison, never inferred from the selected School (owner decision, 2026-11-16) (FR-10, AD-19)
**And** the extra comparison stays within the NFR-3 p95 1 s preview budget and does not change the selected School's shares.

### Story 11.2: Present one readable Share preview in the desktop slot

As a family member editing a Case,
I want readable shares beside my family on a wide screen,
So that I can review the latest result and open Full results easily.

**Acceptance Criteria:**

**Given** Story 11.1, Epic 8's presented output and Epic 9's reserved preview slot
**When** the Interview is at least 1280px wide
**Then** the Share preview occupies the 340px third column inside the existing maximum 1360px shell, with 24px padding, background token and a 1px inline-start decorative divider (UX-DR37, UX-DR79)
**And** it uses the existing editor layout without rebuilding the 380px relatives column or flexible tree, and no sticky summary bar is shown.

**Given** an available presentation with inheriting and blocked people
**When** share-rows render
**Then** each shows its presented label, optional muted sub-line, exact fraction, percentage and amount when supplied, with bold values aligned to the logical end and 1px decorative row dividers (UX-DR36, UX-DR37)
**And** blocked rows use readable muted text and smaller values with explicit “No share in this case”, preserving server language/direction metadata and bidi isolation rather than relying on colour alone (AD-19).

**Given** the preview's content and existing notice slots
**When** the preview renders in a published Locale
**Then** the always-present calculation-aid/not-a-fatwa-or-legal-advice disclaimer is non-dismissible, plain semibold text in a 1px border at 60% foreground, 6px radius and 12px padding (UX-DR37, UX-DR47, NFR-X3)
**And** supplied Beta state remains visible with its explanation; Country links, Country Beta activation and Country/civil-law notices remain extensions owned by later epics, without hard-coded presets.

**Given** the preview has shares
**When** I activate its Full results action by touch, mouse or keyboard
**Then** a primary button styled action opens /{locale}/results/, replacing the old text link under the table, with at least a 44px target and WCAG AA contrast (FR-11, UX-DR37)
**And** the shared content can also render inside Story 11.3's sheet without duplicating result meaning or numeric formatting; navigation Links retain prefetch=false.

**Given** an edit, Undo or active-estate navigation from Epic 9
**When** the preview updates, fails or receives an obsolete response
**Then** this component uses the existing revision reconciliation, pending/error states and shared polite announcement region, keeping tree, list and shares on the accepted estate/revision (UX-DR37, AD-20)
**And** pending numbers are visibly pending, stale responses are discarded, failures retain the family and Retry, and neither new live regions nor client share arithmetic are introduced.

### Story 11.3: Open the full preview from a sticky summary bar and modal sheet

As a family member using a phone or tablet,
I want a persistent Full results action and an expandable preview,
So that reviewing shares does not require scrolling back through my family.

**Acceptance Criteria:**

**Given** Story 11.2's shared preview content and an Interview below 1280px
**When** shares become available
**Then** a fixed bottom bar spans the full viewport width, including the 1024–1279px two-column layout, and shows heir count, “shares ready”, primary Full results and a 44px expand toggle (FR-11, UX-DR38, UX-DR77, UX-DR78)
**And** it has a 2px foreground top border and 0 -6px 16px rgba(0,0,0,.12) token shadow; it is hidden before shares exist and Full results is visible without scrolling at 375px.

**Given** the bar is visible
**When** I tap its expandable area or activate its chevron
**Then** the full Share preview opens in a modal dialog via showModal(), with a “Share preview” heading and Close button (UX-DR39, UX-DR74)
**And** Full results remains a separate navigation action, the background and sticky bar are inert, focus moves to the sheet heading and the native modal focus trap applies without stacking another modal.

**Given** the sheet is open
**When** its content exceeds the available space
**Then** the sheet remains at most 78% of viewport height and all preview content and actions remain reachable by scrolling inside it (UX-DR39)
**And** its top-only corners are 18px, top separation is 2px foreground, shadow is 0 -8px 24px rgba(0,0,0,.2), scrim is 40% light/60% dark, and the heading/Close title bar has a hairline divider with no shadow.

**Given** the sheet was opened from the bar
**When** I use Close, Escape or tap the scrim
**Then** it closes, releases the inert bar and returns focus to the chevron (UX-DR39, UX-DR74)
**And** opening/closing leaves the Case unchanged, targets remain at least 44px, and reduced motion disables sheet slides and scrim fades without disabling interaction.

**Given** a pending update or preview error while the bar or sheet is present
**When** existing Epic 8–9 state handling updates the preview
**Then** the sheet shows the same accepted presentation and pending/error handling as the desktop preview (UX-DR37, UX-DR38, UX-DR39)
**And** the bar never describes old shares as a newly completed result, the family is retained and no duplicate row announcements are emitted.

### Story 11.4: Keep summary controls reachable at narrow widths and high zoom

As a user with a small screen or enlarged text,
I want the preview controls to reflow without covering my work,
So that I can reach both family editing and results.

**Acceptance Criteria:**

**Given** Story 11.3 and an Interview narrower than 360px
**When** the summary bar renders at 320px or equivalent 400% zoom
**Then** it wraps into text above and Full results/chevron below, with no horizontal page scrolling (FR-11, UX-DR38, UX-DR80)
**And** labels and at least 44px targets remain usable with text-spacing overrides in LTR and RTL.

**Given** the bar and Epic 9's Undo toast are visible together
**When** their dimensions or the viewport change
**Then** their combined obstruction is no more than 25% of viewport height and scroll-padding-block-end equals that combined height through Epic 9's obstruction contract (UX-DR80)
**And** the toast sits above the bar and keyboard-focused cards, Heirs rows and controls can scroll clear of both without altering the toast's Undo semantics.

**Given** a phone landscape viewport less than 480px high
**When** the Interview renders
**Then** an in-flow “Share preview” button replaces the fixed bar and opens the same sheet (UX-DR77, UX-DR80)
**And** [ASSUMPTION: EXPERIENCE specifies return to the opener; use the in-flow button as the return-focus target when no chevron exists] closing returns focus to that button, retaining the 78% sheet height limit and 44px targets.

**Given** below-1024px, 1024–1279px and at-least-1280px layouts
**When** the viewport crosses a preview breakpoint
**Then** preview placement follows bar/sheet, bar/sheet and desktop column respectively, using logical properties and preserving the accepted result (UX-DR77, UX-DR78, UX-DR79)
**And** the existing 16px mobile gutters, editor column structure and labelled canvas-only 2D scrolling with at least 6px focus padding remain intact; [ASSUMPTION: sources do not specify focus on a breakpoint change] focus stays on an equivalent visible preview control if its original control is removed.

**Given** the summary and results surfaces in published ar/en/fr Locales
**When** acceptance checks exercise 320px/400% zoom, text-spacing overrides, keyboard use, RTL and light/dark modes
**Then** controls and focus remain visible, text contrast is at least 4.5:1, essential boundaries/focus at least 3:1, and relevant Playwright axe and reflow checks pass (NFR-1, UX-DR74, UX-DR77–80)
**And** reduced motion preserves every summary action, while Full results uses a labelled horizontal table-scroll region rather than causing horizontal page scrolling.

**Given** the wrapped bar plus the undo toast would exceed 25% of viewport height
**When** both are shown
**Then** the toast is placed in the page flow above the bar instead of overlaying content, keeping both reachable and the 44px targets unchanged (owner decision, 2026-11-16) (UX-DR35, UX-DR80)
**And** focus retention across breakpoint changes follows the draft assumptions, with copy reviewed in Epic 12.

### Story 11.5: Preserve the results table and make result actions clear

As a family member reviewing Full results,
I want familiar proof and clearly ranked download, save and sharing actions,
So that I can inspect and keep a draft result confidently.

**Acceptance Criteria:**

**Given** Stories 11.1–11.2 and the existing inheritance-table.tsx/results-view.tsx consumers
**When** Full results renders an available presentation
**Then** the bordered inheritance table retains its screen-reader caption, active-row 10% currentColor tint, dotted-underlined proof buttons and LTR-isolated fractions (UX-DR40)
**And** existing single-estate and later-death proof/table semantics are preserved, with all labels and numbers consumed from Epic 8's presentation rather than reconstructed.

**Given** available Full results
**When** its action row renders
**Then** Download PDF is primary and Save, Share link and WhatsApp are secondary, wrapping with 12px gaps and at least 44px targets (UX-DR41)
**And** the actions reuse shipped download, auth-gate, share and WhatsApp paths, with the always-visible non-dismissible disclaimer styled as plain semibold notice text with 1px 60%-foreground border and 12px padding (UX-DR47, NFR-X3).

**Given** a guest activates Save or Share link
**When** the shipped sign-in dialog completes or is cancelled
**Then** success resumes the requested action for the same Case and cancellation preserves the Case without claiming a save or share succeeded (UX-DR41)
**And** existing naming integration from Epic 10 is reused if present, without rebuilding account, Saved case naming or sharing permissions.

**Given** a PDF, save or share operation is pending or fails
**When** the existing action state is rendered
**Then** inline generating/saving/created/copied or failure/Retry feedback remains associated with the operation and the family stays available (UX-DR41, UX-DR61)
**And** failed downloads are not reported as completed, draft wording is retained and the redesign does not stack sign-in or sharing dialogs.

**Given** results on phone, tablet or desktop in LTR/RTL
**When** I inspect proof or use the actions by keyboard
**Then** phone results remain single column with labelled horizontal table scrolling, tablet/desktop use max-w-5xl (1024px) content, 24px page gutters and 48px/64px vertical rhythm (UX-DR40, UX-DR77, UX-DR79)
**And** focus outlines remain visible, actions wrap without clipping and errors/refusals retain existing no-stale-result handling.

### Story 11.6: Explain the estate input and identify user-supplied facts

As a family member entering an estate,
I want guidance before entering money and a clear statement of the facts I supplied,
So that I understand the calculation's limits before sharing its draft PDF.

**Acceptance Criteria:**

**Given** the Interview estate amount field before any amount is entered
**When** I reach it visually or with a screen reader
**Then** its visible associated hint explains that debts, funeral costs and bequests come out first, and jointly owned or beneficiary-designated assets may not form part of the estate (FR-12, UX-DR84 estate-guidance portion)
**And** the hint is available before input rather than appearing only after submission, in each published Locale, without requiring Country selection.

**Given** a user-entered family and estate
**When** Full results or the regenerated draft PDF is read
**Then** it states that the estate amount and family were supplied by the user and not verified by Mawareeth (FR-12)
**And** this factual limitation appears alongside the non-dismissible calculation-aid/not-a-fatwa-or-legal-advice disclaimer, without a certified, verified or court-approved claim (UX-DR47, NFR-X3).

**Given** no estate amount is supplied
**When** results or the draft PDF is produced
**Then** exact shares remain available under the existing contract and the supplied-facts wording does not claim an amount was supplied (FR-12, AD-19)
**And** [ASSUMPTION: FR-12 does not supply a no-amount copy variant] the wording identifies the supplied family and absence of an estate amount without inventing zero money.

**Given** invalid estate input or a failed PDF request
**When** the existing validation/retry path is used
**Then** the guidance and family remain available and invalid input is not described as a verified estate or successful report (FR-12)
**And** the existing typed error and draft-generation behaviour are reused; this story introduces no debt, joint-asset or beneficiary calculator and no new validation arithmetic.

### Story 11.7: Make rounding adjustments visible and reconcile displayed totals

As a family member checking monetary shares,
I want an explicit rounding adjustment and unchanged exact fractions,
So that I can account for the whole estate across preview, results and PDF.

**Acceptance Criteria:**

**Given** Stories 11.2, 11.3 and 11.5 and Epic 8.6's half-up allocations and signed rounding output
**When** an estate produces a non-zero rounding remainder
**Then** desktop Share preview, summary-sheet, Full results and draft PDF show a separate labelled “rounding” line with its server-presented signed amount (FR-13, UX-DR37)
**And** it is kept distinct from any legal unallocated/treasury share and from Heir shares; every consumer renders the same presentation without redistributing the adjustment (AD-19).

**Given** the same estate, currency and presentation on screen and PDF
**When** displayed amounts are checked
**Then** currency minor-unit amounts, including the signed rounding line and any legal unallocated amount, sum exactly to the estate (FR-13, AD-19)
**And** acceptance examples cover positive and negative adjustments, no remainder, and 0-, 2- and 3-minor-digit currencies using foundation fixtures, without exposing Epic 16's currency selector.

**Given** exact fractions, percentages and amounts in ar/en/fr presentations
**When** they appear on preview, Full results or PDF
**Then** exact fractions remain unrounded and server-formatted strings retain language/direction and bidi isolation consistently (FR-13, AD-19, NFR-X7)
**And** no browser Intl formatting, floating-point rounding or PDF-specific allocation arithmetic is introduced; this story verifies user-facing acceptance of Epic 8.6–8.7 rather than reimplementing them.

**Given** no estate amount, invalid precision or a refused calculation
**When** the corresponding presentation/error is rendered
**Then** an absent estate invents neither amounts nor a monetary rounding adjustment, invalid precision follows the existing typed error path, and a refusal shows no monetary shares (FR-13, AD-19)
**And** family inputs and existing recovery behaviour remain intact; zero-remainder row visibility remains an explicit source question rather than a new display rule.

**Given** the rounding adjustment for an estate is exactly zero
**When** results are presented
**Then** no rounding line is shown in the preview, sheet, Full results or PDF (owner decision, 2026-11-16) (FR-13)
**And** any non-zero adjustment is always shown.

## Epic 12: Honest pages and privacy-safe measurement

Terms and privacy pages match the product; the owner's Arabic/French, proof, refusal and kinship-label review passes land; product events are counted on the server without cookies or personal data; the owner can rerun the SM-1 usability test. Decides retirement of the legacy results pages and the Google Analytics tag.

### Story 12.1: Replace outdated legal claims and record legacy retirement decisions

As a visitor entering family information,
I want terms and privacy pages that describe the product honestly,
So that I can understand its licence, data handling and limits.

**Acceptance Criteria:**

**Given** the existing localized Terms and Privacy routes and `web/src/i18n/public-pages.ts`
**When** the AI drafts replacement copy for owner review in ar/en/fr
**Then** Terms states AGPL-3.0, removes the all-rights-reserved claim and redistribution prohibition, and both pages and their metadata correct typos including "webste" (FR-31, NFR-5)
**And** wording stays calm and plain, retains calculation-aid/not-fatwa/not-legal-advice and qualification advice, and makes no certified, official or court-approved claim (UX-DR82, NFR-X3, NFR-X4).

**Given** the product's accounts, saved Cases, sharing, invitations, email delivery and WhatsApp paths
**When** the owner checks the privacy draft against implemented behaviour and approved later-wave contracts
**Then** it removes advertising-partner boilerplate and covers accounts, sharing, email, WhatsApp, support Tickets, API use, retention and the rights of families whose data is entered, including information about the Deceased (FR-31, NFR-4)
**And** it distinguishes existing features from planned Tickets/API features, describes guest expiry after 24 hours from last change, closed-Ticket retention of 12 months and deletion on request within 30 days, and name-free prefill expiry/redemption under AD-22 without claiming those later features already operate; unresolved account/SavedCase retention and rights-request details remain owner questions rather than invented policies (AD-20, AD-22, AD-24).

**Given** the architecture's open legacy-results retirement item and deferred-work's 2026-11-13 decision that old calculation URLs are retired without redirecting to migrated Saved cases
**When** the owner considers the results/new-results route and template inventory
**Then** the decision record explicitly asks whether to retire those server-rendered results pages, with recommended default "retire both after confirming migrated Saved cases remain reachable through My cases; honour the existing no-redirect-to-migrated-case decision" (FR-31, AD-19)
**And** this remains an open owner decision until recorded; an accepted retirement removes their result views/routes/templates without deleting calculation data or broadening into all legacy HTML retirement, while retained pages continue consuming Epic 8's PresentedResult without independent arithmetic or formatting.

**Given** the GA tag in `calc/templates/calc/base.html` and FR-44's server-event replacement
**When** the owner considers the analytics decision record
**Then** it explicitly asks whether to retire GA, with recommended default "remove the GA script and initialization from all surviving templates because FR-44 counting replaces page-view analytics for product metrics" (FR-44, AD-23, NFR-4)
**And** the decision stays open until owner-recorded; accepted removal is checked across surviving pages, and Privacy describes the actual outcome rather than claiming no analytics while a tag remains; the separately observed Cloudflare beacon is flagged for owner verification and disclosure.

**Given** published legal pages and their existing shell
**When** a visitor opens Terms or Privacy from the footer or changes between ar/en/fr
**Then** the correct localized page and metadata remain reachable through the existing wrapped navigation, underlined footer links, surface band and muted note (FR-31, UX-DR10, UX-DR11)
**And** keyboard access, visible focus and RTL are retained; no Contact/API link is activated before its owning epic ships, and invalid Locale handling retains the existing unavailable-page outcome.

**Given** the owner checklist containing each legal section, metadata, implemented data path and both retirement decisions
**When** the owner confirms or corrects an item
**Then** its reviewed version, outcome and date are recorded, with unconfirmed wording remaining a draft (FR-31, NFR-X4)
**And** unresolved policies or retirement choices are listed explicitly and prevent claiming the corresponding review/retirement complete; no outside legal or scholarly sign-off is asserted.

**Given** the legacy server-rendered results pages and routes
**When** this story ships
**Then** they are retired (owner decision, 2026-11-16): their templates and views are removed, and any retired URL returns a plain localized "This page has moved" page linking to My cases, with no redirect into a migrated case (FR-31, AD-19)
**And** migrated Saved cases remain reachable through My cases before the routes are removed.

**Given** the Google Analytics tag in surviving templates
**When** this story ships
**Then** the GA script and initialization are removed everywhere and replaced by Cloudflare Web Analytics, the cookie-free edge beacon (owner decision, 2026-11-16) (FR-44, NFR-4)
**And** the CSP allows only the Cloudflare beacon origin, no cookie or personal identifier is set, and the privacy page discloses Cloudflare Web Analytics and what it collects.

**Given** the landing, about, FAQ and legal pages
**When** their information blocks are reviewed
**Then** they keep the shipped card component (surface, line border, rounded.xl) unchanged (UX-DR7)

### Story 12.2: Reconcile the Arabic and French copy backlog with owner review

As the owner,
I want a complete keyed copy checklist and a French Interview regression journey,
So that every deferred Arabic and French string has an honest review outcome.

**Acceptance Criteria:**

**Given** every unreviewed Arabic/French entry in `deferred-work.md` and Epic 8's catalog/registry
**When** a review checklist is assembled
**Then** each entry maps to its current key, source text, consumer and backlog reference, including Cancel, preview text, kinship/hajb hints and errors, invitations/email, WhatsApp/fallback, add-heir picker, password change, landing/about/FAQ/footer/metadata, legal text, pageError and School-choice/PDF agreement text (FR-32, AD-21)
**And** moved keys are traced to their replacement, proof/refusal/fiqh entries link to Story 12.3, and a removed legacy-only string is recorded as obsolete with evidence rather than silently omitted or marked reviewed.

**Given** the checklist and AI-drafted corrections
**When** the owner reviews each non-scholarly Arabic/French item
**Then** each active listed string is corrected or confirmed and recorded as "owner-reviewed" with a date only after that review (FR-32, NFR-X4)
**And** general UI copy stays with messages.ts/public-page copy and .po, catalog-owned text uses its AD-21 review field, and [ASSUMPTION: AD-21 does not define general-copy review storage] a keyed companion checklist records general-copy status without moving it into the fiqh catalog; awaiting native review is retained separately from owner review.

**Given** the complete EXPERIENCE Voice and Tone English/Arabic table and wave-1 copy from Epics 9–11
**When** the owner checks labels in context
**Then** the checklist covers deceased, before/later death, edit status, breadcrumb, blocked, agreement, preview, Full results, disclaimer, law/translation Beta, smart prompt, Undo, refused add and 50-Heir limit (UX-DR82, UX-DR83)
**And** relatives are named plainly, defaults are numbered in the current Locale, names stay optional and the family is never called wrong; Arabic drafts retain draft status until reviewed, the female-deceased Arabic wording remains an explicit owner question, and future Country/Beta copy can be reviewed without enabling those features.

**Given** the existing Arabic and English automated browser journeys and the French Interview
**When** an equivalent French journey is added and run during implementation
**Then** it covers family entry, edit/delete/Undo, share preview, School choice where required and Full results, with French labels and no missing/empty strings (FR-32)
**And** a refused action and failed preview preserve the family and understandable recovery text, reusing the shipped flows rather than rebuilding Epics 9–11.

**Given** corrected copy and its review records
**When** the existing catalog/placeholder/generation checks validate it
**Then** missing/empty keys, broken named placeholders and generated drift still fail through Epic 8's validator (AD-21)
**And** an unreviewed or rejected item cannot be marked complete by an AI edit or a passing browser test; source changes after review are flagged for renewed owner review [ASSUMPTION: review invalidation mechanics are not specified].

### Story 12.3: Clarify proof and refusal wording without implying scholarly approval

As a family member reading an explanation,
I want plain proof, refusal and relationship wording with truthful review status,
So that I understand the result and its limits.

**Acceptance Criteria:**

**Given** deferred proof, refusal and kinship wording and Epic 8's stable catalog codes
**When** the owner review packet is prepared
**Then** it includes proof codes/relationship verse assignments and labels, grandmother positions and `father_blocks_his_mother`/`grandmother_inherits_with_her_son`, `radd_later_scholars` and spouse wording, Malikiyya/unsupported-School refusals, hajb/kinship hints, all 23 automatic-lineage paths and ambiguity questions, and manasikhat refusal wording (FR-33, AD-21)
**And** examples show the current meaning and ar/en/fr rendering, with qualified-review questions about derivation, layered previews, grandmother rules, verses and Maliki disputes kept visible instead of being resolved by model opinion.

**Given** an item that deferred-work does not reserve for a qualified scholar
**When** the owner checks accuracy and plain language and confirms or corrects it
**Then** its catalog entry records "owner-reviewed" and the review date, retaining stable codes, typed placeholders and Arabic-original references (FR-33, AD-21, NFR-X4)
**And** an item explicitly requiring a qualified scholar remains "awaiting scholar review" and is not relabelled owner-reviewed; any owner language comments are recorded separately and neither tests nor AI drafting imply scholarly approval.

**Given** multiple heirs sharing a fixed entitlement, including two wives sharing 1/8 and unblocked grandmothers sharing 1/6
**When** proof is presented on screen and in the draft PDF
**Then** it states the group entitlement, eligible count and per-person share, explaining 1/16 each for two wives sharing 1/8 (FR-33, AD-19)
**And** a single eligible heir is not described as a group; typed proof/presentation fields and cross-consumer fixtures are extended through the existing versioned contracts where needed, without changing shares or introducing browser/PDF division logic (AD-25).

**Given** a refused or impossible family and the existing presentation path
**When** revised refusal and kinship text renders
**Then** it explains the existing reason plainly in the current Locale without blaming the family or presenting shares as an answer (FR-33, UX-DR82, UX-DR83)
**And** Malikiyya is distinguishable from a repetition of the School name; wording changes do not remove refusals, decide Shibh al-Malikiyya, add Ja'fari rules or alter the engine's blocking/lineage decisions.

**Given** public landing, about and FAQ coverage/limits copy in ar/en/fr
**When** the owner reviews and publishes the correction
**Then** relevant coverage statements say plainly that the Ja'fari school is not supported yet, consistently with the current unsupported-School refusal (FR-33)
**And** four-Sunni-School agreement wording remains precise, the calculation-aid disclaimer and qualification advice stay visible, and no reviewed-language claim removes law/translation Beta status or promises outside sign-off (NFR-X3, NFR-X4, UX-DR82).

### Story 12.4: Count product outcomes in privacy-safe server aggregates

As the owner,
I want durable server counts with explicit triggers and dimensions,
So that product measurement does not track families or individuals.

**Acceptance Criteria:**

**Given** the existing Django/PostgreSQL monolith and Epic 8's Case boundaries
**When** `metrics/events.py` and aggregate storage are introduced
**Then** the registry defines stable codes, precise triggers, allowed dimensions and dedup scope for Case started, first preview with shares, Full results opened, PDF downloaded, Case saved, Basis chosen by kind/preset, Locale used, Ticket opened/first reply, API/MCP calls and prefilled links opened (FR-44, AD-23)
**And** only existing wave-1 producers are wired now; later-event contracts are documented for Epics 13/14/20 without creating their Tickets, public endpoints, keys or tokens and without importing engine into metrics (AD-15, AD-22).

**Given** a successful existing Case action, result open or PDF delivery
**When** its registered trigger occurs
**Then** the server atomically increments the appropriate daily/Locale/country bucket, with Basis kind/preset only where relevant; first-preview counting requires actual shares and a once-per-Case marker in server Case state (FR-44, AD-23)
**And** failed saves/downloads, refused/no-share previews and rejected commands do not emit success events; repeat preview requests and concurrent completions cannot duplicate the first-preview count, and reload/restore cannot erase its dedup marker.

**Given** a request's country headers
**When** aggregate dimensions are selected
**Then** country is accepted only through Caddy's stripped/rebuilt trusted headers, with CF-IPCountry trusted only when the origin is reachable solely through Cloudflare (FR-44, AD-26)
**And** missing, spoofed/untrusted, non-ISO, XX and T1 values map to `unknown`; no IP lookup, person-level country record or new analytics identifier is introduced.

**Given** aggregate rows and measurement requests
**When** storage and redacted diagnostics are inspected
**Then** aggregates contain only day, event, Locale, country and relevant Basis kind/preset, never names, family payloads, IP/user/session/API-key/Case ids, tokens or URLs containing them (NFR-4, AD-23, AD-26)
**And** measurement adds no cookies, fingerprint, browser tracking storage or personal-data fields; existing functional session cookies and Case-state dedup markers are distinct from analytics tracking, while abuse windows and per-key billing remain separate later-epic concerns.

**Given** concurrent workers, both deployment slots or a failed aggregate write
**When** an event is recorded
**Then** committed PostgreSQL increments do not lose updates, with no per-process durable counter (AD-3, AD-23)
**And** [ASSUMPTION: product-event write-failure policy is unspecified] failure emits a redacted operational outcome without undoing a successful family action or inventing a count; this policy needs owner confirmation and does not change AD-23's fail-closed admission rule for future API calls.

**Given** product events are counted
**When** the daily bucket is chosen and a count write fails
**Then** days are UTC, aggregates are retained indefinitely because they hold no personal data, and a failed count write is logged but never blocks or fails the user's action (owner decision, 2026-11-16) (FR-44, NFR-4)
**And** API admission counting (AD-23) still fails closed independently of product-event counting.

### Story 12.5: Expose daily counts and document metric interpretation

As the owner,
I want an aggregate-only measurement view and a metric dictionary,
So that I can assess wave outcomes without accessing personal event histories.

**Acceptance Criteria:**

**Given** Story 12.4's aggregates
**When** an authorized owner opens the existing Django admin measurement view
**Then** counts can be inspected by date, event, Locale, country and relevant Basis kind/preset (FR-44, AD-23)
**And** anonymous/non-owner requests cannot access it, no person-level drill-down exists, and an empty range is shown as no recorded events rather than a fabricated baseline.

**Given** PRD §8 and each event's trigger/dedup scope
**When** the owner consults the metric dictionary
**Then** it explains started-to-first-preview completion for SM-2, the 90 days after each wave versus the 90 days before where a baseline exists, and how future producers support SM-3 through SM-6 (FR-44)
**And** it identifies unavailable pre-release baselines, avoids describing event totals as unique people, and reserves SM-1 actions/time for Story 12.6's moderated protocol rather than inferring them from page views.

**Given** the delete/Undo counter-metric SM-C2 and no approved triggers for it in FR-44's event list
**When** the measurement dictionary is completed
**Then** it records the gap and an owner decision on whether to add aggregate tree-delete and subsequent-Undo events, with proposed Case-state dedup/association and allowed dimensions documented before activation (NFR-4, AD-23)
**And** it makes no claim that SM-C2 or the two-business-day SM-5 target can be calculated from the listed totals alone; business-day/calendar and Ticket latency definitions remain explicit handoffs to Epic 13.

**Given** later epics implementing Tickets, Country choices, API/MCP and prefill
**When** their event integration contracts are handed over
**Then** each specifies the registry trigger and dimensions, including successful first-reply delivery from AD-24 and the distinction between API/MCP invocation counts and billable usage (FR-44, AD-22, AD-23)
**And** the prefill-open versus explicit-redemption distinction and repeat-request counting rules are recorded as owner questions where unresolved; wave 1 remains releasable without those producers.

### Story 12.6: Give the owner a repeatable five-Heir usability test

As the owner moderating a usability session,
I want matching Arabic and English tasks and a minimal scoring sheet,
So that I can rerun SM-1 consistently after product changes.

**Acceptance Criteria:**

**Given** FR-45 and SM-1
**When** the test pack is drafted for owner review
**Then** it contains the same fully specified synthetic five-Heir family and neutral task script in Arabic and English, with setup/reset instructions and no real family names or estate data (FR-45, NFR-4, NFR-X4)
**And** [ASSUMPTION: the PRD does not select a family] the proposed family is a male deceased with wife, mother, father, one son and one daughter, using default labels and no required names; the owner confirms the fixture before using it as the baseline.

**Given** the task script and recording sheet
**When** a moderator runs a session
**Then** written rules define the start state, timing start/stop, counted actions, treatment of bulk-add, errors, corrections, Undo and moderator help identically in both languages (FR-45)
**And** [ASSUMPTION: counting boundaries are unspecified] the proposed timed task runs from the ready family-entry screen until five correct heirs and the matching preview are visible, with each activation/committed edit counted and corrections included; setup and moderator assistance are recorded separately, pending owner confirmation.

**Given** at least five participants completing the same task
**When** the owner records and interprets results
**Then** the sheet captures an anonymous participant code, script language, device/input context, action count, elapsed time, completion and assistance, and compares results with five or fewer family-entry actions and a typical Case under three minutes (FR-45, SM-1)
**And** unfinished/assisted attempts stay visible rather than being discarded; [ASSUMPTION: "typical" is undefined] median elapsed time is proposed alongside individual results, pending owner confirmation, with no statistical or production-baseline claim from this small sample.

**Given** the reviewed pack and a future rerun
**When** the owner follows its checklist
**Then** the same family, script version, counting rules, start/stop boundaries and scoring method can be reused, with release/date and any deviations recorded (FR-45)
**And** no account identity, contact details, recording, real Case content or analytics id is required; owner review and an empty reusable sheet satisfy tooling delivery without falsely claiming participants were tested or SM-1 achieved (NFR-4, NFR-X4).

**Given** usability results from several sessions
**When** "a typical Case" is assessed for SM-1
**Then** the median completion time is compared with the 3-minute target (owner decision, 2026-11-16) (FR-45, SM-1)

## Epic 13: Ask for help and get an answer

Any visitor sends a question through the Contact form, gets a Ticket number by email, and continues the exchange in one email thread; a WhatsApp link reaches support; Ticket data is minimised and deletable.

### Story 13.1: Accept a question and email its Ticket number reliably

As a visitor,
I want my question recorded and its Ticket number emailed to me,
So that I can ask for help without an account or an attached Case.

**Acceptance Criteria:**

**Given** Epic 8's published Locale registry and translation validator and the existing Django application
**When** an admitted, valid Contact submission commits
**Then** it creates a numbered Ticket, its initial message and its acknowledgement outbox row in one PostgreSQL transaction, storing the submitted topic, message, email, Locale and optional visitor-supplied Case link (FR-34, AD-24, NFR-4)
**And** this story first introduces the Ticket, TicketMessage and Outbox models and committed additive migrations, including open/closed state, closing timestamp, nullable first-reply timestamp and per-Ticket reply-address token; it creates no API-key, calculation or analytics tables and support never imports engine.

**Given** the Contact topic choices
**When** the server validates a submission or supplies choices to the web application
**Then** stable topic codes and localized labels come from one data-driven topic definition, including “Question about my result” and “API access” (FR-34, UX-DR52, UJ-5)
**And** an unknown topic is rejected without creating a Ticket; [ASSUMPTION: a version-controlled topic definition is sufficient, with no topic-management screen] adding a topic does not require changing the submission workflow or Ticket schema, and API access creates an ordinary Ticket without issuing a key.

**Given** an acknowledgement committed with its Ticket
**When** the bounded after-commit send succeeds through the existing Brevo SMTP configuration
**Then** the visitor receives the Ticket number in the submission Locale, with a stable Message-ID and the Ticket's Reply-To address t-<token>@reply.<domain> (FR-34, AD-24)
**And** the outbox records successful sending; transaction rollback sends nothing, and an acknowledgement never sets the owner's first-reply time.

**Given** SMTP failure, timeout or competing delivery attempts
**When** the after-commit sender or retry management command processes the outbox
**Then** committed mail remains durable for retry, sent rows are not deliberately sent again, and concurrent workers/slots cannot claim the same pending row simultaneously (AD-24, AD-23)
**And** retries run through a bounded management command and systemd timer using the active-slot deployment pattern, never a thread or another service; [ASSUMPTION: stable Message-ID is reused on retry] an SMTP acceptance followed by a crash remains an explicitly documented delivery-ambiguity case, not an exactly-once guarantee.

**Given** a honeypot hit, implausible submission timing, excessive body or field size, invalid email or excess per-IP traffic
**When** Contact admission and validation run
**Then** tracking-free honeypot, time check and atomic PostgreSQL-backed per-IP admission protect intake across workers and deployment slots, with body bounds before expensive processing and no Ticket/outbox on rejection (FR-34, NFR-X6 contact part, AD-24, AD-26, AD-23)
**And** the shared admission interface/store is reused if already present, otherwise this story first adds only the RateWindow storage/migration it needs; over-limit returns a retry time/Retry-After, store failure fails closed with 503, and numeric limits, timing thresholds and window retention remain explicit configuration questions.

**Given** a guest or signed-in visitor with a Case in the session
**When** Contact is submitted or an error is logged
**Then** only the visitor's deliberate input enters support, with no automatic Case snapshot, names, family, estate or account profile copied into the Ticket, and no automatic fetching of a supplied Case URL (NFR-4, AD-24, AD-26)
**And** Contact retains CSRF protection when using the session boundary, client IP comes only from Caddy-rebuilt trusted headers, and logs omit bodies, names, family, email content and reply tokens, including secret-bearing paths in edge and application logs.

**Given** Contact form submissions
**When** the admission limits apply
**Then** each IP may submit at most 5 per hour, a form submitted under 3 seconds after load is rejected, messages are limited to 5,000 characters, and a replayed submission (same idempotency key) returns the existing Ticket instead of creating a duplicate (owner decision, 2026-11-16) (FR-34, AD-23, AD-26, NFR-X6)
**And** outbound email retries back off over 24 hours and then raise an operator alert (AD-24, AD-27).

### Story 13.2: Ask for help from Contact or WhatsApp and see the real outcome

As a family member seeking help,
I want an accessible Contact page with a WhatsApp alternative and clear submission feedback,
So that I can send my question and know whether it was accepted.

**Acceptance Criteria:**

**Given** Story 13.1 and the existing static-export Next.js shell
**When** I follow Contact us from the footer, results refusal or Full results help
**Then** the localized Contact page opens at /{locale}/contact/ [ASSUMPTION: source route], without sign-in, and presents stacked labelled topic, message, email and optional Case-link fields with one primary submit (FR-34, UX-DR52, UX-DR11 Contact part, UJ-5)
**And** topic choices use Story 13.1's definition, Case data is never required or prefilled from the current Case, navigation Links use prefetch=false, and this integration adds only the Contact action to existing refusal/results surfaces.

**Given** Contact fields in published ar/en/fr Locales
**When** I use them by keyboard, touch or screen reader in LTR/RTL and light/dark modes
**Then** fields use DESIGN contact-form and case-name-field styling: label above, 1px muted boundary meeting 3:1, rounded.lg, minimum 44px controls, visible unclipped focus and plain foreground inline errors (UX-DR52, NFR-1)
**And** the single-column page reflows at 320px/400% zoom with text-spacing overrides, errors are associated with their fields, and copy uses Epic 8's existing UI/email translation ownership and validator; the Case-name 100-character business rule is not imposed on Contact messages.

**Given** invalid input, admission rejection, network failure or failed submission
**When** the form receives that outcome
**Then** it preserves entered text, explains validation inline in plain text, offers WhatsApp and never reports a Ticket or successful email without server evidence (UX-DR52, UJ-5)
**And** a rate limit shows “Too many requests; try again after {time}” using the server's retry time; the API-key request path uses the existing API access topic, with no promise that a key bypasses Contact admission [ASSUMPTION: UX-DR68's key-request wording concerns API limits, not a Contact quota upgrade] (UX-DR68 Contact part).

**Given** a committed Ticket whose acknowledgement SMTP send succeeded
**When** the successful submission is displayed
**Then** Contact shows the Ticket number and email-sent confirmation, and WhatsApp remains visible (FR-34, UX-DR53)
**And** [ASSUMPTION: reconciliation of UX-DR53 with AD-24 retry] if the Ticket committed but mail remains pending or failed, the page shows the number and truthful pending/failure feedback, retains the text and WhatsApp, and does not invite a fresh submission merely to retry that email; lost-response duplicate-submission policy remains an open question.

**Given** the owner-configured support number and current Locale
**When** I activate WhatsApp on Contact, its sent/failure state or the footer
**Then** a wa.me click-to-chat link opens WhatsApp app or web with the support number and a URL-encoded greeting in that Locale (FR-36, UX-DR11 WhatsApp part, UX-DR53, UJ-5)
**And** the footer retains its surface band, underlined links and muted note; only a generic greeting is prefilled, with no automatic Case or message disclosure (NFR-4), and no WhatsApp API or automated replies are introduced.

**Given** the WhatsApp link on Contact and in the footer
**When** it is configured
**Then** it uses the owner's support number, which is also a WhatsApp Business account (owner decision, 2026-11-16), set through deployment configuration rather than hard-coded (FR-36, PRD §11)
**And** the number is never logged with visitor data.

### Story 13.3: Answer and manage Tickets in one admin queue

As the owner,
I want to see open and closed Tickets and answer them from Django admin,
So that I can resolve questions and see when each first answer was sent.

**Acceptance Criteria:**

**Given** Story 13.1's Ticket/message/outbox models and existing staff authentication
**When** the authorized owner opens Django admin support
**Then** open and closed Tickets are available in one place with number, topic, Locale, message history and first-reply time, and can be marked open or closed with the closing time recorded (FR-35, AD-24)
**And** non-staff visitors cannot list, read or mutate Tickets through this admin workflow; no public Ticket dashboard or new helpdesk service is added.

**Given** a Ticket and an owner-written answer
**When** the owner submits that reply
**Then** the reply message and outbound outbox row commit atomically before Story 13.1's bounded sender runs, addressed to that Ticket's visitor with its per-Ticket Reply-To (FR-35, AD-24)
**And** subject continuity and Message-ID/In-Reply-To/References preserve the acknowledgement/reply email thread, while rendering visitor content as untrusted text rather than executable markup.

**Given** no prior successfully sent owner reply
**When** an owner reply is successfully handed to Brevo SMTP
**Then** first-reply time is set once at that successful send, never at draft creation, queueing, acknowledgement or failed send (FR-35, AD-24)
**And** later successful replies and retry attempts do not overwrite it, and failed sends remain visible to the owner as pending/failed rather than answered successfully.

**Given** a failed transaction, SMTP outage or concurrent admin/send operations
**When** replies are saved or retried
**Then** rollback sends no reply, and committed replies reuse the same durable delivery/claim path without inventing a second outbound mechanism (FR-35, AD-24)
**And** the owner can distinguish unsent from sent messages; this story adds only reply-specific metadata actually needed now through additive migrations on Story 13.1's tables, not replacement Ticket/outbox tables.

### Story 13.4: Attach visitor email replies to the correct Ticket

As a visitor continuing a support conversation,
I want my email reply to return to the same Ticket,
So that I can continue the exchange without repeating my question.

**Acceptance Criteria:**

**Given** Stories 13.1 and 13.3's per-Ticket Reply-To and threading metadata
**When** Brevo inbound parsing delivers a visitor reply to the Django webhook
**Then** the Ticket is selected only from the per-Ticket address in Recipients, never from subject text, In-Reply-To or References, and the inbound message joins that Ticket's admin history (FR-35, AD-24)
**And** required inbound MessageId deduplication metadata and uniqueness constraints are first added by this story's additive migration on TicketMessage; no inbound schema is required by the earlier outbound stories.

**Given** a valid inbound payload and MessageId
**When** the webhook stores the message
**Then** the message and its dedupe key commit atomically before a successful acknowledgement is returned (AD-24)
**And** repeated or concurrent delivery of the same message attaches it once; a database failure is not acknowledged as persisted and a retry can complete without duplicating it.

**Given** the inbound URL and request
**When** authentication runs
**Then** the secret in the URL path is compared in constant time, is rotatable through the deployment configuration, and an incorrect secret cannot read or write a Ticket (AD-24, AD-26)
**And** the webhook takes no cookies or session authority, validates bounded payloads before storage, and edge/application/error logs redact webhook secrets, reply tokens and message bodies.

**Given** missing MessageId, malformed payload, an unknown or deleted reply token, or multiple conflicting Ticket recipients
**When** the webhook receives the message
**Then** it cannot append to an arbitrary Ticket, create a replacement Ticket or acknowledge an unpersisted valid reply as stored (AD-24, AD-26)
**And** [ASSUMPTION: ambiguous recipients are rejected without attachment] exact rejection/status policy, sender checks, attachment handling and closed-Ticket reopening remain explicit open questions; implementation fixtures document the selected policy rather than silently inferring it from the subject.

**Given** the configured reply subdomain, Brevo inbound route and outbound SMTP sender
**When** the acknowledgement, owner answer, visitor reply and second owner answer are exercised end to end
**Then** the visitor sees one email thread and the owner sees the exchange on one Ticket, including a duplicate webhook delivery that adds no extra message (FR-34, FR-35, UJ-5)
**And** deployment instructions cover reply-domain mail routing, webhook secret rotation and redaction without introducing another process/container or committing credentials (AD-24, AD-26).

**Given** an inbound reply to a closed Ticket, with attachments, from any sender
**When** the webhook stores it
**Then** the Ticket is reopened automatically, attachments are dropped and the visitor's thread gets a note that attachments are not accepted, and no sender check is applied because the per-Ticket address is the key (owner decision, 2026-11-16) (FR-35, AD-24)
**And** reopening clears the closing time so the 12-month retention clock restarts only when it is closed again.

### Story 13.5: Delete support data on schedule and on request

As a visitor whose question is resolved,
I want my Ticket deleted when its retention ends or when I request deletion,
So that my support conversation is not kept indefinitely.

**Acceptance Criteria:**

**Given** Stories 13.1–13.4's support data and a Ticket's closing timestamp
**When** the bounded retention management command runs from a systemd timer
**Then** closed Tickets are deleted 12 months after closing, including their messages, reply tokens, dedupe metadata and associated outbox payloads (FR-37, AD-24, AD-23)
**And** open Tickets and closed Tickets not yet due remain; 12 months is the PRD assumption resolved by AD-24, times are stored in UTC, and repeated cleanup is safe.

**Given** a visitor asks support to delete their Ticket
**When** the owner processes the request
**Then** the existing Contact/email channel supports that request and an admin workflow records its receipt and ensures deletion within 30 days, including an open Ticket (FR-37, NFR-4)
**And** [ASSUMPTION: use the existing conversation and owner verification rather than a new public deletion portal] identity verification and handling unverified requests remain explicit policy questions; any request-tracking fields/migration are first introduced here.

**Given** deletion and a pending or concurrently claimed send or inbound delivery
**When** deletion completes
**Then** the database holds no retained Ticket content and no later retry can recreate the Ticket or send its remaining queued content (FR-37, AD-24)
**And** a late inbound message follows Story 13.4's unknown/deleted-recipient handling; deletion cannot retract mail already handed to SMTP or erase a visitor's own mailbox or WhatsApp history, and vendor-copy handling is recorded as a retention question.

**Given** delivered outbox rows and expired Contact abuse windows
**When** scheduled cleanup runs
**Then** their payloads/windows are removed under documented retention settings rather than kept indefinitely (AD-23, NFR-4)
**And** undelivered mail for a retained Ticket is not silently purged as delivered, failures emit redacted outcomes, and the exact delivered-outbox/window periods remain open configuration choices.

**Given** a backup restored to an earlier point
**When** the restore runbook is followed before support processing resumes
**Then** Ticket deletions made after that backup are reapplied and restored pending messages cannot send deleted content (FR-37, AD-27)
**And** this story first provides a minimal deletion replay record and its storage/migration only if needed by the chosen restore mechanism [ASSUMPTION: retain opaque deletion identifiers outside the restored backup, without Ticket content]; its protection, retention and replay method are documented and rehearsed rather than relying on records lost in the restore.

**Given** the support retention/deletion workflow
**When** its release facts are handed to the legal-page owner
**Then** the privacy-page input states the 12-month closed-Ticket period, deletion within 30 days on request, email/WhatsApp handling and the request channel (FR-37, FR-31 interface)
**And** Epic 12 owns publication of the privacy text; verification checks that the published page matches these facts without assuming any particular Epic 12 story or measurement implementation.

**Given** a request to delete support data
**When** the owner processes it
**Then** it is honoured only if it comes from the Ticket's own email address or is confirmed through a link sent to that address (owner decision, 2026-11-16) (FR-37, NFR-4)
**And** an unverified request deletes nothing and is recorded as unverified.

### Story 13.6: Verify support delivery, alerts and recovery on the shared host

As the owner/maintainer,
I want visible support failures and rehearsed delivery and recovery checks,
So that questions do not disappear while the rest of the application appears healthy.

**Acceptance Criteria:**

**Given** Stories 13.1–13.5 on the single Hetzner host with both deployment slots running
**When** Contact, admin replies, inbound webhook and retry/cleanup timers run
**Then** every new endpoint/timer emits redacted structured outcomes and low-cardinality latency, error and limit counts, and relevant support dependencies join existing readiness checks (AD-27, AD-8, AD-9)
**And** metrics/log labels contain no email addresses, Ticket content, Case data, reply tokens or secret paths; operational signals do not implement FR-44 product event counting.

**Given** a failed retry/cleanup timer, growing outbox backlog or webhook rejection spike
**When** the configured alert condition is reached
**Then** the existing Prometheus/Alertmanager operator route alerts the AD-8 operator with a usable runbook, extending deploy/monitor.sh and deploy/monitoring/mawareeth-alerts.yml patterns (AD-27)
**And** an alert-path drill demonstrates each support condition; thresholds and retry/cleanup cadence are documented configuration choices, not an invented user-facing response SLA.

**Given** concurrent intake/retry workers, SMTP unavailability, admission-store failure and a duplicate inbound delivery
**When** support acceptance checks run
**Then** they demonstrate atomic Ticket/outbox commit, fail-closed admission, bounded SMTP waits, retry recovery, inbound deduplication and accurate first-reply time (FR-34, FR-35, AD-23, AD-24)
**And** both-slot evidence shows Contact and scheduled commands do not break the foundation's preview/lock budgets; the existing 10-second SMTP timeout is evaluated as a bound, not assumed to meet an unspecified Contact latency target (AD-27).

**Given** Huda's UJ-5 in published Arabic, English and French
**When** she reaches Contact, chooses Question about my result, submits without a Case, receives an answer, replies by email or chooses WhatsApp
**Then** checks cover the numbered page/email acknowledgement, one-thread exchange, optional Case link and localized greeting, plus validation, rate-limit and send-failure text preservation (FR-34–FR-36, UX-DR52, UX-DR53, UX-DR11 Contact/WhatsApp parts, UX-DR68 Contact part)
**And** keyboard, screen-reader labels, RTL, both colour modes and 320px/400% reflow are verified without publishing new Locales or rebuilding Epic 8's registry/validator.

**Given** a restored database and the release's documented support configuration
**When** recovery is rehearsed before resuming mail delivery
**Then** new support tables are checked, Story 13.5's deletion replay is applied, duplicate inbound delivery stays harmless and pending retained mail resumes through the existing outbox (FR-37, AD-27)
**And** release evidence records remaining SMTP ambiguity and source policy questions; no support release is described as complete while mail routing, deletion replay or required operator alerts are unverified.

## Epic 14: Calculate under a country's law — Saudi Arabia and Lebanon

Users switch the Basis from the Share preview or Full results to a live Country law and get shares with statute citations, a Beta label, version stamps on saved, shared and PDF results, and honest refusals where the preset is silent. Ships the preset machinery (versioned TOML presets; rule switches for *radd*, distant kin, grandfather with siblings, mushtaraka and akdariyya; default School for gaps, Saudi Arabia Hanbali), the extended relationship list, the owner go-live gate, and the two presets without an Obligatory bequest: Saudi Arabia and Lebanon (Sunni, with the sect question).

### Story 14.1: Register immutable presets behind the owner go-live gate

As the owner/maintainer,
I want one registry for versioned preset files and their eligibility,
So that unchecked law cannot be selected or executed in production.

**Acceptance Criteria:**

**Given** Epic 8.1's preset/Basis schemas and 8.2's parse_preset/immutable RuleSet
**When** the shell discovers presets/<iso2>/<YYYY-MM-DD>.toml
**Then** it validates path/id/effective-date agreement, reads TOML outside engine and supplies parsed data to the existing parser (FR-X1, AD-17, AD-25)
**And** files hold every addendum §A/§E setting, default_school, default_currency, citations and paired review metadata; display text stays catalog-owned, and no replacement parser, schema, preset table or migration is introduced.

**Given** a candidate version and the owner's checklist
**When** production eligibility is evaluated
**Then** every rule has {statute_id, article, checked_on}, or an explicit gap_school reference backed by checked statutory-fallback evidence, and every listed blocker is closed before registration is enabled (FR-22, AD-17)
**And** the checklist records rule key, official source/article, owner outcome and checked date, including unborn child, simultaneous deaths, killer/apostate bars, difference of religion and no-heir outcome; AI research and tests never count as owner checks.

**Given** unchecked, malformed, blocked or future-dated versions
**When** choices are listed or a Country Basis is resolved
**Then** the registry gates execution as well as selection across internal requests, save/load and restore; unchecked fixtures are available only in explicitly configured non-production environments (FR-22, AD-17, AD-18)
**And** current means newest eligible non-future effective version; once-eligible historical pins remain resolvable, unavailable pins return typed errors, and no caller substitutes the newest version or a School; future API/MCP/prefill consumers receive this same interface without being built here.

**Given** a merged version file
**When** a later data release changes it
**Then** CI rejects editing/deleting it except paired reviewed_by/reviewed_on changes; numerical or citation corrections require a new version (FR-19, FR-20, AD-17)
**And** null review metadata means Beta, removal requires a qualified reviewer's name/date recorded in git, and owner statute approval alone does not remove Beta; PRD §10's phase-2 owner-only review retains the label.

**Given** test-only eligible/ineligible versions and active/rollback images
**When** registry and release fixtures run
**Then** tests cover date boundaries, malformed/unknown ids, listing/execution bypass attempts and historical-version retention (NFR-2, AD-17, AD-20, AD-27)
**And** [ASSUMPTION: eligibility history lives in a version-controlled companion manifest/checklist] production registration remains off until the actual owner checks pass, without modifying immutable rule data to record later eligibility.

**Given** an open legal point marked [TO CONFIRM] for a preset (for example Lebanon Council decisions, effective dates, article maps)
**When** the owner runs the go-live gate
**Then** the preset cannot be made selectable in production while any such point is unresolved; resolution is recorded with source and date in the preset's citations (FR-22, AD-17, NFR-X4)
**And** a Beta label never waives an unresolved go-live blocker.

### Story 14.2: Apply Country rule settings through the shared engine

As a family member choosing a Country law,
I want its settings to control the existing engine,
So that checked statutory departures take precedence over its default School.

**Acceptance Criteria:**

**Given** Story 14.1's test-only presets and Epic 8.2's RuleSet
**When** engine.calculate evaluates Country rules
**Then** radd, distant kin, grandfather with siblings, mushtaraka and akdariyya use resolved settings before explicitly permitted default-School gaps (FR-17, AD-15, AD-17)
**And** the engine remains pure and exact, built-in School behaviour/refusals remain unchanged, and no preset-id branches or separate Country engines are added.

**Given** a matrix of supported setting values and default-School values
**When** focused fixtures vary each setting
**Then** each implemented value and interaction has a known-answer test, including at least one distinguishing family for every setting differing from a preset's default School (FR-17, NFR-2)
**And** only SA/LB-required and existing School modes are enabled here; unsupported values fail validation or explicitly refuse without numbers, leaving later-country algorithms to their owning epics.

**Given** a Saudi-shaped grandfather-exclusion setting
**When** the family is paternal grandfather plus full brother
**Then** the grandfather receives 1 and brother 0, matching research [8] art. 212 rather than Hanbali sharing (FR-17)
**And** husband, mother, paternal grandfather and full sister yields 1/2, 1/3, 1/6 and 0, with no akdariyya distribution; this is a derived arts. 212–213 fixture whose grandfather/mother exception is [TO CONFIRM] at the owner gate.

**Given** husband, mother, two maternal brothers and one full brother
**When** mushtaraka sharing is disabled
**Then** husband receives 1/2, mother 1/6, maternal brothers 1/6 each and full brother 0, matching Saudi research [8] art. 227 and Lebanon's Hanafi default (FR-17)
**And** existing sharing-mode School fixtures still pass, proving the setting independently even where Saudi agrees with Hanbali.

**Given** spouse-last radd and no agnate
**When** the family is wife/daughter, wife alone, or wife/daughter's son
**Then** derived Saudi arts. 231–235 fixtures expect respectively 1/8 and 7/8; 1; and 1/4 and 3/4 (FR-17)
**And** the third family proves distant kin precede spouse radd; research-backed expectations are checked at go-live and never used to rewrite an approved School fixture to hide a difference.

### Story 14.3: Add the relationships reached by descendants and distant-kin rules

As a family member entering descendants or distant kin,
I want the necessary relationships represented with their actual lineage,
So that the calculation distinguishes relatives who reach the estate differently.

**Acceptance Criteria:**

**Given** Epic 8's Family contracts, queries/catalog/commands and Epic 9's existing editor
**When** the relationship inventory is extended
**Then** it includes the predeceased-child marker, son's-line descendants at any depth representable within Case limits, daughter's children of the first degree and maternal grandfather, plus the complete enumerated SA three-class and Hanafi distant-kin relationships used here (FR-6, AD-16, AD-25)
**And** a keyed relationship/class/lineage matrix identifies existing and new support, keeps stable codes/person ids and intermediate lineage, and allows later preset additions without a new Family model.

**Given** an extended relationship and selected rule set
**When** I add/edit/place it through buttons, Add relative here or drag
**Then** existing engine queries and revision-aware commands decide admissibility/lineage identically, distinguishing blocked valid relatives from impossible additions (FR-6, AD-16, AD-20)
**And** tree/outline/list/preview consume the accepted revision; impossible/cyclic/over-limit changes make no partial mutation, predeceased people receive no ordinary heir share, and no obligatory-bequest arithmetic is enabled.

**Given** every new relationship code
**When** catalog and renderer checks run
**Then** each has non-empty labels in every registered Locale through Epic 8.5's validator, Arabic-original references and typed proof parameters (FR-6, AD-21)
**And** current ar/en/fr keyboard/touch entry, RTL/light/dark rendering and PDF glyph checks pass without publishing later Locales or rebuilding the editor.

**Given** the relationship/class matrix and test-only Country rules from Stories 14.1–14.2
**When** known-answer and save/reopen fixtures run
**Then** every new relationship has a test under each School and SA/LB rule set that uses it, including explicit blocked/refused outcomes, and lineage/status round-trips through existing schema-2 storage (FR-6, NFR-2, AD-20)
**And** son's-line depth is not arbitrarily capped at one generation; later-country-only distant-kin classes are an explicit handoff to Epics 15/17 [ASSUMPTION: phased FR-6 completion follows preset availability].

### Story 14.4: Change the Basis from Share preview and Full results

As a family member reviewing shares,
I want an optional list of live Country laws beside my results,
So that I can choose a law or return to comparing the four Schools.

**Acceptance Criteria:**

**Given** Stories 14.1–14.3 and Epic 11.1's agreement/School-selection flow
**When** a new Case starts or School results are displayed
**Then** it starts on {kind:"compare"}, has no Interview Basis step, and consumes the existing School prompt only when comparison requires it (FR-15, UX-DR43 Country part)
**And** the quiet, underlined “Calculate under a country's law” action is available in Share preview, its summary-sheet and Full results, including incomplete/refused states, independently of an FR-14 prompt (UX-DR44).

**Given** I open the Country list
**When** it renders
**Then** registry-driven choice-cards show only live choices in the current Locale with name/version date, unreviewed-law Beta and secondary “Back to all four Schools” (FR-15, FR-20, AD-17, UX-DR45, UX-DR48 Country part)
**And** empty/failed lists explain their state without invented choices or hard-coded browser preset lists.

**Given** I choose a live Country version or return to comparison
**When** the existing Basis command succeeds against expected_revision
**Then** its whole Case pins {kind:"country", preset_id, preset_version} or resets to compare and requests the matching preview; the Country School is derived from the preset (FR-15, AD-18, AD-20)
**And** Country name/date always display even if shares agree with all Schools, without a Country gap-School prompt or reimplementation of Epic 11.1.

**Given** a stale revision, offline state, ineligible selection or failed preview
**When** Basis switching is attempted
**Then** foundation conflict/error handling preserves accepted inputs, discards obsolete responses and never reports the attempted choice as applied (FR-15, AD-17, AD-20)
**And** an accepted Basis requiring facts shows the existing required-fact outcome instead of stale School numbers; Country policies use the Epic 8.4 interface.

**Given** Country controls in ar/en/fr on phone/desktop
**When** keyboard/screen-reader, 320px/400% zoom, RTL and light/dark checks run
**Then** DESIGN link/list/choice-card/Beta tokens give 44px targets, unclipped focus, checked 2px borders, readable contrast and a nearby non-dismissible Beta explanation (NFR-1, UX-DR44, UX-DR45, UX-DR48)
**And** [ASSUMPTION: list hosting is unspecified] the list replaces the current sheet interaction state without stacked dialogs, Close/Escape returns to the opener, and “Beta”/“تجريبي” retains its source wording-assumption status.

### Story 14.5: Cite Country rules in proof and draft PDF

As a family member checking a Country result,
I want each proof step and PDF share to identify its source,
So that I can see the statute and where a School fills a gap.

**Acceptance Criteria:**

**Given** Stories 14.1–14.4 and Epic 8's proof keys/presentation
**When** Country proof is presented
**Then** each share's steps, including blocking, radd and special cases, cite statute/article or explicitly say “default School for gaps: {school}” (FR-18, AD-17, AD-19, UX-DR87 citation part)
**And** the statutory fallback provision provides context without falsely claiming that it prescribes the fraction; School proof remains unchanged.

**Given** a used rule lacks its citation or an approved gap
**When** calculation/presentation is requested
**Then** a typed configuration/coverage failure prevents a complete uncited numeric Country result and a build-time check identifies the missing rule key (FR-18, FR-21, AD-17, AD-19)
**And** adding a gap label cannot bypass a known uncovered rule or owner check.

**Given** one pinned Country Case on Full results and PDF
**When** proof is opened or its draft PDF regenerated
**Then** citations come from the same PresentedResult and the PDF header names the preset/version date with Country Beta and explanation (FR-18, FR-20, AD-19, UX-DR48, UX-DR87)
**And** the disclaimer and supplied-facts wording remain visible, with no certified/court-approved claim, independent PDF arithmetic or new bequest row (PRD §10, NFR-X3).

**Given** Saudi art. 212/227/231 fixture proof and test-only Lebanon Hanafi gaps
**When** ar/en/fr screen and rendered-PDF checks run
**Then** source keys resolve to correct readable citations with bidi-isolated names/fractions and unclipped article text, and exact shares agree across consumers (NFR-1, NFR-2, AD-21)
**And** failed generation preserves the Case and existing Retry path; Epic 16 Country/civil notice publication is not required.

### Story 14.6: Preserve pinned versions and offer explicit recalculation

As a returning Case owner,
I want to see the version I saved and choose whether to update it,
So that a preset release cannot silently change my saved or shared result.

**Acceptance Criteria:**

**Given** Stories 14.1–14.5 and Epic 8.10's schema-2 inputs-only writers
**When** a Country Case is saved, shared, reopened or downloaded
**Then** its stored Basis pins preset_id/version, share views resolve that pin, and the PDF visibly stamps its Basis name/id/version (FR-19, AD-18, AD-20)
**And** no derived result, engine-version stamp or replacement table is persisted; Country writes require the active/rollback reader-writer round-trip matrix to pass.

**Given** a newer eligible effective version exists
**When** the owner opens a Saved case
**Then** the stored version still calculates/displays with “A newer version exists. Recalculate?” and both version dates (FR-19, UX-DR64)
**And** ignoring/declining keeps the pin, future/ineligible versions trigger no offer, and unavailable historical files return typed errors without substitution.

**Given** the owner explicitly accepts Recalculate
**When** the existing revision-aware Basis command resolves the current eligible version
**Then** the working Case advances once to its new pin and recalculates; the SavedCase changes only through explicit save and its existing compare-and-swap (FR-19, AD-18, AD-20)
**And** cancellation/conflict/failure leaves the persisted pin unchanged, new required facts/refusals show no stale numbers, and no GET or background update silently mutates the Case.

**Given** a valid shared/received Country view
**When** the owner has unsaved changes, saves a new pin or a newer preset appears
**Then** the shared-case-banner states read-only, preset name/date and newer-version availability while showing only current persisted family/pin (FR-19, UX-DR88 Country part)
**And** recipients cannot switch the owner's pin; [ASSUMPTION: reconcile UX-DR64 with read-only sharing] only an authorized owner gets an editable-Case path, other viewers get informational update text, and existing invitation/revocation checks remain.

**Given** an old downloaded PDF and later regenerated drafts
**When** the preset or saved family changes
**Then** the downloaded file retains its original stamp; regeneration uses requested current inputs and pinned Basis and may identify newer availability without selecting it (FR-19, AD-18, AD-27)
**And** drafts remain non-canonical, while deployment/restore checks retain all once-eligible files and matching catalogs.

### Story 14.7: Ask required Country facts and refuse uncovered rules

As a family member whose rules need clarification,
I want a clear question or refusal before Country shares appear,
So that unsupported law cannot masquerade as a calculated answer.

**Acceptance Criteria:**

**Given** Stories 14.1–14.6 and Epic 8.4's required-facts/refusal queries
**When** a Country rule set needs an unanswered fact or encounters an uncovered rule
**Then** engine returns typed fact/reason codes rendered through localized shell controls, without shell/browser fiqh tables (FR-21, AD-16)
**And** explicitly allowed School gaps remain distinct from unsupported rules; default_school alone never licenses silent fallback.

**Given** a test-only Lebanon rule set requiring sect
**When** the Interview renders the required fact
**Then** it asks “Was the deceased Sunni?” with Sunni, Shia, another religion and unknown/unanswered states [ASSUMPTION: control wording], without an upfront Basis step (FR-21, AD-16, UX-DR63)
**And** only Sunni permits supported numeric calculation; Shia explains unsupported Ja'fari courts, another religion explains the 1959 non-Muslim law, and missing/unknown answers give no numbers.

**Given** an answer is supplied or changed
**When** the existing answers command succeeds against expected_revision
**Then** minimal eligibility facts persist as Case inputs through save/reopen/restore and are re-evaluated for the applicable rule set and deceased/estate (FR-21, AD-20, NFR-4)
**And** missing facts in an affected later-death layer prevent a misleading completed combined result, conflicts/offline follow existing handling, and religious facts never enter logs/metrics/support automatically.

**Given** previous numeric shares followed by a refused/incomplete Country outcome
**When** preview, results, shared view or PDF is requested
**Then** no stale shares, partial totals or numeric draft PDF are emitted as the new answer; localized plain-text reasons offer Contact us (FR-21, AD-19, UX-DR63)
**And** family inputs remain editable, authorized users can return to comparison, and refusal uses the existing notice/alert treatment without blame or new status colours.

**Given** pregnancy, unknown death order, killing, mixed religion or no heirs
**When** the preset lacks checked rules or sufficient facts for that situation
**Then** its coverage declaration produces a specific required fact or unsupported-rule refusal rather than ordinary shares (FR-21, FR-22, AD-16, AD-17)
**And** tests cover every declared boundary, invalid/missing answers and return to a supported family; no general court, pregnancy or estate-rights subsystem is introduced.

### Story 14.8: Deliver the Saudi Arabia preset with statute-backed tests

As a family member choosing Saudi Arabia's law,
I want a checked Personal Status Law preset,
So that its statutory departures are applied and explained consistently.

**Acceptance Criteria:**

**Given** Stories 14.1–14.7
**When** the Saudi data release is prepared
**Then** presets/sa/<YYYY-MM-DD>.toml uses a verified effective date, PSL M/73 (2022), no obligatory bequest, spouse-last radd, three-class equal-treatment tanzil, grandfather exclusion and no mushtaraka sharing (FR-X1 Saudi part, FR-17, AD-17)
**And** Hanbali is the owner-decided default, not a claim that art. 251 names it; grandfather exclusion prevents akdariyya, the 2025 regulations are checked for effects, and no research/publication date is invented as the effective version.

**Given** country research [8], its Saudi statute digest and citation-check
**When** known-answer tests run
**Then** grandfather/full brother gives 1/0 (art. 212); husband/mother/two maternal brothers/full brother gives 1/2, 1/6, 1/6 each, 0 (art. 227); wife/daughter gives 1/8 and 7/8, wife alone 1 (art. 231) (FR-17, NFR-2)
**And** per-person statuses, source keys, totals and entry-order independence are asserted; grandfather/radd/akdariyya have distinguishing fixtures against Hanbali wherever settings differ, while agreeing settings receive regression tests.

**Given** only a daughter's son and that daughter's daughter, and separately wife/daughter's son
**When** distant-kin fixtures calculate
**Then** derived arts. 232–236 expectations are 1/2 each and respectively 1/4 plus 3/4, subject to official-text checking (FR-6, FR-17)
**And** tests cover all three classes, nearer same-class blocking and cross-class co-inheritance; full membership and exact cross-class worked fractions remain [TO CONFIRM] until owner-verified, never fabricated as published examples.

**Given** addendum §E and research arts. 200, 202–203, 237–240
**When** coverage and boundary tests are prepared
**Then** the checklist records intentional/quasi-intentional killing bars, accidental estate-versus-diya distinction, religion bar, no mutual inheritance at simultaneous/unknown-order deaths, medical-report unborn reserve and property-of-unknown-owner outcome (FR-21, FR-22)
**And** each is supported with requisite facts or explicitly refused through Story 14.7; apostasy/missing articles are [TO CONFIRM] blockers and no generic treasury or ordinary full-estate allocation substitutes for an unsupported outcome.

**Given** Saudi data, source checks and fixtures
**When** the owner evaluates go-live
**Then** eligibility stays off until every rule/fallback has checked official evidence, blockers are closed and known-answer/citation/refusal checks pass (FR-22, AD-17)
**And** research confidence never substitutes for owner approval; absence of obligatory bequest is a negative finding needing confirmation, and passing the gate retains Beta without qualified sign-off.

**Given** the eligible Saudi version in ar/en/fr
**When** selection, save/reopen, sharing, proof and PDF checks run
**Then** all use its pin, Beta and citations with matching exact shares and no-number boundaries (FR-15, FR-18, FR-19, FR-20, FR-21, UX-DR44, UX-DR48, UX-DR88)
**And** existing two-slot capacity checks demonstrate engine under 200 ms for standard families and preview p95 under 1 s up to 50 Heirs, with compatible rollback files and no family data in diagnostics (NFR-2, NFR-3, NFR-4, AD-20, AD-27).

### Story 14.9: Deliver the Lebanon Sunni preset with a sect boundary

As a family member choosing Lebanese Sunni rules,
I want a checked Hanafi-based preset that confirms the Deceased was Sunni,
So that other or unverified rules cannot produce a misleading Sunni result.

**Acceptance Criteria:**

**Given** Stories 14.1–14.8's shared machinery
**When** Lebanon data is prepared
**Then** presets/lb/<YYYY-MM-DD>.toml uses a verified effective date, Hanafi default, all Country arithmetic overrides off and no obligatory bequest, with art. 242 of the 1962 law as amended by Law 177/2011 (FR-X1 Lebanon part, FR-17, AD-17)
**And** Council decisions precede the 1917 Ottoman Family Rights Law and preferred Hanafi opinion; “no overlay/bequest found” is [ASSUMPTION: negative research finding, TO CONFIRM], not an express prohibition or completed owner check.

**Given** Lebanon is selected from preview or Full results
**When** required facts are evaluated
**Then** Story 14.7's sect question is required: Sunni allows supported calculation, Shia refuses with Ja'fari explanation and another religion refuses with the 1959-law explanation (FR-21, AD-16, UX-DR63)
**And** unknown/unanswered sect yields no numbers across preview/results/shared/PDF, saved answers survive reopening and changed answers invalidate stale results without silently changing the pin.

**Given** Sunni and supported families without uncovered overlays
**When** Lebanon known-answer tests run
**Then** grandfather/full brother gives 1/0 and husband/mother/two maternal brothers/full brother gives 1/2, 1/6, 1/6 each, 0, matching Hanafi (FR-17, NFR-2)
**And** daughter/sole full paternal uncle gives 1/2 each as a derived Hanafi fixture consistent with the dated research [6] daughters-and-agnates report, not a fraction quoted from it; 1959 non-Muslim equality is never applied.

**Given** radd/distant-kin and predeceased-descendant fixtures
**When** pinned Lebanon and built-in Hanafi are compared
**Then** results match the existing Hanafi corpus for wife/daughter, lone spouse, maternal grandfather, daughter's child and living son blocking a predeceased son's children (FR-6, FR-17)
**And** every setting is tested though none differs from default; lone-spouse treatment is [TO CONFIRM] given weak/inconsistent research detail, without altering the approved School corpus or asserting an unverified Lebanese exception.

**Given** missing Council decision 46/2011/later decisions, unread arts. 382–492, Ottoman provisions, miri land or mixed-religion uncertainty
**When** coverage/go-live is assessed
**Then** unresolved inheritance-relevant overlays block eligibility, and every addendum §E rule has verified statutory/fallback evidence and an explicit supported/refused boundary (FR-21, FR-22, AD-17)
**And** low-confidence mixed-religion claims are not promoted to law, uncovered miri/sect-conversion/foreign-property situations refuse, and the hasr irth court question stays procedural rather than becoming a certificate feature.

**Given** completed owner checks and closed inheritance blockers
**When** eligibility is enabled and end-to-end checks run
**Then** list/results/PDF retain Beta, pinned name/date, art. 242 context and explicit Hanafi-gap labels; saved/shared/update/refusal flows agree in ar/en/fr (FR-15, FR-18, FR-19, FR-20, FR-21, FR-22, UX-DR45, UX-DR48, UX-DR64, UX-DR87 citation part, UX-DR88)
**And** no outside sign-off is claimed, findings are scheduled for re-check by 2027-05 or Council change, and existing accessibility/capacity harnesses verify controls and preview budgets without Epic 15–17 deliverables (NFR-1, NFR-3, AD-27).

## Epic 15: Obligatory bequest for grandchildren — Egypt and Morocco

Descendants of an Heir who died before or with the Deceased receive their Obligatory bequest under the Country law (1/3 cap, 2:1 split, gift offset, each country's method), and users on a School Basis are told when a country's law would give those descendants a share. Adds the Egypt and Morocco presets.

### Story 15.1: Calculate a shared preset-driven Obligatory bequest before inheritance

As a family member calculating under a Country law,
I want qualifying descendants' bequest calculated before the remaining inheritance,
So that the same engine applies the selected law without changing School calculations.

**Acceptance Criteria:**

**Given** Epic 14 is complete and a non-production synthetic rule set enables Obligatory bequest
**When** the pure engine calculates a family
**Then** one shared step consumes preset settings for eligible lines, son/daughter generation depths, ancestor blocking within each branch, excluded-if-heir, aggregate cap, 2:1 split, offsets and method (FR-16, FR-X1, AD-15–17)
**And** tests use synthetic data rather than requiring a later Egypt or Morocco story; School, compare, Saudi and Lebanon rule sets apply no Obligatory bequest and retain their existing answers.

**Given** descendants under several predeceased children, a qualifying person with descendants, and an already-inheriting grandchild
**When** eligibility and hypothetical parental entitlements are evaluated
**Then** lineage edges and stable person ids determine branches, the configured nearer ancestor blocks only their own descendants, unrelated branches remain eligible, and excluded-if-heir prevents an additional bequest (FR-16, AD-16, AD-25)
**And** fixtures cover sons' and daughters' lines, the configured depth boundary and one generation beyond it, and before/with death separately; an exhausted residuary entitlement is not automatically treated as non-heir eligibility [TO CONFIRM per-country legal definition].

**Given** synthetic settings with cap 1/3 and a branch entitlement of 1/2 of a 900-unit distributable estate, containing one eligible male and one eligible female
**When** there are no offsets or competing voluntary bequests
**Then** the combined bequest is capped at 300, split 200 and 100, and living heirs divide the remaining 600 using the ordinary configured rule set (FR-16, NFR-2)
**And** this is a synthetic arithmetic fixture, not a researched legal example; multiple branches share one aggregate third rather than each receiving a separate third, with the method's branch allocation explicitly tested.

**Given** either configured Egypt two-pass or Morocco two-phase method
**When** the shared step computes hypothetical and final partitions
**Then** Egypt's strategy deducts the bequest first and recalculates living heirs on the remainder, while Morocco's strategy can model the hypothetical parent's subsequent estate, including a spouse, solely to establish the bequest amount (FR-16; research [1], [21])
**And** method fixtures compare identical inputs and retain distinct strategies unless sourced examples establish equivalence; hypothetical estates do not mutate the Case, consume a later-death slot or recursively award another Obligatory bequest.

**Given** lifetime gifts or voluntary bequests credited to particular beneficiaries/branches
**When** entitlement is reduced and topped up
**Then** the shared step preserves recipient attribution, never produces a negative top-up, and applies the configured country-specific priority or abatement rule instead of assuming Egypt arts. 77–79 and Morocco arts. 369/302 are identical (FR-16, addendum §A)
**And** synthetic fixtures cover zero, partial, equal and excess offsets, gifts to only some descendants and concurrent voluntary bequests; an unsupported interaction returns the existing required-facts/refusal outcome without a guessed amount (FR-21 reuse).

**Given** valid, incomplete or malformed inputs
**When** the step returns its outcome
**Then** exact reduced fractions name their original-estate and remainder stage bases, identify each beneficiary and allocation kind, and emit typed proof/citation keys for eligibility, hypothetical share, cap, offset, split and remainder (AD-15, AD-25, NFR-2)
**And** missing facts, invalid money, unsupported method or impossible lineage cannot return completed shares; regression and invariant checks cover entry order, conservation including treasury/unallocated shares, supported later-death layers and the existing NFR-3/AD-27 budgets.

### Story 15.2: Record the facts needed to apply bequest offsets

As a family member supplying facts for a Country calculation,
I want to record prior gifts, voluntary bequests and relevant death timing,
So that my descendants' entitlement uses my answers rather than silent defaults.

**Acceptance Criteria:**

**Given** Story 15.1 and the engine's required-facts query under a bequest-enabled test rule set
**When** the existing Interview edit/answer surfaces request bequest facts
**Then** accessible fields capture recipient-attributed gratuitous lifetime gifts and voluntary bequests and distinguish none from unknown, using the existing Family contract and command service (FR-16, AD-16, AD-20, AD-25)
**And** before/with death facts reach the existing status contract; [ASSUMPTION: extend existing edit/answer surfaces rather than add an Interview step] the exact simultaneous-death control wording remains for owner confirmation.

**Given** a bequest calculation and the existing estate hint that bequests come out first
**When** the user supplies an estate and offsets
**Then** contextual copy explains which amount the engine needs before its automatic Obligatory-bequest deduction and prevents deducting that bequest twice (FR-16, FR-12 integration, UX-DR84)
**And** [TO CONFIRM: statutory valuation base and voluntary-bequest accounting per country] a missing required estate/valuation fact is requested before an amount-dependent offset can produce completed shares; absent estate with confirmed zero offsets can still yield exact fractions.

**Given** a negative amount, invalid currency precision, ambiguous recipient, unknown required answer or a stale revision
**When** a fact is submitted
**Then** the existing validation/conflict path explains the issue, preserves accepted inputs and makes no partial mutation or fabricated zero (AD-20, NFR-4)
**And** successful commands bump one revision, preview only that revision, and save/reopen/restore round-trip facts with stable branch identity; local browser state is not the authority.

**Given** published Arabic, English and French and a died-before parent with descendants beneath their card
**When** facts are entered by touch, keyboard or screen reader
**Then** controls are labelled, at least 44px, visibly focused, usable in RTL, both colour modes and 320px/400% reflow, and errors are associated with fields (NFR-1, UX-DR18, UX-DR24, UX-DR33)
**And** the existing dashed card and Add relative here remain the family-entry route; no relationship list or tree editor is rebuilt, and new copy passes the existing catalog/placeholder validator without falsely recording owner review (AD-21).

### Story 15.3: Show bequests separately with cited calculation steps

As a family member reading my result,
I want the Obligatory bequest shown separately from inheritance with its explanation,
So that I can see what was set aside and how the heirs share the rest.

**Acceptance Criteria:**

**Given** Stories 15.1–15.2 and a synthetic bequest result
**When** presentation produces the Share preview, Full results or draft PDF
**Then** the bequest has its own labelled row with a small article citation and identifiable beneficiaries, with per-person allocations available without counting the group row again (FR-16, UX-DR36–40, UX-DR87, AD-19)
**And** beneficiaries are described as receiving a bequest rather than inheriting through the predeceased parent; that parent retains died-before status and no living-heir allocation.

**Given** hypothetical entitlement, capped entitlement, credited offsets and a remainder partition
**When** I open the proof
**Then** typed proof steps explain eligibility, the selected method, the hypothetical parent's share, the aggregate 1/3 cap, offsets/top-ups, branch and 2:1 divisions, and living-heir distribution on the remainder (FR-16, FR-18 reuse, AD-25)
**And** citations use Epic 14's statute pipeline; remainder fractions explicitly identify their base and the final original-estate equivalents, so a fixed share of the remainder is not mislabelled as the same fraction of the original estate.

**Given** the synthetic 900-unit fixture with a 300-unit bequest
**When** screen and PDF display allocations
**Then** they agree on the bequest's 1/3 of the original estate, 200/100 beneficiary amounts and the 600-unit inheritance base (NFR-2, AD-19)
**And** existing half-up rounding and the separate signed rounding line reconcile the total without changing fractions; absent estate invents no amounts and zero entitlement does not appear as a positive bequest [ASSUMPTION: retain a zero-entitlement explanation in proof].

**Given** localized result/proof copy, a refusal or missing facts
**When** the result surfaces render
**Then** ar/en/fr use shared catalog templates, bidi isolation and the existing table caption/proof controls, and retain the disclaimer, Basis/version and Beta presentation already supplied by earlier epics (AD-19, AD-21, NFR-1, NFR-X3)
**And** missing citation/template errors or a refused calculation never yield an apparently complete uncited bequest or stale numbers; keyboard, RTL, narrow-screen and rendered draft-PDF checks include the new row and proof without creating new formatting or notice machinery.

### Story 15.4: Add the Egypt preset with verified bequest examples

As Mona settling her father's estate,
I want to calculate under Egypt's checked preset,
So that Karim's qualifying descendants receive the Egyptian Obligatory bequest before the heirs divide the rest.

**Acceptance Criteria:**

**Given** Stories 15.1–15.3 and Epic 14's loader, registry, switches and gate
**When** Egypt's versioned presets/eg/<YYYY-MM-DD>.toml data is authored
**Then** it identifies Laws 77/1943 and 71/1946, selects the shared Egypt two-pass method, cap 1/3, 2:1, non-heir condition, gifts/bequests offset and top-up, and each ancestor blocking only their own descendants (FR-X1 Egypt, FR-16; research [1]–[3])
**And** son's-line depth and first-generation daughter's-line eligibility remain [TO CONFIRM] against the complete art. 76 and explanatory memorandum; the digest's snippet-based reading is not marked checked or used to unlock production.

**Given** Egypt's full preset data
**When** the remainder is calculated through Epic 14's existing switches
**Then** data selects spouse-last radd, four ranked distant-kin classes with 2:1, grandfather's better sharing/residue with 1/6 floor, and Hanafi for gaps (addendum §A; research [4], [6])
**And** mushtaraka/akdariyya gaps and all addendum §E rules are explicitly cited or recorded as checked lawful gap handling; no new country-specific engine branch is added and each differing setting has a known-answer fixture (FR-17 reuse).

**Given** the complete family and computation transcribed from Dar al-Ifta fatwa 8330, research [1]
**When** the automated known-answer fixture executes
**Then** its 59,904 total units produce 5,824 bequest units and 54,080 remainder units, with sourced per-beneficiary and living-heir outputs and cited intermediate steps (FR-16)
**And** [TO CONFIRM: full family, branch allocations and intermediate denominators are absent from the local digest] these are obtained from the source, not reconstructed from those totals; the fixture cannot pass by asserting totals alone or by remaining skipped.

**Given** checked boundary fixtures for art. 76 and arts. 77–79
**When** Egypt calculates before/with death, both parental lines, depth limits, separate branches, already-inheriting descendants and prior gifts/bequests
**Then** fixtures demonstrate within-branch blocking, no double entitlement, offset/top-up and obligatory-before-voluntary priority, including excess and proportional abatement where applicable (FR-16; Egyptian statute digest)
**And** simultaneous-death scope, zero-residue heir status and competing-bequest treatment are [TO CONFIRM] from official text before fixture approval; unknown required facts use Epic 14's existing refusal/fact flow.

**Given** any unchecked Egyptian rule or unresolved blocker
**When** production listing or direct execution is attempted
**Then** Epic 14's gate keeps that version unavailable, including to the smart-prompt query; test environments can exercise its draft fixtures (FR-22 reuse, AD-17)
**And** go-live requires owner-checked articles/dates for the whole preset, resolution of art. 76 limits and the reported constitutional challenge's applicability, and passing examples; no invented checked_on, effective date or scholar sign-off is recorded, and unreviewed law stays Beta (NFR-X4, NFR-X5).

**Given** Egypt is eligible and Mona enters wife, Hassan, Mona, and Karim marked died-before with a son and daughter beneath him
**When** she selects Egypt through Epic 14's existing country-law link
**Then** Karim's children have the separate capped bequest row and “Egyptian Wills Law 71/1946, art. 76” citation, with the mother, Hassan and Mona sharing the remainder (UJ-1, UX-DR84)
**And** Arabic preview, Full results, proof and draft PDF agree, Beta and pinned version remain visible, and existing save/share/PDF flows retain the same facts and Basis; this story does not depend on Story 15.6's prompt.

### Story 15.5: Add the Morocco preset with its two-phase worked example

As Maître Benali checking a Moroccan case,
I want the Moroccan law's bequest and cited remainder calculation,
So that I can inspect the applicable method in French and keep a reproducible case.

**Acceptance Criteria:**

**Given** Stories 15.1–15.3 and Epic 14's preset machinery
**When** Morocco's versioned presets/ma/<YYYY-MM-DD>.toml data is authored
**Then** Law 70-03, Family Code 2004 arts. 369–372 configure the shared two-phase method, before/with death, son's line at any depth, daughter's children first generation only, own-branch ancestor blocking, cap 1/3 and 2:1 split (FR-16, FR-X1 Morocco; research [21], citation-check)
**And** the exact lineage interpretation is checked against official text, including art. 372's exclusion of daughters' children's descendants; article text and commentary are recorded distinctly.

**Given** art. 371 eligibility/offset data and arts. 369/302 concurrent-bequest data
**When** a beneficiary already inherits or has received gifts or a voluntary bequest
**Then** sourced fixtures exclude an inheriting beneficiary, top up a shortfall, preserve entitlements of descendants who received nothing, and handle excess/approval and proportional abatement through the configured shared strategy (FR-16)
**And** no Egyptian priority rule is copied by default; missing approval or valuation facts use required-facts/refusal handling, with the exact accounting order [TO CONFIRM] before activation.

**Given** the complete worked family in the commentary accompanying research [21]
**When** its automated two-phase known-answer fixture executes
**Then** the relevant sourced allocation is exactly 49/960, and the fixture checks hypothetical parental succession including spouse where applicable, the final partition and all beneficiary/heir fractions (FR-16, NFR-2)
**And** [TO CONFIRM: the local digest does not identify the recipient, full family, stage base of 49/960 or intermediate shares] these are transcribed from the commentary before acceptance; 49/960 is not assumed to be the aggregate bequest and the commentary is not represented as statute text.

**Given** Morocco's full preset and existing Epic 14 switches
**When** remainder-rule fixtures execute
**Then** data selects Maliki for gaps (art. 400), spouse-inclusive radd as supported by art. 349/commentary, no distant-kin inheritance with treasury last, grandfather's best configured options (art. 354) and equal mushtaraka sharing (art. 365) (addendum §A; research [21])
**And** spouse-radd interpretation, akdariyya and other gaps, and every addendum §E rule must have checked statutory/gap evidence; missing articles remain blockers rather than newly invented rules, with tests for settings differing from default Maliki (FR-17, FR-22 reuse).

**Given** incomplete owner checks, unresolved method/example questions or a future-effective version
**When** Morocco is listed or executed in production
**Then** the existing registry excludes it until the full-preset gate passes and selects only an eligible current version (AD-17, FR-22 reuse)
**And** evidence distinguishes owner official-text checks from qualified review, retains Beta while reviewer fields are null, and records the Morocco reform re-check due by 2027-01 without adopting proposals as current rules (NFR-X4, NFR-X5).

**Given** an eligible Morocco preset and French UJ-6
**When** Benali selects “Loi marocaine (Code de la famille 2004)” through the existing link and opens proof
**Then** that catalog label, separate bequest row, appropriate articles and pinned preset/version appear consistently in preview, Full results and draft PDF (UX-DR87, FR-16)
**And** save/private sharing use the existing Case permissions and pinned-version flow, all published ar/en/fr copy validates, and the pending-reform notice is left to Epic 16's FR-25 implementation without becoming a dependency of this story.

### Story 15.6: Offer live bequest laws when a School result omits eligible descendants

As a family member viewing a School result,
I want to know when a live country's law would give descendants an Obligatory bequest,
So that I can choose that Basis while keeping control of my Case.

**Acceptance Criteria:**

**Given** a School or compare Basis and an Heir marked died-before with descendants
**When** the registry supplies eligible current rule sets to the existing AD-16 share-changing-preset query
**Then** the engine returns only live presets that award this family a positive Obligatory bequest and change its per-person allocations, and presentation selects the prompt from that result (FR-14, AD-15–19)
**And** no browser/shell eligibility tables or hard-coded Egypt/Morocco list decide the result; School shares remain unchanged until the user chooses a Country law.

**Given** no died-before parent with descendants, no positive top-up after offsets, only ineligible generations, already-inheriting descendants, an unchanged result, no live preset, or a Country Basis
**When** the result is presented
**Then** no FR-14 prompt appears, even if another country switch would change shares (FR-14, UX-DR46)
**And** draft/unchecked/future versions and refused or incomplete candidate outcomes are never advertised as known share-changing bequest results; a with-death-only trigger is [TO CONFIRM] and is not silently added beyond FR-14's died-before wording.

**Given** an eligible undismissed prompt
**When** preview or Full results renders
**Then** a non-blocking smart-prompt follows the shares, says some countries' laws give these descendants an Obligatory bequest, and explains it as an extra share set aside for grandchildren whose parent died before the Deceased (FR-14, UX-DR46, UX-DR83)
**And** accent-soft background, 1px accent boundary, 5px logical inline-start edge, rounded.node, full-width 44px live-preset buttons and a 44px “Not now” follow DESIGN; insertion never moves focus or suppresses the existing all-four agreement/School-choice behaviour.

**Given** I choose a listed Country law
**When** Epic 14's revision-aware Basis command and registry resolver accept it
**Then** the Case pins the eligible preset version and recalculates through the shared engine/presentation, showing the bequest row, citation and existing Beta/version UI (FR-14, FR-15 reuse, UX-DR84, UX-DR87)
**And** stale revision, registry eligibility change, network failure or offline state cannot silently switch Basis or show attempted shares as accepted; inputs remain and existing conflict/retry handling applies.

**Given** I press “Not now”
**When** the revision-checked Case command succeeds
**Then** dismissal is persisted as server Case state across preview/results navigation, reload and save/reopen, without changing School shares, and the country-law link remains (FR-14, AD-19–20, UX-DR46, UX-DR84)
**And** another Case is unaffected; [ASSUMPTION: keep dismissal for the Case across family/Basis changes unless explicitly restored] reset/Undo semantics remain an open product question, and a failed/conflicting dismissal is not reported as persisted.

**Given** Mona's UJ-1, eligible Egypt/Morocco fixtures and 50-Heir workloads
**When** the prompt, choice and dismissal are exercised in ar/en/fr on phone/desktop and with keyboard/screen reader
**Then** both surfaces list only the actual qualifying live presets, non-live Egypt is absent, dismissal preserves compare and the link, and selection yields matching preview/results/PDF allocations (NFR-1–3, UX-DR46, UX-DR84)
**And** RTL, dark/light contrast, visible focus, 320px/400% reflow and the existing preview p95 under 1 s/standard-engine under 200 ms budgets pass including candidate-query cost; tests reuse existing capacity and presentation facilities.

**Given** an Heir who died before or with the Deceased and has descendants, under a School Basis
**When** a live preset would change those descendants' shares
**Then** the FR-14 prompt shows for both "died before" and "died with" (owner decision, 2026-11-16), and a dismissal is stored as Case state until the family changes in a way that affects eligibility, when it may show again (FR-14, AD-20)
**And** Undo of the change that reset eligibility also restores the previous dismissal state.

## Epic 16: Money, numbers and notices that fit the country

Users choose the estate currency (defaulting from the Country law or Locale), see numbers and dates in their Locale's conventions on screen and in the PDF, read each Country law's notice, and get the civil-law notice under a School Basis in every Locale.

### Story 16.1: Choose and retain the estate currency

As a family member entering an estate,
I want to choose its currency and retain that choice,
So that the monetary shares use the estate's currency wherever I read them.

**Acceptance Criteria:**

**Given** Epic 8's currency input, Locale registry, command service and presentation, and Epic 11's estate/results surfaces
**When** I enter or edit the estate in the Interview
**Then** a labelled, keyboard-accessible currency chooser lets me choose the estate currency without choosing a Country law (FR-23, AD-19, AD-20)
**And** [ASSUMPTION: placement is unspecified] the chooser sits beside the existing estate field, uses existing labelled form styling, visible focus and at least 44px targets, and reflows in LTR/RTL; available currency codes and labels use one shared definition rather than separate browser/server lists.

**Given** a new Case whose currency has explicit=false
**When** its initial default is resolved or its Locale or Basis changes
**Then** the default is the resolved Country preset's default_currency if present, otherwise the Locale's default currency, and re-defaulting occurs only while explicit=false (FR-23, AD-17, AD-19)
**And** School and compare Cases work with no live Country presets; Country assertions run against whatever presets are live in the registry, using the resolved pinned version rather than an assumed Saudi/Egypt/Morocco release or the newest version.

**Given** I choose a currency, including the currency already shown as the default
**When** the revision-aware currency command succeeds and I subsequently save and reopen the Case
**Then** currency persists as {code, explicit:true} through the existing Case/SavedCase inputs and is not re-defaulted by a Locale or Basis change (FR-23, AD-19, AD-20)
**And** existing live share views and regenerated draft PDFs consume the saved currency; legacy Cases and converted guest snapshots retain Story 8.10's {code:"SAR", explicit:true} until the user deliberately changes it, without another backfill.

**Given** a valid currency and an estate representable at its Babel minor-unit precision
**When** Share preview, summary-sheet, Full results and draft PDF show monetary allocations
**Then** they show the chosen currency's symbol and minor-unit rules through Epic 8's presentation and Epic 11.7's rounding line, including 0-, 2- and 3-digit currency examples (FR-23, FR-13, AD-19)
**And** exact fractions remain unchanged, absent estate produces no invented amounts, and this story adds no exchange-rate conversion; [ASSUMPTION: currency-change amount semantics are unspecified] an entered major-unit amount is retained only if valid in the new currency, otherwise the atomic change is rejected for correction rather than silently rounded or rescaled.

**Given** an unknown currency code, excess estate precision, stale revision, offline connection or failed currency request
**When** the change is attempted
**Then** invalid input uses the foundation's typed error and failed/conflicting commands do not partially change estate or currency or report success (AD-19, AD-20, FR-23)
**And** the accepted family remains available, field errors are associated with the chooser/amount, existing conflict/offline handling is reused and older-revision previews cannot replace the accepted result.

**Given** the currency chooser
**When** it lists currencies and picks a default
**Then** it offers the seven preset countries' currencies (SAR, AED, EGP, JOD, MAD, DZD, LBP), USD, EUR, GBP, PKR, INR, TRY, IDR, MYR and CNY; the default comes from the Country law, else from the Locale's `default_currency` in `i18n/locales.json` (ar SAR, en USD, fr EUR, ur PKR, hi INR, tr TRY, id IDR, ms MYR, de/es/it EUR, zh CNY) (owner decision, 2026-11-16) (FR-23, AD-19, AD-21)
**And** changing currency keeps the entered number with no exchange-rate conversion; if it has more decimals than the new currency's minor units allow, the user is asked to correct it and nothing is silently rounded.

### Story 16.2: Read matching Locale numbers and dates on screen and PDF

As a family member reading a calculation in my Locale,
I want numbers and dates to follow its conventions in every view,
So that I can compare the screen and draft PDF without interpreting different formats.

**Acceptance Criteria:**

**Given** Stories 8.5–8.7's registry and server presentation and Epic 11's rendered results
**When** the same inputs and Locale render Share preview, summary-sheet, Full results and draft PDF
**Then** corresponding fractions, percentages, amounts and dates use identical server-produced strings and Locale conventions, including relevant saved/result/version dates where present (FR-24, NFR-X7, UX-DR50, AD-19, AD-21)
**And** Babel receives the registry's Babel locale and explicit numbering_system; browser Intl, PDF helpers and templates do not independently format these values, and dates retain their stored UTC meaning (AD-25).

**Given** a Locale whose registry numbering_system uses Arabic-Indic digits, and Locales using Latin digits
**When** fractions, percentages, amounts and dates are presented
**Then** actual displayed digit code points, grouping and decimal separators follow that Locale, with Arabic-Indic digits where configured, identically on screen and in PDF (FR-24, NFR-X7, UX-DR50)
**And** acceptance examples inspect digits as well as separators rather than treating a Babel numbering-system argument alone as proof; currency symbol and precision follow the supplied currency, independently of the display Locale.

**Given** RTL Arabic or a registry-based Urdu fixture with mixed-script names, fractions and monetary values
**When** results and PDF render
**Then** fractions remain LTR-isolated without reversing numerator and denominator, amounts and names remain bidi-isolated, and page language/direction derive from the registry (FR-24, UX-DR50, DESIGN Do's and Don'ts)
**And** PDF font/glyph and visual checks demonstrate readable digit order, currency signs and separators; Urdu fixtures do not publish Urdu ahead of Epic 18.

**Given** exact shares, no estate, a rounding adjustment or a refused outcome
**When** Locale formatting is applied
**Then** exact fractions are never rounded, absent estate stays absent, signed rounding remains distinguishable from legal unallocated/treasury shares, and refusal does not acquire numerical shares (FR-24, FR-13, AD-19)
**And** checks cover zero/non-zero rounding and 0-, 2- and 3-minor-digit currencies through foundation fixtures without depending on Story 16.1's chooser.

**Given** a registered Locale with missing/empty formatting-related UI, email, PDF or server-message copy, an invalid registry configuration or missing PDF glyphs
**When** the existing validator and publication checks assess the change
**Then** their existing gates reject the gap with the Locale/key or configuration identified, rather than releasing blank or inconsistent output (NFR-X7, AD-21, UX-DR50)
**And** any runtime English text fallback remains visibly marked lang="en" as in UJ-4; this story extends the foundation checks and does not replace the validator or add new Locale publication.

**Given** any date shown on screen or in the PDF
**When** it is formatted
**Then** it uses the Gregorian calendar in the Locale's own date format, identically on screen and in the PDF (owner decision, 2026-11-16) (FR-24, NFR-X7)

### Story 16.3: Show the selected Country law's notice in every Locale

As a family member using a Country law,
I want to read its short notice alongside my result and draft PDF,
So that I understand the qualifications attached to that law.

**Acceptance Criteria:**

**Given** Epic 8's preset/catalog contracts and notice slots and Epic 11's results/PDF consumers
**When** a result has a resolved Country Basis for a preset live in the registry
**Then** presentation selects that preset's preset.<id>.notice from the current Locale's catalog, and Full results and draft PDF display it (FR-25, AD-17, AD-19, AD-21)
**And** preview and summary-sheet render the same supplied notice through their existing slots (EXPERIENCE Component Patterns, UX-DR47); notice text stays outside immutable preset TOML and no renderer maintains a country-to-notice switch.

**Given** the PRD's Country notice examples
**When** catalog notice content is supplied in every registered Locale
**Then** the corresponding English source texts are Morocco: "Family Code of 2004; a reform is pending.", Egypt: "A constitutional challenge to the bequest article has been reported.", UAE: "Non-Muslims may follow a separate civil law.", and Lebanon: "Lebanese Sunni courts apply Hanafi rules; Shia families follow Ja'fari courts; changing sect changes the applicable law." (FR-25, PRD §4.5)
**And** translations preserve that meaning and their actual review status; supplying copy never activates a preset, and unspecified Country notice wording remains an open content question rather than invented legal advice.

**Given** any live preset and published Locale, including a Locale unrelated to that country
**When** its Country result is opened or a draft PDF regenerated
**Then** the matching Country notice appears in that Locale, without filtering by visitor location or the Locale's country (FR-25, AD-21)
**And** acceptance runs over whatever presets are live; with no live presets, catalog/selection contract fixtures verify the extension and School results remain usable, with no requirement that Epic 14 or 15 finish first and no bypass of FR-22 eligibility.

**Given** a displayed Country notice
**When** I read it on a narrow RTL/LTR screen or in the PDF
**Then** it is plain, non-dismissible text using the notice component's 1px border at 60% foreground, rounded.md and 12px padding, with the existing semibold disclaimer still present (UX-DR47, NFR-X3, DESIGN components.notice)
**And** applicable Beta explanations and citations keep their existing ownership; [ASSUMPTION: DESIGN/EXPERIENCE] no new status colour or icon is introduced, and the notice makes no certified or court-approved claim.

**Given** a change to another eligible Country Basis or back to School/compare, or a missing/empty notice translation
**When** the accepted presentation changes or the catalog validator runs
**Then** the previous Country's notice cannot remain on a different Basis, and missing/empty catalog keys fail the existing Locale/key gate (FR-25, NFR-X7, AD-19, AD-21)
**And** failed/stale Basis requests cannot replace the accepted notice; [ASSUMPTION: runtime catalog-failure recovery is unspecified] unexpected missing copy uses the foundation's error/fallback path without inventing a different country's notice.

**Given** a live preset with no notice text in the PRD (Saudi Arabia, Jordan, Algeria)
**When** its notice is prepared
**Then** AI drafts the notice in every registered Locale and the owner reviews it before the preset goes live; review status is recorded in the catalog (owner decision, 2026-11-16) (FR-25, NFR-X4, AD-21)

### Story 16.4: Explain civil-law limits under every School in every Locale

As a family member calculating under a School,
I want a clear notice about local civil-law limits,
So that I know to confirm the estate and possible claims with a local lawyer.

**Acceptance Criteria:**

**Given** Epic 8's presentation notice slots and Epic 11's School results and PDF
**When** any single School Basis produces results in any published Locale
**Then** Full results and draft PDF carry a notice that local civil law may decide what forms the estate and who may claim, and that a local lawyer should confirm (FR-26, AD-19, UJ-4)
**And** preview and summary-sheet render the supplied notice consistently with EXPERIENCE's notice pattern (UX-DR47); this applies in every Locale regardless of visitor country, estate currency or whether that country has a live preset.

**Given** the default compare-all-four-Schools Basis, including an all-four agreement result
**When** the result is presented
**Then** [ASSUMPTION: FR-26 and AD-19 explicitly name School Basis but UJ-4 and the default comparison journey imply this scope] the same civil-law notice is shown on preview, Full results and draft PDF (FR-26, UJ-4)
**And** agreement does not suppress the notice or force a School choice; this assumption remains an explicit question below.

**Given** a Country Basis supported by a live preset, or a successful change between Country and School
**When** the accepted presentation renders
**Then** the generic School civil-law notice is absent under Country and returns under School, based solely on the resolved Basis (FR-26, AD-19)
**And** the always-present calculation-aid disclaimer remains; the negative Country assertion is verified against whatever presets are live, or contract fixtures if none are live, without requiring Epic 14 and without changing FR-22 eligibility.

**Given** the civil-law notice in a published LTR/RTL Locale
**When** it is read on screen or PDF, including without an estate amount
**Then** it is plain, non-dismissible text using the shared notice border, rounded.md and 12px padding, alongside the existing semibold disclaimer, and remains readable in both colour modes and at narrow widths (UX-DR47, NFR-X3)
**And** no country is inferred from language or currency; UJ-4's Birmingham example is covered by advice about applicable local civil law, with any UK-specific wording left to an explicit content decision.

**Given** every registered Locale and a registry-based Urdu UJ-4 fixture
**When** notice translations and their screen/PDF rendering are checked
**Then** every Locale has non-empty copy conveying all three points: estate composition, possible claimants and confirmation by a local lawyer; the existing validator rejects missing/empty keys (FR-26, NFR-X7, AD-21)
**And** English runtime fallback has lang="en" and is never blank; Urdu direction/glyph checks reuse the registry pipeline without publishing the Locale or asserting native review before Epic 18.

**Given** the Basis is "compare all four Schools"
**When** results are presented
**Then** the civil-law notice is shown, as for a single School (owner decision, 2026-11-16) (FR-26)

## Epic 17: Jordan, UAE and Algeria presets

Users in Jordan, the UAE and Algeria can calculate under their Country law, each preset going live only through the FR-22 gate.
**FRs covered:** FR-X1 (Jordan, UAE, Algeria); reuses FR-16 to FR-22

### Story 17.1: Add the radd, distant-kin and parent's-share settings Jordan, the UAE and Algeria need

As the owner/maintainer,
I want only the engine setting values that Epics 14 and 15 lack, added to the shared engine,
So that the three presets stay pure data and no country branch is written.

**Acceptance Criteria:**

**Given** Epic 14.2's resolved settings (radd, distant kin, grandfather with siblings, mushtaraka, akdariyya) and Epic 15.1's shared Obligatory-bequest step with its lines, depths, cap, split, offset and method settings
**When** a value matrix is built for Jordan, the UAE and Algeria (addendum §A)
**Then** each needed value is classified as already supported (Saudi/Lebanon/Egypt/Morocco values, the existing Egypt four-class 2:1 distant-kin and better-of-sharing-or-residue grandfather values, son's-line-only lines, before/with death, both daughter-line depths) or new (FR-17, FR-16, AD-15, AD-17)
**And** only values absent from that matrix are implemented below; Epic 14.2's rule that unsupported values fail validation or refuse without numbers stays in force for everything else, and no schema, parser, preset table or country-id branch is added.

**Given** Jordan art. 312 (spouses excluded from radd; a lone spouse takes the remainder, ahead of dhawi al-arham) as digested, and Algeria art. 167 (spouse takes radd only when no asaba, no other fixed-share heir and no dhawi al-arham)
**When** the spouse-radd setting is resolved
**Then** the existing spouse-last value is reused where it already gives the same ordering, and a "lone spouse before distant kin" value is added only for Jordan's ordering, with a distinguishing fixture for a wife alone against a daughter's son (wife takes the whole estate here, against Saudi's distant-kin-first result) (FR-17, AD-17)
**And** the Jordan ordering rests on research [11][12] at medium confidence and is [TO CONFIRM] against the official text; the fixture is derived, never presented as a published example.

**Given** UAE art. 236 as digested (dhawi al-arham inherit beside a sole spouse)
**When** the distant-kin setting is resolved
**Then** a "distant kin share with a sole spouse" value gives the spouse the ordinary fixed share and the nearest distant-kin class the remainder, for example a husband alone with a daughter's son, with husband 1/2 and daughter's son 1/2 as a derived fixture (FR-6, FR-17)
**And** the existing Epic 14.3 relationships and class matrix are reused; the class order, 2:1 treatment and how a spouse's radd interacts are [TO CONFIRM] for the UAE (art. 236 only as summarised) and recorded as open rather than guessed.

**Given** Jordan, the UAE and Algeria describe the bequest method only as "the parent's share, capped at 1/3" (addendum §A, research [11][15][25])
**When** the method setting is resolved
**Then** the data may select Epic 15.1's existing two-pass strategy only if a fixture shows it equals the "parent's share as if alive, cap, then divide the remainder" reading for these laws; otherwise one simple parent's-share strategy is added to the same step, with the aggregate cap shared across branches (FR-16, AD-15)
**And** the equivalence or difference is shown on identical inputs against both existing methods, and hypothetical estates never mutate the Case or recurse, as in Story 15.1.

**Given** the new values and the existing School corpus
**When** the regression and known-answer suites run
**Then** each new value has a distinguishing fixture against the relevant default School (Hanafi for Jordan, Maliki for the UAE and Algeria), and every School, compare, Saudi, Lebanon, Egypt and Morocco fixture is unchanged (FR-17, NFR-2)
**And** the engine stays pure and exact, with entry-order independence, conservation including unallocated shares, and the existing 200 ms engine budget (NFR-2, NFR-3, AD-27).

### Story 17.2: Deliver the Jordan preset with statute-backed tests

As a family member in Jordan,
I want a checked Personal Status Law 15/2019 preset,
So that the son's-line bequest and Jordan's inheritance rules are applied and explained consistently.

**Acceptance Criteria:**

**Given** Stories 14.1–14.9, 15.1–15.3, 16.3 and 17.1
**When** the Jordan data release is prepared
**Then** presets/jo/<YYYY-MM-DD>.toml uses a verified effective date and Personal Status Law 15/2019, a Hanafi default for gaps (art. 325), the son's line only at any depth, cap 1/3, 2:1, gift offset and top-up, excluded-if-heir and bequest before voluntary bequests (FR-X1 Jordan, FR-16, FR-17, AD-17; research [11])
**And** the remainder settings are the lone-spouse-before-distant-kin radd of Story 17.1, four-class 2:1 distant kin (arts. 301–310), better-of-sharing-or-residue grandfather with a 1/6 floor (art. 290) and mushtaraka sharing (art. 296(d)); every setting has a cited article or a checked gap_school reference.

**Given** the digest's article numbers (279, 281, 284, 290, 296, 301–312, 325) that may follow the 2010 text as amended by 15/2019
**When** the owner prepares the go-live checklist
**Then** the numbering against the Official Gazette is a go-live blocker, and so are the apostate rule in art. 281(c) ("a Muslim apostate inherits", read as anomalous), the art. 279(b) "unless fixed-share heirs exhaust the estate" wording and the lone-spouse radd ordering [TO CONFIRM] (FR-22, AD-17; PRD §11)
**And** no checked_on, effective date or reviewer is invented, and the apostate and no-heir (Ministry of Awqaf, art. 284) outcomes are supported through Story 14.7's facts and refusals, or refused, rather than defaulted.

**Given** the daughter's-line exclusion in art. 279(d) and the parliamentary report that a predeceased daughter's children were rejected
**When** fixtures for a daughter's children and a son's grandchildren are calculated
**Then** the son's children and lower descendants receive the capped bequest, a predeceased daughter's children receive none from the bequest step, and their ordinary treatment follows the Hanafi gap (FR-16, FR-17)
**And** the parliamentary-report snippet is low confidence and never used as a statute basis; the daughter's-line conclusion is [TO CONFIRM] against the official text.

**Given** a derived family with a predeceased son's children, a surviving spouse and parents, and separately a lone spouse and a daughter's son
**When** Jordan known-answer tests run
**Then** one fixture each proves the 1/3 cap with the 2:1 split, the gift offset, within-branch blocking, the lone spouse taking the remainder before distant kin, and mushtaraka sharing against the Hanafi default, as well as grandfather with a full brother against the Hanafi exclusion (FR-16, FR-17, NFR-2)
**And** no worked example is published for Jordan in the research, so each expectation is labelled derived from the digest and checked at go-live; settings that agree with Hanafi get regression tests, and per-person statuses, source keys and totals are asserted.

**Given** the PRD supplies no Jordan notice text
**When** the Jordan notice is prepared
**Then** an AI-drafted notice exists in every registered Locale in the catalog, with owner review status recorded before the preset goes live, and it makes no certified or court-approved claim (FR-25, NFR-X4, AD-21; Story 16.3)
**And** the notice stays outside the immutable TOML file and unspecified wording remains an open content question.

**Given** Jordan data, citations, source checks and fixtures
**When** the owner runs the Epic 14.1 go-live gate and the eligible version is exercised in every registered Locale
**Then** it stays unavailable until every article and fallback is owner-checked and each [TO CONFIRM] blocker is closed, then selection, save/reopen, sharing, proof and PDF all show its pin, Beta, citations and notice with matching exact shares (FR-22, FR-15, FR-18, FR-19, FR-20, AD-17)
**And** the version retains Beta while reviewer fields are null, and the existing capacity checks hold without family data in diagnostics (NFR-3, NFR-4, AD-27).

### Story 17.3: Deliver the UAE preset with statute-backed tests

As a family member in the UAE,
I want a checked Federal Decree-Law 41/2024 preset,
So that its bequest, radd and distant-kin rules are applied and explained consistently.

**Acceptance Criteria:**

**Given** Stories 14.1–14.9, 15.1–15.3, 16.3 and 17.1
**When** the UAE data release is prepared
**Then** presets/ae/<YYYY-MM-DD>.toml uses the verified in-force date (digest: 2025-04-15, to be checked), Decree-Law 41/2024, Maliki as the default for gaps [ASSUMPTION: to confirm; the statute names only "Islamic Sharia", art. 1], and the art. 179 bequest for sons' and daughters' children at any depth, cap 1/3, 2:1, excluded-if-heir and gift offset, before voluntary bequests (FR-X1 UAE, FR-16, FR-17, AD-17; research [15][16])
**And** radd excludes spouses (art. 233), distant kin inherit beside a sole spouse (arts. 234–238, Story 17.1), akdariyya follows art. 239 and the no-heir outcome is a charitable waqf (art. 241).

**Given** the digest's unresolved points
**When** the owner prepares the go-live checklist
**Then** the art. 240 mushtaraka split (the summary says males double, tradition says equal), the grandfather-with-siblings article, art. 179's "or were given the amount in life" offset wording and the Maliki default itself are [TO CONFIRM] go-live blockers (FR-22, AD-17; PRD §11)
**And** the official gazette text is checked, because every article here comes from an unofficial translation (research [15]) and the portals could not be read; no article is fixed from memory.

**Given** the shared bequest step and the UAE's inclusion of daughters' children
**When** fixtures run for a predeceased son's children and a predeceased daughter's children, before and with the grandparent's death, and for children who already inherit
**Then** both lines receive the capped bequest, and an already-inheriting grandchild receives none, matching art. 179 as digested (FR-16, FR-17, NFR-2)
**And** the expectations are derived from the digest rather than a published example; the distinguishing contrast is the daughter's line against Jordan's son's-line-only data.

**Given** derived families for radd, distant kin and akdariyya
**When** UAE known-answer tests run
**Then** a daughter with a wife leaves the wife at her fixed share with no radd, a husband alone with a daughter's son gives husband 1/2 and daughter's son 1/2 (art. 236 as summarised), and akdariyya is distinguished from Maliki where the settings differ (FR-17, FR-6)
**And** simultaneous deaths give no mutual inheritance (arts. 203/205) and a medical-report unborn reserve (art. 243) is supported or refused through Story 14.7; settings that agree with Maliki receive regression tests only.

**Given** the PRD's UAE notice, "Non-Muslims may follow a separate civil law."
**When** the notice is supplied
**Then** it uses that English source text with translations in every registered Locale and its actual review status, and non-Muslim and home-country-law succession are refused through the Epic 16.4 civil-law boundary, not calculated (FR-25, FR-21, NFR-X4)
**And** the notice is never filtered by the visitor's location and does not activate the preset.

**Given** UAE data, citations and fixtures
**When** the owner runs the Epic 14.1 go-live gate and the eligible version is exercised in every registered Locale
**Then** the preset stays off until the articles are owner-checked and each blocker is closed, then results, proof and PDF show the pin, Beta, citations and notice with matching exact shares (FR-22, FR-15, FR-18, FR-19, FR-20, AD-17)
**And** the version retains Beta while reviewer fields are null, and the existing capacity checks hold (NFR-3, NFR-4, AD-27).

**Given** a UAE estate of a non-Muslim deceased, or one where the family elects home-country law
**When** the UAE preset is the Basis
**Then** the calculation is refused with a localized reason and no shares, and the UAE notice states that a separate civil law may apply (owner decision, 2026-11-16) (FR-21, FR-25)

### Story 17.4: Deliver the Algeria preset with a configurable daughters' line

As a family member in Algeria,
I want a checked Family Code preset with tanzil that handles deaths before or with the grandparent,
So that I get a cited result that does not claim the uncertain law is settled.

**Acceptance Criteria:**

**Given** Stories 14.1–14.9, 15.1–15.3, 16.3 and 17.1
**When** the Algeria data release is prepared
**Then** presets/dz/<YYYY-MM-DD>.toml uses the verified effective date, the Family Code (Law 84-11 as amended 2005, unverified), Maliki as the default for gaps [ASSUMPTION: to confirm; art. 222 refers only to Islamic Sharia], and tanzil per arts. 169–172: deaths before or with the grandparent, the parent's share, cap 1/3 and 2:1 (FR-X1 Algeria, FR-16, FR-17, AD-17; research [25][28])
**And** radd excludes spouses unless there is no other heir (art. 167), distant kin inherit, and the no-heir outcome is the treasury.

**Given** art. 169's silence on daughters' children and Supreme Court decision 932349 (12 November 2015), whose holding was not retrieved
**When** the data is authored
**Then** daughter_line_depth is set through the existing setting only from the retrieved decision and article text, and the decision's holding is a go-live blocker [TO CONFIRM] (FR-16, FR-22, AD-17; PRD §11)
**And** with the holding unresolved, the preset cannot be made selectable in production, the Beta label never waives the blocker, and no daughter's-line value is guessed.

**Given** the unretrieved article texts (art. 171 offset wording, the grandfather with siblings, mushtaraka, akdariyya, arts. 173–190)
**When** the go-live checklist is built
**Then** each of those settings is recorded as [TO CONFIRM] with the gap_school (Maliki) reference to be backed by checked evidence, and the excluded-if-heir condition is confirmed for Algeria, since the addendum lists it as stated only for other countries (FR-22, FR-17)
**And** the research's low-medium confidence and the secondary sources for arts. 167 and 169–172 are recorded, and no setting is marked checked from a paraphrase.

**Given** derived families, on both the Algerian and the Maliki Basis
**When** Algeria known-answer tests run
**Then** a son's child and a daughter's child (under the configured depth) share the capped bequest 2:1, an already-inheriting grandchild receives none, a death "with" the grandparent is treated as tanzil, and a wife alone with a daughter's son differs from Maliki's treasury outcome (FR-16, FR-17, NFR-2)
**And** these are labelled derived, with no published Algerian worked example; settings that match Maliki receive regression tests.

**Given** the PRD supplies no Algeria notice text
**When** the Algeria notice is prepared
**Then** AI drafts it in every registered Locale and the owner reviews it before go-live, with review status recorded in the catalog, and the notice says the daughters'-line question is unsettled only if that remains true (FR-25, NFR-X4, AD-21; Story 16.3)
**And** the notice stays outside the TOML file and makes no certified or court-approved claim.

**Given** Algeria data and fixtures
**When** the owner runs the Epic 14.1 go-live gate and the eligible version is exercised in every registered Locale
**Then** it stays unavailable until the official text and decision 932349 are checked and every blocker closed, then results, proof and PDF show the pin, Beta, citations and notice with matching exact shares (FR-22, FR-15, FR-18, FR-19, FR-20, AD-17)
**And** the version retains Beta while reviewer fields are null and the existing capacity checks hold (NFR-3, NFR-4, AD-27).

## Epic 18: Use Mawareeth in Urdu, Hindi, Turkish, Indonesian and Malay

Users use the whole product (Interview, results, proof, PDF, account pages, emails) in five new Locales, with Urdu right-to-left, agreed fiqh terms with the Arabic term beside relationship names, Beta labels for unreviewed translations, and findable public pages.

### Story 18.1: Publish a Locale through the registry with Beta label, switcher and discoverable pages

As the owner/maintainer,
I want one repeatable way to publish a Locale from the registry,
So that each new language ships with the same Beta label, switcher entry and findable public pages without per-language code.

**Acceptance Criteria:**

**Given** Story 8.5's i18n/locales.json, validator/generator, CI gate and PDF glyph check, and Story 16.2's registry-driven formatting
**When** a Locale entry is set to published with review state "unreviewed"
**Then** Django LANGUAGES, Next.js locales/direction, PDF configuration, hreflang and the sitemap all pick it up from the registry alone, with no second list (AD-21, FR-27, FR-30)
**And** a Locale whose validator, glyph check or registry fields (code, dir, Babel locale, numbering_system, own-script name, font stack, default_currency) are incomplete cannot be marked published, and the failure names the Locale and key or field.

**Given** a published Locale whose review state is unreviewed
**When** Full results, the footer, the Share preview, the summary-sheet and the draft PDF render in it
**Then** each shows badge-beta with the nearby text "This translation has not yet been reviewed by a native speaker" in that Locale, as real text near the start of the PDF, and it is never user-hideable (FR-29, UX-DR48 Locale part)
**And** the pill label "Beta" is shown in the Locale's own wording [ASSUMPTION: DESIGN gives only "Beta" / "تجريبي"; per-Locale pill text is AI-drafted and goes through the term catalog's review field], and the label disappears only when the registry review state is changed to reviewed, which no story in this epic does.

**Given** the nav language list
**When** it renders for any visitor Locale
**Then** every published Locale appears once, named in its own script from the registry, each item with its own lang and dir, 44px high, the current one semibold with aria-current and not a link (UX-DR49, FR-30)
**And** an unpublished Locale is absent from the list, hreflang and sitemap, and from the URL space (it does not serve a public page).

**Given** each public page (landing, about, FAQ, terms, privacy and the other Epic 12 public pages)
**When** the page is served in a published Locale
**Then** it has localized title, meta description and Open Graph text, hreflang links for every published Locale plus x-default, and a canonical URL for itself (FR-30)
**And** the sitemap lists every public page once per published Locale with its alternates, and a Locale's pages appear there only while it is published.

**Given** a test-only Locale fixture (Latin script, LTR, not published) and an RTL fixture in the registry
**When** the pipeline is exercised end to end in CI
**Then** publishing, Beta label, switcher, hreflang, sitemap and a missing-key failure each behave as above, proving the pipeline without publishing a real language (AD-21, NFR-X7)
**And** the Epic 16 civil-law and Country notices are covered by the same validator for any registered Locale, so no Locale can publish without them (FR-26).

**Given** a runtime string missing in a published Locale
**When** it is shown
**Then** the English text appears marked lang="en", is never blank, and CI blocks the release that caused it (UX-DR50, NFR-X7)
**And** the Locale add procedure (registry entry, term catalog, messages.ts, .po, email and PDF templates, review state) is written in one short maintainer checklist reused by Epic 19 [ASSUMPTION: the checklist is a short repository doc, not a new tool].

### Story 18.2: Use Mawareeth in Urdu, right-to-left

As Bilal, who reads Urdu more comfortably than English or Arabic,
I want the whole product in Urdu with relationship names and their Arabic terms,
So that I can read who inherits what and download the PDF without translating in my head.

**Acceptance Criteria:**

**Given** Story 18.1's pipeline and the registry's RTL handling
**When** ur is registered with dir rtl, Babel locale ur, its numbering_system, own-script name اردو, font stack, default_currency PKR and unreviewed state
**Then** directionOf and every consumer take direction from one registry RTL list covering ar and ur, and the page turns right-to-left on switching (UX-DR50, NFR-1, FR-27)
**And** [ASSUMPTION: Urdu digit style, Extended Arabic-Indic U+06F0 range versus Latin, is not yet chosen; it is taken from the registry numbering_system and confirmed with the owner before publishing] the chosen digits are identical on screen and in PDF (FR-24, NFR-X7).

**Given** the open Urdu typography decision
**When** the font stack is chosen and recorded in the registry
**Then** it is a Naskh or Nastaliq face with a recorded choice and reason [ASSUMPTION: Naskh-style Noto Naskh Arabic first for legibility at small card sizes with Noto Nastaliq Urdu as a candidate for headings only; owner decides], embedded in the PDF with full shaping and with font-synthesis off (UX-DR51)
**And** Urdu body line-height 1.7 [ASSUMPTION per DESIGN] is applied through a body-ur token, card text is at least 0.9rem, and at 200% text-only zoom cards grow rather than clip.

**Given** AI-drafted Urdu for every UI string, email, PDF label, server message and term-catalog entry
**When** the validator and generator run
**Then** no key is missing or empty in the web app, the .po files or i18n/terms/ur.json, and every catalog entry has review "unreviewed" (FR-27, NFR-X7, AD-21)
**And** one agreed fiqh term per concept (relationship names, Obligatory bequest, radd, School names) is used by screen, proof, email and PDF, listed in the term catalog for owner confirmation [ASSUMPTION: term choices are AI-proposed and the owner confirms them before publication] (FR-28).

**Given** a family entered in Urdu
**When** Share preview, Full results, proof and the draft PDF are shown
**Then** each relationship reads "{Urdu term} ({Arabic term})" with the Arabic in bdi lang="ar" dir="rtl", names in bdi dir="auto", fractions dir="ltr" and amounts isolated (FR-28, UX-DR50, AD-19)
**And** the all-four-Schools agreement line "Same result in all four Sunni schools" appears in Urdu, with no "Calculated under..." line, and the civil-law estate notice is shown (UK law may decide what forms the estate) (UX-DR86, FR-26).

**Given** the Urdu PDF and its visual and glyph checks
**When** the PDF is generated for the UJ-4 family
**Then** every glyph resolves in the registered font stack, digits, fractions and currency signs keep readable order, the Beta label appears as text at the start, and it is downloadable (UX-DR86, UX-DR51, NFR-1)
**And** an axe pass and keyboard check of the Interview, tree, Full results and account pages in Urdu RTL (logical-property mirroring, lang/dir on Arabic terms) report no WCAG 2.1 AA violations, reusing Story 9.11's RTL checks (NFR-1).

**Given** the Urdu Locale passing the validator, glyph check and owner term confirmation
**When** the registry marks it published with Beta
**Then** it appears in the language switcher as اردو, in hreflang and the sitemap, and the UJ-4 journey (switch, enter family, Beta label, results, PDF) passes as an automated browser journey (UX-DR49, UX-DR86, FR-30)
**And** failing any gate leaves it unpublished, and English fallback is marked lang="en".

**Given** Urdu text on screen and in the PDF
**When** it is rendered
**Then** all Urdu text uses a Naskh font (no Nastaliq), digits are Latin per CLDR's `ur` default, and line height comes from a `body-ur` token set to 1.7 (owner decision, 2026-11-16) (UX-DR51, FR-24)
**And** AI-drafted public pages publish under the Locale Beta label; the single fiqh term per concept is AI-drafted and owner-approved before publication.

### Story 18.3: Use Mawareeth in Hindi

As a Hindi-reading family member,
I want the whole product in Hindi with the Arabic terms beside relationship names,
So that I can understand the calculation in my own language.

**Acceptance Criteria:**

**Given** Story 18.1's pipeline
**When** hi is registered LTR with Babel locale hi, numbering_system, own-script name हिन्दी, a Devanagari font stack, default_currency INR and unreviewed state
**Then** page lang, dir and formatting derive from the registry, and Devanagari renders with correct conjuncts and matras on screen and in the PDF (FR-27, AD-21)
**And** [ASSUMPTION: Hindi shows Latin digits (0-9) unless the owner prefers Devanagari digits] the digit choice is recorded in the registry and identical on screen and in the PDF (FR-24, NFR-X7).

**Given** the font decision
**When** the Devanagari stack is chosen
**Then** it is recorded with a reason [ASSUMPTION: Noto Sans Devanagari with a system fallback; owner may change it] and embedded in the PDF with the registry glyph check passing (UX-DR51)
**And** line-height is checked for stacked marks and cards grow rather than clip at 200% text-only zoom [ASSUMPTION: Devanagari line-height of 1.6 or more is taken from this check, not fixed in DESIGN].

**Given** AI-drafted Hindi for every UI string, email, PDF label, server message and term-catalog entry
**When** the validator and generator run
**Then** no key is missing or empty in messages.ts, the .po files or i18n/terms/hi.json, and each entry has review "unreviewed" (FR-27, NFR-X7)
**And** one agreed term per fiqh concept is used everywhere, [ASSUMPTION: transliteration is allowed where Hindi has no settled word, listed for owner confirmation], and relationship names read "{Hindi term} ({Arabic term})" with Arabic in bdi lang="ar" dir="rtl" inside LTR text (FR-28, UX-DR50).

**Given** the Hindi Locale
**When** Full results, the footer and the PDF render
**Then** each shows the Beta label "This translation has not yet been reviewed by a native speaker" in Hindi, with the civil-law notice, and English fallback is marked lang="en" (FR-29, FR-26)
**And** axe checks of the Interview and Full results in Hindi report no WCAG 2.1 AA violations (NFR-1).

**Given** the validator, glyph check and owner term confirmation pass
**When** hi is published through the registry
**Then** it appears in the switcher as हिन्दी, with localized public pages, hreflang and sitemap entries (FR-30, UX-DR49)
**And** a Hindi Interview-to-PDF browser journey passes.

**Given** Hindi numbers on screen and in the PDF
**When** they are formatted
**Then** they use Latin digits per CLDR's `hi` default (owner decision, 2026-11-16) (FR-24)

### Story 18.4: Use Mawareeth in Indonesian and Malay

As an Indonesian- or Malay-reading family member,
I want the whole product in my language with the Arabic terms beside relationship names,
So that I can follow the calculation in Bahasa Indonesia or Bahasa Melayu.

**Acceptance Criteria:**

**Given** Story 18.1's pipeline
**When** id and ms are registered LTR as separate entries with Babel locales id and ms, own-script names Bahasa Indonesia and Bahasa Melayu, a Latin font stack, default_currency IDR and MYR and unreviewed state
**Then** each has its own catalog, message files and registry entry, derived consumers, localized formatting and PDF glyph check (FR-27, AD-21)
**And** neither Locale is a copy of the other: shared wording is reused only where the validator shows both files holding it explicitly [ASSUMPTION: the two languages share one story but not one translation file].

**Given** AI-drafted Indonesian and Malay for every UI string, email, PDF label, server message and term-catalog entry
**When** the validator and generator run
**Then** no key is missing or empty in either Locale, and each entry has review "unreviewed" (FR-27, NFR-X7)
**And** one agreed term per fiqh concept per Locale, with differences between id and ms (for example inheritance and heir wording) kept deliberately and listed for owner confirmation (FR-28).

**Given** a family entered in either Locale
**When** Share preview, Full results, proof and PDF render
**Then** relationship names read "{translated term} ({Arabic term})" with Arabic in bdi lang="ar" dir="rtl", and numbers, currency and dates follow each Locale's conventions identically on screen and PDF (FR-28, FR-24, UX-DR50)
**And** Indonesia and Malaysia get a Locale, not a Country preset (PRD §7).

**Given** either Locale
**When** Full results, the footer and the PDF render
**Then** each shows the Beta label in that language with the civil-law notice, and English fallback is marked lang="en" (FR-29, FR-26)
**And** axe checks report no WCAG 2.1 AA violations (NFR-1).

**Given** the validator, glyph check and owner term confirmation pass for each Locale
**When** id and ms are published through the registry
**Then** each appears in the switcher in its own name with localized public pages, hreflang and sitemap entries, and an Interview-to-PDF browser journey passes in each (FR-30, UX-DR49)
**And** a Locale failing any gate stays unpublished without blocking the other.

### Story 18.5: Use Mawareeth in Turkish

As a Turkish-reading family member,
I want the whole product in Turkish with the Arabic terms beside relationship names,
So that I can follow the calculation in Turkish.

**Acceptance Criteria:**

**Given** Story 18.1's pipeline
**When** tr is registered LTR with Babel locale tr, Latin digits, own-script name Türkçe, a Latin font stack covering ğ, ş, ı, İ, ö, ü, ç, default_currency TRY and unreviewed state
**Then** page lang, dir and formatting derive from the registry and the PDF glyph check passes for those letters (FR-27, AD-21)
**And** screen and PDF use the same Turkish number and date conventions (FR-24, NFR-X7).

**Given** Turkish text and the dotted and dotless i
**When** UI and PDF text is rendered, uppercased by CSS or sorted
**Then** casing uses the lang="tr" rules so İ and ı are preserved [ASSUMPTION: no code uppercases translated text outside CSS; where one does, it is made locale-aware]
**And** no other behaviour changes.

**Given** AI-drafted Turkish for every UI string, email, PDF label, server message and term-catalog entry
**When** the validator and generator run
**Then** no key is missing or empty in messages.ts, the .po files or i18n/terms/tr.json, and each entry has review "unreviewed" (FR-27, NFR-X7)
**And** one agreed term per fiqh concept is used, and relationship names read "{Turkish term} ({Arabic term})" with Arabic in bdi lang="ar" dir="rtl" (FR-28, UX-DR50).

**Given** the Turkish Locale
**When** Full results, the footer and the PDF render
**Then** each shows the Beta label in Turkish, with the civil-law notice, and English fallback is marked lang="en" (FR-29, FR-26)
**And** Turkey gets a Locale, not a Country preset (PRD §7).

**Given** the validator, glyph check and owner term confirmation pass
**When** tr is published through the registry
**Then** it appears in the switcher as Türkçe, with localized public pages, hreflang and sitemap entries, and a Turkish Interview-to-PDF browser journey passes (FR-30, UX-DR49)
**And** axe checks report no WCAG 2.1 AA violations (NFR-1).

## Epic 19: German, Spanish, Italian and Chinese

The same Locale pipeline delivers the remaining four languages.

Owner decisions (owner decision, 2026-11-16) applying to every story in this epic: German, Spanish and Italian use formal address (Sie, usted, Lei); Spanish is one neutral `es` Locale; Chinese is Simplified only (Traditional later); the Arabic term beside a Chinese relationship name sits in full-width parentheses （…）.

### Story 19.1: Publish Mawareeth in German

As a German-speaking family member,
I want to use the whole product in German with fiqh terms I can follow,
So that I can understand my family's shares without reading Arabic or English.

**Acceptance Criteria:**

**Given** Epic 8's validator and Locale registry and Epic 18's Locale publication pipeline (registry publication, Beta label, language-switcher entry, hreflang/sitemap/localized metadata)
**When** `de` is added to `i18n/locales.json` with code, `ltr` direction, Babel locale `de`, `numbering_system` latn, own-script name "Deutsch", Latin PDF font stack, `default_currency` EUR, and review state "unreviewed"
**Then** the registry entry is the only place German is configured, and Django, Next.js, PDF, `hreflang` and the sitemap derive from it (FR-27, FR-23, AD-21)
**And** this story reuses Epic 18's publication steps and does not rebuild them; [ASSUMPTION: the validator is data-driven, so a new Locale needs no new gate code].

**Given** AI-drafted German text for `i18n/terms/de.json`, `messages.ts` and `.po`
**When** the single validator runs over catalog, `messages.ts` and `.po`
**Then** every Interview, results, proof, PDF label, account page, email, public page and server-side message key has a non-empty German value with matching named placeholders (FR-27, NFR-X7, AD-21, UX-DR50)
**And** missing or empty keys, or placeholder mismatches, fail CI with the Locale and key identified, and German is not exempted.

**Given** the German fiqh term list for relationships, Schools, Basis kinds, Obligatory bequest, *radd*, refusal reasons and proof templates
**When** any German screen, proof or PDF string names a term
**Then** each concept uses exactly one agreed German term from the catalog, each value recorded as `{text, review}` with the AI draft status and not marked reviewed (FR-28, AD-21)
**And** in Full results and the PDF each relationship reads "{German term} ({Arabic term})", with the Arabic original referenced by code and shown in `<bdi lang="ar" dir="rtl">` (FR-28, UX-DR50).

**Given** German Share preview, Full results and PDF
**When** a Case shows amounts, fractions, percentages and dates
**Then** they use Babel German conventions through the shared server presentation, with the estate currency defaulting to EUR for a new Case whose currency is not explicit, and with Gregorian dates in German format identical on screen and PDF (FR-23, FR-24, AD-19, owner decision 2026-11-16)
**And** a user-chosen currency is kept and not re-defaulted.

**Given** a School Basis and a Country Basis in German
**When** Full results and the draft PDF render
**Then** the civil-law notice appears under a School Basis and not under a Country law, and any live preset's `preset.<id>.notice` appears in German (FR-26, FR-25, AD-21)
**And** German catalog entries for notices exist for every registered preset, AI-drafted and marked unreviewed, without activating any preset.

**Given** German is unreviewed
**When** I view Full results, the footer or the PDF in German
**Then** the Beta label "Diese Übersetzung wurde noch nicht von Muttersprachlern geprüft" [ASSUMPTION: exact German wording is an AI draft for owner review] shows, is not hideable, and uses the shared Beta pill (FR-29, UX-DR48)
**And** the PRD English text "This translation has not yet been reviewed by a native speaker" is its meaning source.

**Given** the German font stack and a German-language PDF fixture covering umlauts, ß, Arabic terms, fractions and amounts
**When** the CI PDF glyph check runs and the registry state is set to published
**Then** missing glyphs block publication, and a pass publishes German through the registry only (FR-27, AD-21, NFR-X7)
**And** public pages carry `hreflang` links including `de`, appear in the German sitemap, and the language switcher lists "Deutsch" with `lang="de"` and a 44px target (FR-30, UX-DR49).

### Story 19.2: Publish Mawareeth in Spanish

As a Spanish-speaking family member,
I want to use the whole product in Spanish with fiqh terms I can follow,
So that I can understand my family's shares without reading Arabic or English.

**Acceptance Criteria:**

**Given** Epic 8's validator and Locale registry and Epic 18's Locale publication pipeline
**When** `es` is added to `i18n/locales.json` with `ltr` direction, Babel locale `es`, `numbering_system` latn, own-script name "Español", Latin PDF font stack, `default_currency` EUR and review state "unreviewed"
**Then** the registry entry is the only place Spanish is configured and every consumer derives from it (FR-27, FR-23, AD-21)
**And** Epic 18's publication steps are reused, not rebuilt; [ASSUMPTION: one neutral `es` Locale serves all Spanish speakers; regional variants are out of scope].

**Given** AI-drafted Spanish text for `i18n/terms/es.json`, `messages.ts` and `.po`
**When** the single validator runs
**Then** every UI, email, PDF label, public page and server-side message key has a non-empty Spanish value with matching named placeholders (FR-27, NFR-X7, AD-21, UX-DR50)
**And** any gap fails CI with the Locale and key identified.

**Given** the Spanish fiqh term list
**When** any Spanish screen, proof or PDF string names a relationship, School, Basis kind, Obligatory bequest or *radd*
**Then** one agreed Spanish term per concept comes from the catalog as `{text, review}` with unreviewed status (FR-28, AD-21)
**And** Full results and the PDF show "{Spanish term} ({Arabic term})" with the Arabic original in `<bdi lang="ar" dir="rtl">` (FR-28, UX-DR50).

**Given** Spanish Share preview, Full results and PDF
**When** amounts, fractions, percentages and dates render
**Then** they follow Babel Spanish conventions via shared presentation, the default currency for a non-explicit Case is EUR, and Gregorian dates are identical on screen and PDF (FR-23, FR-24, AD-19, owner decision 2026-11-16)
**And** [ASSUMPTION: Babel's Spanish rule of no grouping separator for four-digit numbers is accepted as correct Locale behaviour] acceptance examples inspect the actual strings.

**Given** a School Basis and a Country Basis in Spanish
**When** Full results and the draft PDF render
**Then** the civil-law notice appears under a School Basis and not under a Country law, and live presets' notices appear in Spanish, AI-drafted and unreviewed (FR-26, FR-25, AD-21)
**And** no preset is activated by supplying copy.

**Given** Spanish is unreviewed
**When** I view Full results, the footer or the PDF in Spanish
**Then** a non-hideable Beta label states that the translation has not yet been reviewed by a native speaker, in an AI-drafted Spanish wording for owner review (FR-29, UX-DR48)
**And** the label uses the shared Beta pill.

**Given** a Spanish PDF fixture covering accents, ñ, inverted punctuation, Arabic terms and amounts
**When** the CI glyph check runs and the registry state is set to published
**Then** missing glyphs block publication, and a pass publishes Spanish through the registry only (FR-27, AD-21)
**And** public pages have `hreflang` for `es`, appear in the Spanish sitemap, and the switcher lists "Español" with `lang="es"` (FR-30, UX-DR49).

### Story 19.3: Publish Mawareeth in Italian

As an Italian-speaking family member,
I want to use the whole product in Italian with fiqh terms I can follow,
So that I can understand my family's shares without reading Arabic or English.

**Acceptance Criteria:**

**Given** Epic 8's validator and Locale registry and Epic 18's Locale publication pipeline
**When** `it` is added to `i18n/locales.json` with `ltr` direction, Babel locale `it`, `numbering_system` latn, own-script name "Italiano", Latin PDF font stack, `default_currency` EUR and review state "unreviewed"
**Then** the registry entry is the only place Italian is configured and every consumer derives from it (FR-27, FR-23, AD-21)
**And** Epic 18's publication steps are reused, not rebuilt.

**Given** AI-drafted Italian text for `i18n/terms/it.json`, `messages.ts` and `.po`
**When** the single validator runs
**Then** every UI, email, PDF label, public page and server-side message key has a non-empty Italian value with matching named placeholders (FR-27, NFR-X7, AD-21, UX-DR50)
**And** any gap fails CI with the Locale and key identified.

**Given** the Italian fiqh term list
**When** any Italian screen, proof or PDF string names a relationship, School, Basis kind, Obligatory bequest or *radd*
**Then** one agreed Italian term per concept comes from the catalog as `{text, review}` with unreviewed status (FR-28, AD-21)
**And** Full results and the PDF show "{Italian term} ({Arabic term})" with the Arabic original in `<bdi lang="ar" dir="rtl">` (FR-28, UX-DR50).

**Given** Italian Share preview, Full results and PDF
**When** amounts, fractions, percentages and dates render
**Then** they follow Babel Italian conventions via shared presentation, the default currency for a non-explicit Case is EUR, and Gregorian dates are identical on screen and PDF (FR-23, FR-24, AD-19, owner decision 2026-11-16)
**And** a chosen currency is retained.

**Given** a School Basis and a Country Basis in Italian
**When** Full results and the draft PDF render
**Then** the civil-law notice appears under a School Basis and not under a Country law, and live presets' notices appear in Italian, AI-drafted and unreviewed (FR-26, FR-25, AD-21)
**And** no preset is activated by supplying copy.

**Given** Italian is unreviewed
**When** I view Full results, the footer or the PDF in Italian
**Then** a non-hideable Beta label states that the translation has not yet been reviewed by a native speaker, in AI-drafted Italian for owner review (FR-29, UX-DR48)
**And** the label uses the shared Beta pill.

**Given** an Italian PDF fixture covering accented vowels, Arabic terms, fractions and amounts
**When** the CI glyph check runs and the registry state is set to published
**Then** missing glyphs block publication, and a pass publishes Italian through the registry only (FR-27, AD-21)
**And** public pages have `hreflang` for `it`, appear in the Italian sitemap, and the switcher lists "Italiano" with `lang="it"` (FR-30, UX-DR49).

### Story 19.4: Publish Mawareeth in Simplified Chinese

As a Chinese-reading family member,
I want to use the whole product in Simplified Chinese with fiqh terms and Arabic originals that display correctly,
So that I can understand my family's shares on screen and in the PDF.

**Acceptance Criteria:**

**Given** Epic 8's validator and Locale registry and Epic 18's Locale publication pipeline
**When** `zh` is added to `i18n/locales.json` with `ltr` direction, Babel locale `zh`, `numbering_system` latn, own-script name "简体中文", a Han-capable PDF font stack, `default_currency` CNY, language tag `zh-Hans`, and review state "unreviewed"
**Then** the registry entry is the only place Chinese is configured, page `lang` and `hreflang` use `zh-Hans`, and every consumer derives from it (FR-27, FR-23, AD-21)
**And** Simplified script is [ASSUMPTION: PRD FR-27] and Epic 18's publication steps are reused, not rebuilt.

**Given** AI-drafted Chinese text for `i18n/terms/zh.json`, `messages.ts` and `.po`
**When** the single validator runs
**Then** every UI, email, PDF label, public page and server-side message key has a non-empty Chinese value with matching named placeholders (FR-27, NFR-X7, AD-21, UX-DR50)
**And** any gap fails CI with the Locale and key identified.

**Given** the Chinese fiqh term list
**When** any Chinese screen, proof or PDF string names a relationship, School, Basis kind, Obligatory bequest or *radd*
**Then** one agreed Chinese term per concept comes from the catalog as `{text, review}` with unreviewed status (FR-28, AD-21)
**And** Full results and the PDF show each relationship as "{Chinese term} ({Arabic term})" with the Arabic original in `<bdi lang="ar" dir="rtl">` and no stray bidi reordering of the Han text (FR-28, UX-DR50).

**Given** the web app and the PDF
**When** Chinese text renders
**Then** a Han-capable font stack is applied with `font-synthesis` off (review-accessibility), and the web stack, PDF stack and registry agree (FR-27, AD-21, UX-DR51)
**And** [ASSUMPTION: concrete families such as Noto Sans SC are chosen at implementation and recorded in the registry; the sources name no Chinese font] line breaking follows the default CJK rules without forced word-break, and long Arabic terms, names and amounts in a Chinese line do not overflow cards, badges or buttons at narrow widths.

**Given** Chinese Share preview, Full results and PDF
**When** amounts, fractions, percentages and dates render
**Then** they follow Babel Chinese conventions via shared presentation with Latin digits, the default currency for a non-explicit Case is CNY, and Gregorian dates are identical on screen and PDF (FR-23, FR-24, AD-19, owner decision 2026-11-16)
**And** a chosen currency is retained and fractions stay `dir="ltr"` isolated.

**Given** a School Basis and a Country Basis in Chinese
**When** Full results and the draft PDF render
**Then** the civil-law notice appears under a School Basis and not under a Country law, and live presets' notices appear in Chinese, AI-drafted and unreviewed (FR-26, FR-25, AD-21)
**And** an unreviewed Locale shows the non-hideable Beta label, in AI-drafted Chinese for owner review, on Full results, footer and PDF (FR-29, UX-DR48).

**Given** a Chinese PDF fixture covering common and less-common Han characters used by the catalog, Arabic terms, fractions and amounts
**When** the CI glyph check runs and the registry state is set to published
**Then** missing glyphs, such as tofu boxes, block publication, and a pass publishes Chinese through the registry only (FR-27, AD-21)
**And** public pages have `hreflang` for `zh-Hans`, appear in the Chinese sitemap, and the switcher lists "简体中文" with `lang="zh-Hans"` and a 44px target (FR-30, UX-DR49).

## Epic 20: AI assistants can calculate with Mawareeth

Any client or AI assistant calculates through the public API or MCP server without a key within a free limit, gets a link that opens the prefilled Interview, and heavy users request a billable API key through a Ticket.

### Story 20.1: Calculate a family through the public endpoint

As an app developer or AI assistant,
I want to send a family, an optional estate amount and a Basis and receive the calculation,
So that answers outside Mawareeth match the web app without an account.

**Acceptance Criteria:**

**Given** the Epic 8 engine and presentation, the Epic 14 preset registry and the Locale registry
**When** a client POSTs a family (relationship codes only), an optional estate amount with currency, a Basis (School, compare-all-Schools or a live Country preset) and a Locale to `/api/public/v1/calculate/`
**Then** the response carries, per Heir, the reduced fraction as `{numerator, denominator}` and as text, a percentage, an amount when an estate was given, and a no-share or blocked status, plus proof steps, any School difference, the Basis with its preset version, the Beta label state and the disclaimer, all text in the requested Locale (FR-38, AD-22, AD-19)
**And** the endpoint calls the core only through `presentation`, with no new calculation or formatting logic.

**Given** the same input, engine and preset version as an Interview request
**When** both are calculated
**Then** the public response carries the same fractions, statuses and proof ids as the web app (FR-38, NFR-2)
**And** a parity test over the shared known-answer fixtures covers every School, the compare-all Basis and each live preset.

**Given** a relationship code that is unknown or ambiguous (for example "uncle")
**When** the request is validated
**Then** it is rejected with `{error: code, detail, candidates}` listing the possible codes, and no numbers (FR-38, AD-22)
**And** a refusal (unsupported School, Malikiyya, Ja'fari, impossible family, unavailable preset pin) returns `{status:"refused", reason}` with no shares, never a partial result (FR-38, UJ-7).

**Given** the request carries more than 50 Heirs, more than 2 later deaths, an excessive graph depth or an oversized body
**When** it is parsed
**Then** the bounds are enforced before engine work with typed errors and the calculation has an execution budget well inside the 120 s bound (AD-26)
**And** a family at exactly 50 Heirs and 2 later deaths succeeds.

**Given** a request that includes optional person names
**When** the response is sent
**Then** names are used only to label that response and are then dropped; no Case, session or database row is created or changed (FR-38, NFR-X2, AD-22)
**And** a test asserts zero ORM writes and no session cookie read or set.

**Given** the logs and error reports for success, refusal and error paths
**When** they are inspected
**Then** they hold no request bodies, names, family data, API keys or prefill URLs, only redacted outcome codes and counts (NFR-X2, AD-26)
**And** the endpoint is CSRF-exempt, never reads the session cookie, and is not routed in production until Story 20.3 gates it [ASSUMPTION: a settings flag keeps it off until then].

### Story 20.2: Publish the OpenAPI document and code lists

As an app developer or AI assistant,
I want a public API description and list endpoints for relationships, Schools and live presets,
So that I can build requests with valid codes and show names in my user's language.

**Acceptance Criteria:**

**Given** the Epic 8 relationship catalog, School list and Locale registry
**When** a client GETs `/api/public/v1/relationships/` and `/api/public/v1/bases/`
**Then** every relationship, School and live Country preset is returned with its stable code and its name in the requested Locale, and in every Locale on request (FR-39, AD-22, AD-21)
**And** preset entries carry the current version, the Beta label state and any pinned-version availability; unchecked, future-dated or blocked presets never appear (AD-17).

**Given** a request for a Locale that is not live
**When** a list endpoint runs
**Then** it returns a typed error naming the live Locales, or the registry default if no Locale was sent [ASSUMPTION: default Locale applies when none is sent]
**And** no list endpoint writes to the database.

**Given** the generated OpenAPI document at `/api/public/v1/openapi.json`
**When** it is built from the same registries
**Then** it describes the calculate and list endpoints, the error and refusal shapes, the key header, the 429 and 503 responses and the bounds (FR-39, AD-22)
**And** the document is versioned with the `/v1/` path and changes only by a new version path.

**Given** CI
**When** the OpenAPI relationship, School or live-preset lists differ from the engine and registry
**Then** CI fails with the differing codes (FR-39, AD-22)
**And** a new preset registered live without regenerating the document also fails CI.

**Given** relationship names for a Locale that has a missing catalog entry
**When** the list is built
**Then** the build fails through the existing i18n validator instead of falling back silently to another language (AD-21)
**And** the list endpoints use the same code ids as Story 20.1 so a code returned here is always accepted there.

### Story 20.3: Limit keyless use fairly and explain the limit

As an app developer or AI assistant user,
I want free use within a clear limit and a useful message when I exceed it,
So that I can retry later or ask for a key, and the service stays available to everyone.

**Acceptance Criteria:**

**Given** the Epic 13 admission service and its shared PostgreSQL window table
**When** public API requests arrive without a valid key
**Then** one atomic check-and-consume runs per external invocation before parsing into the engine, counted per IP address, with the shared API and MCP bucket (FR-42, AD-23, AD-26)
**And** the free limit is configurable, with a placeholder default of 60 requests per IP per hour [ASSUMPTION: value owner-set; a Deferred item in the spine]; no new counter table is created if Epic 13 already provides it.

**Given** concurrent requests from the same IP across workers and both slots
**When** they are admitted
**Then** the limit holds exactly, with no lost updates and no reset on deploy (AD-23, AD-3)
**And** validation errors do not count but admitted results and refusals do.

**Given** a request over the limit
**When** it is rejected
**Then** it returns 429 with `Retry-After`, the time it may retry, and instructions to request an API key through an "API access" Ticket (FR-42, AD-23)
**And** the body contains no IP address or family data.

**Given** the counter store is unavailable
**When** a request arrives
**Then** admission fails closed with 503 and a redacted outcome, and no engine work runs (AD-23)
**And** the client IP is taken only from Caddy's rebuilt headers; a spoofed forwarded header cannot reset or share a limit (AD-26, AD-7).

**Given** a visitor reaches the rate-limited state in the web app or on the API page
**When** it is shown
**Then** it reads "Too many requests; try again after {time}" in the visitor's Locale, uses a polite live region, offers the key-request route and keeps any typed input (UX-DR68)
**And** the time is formatted for the Locale and shown in a mirrored layout for right-to-left Locales.

**Given** the public endpoints from Story 20.1 and 20.2
**When** this story ships
**Then** they are routed in production only behind admission, and API and MCP calls are counted as events for Story 12.4's registry (FR-42, FR-44)
**And** expired window rows are removed by the existing cleanup timer.

**Given** keyless public API and MCP use
**When** admission applies
**Then** the free limit is 60 requests per hour per IP, shared by API and MCP, held as configuration; per-key quotas and pricing are set by the owner outside the product (owner decision, 2026-11-16) (FR-42, AD-23)
**And** a request naming no Locale is answered in English, and every result includes the prefilled-Interview Case link by default (owner decision, 2026-11-16) (FR-38, FR-41).

### Story 20.4: Link every result to a prefilled Interview

As Salma, who got an answer from an assistant,
I want to open the same family and Basis in the Interview,
So that I can review the tree and download the draft PDF.

**Acceptance Criteria:**

**Given** a calculate request that asks for a Case link (default on) [ASSUMPTION: opt-out flag `include_case_link`]
**When** the result is built
**Then** the name-free canonical family and Basis are stored in the new `PrefillToken` table behind a random 256-bit token, kept only as `token_hash`, with an `expires_at` 7 days out, and the response carries a URL holding only the token (FR-41, AD-22)
**And** the migration creating `PrefillToken` is additive, and no family data or names appear in the URL, logs or token rows.

**Given** a visitor opens a prefill link
**When** the page loads
**Then** a confirm page shows without consuming the token, and only an explicit POST redeems it, so prefetchers and crawlers cannot use it up (FR-41, AD-22)
**And** an unknown, expired or already-used token shows the Expired case state with the 7-day lifetime explained, one new-Case action and no family data (UX-DR66, UX-DR89).

**Given** a valid token is redeemed
**When** the Epic 8.9 command service runs the redeem extension point
**Then** it claims the unexpired token, creates a new guest Case with the family and Basis, deletes the payload and bumps the revision, all in one atomic transaction (FR-41, AD-20, AD-22)
**And** two simultaneous redemptions create exactly one Case and the second gets "already used".

**Given** a visitor already has an unsaved Case in the session
**When** they redeem a link
**Then** the visitor is asked before the existing Case is replaced, and declining leaves both the Case and the token untouched (AD-22)
**And** a family the engine now refuses, or a preset pin no longer available, shows the refusal reason without numbers (UX-DR89, UJ-7).

**Given** the Interview opened from a link
**When** it renders
**Then** the tree, preview fractions, disclaimer, agreement fact and draft PDF path match the assistant's answer, in the stored Locale (UX-DR89, UJ-7)
**And** the "prefilled link opened" event is counted once without any token or Case id (FR-44).

**Given** the cleanup timer
**When** it runs
**Then** tokens past `expires_at` are deleted and a timer failure alerts the operator (AD-23, AD-27)
**And** the restore runbook gains a check that restored tokens past expiry are removed.

### Story 20.5: Let assistants connect through the MCP server

As an AI assistant,
I want an MCP server with tools to list codes and calculate,
So that I can relay Mawareeth's exact answer, the disclaimer and a Case link to my user.

**Acceptance Criteria:**

**Given** the Epic 8 core and Stories 20.1 to 20.4
**When** a client calls the stateless Streamable-HTTP endpoint at `/api/public/v1/mcp/` (a Django view, protocol revision 2026-07-28)
**Then** it offers `calculate_inheritance`, `list_relationships` and `list_bases`, which call the same functions as the public API and return fractions as text and numbers, the disclaimer and the Case link (FR-40, AD-22)
**And** the MCP view holds no state or session and creates no Case rows.

**Given** the tool descriptions
**When** an assistant reads them
**Then** they tell it to look up relationship codes first, ask the user when a relative is ambiguous, show the disclaimer and not round or restate shares as rulings (FR-40, UJ-7, UX-DR89)
**And** an ambiguous relative returns the typed candidate-codes error so the assistant can ask the user.

**Given** a request with a bad `Origin`, `MCP-Protocol-Version`, `Mcp-Method` or `Mcp-Name`, a GET or a DELETE
**When** it reaches the endpoint
**Then** bad headers are rejected, and GET and DELETE return 405 (AD-22, AD-26)
**And** the endpoint is CSRF-exempt, never reads the session cookie, and logs no bodies.

**Given** an MCP call, including a batch
**When** admission runs
**Then** each external invocation consumes one unit from the same bucket as the API before any engine work, never double-counting (FR-42, AD-23)
**And** the batch size is bounded and an over-size batch is rejected before work (AD-26); a refusal such as Ja'fari returns the reason and no numbers (UJ-7).

**Given** CI
**When** the official MCP Python SDK client (2.3.0) connects
**Then** it lists tools, calls each one and checks that results equal the public API's for the same input (FR-40, AD-22)
**And** CI covers the error, refusal, 405 and over-limit paths.

**Given** the wave-4 acceptance gate
**When** the owner connects the deployed server from hosted Claude and from a ChatGPT connector by URL
**Then** the manual run records pass or fail for the UJ-7 sequence (look up codes, clarify, calculate, show the disclaimer, give the link) with date and client versions (FR-40, AD-22)
**And** wave 4 does not ship while either connector fails, and the transport stays [ASSUMPTION: stateless Streamable HTTP with JSON responses] unless the gate shows it is insufficient.

**Given** the MCP server
**When** it is deployed
**Then** it uses stateless Streamable HTTP inside the existing Django image (owner decision, 2026-11-16) (FR-40, AD-22, AD-1)

### Story 20.6: Issue, meter and revoke billable API keys

As the owner,
I want to issue a key with a higher limit to a heavy user who asked through a Ticket and see its monthly usage,
So that I can invoice them manually and stop abuse at once.

**Acceptance Criteria:**

**Given** a visitor opens a Ticket with the topic "API access" through the Epic 13 data-driven topics
**When** the owner reviews it in the admin queue
**Then** the owner can issue a key in the Django admin, owned by `public_api`, with a name, quota, owner contact reference and a link back to the Ticket via a nullable reference (FR-43, AD-23, AD-24)
**And** this story first adds the `ApiKey` and `UsageCounter` tables and the nullable Ticket-to-key reference by additive migrations; a Ticket never holds the key.

**Given** a key is issued
**When** it is shown
**Then** the secret appears once, only its hash is stored, and it is never logged, emailed through the outbox or copied into a Ticket message (FR-43, NFR-5, AD-26)
**And** a lost key is replaced by a new issue, not recovered.

**Given** a request with a valid key
**When** admission runs
**Then** it is limited by that key's quota instead of the free limit, with the same atomic check-and-consume (FR-43, AD-23)
**And** an invalid or revoked key falls back to the per-IP free limit, not an error [ASSUMPTION: no distinct "key revoked" signal].

**Given** the owner changes a quota or revokes a key
**When** the next request arrives
**Then** the new quota applies and a revoked key stops at once and returns to the free limit (FR-43)
**And** revocations are reapplied after a restore, and the runbook gains a replay check (AD-27).

**Given** admitted requests with a key
**When** a result or refusal is returned
**Then** one unit is added to the key's UTC calendar-month `UsageCounter`; validation errors, 429s and 503s do not count (FR-43, AD-23)
**And** counters hold no IP, family data or names, and have their own retention.

**Given** the owner needs to invoice
**When** they open the key's admin view
**Then** monthly usage per key and per UTC month is shown and exportable, and there is no payment, price or invoice object in the product (FR-43, NFR-5)
**And** [ASSUMPTION: pricing and quota tiers are set by the owner outside the product] and the source tree contains no secrets or key material (AGPL, NFR-5).

**Given** a request carrying a revoked API key
**When** it reaches admission
**Then** it is rejected with HTTP 401 and a localized "API key revoked" error, and is never silently downgraded to the free limit (owner decision, 2026-11-16) (FR-43, AD-23)

### Story 20.7: Explain the API, MCP setup and terms on one page

As a developer or assistant user,
I want an API page with the document link, MCP setup, usage terms and key request,
So that I can start, stay within the terms and ask for more quota.

**Acceptance Criteria:**

**Given** the Next.js static export and the Locale registry
**When** `/{locale}/api/` is built [ASSUMPTION: route] for each live Locale
**Then** it shows the OpenAPI link, MCP setup by URL, example requests, the free-limit statement and the usage terms in that Locale, and it is linked from the footer and the rate-limited message (FR-39, UX-DR90, UX-DR68)
**And** it keeps handwritten shared `ui.ts` components, Tailwind CSS 4 and `prefetch=false` on every Link.

**Given** the usage terms
**When** they are shown
**Then** they say: free within the limit, a paid key above it, and the disclaimer and attribution must be shown by clients (FR-43, FR-42)
**And** they state that prices are on request and not shown, since pricing is [ASSUMPTION: owner-set] and not in the product.

**Given** a visitor wants a key
**When** they use the key-request action
**Then** they go to the Contact form with the "API access" topic preselected from the Epic 13 topic list (FR-43, UX-DR90)
**And** no key request or personal data is stored on the page itself.

**Given** the page is read by a keyboard, a screen reader, a narrow phone or a right-to-left Locale
**When** it renders
**Then** headings, code blocks, copy actions and the rate-limited state are operable and mirrored correctly, with code kept left-to-right (UX-DR90, UX-DR68)
**And** it shows the real free-limit value from the same setting as Story 20.3, never a hard-coded copy.

**Given** a Locale whose API page strings are not yet reviewed or complete
**When** the page is built
**Then** the i18n validator fails the build for a missing string rather than falling back silently (AD-21)
**And** the page displays no live data and makes no call that consumes the visitor's free limit.

### Story 20.8: Prove the public surface meets capacity and observability gates

As the owner,
I want measured speed, alerts and recovery checks for the public API and MCP,
So that wave 4 ships only when assistants get fast, safe answers on the shared host.

**Acceptance Criteria:**

**Given** both deployment slots running and the shared host
**When** the load test sends keyless, keyed and MCP requests with families up to 50 Heirs and 2 later deaths
**Then** public API p95 is under 1 s, including admission and prefill-token writes, with results recorded (NFR-3, AD-27)
**And** the run includes the compare-all-Schools Basis and the largest live preset, and a miss blocks wave 4.

**Given** the same run
**When** counters are updated concurrently across workers and slots
**Then** admission and key usage totals equal the admitted requests exactly, and lock waits stay inside the budget (AD-23, AD-27)
**And** a stalled counter store yields 503 within the budget rather than hanging (AD-23).

**Given** each public endpoint and the prefill cleanup timer
**When** they run
**Then** they emit redacted structured outcomes and low-cardinality latency, error and limit counts, with no key, IP, name or token labels (AD-27, AD-26)
**And** an alert reaches the operator for a timer failure, a 503 spike or a sustained over-limit surge.

**Given** a restore from backup to a test host
**When** the runbook runs
**Then** it checks the `PrefillToken`, `ApiKey` and `UsageCounter` tables, reapplies key revocations, removes expired tokens, and confirms preset and catalog files match the release (AD-27)
**And** a revoked key still returns to the free limit after restore.

**Given** a log and database scan after the load run
**When** it looks for names, family payloads, secrets and prefill URLs
**Then** none are found (NFR-X2, AD-26)
**And** the wave-4 checklist records the gate results together with the Story 20.5 connector acceptance.
