---
title: 'Domain research: Lebanon Sunni inheritance law'
type: 'domain'
topic: 'Lebanon Sunni inheritance law'
decision: 'Rule settings for the phase-2 Lebanon (Sunni) country preset'
source: 'native run'
status: complete
preset: 'quick'
validation: 'normal'
created: '2026-11-16'
updated: '2026-11-16'
claims_verified: 2
claims_unverified: 2
claims_disputed: 1
---

# Domain research: Lebanon Sunni inheritance law

**Decision this research serves:** the rule settings for the phase-2 Lebanon (Sunni) country preset (PRD open question 1).

## Executive summary

**The Lebanon (Sunni) preset is the Hanafi school, with no obligatory bequest.** Art. 242 of the 1962 Sharia courts law, as amended in 2011, says Sunni judges apply, in order:
1. the decisions of the Supreme Sunni Islamic Council
2. the Ottoman Family Rights Law of 1917
3. "the preferred opinion of the school of Imam Abu Hanifa" [1]

No Council decision or Ottoman provision that changes inheritance shares was found [1][2]. Practice reports match plain Hanafi rules: daughters without a brother share the estate with uncles and other agnates, and some Sunni families convert to Shiism to avoid this [6].

**What that means for the engine:** the Lebanon preset can reuse the existing Hanafi rules with all statute switches off. It does not need the obligatory-bequest step.

**Biggest caveat:** the evidence of absence is thin. The Supreme Sunni Islamic Council decisions (notably no. 46 of 2011) were not found in full, and the obligatory bequest's absence rests on searches, not an express statement. Hence the beta label, plus a check with a Lebanese Sunni court or lawyer before removing it.

## Rules of the game

- **Who decides:** under the 1962 law, Sunni Sharia courts have jurisdiction over proving a death, fixing the heirs, and setting the inheritance shares (art. 17(12–13)) [1].
  - If the heirs belong to different schools, the court of the deceased's school decides (art. 60).
  - The heirs' certificate (*hasr irth*) comes from the court of the deceased's domicile or main real estate (art. 70(3)) [1].
  - **Conflict:** the Ministry of Justice says a civil single judge issues *hasr irth* unless the heirs or shares are contested [5]. A law firm says the certificate states each heir's share [3]. The two routes may coexist; which one applies to a Muslim estate is an open question. Either way, the output is the same: heirs plus their shares.
- **Which rules:** Council decisions first, then the 1917 Ottoman Family Rights Law, then the preferred Hanafi opinion (art. 242 as amended by Law 177/2011) [1]. Musawah's 2022 overview gives the same order [2].
- **Not for Muslims:** the 1959 inheritance law for non-Muslims (equal shares for men and women; amended 1995) applies to non-Muslim communities only [4][7].
- **Shia families:** Ja'fari courts apply the Ja'fari school (art. 242(2)) [1]. Out of scope for phase 2.
- **In practice:** Sunni daughters without a brother share with agnates such as uncles. A Dar al-Fatwa official confirmed in 2007 that some Sunnis convert to Shiism so that their daughters inherit everything [6]. That is consistent with plain Hanafi *ta'sib*, with no statutory change.

## Preset settings

| Setting | Lebanon (Sunni) | Basis | Confidence |
|---|---|---|---|
| Default school for gaps | Hanafi (preferred opinion) | art. 242 [1] | high |
| Obligatory bequest | none | no source found [1][2] | medium (finding of absence) |
| Leftover estate (*radd*) | Hanafi default: spouses excluded unless no other heir | no Lebanese deviation found | medium |
| Distant kin | Hanafi default | no Lebanese deviation found | medium |
| Grandfather with siblings | Hanafi default: grandfather excludes siblings | no Lebanese deviation found | medium |
| Mushtaraka | Hanafi default: no sharing | no Lebanese deviation found | medium |
| Different religions | no inheritance between Muslim and non-Muslim (Hanafi) | not found in Lebanese sources | low |
| Court with authority | deceased's school (art. 60) | [1] | high |

## Cross-dimension insights

The statute and the practice evidence point the same way: Lebanese Sunni inheritance is plain Hanafi. That makes Lebanon the cheapest preset after Saudi Arabia. What it adds for users is the label ("Lebanese Sunni courts apply Hanafi rules"), a Lebanon-specific notice, and the citation, not new arithmetic.

## Recommendations

1. **PRD addendum §A:** fill the Lebanon column as above: Hanafi, all switches off, citation art. 242 of the 1962 law (am. 2011).
2. **Country notice (FR-19):** say that Shia families follow Ja'fari courts (not supported), that non-Muslims follow the 1959 law, and that changing sect changes the applicable law [1][4][8].
3. **Beta label (FR-15):** keep it until a Lebanese Sunni court or lawyer confirms that no Council decision changes shares.

## Open questions

- The full text of Supreme Sunni Islamic Council decision no. 46 of 2011 and any later decisions. Does any of them touch inheritance or bequests? *Route:* Dar al-Fatwa, or the Official Gazette of December 2012.
- Who issues *hasr irth* for Muslim estates in practice: the Sharia court or the civil single judge? *Route:* a Lebanese lawyer.
- Articles 382–492 of the 1962 law were not read because the page was truncated. *Route:* read the rest of the page, with an offset.
- Rules for *miri* (state) land under the 1913 Ottoman law: not found.

## Source appendix

| # | Supports | Publisher | Pub date | Accessed | Confidence |
|---|---|---|---|---|---|
| 1 | 1962 law arts. 17, 60, 70, 242 (am. Law 177/2011) | [Lebanese University legal informatics centre](http://legallaw.ul.edu.lb/LawView.aspx?opt=view&LawID=244292) | 1962-07-16, am. 2011 | 2026-11-16 | high |
| 2 | Order of sources; jurisdiction | [Musawah, Lebanon overview table](https://www.musawah.org/wp-content/uploads/2019/03/Lebanon-Overview-Table-2022.pdf) | 2022 | 2026-11-16 | medium |
| 3 | Heirs' certificate states shares; documents | [PBL law firm](https://pbl.legal/insights/international-estate-planning-in-lebanon-a-clear-overview-for-high-net-worth-families/) | 2025-07-16 | 2026-11-16 | medium |
| 4 | 1959 law covers non-Muslims only | [Women's History in Lebanon](https://womenshistoryinlebanon.org/timeline/personal-status-laws-no-longer-regulate-inheritance-for-non-muslim-confessions) | n.d. | 2026-11-16 | medium |
| 5 | Civil single judge issues hasr irth | [Lebanese Ministry of Justice](https://www.justice.gov.lb/index.php/court-details/6/1) | n.d. | 2026-11-16 | medium |
| 6 | Sunni daughters share with agnates; conversions | [AFP via WWRN](https://wwrn.org/articles/26861) | 2007 | 2026-11-16 | low-medium |
| 7 | 1959 non-Muslim inheritance law text | [LexisMiddleEast](https://www.lexismiddleeast.com/law/Lebanon/Law_1_1959/en) | 1959, am. 1995 | 2026-11-16 | medium |
| 8 | Inheritance follows the sect of the first marriage | [USEK](https://www.usek.edu.lb/Content/Assets/20240322PresidentRicha.pdf) | 2024 | 2026-11-16 | low |

## Staleness map

| Claims | Class | Re-check by | Trigger |
|---|---|---|---|
| Art. 242 order of sources [1] | regulatory | 2027-05 | Any new Supreme Sunni Islamic Council decision |
| Absence of an obligatory bequest [2] | regulatory | 2027-05 | A Council decision or reform |
| Practice reports [6] | other | already old (2007) | Replace with a current Lebanese source |

Earliest re-check: replace the 2007 practice source now. Statute claims are next due in 2027-05. A Refresh run handles this.
