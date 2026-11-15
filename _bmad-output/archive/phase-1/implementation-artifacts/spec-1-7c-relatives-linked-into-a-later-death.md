---
title: 'Story 1.7c: Relatives Linked Automatically into a Later Death'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: 'c8a2b9565316534a7a4172352fd23c4d90ad32f1'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-7-successive-deaths-manasikhat-in-the-interview.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-7b-successive-deaths-web-interview.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When an heir X is marked as also died, the visitor has to re-enter X's relatives who are already in the case (for example the wife as X's mother, the daughter as X's sister) and link each one by hand. The epic expects them to be linked automatically.

**Approach:** In the same write that marks the death, the server works out how each living person in X's layer is related to X and adds each relative as a linked row in X's new layer. It asks the visitor only when the family data cannot settle the answer. The web shows those questions next to the order question and renders the filled layer, which stays editable.

## Boundaries & Constraints

**Always:**
- **One write.** `POST case/deaths/` stays one atomic write. Marking the death, resolving the order and adding the derived rows either all happen or nothing is stored. All open questions and errors come back together.
- **Who is considered:** every living person with a row in the layer of X's earliest row, except X, that layer's deceased, and anyone who died before X. The person is linked through `same_as`, which points at their earliest row. Order is resolved first, and people whose death comes after X's are included.
- **How a relationship is derived:** each relationship id is a lineage path from the deceased of its layer. For example, `brother` is a son of the same father and the same mother, and `son_of_paternal_brother` is a son of a son of the father only. A row's relationship to X is derived from X's path and the row's path through their shared ancestors. A result that is not one of the 23 relationship ids, or not an heir relationship, adds nothing. A derived row that would fail the layer's kinship rules adds nothing and never refuses the death.
- **Ambiguity rules:**
  - Male deceased with 0 or 1 wife: that wife is the mother of his children, and his children are full siblings.
  - Male deceased with 2 or more wives: the visitor is asked which wife is each child's mother, choosing one of the wives or "none of them".
  - Female deceased: asked once whether her husband (if any) is the father of all her children. Yes means he is their father and they are full siblings. No asks per row: father or not, and full or maternal sibling.
  - When two people descend from someone not in the case, the visitor is asked whether they share that parent. Examples are grandchildren through a son who died earlier, nephews, and cousins.
  - Everything else is certain and is not asked.
- **Questions:** each question offers the derivable relationship ids plus `none`, with a suggested answer. Answers are sent back on the same POST. An answer that is not among the offered options is refused.
- **Editing afterwards:** the filled layer behaves like a hand-built one. Every derived row can be edited or removed.
- A case with no deaths is unchanged.

**Ask First:** Any engine or schema change. Any rule that guesses where these rules say to ask.

**Never:** Deriving through a person who isn't in the case beyond the stated assumptions. Changing an existing row. The lawyer mode, gharqa or legacy pages. Pushing this work.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Child, one wife | Male D: wife W, daughter Da, sons S1, S2, father F; S1 dies | S1's layer: mother=W, sister=Da, brother=S2, grandfather=F; no question | N/A |
| Several wives | Male D: W1, W2, S1, S2, Da; S1 dies | Asked: S1's mother (W1/W2/none); per sibling full or paternal. Answers give the rows; the other wife is not added | Missing answers: `relatives: required` with `questions` |
| Female D | Female D: husband H, S1, S2; S1 dies | Asked once whether H is the father of all of them. Yes: father=H, brother=S2. No: per-row questions | Same |
| Parent dies | Male D: father F, mother M, brother B, son S; F dies | F's layer: wife=M, son=B, son_of_son=S | N/A |
| Grandchildren | D: son_of_son G1, G2; G1 dies | Asked whether G1 and G2 share a father: brother or son_of_uncle/none | Same |
| With order | Second death needs `first` as well as relatives | Both questions come back together; one resend with both settles it | Nothing stored until complete |
| Dead before X | Y died before X | Y not added to X's layer | N/A |
| Bad answer | Answer not among the offered options | Nothing stored | `relatives: invalid` |

</frozen-after-approval>

## Code Map

- `api/anonymous_case.py` -- `RELATIONSHIPS:21` (id -> gender), `_layers:332`, `_rows:338`, `_person:342`, `_store_case:397`, `_order:402`, `mark_deceased:437`, `add_heir:505`, which validates links inline at `:530-545` and creates rows at `:548` (uuid hex). Pull the add validation and insertion into an in-memory helper so `mark_deceased` can add rows before its single save.
- `api/heir_rules.py` -- `SECOND_OF:17`, `MAX_WIVES:25`, `kinship_code:45`, `counts:37`. Reuse it to check each derived row.
- New `api/kinship.py` -- the lineage path of each relationship id, plus `derive(case, x_row) -> (rows, questions)`. Pure, with no session or HTTP.
- `api/views.py` `DeathsView:194`, `CaseWriteView.write:92` -- accept `relatives` and `shared_father`. A 400 for missing answers carries `questions` beside `errors`.
- `api/contracts/interview.json` -- `relatives` codes (`required`, `invalid`) and the question shape.
- `api/tests.py` `InterviewDeathsTests:2414` (`setup_family:2420`, `mark:2426`, `two:2433`). `two` links by hand and now has to rely on the automatic rows.
- `web/src/api/case.ts` `markDeceased:529`, `answer:436` (400 -> invalid; carry `questions`). `web/src/interview/flow.ts` `markDeath:509`, dispatch `:679`, `deathRefused:812`. Add a relatives question on the pattern of the order question. `order-question.tsx` is the UI pattern to copy, and `messages.ts` holds ar/en/fr.

## Tasks & Acceptance

**Execution:**
- [x] `api/kinship.py` + tests -- the paths and `derive`. Every pair of relationship ids and deceased gender gives a certain result, `none` or a question, with no exceptions.
- [x] `api/anonymous_case.py` -- add rows in memory, and extend `mark_deceased(…, relatives=None, shared_father=None)`: order first, then derive, then validate the answers, then add and save once.
- [x] `api/views.py`, `api/contracts/interview.json` -- the new body fields, the `questions` payload and the codes.
- [x] `api/tests.py` -- every matrix row through the API. Existing death tests adjusted only where the automatic rows replace hand links.
- [x] `web/src/api/case.ts`, `web/src/interview/flow.ts`, new `relatives-question.tsx`, `start-case.tsx`, `messages.ts` + tests -- parse `questions`, show them (with the order question when both are open), and resend the answers. ar/en/fr text.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- add an entry for qualified review of the derivation table.

**Acceptance Criteria:**
- Given the first matrix row, when S1 is marked, then the preview equals the 1.7a two-layer fixture with no hand-linked row.
- Given any refused or incomplete mark, when it returns, then the session is unchanged.
- Given a case with no deaths, when all existing tests run, then they pass.

## Design Notes

A path is a list of steps from the deceased of a layer: `father`, `mother`, `child(m/f)`, `spouse`. Full and half siblings differ by which parents they share:
- `brother` = {father, mother}·child(m)
- `paternal_brother` = father·child(m), not through the mother
- `son_of_brother` = brother·child(m)

To relate a row R to X: reverse X's path, join it to R's path, and cancel matching steps. Map the result back to a relationship id from X's side, using X's gender for spouse terms. A step through an unnamed person (a son who died earlier, a brother) becomes a question whenever two rows might go through the same person.

## Verification

**Commands:**
- `DATABASE_URL='sqlite://:memory:' DJANGO_ENV=test .venv/Scripts/python.exe manage.py test api calc` -- expected: all pass.
- `npm run lint && npm run typecheck && npm test && npm run build` in `web/` -- expected: all pass.

## Spec Change Log

- Review, 2026-11-10: three reviewers (Claude, as codex was at its usage limit). No intent gap or spec defect; patches only. Fixed:
  - Malformed `relatives` or `shared_father` is refused as `relatives: invalid` before anything is derived, never as a 500.
  - An answered combination that is impossible, such as two mothers, is refused, not silently dropped.
  - The suggested answer is the likely reading (full sibling, mother, father), not the alphabetical first.
  - The web guards a malformed 400 body and never resends answers to questions that are no longer open.
  - Added: a derivation table test with eight families, malformed-input and two-mothers tests, a test for a layer with no heirs (not ready), and `same_as` gender-mismatch coverage. The death test classes no longer run twice.
  - KEEP: path algebra in `api/kinship.py`, and certain rows that fail validation are skipped silently.

## Suggested Review Order

**Derivation**

- Start here: each relationship as lineage paths from the layer's deceased.
  [`kinship.py:8`](../../api/kinship.py#L8)

- Who is considered, the ambiguity rules and the questions, in one pure function.
  [`kinship.py:103`](../../api/kinship.py#L103)

- Path algebra: shared ancestors cancel; an unnamed shared parent becomes an option.
  [`kinship.py:63`](../../api/kinship.py#L63)

- The suggested answer is the likely reading, not the alphabetical first.
  [`kinship.py:96`](../../api/kinship.py#L96)

**One atomic write**

- Validate the input, resolve the order, derive, check the answers, add the rows, save once.
  [`anonymous_case.py:439`](../../api/anonymous_case.py#L439)

- In-memory add shared with `add_heir`, so derived rows pass the same kinship rules.
  [`anonymous_case.py:557`](../../api/anonymous_case.py#L557)

- The view passes the new body fields; a 400 carries `questions` beside `errors`.
  [`views.py:199`](../../api/views.py#L199)

- The contract: `relatives` codes and the question shape.
  [`interview.json:37`](../../api/contracts/interview.json#L37)

**Web questions**

- Strict parsing of `questions`; a malformed body still returns its error codes.
  [`case.ts:136`](../../web/src/api/case.ts#L136)

- A refusal opens the order question and the relatives questions together.
  [`flow.ts:844`](../../web/src/interview/flow.ts#L844)

- A resend carries only answers to questions that are still open.
  [`flow.ts:703`](../../web/src/interview/flow.ts#L703)

- Several wives collapse into one "who is the mother" select; the other rows each get a select.
  [`relatives-question.tsx:8`](../../web/src/app/[locale]/interview/relatives-question.tsx#L8)

- Wired next to the order question on the heirs screen.
  [`start-case.tsx:279`](../../web/src/app/[locale]/interview/start-case.tsx#L279)

- ar/en/fr text for the questions; ar and fr await native review.
  [`messages.ts:102`](../../web/src/i18n/messages.ts#L102)

**Tests**

- The matrix through the API, atomic refusals and malformed input.
  [`tests.py:2689`](../../api/tests.py#L2689)

- Expected relatives for eight families, including the female yes/no cases.
  [`tests.py:2894`](../../api/tests.py#L2894)
