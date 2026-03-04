# Defining Core Experience

## The Defining Experience

**One-sentence description:** *"Tell it who passed away and who's in the family — it gives you the complete inheritance shares with the Islamic legal proof, ready for the lawyer and the court."*

Mawareeth V3's defining experience is **preparation that eliminates confusion**. In the Lebanese inheritance process (حصر الإرث), Step 4 — obtaining the court's "Hujjat Hasr Irth" that determines heirs and their legal shares — is the most complex, expensive, and scholar-dependent step. Mawareeth automates this exact step, producing a court-formatted report with fiqh citations that the lawyer can use directly in the filing.

The product is the **preparation layer** that makes every downstream step (lawyer filing, court review, property transfer) faster, cheaper, and conflict-free.

## User Mental Model

**How the problem is currently solved (Lebanon):**

The Lebanese inheritance process (حصر الإرث) involves 6 sequential bureaucratic steps:

1. **Death Certificate** (شهادة الوفاة) — Obtained from the Mukhtar (village head)
2. **Family Registry Extract** (إخراج قيد عائلي) — Shows the deceased struck off the register
3. **Mukhtar's Attestation** (إفادة المختار) — Lists date of death, heir names, and addresses
4. **Court Application for Hasr al-Irth** (حجة حصر إرث) — Filed at the Sharia Court (Muslims) or Ecclesiastical Court (Christians) to legally determine heirs and their shares
5. **Financial Declaration** (تصريح عن التركة) — All assets (real estate, bank accounts, vehicles) declared to the Ministry of Finance within 90 days of death
6. **Property Transfer** (نقل الملكية) — After paying transfer fees, ownership moves to heirs' names at real estate registry and vehicle registration

**Required Documents:** Death certificate, family registry extract (إخراج قيد عائلي), individual registry extracts for each heir (إخراجات قيد أفرادي), Mukhtar's attestation, property deeds/vehicle registrations, and the Hasr al-Irth application (prepared by a lawyer).

**Note:** If there is a legal dispute, the 90-day deadline for financial declaration starts from the date of the final court ruling, not the date of death.

**What Mawareeth replaces:** Step 4 is where families get stuck. Determining who inherits what share under which school of Islamic jurisprudence requires scholarly expertise. Families hire lawyers, consult scholars, and wait months — all while tensions build. Mawareeth produces the answer to Step 4 in minutes, with the legal citations to back it up.

**User's mental model:** "I need to figure out who gets what *before* going to the lawyer." Mawareeth is the preparation step that gives heirs clarity and gives lawyers a verified foundation.

## Success Criteria

| Criterion | Measurement | Target |
|-----------|------------|--------|
| **Speed to clarity** | Time from first click to seeing complete share distribution | < 5 minutes for 3-generation cases |
| **Court-readiness** | Report formatted to Lebanese Hasr al-Irth standards with fiqh citations | 100% of reports meet standard |
| **Self-service completion** | Non-expert heirs can complete the interview without external help | 90%+ unaided completion rate |
| **Lawyer acceptance** | Lawyers can use the report as foundation for court filing | Report accepted by legal professionals |
| **Family resolution** | Multiple family members see the same authoritative answer | Shareable, unambiguous results |

**Users say "this just works" when:**
- The family tree they built matches their actual family
- The share distribution includes the *why* (fiqh citation), not just the *what* (percentage)
- The PDF looks like something a lawyer would produce, not a calculator printout
- They can share it with siblings and everyone sees the same clear answer

## Novel UX Patterns

**Pattern Analysis: Established foundations with domain-specific innovation**

**Established Patterns (users already understand):**
- Multi-step form wizard (TurboTax model) — familiar and proven
- PDF report generation — expected output format
- Share via link/WhatsApp — second nature for the target audience

**Novel Innovation (unique to Mawareeth):**
- **Fiqh-Aware Progressive Disclosure** — Legal reasoning revealed contextually, not dumped. Each share shows its Islamic legal basis on demand. This pattern doesn't exist in any competing calculator.
- **Real-Time Family Tree as Trust Anchor** — The visual kinship graph builds as users add heirs, confirming "the system understands my family" before any calculation happens. This is the emotional bridge between data entry and trust in results.
- **Court-Ready Output from Consumer Input** — Consumer-grade interview simplicity producing professional-grade legal documentation. The gap between input effort and output quality is the "magic moment."

**Teaching Strategy for Novel Patterns:**
- Family tree visualization needs no teaching — it's intuitive (users see their family appear)
- Fiqh citations use progressive disclosure — summary visible, detail on tap
- Court formatting is invisible to users — they just see "professional PDF"

## Experience Mechanics

**1. Initiation — "Start Your Inheritance Case"**
- Landing page communicates value: "Get your inheritance shares in minutes, backed by Islamic law"
- Single CTA button: "Start Calculation" — no sign-up required
- First screen: "Select your school of jurisprudence" (MadhabSelector component)

**2. Interaction — The Guided Interview**
- **Step A: Deceased Information** — Name, gender, date (minimal fields)
- **Step B: "Who are the heirs?"** — HeirAdder component, one heir at a time
  - Select relationship type (son, daughter, wife, father, mother, etc.)
  - System validates against Madhab rules in real-time
  - Family tree visualizer updates with each addition
  - Running share preview updates dynamically
- **Step C: Review Family Tree** — "Is this your complete family?"
- **Step D: Confirm and Calculate** — Final review before calculation

**3. Feedback — Real-Time Trust Building**
- Family tree grows visually with each heir added (FamilyTreeVisualizer)
- Share percentages preview updates in real-time (sidebar/bottom panel)
- Validation messages explain *why* in Islamic legal terms (FiqhCitationTooltip)
- Progress bar shows interview completion

**4. Completion — The Relief Moment**
- Full results screen: family tree + share breakdown + fiqh citations
- "Download Court-Ready PDF" — prominent CTA
- "Share with Family" — WhatsApp, link, email (one tap)
- "Save This Case" — triggers optional account creation
- Clear next steps: "Take this to your lawyer for the Hasr al-Irth filing"
