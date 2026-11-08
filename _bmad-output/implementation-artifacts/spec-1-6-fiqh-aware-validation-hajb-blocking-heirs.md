---
title: 'Story 1.6: Fiqh-Aware Validation + Hajb (Blocking Heirs)'
type: 'feature'
created: '2026-11-07'
status: 'done'
baseline_commit: '5ee0b934207506ea84d4d3edb1aca56b8917db7b'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/web/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A visitor can save a family that cannot exist, such as two fathers, and only learns from a vague "unavailable" in the preview. The add-heir list also gives no sign of which relatives would inherit nothing given the family so far.

**Approach:** One pure rules module on the server decides which relationships are impossible and which are blocked (hajb), and the answer is sent with every case. The server refuses impossible kinship on every write, with an explanation and a suggested correction. Blocked relatives are labelled, never hidden or refused.

## Boundaries & Constraints

**Always:**
- Blocked relatives stay offered and can be saved, because a blocked heir can still change other shares. For example, two siblings blocked by the father still reduce the mother to 1/6. The same family therefore gives the same result in any order of entry. The project owner decided this on 2026-11-08, overriding the epic's "not displayed".
- The frontend holds no fiqh rules. It only reads what the server sends with the case.
- The hajb rules must agree with the engine's `blocked` flags, proven by a test against the engine. The engine stays the authority for shares.
- Saved heirs are never changed or removed by these rules. Saving an heir with an unchanged relationship always passes, so it can be renamed.
- Entered data survives every error, and all errors on the form show together.
- Every message says what is wrong and what to do, in Arabic, English and French. No message assumes the deceased's gender, and kinship messages fit both adding and editing.
- The server decides every save. A check from the case's options in the add form (when a relationship is picked, and on blur) is only advice, so a tab left open never blocks a save on its own.

**Ask First:** Any change to engine rules or refusals. Any schema migration. Any new frontend library. Any new limit beyond those in the matrix.

**Never:** Hiding or refusing a relative for hajb. Jafari hajb rules: a Jafari case labels nothing, because applying Sunni rules would be wrong. Fiqh citations or proof (Story 2.2). A review or calculate step. Pushing this work.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Blocker added | Hanbali: father | Brother, sister and others the engine blocks are labelled "does not inherit with the family so far", and still save | N/A |
| Order independence | Father, mother, 2 brothers, in either order | All saved; the preview gives the mother 1/6 both ways | N/A |
| School differs | Grandfather, Hanbali vs Hanafi | Brother unlabelled under Hanbali, labelled under Hanafi | N/A |
| Block lifted | 2 daughters, then son's son added | Son's daughter labelled, then not | N/A |
| Jafari or no school | Father | Nothing labelled | N/A |
| Second father | Father exists; add father, or edit a son into one | `400`, `relationship: second_father`, suggests editing the existing one; nothing stored | Also on pick and blur in the add form |
| Same for | mother, husband, grandfather | Own code each | Same |
| Fifth wife | 4 wives; add or edit into a wife | `relationship: fifth_wife` | Same |
| Spouse mismatch | Male deceased with husband; female with wife | `husband_of_male` / `wife_of_female`, suggests the other spouse or correcting the gender | Same |
| Edited heir left out | Only father edited to grandfather; 4th wife renamed | Accepted | N/A |
| Kinship over hajb | Father and grandfather, add grandfather | `second_grandfather`; options list it as invalid, not blocked | N/A |
| Gender contradicts saved spouse | Husband saved, deceased changed to male | `400`, `gender: has_husband` (`has_wife` likewise) | Form keeps values |
| Both spouses in an older session | Husband and wife saved | Any gender: `gender: has_both_spouses`, suggests removing one | N/A |
| Unreadable deceased | Edit an heir's relationship when the stored deceased is invalid | `400`, `case: deceased_required`, never `500` | N/A |
| Several issues | Second father and a name too long, on add, on edit, or at the heir limit | All codes together, values kept, focus on the first | N/A |
| Corrected | The refused input fixed and resubmitted | Errors clear, heir saved | N/A |
| Stale tab | Server refuses a relationship | The case is fetched again, so the list and options are current | Refusal message stays |
| Older client or body | Case without `heir_options`, or an unknown code in it | Nothing labelled or flagged by the client; the server still decides | N/A |

</frozen-after-approval>

## Code Map

- `calc/models.py:1040-1560` -- each `get_quote` sets `blocked`. Read-only source for the hajb rules. Conditional blocks depend on `asaba` sisters and paternal sisters, and on daughter counts. `:401` `has_siblings` counts blocked siblings, which is why blocked relatives must stay addable.
- `calc/models.py:378` -- `get_quotes()` sets flags without distributing, so rule tests avoid radd refusals. Set `calc.madhab` and call `clear()` first, as `compute` does. `calc/schools.py:50` `grandfather_blocks_siblings` -- reuse it.
- `api/anonymous_case.py` -- `get()` builds every case response, plus `clean_deceased`, `set_deceased`, `add_heir`, `update_heir`. `_save` writes the raw session dict, so derived keys are never stored. `update_heir` has no deceased guard today.
- `api/preview.py:57` -- `is_impossible`, the 1.5 stop-gap. `HEIR_CLASSES` builds engine rows for rule tests.
- `api/views.py:81` -- `CaseWriteView.write` already rejects non-object bodies and turns `FieldErrors` into `400`.
- `api/contracts/interview.json` -- `errorCodes`, checked from both sides.
- `web/src/api/case.ts:157` `parseCase`, `fetchCase`. `web/src/interview/flow.ts:357,443` `blurField`, `precheck`, and the `invalid` result handling. `web/src/app/[locale]/interview/heir-form.tsx:78` -- the options. `start-case.tsx:387` -- props.
- `web/src/i18n/messages.ts:230` -- `fieldErrors`. `web/src/interview/answers.test.ts:180` -- the code check.
- The scratchpad diff from the reverted first attempt, at `C:/Users/samaw/AppData/Local/Temp/claude/ba9dccb10bfb27ab/60daec2e-a566-438f-a1cc-1bbd018a8ae4/scratchpad/story-1-6.diff`, may be reused where it fits this spec. Its `heir_rules.py` matched the engine on all sampled families.

## Tasks & Acceptance

**Execution:**
- [x] `api/heir_rules.py` -- pure: `counts(heirs)`, `blocked_relationships(madhab, counts)`, `kinship_code(relationship, gender, counts)`, `gender_conflict(gender, counts)` and `is_impossible_family`, with every code a named constant -- the one owner of the rules.
- [x] `api/anonymous_case.py` -- add `heir_options` to `get()`. Enforce kinship only in `add_heir` and `update_heir`, the edited heir left out, and gender conflicts in `set_deceased`. Merge all field errors.
- [x] `api/preview.py` -- make `is_impossible` use the new module, and keep the refusal as a guard for older sessions.
- [x] `api/contracts/interview.json`, new `api/contracts/heir-options-fixtures.json` -- new codes, plus families with their expected `heir_options`, read by Python and TypeScript.
- [x] `api/tests.py` -- cover every matrix row. Assert that every rule code is in the contract. Compare with the engine across a female and a male deceased: every single-heir family under all four schools, a seeded sample of 300 larger families under each school, and directed families (two sisters with and without a paternal brother, two daughters with a son's son, grandfather with sisters and paternal siblings).
- [x] `web/src/api/case.ts`, `case.test.ts` -- parse `heir_options` strictly against the known codes and relationships. Anything malformed or unknown reads as empty.
- [x] `web/src/interview/answers.ts`, `flow.ts`, tests -- add pure `relationshipIssue` for blur in the add form only, and pure `heirOptionLabels` for the list. `precheck` no longer refuses on options. A server refusal of a relationship fetches the case again.
- [x] `web/src/app/[locale]/interview/heir-form.tsx`, `start-case.tsx` -- label blocked options in the add form. The edit form shows plain labels. (A hint below the field saying labelled relatives can still be added was removed on 2026-11-08: shown beside an impossible pick, such as a husband for a male deceased, it read as if that pick were allowed.)
- [x] `web/src/i18n/messages.ts` -- every code's message and the label in all three languages.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- append blur checks in the edit form, browser tests for the add form's labels, native and fiqh review of the new text, and whether a grandmother limit is needed.

**Acceptance Criteria:**
- Given a family with a blocker, when the add form opens, then blocked relatives are labelled, still selectable, and save.
- Given an impossible relationship, when saving, then a message says what is invalid and suggests a correction, and nothing is stored.
- Given any direct API write, when it breaks a kinship rule, then it is refused.
- Given the rules and the engine, when tests run, then every tested family gets the same blocked answer from both.

## Spec Change Log

- Review loop 1, 2026-11-08: review found that hiding and refusing blocked heirs gave wrong shares and depended on entry order. The engine counts blocked siblings toward the mother's 1/6, so a family of father, mother and two brothers gave her 1/3 when the father was entered first. Review also found that blocks a later relative can lift trapped the visitor. The project owner chose to allow every blocked relative and label it. The intent, the matrix and the tasks were rewritten, and the code was reverted. Other fixes taken in: a deceased guard in `update_heir`; no local refusal and a fetch after a server refusal; strict codes; wording that is neutral in gender and fits both add and edit; `has_both_spouses`; and tests for edits, the exclusion of the edited heir, kinship over hajb, merged errors and directed engine families. KEEP: a pure rules module checked against the engine; `heir_options` computed in `get()` and never stored; kinship checked before hajb; errors merged; an unchanged relationship always passing; the edited heir left out of its own check.

## Design Notes

**Case shape:** computed in `get()`, never stored.

```json
"heir_options": {
  "blocked": ["brother", "sister"],
  "invalid": { "father": "second_father", "husband": "husband_of_male" }
}
```

A relationship in `invalid` is never also in `blocked`.

**Why the server sends it:** the conditional blocks depend on `asaba` sisters, and two copies of that logic would drift.

**Why the edit form is different:** the options describe adding to the whole family, but an edit leaves that heir out. So the edit form shows no labels and no blur checks, and the server checks on save.

**Cost:** the rules are pure and run on counts, adding no queries to any response.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` in `web/`, then `node scripts/check-export.mjs` -- expected: all pass.
- `DATABASE_URL='sqlite://:memory:' DJANGO_ENV=test .venv/Scripts/python.exe manage.py test` -- expected: all pass.

**Manual checks:**
- In the built export, Arabic at 320px and English at desktop: add father and see the labels, add a brother anyway, remove the father and see the labels go, trigger second father, change gender with a spouse saved, and fix each error by keyboard.

## Suggested Review Order

**The rules**

- Start here: the hajb answer for adding one relative, by counts, never hiding anyone.
  [`heir_rules.py:182`](../../api/heir_rules.py#L182)

- Mirrors the engine's `get_quote` order; residuary sisters decide the conditional blocks.
  [`heir_rules.py:114`](../../api/heir_rules.py#L114)

- Impossible kinship, the only thing a write refuses.
  [`heir_rules.py:41`](../../api/heir_rules.py#L41)

- Deceased gender against saved spouses, including both spouses from older sessions.
  [`heir_rules.py:56`](../../api/heir_rules.py#L56)

**Enforcement and the case shape**

- Computed on every read and never stored; kinship wins over hajb.
  [`anonymous_case.py:201`](../../api/anonymous_case.py#L201)

- Edit leaves the heir out, passes an unchanged relationship, guards an unreadable deceased.
  [`anonymous_case.py:343`](../../api/anonymous_case.py#L343)

- Add merges field, kinship and limit errors into one response.
  [`anonymous_case.py:310`](../../api/anonymous_case.py#L310)

- The preview's stop-gap now reads the same rules.
  [`preview.py:54`](../../api/preview.py#L54)

**The client**

- Strict parse: anything unknown or contradictory reads as nothing flagged.
  [`case.ts:181`](../../web/src/api/case.ts#L181)

- A refusal fetches the case again, so a stale tab gets current.
  [`flow.ts:676`](../../web/src/interview/flow.ts#L676)

- Advice on pick and blur for the add form only; the server decides every save.
  [`answers.ts:157`](../../web/src/interview/answers.ts#L157)

- Labels blocked options in the add form, plain labels in the edit form.
  [`heir-form.tsx:51`](../../web/src/app/%5Blocale%5D/interview/heir-form.tsx#L51)

- The label text; Arabic and French still need native review.
  [`messages.ts:182`](../../web/src/i18n/messages.ts#L182)

**Tests**

- Rules versus the engine's `blocked` flags, single, sampled and directed families.
  [`tests.py:1562`](../../api/tests.py#L1562)

- The reason for the redesign: the mother gets 1/6 in any entry order.
  [`tests.py:1748`](../../api/tests.py#L1748)

- Families with expected options, read by both Python and TypeScript.
  [`heir-options-fixtures.json:1`](../../api/contracts/heir-options-fixtures.json#L1)
