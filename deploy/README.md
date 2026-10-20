# Secured Hetzner host baseline

This directory contains the secured host baseline, the private Compose runtime, blue-green release deployment, encrypted off-host database backup with restore verification, and host monitoring with alerting through SCDF's Prometheus/Alertmanager plus an external Better Stack probe. Crash recovery after an interrupted deploy is automated by `release.sh recover`, and `monitor.sh drill` records the operator's alert-path drill. It does not automate contract-migration detection, host-state backup, DNS, or cutover.

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

Each slot's release is recorded in root-only `<state dir>/slots/<slot>.env` (`IMAGE`, `COMMIT`, `SNAPSHOT`), written only by `release.sh deploy`. The deploy writes the candidate's record in the `switching` phase: after the candidate passed its readiness and release-identity gates, immediately before the route file is replaced, and therefore *before* the edge verification. At the same moment the record it replaces is saved as `<slot>.env.prev` (or a stale `.prev` is removed when the slot had no record). If the switch or the edge verification then fails, the deploy puts the record back first, journals `records=untouched`, and only then puts the earlier `.prev` back (removing the record if the slot had none), so a failed deploy never leaves an unverified release recorded. If that journal write fails, `.prev` keeps the pre-deploy record and the deploy prints a WARNING, because a journal that still says `records=replaced` makes `recover` restore the record from `.prev`. The journal's `records=` line says whether `.prev` already holds the pre-deploy record, so a crash anywhere in this sequence is visible as a non-idle journal that `release.sh recover` can resolve (see Crash recovery).

`up` restarts the recorded active release after `down`; it never changes releases. It refuses when the route or the active slot's record is absent (bootstrap the first release with `release.sh deploy`), when the manifest image or commit differs from the active record (use `release.sh deploy`), and when the runtime configuration differs from the recorded snapshot. It starts PostgreSQL (waiting for health), then the active slot (waiting for health), then Caddy, each bounded by `MAWAREETH_RUNTIME_WAIT_TIMEOUT` (default 300s); it never starts the idle slot and never runs migrations. `prepare`, `up`, and `down` take the deploy lock and refuse while the deploy journal is not idle. `status` and `logs` are read-only: they create no state directory, snapshot, or record and tolerate configuration drift.

**Reboots.** Containers use `restart: unless-stopped`, so after a host reboot Docker itself restarts PostgreSQL, the slot that was running, and Caddy, without the runtime's ordering, lock, or journal checks. Expect brief `502` responses until the slot is ready again. After every reboot, as root: confirm `<state dir>/deploy.journal` is absent or `phase=idle` (otherwise preview with `deploy/release.sh recover --dry-run`, then run `deploy/release.sh recover` before anything else); run `deploy/runtime.sh status` and check that only the routed slot is running and healthy; confirm `curl -sD - --resolve DOMAIN:443:127.0.0.1 https://DOMAIN/health/release/` shows the routed slot's `X-Mawareeth-Slot` and the recorded commit; if anything is off, run `deploy/runtime.sh up` with the active release's manifest.

**Caddy admin API (deliberate decision).** `admin off` would make `caddy reload` impossible, so the Caddyfile enables the admin API on `localhost:2019` inside the Caddy container only. Port 2019 is never published by Compose (the offline tests assert this), so it is reachable only from processes in that container, which `release.sh` drives with `docker compose exec caddy caddy reload`. Exposing it any further requires an explicit decision.

## Blue-green deployment

Every application release, including the first, is deployed with `release.sh deploy`, as root, from a clean checkout of the release's deployment-bundle commit with its images already loaded (see above). It never builds, pulls, deploys a tag, or changes secrets or snapshots. The checkout must be owned by root (or listed in root's `safe.directory`) so `git status` works; the deploy refuses when `git status --porcelain -- deploy` reports any change.

```console
sudo MAWAREETH_RELEASE_MANIFEST=/etc/mawareeth/release-manifest.json deploy/runtime.sh prepare
sudo MAWAREETH_RELEASE_MANIFEST=/etc/mawareeth/release-manifest.json deploy/release.sh deploy
```

The deploy holds an exclusive non-blocking `flock` on `<state dir>/deploy.lock` for its whole run and journals each phase atomically (temporary file, `fsync`, rename, directory `fsync`) to root-only `<state dir>/deploy.journal` before acting: `idle → candidate-starting → migrating → candidate-ready → switching → verifying → draining → idle`. The journal has eleven lines: `phase`, `prior_slot` (empty for bootstrap), `candidate_slot`, `manifest_commit`, `prior_commit`, `result` (`in-progress`, `verified`, `success`, or `failed:<phase>`), `started_at`, `updated_at`, `deploy_log`, `migrate_log`, and `records`. `records=untouched` means the candidate's slot record has not been touched; in `switching` the deploy first publishes `<candidate>.env.prev` (the pre-deploy record, or removes it when there was none), then journals `records=replaced`, and only then writes the candidate record and the route. Journals written before `records=` existed have ten lines; the deploy and the runtime still parse them, but `recover` refuses them. A deploy refuses to start unless the journal is absent or a well-formed, root-owned mode-0600 file with `phase=idle`.

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
| 4 | Journal is not idle, or is malformed or unsafe | Nothing changed; run `release.sh recover` |
| 5 | Candidate failed to start on the manifest image, become live, migrate, become ready, or report the commit; the active slot became unready after the migration; or a signal or unexpected error arrived in these phases | Route unchanged; candidate stopped; journal idle with `result=failed:<phase>` |
| 6 | The switch, Caddy reload, or production TLS verification failed, or a signal or unexpected error arrived during switching or verifying | Prior route restored (if it was changed) and confirmed at the edge (bootstrap: Caddy stopped); candidate records restored; old slot serving; journal idle with `result=failed:<phase>` |
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
4. Ensure that slot is running and healthy, reload Caddy with `docker compose -p mawareeth exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`, and confirm `curl -sD - --resolve DOMAIN:443:127.0.0.1 https://DOMAIN/health/release/` shows the expected `X-Mawareeth-Slot` and commit.
5. Make `$STATE/slots/<slot>.env` match what each slot runs: for an abandoned candidate restore `<slot>.env.prev` to `<slot>.env` (or remove the record if the candidate had none before). Records are root-owned mode 0600; publish them with `install -o root -g root -m 0600` to a temporary file in `$STATE/slots`, `sync`, and `mv`.
6. Stop the slot that is not routed with `docker compose -p mawareeth stop -t 35 app-<slot>`.
7. Reset the journal atomically: write the same lines (ten or eleven) with `phase=idle` (keep `result` as a `failed:<phase>` or `success` value), publish it with `install -o root -g root -m 0600` to a temporary file in `$STATE`, `sync`, and `mv` it over `deploy.journal`, or remove the journal.

## Encrypted backup and restore

`deploy/backup.sh` backs PostgreSQL up off-host into a client-side encrypted [Restic](https://restic.net/) repository on a dedicated Hetzner BX11 Storage Box sub-account, proves monthly that the latest dump restores, and gates irreplaceable writes on that proof. Restic runs only from the `RESTIC_IMAGE` pinned by digest in `runtime-images.lock` (load it like the other runtime images and check its `RepoDigests`); the script never builds or pulls. It never takes the deploy lock and never touches slots, routes, the deploy journal, or runtime snapshots. Run every command as root.

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

- **`backup`** takes a non-blocking lock on `<state dir>/backup.lock` (exit 3 if held), removes Restic containers left by earlier runs (and fails if one is still running), forgets snapshots left `pending` by earlier failed runs, and finds the one running Compose PostgreSQL container by its labels. In one `psql` session it opens a `REPEATABLE READ` transaction, exports its snapshot, and takes an exact `count(*)` of every user table except other sessions' temporary schemas, keyed by `format('%I.%I')`; the manifest must include `public.django_migrations`. `pg_dump -Fc --snapshot=<id>` then streams that same snapshot straight into Restic (`mawareeth.dump`), so dump and counts describe the same data. `psql` and `pg_dump` run under `timeout` inside the container too. The counts are stored as `manifest.tsv`. Both snapshots are tagged `pending,run:<UTC stamp>`; the whole stored dump is read back (verifying every blob) and must start with `PGDMP` before both are re-tagged `complete`. `restic tag` rewrites snapshots under new IDs, so the new IDs are re-read and recorded. Retention is `forget --tag complete --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune`. Unencrypted dump bytes never touch the host disk. Every stage is capped against one 4-hour budget, and every Restic container has a deterministic name and is force-removed if its client fails or times out. Any failed stage before retention forgets every snapshot of the run.
- **`verify-restore`** runs `restic check` (metadata, not `--read-data`), picks the newest `complete` dump that has exactly one manifest of the same run, refuses a dump older than 24 hours or dated more than 5 minutes in the future (RPO, clock skew), requires free space on Docker's data root of at least 3× the dump size, restores it with `pg_restore --exit-on-error --no-owner --no-acl` into a throwaway PostgreSQL from the pinned image with `--network none`, a labelled temporary volume, and a random password, compares every table count (including `django_migrations`) with the manifest, and requires the whole run to finish within 4 hours (RTO; every stage is capped against that budget and an exhausted budget is `slow`). The throwaway container and volume are removed on every exit path; a removal failure is reported as `CRITICAL`. It never touches the production database or volume.
- **`gate`** exits 0 only when the restore evidence says `pass` and is at most 35 days old **and** the last backup is `ok` and at most 26 hours old; otherwise it exits 1 and names each unmet condition. Malformed timestamps fail closed.
- **`status`** prints the last backup status, the restore evidence, and the gate verdict.

| Exit | Meaning |
|------|---------|
| 0 | Success (gate: recovery is proven) |
| 1 | Gate not satisfied |
| 2 | Refused before any change: invalid configuration, unsafe file ownership or mode, unpinned or wrongly pinned image |
| 3 | Another backup operation holds the backup lock |
| 5 | Backup failed; `last-backup` has `result=failed:<stage>`: `setup` (cache volume or a still-running leftover Restic container), `repository` (unreachable, host key rejected, or stale-pending cleanup failed), `postgres` (zero or several PostgreSQL containers), `dump` (snapshot transaction, counting, `pg_dump`, or storing the dump), `manifest` (no tables, no `public.django_migrations`, or storing the manifest), `verify` (snapshot IDs or `PGDMP` read-back), `tag`, or `retention` (the run's complete snapshots are kept). The terminal never shows Restic or SSH output; `init` failures also exit 5 |
| 6 | Restore verification failed; `restore-verified` has `result=fail:<reason>`: `no-backup` (no complete dump), `manifest` (no dump with exactly one manifest, or an empty, malformed, or `django_migrations`-less manifest), `repository` (unreachable, `restic check` failed, unparseable listing, or a read failed), `stale` (older than 24h or future-dated), `setup` (disk space, volume inspection or creation, container start, readiness, or a refusal mid-run), `restore` (`pg_restore` failed), `count` (counting failed), `count-mismatch`, `cleanup`, `slow` (RTO exceeded), or `interrupted` (signal) |
| 129, 130, 143 | Hangup, interrupt, or termination before the operation started (afterwards a signal maps to 5 or 6) |

**Evidence.** The root-only (0700) directory `<state dir>/backup/` holds `last-backup` and `restore-verified`, each a mode-0600 `key=value` file published atomically. `last-backup` records the result, run, finish time, and the dump and manifest snapshot IDs. `restore-verified` records the result, verification time, backup run, snapshot IDs, dump time and age, duration, table count, RPO/RTO, and its log. Per-run diagnostic logs (Restic, SSH, and PostgreSQL output) are kept in `<state dir>/backup/logs/` (0600). Like the deploy logs they are never rotated automatically: prune old ones deliberately as root and redact them before sharing.

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
   STATE="$(realpath deploy/runtime)"; LOCK="$STATE/backup.lock"
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

3. Choose the dump snapshot `ID` and the manifest snapshot `MANIFEST_ID` that share its `run:` tag.
4. **Data rollback on an existing host: never destroy the current data.** Take a final backup (`deploy/backup.sh backup`, with the timers still stopped), stop PostgreSQL (`docker compose -p mawareeth stop postgres`), and keep the current volume: copy it into a retained volume such as `mawareeth-postgres-data-before-<date>` (`docker volume create mawareeth-postgres-data-before-<date>` then `docker run --rm --network none -v mawareeth-postgres-data:/from:ro -v mawareeth-postgres-data-before-<date>:/to IMAGE_POSTGRES sh -c 'cp -a /from/. /to/'`). Only after the copy is verified, remove `mawareeth-postgres-data` so `runtime.sh prepare` creates a fresh empty one. On a rebuilt host the volume is already new and empty.
5. Start only PostgreSQL on the empty volume (`deploy/runtime.sh prepare`, then `docker compose -p mawareeth start postgres` or `runtime.sh up` with the release manifest and stop the slot again) and stream the dump in without writing it to disk:

   ```console
   restic dump ID /mawareeth.dump | pg pg_restore --exit-on-error --no-owner --no-acl -U "$PGU" -d "$PGD"
   ```

6. Compare the counts with the manifest; the output must be identical:

   ```console
   restic dump MANIFEST_ID /manifest.tsv > /dev/shm/manifest.tsv
   pg psql -X -q -A -t -F "$(printf '\t')" -v ON_ERROR_STOP=1 -U "$PGU" -d "$PGD" > /dev/shm/restored.tsv <<'SQL'
   SELECT format('SELECT %L, count(*) FROM %I.%I', CASE WHEN k ~ '[[:cntrl:]]' THEN 'hex:' || encode(convert_to(k, 'UTF8'), 'hex') ELSE k END, schemaname, tablename) FROM (SELECT schemaname, tablename, format('%I.%I', schemaname, tablename) AS k FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema') AND schemaname !~ '^pg_(toast_)?temp_') AS t ORDER BY schemaname, tablename \gexec
   SQL
   diff /dev/shm/manifest.tsv /dev/shm/restored.tsv && echo counts match; rm -f /dev/shm/manifest.tsv /dev/shm/restored.tsv
   ```

7. Deploy the matching release with `release.sh deploy` and verify the edge.
8. Re-enable the timers (`systemctl start mawareeth-backup.timer mawareeth-restore-check.timer`), then run `backup.sh backup` and `backup.sh verify-restore` and confirm `backup.sh gate` before reopening writes. Keep the retained volume until the restored data has been accepted, then remove it in a separately approved step.

### Known limits (deferred)

- The host holds the repository password and an SSH key with write access, so a compromised host can delete or prune the backups; the repository is not append-only (append-only or object-locked storage is deferred).
- Only the application database is backed up. Roles and other cluster globals are not (`pg_dump` covers one database; restores use `--no-owner --no-acl`), and host state (`/etc/mawareeth`, slot records, routes) is not; host rebuild is story 0.9 and host-state backup is deferred.
- Verification compares exact row counts, not row contents: a restore with the right counts but different data would pass.
- There is no WAL archiving or point-in-time recovery (see Real RPO).
- Alerting on failed or stale backups and restore checks is in [Monitoring and alerting](#monitoring-and-alerting). Logs under `<state dir>/backup/logs/` are pruned manually.

## Monitoring and alerting

Mawareeth reuses SCDF's monitoring stack instead of running its own. This host runs only Ubuntu's `prometheus-node-exporter`, bound to its Tailscale IPv4 on port 9100. SCDF's Prometheus and Alertmanager on `p1` scrape it over Tailscale and email SCDF's existing `SMTP_TO` address through a `project=mawareeth` route. Better Stack probes the public readiness endpoint from outside. Prometheus and Alertmanager never run on this host, and port 9100 is never public: the Hetzner cloud firewall is unchanged, and UFW admits 9100/tcp only `in on tailscale0` from `100.64.0.0/10`. Run every command as root. `monitor.sh` never takes the deploy or backup locks and never touches slots, routes, or the database.

### Host setup

1. **Install.** `sudo deploy/monitor.sh install` first requires `ufw status` to report `Status: active` (otherwise it exits 1 before changing anything; run the host baseline first). It then does the following:
   - Adds Tailscale's official signed noble repository (`/etc/apt/keyrings/tailscale-archive-keyring.gpg`, `/etc/apt/sources.list.d/tailscale.list`).
   - Installs `tailscale` and `prometheus-node-exporter` (the exporter comes from the Ubuntu archive).
   - Writes `/usr/local/sbin/mawareeth-node-exporter` and the drop-in `/etc/systemd/system/prometheus-node-exporter.service.d/10-mawareeth.conf` (`After=tailscaled.service`, `Restart=always`, `RestartSec=15`). The wrapper reads `tailscale ip -4` and starts the exporter with `--web.listen-address=<that IP>:9100 --collector.textfile.directory=/var/lib/prometheus/node-exporter`. Without a Tailscale IPv4 in `100.64.0.0/10` it exits 1 and systemd retries every 15 seconds. It never falls back to `0.0.0.0` or another address. The drop-in replaces the packaged `ExecStart`, so `ARGS` in `/etc/default/prometheus-node-exporter` is ignored.
   - Adds the UFW rule `allow in on tailscale0 from 100.64.0.0/10 to any port 9100 proto tcp`.
   - Writes `/etc/systemd/journald.conf.d/50-mawareeth.conf` (`SystemMaxUse=500M`, `SystemKeepFree=1G`, `MaxRetentionSec=30day`) and restarts journald.
   - Writes and enables `mawareeth-monitor-collect.{service,timer}` (`OnCalendar=*:0/5`, `Persistent=true`) and publishes the first metrics.

   Re-run `install` after moving the checkout.
2. **Join the tailnet interactively.** Run `sudo tailscale up --hostname=mawareeth-prod` and open the printed login URL as an SCDF tailnet admin. Never pass an auth key on the command line, and never put one in this repository, CI, or a log. In the Tailscale admin console, disable key expiry for this node, and restrict the tailnet ACL so that only `p1` may reach `mawareeth-prod:9100`. Then run `sudo systemctl restart prometheus-node-exporter` (otherwise it starts within 15 seconds anyway).
3. **Check the host.** All of these must hold:
   - `tailscale ip -4` prints a `100.x` address.
   - `sudo ss -ltnp 'sport = :9100'` shows only that address, never `0.0.0.0` or `*`.
   - `sudo ufw status numbered` shows 9100/tcp only on `tailscale0` from `100.64.0.0/10`.
   - `curl -s http://$(tailscale ip -4):9100/metrics | grep '^mawareeth_'` lists the seven metrics.
   - `systemctl list-timers mawareeth-monitor-collect.timer` shows the timer.

**Collector.** `monitor.sh collect` runs every 5 minutes. It reads `<state dir>/backup/last-backup` and `restore-verified` with the same strict reader as `backup.sh gate`: root-owned, mode 0600, `key=value` lines. It then atomically writes `/var/lib/prometheus/node-exporter/mawareeth.prom` (0644). That file holds these gauges:
- `mawareeth_backup_last_result_ok` and `mawareeth_backup_last_ok_timestamp_seconds` (the finish time when the result is `ok`).
- `mawareeth_restore_last_result_pass` and `mawareeth_restore_last_pass_timestamp_seconds` (the verification time when the result is `pass`).
- `mawareeth_drill_active_code` (the code of the active alert-path drill, otherwise 0) and `mawareeth_drill_last_pass_timestamp_seconds` (the last passed drill), read from `<state dir>/monitor/drill` (see [Alert-path drill](#alert-path-drill)).
- `mawareeth_monitor_collect_timestamp_seconds`.

A missing, mis-owned, or malformed record, or one with a non-decimal epoch, publishes 0, so the matching alert fires. The collector still exits 0 in that case. Ages are judged by the rules on `p1` (`time() - metric`). `monitor.sh status` prints what a collect would publish, the current file, and the drill state. Exit codes: 0 success, 1 an install or drill write step failed, 2 refused (bad input or environment), 3 another monitor operation holds `<state dir>/monitor.lock`.

### Wiring `p1`

Ask before changing anything on `p1`. Merge the three snippets under `deploy/monitoring/` into SCDF's configuration there, using SCDF's usual procedure for its own rule and route changes:

1. Add the `mawareeth-node` job from `prometheus-scrape.yml` to `scrape_configs`, with `<tailscale-ip>` replaced by the host's `tailscale ip -4`. The job carries the labels `alias=mawareeth-prod` and `project=mawareeth`.
2. Copy `mawareeth-alerts.yml` next to SCDF's rule files and list it under `rule_files`.
3. From `alertmanager-route.yml`:
   - Add the `project="mawareeth"` route as the **first** child of `route.routes`, so no catch-all takes it.
   - Add the `mawareeth-email` receiver, with `${SMTP_TO}` set to the same address SCDF's receiver uses. SMTP host and credentials come from `p1`'s existing `global.smtp_*` settings and never from this repository.
   - Add both `inhibit_rules`.

   Emails arrive with the subject `[MAWAREETH <severity>] <alertname>`.
4. Validate before reloading. Alertmanager does not expand environment variables, so `grep -n '\${' alertmanager.yml` must print nothing: no literal `${SMTP_TO}` or other `${...}` may remain. Then run `promtool check config prometheus.yml`, `promtool check rules mawareeth-alerts.yml`, `amtool check-config alertmanager.yml`, and `amtool config routes test --config.file=alertmanager.yml --verify.receivers=mawareeth-email project=mawareeth`. Then reload both services. Under Prometheus → Targets, `mawareeth-node` must be `UP`.
5. **If the Tailscale IPv4 changes.** It stays fixed while the node keeps its registration. If the node re-registers with Tailscale (for example after a logout, key expiry, or rebuild) and `tailscale ip -4` changes, update the `<tailscale-ip>` target in p1's scrape job and reload Prometheus, then run `sudo systemctl restart prometheus-node-exporter` on this host. A running exporter does not rebind on its own.

| Alert | Fires when | Severity |
|-------|-----------|----------|
| `MawareethHostDown` | `up == 0`, or no `up` series at all (the scrape job is missing or renamed), for 2 minutes; inhibits every other Mawareeth alert | critical |
| `MawareethBackupUnhealthy` | Last backup not `ok`, record unusable, last success older than 26 hours, or more than 5 minutes in the future (clock skew, which also closes `backup.sh gate`) | critical |
| `MawareethRestoreUnhealthy` | Last restore check not `pass`, record unusable, last pass older than 35 days, or more than 5 minutes in the future | critical |
| `MawareethDiskWarning` | An ext4/xfs/btrfs filesystem more than 75% used for 5 minutes | warning |
| `MawareethDiskCritical` | More than 85% used for 5 minutes (inhibits the warning on the same mountpoint) | critical |
| `MawareethCollectorStale` | `mawareeth.prom` older than 20 minutes, absent, or unparseable (`node_textfile_scrape_error == 1`) | warning |
| `MawareethAlertDrill` | An alert-path drill is active (`mawareeth_drill_active_code > 0`); fires at once and carries the code in its summary | info |
| `MawareethDrillOverdue` | The last passed drill is older than 92 days, none has passed (or the drill record is unusable), the metric is absent, or it is more than 5 minutes in the future | warning |

`deploy/tests/test_monitor.sh` unit-tests these rules with `promtool test rules` and checks the route snippet with `amtool check-config` and `amtool config routes test`. Those checks run only when `promtool` and `amtool` are installed (otherwise only static checks run); with `CI` set, a missing tool fails the suite. The end-to-end path is proven by the operator's [alert-path drill](#alert-path-drill), which must pass before cutover and then every quarter.

The `deploy-shell` job in the `Django CI` workflow (`.github/workflows/django.yml`) installs pinned, checksum-verified ShellCheck, `promtool`, and `amtool`, runs ShellCheck over `deploy/*.sh` and `deploy/tests/*.sh`, and runs every `deploy/tests/*.sh` suite twice: unprivileged and as root. A failure there fails `Django CI`, so `Publish Release Image` does not publish.

### Better Stack uptime probe

Create one Better Stack Uptime monitor:
- Type "URL returns a status code", URL `https://DOMAIN/health/ready/`, expected status 200.
- Check frequency 3 minutes, confirmation period 3 minutes (so two failed checks in a row alert), request timeout 15 seconds.
- Email notification to the same `SMTP_TO` address, with the monitor name prefixed `MAWAREETH`.

`/health/ready/` returns 200 only when PostgreSQL answers and the schema is current. Otherwise it returns 503 with no diagnostics, so a down edge, a dead slot, or a broken database all alert. Keep the Better Stack account credentials in the operator's password manager. Better Stack needs no host change: it reaches the public HTTPS edge.

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
4. While this fires, the other Mawareeth alerts are suppressed. Re-check them after recovery.

<a id="runbook-mawareethbackupunhealthy"></a>
**MawareethBackupUnhealthy.**
1. Run `sudo deploy/backup.sh status`, then `journalctl -u mawareeth-backup.service`.
2. The `result=failed:<stage>` value and the run log named in `last-backup` identify the failing stage (see the exit-code table above).
3. If the record is absent or unusable, check `ls -l <state dir>/backup/`: the record must be `root:root` 0600.
4. Fix the cause, then run `sudo deploy/backup.sh backup` by hand. The resolution arrives after the next collect, scrape, rule evaluation, and Alertmanager group interval, typically within about 15 minutes.

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

Also confirm the Docker-port backstop is active and in effect: `systemctl is-active mawareeth-docker-firewall.service` must report `active`, and `sudo iptables -L DOCKER-USER -n` (plus `sudo ip6tables -L DOCKER-USER -n` where IPv6 is enabled) must show only the established-traffic accept, the 80/443 accept, and the trailing drop. Docker recreates its own chain independently of `ufw`, so the unit declares `BindsTo=docker.service` and `PartOf=docker.service` and is installed into `docker.service.wants`: it stops with Docker for any reason (including a crash) and reapplies the rules whenever Docker starts or restarts. `systemctl show -p BindsTo,PartOf,WantedBy mawareeth-docker-firewall.service` must list `docker.service`; on a host bootstrapped before this was added, rerun `bootstrap-host.sh` (idempotent) to install the updated unit. The same checks still apply after a `systemctl restart docker`.

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
