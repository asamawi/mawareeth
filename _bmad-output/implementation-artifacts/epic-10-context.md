# Epic 10 Context: Named Saved cases that open directly

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Registered users open a Saved case from My cases straight into the Interview with its family loaded, name and rename it, and have later edits saved to it automatically, so My cases always holds their latest work and they never lose changes. Guest recovery stays separate and shared links stay read-only views of the stored case.

## Stories

- Story 10.0: Warn before unsaved changes to a Saved case are discarded
- Story 10.1: Name a Case and show whether saving succeeded (part A done: naming and truthful status; part B open: conflict choices)
- Story 10.2: Find and rename named Cases in My cases
- Story 10.3: Open Saved cases directly and keep guest recovery separate
- Story 10.4: Preserve received invitations and label shared Cases as read-only
- Story 10.5: Save an opened Saved case automatically

## Requirements & Constraints

- Opening a Saved case goes straight to the Interview with no resume-or-start-over prompt. Starting a new Case is a separate explicit action in My cases and is never linked as a write-back to a previously opened Saved case. The resume/start-over prompt remains only for a returning guest with an unsaved Case under 24 hours old.
- Save lives on Full results only (the Interview links to it). Only Save asks for a Case name, prefilled "Estate of {Deceased name or label}, {date}"; Share and WhatsApp save a first-time Case with the default name and never change an existing name. Names accept any script up to 100 user-perceived characters (grapheme clusters, same count on client and server), are trimmed, fall back to the default when blank, and may be duplicated. An over-limit or non-string name is rejected by the server (400) without mutation. Client and server count graphemes the same way.
- My cases labels by Case name and last change, defaults to most recently changed first, and offers name sorting using the current Locale's collation. Inline rename must not touch family, Basis, identity or share/invite links.
- Changes to an opened Saved case are saved automatically, and the user can see whether the latest change is saved. The status line reads Saving, then "Saved to My cases" only after success, with a failure message plus Retry that keeps the family. Wording is draft; ar/fr need native review.
- Conflict (SavedCase changed elsewhere): part A already shows a distinct conflict message, never "Saved to My cases". Part B adds exactly two choices, "Open latest version" or "Save as a new case"; no merge, no force-overwrite, nothing discarded until chosen. "Save as a new case" needs a new explicit create operation that relinks the working copy under concurrency.
- Unsaved working-copy changes show a notice, and opening another case or Start over asks "Discard unsaved changes?" with the safe choice focused; if the unsaved state cannot be read, ask anyway. No browser leave warning.
- Accessibility and layout: 44px targets, labelled inputs, visible focus, bdi dir=auto for mixed-script names, 320px/400% reflow, light/dark tokens, skeleton loading with aria-busy, empty state distinct from failure.
- Capacity: every Interview action stays under the 1000 ms p95 with autosave and the contention writer running; the two-later-death actions are already near budget (about 930-940 ms).

## Technical Decisions

- The server owns the Case. An opened SavedCase is a session working copy linked to the SavedCase id and base revision. Accepted changes are written back in a separate request after the command, with a compare-and-swap on that revision. Autosave only updates the linked SavedCase: it never creates one, never changes the Case revision or a pinned version, and never overwrites on conflict. A never-saved Case is saved only by explicit Save.
- The save endpoint currently creates a new SavedCase when the linked one is not found; autosave must be update-only so a deleted case, lost link or other account creates nothing.
- Autosave requests name the Case revision they mean to save; "saved" is claimed only when the answer covers the latest revision. At most one request in flight, newest state sent next, no endless retry.
- Some valid working states cannot be saved (no heirs, or Schools differ and none chosen); these keep edits and say what is missing rather than reporting failure. Conflict responses must be distinguished from generic save errors on the client.
- Unsaved state is derived from the Case revision versus the revision last loaded or written; the session link gains one field, and old links without it count as unsaved. No schema migration; the open endpoint stays compatible with old and new images (blue-green).
- Basis is a discriminated compare/school/country value; saving never changes stored Basis intent or a pinned preset version. Results are never stored, always recomputed.
- Share links are a live view of the persisted SavedCase (so autosaved edits become visible to recipients, owner-approved 2026-11-26); they never expose unsaved working inputs or cached results.
- Guest Case expiry (24 hours after last change) is enforced by the Case service on every read and edit; an expired guest Case shows "This case has expired" with one new-Case action and no family data. A SavedCase is never treated as an expired guest Case.
- SavedCase.name is an unlimited text column (owner, 2026-11-26; a fixed width could not hold 100 graphemes); the 100-grapheme rule is enforced in code, server by Unicode extended grapheme clusters and client by Intl.Segmenter.
- Epic 8 foundations are consumed, not rebuilt: SavedCase name field and backfilled default names, schema-2 writers, command service, revision conflict outcomes, list readers, presentation layer.

## UX & Interaction Patterns

- Signed-out Save uses the existing sign-in dialog, then resumes into the naming flow for the same Case; authentication and naming never stack dialogs and cancelling never claims a save.
- The same inline status-line carries save, autosave, PDF generating/failed and share link created/copied states; "copied" only after a successful copy; one announcement per settled save.
- Interview shows "Changes not saved to My cases yet" with a link to Save on Full results (stopgap until autosave).
- Shared view shows a read-only banner (accent-soft fill, 1px accent border, rounded node, 12px padding) and invents no Country name or version.
- Received/invite entry paths and their acceptance, expiry and revocation rules stay as shipped.

## Cross-Story Dependencies

- 10.0 first (stopgap prompt); 10.3 reuses its discard prompt on direct open and new Case.
- 10.1 part A (done) provides the status line and naming flow; part B (conflict choices) is open and 10.5 depends on it, so 10.5 follows part B.
- 10.2 and 10.3 depend on Epic 8 (list readers, names, revision/conflict boundary, converted cases) and Epic 9's editor.
- 10.4 reads the persisted SavedCase, so it reflects both explicit and automatic saves.
- Epic 14 must keep autosave from changing a pinned preset version; preset-version messaging stays there.
