---
title: 'Story 11.5: Preserve the results table and make result actions clear'
type: 'feature'
created: '2026-11-28'
baseline_commit: '0c31c9485dc075276fbc6dd6d0b7f6e042aa9adf'
baseline_revision: '0c31c9485dc075276fbc6dd6d0b7f6e042aa9adf'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
  - '{project-root}/web/AGENTS.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** On Full results, Download PDF sits alone under Save, Share link and WhatsApp, and every action uses the same outlined `buttonClass`, so nothing says which action comes first. The page shows no calculation-aid disclaimer, and its `max-w-6xl`/`py-10` shell does not follow the public 1024px, 24px-gutter, 48px/64px rhythm.

**Approach:** Put all four actions in one wrapping row with 12px gaps: Download PDF first as the primary button, then Save, Share link and WhatsApp as secondary buttons. Show the disclaimer as a non-dismissible notice above the actions. Move the page to the public content shell. Keep the table, the proof, the sign-in-and-resume flow and the status line exactly as shipped, and prove it with unit and Playwright tests.

## Boundaries & Constraints

**Always:**
- **Action row** (Full results, `gate` true): one `flex flex-wrap gap-3` row in this DOM and visual order: Download PDF (`primaryButton` from `ui.ts`), Save, Share link, WhatsApp (`secondaryButton`). Every control ≥44px high; at 320px they wrap without clipping or page x-scroll in en, ar and fr. Disabled buttons keep `disabled` and look disabled (e.g. `disabled:opacity-60 disabled:cursor-not-allowed`). Focus outlines stay visible on both variants.
- **Reuse:** the existing `DraftDownload` logic (labels Download / Generating / Retry, abort on unmount, no "done" on failure), `AuthGate` save/share/WhatsApp handlers, its one `role="status"` line (`newestLine`) for PDF, save, share and copy feedback, its Retry buttons, the conflict choices, `NameDialog`, `SharePanel`, `WhatsappPanel`, `InvitePanel` and the sign-in `<dialog>` stay as they are. Only where the PDF button renders and the button classes change. Suggested shape: `AuthGate` takes an optional `lead?: React.ReactNode` rendered first inside its action row, and `Available` passes the `DraftDownload` there.
- **Read-only pages** (`gate={false}`: `shared-view.tsx`, `received-view.tsx`): Download PDF becomes `primaryButton` and keeps its own inline status/alert lines. No Save/Share/WhatsApp, no new disclaimer (their banners already carry it).
- **Disclaimer:** on Full results, a `<p data-notice="disclaimer">` with `rounded-[6px] border border-current/60 p-3 font-semibold` (the share-preview notice style), always rendered for an available result, no close control. Text comes from `presented.notices` (`code === "disclaimer"`), else the catalog `notice.disclaimer` for the locale, exactly as `noticeText` in `share-preview.tsx:250` does. Move `noticeText` into a shared module (e.g. `web/src/interview/notices.ts`) and import it from both places; share-preview behaviour must not change. Placement: after the school line, before the action row.
- **Shell:** `results/page.tsx` `<main>` becomes `mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-12 md:py-16` (same values as `sectionClass`), and the `h1` spans that width. Loading/failed/choose-school bodies keep their own inner widths. Below 640px the page stays single column and only the table region (`inheritance-table.tsx:233`, labelled `role="region"`) scrolls sideways.
- **Guest sign-in:** a guest Save/Share/WhatsApp still opens the shipped sign-in dialog (one dialog, never stacked on the naming or share-warning dialog). Closing it without signing in sends no save or share request, leaves the status line without any "Saved"/"created" text and returns focus to the button that opened it. Signing in resumes the requested action for the same Case (shipped `?resume=` path).
- Table and proof unchanged: caption, `bg-current/10` active row, dotted-underline proof buttons, `<bdi dir="ltr">` fractions, single- and later-estate semantics, all labels from the presentation.

**Never:** No new or changed translations (ar/en/fr `messages.ts` text, catalog or .po). No change to the API, `@/api/*`, `auth-gate-state.ts`, PDF generation, `inheritance-table.tsx` markup, or the Interview. No second status region for the action row. No `left`/`right` CSS. No dismiss control on the disclaimer.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Signed-in results | available preview, 1280×900 | disclaimer, then row PDF(primary) · Save · Share link · WhatsApp; content ≤1024px wide, 24px inline padding | — |
| Phone | 320×640, en/ar/fr | actions wrap in rows, each ≥44px, none clipped; no page x-scroll; table region scrolls | — |
| PDF fails | download 500 | status line shows the failure; button reads Retry; family and table still shown | Retry re-requests |
| Guest cancels | anonymous, Save → dialog → Close | no save request; status has no Saved text; focus on Save | — |
| Guest signs in | `?resume=share` after sign-in | share is prepared for the same Case; param stripped | shipped errors |
| Shared link | `/shared/` available | PDF button primary with its own status; no Save/Share; no extra disclaimer | shipped |

</intent-contract>

## Code Map

- `web/src/app/[locale]/results/results-view.tsx` -- `Available` :216 renders the school line :271, `AuthGate` :272, then `DraftDownload` :273 as a separate block. `DraftDownload` :434–489 (button uses `buttonClass` :483, inline status only when `onStatus` is absent :486–487). Move the PDF button into the gate's row, apply `primaryButton`, add the disclaimer.
- `web/src/app/[locale]/results/auth-gate.tsx` -- action row :265–269 (three `buttonClass` buttons), status line :271, Retry :272–273, conflict group :275, sign-in `<dialog>` :286 (`onClose` resumes only when signed in; focuses `trigger`). Add the `lead` slot and the secondary classes only.
- `web/src/app/[locale]/ui.ts` -- `primaryButton`, `secondaryButton` (both `min-h-11`, `rounded-lg`, `focusRing`), `sectionClass` (`max-w-5xl px-6 py-12 md:py-16`). Reuse; do not edit unless a disabled style is shared.
- `web/src/app/[locale]/interview/share-preview.tsx` -- `noticeText` :250 (served notice → catalog `terms[locale]["notice.<code>"]`), notice box classes :349, :370. Move `noticeText` out; keep the same output.
- `web/src/app/[locale]/results/page.tsx` -- `<main>` :13 (`max-w-6xl px-6 py-10`), `h1` `max-w-xl`.
- `web/src/app/[locale]/results/inheritance-table.tsx` -- read only: `bg-current/10` :167, dotted proof button :175, region :233, sr-only caption :239.
- `web/src/app/[locale]/shared/shared-view.tsx:98`, `received/received-view.tsx:79` -- other `Available` consumers with `gate={false}`; must keep working.
- Tests: `results/results-view.test.tsx`, `results/auth-gate.test.tsx` (happy-dom, `showModal` stub, `?resume=` tests :133–370), `interview/share-preview.test.tsx` (disclaimer notice). E2E: `web/e2e/results.spec.ts` (`stubResults`, `serious()` axe helper, Full results at 320px test :226, PDF failure test :203), `web/e2e/shared.spec.ts`, `web/e2e/accessibility.spec.ts`.
- `_bmad-output/planning-artifacts/ux-designs/ux-mawareeth-2026-11-16/DESIGN.md:103-116,236,413,447` -- button and notice tokens, full-results-actions.

## Tasks & Acceptance

**Execution:**
- `web/src/interview/notices.ts` (new) -- export `noticeText(presented, code, locale)` moved from `share-preview.tsx`; `share-preview.tsx` imports it.
- `web/src/app/[locale]/results/auth-gate.tsx` -- optional `lead` slot first in the action row; Save/Share link/WhatsApp use `secondaryButton` plus disabled styling.
- `web/src/app/[locale]/results/results-view.tsx` -- `DraftDownload` button uses `primaryButton` plus disabled styling; in gate mode it renders inside `AuthGate`'s row via `lead`, in read-only mode where it is today. Add the disclaimer notice after the school line when `gate` is true.
- `web/src/app/[locale]/results/page.tsx` -- the public shell classes.
- `web/src/app/[locale]/results/results-view.test.tsx`, `auth-gate.test.tsx` -- assert row order (PDF, Save, Share link, WhatsApp) inside one container, PDF has the primary class and the others the secondary class, the disclaimer text (served and catalog fallback) with no button inside it, `gate={false}` has the PDF button and no disclaimer or Save; a guest Close sends no save/share request, shows no saved text and refocuses the opener.
- `web/e2e/results.spec.ts` -- new `Story 11.5` block in en, ar and fr: at 1280×900 the row order, 12px column/row gap (`getComputedStyle`), PDF background is the accent and the others transparent with a border, each ≥44px, the disclaimer visible with 12px padding, 1px border and weight ≥600, the content width ≤1024px and main inline padding 24px; at 320×640 no page x-scroll, every action fully inside the viewport, the table region scrolls; the caption, an active-row tint after a proof click and `bdi[dir=ltr]` fractions; keyboard Tab reaches PDF then Save then Share link then WhatsApp in order with a visible outline; a failed PDF leaves Retry and the table. Guest (anonymous session): Save → sign-in dialog → Close → no POST, no Saved, focus on Save. Axe (`serious()`) at 320 and 1280 in light and dark.
- `web/e2e/shared.spec.ts` -- only adjust selectors if the PDF button change breaks them; add an assertion that the shared page has no Save button and a PDF button.

**Acceptance Criteria:**
- Given an available result on Full results, when the page renders, then the table keeps its caption, active-row tint, dotted proof buttons and LTR fractions, and the single- and later-estate proof render as before.
- Given available Full results, when the action row renders, then Download PDF is the one primary button before Save, Share link and WhatsApp (secondary), they wrap with 12px gaps at ≥44px, and the semibold disclaimer notice with a 1px 60% border and 12px padding is visible and cannot be dismissed.
- Given a guest who activates Save or Share link, when the sign-in dialog is closed, then no save or share succeeded message appears and the Case is unchanged; when sign-in succeeds, then the requested action resumes for the same Case.
- Given a pending or failed PDF, save or share, when its state renders, then the shared status line shows generating/saving/created/copied or the failure, Retry stays with the action, the family stays visible, and no second dialog stacks.
- Given phone, tablet or desktop in en, ar and fr, when results are inspected by keyboard, then phone is single column with only the labelled table region scrolling sideways, wider screens use ≤1024px content with 24px gutters and 48px/64px vertical padding, focus outlines are visible, actions are not clipped, and Playwright axe reports no serious or critical violation.

## Spec Change Log

## Review Triage Log

### 2026-11-28 — Review pass
- Routing: no `codex`, `gemini`, `hermes` or `qwen` agent type was registered in this session, so the five layers ran as one combined read-only sonnet subagent, the last fallback in the routing rule. The review fixes went back to the implementation sonnet subagent. The diff was 24 kB. The cross-story-contract layer reported "No contract shape changed".
- verdicts: 33 findings — high 0, medium 6, low 16, false 11, maybe-false 0
- findings:
  - `[low]` `[reject]` blind 1: no axe run covers the guest dialog, failed-PDF or share panels. The dialogs and panels are unchanged here, and the existing results and accessibility specs already run axe on the naming dialog. More tests, not a correction.
  - `[false]` `[reject]` blind 2: the disclaimer can be null and so not shown. The catalog has `notice.disclaimer` for en, ar and fr (catalog.generated.ts:172,286,400), and the results route accepts only those locales (`isLocale` in page.tsx).
  - `[low]` `[reject]` blind 3: no `aria-describedby` ties the disclaimer to the actions. No AC or UX rule asks for it, and the notice is plain text read in DOM order before the actions.
  - `[low]` `[reject]` blind 4: the notice classes are duplicated in results-view and share-preview. Two sites, and a shared constant adds public surface. Drift is cosmetic.
  - `[low]` `[reject]` blind 5: the disabled-class string is repeated in two files. Cosmetic.
  - `[false]` `[reject]` blind 6: `React.ReactNode` is used without an import. Typecheck is clean, and results-view.tsx already uses `React.ReactNode` the same way (`back: React.ReactNode`).
  - `[false]` `[reject]` blind 7: a `madhab` change remounts AuthGate and drops the PDF state. Every path that changes `madhab` goes through `reload`, which sets `current` to null and unmounts the whole `Available` tree (results-view.tsx:67,79), the same as before the change.
  - `[low]` `[reject]` blind 8: the h1 width and the inner widths of the loading and failed bodies are untested. Static classes with no behaviour.
  - `[low]` `[reject]` blind 9: the exact px assertions are brittle. They are the design tokens the AC names.
  - `[false]` `[reject]` blind 10: the guest Close test calls `dlg.close()` and never clicks the real button. The new e2e "guest: Save opens sign-in, Close sends nothing" clicks the real Close button.
  - `[low]` `[reject]` blind 11: the `?resume=share` test restores the DOM at the end of the test, not in `finally`. This matches the file's existing resume tests, and a failing test already fails the run.
  - `[false]` `[reject]` edge 1: null disclaimer (grouped with blind 2).
  - `[false]` `[reject]` edge 2: remount on `madhab` (grouped with blind 7).
  - `[false]` `[reject]` edge 3: a PDF can start during a save and race it on the status line. The PDF was never gated by save state before this change, and `newestLine` shows the newest event by sequence number (auth-gate-state.ts).
  - `[false]` `[reject]` edge 4: the order check misreads wrapped rows. At 1280px the four actions fit on one row inside 1024px, and the test passed in all three locales.
  - `[low]` `[reject]` edge 5: `locator("..")` assumes Save's parent is the row. True today, and it is test-only coupling.
  - `[false]` `[reject]` edge 6: extra focusable elements break the Tab order check. The PDF button's wrapper div is not focusable; the test asserts focus by name after each Tab and passed.
  - `[low]` `[reject]` edge 7: test cleanup (grouped with blind 11).
  - `[medium]` `[patch]` edge 8 (claim): the spec's "active-row tint after a proof click" is untested, and no other e2e covers it. Patched: the desktop table test now checks that the first proof button in the table region has a dotted underline, clicks it, and asserts its row background is no longer transparent.
  - `[low]` `[reject]` edge 9 (claim): no e2e covers resume through real sign-in navigation. Unit tests cover `?resume=save`, `?resume=whatsapp` and (added in this run) `?resume=share`. The resume code is unchanged.
  - `[medium]` `[patch]` edge 10 (claim): served-over-catalog disclaimer precedence is not checked on Full results. Patched: the unit test asserts the exact text, and a new case with a replaced served notice asserts that the served text is shown.
  - `[false]` `[reject]` edge 11: deletion check — the reviewer found no orphan.
  - `[medium]` `[patch]` verification-gap 1: served-text precedence (grouped with edge 10).
  - `[low]` `[patch]` verification-gap 2: the disabled styling is unpinned. Patched: the Full results unit test asserts that all four action buttons carry `disabled:opacity-60`.
  - `[low]` `[reject]` verification-gap 3: received-view has no PDF-button check. It renders the same `Available gate={false}` branch that the unit test and shared.spec.ts cover.
  - `[medium]` `[patch]` verification-gap 4: tint untested (grouped with edge 8).
  - `[low]` `[reject]` verification-gap other 1: test cleanup (grouped with blind 11).
  - `[low]` `[reject]` verification-gap other 2: the keyboard test starts from `.focus()` on PDF. The DOM order PDF → Save → Share → WhatsApp is pinned by the unit tests.
  - `[medium]` `[patch]` intent-alignment 1: the table and proof criterion is checked only through the caption and `bdi` (grouped with edge 8).
  - `[medium]` `[patch]` intent-alignment 2: the disclaimer is checked as non-empty only (grouped with edge 10). The 60% border opacity is still checked by class only.
  - `[low]` `[reject]` intent-alignment 3: no real-navigation e2e of resume (grouped with edge 9).
  - `[false]` `[reject]` intent-alignment 4: pending and failed feedback — the reviewer found no divergence. The e2e covers the failed PDF and the unit tests cover the shared status line.
  - `[low]` `[patch]` intent-alignment 5: the 48px/64px vertical rhythm is unchecked. Patched: at 1280px the e2e asserts main `paddingTop` and `paddingBottom` are 64px. No tablet width was added (static classes).

## Design Notes

**Why the disclaimer only on Full results.** The shared and received pages already open with a banner that carries the draft/disclaimer text; adding the notice there would repeat it. The Interview sheet already shows it (11.2). Story 11.6 adds the user-supplied-facts statement and the Beta explanation next to this notice.

**Why a `lead` slot.** The PDF action must sit in the same row as the gated actions, but `DraftDownload` also serves the read-only pages without a gate. A slot keeps one implementation of each action and one status line.

## Verification

**Commands (from `web/`, Git Bash glob form):**
- `node --import ./src/test/loader.mjs --test "src/interview/*.test.ts" "src/app/[[]locale]/interview/share-preview.test.tsx" "src/app/[[]locale]/results/*.test.ts" "src/app/[[]locale]/results/*.test.tsx"` -- all pass
- `npm run lint` and `npm run typecheck` -- 0 errors
- `npm run build` then `npm run test:e2e -- --project=chromium results.spec.ts shared.spec.ts cases.spec.ts accessibility.spec.ts` -- all pass, none skipped

## Auto Run Result

Status: done

**Routing:** `/bmad-build-auto 11-5` resolved to Story 11.5 in epic 11. A sonnet subagent implemented it. No `codex`, `gemini`, `hermes` or `qwen` agent type was registered in this session, so the review layers ran as one combined read-only sonnet subagent (the routing rule's last fallback), and the review fixes went back to the implementation subagent.

**Summary:**
- **Action row:** Full results shows one wrapping row with 12px gaps. Download PDF comes first as the only primary button, then Save, Share link and WhatsApp as secondary buttons. Every target is at least 44px, and disabled buttons look disabled.
- **Reuse:** the PDF button reaches the gate's row through a new `lead` slot on `AuthGate`. The download, sign-in, resume, share, WhatsApp and status-line logic is unchanged.
- **Disclaimer:** a non-dismissible semibold notice (1px 60% border, 12px padding) sits above the actions. Its text is the served notice, or else the catalog's. `noticeText` moved to `web/src/interview/notices.ts` and is shared with the Share preview.
- **Page shell:** Full results uses the public shell: at most 1024px wide, 24px gutters, and 48px/64px vertical padding.
- **Shared and received pages:** they keep their own banners and get a primary PDF button.

**Files changed:**
- `web/src/interview/notices.ts` (new) -- `noticeText`, moved out of share-preview.
- `web/src/app/[locale]/interview/share-preview.tsx` -- imports `noticeText`; no behaviour change.
- `web/src/app/[locale]/results/auth-gate.tsx` -- `lead` slot; secondary button styling.
- `web/src/app/[locale]/results/results-view.tsx` -- primary PDF button placed in the gate's row; disclaimer notice.
- `web/src/app/[locale]/results/page.tsx` -- public content shell.
- `results-view.test.tsx`, `auth-gate.test.tsx` -- row order and classes, exact disclaimer text (served and catalog), disabled styling, the `gate={false}` view, guest Close, and `?resume=share` for the same Case.
- `web/e2e/results.spec.ts`, `web/e2e/shared.spec.ts` -- a Story 11.5 block in en, ar and fr:
  - the 1280px layout, styles and shell;
  - the proof's dotted underline and active-row tint;
  - LTR fractions and keyboard order;
  - the 320px wrap;
  - a failed PDF;
  - guest Close;
  - axe at 320px and 1280px in light and dark;
  - the shared page's PDF button.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- the pre-existing Interview sheet contrast failure.

**Review:** 33 findings (high 0, medium 6, low 16, false 11, maybe-false 0).
- Patched, 4 entries:
  - Medium: the active-row tint and dotted proof buttons are tested.
  - Medium: the exact served and catalog disclaimer text is tested.
  - Low: the disabled-class assertion.
  - Low: the 64px vertical padding assertion.
- Deferred: none.
- Rejected, each with its reason in the triage log:
  - false claims: a null disclaimer, a `madhab` remount, the `React` import, a status-line race, the wrapped-order check, the Tab order;
  - test-structure nits: cleanup not in `finally`, `locator("..")`, starting from `.focus()`, px brittleness;
  - duplicated class strings;
  - axe on unchanged dialogs;
  - `aria-describedby`;
  - a received-view duplicate check;
  - an e2e of real sign-in resume (unit-covered).

**Follow-up review:** `true`. Two medium entries were patched. The unverified risk: the guest sign-in resume for Save and Share link is proved only by unit tests that fake the session (`?resume=`). No Playwright run signs in through the real login page and comes back to the same Case with the action resumed.

**Verification:**
- Node unit tests passed 484/484. Typecheck is clean. Lint has 0 errors and 12 existing warnings. `npm run build` succeeded.
- Chromium Playwright for `results.spec.ts`, `shared.spec.ts`, `cases.spec.ts` and `accessibility.spec.ts`: 196 passed and 3 failed. The 3 failures are all `accessibility.spec.ts:179` ("the 320px bar with text spacing, then the open sheet", en/ar/fr light), with `color-contrast: .text-accent`.
- **Those 3 failures predate this story.** The baseline 0c31c948 (this diff reverse-applied, fresh build) fails the same 3 tests the same way. The test passes 12/12 when run alone. It is recorded in deferred-work.md.
- Firefox and WebKit were not run here; CI runs them.

**Residual risks:**
- The Interview sheet `.text-accent` contrast failure (pre-existing, order-dependent) is still open.
- No e2e signs in for real and resumes the action.
- The implementation subagent flipped LF files to CRLF twice; the parent restored the original line endings each time.
- New strings: none.
