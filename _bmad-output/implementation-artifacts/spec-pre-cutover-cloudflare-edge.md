---
title: 'Pre-cutover Cloudflare edge: Origin CA TLS, www canonical, DOMAIN re-bootstrap'
type: 'feature'
created: '2026-10-27'
status: 'done'
review_loop_iteration: 0
baseline_commit: '28540db0715eb8da90d9b5433dd17949d0ebc1a2'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-0-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 0.10 cannot pass as written:
- Caddy serves only `{$DOMAIN}`, while production uses both `mawareeth.com` and `www`.
- `release.sh` validates over verified TLS through `--resolve`, but Caddy can obtain an ACME certificate only after public DNS reaches the host.
- Moving `DOMAIN` off `rehearsal.mawareeth.com` changes the runtime configuration, which deploys refuse.

**Approach:** Add an opt-in `cloudflare` edge mode, selected in `runtime.env`:
- Caddy serves `DOMAIN` (`www.mawareeth.com`) with a Cloudflare Origin CA certificate installed out of band.
- It permanently redirects `REDIRECT_DOMAIN` (`mawareeth.com`) to `https://{DOMAIN}{uri}`.
- It trusts forwarded headers only from Cloudflare's published IP ranges.
- `release.sh` verifies the edge against the pinned Origin CA roots.
- The default `acme` mode (one name, ACME) is unchanged, so the rehearsal path keeps working.
- `deploy/README.md` documents Cloudflare setup and a one-time re-bootstrap to the production `runtime.env`.

## Boundaries & Constraints

**Always:**
- Absent `EDGE_MODE` means `acme`, with byte-identical app snapshots and hashes to today.
- Edge keys never enter the app snapshot.
- Origin key and certificate live only on the host under a root-only directory; the repository holds only Cloudflare's public Origin CA roots.
- Errors name keys and paths, never key material.
- In `cloudflare` mode, Caddy never requests an ACME certificate for either name.
- Visitors' client-supplied forwarded headers are still replaced unless the connection comes from a Cloudflare range.
- `/health/release*` stays 404 for everyone, and `X-Mawareeth-Slot` edge verification is unchanged.

**Ask First:**
- Restricting ports 80/443 to Cloudflare ranges in UFW or the Hetzner firewall.
- Changing Django settings beyond what the snapshot already derives from `DOMAIN`.
- Any Caddy image other than the pinned stock one.

**Never:**
- Touch the host or Cloudflare.
- Add a `runtime.sh rotate` command.
- Add a Caddy plugin or DNS-01.
- Commit an Origin certificate or key.
- Fetch Cloudflare ranges or roots at runtime.
- Use `remote_ip` or `client_ip` matchers, or a `client_ip_headers` option, in the Caddyfile. The existing test forbids address-based exceptions, and Cloudflare's `X-Forwarded-For` is the default header.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Rehearsal default | no `EDGE_MODE` | ACME for `DOMAIN` as today; snapshot hash unchanged | N/A |
| Production edge | `EDGE_MODE=cloudflare`, `DOMAIN=www.mawareeth.com`, `REDIRECT_DOMAIN=mawareeth.com`, valid origin files | Caddy serves www with the origin cert, apex 301 → `https://www.mawareeth.com{uri}`, deploy edge check passes | N/A |
| Bad mode | `EDGE_MODE=other` | refused before any mutation | names `EDGE_MODE` |
| Missing redirect name | cloudflare without `REDIRECT_DOMAIN`, or equal to `DOMAIN`, or invalid hostname | refused | names `REDIRECT_DOMAIN` |
| Redirect in acme | `REDIRECT_DOMAIN` set with acme/absent mode | refused (it would need a certificate acme mode cannot pre-issue) | names `REDIRECT_DOMAIN` |
| Origin files wrong | cloudflare and directory/cert/key missing, not regular, not root-owned, key not 0600 | refused before any mutation | names the path, never contents |
| Spoofed proxy header | request not from a Cloudflare range carrying `X-Forwarded-Proto: http` / `X-Forwarded-For` | headers replaced by Caddy as today | N/A |

</frozen-after-approval>

## Code Map

- `deploy/Caddyfile` -- single `{$DOMAIN}` site, `respond /health/release* 404`, `import /etc/caddy/routes/*.caddy`; global block holds `admin localhost:2019`. Caddyfile `import` is token-level, and `{$VAR:default}` resolves at parse time, so mode-specific snippets can be imported by path.
- `deploy/compose.yaml` (`caddy:` service) -- env only `DOMAIN`; mounts the Caddyfile, routes, data and config. Needs `EDGE_MODE`, `REDIRECT_DOMAIN`, and a read-only origin-TLS mount. In acme mode, mount an empty runtime-owned directory, so the Compose model stays valid.
- `deploy/runtime.sh` -- `required_runtime_keys`/`optional_app_keys` near :46-49 (allow-list built from both); `validate_values` (:72), `validate_hostname`; `snapshot_content` (:229, must not change); `compose_bounded` (:403) builds the env with `env -i`, so new variables must be passed explicitly; `preflight`/`file_metadata` for root-owned mode checks.
- `deploy/release.sh:189-192` -- the only edge probe: `curl --proto '=https' --resolve "$DOMAIN:443:127.0.0.1"`. It needs `--cacert <repo Origin CA bundle>` in cloudflare mode.
- `mawareeth/settings.py:276` (`SECURE_PROXY_SSL_HEADER`) and `:41-65` (hosts/CSRF from `DOMAIN`) -- unchanged. Django reads no `X-Forwarded-For` or `REMOTE_ADDR`.
- `.github/workflows/django.yml` (`caddy-config` job) -- runs `caddy adapt --validate` with `DOMAIN=ci.example.com` per slot; `mawareeth/tests.py:~460-474` pins that job (validate count is 2).
- `deploy/tests/test_compose_runtime.sh:39-54` -- Caddyfile static checks (no `remote_ip|client_ip|{remote_host}`); the validation/refusal test patterns to reuse are the optional-key cases.
- `deploy/tests/test_release.sh` -- the curl stub for edge probes.
- `deploy/README.md` -- "Private Compose runtime" (runtime.env schema), "Production cutover (story 0.10)" section, and rehearsal steps that must stay valid.

## Tasks & Acceptance

**Execution:**
- [x] `deploy/cloudflare-origin-ca.pem` -- add Cloudflare's published Origin CA RSA and ECC roots (from `developers.cloudflare.com/ssl/origin-configuration/origin-ca/`), with their SHA-256 fingerprints recorded in the README -- the trust anchor for the deploy check.
- [x] `deploy/caddy/edge-acme.caddy`, `deploy/caddy/edge-cloudflare.caddy` (or equivalent) plus `deploy/Caddyfile` -- select mode snippets via `{$EDGE_MODE:acme}`:
  - cloudflare: `tls` with the mounted origin cert and key; a redirect site for `{$REDIRECT_DOMAIN}` (same certificate) using `redir https://{$DOMAIN}{uri} permanent`; `trusted_proxies static` with Cloudflare's current IPv4 and IPv6 ranges in the global `servers` options.
  - acme: nothing extra.
- [x] `deploy/compose.yaml`, `deploy/runtime.sh` --
  - Accept the optional keys `EDGE_MODE` and `REDIRECT_DOMAIN` (allow-list) and validate them per the matrix.
  - In cloudflare mode, check `/etc/mawareeth/origin-tls/{cert.pem,key.pem}` (path overridable for tests): root-owned, regular files, key 0600, directory 0700.
  - Pass the variables and the TLS directory to Compose.
  - Keep the app snapshot unchanged.
- [x] `deploy/release.sh` -- add `--cacert` to the edge probe when `EDGE_MODE=cloudflare`.
- [x] `.github/workflows/django.yml`, `mawareeth/tests.py` -- also `caddy adapt --validate` in cloudflare mode, using a throwaway self-signed cert. Assert the adapted JSON has the redirect, `trusted_proxies`, and no ACME issuer for the names. Update the pinned contract.
- [x] `deploy/tests/test_compose_runtime.sh`, `deploy/tests/test_release.sh` -- matrix cases; acme hash unchanged; Compose env and mounts; `--cacert` only in cloudflare mode.
- [x] `deploy/README.md` --
  - Document the edge keys.
  - Cloudflare setup: SSL/TLS mode Full (strict); an Origin certificate for `mawareeth.com` and `*.mawareeth.com` installed as root-only files; records proxied.
  - Refreshing the Cloudflare ranges and roots.
  - Production-cutover preparation: a re-bootstrap step that stops the slots and Caddy, archives `slots/`, `routes/`, the journal and snapshots, installs the production `runtime.env`, prepares, and bootstraps with `--allow-contract` against the empty database.
  - Step 6: the DNS switch means pointing the proxied records at the host.

**Acceptance Criteria:**
- Given today's `runtime.env`, when preparing, then the snapshot name and content are byte-identical, and the Caddy adapted config is unchanged apart from benign ordering.
- Given cloudflare mode and valid origin files, when deploying, then the edge probe verifies against the repo's Origin CA bundle and succeeds.
- Given the Caddyfile in cloudflare mode, when adapted, then neither name has an ACME issuer, and `mawareeth.com` answers a permanent redirect to `https://www.mawareeth.com` with the path and query kept.

## Verification

**Commands:**
- `bash deploy/tests/test_compose_runtime.sh && bash deploy/tests/test_release.sh` -- expected: pass.
- `docker run --rm koalaman/shellcheck:v0.11.0 deploy/*.sh deploy/tests/*.sh` -- expected: clean.
- `caddy adapt --validate` with the pinned image, in both modes (as the CI job does) -- expected: valid; the cloudflare JSON contains the redirect and `trusted_proxies`.
- `python manage.py test mawareeth.tests.WorkflowContractTests` -- expected: OK.

## Suggested Review Order

**Mode selection and the Caddy edge**

- One Caddyfile; `{$EDGE_MODE:acme}` picks snippet sets, so absent mode adapts identically to before.
  [`Caddyfile:6`](../../deploy/Caddyfile#L6)

- Trust forwarded headers only from Cloudflare's published ranges; static list, no plugin.
  [`global.caddy:14`](../../deploy/caddy/edge/cloudflare/global.caddy#L14)

- No ACME for any name; HTTP→HTTPS redirects stay on.
  [`global.caddy:7`](../../deploy/caddy/edge/cloudflare/global.caddy#L7)

- The `www` site serves the out-of-band Origin CA certificate.
  [`site.caddy:2`](../../deploy/caddy/edge/cloudflare/site.caddy#L2)

- Apex site: same certificate, 301 to `https://{DOMAIN}{uri}`, keeping path and query.
  [`sites.caddy:4`](../../deploy/caddy/edge/cloudflare/sites.caddy#L4)

**Refuse before mutation**

- Edge keys validated per the matrix; they never enter the app snapshot.
  [`runtime.sh:104`](../../deploy/runtime.sh#L104)

- Origin files: root ownership and modes, then content (parses, unexpired, both names, key matches).
  [`runtime.sh:119`](../../deploy/runtime.sh#L119)

- `-checkhost` for DOMAIN and REDIRECT_DOMAIN; errors name paths, never key material.
  [`runtime.sh:147`](../../deploy/runtime.sh#L147)

- Acme-mode empty placeholder mount; accepts Docker's 0755; refuses content.
  [`runtime.sh:165`](../../deploy/runtime.sh#L165)

- Edge settings passed explicitly through the sanitised Compose environment.
  [`runtime.sh:505`](../../deploy/runtime.sh#L505)

- Only the Caddy service receives the edge variables and the read-only origin-tls bind.
  [`compose.yaml:70`](../../deploy/compose.yaml#L70)

**Deploy verification**

- The edge probe trusts the pinned Origin CA roots only in cloudflare mode.
  [`release.sh:194`](../../deploy/release.sh#L194)

- The apex redirect is probed too; a failure counts as an edge-verification failure.
  [`release.sh:221`](../../deploy/release.sh#L221)

- Cloudflare's public RSA and ECC Origin CA roots; fingerprints pinned in a test and the README.
  [`cloudflare-origin-ca.pem:5`](../../deploy/cloudflare-origin-ca.pem#L5)

**Operator runbook**

- Cloudflare setup: Full (strict), Origin certificate, proxied records, refreshing ranges and roots.
  [`README.md:33`](../../deploy/README.md#L33)

- A records only: docker-proxy would hide IPv6 clients behind the bridge gateway.
  [`README.md:59`](../../deploy/README.md#L59)

- One-time re-bootstrap from the rehearsal DOMAIN to the production edge.
  [`README.md:97`](../../deploy/README.md#L97)

**Tests and CI**

- Every matrix refusal is checked for no state change and no key material in output.
  [`test_compose_runtime.sh:462`](../../deploy/tests/test_compose_runtime.sh#L462)

- The real Compose model in both modes: only Caddy is wired with the edge settings.
  [`test_compose_runtime.sh:852`](../../deploy/tests/test_compose_runtime.sh#L852)

- Re-bootstrap-shaped cloudflare deploy in production shape (www canonical, apex redirect).
  [`test_release.sh:1104`](../../deploy/tests/test_release.sh#L1104)

- CI adapts the cloudflare mode and asserts redirect, trust, no ACME, and certificate use.
  [`django.yml:251`](../../.github/workflows/django.yml#L251)

- The workflow contract pins the new CI assertions.
  [`tests.py:477`](../../mawareeth/tests.py#L477)
