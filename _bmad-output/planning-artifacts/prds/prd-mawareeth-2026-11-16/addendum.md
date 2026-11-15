# Addendum: Mawareeth phase 2 PRD

Depth that belongs downstream (architecture, engine design, UX) rather than in the PRD. The source for §A is the country-law research (`research/domain-islamic-inheritance-country-laws-2026-11-16/research.md`); its numbered citations are kept as [n].

## A. Country preset settings (draft, from research)

| Setting | Saudi Arabia | Egypt | Jordan | UAE | Morocco | Algeria | Lebanon (Sunni) |
|---|---|---|---|---|---|---|---|
| Obligatory bequest | none [8] | son's and daughter's lines; each ancestor blocks only his own descendants [2] | son's line only [11] | son's and daughter's children [15][16] | son's line any depth; daughter's children first degree [21] | yes; daughter's line disputed [25][26] | none found [L1][L2] |
| Bequest cap and split | — | 1/3; 2:1; gift offset [2][3] | 1/3; 2:1; gift offset [11] | 1/3; 2:1 [15] | 1/3; 2:1; gift/bequest offset [21] | 1/3; 2:1 [25] | — |
| Bequest method | — | two-pass, taken out first (fatwa 8330) [1] | parent's share per branch | parent's share | two-phase (commentary) [21] | parent's share | — |
| Leftover estate (radd) | spouse last [8] | spouse last [4] | spouses excluded; lone spouse gets the rest [11] | spouses excluded [15] | to all fixed-share heirs, spouse included (commentary) [21] | spouses excluded unless no other heir [27] | Hanafi default |
| Distant kin | 3 classes, parent's place, equal shares [8] | 4 classes, ranked, 2:1 [4] | 4 classes, 2:1 [11] | inherit, also beside a sole spouse [15] | none; treasury [21] | inherit [27] | Hanafi default |
| Grandfather with siblings | grandfather excludes siblings [8] | better of sharing or residue; floor 1/6 [4] | same as Egypt [11] | codified, article to confirm | best of 1/3 or sharing [21] | to confirm | Hanafi: grandfather excludes siblings |
| Mushtaraka | no sharing [8] | not found | sharing [11] | art. 240, to confirm | equal sharing, art. 365 [21] | to confirm | Hanafi: no sharing |
| Default school for gaps | law's own preferences [8] | Hanafi [6] | Hanafi [11] | Sharia, unnamed [15] | Maliki [21] | Sharia [28] | Hanafi, after Council decisions and the 1917 Ottoman law (1962 law art. 242, am. 2011) [L1] |
| Confidence | high | high (method) / medium (articles) | medium | medium | high | low-medium | high (school); medium (no overlay found) |

[L1], [L2]: Lebanon research, `research/domain-lebanon-sunni-inheritance-law-2026-11-16/research.md` sources [1] and [2].

Settings for the shared Obligatory bequest step:
- `lines`: which children's lines qualify (son / son and daughter)
- `daughter_line_depth`: generations through a daughter (0, 1, or unlimited)
- `son_line_depth`: generations through a son (usually unlimited)
- `cap`: 1/3
- `split`: 2:1
- `gift_offset`: subtract lifetime gifts and voluntary bequests; top up any shortfall
- `method`: two-pass (Egypt) or two-phase (Morocco). Check whether these give identical results; if they do, one implementation suffices.
- `excluded_if_heir`: true everywhere researched

## B. Country preset as data

Proposed shape, to be decided in architecture:
- `id`, display name per Locale, statute citation(s), `version` (effective date) and `reviewed_by` / `reviewed_on` (null means Beta label)
- the rule settings from §A, a default school for gaps, and a per-step citation map (rule to article)
- a notice text per Locale (FR-19), and a default currency (FR-17)

Saved cases store `basis` plus `preset_id@version` (FR-14). The engine reads presets read-only. A preset change is a data release with tests, not a code branch.

## C. Ticketing options (for FR-27 to FR-30)

| Option | Fit | Notes |
|---|---|---|
| Hosted helpdesk (e.g. Zammad Cloud, Freshdesk, Help Scout) | fast to start; email threading built in | data leaves the host: check EU or KSA hosting, cost, AGPL compatibility of integration |
| Self-hosted Zammad on the Hetzner host | data stays on our host; full email threading | ops load: another service to back up and monitor |
| Minimal in-app Ticket store (Django model + inbound email) | smallest footprint; matches the existing stack | threading and inbound parsing need building |

WhatsApp: a `wa.me` click-to-chat link needs no API. The WhatsApp Business API is only needed for automated replies, which are out of scope.

## D. Inputs and conflicts noted

- The phase-1 PRD framed the product around Lebanon and the diaspora, with the Ja'fari school in FR-01. Phase 2 keeps Lebanon but Sunni only, and defers Ja'fari (owner decision, 2026-11-16).
- Report 2 called the French locale legacy. A live check on 2026-11-16 found `/fr/` serving the current product. Re-check the French interview end to end during the copy pass.
- Test fixtures worth reusing (report 1):
  - SAR 720,000 ordinary estate
  - a two-death case summing to 864/864
  - the mushtaraka SAR 360,000 case
