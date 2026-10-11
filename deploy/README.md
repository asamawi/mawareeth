# Secured Hetzner host baseline

This directory creates the secure substrate only. It does not install Compose services, Caddy, Django, PostgreSQL, backups, DNS, monitoring, or deploy an application.

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

Capture exits non-zero until all evidence is available and reviewed. It writes only allow-listed app/process/database/add-on/domain fields, configuration key names, DNS answers, observation time, and the Heroku CLI version. Raw Heroku responses are never written. Do not redirect CLI debugging output or save raw API responses; they may contain database URLs or credentials.

Review every section against the Heroku dashboard and the responsible operator's knowledge. Record confirmations explicitly after that review:

```console
python deploy/heroku_inventory.py confirm --input deploy/heroku-inventory.local.json --confirmation target_app_confirmed --confirmation database_reviewed --confirmation addons_reviewed --confirmation config_keys_reviewed --confirmation domains_and_dns_reviewed
python deploy/heroku_inventory.py verify --input deploy/heroku-inventory.local.json
```

Verification fails closed when a required section is missing, malformed, unresolved, or unconfirmed. Never replace an unknown value with a repository default. Before proposing a reviewed baseline for source control, inspect the complete file and search for database URL schemes, credentials, tokens, cookies, private keys, certificate material, and configuration values. The default local output and `docs/operations/heroku-inventory.redacted.json` are ignored deliberately; adding a live baseline requires explicit operator approval and a forced add after review.
