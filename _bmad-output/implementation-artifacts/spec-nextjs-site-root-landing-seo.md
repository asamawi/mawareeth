---
title: 'Next.js at the site root: landing, about, terms and privacy pages with SEO'
type: 'feature'
created: '2026-11-13'
status: 'done'
baseline_commit: 'db2d1a43c7f07ce57520a19b648761a3b0d5ceb6'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/web/AGENTS.md'
  - '{project-root}/.claude/skills/ui-ux-pro-max/SKILL.md'
warnings: ['oversized', 'multiple-goals']
deferred:
  - summary: >-
      Update or keep noindex on the ported terms and privacy pages, which now appear in the sitemap and llms.txt with known defects.
    evidence: |-
      Ported verbatim as the spec required: typos ("webste", "www.website.com"), advertising and Google DART cookie sections the site does not use, Netherlands law, a non-existent Comments feature, and no mention of accounts, sharing or email. Indexing makes them more visible than before; the deferred-work entry for updating them is the fix.
    location: >-
      web/src/i18n (terms, privacy text)
    severity: medium
  - summary: >-
      api.tests.InterviewAnswerTests.test_edit_heir_keeps_id_and_place_and_derives_gender_again fails on the baseline: it does not expect the edit_options key added by 5cc435d.
    evidence: |-
      Reproduced in this run; the test's expected dict lacks edit_options, while api/anonymous_case.py:268 adds it; this change does not touch that code.
    location: >-
      api/tests.py:811
    severity: low
  - summary: >-
      Extend the deploy smoke test to check /robots.txt, /sitemap.xml, /llms.txt, /ar/about/, the / language redirect and the /app/ar/ legacy redirect on the built image.
    evidence: |-
      The smoke only fetches /ar/ and one asset; the root files and redirects are covered by Django tests with a stand-in export and by check-export at build time only.
    location: >-
      .github/workflows/deploy.yml
    severity: low
  - summary: >-
      Tie the public-page lists together (web/src/seo/site.ts publicPages, mawareeth/web_headers.py PUBLIC_PAGES, check-export.mjs pages) so a new public page cannot be in the sitemap while Django still sends noindex.
    evidence: |-
      Three hand-maintained copies; no test compares them.
    location: >-
      mawareeth/web_headers.py
    severity: low
---

<intent-contract>

## Intent

**Problem:** The Next.js app lives under `/app/`, while Django still renders the public landing, about, terms and privacy pages at `/{lang}/…` with old Bootstrap templates. Nothing on the site is set up for search or AI-search engines (deferred-work.md, "Product scope / future epics", order 3 of 6).

**Approach:** The owner decided on 2026-11-13 to:
1. Drop the `/app` basePath and serve the whole Next.js export from the site root (`/{lang}/…`). Old `/app/…` URLs redirect to the same path without the prefix.
2. Rebuild the landing, about, terms and privacy pages in Next.js, designed with the ui-ux-pro-max skill, and send signed-in visitors on the landing page to My saved cases.
3. Draft all the landing, about and FAQ content in ar/en/fr, and add SEO/AEO: metadata, the canonical `https://www.mawareeth.com`, hreflang, `robots.txt`, `sitemap.xml`, JSON-LD and `llms.txt`.

## Boundaries & Constraints

**Always:**
- **Static export only.** Keep `output: "export"` and `trailingSlash: true`, and remove `basePath`. WhiteNoise keeps serving the export ahead of Django's URL routing, with `WHITENOISE_ROOT = web-dist`, which now holds the export directly.
- **Root redirect.** `/` stays a language redirect: cookie, then Accept-Language, then `ar`. It keeps the query string, is not cached, and varies on Cookie and Accept-Language.
- **Legacy `/app/` redirects.** Every `/app/<rest>` request redirects with a 302 (not 301, so a rollback of the release stays safe) to `/<rest>`, keeping the query string. The bare `/app/` uses the same language redirect as `/`. The Location must start with exactly one `/`: `/app//evil.com` must never produce `//evil.com`.
- **Indexing.** Only `/{lang}/`, `/{lang}/about/`, `/{lang}/terms/`, `/{lang}/privacy/`, `/robots.txt`, `/sitemap.xml` and `/llms.txt` are indexable. Every other export page keeps `X-Robots-Tag: noindex` and a robots `noindex` meta tag.
- **Unchanged export headers.** Every export file keeps `X-Frame-Options: DENY`. Pages keep `Cache-Control: no-cache`, and `/_next/static/` keeps `public, max-age=31536000, immutable`. `/static/` (Django collectstatic) is left alone.
- **Landing redirect.** On the landing page, a visitor whose session check says authenticated is sent with `location.replace` to `/{lang}/cases/`. Anonymous visitors, and visitors whose check failed, stay on the landing page.
- **Canonical URLs.** Each public page has a canonical `https://www.mawareeth.com/{lang}/…/` URL and hreflang alternates for ar, en and fr. `x-default` points to `https://www.mawareeth.com/`.
- **Structured data.** The JSON-LD is Organization plus WebApplication on the landing page, and FAQPage only where the same questions and answers are visible on that page. Escape `<` in the serialized JSON.
- **Text and translations.** All new text goes in `web/src/i18n/messages.ts` in ar, en and fr, with Arabic RTL. Content states only what the product does today: the Hanafi, Maliki, Shafi'i and Hanbali schools (no Jafari), successive deaths, step-by-step proof with citations, the draft PDF report, and saving and sharing with an account. It says the result is not a fatwa or legal advice. Record every new string for native and fiqh review in `deferred-work.md`.
- **Terms and privacy.** Port the wording of the Django terms and privacy pages faithfully, using their existing `.po` msgstrs for ar and fr. Where a msgstr is empty, draft one and record it for review.

**Block If:** A Next.js page route would need a server runtime, or would collide with a Django route that must keep working, such as `/{lang}/calc/`, `/{lang}/<pk>/…`, `/{lang}/new/`, `/{lang}/profile/` or `/{lang}/admin/`.

**Never:**
- No Next.js server or middleware runtime, and no Caddy changes.
- Don't change the meaning of the terms or privacy text.
- Don't change existing ar/en/fr strings in `messages.ts` or `.po` msgstrs, except to copy them.
- Don't retire the other legacy Django pages: calc form, detail, results, delete, profile and error stay (order 6 of 6).
- Don't claim features the engine refuses, such as Jafari or the Maliki Malikiyya case.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Root redirect | `GET /?utm=x`, Accept-Language `fr` | 302 to `/fr/?utm=x`, `no-store`, Vary Cookie, Accept-Language | Unsupported language → `/ar/` |
| Legacy deep link | `GET /app/en/password-reset/confirm/?uid=a&token=b` | 302 to `/en/password-reset/confirm/?uid=a&token=b` | None |
| Legacy bare prefix | `GET /app/` with an `en` language cookie | 302 to `/en/` | None |
| Open-redirect attempt | `GET /app//evil.com/` | Location is a same-site path starting with one `/` (`/evil.com/`) | Never `//…` |
| Public page indexable | `GET /en/about/` with the export present | 200, no `X-Robots-Tag`, `X-Frame-Options: DENY`, `no-cache` | None |
| Private page not indexable | `GET /en/interview/` with the export present | 200 with `X-Robots-Tag: noindex` | None |
| Hashed asset | `GET /_next/static/chunks/x.js` | `immutable`, one year | Missing → 404 |
| Export absent (dev/tests) | `WHITENOISE_ROOT=None`, `GET /ar/` | 404; `/` and `/app/…` still redirect; the API still answers | None |
| Signed-in landing | Session API says authenticated | Replaced by `/{lang}/cases/` | Probe failure → stay on landing |
| Old Django signup route | `GET /en/signup/` with no export | 404 (no redirect loop) | None |

</intent-contract>

## Code Map

- `web/next.config.ts:5` -- `basePath: "/app"`. Remove it. Keep the dev rewrite of `/api` to `:8000`, and drop its `basePath: false` if it no longer means anything.
- `web/src/next-config.test.ts:8-22` -- asserts the `/app` basePath; update it.
- `Dockerfile:43` -- `COPY --from=web /web/out /app/web-dist/app`. Change it to `/app/web-dist`.
- `.github/workflows/deploy.yml:125-133` -- the smoke test fetches `/app/ar/` and greps for `/app/_next/static/`. The image test looks for `web-dist/app/ar/index.html`. Point all three at root paths. `mawareeth/tests.py:755` asserts these snippets, so update it too.
- `mawareeth/settings.py:316-322` -- the comment and `WEB_DIST_DIR`. The value is unchanged; reword the comment.
- `mawareeth/web_headers.py` -- the `WEB_PREFIX` and `WEB_HASHED_ASSET_PREFIX` checks for `/app/`. Rework them:
  - Skip `/static/`.
  - Give `/_next/static/` immutable caching plus DENY.
  - Give every other export file DENY and `no-cache`, plus noindex unless it is in the public set.
  - WhiteNoise passes both the `/ar/` and `/ar/index.html` forms of a URL; handle both.
- `mawareeth/web_views.py:11-37`:
  - Generalize `app_root` into a language redirect used by `/` and `/app/`.
  - Add the legacy `/app/<rest>` redirect.
  - `auth_redirect` builds `/app/{lang}/{page}/`; change it to `/{lang}/{page}/`.
- `mawareeth/urls.py`:
  - Line 45: `path('app/', …)`. Replace it with `''` → root redirect and `re_path('^app/(?P<rest>.*)$')` → legacy redirect.
  - Remove `re_path ^(?P<lang>[^/]+)/signup/$`; with the export at the root it would redirect to itself.
  - In `calc_patterns`, remove the `''` home, `terms/`, `privacy/`, `about/` and `signup/` routes. Without the `''` route, LocaleMiddleware's own `/` redirect no longer fires, which is why the explicit root route is needed.
- `calc/views.py:62-79` -- `HomePage`, `Terms`, `Privacy` and `About`. Delete them and their templates `calc/templates/calc/{home,about,terms,privacy}.html`. Read the terms and privacy templates and the about template first; they are the source text.
- `calc/templates/calc/base.html:48-103` and `calc/templates/404.html:13` -- `{% url 'calc:home|about|signup|terms|privacy' %}`. Replace them with literal `/{{ LANGUAGE_CODE }}/…/` links and drop the `active_link 'calc:home'`.
- `locale/{ar,fr}/LC_MESSAGES/django.po` -- the existing msgstrs for the terms, privacy and about msgids are the source for the ported text. Do not edit the `.po` files.
- `api/templates/api/password_reset_email.txt:9` and `api/invites.py:25` -- emailed links. Change them to `/{locale}/…`.
- `web/src/i18n/paths.ts:3-45` -- builds `/app/...` in `loginHref`, `signupHref` and `shareUrl`. Drop the prefix. `web/src/i18n/paths.test.ts` asserts these paths.
- `web/src/app/[locale]/site-nav.tsx:31,52`, `auth-form.tsx:114-116` and `cases/cases-view.tsx:69` -- hardcoded `/app/`. Remove the prefix. Matching assertions are in `auth-form.test.tsx`, `cases-view.test.tsx`, `invite/invite-view.test.tsx`, `results/*.test.tsx` and `src/test/dom.ts:6`.
- `web/src/app/[locale]/layout.tsx:17-27` -- `generateMetadata` sets `robots: noindex` for every page. Keep noindex as the default. Add `metadataBase` `https://www.mawareeth.com` and a site footer with links to About, Terms and Privacy.
- `web/src/app/[locale]/page.tsx` -- a placeholder shell with `SessionStatus`. Replace it with the landing page. Delete `session-status.tsx` if nothing else uses it; only `page.tsx` does today.
- `web/src/app/[locale]/use-session.ts` -- `useAuthState()` drives the signed-in redirect. Reuse it.
- `web/src/i18n/messages.ts` -- the `Messages` type plus `ar`, `en` and `fr` objects. Add `landing`, `about`, `terms`, `privacy`, `faq` and `footer` groups.
- `web/scripts/check-export.mjs` -- checks `lang`/`dir` for `""`, `interview` and `results`. Add `about`, `terms` and `privacy`. Assert that `robots.txt`, `sitemap.xml` and `llms.txt` exist at the root of `out/`, and that `out/index.html` still does not exist, because Django owns `/`. Reword the `/app/` comments.
- `web/scripts/prune-export.mjs` -- unchanged.
- `mawareeth/tests.py:440-545` -- the `WebExportTests`, `WebRootRedirectTests` and `WebExportAbsentTests` fixtures build `root/app/{locale}/index.html`. Move them to the root layout and cover the matrix. `:441` uses `reverse("calc:home")`; use `/` instead.
- `calc/tests.py:935` (`PUBLIC_ROUTES`), `:1159`, `:1291`, `:1398-1420` and `:3570-3611`; `user_auth/tests.py:37-40`; `api/tests.py:3573-3695` -- these assert removed routes or `/app/` URLs. Update them to the new paths. The Referer-only `/app/` test headers can stay.
- `deploy/README.md:5` and `web/README.md:18,33` -- describe serving under `/app/`; update them.

## Tasks & Acceptance

**Execution:**
1. `web/next.config.ts`, `Dockerfile` and `.github/workflows/deploy.yml` -- remove basePath, copy the export to the root of `web-dist`, and move the smoke and image checks to root paths. This puts the app at the root.
2. `mawareeth/web_views.py` and `mawareeth/urls.py` -- add the root and legacy `/app/` redirects (see the matrix), change `auth_redirect` targets, and remove the overlapping Django routes. This keeps old links working and routing unambiguous.
3. `mawareeth/web_headers.py` -- apply the header rules by path, including the public indexable set.
4. `calc/views.py`, the four `calc` templates, `calc/templates/calc/base.html` and `calc/templates/404.html` -- delete the replaced views and templates, and use literal language-prefixed links. This retires the Django versions.
5. `api/templates/api/password_reset_email.txt` and `api/invites.py` -- send root URLs in emails.
6. `web/src/i18n/paths.ts`, `site-nav.tsx`, `auth-form.tsx` and `cases-view.tsx` -- drop every `/app` prefix.
7. `web/src/i18n/messages.ts` -- add the drafted landing, about and FAQ text (5-7 answer-first Q&As) and the footer, plus the ported terms and privacy text, in ar, en and fr.
8. `web/src/app/[locale]/page.tsx` plus new `about/page.tsx`, `terms/page.tsx` and `privacy/page.tsx`, and `layout.tsx` -- build the designed pages with ui-ux-pro-max guidance: a responsive hero with the primary CTA to `/{lang}/interview/`, how it works, coverage, a not-a-fatwa note, the FAQ and a final CTA. Also add per-page metadata (title, description, canonical, hreflang, robots index on these four pages only), JSON-LD, the footer and the signed-in redirect. Tailwind only; no new dependencies.
9. `web/src/app/robots.ts`, `web/src/app/sitemap.ts` (or the static-export-compatible form the bundled Next docs prescribe) and `web/public/llms.txt`:
   - `robots.txt` allows the public pages, disallows the private app pages, `/api/` and `/accounts/`, and names the sitemap.
   - The sitemap lists the 12 public URLs with hreflang alternates.
   - `llms.txt` is an answer-first English summary of what Mawareeth does and does not do, linking the canonical pages in all three languages.
10. `web/scripts/check-export.mjs` -- apply the export-shape checks from the Code Map.
11. Tests: update every test listed in the Code Map, and add Django tests for each matrix row. Add web tests for:
    - landing metadata, canonical and JSON-LD;
    - the signed-in redirect and the anonymous no-redirect;
    - the footer links;
    - `paths.ts` without `/app`;
    - the robots and sitemap content.
12. `_bmad-output/implementation-artifacts/deferred-work.md`:
    - Remove the order-3 entry and the "Unify full-site i18n URLs" entry.
    - Add native and fiqh review of all new landing, about and FAQ text.
    - Add the terms and privacy msgstrs drafted for empty `.po` entries.
    - Add "update the terms and privacy text for accounts, sharing and email delivery".
    - Retarget the order-6 entry's note: old Django home, about, terms and privacy are already gone.

**Acceptance Criteria:**
- Given the built export, when `npm run build` runs, then `check-export` passes, with `out/{ar,en,fr}/{,about/,terms/,privacy/}index.html` carrying the correct `lang`/`dir`, `out/robots.txt`, `out/sitemap.xml` and `out/llms.txt` present, and no `out/index.html`.
- Given any web source file, when it is grepped for `/app/` or `"/app"`, then nothing is found outside test Referer headers and comments about the legacy redirect.
- Given `/en/` in a browser at 375px and 1280px, in light and dark mode and in Arabic RTL, when it renders, then there is no horizontal scroll, the primary CTA links to `/en/interview/`, the FAQ is visible, and the head carries the canonical `https://www.mawareeth.com/en/`, hreflang for ar, en, fr and x-default, and parseable JSON-LD.
- Given the legacy Django pages, when a signed-in user opens `/en/calc/`, then the nav and footer links point to `/en/`, `/en/about/`, `/en/terms/` and `/en/privacy/`, and the page renders 200.

## Spec Change Log

## Review Triage Log

### 2026-11-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7 (high 1, medium 2, low 4)
- defer: 4 (medium 1, low 3)
- reject: 16 (low 16)
- addressed_findings:
  - `[high]` `[patch]` Open redirect in `legacy_app_redirect` through backslash or control characters (`/app/%5Cevil.com` → `/\evil.com`); the fix falls back to the language redirect, and tests were added.
  - `[medium]` `[patch]` The full terms, privacy, landing and FAQ text sat in a shared client chunk loaded by the interview and results pages; it moved to a server-only module, and check-export guards it.
  - `[medium]` `[patch]` check-export only checked that the root files exist; it now checks they are non-empty, that public pages have a canonical link and no noindex, and that the interview page has noindex.
  - `[low]` `[patch]` A stale sr-only "(current)" on the legacy Home link was removed.
  - `[low]` `[patch]` `calc/urls.py` CRLF line endings were restored and the dead signup route was removed.
  - `[low]` `[patch]` Imports in `calc/views.py` left unused by the deleted views were removed.
  - `[low]` `[patch]` Deferred-work entries now name the root pages instead of `/app/`.

## Design Notes

- WhiteNoise runs before URL routing, so with the export in `web-dist/` it answers `/{lang}/…` pages first, and Django handles only paths the export lacks. Django must still own `/` (a static `index.html` cannot negotiate the language) and `/app/…`.
- 302, not 301: blue/green rollback is supported, and a cached permanent redirect to `/{lang}/interview/` would 404 on the previous release.
- Signed-in redirect: render the landing page normally and redirect after the session check, so crawlers and anonymous visitors always get full static HTML.

## Verification

**Commands:**
- `cd web && npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass, including `check-export: ok`.
- `uv run python manage.py test mawareeth calc.tests user_auth api.tests --noinput` -- expected: all pass. Run serially, with Postgres on localhost:5432.
- `uv run python manage.py check` -- expected: no issues.
- `cd web && grep -rn "/app" src scripts` -- expected: only comments or test Referers.

**Manual checks:**
- Open `web/out/en/index.html`, `web/out/ar/index.html` and `web/out/sitemap.xml` and inspect the head tags, the JSON-LD and the 12 sitemap URLs.

## Auto Run Result

Status: done

**Summary:** The Next.js export is now served from the site root (`/{lang}/…`). `/` is a Django language redirect, and every old `/app/<rest>` URL gets a 302 to `/<rest>`. The Django home, about, terms and privacy pages are retired in favour of designed Next.js pages, with drafted ar/en/fr landing, about and FAQ text and ported terms and privacy text (in the server-only `web/src/i18n/public-pages.ts`). Signed-in visitors on the landing page go to `/{lang}/cases/`. SEO covers per-page canonical and hreflang, Organization, WebApplication and FAQPage JSON-LD, `robots.txt`, `sitemap.xml` and `llms.txt`. Only the 12 public pages and the root files can be indexed.

**Files changed:**
- **Deploy:** `Dockerfile` and `.github/workflows/deploy.yml` serve the export from the root of `web-dist` and run the smoke test against root paths.
- **Django:** `mawareeth/web_views.py`, `mawareeth/urls.py` and `mawareeth/web_headers.py` add the root and legacy redirects, route removals and header rules by path. `calc/views.py`, `calc/urls.py` and four templates delete the retired pages; `calc/templates/calc/base.html` and `404.html` use literal links. `api/invites.py` and `password_reset_email.txt` send root URLs.
- **Web:** `next.config.ts` drops basePath. `paths.ts`, `site-nav.tsx`, `auth-form.tsx` and `cases-view.tsx` drop the `/app` prefix. New pages are the landing, `about/`, `terms/` and `privacy/`, plus `landing-redirect.tsx`, `site-footer.tsx`, `legal-page.tsx`, `json-ld.tsx`, `ui.ts`, `src/seo/*`, `robots.ts`, `sitemap.ts` and `public/llms.txt`. `session-status.tsx` is removed. `check-export.mjs` checks the export shape, SEO and bundle leakage.
- **Tests:** `mawareeth/tests.py`, `calc/tests.py`, `user_auth/tests.py`, `api/tests.py` and the web tests are updated, and the matrix tests are added.
- **Docs and backlog:** `deploy/README.md`, `web/README.md` and `deferred-work.md` (order-3 and URL-unification entries removed; review items added; `/app/` wording updated).

**Review:** 4 reviewers. 7 patches applied (high 1, medium 2, low 4), 4 deferred, 16 rejected. The follow-up review score is 3×2 + 4 = 10, and a high-severity patch was applied, so `followup_review_recommended: true`.

**Verification:**
- Web: `npm run lint` has 0 errors (10 existing warnings), `npm run typecheck` is clean, `npm test` passes 449/449, and `npm run build` and `check-export: ok` pass.
- Django: `manage.py check` is clean. `manage.py test mawareeth user_auth api.tests.InviteTests api.tests.AuthApiTests` passed 119 tests. The implementer ran calc, user_auth and api in full; the only failure, `api.tests.InterviewAnswerTests.test_edit_heir_keeps_id_and_place_and_derives_gender_again`, fails on the baseline too (deferred).
- I inspected the head tags, robots, sitemap and llms.txt in the built `out/`.

**Residual risks:**
- All new ar/fr text is unreviewed (recorded in deferred-work).
- The ported terms and privacy are now indexed with known defects (deferred).
- The 375px layout and dark mode were not checked in a real browser.
- Signed-in visitors see the landing page briefly before the client redirect.
- Production needs the legacy `/app/` redirects for as long as old emails and share links circulate.
