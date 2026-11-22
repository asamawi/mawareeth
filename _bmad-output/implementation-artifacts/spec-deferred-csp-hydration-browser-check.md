---
title: 'Browser hydration check under the production Content-Security-Policy'
type: 'chore'
created: '2026-11-22'
status: 'done'
baseline_revision: '0f2cfd8e1cf94b564fe48a600e122b2f8e16b216'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The Playwright suite serves `web/out` with a plain Node server that sends no CSP, so a hash mismatch that blocks Next's inline bootstrap scripts under the hash-based CSP from `mawareeth/web_headers.py` would pass every automated test while breaking hydration in production (deferred-work item from `spec-deferred-browser-tests.md`).

**Approach:** Let the e2e static server optionally send, for each exported HTML page, exactly the headers that `mawareeth.web_headers.add_web_headers` computes (via a small Python helper, so the CSP has one source of truth), and add a Playwright project that loads every exported page under that CSP and fails on any CSP violation or missing hydration.

## Boundaries & Constraints

**Always:** The CSP sent in the test comes from `mawareeth/web_headers.py` itself (`add_web_headers` or `content_security_policy`), never from a JS re-implementation. The existing `chromium` project keeps running without CSP, unchanged. The helper uses only the standard library plus repo modules (`mawareeth.web_headers`, `i18n`, `engine.contracts`), with no Django setup, so it runs under CI's system `python3` in the `web` job. If the helper fails or returns no pages, the CSP server exits non-zero (the test must not silently run without CSP). Python interpreter: `E2E_PYTHON` env var, defaulting to `python` on Windows and `python3` elsewhere.

**Never:** No change to `mawareeth/web_headers.py` behaviour or the CSP itself. No change to app source under `web/src`, to user-facing text, or to translations. No new npm or Python dependencies. No Django/WhiteNoise server in the test path.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | Every `*.html` page of `web/out` (45 today: 15 pages x ar/en/fr) loaded at its directory URL under the CSP server | Response carries a `Content-Security-Policy` header whose `script-src` holds at least one `'sha256-` token; the page hydrates (its `/api/session/` probe is requested); zero `securitypolicyviolation` events and zero console messages mentioning "Content Security Policy" | n/a |
| CANARY | On a loaded page, the test injects an inline `<script>` element | One `securitypolicyviolation` (directive `script-src` / `script-src-elem`) is recorded, proving the detector and the header work | Test fails if none is recorded |
| HELPER_FAILS | Python missing, import error, or empty `web/out` | CSP server prints the reason and exits non-zero, so Playwright's webServer fails to start | n/a |
| API_CALLS | Pages call `/api/...` endpoints other than session | Session answers `{"authenticated": false}`; every other `/api/` request answers JSON 404; 404 console noise is ignored (only CSP-related console text counts) | n/a |

</intent-contract>

## Code Map

- `mawareeth/web_headers.py` -- READ-ONLY source of truth. `add_web_headers(headers, path, url)` sets `X-Frame-Options`, `Cache-Control`, `X-Robots-Tag` and, for URLs ending `/` or `.html`, `Content-Security-Policy = content_security_policy(path)` (hashes every inline executable script, CRLF-normalised). WhiteNoise calls it with both `/en/` and `/en/index.html` URL forms. Importable without Django (checked: `uv run python -c "import mawareeth.web_headers"` works).
- `web/e2e/serve.mjs` -- node-only static server for `web/out` (`dir/` -> `dir/index.html`, 308 to add slash, real 404). Reads `E2E_PORT`. Extend: when `E2E_CSP=1`, at startup run the helper once (`spawnSync`), parse its JSON `{url: {header: value}}`, and add those headers to the matching HTML response (key by the request pathname, e.g. `/en/` or `/en/index.html`).
- `web/playwright.config.ts` -- one `chromium` project + one `webServer` on 4173. Add a second webServer (port 4174, `E2E_CSP=1`) and a `csp` project with `baseURL` on 4174 and `testMatch: "csp.spec.ts"`; make the `chromium` project ignore `csp.spec.ts`. `webServer` accepts an array.
- `web/e2e/api.ts` -- `Api` fixture fails tests on unstubbed `/api/` requests; the CSP spec should NOT use it (pages vary in API calls); use `@playwright/test` directly with its own `page.route("**/api/**")`.
- `web/e2e/landing.spec.ts:1-17` -- existing hydration pattern (session probe count > 0 proves hydration).
- `.github/workflows/django.yml:273-330` -- `web` job (ubuntu-latest, has system `python3`); `npm run test:e2e` runs all projects, so the new project runs in CI with no workflow change unless the checkout lacks something the helper needs (it has the full repo).

## Tasks & Acceptance

**Execution:**
- `web/e2e/csp_headers.py` -- new helper: insert the repo root (two parents up) at the front of `sys.path`, walk the export dir given as argv[1], and for each `*.html` file call `add_web_headers` for both URL forms (`/<dir>/` and `/<dir>/index.html`); print one JSON object to stdout; exit 1 with a stderr message if no HTML file is found -- single source of truth for headers.
- `web/e2e/serve.mjs` -- add the optional `E2E_CSP=1` mode described in the Code Map; on helper failure (non-zero exit, unparseable JSON, empty map) print the reason and `process.exit(1)`; update the header comment -- serve production headers in the test.
- `web/playwright.config.ts` -- add the `csp` project and second webServer as described -- run the new spec under CSP without touching the existing project.
- `web/e2e/csp.spec.ts` -- new spec: derive the page list by walking `web/out` for `index.html` files (node:fs) and assert the list is non-empty; for each page, one test that installs a `securitypolicyviolation` collector via `page.addInitScript`, records CSP-related console messages and `pageerror`s, routes `/api/session/` to anonymous and other `/api/` to JSON 404, navigates, asserts the CSP header with a `'sha256-` token, waits (`expect.poll`) for the session request, then asserts no violations, no CSP console text and no page errors; plus the CANARY test on `/en/`.

**Acceptance Criteria:**
- Given a fresh `npm run build`, when `npm run test:e2e` runs, then both the `chromium` and `csp` projects pass, and the `csp` project ran one test per exported page plus the canary.
- Given the CSP server, when a page's inline script hash is not in its CSP (simulated by the canary's injected inline script), then the spec records a violation, so a real hash mismatch would fail the suite.
- Given `E2E_PYTHON` points at a missing interpreter, when `E2E_CSP=1 node e2e/serve.mjs` starts, then it exits non-zero with a message naming the failure.

## Spec Change Log

## Review Triage Log

### 2026-11-22 — Review pass
- verdicts: 20 findings — high 0, medium 0, low 13, false 7, maybe-false 0
- findings:
  - `[low]` `[reject]` blind: discovery visits only `index.html` pages, so a future standalone HTML (e.g. `404.html`) would be unchecked — no such page exists in today's export (all 45 are `index.html`); adds discovery branches for a hypothetical page.
  - `[false]` `[reject]` blind: session request counted before the route's UI is usable — the probe is a client effect from the navbar, so it only fires after hydration; that is the hydration signal the spec chose.
  - `[low]` `[reject]` blind: a deferred-effect CSP violation could arrive after the assertions — unlikely for Next bootstrap scripts (they run before hydration, which precedes the probe); a settle milestone adds complexity.
  - `[low]` `[patch]` blind: canary never confirms the injected script was blocked — now also asserts `window.__canary` is undefined.
  - `[low]` `[reject]` blind: the CSP webServer starts even for a chromium-only run — developers of this Django repo have Python; scoping webServers per project adds config branching.
  - `[low]` `[reject]` edge: missing export aborts collection with a raw ENOENT — loud failure; serve.mjs already prints the `npm run build` prerequisite.
  - `[false]` `[reject]` edge: directory names with `#`/`?`/`%` — export directory names are fixed route slugs; unreachable.
  - `[false]` `[reject]` edge: `os.walk` swallows errors giving a partial map — a page missing headers then fails its own `'sha256-` assertion, so nothing passes silently.
  - `[false]` `[reject]` edge: helper emits an array or malformed values — the helper is repo code that always emits a URL-keyed dict.
  - `[false]` `[reject]` edge: duplicate-separator URLs get HTML without CSP — no test requests such URLs; test-only server.
  - `[low]` `[reject]` edge: a hung interpreter blocks startup — Playwright's webServer timeout fails the run.
  - `[low]` `[reject]` edge: a reused CSP server goes stale after a rebuild — locally only (CI never reuses), and stale hashes make tests fail loudly rather than pass.
  - `[low]` `[reject]` edge: deferred violation after assertions — same as the blind-hunter row above.
  - `[low]` `[reject]` edge: CSP server starts for a chromium-only run — same as the blind-hunter row above.
  - `[low]` `[reject]` edge: standalone HTML pages not visited — same as the blind-hunter row above.
  - `[false]` `[reject]` edge: the spec's matrix names `/api/session/` while code mocks `/api/v1/session/` — the code is correct (the app calls `/api/v1/session/`); the fix would edit this spec.
  - `[low]` `[reject]` verification-gap: no full-policy parity check of the forwarded header — the server forwards the helper's dict unchanged and the helper calls `add_web_headers`; the policy text is pinned by `mawareeth/tests.py`.
  - `[low]` `[patch]` verification-gap: explicit `/en/index.html` URL not checked — added a test asserting its CSP holds a `'sha256-` token.
  - `[low]` `[patch]` verification-gap (other): `web/README.md` does not say browser tests need Python — added one sentence.
  - `[false]` `[reject]` intent-alignment: Node serving vs Django/WhiteNoise reading — the deferred item explicitly allows sending the CSP computed by `mawareeth/web_headers.py`.

## Design Notes

A page that hydrates requests `/api/session/` from the navbar (`web/src/app/[locale]/site-nav.tsx`, `use-session.ts`); if a page turns out not to probe the session, wait for `load` plus a React-owned signal on that page instead, and note it in the spec. Next's inline scripts are what the hashes guard: if they were blocked, hydration would not happen and the browser would fire `securitypolicyviolation`, so both checks are kept.

## Verification

**Commands:**
- `cd web && npm run build` -- expected: export built
- `cd web && npm run lint && npm run typecheck` -- expected: no errors
- `cd web && npm run test:e2e` -- expected: all tests pass in both projects (local Windows run: `E2E_PYTHON` unset uses `python`)
- `cd web && E2E_CSP=1 E2E_PYTHON=no-such-python node e2e/serve.mjs` -- expected: non-zero exit with a clear message

## Auto Run Result

- Summary: the Playwright suite gains a `csp` project that serves `web/out` with the headers `mawareeth.web_headers.add_web_headers` computes and loads every exported page, failing on a CSP violation, CSP console text, a page error, or missing hydration (session probe). A canary proves blocked inline scripts are detected.
- Files: `web/e2e/csp_headers.py` (new helper printing production headers per page as JSON); `web/e2e/serve.mjs` (`E2E_CSP=1` mode, fails closed); `web/playwright.config.ts` (`csp` project + second webServer on 4174); `web/e2e/csp.spec.ts` (new spec); `web/README.md` (Python note).
- Review: 20 findings; 3 low patched (canary asserts the script never ran, explicit `/en/index.html` CSP test, README note); 0 deferred; 17 rejected with reasons in the triage log.
- Follow-up review recommended: false (patched: high 0, medium 0, low 3).
- Verification: fresh `npm run build`; `npm run typecheck` ok; eslint on changed files clean; `npx playwright test` 194 passed (chromium unchanged + 48 csp); `E2E_CSP=1 E2E_PYTHON=no-such-python node e2e/serve.mjs` exits 1 with a clear message. Parent fix during verification: the implementer's first run used a stale export and matched `/api/session/`; corrected to `/api/v1/session/`.
- Residual risks: not yet run in CI (needs system `python3` in the `web` job, present on ubuntu-latest). A locally reused CSP server keeps headers from its start, so restart it after a rebuild.
