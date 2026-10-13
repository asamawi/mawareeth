# Secured Hetzner host baseline

This directory contains the secured host baseline, the private Compose runtime, and blue-green release deployment. It does not automate crash recovery, contract-migration detection, backups, DNS, monitoring, or cutover.

## Private Compose runtime

Run runtime operations as root with `sudo`; Docker-group access is root-equivalent and is not the supported operator boundary. Copy the directly installable `runtime.env.example` to `/etc/mawareeth/runtime.env`, keep it `root:root` mode `0600`, and edit it with `sudoedit`. Values use a strict raw `KEY=VALUE` schema: no comments, blank lines, control characters, shell expansion, or extra keys. Compose consumes the generated app snapshot with `env_file.format: raw`, so values are passed literally rather than interpolated. PostgreSQL passwords must contain only URL-safe unreserved characters (`A-Z`, `a-z`, `0-9`, `.`, `_`, `~`, `-`) because the same value is embedded in `DATABASE_URL` without lossy transformation. Keep `DOMAIN` lowercase and within DNS label/total-length limits; `MAILGUN_SERVER_NAME` must also be a valid hostname.

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

Each slot's release is recorded in root-only `<state dir>/slots/<slot>.env` (`IMAGE`, `COMMIT`, `SNAPSHOT`), written only by `release.sh deploy`. The deploy writes the candidate's record in the `switching` phase: after the candidate passed its readiness and release-identity gates, immediately before the route file is replaced, and therefore *before* the edge verification. At the same moment the record it replaces is saved as `<slot>.env.prev` (or a stale `.prev` is removed when the slot had no record). If the switch or the edge verification then fails, the deploy puts the record and `.prev` back exactly as they were before the deploy (removing the record if the slot had none), so a failed deploy never leaves an unverified release recorded and never destroys an earlier `.prev`. A crash between the record write and the end of verification is visible as a non-idle journal (see manual recovery).

`up` restarts the recorded active release after `down`; it never changes releases. It refuses when the route or the active slot's record is absent (bootstrap the first release with `release.sh deploy`), when the manifest image or commit differs from the active record (use `release.sh deploy`), and when the runtime configuration differs from the recorded snapshot. It starts PostgreSQL (waiting for health), then the active slot (waiting for health), then Caddy, each bounded by `MAWAREETH_RUNTIME_WAIT_TIMEOUT` (default 300s); it never starts the idle slot and never runs migrations. `prepare`, `up`, and `down` take the deploy lock and refuse while the deploy journal is not idle. `status` and `logs` are read-only: they create no state directory, snapshot, or record and tolerate configuration drift.

**Reboots.** Containers use `restart: unless-stopped`, so after a host reboot Docker itself restarts PostgreSQL, the slot that was running, and Caddy, without the runtime's ordering, lock, or journal checks. Expect brief `502` responses until the slot is ready again. After every reboot, as root: confirm `<state dir>/deploy.journal` is absent or `phase=idle` (otherwise follow manual recovery before anything else); run `deploy/runtime.sh status` and check that only the routed slot is running and healthy; confirm `curl -sD - --resolve DOMAIN:443:127.0.0.1 https://DOMAIN/health/release/` shows the routed slot's `X-Mawareeth-Slot` and the recorded commit; if anything is off, run `deploy/runtime.sh up` with the active release's manifest.

**Caddy admin API (deliberate decision).** `admin off` would make `caddy reload` impossible, so the Caddyfile enables the admin API on `localhost:2019` inside the Caddy container only. Port 2019 is never published by Compose (the offline tests assert this), so it is reachable only from processes in that container, which `release.sh` drives with `docker compose exec caddy caddy reload`. Exposing it any further requires an explicit decision.

## Blue-green deployment

Every application release, including the first, is deployed with `release.sh deploy`, as root, from a clean checkout of the release's deployment-bundle commit with its images already loaded (see above). It never builds, pulls, deploys a tag, or changes secrets or snapshots. The checkout must be owned by root (or listed in root's `safe.directory`) so `git status` works; the deploy refuses when `git status --porcelain -- deploy` reports any change.

```console
sudo MAWAREETH_RELEASE_MANIFEST=/etc/mawareeth/release-manifest.json deploy/runtime.sh prepare
sudo MAWAREETH_RELEASE_MANIFEST=/etc/mawareeth/release-manifest.json deploy/release.sh deploy
```

The deploy holds an exclusive non-blocking `flock` on `<state dir>/deploy.lock` for its whole run and journals each phase atomically (temporary file, `fsync`, rename, directory `fsync`) to root-only `<state dir>/deploy.journal` before acting: `idle → candidate-starting → migrating → candidate-ready → switching → verifying → draining → idle`. The journal has ten lines: `phase`, `prior_slot` (empty for bootstrap), `candidate_slot`, `manifest_commit`, `prior_commit`, `result` (`in-progress`, `verified`, `success`, or `failed:<phase>`), `started_at`, `updated_at`, `deploy_log`, and `migrate_log`. A deploy refuses to start unless the journal is absent or a well-formed, root-owned mode-0600 file with `phase=idle`.

1. Preflight reuses `runtime.sh` validation of the runtime file, manifest, local images, and Compose model. The active slot is read from the persisted route; the candidate is always the other, idle slot. The deploy refuses (exit 2) when the current runtime configuration does not hash to the snapshot recorded for the active slot (rotate configuration separately), when the active slot's container does not run its recorded image, when the active slot is not ready, when the running Caddy container was created from a different Compose model (a reload cannot fix stale mounts; run `runtime.sh up` first), or when the production edge does not already confirm the active slot's header and commit over verified TLS. Bootstrap instead refuses when any slot or Caddy is already running without slot records (a pre-0.6 runtime is live; migrate it manually).
2. The candidate slot is recreated with the manifest image, its container's image ID must equal the local manifest image, and it must answer `/health/live/`.
3. Exactly one `python manage.py migrate --noinput` runs inside the candidate. Its output is never printed (it can contain connection details) and goes to the deploy's migrate log.
4. The candidate must answer `/health/ready/` (all of its migrations applied) and `/health/release/` must report the manifest commit; both are retried until their deadline. The active slot must still be ready after the migration, otherwise the migration may not be backward compatible and the deploy stops with the route unchanged.
5. The candidate's slot record is written (see above), the route file is replaced atomically, and Caddy is reloaded (or started if it is not running). The Caddy state is read with `docker compose ps --all`; Compose errors and `restarting` are retried a bounded number of times and `paused` is refused, so a failing `ps` is never mistaken for "Caddy is stopped".
6. Production is verified through Caddy with `curl --resolve DOMAIN:443:127.0.0.1` and full certificate validation: `/health/release/` must carry `X-Mawareeth-Slot: <candidate>` and report the manifest commit, and `/health/ready/` must succeed. The journal then records `result=verified`.
7. Only then is the old slot stopped gracefully (`stop -t 35`, above gunicorn's 30s graceful timeout).

On any failure before step 5 the route never moves and the candidate is stopped. On a failure in steps 5-6 the prior route file is restored and reloaded only if it had already been replaced, the edge must then confirm the prior slot's header and commit, the candidate's records are restored, and the candidate is stopped; the old slot was never stopped. Applied migrations are never reversed or faked. Every wait is bounded and every probe attempt is capped at the remaining deadline; tune with `MAWAREETH_DEPLOY_LIVE_TIMEOUT` (default 120s), `MAWAREETH_DEPLOY_READY_TIMEOUT` (180s), `MAWAREETH_DEPLOY_MIGRATE_TIMEOUT` (900s), `MAWAREETH_DEPLOY_VERIFY_TIMEOUT` (60s), and `MAWAREETH_DEPLOY_POLL_INTERVAL` (2s).

Hangup, interrupt, and termination signals are trapped. Before the first mutation they end the deploy with nothing changed; afterwards they take the same failure path as an error in the current phase, and the restore itself ignores further signals. Terminal output failures (for example a closed SSH session) never abort the deploy.

**Diagnostic logs.** Each deploy creates its own root-owned mode-0600 pair in the root-only directory `<state dir>/logs/`: `deploy-<UTC time>-<pid>.log` (Compose, probe, and curl diagnostics plus every terminal message) and `migrate-<UTC time>-<pid>.log` (the migration output, which can contain connection details). The journal names both. Nothing rotates or deletes them: keep at least the logs of the current and previous releases and of any failed deploy until it is understood, and delete older pairs deliberately (for example after 90 days) as root. Never copy them to tickets or chat without redacting credentials.

**Bootstrap.** When no slot record exists (a fresh host), `release.sh deploy` targets blue: it starts PostgreSQL, starts and migrates blue, gates it on image, readiness, and identity, records it, seeds the route, starts Caddy, and verifies the edge. On failure before routing nothing is served; on a failure after Caddy started, Caddy and blue are stopped and blue's records are restored, so no route is ever served from an unverified slot. Before the first run, check from outside the host that the domain's public A/AAAA records resolve to this host only, that inbound TCP 80 and 443 reach it (Hetzner and host firewalls), that nothing else listens on 80/443 on the host, and that outbound DNS and TCP 443 work for ACME. Caddy obtains the certificate on its first start; each failed bootstrap retries issuance, and Let's Encrypt limits failed validations (currently 5 per account, hostname, and hour), so after one ACME-related failure fix DNS or the firewall and confirm with the deploy log before retrying. Raise `MAWAREETH_DEPLOY_VERIFY_TIMEOUT` for this first run if issuance may exceed 60s.

| Exit | Meaning | Production state |
|------|---------|------------------|
| 0 | Deployed and verified; old slot drained | Candidate serves; journal idle with `result=success` |
| 2 | Refused before mutation: invalid input, configuration drift, dirty bundle, active slot not ready or not on its recorded image, stale Caddy container, edge not confirming the active slot, live legacy runtime at bootstrap, or journal write failure | Nothing changed |
| 3 | Another deploy or runtime operation holds the lock | Nothing changed |
| 4 | Journal is not idle, or is malformed or unsafe | Nothing changed; recover manually |
| 5 | Candidate failed to start on the manifest image, become live, migrate, become ready, or report the commit; the active slot became unready after the migration; or a signal or unexpected error arrived in these phases | Route unchanged; candidate stopped; journal idle with `result=failed:<phase>` |
| 6 | The switch, Caddy reload, or production TLS verification failed, or a signal or unexpected error arrived during switching or verifying | Prior route restored (if it was changed) and confirmed at the edge (bootstrap: Caddy stopped); candidate records restored; old slot serving; journal idle with `result=failed:<phase>` |
| 7 | CRITICAL: restoring the prior state failed or could not be confirmed at the edge | Caddy may target the unverified candidate; journal `phase=restore-failed`; recover manually now |
| 8 | Verified release serves, but the old slot could not be drained, the journal could not be advanced, or the deploy stopped unexpectedly after verification | Candidate serves; journal left non-idle with `result=verified`; recover manually |
| 129, 130, 143 | Hangup, interrupt, or termination before the first mutation | Nothing changed |

**Migration timeout caveat.** `MAWAREETH_DEPLOY_MIGRATE_TIMEOUT` stops waiting for `docker compose exec`, but the migration process inside the container can continue until the candidate is stopped by the failure path. On PostgreSQL Django applies each migration in its own transaction, so an interrupted run normally leaves a prefix of complete migrations applied. The exceptions can be left half applied: migrations declared with `atomic = False`, `RunPython`/`RunSQL` operations that run outside a transaction (including `RunSQL` that commits on its own), and concurrent index operations (`AddIndexConcurrently`, `RemoveIndexConcurrently`, `CREATE INDEX CONCURRENTLY`), which cannot run in a transaction and can leave an `INVALID` index. Keep such operations idempotent and in their own migration, size the timeout for the slowest expected migration, and schedule long data migrations as a separate, deliberate release.

**Expand-migrate-contract.** Old and new releases run against the same schema during a deploy, and a failed deploy leaves new migrations applied while the old slot keeps serving. Every release's migrations must therefore be backward-compatible with the release currently serving: *expand* (add nullable or defaulted columns, new tables, new indexes) in one release; *migrate* data and switch code to the new shape in a following release; *contract* (drop or rename columns/tables, add `NOT NULL` without a default) only in a later release once no serving or rollback-candidate release reads the old shape. Never edit or squash migrations that production has applied. Automated detection of contract operations is deferred.

**Rollback** is a forward deploy of an earlier release: check out its deployment-bundle commit, make sure its image is loaded, and run `release.sh deploy` with its manifest. It must be compatible with the current schema, which the expand-migrate-contract rules guarantee for the immediately preceding release. Because 0.6 introduces this deployment contract, the oldest bundle you can roll back to with `release.sh` is this release.

**Manual recovery for a non-idle journal** (exit 4, 7 or 8, or a crashed deploy; automated `recover` is deferred). Run every step as root from the deployment checkout with `STATE=<state dir>` (default `deploy/runtime`):

1. Read `$STATE/deploy.journal`, the persisted route `$STATE/routes/active-slot.caddy`, the deploy and migrate logs the journal names, and `deploy/runtime.sh status`.
2. Decide which slot must serve: the candidate if the journal has `result=verified` or `phase=draining` (it was verified at the edge), otherwise the prior slot. For a bootstrap (`prior_slot` empty) that is not verified, Caddy must stay stopped (`docker compose -p mawareeth stop caddy`).
3. If the route file does not target that slot, rebuild it from the tracked seed and publish it atomically, with `SLOT` set to `blue` or `green`:

   ```console
   sed "s/app-blue:8000/app-$SLOT:8000/; s/X-Mawareeth-Slot blue/X-Mawareeth-Slot $SLOT/" deploy/caddy/active-slot.caddy > "$STATE/routes/.recover.caddy.tmp"
   install -o root -g root -m 0644 "$STATE/routes/.recover.caddy.tmp" "$STATE/routes/.recover.tmp" && rm "$STATE/routes/.recover.caddy.tmp"
   sync "$STATE/routes/.recover.tmp" && mv "$STATE/routes/.recover.tmp" "$STATE/routes/active-slot.caddy" && sync "$STATE/routes"
   ```

   The route stays mode 0644 because Caddy reads it; the runtime refuses any other mode and any extra `*.caddy` file in that directory.
4. Ensure that slot is running and healthy, reload Caddy with `docker compose -p mawareeth exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`, and confirm `curl -sD - --resolve DOMAIN:443:127.0.0.1 https://DOMAIN/health/release/` shows the expected `X-Mawareeth-Slot` and commit.
5. Make `$STATE/slots/<slot>.env` match what each slot runs: for an abandoned candidate restore `<slot>.env.prev` to `<slot>.env` (or remove the record if the candidate had none before). Records are root-owned mode 0600; publish them with `install -o root -g root -m 0600` to a temporary file in `$STATE/slots`, `sync`, and `mv`.
6. Stop the slot that is not routed with `docker compose -p mawareeth stop -t 35 app-<slot>`.
7. Reset the journal atomically: write the same ten lines with `phase=idle` (keep `result` as a `failed:<phase>` or `success` value), publish it with `install -o root -g root -m 0600` to a temporary file in `$STATE`, `sync`, and `mv` it over `deploy.journal`, or remove the journal.

## Immutable release artifacts

`Django CI` remains the application validation authority. After a successful push run on an allowed release branch, `.github/workflows/deploy.yml` checks out that run's exact commit, builds the application image once, starts that local image, and verifies both liveness and the baked release identity before pushing the same tag to GHCR. A failed build, smoke probe, identity assertion, registry push, or manifest validation prevents publication of a deployable manifest.

The workflow uploads `release-manifest-<commit>` containing `release-manifest.json`. Its `application.image` is the only production-consumable image identity and has the canonical form `ghcr.io/<owner>/<repository>@sha256:<digest>`; branch names and tags are not deployment inputs. The manifest also binds the same 40-character commit as the human release identity and deployment-bundle revision, plus configuration schema `1`, migration contract `expand-migrate-contract-v1`, and the successful `Django CI` workflow run. The deployment-bundle commit identifies all tracked Compose, Caddy, and deploy files added by later stories.

`deploy/release_manifest.py validate --input release-manifest.json --expected-repository ghcr.io/<owner>/<repository>` fails closed on missing, extra, duplicate, malformed, or inconsistent fields, on an image from any other repository, and on configuration schemas or migration contracts outside the supported sets in `release_manifest.py`. Consumers must always pass `--expected-repository`. The manifest compatibility version, configuration schema, and migration contract are release interfaces: change them only through an explicit compatibility decision, by updating both the workflow `env` and the supported sets.

The workflow validates the manifest inputs before pushing, so an unsupported contract never reaches GHCR. A registry push that succeeds before a later step fails can still leave a `:<commit>` tag without a manifest; never deploy by tag. Re-running the workflow rebuilds and re-pushes that tag with a new digest. Earlier manifests still name their own digests, so keep GHCR cleanup from deleting untagged versions that a retained manifest references. Manifest artifacts are kept for 90 days; archive any manifest you may need to roll back to after that.

`deploy.yml` runs from the default branch (a `workflow_run` rule), but it checks out and executes `deploy/release_manifest.py` from the released commit. Keep the script's CLI backward compatible with the default branch's workflow, or merge workflow and CLI changes together. The manifest contains identities and contract versions only. Runtime credentials, environment values, secret material, host deployment logic, and mutable source references must never be added. Stories 0.5 and 0.6 consume and verify this contract; this workflow does not contact or deploy to the production host.

## Prerequisites and inputs

Run only from an administrator workstation, never CI, with `bash`, `python3`, `jq`, OpenSSH, and the Hetzner `hcloud` CLI installed. Use a minimally scoped Hetzner token that can manage the one SSH key, firewall, and server. Agree the server name, key identity, SSH source CIDRs, and a weekly maintenance window before running.

Copy `host-baseline.env.example` to `host-baseline.env`; it is ignored by Git. Fill the token, server and key identity, paths to the matching public/private SSH keys, and comma-separated administrator CIDRs. Keep the config mode 0600. The script refuses missing or malformed input before contacting Hetzner.

Run `bash deploy/provision-host.sh`. The first run creates Ubuntu 24.04 CX33 in `nbg1`, an edge firewall, deletion protection, then bootstraps the guest. Re-runs reconcile the firewall, protection, and guest baseline without creating another matching server. An existing server with a different size, location, image, or baseline ownership label aborts for an explicit operator decision.

## Access, patching, and break-glass

Only listed CIDRs may SSH, and SSH requires an authorized key; password and root login are disabled after bootstrap. Ensure a second tested administrator key and Hetzner console access exist before changing access ranges. Do not remove the only permitted CIDR during maintenance. Ubuntu security updates are enabled automatically; review `/var/log/unattended-upgrades/` in the agreed weekly maintenance window and schedule any reboot deliberately.

## Runtime secrets

The baseline creates `/etc/mawareeth/runtime.env`, owned by root with mode 0600. Populate it directly on the server through an approved out-of-band administrative session, e.g. `sudoedit /etc/mawareeth/runtime.env`; never copy it into this repository, CI variables, command lines, or logs. Later runtime work decides the file format and consumers.

## Application runtime contract

With `DJANGO_ENV=production` the application refuses to start unless these are set: `DJANGO_KEY`, `DJANGO_ALLOWED_HOSTS` (explicit hostnames, no wildcards), `DJANGO_CSRF_TRUSTED_ORIGINS` (explicit `https://` origins), `DATABASE_URL`, `DATABASE_SSL_MODE`, `MAILGUN_ACCESS_KEY`, and `MAILGUN_SERVER_NAME`. Use `DATABASE_SSL_MODE=disable` for the private Compose PostgreSQL and `verify-ca`/`verify-full` for any new managed database; `prefer` is rejected because it silently falls back to plaintext. `require` (encrypted, server certificate not checked) is accepted only because Heroku Postgres supports nothing stronger, and will be rejected once production leaves Heroku. The verified modes also need `DATABASE_SSL_ROOT_CERT`: the in-container path of a readable CA file (e.g. a mounted Compose secret), not the certificate contents. Optional: `DATABASE_CONNECT_TIMEOUT` (default 5 seconds), `RELEASE_VERSION`, and `RELEASE_COMMIT_SHA` (baked into the image by CI).

Django trusts `X-Forwarded-Proto` from its upstream, so it must stay reachable only through Caddy. Health probes are answered before host validation and the HTTPS redirect, so private plain-HTTP checks may target a slot directly, e.g. `http://app-blue:8000/health/ready/`:

- `/health/live/` — process liveness; touches no dependency.
- `/health/ready/` — `200` only when PostgreSQL answers and every migration shipped in this release is applied; otherwise `503 {"status": "error"}` with no diagnostics.
- `/health/release/` — application version, release, and commit identity.

## Audit checks

On the host, `sudo ufw status numbered` must show TCP 22 only from the configured CIDRs and TCP 80/443 only; it must not show app, Docker, or PostgreSQL ports. In Hetzner, inspect the attached edge firewall for the same allow-list. Confirm `sudo sshd -T | grep -E 'passwordauthentication|permitrootlogin|pubkeyauthentication'`, `docker --version`, `docker compose version`, `stat -c '%U %G %a' /etc/mawareeth/runtime.env`, and `hcloud server describe SERVER` (deletion protection). Public checks must find only ports 80 and 443; port 22 is reachable only from an approved source.

Also confirm the Docker-port backstop is active and in effect: `systemctl is-active mawareeth-docker-firewall.service` must report `active`, and `sudo iptables -L DOCKER-USER -n` (plus `sudo ip6tables -L DOCKER-USER -n` where IPv6 is enabled) must show only the established-traffic accept, the 80/443 accept, and the trailing drop. Re-check this after any `systemctl restart docker`, since Docker recreates its own chain independently of `ufw`.

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
