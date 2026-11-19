---
title: 'Story 9.5: Add a group of relatives with a count stepper'
type: 'feature'
created: '2026-11-19'
baseline_revision: 'b591a12deef4cde1e4d9f226daf9e0734052e7e0'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
  - '{project-root}/web/AGENTS.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** In the Add relatives panel, a press adds exactly one relative. Entering "4 daughters" takes four presses, four commands and four revisions. FR-4 asks for one add action per group.

**Approach:** Each relationship button in the panel gets a count stepper (minus, count, plus). The count starts at 1. When it is 2 or more, the add press sends one request to the server's existing atomic bulk-add command (`POST /api/v1/case/heirs/bulk/`, `case_commands.bulk_add`) at the current revision. A count of 1 keeps today's single add. The server is unchanged.

## Boundaries & Constraints

**Always:**
- **Stepper UI** (`add-relatives.tsx`). Every relationship entry's pill-row wrapper holds the add button, then a stepper:
  - a minus button, an `<output>` with the count, and a plus button;
  - each button is 44px square (`size-11`), `bg-surface` (or the surface token the panel uses in light and dark), `border border-graphic`, with the standard visible focus ring; the output is `font-bold`;
  - the minus and plus show `−` and `+` as `aria-hidden` glyphs and get localized accessible names: `stepperFewer` / `stepperMore` with `{relationship}` set to the plain relationship term (`messages.relationships[id]`, without the blocked suffix);
  - the output has `aria-live="off"` (an `<output>` is a live region by default, and stepper presses must announce nothing) and is labelled by `stepperCount` with `{relationship}`;
  - logical properties only. In RTL the order follows the document direction, and the glyphs are not mirrored.
- **Count rules.**
  - The count starts at 1 for each relationship and is kept per relationship in the panel's own state.
  - Minimum 1. Maximum = remaining capacity = 50 − the active layer's heir count (passed in as a `remaining` prop), never below 1.
  - At the minimum or the maximum, that button is `aria-disabled="true"` and a press does nothing. It is never natively `disabled`, so it keeps focus. The same holds when the panel is `disabled` (saving or offline) or `atLimit`.
  - When `remaining` falls below a stored count (the family changed elsewhere), the shown count is clamped to `max(1, remaining)`.
  - After a successful add of that relationship, its count resets to 1. After a refusal, conflict or failure, the count is kept.
- **Add press.** `onAdd(relationship, count)`.
  - `count === 1`: exactly today's single add (`addHeir`, `origin: "panel"`). Behaviour and e2e unchanged.
  - `count >= 2`: one `Answer` `{kind: "addHeirs", from, relationship, count}` (or `addHeir` with a `count` field; pick one, keep it one command). `send` calls a new `deps.addHeirs(signal, caseId, revision, relationship, count, layer?)`, which posts `{case_id, expected_revision, heirs: [{relationship, name: null} × count], layer?}` to `/api/v1/case/heirs/bulk/`.
  - `precheck`: when `count` is above the remaining capacity, return the `heirs: limit` panel outcome locally and send nothing. The server stays the authority.
- **Client API** (`web/src/api/case.ts`). New `addHeirs(...)` returning `AnswerResult`, with the same CSRF, 201, 404, 409 and throttle handling as `addHeir`:
  - 201 `{case}` → `saved`.
  - 400 `{error: "over_capacity"}` → `invalid` with errors `{heirs: "limit"}`, which reuses the one-press limit text.
  - 400 `{error: "invalid_input", errors: {"<index>": {field: code}}}` → `invalid` with the field errors of the lowest numeric index. Every item has the same relationship, so the first failing item's reason (for example `relationship: second_father`, `fifth_wife`, `heirs: limit`) explains the refusal.
  - A malformed body → `failed`.
- **Outcomes** go through the existing panel flow (9.3) exactly as a one-press add does:
  - Success adopts the one returned Case (tree, list and preview update together, with no intermediate partial family), keeps the heir form as it was, and keeps focus on `add:<relationship>`.
  - The announcement is one polite message: `heirsAdded` with `{count}` and `{relationship}`, in place of the per-row `heirAdded`.
  - Refusal or limit: one panel `role="alert"` via `errorText`, the accepted family unchanged, focus kept. A relationship or gender refusal triggers the same reread as one-press entry.
  - A same-case 409 adopts the returned Case with `conflictNotice` and does not resend.
  - At 50 heirs the panel shows the same `heirs.limit` text and stops adds, as today.
- **Numbered defaults** stay the client's existing `answers.ts` numbering from the returned rows ("Daughter 1" … "Daughter 4" in the current locale). The bulk items carry `name: null`.
- **Copy:** new `interview` keys in ar, en and fr, recorded in `deferred-work.md` under a "Story 9.5" section for native review:
  - `stepperFewer`: "One fewer {relationship}" / "إنقاص عدد {relationship}" / "Diminuer le nombre ({relationship})";
  - `stepperMore`: "One more {relationship}" / "زيادة عدد {relationship}" / "Augmenter le nombre ({relationship})";
  - `stepperCount`: "Number of {relationship} to add" / "عدد من سيُضاف ({relationship})" / "Nombre à ajouter ({relationship})";
  - `heirsAdded`: "{count} × {relationship} added." / "تمت إضافة {count} × {relationship}." / "{count} × {relationship} ajoutés.".

**Never:**
- Change the server, the bulk command, its contract or the snapshot writers.
- Decide in the browser which relationships may repeat (no per-relationship maximum, no hiding the stepper for father or husband). The server refuses an illegal repeat, and the browser shows its reason.
- Send n single adds in a loop, or apply a partial batch.
- Announce stepper presses, or change existing translations.
- Add positioned adds (9.7), Undo (9.6) or announcement coalescing (9.10).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Four daughters | 2 heirs, Daughter count 4, Add | one POST `/case/heirs/bulk/` with 4 `{relationship:"daughter", name:null}` at rev N; 6 heirs; Daughter 1–4 shown; count back to 1; focus on `add:daughter`; one `heirsAdded` message | — |
| Count 1 | Son, count 1, Add | one POST `/case/heirs/` as today | — |
| Minimum | count 1, press minus | stays 1; minus `aria-disabled` | — |
| Maximum | 47 heirs, Son count 3, press plus | stays 3; plus `aria-disabled` | — |
| Capacity shrank | Son count 5, then 47 heirs | count shows 3 | — |
| Illegal repeat | Father count 2, Add | server 400 `invalid_input` `{"1": {relationship: second_father}}`; the panel alert shows the second-father reason; family unchanged; focus kept | — |
| Over capacity | server 400 `over_capacity` | panel alert with the `heirs.limit` text; unchanged | — |
| Stale revision | bulk add answers 409 conflict | returned Case adopted; `conflictNotice`; no resend | — |
| Stepper presses | plus, plus | no request, and no live-region text | — |
| At 50 | 50 heirs | limit text; add and stepper buttons `aria-disabled` | — |

</intent-contract>

## Code Map

- `api/case_commands.py:148` `bulk_add` -- read-only evidence: 1..50 items, `OverCapacity` when the layer would exceed 50, sequential `_add_heir` so later items see earlier ones, `InvalidInput` with string-indexed field errors, one store. `api/views.py:171-178` maps them to 400 `{error: "over_capacity"}` and 400 `{error: "invalid_input", detail, errors}`; `BulkHeirsView` (`~:230`) returns 201 `{case}`. Route in `api/urls.py`. Server tests `BulkTests` at `api/test_case_commands.py:239` already cover it.
- `web/src/api/case.ts` -- `addHeir:693` (copy its request and response handling), `AnswerResult:625`, `answer()` (400 field-error parsing; a bare `over_capacity` would become `failed` today, so map it explicitly), `HeirFields:206`. Tests in `case.test.ts`.
- `web/src/interview/flow.ts` -- `Answer:562` (`addHeir` with `origin: "panel"`), `precheck` (`~:613`, the local full-layer refusal), `send:749`, `save()` panel handling (`~:857-973`: success adopts the Case, keeps the form, announces `heirAdded`, focuses `add:<id>`; refusal → `PanelOutcome`; a relationship/gender error rereads; conflict adopts and alerts), `Deps` (add `addHeirs`). Tests in `flow.test.ts`.
- `web/src/app/[locale]/interview/add-relatives.tsx` -- the pill-row wrapper per entry (`min-h-11 rounded-node border-graphic`); props `messages, groups, atLimit, disabled, outcome, onAdd`; the `around()` helper for `{relationship}` templates; `aria-disabled` plus a click guard. Add `remaining` and the stepper. Test: `add-relatives.test.tsx`.
- `web/src/app/[locale]/interview/start-case.tsx` -- `~:240`, `~:339`: the wiring of `onAdd`, `atLimit` (`heirLimitReached` over active-layer heirs) and the deps; pass `remaining` and the count.
- `web/src/interview/answers.ts:199` `heirLimitReached`, `:238` the numbered-default helper (unchanged).
- `web/src/i18n/messages.ts` -- interview type `~:79-190`; `heirAdded` at ar `:399`, en `:705`, fr `:1012`; `addRelative` at `:378/:684/:991`. Key parity tests are in `web/src/api/case.test.ts`.
- `web/e2e/interview.spec.ts:339-394` (the add-relatives suite) and `web/e2e/api.ts:77` (the POST heir mock; add a bulk route recording `bulkPosts`).
- `web/e2e/accessibility.spec.ts` -- the existing axe run over the panel.

## Tasks & Acceptance

**Execution:**
- `web/src/api/case.ts` (+ test) -- `addHeirs` and its response mapping: 201, `over_capacity` → `heirs: limit`, `invalid_input` → lowest index errors, 409 conflict → `replaced`, malformed → `failed`.
- `web/src/interview/flow.ts` (+ test) -- the bulk answer, the `precheck` capacity refusal, `send`, the `heirsAdded` announcement, and outcomes identical to the one-press panel (success with focus, refusal keeps the family, conflict without resend).
- `web/src/app/[locale]/interview/add-relatives.tsx` (+ test) -- the stepper: names, the `aria-live="off"` output, min/max/clamp, `aria-disabled` without native disabled, reset after a successful add of that relationship (a prop such as a success key, or a callback result), `onAdd(id, count)`.
- `web/src/app/[locale]/interview/start-case.tsx` -- the wiring.
- `web/src/i18n/messages.ts` -- the four keys in ar, en and fr; `_bmad-output/implementation-artifacts/deferred-work.md` -- a "Story 9.5" copy list.
- `web/e2e/api.ts`, `web/e2e/interview.spec.ts` -- on the mocked API: set Daughter to 4 and Add → exactly one bulk POST with four items and no single POST, four daughters in list and tree, focus on the add button; Father ×2 refused with the alert; plus `aria-disabled` at remaining capacity. `accessibility.spec.ts` stays passing (en and ar).

**Acceptance Criteria:**
- Given a count of n ≥ 2 and room for n, when Add is pressed, then exactly one bulk command at the current revision adds n separately identified heirs, and the tree, list and preview show only the one returned Case.
- Given any refusal (over capacity, an illegal repeat, a stale revision), when it settles, then no heir is added, the panel explains it with the server's reason, and focus stays on the pressed button.
- Given the web unit tests, lint, typecheck, build and the interview and accessibility e2e specs, when run, then they pass, with no new serious or critical axe violations.

## Spec Change Log

## Review Triage Log

### 2026-11-19 — Review pass (all layers on codex; the first blind-hunter run crashed with a codex out-of-memory error while five ran in parallel and was re-run alone at the deep tier)
- verdicts: 25 findings — high 0, medium 0, low 15, false 10, maybe-false 0
- findings:
  - `[low]` `[reject]` (intent) English stepper names read "One fewer/One more {relationship}" where the story says "Fewer/More {relationship}" — the catalogs hold only singular terms, so the spec chose a grammatical equivalent with the same meaning; the copy is in the native-review list.
  - `[low]` `[patch]` (intent) the preview after a bulk add is not asserted — same root as the verification-gap preview row; patched there.
  - `[false]` `[reject]` (intent) the stepper is offered on father, which the engine refuses to repeat — the specified reading ("each allowed relationship"; no browser repeat tables per AD-16); the refusal is shown and tested.
  - `[false]` `[reject]` (intent) Undo of a group is untested — Story 9.6 owns Undo.
  - `[low]` `[patch]` (verification-gap) bulk success leaves the share preview unverified — the four-daughters e2e now serves before/after previews by revision and asserts the returned revision's 7/48 share.
  - `[low]` `[patch]` (verification-gap) the stepper ceiling after an estate switch is untested — a new e2e switches from 47 to 48 heirs and asserts the reset count and the plus `aria-disabled` at 2.
  - `[low]` `[patch]` (verification-gap) stepper presses while frozen are not exercised — the frozen component test now sets 2, freezes, presses minus and plus, and asserts 2.
  - `[false]` `[reject]` (edge-case) the U+2212 assertion fails — the test literal is U+2212 and the test passes.
  - `[low]` `[patch]` (edge-case) a count chosen in one estate carries into another — `AddRelatives` is now keyed by the active layer id; covered by the estate-switch e2e.
  - `[low]` `[reject]` (edge-case) the clamp is display-only, so a larger stored count can return when capacity rises again — the shown count is always what is sent; needs a removal elsewhere between presses, and the fix adds state tracking.
  - `[false]` `[reject]` (edge-case) the flow accepts zero, negative, NaN or fractional counts — the only producer is the stepper, which yields integers 1..remaining.
  - `[false]` `[reject]` (edge-case) `addHeirs` accepts out-of-range counts — same: no caller can pass one.
  - `[false]` `[reject]` (edge-case) an error index outside the batch is accepted — the server indexes only submitted items (`case_commands.bulk_add`).
  - `[low]` `[reject]` (edge-case) a lost bulk response can be retried into a duplicate group — the existing failed-add path rereads the case and shows the stored heirs before any retry, the same behaviour as a one-press add; changing it is outside this story.
  - `[low]` `[patch]` (edge-case) `heirLimitReached` is no longer used in production — deleted with its isolated test.
  - `[low]` `[reject]` (edge-case, claim) a 201 with a minimal case body parses as saved — `parseCase` is the pre-existing parser shared by every write; not changed here.
  - `[false]` `[reject]` (edge-case, claim) a conflict can drop focus or bypass the panel message — the heading fallback when the button disappears and the different-case replacement are the existing 9.3 behaviour; the same-case conflict keeps focus and shows the notice (flow test).
  - `[low]` `[reject]` (blind) the clamp is display-only — same as the edge-case row.
  - `[false]` `[reject]` (blind) non-integer counts reach `Array.from` — unreachable, as above.
  - `[false]` `[reject]` (blind) `precheck` lost its add-only guard, refusing edits at 50 — `precheck` returns early for `saveHeir`, `removeHeir` and the death answers (`flow.ts:616`), so only adds reach the check.
  - `[low]` `[patch]` (blind) the Add button does not convey the selected quantity — each Add button is now `aria-describedby` its count output ("Number of Daughter to add 4"); asserted in the component test and the e2e.
  - `[low]` `[reject]` (blind) "Number of Daughter to add" and the masculine French `ajoutés` read awkwardly — the copy is the spec's and is listed in deferred-work for native review; translations are not changed here.
  - `[false]` `[reject]` (blind) an out-of-batch error index is accepted — same as the edge-case row.
  - `[low]` `[patch]` (blind) a completed add is detected by object identity — now compared by announcement `seq`; a rerender with a fresh object of the same seq keeps the count (component test).
  - `[low]` `[patch]` (blind) the refused-fathers e2e checks only the node count — it now compares the `data-node` ids and the visible heir-list entries before and after.

## Design Notes

**Why the server is unchanged.** The atomic bulk command from Epic 8 (`bulk_add`) already does what the AC asks: one revision, sequential engine checks, all or nothing, capacity enforced. Only the browser lacked a way to call it.

**Why count 1 keeps the single add.** It keeps the 9.3 contract and its e2e coverage exactly as they are, and a single add returns the same Case.

**Why every relationship gets a stepper.** The AC shows a stepper beside each allowed relationship, and AD-16 forbids repeat tables in the browser. A second father is refused by the engine and explained, the same way the one-press path does it.

**Why the stepper names use the singular term.** The catalogs hold one singular term per relationship and no plurals. "One more {relationship}" reads correctly with a singular noun in each locale.

## Verification

**Commands:**
- `cd web && npm test` -- expected: all pass.
- `cd web && npm run lint && npm run typecheck` -- expected: 0 errors; at most 12 lint warnings.
- `cd web && npm run build && npx playwright test e2e/interview.spec.ts e2e/accessibility.spec.ts` -- expected: all pass.
- `uv run python manage.py test api.test_case_commands --noinput` -- expected: pass (unchanged server; a guard that the bulk contract still holds).

## Auto Run Result

Status: done

**Summary:** Each relationship button in the Add relatives panel now has a count stepper (minus, a silent `<output>`, plus). The count starts at 1 and is capped at the active estate's remaining capacity; the buttons use `aria-disabled`, never native `disabled`. A count of 1 keeps the one-press add. A count of 2 or more sends one `POST /api/v1/case/heirs/bulk/` at the current revision; the one returned Case updates the tree, list and preview, one `heirsAdded` message is announced, focus stays on the Add button, and the count resets to 1. Refusals (`over_capacity` → the existing limit text; `invalid_input` → the lowest item's reason; a stale revision → `conflictNotice`) leave the family unchanged, keep the count and keep focus. The server is unchanged.

**Files changed:**
- `web/src/api/case.ts` (+ test): `addHeirs` and the bulk refusal mapping.
- `web/src/interview/flow.ts` (+ test): the `count` on a panel add, the capacity precheck, the bulk send and the group announcement.
- `web/src/interview/answers.ts` (+ test): the unused `heirLimitReached` removed.
- `web/src/app/[locale]/interview/add-relatives.tsx` (+ test): the stepper.
- `web/src/app/[locale]/interview/start-case.tsx`: the wiring, the remaining capacity and the per-estate key.
- `web/src/i18n/messages.ts`: `stepperFewer`, `stepperMore`, `stepperCount`, `heirsAdded` in ar, en and fr.
- `web/e2e/api.ts`, `web/e2e/interview.spec.ts`: the bulk mock and the e2e tests.
- `_bmad-output/implementation-artifacts/deferred-work.md`: the Story 9.5 copy for native review.

**Run history:**
- Codex was over its usage limit at the start (until 15:42); the run waited for it, as the owner asked.
- Codex hit its limit again near the end of implementation (until 20:43), with the code and tests written. The parent verified the partial tree, fixed one e2e locator (the Next route announcer also has `role="alert"`), and waited for codex before review.
- The first blind-hunter run crashed with a codex out-of-memory error and was re-run alone at the deep tier.

**Review:** one pass. 25 findings: high 0, medium 0, low 15, false 10.
- **Patched** (8 entries, all low): counts reset per estate; `heirLimitReached` deleted; completion detected by `seq`; the Add button described by its count; tests for the preview after a bulk add, the ceiling after an estate switch, frozen stepper presses, and the exact family after a refused batch.
- **Deferred:** none.
- **Rejected:** each reason is in the Review Triage Log. Main ones: unreachable count values; the display-only clamp; the pre-existing lost-response retry and case parser; and the copy wording, which waits for native review.

**Follow-up review recommended:** false. No high or medium entries were patched.

**Verification** (on the final tree):
- `npm test`: 563 of 563 pass.
- `npm run typecheck`: clean. `npm run lint`: 0 errors and 12 warnings.
- `npm run build`: OK. A first build crashed with a Node out-of-memory error after compiling, which left a stale build that failed two e2e tests; a clean rebuild fixed it.
- `npx playwright test e2e/interview.spec.ts e2e/accessibility.spec.ts`: 78 of 78 pass.
- `uv run python manage.py test api.test_case_commands --noinput`: 44 tests OK (before the web-only review patches).

**Matrix audit:**
- Four daughters, stepper presses silent: the e2e "adding four daughters…".
- Count 1: the component test (`["son", 1]`) and the 9.3 e2e "one press posts one add".
- Minimum, capacity shrank: the component tests.
- Maximum: the e2e "the plus button stays focused at remaining capacity" and the estate-switch e2e.
- Illegal repeat: the e2e "a refused pair of fathers…" and the `case.test.ts` lowest-index mapping.
- Over capacity: the `case.test.ts` `over_capacity` mapping and the flow precheck test.
- Stale revision: the flow test "a bulk conflict…".
- At 50: the component "at the limit or while frozen…" test and the e2e "at 50 heirs…".

**Residual risks:**
- The new copy awaits native review; "Number of Daughter to add" and the French `ajoutés` are known to read awkwardly.
- The stepper is offered for relationships the engine never repeats (father, husband); the server's refusal explains it.
- A lost bulk response followed by a retry can add the group twice, as one-press adds can add one heir twice; the reread shows the stored family first.
