---
title: 'Execute production cutover and retire Heroku'
type: 'chore'
created: '2026-11-01'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'fa95645206e3d4d30a2df9aa88be8d83c53c041c'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-0-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-0-9-rehearse-capacity-restore-and-cutover.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-pre-cutover-cloudflare-edge.md'
---

## Intent

**Problem:** Mawareeth still ran on Heroku. Story 0.10 moves it to the rehearsed Hetzner host under explicit go-live control, without split writes or an unsafe rollback gap, and retires Heroku.

**Approach:** Follow `deploy/README.md` "Production cutover (story 0.10)" on the write-freeze path chosen by the 0.9 rehearsal, with the production edge from `spec-pre-cutover-cloudflare-edge.md`:
- Cloudflare proxied, with an Origin CA certificate;
- `www.mawareeth.com` canonical, and the apex 301 → www.

This record holds the execution evidence, because no code changed.

## Preparation (2026-10-28 – 2026-11-01)

- **Edge shipped:** PRs #80 (Cloudflare edge) and #83 (dependency fixes) were released as `fa95645`.
- **Cloudflare:** zone on Cloudflare; Origin certificate for `mawareeth.com` and `*.mawareeth.com` (expires 2041-10-24) installed root-only in `/etc/mawareeth/origin-tls/` and verified against the pinned roots; SSL/TLS Full (strict); Always Use HTTPS.
- **Host re-bootstrap (README "Production cutover preparation"):**
  - rehearsal state archived to `/root/mawareeth-pre-cutover-20261028T120741Z`;
  - `runtime.env` set to `DOMAIN=www.mawareeth.com`, `EDGE_MODE=cloudflare`, `REDIRECT_DOMAIN=mawareeth.com`;
  - bootstrap deploy;
  - `www` verified locally: 200, slot header, apex 301 → www, no ACME.
- **Gates before the freeze:** backup gate passed; rehearsal report `gate=pass`, path `write-freeze`; no deploy to recover; Heroku source reachable read-only.
- **Target:** the database was reset to empty, and `pg_stat_statements` recreated in `public` (Heroku has it there; the reset drops it).

## Cutover (2026-11-01, UTC)

| Phase | Time | Since freeze | Budget |
|---|---|---|---|
| `heroku maintenance:on`, `mark freeze-start` | 09:32:56 | — | — |
| `import --freeze-marked --extensions-created`: 49 tables match on counts and checksums, sequences match | 09:33:09 | 13 s | — |
| 2 pending migrations applied, `runtime.sh up`, edge validated, `mark validated` | 09:35:49 | 2 min 53 s | 20 min |
| Cloudflare: apex and www as proxied **A records** to 2.28.64.83 (AAAA removed); public traffic served by Caddy (slot blue); `mark dns-switched`, `mark rollback-point` | 09:39:38 | 6 min 42 s | 30 min |
| First production `backup` (31 s) and `verify-restore` (20 s); backup gate passed | 09:40:56 | — | — |

**Data carried over:** 3,018 users and 3,205 calculations. `django_site` 2 already named `www.mawareeth.com`.

**Origin path:** Cloudflare reaches the host over IPv4. Caddy's port-443 peers were all in Cloudflare's ranges (162.158.0.0/15, 172.64.0.0/13), so `trusted_proxies` applies.

## Heroku retirement (2026-11-01)

- **Inventory:**
  - one `web` dyno behind maintenance mode; no workers, schedulers, webhooks or drains;
  - one add-on, `heroku-postgresql` essential-1 (25.8 MB);
  - a stale custom domain `www.mawareeth.com`.
- **No missing configuration:** the Heroku-only config vars are either not read by the app (`INSTAGRAM_*`, `DEBUG`, `DB`), forced in production (cookie and SSL flags), or used only by local development (`ENGINE`, `DATABASE_HOST`, `DATABASE_NAME`).
- **Final archive:** a read-only `pg_dump -Fc --schema=public` of the frozen Heroku database was streamed into the restic repository as snapshot `2b2be5a5`, tag `heroku-final` (`heroku-final-20261101.dump`). Read back from the repository, it is a valid archive with 49 tables and 49 table-data entries. Retention never prunes it, because it lacks the `complete` tag.
- **Destroyed:** dyno scaled to 0, custom domain removed, then `heroku apps:destroy mawareeth` (app, add-ons and database). `/etc/mawareeth/heroku-source.env` was shredded on the host.
- **Cloudflare:** the dangling `rehearsal` CNAME to herokudns was deleted (subdomain-takeover risk).
- **Confirmed after the switch:** social login works on `www`, and the exposed Hetzner token had already been rotated.

## Findings

1. **Heroku auto-deployed `master` but never ran migrations.** Its schema was 2 migrations behind the release (`calc.0026`, `social_django.0017`), exactly as in the rehearsal. They were applied inside `app-blue` per the README procedure, after the plan check: 0 contract operations, 48 metadata-only operations, and one constraint with 0 offending rows. The supported command for this stays in `deferred-work.md`.
2. **`rehearse.sh report` now shows `gate=unmet`** (capacity not after the import; DNS-rollback mark ordering). Production marks replaced the rehearsal marks in the shared evidence directory. This is the known deferred item and not a cutover failure; the production import and restore evidence passed.
3. **Heredoc pitfall:** inside a heredoc fed to `ssh ... 'sudo bash -s'`, `docker exec -i` reads the rest of the script from stdin. An earlier preparation run silently skipped steps that way before it was caught. Scripts now pass `</dev/null`.

## Acceptance (epic story 0.10)

- **Every production gate and the 0.9 rehearsal gate passed before the window:** yes (see Preparation).
- **Freeze, transfer, validation and DNS switch within 30 minutes on the write-freeze path:** yes, 6 min 42 s.
- **Identity, data integrity, monitoring and backup verified before Heroku retirement:**
  - release `fa95645` and the slot header confirmed through the edge;
  - counts and checksums matched;
  - backup and restore were verified on production data;
  - host monitoring was already installed.
- **Heroku decommissioned only after the rollback point and with no live dependency or split-write path:** yes. Writes landed on Hetzner after `rollback-point`; Heroku was in maintenance with no writer processes, then destroyed.

## Open follow-ups

- Point Better Stack's uptime probe at `https://www.mawareeth.com/health/ready/`.
- Decide Authenticated Origin Pulls and/or limiting 80/443 to Cloudflare's ranges (`deferred-work.md`).
- Separate rehearsal and production evidence in `rehearse.sh` (`deferred-work.md`).
- Delete `/root/mawareeth-pre-cutover-20261028T120741Z` and `/root/runtime.env.rehearsal.*` on the host; they hold rehearsal-era secrets.
