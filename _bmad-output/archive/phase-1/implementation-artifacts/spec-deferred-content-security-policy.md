---
title: 'Content-Security-Policy for the Next.js export'
type: 'feature'
created: '2026-11-13'
status: 'done'
baseline_revision: 'b238b2cf50f882d666fffa4b8b0f2697cf7750a5'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** The Next.js pages served from `/{lang}/…` have no Content-Security-Policy. This is a release blocker in deferred-work.md ("Interview & web UI", from spec-1-1 and spec-nextjs-drf-foundation). The export is static HTML that Django's WhiteNoise serves (`output: "export"`, no Node server), so a per-request nonce is impossible. Each page also carries release-specific inline scripts (`self.__next_f.push(...)`, `<script id="_R_">`).

**Approach:** In `add_web_headers`, give every exported `.html` file an enforced CSP whose `script-src` is `'self'` plus the SHA-256 hashes of that file's own inline executable scripts. The hashes are computed from the file at `path` when WhiteNoise builds its header table. There is no `'unsafe-inline'` for scripts. Other directives are fixed.

## Boundaries & Constraints

**Always:**
- Header `Content-Security-Policy` (enforced, not Report-Only) on every export HTML response (the URL ends in `/` or `.html` and is not under `/static/` or `/_next/static/`), with exactly these directives in this order:
  `default-src 'self'; script-src 'self' <hashes>; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' https://www.facebook.com https://www.linkedin.com`
  `<hashes>` is the space-separated `'sha256-<base64>'` of each distinct inline script in the file, in document order, deduplicated. With none, `script-src 'self'` alone.
- Inline executable scripts are `<script>` elements without `src` whose `type` is absent, empty, `text/javascript`, or `module`. Data blocks (`application/ld+json`, `application/json`) are not hashed. The hash covers the element's raw text exactly as written between the tags (UTF-8, no trimming or entity decoding), which is what browsers hash.
- `style-src 'unsafe-inline'` is deliberate: the export contains `style="…"` attributes (family tree, table virtualizer) and `<noscript><style>` blocks that React hydration does not re-apply.
- `form-action` lists the Facebook and LinkedIn origins because the social-login forms POST to `/social-auth/login/…`, which redirects there, and Chrome applies `form-action` to redirects.
- Existing headers (`X-Frame-Options`, `Cache-Control`, `X-Robots-Tag`) are unchanged. Non-HTML export files (`robots.txt`, `sitemap.xml`, `llms.txt`, `.txt` RSC payloads, `/_next/static/` assets) and `/static/` get no CSP.
- If `path` cannot be read, the page still gets the CSP with `script-src 'self'` (fail closed: inline scripts blocked) and nothing raises.
- Record in deferred-work.md that social login (Facebook, LinkedIn) must be exercised live under the new `form-action` on the deployed stack. Remove the CSP release-blocker entry.

**Block If:**
- Producing a correct page needs `'unsafe-inline'` or `'unsafe-eval'` in `script-src`.
- A headless-browser check of the built export shows CSP violations that the directives above cannot fix without widening `default-src`.

**Never:**
- No CSP for Django-rendered pages (legacy calc pages, admin, profile, social-auth). They are being retired (deferred item, order 6 of 6).
- No `django-csp` or other new dependency. No Caddy header changes. No Next.js config or source changes.
- No per-request work: hashes come from WhiteNoise's one-time header computation.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Page with inline scripts | `en/interview/index.html` containing two inline scripts, one `src` script, one `application/ld+json` block | `script-src 'self' 'sha256-A' 'sha256-B'` (only the two inline executable ones, document order) | No error expected |
| Duplicate inline script | the same inline body twice | its hash appears once | No error expected |
| Page without inline scripts | `<html></html>` | `script-src 'self'` exactly | No error expected |
| Both URL forms | `/en/about/` and `/en/about/index.html` (same path) | identical CSP | No error expected |
| Non-HTML / static | `/robots.txt`, `/_next/static/chunks/x.js`, `/static/calc/css/content.css` | no `Content-Security-Policy` key | No error expected |
| Unreadable path | `path` does not exist | CSP with `script-src 'self'` | no exception |
| Non-ASCII script | inline script containing Arabic text | hash of its UTF-8 bytes | No error expected |

</intent-contract>

## Code Map

- `mawareeth/web_headers.py` -- `add_web_headers(headers, path, url)`: WhiteNoise's `WHITENOISE_ADD_HEADERS_FUNCTION`. It is called once per file and URL form when WhiteNoise indexes `WHITENOISE_ROOT`, and `path` is the file on disk. It returns early for `/static/` and `/_next/static/`. Add CSP building here; a module-level helper may parse with `html.parser.HTMLParser`, using `convert_charrefs=False` and collecting raw `handle_data` inside `<script>`.
- `mawareeth/settings.py:316-323` -- `WEB_DIST_DIR`/`WHITENOISE_ROOT`/`WHITENOISE_ADD_HEADERS_FUNCTION` wiring (read-only).
- `mawareeth/settings.py:383-393` -- existing Referrer-Policy, nosniff, HSTS and social backends (Facebook, LinkedIn OIDC, Instagram) (read-only).
- `mawareeth/tests.py:446-540` -- `WebExportTests`: builds a stand-in export in a temp dir with `override_settings(WHITENOISE_ROOT=root)`; `test_header_rules_handle_both_url_forms_and_leave_static_alone` calls `add_web_headers(headers, "unused", url)` and asserts exact dicts. Update those exact dicts (the "unused" path means unreadable, so `script-src 'self'`) and extend the fixture pages with inline scripts.
- `web/src/app/[locale]/auth-form.tsx:109` -- social forms POST to same-origin `/social-auth/login/{facebook,linkedin-openidconnect}/` (read-only).
- `web/src/app/[locale]/json-ld.tsx:4` -- JSON-LD via `dangerouslySetInnerHTML` (`type="application/ld+json"`, must not be hashed) (read-only).
- `web/out/` -- an existing local export (may be stale); `cd web && npm run build` regenerates it.
- `_bmad-output/implementation-artifacts/deferred-work.md:200-202` -- the CSP release-blocker entry to remove; add the social-login live-check entry under "Edge / Cloudflare" or "Django / API".

## Tasks & Acceptance

**Execution:**
- `mawareeth/web_headers.py` -- add the inline-script hasher and set `Content-Security-Policy` on export HTML as specified -- the policy itself.
- `mawareeth/tests.py` -- extend `WebExportTests`: write fixture pages with inline scripts (ASCII and Arabic), a `src` script, a JSON-LD block and a duplicate; assert the exact header over HTTP for both URL forms; assert no CSP on txt/asset/static; unit-test `add_web_headers` with a missing path; compute expected hashes independently in the test with `hashlib`/`base64` on the literal script text -- cover the I/O matrix.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- remove the CSP entry; add the social-login `form-action` live-check entry -- backlog accuracy.

**Acceptance Criteria:**
- Given the real built export (`web/out`, rebuilt with `npm run build`) served by Django with `WHITENOISE_ROOT` pointing at it, when `/en/`, `/ar/interview/` and `/fr/results/` are loaded in headless Chrome or Edge, then the console shows no "Content Security Policy" violation and the page hydrates (interactive content replaces the noscript fallback).
- Given any export HTML file, when its CSP is read, then every inline executable script in that file is allowed by hash and nothing else inline is.

## Spec Change Log

## Review Triage Log

### 2026-11-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 1, low 2)
- defer: 0
- reject: 45: (high 0, medium 3, low 42)
- addressed_findings:
  - `[medium]` `[patch]` Browsers hash an inline script's parsed text, in which HTML parsing has turned CRLF and lone CR into LF. The file was read with `newline=''`, so a CRLF export would get hashes that never match. Fixed: script text is normalised to LF before hashing; new test `test_crlf_and_lone_cr_are_hashed_as_lf_like_browsers`.
  - `[low]` `[patch]` The fail-closed branch was silent, and its decode-error path was untested. Fixed: `logger.warning` with `exc_info`; `test_unreadable_path_fails_closed` now covers a missing file and an undecodable file and asserts the warning.
  - `[low]` `[patch]` The `text/javascript` type and the strip/lowercase normalisation of `type` were unpinned. Fixed: the fixture has `type="text/javascript"` and `type=" Module "` scripts and the expected hash list includes them.

## Auto Run Result

**Summary:** Every HTML page of the Next.js export now carries an enforced Content-Security-Policy. Its `script-src` is `'self'` plus the SHA-256 of that page's own inline scripts, computed by WhiteNoise's one-time header pass, with no `'unsafe-inline'` or `'unsafe-eval'` for scripts. The other directives are fixed: `style-src 'self' 'unsafe-inline'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, and `form-action 'self'` plus Facebook and LinkedIn for social login. The CSP release blocker is closed.

**Files changed:**
- `mawareeth/web_headers.py` -- inline-script collector (`HTMLParser`, raw text), hashes normalised to LF, CSP on URLs ending `/` or `.html`; fail closed with a logged warning.
- `mawareeth/tests.py` -- `WebExportTests` fixtures with inline, `src`, JSON-LD, duplicate, typed, CRLF and undecodable scripts; exact-header tests; no CSP on txt/xml/assets.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- removed the CSP release blocker; added a live social-login check under the new `form-action`.

**Review findings:** 3 patches applied (1 medium, 2 low), 0 deferred, 45 rejected. The rejected findings, with reasons:
- Other JavaScript MIME types, event-handler attributes, `<base>` and import maps: the real export emits none (checked in `web/out`).
- A CSP on the site-root redirect: it has no document.
- Django-rendered pages: excluded by the spec, and being retired.
- Report-Only or reporting: the spec chose enforcement.
- Stale hashes: every blue/green deploy starts new containers, so WhiteNoise re-indexes.
- Wider `form-action` hosts: tracked by the live social-login check.

While patching, the new CRLF test's direct `response.close()` fired `request_finished`, which closed the test transaction's DB connection and made `test_existing_routes_still_respond` return 503. The test now consumes the response instead.

**Follow-up review recommendation:** true. Patched: high 0, medium 1, low 2; score 3×1 + 2 = 5.

**Verification:**
- `uv run python manage.py test mawareeth --noinput`: 101 tests, OK.
- The implementer built the export with `cd web && npm run build` and served `web/out` through Django `runserver`.
- It then loaded `/en/`, `/ar/interview/` and `/fr/results/` in headless Edge (`--enable-logging=stderr --v=0 --virtual-time-budget=8000 --dump-dom`). There were zero CSP or "Refused" messages. `/ar/interview/` hydrated, with form controls absent from the static HTML. `/en/` carried three script hashes.
- The browser check ran before the LF normalisation patch. The export uses LF line endings, so the hashes are unchanged.

**Residual risks:**
- Facebook and LinkedIn sign-in under `form-action` are untested until the live check (now in deferred-work.md).
- Hydration of `/en/` and `/fr/results/` was confirmed only by the absence of CSP errors.
- Every `WebExportTests` setUp logs one expected warning traceback for the undecodable fixture.

## Verification

**Commands:**
- `uv run python manage.py test mawareeth --noinput` -- expected: all pass (Postgres on localhost:5432).
- `cd web && npm run build` -- expected: export succeeds into `web/out`.

**Manual checks (if no CLI):**
- Serve `web/out` through Django (for example `WEB_DIST_DIR` symlink/copy to `web-dist` and `uv run python manage.py runserver`, with DEBUG settings that allow http) and open the three pages above in headless Edge/Chrome with `--enable-logging=stderr --v=0`. Expect no "Refused to execute inline script" or other CSP messages, and the hydrated content present in `--dump-dom` output. Record the exact commands and outcome in the Auto Run Result; if no browser binary is available, say so explicitly.
