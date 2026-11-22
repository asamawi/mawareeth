---
title: "Story 11.2: Give the Interview's space to family entry and build one readable Share preview body"
type: 'feature'
created: '2026-11-22'
baseline_commit: '1e70d969263f50a3d09dcec661cdefa07b6dca30'
status: 'done'
route: 'one-shot'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
  - '{project-root}/web/AGENTS.md'
warnings: ['oversized']
deferred:
  - summary: >-
      A preview response that carries only an older revision leaves the lifecycle pending, and its slow-progress lines can still be spoken after the request has finished.
    evidence: |-
      acceptRevision returns null for an older revision and the request effect returns early without settling. This logic was moved unchanged from the pre-11.2 SharePreview, so it predates this story. Reported by the edge-case hunter in the 2026-11-22 review.
    location: >-
      web/src/app/[locale]/interview/share-preview.tsx:142
    severity: low
---

<intent-contract>

## Intent

**Problem:** The Interview gives the Share preview a 340px third column at 1280px and up, and puts it in the page flow under the tree below that. Both take space from family entry. The preview markup also mixes its request lifecycle with its presentation, so 11.3's summary sheet cannot reuse it.

**Approach:** The owner chose the literal reading on 2026-11-22. Split the preview into a lifecycle controller that stays mounted on the Interview and a pure `SharePreviewBody` presentation component that is **not rendered on the page in this story**. 11.3 will render it inside the summary sheet. Remove both page placements, so the layout is two columns from 1024px. Rebuild the body to the 11.2 row, disclaimer, Beta and Full results rules. Mark the preview-only Playwright checks `test.fixme` until 11.3.

## Boundaries & Constraints

**Always:**
- Keep the request effect unchanged: abort superseded requests, reject stale revisions, reconcile against the saved case, retry on reconnect, announce progress at 3s/10s through the existing single polite status, keep the first load quiet, and have `reportPresented` and `onPresented` feed tree and Heirs-list blocked evidence. It stays mounted for the root estate and while a later-death estate is open, exactly as today.
- Keep the later-estate rule: no preview body while a later-death estate is open.
- The body renders only server-presented strings. Reuse `previewRows` and `rowLabels` (`web/src/interview/preview.ts`) and `primaryButton` (`web/src/app/[locale]/ui.ts`). Keep bidi isolation and server `dir`/`lang`, with LTR fractions.
- Use only existing copy: `treeNoShare` for blocked rows, `previewResultsLink` for the action, the served notice `text` with `notice.<code>` from the generated catalog as fallback. Omit a Beta notice that has neither.
- Expose one always-present, revision-stamped settled signal on the Interview root, `data-preview-state` (`idle|pending|ready|choose-school|refused|error`) plus `data-preview-revision`, so tests can wait for an accepted calculation without a visible preview.

**Never:** No new live regions, no client share arithmetic, no new or changed translations, no summary bar or sheet (11.3), and no change to Results or the API. The body must not render on the Interview page. Do not delete preview e2e tests; mark them fixme.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Inheriting row | answer row with share | label, optional muted sub-line, fraction, percent, amount when supplied; bold values at logical end; 1px decorative divider | — |
| Blocked row | row with `blocked` rule or no share | muted readable text, smaller values, visible "No share in this case" text | — |
| No amount | amount null | fraction and percent only, no amount cell | — |
| Disclaimer | `disclaimer` notice | always shown, semibold, 1px border at 60% foreground, 6px radius, 12px padding, no dismiss control | null text → catalog `notice.disclaimer` |
| Beta | `locale_beta` notice | visible with its explanation text | no text and no catalog key → omitted |
| Has shares | answer state | primary-button Full results link to `/{locale}/results/`, `prefetch={false}`, ≥44px | — |
| Pending / error / choose-school / refused | controller state | body shows today's pending marker, error with Retry, `SchoolChoice`, refusal | stale responses discarded |

</intent-contract>

## Code Map

- `web/src/app/[locale]/interview/share-preview.tsx` -- the only export is `SharePreview` (props: `messages, results, locale, kase`, optional `saving, failed, onChooseSchool, onPresented, post, drop, heirCount`). Request effect at :98, `onPresented` at :151, available render at :167, other branches at :237. Today the results link is an underline text link and there is no disclaimer or Beta display. Split this file into a controller hook and `SharePreviewBody`.
- `web/src/app/[locale]/interview/start-case.tsx` -- shell grid at :659 and :692. The preview follows the list on mobile, spans both columns at `lg`, and the `xl` root-estate third column at :777 puts the edit panel above the preview. Mount at ~:778, `reportPresented` at :322, the later-estate `hidden` wrapper at :496.
- `web/src/app/[locale]/interview/page.tsx:19` -- 1360px shell. Keep it.
- `web/src/interview/tree.ts:189` (`estateModel`), `web/src/app/[locale]/interview/heir-list.tsx:134` -- consumers of the blocked evidence. Read only.
- `web/src/interview/preview.ts:138`, `web/src/interview/results.ts:45` -- `previewRows` and `rowLabels`, to reuse.
- `web/src/app/[locale]/results/results-view.tsx:236,353` -- `HeirCard` bidi pattern, as reference only. Do not edit.
- `web/src/contracts/presented.ts:242` -- notice codes include `disclaimer` and `locale_beta`, with nullable `text`.
- `web/src/i18n/catalog.generated.ts:286` -- `notice.disclaimer`. `web/src/i18n/messages.ts:714` -- `treeNoShare`. `:910` -- `previewResultsLink`.
- `web/src/app/[locale]/results/results-view.test.tsx` -- pattern for a happy-dom component test (`installDom`, `previewFixture`).
- `web/e2e/family.ts:20` (`openHeirsScreen` waits for the visible table or list), `web/e2e/interview.spec.ts`, `web/e2e/accessibility.spec.ts:36,132`.
- `_bmad-output/planning-artifacts/ux-designs/ux-mawareeth-2026-11-16/DESIGN.md:271` -- the `share-preview` token is background plus 24px padding, with no width and no inline-start border.

## Tasks & Acceptance

**Execution:**
- `web/src/app/[locale]/interview/share-preview.tsx` -- extract `useSharePreview(...)` (all state, refs and effects, returning a view state) and `SharePreviewBody` (pure; props are the view state plus `messages`, `locale`, `onRetry`, `onChooseSchool`, `saving`, `failed`). Apply the matrix styling, disclaimer, Beta and primary Full results. Keep the `share-preview` token: background and padding only. -- Lets 11.3 mount the body without moving the lifecycle.
- `web/src/app/[locale]/interview/start-case.tsx` -- call the hook where `SharePreview` mounts today, so lifecycle and evidence are unchanged. Render no body. Remove the `xl` third column and the `lg` preview span. From `lg` up, keep the edit panel placed as at 1024–1279px. Add `data-preview-state` and `data-preview-revision` to the Interview root. -- Gives the space to family entry.
- `web/src/app/[locale]/interview/share-preview.test.tsx` (new) -- happy-dom tests for every matrix row using `previewFixture`, plus a check that the body has no `aria-live` and does no arithmetic, with all values coming from the fixture strings.
- `web/e2e/family.ts`, `web/e2e/interview.spec.ts`, `web/e2e/accessibility.spec.ts` -- switch wait-only gates (`openHeirsScreen`, `drag` at :1507, `rowsOf` at :1643) to `data-preview-state` and `data-preview-revision`, or to tree readiness. Mark the preview-only tests (:233 school block, :300, :1661–1793 story 9.10 group, :2177 bidi, accessibility :132) `test.fixme("returns with the summary sheet in story 11.3")`. In the mixed tests (:316, :370, :1060, :1261, :2232), remove only the preview assertions with a `// 11.3:` comment. Rewrite the 1100/1366 shell tests (:880, :898) and the 1280px geometry cases (:1841) to the two-column layout, and assert that no preview region exists at 375, 1100 and 1366px.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- record: the fixme'd preview e2e tests and removed mixed assertions to restore in 11.3; the Interview has no visible shares, School choice, preview error or Retry, or Full results until 11.3.

**Acceptance Criteria:**
- Given the Interview at 375, 1100 and 1366px in en and ar, when the family has shares, then no Share preview region is in the page, and from 1024px the layout is the 380px column plus a flexible tree inside the 1360px shell, with the edit panel beside the tree as at 1024–1279px.
- Given an edit, Undo or later-estate navigation, when a calculation settles, then `data-preview-revision` matches the accepted revision, blocked badges in the tree and Heirs list still update, and the single polite status still announces as before.
- Given `SharePreviewBody` with each matrix state, when rendered in en, ar and fr, then it matches the matrix and activating Full results by click or keyboard navigates to `/{locale}/results/`.

## Design Notes

The view state the hook returns must already carry everything the body draws, including the last available rows used while pending, so 11.3 only renders `<SharePreviewBody {...view} />` inside the sheet. Keep `heirCount` in the hook result because 11.3's bar needs it.

## Verification

**Commands (from `web/`):**
- `node --import ./src/test/loader.mjs --test "src/interview/*.test.ts" src/api/case.test.ts "src/app/??locale??/interview/*.test.tsx" "src/app/??locale??/results/results-view.test.tsx"` -- all pass
- `npm run lint` and `npm run typecheck` -- clean
- `npm run build` then `npm run test:e2e -- --project=chromium interview.spec.ts accessibility.spec.ts` -- pass, with only the listed tests fixme

## Spec Change Log

## Review Triage Log

### 2026-11-22 — Review pass
- One combined read-only codex call (deep tier, diff 78 kB) covered blind-hunter, edge-case-hunter, verification-gap, intent-alignment and cross-story-contract (that layer reported "No contract shape changed").
- verdicts: 26 findings — high 0, medium 7, low 15, false 4, maybe-false 0
- findings:
  - `[medium]` `[patch]` blind: the root revision marker is also set on `error`, and the post-edit waits at interview.spec.ts:440/:2253 accept the revision alone — the waits now require `data-preview-state="ready"` plus the revision.
  - `[medium]` `[patch]` blind: the disclaimer was only in AvailableShares, so School choice, refusal and error had none — it now renders in SharePreviewBody's common wrapper for every content kind.
  - `[low]` `[patch]` blind: a supplied Beta notice was not shown with School-choice content — moved to the common wrapper with the disclaimer.
  - `[false]` `[reject]` blind: blocked rows cannot show smaller values — `previewRows` gives blocked rows null fraction, percent and amount (preview.ts:143), so there are no values to show. The text "No share in this case" is explicit.
  - `[false]` `[reject]` blind: a presented name could be lost because labels come from a map — the map is `rowLabels(kase)`, which labels every heir of the case. It is the same source as the pre-11.2 preview and the tree.
  - `[low]` `[patch]` blind: wrapped values lose logical-end alignment — added `ms-auto justify-end` to the value group.
  - `[low]` `[patch]` blind: `{...view}` cannot wire Retry because the body only calls `onRetry` — `onRetry` is now optional and falls back to `view.retry`.
  - `[low]` `[patch]` blind: the School form submits silently without `onChooseSchool` — SchoolChoice gets `disabled={saving || !onChooseSchool}`.
  - `[low]` `[patch]` blind: the Full results test checked only the English href — it now checks the href and link text for en, ar and fr.
  - `[low]` `[patch]` blind: the disclaimer test accepted any string — it now must equal `terms[locale]["notice.disclaimer"]` for each locale.
  - `[low]` `[patch]` blind: the 1366px shell check passed on overflow, because the signed difference went negative — it now uses `Math.abs`.
  - `[low]` `[defer]` edge: a stale-only response leaves the lifecycle pending — the request effect was moved unchanged, so this predates the story and is recorded in `deferred`.
  - `[medium]` `[patch]` edge: a failed request carries the revision (grouped with the first row) — fixed by the ready-plus-revision waits.
  - `[low]` `[patch]` edge: School form with no handler (grouped with the earlier row) — disabled.
  - `[medium]` `[patch]` edge: notices missing outside the available state (grouped with the disclaimer row) — common wrapper.
  - `[low]` `[patch]` edge: value alignment on wrap (grouped with the earlier row) — `ms-auto justify-end`.
  - `[low]` `[patch]` edge: the unused `results` prop still crossed the client boundary — removed from the StartCase props and from page.tsx.
  - `[low]` `[patch]` edge: the unused `relationsOf` and `relations` remained — removed from the hook, `names` and `Last`.
  - `[low]` `[reject]` edge: `rowsOf` still selects under the removed preview heading — it is used only by the `test.fixme` tests of the 9.10 group (interview.spec.ts:1679–1784), so no active test or user hits it. 11.3 restores its host.
  - `[low]` `[patch]` edge: only the disclaimer test looped over locales (grouped with the Full results row) — Full results and the disclaimer are now checked per locale, and the disclaimer for every content kind.
  - `[false]` `[reject]` edge: the edit panel sits below the tree rather than beside it — the story AC says "placed as at 1024–1279px", where the panel follows the tree, and the code matches.
  - `[medium]` `[patch]` verification-gap: a failed post-edit calculation passes the revision waits (grouped with the first row) — the waits now require ready.
  - `[medium]` `[patch]` verification-gap: the fixme on the bidi test also dropped its tree-card `bdi` assertion — moved into the active en/ar no-preview test.
  - `[medium]` `[patch]` verification-gap: the failure announcement was covered only by a skipped test — added the active "a failed preview after an add keeps the family and reaches the one status" (HTTP 500, family stays, root `error`, status says `previewFailed`).
  - `[low]` `[patch]` verification-gap: Full results activation was checked for English only (grouped with the Full results row) — the destinations are checked per locale. Browser activation waits for 11.3's host.
  - `[false]` `[reject]` intent-alignment: the browser cannot reach rows, notices, School choice, Retry or Full results — this is the owner-selected literal reading (option 1, 2026-11-22). The diff implements it, and 11.3 supplies the host.

## Auto Run Result

**Routing:** `/bmad-build-auto epic 9` resolved to 11.2, the next story in the Epic 9 block of sprint-status (sprint change 2026-11-22: 9.13, then 11.2, then 11.3, then 9.12). The first pass halted on an intent gap: 11.2 removes the preview host before 11.3 adds the sheet. The owner chose option 1, the literal reading, with preview e2e tests fixme'd until 11.3, and the run resumed. Codex compiled `epic-11-context.md`.

**Summary:** The Interview has no Share preview at any width. From 1024px it is two columns, the 380px Add relatives/Heirs column and a flexible tree, with the edit panel below the tree as at 1024–1279px. The preview lifecycle (`useSharePreview`) stays mounted through `SharePreviewController`, so tree and Heirs-list blocked evidence and the single polite status work as before. It draws nothing and exposes `data-preview-state` and `data-preview-revision` on the Interview root. `SharePreviewBody` is a pure component that only unit tests mount until 11.3. It has share rows with values at the logical end, blocked rows with "No share in this case", the always-present disclaimer and Beta notice in every state, and a primary Full results link with `prefetch={false}`.

**Files changed:**
- `web/src/app/[locale]/interview/share-preview.tsx` -- split into `useSharePreview`, `SharePreviewBody` and `SharePreviewController`.
- `web/src/app/[locale]/interview/share-preview.test.tsx` -- new happy-dom tests (9) for every matrix row, School choice, and per-locale Full results and disclaimer.
- `web/src/app/[locale]/interview/start-case.tsx`, `page.tsx` -- two-column layout, headless controller, root signal, and the unused `results` prop removed.
- `web/e2e/family.ts`, `interview.spec.ts`, `accessibility.spec.ts` -- waits moved to the root signal, 13 preview-only tests marked fixme, new pane-free layout tests and an active failed-preview announcement test.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- what 11.3 must restore.
- `_bmad-output/implementation-artifacts/epic-11-context.md` -- new Epic 11 context.

**Review:** 26 findings. 21 patched, in 12 entries (7 medium and 14 low rows). 1 deferred (a stale-only response stays pending; pre-existing). Rejected: 4 false (blocked-row values, the label source, edit-panel placement, intent divergence) and 1 low (`rowsOf` is used only by fixme'd tests).

**Follow-up review:** recommended (`true`). This first pass patched 7 medium rows. The specific unverified risk is that the disclaimer and Beta notice moved into the common wrapper and render in prompt, waiting and error states, which no browser surface shows until 11.3. 11.3's review should check that they read correctly in the sheet.

**Verification:** Node unit tests passed 516/516. `npm run typecheck` is clean, and `npm run lint` has 0 errors (13 warnings, among them the unused `choiceFailed` kept for 11.3). `npm run build` then Chromium Playwright `interview.spec.ts accessibility.spec.ts` gave 189 passed and 13 skipped (fixme). Firefox, WebKit and the other e2e specs were not run here; CI runs them.

**Residual risks:** Until 11.3, the Interview shows no shares, School choice, preview error with Retry, or Full results action (recorded in deferred-work). 11.3 must lift the full `useSharePreview` view, not just the root signal. `sprint-status.yaml` still shows 9.13 as `review`, although its spec is `done`.
