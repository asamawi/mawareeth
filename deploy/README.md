# Secured Hetzner host baseline

This directory contains the secured host baseline, the private Compose runtime, blue-green release deployment, encrypted off-host database backup with restore verification, and host monitoring with alerting through SCDF's Prometheus/Alertmanager plus an external Better Stack probe. Crash recovery after an interrupted deploy is automated by `release.sh recover`, and `monitor.sh drill` records the operator's alert-path drill. It does not automate contract-migration detection, host-state restore, DNS, or cutover.

## Private Compose runtime

Run runtime operations as root with `sudo`; Docker-group access is root-equivalent and is not the supported operator boundary. Copy the directly installable `runtime.env.example` to `/etc/mawareeth/runtime.env`, keep it `root:root` mode `0600`, and edit it with `sudoedit`. Values use a strict raw `KEY=VALUE` schema: no comments, blank lines, control characters, shell expansion, or extra keys. Compose consumes the generated app snapshot with `env_file.format: raw`, so values are passed literally rather than interpolated. PostgreSQL passwords must contain only URL-safe unreserved characters (`A-Z`, `a-z`, `0-9`, `.`, `_`, `~`, `-`) because the same value is embedded in `DATABASE_URL` without lossy transformation. Keep `DOMAIN` lowercase and within DNS label/total-length limits; `MAILGUN_SERVER_NAME` must also be a valid hostname.

Five optional keys carry the sites-framework ID and social-login credentials that Heroku sets. They are left out of `runtime.env.example` so the example stays directly installable without fake OAuth credentials. Any that are present are appended to the app snapshot under the same names, after the standard lines, in this order:

- `SITE_ID`: a positive integer without leading zeros (`^[1-9][0-9]{0,9}$`) and at most `2147483647`, because Django's `Site.id` is a PostgreSQL `integer`. `mawareeth/settings.py` falls back to `1` when it is absent.
- `FACEBOOK_KEY`: the Facebook **App ID**, 1–32 digits (`^[0-9]{1,32}$`), because settings cast it to `int`.
- `FACEBOOK_SECRET`: the Facebook **App Secret**.
- `LINKEDIN_KEY`: the LinkedIn OpenID Connect **Client ID**.
- `LINKEDIN_SECRET`: the LinkedIn OpenID Connect **Client Secret**.

`FACEBOOK_SECRET`, `LINKEDIN_KEY` and `LINKEDIN_SECRET` must each be at most 256 characters with no whitespace (an empty value is refused for every key). `FACEBOOK_KEY` and `FACEBOOK_SECRET` must both be set or both be absent, and so must `LINKEDIN_KEY` and `LINKEDIN_SECRET`. Errors name only the key, never the value. `settings.py` reads them as `SITE_ID`, `SOCIAL_AUTH_FACEBOOK_KEY`/`SOCIAL_AUTH_FACEBOOK_SECRET` and `SOCIAL_AUTH_LINKEDIN_OPENIDCONNECT_KEY`/`SOCIAL_AUTH_LINKEDIN_OPENIDCONNECT_SECRET`, and without them falls back to placeholder credentials that break social login.

Append these lines to `/etc/mawareeth/runtime.env` with `sudoedit`. The values below are **placeholders only**: replace every one with the real value from the Heroku config or the provider console, and drop a provider's pair entirely if it is not used:

```
SITE_ID=2
FACEBOOK_KEY=000000000000000
FACEBOOK_SECRET=REPLACE_WITH_FACEBOOK_APP_SECRET
LINKEDIN_KEY=REPLACE_WITH_LINKEDIN_CLIENT_ID
LINKEDIN_SECRET=REPLACE_WITH_LINKEDIN_CLIENT_SECRET
```

**`SITE_ID` after a Heroku restore.** The database restored from Heroku carries Heroku's `django_site` rows, so `SITE_ID` must equal the Heroku value (`2` today), and a `django_site` row with that ID must exist in the restored database. Otherwise `Site.objects.get_current()` raises `Site.DoesNotExist`. Omitting the key does not fail validation: the app silently uses site `1`, which is the wrong site for the restored data.

A `runtime.env` without these keys renders the same snapshot, with the same hash, as before. Adding, changing or removing any of them changes the snapshot hash. `release.sh deploy` and `recover` refuse when the runtime file does not hash to the active slot's recorded snapshot (see Blue-green deployment). Adding these keys to a host with running slots is therefore a deliberate configuration rotation, not something a deploy does for you. No rotation command exists yet; it is an open deferred item (a phased runtime-configuration rotation operation). Until one exists, set these keys in `runtime.env` before the first deploy on a new host.

Download a trusted `release-manifest.json` out of band, verify its provenance, and keep it at an absolute root-owned mode-0600 path. The root-owned image lock remains mode 0644. The manifest's deployment-bundle SHA must equal the checked-out repository commit, its repository must equal `APP_IMAGE_REPOSITORY`, and its application identity must be a canonical GHCR digest. Load images on a connected trusted workstation with `docker pull REPOSITORY@sha256:DIGEST`, verify `docker image inspect --format '{{join .RepoDigests "\n"}}' REPOSITORY@sha256:DIGEST` contains the exact requested `REPOSITORY@sha256:DIGEST`, then transfer with `docker save` over an approved channel. On the offline host, use `docker load`, repeat the exact `RepoDigests` inspection, and run preflight. Never substitute a matching digest reported under a different repository. The runtime never builds or pulls and uses `pull_policy: never`.

Prepare and inspect the runtime, bootstrap the first release with `release.sh deploy` (see Blue-green deployment), and use `up` only to restart the recorded active release:

```console
sudo MAWAREETH_RELEASE_MANIFEST=/etc/mawareeth/release-manifest.json deploy/runtime.sh prepare
sudo MAWAREETH_RELEASE_MANIFEST=/etc/mawareeth/release-manifest.json deploy/runtime.sh config
sudo MAWAREETH_RELEASE_MANIFEST=/etc/mawareeth/release-manifest.json deploy/release.sh deploy
sudo MAWAREETH_RELEASE_MANIFEST=/etc/mawareeth/release-manifest.json deploy/runtime.sh up
sudo MAWAREETH_RELEASE_MANIFEST=/etc/mawareeth/release-manifest.json deploy/runtime.sh status
sudo MAWAREETH_RELEASE_MANIFEST=/etc/mawareeth/release-manifest.json deploy/runtime.sh logs --tail 200
```

Preparation validates every input, local image, and the fully resolved Compose model before durable mutation. `config` performs that inspection with a protected temporary snapshot and creates no volumes or persistent snapshot. Preparation creates fixed external volumes `mawareeth-postgres-data`, `mawareeth-caddy-data`, and `mawareeth-caddy-config` only when absent, validates labels after creation or concurrent appearance, and refuses foreign labels or inspection failures. An existing PostgreSQL volume is accepted only when `PG_VERSION` is absent (empty/new) or major version `17`; the runtime never replaces or upgrades durable state. Repeated preparation reuses volumes and the content-addressed snapshot.

The generated `deploy/runtime/<sha256>.snapshot.env` is one app-only, root-owned mode-0600 snapshot shared by both slots. Creation is atomic and existing content or permission drift aborts. Snapshots are intentionally not cleaned up automatically: retain those referenced by rollback releases, audit them by filename and metadata without printing content, and remove obsolete snapshots only during a separately approved operation. The runtime source file, snapshots, certificates, and volume data are ignored and must never be committed.

Only Caddy publishes TCP host ports 80/443; HTTP/3/UDP is not enabled. PostgreSQL remains on an internal database network, while Caddy's app network permits outbound ACME traffic. Before startup, public DNS A/AAAA records must point to the host as intended, outbound TCP 443 and DNS resolution must work, and inbound TCP 80/443 must reach Caddy for ACME challenges and HTTPS. Container health is visible through `runtime.sh status`; bounded JSON logs are available through `runtime.sh logs`. Audit with `deploy/runtime.sh status`, `docker volume inspect` for all three fixed names, and `docker ps --format '{{.Names}} {{.Ports}}'` to confirm no app/database binding exists.

### Routes, slot records, and runtime commands

The persisted route authority is `<state dir>/routes/active-slot.caddy` (default `deploy/runtime/routes/`), which Caddy mounts read-only. `prepare` seeds it from the tracked blue seed `deploy/caddy/active-slot.caddy` only when no route and no slot record exist, and fails with a clear message if the seed is missing; nothing but `release.sh deploy` rewrites an existing route. Caddy imports every `routes/*.caddy`, so the runtime and the deploy refuse to act when any other `*.caddy` file is present there. Every route stamps responses with `X-Mawareeth-Slot: <slot>` (`header_down`), so production verification proves which slot actually answered. The two slots run independent images (`APP_BLUE_IMAGE`, `APP_GREEN_IMAGE`) and share one snapshot. Caddy no longer waits for blue: the runtime decides the start order.

Each slot's release is recorded in root-only `<state dir>/slots/<slot>.env` (`IMAGE`, `COMMIT`, `SNAPSHOT`), written only by `release.sh deploy`. The deploy writes the candidate's record in the `switching` phase: after the candidate passed its readiness and release-identity gates, immediately before the route file is replaced, and therefore *before* the edge verification. At the same moment the record it replaces is saved as `<slot>.env.prev` (or a stale `.prev` is removed when the slot had no record). If the switch or the edge verification then fails, the deploy puts the record back first, journals `records=untouched`, and only then puts the earlier `.prev` back (removing the record if the slot had none), so a failed deploy never leaves an unverified release recorded. If that journal write fails, `.prev` keeps the pre-deploy record and the deploy prints a WARNING, because a journal that still says `records=replaced` makes `recover` restore the record from `.prev`. The journal's `records=` line says whether `.prev` already holds the pre-deploy record, so a crash anywhere in this sequence is visible as a non-idle journal that `release.sh recover` can resolve (see Crash recovery).

`up` restarts the recorded active release after `down`; it never changes releases. It refuses when the route or the active slot's record is absent (bootstrap the first release with `release.sh deploy`), when the manifest image or commit differs from the active record (use `release.sh deploy`), and when the runtime configuration differs from the recorded snapshot. It starts PostgreSQL (waiting for health), then the active slot (waiting for health), then Caddy, each bounded by `MAWAREETH_RUNTIME_WAIT_TIMEOUT` (default 300s); it never starts the idle slot and never runs migrations. `prepare`, `up`, and `down` take the deploy lock and refuse while the deploy journal is not idle. `status` and `logs` are read-only: they create no state directory, snapshot, or record and tolerate configuration drift.

**Reboots.** Containers use `restart: unless-stopped`, so after a host reboot Docker itself restarts PostgreSQL, the slot that was running, and Caddy, without the runtime's ordering, lock, or journal checks. Expect brief `502` responses until the slot is ready again. After every reboot, as root: confirm `<state dir>/deploy.journal` is absent or `phase=idle` (otherwise preview with `deploy/release.sh recover --dry-run`, then run `deploy/release.sh recover` before anything else); run `deploy/runtime.sh status` and check that only the routed slot is running and healthy; confirm `curl -sD - --resolve DOMAIN:443:127.0.0.1 https://DOMAIN/health/ready/` shows the routed slot's `X-Mawareeth-Slot` and that the slot itself reports the recorded commit (`docker compose -p mawareeth exec -T app-<slot> python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health/release/').read().decode())"`; Caddy answers `/health/release/` with `404`); if anything is off, run `deploy/runtime.sh up` with the active release's manifest.

**Caddy admin API (deliberate decision).** `admin off` would make `caddy reload` impossible, so the Caddyfile enables the admin API on `localhost:2019` inside the Caddy container only. Port 2019 is never published by Compose (the offline tests assert this), so it is reachable only from processes in that container, which `release.sh` drives with `docker compose exec caddy caddy reload`. Exposing it any further requires an explicit decision.

## Blue-green deployment

Every application release, including the first, is deployed with `release.sh deploy`, as root, from a clean checkout of the release's deployment-bundle commit with its images already loaded (see above). It never builds, pulls, deploys a tag, or changes secrets or snapshots. The checkout must be owned by root (or listed in root's `safe.directory`) so `git status` works; the deploy refuses when `git status --porcelain -- deploy` reports any change.

```console
sudo MAWAREETH_RELEASE_MANIFEST=/etc/mawareeth/release-manifest.json deploy/runtime.sh prepare
sudo MAWAREETH_RELEASE_MANIFEST=/etc/mawareeth/release-manifest.json deploy/release.sh deploy
# only for a deliberate contract release (see step 3):
sudo MAWAREETH_RELEASE_MANIFEST=/etc/mawareeth/release-manifest.json deploy/release.sh deploy --allow-contract
```

The deploy holds an exclusive non-blocking `flock` on `<state dir>/deploy.lock` for its whole run and journals each phase atomically (temporary file, `fsync`, rename, directory `fsync`) to root-only `<state dir>/deploy.journal` before acting: `idle → candidate-starting → migrating → candidate-ready → switching → verifying → draining → idle`. The journal has eleven lines: `phase`, `prior_slot` (empty for bootstrap), `candidate_slot`, `manifest_commit`, `prior_commit`, `result` (`in-progress`, `verified`, `success`, or `failed:<phase>`), `started_at`, `updated_at`, `deploy_log`, `migrate_log`, and `records`. `records=untouched` means the candidate's slot record has not been touched; in `switching` the deploy first publishes `<candidate>.env.prev` (the pre-deploy record, or removes it when there was none), then journals `records=replaced`, and only then writes the candidate record and the route. Journals written before `records=` existed have ten lines; the deploy and the runtime still parse them, but `recover` refuses them. A deploy refuses to start unless the journal is absent or a well-formed, root-owned mode-0600 file with `phase=idle`.

1. Preflight reuses `runtime.sh` validation of the runtime file, manifest, local images, and Compose model. The active slot is read from the persisted route; the candidate is always the other, idle slot. The deploy refuses (exit 2) when the current runtime configuration does not hash to the snapshot recorded for the active slot (rotate configuration separately), when the active slot's container does not run its recorded image, when the active slot is not ready, when the running Caddy container was created from a different Compose model (a reload cannot fix stale mounts; run `runtime.sh up` first), or when the production edge does not already confirm the active slot (its `X-Mawareeth-Slot` header on `/health/ready/` over verified TLS, and its commit read directly from the slot; see step 6). Bootstrap instead refuses when any slot or Caddy is already running without slot records (a pre-0.6 runtime is live; migrate it manually).
2. The candidate slot is recreated with the manifest image, its container's image ID must equal the local manifest image, and it must answer `/health/live/`.
3. **Contract gate.** While the journal still says `candidate-starting`, `python manage.py migrate --plan --no-color` runs inside the candidate (bounded by `MAWAREETH_DEPLOY_MIGRATE_TIMEOUT`) and its stdout and stderr are appended to the migrate log only; only stdout is matched. If the plan cannot be computed, or if any plan operation (a line of four spaces followed by Django's description) starts with one of these seven phrases, the candidate is aborted (exit 5, route unchanged, `result=failed:candidate-starting`) before anything is migrated:

   | Plan phrase | Django operation |
   |-------------|------------------|
   | `Remove field ` | `RemoveField` |
   | `Delete model ` | `DeleteModel` |
   | `Rename field ` | `RenameField` |
   | `Rename model ` | `RenameModel` |
   | `Rename table for ` | `AlterModelTable` |
   | `Raw SQL operation` | `RunSQL` (its effect cannot be inferred from the plan) |
   | `Custom state/database change combination` | `SeparateDatabaseAndState` |

   Those operations can break the old slot that keeps serving during the handover. The terminal names `--allow-contract` and the migrate log path but never shows the plan. Ship removals, renames and raw schema changes as a separate contract release once no serving release uses the old schema, review the plan in the migrate log, and only then pass `release.sh deploy --allow-contract`; the deploy log and the migrate log record that contract operations were allowed. There is no environment-variable bypass. Other operations (add, create, alter, `RunPython` data migrations) pass the gate, so their backward compatibility still rests on review and on step 4's check of the active slot. The most common break the gate cannot see is an `Add field` of a NOT NULL column without a database default (`db_default`): the old slot's inserts omit it and fail. Add such columns as nullable or with `db_default` first. **Rollback warning:** after a release deployed with `--allow-contract`, rolling back (deploying the previous release again, or `recover` restoring the prior slot) puts the old code on a schema it may not support, because applied migrations are never reversed; treat such a release as forward-only and fix forward.
   Then exactly one `python manage.py migrate --noinput` runs inside the candidate. Its output is never printed (it can contain connection details) and is appended to the deploy's migrate log.
4. The candidate must answer `/health/ready/` (all of its migrations applied) and `/health/release/` must report the manifest commit; both are retried until their deadline. The active slot must still be ready after the migration, otherwise the migration may not be backward compatible and the deploy stops with the route unchanged.
5. The candidate's slot record is written (see above), the route file is replaced atomically, and Caddy is reloaded (or started if it is not running). The Caddy state is read with `docker compose ps --all`; Compose errors and `restarting` are retried a bounded number of times and `paused` is refused, so a failing `ps` is never mistaken for "Caddy is stopped".
6. Production is verified through Caddy with `curl --resolve DOMAIN:443:127.0.0.1` and full certificate validation: `/health/ready/` must succeed and carry `X-Mawareeth-Slot: <candidate>`, which proves the edge routes to the candidate. Caddy answers `/health/release*` with `404` for every client, so the commit is then read from that slot directly (its `/health/release/` probed inside its container) and must equal the manifest commit. The journal then records `result=verified`. The pre-deploy check of the active slot and the restore and `recover` checks of the prior slot use the same two steps.
7. Only then is the old slot stopped gracefully (`stop -t 35`, above gunicorn's 30s graceful timeout).

On any failure before step 5 the route never moves and the candidate is stopped. On a failure in steps 5-6 the prior route file is restored and reloaded only if it had already been replaced, the edge must then confirm the prior slot's header and commit, the candidate's records are restored, and the candidate is stopped; the old slot was never stopped. Applied migrations are never reversed or faked. Every wait is bounded and every probe attempt is capped at the remaining deadline; tune with `MAWAREETH_DEPLOY_LIVE_TIMEOUT` (default 120s), `MAWAREETH_DEPLOY_READY_TIMEOUT` (180s), `MAWAREETH_DEPLOY_MIGRATE_TIMEOUT` (900s), `MAWAREETH_DEPLOY_VERIFY_TIMEOUT` (60s), and `MAWAREETH_DEPLOY_POLL_INTERVAL` (2s).

Hangup, interrupt, and termination signals are trapped. Before the first mutation they end the deploy with nothing changed; afterwards they take the same failure path as an error in the current phase, and the restore itself ignores further signals. Terminal output failures (for example a closed SSH session) never abort the deploy.

**Diagnostic logs.** Each deploy creates its own root-owned mode-0600 pair in the root-only directory `<state dir>/logs/`: `deploy-<UTC time>-<pid>.log` (Compose, probe, and curl diagnostics plus every terminal message) and `migrate-<UTC time>-<pid>.log` (the migration output, which can contain connection details). The journal names both. Nothing rotates or deletes them: keep at least the logs of the current and previous releases and of any failed deploy until it is understood, and delete older pairs deliberately (for example after 90 days) as root. Never copy them to tickets or chat without redacting credentials.

**Bootstrap.** When no slot record exists (a fresh host), `release.sh deploy` targets blue: it starts PostgreSQL, starts and migrates blue, gates it on image, readiness, and identity, records it, seeds the route, starts Caddy, and verifies the edge. On failure before routing nothing is served; on a failure after Caddy started, Caddy and blue are stopped and blue's records are restored, so no route is ever served from an unverified slot. Before the first run, check from outside the host that the domain's public A/AAAA records resolve to this host only, that inbound TCP 80 and 443 reach it (Hetzner and host firewalls), that nothing else listens on 80/443 on the host, and that outbound DNS and TCP 443 work for ACME. Caddy obtains the certificate on its first start; each failed bootstrap retries issuance, and Let's Encrypt limits failed validations (currently 5 per account, hostname, and hour), so after one ACME-related failure fix DNS or the firewall and confirm with the deploy log before retrying. Raise `MAWAREETH_DEPLOY_VERIFY_TIMEOUT` for this first run if issuance may exceed 60s.

| Exit | Meaning | Production state |
|------|---------|------------------|
| 0 | Deployed and verified; old slot drained | Candidate serves; journal idle with `result=success` |
| 2 | Refused before mutation: invalid input, configuration drift, dirty bundle, active slot not ready or not on its recorded image, stale Caddy container, edge not confirming the active slot (wrong or missing `X-Mawareeth-Slot` on `/health/ready/`, or the slot's direct `/health/release/` reporting another commit), live legacy runtime at bootstrap, or journal write failure | Nothing changed |
| 3 | Another deploy or runtime operation holds the lock | Nothing changed |
| 4 | Journal is not idle, or is malformed or unsafe | Nothing changed; run `release.sh recover` |
| 5 | Candidate failed to start on the manifest image, become live, pass the contract gate (plan failed, or any of the seven contract operations without `--allow-contract`), migrate, become ready, or report the commit; the active slot became unready after the migration; or a signal or unexpected error arrived in these phases | Route unchanged; candidate stopped; journal idle with `result=failed:<phase>` |
| 6 | The switch, Caddy reload, or production TLS verification (edge slot header on `/health/ready/`, or the candidate's direct commit) failed, or a signal or unexpected error arrived during switching or verifying | Prior route restored (if it was changed) and confirmed at the edge (bootstrap: Caddy stopped); candidate records restored; old slot serving; journal idle with `result=failed:<phase>` |
| 7 | CRITICAL: restoring the prior state failed or could not be confirmed at the edge | Caddy may target the unverified candidate; journal `phase=restore-failed`; run `release.sh recover` now |
| 8 | Verified release serves, but the old slot could not be drained, the journal could not be advanced, or the deploy stopped unexpectedly after verification | Candidate serves; journal left non-idle with `result=verified`; run `release.sh recover` |
| 129, 130, 143 | Hangup, interrupt, or termination before the first mutation | Nothing changed |

**Migration timeout caveat.** `MAWAREETH_DEPLOY_MIGRATE_TIMEOUT` stops waiting for `docker compose exec`, but the migration process inside the container can continue until the candidate is stopped by the failure path. On PostgreSQL Django applies each migration in its own transaction, so an interrupted run normally leaves a prefix of complete migrations applied. The exceptions can be left half applied: migrations declared with `atomic = False`, `RunPython`/`RunSQL` operations that run outside a transaction (including `RunSQL` that commits on its own), and concurrent index operations (`AddIndexConcurrently`, `RemoveIndexConcurrently`, `CREATE INDEX CONCURRENTLY`), which cannot run in a transaction and can leave an `INVALID` index. Keep such operations idempotent and in their own migration, size the timeout for the slowest expected migration, and schedule long data migrations as a separate, deliberate release.

**Expand-migrate-contract.** Old and new releases run against the same schema during a deploy, and a failed deploy leaves new migrations applied while the old slot keeps serving. Every release's migrations must therefore be backward-compatible with the release currently serving: *expand* (add nullable or defaulted columns, new tables, new indexes) in one release; *migrate* data and switch code to the new shape in a following release; *contract* (drop or rename columns/tables, add `NOT NULL` without a default) only in a later release once no serving or rollback-candidate release reads the old shape. Never edit or squash migrations that production has applied. Automated detection of contract operations is deferred.

**Rollback** is a forward deploy of an earlier release: check out its deployment-bundle commit, make sure its image is loaded, and run `release.sh deploy` with its manifest. It must be compatible with the current schema, which the expand-migrate-contract rules guarantee for the immediately preceding release. Because 0.6 introduces this deployment contract, the oldest bundle you can roll back to with `release.sh` is this release.

### Crash recovery

After a deploy exits 4, 7 or 8, or crashes (power loss, `SIGKILL`), the journal stays non-idle and every deploy and mutating runtime command is refused. Recover as root from the deployment checkout; no release manifest is needed:

```console
sudo deploy/release.sh recover --dry-run
sudo deploy/release.sh recover
```

`recover` holds the deploy lock for its whole run and takes images, commits, and snapshots only from the slot records and the journal. Before changing anything it refuses (exit 2) when the current runtime configuration does not hash to the snapshot recorded for the slot that must serve: restore the runtime file matching the recorded snapshot (rotate configuration separately). When a slot must serve, it first starts PostgreSQL if it is not running (bounded by `MAWAREETH_RUNTIME_WAIT_TIMEOUT`, default 300s), because `runtime.sh up` refuses while the journal is not idle. It decides which slot must serve: the candidate if the journal has `result=verified` or `phase=draining` (it was verified at the edge), otherwise the prior slot; for an unverified bootstrap (`prior_slot` empty) nothing may serve. Then:

- **Abandoned candidate** (not verified, prior slot set): with `records=replaced` the candidate's record is restored from `<candidate>.env.prev` (or removed when there is no `.prev`, because the slot had no record before the deploy); with `records=untouched` the records are left as they are. The prior slot is started on its recorded image if it is not already running it, must answer `/health/ready/` and report the journaled prior commit, the route is pointed at it (only if needed), Caddy is reloaded (or started), and the edge must confirm its `X-Mawareeth-Slot` header and commit over verified TLS. Only then is the candidate stopped, and only after that are its records restored, so if `recover` fails midway the records still describe what runs; the journal is then reset to `idle` with `result=failed:<phase>` and `records=untouched`.
- **Verified candidate**: the same route, reload, and edge confirmation for the candidate with the manifest commit; then the prior slot is stopped and the journal reset to `idle` with `result=success`.
- **Unverified bootstrap**: Caddy is stopped and must be confirmed stopped, the candidate is stopped, its record is removed or restored as above, and the journal is reset to `idle`. Because only `stop` runs, Compose is given the candidate's recorded snapshot, else its `.prev`'s, else a protected temporary rendering that is removed on exit (`prepare`, the usual remedy for a missing snapshot, refuses a non-idle journal).

`--dry-run` prints the slot that will serve and the record, route, and stop actions, and changes nothing. With an absent or idle journal, `recover` prints "nothing to recover" and exits 0, so running it twice is harmless. It never runs, reverses, or fakes migrations, never builds or pulls images, never redeploys, and never starts a slot other than the one that must serve. Every wait is bounded: readiness and release identity by `MAWAREETH_DEPLOY_READY_TIMEOUT` (default 180s), edge confirmation by `MAWAREETH_DEPLOY_VERIFY_TIMEOUT` (60s), the PostgreSQL start by `MAWAREETH_RUNTIME_WAIT_TIMEOUT` (300s), each Compose command by a fixed 60s and each stop by `stop -t 35` within a 65s limit, with retries spaced by `MAWAREETH_DEPLOY_POLL_INTERVAL` (2s). `recover` writes its own diagnostics to a root-only `<state dir>/logs/recover-<UTC time>-<pid>.log`, whose path it prints on the terminal; the reset journal keeps the deploy's own `deploy_log` and `migrate_log` paths. The deploy overwrites the candidate's older `.prev` in its `switching` step: it is replaced by the pre-deploy record on success, after a crash at or after the `.prev` write, and when `recover` rolls back (`.prev` then equals the restored record). Keep older records elsewhere if you need them.

| Exit | Meaning | Journal |
|------|---------|---------|
| 0 | Recovered; or nothing to recover; or a dry run printed its plan | Idle (unchanged for a dry run) |
| 2 | Refused before any change: invalid arguments or input; the journal is malformed, unsafe (owner or mode), in the legacy ten-line format, or non-idle with `result=success`; the slot records contradict it (for example a record commit differs from the journaled commit); the target's recorded snapshot is missing or drifted; the target's image is not loaded; or the runtime configuration differs from the target's recorded snapshot | Unchanged; fix the cause or use the manual steps below |
| 3 | Another deploy or runtime operation holds the lock. After a crash, a leftover process of the crashed deploy may still hold `deploy.lock`: check for it (for example `fuser -v <state dir>/deploy.lock`) before retrying | Unchanged |
| 7 | CRITICAL: PostgreSQL or the serving slot did not start or become ready, the slot reported the wrong commit, Caddy could not be reloaded or stopped, the edge did not confirm the slot, the other slot could not be stopped, the records or the journal could not be written, or a signal arrived after recover began changing state | Unchanged (non-idle); the message says what was and was not changed; fix the cause, then run `recover` again |
| 129, 130, 143 | Hangup, interrupt, or termination before any change | Unchanged |

`recover` does not fall back to the prior slot when a verified candidate is not ready; that is an operator decision.

**Manual recovery** is the fallback when `recover` refuses (exit 2), for example for a legacy ten-line journal. Run every step as root from the deployment checkout with `STATE=<state dir>` (default `deploy/runtime`):

1. Read `$STATE/deploy.journal`, the persisted route `$STATE/routes/active-slot.caddy`, the deploy and migrate logs the journal names, and `deploy/runtime.sh status`.
2. Decide which slot must serve: the candidate if the journal has `result=verified` or `phase=draining` (it was verified at the edge), otherwise the prior slot. For a bootstrap (`prior_slot` empty) that is not verified, Caddy must stay stopped (`docker compose -p mawareeth stop caddy`).
3. If the route file does not target that slot, rebuild it from the tracked seed and publish it atomically, with `SLOT` set to `blue` or `green`:

   ```console
   sed "s/app-blue:8000/app-$SLOT:8000/; s/X-Mawareeth-Slot blue/X-Mawareeth-Slot $SLOT/" deploy/caddy/active-slot.caddy > "$STATE/routes/.recover.caddy.tmp"
   install -o root -g root -m 0644 "$STATE/routes/.recover.caddy.tmp" "$STATE/routes/.recover.tmp" && rm "$STATE/routes/.recover.caddy.tmp"
   sync "$STATE/routes/.recover.tmp" && mv "$STATE/routes/.recover.tmp" "$STATE/routes/active-slot.caddy" && sync "$STATE/routes"
   ```

   The route stays mode 0644 because Caddy reads it; the runtime refuses any other mode and any extra `*.caddy` file in that directory.
4. Ensure that slot is running and healthy, reload Caddy with `docker compose -p mawareeth exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`, and confirm `curl -sD - --resolve DOMAIN:443:127.0.0.1 https://DOMAIN/health/ready/` shows the expected `X-Mawareeth-Slot`, and that the slot reports the expected commit when probed directly (`docker compose -p mawareeth exec -T app-<slot> python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health/release/').read().decode())"`); through Caddy `/health/release/` answers `404`.
5. Make `$STATE/slots/<slot>.env` match what each slot runs: for an abandoned candidate restore `<slot>.env.prev` to `<slot>.env` (or remove the record if the candidate had none before). Records are root-owned mode 0600; publish them with `install -o root -g root -m 0600` to a temporary file in `$STATE/slots`, `sync`, and `mv`.
6. Stop the slot that is not routed with `docker compose -p mawareeth stop -t 35 app-<slot>`.
7. Reset the journal atomically: write the same lines (ten or eleven) with `phase=idle` (keep `result` as a `failed:<phase>` or `success` value), publish it with `install -o root -g root -m 0600` to a temporary file in `$STATE`, `sync`, and `mv` it over `deploy.journal`, or remove the journal.

## Encrypted backup and restore

`deploy/backup.sh` backs PostgreSQL up off-host into a client-side encrypted [Restic](https://restic.net/) repository on a dedicated Hetzner BX11 Storage Box sub-account, proves monthly that the latest dump restores, and gates irreplaceable writes on that proof. Restic runs only from the `RESTIC_IMAGE` pinned by digest in `runtime-images.lock` (load it like the other runtime images and check its `RepoDigests`); the script never builds or pulls. It never takes the deploy lock and never writes slots, routes, the deploy journal, or runtime snapshots; it only reads the runtime file, slots, routes, and the snapshots the slot records name, to archive them as encrypted host state. Run every command as root.

### One-time setup

1. **Storage Box.** Order a BX11 Storage Box, enable SSH support, and create a dedicated sub-account (for example `u123456-sub1`) whose home directory holds only this repository; do not share it with any other data or host. Generate a passphrase-less key on the host with `ssh-keygen -t ed25519 -N '' -f /etc/mawareeth/storagebox_ed25519`, install its public half for the sub-account (`.ssh/authorized_keys` on the Storage Box, port 23), and keep the private key `root:root` mode 0600.
2. **Host key pin.** Fetch the Storage Box host key once (`ssh-keyscan -p 23 u123456.your-storagebox.de`), compare its fingerprint with the fingerprints Hetzner publishes for Storage Boxes, and only then save it as `/etc/mawareeth/storagebox_known_hosts` (`root:root`, mode 0600 or 0644). Restic connects with `ssh -p 23 ... -o StrictHostKeyChecking=yes`, so an unknown or changed host key fails the run.
3. **Configuration.** Copy `backup.env.example` to `/etc/mawareeth/backup.env` (`root:root` 0600). It uses the same strict raw `KEY=VALUE` format as `runtime.env` and accepts exactly `STORAGE_BOX_USER`, `STORAGE_BOX_HOST`, and `RESTIC_REPOSITORY_PATH` (a path relative to the sub-account home). Restic secrets never go into `runtime.env`, CI, logs, or command lines.
4. **Repository password.** Create a long random password, e.g. `(umask 077; head -c 32 /dev/urandom | base64 > /etc/mawareeth/restic.password)` (`root:root` 0600). Without it the backups are unreadable.
5. **Escrow all four secrets before the first backup.** A lost host loses every copy on it, so store `backup.env`, `restic.password`, `storagebox_ed25519`, and `storagebox_known_hosts` off-host in an approved secret store, and keep the **password in two independent off-host places** (for example two password managers, or one password manager plus a sealed offline copy) held by different people. Record where they are, and test one password copy during each restore rehearsal. If the SSH key is lost with the host, regain access by generating a new key on the replacement host and registering its public key for the sub-account in Hetzner Robot (Storage Box → sub-account → SSH keys, or by resetting the sub-account password and installing the key over SFTP); the repository itself only needs the escrowed password.
6. **Initialise, prove, schedule.**

   ```console
   sudo deploy/backup.sh init
   sudo deploy/backup.sh backup
   sudo deploy/backup.sh verify-restore
   sudo deploy/backup.sh install
   sudo deploy/backup.sh status
   ```

   Run the first `verify-restore` by hand right after the first successful backup so the gate opens immediately; do not wait for the monthly timer. `install` writes `mawareeth-backup.{service,timer}` (daily at 02:30 with `RandomizedDelaySec=15m`, `Persistent=true`) and `mawareeth-restore-check.{service,timer}` (monthly, on the 1st at 04:00, `Persistent=true`) to `/etc/systemd/system`, then enables both timers. Both services set `HOME=/root`, pin the current checkout, state directory, runtime file, image lock, and configuration directory, and run at low priority (`Nice=10`, `IOSchedulingClass=idle`, `CPUSchedulingPolicy=batch`; this applies to the script and Docker clients, not to work inside containers) with `TimeoutStartSec=5h` and `TimeoutStopSec=900`. The restore check retries failures hourly (`Restart=on-failure`, `RestartSec=1h`, at most 7 starts in 12h), so a check blocked by a running backup (exit 3) or failing as `stale` after one bad night does not leave the gate closed for a month; configuration refusals (exit 2) are not retried. Re-run `install` after moving the checkout. Inspect runs with `systemctl list-timers 'mawareeth-*'` and `journalctl -u mawareeth-backup.service`.

**Bumping the Restic pin.** Change the `RESTIC_IMAGE` line in `runtime-images.lock` and the matching allowlist value in `load_lock` in `runtime.sh` in the same commit (the lock is refused otherwise), load and inspect the new image on the host, then run `backup` and `verify-restore` by hand.

### What each command does

- **`backup`** takes a non-blocking lock on `<state dir>/backup.lock` (exit 3 if held), removes Restic containers left by earlier runs (and fails if one is still running), forgets snapshots left `pending` by earlier failed runs, and finds the one running Compose PostgreSQL container by its labels. In one `psql` session it opens a `REPEATABLE READ` transaction, exports its snapshot, reads `SHOW server_version_num` (it must be a six-digit number, i.e. PostgreSQL 10 or later; the major is that value divided by 10000, always two digits, 10–99) and `SHOW is_superuser` (it must be `on` or `off`), applies fixed output settings (`TimeZone=UTC`, `DateStyle=ISO, YMD`, `IntervalStyle=postgres`, `extra_float_digits=1`, `bytea_output=hex`, `lc_monetary=C`, and an empty `search_path`, which is safe because every table is named `%I.%I`-qualified and every function and type used is in `pg_catalog`, so the checksums cannot depend on the role's or database's `search_path`), and takes, for every user table except other sessions' temporary schemas, an exact `count(*)` and an order-independent content checksum, keyed by `format('%I.%I')`; the manifest must include `public.django_migrations`. The checksum is the sum of the signed 64-bit prefixes of `md5(row::text)` over every row (constant memory, no sort); it detects corruption but is not tamper-proof, which is acceptable because Restic already encrypts and authenticates the archive. `pg_dump -Fc --snapshot=<id>` then streams that same snapshot straight into Restic (`mawareeth.dump`, also tagged `pg-major:<N>`), so dump, counts, and checksums describe the same data. `psql` and `pg_dump` run under `timeout` inside the container too. The manifest is stored as `manifest.tsv`, one `key<TAB>count<TAB>checksum` line per table. A third snapshot, `globals.sql`, is `pg_dumpall --globals-only` (roles with their password hashes, role settings, tablespaces) streamed straight into Restic; a failed `pg_dumpall` or upload fails the run at stage `globals`. Only a superuser can read role password hashes, so when the backup role is not a superuser the globals are taken with `--no-role-passwords` (the roles without their passwords), the run log says why, the run is still `ok`, and `last-backup` records `globals_role_passwords=0` (`1` with the hashes). After restoring from such a `globals.sql`, the roles have no passwords: list them with `pg psql -U "$PGU" -d "$PGD" -c '\du'` (helpers from the [manual restore runbook](#manual-restore-runbook)) and set each login role's password with `ALTER ROLE <role> PASSWORD '<password>'`; the application role's password is `POSTGRES_PASSWORD` in `/etc/mawareeth/runtime.env`. It is kept for a manual recovery and never restored automatically. A fourth snapshot, `host-state.tar`, is a tar of an explicit member list, without recursion: `runtime.env`, `<state dir>/routes/` and its `active-slot.caddy`, `<state dir>/slots/` (when it exists) with each blue or green record and `.prev`, and every `*.snapshot.env` those records name (once each). It is streamed straight into Restic (`tar --numeric-owner --no-recursion`, never written to disk); stray files such as `slots/.tmp.*`, the deploy journal, and the other `/etc/mawareeth` secrets are not archived. A missing or non-regular runtime or route file, a missing routes directory, an unusable record, a record that names a missing snapshot, or a failed `tar` or upload fails the run at stage `host-state`. The verify stage also reads the stored archive back and requires the runtime file among its members, and reads `globals.sql` back (in memory) and requires its `-- PostgreSQL database cluster dump` line. The archive is taken without the deploy lock, so a capture made mid-deploy can pair a new record with the old route. All four snapshots are tagged `pending,run:<UTC stamp>-<pid>`; the whole stored dump is read back (verifying every blob) and must start with `PGDMP` before all four are re-tagged `complete`. `restic tag` rewrites snapshots under new IDs, so the new IDs are re-read and recorded. Retention is `forget --tag complete --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune`. Unencrypted dump bytes never touch the host disk. Every stage is capped against one 4-hour budget, and every Restic container has a deterministic name and is force-removed if its client fails or times out. Any failed stage before retention forgets every snapshot of the run.
- **`verify-restore`** runs `restic check` (metadata, not `--read-data`), picks the newest `complete` dump that has exactly one manifest of the same run, refuses a dump older than 24 hours or dated more than 5 minutes in the future (RPO, clock skew), requires free space on Docker's data root of at least 3× the dump size, starts a throwaway PostgreSQL from the pinned image with `--network none`, a labelled temporary volume, and a random password, refuses (`version-mismatch`) a dump whose `pg-major:` tag is duplicated or malformed (anything but a two-digit major, 10–99), or missing from a run with a checksum manifest (both before any throwaway exists), or differs from the throwaway server's major (before `pg_restore`); a legacy run with a counts-only manifest and no tag is restored as before, restores it with `pg_restore --exit-on-error --no-owner --no-acl`, applies the same output settings, and compares every table count (including `django_migrations`) with the manifest first (`count-mismatch`) and then every content checksum (`checksum-mismatch`); the differing lines go to the run log. A manifest from an older script, whose lines are all `key<TAB>count`, is verified on counts alone with the original counts-only query (`content_checksums=0`); a manifest that mixes both line formats is refused (`manifest`). Because every user table is checksummed, `django_migrations` content is covered exactly. It requires the whole run to finish within 4 hours (RTO; every stage is capped against that budget and an exhausted budget is `slow`); the RTO includes the count and checksum pass after `pg_restore`, and the evidence's `restore_seconds` (start to the end of `pg_restore`) shows how much of `duration_seconds` the restore itself took. The throwaway container and volume are removed on every exit path; a removal failure is reported as `CRITICAL`. It never touches the production database or volume.
- **`gate`** exits 0 only when the restore evidence says `pass` and is at most 35 days old **and** the last backup is `ok` and at most 26 hours old; otherwise it exits 1 and names each unmet condition. Malformed timestamps fail closed.
- **`status`** prints the last backup status, the restore evidence, and the gate verdict.

| Exit | Meaning |
|------|---------|
| 0 | Success (gate: recovery is proven) |
| 1 | Gate not satisfied |
| 2 | Refused before any change: invalid configuration, unsafe file ownership or mode, unpinned or wrongly pinned image |
| 3 | Another backup operation holds the backup lock |
| 5 | Backup failed; `last-backup` has `result=failed:<stage>`: `setup` (cache volume or a still-running leftover Restic container), `repository` (unreachable, host key rejected, or stale-pending cleanup failed), `postgres` (zero or several PostgreSQL containers), `dump` (snapshot transaction, a `server_version_num` that is not a six-digit number (PostgreSQL 10+), an `is_superuser` that is neither `on` nor `off`, counting and checksumming, `pg_dump`, or storing the dump), `manifest` (no tables, no `public.django_migrations`, or storing the manifest), `globals` (`pg_dumpall --globals-only` or storing its output failed), `host-state` (the runtime file, routes directory, or route file is missing or not regular, a slot record is unusable or names a missing snapshot, or archiving or storing the host state failed), `verify` (snapshot IDs, `PGDMP` read-back, a host-state archive that does not read back with the runtime file, or a `globals.sql` that does not read back with its `-- PostgreSQL database cluster dump` line), `tag`, or `retention` (the run's complete snapshots are kept). The terminal never shows Restic or SSH output; `init` failures also exit 5 |
| 6 | Restore verification failed; `restore-verified` has `result=fail:<reason>`: `no-backup` (no complete dump), `manifest` (no dump with exactly one manifest, or an empty, malformed, mixed counts-only and checksum, or `django_migrations`-less manifest), `repository` (unreachable, `restic check` failed, unparseable listing, or a read failed), `stale` (older than 24h or future-dated), `setup` (disk space, volume inspection or creation, container start, readiness, an unreadable throwaway server version, or a refusal mid-run), `version-mismatch` (the dump's `pg-major:` tag differs from the throwaway server's major, is duplicated or malformed, or is missing from a run with a checksum manifest; `pg_restore` never ran), `restore` (`pg_restore` failed), `count` (counting failed), `count-mismatch`, `checksum-mismatch` (counts match but a table's content checksum differs), `cleanup`, `slow` (RTO exceeded), or `interrupted` (signal) |
| 129, 130, 143 | Hangup, interrupt, or termination before the operation started (afterwards a signal maps to 5 or 6) |

**Evidence.** The root-only (0700) directory `<state dir>/backup/` holds `last-backup` and `restore-verified`, each a mode-0600 `key=value` file published atomically. `last-backup` records the result, run, finish time, the dump, manifest, host-state, and globals snapshot IDs (`host_state_snapshot`, `globals_snapshot`), the server major (`pg_major`), and whether the globals hold role password hashes (`globals_role_passwords=1`, `0` for a role that is not a superuser, empty for any run that is not `ok`). `restore-verified` records the result, verification time, backup run, snapshot IDs, dump time and age, duration (`duration_seconds`, the whole run), the time to the end of `pg_restore` (`restore_seconds`, empty when the run stopped earlier), table count, whether content checksums were compared (`content_checksums=1`, `0` for a counts-only manifest, or empty when the manifest was refused or the run stopped before reading it), the dump's and the throwaway server's majors (`dump_pg_major`, empty for a dump without a `pg-major:` tag, and `restore_pg_major`), RPO/RTO, and its log. Per-run diagnostic logs (Restic, SSH, and PostgreSQL output) are kept in `<state dir>/backup/logs/` (0600). Like the deploy logs they are never rotated automatically: prune old ones deliberately as root and redact them before sharing.

**Real RPO.** A nightly run starts between 02:30 and 02:45 and the dump takes its own time, so successive recovery points are about 24 hours apart plus that jitter and the dump time; the gate tolerates 26 hours. One failed night means 48 hours or more without a new recovery point; `MawareethBackupUnhealthy` emails the operator when the last backup is not `ok` or its last success is older than 26 hours (see [Monitoring and alerting](#monitoring-and-alerting)).

**Cutover precondition.** `sudo deploy/backup.sh gate` must exit 0 before production accepts irreplaceable writes (story 0.10).

### Manual restore runbook

For a real recovery (a rebuilt host, or a deliberate data rollback), run as root from the deployment checkout on a host with the runtime images loaded and the four secrets under `/etc/mawareeth` restored from escrow. Set `STATE` to the absolute state directory (default `<checkout>/deploy/runtime`).

1. Stop the timers and the writers:

   ```console
   systemctl stop mawareeth-backup.timer mawareeth-restore-check.timer mawareeth-backup.service mawareeth-restore-check.service
   docker compose -p mawareeth stop app-blue app-green caddy
   ```

2. Define the helpers. Restic runs exactly like the script (secrets stay in mounted files, same SSH options) and holds `backup.lock` for each call:

   ```console
   STATE="$(realpath deploy/runtime)"; LOCK="$STATE/backup.lock"; install -d -o root -g root -m 0700 "$STATE"
   U="$(sed -n 's/^STORAGE_BOX_USER=//p' /etc/mawareeth/backup.env)"; H="$(sed -n 's/^STORAGE_BOX_HOST=//p' /etc/mawareeth/backup.env)"
   P="$(sed -n 's/^RESTIC_REPOSITORY_PATH=//p' /etc/mawareeth/backup.env)"; IMAGE="$(sed -n 's/^RESTIC_IMAGE=//p' deploy/runtime-images.lock)"
   PGU="$(sed -n 's/^POSTGRES_USER=//p' /etc/mawareeth/runtime.env)"; PGD="$(sed -n 's/^POSTGRES_DB=//p' /etc/mawareeth/runtime.env)"
   restic() { RESTIC_REPOSITORY="sftp:$U@$H:$P" flock -n "$LOCK" docker run --rm -i -e RESTIC_REPOSITORY -e RESTIC_PASSWORD_FILE=/run/mawareeth/restic.password \
     -v /etc/mawareeth/restic.password:/run/mawareeth/restic.password:ro -v /etc/mawareeth/storagebox_ed25519:/run/mawareeth/storagebox_ed25519:ro \
     -v /etc/mawareeth/storagebox_known_hosts:/run/mawareeth/known_hosts:ro "$IMAGE" \
     -o "sftp.command=ssh -p 23 -i /run/mawareeth/storagebox_ed25519 -o UserKnownHostsFile=/run/mawareeth/known_hosts -o StrictHostKeyChecking=yes -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=30 -o ServerAliveInterval=30 -o ServerAliveCountMax=4 $U@$H -s sftp" "$@"; }
   pg() { docker exec -i "$(docker ps -q --filter label=com.docker.compose.project=mawareeth --filter label=com.docker.compose.service=postgres)" "$@"; }
   restic snapshots --tag complete
   ```

3. Choose the dump snapshot `ID` and the manifest snapshot `MANIFEST_ID` that share its `run:` tag, and the `host-state.tar` snapshot `HOST_ID` and `globals.sql` snapshot `GLOBALS_ID` of the same run (runs from before host-state archiving have no `HOST_ID`; recreate `runtime.env`, slot records, and routes by hand for those; runs from before globals archiving have no `GLOBALS_ID`). Note the dump's `pg-major:<N>` tag: restore only into a PostgreSQL of that major (`pg psql -X -A -t -U "$PGU" -d "$PGD" -c 'SHOW server_version_num'` divided by 10000, once PostgreSQL runs in step 6). For a major upgrade, restore into the old major first and upgrade afterwards. A dump without the tag predates it; check the image it was taken with by hand.
4. **Rebuilt host only:** restore the host state before `prepare`. It brings back `runtime.env`, the route, the slot records (with `.prev`), and the snapshots they name at their original absolute paths, owned by numeric IDs, so restore into the same paths as the old host. List the members first and confirm they are exactly this host's runtime file (default `etc/mawareeth/runtime.env`) and entries under `${STATE#/}`; if not, stop and align `MAWAREETH_RUNTIME_FILE` and the state directory with the old host. **The extract overwrites an existing `runtime.env`** (and any route or record already there), so keep a copy of any file you wrote by hand:

   ```console
   install -d -o root -g root -m 0700 /etc/mawareeth
   restic dump HOST_ID /host-state.tar | tar -t
   restic dump HOST_ID /host-state.tar | tar -x --numeric-owner -C /
   MAWAREETH_RELEASE_MANIFEST=/root/release-manifest.json deploy/runtime.sh status
   ```

   The release manifest for the `status` check is the `release-manifest.json` of the commit in the restored slot record of the routed slot (`COMMIT=` in `$STATE/slots/<slot>.env`): download the workflow's `release-manifest-<commit>` artifact, or your archived copy of it, as described in [Immutable release artifacts](#immutable-release-artifacts), and keep it root-only (mode 0600). The deploy journal is not archived: an absent journal means idle. The archive is a point-in-time copy taken without the deploy lock, so a backup that ran during a deploy can pair a new slot record with the old route. Check that `runtime.sh status` and the restored route and records agree (the routed slot's record names the release you mean to serve); if they disagree, fix them with the [Crash recovery](#crash-recovery) steps (`release.sh recover`, or its manual recovery fallback) before deploying. On a data rollback of an existing host, skip this step: its host state is current.
5. **Data rollback on an existing host: never destroy the current data.** Take a final backup (`deploy/backup.sh backup`, with the timers still stopped), stop PostgreSQL (`docker compose -p mawareeth stop postgres`), and keep the current volume: copy it into a retained volume such as `mawareeth-postgres-data-before-<date>` (`docker volume create mawareeth-postgres-data-before-<date>` then `docker run --rm --network none -v mawareeth-postgres-data:/from:ro -v mawareeth-postgres-data-before-<date>:/to IMAGE_POSTGRES sh -c 'cp -a /from/. /to/'`). Only after the copy is verified, remove `mawareeth-postgres-data` so `runtime.sh prepare` creates a fresh empty one. On a rebuilt host the volume is already new and empty.
6. Start only PostgreSQL on the empty volume (`deploy/runtime.sh prepare`, then `docker compose -p mawareeth start postgres` or `runtime.sh up` with the release manifest and stop the slot again) and stream the dump in without writing it to disk:

   ```console
   restic dump ID /mawareeth.dump | pg pg_restore --exit-on-error --no-owner --no-acl -U "$PGU" -d "$PGD"
   ```

7. Compare the counts, then the content checksums, with the manifest. The output settings must come first, exactly as in `backup.sh`, or the checksums of date, time, interval, float, `money`, and `bytea` columns differ:

   ```console
   restic dump MANIFEST_ID /manifest.tsv > /dev/shm/manifest.tsv
   pg psql -X -q -A -t -F "$(printf '\t')" -v ON_ERROR_STOP=1 -U "$PGU" -d "$PGD" > /dev/shm/restored.tsv <<'SQL'
   SET TimeZone = 'UTC';
   SET DateStyle = 'ISO, YMD';
   SET IntervalStyle = 'postgres';
   SET extra_float_digits = 1;
   SET bytea_output = 'hex';
   SET lc_monetary = 'C';
   SELECT format('SELECT %L, count(*), coalesce(sum((''x'' || left(md5(t.*::text), 16))::bit(64)::bigint::numeric), 0) FROM %I.%I AS t', CASE WHEN k ~ '[[:cntrl:]]' THEN 'hex:' || encode(convert_to(k, 'UTF8'), 'hex') ELSE k END, schemaname, tablename) FROM (SELECT schemaname, tablename, format('%I.%I', schemaname, tablename) AS k FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema') AND schemaname !~ '^pg_(toast_)?temp_') AS t ORDER BY schemaname, tablename \gexec
   SQL
   diff <(cut -f1,2 /dev/shm/manifest.tsv) <(cut -f1,2 /dev/shm/restored.tsv) && echo counts match
   diff /dev/shm/manifest.tsv /dev/shm/restored.tsv && echo checksums match
   rm -f /dev/shm/manifest.tsv /dev/shm/restored.tsv
   ```

   Both must match. A manifest with only two columns per line (`key<TAB>count`) was taken before content checksums: for it only the counts `diff` applies.

   **Roles and globals.** `globals.sql` is never restored automatically. The restore above uses `--no-owner --no-acl`, so the application needs only the `POSTGRES_USER` role that the PostgreSQL image creates. If the old cluster had extra roles, role settings, or tablespaces, read the file without writing it to disk (it holds role password hashes) and recreate only what is missing, by hand, after review: `restic dump GLOBALS_ID /globals.sql | less`. Do not pipe it into `psql` wholesale: it also re-creates the existing superuser and would fail or overwrite its password.

8. Deploy the matching release with `release.sh deploy` and verify the edge.
9. Re-enable the timers (`systemctl start mawareeth-backup.timer mawareeth-restore-check.timer`), then run `backup.sh backup` and `backup.sh verify-restore` and confirm `backup.sh gate` before reopening writes. Keep the retained volume until the restored data has been accepted, then remove it in a separately approved step.

### Known limits (deferred)

- The host holds the repository password and an SSH key with write access, so a compromised host can delete or prune the backups; the repository is not append-only (append-only or object-locked storage is deferred).
- Only the application database is restored and verified. Roles and other cluster globals are archived as `globals.sql` but are never restored automatically (restores use `--no-owner --no-acl`; see the runbook), and host state is archived only partly: `host-state.tar` holds `runtime.env`, slot records, routes, and the snapshots the records name, but not the deploy journal or the other `/etc/mawareeth` secrets (keep those in escrow). Restoring host state is a manual runbook step (no automated command), and so is a full host rebuild: story 0.9 rehearses only the data restore and the cutover ([Cutover rehearsal](#cutover-rehearsal)).
- The host-state archive is taken without the deploy lock. A deploy that overlaps the nightly backup can change a record, route, or snapshot while it is read and fail that night's run (`failed:host-state`); rerun `backup.sh backup` after the deploy.
- The checksum reads and detoasts every row of every table, so it lengthens both the nightly snapshot transaction (and with it how long old row versions are held) and the restore check, roughly in proportion to the database size. Columns whose text differs between clusters for identical data, such as `oid` or `reg*` columns or large-object references, would report `checksum-mismatch` after a correct restore; Django's schema has none, so a new table with such a column needs this revisited.
- Content checksums detect corruption, not tampering (a sum of 64-bit hash prefixes); the archive's integrity rests on Restic's authenticated encryption. Runs from before content checksums are verified on counts alone. No application-level check (such as `manage.py migrate --check`) runs against the restored database: it would need networking and runtime secrets in the throwaway, and the checksums already cover `django_migrations` content exactly.
- There is no WAL archiving or point-in-time recovery (see Real RPO).
- Alerting on failed or stale backups and restore checks is in [Monitoring and alerting](#monitoring-and-alerting). Logs under `<state dir>/backup/logs/` are pruned manually.

## Monitoring and alerting

Mawareeth reuses SCDF's monitoring stack instead of running its own. This host runs only Ubuntu's `prometheus-node-exporter`, bound to its Tailscale IPv4 on port 9100. SCDF's Prometheus and Alertmanager on `p1` scrape it over Tailscale and email SCDF's existing `SMTP_TO` address through a `project=mawareeth` route. Better Stack probes the public readiness endpoint from outside, and a Better Stack heartbeat watches `p1` itself: the always-firing `MawareethWatchdog` pings it, and Better Stack alerts when the pings stop. Prometheus and Alertmanager never run on this host, and port 9100 is never public: the Hetzner cloud firewall is unchanged, and UFW admits 9100/tcp only `in on tailscale0` from `100.64.0.0/10`. Run every command as root. `monitor.sh` never takes the deploy or backup locks and never touches slots, routes, or the database.

### Host setup

1. **Install.** `sudo deploy/monitor.sh install` first requires `ufw status` to report `Status: active` (otherwise it exits 1 before changing anything; run the host baseline first). It then does the following:
   - Adds Tailscale's official signed noble repository (`/etc/apt/keyrings/tailscale-archive-keyring.gpg`, `/etc/apt/sources.list.d/tailscale.list`).
   - Installs `tailscale` and `prometheus-node-exporter` (the exporter comes from the Ubuntu archive).
   - Writes `/usr/local/sbin/mawareeth-node-exporter` and the drop-in `/etc/systemd/system/prometheus-node-exporter.service.d/10-mawareeth.conf` (`After=tailscaled.service`, `Restart=always`, `RestartSec=15`). The wrapper reads `tailscale ip -4` and starts the exporter with `--web.listen-address=<that IP>:9100 --collector.textfile.directory=/var/lib/prometheus/node-exporter --collector.systemd`. The systemd collector (off by default in node_exporter) publishes `node_systemd_unit_state` for `MawareethSystemdUnitFailed`; its default exclude list already drops automount, device, mount, scope, and slice units. It adds about 5 series per unit (one per state), a few hundred on this host. Without a Tailscale IPv4 in `100.64.0.0/10` it exits 1 and systemd retries every 15 seconds. It never falls back to `0.0.0.0` or another address. The drop-in replaces the packaged `ExecStart`, so `ARGS` in `/etc/default/prometheus-node-exporter` is ignored.
   - Adds the UFW rule `allow in on tailscale0 from 100.64.0.0/10 to any port 9100 proto tcp`.
   - Adds the UFW rule `allow in on tailscale0 from 100.64.0.0/10 to any port 22 proto tcp`, so administrators can SSH over the tailnet from any public address (see [Access, patching, and break-glass](#access-patching-and-break-glass)).
   - Writes `/etc/systemd/journald.conf.d/50-mawareeth.conf` (`SystemMaxUse=500M`, `SystemKeepFree=1G`, `MaxRetentionSec=30day`) and restarts journald.
   - Writes and enables `mawareeth-monitor-collect.{service,timer}` (`OnCalendar=*:0/5`, `Persistent=true`) and publishes the first metrics.

   Re-run `install` after moving the checkout. Re-running it also upgrades a host whose wrapper predates a flag (such as `--collector.systemd`): it rewrites the wrapper and restarts the exporter.
2. **Join the tailnet interactively.** Run `sudo tailscale up --hostname=mawareeth-prod` and open the printed login URL as an SCDF tailnet admin. Never pass an auth key on the command line, and never put one in this repository, CI, or a log. In the Tailscale admin console, disable key expiry for this node, and restrict the tailnet ACL so that only `p1` may reach `mawareeth-prod:9100` and only administrators' devices may reach `mawareeth-prod:22`. Then run `sudo systemctl restart prometheus-node-exporter` (otherwise it starts within 15 seconds anyway).
3. **Check the host.** All of these must hold:
   - `tailscale ip -4` prints a `100.x` address.
   - `sudo ss -ltnp 'sport = :9100'` shows only that address, never `0.0.0.0` or `*`.
   - `sudo ufw status numbered` shows 9100/tcp only on `tailscale0` from `100.64.0.0/10`, and 22/tcp on `tailscale0` from `100.64.0.0/10` besides the public SSH allow-list.
   - From an administrator's tailnet device, `ssh mawareeth-admin@mawareeth-prod` (or the `100.x` address) connects.
   - `curl -s http://$(tailscale ip -4):9100/metrics | grep '^mawareeth_'` lists the eight metrics.
   - `curl -s http://$(tailscale ip -4):9100/metrics | grep -c '^node_systemd_unit_state'` prints a number above 0 (the systemd collector is on).
   - `curl -s http://$(tailscale ip -4):9100/metrics | grep -oE '^node_(vmstat_oom_kill|timex_sync_status|filesystem_files|filesystem_readonly)' | sort -u` prints all four names (the host-health rules need them).
   - `systemctl list-timers mawareeth-monitor-collect.timer` shows the timer.

**Collector.** `monitor.sh collect` runs every 5 minutes. It reads `<state dir>/backup/last-backup` and `restore-verified` with the same strict reader as `backup.sh gate`: root-owned, mode 0600, `key=value` lines. It then atomically writes `/var/lib/prometheus/node-exporter/mawareeth.prom` (0644). That file holds these gauges:
- `mawareeth_backup_last_result_ok` and `mawareeth_backup_last_ok_timestamp_seconds` (the finish time when the result is `ok`).
- `mawareeth_backup_last_archives_complete`: 1 only when the backup record is usable, `ok`, and its `host_state_snapshot` and `globals_snapshot` are both 64-hex Restic IDs; otherwise 0.
- `mawareeth_restore_last_result_pass` and `mawareeth_restore_last_pass_timestamp_seconds` (the verification time when the result is `pass`).
- `mawareeth_drill_active_code` (the code of the active alert-path drill, otherwise 0) and `mawareeth_drill_last_pass_timestamp_seconds` (the last passed drill), read from `<state dir>/monitor/drill` (see [Alert-path drill](#alert-path-drill)).
- `mawareeth_monitor_collect_timestamp_seconds`.

A missing, mis-owned, or malformed record, or one with a non-decimal epoch, publishes 0, so the matching alert fires. The collector still exits 0 in that case. Ages are judged by the rules on `p1` (`time() - metric`). `monitor.sh status` prints what a collect would publish, the current file, and the drill state. Exit codes: 0 success, 1 an install or drill write step failed, 2 refused (bad input or environment), 3 another monitor operation holds `<state dir>/monitor.lock`.

### Wiring `p1`

Ask before changing anything on `p1`. Merge the three snippets under `deploy/monitoring/` into SCDF's configuration there, using SCDF's usual procedure for its own rule and route changes:

1. Add the `mawareeth-node` job from `prometheus-scrape.yml` to `scrape_configs`, with `<tailscale-ip>` replaced by the host's `tailscale ip -4`. The job carries the labels `alias=mawareeth-prod` and `project=mawareeth`.
2. Copy `mawareeth-alerts.yml` next to SCDF's rule files and list it under `rule_files`.
3. From `alertmanager-route.yml`:
   - Add both routes, in the snippet's order, as the **first** children of `route.routes`, so no catch-all takes them: the `alertname="MawareethWatchdog"` route first, then the `project="mawareeth"` route. The Watchdog route must come first, because the project route would otherwise email it.
   - Add the `mawareeth-email` receiver, with `${SMTP_TO}` set to the same address SCDF's receiver uses. SMTP host and credentials come from `p1`'s existing `global.smtp_*` settings and never from this repository.
   - Add the `mawareeth-heartbeat` receiver, with `${MAWAREETH_HEARTBEAT_URL}` set to the heartbeat URL from [Better Stack heartbeat](#better-stack-heartbeat), substituted the same way as `${SMTP_TO}`. The URL works as a secret: keep it only in `p1`'s generated config and the operator's password manager, never in this repository, CI, or a log.
   - Add both `inhibit_rules`. The `MawareethHostDown` inhibit excludes `MawareethWatchdog`, because the heartbeat tests `p1`, not this host.

   Emails arrive with the subject `[MAWAREETH <severity>] <alertname>`. The Watchdog is never emailed: its route POSTs to the heartbeat about every 1-2 minutes (`group_wait: 0s`, `group_interval: 1m`, `repeat_interval: 1m`, `send_resolved: false`).
4. Validate before reloading. Alertmanager does not expand environment variables, so `grep -n '\${' alertmanager.yml` must print nothing: no literal `${SMTP_TO}`, `${MAWAREETH_HEARTBEAT_URL}`, or other `${...}` may remain. Then run `promtool check config prometheus.yml`, `promtool check rules mawareeth-alerts.yml`, `amtool check-config alertmanager.yml`, `amtool config routes test --config.file=alertmanager.yml --verify.receivers=mawareeth-email project=mawareeth`, and `amtool config routes test --config.file=alertmanager.yml --verify.receivers=mawareeth-heartbeat alertname=MawareethWatchdog project=mawareeth`. Then reload both services. Under Prometheus → Targets, `mawareeth-node` must be `UP`, and within a few minutes the Better Stack heartbeat must show as up.
5. **If the Tailscale IPv4 changes.** It stays fixed while the node keeps its registration. If the node re-registers with Tailscale (for example after a logout, key expiry, or rebuild) and `tailscale ip -4` changes, update the `<tailscale-ip>` target in p1's scrape job and reload Prometheus, then run `sudo systemctl restart prometheus-node-exporter` on this host. A running exporter does not rebind on its own.

| Alert | Fires when | Severity |
|-------|-----------|----------|
| `MawareethHostDown` | `up == 0`, or no `up` series at all (the scrape job is missing or renamed), for 2 minutes; inhibits every other Mawareeth alert except `MawareethWatchdog` | critical |
| `MawareethBackupUnhealthy` | Last backup not `ok`, record unusable, last success older than 26 hours, or more than 5 minutes in the future (clock skew, which also closes `backup.sh gate`) | critical |
| `MawareethBackupIncomplete` | The last backup is `ok` but its record does not name both a `host-state.tar` and a `globals.sql` snapshot (`mawareeth_backup_last_archives_complete == 0 and mawareeth_backup_last_result_ok == 1`), or the archives metric is absent while the last result is `ok`; a failed or unusable record is `MawareethBackupUnhealthy` instead | warning |
| `MawareethRestoreUnhealthy` | Last restore check not `pass`, record unusable, last pass older than 35 days, or more than 5 minutes in the future | critical |
| `MawareethDiskWarning` | An ext4/xfs/btrfs filesystem more than 75% used for 5 minutes | warning |
| `MawareethDiskCritical` | More than 85% used for 5 minutes (inhibits the warning on the same mountpoint) | critical |
| `MawareethCollectorStale` | `mawareeth.prom` older than 20 minutes, absent, or unparseable (`node_textfile_scrape_error == 1`) | warning |
| `MawareethAlertDrill` | An alert-path drill is active (`mawareeth_drill_active_code > 0`); fires at once and carries the code in its summary | info |
| `MawareethDrillOverdue` | The last passed drill is older than 92 days, none has passed (or the drill record is unusable), the metric is absent, or it is more than 5 minutes in the future | warning |
| `MawareethInodesLow` | An ext4/xfs/btrfs filesystem with more than 85% of its inodes used for 5 minutes; a filesystem reporting no inode count (`node_filesystem_files == 0`, as btrfs does) never fires | critical |
| `MawareethFilesystemReadOnly` | An ext4/xfs/btrfs filesystem read-only (`node_filesystem_readonly == 1`) for 2 minutes | critical |
| `MawareethMemoryPressure` | `MemAvailable` below 10% of `MemTotal`, or more than 50% of swap used (only when `SwapTotal > 0`), for 10 minutes | warning |
| `MawareethOOMKill` | The kernel OOM killer ran within the last 10 minutes (`increase(node_vmstat_oom_kill[10m]) > 0`); fires at once and resolves 10 minutes after the last kill | warning |
| `MawareethSystemdUnitFailed` | A systemd unit in the `failed` state for 5 minutes (labelled with the unit `name`), or no `node_systemd_unit_state` series at all for 5 minutes (the exporter runs without `--collector.systemd`; the alert then has no `name`) | warning |
| `MawareethClockUnsynced` | `node_timex_sync_status == 0`, or `abs(node_timex_offset_seconds) > 0.5`, for 10 minutes | warning |
| `MawareethWatchdog` | Always (`vector(1)`). Routed only to the `mawareeth-heartbeat` webhook, never emailed, never inhibited; see [Better Stack heartbeat](#better-stack-heartbeat) | heartbeat |

`deploy/tests/test_monitor.sh` unit-tests these rules with `promtool test rules` and checks the route snippet with `amtool check-config` and `amtool config routes test`. Those checks run only when `promtool` and `amtool` are installed (otherwise only static checks run); with `CI` set, a missing tool fails the suite. The end-to-end path is proven by the operator's [alert-path drill](#alert-path-drill), which must pass before cutover and then every quarter.

The `deploy-shell` job in the `Django CI` workflow (`.github/workflows/django.yml`) installs pinned, checksum-verified ShellCheck, `promtool`, and `amtool`, runs ShellCheck over `deploy/*.sh` and `deploy/tests/*.sh`, and runs every `deploy/tests/*.sh` suite twice: unprivileged and as root. A failure there fails `Django CI`, so `Publish Release Image` does not publish.

Two more `Django CI` jobs check deploy artifacts before merge. `image-build` builds the full release image from the `Dockerfile` with Buildx (`push: false`, no load, no registry login), so the builder stage's `collectstatic` and `check --deploy --fail-level WARNING` gates fail the pull request rather than the post-merge publish. `caddy-config` reads the digest-pinned `CADDY_IMAGE` from `deploy/runtime-images.lock` (a missing or non-digest line fails the job before any pull), pulls it, and runs `caddy adapt --validate` offline (`--network none`, `DOMAIN=ci.example.com`) on `deploy/Caddyfile` with the route directory mounted at the `deploy/compose.yaml` paths, once with the blue route from `deploy/caddy/active-slot.caddy` and once with the green route. The adapted config must contain that slot's `app-<slot>:8000` upstream, because an import glob that matches no file is not a Caddy error. It then validates a copy of the Caddyfile with an unknown directive and fails if that copy is accepted, so the check cannot silently pass everything. A failure in either job also blocks `Publish Release Image`.

### Better Stack uptime probe

Create one Better Stack Uptime monitor:
- Type "URL returns a status code", URL `https://DOMAIN/health/ready/`, expected status 200.
- Check frequency 3 minutes, confirmation period 3 minutes (so two failed checks in a row alert), request timeout 15 seconds.
- Email notification to the same `SMTP_TO` address, with the monitor name prefixed `MAWAREETH`.
- Under the monitor's advanced settings, enable SSL certificate expiration and domain expiration notifications (Better Stack's default lead times are fine). These catch a certificate Caddy failed to renew and a lapsing domain registration before the readiness check does.

`/health/ready/` returns 200 only when PostgreSQL answers and the schema is current. Otherwise it returns 503 with no diagnostics, so a down edge, a dead slot, or a broken database all alert. Keep the Better Stack account credentials in the operator's password manager. Better Stack needs no host change: it reaches the public HTTPS edge.

### Better Stack heartbeat

The heartbeat is the dead-man's switch for `p1`. `MawareethWatchdog` always fires, and Alertmanager POSTs it to the heartbeat URL about every 1-2 minutes. If `p1`'s Prometheus stops evaluating rules, its Alertmanager stops sending, or `p1` loses its outbound path, the pings stop and Better Stack alerts on its own. Create it by hand in the Better Stack dashboard (nothing here calls Better Stack's API):
- A heartbeat monitor named with the prefix `MAWAREETH` (for example `MAWAREETH p1 alert path`).
- Expected period 5 minutes, grace period 5 minutes. A ping every 1-2 minutes stays well inside that window, so only a real stop alerts.
- Email notification to the same `SMTP_TO` address.

Copy the heartbeat URL Better Stack shows into the operator's password manager and substitute it for `${MAWAREETH_HEARTBEAT_URL}` on `p1` (see [Wiring `p1`](#wiring-p1)). Never commit it: anyone holding it can send pings and hide an outage. `deploy/tests/test_monitor.sh` fails if a Better Stack heartbeat URL appears anywhere in the repository.

**One-time launch check (prove it pages).** After wiring `p1`:
1. On `p1`, add an Alertmanager silence matching `alertname="MawareethWatchdog"` (or pause the pings another way) for longer than period plus grace, say 15 minutes.
2. Confirm Better Stack marks the heartbeat down and emails `SMTP_TO`.
3. Expire the silence and confirm the heartbeat recovers within a few minutes.

**Silences and planned downtime.** An Alertmanager silence that matches `project="mawareeth"` also silences `MawareethWatchdog`, so Better Stack pages. Maintenance silences must add `alertname!="MawareethWatchdog"`. A planned `p1` restart or outage longer than the grace period also trips the heartbeat: pause the heartbeat in Better Stack first and resume it afterwards.

What the heartbeat covers: `p1`'s Prometheus (rule evaluation), its Alertmanager (routing and sending), and `p1`'s reachability from the internet. What it does not cover: the SMTP relay. A broken relay leaves the heartbeat green while alert emails stop. That gap stays covered only by the quarterly [alert-path drill](#alert-path-drill); there is deliberately no alert on `alertmanager_notifications_failed_total`. The heartbeat also does not watch this host: a dead Mawareeth host is `MawareethHostDown`, and Better Stack's uptime probe covers the public edge.

### Alert-path drill

The drill proves that a host alert reaches the operator's inbox through `p1` and that Better Stack can notify the same inbox. It uses the existing `project=mawareeth` route and `mawareeth-email` receiver unchanged. Run it once before cutover (the launch drill) and then at least every quarter: `MawareethDrillOverdue` warns once the last pass is older than 92 days, and it warns on a fresh host until the launch drill passes.

1. Run `sudo deploy/monitor.sh drill start`. It prints a random six-digit code and republishes `mawareeth.prom` at once with `mawareeth_drill_active_code` set to that code.
2. Within about 10 minutes (scrape, rule evaluation, and Alertmanager `group_wait`), an email with the subject `[MAWAREETH info] MawareethAlertDrill (firing)` arrives at `SMTP_TO`. Its summary reads `Mawareeth alert-path drill code <code>`. Until the drill is confirmed or aborted it re-sends every 4 hours (`repeat_interval`).
3. In Better Stack, open the `MAWAREETH` monitor and use **Send test notification**. Check that the test alert reaches the same inbox. This step is manual; nothing here calls Better Stack's API.
4. Run `sudo deploy/monitor.sh drill confirm <code from the email> --better-stack-received`. It records a pass only when the code matches the active drill and the flag asserts that the Better Stack test alert arrived. A resolved email follows.

   The code is also visible on the host: `drill start` prints it, and it appears in `mawareeth.prom` and `monitor.sh status`. So `confirm` is an operator-discipline check, not cryptographic proof. Type the code from the email you received, never from the terminal. If no email arrived, the drill has failed.
5. If either notification does not arrive, run `sudo deploy/monitor.sh drill abort`, fix the path (see the runbooks below), and start again. An abort keeps the previous pass.
6. After a `confirm` or `abort`, wait about 15 minutes, until the resolved email arrives, before you start another drill. Alertmanager would otherwise treat the new drill as the same still-firing alert and send no new email.

Refusals exit 2 and change nothing: `start` while a drill is active, `confirm` with a wrong or malformed code, without `--better-stack-received`, or with no active drill, and `abort` with no active drill. Exit 3 means another monitor operation holds the lock. A drill command never takes the deploy or backup locks.

**Evidence.** Both files are `root:root` mode 0600 in `<state dir>/monitor/` (mode 0700):
- `drill` is the current record (`state`, `code`, `started_epoch`, `last_result`, `last_pass_epoch`, `last_pass_at`), read by the collector with the same strict reader as the backup records. A missing or unusable record publishes 0 for both drill metrics, so `MawareethDrillOverdue` fires. `drill start`, `confirm`, and `abort` refuse an unusable record; inspect it and move it aside.
- `drill-history` gets one line per `start`, `pass`, and `aborted` event, with the UTC time, the code, and the operator (`by=`, from `SUDO_USER`, otherwise `root`).

A refusal (exit 2) writes nothing; `confirm` and `abort` never create the directory. If the history line cannot be appended, the previous record is restored and the command exits 1. If the record and history were written but `mawareeth.prom` could not be, the command exits 1 and says the drill state was changed; the next collect publishes it.

Keep the two emails (drill firing and resolved) and the Better Stack test notification with the launch evidence. `sudo deploy/monitor.sh status` shows the drill state.

### Log bounds

- Each of the four containers (`postgres`, `app-blue`, `app-green`, `caddy`) uses Docker's `json-file` driver capped at `max-size: 10m` × `max-file: 5` in `compose.yaml`. That is at most 50 MB each and 200 MB in total.
- journald is capped at 500 MB, stops growing once less than 1 GB of the filesystem would remain free (`SystemKeepFree` limits journald's own use; it does not guarantee free space), and keeps at most 30 days.
- Deploy and backup diagnostic logs under `<state dir>` are pruned manually (see above).
- Rotating logs are not durable evidence.

### Runbooks

<a id="runbook-mawareethhostdown"></a>
**MawareethHostDown.**
1. Check from `p1` with `tailscale ping mawareeth-prod`.
2. If Tailscale answers, SSH in and check `systemctl status prometheus-node-exporter tailscaled`, then `journalctl -u prometheus-node-exporter -n 50`. "no Tailscale IPv4 address" means Tailscale is logged out: run `sudo tailscale up` interactively. If the address changed, update p1's scrape target (see [Wiring `p1`](#wiring-p1)).
3. If nothing answers, check the server in the Hetzner console (power, CPU, rescue) and whether Better Stack is also alerting.
4. While this fires, the other Mawareeth alerts (except `MawareethWatchdog`) are suppressed. Re-check them after recovery.

<a id="runbook-mawareethbackupunhealthy"></a>
**MawareethBackupUnhealthy.**
1. Run `sudo deploy/backup.sh status`, then `journalctl -u mawareeth-backup.service`.
2. The `result=failed:<stage>` value and the run log named in `last-backup` identify the failing stage (see the exit-code table above).
3. If the record is absent or unusable, check `ls -l <state dir>/backup/`: the record must be `root:root` 0600.
4. Fix the cause, then run `sudo deploy/backup.sh backup` by hand. The resolution arrives after the next collect, scrape, rule evaluation, and Alertmanager group interval, typically within about 15 minutes.

<a id="runbook-mawareethbackupincomplete"></a>
**MawareethBackupIncomplete.**
This alert is expected right after the change that added `globals.sql` ships, until the first nightly run of the new `backup.sh` records a `globals_snapshot`. It also fires when a snapshot ID is malformed (not 64 lowercase hex characters) or when `mawareeth_backup_last_archives_complete` is absent while the last result is `ok` (for example, the rules on `p1` were updated before `monitor.sh` on the host; run `sudo deploy/monitor.sh status` to see whether the metric is published).
1. Run `sudo deploy/backup.sh status` and read `host_state_snapshot` and `globals_snapshot` in `last-backup`. An empty, missing, or malformed value means that run did not record that archive, so a host rebuild (host state) or role recovery (globals) from it would be incomplete; the database dump itself is still usable.
2. The usual cause is a run made by an older `backup.sh` (for example, a checkout that predates host-state or globals archiving, pinned by `install` in the systemd unit). Check `ExecStart` in `systemctl cat mawareeth-backup.service` and that checkout's version; update the checkout and re-run `sudo deploy/backup.sh install` if it is stale.
3. Run `sudo deploy/backup.sh backup` by hand and confirm both IDs are now set. If a current script still leaves one empty, treat it as a regression and keep the run log named in `last-backup`.

<a id="runbook-mawareethrestoreunhealthy"></a>
**MawareethRestoreUnhealthy.**
1. Run `sudo deploy/backup.sh status`, then `journalctl -u mawareeth-restore-check.service`. The `fail:<reason>` value maps to the exit-6 table above.
2. Fix the cause, then run `sudo deploy/backup.sh verify-restore`.
3. While this fires, `backup.sh gate` is closed, so do not accept irreplaceable writes.

<a id="runbook-mawareethdisk"></a>
**MawareethDiskWarning / MawareethDiskCritical.**
1. Run `df -h` and `sudo du -xh --max-depth=2 / | sort -h | tail`, then `docker system df`.
2. Usual causes are old images, prunable deploy or backup logs under `<state dir>`, and PostgreSQL growth.
3. Remove unused images with `docker image prune` (never volumes), and prune old logs deliberately.
4. A restore check needs 3× the dump size free. If growth is structural, plan a resize in the maintenance window.

<a id="runbook-mawareethcollectorstale"></a>
**MawareethCollectorStale.**
1. Run `systemctl list-timers mawareeth-monitor-collect.timer`, then `journalctl -u mawareeth-monitor-collect.service -n 50`, then `sudo deploy/monitor.sh status`.
2. Exit 2 means a refusal (for example, the state or textfile directory is missing). Exit 3 means another monitor run holds the lock.
3. Re-run `sudo deploy/monitor.sh install` if the units are missing or the checkout moved.

<a id="runbook-mawareethalertdrill"></a>
**MawareethAlertDrill.**
1. This is expected during an [alert-path drill](#alert-path-drill). Note the code in the summary.
2. Send the Better Stack test notification, then run `sudo deploy/monitor.sh drill confirm <code> --better-stack-received`.
3. If nobody started a drill, or it cannot be finished, run `sudo deploy/monitor.sh drill abort`. Check `<state dir>/monitor/drill-history` for who started it and when.

<a id="runbook-mawareethdrilloverdue"></a>
**MawareethDrillOverdue.**
1. Run `sudo deploy/monitor.sh status` and read the drill section.
2. `(absent: no drill has run)` or `last_result=aborted` with no `last_pass_at` means the launch drill has not passed yet. Run the [alert-path drill](#alert-path-drill).
3. `(unusable ...)` means the record is not `root:root` 0600 or is malformed. Inspect it with `sudo ls -l <state dir>/monitor/` and `sudo cat <state dir>/monitor/drill`, move it aside, and run the drill again.
4. A `last_pass_at` more than 92 days old means the quarterly drill is due. A pass dated in the future means the host clock is wrong: fix time sync first.

<a id="runbook-mawareethinodeslow"></a>
**MawareethInodesLow.**
1. Run `df -i` to confirm the filesystem, then find the directory with the most files: `sudo du -x --inodes --max-depth=3 <mountpoint> | sort -n | tail`.
2. Usual causes are many small files: leftover deploy or backup logs under `<state dir>`, Docker build cache or image layers (`docker system df`), and stale temporary files.
3. Prune deliberately (`docker builder prune`, old logs; never volumes). Once inodes run out, file creation fails even with free bytes, so backups and deploys fail too.

<a id="runbook-mawareethfilesystemreadonly"></a>
**MawareethFilesystemReadOnly.**
1. Run `findmnt -o TARGET,SOURCE,FSTYPE,OPTIONS <mountpoint>` and `sudo dmesg -T | grep -iE 'ext4|xfs|btrfs|I/O error|remount' | tail -n 30`. A kernel remount after an I/O or filesystem error is the usual cause.
2. Stop accepting writes: `backup.sh` and deploys will fail. Do not try `mount -o remount,rw` before you know the cause.
3. Check the volume in the Hetzner console. Plan a maintenance window to run `fsck` from rescue mode (or replace the volume), then verify with `sudo deploy/backup.sh backup` and `sudo deploy/backup.sh verify-restore`.

<a id="runbook-mawareethmemorypressure"></a>
**MawareethMemoryPressure.**
1. Run `free -m`, `docker stats --no-stream`, and `ps -eo pid,comm,rss --sort=-rss | head`.
2. Usual causes are both app slots running after an interrupted deploy (check `deploy/runtime.sh status` as in [Private Compose runtime](#private-compose-runtime)), a PostgreSQL query or a restore check, or a leak in the app.
3. If pressure is structural, plan a resize in the maintenance window. Watch for `MawareethOOMKill`.

<a id="runbook-mawareethoomkill"></a>
**MawareethOOMKill.**
1. Run `sudo journalctl -k --since -30min | grep -i -A5 'out of memory'` to see which process was killed, then `docker ps -a` for containers that exited or restarted.
2. Check that the app slot and PostgreSQL are healthy (`deploy/runtime.sh status`, `curl -s https://DOMAIN/health/ready/`). A killed PostgreSQL backend can leave the app erroring until it recovers.
3. Then follow the [memory runbook](#runbook-mawareethmemorypressure). The alert resolves 10 minutes after the last kill.

<a id="runbook-mawareethsystemdunitfailed"></a>
**MawareethSystemdUnitFailed.**
1. With a `name` label: run `systemctl status <name>` and `journalctl -u <name> -n 100`. Fix the cause, then `sudo systemctl reset-failed <name>` (and restart it if it should be running). The Mawareeth units (`mawareeth-backup`, `mawareeth-restore-check`, `mawareeth-monitor-collect`) have their own runbooks above.
2. Without a `name` label: no `node_systemd_unit_state` series reaches `p1`, so the exporter runs without the systemd collector (a wrapper from before `--collector.systemd`). Run `sudo deploy/monitor.sh install` again, then check `curl -s http://$(tailscale ip -4):9100/metrics | grep -c '^node_systemd_unit_state'`. If it is still 0, check `journalctl -u prometheus-node-exporter -n 50` for D-Bus errors.
3. `systemctl --failed` lists every failed unit on the host.

<a id="runbook-mawareethclockunsynced"></a>
**MawareethClockUnsynced.**
1. Run `timedatectl status` and `timedatectl timesync-status` (or `chronyc tracking` if chrony is installed).
2. Make sure exactly one time daemon is active and can reach its NTP servers (UDP 123 outbound), then restart the one in use: `sudo systemctl restart systemd-timesyncd` for systemd-timesyncd, or `sudo systemctl restart chrony` for chrony.
3. A wrong clock also skews the backup, restore, and drill age rules (and may close `backup.sh gate` as future-dated). Re-check those alerts once the clock is synchronised.

<a id="runbook-mawareethwatchdog"></a>
**MawareethWatchdog.**
This alert always fires by design and is never emailed. If an email for it arrives, the `mawareeth-heartbeat` route is missing or below the project route on `p1`: fix the order (see [Wiring `p1`](#wiring-p1)). If Better Stack reports the heartbeat down:
1. On `p1`, check that Prometheus and Alertmanager are running and that Prometheus → Alerts shows `MawareethWatchdog` firing.
2. Check Alertmanager's log for webhook errors to the heartbeat URL, and that `p1` can reach Better Stack over HTTPS.
3. Check that the substituted URL in `p1`'s `alertmanager.yml` matches the heartbeat in Better Stack (a regenerated config may have lost it).
4. While the heartbeat is down, no Mawareeth host alert is trustworthy. Check the host by hand (`sudo deploy/backup.sh status`, `sudo deploy/monitor.sh status`, `df -h`).

## Immutable release artifacts

`Django CI` remains the application validation authority. After a successful push run on `master` (a merge; pull request runs never publish), `.github/workflows/deploy.yml` checks out that run's exact commit, builds the application image once, starts that local image, and verifies both liveness and the baked release identity before pushing the same tag to GHCR. A failed build, smoke probe, identity assertion, registry push, or manifest validation prevents publication of a deployable manifest.

The workflow uploads `release-manifest-<commit>` containing `release-manifest.json`. Its `application.image` is the only production-consumable image identity and has the canonical form `ghcr.io/<owner>/<repository>@sha256:<digest>`; branch names and tags are not deployment inputs. The manifest also binds the same 40-character commit as the human release identity and deployment-bundle revision, plus configuration schema `1`, migration contract `expand-migrate-contract-v1`, and the successful `Django CI` workflow run. The deployment-bundle commit identifies all tracked Compose, Caddy, and deploy files added by later stories.

`deploy/release_manifest.py validate --input release-manifest.json --expected-repository ghcr.io/<owner>/<repository>` fails closed on missing, extra, duplicate, malformed, or inconsistent fields, on an image from any other repository, and on configuration schemas or migration contracts outside the supported sets in `release_manifest.py`. Consumers must always pass `--expected-repository`. The manifest compatibility version, configuration schema, and migration contract are release interfaces: change them only through an explicit compatibility decision, by updating both the workflow `env` and the supported sets.

The workflow validates the manifest inputs before pushing, so an unsupported contract never reaches GHCR. A registry push that succeeds before a later step fails can still leave a `:<commit>` tag without a manifest; never deploy by tag. Re-running the workflow rebuilds and re-pushes that tag with a new digest. Earlier manifests still name their own digests, so keep GHCR cleanup from deleting untagged versions that a retained manifest references. Manifest artifacts are kept for 90 days; archive any manifest you may need to roll back to after that.

`deploy.yml` runs from the default branch (a `workflow_run` rule), but it checks out and executes `deploy/release_manifest.py` from the released commit. Keep the script's CLI backward compatible with the default branch's workflow, or merge workflow and CLI changes together. The manifest contains identities and contract versions only. Runtime credentials, environment values, secret material, host deployment logic, and mutable source references must never be added. Stories 0.5 and 0.6 consume and verify this contract; this workflow does not contact or deploy to the production host.

## Prerequisites and inputs

Run only from an administrator workstation, never CI, with `bash`, `python3`, `jq`, OpenSSH, and the Hetzner `hcloud` CLI installed. Use a minimally scoped Hetzner token that can manage the one SSH key, firewall, and server. Agree the server name, key identity, SSH source CIDRs, and a weekly maintenance window before running.

Copy `host-baseline.env.example` to `host-baseline.env`; it is ignored by Git. Fill the token, server and key identity, paths to the matching public/private SSH keys, and comma-separated administrator CIDRs. Keep the config mode 0600. The script refuses missing or malformed input before contacting Hetzner.

Run `bash deploy/provision-host.sh`. The first run creates Ubuntu 24.04 CX33 in `nbg1`, an edge firewall, delete and rebuild protection (the API sets them together), then bootstraps the guest. Re-runs reconcile the firewall, protection, and guest baseline without creating another matching server. An existing server with a different size, location, image, or baseline ownership label aborts for an explicit operator decision.

## Access, patching, and break-glass

Only listed CIDRs may SSH, and SSH requires an authorized key; password and root login are disabled after bootstrap. The listed CIDRs are enforced twice, by the Hetzner cloud firewall and by UFW on the host, so a changed workstation address needs both updated, and UFW can only be changed from a working session or the Hetzner console. After `monitor.sh install` and joining the tailnet, administrators can also SSH over Tailscale (`tailscale0`, `100.64.0.0/10`, still key-only); the tailnet ACL decides which devices may reach port 22. Prefer that path, and keep the public allow-list as the fallback. Re-running `bootstrap-host.sh` resets UFW, which drops both `tailscale0` rules, so re-run `monitor.sh install` afterwards. Ensure a second tested administrator key and Hetzner console access exist before changing access ranges. Do not remove the only permitted CIDR during maintenance. Ubuntu security updates are enabled automatically; review `/var/log/unattended-upgrades/` in the agreed weekly maintenance window and schedule any reboot deliberately.

## Runtime secrets

The baseline creates `/etc/mawareeth/runtime.env`, owned by root with mode 0600. Populate it directly on the server through an approved out-of-band administrative session, e.g. `sudoedit /etc/mawareeth/runtime.env`; never copy it into this repository, CI variables, command lines, or logs. Later runtime work decides the file format and consumers.

## Application runtime contract

With `DJANGO_ENV=production` the application refuses to start unless these are set: `DJANGO_KEY`, `DJANGO_ALLOWED_HOSTS` (explicit hostnames, no wildcards), `DJANGO_CSRF_TRUSTED_ORIGINS` (explicit `https://` origins), `DATABASE_URL`, `DATABASE_SSL_MODE`, `MAILGUN_ACCESS_KEY`, and `MAILGUN_SERVER_NAME`. Use `DATABASE_SSL_MODE=disable` for the private Compose PostgreSQL and `verify-ca`/`verify-full` for any new managed database; `prefer` is rejected because it silently falls back to plaintext. `require` (encrypted, server certificate not checked) is accepted only because Heroku Postgres supports nothing stronger, and will be rejected once production leaves Heroku. The verified modes also need `DATABASE_SSL_ROOT_CERT`: the in-container path of a readable CA file (e.g. a mounted Compose secret), not the certificate contents. Optional: `DATABASE_CONNECT_TIMEOUT` (default 5 seconds), `RELEASE_VERSION`, and `RELEASE_COMMIT_SHA` (baked into the image by CI).

Django trusts `X-Forwarded-Proto` from its upstream (`SECURE_PROXY_SSL_HEADER`), so it must stay reachable only through Caddy. Two invariants make that safe, and the offline tests (`deploy/tests/test_compose_runtime.sh`) pin both (case-insensitively for the header check, and also against `network_mode:` on the slots):

- **Caddy overwrites client forwarding headers.** Caddy 2.11 replaces any client-supplied `X-Forwarded-Proto`, `X-Forwarded-For`, and `X-Forwarded-Host` with its own values unless `trusted_proxies` is configured. Neither the Caddyfile nor the generated route sets `trusted_proxies` or forwards `X-Forwarded-*` with `header_up`; adding either needs an explicit decision.
- **The slots are `expose`-only.** `app-blue` and `app-green` (and the shared `x-app` template) declare `expose: 8000` and no `ports:`; only Caddy publishes TCP 80/443. A client can therefore reach Django only through Caddy.

Health probes are answered before host validation and the HTTPS redirect, so private plain-HTTP checks may target a slot directly, e.g. `http://app-blue:8000/health/ready/`:

- `/health/live/` — process liveness; touches no dependency. Public.
- `/health/ready/` — `200` only when PostgreSQL answers and every migration shipped in this release is applied; otherwise `503 {"status": "error"}` with no diagnostics. Public (external monitors probe it). On PostgreSQL both checks run in one transaction that first sets `SET LOCAL statement_timeout = '2s'` and `lock_timeout = '2s'`. Each limit applies per statement (the probe runs a few statements), so a stalled or locked database fails the probe after about 2 seconds per stuck statement with `503`, the cause logged server-side, instead of pinning a gunicorn worker until gunicorn's 60s timeout. The settings end with that transaction, so pooled connections (`conn_max_age=600`) keep their defaults; when the probe is called inside an existing atomic block it skips them rather than change the outer transaction. Connecting is not covered: it is bounded by `DATABASE_CONNECT_TIMEOUT` (default 5 seconds).
- `/health/release/` — application version, release, and commit identity. **Never served through the edge:** Caddy answers `404` itself for `/health/release*`, for every client, without contacting the app. There is deliberately no source-address exception: Docker IPv6 is off, so IPv6 clients reach Caddy through docker-proxy and appear as the private bridge gateway, and an address allowlist would expose the identity to them. The identity is reached only by direct slot probes (`release.sh` probes inside the slot container, in-network `http://app-<slot>:8000/health/release/` checks, the CI smoke test).

Changing the Caddyfile on a running host takes effect only after Caddy reloads it: the next `release.sh deploy` reloads Caddy when it switches routes, or reload it deliberately with `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile` (with the runtime's Compose project and environment). Then confirm from outside the host that `https://DOMAIN/health/release/` answers `404`. If it still answers `200`, Caddy is reading the file it started with (a single-file bind mount keeps the original file when a checkout replaces it), and the Caddy container must be recreated in a maintenance window.

## Audit checks

On the host, `sudo ufw status numbered` must show TCP 22 only from the configured CIDRs and TCP 80/443 only; it must not show app, Docker, or PostgreSQL ports. In Hetzner, inspect the attached edge firewall for the same allow-list. Confirm `sudo sshd -T | grep -E 'passwordauthentication|permitrootlogin|pubkeyauthentication'`, `docker --version`, `docker compose version`, `stat -c '%U %G %a' /etc/mawareeth/runtime.env`, and `hcloud server describe SERVER` (deletion protection). Public checks must find only ports 80 and 443; port 22 is reachable only from an approved source.

Also confirm the Docker-port backstop is active and in effect: `systemctl is-active mawareeth-docker-firewall.service` must report `active`, and `sudo iptables -L DOCKER-USER -n` (plus `sudo ip6tables -L DOCKER-USER -n` where IPv6 is enabled) must show only the established-traffic accept, the 80/443 accept, a `RETURN` for traffic arriving from `docker0` and from `br-+` (connections containers start, such as DNS, Mailgun, the Storage Box, and Heroku; they continue to Docker's own rules), and the trailing drop. Without those two `RETURN` rules every container-started connection except to ports 80 and 443 is dropped, including DNS. Docker recreates its own chain independently of `ufw`, so the unit declares `BindsTo=docker.service` and `PartOf=docker.service` and is installed into `docker.service.wants`: it stops with Docker for any reason (including a crash) and reapplies the rules whenever Docker starts or restarts. `systemctl show -p BindsTo,PartOf,WantedBy mawareeth-docker-firewall.service` must list `docker.service`; on a host bootstrapped before this was added, rerun `bootstrap-host.sh` (idempotent) to install the updated unit. The same checks still apply after a `systemctl restart docker`.

## Cutover rehearsal

`deploy/rehearse.sh` collects the evidence story 0.10 needs before go-live: how long the Heroku data move takes, whether that fits the 20-minute write-freeze budget, whether the CX33 holds both slots under load, and whether recovery is proven. `deploy/rehearsal.py` (standard library only) samples the host, evaluates the samples, and generates the workstation load. Run every `rehearse.sh` command as root on the host.

The rehearsal copies live Heroku **read only**: one snapshot, no maintenance mode, no writes, and production DNS untouched. DNS is rehearsed on a throwaway name such as `rehearsal.mawareeth.com`, switched Heroku → Hetzner → Heroku to time propagation and the rollback. During the rehearsal the host's `DOMAIN` in `runtime.env` is that throwaway name, so Caddy gets a certificate for it.

| Command | What it does |
|---------|--------------|
| `import [--freeze-marked] [--extensions-created]` | Copies Heroku's `public` schema into the empty private PostgreSQL in one transaction and checks it against the source |
| `mark PHASE` | Records a manual cutover phase |
| `capacity [--minutes N]` | Runs both slots and samples the host while the workstation load runs (default 30 minutes) |
| `report` | Combines the evidence into a gate verdict and picks the cutover path |

**Safety rules.**

- `rehearse.sh` never switches the route, DNS, or Heroku maintenance mode.
- `import` refuses unless the target database holds no user objects (relations, sequences, views, types, or functions outside the system schemas, apart from objects an extension owns) and neither application slot is running.
- `import` and `capacity` both hold the deploy lock and the backup lock.
- `capacity` starts only the idle slot, from its own slot record, and stops it on every exit path, including a signal.

### Source credentials

1. On the workstation, run `heroku pg:credentials:url DATABASE --app HEROKU_APP`. Do not save or paste its output anywhere else.
2. On the host, write the connection values into `/etc/mawareeth/heroku-source.env` with `sudoedit` (`root:root` mode 0600). The file uses the same strict raw `KEY=VALUE` format as `runtime.env`, one key per line, and must contain exactly `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD`:

   ```text
   PGHOST=ec2-0-0-0-0.compute-1.amazonaws.com
   PGPORT=5432
   PGDATABASE=...
   PGUSER=...
   PGPASSWORD=...
   ```

   Never put a URL, the password, or the file in the repository, CI, a command line, or a log.

The file goes to the pinned `POSTGRES_IMAGE` client (17.11) only through `docker run --env-file`.

**These are the application's own read-write credentials.** Heroku's essential plans cannot create a read-only credential (`heroku pg:credentials:create` needs Standard or higher). Every source session is therefore held read only by the session itself:

- `PGOPTIONS=-c default_transaction_read_only=on`;
- a `BEGIN ... READ ONLY` snapshot transaction;
- `pg_dump`'s own read-only transaction;
- `PGSSLMODE=require`.

Session timeouts are disabled (`idle_in_transaction_session_timeout=0`, `statement_timeout=0`), so the snapshot transaction survives the whole dump.

Heroku rotates the credentials when the database is re-provisioned and on `heroku pg:credentials:rotate`. Delete the file once story 0.10 is finished.

**Impact on live Heroku.** The import holds one `REPEATABLE READ` snapshot open on the production database for its whole duration: the count pass, the dump, and the sequence read. It also reads and detoasts every row twice, once for the checksums and once for the dump. While the snapshot is open, vacuum cannot remove row versions newer than it. Run the rehearsal at a quiet hour, and expect extra load on the essential-1 plan.

### Rehearsal sequence

Do this on a prepared host (`runtime.sh prepare`, PostgreSQL running, an **empty** database, both slots stopped), with backups configured.

1. **Lower the TTL.** Set the TTL of the throwaway record to 60 seconds (and, for 0.10, the TTL of `mawareeth.com` and `www`). Wait at least the old TTL, then run `sudo deploy/rehearse.sh mark ttl-lowered`.
2. **Import.** Run `sudo deploy/rehearse.sh import`.
   - It opens one `REPEATABLE READ, READ ONLY` session on Heroku and exports its snapshot.
   - It refuses (exit 2, nothing written, each finding named) a source that:
     - runs a major other than 17;
     - has user tables outside `public`;
     - holds large objects (`pg_largeobject_metadata`);
     - uses extensions other than `plpgsql`;
     - lacks `public.django_migrations`.
   - **Extensions.** `pg_dump --schema=public` does not create extensions. Create each named extension on the target first, in the same schema as on Heroku. For Heroku's `heroku_ext`, that means `CREATE SCHEMA heroku_ext; CREATE EXTENSION <name> SCHEMA heroku_ext;`. Then rerun with `import --extensions-created`, which checks that the target has every one of them.
   - It counts and checksums every source table inside the snapshot, using the queries from `backup.sh`.
   - It streams `pg_dump -Fc --no-owner --no-acl --schema=public --snapshot=<id>` straight into `pg_restore --exit-on-error --single-transaction --no-owner --no-acl --schema=public`.
     - The dump never touches the disk.
     - `--schema=public` on the restore side skips the dump's `CREATE SCHEMA public`, which would otherwise fail against the existing schema.
     - `--single-transaction` rolls back a failed restore, so `fail:restore` leaves the target empty.
   - It then compares the target's counts and checksums with the source's.
   - Before committing the snapshot transaction, it reads the `last_value` and `is_called` of every `public` sequence in the source session, and compares them with the target's. Sequences are not transactional, so a write on live Heroku during a rehearsal import can move one and fail the run with `fail:compare`. Under the 0.10 write freeze the comparison is exact.
   - Differing tables and sequences are named, and the full diff goes to the root-only log.
   - Finally it runs `ANALYZE` on the target (`analyze_seconds`).

   A rehearsal simulates `freeze-start` at the moment the import starts (written once the source checks pass).
3. **Deploy and validate.** Run `release.sh deploy` with the release manifest. It applies the migrations; `rehearse.sh` has no migrate step. Validate the application through the edge, then run `sudo deploy/rehearse.sh mark validated`.
4. **Switch DNS.** Point the throwaway record at the host. When it resolves to Hetzner from outside, run `mark dns-switched`.
5. **Capacity, while the throwaway record still points at the host** (between `dns-switched` and `dns-rolled-back`). Deploy a second release first, so that both slots have a slot record. Then run from the workstation, with the host's public IPv4 as `HOST_IP`:

   ```console
   python3 deploy/rehearsal.py loadgen --url https://rehearsal.mawareeth.com --expect-address HOST_IP \
       --concurrency 20 --minutes 32 --path / --path /health/ready/ \
     | ssh admin@HOST sudo /srv/mawareeth/deploy/rehearse.sh capacity --minutes 30
   ```

   - Use the absolute path of the host's deployment checkout. The administrator needs passwordless `sudo` for this command, because `sudo` cannot prompt while the pipe feeds standard input.
   - `--expect-address` is required. The load generator refuses (exit 2) unless the URL's host currently resolves to that address, so the load reaches the host and not Heroku.
   - It sends only `GET` (or `HEAD` with `--method HEAD`). Add a `--path` for each representative page.
   - It prints its summary on standard output: requests, errors, `p95_ms` over the answered requests, the actual `seconds`, `requests_per_second`, and the `started_epoch` and `finished_epoch` of the load.
   - `capacity` starts the idle slot and keeps the route on the active one. It samples `/proc` every 15 seconds for 30 minutes and waits up to 15 minutes for the load summary on standard input. Then it stops the slot and evaluates the samples.
   - The load must cover the whole sampling window: it must start at or before the first sample, finish at or after the last, and last at least the measured sampling duration minus one interval. Otherwise the run fails with `fail:load`. The load therefore runs 2 minutes longer than the sampling, and the workstation and host clocks must both be NTP-synchronised.
   - Keep the SSH session open. A hangup ends the run (exit 129, slot stopped, `fail:interrupted`), and Ctrl-C on the workstation stops the load with a partial summary (exit 130).
6. **Roll DNS back.** Mark `rollback-point` where 0.10 would first accept a write. Then point the record back at Heroku and run `mark dns-rolled-back` once it resolves there again.
7. **Restore proof.** After the import, run `sudo deploy/backup.sh backup` and then `sudo deploy/backup.sh verify-restore` (story 0.7).
8. **Report.** Run `sudo deploy/rehearse.sh report`.

**Capacity thresholds** (architecture AD-2; changing them needs an explicit decision):

- The run fails when the mean CPU exceeds 70% or the memory used exceeds 80% over any 15-minute window. Windows roll over the 15-second samples. CPU is the busy share of the jiffy delta. Memory used is `1 − MemAvailable/MemTotal`, averaged over the window.
- It fails on any `pswpin`, `pswpout`, or `oom_kill` increase.
- It fails when more than 1% of the load requests failed, or none were made.
- It fails with fewer than 15 minutes of samples.

A redirect counts as an answer and is not followed. Point `--url` at the canonical HTTPS origin.

**The report and the gate.** `report` prints and writes `<state dir>/rehearsal/report`:

- the import, capacity, and restore results (`import_dump_seconds`, `import_restore_seconds`, `import_compare_seconds`, `import_analyze_seconds`, the measured `capacity_duration_seconds`, the capacity peaks and load figures, the restore duration);
- each mark and the phase durations (`phase_freeze_to_validated_seconds`, `phase_freeze_to_dns_seconds`, `phase_dns_rollback_seconds`, `phase_ttl_lead_seconds`);
- the chosen `path`;
- `gate=pass|unmet`.

The path is `write-freeze` when `validated − freeze-start` ≤ 1200 s **and** `dns-switched − freeze-start` ≤ 1800 s; otherwise it is `replication`, which fails the gate (0.10 would then need a replication-based cutover, which is not built).

**Size note.** The import is one `pg_dump -Fc` stream (no `-j`, which a streamed dump cannot use), restored in one transaction. Its duration grows with the database. The rehearsal's measured `phase_freeze_to_validated_seconds` decides: if it exceeds 20 minutes, the replication path is required.

The gate also requires:

- a passing import;
- a passing capacity run with at least 1800 seconds of measured samples (`duration_seconds`, not the requested minutes), started after the import finished;
- a passing `restore-verified` that is:
  - verified after the import finished;
  - no more than 35 days old;
  - within RPO and RTO: `rpo_seconds` and `dump_age_seconds` ≤ 86400, `rto_seconds` and `duration_seconds` ≤ 14400 (non-negative integers);
- all six marks, none in the future, in order:
  - `ttl-lowered` ≤ `freeze-start` ≤ `validated` ≤ `dns-switched` ≤ `rollback-point` ≤ `dns-rolled-back`;
  - `validated` ≤ `rollback-point`.

Each unmet item is printed.

| Exit | Meaning |
|------|---------|
| 0 | Success; for `report`, the gate passed |
| 1 | `report`: the gate is not met |
| 2 | Refused before anything was written. Causes: an invalid source file or configuration; a running slot; a non-empty target; non-public source tables, large objects, or uncreated extensions; a different source major; a stale or reused `--freeze-marked` mark; an unknown phase; or a missing slot record |
| 3 | The deploy or backup lock is held |
| 4 | `import` or `capacity` failed, and the evidence records `fail:<stage>`; or `mark` or `report` could not write its record. Import stages: `source`, `dump`, `restore`, `compare`, `analyze`. Capacity stages: `start`, `samples`, `load`, `load-errors`, `cpu`, `memory`, `swap`, `oom`, `insufficient-samples`, `stop` |
| 129, 130, 143 | Hangup, interrupt, or termination. A run in progress records `fail:interrupted`; `import` removes its source containers, and `capacity` stops its slot |

**Evidence.** `<state dir>/rehearsal/` (root 0700) holds the following 0600 `key=value` files, each written atomically:

- `import` and `capacity`;
- one `mark-<phase>` per mark (`mark` replaces an earlier one);
- `report`;
- the raw `capacity-samples.tsv`.

Diagnostic logs go to `logs/`. Like the other logs, they are never rotated automatically.

**Resetting the target to empty.** A failed restore is rolled back, but a passing import, or a dump that failed after `pg_restore` accepted its output, leaves data that `import` refuses to overwrite. On the rehearsal host, or on the production host before story 0.10 opens any write, first confirm that no slot is running (`deploy/runtime.sh status`) and that the data is disposable. Then run as root from the deployment checkout:

```console
PGU="$(sed -n 's/^POSTGRES_USER=//p' /etc/mawareeth/runtime.env)"; PGD="$(sed -n 's/^POSTGRES_DB=//p' /etc/mawareeth/runtime.env)"
PGC="$(docker ps -q --filter label=com.docker.compose.project=mawareeth --filter label=com.docker.compose.service=postgres)"
docker exec -i "$PGC" psql -X -v ON_ERROR_STOP=1 -U "$PGU" -d "$PGD" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION pg_database_owner; GRANT USAGE ON SCHEMA public TO PUBLIC;'
```

`PGC` must be exactly one container ID. The reset leaves extensions in other schemas in place. Never run it on a database that has accepted production writes.

### Production cutover (story 0.10)

This sequence is not run during the rehearsal. Every step against Heroku, DNS, or the production host needs its own approval.

1. Lower the TTLs a day ahead.
2. **Before the freeze:**
   - stop both slots, but keep PostgreSQL running (not `runtime.sh down`, which stops it too): `for svc in app-blue app-green; do docker ps -q --filter label=com.docker.compose.project=mawareeth --filter label=com.docker.compose.service=$svc | xargs -r docker stop -t 35; done`;
   - reset the target to empty with the commands above;
   - confirm `sudo deploy/backup.sh gate`;
   - run `sudo deploy/rehearse.sh report` and confirm that the rehearsal gate passed.
3. **Freeze.** Run `heroku maintenance:on --app HEROKU_APP`, then immediately `sudo deploy/rehearse.sh mark freeze-start`.
4. **Import.** Run `sudo deploy/rehearse.sh import --freeze-marked` (add `--extensions-created` if needed). It keeps the operator's `freeze-start`, and refuses a mark older than 30 minutes or older than the last import, such as one left by the rehearsal.
5. **Deploy and validate.** Run `release.sh deploy` and validate through the edge with `--resolve` (DNS still points at Heroku). Then run `mark validated`. This must happen within 20 minutes of the freeze.
6. **DNS.** Switch `mawareeth.com` and `www` to the host and run `mark dns-switched` within 30 minutes of the freeze.
7. **Rollback point.** Until Hetzner accepts its first write, `heroku maintenance:off` plus DNS back to Heroku is lossless. Run `mark rollback-point` just before opening writes. After that, rolling back means copying Hetzner's writes back to Heroku.

**Known limits.**

- Only `public` is copied. Large objects and extensions are refused rather than copied (see the import step).
- Roles, ownership, and grants are not copied (`--no-owner --no-acl`). The application role owns everything it restores.
- The capacity load reaches only the active slot. The idle slot contributes its memory and background work, which matches the overlap during a blue-green deploy.

## Heroku migration inventory

Capture the live migration baseline only from an operator workstation with Python dependencies installed, the Heroku CLI installed, and an authenticated account that has read access to the production app. Confirm the exact app identifier before running. The utility performs only read operations against Heroku and public DNS; it does not connect to PostgreSQL or change the app, configuration, add-ons, domains, DNS, releases, or data.

Use an ignored local path for the first capture:

```console
python deploy/heroku_inventory.py capture --app HEROKU_APP --output deploy/heroku-inventory.local.json
```

Capture never exits zero, because a fresh report always lacks operator confirmations. Exit `2` means evidence is missing: the unknown sections are listed on stdout and each failure reason, such as authentication, app access, timeout or DNS, is printed to stderr without any Heroku output. Exit `3` means every section was captured and the report now needs review and confirmations. Capture writes only allow-listed app/process/database/add-on/domain fields, configuration key names, DNS A/AAAA answers, observation time, and the Heroku CLI version. Raw Heroku responses are never written. One-off `run` dynos are excluded, and a process command that looks like it carries an inline credential marks the processes section unknown instead of being written. Do not redirect CLI debugging output or save raw API responses; they may contain database URLs or credentials.

`captured_at`, dyno `state`, and DNS answers are observation metadata: they can change between otherwise identical captures, so compare repeated captures on the remaining fields. A wildcard domain is resolved through an `inventory-wildcard-probe` label it covers.

Review every section against the Heroku dashboard and the responsible operator's knowledge. `confirm` refuses a report with unknown sections; recapture first. Record confirmations explicitly after that review:

```console
python deploy/heroku_inventory.py confirm --input deploy/heroku-inventory.local.json --confirmation target_app_confirmed --confirmation database_reviewed --confirmation addons_reviewed --confirmation config_keys_reviewed --confirmation domains_and_dns_reviewed
python deploy/heroku_inventory.py verify --input deploy/heroku-inventory.local.json
```

Verification fails closed when a required section is missing, malformed, unresolved, or unconfirmed, when the capture time or Heroku CLI version is absent, or when the captured app name differs from the target app. Never replace an unknown value with a repository default. Before proposing a reviewed baseline for source control, inspect the complete file and search for database URL schemes, credentials, tokens, cookies, private keys, certificate material, and configuration values. The default local output is ignored deliberately. The reviewed baseline at `docs/operations/heroku-inventory.redacted.json` is tracked, and the automated tests verify it and scan it for secret material, so any change to it must pass `python manage.py test` and operator review before merge.
