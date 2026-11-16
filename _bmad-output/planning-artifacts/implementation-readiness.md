# Implementation Readiness — Phase 2 (Epics 8–20)

**Date:** 2026-11-16
**Verdict:** CONCERNS. Epics 8–13 (wave 1) can start now. Fix the items below with `bmad-correct-course` before Epic 14 starts.

Every FR (1–45, X1) and NFR (1–5, X1–X7) maps to at least one story. No story depends on a later epic, or on a later story in its own epic.

Paths: **E** = `epics.md`, **P** = `prds/prd-mawareeth-2026-11-16/prd.md`, **A** = `architecture/architecture-mawareeth-2026-11-16/ARCHITECTURE-SPINE.md`, **X** = `ux-designs/ux-mawareeth-2026-11-16/EXPERIENCE.md`.

## Before Epic 14 / 15

1. **The removal of the Basis step is placed in wave 2.**
   - FR-15 (E:89) and Story 14.4 (E:2461) remove the Interview Basis step and start every new Case on "compare all four Schools".
   - Wave-1 Story 11.1 adds the after-result School prompt. The shipped Interview, however, still has `web/src/app/[locale]/interview/madhab-selector.tsx`.
   - So wave 1 ships an upfront School choice alongside the new School prompt.
   - Decide whether the Basis-step removal and the compare default move into Epic 11. Re-scope 14.4 to the Country link only, and update the coverage map. *(epics.md)*
2. **The FR-16 worked examples lack their inputs.**
   - Egypt, Story 15.4 (E:2773): the family and branch allocations from fatwa 8330 are missing. Only the totals are recorded.
   - Morocco, Story 15.5 (E:2811): the recipient, the family and the stage base of 49/960 are missing.
   - Transcribe both from their sources into the research digests before Epic 15 starts. *(research)*

## Major

3. **The dependency line at E:694 is wrong.** It says "Epics 9–13 need only 8". The actual dependencies are:
   - 10.3, 11.2 and 11.4 need Epic 9.
   - 12.2 needs Epics 9–11.
   - 14.3 needs Epic 9.
   - 16.1, 16.3 and 16.4 need Epic 11.
   - 18.1 needs 16.2.
   - 20.3 needs 12.4.
   - 20.4 needs 8.9.

   All of these point backward, so the epic order is still safe. *(epics.md)*
4. **Story 12.1 contradicts itself.** E:1926 and E:1931 say the retirement of legacy results and the removal of GA are "open". E:1945 and E:1950 record both as decided on 2026-11-16, including Cloudflare Web Analytics. That decision is missing from P (FR-44/FR-31) and from A:427. *(epics.md, PRD, architecture)*
5. **Some decisions are recorded only in epics.md:**
   - Legacy and guest Cases default to SAR with explicit=true (E:1062, E:2896).
   - Contact limits: 5/hour, 3 seconds, 5,000 characters (E:2164).
   - Free API limit of 60/hour (E:3661). PRD §11 Q9 still lists it as open.
   - Locale choices (E:3372).
   - The Urdu font is a three-way conflict:
     - E:3237 says Naskh or Nastaliq, and leaves the choice to the owner.
     - E:3262 says Naskh.
     - A:346 says Nastaliq.
     - DESIGN.md:46 and DESIGN.md:390 list it as open.

   Record these in the PRD, the architecture and DESIGN.md.
6. **No story moves the DRF throttles to the shared PostgreSQL store**, which AD-23 requires (A:249). Add this to 13.1, to 20.3 or to an Epic 8 story. *(epics.md)*
7. **Some FR-44 events have no story that emits them.** "Ticket opened and first reply" and "Basis chosen by preset" have none (12.4 defers them, E:2031–2037). SM-C2 (P:608) needs delete and Undo events that FR-44 doesn't list. *(epics.md, PRD)*
8. **The Obligatory-bequest prompt conflicts across documents.**
   - PRD UJ-1 (P:80) says an ignored prompt remains, and FR-14 doesn't mention dismissal.
   - AD-19/20, UX-DR46 and Story 15.6 add a "Not now" dismissal, but its Undo and reset rule is open (E:2859). *(PRD, epics.md)*
9. **Story 8.12 (purge 1,145 empty legacy drafts) traces to no requirement.** It traces only to `deferred-work.md:284`, which says "Decide what to do". Record the owner's decision there. *(deferred-work, epics.md)*

## Minor

10. Some stories still carry stale "open/ASSUMPTION" lines next to recorded decisions:
    - 20.3: E:3632 against E:3661.
    - 13.1: E:2156 against E:2164.
    - 12.4: E:2054 against E:2059.
11. X:172 and X:288 still say the PRD must drop the Basis step. The PRD already does this (P:72, P:284).
12. Ownership of FR-6 is blurred. Stories 9.4 and 9.7 already mark "died before" and add grandchildren, while Story 14.3 claims the predeceased-child marker.
13. No story cites UX-DR26 (badge-no-share) by ID, although stories at E:964 and E:1192 contain its text.
14. Open items that block no wave-1 story:
    - The Arabic label for a female deceased (X:290).
    - The notice wording for Jordan, the UAE and Algeria (E:3093).
    - The 2027-01 re-check under NFR-X5 is scheduled only for Morocco. Egypt and Kuwait are not covered.
    - The deferred-work privacy items.

## Not findings

- The owner gate before country presets go live (FR-22, AD-17).
- The `[TO CONFIRM]` markers for statutes. These are go-live blockers, not story blockers.
