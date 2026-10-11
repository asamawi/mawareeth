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

## Audit checks

On the host, `sudo ufw status numbered` must show TCP 22 only from the configured CIDRs and TCP 80/443 only; it must not show app, Docker, or PostgreSQL ports. In Hetzner, inspect the attached edge firewall for the same allow-list. Confirm `sudo sshd -T | grep -E 'passwordauthentication|permitrootlogin|pubkeyauthentication'`, `docker --version`, `docker compose version`, `stat -c '%U %G %a' /etc/mawareeth/runtime.env`, and `hcloud server describe SERVER` (deletion protection). Public checks must find only ports 80 and 443; port 22 is reachable only from an approved source.
