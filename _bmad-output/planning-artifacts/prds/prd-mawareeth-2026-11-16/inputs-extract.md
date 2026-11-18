# Phase-2 PRD inputs extract (2026-11-16)

Scope: families (primary), lawyers/scholars (secondary), country presets, localisation, content review, more languages, contact/support, UI/UX. Paid reviewed calculations are OUT of scope (private marketplace project); boundary context only.

## 1. Country-law research
Path: `_bmad-output/planning-artifacts/research/domain-islamic-inheritance-country-laws-2026-11-16/research.md`

### Requirements / ideas
- Build ONE configurable "obligatory bequest" (wasiyya wajiba / tanzil) step before any preset; settings: qualifying lines, depth, 1/3 cap, gift offset (Exec summary, Cross-dim 1).
- Without it, a user choosing a madhab gets a wrong answer under most Arab statutes whenever a child predeceased the parent (Exec 1).
- Preset order: Saudi first as mechanism proof (cheapest, high confidence, no bequest), then Egypt, Morocco, Jordan, UAE; Algeria behind a verification gate (Recs 1).
- Two further switches: leftover-estate (radd) recipient (spouse last / included / after distant kin); distant-kin method (ranked 2:1 / parent's place equal / none) (Cross-dim 1).
- Model a preset as data (statute id, version/date, rule settings, default school for gaps, citations), not code branches; store preset + version in saved cases because laws change (Recs 2).
- Per-preset release gate: verify articles against the official gazette plus qualified-reviewer sign-off (Recs 3).
- Edge rules per country: unborn child (reserve better of two shares; Egypt caps pregnancy at 365 days), simultaneous deaths, killer/apostate bars, UAE non-Muslim civil rule (spouse 1/2, children equal) (Shortlist notes).
- Default school for gaps differs: Egypt/Jordan Hanafi, Morocco Maliki, Qatar Hanbali, UAE/Algeria "Sharia" unnamed (Shortlist table).
- Defer: Ja'fari engine (Iraq, Bahrain, Lebanon, Iran), Urdu/Bengali/Indonesian UI, Kuwait until its reform settles (Recs 4).
- Language: Arab states are covered by ar/en/fr; every non-Arab candidate needs a new language (Usefulness; inference, unsourced).

### Constraints / risks
- Except Saudi, Morocco, Qatar, article texts came from unofficial or secondary sources; jurist review is mandatory before release (Exec caveat).
- Law in flux: Morocco reform pending (recheck 2027-01), Kuwait 2025 draft, Egypt art. 76 constitutional challenge (outcome unknown), Iraq Ja'fari code (Status risk; Staleness map).
- Saudi preset adds least user value: Najiz official calculator exists. No Egypt/Jordan official calculators found (Exec 3).
- Possible multi-country rival almehleky.sa (unverified, 403) (Usefulness).
- Turkey fails the gate (civil code for all). Egypt reach figure stale; use Digital 2026 (Staleness).
- Open: Egypt art. 76 verbatim, Jordan numbering and apostate rule art. 281(c), UAE arts. 239/240, Algeria official text (Open questions).
- Confidence: Saudi, Morocco, Egyptian method high; Egypt articles, Jordan, UAE medium; Algeria low-medium.

### Reusable examples / test cases
- Egypt: Dar al-Ifta fatwa 8330 worked example, 59,904-share base (source [1]).
- Morocco: Law 70-03 commentary worked example, 49/960 (source [21]).
- Obligatory-bequest matrix (cap 1/3 everywhere): Egypt son and daughter lines; Jordan son's line only; UAE son's and daughter's children; Morocco son's line any depth, daughter's children first degree only.
- Saudi: grandfather excludes siblings; no mushtaraka; distant kin equal male/female; no obligatory bequest.
- Reach: Egypt 81.9% online (~117M); Pakistan 45.7%; Indonesia 74.6%.

## 2. Deep-research report 1 (Saudi commercial)
Path: `C:\Users\samaw\Downloads\mawareeth-deep-search\deep-research-report-1.md`

### Requirements / ideas relevant to phase 2 (free product)
- Calculator, school comparison, proof and draft PDF must stay FREE; free Saudi substitutes (Infath incl. munasakhat and compensation; Najiz) mean arithmetic is no moat (Decision memo).
- Differentiate on explanatory quality, trust, collaboration and handoff, not on "we do successive deaths" (that claim is now false vs Infath) (Saudi demand).
- Product states it is a calculation aid, not a fatwa or legal advice, and recommends review by a qualified scholar, court or lawyer; that handoff is where external services sit (Product verification).
- Data minimisation: no national IDs, bank statements or deeds; pseudonymise; short deletion (Legal/privacy).
- Guest flow works without account; account only to save and share (live page).

### Constraints / risks
- PDPL applies to data of deceased persons that identifies a family member; needs Saudi privacy-lawyer review of notice, retention, hosting.
- Saudi legal-practice law: individualised Saudi-law conclusions should come from a licensed lawyer; use "reviewed", not "certified" (Legal).
- AGPL-3.0 s.13 source offer for modified networked versions; do NOT assume dual-licensing rights without a contributor-assignment check (License).
- Live /interview is JS-driven; research could not verify end-to-end (access limit, not a defect).

### Test cases (exact)
- Ordinary estate SAR 720,000; wife, mother, father, son, daughter: wife 1/8 = 90,000; mother 1/6 = 120,000; father 1/6 = 120,000; son 13/36 = 260,000; daughter 13/72 = 130,000.
- Two-death: estate 720,000; W 1/8, S 7/12, D 7/24. S dies leaving wife SW, mother W, son GS, daughter GD. Final: W 2/9 (160,000), D 7/24 (210,000), SW 7/96 (52,500), GS 119/432 (198,333.33), GD 119/864 (99,166.67); sums 864/864. Tests identity across layers and money rounding. (I re-derived these; they are correct.)
- Mushtaraka, SAR 360,000: husband 1/2, mother 1/6, 2 maternal brothers, 1 full brother. Hanafi/Hanbali/Saudi: husband 180,000, mother 60,000, each maternal brother 60,000, full brother 0. Maliki/Shafi'i: each of the 3 gets 1/9 = 40,000.

### Boundary only (out of scope)
- SAR 499 Reviewed Munasakhat Pack for lawyers, reviewer queue, pass thresholds (5 of 20). Do not scope in phase 2.

## 3. Deep-research report 2 (international)
Path: `C:\Users\samaw\Downloads\mawareeth-deep-search\deep-research-report-2.md`

### Requirements / ideas
- French locale reported legacy/incomplete (opened old "Mawareeth 2.0", redirected to English login); treat French parity as a phase-2 need (Product verification). Verify against current build; may be stale after the 2026-11-13 release.
- Expose a non-sensitive `/version` or health endpoint with the release commit SHA (RELEASE_COMMIT_SHA already configured) for provenance and trust (Commit limitation).
- Professionals want a file-ready PDF: assumptions sheet, exact fractions, school comparison, evidence, and the chain "death one -> carried fraction -> second estate -> final positions" (Sample deliverable).
- Add a footer: estate figure and heir eligibility supplied by the user, not determined by Mawareeth. Users mistake gross wealth for the faraid estate (joint tenancy, beneficiary-designated assets) (Fictional cases).
- Germany/France forced heirship constrains faraid; Germany needs a German UI; US is state-by-state; English markets (England and Wales, Ontario) already fit.

### Constraints / risks
- Source facts: guest model max 50 heirs and up to two later deaths, 24h idle expiry; share links 30 days, hashed token.
- Competitors: Mizaanly (UK, free four-madhhab calculator, GBP 29 letter), Shariawiz (US, free calculator), mawaarith.com (SAR 149 report; successive deaths "forthcoming").
- Probate paper preparation is a regulated legal activity in England and Wales; stay out.

### Test case
- E&W-001: distributable GBP 240,000; wife, mother, two sons, one daughter; Hanbali requested with four-school comparison.

### Conflicts between research sources
- Report 2 says Saudi competitors lack successive deaths (mawaarith.com); report 1 shows Infath has a munasakhat calculator; research.md says Najiz successive deaths unverified.
- research.md ranks Egypt/Morocco (law presets); report 2 ranks England and Wales first (market entry). Different decisions, but both need only ar/en/fr.
- Report 1 and research.md agree Saudi law has no mushtaraka sharing; consistent.

## 4. Phase-1 PRD (Mawareeth V3)
Path: `_bmad-output/archive/phase-1/planning-artifacts/prd.md` (last edited 2026-03-04; Lebanon/diaspora framing)

### Vision wording (preserve tone)
- "the definitive universal protocol for Islamic inheritance"; "deterministic, scholarly-validated 'Source of Truth'"; replaces "fragmented, manual, and error-prone" methods; "bridging 1,400 years of jurisprudence (fiqh) with modern legal technology"; court clerk as "Silent Advocate"; "Logic-as-Code" (no manual overrides; fixes at engine level).
- Differentiator: modular madhab architecture and recursive Manasikhat graph-solver.
- Shipped positioning (reports 1 and 2): "free Islamic inheritance calculator", four Sunni schools, differences shown, proof, successive deaths, draft PDF, no account needed to calculate or download.

### Personas / journeys
- Sami, diaspora heir in Paris; conflicting family advice causes tension; wants a clear draft PDF.
- Layla, estate lawyer in Tripoli; 10+ cases a month; saves 5+ hours per case; attaches reports to court filings.
- Mustafa, court clerk (Hasr al-Irth decrees); receives pre-prepared reports.
- Rana, certification buyer: OUT of scope (marketplace).

### FRs / NFRs still relevant
- FR-01 (4 Sunni + Jafari), FR-02 manasikhat, FR-03 proofs, FR-04 invalid-kinship flags, FR-05 to FR-07 guided interview with live preview, FR-08/09 court-ready PDF with citations and kinship graphs, FR-10 Preliminary/Verified watermark, FR-16 no overrides, FR-18 privacy-first, FR-19 anonymisation.
- NFR-01 under 200ms (standard) and 1s (manasikhat); NFR-03 versioned deterministic engine; NFR-07 WCAG 2.1 AA with high-legibility Arabic; NFR-08 3G/4G performance; NFR-04/05 ephemeral sessions, AES-256, TLS 1.3.
- Success: 3-generation case in under 5 minutes; non-experts finish the guided interview; 100% pass on 1,000+ scholarly cases; #1 search ranking; 500+ calculations in 30 days; endorsement by a recognised Islamic council.
- Compliance: non-removable disclaimers on algorithm-only results; AGPL-3.0 engine with CLA for contributions.
- Marketplace, out of phase 2: FR-11 to FR-15, FR-17, NFR-06, NFR-09, NFR-10.

### Promised but not delivered (or unverified)
- Jafari school (FR-01; engine raises `UnsupportedCase`); Lebanese multi-faith modules (Christian, Druze, civil); FR-08 Lebanese Hasr al-Irth format; FR-09 kinship graphs in the PDF (unverified); FR-10 watermark; FR-19 (explicitly not implemented); professional Arabic/English/French (French unverified); 1,000+ case suite; council endorsement; public OpenAPI/SDKs.
- Framing conflict: PRD targets Lebanon/diaspora; research targets Arab statutes (Egypt, Morocco, Jordan, UAE). Lebanon is Ja'fari-heavy and unresearched. PRD "Phase 2" (core product) is not the new "phase 2".

## 5. Deferred work (open items)
Path: `_bmad-output/implementation-artifacts/deferred-work.md` (infra, CI, monitoring, backup sections skipped)

### Content and fiqh review
- [1-7c kinship table] Qualified review of 23 lineage paths in `api/kinship.py` (half siblings, multiple wives, female deceased) plus AR/FR wording — family trust.
- [1-7 layered previews] Fiqh review of interview-built successive-death previews across schools — correctness.
- [2.4 manasikhat matrix] Reviewers check matrix and AR/FR refusal text — trust.
- [2.2 proof] Reviewer check of proof codes, verse per relationship, AR/FR labels — scholar audience.
- [2.2 citations] Add hadith/ijma/scholar citations for rules without a verse (grandfather, mushtaraka, akdariyya, awl, radd) — scholar credibility.
- [2.2 shared fixed share] Explain a fraction split among heirs (two wives 1/8 -> 1/16 each) — family clarity; changes proof v1 contract.
- [2.3 grandmothers] Reviewer check of grandmother matrix and labels — correctness.
- [maliki/shafii later radd] Review `radd_later_scholars` label; should plain radd say a spouse takes no radd — relevant to country radd switch.
- [Malikiyya] Maliki refuses (`malikiyya_disputed`) pending ruling — users get no number.
- [Shibh al-Malikiyya] Decide whether Maliki should also refuse the full-brother variant — possible disputed number.
- [Jafari] Add Jafari school (needs paternal/maternal line distinction) — unmet FR-01; Iraq, Lebanon, Iran.

### i18n and wording (all AR/FR drafted without native review)
- Landing/about/FAQ/footer/meta text (`web/src/i18n/messages.ts`): native plus fiqh review — first impression and SEO.
- Terms/privacy: ported verbatim with typos ("webste"), predate accounts, sharing, email, WhatsApp, still mention advertising partners — needs legal update.
- School-only-when-it-matters strings (`schoolsAgree`, `schoolsDiffer`, `chooseSchool`, `saveNeedsSchool`, "Same result in all four Sunni schools") — core UX copy.
- Preview refusal sentences (Malikiyya reads like a repeated school name in Arabic) — explains why no number.
- Fiqh-aware validation text (hajb label, hints, kinship messages) — core.
- Invitation/email, WhatsApp share, password-change, stale-chunk `pageError`, "Cancel", add-heir picker ("More relatives", "Other relationship") — native review, Arabic RTL readability.

### Interview and UI
- [Family tree] Node selection with arrow keys, pan/pinch zoom — accessibility, usability.
- [Family tree] Full-viewport layout with floating card (desktop) or bottom sheet (mobile) — UX-spec promise undelivered.
- [Family tree] Keep deceased visible when tree exceeds 45% viewport (overflows at six heirs, 375px and 1280px) — larger families.
- [Shares on tree] Show each heir's share on its node with citation and proof — planned, undelivered.
- [Proof on screens] Show proof on results and preview — verify against shipped Epic 3.
- [Relationship list] Only 23 IDs; missing maternal grandfather, remote lines, lower generations, Hanafi/Jafari distant kin — some families cannot be modelled; ties to country distant-kin switch.
- [Stories 1.7b, 3.1b, 3.1c] Successive-death web interview, layered proof, side-by-side manasikhat table — check against 2026-11-13 release status.
- [Browser tests] Playwright+axe on heir screen (RTL 320px, dark mode, forced colors, keyboard) and a CSP hydration check — evidence for NFR-07.
- [Anonymous case storage] Move anonymous case from DB session to browser storage — privacy.
- [FR-19] Anonymisation not implemented; names and estate stored as entered — PDPL relevance.
- [Preview performance] Preview writes to DB (about 100 queries for 6 heirs, 645 for 50); a no-school case costs four engine runs — slows families; needs in-memory path.
- [Lock timeouts] Unbounded case-write and compute() lock waits — responsiveness under load.
- [Legacy calculations] 1,146 unconverted (841 no deceased, 304 no heirs, #2402 anomaly) — decide fate.
- [Legacy Django pages] Retire remaining HTML pages; old calc URLs not redirected by owner decision — existing users lose old links.
- [Auth hardening] Per-account login limits, reset cooldown, timing leak — security.
- [OAuth] End-to-end test after major upgrades — login regression risk.
- Gap: no contact/support channel item appears anywhere in deferred-work.
