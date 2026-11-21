---
title: 'Story 9.8: Open and edit later-death estates with a breadcrumb'
type: 'feature'
created: '2026-11-21'
baseline_revision: '20071249af3216c02e73f7386d124a804f7afcb8'
status: 'done'
review_loop_iteration: 1
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
  - '{project-root}/web/AGENTS.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Later deaths exist in the data model, and the old "Also died" row action, its order and relatives questions, and an always-visible estate switcher already work. But the edit sheet cannot mark a later death. A died-later card only selects itself. The breadcrumb shows at the root, sits above the whole grid and does not focus the tree. The Share preview shows beside a later estate, where it only clutters the tree and Add relatives. Nothing stops the user from trying a third later death. FR-3, AD-16/20 and UX-DR19/25/32/33/34/57/58/59 ask for one route: mark the death in the edit sheet, open the person's own estate from the card, the row or the sheet, and return through a breadcrumb.

**Approach:**
- Reuse the existing mark-death command (`POST /api/v1/case/deaths/`). An additive `empty: true` creates the estate with no derived relatives.
- Scope the existing tree, list and Add relatives to the active estate. The Share preview shows only at the root, and stays "not ready" until every later estate has heirs, as today (owner decision, 2026-11-21).
- Rework `death-breadcrumb.tsx` into the "Estate level" navigation above the canvas.

## Boundaries & Constraints

**Always:**
- **Server, `mark_deceased` (`api/anonymous_case.py`) via `DeathsView`:**
  - The new body key `empty` is optional.
    - A missing key, or `false`, keeps today's behaviour byte for byte.
    - Any other non-`true` value raises `FieldErrors({'empty': 'invalid'})`.
    - `empty: true` together with a `relatives` or `shared_father` key, even an explicit JSON `null`, raises `relatives: invalid`. Key presence counts, not the value.
  - With `empty: true`, `derive` is never called. No relatives are added and no questions are returned. The limit, `already_deceased`, `_order` (including `order_required` and its `first` answer), the revision, atomic rollback and the 201 whole-Case response are unchanged.
  - Add `empty: invalid` to `api/contracts/interview.json`.
- **Preview readiness is unchanged.** `api/preview.py` and `previewReady` are not touched. A case with an empty later estate stays `not_ready` until every later estate has heirs.
- **Client data:** `markDeath` in `web/src/api/case.ts` sends `empty: true` only when asked.
- **Edit sheet (`edit-sheet.tsx`):**
  - **The later-death choice.** The status group gains a third radio, `statusDiedLater`. It is shown for any non-deceased person whose status is `alive`, in any estate. The died-before radio stays root-only.
  - When the Case already holds two later deaths, that radio is not rendered and the text `laterDeathLimit` shows in its place. Existing died-later people are unaffected.
  - **Choosing it** dispatches flow `markDeath` with `origin: "sheet"`, which sends `empty: true`. If the sheet's name field holds an uncommitted edit, that name is saved first through the existing name save. The death command is sent only after that save succeeds, so a typed name is never lost.
    - On success the sheet stays open on that person. The active estate does not change. Focus moves to the sheet's "Open own estate" button (`data-focus="openEstate"`). One Undo entry is recorded. The polite announcement is `laterDeathAddedMale` or `laterDeathAddedFemale`, chosen by the person's gender.
    - An order refusal renders the existing `OrderQuestion` inside the sheet. Choosing an answer resends with `first`, `origin: "sheet"` and `empty: true`. Cancelling it changes nothing and focuses the later-death radio (`editStatus:died_later`).
    - Any other refusal, including `death: limit`, shows a `role="alert"` in the sheet. Focus stays on the radio, and nothing changes.
  - **For a died-later person,** the status group stays hidden as today. Instead the sheet shows a 44px accent button `openOwnEstate` (`data-focus="openEstate"`). It opens that person's estate.
- **Opening an estate.**
  - These all go through one flow action, the existing `openLayer`:
    - tap or Enter on a died-later tree card;
    - the Heirs-row action (relabel today's "Open their heirs" to `openOwnEstate`; keep `heirOpenLayer` in the catalog);
    - the sheet button;
    - a breadcrumb link.
  - When the target is a tree or breadcrumb level, `openLayer` closes editing and focuses the tree heading. The `<h3>` gets `tabIndex={-1}` and `data-focus="treeHeading"`, and its text names the estate: the existing `deathLayerLabel`, or `treeHeading` at the root.
  - The Heirs-row Edit action remains the way to edit a died-later person. The card no longer opens the sheet or only selects itself.
- **Breadcrumb (`death-breadcrumb.tsx`):**
  - A `<nav aria-label={estateLevel}>` rendered inside the tree section, directly above the canvas. It is absent at the root.
  - Its levels run root → … → active. The parent of a died-later level is the highest-order earlier later death whose estate holds a row of that person, otherwise the root. That makes at most three levels.
  - Earlier levels are accent links (`<a href="#">`/buttons styled as links, min 44×44px). The current level is semibold, non-link text with `aria-current="page"`. Separators are aria-hidden inline-SVG chevrons with `rtl:-scale-x-100`.
  - One activation opens that level through `openLayer` and focuses `treeHeading`.
  - The breadcrumb above the grid is removed.
- **Share preview (owner decision, 2026-11-21):**
  - At the root it renders exactly as today.
  - While a later estate is open, the preview panel is not rendered at all: no heading, rows or placeholder. The tree and list use the space. Returning to the root shows it again. The results page keeps showing every heir.
- **Labels in a later estate:** the tree cards and Heirs rows label each person by their relationship to that later deceased: the relationship stored on the later estate's own row, through `treeDescription`. They never use the person's first-estate relationship. For example, the first deceased's wife, entered as "Mother" in her son's estate, reads "Mother" there.
- **Reconciliation:** removal, cascade confirmation, Undo and conflicts keep the existing `keepLayer` (fall back to the root when the active estate is gone) and the 9.4/9.6 focus rules. Focus never stays inside a removed estate.
- **Copy:** new `interview` keys in ar, en and fr, plus `fieldErrors.empty.invalid`. List them all in `deferred-work.md` under "Story 9.8" for native review.

| key | en | ar | fr |
|---|---|---|---|
| `statusDiedLater` | Died after the deceased, before division | توفي بعد المتوفى وقبل القسمة | Décédé après le défunt, avant le partage |
| `laterDeathLimit` | A case can hold up to two later deaths. | يمكن أن تتضمن الحالة وفاتين لاحقتين على الأكثر. | Un dossier peut comporter au plus deux décès ultérieurs. |
| `openOwnEstate` | Open own estate: {heir} | افتح التركة المستقلة: {heir} | Ouvrir la succession propre : {heir} |
| `laterDeathAddedMale` | {heir} died later. Open own estate to add his heirs. | توفي {heir} لاحقًا. افتح تركته المستقلة لإضافة ورثته. | {heir} est décédé plus tard. Ouvrez sa succession propre pour ajouter ses héritiers. |
| `laterDeathAddedFemale` | {heir} died later. Open own estate to add her heirs. | توفيت {heir} لاحقًا. افتحي تركتها المستقلة لإضافة ورثتها. | {heir} est décédée plus tard. Ouvrez sa succession propre pour ajouter ses héritiers. |
| `estateLevel` | Estate level | مستوى التركة | Niveau de succession |
| `fieldErrors.empty.invalid` | That request could not be read. | تعذرت قراءة هذا الطلب. | Cette demande n'a pas pu être lue. |

**Never:**
- Reimplement composition, shares or the later-death limit in the browser.
- Change the PresentedResult contract, notices, the snapshot writers or the stored row shape, or migrate data.
- Add a second preview panel, or any per-estate preview.
- Change `api/preview.py`, preview readiness, or the results, PDF, shared or received paths.
- Remove or alter the existing "Also died" row flow, or its derivation and questions.
- Change existing translations.
- Do 9.9 arrow-key work or 9.10 announcement coalescing.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sheet marks later death | alive son S; `POST deaths {heir_id: S, empty: true}` | 201; `deaths` gains S with `heirs: []`; no derived rows; sheet stays, focus `openEstate`; announcement | — |
| No `empty` key | today's request | byte-identical response to before | — |
| Bad `empty` | `empty: "yes"`, or `empty: true` + `relatives` (also `relatives: null` / `shared_father: null`) | 400 `empty: invalid` / `relatives: invalid`; revision unchanged | sheet alert |
| Typed name then radio | name edited, not yet blurred; radio chosen | name save, then the death command; the Case keeps the typed name | name save refused → no death command |
| Cancel order question | sheet order question open; Cancel | no request; focus `editStatus:died_later` | — |
| Order unknown | 2nd later death, order not inferable | 400 `death: order_required`; OrderQuestion in sheet; resend with `first` | — |
| Third later death | two deaths exist | radio hidden + `laterDeathLimit`; direct POST → 400 `death: limit`, no mutation | — |
| Empty later estate | S marked, estate empty | preview `not_ready`, unchanged | — |
| Open estate | Enter on S's card / row action / sheet button / breadcrumb | layer = S; tree, list and Add relatives scoped; no preview panel; focus `treeHeading` | — |
| Later-estate labels | first wife W is entered as "Mother" in son S's estate | in S's estate, W's card and row read "Mother", never "Wife" | — |
| Breadcrumb | active = death 3 nested in death 2 | 3 levels; root and death 2 are links; current is text | — |
| Remove linked person | S's estate populated with a named person only in it; Remove S from the root row | 409 cascade; the confirmation shows that person's **name** (not an id); cancel changes nothing; confirm → layer root, existing focus rules | — |
| Undo | after confirmed removal of a **populated** estate | restores S, every estate row and edge, with identical ids; focus on the restored card. The server test checks the DELETE succeeded before restoring | — |

</intent-contract>

## Code Map

- `api/anonymous_case.py:646` `mark_deceased` -- add `empty`; `derive` call at `:671`; `_order:611`; limit at `:657`. `api/views.py:329` `DeathsView.post` -- pass `data.get('empty', <sentinel>)`, so that missing differs from an explicit value.
- `api/preview.py` -- read only; do not change.
- `api/contracts/interview.json:39` -- error codes. `api/test_case_commands.py:297-357` -- death limit and cascade tests (the model for new ones).
- `web/src/api/case.ts:719` `DEATHS_URL` and the mark-death call (grep `DEATHS_URL`); add an `empty` option.
- `web/src/interview/flow.ts` -- `Answer:605` `markDeath` (+ `origin?: "sheet"`); `send:835`; `saved:903` (sheet origin: keep layer and `editingHeir`, focus `openEstate`, new announcement); `deathRefused:1056` (sheet origin: alert or order question in the sheet; focus on the radio, `status:died_later`); `openLayer:~392` (add a focus target parameter: `treeHeading` vs `relationship`); `keepLayer` in `web/src/interview/layers.ts:65`; `announce`.
- `web/src/app/[locale]/interview/edit-sheet.tsx:153` -- status radios, the new radio, the limit line, `OrderQuestion` in the sheet, and the "Open own estate" button.
- `web/src/app/[locale]/interview/order-question.tsx` -- reuse as is.
- `web/src/app/[locale]/interview/heir-list.tsx:220-230` -- the `onOpenLayer` label becomes `openOwnEstate`. Hide `onAlsoDied` (`:207`) when `case.deaths.length >= 2`.
- `web/src/app/[locale]/interview/family-tree.tsx:64,95,105` -- died-later card activation calls a new `onOpenEstate(personId)`; the heading `tabIndex`, `data-focus` and estate label; render the breadcrumb slot above the canvas.
- `web/src/app/[locale]/interview/death-breadcrumb.tsx:33` -- the rework; keep `crumbTextOf` if it is still used.
- `web/src/app/[locale]/interview/start-case.tsx:298,341-375,559,629,675` -- remove the top breadcrumb; wire the sheet `markDeath`, the open-estate handlers, and render `SharePreview` only when the active layer is the root; `orderQuestion` currently renders outside the sheet. For sheet origin, pass it into `EditSheet`.
- `web/src/app/[locale]/interview/share-preview.tsx` -- unchanged; `start-case.tsx` decides whether to render it.
- `web/src/interview/tree.ts:190` `estateModel`, `treeDescription` -- the died-later card state already exists (solid accent and badge). Check that later-estate labels come from that layer's own row relationship; add a test with a person who has different relationships in two estates.
- `web/src/i18n/messages.ts` -- the interview type and the ar (`~:462-530`), en (`~:700-850`) and fr (`~:1091-1180`) blocks; parity tests in `case.test.ts`.
- Tests: `web/src/interview/flow.test.ts` (the positioned-add model at `:2282`), `edit-sheet.test.tsx`, `family-tree.test.tsx`, a `death-breadcrumb` test, `tree.test.ts`; `web/e2e/api.ts:36,89` (add a `POST /case/deaths/` mock that records bodies and returns a Case with the death appended, `heirs: []`); `web/e2e/interview.spec.ts:484,603,771,919` (the existing estate, cascade and undo e2e); `web/e2e/accessibility.spec.ts`.

## Tasks & Acceptance

**Execution:**
- `api/anonymous_case.py`, `api/views.py`, `api/contracts/interview.json` -- `empty` on mark-death, as specified.
- `api/test_case_commands.py` -- one test per server matrix row:
  - an empty mark with no derivation, where the family would otherwise derive relatives;
  - no key is unchanged;
  - bad `empty`; `empty` + `relatives`; `empty` + explicit `null` `relatives` / `shared_father`;
  - `order_required` with `empty`, then `first`;
  - the limit refusal with the revision unchanged;
  - an empty later estate keeps the preview `not_ready`;
  - cascade impact lists the later estate's people;
  - removal of a populated later estate (assert the DELETE succeeded), then restore → identical rows, edges and ids.
- `web/src/api/case.ts` (+ test) -- the `empty` body flag.
- `web/src/interview/flow.ts` (+ test) -- sheet-origin `markDeath`: success, refusal, order, cancel (focus `editStatus:died_later`), a dirty name saved first, and focus; one Undo entry; `openLayer` focus `treeHeading`; removal of an open estate falls back to the root.
- `edit-sheet.tsx`, `heir-list.tsx`, `family-tree.tsx`, `death-breadcrumb.tsx`, `start-case.tsx`, `web/src/interview/tree.ts` (+ their tests) -- the UI as specified.
- `web/src/i18n/messages.ts` -- the copy table; `_bmad-output/implementation-artifacts/deferred-work.md` -- the "Story 9.8" copy list.
- `web/e2e/api.ts`, `web/e2e/interview.spec.ts` -- e2e on the mocked API:
  - sheet radio → POST body `{heir_id, empty: true}`, focus `openEstate`, announcement;
  - Enter on a died-later card opens the estate with the breadcrumb and focus on the heading;
  - the breadcrumb returns to the root;
  - at two deaths the radio is hidden with the limit text;
  - in an open later estate there is no Share preview, and a person with a different first-estate relationship shows the later-estate one; back at the root the preview returns;
  - typing a name and then choosing the later-death radio keeps the name (the PUT comes before the deaths POST);
  - removing the linked person shows the **name** of a person found only in that estate in the cascade confirmation; cancel leaves the family unchanged.
- `web/e2e/accessibility.spec.ts` -- axe on an open later estate with the breadcrumb, in en and ar.

**Acceptance Criteria:**
- Given an alive Heir's edit sheet, when "Died after the deceased, before division" is chosen, then one mark-death command with `empty: true` is sent, the sheet stays open with focus on "Open own estate", the card shows the died-later state, and the preview stays not ready until that estate has heirs.
- Given a died-later person, when their card, row action, sheet button or a breadcrumb level is activated, then exactly that estate is active for the tree, list, Add relatives and Add relative here; people are labelled by their relationship to that later deceased; no Share preview is shown; and focus is on the named tree heading.
- Given the server tests, web unit tests, lint, typecheck, build and the interview and accessibility e2e specs, when run, then all pass with no new serious or critical axe violations.

## Spec Change Log

### 2026-11-21 — Owner answers to the intent gap (attempt 1 blocked)
- **Trigger:** the review found that the later-estate preview showed combined shares and first-estate relationships (high, intent_gap).
- **Owner decisions:**
  1. Later-estate people are labelled by their relationship to the later deceased.
  2. No Share preview while a later estate is open; the results page shows every heir.
  3. No preview until every later estate has heirs.
- **Amended (inside and outside the intent contract, by owner decision):**
  - Dropped the pending-estate preview (the server `pending`/`allow_pending` change, `previewReady`, the `estatePending`, `estateInherited` and `estatePreviewEmpty` copy).
  - Hid the preview in later estates.
  - Added the label rule.
  - Folded in the review fixes: explicit-null companions refused; sheet order-cancel focus; a dirty name saved before the death; the cascade confirmation shows names; the populated-estate restore test checks the DELETE.
- **Known-bad state avoided:** combined shares and wrong relationships shown under a later estate's heading, and a partial "available" preview while an estate is empty.
- **KEEP:** start from `spec-9-8-attempt-1.patch`. Keep its `empty` mark-death flag, sheet radio and refusal handling, `openLayer` focus parameter and `treeHeading`, breadcrumb rework with `estatePath`, died-later card activation, heir-row relabel and limit hiding, the e2e deaths mock, and the axe run. Remove its preview/pending pieces.

## Review Triage Log

### 2026-11-21 — Review pass (all five layers in one combined read-only codex call, deep tier; diff 122 kB)
Attempted change saved as `spec-9-8-attempt-1.patch` (applies cleanly to the baseline); code reverted.
- verdicts: 37 findings — high 4, medium 10, low 10, false 3, maybe-false 10
- findings (blind-hunter):
  - `[high]` `[intent_gap]` A later estate's preview filters the combined rows, so an heir in both estates shows the combined fraction, percent and amount under the later estate's heading (`share-preview.tsx` `shownRows`). Confirmed in code. The intent's "that estate's presentation" can mean local entitlements or the estate's people with their final shares. The intent contract chose the second and forbade the PresentedResult change the first would need.
  - `[medium]` `[intent_gap]` The same rows keep their first-estate relationship ("Wife" where she is the later deceased's mother). Same root cause.
  - `[medium]` `[intent_gap]` Cancelling the sheet's order question focuses `openEstate`, which does not exist while the person is alive (`cancelOrder` in flow.ts). Confirmed; moot after revert.
  - `[low]` `[intent_gap]` `empty: true` with explicit JSON `null` `relatives`/`shared_father` is accepted (`views.py` `.get()`). Confirmed; moot after revert.
  - `[maybe-false]` `[intent_gap]` The preview key ignores `pending`, so a stale pending notice can show. Settled by a test that undoes a pending death while a preview is in flight.
  - `[low]` `[intent_gap]` The limit `2` is hard-coded in edit-sheet and heir-list. The server still refuses atomically; this is display only.
  - `[medium]` `[intent_gap]` The scoped-preview e2e asserts only the heading and inherited text, so it would pass with no filter.
  - `[low]` `[intent_gap]` The cascade e2e counts list items, so a raw id would pass.
  - `[low]` `[intent_gap]` The restore test ignores the DELETE response.
  - `[medium]` `[intent_gap]` The restore test snapshots an empty later estate, not a populated one.
  - `[low]` `[intent_gap]` `estatePreviewEmpty` interpolates the label without `bdi`.
- findings (edge-case-hunter):
  - `[low]` `[intent_gap]` Explicit null companions with `empty` — same as the blind row.
  - `[medium]` `[intent_gap]` Sheet order-cancel focus target — same as the blind row.
  - `[maybe-false]` `[intent_gap]` A typed name is lost when the later-death radio is clicked first. Settled by a browser test: type a name, then click the radio.
  - `[false]` `[reject]` An offline died-later card switches estate — opening an estate is navigation, not a write. Offline freezes writes only, and the old breadcrumb was never frozen.
  - `[maybe-false]` `[intent_gap]` A stale pending notice after Undo — same as the blind preview-key row.
  - `[medium]` `[intent_gap]` The tree looks evidence up by the original order, while the server renumbers after a pending death (`tree.ts` `estateModel`), so blocked badges are lost in estate 3 when estate 2 is pending. Confirmed.
  - `[high]` `[intent_gap]` (claim) Combined share and relationship under a single estate heading — same root cause as the first row.
  - `[maybe-false]` `[intent_gap]` (claim) A pending estate shows the whole case's `choose_school`/`unavailable` body. Settled by rendering a pending estate with a school-disagreement fixture.
  - `[medium]` `[intent_gap]` (claim) The scoped-preview e2e is too weak — same as the blind row.
  - `[low]` `[intent_gap]` (claim) The cascade e2e would pass on a raw id — same as the blind row.
- findings (verification-gap):
  - `[medium]` `[intent_gap]` The scoped-preview test cannot tell local shares from combined ones — same as the blind row.
  - `[medium]` `[intent_gap]` No test covers renumbering after an empty estate — same as the tree row.
  - `[low]` `[intent_gap]` No focus assertion on sheet order cancel — same root cause as the cancel row.
  - `[low]` `[intent_gap]` The cascade test passes on a raw row id — same as the blind row.
  - `[maybe-false]` `[intent_gap]` (other) An uncommitted name is lost — same as the edge row.
- findings (intent-alignment):
  - `[high]` `[intent_gap]` The diff implements the "interview-level" reading (filtered combined rows), not the "estate-level presentation" reading. Same root cause as the first row.
  - `[maybe-false]` `[intent_gap]` The restore test covers an empty layer, not the populated family the story describes — same as the blind row.
  - `[false]` `[reject]` The literal `2` contradicts server ownership of the limit — the server still refuses atomically; the UI only hides the choice, which the AC requires.
- findings (cross-story-contract):
  - `[low]` `[intent_gap]` `DeathsView` accepts contradictory explicit nulls — same as the blind row.
  - `[high]` `[intent_gap]` The interview preview misreads estate scope for `available`, `choose_school` and `unavailable` — same root cause as the first row.
  - `[medium]` `[intent_gap]` The tree misreads renumbered evidence — same as the edge row.
  - `[maybe-false]` `[intent_gap]` The results page may show a partial `available` result for a pending family. Settled by checking whether `/results` uses the interview preview endpoint (with `allow_pending`) and what it renders.
  - `[maybe-false]` `[intent_gap]` The settled-preview cache shows an obsolete `pending` — same as the blind preview-key row.
  - `[maybe-false]` `[intent_gap]` `unavailable` with `pending` has no envelope test. Settled by adding a fixture.
  - `[maybe-false]` `[intent_gap]` `choose_school` with `pending` has no envelope test. Settled by adding a fixture.
  - `[false]` `[reject]` A 400 with `errors.empty` has no client test — the server emits it only for a malformed request, which the client never sends (it sends `empty: true` or nothing).
- Count note: the totals count rows by verdict. The four high rows share one root cause (the estate-presentation reading).

### 2026-11-21 — Review pass 2 (after the owner's answers; one combined read-only codex call, deep tier; diff 124 kB)
- verdicts: 36 findings — high 0, medium 16, low 19, false 1, maybe-false 0
- findings (blind-hunter):
  - `[low]` `[patch]` The laterDeath announcement uses the pre-rename name (`saved` reads `from.case`). Fixed: built from the returned Case.
  - `[medium]` `[patch]` A successful name PUT followed by a refused death POST keeps the pre-rename Case and revision. Fixed: the refusal view adopts the Case from the name save (flow test).
  - `[low]` `[patch]` The sheet's order-answer retry drops an uncommitted name draft. Fixed: the draft goes through the same path as the radio.
  - `[medium]` `[patch]` Pending legacy relatives answers are merged into a sheet-origin request, which sends `relatives` with `empty: true`. Fixed: the sheet origin sends no answers (flow test).
  - `[medium]` `[patch]` Unmounting SharePreview in a later estate stops presented evidence, so blocked heirs lose "No share" after an edit. Fixed: it stays mounted but `hidden`.
  - `[low]` `[patch]` The cascade server test accepts any single person. Fixed: it asserts the full `impact`.
  - `[medium]` `[patch]` The restore test has no edge. Fixed: an anchored later-estate heir (writer 2) and an exact edge before and after.
  - `[low]` `[reject]` The cancel e2e does not reopen the estate. Cancel sends no request and the client never mutates the Case locally, so nothing can be dropped.
  - `[low]` `[reject]` The omitted/`false` compatibility test checks only the row count. That path is the untouched legacy derivation, covered by the existing derivation tests.
  - `[low]` `[reject]` The spec's Design Notes contradict the owner decisions. The fix edits the spec; the notes were refreshed by the parent when it finalized the spec, not as a code patch.
- findings (edge-case-hunter):
  - `[medium]` `[patch]` Rename a died-later person, then click "Open own estate": the name is lost. Fixed: the name is saved before the estate opens (test).
  - `[low]` `[patch]` The order answer drops the draft — same as the blind row.
  - `[medium]` `[patch]` PUT ok, POST 429, stale revision — same as the blind row.
  - `[low]` `[patch]` The announcement names the old name — same as the blind row.
  - `[medium]` `[patch]` Legacy answers sent with `empty` — same as the blind row.
  - `[low]` `[reject]` An `already_deceased` refusal turns the sheet into the died-later state and focus misses. This needs a concurrent mark from another tab, and the existing conflict refresh handles the view.
  - `[low]` `[reject]` The card opens an estate offline, but the breadcrumb is blocked only while saving. Both are navigation, and saving is momentary.
  - `[medium]` `[patch]` Unmounted preview evidence — same as the blind row.
  - `[low]` `[patch]` Cascade test count — same as the blind row.
  - `[medium]` `[patch]` Restore edge — same as the blind row.
- findings (verification-gap):
  - `[medium]` `[patch]` No test drives the sheet's real order question. Added an e2e: a 400 `order_required`, then an order choice, with the second POST checked for `first`, `empty: true` and focus on `openEstate`.
  - `[medium]` `[patch]` The partial-success boundary — same as the blind row (flow test added).
  - `[low]` `[patch]` The cascade id-to-name mapping — same as the blind cascade row.
  - `[medium]` `[patch]` The restore test has no edge — same as the blind row.
  - `[medium]` `[patch]` (other) Blocked-badge evidence while the preview is hidden — same as the blind row.
  - `[medium]` `[patch]` (other) Open own estate loses the name — same as the edge row.
- findings (intent-alignment):
  - `[false]` `[reject]` No assertion on the preserved entitlement or the separate-calculation text on results. The owner dropped the preview and separate-calculation work from this story (2026-11-21). The results page's layered presentation is untouched by the diff.
- findings (cross-story-contract):
  - `[medium]` `[patch]` The sheet can send `relatives` with `empty` — same as the blind row.
  - `[low]` `[reject]` No client fixture for `errors.empty`. The client only ever sends `empty: true` or omits it, and `parseErrors` is generic.
  - `[medium]` `[patch]` No full envelope for the order retry — covered by the new order e2e.
  - `[low]` `[reject]` No `empty: null` example. The identity check already refuses null as `empty: invalid`; this would only guard a hypothetical regression.
  - `[low]` `[reject]` No numeric lookalike example — same reason; the identity checks reject `0` and `1`.
  - `[low]` `[reject]` No empty-mode `unknown` example. `_order` runs the same code before the empty branch, and its refusals are tested.
  - `[low]` `[reject]` No empty-mode `simultaneous` example — same reason.
  - `[low]` `[reject]` No empty-mode `order_conflict` example — same reason.
  - `[low]` `[reject]` `already_deceased` sheet refusal — same as the edge row.

## Design Notes

**Why `empty: true` and not `update_heir` status.** The existing mark-death command already owns the limit, the order inference, the `first` answer and atomic rollback. A second route would duplicate them. The AC explicitly asks for an initially empty estate (UX-DR57), while the old row action derives relatives. An opt-in flag keeps both, and keeps the old flow byte-identical.

**Preview (owner decisions, 2026-11-21).** A later estate shows no Share preview. It stays mounted but hidden, so the tree's blocked evidence stays current. The preview remains `not_ready` until every later estate has heirs, and the results page shows every heir.

## Verification

**Commands:**
- `uv run python manage.py test api.test_case_commands api.tests --noinput` -- expected: pass (add the preview test module label if it is separate).
- `cd web && npm test` -- expected: all pass.
- `cd web && npm run lint && npm run typecheck` -- expected: 0 errors; at most 12 lint warnings.
- `cd web && npm run build && npx playwright test e2e/interview.spec.ts e2e/accessibility.spec.ts` -- expected: all pass.

## Auto Run Result

Status: done

**Summary:** Later-death estates can now be marked, opened and navigated from the Interview.
- **Marking a later death.** An alive person's edit sheet offers "Died after the deceased, before division". It sends the existing mark-death command with a new optional `empty: true`, which creates the estate with no derived relatives. The sheet stays open, focus moves to "Open own estate", and a gendered announcement says to open the estate to add heirs.
  - An order question, if the server needs one, appears inside the sheet.
  - A typed name is saved before the death, or before opening an estate.
  - At two later deaths the choice is replaced by "A case can hold up to two later deaths."; the server still refuses a third death atomically.
- **Opening an estate.** A died-later card, the Heirs-row "Open own estate", the sheet button or the breadcrumb opens that estate and focuses its named tree heading. The tree, list and Add relatives are scoped to it, and people are labelled by their relationship to that later deceased.
- **Breadcrumb.** The breadcrumb is now an "Estate level" navigation above the canvas. It is absent at the root and has at most three levels.
- **Share preview.** Per the owner's decisions, the Share preview is hidden (still mounted) while a later estate is open, and stays not ready until every later estate has heirs. Preview code is unchanged.

**Files changed:**
- `api/anonymous_case.py`, `api/views.py`, `api/contracts/interview.json`: the `empty` flag. Companion keys are refused even when null; `empty: invalid` added.
- `api/test_case_commands.py`: `EmptyLaterDeathTests`: no derivation, compatibility, invalid flags, the order answer, the limit, preview `not_ready`, the exact cascade impact, and a populated-estate restore with an edge.
- `web/src/api/case.ts` (+ test): the `empty` option.
- `web/src/interview/flow.ts` (+ test): sheet-origin `markDeath` with the name saved first, refusals on the renamed Case, the order question in the sheet, `openLayer` focus `treeHeading`, and `saveHeir` + `openEstate`.
- `web/src/interview/layers.ts` (+ test): `estatePath`. `web/src/interview/tree.test.ts`: later-estate labels.
- `edit-sheet.tsx`, `family-tree.tsx`, `heir-list.tsx`, `death-breadcrumb.tsx`, `start-case.tsx` (+ tests, new `death-breadcrumb.test.tsx`): the UI.
- `web/src/i18n/messages.ts`, `deferred-work.md`: new ar/en/fr copy, listed for native review.
- `web/e2e/api.ts`, `interview.spec.ts`, `accessibility.spec.ts`: a deaths mock and write log, sheet mark, the order question, card and breadcrumb navigation, the limit, no preview in a later estate, later-estate labels, cascade names, blocked state, and axe in en and ar.

**Run history:**
- Attempt 1 (planning by codex standard, implementation by Sonnet, the `allow_pending` fix by codex light, review by codex deep) was blocked on an intent gap about the later-estate preview. It was saved as `spec-9-8-attempt-1.patch`.
- The owner answered on 2026-11-21; see the Spec Change Log. The attempt was re-applied and reworked by the same Sonnet implementer.
- A second combined codex review (deep) followed. Its patches went to the Sonnet implementer (more than 3 files).

**Review:**
- Pass 1: 37 findings → intent gap (see the log).
- Pass 2: 36 findings: medium 16, low 19, false 1.
  - **Patched** (entries): medium 6 — the name lost on Open own estate, legacy answers sent with `empty`, the stale revision after a rename + refused death, hidden-preview evidence, the restore edge test, and the order-question e2e. Low 3 — the announcement name, the order-answer draft, and the cascade impact test.
  - **Deferred:** none.
  - **Rejected:** cancel-reopen e2e and compatibility-test strength (no reachable defect); stale Design Notes (a spec edit, refreshed); the concurrent `already_deceased` focus and offline breadcrumb (navigation only, rare); results-page assertions (the owner dropped that scope); client `errors.empty` and the null/numeric/unknown/simultaneous/order_conflict envelope examples (the server checks are already strict, and `_order` is shared).

**Follow-up review recommended:** true. More than two medium entries were patched in the last pass. The unverified risk is the new two-write sequence (name PUT, then the death POST or estate open) in `save()`. No reviewer has seen how it interacts with 9.6 Undo: a name saved before a refused death has no Undo entry of its own. Nor has anyone seen the blocked-state e2e, which renames without changing the preview key, so it does not strictly prove that the preview stays mounted.

**Verification** (final tree):
- `uv run python manage.py test api.test_case_commands api.tests.InterviewDeathsTests --noinput`: 82 OK.
- `npm test`: 650/650.
- Lint: 0 errors, 12 warnings.
- Typecheck clean; build OK.
- `npx playwright test e2e/interview.spec.ts e2e/accessibility.spec.ts`: 108 passed (chromium).
- `api/preview.py`, `share-preview.tsx` and `preview.ts` are unchanged from the baseline. No CRLF.

**Residual risks:**
- Only chromium ran. The full calc + api suite was not run (the driver's batch covers it), and `reports` cannot import WeasyPrint on this Windows host.
- The new copy awaits native review.
- The old "Also died" row action remains, with derivation, beside the new empty-estate sheet route.
