# Secured Hetzner host baseline

This directory creates the secure substrate only. It does not install Compose services, Caddy, Django, PostgreSQL, backups, DNS, monitoring, or deploy an application.

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
