---
title: 'Story 10.4: Preserve received invitations and label shared Cases as read-only'
type: 'feature'
created: '2026-11-27'
status: 'done'
baseline_commit: '983a319b0a4c3b1a160952505341f42bdd3c4588'
baseline_revision: '983a319b0a4c3b1a160952505341f42bdd3c4588'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The shared view (`/{locale}/shared/`) shows only a draft disclaimer, styled `border-current/60`. It never says the view is read-only, and it does not use the `shared-case-banner` design tokens. On Full results, PDF progress and failure, share-link creation and copy outcomes are shown as separate status/alert paragraphs. They are not on Story 10.1's single inline save status line. The received/invite/shared access paths already behave as required, but no browser test covers them and no Django test reads a share between an owner's unsaved edit and the save.

**Approach:** Web change plus regression tests, with no server change. (1) The shared view gets a `shared-case-banner` at the top (`bg-accent-soft border border-accent rounded-node p-3`). It holds a new explicit read-only sentence and keeps the existing draft disclaimer. (2) On Full results with the gate shown, the save status line in `AuthGate` becomes the one line for save, share-link (creating/created/failed), copy (copied/failed) and PDF (generating/failed) outcomes, and the newest event wins. `DraftDownload` and `SharePanel` report into that line instead of rendering their own messages. (3) Tests pin the shipped received/invite/shared access rules and the live-view rule.

## Boundaries & Constraints

**Always:**
- The banner is the first element of every rendered shared-view state that shows a Case, including the existing "preview not available" branch. It contains `shared.readOnly` (new) followed by the existing `shared.banner` disclaimer. It keeps the existing `role="note"`, adds `data-component="shared-case-banner"`, and uses exactly the token classes `bg-accent-soft border border-accent rounded-node p-3` (Tailwind classes backed by `--color-accent-soft`, `--color-accent` and `--radius-node` in `globals.css`). The private/public badge stays below it.
- The shared view keeps `gate={false}` and `back={null}`. It shows no Save, Share, WhatsApp, Open, Rename or edit control, and no Country name or version line.
- Unavailable (404), sign-in-required (403), throttled (429) and failed states keep their shipped text and actions. They render no banner, no family data and no editable fallback. Unavailable copy never mentions a 24-hour or guest lifetime.
- Full results status line (`AuthGate`'s `<p role="status" aria-live="polite">`): it shows the message of the most recent event among save (shipped states, conflict states included), share-link creating (`share.preparing`), share created (`share.created`), share failed (`share.createError`), copy (`share.copied` only after `navigator.clipboard.writeText` resolves; `share.copyFailed` on rejection, which also selects the URL as today), PDF busy (`results.pdfBusy`) and PDF failure (the existing `pdfFailed`, `pdfUnavailable`, `pdfThrottled` or `pdfTimeout` text). A PDF success clears a PDF busy message. The save Retry and conflict buttons keep their shipped conditions. The family and results stay on the page on every failure.
- When `gate` is false (shared and received views), `DraftDownload` keeps its own shipped `pdfBusy` status and failure alert unchanged.
- Reuse only existing message keys, except the one new key `shared.readOnly` in en, ar and fr: en "Read-only view of the owner's latest saved case. You cannot edit or rename it here.", ar "عرض للقراءة فقط لآخر نسخة محفوظة من حالة المالك. لا يمكنك تعديلها أو إعادة تسميتها هنا.", fr "Vue en lecture seule de la dernière version enregistrée du dossier du propriétaire. Vous ne pouvez pas le modifier ni le renommer ici.". Record it in `deferred-work.md` for native review. `npm run i18n` passes.

**Never:**
- No server, API-shape, migration, PDF-pipeline or token-format change. Do not change `/{locale}/received/`, `/{locale}/invite/`, the My cases received section or their acceptance, authentication, expiry and revocation logic.
- Do not change existing message text. Do not redesign Full results actions (button set, order, labels). Do not change `InvitePanel` or `WhatsappPanel` (WhatsApp ready/unavailable messages stay where they are). Do not change share-row management messages (`share.actionError`, make public/private, revoke).
- No autosave (10.5) and no preset-version messaging (Epic 14). No banner on the received view (the AC scopes the banner to `/shared/`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Shared, School basis | `POST shares/view/` 200, preview available, school line | Banner (read-only + draft) first, badge, results; no Save/Share/edit controls; no Country text | — |
| Shared, compare basis | 200, all-schools agreement line | Same banner; agreement line as shipped | — |
| Shared, preview unavailable | 200, `preview.status != available` | Banner, then shipped `shared.error` alert | — |
| Shared unavailable | 404 (expired, revoked, unknown) | Shipped "This link is unavailable." only; token forgotten; no banner, no family | — |
| Shared private, guest | 403 `sign_in_required` | Shipped sign-in/create-account; no family | — |
| Owner edits, not saved | Owner session copy changed, no save | Share shows the previous persisted family | — |
| Owner saves | Save 200 after the edit | Next share read shows the new family | — |
| PDF on Full results | Click download | Line: `pdfBusy`; then cleared on success, or the failure text with family intact | Button shows `pdfRetry` as today |
| Share created | Share click → save → create 201 | Line: `share.preparing` then `share.created`; SharePanel shows URL and Copy | create fails → line `share.createError` |
| Copy | Copy click | Line `share.copied` after resolve; `share.copyFailed` + URL selected on reject | — |
| Event order | PDF failed, then Save succeeds | Line shows `saved` (newest wins) | — |

</intent-contract>

## Code Map

- `web/src/app/[locale]/shared/shared-view.tsx:86-108` -- the `banner` fragment (`role="note"`, `rounded-md border border-current/60 p-3`) used by the view and preview-unavailable branches. Restyle it, add the read-only line, keep the badge. `:64-83` holds the sign-in, unavailable, throttled and failed branches (unchanged).
- `web/src/app/[locale]/globals.css:9,12,25,29,45,55` -- `--accent`, `--accent-soft` (light/dark), `--color-accent-soft`, `--radius-node`. Read-only; the Tailwind classes `bg-accent-soft border-accent rounded-node` already resolve.
- `_bmad-output/planning-artifacts/ux-designs/ux-mawareeth-2026-11-16/DESIGN.md:81,302` -- `components.shared-case-banner` spec (read-only evidence).
- `web/src/app/[locale]/results/results-view.tsx:268-269` -- `Available` mounts `AuthGate` (when `gate`) then `DraftDownload`. `:431-482` `DraftDownload` (`busy`, `error`, own `role=status`/`role=alert`). Add an optional `onStatus(event)` callback. When it is given, report busy, success and failure through it and do not render the two paragraphs. Lift the PDF status into `Available` and pass it to `AuthGate` (for example a `pdf` prop with a sequence counter so the newest event wins).
- `web/src/app/[locale]/results/auth-gate.tsx:81-103` `runShare` (`shareState` creating/error/ready), `:254` the status line expression, `:267-269` the separate `share.preparing`/`share.createError` paragraphs and `SharePanel` mount. Replace the derived expression with a "latest event" model (for example `line: {key, seq}` set by each event, or a timestamp compare). Remove the two separate share paragraphs.
- `web/src/app/[locale]/results/share-panel.tsx:55-63,74-79` -- `copyLink()` and the `created`/copy `role=status` paragraphs. Add an optional `onStatus` callback. When it is given (it always is from `AuthGate`), report `created` on mount and the copy outcome through it and do not render those paragraphs. Keep the URL field, Copy button, list and dialog.
- `web/src/i18n/messages.ts:48` (type `shared`), `:370` ar, `:720` en, `:1071` fr -- add `readOnly`.
- Server read-only evidence: `api/views.py:712-717` shared view (decodes the persisted `SavedCase.snapshot`, recomputes the preview, `never_cache`), `api/sharing.py:11,36` (uniform 404, 30-day lifetime), `api/invites.py:18,37`, `api/views.py:595,624,802`.
- Tests: `api/tests.py:3922` `ShareTests` (`test_live_content_and_viewer_session_untouched` at `:4048`), `:4161` `InviteTests`. Web: `shared/shared-view.test.tsx`, `results/auth-gate.test.tsx:287`, `results/share-panel.test.tsx:32`, `results/results-view*.test.tsx` if present, `cases/cases-view.test.tsx:132` (received rows), `received/received-view.test.tsx`, `invite/invite-view.test.tsx`. E2E: `web/e2e/api.ts:29,140,155` (stub router; unhandled calls abort), `web/e2e/results.spec.ts:74`, `web/e2e/cases.spec.ts`.

## Tasks & Acceptance

**Execution:**
- `web/src/i18n/messages.ts` -- add `shared.readOnly` (type + en/ar/fr, text above).
- `web/src/app/[locale]/shared/shared-view.tsx` + `shared-view.test.tsx` -- banner restyle and read-only line. Tests: the banner comes first with the token classes and `data-component`, and holds both sentences. No button named Save/Share/WhatsApp/Rename/Open. Unavailable, sign-in and failed states render no banner and no heir. The compare and School fixtures show no Country text.
- `web/src/app/[locale]/results/results-view.tsx`, `auth-gate.tsx`, `share-panel.tsx` + their tests -- the single status line (newest event wins) and the `onStatus` callbacks. Tests cover each Full-results matrix row, including copy reject, `copied` only after resolve, PDF failure keeping the heir rows, PDF-then-save ordering, and `DraftDownload` unchanged when `gate` is false.
- `api/tests.py` (`ShareTests`) -- a new test: share view after an owner edit with no save returns the old persisted family, and after save returns the new family. Put it next to `test_live_content_and_viewer_session_untouched`.
- `web/src/app/[locale]/cases/cases-view.test.tsx` -- assert that received rows have only "View draft" linking to `/{locale}/received/#<id>`, with no Open or Rename button.
- `web/e2e/api.ts` + new `web/e2e/shared.spec.ts` -- stubs for `shares/view/`, `received/<id>/view/` and `invites/accept/`. Cover en and ar: a shared School case shows the banner with the read-only text and no edit controls; axe has no violations on the banner state (light theme); a 404 shows the unavailable text and no heir; a 403 shows the sign-in links; My cases → View draft → received view renders read-only; invite accept redirects to the received view. Extend `web/e2e/results.spec.ts`: Share shows `created` then, after a granted clipboard copy, `copied` in the same `role=status` line as Save; a stubbed failing PDF shows the failure text in that line with the family still visible.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- the new `shared.readOnly` strings (en, ar, fr) for native review.

**Acceptance Criteria:**
- Given a valid share link to a School or compare SavedCase, when `/{locale}/shared/` renders, then the first element is the shared-case-banner stating the view is read-only with the specified token styling, no Country name or version appears, and no edit, rename, save or share control is exposed.
- Given an owner's unsaved working-copy change, when the share link is read before and after a successful save, then it shows the previously saved family first and the new family only after the save.
- Given a received invite in My cases or an `/{locale}/invite/` or `/{locale}/received/` entry, when it is followed, then it behaves as shipped (acceptance, sign-in, 404 for expired, revoked or foreign), and received rows show no owned-case Open or Rename.
- Given Full results with save, share and PDF actions, when any of them progresses, succeeds or fails, then exactly one inline status line reports the newest outcome, "copied" appears only after a successful copy, and the family stays on the page on failure.

## Spec Change Log

## Review Triage Log

### 2026-11-27 — Review pass
- verdicts: 22 findings — high 0, medium 9, low 13, false 0, maybe-false 0
- review: one combined call to the `codex` agent with all five layers (deep tier, diff 62 kB). Codex's own CLI failed at startup ("access denied" on `-C c:/mawareeth`), so the codex agent reviewed the diff and working tree directly, read-only. cross-story-contract reported "No contract shape changed".
- findings:
  - `[low]` `[reject]` blind: a pending Copy for link A can report "copied" after link B's panel replaces it — needs a new share created while a clipboard write is still pending (clipboard writes settle almost at once); the fix adds an identity guard
  - `[medium]` `[patch]` blind: a PDF success publishes `null`, so an older message (for example a share `createError`) comes back on the line — fixed: success publishes `""` and `newestLine` counts an empty string as the newest event, which blanks the line
  - `[low]` `[reject]` blind: the e2e success stub gives an anonymous visitor a private case, so it does not prove who may see the banner — the access rule is the server's and is covered by Django `ShareTests`; the e2e checks rendering only
  - `[low]` `[reject]` blind: the received-view stub returns the same family for every id — the id-to-case mapping is the unchanged server's, covered by `InviteTests`
  - `[medium]` `[patch]` blind: the Django post-save test checks only the heir count — fixed together with the verification-gap row: it now asserts the added heir by name and that the preview is unchanged before the save and changed after it
  - `[low]` `[reject]` blind: the compare unit test relabels a Hanafi fixture — it tests the banner and line rendering for the compare label shape (validated against `web/src/contracts/presented.ts:210`); calculation for a real compare case is Epic 8 coverage
  - `[low]` `[patch]` blind: the rejected-copy test never asserts the URL is selected — fixed: it asserts the input is fully selected
  - `[low]` `[patch]` blind: the banner style e2e does not check colour or radius — fixed: it asserts a 10px radius, a 1px border in the computed `--accent` colour and 12px padding
  - `[low]` `[reject]` edge: the copy-after-replace race — same as the first blind row
  - `[medium]` `[patch]` edge: after the new link is revoked, the line still says "Private link created. Copy it now" (before this story the text sat inside `live &&`) — fixed: `SharePanel` reports `cleared` when `live` turns false, and `AuthGate` blanks the line; unit test added
  - `[medium]` `[patch]` edge: PDF success brings back the previous share error — same fix as the blind PDF row
  - `[low]` `[patch]` edge: the results-view test helper's "download" variant had no blob — fixed with the verification-gap PDF row (a deferred `{kind:"download", blob}` test)
  - `[medium]` `[patch]` edge: the "shared School case" e2e used a compare fixture with `madhab: null` — fixed with verification-gap row 3: a Hanafi fixture with a named heir, asserting the heir and the School line in en and ar
  - `[low]` `[reject]` edge: axe filters to serious and critical violations — this is the project-wide convention in `web/e2e/accessibility.spec.ts`
  - `[low]` `[patch]` edge: the preview-unavailable test's per-heir loop was vacuous (both fixture heirs have null names) — fixed: it asserts no shares, steps, list, table or relationship label renders
  - `[low]` `[reject]` edge: WhatsApp's own `role=status` gives a second announcement — the intent names PDF and share-link created/copied states only, and WhatsApp's ready/unavailable copy is outside them; moving it would redesign the panel
  - `[medium]` `[patch]` verification-gap: no test watches a button-started PDF while pending and after success — fixed: a deferred-success test asserts the same status element shows `pdfBusy`, then is blank
  - `[medium]` `[patch]` verification-gap: the one-status-line count passed only because the invite list errored — fixed: invites served as `{invites: []}`; the test asserts the status element captured before Share is the one that shows created, then copied
  - `[medium]` `[patch]` verification-gap: the browser banner test never shows the family — same fix as the School-fixture row
  - `[medium]` `[patch]` verification-gap: the post-save Django test does not observe the recomputed preview — same fix as the blind Django row
  - `[low]` `[patch]` verification-gap (other): e2e stubs differ from Django's bodies (`status: "ok"`, `error`, 403 without `detail`) — fixed: `"draft"`, `{detail}`, `{detail, code}`
  - `[low]` `[reject]` intent-alignment: the diff implements the route-specific reading (banner on `/shared/` only); no test follows the recipient's rendered calculation across a save — the story's banner AC names `/{locale}/shared/`, and the received view keeps its shipped owner banner; the live-view rule is covered server-side by the strengthened Django test

## Design Notes

Newest-event-wins keeps one line truthful when actions interleave. A plain priority order would hide a newer PDF failure behind an older "Saved to My cases". Callbacks keep `DraftDownload` and `SharePanel` reusable in the shared and received views, where `AuthGate` is absent and the shipped messages stay.

Banner sketch:
```tsx
<p role="note" data-component="shared-case-banner" className="rounded-node border border-accent bg-accent-soft p-3">
  <strong className="block">{text.readOnly}</strong>{text.banner}
</p>
```

## Verification

**Commands:**
- `cd web && npm test && npm run typecheck && npm run lint && npm run i18n` -- expected: no failures, 0 lint errors
- `cd web && npm run build && npx playwright test e2e/shared.spec.ts e2e/results.spec.ts e2e/cases.spec.ts e2e/accessibility.spec.ts` -- expected: all pass
- `uv run python manage.py test api.tests.ShareTests api.tests.InviteTests --noinput` -- expected: OK

## Auto Run Result

Status: done

**Summary.** The shared view (`/{locale}/shared/`) now opens with a `shared-case-banner` (`role="note"`, `data-component="shared-case-banner"`, `bg-accent-soft border border-accent rounded-node p-3`). It states in bold that the view is a read-only view of the owner's latest saved case, followed by the existing draft disclaimer. It appears on the results state and on the "preview not available" state, never on the unavailable, sign-in, throttled or failed states. On Full results, Story 10.1's save status line is now the one line for save, share-link (creating, created, failed), copy (copied after the clipboard resolves, or copy failed with the URL selected) and PDF (generating, failed) outcomes. A page-wide event counter makes the newest event win. A PDF success or a revoked new link blanks the line. `DraftDownload` and `SharePanel` report through optional callbacks and keep their own shipped messages when no `AuthGate` is present (shared and received views). Received/invite routes, the server and WhatsApp messages are unchanged. Regression tests pin the shipped access rules and the live-view rule.

**Files changed**
- `web/src/app/[locale]/shared/shared-view.tsx` (+ test) -- the banner and read-only line.
- `web/src/app/[locale]/results/auth-gate-state.ts` -- `nextSeq()` and `newestLine()`.
- `web/src/app/[locale]/results/auth-gate.tsx` (+ test) -- the one status line, share events, `pdf` prop; the separate share paragraphs removed.
- `web/src/app/[locale]/results/results-view.tsx` (+ test) -- `DraftDownload` `onStatus`, wired only when `gate` is true.
- `web/src/app/[locale]/results/share-panel.tsx` (+ test) -- `onStatus` (created, copied, copyFailed, cleared).
- `web/src/app/[locale]/cases/cases-view.test.tsx` -- received rows show only View draft.
- `web/src/i18n/messages.ts` -- `shared.readOnly` (en, ar, fr).
- `api/tests.py` -- `ShareTests.test_share_shows_the_saved_family_until_the_owner_saves_an_edit`.
- `web/e2e/api.ts`, `web/e2e/shared.spec.ts` (new), `web/e2e/results.spec.ts` -- shared, received and invite journeys in en and ar; Share then Copy, and a failing PDF, on the single line.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- `shared.readOnly` for native review.

**Planning and fallbacks.**
- Planning investigation ran on the `codex` agent.
- Two matrix rows (compare basis, preview not available) had no test after implementation. The first codex attempt to add them failed at startup: the POSIX cwd containing `[locale]` broke `-C`. The retry with `-C c:/mawareeth/web` added them. I fixed a null-name type error in one of them.
- In the review, codex's CLI failed at startup ("access denied"), so the codex agent reviewed the diff itself.

**Review findings.** 22 findings: high 0, medium 9, low 13, false 0.
- Patched: 6 medium entries and 4 low entries, sent back to the implementation subagent.
  - Medium: PDF success blanks the line; a revoked new link clears its notice; the Django test checks the added heir and the recomputed preview; the shared e2e uses a School fixture with a named heir and School line; a deferred-success PDF test; healthy invite fixtures and a same-element assertion for the status line.
  - Low: the rejected copy selects the URL; banner colour, radius, border and padding; the preview-unavailable test is no longer vacuous; e2e stubs match Django's bodies.
- Deferred: none.
- Rejected, with reasons in the triage log:
  - The copy-after-replace race.
  - Anonymous-private and same-family stubs (server rules covered by Django).
  - The compare relabelled fixture.
  - The axe serious/critical filter (project convention).
  - WhatsApp's own status (outside the named states).
  - The route-specific banner reading (the AC names `/shared/`).

**Follow-up review recommended: true.** Six medium entries were patched. The named unverified risk is the event-ordering model in `AuthGate`. It wraps `setSaveState`, `setBusy` and `setChoiceError` so that each call stamps a new event number, and since the patch an empty message counts as an event. Interleaved conflict choices with share or PDF events have not had a fresh review. A future direct call to a raw setter would also skip the stamp.

**Verification** (after the patches)
- `npm test`: 824/824 pass. `npm run typecheck`: OK. `npm run lint`: 0 errors (12 existing warnings). `npm run i18n`: OK.
- `npm run build`: OK. Playwright `shared.spec.ts results.spec.ts cases.spec.ts accessibility.spec.ts`: 141 passed.
- Django `api.tests.ShareTests api.tests.InviteTests`: 22 tests OK.

**Residual risks**
- The `shared.readOnly` wording in ar and fr needs native review (recorded in deferred-work.md).
- When WhatsApp is chosen, its ready message is still announced in its own status next to the line.
- The received view keeps its shipped owner banner and has no `shared-case-banner`.
