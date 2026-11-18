---
title: 'Recover from failed or stale JavaScript chunks'
type: 'feature'
created: '2026-11-13'
status: 'done'
baseline_revision: 'abc88495195b0ad508fee7f7add2a66dabebd00f'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** Each blue/green release image holds only its own hashed `/_next/static/` assets. A tab left open across a deploy, or a flaky network, can therefore fail to load a script chunk. Next 16 already turns a failed RSC payload (`.txt`) fetch during client navigation into a full browser navigation. But the app has no `error.tsx` or `global-error.tsx`, so any error thrown while rendering (including a chunk that fails to load during render) leaves a blank or broken page with no way back to the interview. This is a release blocker in deferred-work.md (from spec-1-1).

**Approach:** Add three pieces:
- a localized `[locale]/error.tsx` boundary that shows a fallback with "Reload page" and a link back to the interview;
- a minimal root `global-error.tsx` for errors in the locale layout itself;
- a shared helper that, only for chunk-load errors, performs one automatic hard reload, guarded against loops.

Prove it in Playwright by simulating stale-deploy failures.

## Boundaries & Constraints

**Always:**
- `web/src/app/chunk-recovery.ts` (pure, unit-testable):
  - `isChunkLoadError(error)` is true when `error.name === "ChunkLoadError"`, or when the message matches `/Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i`. It is false for anything else, including non-Error values.
  - `shouldAutoReload(storage, now)` returns true and records `now` under `sessionStorage` key `mawareeth.chunk-reload-at` only when no reload was recorded in the last 30 000 ms. If storage throws or is unavailable, it returns false (no auto reload, so a loop is impossible).
- `web/src/app/[locale]/error.tsx` (`"use client"`, props `{ error, reset }` per the installed Next docs in `web/node_modules/next/dist/docs/`; check whether `retry` exists and prefer the documented recovery API). Behaviour:
  - It gets the locale from the route params or the pathname.
  - On mount, if `isChunkLoadError(error) && shouldAutoReload(...)`, it calls `window.location.reload()` once.
  - Otherwise it renders, in the locale's language and direction: a heading/message, a "Reload page" button (`window.location.reload()`), and a link to `/{locale}/interview/`.
  - Focus moves to the heading. The styling uses the existing `ui.ts` button classes.
  - It logs the error with `console.error`.
- `web/src/app/global-error.tsx` renders its own `<html lang dir><body>`. It picks the locale from the first path segment (ar/en/fr, else `ar`), applies the same chunk auto-reload rule, and offers the same reload button and interview link. It needs no imports beyond `messages`, `chunk-recovery` and React; no site nav.
- New text goes in `web/src/i18n/messages.ts` (and its `Messages` type) under one new key group `pageError`:
  - `title`: en "This page did not load correctly"; ar "لم يتم تحميل هذه الصفحة بشكل صحيح"; fr "Cette page ne s'est pas chargée correctement".
  - `body`: en "Reload the page to continue. Your saved answers are kept."; ar "أعد تحميل الصفحة للمتابعة. إجاباتك المحفوظة باقية."; fr "Rechargez la page pour continuer. Vos réponses enregistrées sont conservées."
  - `reload`: en "Reload page"; ar "إعادة تحميل الصفحة"; fr "Recharger la page".
  - `interview`: en "Back to the interview"; ar "العودة إلى المقابلة"; fr "Retour à l'entretien".
  Record all of it for native review in deferred-work.md.
- Playwright (`web/e2e/stale-deploy.spec.ts`, reusing `e2e/api.ts` stubs):
  - (a) After hydration on `/en/`, the RSC payload for the next client navigation is fulfilled with 404 once. Clicking a nav link still ends on the destination URL with its content rendered (Next's hard-navigation fallback).
  - (b) After hydration, the first request for a JS chunk that is not yet loaded and is needed by the destination route is aborted once. The navigation still ends on the destination with content rendered and no blank page.
  - (c) The error fallback renders localized (`/ar/` RTL and `/en/`) with a working reload button and interview link when a render error occurs. Trigger it in the most direct reliable way available (for example a chunk failure that persists past the one auto reload); if no reliable in-browser trigger exists, cover (c) with a happy-dom unit test of `error.tsx` instead and say so.
- Unit tests (`node --test`) for `isChunkLoadError` (each signature, a plain Error, a string, null) and `shouldAutoReload`: first call true; second call within 30 s false; true again after 30 s; throwing storage returns false.
- Remove the stale-chunk release-blocker entry from deferred-work.md and add the native-review entry for `pageError`.

**Block If:**
- Next 16.4.5's documented error-file API cannot catch render-time chunk errors on a static export, so a different mechanism (service worker, keeping old assets across deploys, server changes) would be needed.

**Never:**
- No change to deploy, Docker, Caddy, Django or asset retention. No service worker.
- No `experimental` Next flags (for example `appNavFailHandling`).
- No change to interview logic, storage of drafts or API calls.
- No `not-found.tsx` (the 404 pages are pruned deliberately).

</intent-contract>

## Code Map

- `web/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md:119,163` -- the installed error-file API (`reset`, `retry` availability; global-error must render `<html>`/`<body>`). Read before writing (see `web/AGENTS.md`).
- `web/node_modules/next/dist/client/components/router-reducer/fetch-server-response.js:95-227` -- existing hard-navigation fallback for a failed RSC fetch (read-only evidence for test (a)).
- `web/src/app/[locale]/layout.tsx:14` -- locale layout, `<html lang dir>` and `generateStaticParams`; `error.tsx` sits beside it.
- `web/src/app/[locale]/ui.ts:5` -- shared button/link classes.
- `web/src/app/[locale]/interview/start-case.tsx:78` -- `localStorage` key pattern (`mawareeth.*`); drafts persist in `sessionStorage` (`web/src/interview/answers.ts:291`) and the case lives in the server session, so a reload keeps saved answers.
- `web/src/i18n/messages.ts:15,264` -- `Messages` type and the per-locale objects; `directionOf` and the locale helpers live in `web/src/i18n/`.
- `web/scripts/prune-export.mjs:1` -- removes 404 pages (do not add `not-found.tsx`).
- `web/e2e/api.ts`, `web/e2e/serve.mjs`, `web/playwright.config.ts` -- the Playwright harness (stubs, real 404s for missing files).
- `web/src/test/dom.ts`, `web/src/test/loader.mjs` -- happy-dom unit test setup.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- the "Handle failed or stale JavaScript chunks…" entry.

## Tasks & Acceptance

**Execution:**
- `web/src/app/chunk-recovery.ts` and `web/src/app/chunk-recovery.test.ts` -- detection and the loop guard, with unit tests.
- `web/src/app/[locale]/error.tsx` -- localized boundary.
- `web/src/app/global-error.tsx` -- root fallback.
- `web/src/i18n/messages.ts` -- the `pageError` group in the type and all three locales.
- `web/e2e/stale-deploy.spec.ts` -- scenarios (a)–(c).
- `_bmad-output/implementation-artifacts/deferred-work.md` -- remove the resolved entry; add the native-review entry.

**Acceptance Criteria:**
- Given a hydrated page whose next navigation's chunk or RSC payload fails once, when the visitor follows a link, then they land on the destination with content rendered (no blank page, no reload loop).
- Given a chunk error that persists past the one automatic reload, when the page renders, then the localized fallback shows a reload button and an interview link, and no further automatic reload happens within 30 s.

## Spec Change Log

## Review Triage Log

### 2026-11-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 2, low 4)
- defer: 0
- reject: 40: (high 0, medium 3, low 37)
- addressed_findings:
  - `[medium]` `[patch]` `global-error.tsx` was untested. Added `web/src/app/global-error.test.tsx` (happy-dom): fr/ar `lang`/`dir`, title, reload button, interview link, no auto reload for a plain error, one reload for a chunk error.
  - `[medium]` `[patch]` Nothing proved that the first chunk failure triggers the automatic reload. The e2e test now sets a window marker and asserts it is gone and the reload key is recorded. This showed that a single aborted chunk is absorbed by Next's own re-request and never reached the boundary, so the test now fails each unseen chunk twice. Added unit tests for `reloadForChunkError` (one reload, none within 30 s, none for a non-chunk error, none when storage throws).
  - `[low]` `[patch]` A future stored timestamp (clock skew) blocked recovery; `last > now` is now treated as stale.
  - `[low]` `[patch]` `isChunkLoadError` missed cross-realm or non-Error objects; it now duck-types string `name`/`message`.
  - `[low]` `[patch]` The e2e test hardcoded the storage key; it now imports `RELOAD_KEY`.
  - `[low]` `[patch]` French was not covered by the fallback e2e loop; `fr` is added.

## Auto Run Result

**Summary:** A render-time failure on the Next.js routes no longer leaves a blank page. `[locale]/error.tsx` and the root `global-error.tsx` show a localized fallback ("This page did not load correctly", a "Reload page" button and a link back to the interview, with focus on the heading). For chunk-load errors they perform one automatic hard reload, which fetches the new release's assets after a deploy. A 30 s `sessionStorage` guard prevents loops, and blocked storage means no auto reload. Next 16 already turns a failed RSC payload fetch into a full navigation; an e2e test pins that. The stale-chunk release blocker is closed.

**Files changed:**
- `web/src/app/chunk-recovery.ts` and `web/src/app/chunk-recovery.test.ts` -- chunk-error detection (duck-typed), the 30 s reload guard (clock-skew safe) and `reloadForChunkError`, with unit tests.
- `web/src/app/[locale]/error.tsx` -- localized boundary.
- `web/src/app/global-error.tsx` and `web/src/app/global-error.test.tsx` -- root fallback with its own `<html lang dir>`, inline styles (global CSS does not reach it), and tests.
- `web/src/i18n/messages.ts` -- `pageError` (title, body, reload, interview) in ar/en/fr.
- `web/e2e/stale-deploy.spec.ts` -- RSC 404 recovery, chunk failure recovered by one proven reload, and the fallback in ar/en/fr after the reload budget is spent.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- removed the stale-chunk release blocker; added native review of the `pageError` text.

**Review findings:** 6 patches applied (2 medium, 4 low), 0 deferred, 40 rejected. The rejected findings, with reasons:
- Server-side asset retention, service workers and global `error`/`unhandledrejection` listeners: excluded by the spec, and the app has no lazy imports outside render.
- Telemetry: out of scope.
- Using `reset`/`retry` instead of a hard reload: a stale deploy needs fresh assets.
- A brief fallback flash before the reload, and `role="alert"`: focus moves to the heading.
- Arabic as the default locale for non-locale paths: matches the site root's default.

**Follow-up review recommendation:** true. Patched: high 0, medium 2, low 4. Score 3×2 + 4 = 10.

**Verification:** in `web/`, `npm run lint` (0 errors, 10 existing warnings), `npm run typecheck`, `npm test` (472 pass), `npm run build` and `npm run test:e2e` (44 passed).

**Residual risks:**
- If a chunk keeps failing after the one automatic reload, the reloaded page's own hydration can fail too. The visitor then sees the static HTML without the React fallback; the e2e fallback test stages this by pre-recording the reload.
- The `pageError` text in all three languages awaits native review.
- No test runs a real two-release deploy; skew is simulated with request interception.

## Verification

**Commands:**
- `cd web && npm run lint && npm run typecheck && npm test` -- expected: pass (0 lint errors).
- `cd web && npm run build && npm run test:e2e` -- expected: all browser tests pass, including the new stale-deploy spec.
