# Mawareeth web

The Next.js frontend, built as a static export and served by Django from the site root (`/<locale>/...`). The landing page links to `/<locale>/interview/` (zero-signup case start). Only the landing, about, terms and privacy pages (plus `robots.txt`, `sitemap.xml` and `llms.txt`) are indexable; every other page is `noindex`. Old `/app/...` URLs redirect to the same path without the prefix.

## Local development

Use the Node version in `.nvmrc`. Run Django and Next side by side:

```console
uv run python manage.py runserver
cd web
npm ci
npm run dev
```

Open <http://localhost:3000/>, which redirects to the Arabic landing page `/ar/` (also `/en/` and `/fr/`). In development only, Next forwards `/api/*` to `localhost:8000`, so the browser still sees one origin. In production Django answers `/` and sends visitors to `/ar/` unless their language cookie names another language.

Without a `web-dist/` directory, which is the normal case in development, Django itself answers `/<locale>/` with 404. Use the Next dev server for these pages.

## Checks

These are what the `web` job in `.github/workflows/django.yml` runs:

```console
npm ci
npm run lint
npm run typecheck
npm test
npm run build
node scripts/check-export.mjs
npx playwright install --with-deps chromium
npm run test:e2e
```

`npm run build` writes the export to `out/`. The `Dockerfile` copies it to `web-dist/` in the release image.

## Browser tests

`npm run test:e2e` runs the Playwright suite in `e2e/` against the built export in `out/`, so run `npm run build` first; locally, `npx playwright install chromium` is enough. A small static server (`e2e/serve.mjs`) serves the export, and every `/api/v1/` request is answered by stubs in `e2e/api.ts`, so neither Django nor PostgreSQL is needed. The suite covers hydration, the interview's states, no automatic retry, RTL, keyboard use, reduced motion, the no-JavaScript fallback, axe accessibility checks, the school comparison, and recovery from failed or stale script chunks. It does not send the production Content-Security-Policy.

## Limits of a static export

There is no server-side rendering, Next middleware or image optimization, and every route must be known at build time. Adding a route means updating `src/i18n/messages.ts` and `scripts/check-export.mjs`. Adding a locale also means Django's `LANGUAGES` and `languageNames` in `src/app/[locale]/site-nav.tsx`.
