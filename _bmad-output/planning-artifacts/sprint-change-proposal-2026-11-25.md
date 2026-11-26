# Sprint Change Proposal: Opened Saved cases save automatically

Date: 2026-11-25
Trigger: Owner report: "when opening saved case and updating the updates are not saved", seen on the local copy and in production, without pressing Save. "It should save automatically."
Mode: batch.
Scope: Moderate (one architecture rule, two new Epic 10 stories, three Epic 10 stories edited, one PRD consequence, two UX rows).
Status: Approved 2026-11-26 by Ahmad. Edits applied to the spine, epics.md, the PRD, EXPERIENCE.md and sprint-status.yaml.

## 1. Issue summary

Opening a Saved case loads a working copy into the session, linked to the SavedCase id and base revision. Each Interview change updates only that copy. The SavedCase changes only through an explicit Save, and opening a case again replaces the working copy with the last saved version, so unsaved changes are lost.

**Type:** new requirement from the owner. The code follows AD-20 as written ("Save writes back"); nothing is malfunctioning.

**Evidence (by reading the code; not yet reproduced in a browser):**

- `OpenSavedCaseView.post` (`api/views.py`) loads the stored snapshot through `load_snapshot`, which calls `start(request)` and replaces the session case.
- The only write to an existing SavedCase's family is the save POST in `api/views.py`. `saveCase` is called only from `web/src/app/[locale]/results/auth-gate.tsx`, so there is **no Save control in the Interview**. Share and WhatsApp on Full results also save first.
- The edits survive in the session (Interview, Resume) until another open or a start-over replaces them; after that the app cannot recover them.
- An independent codex trace of `05ecadd` and `17c4a9e` reached the same cause and found the save and open backend materially the same in both, with no write-back regression.
- `cases-view.tsx` opens a case without checking for unsaved changes. Story 10.3 already plans the prompt "Discard unsaved changes?" (owner decision, 2026-11-16), but it is backlog.

## 2. Impact analysis

### Findings that shape the design

1. **The save endpoint creates a case when it cannot find the linked one.** `row is None` leads to a new SavedCase. That is right for a first Save. With autosave, a deleted case, a lost link or another account would silently create copies. Autosave must be update-only.
2. **Shared links are live views of the SavedCase** (PRD FR-19, AD-18). With autosave, a recipient can see a half-finished edit. This needs an owner decision (section 6).
3. **A conflict (409) is shown today as a plain save error.** `saveCase` turns every non-OK answer except `school_required` into `null`.
4. **Some valid working states cannot be saved:** no heirs, or Schools that differ with none chosen (`school_required`). These must keep the edits and say what is missing, not report a failure.

### Epics and stories

| Item | Effect |
|---|---|
| Epic 9 | No change. Its retrospective verdict and action items are unaffected. |
| 10.0 (new) | Stopgap: show unsaved changes and ask before discarding them. First story of Epic 10. |
| 10.1 | Save stays explicit for a never-saved Case. For an opened Case the status line also reports autosave. |
| 10.3 | The discard prompt moves to 10.0; 10.3 keeps it working with autosave. |
| 10.4 | The share criterion about unsaved working inputs is reworded. |
| 10.5 (new) | Autosave. After 10.1, because it uses its status line and conflict choices. |
| Other epics | No order change found. Epic 14 (preset versions) must keep autosave from changing a pinned version. |

### Artifacts

- **PRD:** FR-7 gains one testable consequence. MVP scope is otherwise unchanged.
- **Architecture:** AD-20 "Opened SavedCase" changes, in the spine and in its copy in `epics.md`. Command service, Undo and offline rules stay.
- **UX:** the Saving row and the UJ-3 flow in `EXPERIENCE.md`; UX-DR61 in `epics.md`. New en, ar and fr text needs native review for ar and fr.
- **Testing and release:** `capacity_check` must cover autosave alongside edits. The two-later-death actions are near the budget (worst 932 to 941 ms of 1000 ms in the recorded runs), and write-path changes also speed the contention writer.
- **Schema:** none expected. The session link gains one field; old links without it must be handled.

## 3. Recommended approach

**Option 1, Direct Adjustment: selected.** Add two stories and edit three. Effort: medium. Risk: medium (concurrent saves, capacity budget, live shares).

- **Option 2, Rollback:** not viable. No completed story caused this.
- **Option 3, MVP review:** not needed. No scope is cut.

**Alternative considered:** write the SavedCase inside every command. Rejected: it adds work to the timed write path, ties each edit to save conflicts, and would refuse valid edits that cannot be saved yet. A separate request keeps AD-20's command service unchanged.

## 4. Detailed change proposals

### 4.1 Architecture (`ARCHITECTURE-SPINE.md` AD-20, and the copy in `epics.md`)

OLD:

> **Opened SavedCase:** the session holds a working copy linked to the SavedCase id and its base revision. Save writes back with a compare-and-swap on that revision, and a conflict is reported, never overwritten.

NEW:

> **Opened SavedCase:** the session holds a working copy linked to the SavedCase id and its base revision. Accepted changes are written back automatically, in a separate request after the command, with a compare-and-swap on that revision. Autosave only updates the linked SavedCase: it never creates one, never changes the Case revision or a pinned version, and a conflict is reported, never overwritten. A never-saved Case is saved only by an explicit Save (sprint change 2026-11-25).

### 4.2 PRD (FR-7, testable consequences)

ADD:

> - Changes to an opened Saved case are saved to it automatically, and the user can see whether the latest change is saved.

### 4.3 New Story 10.0: Warn before unsaved changes to a Saved case are discarded (stopgap)

As a registered family member,
I want to know that my changes are not yet in My cases and be asked before they are discarded,
So that I do not lose work.

**Given** a working copy opened from a Saved case
**When** its Case revision differs from the revision last loaded from or written to that SavedCase
**Then** the Case response says it has unsaved changes, and the Interview shows "Changes not saved to My cases yet" with a link to the existing Save on Full results
**And** a successful Save or a fresh open clears the notice, and a never-saved Case does not show it.

**Given** unsaved changes
**When** I open a Saved case from My cases, or confirm Start over in the Interview
**Then** I am asked "Discard unsaved changes?", with the safe choice focused; cancelling sends no request and keeps the working copy, and confirming discards only the working copy (owner decision, 2026-11-16, moved from 10.3)
**And** if the working copy changes in another tab between the prompt and the confirmation, I am asked again instead of losing the newer change
**And** if the unsaved state cannot be read, the prompt is shown.

**Given** a session link written before this release, with no recorded Case revision
**When** the Case is read
**Then** it is treated as having unsaved changes until the next Save or open.

**Given** the release
**When** old and new images both serve requests
**Then** the open endpoint's request and response stay compatible with the old client, and no migration is needed.

Leaving the page does not discard the working copy, so no browser leave warning is added.

### 4.4 New Story 10.5: Save an opened Saved case automatically

As a returning family member,
I want my changes to an opened Saved case saved without pressing Save,
So that My cases always holds my latest work.

**Given** an opened Saved case, signed in and online
**When** a change or Undo is accepted
**Then** one save request follows shortly after the last accepted change, with at most one in flight and the newest state sent next
**And** the request names the Case revision it means to save, so a save that reaches the server before an edit cannot be reported as covering it,
**And** the status line shows "Saving", then "Saved to My cases" only when the answer covers the latest Case revision, and one status announcement is made per settled save.

**Given** an autosave request
**When** the linked SavedCase is missing, belongs to another account or the link is absent
**Then** nothing is created or written, the working copy is kept and the outcome is visible.

**Given** the SavedCase changed elsewhere
**When** autosave meets the conflict
**Then** autosave stops and the 10.1 message and its two choices appear; nothing is merged, overwritten or discarded until I choose, and I can keep editing.

**Given** a working copy that cannot be saved yet (no heirs, or Schools differ and none is chosen)
**When** autosave runs
**Then** the line says what is missing, the edits stay, and the next change tries again.

**Given** a network failure, a timeout, or an expired sign-in
**When** autosave fails
**Then** "Could not save. Your family is still here. Try again." and Retry appear, or sign-in which returns to the same Case; there is no endless automatic retry.

**Given** a save is pending or failed
**When** I open another Case, start a new one or sign out in the app
**Then** the pending save is sent first; if it does not succeed, the 10.0 prompt appears before anything is discarded.

**Given** a never-saved Case
**When** I edit it
**Then** nothing is autosaved; Save with naming and sign-in (10.1) stays the first save, after which autosave applies.

**Given** a Case pinned to a preset version or with no School chosen
**When** autosave runs
**Then** the stored Basis intent and pinned version are unchanged by the save itself (AD-18, FR-19).

**Given** the capacity gate
**When** autosave runs alongside the six Interview actions on the two-later-death Case
**Then** every action stays under the 1000 ms p95 budget with the contention writer running.

**Given** tests
**When** the story is complete
**Then** they cover: edit then reopen from My cases shows the edit; rapid edits; Undo; two tabs; deleted case; other account; no heirs; school required; offline; sign-in expiry; and a Case never saved.

### 4.5 Story 10.1 (edit)

OLD: "**When** I save edits, including after another working copy has saved"
NEW: "**When** I save edits, or autosave writes them (10.5), including after another working copy has saved"

Rationale: the conflict and status rules are shared by both kinds of save.

### 4.6 Story 10.3 (edit)

OLD: "**Given** the current working Case has unsaved changes / **When** I open a Saved case or start a new Case from My cases / **Then** I am asked "Discard unsaved changes?" first…"
NEW: the same criterion, moved to 10.0, replaced here by: "The 10.0 discard prompt still applies when a direct open would replace unsaved changes."

### 4.7 Story 10.4 (edit)

OLD:

> **Given** the owner has a saved family and then changes only its working copy … reflecting only accepted saves

NEW:

> **Given** the owner has a saved family and its working copy has a change that is not yet saved … reflecting only accepted saves, whether explicit or automatic

### 4.8 UX (`EXPERIENCE.md`, UX-DR61)

- Saving row, ADD: "For an opened Saved case these states also follow autosave. Not saved yet: 'Changes not saved to My cases yet' (wording draft)."
- UJ-3, ADD after step 3: "His changes are saved to the case as he makes them."

### 4.9 Sprint status

Under `epic-10`: add `10-0-warn-before-unsaved-changes-are-discarded: ready-for-dev` before 10-1, and `10-5-save-an-opened-saved-case-automatically: backlog` after 10-4. `epic-10` becomes `in-progress` when 10.0 starts.

## 5. Implementation handoff

- **Scope:** Moderate. Product Owner / Developer roles; the owner approves AD-20.
- **Sequence:** 10.0, then 10.1, then 10.5; 10.2 to 10.4 as planned.
- **Build:** `bmad-build` per story. 10.0 and 10.5 go to a Sonnet subagent, because each spans more than three files; review by codex.
- **Success criteria:** an edit to an opened Saved case is there after reopening it, with no Save pressed; no test or flow creates or overwrites a SavedCase by autosave; the capacity gate passes.

## 6. Owner decision

**Shared links during editing.** Decided 2026-11-26: accepted as recommended. Recommendation: a shared link keeps following the Saved case, as FR-19 says, so recipients can see changes as they are autosaved. Alternative: recipients see only an explicitly published version; that changes FR-19 and AD-18 and is a larger piece of work.

## Checklist record

- 1.1 to 1.3 done (trigger is an owner report, not a story). 2.1 to 2.5 done. 3.1 to 3.4 done (no `AGENTS.md` in this repo). 4.1 viable; 4.2 and 4.3 not viable or not needed; 4.4 done. 5.1 to 5.5 done. 6.1 and 6.2 done.
- 6.3 done (approved 2026-11-26). 6.4 and 6.5 done.
- Narrowing: planning documents were searched for save, share and AD-20 passages and those parts read; they were not read in full.
