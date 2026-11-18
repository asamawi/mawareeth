---
title: 'Per-hostname Authenticated Origin Pulls: Caddy requires the zone''s own client certificate'
type: 'feature'
created: '2026-11-01'
status: 'done'
review_loop_iteration: 0
baseline_commit: '91d82a3df122e1a14a261cbfe47d6571b9e5b337'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-cloudflare-origin-lock.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Restricting the origin to Cloudflare's IP ranges still admits any Cloudflare customer's traffic (for example from Workers) aimed at the origin IP, and Caddy trusts the forwarded headers on it. Nothing proves that a connection comes from Mawareeth's own zone.

**Approach:** Add an opt-in runtime key, `ORIGIN_CLIENT_AUTH=require`, valid only with `EDGE_MODE=cloudflare`. With it, Caddy requires and verifies, on both production names, a client certificate issued by the operator's own CA. The certificate is uploaded to Cloudflare as a per-hostname Authenticated Origin Pulls certificate. `release.sh` presents it on its edge and redirect probes. Preflight validates the three root-only files (`aop-ca.pem`, `aop-client.pem`, `aop-client-key.pem`). The README documents generating the files, the Cloudflare API upload, the safe enablement order and rollback.

## Boundaries & Constraints

**Always:**
- With `ORIGIN_CLIENT_AUTH` absent or `off`, the Compose environment, the Caddy Compose config hash and the adapted Caddy config are identical to today's, so the next CI deploy is unaffected.
- With `require`, every TLS connection to `DOMAIN` or `REDIRECT_DOMAIN` without a client certificate chaining to `aop-ca.pem` fails the handshake. Connecting with another SNI cannot reach those sites: the adapted config shows `strict_sni_host` on.
- The three files live in the existing origin TLS directory (`/etc/mawareeth/origin-tls`, root `0700`). Errors name the file or key, never its contents. Key material is never printed or logged.
- `ORIGIN_CLIENT_AUTH` never enters the app snapshot.
- Port 80, the `http://127.0.0.1` health site and the acme mode are unchanged.

**Ask First:**
- Any change to `deploy/compose.yaml` or to the Caddy service's environment.
- Enabling Cloudflare's zone-level (shared-certificate) Authenticated Origin Pulls.

**Never:**
- Touch the live host, Cloudflare or Hetzner.
- Commit certificates or keys, or put a Cloudflare API token in the repository or in runtime.env.
- Fetch anything at runtime.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default | cloudflare mode, key absent or `off` | today's behaviour; AOP files ignored even if present | N/A |
| Enabled | cloudflare + `require`, valid files | Caddy loads the client-auth snippets; probes pass `--cert`/`--key` | N/A |
| Wrong mode | `ORIGIN_CLIENT_AUTH=require` with acme | refused at preflight | names `ORIGIN_CLIENT_AUTH` |
| Bad value | `ORIGIN_CLIENT_AUTH=yes` | refused | names `ORIGIN_CLIENT_AUTH` |
| Bad files | missing, symlink, empty, wrong owner/mode (CA/cert `0600`/`0644`, key `0600`), unparsable, expired, client cert not verifying against the CA for client use, key not matching the cert | refused before any state change | names the file |

</frozen-after-approval>

## Code Map

- `deploy/runtime.sh:56` `optional_edge_keys` -- add `ORIGIN_CLIENT_AUTH`. `:104-114` `validate_edge_values` -- the REDIRECT_DOMAIN pattern for cloudflare-only keys. `:119-151` `validate_origin_tls`/`validate_origin_content` -- the file-check and openssl patterns to reuse for the AOP files (run them only when `require`). `:505` `compose_bounded` passes `EDGE_MODE="$(edge_mode)"` to Compose. Compose's `EDGE_MODE` names the Caddy snippet directory.
- `deploy/Caddyfile` -- imports `/etc/caddy/edge/{$EDGE_MODE:acme}/{global,site,sites}.caddy`. Leave it unchanged.
- `deploy/caddy/edge/cloudflare/{global,site,sites}.caddy` -- today's cloudflare snippets. These are the base for the new `cloudflare-aop` set.
- `deploy/compose.yaml:65-83` -- Caddy service. Its env and mounts must not change. `/etc/caddy/origin-tls` already mounts the origin TLS directory.
- `deploy/release.sh:190-197` `edge_fetch`, `:224-230` `edge_redirect` -- curl probes, `--cacert` in cloudflare mode. `:392-403` `require_current_caddy` -- compares config hashes, which is why enabling AOP needs `runtime.sh up`.
- `deploy/tests/test_compose_runtime.sh:57-106` -- snippet assertions and the ranges sync. `:410-530` -- edge-key prepare cases (`make_origin`, `expect_edge_snapshot`, `expect_edge_refused`, `$tmp/compose.env` checks).
- `deploy/tests/test_release.sh:214-240` -- the curl stub, which checks `--cacert`. `:1104-1185` -- cloudflare bootstrap/deploy cases (`$S/calls.log` curl assertions).
- `.github/workflows/django.yml:250-330` -- `caddy adapt --validate` of the cloudflare mode, with a throwaway cert and Python shape checks on the adapted JSON.
- `deploy/README.md:73-131` "Cloudflare edge" -- the trust-scope paragraph currently says AOP is "not built yet".

## Tasks & Acceptance

**Execution:**
- [x] `deploy/caddy/edge/cloudflare-aop/{global,site,sites}.caddy` -- `global.caddy` imports the cloudflare global; `site`/`sites` repeat the cloudflare blocks, with `tls … { client_auth { mode require_and_verify; trust_pool file /etc/caddy/origin-tls/aop-ca.pem } }`. This reuses the ranges and changes nothing in Compose.
- [x] `deploy/runtime.sh` -- validate `ORIGIN_CLIENT_AUTH` (`off`|`require`, cloudflare only). With `require`, validate the three files: owner and mode, non-empty, X.509 parses and is unexpired, `openssl verify -CAfile aop-ca.pem -purpose sslclient aop-client.pem`, and the key matches. Pass Compose `EDGE_MODE=cloudflare-aop` when `require`, with a comment explaining the mapping. Export a helper that `release.sh` can use.
- [x] `deploy/release.sh` -- with `require`, `edge_fetch` and `edge_redirect` add `--cert …/aop-client.pem --key …/aop-client-key.pem`.
- [x] `deploy/tests/test_compose_runtime.sh` -- cover every matrix row: the snapshot is unchanged, `compose.env` carries `EDGE_MODE=cloudflare` for off and `cloudflare-aop` for require, refusals name the key or file and never print the key, and the snippet assertions cover the new directory.
- [x] `deploy/tests/test_release.sh` -- the stub requires `--cert`/`--key` exactly when `require`. Add a cloudflare + `require` bootstrap case.
- [x] `.github/workflows/django.yml` -- add a `caddy adapt --validate` step for `cloudflare-aop` with a throwaway CA and client cert. Assert `client_authentication.mode == require_and_verify` with the CA on the policies for both names, and `strict_sni_host` true.
- [x] `deploy/README.md` -- document (`runtime.env.example` stays unchanged: the loader and its test reject comments there, so the key is documented in the README only):
  - generating the CA and client cert with openssl (ECDSA P-256, `extendedKeyUsage=clientAuth`) and installing them root-only;
  - the Cloudflare per-hostname upload (`POST /zones/{zone}/origin_tls_client_auth/hostnames/certificates`, then `PUT …/hostnames` enabling both names; token with SSL and Certificates: Edit, supplied out of band and never stored);
  - the order: Cloudflare first, verify, then `ORIGIN_CLIENT_AUTH=require` + `runtime.sh up`, then verify that a direct curl without the cert fails and that the site loads through Cloudflare;
  - rollback: origin `off` + `runtime.sh up` first, then disable at Cloudflare;
  - client-cert expiry and rotation;
  - replacing the "not built yet" paragraph.

**Acceptance Criteria:**
- Given today's production runtime.env, when `runtime.sh` builds the Compose environment, then it is byte-identical to the baseline commit's and `release.sh deploy` does not report a stale Caddy.
- Given `require` and a valid fixture, when release bootstrap runs, then every edge curl carries both `--cacert` and the client `--cert`/`--key`.

## Design Notes

The opt-in is folded into the Caddy snippet directory name, not added as a new Compose variable. A new `environment:` entry would change Caddy's Compose config hash, so `require_current_caddy` would fail the next CI deploy on the current host even with AOP off. With the folding, the hash changes only when the operator turns AOP on, and the runbook pairs that with `runtime.sh up`, which recreates Caddy. A short blip is expected.

## Verification

**Commands:**
- `bash deploy/tests/test_compose_runtime.sh` and `bash deploy/tests/test_release.sh` (Linux/WSL or container, as root and unprivileged) -- expected: pass.
- ShellCheck 0.11.0 on `deploy/*.sh deploy/tests/*.sh` -- expected: clean.
- Locally, `caddy adapt --validate` with the pinned image, for `cloudflare` and `cloudflare-aop` -- expected: `cloudflare` output identical to the baseline's; `cloudflare-aop` shows client auth and `strict_sni_host`.

## Suggested Review Order

**Opt-in without touching today's Compose model**

- Entry point: `require` swaps only Caddy's snippet directory, so the config hash is unchanged while `off`.
  [`runtime.sh:120`](../../deploy/runtime.sh#L120)

- The only Compose-facing change: `EDGE_MODE` comes from `compose_edge_mode`.
  [`runtime.sh:611`](../../deploy/runtime.sh#L611)

- Key validation: `off`|`require`, cloudflare only, never in the app snapshot.
  [`runtime.sh:144`](../../deploy/runtime.sh#L144)

**Caddy client authentication**

- Both names require and verify a certificate from `aop-ca.pem` on top of the Origin certificate.
  [`site.caddy:6`](../../deploy/caddy/edge/cloudflare-aop/site.caddy#L6)

- Apex redirect site carries the same requirement.
  [`sites.caddy:6`](../../deploy/caddy/edge/cloudflare-aop/sites.caddy#L6)

- Unusual trick: import arguments inject `strict_sni_host on`; no arguments leave cloudflare byte-identical.
  [`global.caddy:19`](../../deploy/caddy/edge/cloudflare/global.caddy#L19)

**Preflight of the AOP files**

- Refuses the offline CA key or serial files in the mounted directory.
  [`runtime.sh:216`](../../deploy/runtime.sh#L216)

- Every certificate in a bundle must parse and be unexpired; 30-day warning.
  [`runtime.sh:189`](../../deploy/runtime.sh#L189)

- Distinct refusal on OpenSSL before 3 instead of a false "does not verify".
  [`runtime.sh:232`](../../deploy/runtime.sh#L232)

**Deploy probes**

- Edge and redirect probes present the client pair only when `require`.
  [`release.sh:197`](../../deploy/release.sh#L197)

**Operator runbook**

- Files, prerequisites, workstation-only generation, Cloudflare API with checked responses.
  [`README.md:182`](../../deploy/README.md#L182)

- Enabling order (Cloudflare first), rollback (origin first), emergency `off` path.
  [`README.md:284`](../../deploy/README.md#L284)

- Renewal with the existing CA vs CA rotation, under the deploy lock.
  [`README.md:307`](../../deploy/README.md#L307)

**Tests and CI**

- Adapted-JSON checks: client auth and Origin tag on the same policy, strict SNI, no ACME.
  [`django.yml:378`](../../.github/workflows/django.yml#L378)

- Matrix coverage for file refusals, bundles, OpenSSL stub, warning.
  [`test_compose_runtime.sh:692`](../../deploy/tests/test_compose_runtime.sh#L692)

- Bootstrap and deploy with `require`: every edge curl carries `--cacert`, `--cert`, `--key`.
  [`test_release.sh:1206`](../../deploy/tests/test_release.sh#L1206)

- Workflow contract: four validations, the origin mount in both cloudflare steps.
  [`tests.py:476`](../../mawareeth/tests.py#L476)
