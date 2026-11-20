---
title: 'Story 9.7: Add relatives at a chosen node by touch, keyboard or drag'
type: 'feature'
created: '2026-11-20'
baseline_revision: '1199cd83c9ce45c7c83046a4bf2e7d08ad7ab995'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
  - '{project-root}/web/AGENTS.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The tree shows lineage (9.1b, 9.2), but nothing can create it. Every add hangs from the deceased. A user cannot say "this grandson is Karim's son", the parent/spouse placeholders are inert text, and there is no drag. FR-2, AD-16 and UX-DR21/23/29/33 ask for positioned adds by touch, keyboard and pointer drag. All three paths go through one command, and only the engine decides what is legal.

**Approach:**
- The existing add command (`POST /api/v1/case/heirs/`) takes an optional `anchor`: a person id from the active estate's engine `placement`, or `"root"`. The server checks the relationship against that anchor's placement at the current revision. For a non-root anchor it also records one lineage edge.
- The browser gets one shared "Add relative here" chooser. It appears in an action row under the tree for the current card, in the edit sheet, and on the placeholders.
- The Add relatives buttons become pointer-drag sources. A drop on a card or placeholder sends the same positioned add.

## Boundaries & Constraints

**Always:**
- **Server, `anonymous_case._add_heir` (via `add_heir`/`HeirsView`):**
  - A missing `anchor` key keeps today's behaviour byte for byte.
  - When `anchor` is present, it must be a string key of the active layer's placement: `case['placement']` for the first estate, or that death's `placement`, as computed for the live case before the change. Its entries must include the canonical requested `relationship`.
  - Otherwise raise `FieldErrors({'anchor': 'not_allowed'})`. Collect it with the other field errors, as today. That covers an unknown anchor, a non-string anchor, a relationship that is not listed, an anchor sent together with `same_as`, and a slot the engine no longer offers at this revision. Nothing is mutated.
  - **Edges**, from the matched entry's `link`. The orientation follows `engine/placement.py`'s docstring:
    - anchor `"root"`: no edge;
    - `child`: `{kind: 'parent_of', from: anchor, to: new_id}`;
    - `parent`: `{kind: 'parent_of', from: new_id, to: anchor}`;
    - `spouse`: `{kind: 'spouse_of', from: anchor, to: new_id}`.
  - Append the edge to `case['edges']`. Create that list when it is absent.
  - When an edge is needed and `api.snapshots.write_version() == 1`, raise `FieldErrors({'anchor': 'schema_unsupported'})` before any mutation. This mirrors `update_heir`'s `status: schema_unsupported`.
  - Capacity, kinship checks, revision handling, the 201 response and the whole-Case body are unchanged.
  - Bulk add (`/case/heirs/bulk/`) does not take `anchor`.
- **Placement entries gain `gender`** (additive): `_placement` in `anonymous_case.py` adds `'gender': RELATIONSHIPS[candidate]` ('male'|'female') to every entry, for the case and each death. `PlacementOption.gender?: Gender` in `web/src/api/case.ts`; `parsePlacement` accepts the key (keeps it when it is `male`/`female`, otherwise reads the entry without it) and still treats every other malformation as before. Nothing else in the Case changes.
- **Engine only:** legality comes from `placement` (server) and the Case's `placement` (browser). No kinship or relationship table is added in `api/` or `web/`.
- **Client API:** `HeirFields.anchor?: string`, sent only when set. In `flow.ts`, the `addHeir` answer gets `anchor?: string` and `origin?: "panel" | "tree"`. A positioned add is always one person (no `count`) and goes through `deps.addHeir`, adding `layer` as today.
- **Outcome of a positioned add (`origin: "tree"`):**
  - A refusal, conflict, failure or throttle is kept on the view (like `PanelOutcome`) and shown as a `role="alert"` in the tree action row, or in the edit sheet when it came from there. Focus stays on the pressed control.
  - A success adopts the Case, pushes exactly one Undo entry (the existing addHeir rule) and focuses `card:<new row id>`. That id is the active layer's row that is absent from the prior Case. The announcement is the existing `heirAdded` polite message.
- **Shared chooser component** (new `add-here.tsx`), for an anchor (a person id or `"root"`) in the active estate:
  - A 44px accent button labelled `addRelativeHere`. It has `aria-expanded` and `aria-controls` and `data-focus="addHere"`. The label is identical everywhere.
  - Expanding shows a `role="group"` labelled `addHereGroup` with `{person}` = the card's label. It holds one 44px button per placement entry, in server order, labelled with `messages.addRelative`. Blocked entries use the `heirOptionLabels` blocked text and stay addable. Each has `data-focus="addHere:<relationship>"`.
  - With no entries it shows `addHereNone`.
  - Space/Enter or a tap on an option submits it. Escape collapses and focuses the toggle.
  - Everything is `aria-disabled` while frozen (saving or offline) or at the 50-heir limit (it then shows `fieldErrors.heirs.limit`).
- **Where the chooser appears:**
  1. The **card action row**: directly after the canvas scroll region, inside the tree section, for the tree's current card. That card is the selected or focused one, otherwise the deceased. The row collapses when the current card changes, and Tab from the card reaches it next.
  2. The **edit sheet** (`edit-sheet.tsx`): in its non-confirmation content, for the edited person, in every person state.
  3. The **placeholders** (`family-tree.tsx`, `placeholders()`): they become native 44px+ buttons with a dashed accent edge, keeping their labels and `data-focus="placeholder:<link>"`. Activating one opens the chooser for anchor `"root"`, filtered to that `link`.
- **Pointer drag** (pointer events, not HTML5 DnD, so mouse, pen and touch all work; nothing needs press-and-hold):
  - The accent relationship buttons in `add-relatives.tsx` are the chips. A press that moves more than 6px starts a drag carrying that relationship, and the click after a drag is suppressed. A plain tap still adds via the panel, as today.
  - While dragging, every card and placeholder is marked from the Case placement only, through a pure helper in `web/src/interview/tree.ts`. Legal targets get a 2px accent edge and the visible plate `dropHere`. Illegal ones get a readable dim pair (`bg-surface text-muted`, never `opacity`) and the plate `dropNotHere`.
  - Releasing over a legal target sends one positioned add (anchor = that card's `personId`, or `"root"`; one person).
  - Releasing over an illegal target sends nothing, leaves focus where it was, and shows the alert `notAllowedHere` with `{reason}` = `positionNotAllowed`, where `{relationship}` is the localized term.
  - Releasing elsewhere, or a cancelled pointer, does nothing.
  - Drag never changes canvas panning on the canvas itself.
- **Copy:** new `interview` keys in ar, en and fr, plus `fieldErrors.anchor`. List all of them in `deferred-work.md` under "Story 9.7" for native review.
  - `addRelativeHere`: "Add relative here" / "أضف قريبًا هنا" / "Ajouter un proche ici"
  - `addHereGroup`: "Relatives to add to {person}" / "الأقارب الذين يمكن إضافتهم إلى {person}" / "Proches à ajouter à {person}"
  - `addHereNone`: "No relatives can be added here." / "لا يمكن إضافة أقارب هنا." / "Aucun proche ne peut être ajouté ici."
  - `dropHere`: "Drop here" / "أفلت هنا" / "Déposer ici"
  - `dropNotHere`: "Not allowed" / "غير مسموح" / "Non autorisé"
  - `notAllowedHere`: "Not allowed here: {reason}" / "غير مسموح هنا: {reason}" / "Non autorisé ici : {reason}"
  - `positionNotAllowed`: "{relationship} cannot be added at this person." / "لا يمكن إضافة {relationship} عند هذا الشخص." / "Impossible d’ajouter {relationship} à cette personne."
  - `fieldErrors.anchor.not_allowed`: "That relative can no longer be added there." / "لم يعد من الممكن إضافة هذا القريب هناك." / "Ce proche ne peut plus être ajouté à cet endroit."
  - `fieldErrors.anchor.schema_unsupported`: "This case cannot record who a relative belongs to yet." / "لا يمكن لهذه الحالة تسجيل من ينتمي إليه القريب بعد." / "Ce dossier ne peut pas encore enregistrer à qui un proche est rattaché."

**Never:**
- Add a browser relationship-validity table, a new relationship class or a Country rule. Never guess edges for existing relatives.
- Change the bulk command, `restore`, the snapshot writers or the stored row shape, or migrate data.
- Add a keyboard drag pick-up (Space/Enter only press buttons), long-press, or positioned bulk adds.
- Add estate breadcrumb work (9.8), new arrow-key navigation (9.9) or announcement coalescing (9.10).
- Change existing translations.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Root anchor | add `{relationship: son, anchor: "root"}` | 201; one son, no new edge; same body as an add without anchor | — |
| Child of son (writer 2) | son S alive; `{relationship: son_of_son, anchor: S}` | 201; edge `parent_of S→new`; tree draws new card under S | — |
| Died-before son (AC4, writer 2) | S `died_before_or_with`; "Add son of son" chosen at S's "Add relative here", or a Son chip dropped on S (resolved by `dropEntry`) | both send `{relationship: son_of_son, anchor: S}`; edge `parent_of S→new`; new person in the son_of_son line; one Undo entry | — |
| Placement gender | any Case read | every placement entry has `gender` matching its relationship | — |
| Parent link | father F; `{relationship: grandfather, anchor: F}` (writer 2) | edge `parent_of new→F` | — |
| Writer 1 | non-root anchor | 400 `errors.anchor: schema_unsupported`; revision and family unchanged; localized alert | no retry |
| Not offered | `{relationship: son, anchor: S}`, unknown anchor, or anchor + `same_as` | 400 `errors.anchor: not_allowed`; no mutation | alert, focus kept |
| Stale slot | slot gone at current revision (e.g. father now present) | 400 `not_allowed`, or 409 for a stale revision | existing conflict path |
| Later estate | anchor is a heir of death 2's estate (writer 2) | checked against `deaths[n].placement`; edge recorded | — |
| Placeholder | empty estate; activate "+ Add parent", choose Father | POST `anchor: "root"`; focus `card:<new id>` | — |
| Illegal drop | drag Son chip onto a daughter card | no request; alert "Not allowed here: Son cannot be added at this person."; focus unchanged | — |
| Undo | after a positioned add, Undo | one restore; person and edge gone | — |

</intent-contract>

## Code Map

- `api/anonymous_case.py` -- `add_heir:742` / `_add_heir:751`: validation, `same_as` checks and errors collected into `FieldErrors`; add the anchor check and the edge here. `_add_heir` is also called for derived additions: the anchor comes only from `data`, so those callers are unaffected. `_describe:511` sets `case['placement']` and each `death['placement']`. Check whether the case from `_live` is already described; if not, compute the placement the same way with `placement_options`. `_save:410` drops `placement`, keeps non-empty `edges` and calls `ensure_writable`. `update_heir:798` is the model for the `schema_unsupported` check (`write_version()` from `api.snapshots`). `_read_edges:245`, `EDGE_KINDS`. `remove_heir:864` / `_remove_rows:686` already prune and remap edges.
- `engine/placement.py:1-30` -- the `ANCHORS` table and the edge orientation. Read only.
- `engine/queries.py:107` `placement_options` -- read only.
- `api/views.py:230` `HeirsView` -- unchanged route; it goes through `respond_to_command`.
- `api/test_case_commands.py` (or `api/tests.py` beside the existing add tests) -- the new server tests. Use `override_settings(SNAPSHOT_WRITE_VERSION=2)` for edge cases. The died-before setup can come from `update_heir` with status under writer 2.
- `web/src/api/case.ts:695` `HeirFields`, `addHeir:728`, `Placement` / `PlacementOption` (`:89`, `:163`).
- `web/src/interview/flow.ts` -- `Answer:578` (`addHeir`), `isPanel`/`panelView` (`~:603`, the model for the tree outcome), `send:774`, the `saved` focus handling, `historyOf`.
- `web/src/interview/tree.ts` -- `estateModel:189` (`TreePerson.personId`, `placement`), `placeholders:248`. Add the pure drop-legality helper here.
- `web/src/app/[locale]/interview/family-tree.tsx` -- the cards (`card()`), the `current` card, the placeholders (`:46`, the divs at the end), canvas pointer panning (keep it separate from chip drags).
- `web/src/app/[locale]/interview/add-relatives.tsx` -- the accent relationship buttons become drag sources. `heirOptionLabels` gives blocked labels.
- `web/src/app/[locale]/interview/edit-sheet.tsx` -- add the chooser to the non-confirmation content.
- `web/src/app/[locale]/interview/start-case.tsx:564-625` -- the `AddRelatives` / `FamilyTree` / `EditSheet` wiring and `submit()`. Wire the positioned add and share the drag state between the panel and the tree.
- `web/src/app/[locale]/interview/form-bits.tsx:12` `errorText` -- `fieldErrors.<field>.<code>`.
- `web/src/i18n/messages.ts` -- the interview type and the ar/en/fr blocks (`fieldErrors.status.schema_unsupported` at ar `:462`, en `:776`, fr `:1091`). Key-parity tests are in `case.test.ts`.
- `web/e2e/api.ts:79-102` -- the heirs POST mock (records posts); `web/e2e/interview.spec.ts`, `web/e2e/accessibility.spec.ts`.

## Tasks & Acceptance

**Execution:**
- `api/anonymous_case.py` -- implement the anchor validation and edge recording as specified.
- `api/test_case_commands.py` -- existing placement assertions (9.1b tests in `api/`, `calc/`) gain the additive `gender`; one test per server matrix row:
  - root anchor;
  - child edge;
  - died-before anchor;
  - parent edge;
  - writer 1 refusal, with the revision unchanged;
  - not offered, unknown anchor, and anchor with `same_as`;
  - a stale slot;
  - a later estate;
  - restore after a positioned add;
  - no `anchor` key gives the same response as before.
- `web/src/api/case.ts` (+ test) -- `HeirFields.anchor`, and the body carries `anchor` only when set.
- `web/src/interview/tree.ts` (+ test) -- the drop-legality helper: a card and a placeholder, legal and illegal.
- `web/src/interview/flow.ts` (+ test) -- the positioned add, its outcome and focus, and one history entry.
- `web/src/app/[locale]/interview/add-here.tsx` (new, + test) -- the chooser.
- `family-tree.tsx`, `edit-sheet.tsx`, `add-relatives.tsx`, `start-case.tsx` (+ the existing tests updated) -- the action row, the placeholder buttons, the chips, the drop targets and the wiring.
- `web/src/i18n/messages.ts` -- the copy above.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- the "Story 9.7" copy list.
- `web/e2e/api.ts`, `web/e2e/interview.spec.ts` -- e2e on the mocked API:
  - keyboard: focus a card, Tab to "Add relative here", Enter, choose → one POST with `anchor`, and focus on the new card;
  - touch: a `hasTouch` tap path → the same POST body;
  - mouse drag of a chip onto a legal card → the same POST body;
  - an illegal drop → alert, no POST, focus unchanged;
  - placeholder activation → `anchor: "root"`;
  - the edit sheet shows the action;
  - a server `anchor` refusal shows the localized alert.
- `web/e2e/accessibility.spec.ts` -- axe with the chooser expanded, in en and ar.

**Acceptance Criteria:**
- Given a focused card, the deceased, or an open edit sheet, when "Add relative here" is used by tap or Space/Enter, then only that anchor's engine placement entries are offered, and a choice makes one add through the command service with the same request body a drop on that target makes.
- Given matching keyboard, touch and pointer-drop fixtures that add Son at a died-before son, when each settles, then each produces the same lineage edge, a whole-Case revision update, a current preview and exactly one Undo entry.
- Given the server tests, the web unit tests, lint, typecheck, build and the interview and accessibility e2e specs, when run, then they pass with no new serious or critical axe violations.

## Spec Change Log

## Review Triage Log

### 2026-11-20 — Review pass (all five layers in one combined read-only gemini call at the deep tier; the codex call hit its usage limit, which resets 2026-11-25)
- verdicts: 32 findings — high 0, medium 7, low 11, false 14, maybe-false 0
- findings:
  - `[false]` `[reject]` (blind) `outcomeText` ignores `failed`/`throttled` — it handles both (`add-relatives.tsx`, the `else if` branches after `conflict`), so a failed or throttled positioned add shows `messages.failed`/`messages.throttled`.
  - `[low]` `[patch]` (blind) `rootLink` is never cleared after a placeholder press — the action row stayed filtered to that link when the deceased card was focused; focusing or pressing any card now clears it (unit-tested).
  - `[medium]` `[patch]` (blind) a positioned add from the edit sheet keeps `editingHeir`, so on phone the modal dialog stays open and focus cannot reach `card:<new id>` — a successful tree add now closes the sheet like `cancelEditHeir` (flow-tested); the tree action row is also hidden while a sheet is open, so `addHere:<rel>` focus targets are unique (the parent found the duplicate while checking this finding).
  - `[false]` `[reject]` (blind) an unknown `layer` falls back to an empty placement — `_add_heir` raises `HeirNotFound` for an unknown layer before `_anchor_edge` runs.
  - `[false]` `[reject]` (blind) a non-spouse link silently maps to `spouse_of` — placement links come only from `engine/placement.py`, whose links are exactly `child`, `parent` and `spouse`.
  - `[false]` `[reject]` (blind) a placeholder focuses the toggle instead of the first option — the spec says activation opens the chooser; the focused toggle is expanded and the options follow it in Tab order.
  - `[low]` `[reject]` (blind) `dropEntry` rejects a drop when the root entry has no `gender` — only an older server omits `gender`; this server always sends it.
  - `[false]` `[reject]` (blind) no `setPointerCapture` on chip drags — touch pointers are implicitly captured to the chip and bubble to the window listeners; the chips have `touch-action: none`.
  - `[low]` `[reject]` (blind) the illegal-drop alert stays until the next drag or add — the same lifetime as every other Interview refusal (see 9.6's `undoFailed`).
  - `[false]` `[reject]` (blind) `aria-disabled` buttons stay tabbable — intended: the project rule is `aria-disabled`, never native `disabled`, so focus is never lost while saving.
  - `[low]` `[reject]` (blind) the restore test does not cover pre-existing edges — edge round-tripping through restore is covered by the 8.9 and 9.1b snapshot tests; this test proves the new edge goes away.
  - `[false]` `[reject]` (edge-case) `outcomeText` drops failed/throttled — same as the blind row.
  - `[low]` `[patch]` (edge-case) `rootLink` not cleared — same patch as the blind row.
  - `[medium]` `[patch]` (edge-case) sheet stays open after a tree add — same patch as the blind row.
  - `[low]` `[reject]` (edge-case) stale drop alert — same as the blind row.
  - `[low]` `[reject]` (edge-case) missing root gender in `dropEntry` — same as the blind row.
  - `[false]` `[reject]` (edge-case) unknown link becomes `spouse_of` — same as the blind row.
  - `[false]` `[reject]` (edge-case, claim) failed/throttled alerts are missing — same as the blind row.
  - `[low]` `[patch]` (edge-case, claim) the action row does not follow the card after a placeholder — same patch as `rootLink`.
  - `[medium]` `[patch]` (edge-case, claim) a sheet add cannot focus the new card — same patch as the sheet row.
  - `[medium]` `[patch]` (edge-case, claim) AC2/AC4 parity at a died-before son is unverified in the browser — added an e2e with a died-before son: the keyboard chooser ("Add son of son") and a mouse drop of the Son chip each send one POST `{relationship: son_of_son, anchor: h2}`, with the same bodies.
  - `[low]` `[patch]` (verification-gap) no client test carries `anchor: schema_unsupported` to its text — added an `outcomeText` test that returns the en `fieldErrors.anchor.schema_unsupported`.
  - `[false]` `[reject]` (verification-gap) failed/throttled notices are swallowed — same as the blind row.
  - `[medium]` `[patch]` (verification-gap) no browser test at a died-before node — same patch as the edge-case claim row.
  - `[low]` `[patch]` (verification-gap) no test parses `gender` inside `deaths[n].placement` — added a `parseCase` test that keeps a valid gender and drops an invalid one.
  - `[low]` `[patch]` (verification-gap, other) `rootLink` not cleared — same patch as the blind row.
  - `[medium]` `[patch]` (verification-gap, other) sheet focus — same patch as the blind row.
  - `[medium]` `[patch]` (intent) gesture parity is tested only on an alive son — same patch as the died-before e2e row.
  - `[false]` `[reject]` (intent) placeholder state scoping — a duplicate of the `rootLink` row, logged once there; this row restates it as a divergence, with no new defect.
  - `[false]` `[reject]` (intent) the modal dialog lifecycle — a duplicate of the sheet-focus row, logged and patched there.
  - `[false]` `[reject]` (contract) the `schema_unsupported` envelope is unexercised on the client — the envelope goes through the same `parseErrors` → `refusedView` → `outcomeText` path that `not_allowed` exercises end to end; the missing text check is the verification-gap row, patched there.
  - `[false]` `[reject]` (contract) failed/throttled notices are dropped — same as the blind row.

## Design Notes

**One request for three gestures.** Touch, keyboard and drop all end in `{relationship, anchor[, layer]}` to the existing add command. Parity holds by construction, and Undo needs nothing new, because `export_snapshot` already carries `edges`.

**Chip relationship vs placement relationship.** A Son chip dropped on a son anchor means "his son". In the placement, that entry is `son_of_son` with `link: child`. The drop helper `dropEntry(model, anchor, chip)` resolves it:
1. If the anchor's entries include the chip's relationship, use that entry.
2. Otherwise, if all of these hold, use that one entry:
   - the anchor is not `"root"`;
   - the chip's own entry in `placement.root` has `link: "child"` (the chip is a child of the deceased);
   - the anchor has exactly one `child` entry with the same `gender` as that root entry.
3. Otherwise the drop is illegal.

This reads only the engine's lists and the server-supplied genders. It names no relationship, so it is not a kinship table.

The Add relative here chooser lists the anchor's entries under their own terms (for example "Add son of son"). Choosing that entry and dropping a Son chip on the same anchor send the same body.

**Root anchor adds no edge.** Relatives with no recorded parent already hang from the deceased (owner decision, 2026-11-19), so a root edge would be redundant, and writer 1 would refuse it.

## Verification

**Commands:**
- `uv run python manage.py test api.test_case_commands --noinput` -- expected: pass.
- `cd web && npm test` -- expected: all pass.
- `cd web && npm run lint && npm run typecheck` -- expected: 0 errors; at most 12 lint warnings.
- `cd web && npm run build && npx playwright test e2e/interview.spec.ts e2e/accessibility.spec.ts` -- expected: all pass.

## Auto Run Result

Status: done

**Summary:** Relatives can now be added at a chosen person by touch, keyboard or pointer drag, and every path goes through one command. `POST /api/v1/case/heirs/` takes an optional `anchor` (a person id from the active estate's engine `placement`, or `"root"`). The server accepts it only when that anchor's placement lists the requested relationship at the current revision; otherwise it refuses with `anchor: not_allowed` and changes nothing. A non-root anchor records one lineage edge (`parent_of` or `spouse_of`, in the orientation of `engine/placement.py`). Under snapshot writer 1 a non-root anchor is refused with `anchor: schema_unsupported` and nothing changes. Every placement entry now also carries `gender` (additive). In the browser, one shared "Add relative here" chooser lists only the anchor's engine entries. It sits in an action row under the tree for the current card (hidden while an edit sheet is open), in the edit sheet, and behind the parent/spouse placeholders, which are now buttons. The Add relatives buttons are pointer-drag chips (6px threshold, no press-and-hold). While dragging, every card and placeholder shows "Drop here" with a 2px accent edge, or "Not allowed" on a readable dim pair. Legality comes from `dropEntry`, which reads only placement lists and genders: a Son chip on a son resolves to that anchor's single male `child` entry (`son_of_son`). An illegal drop sends nothing, keeps focus and shows "Not allowed here: {reason}". A success adopts the Case, pushes one Undo entry and focuses the new card; from the edit sheet it closes the sheet first.

**Files changed:**
- `api/anonymous_case.py`: `_anchor_edge`, the anchor check and edge in `_add_heir`, and `gender` on placement entries.
- `api/contracts/interview.json`: the `anchor` error codes.
- `api/test_case_commands.py`, `api/tests.py`: the `PositionedAddTests` (9 tests), and the 9.1b placement assertions now expect `gender`.
- `web/src/api/case.ts` (+ test): `PlacementOption.gender`, `HeirFields.anchor`.
- `web/src/interview/tree.ts` (+ test): `dropEntry`.
- `web/src/interview/flow.ts` (+ test): the `origin: "tree"` add, the `view.tree` outcome, its focus, and closing the sheet on success.
- `web/src/app/[locale]/interview/add-here.tsx` (+ test), new: the shared chooser.
- `web/src/app/[locale]/interview/family-tree.tsx`, `edit-sheet.tsx`, `add-relatives.tsx`, `start-case.tsx` (+ tests): the action row, placeholder buttons, drag chips, drop marks and wiring.
- `web/src/i18n/messages.ts`: the new ar, en and fr copy. `_bmad-output/implementation-artifacts/deferred-work.md`: the Story 9.7 copy list for native review.
- `web/e2e/api.ts`, `web/e2e/family.ts`, `web/e2e/interview.spec.ts`, `web/e2e/accessibility.spec.ts`: 9 positioned-add e2e (keyboard, touch, mouse drag, illegal drop, placeholder, edit sheet, server refusal, died-before son parity) and an axe run with the chooser open in en and ar. Three older selectors now target `[data-tree-area]`, because the tree section holds a second group.

**Run history:**
- Planning investigation was done by the parent, not delegated. The owner called this out; a memory note now records it.
- The review went to codex first. Codex hit its usage limit (resets 2026-11-25), so the same combined five-layer review went to the gemini agent at the deep tier.
- Review fixes went back to the Sonnet implementer (more than 3 files).

**Review:** one pass, 32 findings: high 0, medium 7, low 11, false 14.
- **Patched** (4 entries: 2 medium, 2 low):
  - the edit sheet stays modal over a positioned add, plus the duplicate chooser focus ids (medium);
  - browser parity at a died-before son (medium);
  - the stale placeholder filter (low);
  - two client tests, for the `schema_unsupported` text and `gender` in death placement (low).
- **Deferred:** none.
- **Rejected:** every reason is in the Review Triage Log. The main ones:
  - failed and throttled alerts — `outcomeText` already handles both;
  - layer and link fallbacks — guarded upstream, and the engine's links are closed;
  - the alert lifetime — same as other refusals;
  - `aria-disabled` — project rule;
  - root entries without `gender` — only an older server omits it.

**Follow-up review recommended:** true. Two medium entries were patched. The specific unverified risk: the patch changed behaviour (a successful positioned add from the edit sheet now closes the sheet, and the tree action row is hidden while a sheet is open), and the touch e2e now goes through the sheet. No reviewer has looked at that new close-and-focus path, or at how it interacts with 9.6's Undo focus and with the desktop non-modal panel.

**Verification** (on the final tree):
- `uv run python manage.py test api.test_case_commands api.test_snapshots api.test_capacity api.tests.InterviewLineageTests api.tests.HeirRulesTests --noinput`: 99 tests, OK. `engine.tests.test_queries` passed earlier, before the review fixes, which did not touch the engine.
- `npm test`: 606 of 606 pass.
- `npm run typecheck`: clean. `npm run lint`: 0 errors and 12 warnings.
- `npm run build`: OK.
- `npx playwright test e2e/interview.spec.ts e2e/accessibility.spec.ts`: 99 of 99 pass (chromium).
- No changed file has CRLF line endings.

**Matrix audit:**
| Row | Covering tests |
|---|---|
| Root anchor | `test_no_anchor_key_is_unchanged_and_root_adds_no_edge`; placeholder e2e |
| Child of son | `test_child_edge`; keyboard, touch and mouse e2e |
| Died-before son | `test_died_before_anchor_and_restore`; died-before parity e2e; `dropEntry` unit |
| Parent link | `test_parent_edge` |
| Writer 1 | `test_writer_1_refuses_a_non_root_anchor_without_changes`; `outcomeText` schema_unsupported test |
| Not offered | `test_not_offered_unknown_non_string_and_same_as_are_refused`; server-refusal e2e |
| Stale slot | `test_a_slot_the_engine_no_longer_offers_is_refused`; flow conflict test |
| Later estate | `test_later_estate_anchor`; flow "tree add on a later death carries the layer" |
| Placeholder | placeholder e2e; family-tree unit |
| Illegal drop | illegal-drop e2e |
| Undo | `test_died_before_anchor_and_restore` (restore drops the edge); flow "pushes one entry" |
| Placement gender | `test_every_placement_entry_has_a_gender`; `parseCase` gender tests |

**Residual risks:**
- In production (writer 1), only root-anchored adds succeed. Adds at a person are refused with a localized message until the writer moves to 2.
- A drag does not auto-scroll, so the chip and the target must both be on screen. A swipe that starts on a chip does not scroll the page (`touch-action: none`).
- Only chromium ran. The full `calc` + `api` suite was not run; the driver's batch run covers it.
- The new copy awaits native review.
