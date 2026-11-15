---
title: 'Mawareeth phase 2 PRD'
status: draft
created: '2026-11-16'
updated: '2026-11-16'
---

# PRD: Mawareeth phase 2 — easier for families, right for their country, in their language

## 0. Document Purpose

This PRD defines phase 2 of Mawareeth, which follows the phase-1 release of 2026-11-13 (PR #105). It is written for the product owner and for the downstream workflows that will turn it into UX changes, architecture decisions, epics and stories. Features are grouped in §4, with globally numbered requirements (FR-1 to FR-N) nested under them. Domain words are defined once in §3 and used exactly. Inferences awaiting confirmation are tagged `[ASSUMPTION]` and indexed in §9.

It builds on:
- the country-law research, `_bmad-output/planning-artifacts/research/domain-islamic-inheritance-country-laws-2026-11-16/research.md`
- the archived phase-1 PRD, `_bmad-output/archive/phase-1/planning-artifacts/prd.md`
- open items in `_bmad-output/implementation-artifacts/deferred-work.md`
- an input digest, `inputs-extract.md`, in this folder

Technical options and rule-setting detail live in `addendum.md`.

## 1. Vision

Mawareeth already does the hard part: it calculates Islamic inheritance exactly, across the four Sunni schools and through successive deaths, and explains every share. Phase 2 makes that power easy to reach for the people who need it most: families sorting out an estate, often for the first time, often grieving, often on a phone.

Phase 2 has three aims:
- **Fewer steps.** Building the family takes a press or a drag, not a form per relative. A family edits the tree where they see it, and returns to a named case without detours.
- **Right for the country.** A family in Cairo, Amman, Casablanca, Dubai, Riyadh, Algiers or Beirut can calculate under their country's inheritance law as well as under a school. That includes the obligatory bequest for grandchildren whose parent died first, a rule that most Arab statutes add and that no school calculation shows.
- **In their language.** Mawareeth speaks to Muslim communities in Urdu, Hindi, Turkish, Indonesian, Malay, German, Spanish, Italian and Chinese, as well as Arabic, English and French. A real person answers when a family is stuck.
- **Reachable from AI assistants.** When a family asks an AI assistant who inherits what, the assistant can call the real Mawareeth engine instead of guessing, and hand the family a link to the same case.

The calculation, comparison, proof and draft PDF stay free. Mawareeth remains a calculation aid, not a fatwa or legal advice. Where content has not yet been reviewed by a scholar or a native translator, it says so plainly.

## 2. Target User

### 2.1 Jobs To Be Done

**Families (primary)**
- *Functional:* "Tell me who gets what from my father's estate, under the law that actually applies where we live, without making me learn fiqh first."
- *Functional:* "Let me put the whole family in quickly, see it as a tree, and fix mistakes where I see them."
- *Emotional:* "Help me trust the answer enough to show my siblings, and avoid an argument."
- *Contextual:* "I'm on my phone, I may not read Arabic well, and I'll come back to this over several days."
- *Social:* "Give me something clear to share with relatives and take to a scholar, lawyer or court."

**Lawyers and scholars (secondary)**
- *Functional:* "Show me the statute basis for each share, so I can check a family's numbers fast."
- *Functional:* "Keep my cases organised by name, not by reference code."

### 2.2 Non-Users (phase 2)

- Buyers of a paid, human-reviewed calculation. That is the private marketplace project.
- Shia (Ja'fari) families. The engine does not yet support the Ja'fari school; it is deferred to a later phase.
- People needing will drafting, probate filing, tax or asset-valuation advice.

### 2.3 Key User Journeys

- **UJ-1. Mona settles her father's estate under Egyptian law.**
  - **Persona and context:** Mona, 41, in Cairo. Her father died; her brother Karim died two years before him and left two children. Her aunt says Karim's children get nothing, her cousin says they do.
  - **Entry state:** guest, on a phone, Arabic UI, coming from a search.
  - **Path:**
    1. She opens the interview and picks "Law of Egypt" instead of a school.
    2. She enters her father and the estate.
    3. She taps *Wife*, *Daughter*, *Son* to add her mother, herself and her brother Hassan.
    4. She adds Karim as a son who died before his father, then taps his node to add his two children.
  - **Climax:** the preview shows an "Obligatory bequest" line for Karim's children, capped at a third, with "Egyptian Wills Law 71/1946, art. 76" beneath it. Her mother, Hassan and Mona share the rest. A beta label says the Egypt preset is not yet scholar-reviewed.
  - **Resolution:** she taps the prominent *Full results* button, downloads the draft PDF and sends it on WhatsApp.
  - **Edge case:** she had already entered Karim's children as heirs. The tree flags that they inherit through the obligatory bequest under this law, and moves them there.

- **UJ-2. Yusuf builds a big family in minutes and fixes a slip on the tree.**
  - **Persona and context:** Yusuf, 55, in Amman, eldest son, entering his mother's estate. Eleven surviving relatives.
  - **Entry state:** registered user, desktop, Arabic UI.
  - **Path:**
    1. He taps relationship buttons to add relatives with no name typing, or drags a relationship chip onto the tree.
    2. He spots a sister he added as a half-sister.
    3. He opens her node on the tree, changes the relationship, and deletes a duplicate brother from his node.
  - **Climax:** the preview updates after each change, and the tree and the shares always match.
  - **Resolution:** he saves the case and names it "Mother's estate, 2026".

- **UJ-3. Yusuf comes back three days later.**
  - **Entry state:** registered user, any device.
  - **Path:** *My cases* lists "Mother's estate, 2026". He opens it.
  - **Climax:** the case opens straight into the interview with his family loaded. There is no "Start an inheritance case / resume or start over" screen.
  - **Resolution:** he renames it "Mother's estate (final)".

- **UJ-4. Bilal reads his result in Urdu.**
  - **Persona and context:** Bilal, 34, in Birmingham. He reads Urdu more comfortably than English or Arabic, and his uncle died in Lahore.
  - **Path:** he switches the language to اردو. The page turns right-to-left; terms and relationship names are in Urdu, and a "translation not yet reviewed" label sits in the footer.
  - **Climax:** the results read naturally. When the schools agree, there is no "Calculated under the Hanbali school" line, only "Same result in all four Sunni schools".
  - **Resolution:** he downloads the PDF in Urdu.

- **UJ-5. Huda asks for help and gets an answer.**
  - **Persona and context:** Huda, in Algiers, is confused why her late husband's nephew inherits.
  - **Path:** she taps *Contact us*, picks "Question about my result", writes her question and gives her email. She does not have to attach the case.
  - **Climax:** she gets an email with a ticket number, and later the owner's reply, in the same thread.
  - **Resolution:** she can also tap *WhatsApp* to message the support number directly.

- **UJ-6. Maître Benali checks a Moroccan case.** *(secondary)*
  - **Persona and context:** a notary's clerk in Casablanca, French UI.
  - **Path:** they choose "Loi marocaine (Code de la famille 2004)", enter the family, and open the proof.
  - **Climax:** every share cites its article (for example, art. 349 for the leftover estate, arts. 369–372 for the obligatory bequest).
  - **Resolution:** they save the case under a client name and share it by private link.

## 3. Glossary

- **Case:** one deceased person, their estate and their heirs, as entered in the Interview. A guest's Case lives for 24 hours after the last change. A registered user's Case can become a Saved case.
- **Saved case:** a Case stored on a registered user's account, with a Case name.
- **Case name:** a user-editable label for a Saved case. It replaces the case reference in the UI.
- **Deceased:** the person whose estate is divided. A Case can contain later deaths (successive deaths).
- **Heir:** a relative of the Deceased entered in a Case, with a relationship and an optional name.
- **Interview:** the guided screens where the user enters the Deceased, estate and Heirs.
- **Family tree:** the visual diagram of the Deceased and Heirs in the Interview. Heirs can be added, edited and deleted from it.
- **Share preview:** the live share table beside the Interview.
- **Full results:** the results page with shares, proof, PDF, save and share.
- **School:** one of the four Sunni schools of Islamic law (Hanafi, Maliki, Shafi'i, Hanbali).
- **Country law:** the inheritance rules of one country's statute, used instead of a School. A Case is calculated under exactly one Basis.
- **Basis:** what a Case is calculated under: a School or a Country law.
- **Country preset:** the versioned data that defines one Country law for the engine: statute citation, version date, rule settings and default school for gaps.
- **Obligatory bequest:** a share that a Country law gives to grandchildren whose parent died before (or with) the Deceased. It is capped at one third and taken out before the heirs share the rest. Also called *wasiyya wajiba* or *tanzil*.
- **Beta label:** a visible notice that a Country preset or a Locale has not yet been reviewed by a qualified scholar or native translator.
- **Locale:** a UI language, such as ar, en, fr or ur.
- **Ticket:** a support request created from the Contact form, with a number and an email thread.

## 4. Features

### 4.1 Faster family entry and an editable Family tree

**Description:** today an Heir is added by choosing a relationship, typing a name and pressing save. Phase 2 makes adding an Heir one action, and lets the user edit the family where they see it: on the Family tree. Names become optional; the system gives a default label ("Son 2") that the user can change later. Realizes UJ-1 and UJ-2.

#### FR-1: One-press heir add
A user can add an Heir by pressing one relationship button. Realizes UJ-2.

**Consequences (testable):**
- Pressing a relationship button adds an Heir of that relationship to the Case and the Family tree with no further input.
- The new Heir gets a default label in the current Locale ("Son 1", "Son 2"), editable later.
- Relationships the engine says cannot apply (for example a second father) are not offered, as today.
- The Share preview updates after each add.

#### FR-2: Drag-and-drop onto the Family tree
A user can drag a relationship onto the Family tree, onto the Deceased or onto an Heir, to add a relative in that position. Realizes UJ-1 and UJ-2.

**Consequences (testable):**
- Dropping "Son" on a son who died before the Deceased adds that son's child (a grandchild) in the right line.
- Every drag action has a keyboard and screen-reader equivalent that reaches the same result.
- On touch screens, press-and-hold to drag works, and a tap-to-add alternative exists.

#### FR-3: Edit and delete heirs from the Family tree
A user can select an Heir on the Family tree and change their name or relationship, or delete them. Realizes UJ-2.

**Consequences (testable):**
- Selecting a node opens an edit panel (desktop) or bottom sheet (mobile) with name, relationship and delete.
- Deleting an Heir who has descendants in the Case asks for confirmation and states what else is removed.
- The Heirs list, the Family tree and the Share preview always show the same family after any edit.

#### FR-4: Bulk count
A user can add several Heirs of the same relationship at once (for example "4 daughters"). Realizes UJ-2.

**Consequences (testable):**
- Entering a count of up to the case limit adds that many Heirs with default labels.
- [ASSUMPTION: a count stepper on each relationship button is acceptable UI; the UX pass may choose another form.]

**Feature-specific NFRs:**
- The Family tree keeps the Deceased visible for families of up to 50 Heirs at 375px and 1280px widths (deferred-work: tree overflow).
- Arrow-key navigation between tree nodes (deferred-work: tree keyboard access).

### 4.2 Saved cases that open directly, with names

**Description:** today, opening a Saved case shows the "Start an inheritance case" screen with "resume or start over". Phase 2 opens the Case straight into the Interview, and lets the user name and rename cases. Realizes UJ-3.

#### FR-5: Open a Saved case directly
A registered user can open a Saved case from *My cases* straight into the Interview with its family loaded. Realizes UJ-3.

**Consequences (testable):**
- No "resume or start over" prompt appears when opening a Saved case.
- Starting a new case is a separate, explicit action in *My cases*.
- [ASSUMPTION: the resume/start-over prompt stays only for a guest who returns to an unsaved Case within 24 hours.]

#### FR-6: Case names
A registered user can name a Saved case and rename it at any time. Realizes UJ-3, UJ-6.

**Consequences (testable):**
- Saving prompts for a Case name, prefilled with a suggestion (for example "Estate of {deceased name or label}, {date}").
- *My cases* lists and sorts by Case name and last change; the case reference is no longer shown as the main label.
- A Case name accepts any Locale's script, up to 100 characters.

### 4.3 Clearer results

**Description:** Results should be easy to reach and should not mention a School when the School makes no difference. Realizes UJ-1 and UJ-4.

#### FR-7: School line only when it matters
The system shows which School or Country law produced the result only when it changes the shares, or when the user chose a Country law. Realizes UJ-4.

**Consequences (testable):**
- When all four Schools agree, the Share preview and Full results show "Same result in all four Sunni schools" and no "Calculated under the {school} school" line.
- When Schools differ, the user's chosen School is named.
- Under a Country law, the Country preset name and version date are always shown.

#### FR-8: Prominent Full results
The user can reach Full results from the Share preview through a primary button, not a text link under the table. Realizes UJ-1.

**Consequences (testable):**
- The button is visible without scrolling on a 375px screen once the preview has shares.
- It meets WCAG 2.1 AA target size and contrast.

#### FR-9: Estate guidance
The system explains what "estate to divide" means for the chosen Basis before the user enters an amount.

**Consequences (testable):**
- The estate hint states that debts, funeral costs and bequests come out first, and that jointly owned or beneficiary-designated assets may not form part of the estate.
- The PDF footer states that the estate amount and the family were supplied by the user and not verified by Mawareeth.

### 4.4 Country law

**Description:** a user can calculate under a Country law instead of a School. Phase 2 ships seven Country presets:
- Saudi Arabia: Personal Status Law, 2022
- UAE: Federal Decree-Law 41/2024
- Egypt: Laws 77/1943 and 71/1946
- Jordan: Personal Status Law 15/2019
- Morocco: Family Code 70-03, 2004
- Algeria: Family Code
- Lebanon: Sunni Hanafi-based rules

The engine gains one shared Obligatory bequest step and a few rule switches. Each Country preset is versioned data, not a separate engine. Realizes UJ-1 and UJ-6. Rule detail per country is in `addendum.md` §A.

#### FR-10: Choose the Basis
A user can choose a Country law or a School as the Basis of a Case. Realizes UJ-1.

**Consequences (testable):**
- The Basis choice lists the four Schools and the seven Country laws, in the current Locale.
- [ASSUMPTION: the choice is offered at the start of the Interview and can be changed later; the default stays "compare all four Schools".]
- Changing the Basis recalculates the Share preview.

#### FR-11: Obligatory bequest
Under a Country law that has one, the engine gives an Obligatory bequest to the qualifying grandchildren of a child who died before or with the Deceased. Realizes UJ-1.

**Consequences (testable):**
- The qualifying lines, depth, one-third cap, lifetime-gift offset and male-to-female split follow the Country preset settings (`addendum.md` §A).
- The bequest is taken out before the heirs share the rest. The Share preview and Full results show it as its own line, with its article citation.
- The Dar al-Ifta worked example (fatwa 8330) and the Moroccan commentary example (49/960) pass as automated tests.
- Under a School Basis, no Obligatory bequest is applied.

#### FR-12: Rule switches per Country preset
The engine applies each Country preset's settings for leftover estate (*radd*), distant kin, grandfather with siblings, the special cases (mushtaraka, akdariyya) and the default school for gaps.

**Consequences (testable):**
- Each Country preset has at least one passing test case per setting that differs from its default school.
- The research's examples (for example Saudi Arabia: the grandfather excludes siblings; no mushtaraka sharing) pass as tests.

#### FR-13: Statute citations in proof and PDF
For each share under a Country law, the proof and the PDF cite the statute and article. Realizes UJ-6.

**Consequences (testable):**
- Every proof step under a Country law has a citation from the Country preset.
- The PDF header names the Country preset and its version date.

#### FR-14: Versioned Country presets
A Saved case stores the Basis and the Country preset version it was calculated with.

**Consequences (testable):**
- Opening a Saved case after a Country preset changes shows the stored version and offers to recalculate under the current one.
- Shared and PDF results always state the version used.

#### FR-15: Beta label on unreviewed Country presets
Each Country preset shows a Beta label until a qualified reviewer signs it off.

**Consequences (testable):**
- The Beta label appears on the Basis choice, the Share preview, Full results and the PDF.
- Removing the label is a data change recorded with the reviewer's name and date.

#### FR-16: Unsupported situations under a Country law
When a family needs a rule the Country preset does not cover (for example a Shia family in Lebanon), the system says so instead of showing a number.

**Consequences (testable):**
- The refusal names the reason in the current Locale, as the engine already does for the Ja'fari school and the Malikiyya case.

**Notes:**
- Release gate per Country preset: the owner checks the cited articles against the official text. Jordan, the UAE and Algeria have known open points (research §Open questions).
- Lebanon (Sunni) applies the preferred Hanafi opinion after any Supreme Sunni Islamic Council decisions and the 1917 Ottoman Family Rights Law (1962 law art. 242, am. 2011). No obligatory bequest was found, so the preset reuses the Hanafi rules with all switches off. Its notice covers Shia families (Ja'fari courts, not supported) and non-Muslims (1959 law).

### 4.5 Country localisation

**Description:** the experience adapts to the user's country: money, numbers and notices. Realizes UJ-1 and UJ-4.

#### FR-17: Currency
A user can choose the estate currency; it defaults from the Country law, or else from the Locale.

**Consequences (testable):**
- Amounts show in the chosen currency's symbol and minor-unit rules in the Share preview, Full results and PDF.
- Exact fractions are unaffected; only money display and rounding change.

#### FR-18: Number and date formats
Numbers and dates follow the Locale's conventions (for example Arabic-Indic digits where the Locale uses them).

**Consequences (testable):**
- Fractions, percentages and amounts render per Locale in screen and PDF, and stay consistent between the two.

#### FR-19: Country notices
Each Country law can carry a short country-specific notice. For example, the UAE notice says non-Muslims may follow a different civil law, and the Egypt notice says a constitutional challenge to the bequest article has been reported.

**Consequences (testable):**
- The notice shows on Full results and in the PDF under that Country law.

### 4.6 New languages

**Description:** Mawareeth adds nine Locales: Urdu, Hindi, Turkish, Indonesian, Malay, German, Spanish, Italian and Chinese, alongside Arabic, English and French. AI drafts the translations and the owner reviews them. Each new Locale carries a Beta label until a native speaker reviews it. Realizes UJ-4.

#### FR-20: Nine new Locales
A user can use the whole product in each new Locale, including the Interview, results, proof, PDF, account pages, emails and public pages.

**Consequences (testable):**
- Every UI string, email and PDF label has a value in every Locale. A CI check fails on missing keys.
- Urdu renders right-to-left in screen and PDF, like Arabic.
- Chinese uses Simplified script `[ASSUMPTION]`.

#### FR-21: Fiqh term glossary per Locale
Fiqh terms (relationship names, Obligatory bequest, *radd*, School names) use one agreed translation per Locale.

**Consequences (testable):**
- A per-Locale term list exists, and every UI and PDF string uses it.

#### FR-22: Beta label on new Locales
An unreviewed Locale shows a Beta label ("This translation has not yet been reviewed by a native speaker").

**Consequences (testable):**
- The label appears in the footer and on the PDF for that Locale.

#### FR-23: Discoverable languages
Public pages exist in every Locale, with correct `hreflang`, sitemap entries and a language switcher listing each language in its own script.

### 4.7 Content review

**Description:** fix wrong or outdated content, and work through the review backlog of Arabic, French and fiqh wording.

#### FR-24: Accurate legal pages
The terms and privacy pages match the product.

**Consequences (testable):**
- The terms no longer claim "all intellectual property rights reserved" or forbid redistribution; they state the AGPL-3.0 licence.
- The privacy page drops the advertising-partner text and covers accounts, sharing, email, WhatsApp, support Tickets, retention and the rights of the families whose data is entered.
- Typos ("webste") are fixed in every Locale.

#### FR-25: Arabic and French copy pass
All Arabic and French strings listed in deferred-work as "unreviewed" are reviewed and corrected by the owner, and marked reviewed.

#### FR-26: Fiqh wording pass
The proof texts, refusal sentences and kinship labels listed in deferred-work are reviewed for accuracy and plain language. The Shared-fixed-share explanation is added (two wives share 1/8, so 1/16 each).

### 4.8 Contact and support

**Description:** a family can ask for help and get a tracked answer, by form or WhatsApp. Realizes UJ-5.

#### FR-27: Contact form creates a Ticket
Any visitor can send a question through a Contact form, which creates a Ticket and emails them its number. Realizes UJ-5.

**Consequences (testable):**
- The form asks for a topic, a message, an email and, optionally, a link to their Case. It never requires case data.
- The visitor receives an email with the Ticket number in the current Locale.
- The form is protected against spam without a third-party tracking captcha `[ASSUMPTION]`.

#### FR-28: Ticket replies by email
The owner can answer a Ticket, and the visitor sees the whole exchange in one email thread.

**Consequences (testable):**
- Replies from the owner reach the visitor, and the visitor's email replies attach to the same Ticket.
- The owner can see open and closed Tickets in one place.

#### FR-29: WhatsApp click-to-chat
A *WhatsApp* link on the Contact page and in the footer opens a chat with the support number.

#### FR-30: Support data retention
Ticket data is kept only as long as needed and is deletable on request.

**Consequences (testable):**
- Closed Tickets are deleted after a set period [ASSUMPTION: 12 months], and the privacy page states it.

### 4.9 AI tools can use Mawareeth

**Description:** families increasingly ask ChatGPT, Claude, Gemini or another assistant "who inherits what". Those assistants often guess the shares, and they get hard cases wrong. Phase 2 lets any AI assistant call the real Mawareeth engine. It does this through a public calculation API and an MCP server (the Model Context Protocol, the standard way assistants call outside tools). The assistant sends a family and a Basis, and gets back exact shares, the proof and the disclaimer, with a link to open the same Case on Mawareeth. Realizes UJ-7.

- **UJ-7. Salma asks her assistant, and the assistant asks Mawareeth.**
  - **Persona and context:** Salma, 29, in Kuala Lumpur, asks an AI assistant in English: "My grandmother died, leaving my grandfather, my mother and two uncles. Who gets what?"
  - **Path:** the assistant, connected to the Mawareeth MCP server, calls `calculate_inheritance` with the family and "compare all four Schools".
  - **Climax:** the assistant answers with Mawareeth's exact fractions, says the four Schools agree, quotes the "calculation aid, not a fatwa" notice, and gives an "Open this case on Mawareeth" link.
  - **Resolution:** Salma opens the link. The Interview is prefilled with that family, and she downloads the draft PDF.
  - **Edge case:** if the family needs a rule Mawareeth refuses (for example the Ja'fari school), the tool returns the refusal and its reason, and no numbers.

#### FR-31: Public calculation API
Any client can send a family, an optional estate amount and a Basis, and receive the calculation. No account is needed. Realizes UJ-7.

**Consequences (testable):**
- The response holds, for each Heir: an exact fraction, a percentage, an amount if an estate was given, and a no-share or blocked status. It also holds the proof steps, any School difference, the Basis with its Country preset version, the Beta label state, and the disclaimer text.
- Refusals (unsupported school, Malikiyya, impossible family) come back as structured reasons, never as numbers.
- The API stores no Case and logs no names [ASSUMPTION: names are optional in the request and dropped after the response].
- The same input gives the same output as the web app for the same engine and preset version (NFR-2).

#### FR-32: Published API description
The API is described in a public OpenAPI document. Every relationship, School and Country preset is listed with its identifier and its names in each Locale.

**Consequences (testable):**
- A CI check fails if the OpenAPI document and the engine's relationship or preset list disagree.
- An "API" page in the footer links to the document, the MCP setup and usage terms.

#### FR-33: MCP server
An AI assistant can connect to a Mawareeth MCP server and use its tools: `calculate_inheritance`, `list_relationships` and `list_bases`. Realizes UJ-7.

**Consequences (testable):**
- The tools return the same content as FR-31, written so an assistant can relay it faithfully: fractions as text and numbers, the disclaimer, and the Case link.
- The tool descriptions tell the assistant to show the disclaimer and not to round or restate shares as rulings.
- The server works over the standard remote MCP transport `[ASSUMPTION]`, so hosted assistants can connect with a URL.

#### FR-34: Open the same Case on Mawareeth
Each API and MCP result includes a link that opens the Interview prefilled with that family and Basis. Realizes UJ-7.

**Consequences (testable):**
- The link carries the family in the URL or in a short-lived token, and creates a guest Case only when it is opened.
- The link expires after a set period [ASSUMPTION: 7 days].

#### FR-35: Fair use
The API and MCP server limit how much any one client can use them, without accounts.

**Consequences (testable):**
- Requests over the limit get a clear "too many requests" response with a retry time. The response says how to request a key.
- Anyone, including commercial apps, may call the free API within the free limit.

#### FR-36: Billable API keys for heavy users
A heavy user, such as a law firm or a commercial app above the free limit, can request an API key by opening a Ticket with the topic "API access". The owner can issue a billable key with a higher limit.

**Consequences (testable):**
- Requests carrying a valid key are limited by that key's quota, not by the free per-IP limit.
- The owner can issue, change the quota of, and revoke a key, and see each key's monthly usage.
- Revoking a key stops its requests at once and returns them to the free limit.
- The usage terms on the API page say: free within the limit, a paid key above it, and the disclaimer and attribution must be shown.
- [ASSUMPTION: in phase 2 billing is manual. The owner invoices from the monthly usage, and there is no in-app payment.]

**Feature-specific NFRs:**
- p95 response time under 1 s for families of up to 50 Heirs. The API uses the in-memory calculation path, never a database write per request.
- The API returns text in any of the supported Locales on request.

## 5. Non-Goals (Explicit)

- Mawareeth will not sell reviewed calculations in phase 2. That is the private marketplace project.
- No Ja'fari (Shia) school, and no Lebanese Shia, Christian or Druze rules.
- No will drafting, probate filing, estate valuation, tax or legal advice.
- No country presets beyond the seven listed. Kuwait waits for its reform; Iraq needs Ja'fari.
- No native mobile apps; the web app stays responsive.
- No paid translation or scholar review this phase. Beta labels make that visible instead.

## 6. MVP Scope

### 6.1 In Scope
- Faster family entry, an editable Family tree, named Saved cases that open directly (FR-1 to FR-6).
- Results clarity: School line only when it matters, a prominent Full results button, estate guidance (FR-7 to FR-9).
- The Obligatory bequest step, rule switches, and seven Country presets with citations, versioning and Beta labels (FR-10 to FR-16).
- Currency, number formats and Country notices (FR-17 to FR-19).
- Nine new Locales with a term glossary and Beta labels (FR-20 to FR-23).
- Legal-page fixes and the Arabic, French and fiqh copy pass (FR-24 to FR-26).
- Contact form, Tickets, WhatsApp, retention (FR-27 to FR-30).
- Public calculation API, OpenAPI document, MCP server, prefilled Case links, fair-use limits, billable API keys (FR-31 to FR-36).

### 6.2 Out of Scope for phase 2
- Ja'fari school (deferred: a whole second rule set).
- Other Indian languages such as Bengali, Tamil and Malayalam; Hindi first, others later.
- Outside scholar or translator review (deferred; the Beta label covers the gap). `[NOTE FOR PM]` This is the biggest trust risk in the phase. Revisit if any Country preset is used for a court filing.
- Shares shown on Family tree nodes (deferred-work item; candidate if time allows).

## 7. Success Metrics

Measured over the 90 days after each feature ships, against the 90 days before where a baseline exists.

**Primary**
- **SM-1: Steps per family.** Actions to enter a five-heir family fall from about 15 (3 per Heir) to 5 or fewer, and a typical family case is done in under 3 minutes in moderated tests. Validates FR-1 to FR-4.
- **SM-2: Completion.** The share of started Cases that reach a Share preview with shares rises by 20% relative. Validates FR-1 to FR-9.

**Secondary**
- **SM-3: Country reach.** Cases calculated under a Country law, and visits from the seven countries, are tracked; at least 15% of Cases from those countries use their Country law. Validates FR-10 to FR-19.
- **SM-4: Language reach.** Each new Locale has at least one completed Case per week within 90 days. Validates FR-20 to FR-23.
- **SM-5: Support responsiveness.** 90% of Tickets get a first reply within 2 business days. Validates FR-27 to FR-29.
- **SM-6: AI reach.** API and MCP calculations per week, and Cases opened from FR-34 links, tracked from launch; target 100 calculations a week within 90 days `[ASSUMPTION]`. Validates FR-31 to FR-36.

**Counter-metrics (do not optimise)**
- **SM-C1: Calculation accuracy.** Any engine defect found in a Country preset counts against SM-3. Never relax a rule to "make a result appear". Counterbalances SM-2 and SM-3.
- **SM-C2: Accidental deletions.** Undo and restore requests after Family-tree deletes must not rise. Counterbalances SM-1.
- **SM-C3: Data collected.** No new personal data fields to raise completion or support speed. Counterbalances SM-2 and SM-5.
- **SM-C4: Misquoted results.** Do not chase API volume by dropping the disclaimer, the proof or the refusals from tool output to make answers shorter. Counterbalances SM-6.

`[ASSUMPTION: SM-2 to SM-4 need privacy-respecting, cookie-free event counts on the server; today only Cloudflare Web Analytics page views exist.]`

## 8. Cross-Cutting NFRs

- **NFR-1 Accessibility:** WCAG 2.1 AA in every Locale, including right-to-left (Arabic, Urdu), the Family tree, and keyboard alternatives for every drag action.
- **NFR-2 Determinism:** the same Case, Basis and Country preset version always gives the same exact fractions on screen and in the PDF.
- **NFR-3 Performance:** the Share preview updates within 1 s at the 95th percentile for families of up to 50 Heirs on a mid-range phone over 4G. This needs the in-memory preview path from deferred-work.
- **NFR-4 Privacy:** no new personal data beyond what the calculation needs. Ticket data is minimised, and Case data never goes into a Ticket automatically. The rules follow GDPR and Saudi PDPL principles, including for data about the Deceased.
- **NFR-5 Licence:** all code stays AGPL-3.0. No third-party service may make the source offer impossible.

## 9. Constraints and Guardrails

- **Legal standing.** Every result keeps the "calculation aid, not a fatwa or legal advice" notice. Country presets do not say "certified" or "court-approved".
- **Review model.** AI drafts and the owner reviews; there is no outside sign-off this phase. Beta labels (FR-15, FR-22) are mandatory, not optional.
- **Law change.** The Morocco reform, the Kuwait overhaul and Egypt's constitutional challenge can change the rules; re-check by 2027-01 (research staleness map). Versioning (FR-14) keeps old results explainable.

## 10. Open Questions

1. Lebanon: does any Supreme Sunni Islamic Council decision (for example no. 46 of 2011) change inheritance shares? The research found Hanafi rules with no obligatory bequest (`research/domain-lebanon-sunni-inheritance-law-2026-11-16`), but this rests on not finding one.
2. Jordan: confirm the article numbering in Law 15/2019 and the apostate rule in art. 281(c).
3. UAE: confirm the art. 240 mushtaraka split and the grandfather article.
4. Algeria: whether daughters' children qualify for *tanzil* (Supreme Court ruling 932349).
5. Egypt: the art. 76 generation limits, and the outcome of the constitutional challenge.
6. Ticketing: a hosted helpdesk or a self-built Ticket store? (architecture; options in `addendum.md` §C)
7. WhatsApp: a personal number, or a WhatsApp Business number shared with a future team?
8. Which Locale order to ship in? The nine can ship in waves.
9. API pricing: the price per key or per calculation above the free limit, and the free limit itself.

## 11. Assumptions Index

- §4.1 FR-4: a count stepper on relationship buttons is acceptable UI.
- §4.2 FR-5: the resume/start-over prompt stays only for a returning guest with an unsaved Case.
- §4.4 FR-10: the Basis is chosen at the start, can be changed later, and the default stays "compare all four Schools".
- §4.6 FR-20: Chinese uses Simplified script.
- §4.8 FR-27: spam protection without a third-party tracking captcha.
- §4.8 FR-30: closed Tickets are kept for 12 months.
- §7: completion and reach metrics need new cookie-free server-side event counts.
- §4.9 FR-31: names in API requests are optional and dropped after the response.
- §4.9 FR-33: the MCP server uses the standard remote transport, so hosted assistants connect by URL.
- §4.9 FR-34: prefilled Case links expire after 7 days.
- §4.9 FR-35: the free tier is keyless, with per-IP limits.
- §4.9 FR-36: billing for API keys is manual (invoice from monthly usage); no in-app payment.
- §7 SM-6: target of 100 API/MCP calculations a week within 90 days.
