# Sprint Change Proposal: Epic 9 lineage data path

Date: 2026-11-19
Trigger: Story 9.2 was blocked in the unattended build loop (`_bmad-output/implementation-artifacts/bmad-build-auto-result-9-2-render-the-family-as-lineage-cards-on-a-navigable-canvas.md`).
Mode: batch.
Scope: Moderate (backlog reorganisation, one new story, no change to the PRD or to the architecture's decisions).

## 1. Issue summary

Story 9.2 renders the Family tree "from stable person ids and lineage edges" with died-before, died-later and blocked cards, plus engine-allowed "+ Add parent" / "+ Add spouse" placeholders. It assumes Epic 8 delivered these to the Interview. Epic 8 delivered the **Family contract** (AD-25) and the engine, but no story moved the **Interview Case** onto it:

- The Case JSON (`GET /api/v1/case/` and every command response) carries `deceased`, `heirs`, `heir_options` and `deaths` only. It has no persons, edges or statuses (`api/anonymous_case.py:296`, `web/src/api/case.ts:315`).
- `family_from_session()` always emits `'edges': []` and only the `alive` and `died_later` statuses (`calc/adapters.py:30,44`).
- The v2 snapshot writer refuses edges and `died_before_or_with` as `unsupported_content` (`api/snapshots.py:104-106`), so the stored Case cannot hold them either.
- The engine has no "which relationships can be added *where*" query. `relationship_options` counts per estate only (`engine/queries.py:70`), although AD-16 lists that query. Stories 9.3 and 9.7 cite it as "Epic 8.4", which does not exist as written.

Discovered on 2026-11-19 during step-2 planning of 9.2, after 9.1 shipped.

## 2. Impact analysis

- **Epic 9:** one new backend story, **9.1b**, before 9.2. Stories 9.2, 9.3, 9.4 and 9.7 change their *Given* clauses or data source. 9.5, 9.6 and 9.8–9.12 are unchanged.
- **Epic 8:** done; not reopened. The contracts are right; only their use by the Interview is missing.
- **PRD:** no change. FR-2 and FR-3 already require positioned adds and died-before.
- **Architecture:** no decision changes. AD-16, AD-20 and AD-25 already prescribe this. One clarifying note is added to AD-20's conversion list.
- **UX:** one rule is added to EXPERIENCE.md, saying how relatives without a recorded parent are drawn.
- **Technical:**
  - `api` session Case shape and snapshot encode/decode (expand only; v1 readers are kept);
  - one new pure engine query;
  - `web/src/api/case.ts` parsing.
- No data migration. Existing Cases have no edges, and that remains valid.

## 3. Recommended approach

**Direct adjustment.** Insert Story 9.1b, "Carry lineage and status in the Interview Case", owned by `api` and `engine`. Then 9.2 is a rendering story again.

Decisions taken with the owner on 2026-11-19:

1. **A new backend story comes first**, rather than folding the work into 9.2 or faking lineage in the browser.
2. **Unlinked relatives hang from the deceased.** A relative with no recorded parent (every existing relative, and every one added with a plain relationship button) is drawn from the deceased on its generation line, as today. A `parent_of` link exists only when a user adds at a chosen person (9.7) or edits one. Nothing is guessed and nothing is migrated.
3. **Placeholders come from a new engine query.** It returns the relationships allowed at each person and is served in the Case response. The same query drives 9.2's placeholders and 9.7's "Add relative here".

- **Effort:** one medium backend story. 9.2 shrinks slightly.
- **Risk:**
  - snapshot compatibility (AD-20 expand → switch → contract) is mitigated by keeping the v1 writer's refusal and gating persistence on the v2 writer;
  - query latency is bounded at 50 Heirs, and the NFR-3 budget is re-checked by 9.12.
- **Timeline:** +1 story in Epic 9.

## 4. Detailed change proposals

### 4.1 epics.md: new Story 9.1b (insert after Story 9.1)

```
### Story 9.1b: Carry lineage and status in the Interview Case

As a family member building a Case,
I want the server to keep who belongs to whom and who died before the deceased,
So that the tree can show the real family and only offer additions that fit it.

**Acceptance Criteria:**

**Given** Epic 8's Family contract, engine queries and Case command service (8.1, 8.4, 8.9) and the existing session Case
**When** any Case read or command response is returned
**Then** the Case carries every person once with a stable id (earliest row id, `same_as` aliases resolved), its status (alive, died before or with the deceased, died later with order) and its `parent_of`/`spouse_of` edges, and `family_from_session()` builds the Family from them instead of emitting empty edges (AD-20, AD-25)
**And** existing Cases with no recorded edges or died-before statuses read unchanged, with no migration, and their shares, proofs and previews are byte-identical to before.

**Given** a family with persons and edges for the active estate
**When** the new pure engine query for placement (relationships allowed at a person, taking the rule set and estate) runs
**Then** the Case response carries, per person and for the deceased, the allowed relationships at that position (including the parent and spouse slots), computed only by the engine (AD-16)
**And** no shell or browser module derives them, the query is covered by engine unit tests including a second father and a fifth wife being disallowed, and its time for 50 Heirs fits inside the NFR-3 engine budget.

**Given** the snapshot writer version
**When** a Case with edges or a died-before status is stored
**Then** schema 2 stores and reads them losslessly in the session, the SavedCase, share, invite and received views; the v1 writer keeps refusing them as `unsupported_content`; and the reader/writer round-trip matrix covers both (AD-20 expand → switch → contract)
**And** `web/src/api/case.ts` parses the new fields with a test-fixture round trip, treating them as absent when a server sends none.

**Given** this story
**When** it ships
**Then** it adds no new command and no UI; creating links is Story 9.7's positioned add and setting died-before is Story 9.4's edit, both through the existing command service.
```

Rationale: AD-16, AD-20 and AD-25 require this, Epic 8 left it unbuilt, and 9.2, 9.4 and 9.7 all depend on it.

### 4.2 epics.md: Story 9.2

**Section: first AC, Given.**

OLD:
`**Given** Story 9.1 and Epic 8 Family/PresentedResult data for the active estate`

NEW:
`**Given** Stories 9.1–9.1b and the Case's persons, statuses and lineage edges plus PresentedResult data for the active estate`

**Section: first AC, Then.** Append a sentence.

OLD:
`... showing one estate level at a time (AD-19, AD-20, UX-DR13, UX-DR14)`

NEW:
`... showing one estate level at a time (AD-19, AD-20, UX-DR13, UX-DR14); a person with no recorded parent hangs from the deceased on their generation line, as in the shipped tree`

**Section: empty-estate AC, Given.**

OLD:
`**Given** an empty active estate and engine query results supplied through the Epic 8 command-service boundary`

NEW:
`**Given** an empty active estate and Story 9.1b's per-person placement options in the Case response`

Rationale: names the real data source, and records the owner's decision on unlinked relatives.

### 4.3 epics.md: Story 9.3

**Section: first AC, Given.**

OLD:
`**Given** Stories 9.1–9.2 and allowed relationships from Epic 8.4 queries through 8.9's command service`

NEW:
`**Given** Stories 9.1–9.2 and the allowed relationships for the deceased from Story 9.1b's placement options in the Case response`

Rationale: points the panel at the query that actually exists after 9.1b.

### 4.4 epics.md: Story 9.4

**Section: second AC, Given.**

OLD:
`**Given** an open edit surface and Epic 8's edit-validity query/command interfaces`

NEW:
`**Given** an open edit surface, Epic 8's edit-validity query/command interfaces, and a command-service edit that sets a person's died-before status on Story 9.1b's Case (persisted only when the snapshot writer is schema 2, otherwise refused with a localised reason and no mutation)`

Rationale: 9.1b deliberately adds no commands, so the status write lands with its UI.

### 4.5 epics.md: Story 9.7

**Section: first AC, Given.**

OLD:
`**Given** Stories 9.2–9.6 and the allowed-at-position query from Epic 8.4 through the command-service boundary`

NEW:
`**Given** Stories 9.2–9.6 and Story 9.1b's per-person placement options, and an add command that records a `parent_of` or `spouse_of` link to the chosen person (persisted only when the snapshot writer is schema 2, otherwise refused with a localised reason and no mutation)`

Rationale: the link-creating command belongs with the positioned-add UI.

### 4.6 sprint-status.yaml

Insert after `9-1-establish-the-interview-shell-and-accessible-tree-tokens: done`:

`  9-1b-carry-lineage-and-status-in-the-interview-case: backlog`

`auto-dev.ps1` matches `\d+-\d+[a-z]?`, so it picks 9.1b before 9.2.

### 4.7 Architecture spine: AD-20 note (clarification, no decision change)

Append to AD-20 **Conversion**, item 3:

`Lineage edges and died-before statuses (FR-2, FR-3) are likewise persisted only when every active and rollback-eligible image reads schema 2; until then the commands that create them are refused without mutation.`

### 4.8 EXPERIENCE.md: tree-canvas row

Append to the tree-canvas component row:

`A relative with no recorded parent hangs from the deceased on their generation line; a lineage link exists only after adding at a chosen person or editing one.`

### 4.9 Follow-ups

- Delete the blocked result file `bmad-build-auto-result-9-2-…md` once 9.1b is in the backlog. It records a resolved block.
- `epic-9-context.md` becomes stale automatically, because epics.md becomes newer. The next build-auto run recompiles it.

## 5. Implementation handoff

- **Classification:** Moderate.
- **Recipients:**
  - Developer (the auto-dev loop) builds 9.1b, then resumes 9.2.
  - The owner approves this proposal and switches the production snapshot writer to schema 2 before 9.4 or 9.7 ship.
- **Success criteria:**
  - 9.1b: the existing Django calc+api suite stays green, and the round-trip matrix passes with the new fields.
  - 9.2 plans without an intent gap.
  - No existing Case changes its shares.
