---
title: 'Story 1.1: Zero-Signup Case Start'
type: 'feature'
created: '2026-11-06'
status: 'done'
baseline_commit: 'f7bb08c711e929f8bd5cffd8b78ccbe2f0cc7907'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/web/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every way into a case requires an account, so a visitor at the moment of need hits a signup wall before getting any answer.

**Approach:** A landing call to action opens a new interview route in the Next.js app. That route starts an anonymous case held in the Django session through a CSRF-protected, throttled DRF endpoint, and offers to resume if a case already exists. Later stories add the interview content to this state.

## Boundaries & Constraints

**Always:**
- Anonymous state lives only in the Django session under one key, with a 24-hour idle expiry refreshed on each case write. No `Calculation`, `Person` or other case rows are created.
- Reads never create a session row, and `/api/v1/session/` keeps its exact body `{"authenticated": false}`.
- Anonymous writes enforce CSRF and return JSON errors. Case writes are throttled per client IP.
- The short expiry applies to anonymous sessions only. It never shortens a logged-in session, and it is reset at login.
- An existing case is never replaced without the visitor choosing to start over.
- All new text exists in Arabic, English and French, and new UI works in RTL and by keyboard.

**Ask First:** Any change to `deploy/release.sh`, `deploy/runtime.sh`, `deploy/compose.yaml` or Caddy; adding Redis or a shared cache; any schema migration; any change to `deploy/backup.sh` dump or verify behavior.

**Never:** Madhab, deceased or heir capture (Stories 1.2 and 1.3). Personal data in the session in this story. Reusing `calc:new`. Saving to an account (Epic 4). Returning to the interview after signup (Epic 4). New frontend libraries with no user in this story. Pushing this work: it stays on local `development`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New visitor | `GET /api/v1/case/`, no session | `200 {"case": null}`, no session row or cookie | N/A |
| Start | `POST /api/v1/case/`, valid CSRF | `201 {"case": {"id", "started_at"}}`, session expiry 24h | N/A |
| Missing or bad CSRF | Anonymous `POST` | No state change | JSON `403` |
| Over the limit | More than 30 case writes per hour from one IP | No state change | JSON `429`, UI asks to retry later |
| Returning | `GET` with a live case | `200` with the same case, UI offers resume or start over | N/A |
| Start over | `POST` with a live case, after the visitor chooses it | New `id` replaces the old case | N/A |
| Expired | Session older than 24h idle | `200 {"case": null}`, UI says the case expired and offers a new one | N/A |
| Logged-in user starts a case | `POST` while authenticated | `201`, login session expiry unchanged | CSRF enforced as usual |
| Anonymous user logs in | Case in session, then login | Case kept, session expiry back to the site default | N/A |
| API unreachable | Fetch fails or times out | UI shows a retry message, never a blank page | One attempt per click, no auto retry |

</frozen-after-approval>

## Code Map

- `api/views.py:11-28` -- `ApiView` base (opts out of `LoginRequiredMiddleware`) and `SessionView`. New view extends `ApiView` with `AllowAny`.
- `api/urls.py:8-10` -- add `case/` before the catch-all, which must stay last.
- `api/tests.py:36-44,90-101,117` -- pins no-session probe and route base class. Copy the CSRF test style: `secure=True`, `APIClient(enforce_csrf_checks=True)`, `X-CSRFToken` and `Referer`.
- `mawareeth/settings.py:309-314,170,63-80,352` -- `REST_FRAMEWORK` (no throttling), `CSRF_TRUSTED_ORIGINS` (HTTPS-only check runs in production only). No `CACHES` set, so DRF uses per-process LocMem.
- `Dockerfile:103` -- 3 Gunicorn workers.
- `deploy/caddy/edge/cloudflare/global.caddy` -- Caddy keeps `X-Forwarded-For` only from Cloudflare ranges and otherwise replaces it.
- `web/src/app/[locale]/layout.tsx:41` -- body only, no navbar. `dynamicParams = false`, so routes must be static, with no IDs in URLs.
- `web/src/api/session.ts` -- GET-only client and `node --test` pattern with stubbed fetch. No CSRF helper exists.
- `web/src/i18n/messages.ts:13-18` -- typed dictionary for all three locales.
- `web/scripts/check-export.mjs:26-39` -- checks locale roots only; must also cover the new route. Confirm the path before editing.
- `calc/templates/calc/home.html:54-62` -- anonymous landing lead, where the CTA goes. Only anonymous visitors see it (`calc/views.py:44-50`).
- `calc/templates/calc/base.html:65-66` and `mawareeth/urls.py:34,82,90` -- login at `/accounts/login/`, signup at `/<lang>/signup/`.
- `locale/{ar,en,fr}/LC_MESSAGES/django.po` and `.mo` -- both are tracked, so update both.
- `deploy/monitor.sh`, `deploy/backup.sh:1060-1075,1091-1097`, `deploy/runtime.sh:689`, `deploy/release.sh:526` -- timer templates, install path, `read_active_slot` and the `compose_bounded exec -T app-$slot python manage.py` pattern. `monitor.sh` sources `backup.sh`; its token check is the closest model. Failed units already alert (`mawareeth-alerts.yml:222`).
- `deploy/test_monitor.sh:956-973` -- unit tests for timers.
- `web/README.md:3` -- says `/app/` links to nothing, which becomes stale.

## Tasks & Acceptance

**Execution:**
- [x] `api/anonymous_case.py` -- add helpers to read, start and replace the case, and set anonymous expiry -- one owner of the session key for later stories.
- [x] `api/views.py`, `api/urls.py` -- add `CaseView` with `GET` and `POST`, enforcing CSRF for anonymous `POST` -- matrix behavior.
- [x] `api/throttling.py`, `mawareeth/settings.py` -- add a scoped throttle on case writes, `NUM_PROXIES`, `ANONYMOUS_CASE_IDLE_SECONDS`, and the `next dev` origin in non-production CSRF settings -- see Design Notes.
- [x] `api/apps.py` or `api/signals.py` -- on `user_logged_in`, reset session expiry -- short expiry must not follow the user.
- [x] `api/tests.py` -- test every matrix row, including spoofed `X-Forwarded-For`, and that no case rows are written -- proof of the invariants.
- [x] `web/src/api/case.ts`, `web/src/api/case.test.ts` -- add fetch and start calls that send `X-CSRFToken` from the cookie, with the probe issuing it first -- first write client.
- [x] `web/src/app/[locale]/interview/page.tsx`, `interview/start-case.tsx` -- add loading, started placeholder, resume or start over, expired, throttled and failed states, with a `<noscript>` message -- entry to the interview.
- [x] `web/src/app/[locale]/site-nav.tsx`, `layout.tsx` -- add login and signup links, hidden when authenticated, and a language switcher that keeps the current page -- required by the story and to link `/app/`.
- [x] `web/src/i18n/messages.ts`, `web/scripts/check-export.mjs`, `web/README.md` -- add text, guard the new route, correct the docs.
- [x] `calc/templates/calc/home.html`, `locale/*` -- add the CTA linking to `/app/<lang>/interview/`, with translations.
- [x] `deploy/monitor.sh`, `deploy/test_monitor.sh`, `deploy/README.md` -- add a daily timer that runs `clearsessions` in the active slot, and document re-running `install` -- expired rows otherwise stay forever.

**Acceptance Criteria:**
- Given an anonymous visitor on the landing page, when they choose to start, then they reach the interview route with a case in their session and never see a login page.
- Given any `/app/` page, when an anonymous visitor uses the navbar, then signup and login are available and nothing requires them.
- Given a started case, when the visitor reloads or switches language within the expiry, then the same case `id` is offered.
- Given JavaScript is off, when the interview page loads, then a translated message explains that JavaScript is required.
- Given the daily timer runs, when sessions have expired, then their rows are removed and a failure raises the existing unit alert.

## Design Notes

**CSRF:** DRF checks it only for logged-in users. In `CaseView`, call `SessionAuthentication().enforce_csrf(request)` before writing, so failures stay JSON and logged-in behavior is unchanged.

**Client IP:** Without `NUM_PROXIES`, DRF keys on the whole `X-Forwarded-For` string, which a client can vary to dodge limits. `NUM_PROXIES = 2` fits both edge modes as read from the Caddy config: under Cloudflare the header is `client, cloudflare`, and under ACME it is replaced by the single client address, where DRF takes the only entry. Confirm the real header on the deployed stack before relying on it.

**Throttle store:** LocMem counts per worker and resets on deploy, so the effective ceiling is up to 90 writes an hour. Counters are disposable, so this does not put case state in a slot.

**Backups:** The project owner accepted on 2026-11-06 that session rows stay in encrypted backups for the normal retention of about 6 months, so `deploy/backup.sh` does not change. The 24-hour expiry limits the live database only. This story's session holds only a random `id` and a timestamp; personal data arrives in Story 1.3.

**Deferred from linking `/app/`:** The Content-Security-Policy, browser tests and failed or stale chunk handling are release blockers in `deferred-work.md`. They are not part of this story.

## Verification

**Commands:**
- `python manage.py test` -- expected: all pass, with `DJANGO_ENV=production` as CI runs it.
- `python manage.py makemigrations --check` -- expected: no changes.
- `npm run lint && npm run typecheck && npm test && npm run build` in `web/`, plus the export check -- expected: all pass. Confirm script names in `web/package.json:9-13`.
- `bash deploy/tests/test_monitor.sh` -- expected: pass.

**Manual checks:**
- Start, reload, switch language and start over in a browser at Arabic and English, with `next dev` and with the built export.

## Suggested Review Order

**Starting and resuming a case**

- Start here: one attempt per action, and a new visitor's load goes straight to a started case.
  [`flow.ts:33`](../../web/src/interview/flow.ts#L33)

- The expired notice shows once and never starts a case by itself.
  [`flow.ts:53`](../../web/src/interview/flow.ts#L53)

- Turns flow results into views, and moves focus on every settled view.
  [`start-case.tsx:42`](../../web/src/app/%5Blocale%5D/interview/start-case.tsx#L42)

- The only entry from the Django site, shown to anonymous visitors.
  [`home.html:65`](../../calc/templates/calc/home.html#L65)

**Anonymous state in the session**

- The API boundary: a live case is replaced only on an explicit `replace: true`.
  [`views.py:37`](../../api/views.py#L37)

- Sole owner of the session key; malformed stored data reads as no case.
  [`anonymous_case.py:14`](../../api/anonymous_case.py#L14)

- The short expiry applies to anonymous sessions only and refreshes on writes.
  [`anonymous_case.py:30`](../../api/anonymous_case.py#L30)

- A login keeps the case but must not inherit its short expiry.
  [`signals.py:8`](../../api/signals.py#L8)

**Protecting anonymous writes**

- Runs as a permission so CSRF rejections never use throttle quota.
  [`permissions.py:5`](../../api/permissions.py#L5)

- Keys IPv6 on its /64 so rotating addresses cannot dodge the limit.
  [`throttling.py:16`](../../api/throttling.py#L16)

- Picks the client from the forwarded header; the Cloudflare half is still unconfirmed.
  [`settings.py:322`](../../mawareeth/settings.py#L322)

- Client side of CSRF: probes for the cookie when missing, then makes one attempt.
  [`case.ts:73`](../../web/src/api/case.ts#L73)

**Session cleanup on the host**

- Runs `clearsessions` in the active slot's container, bounded inside the container.
  [`monitor.sh:398`](../../deploy/monitor.sh#L398)

- Retries transient failures, while persistent ones still end failed and alert.
  [`monitor.sh:418`](../../deploy/monitor.sh#L418)

**Navigation and text**

- Login and signup stay optional; language switching keeps the current page.
  [`site-nav.tsx:20`](../../web/src/app/%5Blocale%5D/site-nav.tsx#L20)

- Login returns the visitor to the page they were on.
  [`paths.ts:5`](../../web/src/i18n/paths.ts#L5)

- States in three languages that the case is kept on our server for 24 hours.
  [`messages.ts:30`](../../web/src/i18n/messages.ts#L30)

- With JavaScript off, only the explanation shows.
  [`page.tsx:21`](../../web/src/app/%5Blocale%5D/interview/page.tsx#L21)

**Tests and configuration**

- Covers the API rows of the I/O matrix.
  [`tests.py:135`](../../api/tests.py#L135)

- Covers the matrix rows at the UI flow level.
  [`flow.test.ts:31`](../../web/src/interview/flow.test.ts#L31)

- The expiry value.
  [`settings.py:327`](../../mawareeth/settings.py#L327)

- Trusts the `next dev` origins outside production only.
  [`settings.py:81`](../../mawareeth/settings.py#L81)
