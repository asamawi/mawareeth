---
title: 'Next.js and DRF foundation for product delivery'
type: 'feature'
created: '2026-11-06'
status: 'done'
baseline_commit: '082e2f6b3351c8f3da8f6341817afba84606de7b'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 1 needs a rich client-side interview on Next.js and a DRF API (owner decision, 2026-11-05), but the repo is one server-rendered Django app with neither, and no story can start until both reach production safely.

**Approach:** Add a Next.js static export (`web/`, served under `/app/`) and a versioned DRF API (`/api/v1/`). The export is built into the existing release image, so one image, one Gunicorn process and the current blue-green flow carry frontend and API together, same-origin. A small locale-aware shell page calling one API endpoint proves the whole path end to end.

## Boundaries & Constraints

**Always:** Every existing Django route behaves as before. The API is JSON-only, session-authenticated and `IsAuthenticated` by default; a public endpoint opts out explicitly with `AllowAny` plus `login_not_required`. `ar` is RTL; `en` and `fr` are LTR. Node, Next and npm dependencies are pinned, with a committed lockfile. Unlinked, `noindex` shell only: nothing links to `/app/` yet.

**Ask First:** Running a Node server in production. Any change to `deploy/release.sh`, `deploy/runtime.sh`, `deploy/compose.yaml` or Caddy config (this design needs none). Any schema change.

**Never:** Interview, case-state or Madhab features (Stories 1.1+). Replacing or redirecting existing Django pages. Write endpoints. Exposing release identity through the API. Pushing this work: product work stays on local `development`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Shell page | `GET /app/ar/` (also `en`, `fr`) | 200 HTML, correct `lang`/`dir`, `X-Frame-Options: DENY`, `X-Robots-Tag: noindex`, revalidating cache | N/A |
| Locale negotiation | `GET /app/` with cookie or `Accept-Language` | 302 to `/app/<active language>/`; `ar` by default | N/A |
| Unknown locale | `GET /app/de/` | 404 | N/A |
| Hashed asset | `GET /app/_next/static/...` | 200, `Cache-Control` immutable, one year | Missing file gives 404 |
| Session probe, anonymous | `GET /api/v1/session/` | 200 `{"authenticated": false}`, sets `csrftoken`, creates no session row | N/A |
| Session probe, logged in | Same, with session cookie | 200 `{"authenticated": true}` | N/A |
| Unsupported method | `POST /api/v1/session/` | 405 JSON | N/A |
| API unreachable | Shell page, fetch fails | Localized "unavailable" message | No crash, no retry loop |
| Export absent | Dev or test run with no `web-dist/` | App starts; `/app/<locale>/` 404s; Django tests pass | Release smoke test fails a real image |

</frozen-after-approval>

## Code Map

- `Dockerfile` -- builder runs `collectstatic` and `check --deploy`, then `COPY . .`; `mawareeth/tests.py:416` regex-asserts these commands, so keep them.
- `.dockerignore`, `.gitignore` -- `.gitignore:17` `lib/` would silently ignore `web/src/lib/`.
- `mawareeth/settings.py:199-214` -- WhiteNoise sits after `SecurityMiddleware`, before `XFrameOptionsMiddleware`, so its responses need that header added. `LoginRequiredMiddleware` redirects any view without `login_not_required`.
- `mawareeth/urls.py:27` -- non-i18n `urlpatterns`; add routes here. `/ar/`, `/en/`, `/fr/` belong to Django, hence `/app/`.
- `calc/views.py:41` -- `method_decorator(login_not_required, name='dispatch')` pattern to reuse.
- `calc/tests.py:959` -- route classification covers `calc` only; unaffected.
- `.github/workflows/django.yml:193` -- `image-build` always runs, so the Dockerfile's `web` stage is covered and the `changes` filter needs no edit.
- `.github/workflows/deploy.yml:67-105` -- smoke test; plain HTTP is 301'd unless `X-Forwarded-Proto: https` is sent, except health paths.
- `_bmad-output/planning-artifacts/architecture/architecture-mawareeth-2026-09-02/ARCHITECTURE-SPINE.md:53,191` -- AD-1 requires separate approval for a rewrite and lists a separate Next.js frontend as out of scope.

## Tasks & Acceptance

**Execution:**
- [x] `web/` -- Scaffold Next 16.4.5, React 19, TypeScript, Tailwind 4, App Router, `src/`; `output: 'export'`, `basePath: '/app'`, `trailingSlash: true` for builds; dev-only rewrite of `/api` to `localhost:8000`; `.nvmrc` 26.13.0; lint, typecheck and build scripts -- the frontend workspace.
- [x] `web/src/app/[locale]/` -- Root layout and page with `generateStaticParams` for `ar`, `en`, `fr`, `dynamicParams = false`, `noindex` metadata, typed message dictionaries -- proves RTL/LTR.
- [x] `web/src/api/session.ts` -- Same-origin client for the session probe; page renders connected or unavailable state -- proves the path.
- [x] `web/scripts/check-export.mjs` -- Fail unless each locale's `index.html` exists with the right `lang`/`dir` and no root `index.html` exists -- guards the export.
- [x] `api/` (`apps.py`, `views.py`, `urls.py`, `tests.py`) and `mawareeth/urls.py` -- `SessionView` with `ensure_csrf_cookie`; mount `api/v1/` -- first endpoint.
- [x] `pyproject.toml`, `uv.lock` -- Add `djangorestframework==3.18.3`.
- [x] `mawareeth/settings.py` -- `rest_framework` and `api` apps; `REST_FRAMEWORK` defaults; `WEB_DIST_DIR = BASE_DIR / 'web-dist'`; `WHITENOISE_ROOT` only when it exists; `WHITENOISE_INDEX_FILE = True`; `WHITENOISE_ADD_HEADERS_FUNCTION` from `mawareeth/web_headers.py` scoped to `/app/` -- do not replace the immutable-file test, which `/static/` relies on.
- [x] `mawareeth/web_views.py`, `mawareeth/urls.py` -- `login_not_required` view at `app/` redirecting to the active language -- negotiation.
- [x] `mawareeth/tests.py`, `api/tests.py` -- Cover the matrix using a temporary `WHITENOISE_ROOT`; assert existing `/ar/` home and `/health/ready/` still respond; assert `django.yml` has the web job.
- [x] `Dockerfile`, `.dockerignore` -- First stage `node:26.13.0-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072` runs `npm ci` and the build; Python builder removes `/app/web` and copies export to `/app/web-dist/app`; ignore `web/node_modules`, `web/.next`, `web/out`.
- [x] `.gitignore` -- Ignore `web-dist/`, `web/node_modules/`, `web/.next/`, `web/out/`; add `!web/src/lib/`.
- [x] `.github/workflows/django.yml` -- Add `web` job: Node from `.nvmrc`, `npm ci`, lint, typecheck, build, export check. It must fail the workflow, gating publish.
- [x] `.github/workflows/deploy.yml` -- Extend smoke: `/app/ar/` has `dir="rtl"`, one hashed asset from it loads, `/api/v1/session/` returns anonymous JSON; send `X-Forwarded-Proto: https`.
- [x] `ARCHITECTURE-SPINE.md` -- Add AD-1 addendum and update line 191: the owner approved Next.js and DRF for product delivery (2026-11-05) as a static export inside the one deployable unit; AD-2 unchanged.
- [x] `web/README.md`, `deploy/README.md` -- Local dev workflow; one paragraph stating the image contains the export and deploys are unchanged.
- [x] `deferred-work.md` -- Append the items in Design Notes.

**Acceptance Criteria:**
- Given the built image, when run with the smoke test's environment, then all extended smoke checks pass.
- Given the final image, when listed, then `/app/web` and `node_modules` are absent and `/app/web-dist/app/ar/index.html` is present.
- Given the diff, when inspected, then `deploy/release.sh`, `deploy/runtime.sh`, `deploy/compose.yaml` and Caddy config are unchanged.
- Given `next dev` and `runserver` together, when `/app/en/` opens, then the page shows the connected state.

## Design Notes

**Why static export.** It keeps one image and one process, so frontend and API can never be version-skewed, rollback stays atomic, the host carries no extra memory, and the PRD's "SPA/SSG" wording holds. The cost is no SSR, Next middleware or image optimization. The interview is client-driven and sits behind a CTA, so this fits; marketing pages stay on Django. If SSR is ever needed, add Node slots then.

**Known limits to defer:**
- Anonymous writes: DRF's `SessionAuthentication` enforces CSRF only for logged-in users, so Story 1.1 must enforce it explicitly for anonymous POSTs.
- A tab left open across a deploy can 404 on lazily loaded old chunks; handle it when real routes exist.
- shadcn/ui, React Query, Zustand and drf-spectacular arrive with the first story that uses them.
- Full-site i18n URL unification between `/ar/` and `/app/ar/`.

## Verification

**Commands:**
- `uv run python manage.py test` -- expected: all pass.
- `cd web && npm ci && npm run lint && npm run typecheck && npm test && npm run build && node scripts/check-export.mjs` -- expected: exit 0.
- `docker build -t mawareeth:foundation .` then the smoke checks locally -- expected: pass. CI YAML cannot run before a push, so this is the only pre-merge proof.

## Suggested Review Order

**One image carries frontend and API**

- Entry point: the export is built in its own stage, so production runs no Node.
  [`Dockerfile:2`](../../Dockerfile#L2)

- Sources are dropped and only the export enters the image.
  [`Dockerfile:41`](../../Dockerfile#L41)

- WhiteNoise serves the export only when it exists; tests and development run without it.
  [`settings.py:291`](../../mawareeth/settings.py#L291)

- WhiteNoise answers before later middleware, so frame, robots and cache headers are set here.
  [`web_headers.py:8`](../../mawareeth/web_headers.py#L8)

- Language negotiation stays in Django, keeping one source for the active language.
  [`web_views.py:13`](../../mawareeth/web_views.py#L13)

**API access and error format**

- Opts out of the login redirect so permissions answer in JSON.
  [`views.py:12`](../../api/views.py#L12)

- The one public endpoint, which also issues the CSRF cookie.
  [`views.py:22`](../../api/views.py#L22)

- Unknown API paths get JSON, not Django's HTML 404.
  [`views.py:31`](../../api/views.py#L31)

- Secure, JSON-only defaults for every future endpoint.
  [`settings.py:297`](../../mawareeth/settings.py#L297)

**Frontend shell**

- Static export for builds, API proxy for development only.
  [`next.config.ts:33`](../../web/next.config.ts#L33)

- All three locales are generated at build time.
  [`layout.tsx:11`](../../web/src/app/[locale]/layout.tsx#L11)

- One attempt with a timeout; failures become a state, never an exception.
  [`session.ts:31`](../../web/src/api/session.ts#L31)

**Release gates**

- Blocks publishing if the frontend fails lint, types, tests or export shape.
  [`django.yml:217`](../../.github/workflows/django.yml#L217)

- Proves the real image serves the page, an asset and the API, and has no sources.
  [`deploy.yml:103`](../../.github/workflows/deploy.yml#L103)

- Rejects Next's not-found pages, which would otherwise be served with status 200.
  [`check-export.mjs:16`](../../web/scripts/check-export.mjs#L16)

**Tests and decision record**

- Covers the I/O matrix for the export, using a temporary stand-in.
  [`tests.py:403`](../../mawareeth/tests.py#L403)

- Real CSRF and anonymous-access behavior through the middleware stack.
  [`tests.py:81`](../../api/tests.py#L81)

- Records the owner's approval of this design against AD-1.
  [`ARCHITECTURE-SPINE.md:54`](../planning-artifacts/architecture/architecture-mawareeth-2026-09-02/ARCHITECTURE-SPINE.md#L54)
