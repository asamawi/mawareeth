---
title: 'Story 9.10: Coordinate Interview announcements and updating states'
type: 'feature'
created: '2026-11-22'
baseline_revision: '7bf3cdc6d4d9f690f2f111bb8a7790caa345e481'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
  - '{project-root}/web/AGENTS.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The 10-second "Still working on the preview…" stage cannot appear, because the preview request gives up at 5 seconds.
    evidence: |-
      `PREVIEW_TIMEOUT_MS = 5_000` (`web/src/api/case.ts:1010`, from Epic 8) ends every preview request with a failure and Retry before the 10s timer in `share-preview.tsx` fires. Visitors see "Updating the preview…" from 3s, then the shipped failure message with Retry at 5s, so what they see is honest. But the `previewStillWorking` copy is effectively unused. The owner decides whether to lengthen the preview timeout, move the second stage before 5s, or drop it.
    location: >-
      web/src/app/[locale]/interview/share-preview.tsx (STILL_AFTER) and web/src/api/case.ts:1010
    severity: low
  - summary: >-
      What screen readers actually say for the coalesced status (one sentence per change) is not yet evidenced.
    evidence: |-
      The intent-alignment layer notes that the intent lives at the assistive-technology surface. The diff's tests observe DOM text, roles and busy attributes only. The NVDA/VoiceOver/TalkBack runs are recorded as pending under "Story 9.10" in deferred-work.md.
    location: >-
      _bmad-output/implementation-artifacts/deferred-work.md (Story 9.10)
    severity: medium
---

<intent-contract>

## Intent

**Problem:** The Interview speaks through several polite regions that can talk over each other: a hidden status in the Heirs list (commands and zoom; zoom text replaces the command text), a second hidden status in the share preview (completion, school differences, errors), and the offline/loading paragraphs. Nothing coalesces them or sets `aria-atomic`. While a preview refreshes, the old shares are replaced by "Updating the preview…" (rows unmount, layout jumps), a same-basis refresh such as a rename shows old rows with `aria-busy=false`, there is no delayed slow status, and cold load is a bare "Loading…" line. UX-DR35/54/56/60/75 and NFR-3 ask for one restrained status, retained muted shares and a delayed boxed progress line.

**Approach:** Add one pure announcement coalescer and one persistent `role="status" aria-live="polite" aria-atomic="true"` region owned by `StartCase`. Commands, zoom, the delayed slow status and preview outcomes post to it instead of their own regions; it speaks one sentence about 800ms after the last post. Rework `SharePreview` to keep the last good rows mounted and muted while a request is in flight, with regional `aria-busy`, a boxed one-line status after 3s, and a 12px skeleton on cold load.

## Boundaries & Constraints

**Always:**
- **One status region.** Exactly one polite `role="status"` with `aria-atomic="true"` carries routine Interview speech, always mounted (empty when idle). The Heirs-list span (`heir-list.tsx:134`) and the preview's hidden status (`share-preview.tsx:86-93,162-224`) are removed; their text goes through the coalescer. Steppers, rows and the Undo toast stay silent.
- **Coalescer rules** (`web/src/interview/announce.ts`, pure, timer injected): message kinds are `action` (add/bulk/edit/remove/Undo, from the existing `Announcement` localisation in `start-case.tsx:421-445`), `zoom`, `progress` and `preview`. A post replaces any pending message of the same kind and restarts an 800ms timer; on expiry it emits one string joining the pending parts in the order action, zoom, preview, progress, separated by a space, then clears. A flushed string equal to the previous flushed string is still re-announced (re-key or clear-then-set, as the current `seq` keying does). Posting never delays the preview request or the visual update.
- **Preview sentence.** When a preview settles for the accepted revision, post `preview` = new key `previewReadyCount` ("Heirs: {count}. Shares ready.") where count is the number of heirs in the accepted Case's active estate. Example result: "Son 2 added. Heirs: 7. Shares ready." Existing outcome texts (school differences, unavailable, failed, throttled, expired) are posted as `preview` messages instead, with their current wording. The existing action keys (`heirAdded` "{heir} added." etc.) keep their wording.
- **Refusals stay alerts.** All `role="alert"` paths (panel/AddHere/drop refusals, conflicts, Undo failure, sheet errors, preview failure if currently an alert) stay as they are and are never posted to the status.
- **Pending shares.** From the moment a new preview is requested (basis change, same-basis revision change, or Retry) until it settles: the last good rows stay mounted with their stable keys, rendered with `text-muted` on `bg-surface` (no `opacity-*`), and the preview section has `aria-busy="true"`. On settle the rows swap in place; the section keeps its height (reserve the previous min-height while busy). A response for an older revision or a superseded request is discarded through the existing `acceptRevision`/`reconcile`/abort logic and never becomes the displayed answer. With no previous rows (first preview), the existing waiting presentation is kept.
- **Slow status.** 3s after a request starts and while it is unsettled, show a boxed one-line `bg-surface text-muted` line (border, rounded, one line, no spinner, no animation) reading `previewWaiting` ("Updating the preview…"); from 10s it reads new key `previewStillWorking` ("Still working on the preview…"). Each text is posted once as `progress`. It never takes focus, is not a dialog and is not itself a live region. It disappears on settle.
- **Offline.** The existing frozen state and `offlineEditing` message are reused unchanged (add/edit/delete/Undo disabled, no queue). If the browser goes offline with a preview in flight, the last good rows stay visible (muted) and the slow status is hidden; on reconnect the existing refetch behaviour applies. The status line is never the input-blocking authority.
- **Cold load.** While the Case is loading (`view` loading in `start-case.tsx:471`), render a region with `aria-busy="true"` holding 12px-tall rounded `bg-surface` bars shaped like the Add-relatives panel, tree and Heirs list (Tailwind `h-3`), plus the existing "Loading…" text visually hidden. No shimmer under any motion setting. Header and navigation stay usable.
- **New copy** (`previewReadyCount`, `previewStillWorking`) in en, ar and fr in `web/src/i18n/messages.ts`, and recorded in `deferred-work.md` for native review. Proposed: ar "عدد الورثة: {count}. الأنصبة جاهزة." / "ما زال تحديث المعاينة جاريًا…"; fr "Héritiers : {count}. Parts prêtes." / "Mise à jour de l'aperçu toujours en cours…". `{count}` uses the locale's digits the same way other count placeholders do.

**Never:**
- Changing any existing message text or translation.
- Server, API contract, flow command or revision logic changes; browser share arithmetic or number formatting.
- New red/green/amber colours, opacity-based muting, spinners or reduced-motion animation.
- Touching `SaveNotice`, the madhab selector status, the proof aside in `inheritance-table.tsx`, Contact or Country refusal flows, or 9.11 responsive work.
- Delaying the preview request or display behind the 800ms debounce.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Add, preview fast | add Son → preview settles in 200ms | status, once ~800ms after the last post: "Son 2 added. Heirs: 7. Shares ready." | — |
| Add, preview slow | preview settles at 4s | ~0.8s: "Son 2 added."; ~3.8s: "Updating the preview…"; after settle +0.8s: "Heirs: 7. Shares ready." | — |
| Two adds quickly | two adds 300ms apart | one sentence with the latest action only | — |
| Zoom during change | add then `+` within 800ms | "Son 2 added. Zoom 125% …" one sentence | — |
| Stale response | revision 1 preview arrives after revision 2 accepted | discarded; rows stay muted/busy until revision 2 settles | — |
| Rename (same basis) | edit name | rows muted, `aria-busy=true` until settle | — |
| Preview fails | 500 on preview | family kept; existing failure text and Retry; failure text posted once | Retry restarts pending state |
| Offline mid-refresh | go offline with request in flight | last rows visible muted, no slow box; edits disabled with offline message | — |
| Cold load | case GET delayed | skeleton bars, region `aria-busy=true`; replaced by the Interview on load | load failure keeps existing message |
| Refusal | illegal drop / refused add | `role="alert"` with localized reason; status region unaffected | — |

</intent-contract>

## Code Map

Paths under `web/src/app/[locale]/interview/` unless stated.
- `start-case.tsx` -- `:421-445` localises `Announcement` (keyed by `seq`); `:670,715-716` `zoomNote` overrides command text (remove; zoom posts to coalescer); `:471-488,562-564` loading/offline/expired status paragraphs (loading → skeleton; offline unchanged); `:157-174,750-757` passes the saved case to `SharePreview`; `:179-214,252-256,449` offline freeze and Undo guards (read-only). Own the coalescer (`useRef` + `setTimeout`) and the single status region here; pass a `post(kind, text)` callback down.
- `heir-list.tsx:134` -- hidden status span to remove; `:142-164` outline/alerts unchanged.
- `family-tree.tsx:57-64,125-129` -- `announceZoom`/`onAnnounce`: route to `post("zoom", …)`.
- `share-preview.tsx` -- `:56-79` fetch effect (case id, basis key, revision, locale, attempt; abort on supersede); `:76-104,211-225` waiting branch that unmounts rows; `:86-93,162-224` hidden status; `:187-208` failure/Retry. Track `lastGood` separately from the in-flight request; add busy state, muted rows, min-height reserve, slow timers (3s/10s), offline handling via `useOnline` (`online.ts:3-14`).
- `web/src/interview/preview.ts:69-85,163-169` -- `acceptRevision`, `reconcile`, `shown` (note `shown` omits revision; pending must also cover same-basis revision changes). Extend only if needed for a pure `isPending` helper.
- `web/src/interview/announce.ts` (new) + `announce.test.ts` -- the coalescer. Unit runner is Node `--test` (`web/package.json:16`); use `node:test` `mock.timers` or an injected scheduler.
- `../results/inheritance-table.tsx:160` -- rows have stable keys; accept a `pending` prop (or wrap) to apply muted classes without remounting. Proof aside `:72-77,275-285` untouched.
- `web/src/i18n/messages.ts` -- type at `:224-235`; ar `:567-574`, en `:900-907`, fr `:1235-1242` neighbourhood: add `previewReadyCount`, `previewStillWorking`.
- `../globals.css:4-38,62` -- tokens `bg-surface`/`text-muted` (light #f2f7f5/#4b5563, dark #101a17/#a8b0ad) and reduced-motion rules.
- Tests: `family-tree.test.tsx:10`, `add-relatives.test.tsx:128,188`, `undo-toast.test.tsx:47`, `edit-sheet.test.tsx:417-451`, `web/src/interview/flow.test.ts:547,632,708,2390`. E2E `web/e2e/interview.spec.ts:316,350,367,370,755,771,1215,1285,1490,1558` (add/bulk speech, Undo, zoom, offline, empty, refusal — several read the old Heirs-list status and must target the new region); `web/e2e/api.ts` (`Stubs.getPreview`, `previewGets`, `fullCase`, `previewFor`), `web/e2e/family.ts` (`openHeirsScreen`, `openCanvasFixture`, `lineageFixture`); `web/e2e/accessibility.spec.ts:29-99`.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- add a "Story 9.10" section.

## Tasks & Acceptance

**Execution:**
- `web/src/interview/announce.ts` + `announce.test.ts` -- coalescer per Boundaries; test replace-by-kind, ordering, 800ms trailing flush, restart on post, identical re-announce, empty when idle.
- `web/src/i18n/messages.ts` -- add the two keys in en/ar/fr with the proposed text.
- `start-case.tsx`, `heir-list.tsx`, `family-tree.tsx` -- single status region and `post` wiring; remove the Heirs-list span and `zoomNote`; cold-load skeleton.
- `share-preview.tsx`, `../results/inheritance-table.tsx`, (`web/src/interview/preview.ts` if needed) -- last-good rows, muted pending, `aria-busy`, height reserve, slow box at 3s/10s, offline mid-refresh, preview posts; remove the hidden status.
- Component/unit tests -- update tests that read the removed regions; add a `share-preview` test (or e2e) for pending muted rows without opacity and `aria-busy`.
- `web/e2e/interview.spec.ts` -- retarget existing speech assertions to the single region; add: fast add → one combined sentence; delayed preview (route delay ~4s) → rows retained with `text-muted`, no `opacity`, `aria-busy=true`, slow box visible after 3s and not before, then swap; stale older-revision response discarded; exactly one `[role=status][aria-atomic=true]` region on the Interview; delayed case GET → skeleton with `aria-busy=true`; offline mid-refresh → rows visible, edits disabled. Use `page.clock` or route delays, not fixed sleeps longer than needed.
- `web/e2e/accessibility.spec.ts` -- add an axe scan of the pending-preview state and the cold-load skeleton (en, ar).
- `deferred-work.md` -- "Story 9.10": native review of `previewReadyCount`/`previewStillWorking` in ar and fr; screen-reader check that the coalesced status is spoken once per change (NVDA/Chrome, VoiceOver iOS, TalkBack).

**Acceptance Criteria:**
- Given an Interview change with a fast preview, when the change is accepted, then the single status region speaks one sentence combining the action and the heirs/shares-ready summary about 800ms later, and no other polite region speaks.
- Given a preview in flight after an accepted change, when it is pending, then previous shares stay visible in the muted colour pair without opacity, the region is `aria-busy`, the boxed status appears only after 3s, and completion swaps rows without a layout jump; stale responses never display.
- Given cold load, offline or a refusal, when rendered, then cold load shows 12px skeleton bars in an `aria-busy` region, offline keeps the family and last preview with edits disabled, and refusals stay `role="alert"` with localized reasons.
- Given the unit tests, lint, typecheck, build and the interview and accessibility Playwright specs, when run, then all pass with no serious or critical axe findings.

## Spec Change Log

## Review Triage Log

### 2026-11-22 — Review pass (all five layers in one combined read-only codex call, standard tier; diff 51 kB)
- verdicts: 26 findings — high 0, medium 11, low 12, false 1, maybe-false 2
- findings (blind-hunter):
  - `[medium]` `[patch]` The first preview after an add from an empty estate is silent, because the first-load silence also catches it. Fixed: only a preview of a case that was ready at mount is silent.
  - `[medium]` `[patch]` A queued "Shares ready" from revision 2 is spoken with revision 3's action. Fixed: the coalescer gained `drop`, and a new request drops pending `preview`/`progress`.
  - `[low]` `[patch]` A result just after 3s flushes "Shares ready. Updating the preview…". Fixed by the same `drop`: settling or aborting drops pending `progress`.
  - `[maybe-false]` `[reject]` A stale older-revision response leaves the preview busy. The old code behaved the same way (it stayed on the waiting line). It needs the server to answer an older revision for a fresh request, which nothing shows can happen. If true it would only be low.
  - `[medium]` `[patch]` An offline failure mid-refresh removes the last good shares. Fixed: while offline, a failure keeps the last rows muted, and reconnecting requests once more.
  - `[low]` `[reject]` The height reserve ends at the swap, and the slow box sits outside it. The reserve is implemented as the spec says, little content sits below the preview, and holding geometry further adds measuring state.
  - `[low]` `[patch]` The slow-preview test reuses the same shares for both revisions. Fixed: distinct values, old shown muted, new after the swap.
  - `[low]` `[reject]` The status text has no `bdi` around names. The region is `sr-only` with no visual rendering, and speech follows logical order, so isolation changes nothing a user meets.
- findings (edge-case-hunter):
  - `[medium]` `[patch]` First add from an empty estate is silent: same root cause as the first blind row.
  - `[medium]` `[patch]` Old completion paired with a new action: same root cause as the second blind row.
  - `[low]` `[patch]` Progress spoken for a request that has settled: same root cause as the third blind row.
  - `[maybe-false]` `[reject]` Stale response busy forever: same as the blind row. If true, low.
  - `[medium]` `[patch]` Offline failure drops the last preview: same root cause as the blind offline row.
  - `[low]` `[reject]` Opening a later estate while the root preview is pending announces with that estate's count. This is a sub-second race. The count is the active estate's by spec, and binding it per request adds state.
  - `[low]` `[reject]` Bidi isolation is lost in the status: same as the blind row.
  - `[medium]` `[patch]` (claim) A fast first-heir add announces only the action: same root cause as the first blind row.
  - `[low]` `[defer]` (claim) "Still working" at 10s cannot appear, because the preview times out at 5s (`case.ts:1010`). Visitors still see honest progress, then failure with Retry. Choosing between a longer timeout, an earlier stage or dropping the stage is an owner decision, recorded in frontmatter `deferred`.
  - `[low]` `[reject]` (claim) The layout shifts after the swap: same as the blind reserve row.
  - `[medium]` `[patch]` (claim) An interrupted refresh removes the last shares: same root cause as the blind offline row.
- findings (verification-gap):
  - `[medium]` `[patch]` There is no empty-to-ready combined-sentence test. Added in e2e.
  - `[low]` `[patch]` The slow test cannot tell old shares from new: same root cause as the blind test row.
  - `[medium]` `[patch]` The offline test stops before the request fails and never reconnects. Extended through failure and reconnect.
  - `[low]` `[reject]` The status assertions miss the offline notice as a second region and stale queued progress. The offline notice is the foundation's state, which the intent says to reuse. Stale progress is fixed by `drop` and its unit test.
  - `[low]` `[defer]` (other) The 10s timer loses to the 5s timeout: same root cause as the edge "Still working" row.
- findings (intent-alignment):
  - `[false]` `[reject]` The diff implements the narrower reading, leaving lifecycle and offline notices in their own markup. Story 9.10 itself says offline "reuses the foundation's blocked-edit state", so this is the intended reading, not a divergence.
  - `[medium]` `[defer]` Real screen-reader speech, row identity and geometry lie outside the tested surface. The screen-reader runs are recorded as pending in deferred-work.md and in frontmatter `deferred`. Row identity is now asserted with distinct values in the slow test.
- findings (cross-story-contract): none ("No contract shape changed").

## Design Notes

**Plural-free count.** The catalog has no plural rules (Arabic needs six forms), so the summary uses "Heirs: {count}." rather than "7 heirs".

**Why the status is owned by `StartCase`.** It is the common parent of the list, tree and preview and already localises `Announcement`; one owner makes "exactly one region" checkable.

```ts
// announce.ts sketch
type Kind = "action" | "zoom" | "preview" | "progress";
export function createCoalescer(emit: (s: string) => void, schedule = setTimeout, cancel = clearTimeout, delay = 800) {
  const pending = new Map<Kind, string>(); let t: ReturnType<typeof schedule> | undefined;
  return { post(kind: Kind, text: string) { pending.set(kind, text); if (t) cancel(t);
    t = schedule(() => { emit((["action","zoom","preview","progress"] as Kind[]).flatMap(k => pending.get(k) ?? []).join(" ")); pending.clear(); }, delay); } };
}
```

## Verification

**Commands:**
- `cd web && npm test` -- expected: all pass.
- `cd web && npm run lint && npm run typecheck` -- expected: 0 errors; at most 12 lint warnings.
- `cd web && npm run build && npx playwright test e2e/interview.spec.ts e2e/accessibility.spec.ts` -- expected: all pass.

**Manual checks (if no CLI):**
- Screen-reader and native-copy items in `deferred-work.md` stay pending for a person.

## Auto Run Result

Status: done
- Review pass: 26 findings; every `patch` was applied by the implementation subagent; two `defer` items are in frontmatter `deferred` and deferred-work.md.
- Verification (2026-11-22, after the review fixes): `npm test` 662/662 pass; lint 0 errors, 12 warnings; typecheck clean; fresh `npm run build`, then `npx playwright test interview.spec.ts accessibility.spec.ts csp.spec.ts` 191/191 pass.
