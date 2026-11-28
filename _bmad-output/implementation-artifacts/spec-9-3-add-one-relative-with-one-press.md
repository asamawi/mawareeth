---
title: 'Story 9.3: Add one relative with one press'
type: 'feature'
created: '2026-11-19'
status: 'done'
baseline_revision: '5c5a85dd23ceddce90a090e46c4914d050409a9e'
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

**Problem:** To add a relative today, the visitor fills in a form: they pick a relationship radio, optionally type a name, then press "Add heir". The form offers impossible relationships too, such as a second father, and the server refuses them only after submit. It is slow, and it is not the Add relatives panel of buttons that the UX calls for.

**Approach:** Add an "Add relatives" panel to the left column of the heirs screen, in place of the add form. It holds relationship buttons grouped Spouse, Parents, Children, Siblings and More relatives. One press sends one add command at the current revision, with no name. Only relationships the server allows are offered. Every outcome — success, limit, refusal, conflict, failure and offline — goes through the existing flow, and focus stays on the pressed button.

## Boundaries & Constraints

**Always:**
- **Panel.**
  - It sits in the existing left-column `section`, now labelled by a new `h3#add-relatives-heading` with the text "Add relatives". The heading has `tabIndex=-1` so focus can land on it.
  - Under the heading are up to five `role="group"` blocks, each labelled by its own `h4`, in this order: Spouse, Parents, Children, Siblings, More relatives. A group with no offered relationship is not rendered.
  - Each offered relationship is a wrapper with a 1px `graphic` border, `radius-node`, a `background` fill and `min-h-11`, containing one add button.
  - Wrappers wrap onto lines (flex-wrap, 8px gaps).
- **Add button.**
  - It is a native `<button type="button">` at least 44px tall, with an `accent` fill, `accent-foreground` text and `rounded-lg`. It uses `focusRingOnAccent`.
  - Its visible text is the relationship label, followed by a "+" that is `aria-hidden`.
  - Its accessible name comes from the new `addRelative` template, "Add {relationship}". The template text outside `{relationship}` sits in `sr-only` spans, so the name contains the visible words and needs no `aria-label`.
  - The relationship label is `heirOptionLabels(options, true, messages.relationships, messages.heirRelationshipBlocked)`. A blocked-but-valid relative therefore shows the existing "does not inherit" wording and stays addable.
  - It is never natively `disabled`, because disabling the focused button would drop focus. When adds are not possible it uses `aria-disabled="true"`, and a press does nothing. That applies while a save is in flight, while offline (`frozen`), and at the heir limit.
- **What is offered** comes from a pure function in a new `web/src/interview/relatives.ts`: `addGroups(placementRoot, options)`.
  - The grouping is a fixed display map:
    - spouse: `husband`, `wife`;
    - parents: `father`, `mother`;
    - children: `son`, `daughter`;
    - siblings: `brother`, `sister`, `paternal_brother`, `paternal_sister`, `maternal_brother`, `maternal_sister`;
    - more: every other `RELATIONSHIP_IDS` entry, in catalog order.
  - **Spouse, parents and children:** a relationship is offered only when the active estate's `placement.root` has an entry for it. Its blocked flag comes from that entry, and placement order is kept. The active estate's placement is `kase.placement` for estate 1, or `death.placement` for a later death.
  - **Siblings and more:** a relationship is offered when it is not a key of the layer's `heir_options.invalid`. It is blocked when it is in `heir_options.blocked`.
  - **No placement root at all:** when `placementRoot` is `undefined` (an older server), spouse, parents and children fall back to the `heir_options` rule.
  - The browser holds no kinship rules of its own.
- **One press = one command.**
  - The press submits `{kind: "addHeir", from, values: {relationship, name: "", same_as: ""}, origin: "panel"}` through the existing `submit`. That runs `precheck`, sends `expected_revision` and gives one attempt.
  - Nothing is added locally. The tree, list and preview change only from the returned Case.
- **Success** (an `origin: "panel"` add):
  - The returned whole Case is accepted, and the existing `added` announcement goes to the existing polite region. This gives the numbered default label in the Locale, such as "Son 2 added."
  - Focus goes to `data-focus="add:<relationship>"`. When that button is gone (for example a father was just added), focus goes to `add-relatives-heading`.
  - Unlike a form add, a panel add does **not** call `resetHeirForm` and does **not** bump `formEpoch`, so an open edit form keeps its typed text and `editingHeir` stays as it was.
  - The preview recalculates through the existing `SharePreview` and `previewKey` path. Older-revision previews are discarded as today.
- **Refusal or limit** (an `origin: "panel"` add):
  - Its errors show inside the panel in one `role="alert"`, using `errorText` for the `relationship`, `heirs` and `form` codes. The existing `heirs.limit` text comes from its existing owner.
  - Focus stays on the pressed button, or goes to the heading when the button is gone.
  - `HeirForm` must not also show these errors. Keep them apart, for example with a `panel` field on `StartedView` holding `{relationship, errors?, notice?}`, cleared by the next action.
  - The existing refresh-on-relationship-error path still runs.
- **Capacity:**
  - When the active layer has 50 heirs (`heirLimitReached`), the panel shows the `heirs.limit` text as plain text above the groups and every add button is `aria-disabled`.
  - The precheck still refuses, and the server stays the limit authority.
- **Conflict:** an `origin: "panel"` add whose result is `replaced` with the **same** case id is a stale revision. It does not go to the existing-case screen. Instead the view:
  - stays `started` on the returned Case, through `reconcileFresh`;
  - shows the new `conflictNotice` as a `role="alert"` in the panel;
  - keeps focus on the pressed button;
  - does not resend.

  A `replaced` result with a different case id keeps today's behaviour.
- **Failed or throttled:** the existing default path runs: the case is re-read once for a lost add, and the notice is shown. For a panel add, the notice text shows in the panel and focus stays on the button.
- **Offline:** `frozen` already covers it. Buttons are `aria-disabled`, the existing `offlineEditing` status stays, nothing is sent and nothing is queued.
- **`HeirForm`** now renders only in two cases:
  - when an heir is being edited (`started.editingHeir !== null`), in edit mode;
  - when the active layer is a later death and `candidates.length > 0`, in add mode, so "someone already in this case" stays possible.

  It renders after the panel in the same column, and it is otherwise unchanged.
- **Copy:** new `interview` keys in ar, en and fr, each listed in `deferred-work.md` for native review. "More relatives" reuses the existing `heirMoreRelatives`.
  - `addRelativesHeading`: "Add relatives" / "إضافة أقارب" / "Ajouter des proches".
  - `addGroupSpouse`: "Spouse" / "الزوجية" / "Conjoint".
  - `addGroupParents`: "Parents" / "الوالدان" / "Parents".
  - `addGroupChildren`: "Children" / "الأبناء" / "Enfants".
  - `addGroupSiblings`: "Siblings" / "الإخوة والأخوات" / "Frères et sœurs".
  - `addRelative`: "Add {relationship}" / "إضافة {relationship}" / "Ajouter {relationship}".
  - `conflictNotice`: "This case changed in another tab. The latest version is shown, and your last change was not saved." / "تغيّرت هذه الحالة في نافذة أخرى. تُعرض الآن أحدث نسخة، ولم يُحفظ تغييرك الأخير." / "Ce dossier a été modifié dans un autre onglet. La dernière version est affichée et votre dernière modification n'a pas été enregistrée."

**Never:**
- Change the server, the API or the `case.ts` parsers. Do not compute shares, blocking or kinship validity in the browser.
- Create a local heir, queue an offline edit, retry by itself or send a count. The count stepper is 9.5.
- Wire card presses or placeholders, positioned adds, Undo or edit sheets. Those are 9.4–9.7.
- Change existing translations. Do not use physical left/right CSS. Do not use natively `disabled` add buttons.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Legacy male deceased | `placement.root` = father, mother (parent), wife (spouse), son, daughter (child); no invalid | Spouse: Wife; Parents: Father, Mother; Children: Son, Daughter; Siblings: 6; More: the rest | — |
| Second father | father exists; root has no `father`; invalid has `father: second_father` | Parents shows Mother only | — |
| Blocked | `heir_options.blocked` has `brother`; root `mother` entry `blocked: true` | both are offered, labelled with the `heirRelationshipBlocked` text | — |
| No placement | `placementRoot` undefined, invalid `{husband: husband_of_male}` | Spouse: Wife only | — |
| Press Son | revision 3, 1 son | one POST: relationship `son`, no name, `expected_revision` 3; list and tree show "Son 2"; polite "Son 2 added."; focus on the Son button | — |
| Press Father, then it is gone | no father | after success, focus on `add-relatives-heading` | — |
| 50 heirs | layer has 50 | limit text shown; all buttons `aria-disabled`; a press sends nothing | — |
| Refused | 400 `{relationship: "second_father"}` | case re-read; panel alert with the refusal; focus on the button; no heir added | — |
| Stale | 409 with the same case id at revision 5 | started view shows the revision-5 Case; panel alert `conflictNotice`; focus on the button | no resend |
| Offline | `navigator.onLine` false | buttons `aria-disabled`; press sends nothing; `offlineEditing` shown | — |
| Editing open | editing heir H with typed name, press Wife | add succeeds; edit form keeps H and its typed text | — |

</intent-contract>

## Code Map

- `web/src/app/[locale]/interview/start-case.tsx:500-540` -- the left-column `section aria-labelledby="heir-form-heading"` and `HeirForm`. Relabel it, render `AddRelatives` first, then `HeirForm` only under the two conditions above. `submit()` is at `:174`, `frozen` at `:228`, the focus-request effect at `:233` (it looks up `[data-focus=…]`, otherwise focuses the root; extend it so `add:` targets fall back to `#add-relatives-heading`), and `candidates` at `:279`.
- `web/src/app/[locale]/interview/add-relatives.tsx` (new) -- the panel component. Props: messages, groups, `atLimit`, `disabled`, panel outcome (errors and notice), and `onAdd(relationship)`.
- `web/src/interview/relatives.ts` (new) -- `ADD_GROUPS` display map, `addGroups(placementRoot, options)`.
- `web/src/interview/layers.ts` -- `layerAt()` returns `options` (layer `heir_options`). Get the active estate's placement root from `kase.placement?.root` or `death.placement?.root`. Add a small helper here if it is cleaner.
- `web/src/interview/flow.ts` -- `Answer` at `:523` (add `origin?: "panel"` to `addHeir`); `precheck():551`; `send():685`; `saved()` addHeir at `:790` (currently resets the form and focuses `relationship`); `save():879` (`invalid` path `:886`, `replaced` path `:922`, default path `:945`); `invalidView():536`; `Notice` at `:51`; `pendingView` (clear the panel outcome); `nextFocus`; `reconcileFresh():866`.
- `web/src/interview/answers.ts` -- `heirOptionLabels():180`, `heirLimitReached():199`, `templateParts():229` (for `{heir}`; write the `{relationship}` split the same way, or generalise it).
- `web/src/app/[locale]/interview/form-bits.tsx` -- `errorText`, `buttonClass`; `web/src/app/[locale]/ui.ts` -- `focusRingOnAccent`.
- `web/src/api/case.ts` -- `RELATIONSHIP_IDS:14`, `HeirOptions:96`, `Placement:172`, `MAX_HEIRS:53`. Read-only.
- `web/src/i18n/messages.ts` -- interview type `:79-190`; ar `~:357`, en `~:644`, fr `~:932`; `errors.heirs.limit` at `:462/:750/:1040`. Key tests are in `web/src/api/case.test.ts`.
- `web/src/interview/flow.test.ts` -- flow tests. The `replaced` test at `:747` uses a different case (keep it). Add panel-origin tests.
- `web/src/app/[locale]/interview/heir-form.test.tsx`, `web/src/test/dom` -- the jsdom component-test pattern.
- `web/e2e/interview.spec.ts:316-350` -- the offline test uses `en.heirAdd` (switch it to a panel button). The shell tests select `section[aria-labelledby='heir-form-heading']` and region `en.heirAddHeading` (switch them to `add-relatives-heading` / `en.addRelativesHeading`). `web/e2e/api.ts` (`fullCase`, `json`, `api.casePosts`), `web/e2e/family.ts` (`openHeirsScreen`). `web/e2e/accessibility.spec.ts` holds the heirs-screen axe tests.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- append a "Story 9.3" section with the new copy.

## Tasks & Acceptance

**Execution:**
- `web/src/interview/relatives.ts` -- the display map and `addGroups`, pure.
- `web/src/interview/relatives.test.ts` (new) -- the first four matrix rows; the order of groups and entries; empty groups are omitted.
- `web/src/interview/flow.ts` -- the panel origin: the success focus and no form reset; the panel outcome for invalid, failed or throttled; the same-id `replaced` handled as a conflict; the `conflict` notice.
- `web/src/interview/flow.test.ts` -- the Press Son, refused, stale (same id stays started with the returned case and does not resend), 50-heir precheck and editing-open rows. A form add keeps its current behaviour.
- `web/src/app/[locale]/interview/add-relatives.tsx` -- the panel described above.
- `web/src/app/[locale]/interview/add-relatives.test.tsx` (new) -- with jsdom:
  - the groups and their headings;
  - a button's accessible text contains its visible label, and the "+" is `aria-hidden`;
  - `aria-disabled` at the limit and while frozen, where a press does not call `onAdd`;
  - the blocked label;
  - the alert text for a refusal and for a conflict.
- `web/src/app/[locale]/interview/start-case.tsx` -- the wiring; the `HeirForm` conditions; the focus fallback.
- `web/src/i18n/messages.ts`, `web/src/api/case.test.ts` -- the new keys in ar, en and fr.
- `web/e2e/interview.spec.ts` -- update the offline and shell tests. Add:
  - pressing "Add son" on a mocked case posts exactly one body with `relationship: "son"`, `expected_revision` set and no name; the returned Case shows "Son 2" in the list and tree; focus is still on the button; the polite region says it was added;
  - a 409 with the same case id shows the returned Case and the conflict alert;
  - a 50-heir case shows the limit text with every add button `aria-disabled`;
  - no Father button when the case has a father.
- `web/e2e/accessibility.spec.ts` -- the heirs-screen axe run covers the panel in en and ar. Make sure it still passes.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- list the new strings per Locale.

**Acceptance Criteria:**
- Given the heirs screen, when it renders, then "Add relatives" leads the left column (above the tree below 1024px), with groups Spouse, Parents, Children, Siblings, More relatives offering only server-allowed relationships, and the 9.1/9.2 layout and tree tests still pass.
- Given any add outcome, when it settles, then focus is on the pressed add button (or the panel heading if that button is gone) and no heir exists that the server did not return.
- Given the web unit tests, lint, typecheck, build and the interview and accessibility e2e specs, when run, then they pass, with no new serious or critical axe violations.

## Spec Change Log

## Review Triage Log

### 2026-11-19 — Review pass (codex was over its usage limit until 05:12, so the five layers ran as Claude Sonnet subagents, read-only)
- verdicts: 36 findings — high 0, medium 2, low 13, false 21, maybe-false 0
- findings:
  - `[false]` `[reject]` (cross-story) no contract shape changed — confirmed: the diff touches only web view state; the POST body is unchanged.
  - `[false]` `[reject]` (intent) layout and styling (44px, border, wrap, accent) not asserted — the 9.1 shell e2e 44px audit measures every button on the heirs screen, the panel's included, and passes; the classes are the DESIGN tokens.
  - `[false]` `[reject]` (intent) offline not exercised for the panel — the offline e2e now drives the panel's "Add Son" button: `aria-disabled` goes true and a press sends nothing.
  - `[low]` `[reject]` (intent) blocked-but-valid not tested in e2e — covered by `relatives.test.ts` and `add-relatives.test.tsx` ("a blocked relative ... stays addable"); an e2e copy adds nothing.
  - `[false]` `[reject]` (intent) no optional name at add — the name stays optional and is never required; naming is done through Edit (the heir form), as the spec decided.
  - `[false]` `[reject]` (intent) preview recalculation and discarding of stale previews have no new tests — unchanged foundation code; its existing e2e "a preview computed for an older revision is never shown" still passes.
  - `[false]` `[reject]` (intent) conflict differs by case id — this is the spec's decision; a different case id is a replaced case, not a stale revision.
  - `[false]` `[reject]` (intent) fixed id-to-group map — a display grouping only; offering comes from server placement and options.
  - `[false]` `[reject]` (intent) shell selectors now depend on the panel — intended; the panel replaced the add form in that region.
  - `[low]` `[patch]` (verification-gap) `showHeirForm` gate untested — patched: an e2e test that the form is hidden by default and shown after Edit.
  - `[low]` `[patch]` (verification-gap) `placementRootOf` later-death branch untested — patched: a unit test in `layers.test.ts`.
  - `[low]` `[patch]` (verification-gap) panel add in a later-death layer untested — patched: a layered `flow.test.ts` case.
  - `[low]` `[reject]` (verification-gap, other) component test headings only `slice(0,3)`, en only — the full order is asserted in `relatives.test.ts`; ar runs in the axe e2e.
  - `[false]` `[reject]` (verification-gap, other) the `addGroupParents` carve-out — fine as written, as the reviewer notes.
  - `[false]` `[reject]` (verification-gap, other) the heading fallback — covered by the e2e "after adding a father".
  - `[medium]` `[patch]` (edge-case) remove/mark-death throttled or failed notices vanish when `HeirForm` is hidden — confirmed: `SaveNotice` rendered only inside `HeirForm`. Patched: the section renders `SaveNotice` when the form is hidden.
  - `[false]` `[reject]` (edge-case) a refusal code with no message shows nothing — `errorText` falls back to `messages.failed` for any unknown code (`form-bits.tsx:18`).
  - `[low]` `[reject]` (edge-case) the added heir is assumed to be the last layer heir — the same assumption as the existing form add path; the server appends rows. Diffing ids would add branches to guard a state never shown.
  - `[false]` `[reject]` (edge-case) a placement entry also in `invalid` — both come from the same engine query; 9.1b tests keep them consistent.
  - `[false]` `[reject]` (edge-case) other notice kinds reach the panel default branch — only `throttled` and `failed` reach `default:`; `missing` shows `heirGone` in the section.
  - `[false]` `[reject]` (edge-case) `layer` falsy while started — `layerAt` always returns a layer (falling back to the first).
  - `[low]` `[reject]` (edge-case) a server limit refusal at 49 shown heirs leaves the list stale — needs another tab adding meanwhile; the alert explains it, and a re-read branch is more than a direct correction.
  - `[false]` `[reject]` (edge-case) duplicate limit message — at the limit every button is `aria-disabled`, so the precheck limit outcome cannot be reached from the UI.
  - `[medium]` `[patch]` (edge-case, claim) "HeirForm otherwise unchanged" hides the lost notice site — same root cause and patch as the SaveNotice row.
  - `[false]` `[reject]` (blind) naming at add is lost — same as the intent row: names are optional and set through Edit.
  - `[false]` `[reject]` (blind) silent no-op for other notice kinds — same refutation as the edge-case row.
  - `[low]` `[patch]` (blind) a stale panel outcome persists across estate switches — confirmed for `openLayer`; patched: it clears `panel`, with a test.
  - `[low]` `[reject]` (blind) wrong new heir for the announcement — same as the edge-case row.
  - `[false]` `[reject]` (blind) the disabled state is unexplained — offline shows the `offlineEditing` status; saving is transient and announced on completion.
  - `[false]` `[reject]` (blind) duplicate limit message — same refutation as the edge-case row.
  - `[low]` `[patch]` (blind) `placementRootOf` untested — same patch as the verification-gap row.
  - `[low]` `[reject]` (blind) untested flow branches (replaced plus gone edit, double press) — the relationship-refusal re-read is tested (`log.reads === 1`); double press is guarded by the existing `submit` saving check; the replaced-gone branch is rare and mirrors the tested invalid-gone path.
  - `[low]` `[reject]` (blind) no Arabic/RTL component coverage; the `around()` single placeholder — axe runs in ar; each locale template has exactly one `{relationship}`; native review is recorded.
  - `[low]` `[reject]` (blind) fragile i18n exemption; Arabic "الزوجية" — one deliberate carve-out; the term is already on the native-review list in `deferred-work.md`.
  - `[false]` `[reject]` (blind) dead strings `heirAdd`/`heirNameHint`/`heirMoreRelativesLabel` — all still render in `HeirForm` (add mode in later layers, and edit).
  - `[false]` `[reject]` (blind) spec not in the diff — deliberate: the spec is the claims file, kept out of the reviewed diff.

## Design Notes

Why spouse, parents and children read `placement.root` while the other groups read `heir_options`: 9.1b's placement for the estate's deceased lists only parent, spouse and child links. Siblings and more distant relatives have no anchor at the deceased; they are reached through a father who is not recorded. `heir_options` remains the engine's whole-family list for them. Both sources come from the engine, so the browser only groups for display.

Why `aria-disabled` and not `disabled`: a press sets `saving`, which freezes every control. A natively disabled focused button loses focus to `body`, and that would break "focus stays on the add action".

Why a stale revision is handled only for panel adds: the AC asks for it on adds. Other commands keep the existing-case screen until 9.6 and 9.10 rework history and announcements.

## Verification

**Commands:**
- `cd web && npm test` -- expected: all node tests pass.
- `cd web && npm run lint && npm run typecheck` -- expected: no errors; at most 12 lint warnings.
- `cd web && npm run build && npx playwright test e2e/interview.spec.ts e2e/accessibility.spec.ts` -- expected: all pass.

## Auto Run Result

Status: done

**Summary:** The heirs screen now opens with an "Add relatives" panel, which replaces the add form.
- **Panel.** Relationship buttons are grouped Spouse, Parents, Children, Siblings and More relatives.
  - The first three groups come from the active estate's `placement.root`. The other two come from `heir_options`, without any `invalid` relationship.
  - Blocked-but-valid relatives stay addable, with the existing "does not inherit" wording.
- **One press.** A press sends one add with no name at the current revision. Focus stays on the button, or moves to the panel heading when the button is gone. The existing polite region announces the add ("Son 2 added.").
- **Outcomes.** A refusal, a failure or the limit shows in one panel alert. A same-case 409 shows the returned Case with a conflict alert and does not resend. At 50 heirs, every button is `aria-disabled` and the limit text shows. Offline, presses do nothing.
- **Heir form.** It now shows only while editing, or in a later estate that has link candidates.

**Files changed** (under `web/`):
- `src/interview/relatives.ts` (new): the display grouping and `addGroups`.
- `src/interview/layers.ts`: `placementRootOf`.
- `src/interview/flow.ts`: the panel-origin add, the `panel` outcome, the same-id conflict, and `openLayer` clears the panel.
- `src/app/[locale]/interview/add-relatives.tsx` (new): the panel.
- `src/app/[locale]/interview/start-case.tsx`: the wiring, the heir-form gate, the focus fallback, and `SaveNotice` when the form is hidden.
- `src/i18n/messages.ts`: seven new keys in ar, en and fr.
- Tests:
  - new: `relatives.test.ts`, `add-relatives.test.tsx`;
  - extended: `flow.test.ts`, `layers.test.ts`, `case.test.ts`;
  - e2e: `e2e/interview.spec.ts`, `e2e/api.ts` (a `postHeir` stub), `e2e/family.ts`.
- `_bmad-output/implementation-artifacts/deferred-work.md`: the new copy, for native review.

**Fixes before review:** The parent added the matrix e2e test "after adding a father his button is gone and focus lands on the panel heading", because the implementer left that row untested.

**Review:** one pass. Codex was over its usage limit, so the five layers ran as Claude Sonnet subagents. They raised 36 findings: high 0, medium 2, low 13, false 21.
- **Patched:**
  - medium: throttled or failed notices from remove and death writes vanished while the heir form was hidden. `SaveNotice` now renders in the section.
  - low: a panel alert survived an estate switch.
  - tests for the heir-form gate, `placementRootOf` and a layered panel add.
- **Deferred:** none.
- **Rejected:** the reasons are in the Review Triage Log. Many were already covered, refuted by the code (the `errorText` fallback, `layerAt` always returning a layer), or rare enough that a guard would add more than a direct correction (the server limit at 49 shown heirs, the added-heir-is-last assumption).

**Follow-up review recommended:** false. One medium entry was patched, and nothing high.

**Verification** (run by the parent after the last patch):
- `npm test`: 542 of 542 pass.
- `npm run lint`: 0 errors and 12 warnings, unchanged.
- `npm run typecheck`: clean.
- `npm run build`: OK.
- `npx playwright test e2e/interview.spec.ts e2e/accessibility.spec.ts`: 68 of 68 pass.

Matrix audit: every row has a passing test.
- `relatives.test.ts` covers the legacy, second-father, blocked and no-placement rows.
- `flow.test.ts` and the e2e cover Press Son, Stale and 50 heirs.
- The e2e "after adding a father" covers Press Father.
- `flow.test.ts` covers Refused and Editing open.
- The offline e2e covers Offline.

**Residual risks:**
- A later estate with link candidates showing the heir form is untested end to end; only the edit case has an e2e.
- Focus requests for `relationship` after `openLayer` or `startEditHeir` find no control while the form is hidden, so focus falls to the screen root.
- A panel add clears an open order or relatives question, as the form add did before.
- A same-revision conflict is handled for panel adds only; other commands still go to the existing-case screen.
- All new copy awaits native review.
- Wider suites were not run; the driver runs them once per batch.
