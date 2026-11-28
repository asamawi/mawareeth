---
title: 'Story 9.4: Edit and remove relatives from the tree'
type: 'feature'
created: '2026-11-19'
status: 'done'
baseline_revision: '022e0f7a31752d9fc39998ec086c1998cdea97ed'
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

**Problem:** A relative can be corrected only through the inline heir form, which has a Save button. Pressing a tree card only selects it. There is no way to record that a person died before the deceased. Remove trusts a browser guess (`removesDeath`) and always sends `confirm_cascade=true`, so the server's cascade check never reaches the visitor.

**Approach:** Pressing a card, or a Heirs-row Edit, opens one edit surface: a modal bottom sheet on phones and a non-modal panel on wider screens. It holds name, relationship and an "Alive at death / Died before the deceased" status, and each change is saved straight away as one command. Remove first sends an unconfirmed delete. When the server answers with an impact, the surface shows a confirmation listing exactly what the server returned, and only confirming sends the cascade. The server gains a died-before status on the existing edit command. It is persisted only when the snapshot writer is schema 2.

## Boundaries & Constraints

**Always:**
- **Server: status on the edit command.** `PUT /api/v1/case/heirs/<id>/` (`anonymous_case.update_heir`) accepts an optional `status` of `"alive"` or `"died_before_or_with"`. When it is left out, the current status is kept, so today's clients behave exactly as before. The `<id>` may be a heir row id or the id of a person in `case['died_before']`.
  - **Alive → died before** keeps the person's id, name, relationship and edges. The row moves out of `case['heirs']` into `case['died_before']`. It is refused, with `errors.status`, and nothing changes, when:
    - `snapshots.write_version() == 1` → `schema_unsupported`;
    - the row is in a later-death layer → `first_estate_only`;
    - the person has a later death, the row has `same_as`, or another row aliases it → `status_locked`.
  - **Died before → alive** moves the person back to `case['heirs']` with the same id. The usual relationship check (`heir_rules.kinship_code` over the first-estate heirs) and the 50-heir capacity apply. Capacity is refused with `errors.heirs = 'limit'`.
  - **Editing a died-before person's name or relationship** without a status change: the name always saves; a relationship change is checked with `kinship_code` against the first-estate heirs.
  - Every path runs through `case_commands.execute` with `expected_revision`. A refusal stores nothing and returns 400 `{errors}` like today's edit.
- **Server: removing a died-before person.** `DELETE` with a `case['died_before']` id removes that entry and its edges. `case_commands.remove_impact` covers these ids too, through the engine's `delete_impact` with edges ignored, as it does for rows today. No other server change is made.
- **Client API (`web/src/api/case.ts`).**
  - `HeirFields` gains an optional `status: "alive" | "died_before_or_with"`.
  - `removeHeir` gains a `confirm: boolean` argument. `deleteQuery` sends `confirm_cascade=true` only when `confirm` is true. `unmarkDeceased` keeps sending `true`, because its dialog is Story 9.8's.
  - `answer()` maps a 409 whose `error` is `"cascade_unconfirmed"` to a new `AnswerResult` `{kind: "cascade", impact: {persons: string[], estates: number[]}, case}`, validating both. Every other 409 stays `replaced`.
- **One edit surface:** a new `web/src/app/[locale]/interview/edit-sheet.tsx`.
  - **Opening.** It opens from:
    - a click, or Enter, on a normal, died-before or blocked tree card;
    - the Heirs-row Edit;
    - a Remove or Delete request (see below).

    The deceased card and died-later cards keep today's behaviour; Story 9.8 owns them.
  - **Phone (viewport below 640px)** renders a `<dialog>` opened with `showModal()`. This gives a native inert background, focus trap and Escape. It is a bottom sheet with radius 18px at the top.
  - **640px and wider** renders a non-modal panel (a `section` with a heading). It is placed in the DOM right after the tree, so it follows the tree in Tab order, and it has no trap. Escape inside it closes it.
  - **Contents.** Each surface has:
    - a heading `editHeirHeading`;
    - a Close button;
    - the fields below;
    - a Remove button, which is not shown for a died-later person.

    Fields are labelled and at least 44px tall, built from `form-bits.tsx` and the relationship controls of `heir-form.tsx` (extract and share them; do not copy them). Surfaces use the sheet and surface tokens in light and dark mode.
  - **Name**, optional. It commits on blur or Enter as one `saveHeir` command, only when the trimmed value has changed. A blank name is sent as `null`.
  - **Relationship.** For a row, the options come from the row's `edit_options`. For a died-before person, they come from the first estate's `heir_options`. A change saves immediately.
  - **Status.** Two radios, "Alive at death" and "Died before the deceased". They are shown only when the active layer is the first estate and the person is not died-later. A change saves immediately with `status`.
  - **Opening and closing.** Opening focuses the first field (the name). Close, Escape, or a successful removal closes it. Close and Escape return focus to the opener, which is the card (`card:<id>`) or the row Edit (`editHeir:<id>`).
- **Saving on change.**
  - Each change goes through the existing `submit`/`saveHeir` at the current revision. Only a successful command's returned whole Case updates the tree, list and preview.
  - On success, the surface stays open on the same person, the existing `heirUpdated` announcement runs, and focus stays on the changed field. This is unlike today's form, which closes on save.
  - A refusal shows the localized engine/server reason through `errorText` under the field, keeps the accepted family unchanged and keeps focus on the field. The browser never decides validity.
  - A same-case 409 (stale revision) adopts the returned Case through `reconcileFresh`, shows `conflictNotice` as an alert in the surface, keeps the surface open if the person still exists, and does not resend.
- **Selection.** The edited card has `aria-current="true"` and a 3px inset `currentColor` outline, replacing today's 2px offset accent outline for the edited state.
- **Remove, from the sheet's Remove button or the Heirs-row Remove.**
  1. The first press sends `removeHeir(..., confirm: false)`.
  2. If the server removes the person (no impact), that is a "simple Remove". If it answers `cascade`, the view adopts the returned Case and the surface switches to confirmation state.
     - Confirmation **replaces** the surface's contents; it never stacks a second dialog. When the surface was closed, as for a row Remove, it opens in confirmation state.
     - The confirmation is headed `removeConfirmHeading` ("Remove {heir}?"). It lists every `impact.persons` id by its `treeDescription` label (relationship plus name, or the numbered default), and every `impact.estates` order as `removeImpactEstate` ("The estate of {heir}", naming the death's person).
     - It has "Yes, remove" (`heirRemoveYes`) and "Keep" (`heirRemoveNo`). Focus goes to Keep.
  3. Keep, Escape, or Close changes nothing and returns to the edit state, or closes when the confirmation was opened from a row.
  4. "Yes, remove" sends `confirm: true` at the revision of the Case returned with the impact.
     - A `cascade` answer replaces the confirmation with the new impact.
     - A `replaced` (same case) answer or a failure removes nobody: it shows the alert and keeps the accepted family.
- **Delete key.** On a focused normal, died-before or blocked card, Delete always opens the surface in confirmation state first. With no impact known yet, the confirmation lists nobody else. Then "Yes, remove" follows step 4 above, which may refresh to a cascade list.
- **The browser cascade guess is retired.** Delete the Heirs list's local `removesDeath` logic and its inline Keep/Yes confirmation; removal confirmation now lives only in the edit surface. Died-before rows in `heir-list.tsx` (`:145`) get Edit and Remove actions like other rows.
- **Focus after removal** (`nextFocus`):
  - It is computed from the tree model **before** removal, among cards of the same layer with the same `parentId` and generation, in reading order.
  - The target is the next surviving sibling card, otherwise the previous one, otherwise `card:root`.
  - Cards get `data-focus="card:<id>"`, the deceased is `card:root`, and `"card"` joins `FOCUS_PREFIXES`.
  - Focusing a card also moves the tree's roving tab stop to it.
- **Offline or saving (`frozen`).** Fields and buttons are `aria-disabled` or `readOnly`, never natively `disabled`, so focus is not dropped. Nothing is sent or queued.
- **Copy:** new `interview` keys in ar, en and fr, each recorded in `deferred-work.md` under a "Story 9.4" section for native review.
  - `editClose`: "Close" / "إغلاق" / "Fermer".
  - `statusLegend`: "Status at the death" / "الحالة عند الوفاة" / "Situation au décès".
  - `statusAlive`: "Alive at death" / "على قيد الحياة عند الوفاة" / "En vie au décès".
  - `statusDiedBefore`: "Died before the deceased" / "توفي قبل المتوفى" / "Décédé avant le défunt".
  - `removeImpactIntro`: "This also removes:" / "سيُحذف معه أيضًا:" / "Cela supprime aussi :".
  - `removeImpactEstate`: "The estate of {heir}" / "تركة {heir}" / "La succession de {heir}".
  - `fieldErrors.status`, with three codes:
    - `schema_unsupported`: "This case cannot record a death before the deceased yet." / "لا يمكن لهذه الحالة تسجيل وفاة قبل المتوفى بعد." / "Ce dossier ne peut pas encore enregistrer un décès antérieur au défunt.";
    - `first_estate_only`: "A death before the deceased can be set only in the first estate." / "لا يمكن تسجيل الوفاة قبل المتوفى إلا في التركة الأولى." / "Un décès antérieur au défunt ne peut être indiqué que dans la première succession.";
    - `status_locked`: "This person's status cannot change while they are linked or have their own estate." / "لا يمكن تغيير حالة هذا الشخص ما دام مرتبطًا أو له تركة خاصة." / "La situation de cette personne ne peut pas changer tant qu'elle est liée ou a sa propre succession.".

  Reuse the existing `heirEditHeading`, `heirRemove`, `heirRemoveConfirm`, `heirRemoveYes`, `heirRemoveNo`, `heirUpdated`, `heirRemoved` and `conflictNotice`.

**Never:**
- Compute validity, blocking, shares or cascade membership in the browser. Do not keep a browser cascade table.
- Add positioned adds or "Add relative here" (9.7), later-death creation or the died-later status, or Open own estate (9.8). Do not add Undo (9.6), arrow-key tree navigation beyond today's (9.9), or announcement coalescing (9.10).
- Change the snapshot writers, add a migration, or change `unmarkDeceased`'s cascade behaviour.
- Change existing translations. Do not use physical left/right CSS, stacked modals, or natively disabled focused controls.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Rename | edit Son 1, type "Ali", blur | one PUT `{relationship:"son", name:"Ali"}` at rev N; list and tree show Ali; surface stays open; focus on the name field | — |
| Rename unchanged | blur without a change | no request | — |
| Relationship refused | Son → Father while a father exists | 400 `{relationship}`; the localized reason shows under the field; family unchanged; focus kept | — |
| Died before, schema 2 | first-estate son, writer 2, status → died before | 200; the person moves to `died_before` with the same id; the card shows dashed "Died before" | — |
| Died before, schema 1 | writer 1 | 400 `{status: schema_unsupported}`; nothing stored; the localized reason shows | — |
| Died before, locked | a person with a later death, or a `same_as` row | 400 `{status: status_locked}` | — |
| Back to alive at 50 | died-before person, 50 heirs | 400 `{heirs: limit}`; unchanged | — |
| Simple Remove | Son 2, no descendants | one DELETE without confirm; removed; focus on the next sibling card, else the previous, else the deceased | — |
| Cascade Remove | a person with a died-later estate | the first DELETE gets 409 `cascade_unconfirmed`; the confirmation lists exactly the impact persons and estates; Keep changes nothing; Yes sends `confirm_cascade=true` at the impact Case's revision | — |
| Confirm goes stale | Yes gets 409 `conflict` | nobody removed; the returned Case is shown with `conflictNotice` | no resend |
| Delete key | focus on a leaf card, Delete | the confirmation opens before any request | — |
| Phone | 375px, card press | `dialog[open]` modal; background inert; Escape closes; focus back on the card | — |
| Desktop | 1280px | a non-modal panel after the tree; no trap; Escape returns focus to the card | — |

</intent-contract>

## Code Map

- `api/anonymous_case.py` -- `update_heir:798` (row lookup, `clean_heir`, gender lock, `kinship_code`); `remove_heir:836`, `_remove_rows`; `_read_died_before:220`, `_person:491`, `_rows`, `_layers`, `MAX_HEIRS`. Died-before entries are `{id, gender, name, relationship}` in `case['died_before']`. `_describe` and `_decorate` (`~:495-537`) build `persons`, `placement` and the row `edit_options`.
- `api/case_commands.py` -- `execute:68`, `remove_impact:111` (extend to died-before ids), `OverCapacity`.
- `api/snapshots.py:11` `write_version()`; `:60` the v1 refusal of edges and died-before.
- `api/views.py:248` `HeirView` (PUT `edit_heir`, DELETE with `remove_impact`); `:141` `respond_to_command`.
- `api/test_case_commands.py:77,139,233-255` and `api/tests.py:820-847,4293` -- the edit and remove tests to extend. Use `override_settings(SNAPSHOT_WRITE_VERSION=2)` for the schema-2 paths.
- `web/src/api/case.ts` -- `AnswerResult` and `answer()` (`~:609-650`; 409 → `replaced`), `deleteQuery:667`, `updateHeir`, `removeHeir:704`, `HeirFields`, `Person`. Tests are in `case.test.ts`.
- `web/src/interview/flow.ts` -- `StartedView:99-130` (`editingHeir`, `panel`, `focus`); `startEditHeir`, cancel (`~:391-428`); `FOCUS_PREFIXES:81`; `Answer:539` (`saveHeir`, `removeHeir`); `send:726`; `save():922` (`saved` edit closes today at `~:797-881`; `replaced` same-case conflict handling from 9.3); `reconcileFresh`; `nextFocus`.
  - Add a confirmation state, for example `confirming?: {heirId, impact: {persons, estates} | null, opener}`, and an `opener` for close-focus.
  - The edit success now keeps the surface open.
- `web/src/interview/tree.ts` -- `estateModel` (row ids; died-before people use person ids, `parentId`); `treeDescription:182-237` (labels for the impact list). Add a pure `focusAfterRemoval(model, id)` here.
- `web/src/app/[locale]/interview/family-tree.tsx` -- card buttons (`data-node`, click selects, `aria-current` from selection or `editingId`, roving refs `:35-68,113`). Wire click/Enter → `onEdit`, Delete → `onRemoveRequest`, `data-focus="card:<id>"`, the selected outline, and a tab-stop sync on focus.
- `web/src/app/[locale]/interview/heir-list.tsx` -- row actions `:143-259`, the `:145` died-before early return, local `removesDeath` and the inline confirm (remove them).
- `web/src/app/[locale]/interview/heir-form.tsx` / `form-bits.tsx` -- relationship radios plus the "More relatives" select, `errorText`, `inputClass`, `buttonClass`, `SaveNotice`. `HeirForm` remains only for the later-estate "someone already in this case" add.
- `web/src/app/[locale]/interview/start-case.tsx` -- the focus effect `:230-246` (the `[data-focus]` lookup and fallbacks), `frozen:298`, the layout `:512-618` (render the panel right after the tree; render the phone dialog), `onRemove:599`.
- `web/src/i18n/messages.ts` -- the interview type `:79-190`; ar/en/fr blocks; `fieldErrors`. Key parity tests are in `web/src/api/case.test.ts`.
- `web/e2e/interview.spec.ts` (`:408` heir form shown only while editing, `:370` stale), `web/e2e/api.ts` (mock routes; add PUT and DELETE heir handlers with a `cascade_unconfirmed` stub), `web/e2e/family.ts`, `web/e2e/accessibility.spec.ts`.

## Tasks & Acceptance

**Execution:**
- `api/anonymous_case.py`, `api/case_commands.py` -- the status transitions, died-before edit and delete, refusal codes and capacity, as specified above.
- `api/test_case_commands.py` / `api/tests.py` -- the server matrix rows:
  - died before under schema 2 and schema 1;
  - locked, `first_estate_only`, and back to alive at 50;
  - died-before rename and relationship refusal;
  - a died-before DELETE and its impact;
  - an unconfirmed DELETE with impact → 409 with the impact;
  - a status left out → behaviour unchanged.
- `web/src/api/case.ts` (+ test) -- the `status` field, the `confirm` argument, and the `cascade` result parsing (a valid one; a malformed impact → `failed`).
- `web/src/interview/tree.ts` (+ test) -- `focusAfterRemoval`: next sibling, then previous, then root; the same parent only.
- `web/src/interview/flow.ts` (+ test) -- the matrix flow rows:
  - save on change keeps the surface open and focuses the field;
  - a refusal keeps the family;
  - a cascade answer enters confirmation with the adopted Case;
  - Yes sends `confirm` at the new revision;
  - a stale confirm removes nobody;
  - Keep or Escape restores the state;
  - the Delete request opens the confirmation with no request sent;
  - focus after removal;
  - close returns focus to the opener.
- `web/src/app/[locale]/interview/edit-sheet.tsx` (+ jsdom test) -- the surface:
  - fields and labels;
  - the status radios hidden outside the first estate;
  - the phone `showModal` versus panel, by a `matchMedia` prop or hook;
  - the confirmation list text;
  - Escape and Close;
  - `aria-disabled` while frozen.
- `family-tree.tsx`, `heir-list.tsx`, `heir-form.tsx`, `start-case.tsx` -- the wiring above; retire the local cascade guess.
- `web/src/i18n/messages.ts` -- the new keys; `_bmad-output/implementation-artifacts/deferred-work.md` -- the Story 9.4 copy list.
- `web/e2e/interview.spec.ts` -- the following runs on the mocked API:
  - Rename (exactly one PUT, the surface stays open);
  - Phone at 375px: dialog modal, Escape returns focus to the card;
  - Desktop at 1280px: panel, no trap;
  - Cascade Remove: lists the impact, Keep sends nothing more, Yes sends confirm;
  - Simple Remove focus on the next sibling;
  - Delete key confirmation;
  - update the `:408` test for the new surface.

  `accessibility.spec.ts` gains an axe run with the surface open in en and ar.

**Acceptance Criteria:**
- Given any edit or remove outcome, when it settles, then the tree, list and preview show only the server's returned Case, and no person is removed without the server's authority and, for a non-empty impact, the visitor's confirmation.
- Given the web unit tests, lint, typecheck, build, the interview and accessibility e2e specs, and the targeted Django tests, when run, then they pass, with no new serious or critical axe violations.

## Spec Change Log

## Review Triage Log

### 2026-11-19 — Review pass (codex hit its usage limit until 15:42 on all five layers; each layer re-ran once as a Claude Sonnet subagent, read-only; the intent audit was the only codex result)
- verdicts: 44 findings — high 0, medium 9, low 19, false 16, maybe-false 0
- findings:
  - `[low]` `[reject]` (intent) the rename e2e does not compare tree, list and preview after the edit — all three render from the one returned Case; the preview path is unchanged and its stale-revision e2e still passes.
  - `[medium]` `[patch]` (intent) a status change is never driven through the UI — same root as the status-toggle test gap below; patched with edit-sheet and flow tests.
  - `[low]` `[patch]` (intent) card Delete on a person with a cascade is untested — a flow test added: requestCardRemoval, then Yes answered by `cascade`, shows the impact confirmation.
  - `[medium]` `[patch]` (verification-gap) the status radio → `onSave` → PUT `status` path has no web test — added: an edit-sheet radio test, a flow test that `status` reaches `updateHeir`, and a flow test that a `status_locked` refusal keeps the editor and focus.
  - `[medium]` `[patch]` (verification-gap) the `_read_died_before` cap was removed and nothing pins it — confirmed: a restored snapshot (RestoreView) could carry an unbounded died-before list. The cap is restored, alive → died-before is refused at the cap with `heirs: limit`, and a test is added.
  - `[low]` `[patch]` (verification-gap, other) `status: invalid` is outside the contract and the copy — added to `interview.json` and ar/en/fr `fieldErrors.status`, with an API test; listed for native review.
  - `[false]` `[reject]` (verification-gap, other) an aliased died-before round trip is untested — a died-before person cannot have aliases or a death: moving one there is refused as `status_locked`, and `_read_died_before` skips ids already taken by rows.
  - `[medium]` `[patch]` (blind) Close after a name edit is swallowed — confirmed: the blur save sets `frozen`, and `close()` and `cancelEditHeir` ignore the click. Same root as the edge-case "click that caused the blur is dropped". Patched: a pointer press inside the sheet defers the name to the pressed control, while Tab still commits on blur (the first patch skipped every focus move inside the sheet, which broke the rename-on-Tab e2e; the parent narrowed it to presses); relationship and status saves carry the draft name; Close or Escape with a dirty draft sends one save with `close: true`.
  - `[false]` `[reject]` (blind) Enter then blur sends two PUTs — Enter is a discrete event, so React re-renders with `frozen` before the blur, and the blur commit is skipped; after the save the draft basis no longer matches, so the text equals the accepted name.
  - `[false]` `[reject]` (blind) row Remove deletes without confirmation — the specified behaviour: a simple Remove sends an unconfirmed DELETE; only the keyboard Delete asks first, and a non-empty impact always needs confirmation.
  - `[low]` `[patch]` (blind) `status: invalid` is not in the contract — same as the verification-gap row.
  - `[medium]` `[patch]` (blind) the MAX_HEIRS cap on `died_before` was removed — same as the verification-gap row.
  - `[low]` `[patch]` (blind) `remove_heir` leaves `died_before: []` — confirmed in the response body; patched to pop the key, with an assertion.
  - `[low]` `[reject]` (blind) client name validation dropped from `precheck` for saveHeir — the server's `clean_heir` returns the same codes, shown under the field; the only cost is one request for a rare overlong name.
  - `[false]` `[reject]` (blind) `CSS.escape` on the whole target — a CSS escape inside a quoted attribute value matches the literal colon; the card, remove and editHeir focus e2e tests pass in Chromium.
  - `[low]` `[reject]` (blind) thin accessibility coverage — the spec's axe run with the surface open in en (panel) and ar (phone dialog) is in place and passes; more permutations are Story 9.11's verification.
  - `[low]` `[patch]` (blind) weak edit-sheet unit tests (the name never changes; a loose Remove assertion) — patched with a real changed-name blur test and an exact accessible-name assertion.
  - `[false]` `[reject]` (blind) the phone modal opens on every card tap — the specified behaviour (a card press opens the edit surface); a viewport without range-query support falls back to the non-modal panel, which is still usable.
  - `[low]` `[patch]` (blind) a stale `deleteQuery` comment and the now-unused `heirRemoveConfirmDeceased` — the comment is fixed; the unused key is left, because removing translation text is out of this story and it is harmless.
  - `[false]` `[reject]` (blind) awkward copy and missing deferred entries — the copy is the spec's and is listed for native review; `heirRemoveConfirm` is reused, not new text.
  - `[low]` `[patch]` (blind) housekeeping: stray blank lines and import order — patched; the in-function `write_version` import mirrors an existing cycle-avoiding import, and the ids are never mounted twice, because `HeirForm` shows only when no edit is open.
  - `[false]` `[reject]` (blind) focus falls back to the deceased instead of the parent — the spec and AC say next sibling, then previous sibling, then the deceased.
  - `[low]` `[patch]` (contract) `status: invalid` gives the generic failure text — same patch as the verification-gap row.
  - `[medium]` `[patch]` (contract) no web test sends `status` — same patch as the verification-gap row.
  - `[low]` `[patch]` (contract) no web test feeds status error envelopes — covered by the new `status_locked` flow test.
  - `[false]` `[reject]` (contract) a server-built died-before person is never exercised on the web — `calc/adapters.py:42-44` builds every died-before person with relationship and status, and `_describe` emits `persons` from that family, the same shape the e2e fixtures use.
  - `[low]` `[reject]` (contract) cascade results on non-removeHeir answers are untested — unreachable: `unmarkDeceased` always confirms.
  - `[medium]` `[patch]` (edge-case) the click that caused the name blur is dropped — same root and patch as the blind Close row.
  - `[low]` `[reject]` (edge-case) the draft resets when a new Case object arrives — while typing, no other command can run, because every write freezes the screen; a new Case arrives only from this sheet's own save.
  - `[low]` `[reject]` (edge-case) a refused name is resent on each blur — harmless: the server refuses again with the same message; a guard would add state for a rare overlong name.
  - `[low]` `[reject]` (edge-case) precheck dropped — same as the blind row.
  - `[false]` `[reject]` (edge-case) the kinship check on alive → died-before includes the moved row — `counts(r for r in heirs if r is not row)` excludes it.
  - `[low]` `[patch]` (edge-case) `died_before: []` after remove — same patch as the blind row.
  - `[false]` `[reject]` (edge-case) a died-before id can dangle in `same_as` or `deaths` — moving a linked or dead person is refused as `status_locked`, and snapshot reads skip died-before ids already taken by rows.
  - `[false]` `[reject]` (edge-case) the options fallback for a later-layer person — died-before persons exist only in the first estate, where `case.heir_options` is the right list.
  - `[low]` `[reject]` (edge-case) the estate label falls back to the raw order — the impact comes with the adopted Case, whose deaths carry those orders; the fallback is unreachable in practice.
  - `[false]` `[reject]` (edge-case) the non-null `description.people.find(...)!` can crash — the description is built from the same model that supplies `editingPerson`.
  - `[false]` `[reject]` (edge-case) lineage-only persons gain actions — the only model people without a row are died-before persons, who are meant to get Edit and Remove.
  - `[medium]` `[patch]` (edge-case) the `_read_died_before` cap was removed — same patch as above.
  - `[false]` `[reject]` (edge-case) row Remove deletes with no confirmation — the specified simple Remove.
  - `[low]` `[reject]` (edge-case) the orphaned `heirRemoveConfirmDeceased` key and HeirForm edit branches — harmless dead copy; translation removal is out of scope.
  - `[medium]` `[patch]` (edge-case, claim) "no other server change" but the cap was dropped — the cap is restored, so the claim holds again.
  - `[false]` `[reject]` (edge-case, claim) server tests missing and Django unverified — the died-before relationship refusal (`test_relationship_and_capacity_are_checked_on_return`), the omitted status (the rename) and the 409 impact (`test_removing_a_heir_with_a_later_death_layer_needs_confirmation`) exist, and `api.test_case_commands` plus `api.tests` ran: 331 tests, after two fixes.
  - `[false]` `[reject]` (edge-case, claim) `lineOf` only approximates the generation — `lineOf` is the tree's own generation-line function that the layout uses.

## Design Notes

**Why Remove sends unconfirmed first.** The server is the only cascade authority (`remove_impact` → engine `delete_impact`), and there is no separate impact query endpoint. An unconfirmed DELETE is that query: when the impact is empty, it is the simple removal itself; otherwise it returns the impact with the current Case and changes nothing. The keyboard Delete path adds a plain confirmation in front, as the AC asks.

**Why the died-before status is limited to the first estate.** `case['died_before']` records relatives of the first deceased only, and the v2 snapshot stores them there. Later layers' rows are heirs of a later deceased.

**Why kinship is checked against first-estate heirs only.** Died-before persons do not inherit. The engine's placement and estate models treat them as lineage, not heirs, so the same `kinship_code` rule the add path uses applies.

**Why the phone breakpoint is 640px.** It is the card-size breakpoint already in the UX (108px below 640px), the only "phone" boundary the design defines.

## Verification

**Commands:**
- `uv run python manage.py test api.test_case_commands api.tests --noinput` -- expected: pass. Run serially, with Postgres on localhost:5432.
- `cd web && npm test` -- expected: all pass.
- `cd web && npm run lint && npm run typecheck` -- expected: 0 errors; at most 12 lint warnings.
- `cd web && npm run build && npx playwright test e2e/interview.spec.ts e2e/accessibility.spec.ts` -- expected: all pass.

## Auto Run Result

Status: done

**Summary:** Pressing a normal, died-before or blocked card, or a Heirs-row Edit, now opens one edit surface: a `showModal()` bottom sheet below 640px, and a non-modal panel after the tree at 640px and wider.
- **Fields.** Name (commits on blur or Enter), relationship and, in the first estate, "Alive at death / Died before the deceased". Each change saves at once against the current revision; the surface stays open and focus stays on the changed control.
- **Remove.** Remove sends an unconfirmed DELETE. A server `cascade_unconfirmed` 409 now becomes a `cascade` result, and the surface switches to a confirmation listing exactly the server's impact persons and estates; only "Yes, remove" sends `confirm_cascade=true`, at the impact Case's revision. The keyboard Delete always asks first. Focus after a removal goes to the next sibling card, then the previous one, then the deceased. The browser's `removesDeath` guess is gone.
- **Server.** `PUT /case/heirs/<id>/` takes an optional `status`. It moves a first-estate person between `heirs` and `died_before` with the same id and edges, refused as `schema_unsupported` (writer 1), `status_locked`, `first_estate_only`, `heirs: limit` or `status: invalid`. Died-before persons can be renamed, re-related and removed.

**Files changed:**
- `api/anonymous_case.py`: status transitions in `update_heir`; died-before removal in `remove_heir`.
- `api/case_commands.py`: `remove_impact` covers died-before ids.
- `api/contracts/interview.json`: the `status` error codes.
- `api/test_case_commands.py`: the new `HeirStatusTests`.
- `web/src/api/case.ts` (+ test): the `status` field, the `confirm` argument, the `cascade` result.
- `web/src/interview/flow.ts` (+ test): edit-on-change, confirmation state, `close`, opener focus, conflict handling, removal focus.
- `web/src/interview/tree.ts` (+ test): `focusAfterRemoval`.
- `web/src/interview/layers.ts` (+ test): `removesDeath` removed.
- `web/src/app/[locale]/interview/edit-sheet.tsx` (+ new test): the surface.
- `family-tree.tsx`, `heir-list.tsx`, `heir-form.tsx` (shared `RelationshipFields`), `start-case.tsx`: the wiring.
- `web/src/i18n/messages.ts`: new keys in ar, en and fr.
- `web/e2e/interview.spec.ts`, `web/e2e/api.ts`, `web/e2e/accessibility.spec.ts`: the e2e tests.
- `_bmad-output/implementation-artifacts/deferred-work.md`: the new copy, for native review.

**Run history:**
- Codex hit its usage limit during implementation, so one Sonnet subagent finished from its partial tree.
- The first verification was blocked by a full C: drive.
- After space was freed, the Django run found two regressions in `update_heir`: an empty `died_before` was added to 404 bodies, and field errors were no longer collected together. The parent fixed both.
- Codex was out again (until 15:42) for review, so the four other layers re-ran once each on Sonnet. Only the intent audit came from codex.

**Review:** one pass. 44 findings: high 0, medium 9, low 19, false 16.
- **Patched** (grouped entries: 3 medium, 5 low):
  - medium: a click or Close was dropped after a name blur;
  - medium: the `died_before` read cap was restored, and moves are refused at the cap;
  - medium: the status toggle now has web tests;
  - low: `status: invalid` was added to the contract and the copy;
  - low: no empty `died_before` after a removal;
  - low: a card Delete answered by `cascade` is now tested;
  - low: weak edit-sheet assertions were tightened;
  - low: a stale comment and housekeeping.
- **Deferred:** none.
- **Rejected:** each reason is in the Review Triage Log. Main ones:
  - a simple Remove without confirmation is the specified behaviour;
  - the client name precheck is not needed, because the server returns the same codes;
  - the unused `heirRemoveConfirmDeceased` key is left, since removing translation text is out of scope;
  - wider axe permutations belong to Story 9.11.

**Follow-up review recommended:** true. Three medium entries were patched. The specific unverified risk is the new name-commit logic: a pointer press defers to the pressed control, Tab commits, and Close or Escape with a dirty name saves with `close: true`. Unit tests cover it, and e2e covers only the Tab path. A real touch press on a phone (pointerdown on the dialog, then click) and the Close-with-dirty-name close-after-save have no browser test.

**Verification** (on the final tree):
- `uv run python manage.py test api.test_case_commands api.tests --noinput`: 333 tests OK. It ran after the subagent's patches; the parent's last edits were web-only.
- `npm test`: 557 of 557 pass.
- `npm run typecheck`: clean.
- `npm run lint`: 0 errors and 12 warnings.
- `npm run build`: OK.
- `npx playwright test e2e/interview.spec.ts e2e/accessibility.spec.ts`: 74 of 74 pass.

**Matrix audit:**
- Rename: the e2e "desktop card Enter … blur renames once".
- Rename unchanged: the edit-sheet blur test.
- Relationship refused: the flow refusal test and `test_relationship_and_capacity_are_checked_on_return`.
- Died before under schema 1 and 2, locked, and back to alive at 50: `HeirStatusTests`.
- Simple Remove focus: the e2e Delete test.
- Cascade Remove: the e2e row Remove test.
- Confirm goes stale: the flow test.
- Delete key: the e2e and flow tests.
- Phone and desktop: the e2e tests.

**Residual risks:**
- `SNAPSHOT_WRITE_VERSION` defaults to 1, so in production "Died before" is always refused with the localized reason until the writer moves to schema 2.
- A simple Remove has no confirmation until Undo (9.6).
- The copy awaits native review.
- The `(width < 640px)` range query falls back to the panel on browsers without support for it.
