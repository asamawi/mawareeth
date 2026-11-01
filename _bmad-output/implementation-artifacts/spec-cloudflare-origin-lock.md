---
title: 'Lock the origin to Cloudflare: restrict 80/443 to Cloudflare ranges'
type: 'feature'
created: '2026-11-01'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'fa95645206e3d4d30a2df9aa88be8d83c53c041c'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-pre-cutover-cloudflare-edge.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Production sits behind proxied Cloudflare (`EDGE_MODE=cloudflare`), yet the host accepts 80/443 from any address, so scanners and attackers reach the origin directly and bypass Cloudflare.

**Approach:** Add an opt-in host-baseline setting, `PUBLIC_WEB_SOURCES=cloudflare`. It limits inbound 80/443 to Cloudflare's published ranges in all three paths traffic takes:
- the Hetzner cloud firewall;
- the `DOCKER-USER` chain, which IPv4 traffic to Docker-published ports uses;
- UFW, which IPv6 traffic through docker-proxy reaches.

A new `deploy/cloudflare-ips.txt` is the single source of the ranges, also for Caddy's `trusted_proxies`. The default `any` keeps today's behaviour, so the rehearsal and ACME path still works. Per-hostname Authenticated Origin Pulls is split into its own spec (see deferred-work).

## Boundaries & Constraints

**Always:**
- With `PUBLIC_WEB_SOURCES` absent or `any`, the generated Hetzner payload, DOCKER-USER rules and UFW rules are exactly today's.
- Rules are deterministic and idempotent: rerunning, or switching between `any` and `cloudflare`, leaves no stale 80/443 rule.
- IPv4 ranges go only to iptables, and IPv6 ranges only to ip6tables.
- The SSH allow-list, `tailscale0` rules, the established-traffic accept and the container egress `RETURN` rules are unchanged.
- A test fails if Caddy's `trusted_proxies` list differs from `deploy/cloudflare-ips.txt`.
- Errors name the key or file, never secrets.

**Ask First:**
- Restricting any port other than 80/443.
- Any change to how SSH reaches the host.
- Enabling Cloudflare's zone-level shared-certificate Authenticated Origin Pulls.

**Never:**
- Touch the live host, Cloudflare or Hetzner.
- Fetch ranges at runtime.
- Allow catch-all ranges (IPv4 shorter than /8, IPv6 shorter than /12, `0.0.0.0/0`, `::/0`).
- Change Caddy behaviour beyond reading the same ranges.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default | `PUBLIC_WEB_SOURCES` absent or `any` | Hetzner 80/443 from `0.0.0.0/0`,`::/0`; DOCKER-USER/UFW 80/443 from anywhere, as today | N/A |
| Cloudflare lock | `PUBLIC_WEB_SOURCES=cloudflare` | Hetzner 80 and 443 rules list exactly the file's ranges; DOCKER-USER accepts 80/443 only from them (v4/v6 split); UFW allows 80/443 only from them; nothing else accepts 80/443 | N/A |
| Mode switch / rerun | apply `cloudflare`, then `any`, then `cloudflare` again | each run leaves exactly that mode's rules, no duplicates or leftovers | N/A |
| Bad value | `PUBLIC_WEB_SOURCES=other` | refused before contacting Hetzner | names `PUBLIC_WEB_SOURCES` |
| Bad ranges file | missing, empty, invalid CIDR, catch-all or over-broad range, IPv4-only or IPv6-only | refused before contacting Hetzner | names `deploy/cloudflare-ips.txt` |

</frozen-after-approval>

## Code Map

- `deploy/caddy/edge/cloudflare/global.caddy` -- `trusted_proxies static <ranges>` on one line. The ranges are today's Cloudflare list, and it must equal the new `deploy/cloudflare-ips.txt` (one CIDR per line, `#` comments allowed).
- `deploy/provision-host.sh:107-110` -- the jq `rules_payload` has 80/443 sources `["0.0.0.0/0","::/0"]`; make them a variable. Input validation runs before contacting Hetzner (pattern near :27-44 for `SSH_ALLOWED_CIDRS`). `:176` `bootstrap_cmd` passes environment to bootstrap with `printf %q`.
- `deploy/bootstrap-host.sh:84-91` -- `restrict()` inside the heredoc-written `/usr/local/sbin/mawareeth-docker-firewall`. Its rules are guarded by `-C`, including the `--dports 80,443 -j ACCEPT` at position 2, and IPv4/IPv6 are handled by `restrict iptables` / `restrict ip6tables`. The script runs at every Docker start, so the chosen ranges must be baked into the script when it is written. `:142-155` runs `ufw --force reset`, the SSH allows, then `ufw allow 80/tcp` and `443/tcp`.
- `deploy/host-baseline.env.example` -- the documented baseline keys; add `PUBLIC_WEB_SOURCES=`.
- `deploy/tests/test_host_baseline.sh` -- stubs `hcloud`, `jq`, `curl` and `ssh`, matching jq expressions literally (`*'--argjson ssh_sources'*` and similar); the forbidden-port checks (`contains_port`); the `need` assertions on the bootstrap text. `deploy/tests/test_compose_runtime.sh:82-89` has the catch-all range guard to reuse or mirror.
- `deploy/README.md` -- "Cloudflare edge" (trust-scope paragraph, refresh guidance) and "Access, patching, and break-glass" (two firewalls, `monitor.sh install` after re-bootstrap).

## Tasks & Acceptance

**Execution:**
- [x] `deploy/cloudflare-ips.txt`, `deploy/caddy/edge/cloudflare/global.caddy` -- add the ranges file and keep Caddy's list identical; test the sync.
- [x] `deploy/provision-host.sh`, `deploy/host-baseline.env.example` -- validate `PUBLIC_WEB_SOURCES` and the ranges file, build the 80/443 sources from the mode, and pass the mode and ranges to bootstrap.
- [x] `deploy/bootstrap-host.sh` -- bake the mode's 80/443 accept rules (per family) into the firewall script, rebuilding them deterministically, and set the UFW 80/443 allows per mode.
- [x] `deploy/tests/test_host_baseline.sh` (plus `test_compose_runtime.sh` for the sync if that fits better) -- cover every matrix row, including the generated firewall script's rules per family and a mode switch.
- [x] `deploy/README.md` -- enabling:
  1. set `PUBLIC_WEB_SOURCES=cloudflare` in `host-baseline.env`;
  2. rerun provisioning (from the container pattern);
  3. rerun `monitor.sh install`, because bootstrap resets UFW;
  4. verify: Hetzner rules, `iptables`/`ip6tables -S DOCKER-USER`, `ufw status`, the public site through Cloudflare, and a direct `curl --resolve www.mawareeth.com:443:2.28.64.83` from a non-Cloudflare address timing out.

  Rollback is `any` and rerun. Refresh `cloudflare-ips.txt` from `https://www.cloudflare.com/ips-v4` and `/ips-v6` when Cloudflare changes them, and redeploy for Caddy.

**Acceptance Criteria:**
- Given today's `host-baseline.env`, when provisioning runs, then the Hetzner rules payload, the generated firewall script and the UFW commands are identical to today's.
- Given `cloudflare-ips.txt` updated without `global.caddy`, when the tests run, then they fail.

## Verification

**Commands:**
- `bash deploy/tests/test_host_baseline.sh` and `bash deploy/tests/test_compose_runtime.sh` on Linux, both unprivileged and as root -- expected: pass.
- ShellCheck 0.11.0 on `deploy/*.sh deploy/tests/*.sh` -- expected: clean.
- `caddy adapt --validate` (pinned image) in cloudflare mode -- expected: `trusted_proxies` ranges unchanged from today's.

**Manual checks:**
- Run the generated `mawareeth-docker-firewall` in a disposable privileged container, once per mode, and inspect `iptables -S DOCKER-USER` and `ip6tables -S DOCKER-USER`.

## Suggested Review Order

**Single source of the ranges**

- One CIDR per line; feeds the Hetzner firewall, DOCKER-USER, UFW and (by test) Caddy.
  [`cloudflare-ips.txt:6`](../../deploy/cloudflare-ips.txt#L6)

- The test fails if Caddy's `trusted_proxies` differs from the file, in content or order.
  [`test_compose_runtime.sh:91`](../../deploy/tests/test_compose_runtime.sh#L91)

**Provisioning (workstation)**

- Validates the mode and the ranges file before any Hetzner call; refuses catch-alls and multi-token lines.
  [`provision-host.sh:49`](../../deploy/provision-host.sh#L49)

- The Hetzner 80/443 sources come from the mode; the default payload is byte-identical.
  [`provision-host.sh:170`](../../deploy/provision-host.sh#L170)

- Mode and ranges are passed to bootstrap on the sudo command line; sudoers is unchanged.
  [`provision-host.sh:240`](../../deploy/provision-host.sh#L240)

**Host firewall (bootstrap)**

- The marked block shared with the tests; the mode persists so a hand-run bootstrap cannot reopen.
  [`bootstrap-host.sh:28`](../../deploy/bootstrap-host.sh#L28)

- Refuses Cloudflare mode when UFW IPv6 is off, before any firewall change.
  [`bootstrap-host.sh:110`](../../deploy/bootstrap-host.sh#L110)

- The generated script: today's text in `any`; in cloudflare, per-family ranges that prune strays on every Docker start.
  [`bootstrap-host.sh:159`](../../deploy/bootstrap-host.sh#L159)

- After the unit restart: converge, then verify the exact chain per family, or die before UFW.
  [`bootstrap-host.sh:235`](../../deploy/bootstrap-host.sh#L235)

- UFW 80/443: today's allows in `any`, one allow per range in cloudflare.
  [`bootstrap-host.sh:249`](../../deploy/bootstrap-host.sh#L249)

**Operator runbook**

- Enabling, IPv4/IPv6/port-80 verification, Tailscale note and rollback.
  [`README.md:92`](../../deploy/README.md#L92)

- Break-glass to reopen fast without re-provisioning.
  [`README.md:171`](../../deploy/README.md#L171)

**Tests and config**

- The file-backed iptables flow: mode switches and a cloudflare range refresh A→B→A, compared exactly per family.
  [`test_host_baseline.sh:338`](../../deploy/tests/test_host_baseline.sh#L338)

- The documented baseline key.
  [`host-baseline.env.example:19`](../../deploy/host-baseline.env.example#L19)
