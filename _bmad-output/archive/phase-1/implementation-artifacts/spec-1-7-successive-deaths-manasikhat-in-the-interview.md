---
title: 'Story 1.7a: Successive Deaths (Manasikhat) in the Interview: Server'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: '9ed422b5658c921f97168393c7be8cdd2d9b354d'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The interview API cannot record that an heir died before the estate was divided, and the preview cannot run the layered engine from Story 2.4.

**Approach:** The session case gains up to two later deaths. Each later death has its own layer of heirs, and a row in a later layer can be linked to a person already in the case. The server checks every write, and the preview runs `compute_manasikhat` on rows that are always rolled back, returning each living person's combined share of the first estate. The web interview is Story 1.7b, in deferred work.

## Boundaries & Constraints

**Always:**
- The case stays in the session. The project owner decided on 2026-11-10 to keep it there, and moving it to the browser is deferred work. Engine rows exist only inside a transaction that is always rolled back.
- A case without deaths behaves exactly as before: the same case shape apart from an empty `deaths` list, and the same preview body, with no `deaths` key in `basis`. Existing fixtures stay valid.
- Any living heir in any layer can be marked deceased, blocked heirs included, up to two later deaths.
- The order of death is worked out, never asked, when it is implied: if A is an heir in B's layer, A died after B. `first` is required only when two later deaths are not ordered that way. `simultaneous` and `unknown` are refused, each with its own code, and nothing is stored.
- A link only joins rows of one person: same gender, alive at that layer's death, at most once per layer, never the layer's deceased or the first deceased. A link always points to the person's earliest row.
- Removing a row removes only that row. If the person still has another row, their name and their death move to their earliest remaining row, and other links are pointed at that row. If it was the person's last row, their death layer and its rows go too, recursively. Unmarking a death removes that layer and its rows in the same way. No orphaned layer or dangling link survives any write.
- Last write wins. Every write replaces the whole session record, and `get()` drops any tampered or inconsistent part, so a preview always reads one whole case and never answers 5xx because of the case shape.
- Kinship rules and `heir_options` apply per layer, using that layer's deceased's gender and its own heirs. All field errors of one write come together.

**Ask First:** Any engine change. Any schema migration. Any limit beyond those in this spec.

**Never:** Any change under `web/` other than its contract side (Story 1.7b). The project owner allowed the contract side on 2026-11-10: the texts for the new codes and parsing of layered previews. The lawyer Manasikhat mode, the per-layer proof (Epic 3), the legacy Django pages, a later deceased's own property, gharqa. Pushing this work.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Two layers | Male: wife W, sons S1, S2; S1 dies, heirs mother=W (linked), brother=S2 (linked) | Preview: W 13/48, S2 35/48; S1 not listed | N/A |
| Three layers | Above, then W dies: son=S2 (linked), mother M (new) | S2 275/288, M 13/288 (order 3 implied, `first` not needed) | N/A |
| School in a layer | Female: husband H, sons S1, S2; S1 dies: father=H, PGM new, brother=S2 | Hanbali H 9/16, PGM 1/16, S2 6/16; Hanafi/Maliki/Shafi'i H 5/8, PGM 0, S2 3/8 | N/A |
| Order needed | S1 and S2 both die, neither heir of the other | Second mark needs `first`; the answer sets orders 2 and 3 | Missing: `death: order_required`; `simultaneous` / `unknown`: own codes |
| Order contradicted | `first` says A, but A is an heir in B's layer | Refused | `death: order_conflict` |
| Third later death | Two later deaths exist; mark another | Nothing stored | `death: limit` |
| Already deceased | Mark a person who already has a death | Nothing stored | `death: already_deceased` |
| Bad link | Other gender, dead by then, already in the layer, or the layer's deceased | Nothing stored | `same_as`: `gender_mismatch` / `not_alive` / `already_linked` |
| Gender of a linked or deceased row | Edit its relationship to the other gender | Nothing stored | `relationship: gender_locked` |
| Empty later layer | A death with no heirs yet | Preview `not_ready` | N/A |
| Engine refusal | Jafari, or a refused layer (e.g. Maliki Malikiyya) | `unavailable` with the engine's reason, no numbers | N/A |
| Remove a linked person | W removed from layer 1, still mother in S1's layer | Layer-2 row kept with her name, now her earliest row; her death (if any) stays | N/A |
| Remove or unmark a deceased | S1's only row removed, or S1 unmarked | S1's layer and its rows go; a death inside it goes too; order 3 becomes 2 | N/A |
| Tampered session | Death on a missing row, duplicate orders, link to a later row, a cycle | `get()` drops the bad part; preview never 5xx | N/A |

</frozen-after-approval>

## Code Map

- `api/anonymous_case.py` -- session owner: `get():233`, `_read_heirs:186`, `heir_options:211`, `add_heir:320`, `update_heir:353`, `remove_heir:394`, `_save:274` (reassigns the whole dict). Layers, links and deaths live here.
- `api/heir_rules.py` -- pure kinship and hajb rules on counts; reuse per layer with that layer's deceased's gender.
- `api/preview.py` -- `_compute:94` builds rows, `preview:111` rolls back, `basis:61`, `HEIR_CLASSES`, `PLACEHOLDER_ESTATE`. Add the layered path beside the single path and leave the single path unchanged.
- `calc/manasikhat.py:10` `compute_manasikhat(calc, madhab)` -> `({earliest heir pk: Fraction}, v2 proof)`. It validates the topology and locks its own rows. Fields: `Calculation.parent` `calc/models.py:258`, `Deceased.heir`/`death_order` `:945`, `Heir.same_person` `:955`. Builder to copy: `calc/tests.py:3074` `build_layer`, `:3093` fixture.
- `calc/schools.py:21,43` -- `LAYERED_REASONS` holds `MANASIKHAT_UNSUPPORTED`; `UnsupportedCase.message` reads both tables. Read-only.
- `api/views.py:86` `CaseWriteView.write` -- add `DeathsView`/`DeathView` on the model of `HeirsView`/`HeirView:128-149`; routes in `api/urls.py`.
- `api/contracts/interview.json` -- error codes and `previewReasons`. `api/contracts/preview-fixtures.json` `{fixtures:[{title,case,response,display}]}` is read at `api/tests.py:1253` (API 1294, bridge 1342) and by `web/src/interview/preview.test.ts:12`, which must keep passing unchanged. `api/tests.py:1427` requires reasons = `REASONS` + `invalid_family`; extend it with `LAYERED_REASONS`.
- `api/tests.py:535` `InterviewHelpers` (`send`, `start`, `deceased`, `heir`, `plant:577`), `:1260` `PreviewTests` (`build`, `put_heirs`, `rows`).

## Tasks & Acceptance

**Execution:**
- [x] `api/anonymous_case.py` -- read and sanitize `deaths: [{heir_id, order, heirs:[{id, relationship, name, gender, same_as}]}]` in `get()`, and return each layer's `gender`, `heir_options` and each linked row's resolved `name`. Add `mark_deceased(heir_id, first)`, `unmark_deceased(heir_id)`, and `add_heir` with an optional `layer` (the deceased's heir id) and `same_as`. `update_heir` and `remove_heir` find rows in any layer and apply the removal rule.
- [x] `api/views.py`, `api/urls.py` -- `POST case/deaths/` `{case_id, heir_id, first?}` and `DELETE case/deaths/<heir_id>/?case_id=`, through `CaseWriteView.write`.
- [x] `api/preview.py` -- with deaths: `not_ready` while any layer is empty. Otherwise build the root and child rows (parent is the root, with `death_order`, `Deceased.heir` = the person's earliest row, and `same_person` links), call `compute_manasikhat`, and return one share per living person keyed by their earliest row id, plus `unallocated`, `proof: null` and `basis.deaths`.
- [x] `api/contracts/interview.json`, `preview-fixtures.json` -- the new codes, `manasikhat_unsupported` among `previewReasons`, and layered fixtures for the first three matrix rows under each school they name. The TypeScript fixture tests read every fixture, layered ones included.
- [x] `locale/{ar,en,fr}/LC_MESSAGES/django.po` + `.mo` -- only if new server-side text is added; error codes stay codes.
- [x] `api/tests.py` -- every matrix row; layered fixtures through the API and the bridge; single-layer fixtures unchanged; the preview leaves no `Calculation` rows; a tampered session never gives 5xx; every new code is in the contract.
- [x] `web/src/i18n/messages.ts`, `web/src/api/case.ts` + their tests -- ar/en/fr text for every new error code and `manasikhat_unsupported`. The preview parser accepts `proof: null` and `basis.deaths`, so every fixture parses and displays as it says. No flow, tree or form changes.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- add an entry for the qualified fiqh review of layered previews built from interview input.

**Acceptance Criteria:**
- Given a two- or three-layer case, when the preview runs, then the fractions equal the Story 2.4 matrix and no later deceased is listed.
- Given any refused write on a layered case, when it returns, then the session is unchanged and all errors come together.
- Given a case with no deaths, when any existing test runs, then it passes unchanged.

## Spec Change Log

- Implementation, 2026-11-10: the server contract made 5 web contract tests fail (new codes had no text; the strict parser refused `proof: null` and `basis.deaths`), while the spec both forbade `web/` changes and required `npm test` to pass. The project owner chose to do the web contract side now. Changed: the Never boundary, one new task, the fixture-test note and the web verification command. KEEP: the server implementation as built.

## Design Notes

Ids are unique across the case. `same_as` is stored normalized to the earliest row, so identity is one hop, and a row's engine `same_person` is that earliest row's pk. For example, the two-layer row:

```json
"deaths": [{"heir_id": "s1", "order": 2,
  "heirs": [{"id": "r1", "relationship": "mother", "same_as": "w"},
            {"id": "r2", "relationship": "brother", "same_as": "s2"}]}]
```

## Verification

**Commands:**
- `DATABASE_URL='sqlite://:memory:' DJANGO_ENV=test .venv/Scripts/python.exe manage.py test` -- expected: all pass.
- `.venv/Scripts/python.exe manage.py makemigrations --check --dry-run` -- expected: no changes.
- `npm run lint && npm run typecheck && npm test && npm run build` in `web/` -- expected: all pass.

## Suggested Review Order

**Session layers and identity**

- Start here: every layer of the session case, the first death then each later one in order.
  [`anonymous_case.py:332`](../../api/anonymous_case.py#L332)

- Reads stored deaths forward only, dropping anything tampered: bad targets, orders, links or oversized layers.
  [`anonymous_case.py:356`](../../api/anonymous_case.py#L356)

- Saves the cleaned case, never the derived options, so the session is always consistent.
  [`anonymous_case.py:277`](../../api/anonymous_case.py#L277)

**Deaths and order**

- Order of death worked out from heirship; `first` is needed only when nothing implies it.
  [`anonymous_case.py:402`](../../api/anonymous_case.py#L402)

- Marking a death: limit, already deceased, then the order check, all before saving.
  [`anonymous_case.py:437`](../../api/anonymous_case.py#L437)

**Removal without orphans**

- Removing a row promotes the person's earliest surviving row; deaths with no row left are pruned recursively.
  [`anonymous_case.py:456`](../../api/anonymous_case.py#L456)

- Unmarking removes the layer through the same pruning.
  [`anonymous_case.py:488`](../../api/anonymous_case.py#L488)

**Writes per layer**

- Adds to any layer; kinship uses that layer's deceased; links must be alive, same gender, once per layer.
  [`anonymous_case.py:505`](../../api/anonymous_case.py#L505)

- Edits in any layer; gender is locked for linked or deceased people; a rename renames the person.
  [`anonymous_case.py:555`](../../api/anonymous_case.py#L555)

- New death endpoints reuse the shared write wrapper.
  [`views.py:194`](../../api/views.py#L194)

**Layered preview**

- Builds root and child rows with links and runs the Story 2.4 engine inside the rolled-back transaction.
  [`preview.py:119`](../../api/preview.py#L119)

- Not ready while a layer is empty; a case with no deaths takes the unchanged single path.
  [`preview.py:140`](../../api/preview.py#L140)

- `basis.deaths` appears only for layered cases, so existing payloads stay byte-identical.
  [`preview.py:61`](../../api/preview.py#L61)

**Web contract side**

- A layered preview must carry `proof: null`, and its shares must be unique, known rows.
  [`case.ts:735`](../../web/src/api/case.ts#L735)

- Strict optional `basis.deaths` parsing.
  [`case.ts:562`](../../web/src/api/case.ts#L562)

- ar/en/fr text for the new codes; Arabic and French await native review.
  [`messages.ts:265`](../../web/src/i18n/messages.ts#L265)

**Tests and contracts**

- The matrix through the public API: order, links, removal, refusals and tampering.
  [`tests.py:2414`](../../api/tests.py#L2414)

- The preview contract now includes the layered reason table.
  [`tests.py:1437`](../../api/tests.py#L1437)

- Layered fixtures for the Story 2.4 matrix under every Sunni school, read by Python and TypeScript.
  [`preview-fixtures.json:1`](../../api/contracts/preview-fixtures.json#L1)
