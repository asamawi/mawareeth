# Mawareeth web

The Next.js frontend, built as a static export and served by Django under `/app/`. The landing page links to `/app/<locale>/interview/` (zero-signup case start) and every page is `noindex`.

## Local development

Use the Node version in `.nvmrc`. Run Django and Next side by side:

```console
uv run python manage.py runserver
cd web
npm ci
npm run dev
```

Open <http://localhost:3000/app/en/> (also `ar` and `fr`). The page shows the connected state when it reaches Django: in development only, Next forwards `/api/*` to `localhost:8000`, so the browser still sees one origin.

Without a `web-dist/` directory, which is the normal case in development, Django itself answers `/app/<locale>/` with 404. Use the Next dev server for these pages.

## Checks

These are what the `web` job in `.github/workflows/django.yml` runs:

```console
npm ci
npm run lint
npm run typecheck
npm test
npm run build
node scripts/check-export.mjs
```

`npm run build` writes the export to `out/`. The `Dockerfile` copies it to `web-dist/app/` in the release image.

## Limits of a static export

There is no server-side rendering, Next middleware or image optimization, and every route must be known at build time. Adding a route means updating `src/i18n/messages.ts` and `scripts/check-export.mjs`. Adding a locale also means Django's `LANGUAGES` and `languageNames` in `src/app/[locale]/site-nav.tsx`.
