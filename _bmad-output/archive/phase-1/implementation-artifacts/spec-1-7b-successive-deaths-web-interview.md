---
title: 'Story 1.7b: Successive Deaths (Manasikhat) in the Interview: Web'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: '4f74c89f2cb6fee4437851db187a198d98b03267'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-7-successive-deaths-manasikhat-in-the-interview.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The server records successive deaths (Story 1.7a), but the web interview drops `deaths` when it parses the case. A visitor can't mark an heir as also deceased or enter that heir's heirs. A layered preview shows raw row ids where names should be.

**Approach:** Parse `deaths` strictly. Add the death writes and layer-aware heir writes. Give the flow an active layer: the first deceased or one later death. Every heirs-screen part (form, list, tree, options) then works on that layer, and a breadcrumb moves between layers. The preview names each person by their earliest row.

## Boundaries & Constraints

**Always:**
- The server is the authority. The web never infers order of death, links or pruning. It sends the write and renders the case that comes back. Errors are shown by their code, all together, and never lose entered data.
- A case without deaths looks and behaves exactly as now: no breadcrumb, the same list, tree and preview.
- Active layer: `null` (first deceased) or a later death's `heir_id`. After every write, if that death no longer exists, fall back to `null`.
- Row actions in a layer:
  - A living row whose person has no death: "Also died". This marks the death and opens the new layer.
  - A row whose person has a death: "Open their heirs" and "Did not die". "Did not die" needs an inline confirm that says their heirs go too.
  - Remove, on a row whose person has a death: the same warning in its confirm.
- Order question: when the server answers `death: order_required`, ask "Who died first?". The choices are the two later deceased, "At the same time" and "Not known". The answer is resent as `first` (heir id, `simultaneous`, `unknown`). The server's refusal of the last two is shown as its message, and focus stays on the question.
- Adding in a later layer, the visitor chooses between "A new person" and "Someone already in this case". The second offers people whose earliest row is in an earlier layer, minus that layer's deceased, people already in the layer, and people whose death order is lower than this layer's. It sends `same_as`. Gender and aliveness are left to the server's codes. A linked row's name is read-only in the form.
- Breadcrumb in death order, the active one marked `aria-current`: "First deceased › <label> (2nd death) › <label> (3rd death)". The tree draws only the active layer, with the root labelled by its death order.
- Preview labels come from every layer, keyed by earliest row. A person first entered in a later layer reads "<relationship or name> of <that layer's deceased label>". `previewKey` includes `deaths`.
- All new text in ar/en/fr, with Arabic and French marked for native review. Keyboard, focus and RTL rules as in Stories 1.3-1.6, with a `data-focus` target for every new control.

**Ask First:** Any server or contract change under `api/`. Any new web dependency. A dialog or route instead of the inline patterns.

**Never:** The lawyer Manasikhat mode, the per-layer proof, the legacy Django pages, moving the case to browser storage, gharqa. Pushing this work.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Mark | S1 "Also died" in layer 1 | POST deaths; S1's layer becomes active; breadcrumb shows 2 entries | N/A |
| Link | In S1's layer: mother → "already in case" → W | POST heirs `{layer:s1, relationship:mother, same_as:w}`; row shows W's name | `same_as` code on the picker |
| Order asked | S2 "Also died", neither heir of the other | Question appears; choosing S1 resends `first:s1` | Same time / Not known: server message shown, nothing stored |
| Limit / already | A third death, or a person already dead | Server message; layer unchanged | `death: limit` / `already_deceased` |
| Did not die | S1 confirmed | DELETE deaths/s1; active layer falls back to first | N/A |
| Remove promotes | W removed from layer 1, still in S1's layer | List refreshes; W now appears only in S1's layer; preview still names her | N/A |
| Preview | Two-layer fixture | Every share has a human label, no raw id; S1 not listed | `manasikhat_unsupported` shows its reason, no numbers |
| Malformed deaths | Unknown keys, bad order, link to an unknown row | That death or row is dropped, the rest parses | Never throws for a case that has `id` |

</frozen-after-approval>

## Code Map

- `web/src/api/case.ts` -- `Case:95`, `Heir:60` (add `same_as`), `parseCase:199` (drops `deaths`), `HeirFields:395`, `answer:359`, `addHeir:410`, `updateHeir:419`, `removeHeir:429`, `parseErrors:347`. Add `markDeceased(signal, caseId, heirId, first?)` / `unmarkDeceased` beside them. `parsePreview:722` and `parseBasis:562` already accept layered previews.
- Server shape (read-only, `api/anonymous_case.py`): `get():233`, `_read_deaths:356`, `_decorate:346`. Each death is `{heir_id, order: 2|3, gender, heir_options:{blocked, invalid}, heirs:[{id, relationship, gender, name, same_as?}]}`. `_order:400` reads `first`. `mark_deceased:437`. Routes are at `api/urls.py:215-218`, and the codes are in `api/contracts/interview.json:249`.
- `web/src/interview/flow.ts` -- the pure flow: `View:90`, `StartedView:70`, `screenOf:143`, `Action:32`, `Deps:103`, `runAction:473`, `send:579`, `settle:386`. Add the active layer and the open-layer, mark, unmark and order actions here.
- `web/src/app/[locale]/interview/start-case.tsx` -- `useState<View>:100`, deps `:66`, the heirs screen `:370-426`. Options at `:401` come from layer 1 only, so they must come from the active layer.
- `.../heir-form.tsx` (useState, `noValidate`), `.../heir-list.tsx` (inline confirm `:70-144`, `data-focus` `editHeir:<id>` / `remove:<id>`), `.../form-bits.tsx` (`errorText:11`, `FormErrors:80`).
- `.../share-preview.tsx:71` and `.../family-tree.tsx:45`, `.../heir-list.tsx:73` -- `heirLabels(heirs, …)`. The preview falls back to the raw id at `:93`.
- `web/src/interview/tree.ts` `layoutTree:96`, a custom SVG with one spine. Reuse it unchanged per layer.
- `web/src/interview/preview.ts` -- `previewKey:9`, `reconcile`/`basisKey:33-47`. Both ignore deaths.
- `web/src/i18n/messages.ts` -- typed `Messages:15-130`. The 1.7a `same_as`/`death` error texts exist, but there is no UI copy for deaths yet.
- Tests run on `node --test` with no component tests and no e2e. Constraints: `case.test.ts:257` pins dropping `deaths` and must change; `case.test.ts:150` (keys in every locale), `answers.test.ts:407` (contract codes have text), and `flow.test.ts:~1146` (source `data-focus` targets).

## Tasks & Acceptance

**Execution:**
- [x] `web/src/api/case.ts` + test -- strict `deaths` and `same_as` parsing that drops bad parts; layer/`same_as` in `HeirFields`; `markDeceased`/`unmarkDeceased` on the shared `answer` path.
- [x] `web/src/interview/flow.ts` + test -- active layer, fallback after a write, mark/unmark/open/order actions, and the pending order question kept in the view.
- [x] `web/src/interview/` (new `layers.ts` + test) -- pure helpers: the rows, options and deceased of a layer, link candidates, labels across layers, the breadcrumb.
- [x] `web/src/interview/preview.ts` + test -- `previewKey`/`basisKey` include deaths. A layered fixture yields no unlabelled row.
- [x] `start-case.tsx`, `heir-form.tsx`, `heir-list.tsx`, `family-tree.tsx`, `share-preview.tsx`, new `death-breadcrumb.tsx` / order question -- wire the layer through the heirs screen.
- [x] `web/src/i18n/messages.ts` -- ar/en/fr UI copy.

**Acceptance Criteria:**
- Given a two- or three-layer case built through the UI, when the preview loads, then the shares match the 1.7a fixtures and every row has a label.
- Given any refused death or link write, when it returns, then the shown case is unchanged, the code's text is shown, and focus is on the control that owns it.
- Given a case with no deaths, when existing tests run, then they pass except for the deliberate `case.test.ts:257` change.

## Design Notes

The earliest row is the person's identity, and the server already normalizes `same_as` to it. Build one `rows: Map<id, {row, layer}>` over the layers in order. A person's label is the label of their earliest row in that row's own layer. A death's label is its `heir_id` row's label.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` in `web/` -- expected: all pass.
- `DATABASE_URL='sqlite://:memory:' DJANGO_ENV=test .venv/Scripts/python.exe manage.py test api` -- expected: all pass (the contract is unchanged).

**Manual checks:**
- `npm run dev`. Build the three-layer matrix case in en and ar using only the keyboard. Check the breadcrumb, the tree per layer, the order question, "Did not die" and the preview labels.

## Spec Change Log

- Review, 2026-11-10: three reviewers. No intent gap or spec defect; patches only. Fixed: the active layer is kept in the form record so a reload restores it (a draft for a deleted layer is dropped); a hidden stale link is asked for again; `already_deceased` re-reads the case; a refresh clears a stale order question and resets the form when its layer is gone; switching layers drops the draft's link; the parser drops a link to someone who already died; names never act as placeholders; the remove warning shows only when the person's last row goes; mark and unmark are announced. KEEP: the server stays the authority; a case without deaths is unchanged.

## Suggested Review Order

**Layers and identity**

- Start here: every layer in death order, the first deceased then each later death.
  [`layers.ts:21`](../../web/src/interview/layers.ts#L21)

- One map of rows across layers; a person is their earliest row.
  [`layers.ts:62`](../../web/src/interview/layers.ts#L62)

- The people a later layer may link: earlier rows, alive at that death, not already there.
  [`layers.ts:80`](../../web/src/interview/layers.ts#L80)

- Labels for every row of every layer, so a preview never shows a raw id.
  [`layers.ts:112`](../../web/src/interview/layers.ts#L112)

- The remove warning shows only when the person's last row goes, as the server prunes.
  [`layers.ts:170`](../../web/src/interview/layers.ts#L170)

**Strict parsing and writes**

- `deaths` parsed forward, dropping bad deaths, rows and links, never throwing.
  [`case.ts:213`](../../web/src/api/case.ts#L213)

- Death writes reuse the shared answer path; `first` carries the order answer.
  [`case.ts:529`](../../web/src/api/case.ts#L529)

**Flow: active layer, order question, refusals**

- Active layer and the open order question live in the started view.
  [`flow.ts:96`](../../web/src/interview/flow.ts#L96)

- Changing layer ends an edit and drops a link that belongs to the old layer.
  [`flow.ts:327`](../../web/src/interview/flow.ts#L327)

- Saved writes open the new layer, fall back when a layer is gone, and announce deaths.
  [`flow.ts:716`](../../web/src/interview/flow.ts#L716)

- Order refusals keep the question open; `already_deceased` re-reads the case first.
  [`flow.ts:837`](../../web/src/interview/flow.ts#L837)

- A reload restores the active layer and an edit in any layer.
  [`flow.ts:498`](../../web/src/interview/flow.ts#L498)

**Screens**

- The heirs screen works on the active layer: options, form, list, tree, breadcrumb.
  [`start-case.tsx:239`](../../web/src/app/[locale]/interview/start-case.tsx#L239)

- New person or someone already in the case; a stale link is asked for again.
  [`heir-form.tsx:60`](../../web/src/app/[locale]/interview/heir-form.tsx#L60)

- Row actions: also died, open their heirs, did not die, each with inline confirms.
  [`heir-list.tsx:170`](../../web/src/app/[locale]/interview/heir-list.tsx#L170)

- Breadcrumb in death order with `aria-current`; names never act as placeholders.
  [`death-breadcrumb.tsx:26`](../../web/src/app/[locale]/interview/death-breadcrumb.tsx#L26)

- Who died first, with same time and not known sent for the server to refuse.
  [`order-question.tsx:12`](../../web/src/app/[locale]/interview/order-question.tsx#L12)

- The preview names every share by its earliest row across layers.
  [`share-preview.tsx:73`](../../web/src/app/[locale]/interview/share-preview.tsx#L73)

**Preview cache and text**

- The preview key and ready check follow the deaths.
  [`preview.ts:9`](../../web/src/interview/preview.ts#L9)

- ar/en/fr copy for deaths, links and the order question; ar and fr await native review.
  [`messages.ts:85`](../../web/src/i18n/messages.ts#L85)

**Tests**

- Layer helpers, promotion, and every layered fixture labelled.
  [`layers.test.ts:67`](../../web/src/interview/layers.test.ts#L67)

- Strict death parsing and the death writes.
  [`case.test.ts:646`](../../web/src/api/case.test.ts#L646)

- Mark, order, unmark, links and fallback through the flow.
  [`flow.test.ts:1371`](../../web/src/interview/flow.test.ts#L1371)
