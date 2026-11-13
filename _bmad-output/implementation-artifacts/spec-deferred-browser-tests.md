---
title: 'Browser tests for the Next.js routes (Playwright + axe)'
type: 'chore'
created: '2026-11-13'
status: 'done'
baseline_revision: '9d2e3ff091aaa01d55ab88f4d23f315132b6ea59'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
deferred:
  - summary: >-
      Browser hydration is not checked under the production Content-Security-Policy.
    evidence: |-
      The static test server sends no CSP (by this spec's Never rule), and the hash-based CSP from 9d2e3ff is covered by Django header tests and one manual headless-Edge run only. Raised by three reviewers. Recorded in deferred-work.md under "Interview & web UI".
    location: >-
      web/e2e/serve.mjs
    severity: medium
---

<intent-contract>

## Intent

**Problem:** The Next.js `/{lang}/…` pages have only Node unit tests on happy-dom. Hydration, the start-case states, the no-auto-retry rule, RTL, keyboard use and reduced motion were checked by hand once, in headless Chrome. This is a release blocker in deferred-work.md (from spec-1-1 and spec-nextjs-drf-foundation).

**Approach:** Add Playwright (Chromium) with `@axe-core/playwright` as web devDependencies. The tests run against the real static export (`web/out`), served by a small Node static server, with every `/api/v1/` call stubbed through `page.route`. They run in the CI `web` job after the build.

## Boundaries & Constraints

**Always:**
- New exact-pinned devDependencies `@playwright/test` and `@axe-core/playwright`. Use the newest versions published at least 14 days before 2026-11-13; record them in the Auto Run Result. Update `package-lock.json` with `npm install`.
- Layout under `web/`: `playwright.config.ts`, `e2e/serve.mjs`, `e2e/api.ts` (stub helpers), and `e2e/*.spec.ts`. Add an npm script `test:e2e` (`playwright test`).
- `e2e/serve.mjs` uses only `node:` built-ins and serves `web/out`:
  - a `dir/` request serves `dir/index.html`;
  - a request for `dir` without the trailing slash gets a 308 redirect to `dir/`;
  - missing files return a real 404, with no SPA fallback;
  - path traversal is rejected;
  - content types follow the extension.
  The Playwright `webServer` starts it on a fixed local port with `reuseExistingServer` outside CI. Tests start from `/ar/`, `/en/` or `/fr/`, never `/`.
- Stubs live in `e2e/api.ts`:
  - `GET /api/v1/session/` returns `{"authenticated": false}` (or true) and sets a `csrftoken` cookie, so writes reach the POST;
  - `GET /api/v1/case/` and `POST /api/v1/case/` return shapes valid for `web/src/api/case.ts`'s parser;
  - any unstubbed `/api/` request fails the test. No Django or Postgres.
- Specs (Chromium only) must prove:
  1. **Hydration.** Landing (ar, en, fr) and `/en/interview/` load with no `pageerror` and no console error. The interview's `[data-js-only]` content is visible after hydration.
  2. **Rendered states.** Covered states:
     - a new visitor is started automatically into the first interview screen;
     - an existing case shows resume / start over, and start over needs confirmation;
     - the expired state;
     - throttled (429) and failed (500, and an aborted network request) each show their localized message, never a blank page;
     - the navbar shows its anonymous vs authenticated state.
  3. **No retry.** After a failed case POST, waiting 3 s produces no further POST. One click on the retry control produces exactly one more POST. A failed session GET is not re-requested by the same component over 3 s, so the request count stays flat after load.
  4. **RTL.** `/ar/…` has `<html lang="ar" dir="rtl">`, and the main content's computed `direction` is `rtl`. en and fr are `ltr`.
  5. **Keyboard.** Using only `Tab`/`Shift+Tab`/`Enter`/`Space`, a user reaches and activates the start-over and confirm controls. After each screen change, focus is inside the new screen, not on `body`.
  6. **Reduced motion.** With `reducedMotion: 'reduce'`, the computed `scroll-behavior` of `html` is `auto`. With `no-preference`, it is `smooth`.
  7. **No JavaScript.** With `javaScriptEnabled: false`, `/ar/interview/` and `/en/interview/` show the translated noscript message.
  8. **Accessibility.** An axe scan of `/ar/` and `/en/` landing and the started interview screen finds no `serious` or `critical` violations.
- `.gitignore` ignores `web/test-results/`, `web/playwright-report/` and `web/blob-report/`. `npm run lint` and `npm run typecheck` pass with the new files included.
- CI (`.github/workflows/django.yml`, `web` job): after the build/export check, run `npx playwright install --with-deps chromium` and then `npm run test:e2e`. Raise the job timeout if needed. Upload `web/playwright-report` on failure only if a pinned `actions/upload-artifact` SHA already exists in the repo's workflows; otherwise skip the upload.
- Remove the spec-1-1 browser-test release-blocker entry from deferred-work.md.

**Block If:**
- A required behavior in the list above is actually broken in the app, so the test cannot pass without a product change beyond a trivial markup fix.
- An axe `serious`/`critical` violation needs more than a trivial attribute or markup fix. Then exclude only that rule for that page with a comment, add a deferred-work entry naming it, and continue. Block only if more than three such rules are needed.

**Never:**
- No change to product behavior, user-facing text or translations.
- No tests for the tree (1.4), share preview (1.5) or add form (1.6) entries beyond what the scenarios above touch; those entries stay in deferred-work.md.
- No Firefox/WebKit, no visual snapshots, no `next dev` server for the tests, no running Django.
- The static server must not reimplement the Django CSP.

</intent-contract>

## Code Map

- `web/package.json` -- scripts and exact-pinned devDependencies; `"test"` covers only `src/**/*.test.{ts,tsx}` (node --test), so `e2e/*.spec.ts` will not be picked up by it.
- `web/next.config.ts:4-31` -- `output: "export"`, `trailingSlash: true`, no basePath; the dev-only `/api` rewrite.
- `web/scripts/check-export.mjs:12-18` -- export layout; no root `index.html` (Django redirects `/`).
- `web/src/app/[locale]/layout.tsx:14` -- `<html lang dir>` per locale.
- `web/src/app/[locale]/site-nav.tsx:24` -- navbar session probe (GET `/api/v1/session/`); `use-session.ts:7` -- auth states.
- `web/src/app/[locale]/page.tsx:37`, `landing-redirect.tsx:13` -- landing CTA to `/{locale}/interview/`; an authenticated visitor is redirected to cases.
- `web/src/app/[locale]/interview/start-case.tsx:188-226,328+` -- StartCase views (loading/starting, expired/new, existing, confirmation, started, throttled, failed), focus handling, reduced-motion scroll.
- `web/src/interview/flow.ts:175,593` -- start/replace logic (auto-start for a new visitor, `{"replace":true,"case_id":…}`; 409 means an existing case, 429 means throttled); the expiry/"seen" logic decides the expired state.
- `web/src/api/case.ts:202,306,364,405` -- case parser (minimal case: string `id`, `started_at`), CSRF read from the `csrftoken` cookie and sent as `X-CSRFToken`, write calls.
- `web/src/api/session.ts:26` -- `probeSession`: one attempt, 10 s timeout.
- `web/src/app/[locale]/globals.css:33` -- `scroll-behavior: smooth`, `auto` under reduced motion.
- `web/src/app/[locale]/interview/page.tsx:21` -- `<noscript>` fallback and the `[data-js-only]` hiding.
- `web/tsconfig.json:29`, `web/eslint.config.mjs:5` -- include/ignore patterns; the new files are linted and type-checked.
- `.github/workflows/django.yml:256-292` -- `web` job (Ubuntu, Node from `web/.nvmrc`, ci/lint/typecheck/test/build/check-export).
- `_bmad-output/implementation-artifacts/deferred-work.md` -- the "Add browser-level tests for the Next.js `/{lang}/…` routes…" entry to remove.

## Tasks & Acceptance

**Execution:**
- `web/package.json`, `web/package-lock.json` -- add the devDependencies and the `test:e2e` script.
- `web/playwright.config.ts` -- Chromium project, `webServer` running `node e2e/serve.mjs`, `baseURL`, `forbidOnly` and `retries: 0` in CI, `trace: 'retain-on-failure'`.
- `web/e2e/serve.mjs` -- the static server described above.
- `web/e2e/api.ts` -- route stubs, a request counter helper and a fail-on-unstubbed-API guard.
- `web/e2e/landing.spec.ts`, `web/e2e/interview.spec.ts`, `web/e2e/accessibility.spec.ts` -- scenarios 1–8.
- `.gitignore` (or `web/.gitignore`) -- Playwright output dirs.
- `.github/workflows/django.yml` -- browser install and the `test:e2e` step in the `web` job.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- remove the resolved entry; add any axe rule exclusions as new entries.

**Acceptance Criteria:**
- Given a fresh `npm ci && npm run build` in `web/`, when `npx playwright install chromium && npm run test:e2e` runs, then every scenario 1–8 passes and none is skipped.
- Given the app's no-retry logic were changed to retry automatically after a failed POST, when the suite runs, then scenario 3 fails. Check this once by temporarily breaking it locally, then revert, and record the result.

## Spec Change Log

## Review Triage Log

### 2026-11-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 1: (high 0, medium 1, low 0)
- reject: 55: (high 0, medium 4, low 51)
- addressed_findings:
  - `[low]` `[patch]` The CI report upload ran only on `failure()` and left out the traces in `test-results/`. Now it runs when the job has not succeeded and was not cancelled, and uploads both `web/playwright-report` and `web/test-results`.
  - `[low]` `[patch]` `serve.mjs` started on a missing export and gave 404s and an opaque timeout. Now it exits with "Run `npm run build` before `npm run test:e2e`".

## Auto Run Result

**Summary:** Added a Playwright (Chromium) browser suite for the Next.js routes. It runs against the real static export, served by a Node-built-ins static server, with every `/api/v1/` call stubbed and any unstubbed API call failing the test. It has 39 tests across hydration, rendered start-case states, no-retry, RTL, keyboard, reduced motion, the JavaScript-disabled fallback and axe (no serious or critical violations). CI's `web` job installs Chromium and runs it after the build. The spec-1-1 browser-test release blocker is closed.

**Files changed:**
- `web/package.json`, `web/package-lock.json` -- `@playwright/test` 1.64.1 and `@axe-core/playwright` 4.14.0 (exact; the newest at least 14 days old), `test:e2e` script, and an `overrides` pin of `playwright-core` 1.64.1 so that axe does not pull a second copy, which broke type-checking.
- `web/playwright.config.ts` -- Chromium project, webServer on port 4173, `retries: 0` and `forbidOnly` in CI, traces kept on failure.
- `web/e2e/serve.mjs` -- static server: directory index, 308 to the trailing slash, real 404s, traversal rejection, and a clear exit when `web/out` is missing.
- `web/e2e/api.ts` -- route stubs, request counters, CSRF cookie, unstubbed-request guard.
- `web/e2e/landing.spec.ts`, `web/e2e/interview.spec.ts`, `web/e2e/accessibility.spec.ts` -- scenarios 1–8.
- `.gitignore` -- Playwright output directories.
- `.github/workflows/django.yml` -- browser install, `npm run test:e2e` and a report/trace upload when the job does not succeed; timeout raised from 15 to 25 minutes.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- removed the browser-test release blocker; added the CSP-under-browser follow-up.

**Review findings:** 2 patches applied (both low), 1 deferred (medium: no browser check under the production CSP), 55 rejected. The rejected findings, with reasons:
- Fixed 3 s waits and the trailing `**/api/**` glob: the spec mandated the 3 s check, and no asset path contains `/api/`.
- A hand-copied `mawareeth.case-seen` key: the app does not export it, and the spec forbids product changes.
- Firefox, WebKit, mobile viewports and additional pages: outside the spec.
- A real-backend contract test: the spec rules out running Django.
- The `playwright-core` override: it is required.
- The removed backlog entry's "more once 1.2/1.3 add content": Stories 1.2 and 1.3 are done, and the started interview screen is covered.

**Follow-up review recommendation:** false. Patched: high 0, medium 0, low 2. Score 2.

**Verification:**
- In `web/`: `npm run lint` (0 errors, 10 existing warnings), `npm run typecheck`, `npm test` (461 pass), `npm run build`, and `npx playwright test` (39 passed, about 20 s; rerun after the patches, 39 passed).
- The implementer's mutation check: a temporary auto-retry 500 ms after a failure made "a failed POST is not repeated" fail with 6 POSTs. The change was reverted, the export rebuilt and the suite passed again.
- No serious or critical axe violations, so there are no rule exclusions.

**Residual risks:**
- The new CI steps (`--with-deps` install, report upload) have not run on GitHub Actions yet.
- Hydration under the production CSP is untested in a browser (deferred).
- Stubbed responses can drift from the real Django contracts.

## Verification

**Commands:**
- `cd web && npm run lint && npm run typecheck && npm test` -- expected: pass.
- `cd web && npm run build && npx playwright install chromium && npm run test:e2e` -- expected: all browser tests pass.
