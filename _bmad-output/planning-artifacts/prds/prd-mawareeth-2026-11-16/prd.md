---
title: 'Mawareeth phase 2 PRD'
status: final
created: '2026-11-16'
updated: '2026-11-16'
---

# PRD: Mawareeth phase 2 — easier for families, right for their country, in their language

## 0. Document Purpose

This PRD defines phase 2 of Mawareeth, which follows the phase-1 release of 2026-11-13 (PR #105). It is written for the product owner and for the downstream workflows that will turn it into UX changes, architecture decisions, epics and stories.

How to read it:
- Features are grouped in §4, with globally numbered requirements (FR-1 to FR-45) nested under them.
- Domain words are defined once in §3 and used exactly.
- Inferences awaiting confirmation are tagged `[ASSUMPTION]` and indexed in §12.
- §6 sets the delivery waves.

"Phase 2" here means the work after the 2026-11-13 release. It is not the "Phase 2" of the archived phase-1 PRD, which is what shipped.

Phase 2 also changes the product's voice. The phase-1 PRD described a "scholarly-validated Source of Truth". Phase 2 positions Mawareeth as a careful, transparent *calculation aid*: it shows its sources, labels what is not yet reviewed, and refers families to a qualified scholar, lawyer or court for a ruling. This is deliberate. The review model for this phase is owner-only (§10).

It builds on:
- the country-law research: `_bmad-output/planning-artifacts/research/domain-islamic-inheritance-country-laws-2026-11-16/research.md`
- the Lebanon research: `_bmad-output/planning-artifacts/research/domain-lebanon-sunni-inheritance-law-2026-11-16/research.md`
- the archived phase-1 PRD: `_bmad-output/archive/phase-1/planning-artifacts/prd.md`
- open items in `_bmad-output/implementation-artifacts/deferred-work.md`
- the owner's two deep-research reports (Saudi monetisation; international markets)
- the input digest, review and reconciliation files in this folder

Technical options and rule-setting detail live in `addendum.md`.

## 1. Vision

Mawareeth already does the hard part: it calculates Islamic inheritance exactly, across the four Sunni schools and through successive deaths, and explains every share. Phase 2 makes that power easy to reach for the people who need it most: families sorting out an estate, often for the first time, often grieving, often on a phone.

Phase 2 has four aims:
- **Fewer steps.** Building the family takes a press or a drag, not a form per relative. A family edits the Family tree where they see it, and returns to a named case without detours.
- **Right for the country.** A family in Cairo, Amman, Casablanca, Dubai, Riyadh, Algiers or Beirut can calculate under their country's inheritance law as well as under a School. That includes the Obligatory bequest for grandchildren whose parent died first. Most Arab statutes add this rule, and no School calculation shows it.
- **In their language.** Mawareeth speaks to Muslim communities in Urdu, Hindi, Turkish, Indonesian, Malay, German, Spanish, Italian and Chinese, as well as Arabic, English and French. A real person answers when a family is stuck.
- **Reachable from AI assistants.** When a family asks an AI assistant who inherits what, the assistant can call the real Mawareeth engine instead of guessing, and hand the family a link to the same Case.

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
- Shia (Ja'fari) families. The engine does not support the Ja'fari school yet; it is deferred to a later phase.
- People needing will drafting, probate filing, tax or asset-valuation advice.
- Court clerks, as a distinct persona with a court-format output (phase-1 FR-08). Deferred.

### 2.3 Key User Journeys

- **UJ-1. Mona settles her father's estate under Egyptian law.**
  - **Persona and context:** Mona, 41, in Cairo. Her father died; her brother Karim died two years before him and left two children. Her aunt says Karim's children get nothing, her cousin says they do.
  - **Entry state:** guest, on a phone, Arabic UI, coming from a search.
  - **Path:**
    1. She opens the Interview and enters the Deceased (her father) and the estate. There is no Basis step.
    2. She taps *Wife*, *Daughter*, *Son* to add her mother, herself and her brother Hassan.
    3. She adds Karim as a son who died before the Deceased, then drags *Son* and *Daughter* onto his node to add his two children.
    4. The Share preview shows "Same result in all four Sunni schools", with a prompt: Karim died before the Deceased and left children, and some countries' laws give them an Obligatory bequest (FR-14). She taps it and chooses "Law of Egypt".
  - **Climax:** the Share preview shows an "Obligatory bequest" line for Karim's children, capped at a third, with "Egyptian Wills Law 71/1946, art. 76" beneath it. Her mother, Hassan and Mona share the rest. A Beta label says the Egypt preset is not yet scholar-reviewed.
  - **Resolution:** she taps the prominent *Full results* button, downloads the draft PDF and sends it on WhatsApp.
  - **Edge case:** if she ignores the prompt, the result stays under the four Schools and the prompt remains in the Share preview and Full results.

- **UJ-2. Yusuf builds a big family in minutes and fixes a slip on the tree.**
  - **Persona and context:** Yusuf, 55, in Amman, eldest son, entering his mother's estate. Eleven surviving relatives.
  - **Entry state:** registered user, desktop, Arabic UI.
  - **Path:**
    1. He adds relatives by pressing relationship buttons, with no name typing, and drags a relationship chip onto the tree for his nephews.
    2. He spots a sister he added as a half-sister.
    3. He opens her node on the Family tree, changes the relationship, and deletes a duplicate brother from his node. He undoes one delete he regrets.
  - **Climax:** the Share preview updates after each change, and the Family tree and the shares always match.
  - **Resolution:** he saves the Case and names it "Mother's estate, 2026".

- **UJ-3. Yusuf comes back three days later.**
  - **Entry state:** registered user, any device.
  - **Path:** *My cases* lists "Mother's estate, 2026". He opens it.
  - **Climax:** the Case opens straight into the Interview with his family loaded. There is no "Start an inheritance case / resume or start over" screen.
  - **Resolution:** he renames it "Mother's estate (final)".

- **UJ-4. Bilal reads his result in Urdu.**
  - **Persona and context:** Bilal, 34, in Birmingham. He reads Urdu more comfortably than English or Arabic, and his uncle died in Birmingham.
  - **Path:** he switches the Locale to اردو. The page turns right-to-left. Relationship names appear in Urdu with the Arabic term beside them, and a Beta label on the results says the translation is not yet reviewed.
  - **Climax:** the results read naturally. When the Schools agree, there is no "Calculated under the Hanbali school" line, only "Same result in all four Sunni schools". A notice says that UK law may decide what forms the estate.
  - **Resolution:** he downloads the PDF in Urdu.

- **UJ-5. Huda asks for help and gets an answer.**
  - **Persona and context:** Huda, in Algiers, is confused why her late husband's nephew inherits.
  - **Path:** she taps *Contact us*, picks "Question about my result", writes her question and gives her email. She does not have to attach the Case.
  - **Climax:** she gets an email with a Ticket number, and later the owner's reply, in the same thread.
  - **Resolution:** she can also tap *WhatsApp* to message the support number directly.

- **UJ-6. Maître Benali checks a Moroccan case.** *(secondary)*
  - **Persona and context:** a notary's clerk in Casablanca, French UI.
  - **Path:** they enter the family, choose "Loi marocaine (Code de la famille 2004)" from the "Calculate under a country's law" link, and open the proof.
  - **Climax:** every share cites its article, for example the Obligatory bequest articles. A notice says that a reform of the Family Code is pending.
  - **Resolution:** they save the Case under a client name and share it by private link.

- **UJ-7. Salma asks her assistant, and the assistant asks Mawareeth.**
  - **Persona and context:** Salma, 29, in Kuala Lumpur, asks an AI assistant in English: "My grandmother died, leaving my grandfather, my mother and two uncles. Who gets what?"
  - **Path:** the assistant, connected to the Mawareeth MCP server, looks up the relationship codes, then calls `calculate_inheritance` with the family and "compare all four Schools". Because "uncles" could mean the grandmother's sons or her brothers, the tool asks the assistant to clarify, and the assistant asks Salma.
  - **Climax:** the assistant answers with Mawareeth's exact fractions, says the four Schools agree, quotes the "calculation aid, not a fatwa" notice, and gives an "Open this case on Mawareeth" link.
  - **Resolution:** Salma opens the link. The Interview is prefilled with that family, and she downloads the draft PDF.
  - **Edge case:** if the family needs a rule Mawareeth refuses (for example the Ja'fari school), the tool returns the refusal and its reason, and no numbers.

## 3. Glossary

- **Case:** one Deceased, their estate and their Heirs, as entered in the Interview. A guest's Case lives for 24 hours after the last change. A registered user's Case can become a Saved case. A Case holds up to 50 Heirs and up to two later deaths.
- **Saved case:** a Case stored on a registered user's account, with a Case name.
- **Case name:** a user-editable label for a Saved case. It replaces the case reference in the UI.
- **Deceased:** the person whose estate is divided. A Case can contain later deaths (successive deaths).
- **Heir:** a relative of the Deceased entered in a Case, with a relationship and an optional name. An Heir can be marked as having died before the Deceased, to carry their descendants for an Obligatory bequest.
- **Interview:** the guided screens where the user enters the Deceased, estate and Heirs.
- **Family tree:** the visual diagram of the Deceased and Heirs in the Interview. Heirs can be added, edited and deleted from it.
- **Share preview:** the live share table for the Interview, opened from its summary bar.
- **Full results:** the results page with shares, proof, PDF, save and share.
- **School:** one of the four Sunni schools of Islamic law: Hanafi, Maliki, Shafi'i, Hanbali.
- **Country law:** the inheritance rules of one country's statute.
- **Basis:** what a Case is calculated under. It is one of three: "compare all four Schools" (the default; the user picks a School only when the Schools differ), one School, or one Country law.
- **Country preset:** the versioned data that defines one Country law for the engine: statute citation, version date, rule settings, default School for gaps, and a citation per rule.
- **Obligatory bequest:** a share that a Country law gives to grandchildren whose parent died before (or with) the Deceased. It is capped at one third and taken out before the Heirs share the rest. Also called *wasiyya wajiba* or *tanzil*.
- **Beta label:** a visible notice that a Country preset or a Locale has not yet been reviewed by a qualified scholar or native translator.
- **Locale:** a UI language, such as ar, en, fr or ur.
- **Ticket:** a support request created from the Contact form, with a number and an email thread.
- **API key:** a credential that gives one heavy API user a higher quota than the free limit.

## 4. Features

### 4.1 Faster family entry and an editable Family tree

**Description:** today an Heir is added by choosing a relationship, typing a name and pressing save. Phase 2 makes adding an Heir one action, and lets the user edit the family where they see it: on the Family tree. Names become optional; the system gives a default label ("Son 2") that the user can change later. Realises UJ-1 and UJ-2.

#### FR-1: One-press Heir add
A user can add an Heir by pressing one relationship button. Realises UJ-2.

**Consequences (testable):**
- Pressing a relationship button adds an Heir of that relationship to the Case and the Family tree, with no further input.
- The new Heir gets a default label in the current Locale ("Son 1", "Son 2"), editable later.
- Relationships the engine says cannot apply (for example a second father) are not offered, as today.
- The Share preview updates after each add.
- Adding stops at the 50-Heir Case limit with a message saying so.

#### FR-2: Drag-and-drop onto the Family tree
A user can drag a relationship onto the Family tree, onto the Deceased or onto an Heir, to add a relative in that position. Realises UJ-1 and UJ-2.

**Consequences (testable):**
- Dropping "Son" on a son marked as having died before the Deceased adds that son's child (a grandchild) in the right line.
- Every drag action has a keyboard and screen-reader equivalent that reaches the same result.
- On touch screens, a tap on a node opens "Add relative here", so dragging is never required. Press-and-hold drag works but is optional.
- A drop that would create an impossible family is refused with a message, and the tree is unchanged.

#### FR-3: Edit and delete Heirs from the Family tree
A user can select an Heir on the Family tree and change their name or relationship, mark them as having died before the Deceased, or delete them. Realises UJ-2.

**Consequences (testable):**
- Selecting a node opens an edit panel (desktop) or bottom sheet (mobile) with name, relationship, "died before the Deceased" and delete.
- Deleting an Heir who has descendants in the Case, or who is linked into a later death, asks for confirmation and states exactly what else is removed.
- The Heirs list, the Family tree and the Share preview show the same family after any edit.

#### FR-4: Bulk count
A user can add several Heirs of the same relationship at once (for example "4 daughters"). Realises UJ-2.

**Consequences (testable):**
- Entering a count adds that many Heirs with default labels, up to the 50-Heir Case limit.
- [ASSUMPTION: a count stepper on each relationship button is acceptable UI; the UX pass may choose another form.]

#### FR-5: Undo
A user can undo adds, edits and deletes in the Interview, one change at a time, back through the changes made since the page was opened. Realises UJ-2.

**Consequences (testable):**
- An "Undo" control appears for at least 10 seconds after each change and restores the previous family exactly.
- Each further Undo walks back one more change. The history covers the current page visit only and is cleared on reload (architecture AD-20).
- Undo works by keyboard and screen reader.

#### FR-6: Relationships the new rules need
The relationship list covers every relative that the Obligatory bequest and the Country presets' distant-kin rules can reach.

**Consequences (testable):**
- The list includes at least: a predeceased child marker; grandchildren through a son, at any depth; grandchildren through a daughter (first degree); and the maternal grandfather. It also includes the distant-kin classes used by the Country presets in addendum §A.
- Each new relationship has labels in every Locale and a test under each School and Country preset that uses it.

**Feature-specific NFRs:**
- The Family tree keeps the Deceased visible for families of up to 50 Heirs at 375px and 1280px widths (deferred-work: tree overflow).
- Arrow-key navigation between tree nodes (deferred-work: tree keyboard access).

### 4.2 Saved cases that open directly, with names

**Description:** today, opening a Saved case shows the "Start an inheritance case" screen with "resume or start over". Phase 2 opens the Case straight into the Interview, and lets the user name and rename cases. Realises UJ-3.

#### FR-7: Open a Saved case directly
A registered user can open a Saved case from *My cases* straight into the Interview, with its family loaded. Realises UJ-3.

**Consequences (testable):**
- No "resume or start over" prompt appears when opening a Saved case.
- Starting a new Case is a separate, explicit action in *My cases*.
- [ASSUMPTION: the resume/start-over prompt stays only for a guest returning to an unsaved Case within 24 hours.]

#### FR-8: Case names
A registered user can name a Saved case and rename it at any time. Realises UJ-3 and UJ-6.

**Consequences (testable):**
- Saving prompts for a Case name, prefilled with a suggestion: "Estate of {Deceased name or label}, {date}".
- *My cases* lists and sorts by Case name and last change; the case reference is no longer the main label.
- A Case name accepts any Locale's script, up to 100 characters.

#### FR-9: Existing cases at release
Saved cases from before phase 2, including migrated legacy cases, keep working.

**Consequences (testable):**
- Each existing Saved case gets the default Case name from FR-8, using its save date.
- Each gets the Basis it was saved with: its School, or "compare all four Schools". None gets a Country law.
- Guest Cases in progress at release keep working until they expire.

### 4.3 Clearer results

**Description:** results should be easy to reach, should not mention a School when the School makes no difference, and should state what the user supplied. Realises UJ-1 and UJ-4.

#### FR-10: School line only when it matters
The system names the School or Country law behind a result only when it changes the shares, or when the user chose a Country law. Realises UJ-4.

**Consequences (testable):**
- When all four Schools agree, the Share preview and Full results show "Same result in all four Sunni schools" and no "Calculated under the {school} school" line.
- When Schools differ, the user's chosen School is named.
- Under a Country law, the Country preset name and version date are always shown.

#### FR-11: Prominent Full results
The user can reach Full results from the Share preview through a primary button, not a text link under the table. Realises UJ-1.

**Consequences (testable):**
- The button is visible without scrolling on a 375px screen once the Share preview has shares.
- It meets WCAG 2.1 AA target size and contrast.

#### FR-12: Estate guidance and what the user supplied
The system explains what "estate to divide" means before the user enters an amount, and the results say which facts the user supplied.

**Consequences (testable):**
- The estate hint states that debts, funeral costs and bequests come out first, and that jointly owned or beneficiary-designated assets may not form part of the estate.
- The PDF states that the estate amount and the family were supplied by the user and not verified by Mawareeth.

#### FR-13: Money rounding
Amounts are rounded consistently and always add up to the estate.

**Consequences (testable):**
- Each amount is rounded to the currency's minor unit. Any rounding remainder is shown as a separate "rounding" line, so the amounts sum exactly to the estate.
- Exact fractions are never rounded.

#### FR-14: Warn when a School misses a statute rule
When the Basis is a School or "compare all four Schools", and the family has an Heir marked as having died before the Deceased with descendants, the system says that some countries' laws give those descendants an Obligatory bequest, and offers to change the Basis. Realises UJ-1.

**Consequences (testable):**
- The warning appears in the Share preview and Full results, and lists the live Country presets that would give an Obligatory bequest for this family.
- Choosing one recalculates under that Country law.

### 4.4 Country law

**Description:** a user can calculate under a Country law instead of a School. Phase 2 plans seven Country presets:
- Saudi Arabia: Personal Status Law, 2022
- UAE: Federal Decree-Law 41/2024
- Egypt: Laws 77/1943 and 71/1946
- Jordan: Personal Status Law 15/2019
- Morocco: Family Code 70-03, 2004
- Algeria: Family Code
- Lebanon: Sunni courts, Hanafi rules

The engine gains one shared Obligatory bequest step and a few rule switches. Each Country preset is versioned data, not a separate engine. A Country preset goes live only when every rule in it has an article the owner has checked against the official text (FR-22). Realises UJ-1 and UJ-6. Rule detail per country is in `addendum.md` §A.

#### FR-15: Change the Basis
Every Case starts on "compare all four Schools". There is no Basis step in the Interview. A user changes the Basis only from the Share preview or Full results. Realises UJ-1 and UJ-6.

**Consequences (testable):**
- When the four Schools give different shares, the user is asked to choose a School, as today. When they agree, no School question appears.
- A quiet "Calculate under a country's law" link in the Share preview and Full results lists the live Country presets in the current Locale. Only presets that have passed FR-22 appear.
- The FR-14 prompt offers the same choice when a Country law would change this family's shares.
- The user can return to "compare all four Schools" at any time. Changing the Basis recalculates the Share preview.

#### FR-16: Obligatory bequest
Under a Country law that has one, the engine gives an Obligatory bequest to the qualifying descendants of an Heir who died before or with the Deceased. Realises UJ-1.

**Consequences (testable):**
- The qualifying lines, depth, one-third cap, lifetime-gift offset and split between descendants follow the Country preset settings (`addendum.md` §A).
- The bequest is taken out before the Heirs share the rest. The Share preview and Full results show it as its own line, with its article citation.
- The Dar al-Ifta worked example (fatwa 8330) and the Moroccan commentary example (49/960) pass as automated tests.
- Under a School Basis, no Obligatory bequest is applied (FR-14 warns instead).

#### FR-17: Rule switches per Country preset
The engine applies each Country preset's settings for leftover estate (*radd*), distant kin, grandfather with siblings, the special cases (mushtaraka, akdariyya), and its default School for gaps.

**Consequences (testable):**
- Each Country preset has at least one passing test case per setting that differs from its default school.
- The research examples (for example Saudi Arabia: the grandfather excludes siblings, and the mushtaraka is not shared) pass as tests.
- Each preset names a concrete default School for gaps. Saudi Arabia uses Hanbali (owner decision, 2026-11-16). The UAE and Algeria use Maliki `[ASSUMPTION: to confirm]`, because their statutes refer only to "Islamic Sharia".

#### FR-18: Statute citations in proof and PDF
For each share under a Country law, the proof and the PDF cite the statute and article. Realises UJ-6.

**Consequences (testable):**
- Every proof step under a Country law cites either an article of the Country preset, or "default School for gaps: {school}" when the statute is silent.
- The PDF header names the Country preset and its version date.

#### FR-19: Versioned Country presets
A Saved case, a share link and a PDF store the Basis and the Country preset version they were calculated with.

**Consequences (testable):**
- Opening a Saved case after its Country preset changes shows the stored version and offers to recalculate under the current one. Nothing recalculates silently.
- A shared link is a live view of its Saved case: it shows the Case's current family and its pinned Country preset version, and says when a newer version exists. The pinned version changes only when the owner explicitly switches (architecture AD-18).

#### FR-20: Beta label on unreviewed Country presets
Each live Country preset shows a Beta label until a qualified reviewer signs it off.

**Consequences (testable):**
- The Beta label appears in the country-law list, the Share preview, Full results and the PDF.
- Removing the label is a data change recorded with the reviewer's name and date.

#### FR-21: Unsupported situations under a Country law
When a family needs a rule the Country preset does not cover, the system says so instead of showing a number.

**Consequences (testable):**
- The refusal names the reason in the current Locale, as the engine already does for the Ja'fari school and the Malikiyya case.
- Under the Lebanon preset, the Interview asks whether the Deceased was Sunni. If the answer is Shia, the system refuses and explains that Ja'fari courts apply rules Mawareeth does not yet support. If the answer is another religion, it explains that the 1959 law for non-Muslims applies.

#### FR-22: Go-live gate for Country presets
A Country preset becomes selectable in production only when the owner has checked every rule in it against the official statute text.

**Consequences (testable):**
- Each rule in a Country preset records its article and a "checked against official text" date. A preset with any unchecked rule is hidden in production and visible only in test environments.
- Known open points block go-live until resolved (§11): Jordan's numbering, the UAE mushtaraka and grandfather articles, the Algerian daughters' line, and Egypt's art. 76 generation limits.

**Notes:**
- Lebanon (Sunni): the 1962 Sharia courts law (art. 242, as amended in 2011) applies Supreme Sunni Islamic Council decisions, then the 1917 Ottoman Family Rights Law, then the preferred Hanafi opinion. No Obligatory bequest was found, so the preset is Hanafi with every switch off.

### 4.5 Country localisation

**Description:** the experience adapts to the user's country: money, numbers and notices. Realises UJ-1, UJ-4 and UJ-6.

#### FR-23: Currency
A user can choose the estate currency. It defaults from the Country law, or else from the Locale.

**Consequences (testable):**
- Amounts show in the chosen currency's symbol and minor-unit rules in the Share preview, Full results and PDF, rounded per FR-13.

#### FR-24: Number and date formats
Numbers and dates follow the Locale's conventions, for example Arabic-Indic digits where the Locale uses them.

**Consequences (testable):**
- Fractions, percentages and amounts render per Locale in screen and PDF, identically in both, including in right-to-left Locales.

#### FR-25: Country notices
Each Country law carries a short notice in every Locale.

**Consequences (testable):**
- The notice shows on Full results and in the PDF under that Country law. Examples:
  - **Morocco:** "Family Code of 2004; a reform is pending."
  - **Egypt:** "A constitutional challenge to the bequest article has been reported."
  - **UAE:** "Non-Muslims may follow a separate civil law."
  - **Lebanon:** "Lebanese Sunni courts apply Hanafi rules; Shia families follow Ja'fari courts; changing sect changes the applicable law."

#### FR-26: Civil-law notice outside the preset countries
When the Basis is a School, the results carry, in every Locale, a notice that local civil law may decide what forms the estate and who may claim, and that a local lawyer should confirm. Realises UJ-4.

**Consequences (testable):**
- The notice appears on Full results and in the PDF in those Locales, and does not appear under a Country law.

### 4.6 New languages

**Description:** Mawareeth adds nine Locales: Urdu, Hindi, Turkish, Indonesian, Malay, German, Spanish, Italian and Chinese, alongside Arabic, English and French. AI drafts the translations and the owner reviews them. Each new Locale carries a Beta label until a native speaker reviews it. Realises UJ-4.

#### FR-27: Nine new Locales
A user can use the whole product in each new Locale: the Interview, results, proof, PDF, account pages, emails and public pages.

**Consequences (testable):**
- Every UI string, email, PDF label and server-side message has a non-empty value in every Locale. A CI check fails on missing or empty keys, in both the web app and the Django translation files.
- Urdu renders right-to-left in screen and PDF, like Arabic, including fractions and digits.
- Chinese uses Simplified script `[ASSUMPTION]`.

#### FR-28: Fiqh terms shown with the Arabic original
Fiqh terms (relationship names, Obligatory bequest, *radd*, School names) use one agreed translation per Locale. Relationship names in a non-Arabic Locale also show the Arabic term beside them.

**Consequences (testable):**
- A per-Locale term list exists, and every UI and PDF string uses it.
- In Full results and the PDF, each relationship shows "{translated term} ({Arabic term})".

#### FR-29: Beta label on new Locales
An unreviewed Locale shows a Beta label: "This translation has not yet been reviewed by a native speaker".

**Consequences (testable):**
- The label appears on Full results, in the footer and on the PDF for that Locale.

#### FR-30: Discoverable languages
Public pages exist in every Locale and can be found.

**Consequences (testable):**
- Each public page has `hreflang` links for every Locale and appears in the sitemap per Locale.
- The language switcher lists each language in its own script.

### 4.7 Content review

**Description:** fix wrong or outdated content, and work through the review backlog of Arabic, French and fiqh wording. The owner reviews; content that still needs outside review stays marked.

#### FR-31: Accurate legal pages
The terms and privacy pages match the product.

**Consequences (testable):**
- The terms no longer claim "all intellectual property rights reserved" or forbid redistribution; they state the AGPL-3.0 licence.
- The privacy page drops the advertising-partner text and covers accounts, sharing, email, WhatsApp, support Tickets, API use, retention, and the rights of the families whose data is entered.
- Typos ("webste") are fixed in every Locale.

#### FR-32: Arabic and French copy pass
The owner reviews and corrects every Arabic and French string that deferred-work lists as unreviewed.

**Consequences (testable):**
- Each listed string is either corrected or confirmed, and recorded as "owner-reviewed" with a date.
- The French Interview is tested end to end, with an automated browser test like the Arabic and English ones.

#### FR-33: Fiqh wording pass
The owner reviews the proof texts, refusal sentences and kinship labels that deferred-work lists, for accuracy and plain language.

**Consequences (testable):**
- Each listed item is corrected or confirmed, and recorded as "owner-reviewed".
- Items that deferred-work says need a qualified scholar stay recorded as "awaiting scholar review". They are not marked reviewed by the owner.
- The proof explains a shared fixed share (for example, two wives share 1/8, so 1/16 each).
- Public pages say plainly that the Ja'fari school is not supported yet.

### 4.8 Contact and support

**Description:** a family can ask for help and get a tracked answer, by form or WhatsApp. Realises UJ-5.

#### FR-34: Contact form creates a Ticket
Any visitor can send a question through a Contact form, which creates a Ticket and emails them its number. Realises UJ-5.

**Consequences (testable):**
- The form asks for a topic (including "API access"), a message, an email and, optionally, a link to their Case. It never requires case data.
- The visitor receives an email with the Ticket number in the current Locale.
- The form is protected against spam without a third-party tracking captcha `[ASSUMPTION]`.

#### FR-35: Ticket replies by email
The owner can answer a Ticket, and the visitor sees the whole exchange in one email thread.

**Consequences (testable):**
- Replies from the owner reach the visitor, and the visitor's email replies attach to the same Ticket.
- The owner can see open and closed Tickets in one place, with their first-reply time.

#### FR-36: WhatsApp click-to-chat
A *WhatsApp* link on the Contact page and in the footer opens a chat with the support number.

**Consequences (testable):**
- The link opens WhatsApp (app or web) with the support number and a greeting prefilled in the current Locale.

#### FR-37: Support data retention
Ticket data is kept only as long as needed and is deletable on request.

**Consequences (testable):**
- Closed Tickets are deleted after a set period [ASSUMPTION: 12 months], and the privacy page states it.
- A visitor can ask for their Ticket to be deleted, and it is deleted within 30 days.

### 4.9 AI tools can use Mawareeth

**Description:** families increasingly ask ChatGPT, Claude, Gemini or another assistant "who inherits what". Those assistants often guess the shares, and they get hard cases wrong. Phase 2 lets any AI assistant call the real Mawareeth engine. It does this through a public calculation API and an MCP server (the Model Context Protocol, the standard way assistants call outside tools). The assistant sends a family and a Basis, and gets back exact shares, the proof and the disclaimer, with a link to open the same Case on Mawareeth. Realises UJ-7.

#### FR-38: Public calculation API
Any client can send a family, an optional estate amount and a Basis, and receive the calculation. No account is needed. Realises UJ-7.

**Consequences (testable):**
- The family is described only with the relationship codes from FR-39. A request with an unknown or ambiguous relationship is rejected with a message that lists the possible codes.
- For each Heir, the response gives an exact fraction, a percentage, an amount if an estate was given, and a no-share or blocked status. It also gives the proof steps, any School difference, the Basis with its Country preset version, the Beta label state, and the disclaimer text.
- Refusals (unsupported school, Malikiyya, impossible family) come back as structured reasons, never as numbers.
- The API stores no Case and logs no names [ASSUMPTION: names are optional in the request and dropped after the response].
- The same input gives the same output as the web app for the same engine and preset version (NFR-2).

#### FR-39: Published API description
The API is described in a public OpenAPI document. Every relationship, School and live Country preset is listed with its code and its names in each Locale.

**Consequences (testable):**
- A CI check fails if the OpenAPI document and the engine's relationship or preset list disagree.
- An "API" page in the footer links to the document, the MCP setup and the usage terms.

#### FR-40: MCP server
An AI assistant can connect to a Mawareeth MCP server and use its tools: `calculate_inheritance`, `list_relationships` and `list_bases`. Realises UJ-7.

**Consequences (testable):**
- The tools return the same content as FR-38, written so an assistant can relay it faithfully: fractions as text and numbers, the disclaimer, and the Case link.
- The tool descriptions tell the assistant to look up relationship codes first, to ask the user when a relative is ambiguous, to show the disclaimer, and not to round or restate shares as rulings.
- The server works over the standard remote MCP transport `[ASSUMPTION]`, so hosted assistants can connect with a URL.

#### FR-41: Open the same Case on Mawareeth
Each API and MCP result includes a link that opens the Interview prefilled with that family and Basis. Realises UJ-7.

**Consequences (testable):**
- The family is stored on the server behind a random, single-purpose token. The link carries only the token; no family data appears in the URL.
- The stored family is deleted when the token expires [ASSUMPTION: 7 days] or when the link is first opened and a guest Case is created, whichever comes first.

#### FR-42: Fair use
Anyone may use the API and MCP server without a key, within a free limit. This includes commercial apps.

**Consequences (testable):**
- Requests over the free limit get a clear "too many requests" response with a retry time and instructions to request an API key.
- The free limit is per IP address `[ASSUMPTION]`.

#### FR-43: Billable API keys for heavy users
A heavy user, such as a law firm or a commercial app above the free limit, can request an API key by opening a Ticket with the topic "API access". The owner can issue a billable key with a higher limit.

**Consequences (testable):**
- Requests carrying a valid key are limited by that key's quota, not by the free limit.
- The owner can issue, change the quota of, and revoke a key, and see each key's monthly usage.
- Revoking a key stops its requests at once and returns them to the free limit.
- The usage terms on the API page say: free within the limit, a paid key above it, and the disclaimer and attribution must be shown.
- [ASSUMPTION: in phase 2 billing is manual. The owner invoices from the monthly usage, and there is no in-app payment.]

**Feature-specific NFRs:**
- p95 response time under 1 s for families of up to 50 Heirs. The calculation itself runs in memory and writes nothing to the database. The only writes per request are the fair-use and usage counters (FR-42, FR-43) and, when requested, the prefill token (FR-41) (architecture AD-22, AD-23).
- The API returns text in any supported Locale on request.

### 4.10 Measurement

**Description:** phase 2's success metrics (§8) need counts that today's page-view analytics cannot give.

#### FR-44: Cookie-free event counts
The system counts product events on the server without cookies or personal data.

**Consequences (testable):**
- Counted events: Case started, first Share preview with shares, Full results opened, PDF downloaded, Case saved, Basis chosen (by type and preset), Locale used, Ticket opened and first reply, API and MCP calls, and prefilled links opened.
- Counts are aggregated per day, Locale and country (from the request, not stored per person), and visible to the owner.

#### FR-45: Moderated test protocol
The owner can run a repeatable usability test for SM-1.

**Consequences (testable):**
- A written five-Heir test family and task script exist in Arabic and English, with a way to record the number of actions and time per participant.

## 5. Non-Goals (Explicit)

- Mawareeth will not sell reviewed calculations in phase 2. That is the private marketplace project. Paid API keys (FR-43) buy quota, not review.
- No Ja'fari (Shia) school, and no Lebanese Shia or non-Muslim rules.
- No will drafting, probate filing, estate valuation, tax or legal advice. No statement of "what the law means for your estate"; Mawareeth shows the calculation and its sources.
- No Country presets beyond the seven listed. Kuwait waits for its reform; Iraq needs Ja'fari. Pakistan, Turkey, Indonesia and Malaysia get a Locale, not a Country preset.
- No native mobile apps; the web app stays responsive.
- No AI inside the app: no chat-style case entry, no AI explainer of results, no AI-search optimisation work. Phase 2 only lets outside AI assistants call the engine (§4.9).
- No paid translation or scholar review this phase. Beta labels make that visible instead.

## 6. Scope and Waves

### 6.1 Waves

Phase 2 ships in four waves. Each wave is releasable on its own.

| Wave | Contents | FRs |
|---|---|---|
| 1. Easier and correct | Faster entry, editable tree, undo, named cases, existing-case defaults, results clarity, rounding, legal pages, copy and fiqh passes, contact and support, measurement | FR-1 to FR-5, FR-7 to FR-13, FR-31 to FR-37, FR-44, FR-45 |
| 2. Country law, first presets | New relationships, School warning, Basis change, Obligatory bequest, rule switches, citations, versioning, Beta labels, refusals, go-live gate; Saudi Arabia, Egypt, Morocco, Lebanon; currency, number formats, notices | FR-6, FR-14 to FR-26 |
| 3. More countries and first languages | Jordan, UAE, Algeria presets (each after FR-22); Urdu, Hindi, Indonesian, Malay, Turkish | FR-27 to FR-30 (first five Locales) |
| 4. More languages and AI access | German, Spanish, Italian, Chinese; public API, MCP server, prefilled links, fair use, API keys | FR-27 to FR-30 (remaining Locales), FR-38 to FR-43 |

### 6.2 Out of scope for phase 2

- Ja'fari school (deferred: a whole second rule set).
- Other Indian languages such as Bengali, Tamil and Malayalam; Hindi first, others later.
- Outside scholar or translator review (deferred; the Beta label covers the gap). `[NOTE FOR PM]` This is the biggest trust risk in the phase. Revisit if any Country preset is used for a court filing.
- Shares shown on Family tree nodes (deferred-work item; candidate if time allows).
- A professional-grade PDF: assumptions sheet, death-by-death carry-forward ledger, matter reference (from the deep-research reports). Deferred; candidate for phase 3 or the marketplace.
- The layered successive-death proof and side-by-side manasikhat table (deferred-work 3.1b and 3.1c).
- Keeping guest Cases in the browser instead of the server database before an explicit save, and anonymisation (phase-1 FR-18/19). Deferred; NFR-4 still applies.
- A public `/version` page. The release commit is already exposed at `/health/release/`.

## 7. Phase-1 commitments carried or dropped

- **Carried:** proofs and refusals; the guided Interview with a live preview; the draft PDF; WCAG 2.1 AA; determinism and versioning (NFR-2).
- **Changed:** the performance target. Phase 1 set 200 ms for a standard calculation. Phase 2 sets p95 under 1 s end to end on a phone over 4G (NFR-3), which includes the network. The engine target of 200 ms stays.
- **Deferred:**
  - the court-clerk persona and the Lebanese court-format PDF (phase-1 FR-08)
  - kinship graphs in the PDF (FR-09)
  - the "Preliminary / Verified" watermark (FR-10)
  - the 1,000-case scholarly test suite
  - council endorsement
  - SDKs, self-hosting kits, and a contributor licence agreement

## 8. Success Metrics

Measured with FR-44 counts over the 90 days after each wave ships, against the 90 days before where a baseline exists.

**Primary**
- **SM-1: Steps per family.** Actions to enter a five-Heir family fall from about 15 (3 per Heir) to 5 or fewer. A typical family Case takes under 3 minutes in the FR-45 test with at least 5 participants. Validates FR-1 to FR-5.
- **SM-2: Completion.** The share of started Cases that reach a Share preview with shares rises by 20% relative. Validates FR-1 to FR-13.

**Secondary**
- **SM-3: Country reach.** At least 15% of Cases from a live preset's country use its Country law. Validates FR-14 to FR-26.
- **SM-4: Language reach.** Each new Locale has at least one Case reaching a Share preview per week within 90 days of its wave. Validates FR-27 to FR-30.
- **SM-5: Support responsiveness.** 90% of Tickets get a first reply within 2 business days. Validates FR-34 to FR-36.
- **SM-6: AI reach.** API and MCP calculations per week, and Cases opened from FR-41 links. Target: 100 calculations a week within 90 days of wave 4 `[ASSUMPTION]`. Validates FR-38 to FR-43.

**Counter-metrics (do not optimise)**
- **SM-C1: Calculation accuracy.** Any engine defect found in a Country preset counts against SM-3. Never relax a rule to "make a result appear". Counterbalances SM-2 and SM-3.
- **SM-C2: Undo after delete.** The share of tree deletes followed by an Undo (FR-5) must not exceed 10%. A higher rate means deletes are too easy to trigger. Counterbalances SM-1.
- **SM-C3: Data collected.** No new personal data fields to raise completion or support speed. Counterbalances SM-2 and SM-5.
- **SM-C4: Misquoted results.** Do not chase API volume by dropping the disclaimer, the proof or the refusals from tool output to make answers shorter. Counterbalances SM-6.

## 9. Cross-Cutting NFRs

- **NFR-1 Accessibility:** WCAG 2.1 AA in every Locale, including right-to-left (Arabic, Urdu), the Family tree, and keyboard alternatives for every drag action.
- **NFR-2 Determinism:** the same Case, Basis and Country preset version always give the same exact fractions on screen, in the PDF and from the API.
- **NFR-3 Performance:** the Share preview updates within 1 s at the 95th percentile for families of up to 50 Heirs, on a mid-range phone over 4G. This needs the in-memory preview path and bounded lock waits from deferred-work. The engine itself stays under 200 ms for a standard family.
- **NFR-4 Privacy:** no new personal data beyond what the calculation needs. Ticket data is minimised, and Case data never goes into a Ticket automatically. The rules follow GDPR and Saudi PDPL principles, including for data about the Deceased.
- **NFR-5 Licence:** all code stays AGPL-3.0, including API-key handling and metering. No third-party service may make the source offer impossible. Invoicing is done outside the product.

## 10. Constraints and Guardrails

- **Legal standing.** Every result keeps the "calculation aid, not a fatwa or legal advice" notice. Country presets never say "certified" or "court-approved", and never tell a family what the law means for their particular estate.
- **Review model.** AI drafts and the owner reviews; there is no outside sign-off this phase. Beta labels (FR-20, FR-29) are mandatory, and the go-live gate (FR-22) holds every preset until its articles are checked.
- **Law change.** The Morocco reform, the Kuwait overhaul and Egypt's constitutional challenge can change the rules. Re-check by 2027-01; re-check the Lebanon findings by 2027-05 (research staleness maps). Versioning (FR-19) keeps old results explainable.

## 11. Open Questions

1. Lebanon: does any Supreme Sunni Islamic Council decision (for example no. 46 of 2011) change inheritance shares? The research found Hanafi rules with no Obligatory bequest, but this rests on finding no such decision. Also open: who issues the Heirs' certificate (*hasr irth*) for Muslim estates in practice, the Sharia court or the civil single judge.
2. Jordan: confirm the article numbering in Law 15/2019 and the apostate rule in art. 281(c). Blocks go-live (FR-22).
3. UAE: confirm the art. 240 mushtaraka split and the grandfather article. Blocks go-live.
4. Algeria: whether daughters' children qualify for *tanzil* (Supreme Court ruling 932349). Blocks go-live.
5. Egypt: the art. 76 generation limits, and the outcome of the constitutional challenge. Generation limits block go-live.
6. ~~Ticketing: a hosted helpdesk, self-hosted Zammad, or a small Ticket store built into the app?~~ Resolved 2026-11-16 (architecture AD-24): a Ticket store built into the app, with email through Brevo (outbound SMTP, inbound-parse webhook to a per-Ticket reply address).
7. WhatsApp: a personal number, or a WhatsApp Business number shared with a future team?
8. Language order within waves 3 and 4.
9. API pricing: the free limit, and the price per key or per calculation above it.

## 12. Assumptions Index

- §4.1 FR-4: a count stepper on relationship buttons is acceptable UI.
- §4.2 FR-7: the resume/start-over prompt stays only for a returning guest with an unsaved Case.
- §4.4 FR-17: the UAE and Algeria use Maliki as the default School for gaps.
- §4.6 FR-27: Chinese uses Simplified script.
- §4.8 FR-34: spam protection without a third-party tracking captcha.
- §4.8 FR-37: closed Tickets are kept for 12 months.
- §4.9 FR-38: names in API requests are optional and dropped after the response.
- §4.9 FR-40: the MCP server uses the standard remote transport, so hosted assistants connect by URL.
- §4.9 FR-41: prefilled-link tokens expire after 7 days.
- §4.9 FR-42: the free limit is per IP address.
- §4.9 FR-43: billing for API keys is manual (invoice from monthly usage); no in-app payment.
- §8 SM-6: target of 100 API/MCP calculations a week within 90 days of wave 4.
