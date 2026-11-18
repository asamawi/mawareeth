---
title: 'Domain research: Islamic inheritance law by country'
type: 'domain'
topic: 'Islamic inheritance law by country'
decision: 'Pick 3-5 countries for phase-2 country presets and catalogue how each statute departs from the four Sunni schools'
source: 'native run'
status: complete
preset: 'standard'
validation: 'normal'
created: '2026-11-16'
updated: '2026-11-16'
claims_verified: 9
claims_unverified: 5
claims_disputed: 1
---

# Domain research: Islamic inheritance law by country

**Decision this research serves:** pick 3–5 countries for phase-2 country presets, and record for each how its statute departs from the four Sunni schools.

## Executive summary

**Build one configurable "obligatory bequest" step before anything else, then ship presets in this order: Egypt, Morocco, Jordan, UAE, with Algeria behind a verification gate.** Saudi Arabia is the cheapest preset to build and the best documented, but it adds the least for users.

The findings that drive this:

1. **The obligatory bequest (*wasiyya wajiba* or *tanzil*) is the feature most countries share, and Mawareeth does not have it.** Egypt, Jordan, the UAE, Morocco, Algeria, Syria, Iraq and Kuwait all give grandchildren whose parent died first a share capped at 1/3. Pakistan and Bangladesh have a representation variant. The variables are which lines qualify (son's only, or daughter's too), how many generations, and the gift offset. That makes one parameterised step, not a separate engine per country [1][2][11][15][21][25][34][37]. A user who picks a madhab gets a wrong answer under any of these statutes whenever a child has died before the parent.
2. **Egypt scores highest on usefulness.** It has about 117M people with 81.9% online [46], Arabic, a Hanafi base, and a precise official method for the bequest [1]. No online calculator was found; Dar al-Ifta handles inheritance questions by phone and app [44].
3. **Saudi Arabia is crowded.** The Ministry of Justice runs an official Najiz calculator [9]. The 2022 law has no obligatory bequest [8]. A Saudi preset is small and fully verified, which makes it a good first preset to prove the preset mechanism, but not a growth bet.

**Biggest caveat:** apart from Saudi Arabia, Morocco and Qatar, the article texts came from unofficial republications or secondary summaries. Every preset needs a check against the official gazette and review by a qualified jurist before release.

## Rules of the game: what governs Muslim inheritance, by country

Gate: a country qualifies only if Islamic rules govern Muslim inheritance, either written into a statute or applied by the courts without one. **Turkey fails**, because Civil Code 4721 applies to everyone [36]. Every other candidate passes.

### Shortlist: statute departures an engine must implement

| Rule | Egypt | Saudi Arabia | Jordan | UAE | Morocco | Algeria |
|---|---|---|---|---|---|---|
| Instrument | Law 77/1943 + Wills Law 71/1946 [2][4][57] | PSL M/73, 2022; regulations 2025 [8][10] | PSL 15/2019 [11] | Decree-Law 41/2024, in force 15 Apr 2025 [15][17][20] | Family Code 70-03, 2004 [21] | Family Code 84-11 as amended 2005 [25] (unverified) |
| Obligatory bequest | Yes. Son's and daughter's lines; each ancestor blocks only his own descendants; cap 1/3; gifts offset [2][3] | **None** [8] | Yes. **Son's line only**; cap 1/3; gifts offset; ranks before voluntary bequests [11][14] | Yes. **Son's and daughter's children**; cap 1/3; killer and apostate barred [15][16] | Yes. Son's line to any depth; **daughter's children first degree only**; cap 1/3 [21] | Yes (*tanzil*). Cap 1/3; 2:1. Daughter's line disputed [25][26] |
| Bequest method | Two passes: compute the parent's share as if alive, cap, take it out first, share the rest [1] | — | Parent's share, per branch [11] | Parent's share [15] | Two phases (commentary gives a worked example) [21] | Parent's share [25] |
| Grandfather with siblings | Better of sharing as a brother or taking the residue; floor 1/6 [4] | **Grandfather excludes siblings** (Hanafi) [8] | Better of sharing as a brother or taking the residue; floor 1/6 [11] | Codified; article not pinned [15] | Best of 1/3 or sharing; with fixed-share heirs, best of 1/6, 1/3 of remainder, or sharing [21] | Not retrieved |
| Leftover estate (*radd*) | Spouse only as last resort [4] | Spouse only when no blood heir or distant kin [8] | Spouses excluded; a lone spouse gets the rest [11][12] | Spouses excluded [15] | Returns to all fixed-share heirs; spouse included per the commentary's worked example (the article text does not name spouses; medium); treasury last [21] | Spouses excluded unless no other heir [27] |
| Distant kin (*dhawu al-arham*) | 4 classes; ranked by degree; 2:1 [4] | 3 classes; take the parent's place; **equal male/female** [8] | 4 classes; 2:1 [11] | Inherit, including alongside a sole spouse [15] | **No such class**; maternal grandfather is not an heir [21] | Inherit (drafting criticised) [27] |
| Mushtaraka | Not found | **No sharing** [8] | Sharing [11] | Codified art. 240 (detail unverified) [15] | Equal sharing, art. 365 [21] | Not retrieved |
| Akdariyya | Not found | Cannot arise [8] | Not found | Codified art. 239 [15] | Not in arts. 363–368 | Not retrieved |
| Default school for gaps | Hanafi preferred opinion (Law 1/2000) [6] | Sharia opinion closest to the law's own choices (art. 251) [8] | Hanafi preferred opinion (art. 325) [11] | Islamic Sharia, no school named [15] | Maliki, then *ijtihad* (art. 400) [21] | Islamic Sharia (art. 222) [28] |
| Estate with no heir | — | Treated as property of unknown owner [8] | Ministry of Awqaf [11] | Charitable waqf [15] | Treasury [21] | Treasury [27] |
| Status risk | A Supreme Constitutional Court challenge to art. 76 was reported; outcome unknown [7] | Stable | Article numbers may follow the 2010 text [11] | New law | Reform deferred to the next legislature; ta'sib kept [22][23][24][52][53] | Official text unreachable |

Confidence: Saudi Arabia, Morocco and the Egyptian method [1] are **high** (primary text or an official fatwa). The Egyptian articles, Jordan and the UAE are **medium** (unofficial republications, two sources for UAE art. 179). Algeria is **low-medium**.

Other details an engine will meet:
- **Unborn child:** reserve the better of the two possible shares in Egypt, Saudi Arabia and the UAE. Egypt caps pregnancy at 365 days [5]; Saudi Arabia and the UAE require a medical report [8][15].
- **Simultaneous deaths:** no mutual inheritance in Saudi Arabia, Qatar and the UAE [8][29][15]. Algeria brings deaths "with" the grandparent into *tanzil* [25].
- **UAE non-Muslims:** a separate civil law applies: the spouse takes half and children share the rest equally [18].
- **Killers:** in Saudi Arabia an accidental killer inherits from the estate but not from the blood money [8].
- **Apostates:** the Jordan text as summarised says a Muslim apostate inherits (art. 281(c)). This needs verifying before anyone relies on it [11].

### Rest of the field (round 1; secondary sources)

| Country | Instrument and notable rule | Confidence |
|---|---|---|
| Qatar | Law 22/2006. Hanbali default. **No obligatory bequest.** A spouse gets leftover estate only after distant kin (art. 251) [29] | high |
| Oman | Decree 32/97. Art. 229 gives a non-classical obligatory bequest to close relatives who are not heirs. Mushtaraka codified. For daughters, grandfather and distant kin, the deceased's own school applies (art. 281(c)) [30] | medium-high |
| Kuwait | Law 51/1984, with the bequest from Law 5/1971 [31]. A **2025 draft overhaul** is pending [32] | low-medium |
| Syria | PSL 59/1953, amended by Law 4/2019, extended the bequest to a son's daughters [33]. Status after 2024 unchecked | low-medium |
| Iraq | Law 188/1959 art. 74 includes daughters' first-generation children [34]. A Feb 2025 amendment lets couples choose the 1959 law or a Ja'fari code; parliament passed the **Ja'fari code on 27 August** (the source gives no year; 2025 is inferred from its Oct 2025 publication date) [35] | medium |
| Pakistan, Bangladesh | MFLO 1961 s.4: grandchildren take a predeceased son's or daughter's share by representation [37][38][39]. Pakistan's court refused to extend it to a predeceased brother's children (2026) [37] | medium |
| Indonesia | KHI art. 209: obligatory bequest for adopted children and adoptive parents; courts extended it to non-Muslim relatives [40] | medium |
| Malaysia | The Syariah Court issues the faraid certificate [41]; state e-Faraid tools exist [42] | medium |
| Iran | Civil Code arts. 861–949, Ja'fari [56] | medium-low |
| Tunisia | CSP 1956. Sources conflict on whether a spouse can take leftover estate [51] | low |
| Turkey | Civil Code: **fails the gate** [36] | high |
| Libya, Sudan, Afghanistan | Inheritance instrument or current status not established [54][55] | low |

## Usefulness signals

- **Official calculators:**
  - Saudi Arabia: Najiz "حساب المواريث", Nafath login, per-heir shares and amounts; successive deaths not mentioned (verified on the Ministry page) [9].
  - Malaysia: Syariah-court e-Faraid tools [42]. Indonesia: NU Online app calculator, no successive deaths at launch [43].
  - UAE: only the DIFC Courts' illustrative calculator and a 2016 Dubai Courts app [19].
  - Egypt, Jordan, Kuwait, Qatar: none found [44][13]. That is not proof none exist.
  - Maghreb: not searched.
- **Private competition:** almehleky.sa claims to calculate the obligatory bequest under eight Arab countries' laws. This is unverified because the page returned 403 [58]. If true, it is the only multi-country rival found.
- **Reach:**
  - Egypt: 81.9% online [46].
  - Gulf states: about 100% [49].
  - Pakistan: 45.7% [48]; Indonesia: 74.6% [47].
  - The largest Muslim populations are Indonesia (239M), Pakistan (227M) and Bangladesh (151M) [45]. Most Arab-country population figures came only from a weak aggregate [50]. **Each needs a new language.**
- **Language fit:** the Arab states are covered by ar, en or fr, and the Maghreb and Lebanon also by French. All non-Arab candidates need a new language (an inference; not sourced this run).
- **Demand data:** Google Trends and app-store figures could not be retrieved.

## Weighted ranking (re-weightable)

Scores are 1–5 judgments from the evidence above. The weights are the ones approved at the plan gate: statute divergence 30, language fit 25, reach 20, gap 15, Ja'fari need 10. Build cost is **not** a weight; it is noted in the last column.

| Country | Divergence | Language | Reach | Gap | Ja'fari | **Score** | Build cost / risk |
|---|---|---|---|---|---|---|---|
| Iraq | 5 | 5 | 4 | 4 | 5 | **4.65** | Needs a full Ja'fari engine; laws not checked in round 2 |
| Egypt | 5 | 5 | 5 | 5 | 1 | **4.60** | Obligatory-bequest step + Egyptian distant-kin rules |
| Morocco | 5 | 5 | 4 | 4 | 1 | **4.25** | Bequest step + spouse takes leftovers + no distant kin; reform pending |
| Algeria | 4 | 5 | 4 | 4 | 1 | **3.95** | Shares Morocco's step; text unverified |
| Jordan | 4 | 5 | 2 | 5 | 1 | **3.70** | Bequest step (son's line only); article numbers need checking |
| UAE | 4 | 5 | 2 | 4 | 1 | **3.55** | Bequest step + akdariyya/mushtaraka flags; non-Muslim and home-country law options |
| Tunisia | 4 | 5 | 2 | 4 | 1 | 3.55 | Leftover-estate rule disputed |
| Kuwait | 4 | 5 | 1 | 4 | 3 | 3.55 | Law in flux (2025 draft) |
| Pakistan | 4 | 2 | 5 | 3 | 2 | 3.35 | Urdu |
| Qatar | 3 | 5 | 1 | 4 | 1 | 3.05 | Small market |
| Saudi Arabia | 2 | 5 | 3 | 1 | 2 | **2.80** | **Cheapest and fully verified** |
| Indonesia | 3 | 1 | 5 | 3 | 1 | 2.70 | Indonesian |

## Cross-dimension insights

1. **The ranking and the build order differ.** Egypt, Morocco, Jordan, the UAE and Algeria all depend on the same missing piece, the obligatory-bequest step. Build it once, with settings for lines, depth, cap and gift offset, and each country preset becomes mostly a configuration file. Two smaller switches complete the picture: who gets leftover estate (spouse last / spouse included / spouse after distant kin), and the distant-kin method (ranked 2:1 / parent's place equal / none).
2. **The countries that fit best have the weakest online statute access.** Arabic- and French-speaking countries score highest, but their official portals blocked or broke the fetches (UAE, Jordan, Algeria). Shipping country presets responsibly therefore needs a human reviewer per country. That matches the "reviewed calculation" monetisation idea in the two Saudi and UK deep-research reports the owner supplied (not used as evidence here).
3. **Iraq tops the raw score but is a different project.** A Ja'fari rule set, needed for Iraq, Bahrain, Lebanon and Iran, is a whole second school, not a preset. It belongs in a later phase.
4. **The biggest Muslim populations are a language decision, not a law decision.** Pakistan, Bangladesh and Indonesia would each need a new UI language and copy review before their (fairly small) legal differences matter.

## Recommendations

1. **PRD and epics:** an epic, *Country presets: obligatory-bequest step and per-country rule settings*.
   - Story 1 builds the step with settings.
   - Story 2 adds the Saudi preset to prove the mechanism (high confidence, no bequest).
   - Then Egypt (high on method, medium on articles), then Morocco (high, with a "law as of 2004, reform pending" note), then Jordan and the UAE (medium; gazette check first).
2. **Architecture:** model a country preset as data (statute id, version or date, rule settings, default school for gaps, citation list), not code branches. Store the preset and its version in saved cases, because the laws change (Morocco, Kuwait, Egypt's court challenge).
3. **Release gate per preset:** verify the cited articles against the official gazette and get sign-off from a qualified reviewer. Ship worked examples as tests (Dar al-Ifta's 59,904-share example [1]; Morocco's 49/960 commentary example [21]).
4. **Defer:** the Ja'fari engine (Iraq, Bahrain, Lebanon, Iran), new UI languages (Urdu, Bengali, Indonesian), and Kuwait until its reform settles.

## Open questions

- **Egypt:** art. 76 generation limits (verbatim text) and the outcome of the Supreme Constitutional Court challenge [7]. *Route:* manshurat or the gazette PDF, or an Egyptian lawyer.
- **Jordan:** confirm the article numbering in 15/2019 and the apostate rule in art. 281(c). *Route:* lob.gov.jo or the Supreme Judge Department.
- **UAE:** the art. 240 mushtaraka split and the grandfather article. *Route:* the official PDF on uaelegislation.gov.ae, which needs a browser.
- **Algeria:** the official text, and the Supreme Court holding 932349 on daughters' children. *Route:* joradp.dz, or a law-library copy.
- **Not researched:** Bahrain, Lebanon, Palestine. The West Bank reportedly still applies Jordan's 1976 law [12]; Libya, Sudan and Tunisia (leftover estate) are unresolved.
- **Demand:** Google Trends for "حاسبة المواريث" by country; official calculators in the Maghreb and Egypt. *Route:* a manual Trends check, then a Deepen run.
- **Saudi Arabia:** whether the Najiz calculator handles successive deaths. *Route:* a test with a Nafath account.

## Source appendix

| # | Supports | Publisher | Pub date | Accessed | Confidence |
|---|---|---|---|---|---|
| 1 | Egypt obligatory-bequest method, worked example | [Dar al-Ifta al-Misriyya, fatwa 8330](https://dar-alifta.org/ar/fatwa/details/20658/طريقة-حل-الوصية-الواجبة) | 2024-04-07 | 2026-11-16 | high |
| 2 | Egypt art. 76 scope | [Dar al-Ifta al-Misriyya, fatwa 3228](https://www.dar-alifta.org/ar/fatwa/details/12421/حكم-استحقاق-الفرع-الوارث-وصية-واجبة-إذا-كان-وارثا-بالتعصيب-ولم-يبق-له-شيء) | 1981-03-02 | 2026-11-16 | medium |
| 3 | Egypt Wills Law arts. 77–79 | [mohamah.net](https://www.mohamah.net/law/?p=46900) | 2017 | 2026-11-16 | medium |
| 4 | Egypt Law 77/1943 arts. 22, 30, 31–38 | [mohamah.net](https://www.mohamah.net/law/?p=4097) | n.d. | 2026-11-16 | medium |
| 5 | Egypt arts. 5, 6, 10, 42–45 | [lawyeregypt.net](https://lawyeregypt.net/?p=5301) | n.d. | 2026-11-16 | medium |
| 6 | Egypt Law 1/2000 art. 3 Hanafi default | [Wikisource](https://ar.wikisource.org/wiki/قانون_رقم_1_لسنة_2000_-_مصر) | n.d. | 2026-11-16 | medium |
| 7 | Constitutional challenge to art. 76 | [Akhbar el-Yom](https://akhbarelyom.com/news/newdetails/3311635/1/3-أبريل-عدم-دستورية-الوصية-لفرع-الابن-ال) | unknown | 2026-11-16 | low |
| 8 | Saudi PSL Book 7 arts. 197–251 | [Qadha (Ministry of Justice edition)](https://qadha.org.sa/files/3/ملفات%20الكتب%20المعدلة/نظام%20الأحوال%20الشخصية%20مع%20الفهارس.pdf) | 2025-02-21 | 2026-11-16 | high |
| 9 | Najiz inheritance calculator | [Saudi Ministry of Justice](https://www.moj.gov.sa/ar/eServices/Pages/7f678c3b-6251-439e-ab04-64638df6635f.aspx) | n.d. | 2026-11-16 | high |
| 10 | Saudi PSL 2022 overview | [Zawya](https://zawya.com/en/legal/regulations/saudi-personal-status-law-limits-judiciarys-discretionary-power-reduce-inconsistencies-b7v5fqan) | 2022 | 2026-11-16 | medium |
| 11 | Jordan PSL arts. 279, 281, 284, 290, 296, 301–312, 325 | [jordanianlaw.com](https://jordanianlaw.com/) | n.d. | 2026-11-16 | medium |
| 12 | Jordan spouse radd; West Bank 1976 law | [J. Palestine Ahliya Univ.](https://journal.paluniv.edu.ps/index.php/journal/article/view/210) | 2025-12-01 | 2026-11-16 | medium |
| 13 | Jordan inheritance-deed e-service | [Supreme Judge Department](https://sjd.gov.jo/EchoBusV3.0/SystemAssets/PDFs/AR/دليل%20المراجعين/حجة%20حصر%20ارث.pdf) | n.d. | 2026-11-16 | medium |
| 14 | Jordan: daughters' children rejected | [Al Mamlaka TV](https://www.almamlakatv.com/news/17214-أغلبية-تؤيد-استثناء-سن-الزواج) | n.d. | 2026-11-16 | low |
| 15 | UAE Decree-Law 41/2024 arts. 1, 179, 203–243 | [shushin.io (translation)](https://uae.shushin.io/personalstatus/Federal-Law-41-2024) | 2025 | 2026-11-16 | medium |
| 16 | UAE art. 179 daughters' children | [Al Etihad](https://www.aletihad.ae/opinion/4674419) | 2025 | 2026-11-16 | medium |
| 17 | UAE wills cap | [Horiz Law](https://www.horizlaw.ae/insights/key-amendments-and-legal-implications-of-federal-decree-law-no.-41-of-2024-on-personal-status-for-muslims-in-the-uae) | 2025 | 2026-11-16 | medium-high |
| 18 | UAE non-Muslim inheritance | [Chambers](https://chambers.com/articles/understanding-uae-non-muslim-family-laws-a-guide-to-marriage-divorce-and-inheritance-in-the-uae) | n.d. | 2026-11-16 | medium |
| 19 | DIFC illustrative calculator | [DIFC Courts](https://difccourts.ae/difc-courts-wills/inheritance-calculator) | n.d. | 2026-11-16 | low-medium |
| 20 | UAE 41/2024 in force; home-law opt-in | [Chambers](https://chambers.com/articles/federal-decree-law-no-41-2024-and-its-changes-to-the-personal-status-law-for-muslims-in-the-uae) | 2025 | 2026-11-16 | medium |
| 21 | Morocco Law 70-03 arts. 348–372, 400 | [IDP Barcelona (official FR translation)](https://www.idpbarcelona.net/docs/recerca/marroc/pdf/nor_loi_70_03.pdf) | 2004 | 2026-11-16 | high |
| 22 | Morocco reform status Oct 2026 | [LesMRE](https://www.lesmre.com/fr/actualites/reforme-moudawana-2026-mariage-divorce-garde-succession-mre) | 2026-10-15 | 2026-11-16 | medium |
| 23 | Morocco reform politics Jan 2026 | [Hespress FR](https://fr.hespress.com/457003-reforme-du-code-de-la-famille-un-vote-en-2026-ou-un-report-a-la-prochaine-legislature.html) | 2026-01-05 | 2026-11-16 | high |
| 24 | Morocco reform unfinished at end of term | [Medias24](https://medias24.com/2026/07/15/legislature-2021-2026-le-bilan-cinq-ans-de-reformes-mais-plusieurs-grands-chantiers-laisses-en-suspens-1722399/) | 2026-07-15 | 2026-11-16 | medium |
| 25 | Algeria arts. 169–172 tanzil | [mohamah.net](https://www.mohamah.net/law/?p=26621) | n.d. | 2026-11-16 | medium |
| 26 | Algeria tanzil scope dispute | [Emarefa](https://search.emarefa.net/en/detail/BIM-1304660) | n.d. | 2026-11-16 | low |
| 27 | Algeria art. 167 radd | [De Jure, UIN Malang](https://ejournal.uin-malang.ac.id/index.php/syariah/article/view/6466) | 2019 | 2026-11-16 | medium |
| 28 | Algeria art. 222 | [Emory Islamic Family Law](https://scholarblogs.emory.edu/islamic-family-law/legal-profiles/algeria-democratic-and-popular-republic-of/) | n.d. | 2026-11-16 | medium |
| 29 | Qatar Law 22/2006 | [Univ. Zurich (English translation)](https://www.ius.uzh.ch/dam/jcr:00000000-74d3-1f02-ffff-ffff87068da3/Law_22_2006_2558.pdf) | 2006 | 2026-11-16 | high |
| 30 | Oman Decree 32/97 | [Supreme Judicial Council, Oman](https://sjc.gov.om/userupload/laws/(English)قانون%20الاحوال%20الشخصية.pdf) | 1997 | 2026-11-16 | high |
| 31 | Kuwait obligatory bequest origin | [Emory Islamic Family Law](https://scholarblogs.emory.edu/islamic-family-law/home/research/legal-profiles/kuwait-state-of) | n.d. | 2026-11-16 | low |
| 32 | Kuwait 2025 draft overhaul | [Gulf News](https://gulfnews.com/world/gulf/kuwait/kuwait-proposes-sweeping-reforms-to-decades-old-family-law-1.500259947) | 2025-09-07 | 2026-11-16 | medium |
| 33 | Syria Law 4/2019 | [Chatham House](https://kalam.chathamhouse.org/new-amendments-to-personal-status-law-offer-small-gains-for-womens-rights/) | 2019 | 2026-11-16 | low-medium |
| 34 | Iraq art. 74 | [mohamah.net](https://www.mohamah.net/law/?p=109713) | n.d. | 2026-11-16 | low-medium |
| 35 | Iraq Ja'fari code 2025 | [Human Rights Watch](https://www.hrw.org/news/2025/10/15/iraq-new-personal-status-code-makes-women-second-class) | 2025-10-15 | 2026-11-16 | medium |
| 36 | Turkey Civil Code for all | [Musawah](https://campaignforjustice.musawah.org/repository/turkey/) | n.d. | 2026-11-16 | high |
| 37 | Pakistan MFLO s.4; court ruling | [APP](https://app.com.pk/national/section-4-of-muslim-family-laws-ordinance-does-not-extend-to-children-of-predeceased-brother-fccp) | 2026 | 2026-11-16 | medium |
| 38 | Pakistan s.4 commentary | [LUMS Law Journal](https://sahsol.lums.edu.pk/node/12851) | n.d. | 2026-11-16 | medium |
| 39 | Bangladesh MFLO s.4 | [Banglapedia](https://en.banglapedia.org/index.php/Muslim_Family_Law_Ordinance,_1961) | n.d. | 2026-11-16 | medium |
| 40 | Indonesia KHI art. 209 | [Hukumonline](https://www.hukumonline.com/berita/a/mengulas-polemik-wasiat-wajibah-untuk-ahli-waris-beda-agama-lt609b72a619682) | n.d. | 2026-11-16 | medium |
| 41 | Malaysia faraid certificate | [Malaysia.gov.my](https://www.malaysia.gov.my/en/categories/death--inheritance/division-of-inheritance) | n.d. | 2026-11-16 | medium |
| 42 | Malaysia e-Faraid | [New Straits Times](https://www.pressreader.com/malaysia/new-straits-times/20160923/281908772622361) | 2016-09-23 | 2026-11-16 | medium |
| 43 | Indonesia NU Online calculator | [NU Online](https://nu.or.id/nasional/nu-online-super-app-hadirkan-fitur-baru-kalkulator-waris-iOZ2Y) | 2023-07-12 | 2026-11-16 | high |
| 44 | Egypt Dar al-Ifta fatwa service | [Dar al-Ifta al-Misriyya](https://www.dar-alifta.org/ar/services/details/8) | n.d. | 2026-11-16 | medium |
| 45 | Muslim populations 2020 | [Pew Research Center](https://www.pewresearch.org/short-reads/2025/06/10/islam-was-the-worlds-fastest-growing-religion-from-2010-to-2020/) | 2025-06-10 | 2026-11-16 | high |
| 46 | Egypt internet 81.9% | [DataReportal](https://datareportal.com/reports/digital-2025-egypt) | 2025 | 2026-11-16 | high |
| 47 | Indonesia internet 74.6% | [DataReportal](https://datareportal.com/reports/digital-2025-indonesia) | 2025 | 2026-11-16 | medium |
| 48 | Pakistan internet 45.7% | [DataReportal](https://datareportal.com/reports/digital-2025-pakistan) | 2025 | 2026-11-16 | medium |
| 49 | Gulf internet ~100% | [Wikipedia (ITU data)](https://en.wikipedia.org/wiki/List_of_countries_by_number_of_Internet_users) | 2025-12 | 2026-11-16 | medium |
| 50 | Muslim populations, other countries | [Wikipedia](https://en.wikipedia.org/wiki/Islam_by_country) | n.d. | 2026-11-16 | low |
| 51 | Tunisia radd | [WebManagerCenter](https://www.webmanagercenter.com/2026/03/21/563066/droit-successoral-en-tunisie-comprendre-le-rad-et-la-donation-guide-complet/) | 2026-03-21 | 2026-11-16 | low-medium |
| 52 | Morocco reform proposals 2024 | [Morocco World News](https://www.moroccoworldnews.com/2024/12/166811/approved-reforms-in-moroccos-family-code-whats-changing/) | 2024-12 | 2026-11-16 | low |
| 53 | Morocco ulema reject abolishing ta'sib | [The New Arab](https://www.newarab.com/news/moroccos-family-code-reform-pleases-no-one-especially-women) | 2024-12 | 2026-11-16 | low |
| 54 | Libya inheritance instrument | [World Bank WBL](https://wbl.worldbank.org/content/dam/documents/wbl/2020/sep/Libya.pdf) | 2020 | 2026-11-16 | low |
| 55 | Afghanistan Shia PSL 2009 | [Refworld](https://www.refworld.org/legal/legislation/natlegbod/2009/en/67609) | 2009 | 2026-11-16 | low-medium |
| 56 | Iran Civil Code inheritance | [Ulul Albab, UIN Malang](https://ejournal.uin-malang.ac.id/index.php/ululalbab/article/download/4492/pdf) | n.d. | 2026-11-16 | medium-low |
| 57 | Egypt laws overview | [Al Zayat law firm](https://alzayatfirm.com/egypt-inheritance-law/) | n.d. | 2026-11-16 | medium |
| 58 | almehleky multi-country claim | [almehleky.sa](https://almehleky.sa/?p=20109) | n.d. | 2026-11-16 | low |

## Staleness map

The `recon_kit staleness` script windows each claim by publication date. That flagged 12 of 15 ledger claims as stale, because statute enactment dates (1943, 2004, 2019) fall outside a 6-month regulatory window. The domain pack instead says regulatory status must be confirmed current on every load-bearing claim, whatever its date. All statute claims were confirmed in force on **2026-11-16**, so the re-check windows below run from the access date.

| Claims | Class | Re-check by | Trigger that forces an earlier re-check |
|---|---|---|---|
| Morocco reform status [22] | regulatory | **2027-01** | A bill tabled in the new legislature |
| Kuwait draft overhaul [32] | regulatory | 2027-01 | The draft reaches the National Assembly |
| Egypt art. 76 constitutional challenge [7] | regulatory | 2027-01 | Any Supreme Constitutional Court ruling |
| Iraq Ja'fari code [35] | regulatory | 2027-05 | Implementing regulations |
| All other statute claims [1][2][4][8][11][15][21][25][29][36] | regulatory | 2027-05 | Gazette amendment |
| Competitor and calculator claims [9][44] | competitor | 2027-11 | — |
| Egypt reach figure [46] | quantitative | 2026-08 (already past) | DataReportal 2026 report |

The earliest re-check date is **2026-08**, already past, for the reach figure: use the Digital 2026 edition before quoting it. The earliest legal re-check is **January 2027** (Morocco, Kuwait, Egypt). A Refresh run handles this.
