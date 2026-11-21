---
title: 'Refuse admin keys whose body does not match their key type'
type: 'chore'
created: '2026-11-22'
status: 'done'
baseline_revision: 'bb658f01ddbcfc70dbe0ad1c77fa273748baa79e'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** `bootstrap-host.sh` `validate_admin` checks that `ADMIN_PUBLIC_KEY`'s base64 blob is canonical and starts with the declared type, but accepts any key bytes after it. A key with a matching header and an incomplete body (for example a one-byte ed25519 key) is installed into `authorized_keys`, and OpenSSH then cannot load it, so a direct guest run with a hand-made key locks the admin out. (Deferred item from `spec-deferred-bootstrap-guest-input-tightening.md`.)

**Approach:** Extend the existing python3 parser in the guest-inputs block to read the blob as SSH wire strings and check each supported type's fields the way OpenSSH's `sshkey_from_blob` does, with no trailing bytes allowed. Unsupported types are refused.

## Boundaries & Constraints

**Always:** Keep the check inside the `# >>> guest inputs` block, in the existing python3 heredoc (stdlib only). Keep the same refusal message `ADMIN_PUBLIC_KEY is required and must be a valid OpenSSH public key` and the same order of checks (all before any host change). Accepted values still reach the rest of bootstrap unchanged. Every key `ssh-keygen` makes for ed25519, ecdsa 256/384/521 and rsa 3072 must still be accepted.

**Never:** No new dependency (no `cryptography`, no calling `ssh-keygen` from bootstrap). Do not change `provision-host.sh`, `ci-deploy.sh` or the README. Do not accept certificate types (`*-cert-v01@openssh.com`), `ssh-dss` or any type outside the list below.

## I/O & Edge-Case Matrix

Wire format: `string` = uint32 big-endian length + bytes; `mpint` = string holding a big-endian two's-complement integer.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| ed25519 | `string type, string pk` with pk exactly 32 bytes, nothing after | accepted | other pk length or trailing bytes â†’ refused |
| sk-ed25519 | `sk-ssh-ed25519@openssh.com`: `string type, string pk(32), string application` | accepted (application may be any bytes, non-empty) | missing application, empty application, wrong pk length, trailing bytes â†’ refused |
| ecdsa | `ecdsa-sha2-nistp{256,384,521}`: `string type, string curve, string Q`; curve equals the type's suffix (`nistp256` â€¦); Q = `0x04â€–Xâ€–Y` with X,Y each the curve's field size (32/48/66 bytes); 0 â‰¤ X,Y < p and YÂ² â‰¡ XÂ³ âˆ’ 3X + b (mod p) | accepted | curve name mismatch, compressed/short point, coordinate â‰¥ p, point not on curve, trailing bytes â†’ refused |
| sk-ecdsa | `sk-ecdsa-sha2-nistp256@openssh.com`: as ecdsa nistp256, then `string application` (non-empty) | accepted | any other curve, missing/empty application â†’ refused |
| rsa | `ssh-rsa`: `string type, mpint e, mpint n`; both non-negative (high bit of first byte clear); leading zero bytes tolerated; e > 0; n bit length 1024..16384 | accepted | negative mpint, e = 0, n < 1024 or > 16384 bits, trailing bytes â†’ refused |
| unsupported | `ssh-dss`, `ssh-foo`, `ecdsa-sha2-nistp192`, any cert type | refused | same message |
| truncated | any string whose declared length runs past the blob end | refused | same message |

</intent-contract>

## Code Map

- `deploy/bootstrap-host.sh:33-61` -- `validate_admin`: bash type-header regex (line 37) then python3 heredoc (lines 41-60) doing whitespace, field split, strict canonical base64 and the type-header check (`want`, line 57). Replace the "carries key bytes" check at lines 57-59 with a wire-string reader and per-type field checks; the line-37 regex may stay as a cheap pre-filter or be narrowed to the supported type list. Update the comment at lines 38-40.
- `deploy/tests/test_host_baseline.sh:180-216` -- guest-input tests for `validate_admin` via `guest_accepts` / `guest_refuses` (helpers at 149-164). `sample_key` (184-188) builds `type header + N arbitrary bytes`, which the new check will refuse, so it must be replaced by structure-aware builders. `canonical_key` (191) is a one-byte ed25519 key used as an accept case and as the source of `noncanonical_key` (192-196, flips base64 padding bits); both need a structurally valid source whose base64 ends with padding.
- `deploy/tests/test_host_baseline.sh:102-105` -- the suite already makes an ed25519 key with `ssh-keygen`; the same pattern serves for ecdsa and rsa keys.
- `deploy/tests/test_host_baseline.sh:299` -- sandbox refusal of `ssh-ed25519 AAAA`; unaffected.
- `.github/workflows/django.yml:227-243` -- CI runs shellcheck on `deploy/tests/*.sh` and every `deploy/tests/test_*.sh` suite on Linux.

## Tasks & Acceptance

**Execution:**
- `deploy/bootstrap-host.sh` -- in the guest-inputs python heredoc, add a bounds-checked SSH string reader and the per-type checks of the matrix (NIST P-256/384/521 p and b constants from FIPS 186-4 / SEC 2); refuse unknown types and any trailing bytes; update the block comment -- a key OpenSSH cannot load is never installed.
- `deploy/tests/test_host_baseline.sh` -- replace `sample_key` with python builders that produce structurally valid keys per type (sk-ed25519 and sk-ecdsa synthesized; for sk-ecdsa use a real P-256 point, e.g. taken from an `ssh-keygen -t ecdsa -b 256` key); add accept cases for `ssh-keygen` ed25519, ecdsa 256/384/521 and rsa 3072 keys and the synthesized sk keys; add refusal cases for every error row of the matrix (at least: one-byte ed25519, 33-byte ed25519, ed25519 with trailing byte, ecdsa curve mismatch, ecdsa off-curve point, compressed ecdsa point, sk-ed25519 without application, sk-ecdsa with empty application, rsa 512-bit modulus, rsa negative modulus, rsa e = 0, `ssh-dss` and `ecdsa-sha2-nistp192` with otherwise well-formed bodies, truncated string length); rebuild `canonical_key`/`noncanonical_key` from a structurally valid key whose base64 ends with padding, so the non-canonical case is still refused only for its padding bits.

**Acceptance Criteria:**
- Given a guest run with `ADMIN_PUBLIC_KEY` = a one-byte ed25519 key line, when `validate_admin` runs, then bootstrap stops with `ADMIN_PUBLIC_KEY is required and must be a valid OpenSSH public key` before any host change.
- Given each key `ssh-keygen` produces for ed25519, ecdsa 256/384/521 and rsa 3072, when `validate_admin` runs, then it is accepted and `ADMIN_PUBLIC_KEY` is unchanged.
- Given the full suite, when `bash deploy/tests/test_host_baseline.sh` runs, then it exits 0.

## Spec Change Log

## Review Triage Log

### 2026-11-22 — Review pass
- verdicts: 18 findings — high 0, medium 8, low 10, false 0, maybe-false 0 (all five layers ran as one combined codex call; 6 distinct patches, 3 rejected)
- findings:
  - `[medium]` `[patch]` blind-hunter: sk application accepts any non-empty bytes, interior NUL unchecked — OpenSSH 9.6 reads it with `sshbuf_get_cstring`, which refuses a NUL before the last byte; added `application()` refusing `b'\0' in app[:-1]`, fixtures `sk-ed25519-nul`, `sk-ecdsa-nul`.
  - `[medium]` `[patch]` blind-hunter: RSA mpint encoded size unchecked — `sshbuf_get_bignum2_bytes_direct` refuses len > 2049 (or 2049 with a non-zero first byte) before trimming zeros; added to `mpint()`, fixture `rsa-overlong`.
  - `[medium]` `[patch]` blind-hunter: a failing `mkkey` inside the `guest_refuses` argument yields an empty key that is refused with the same message — every `mkkey` result is now assigned, its exit checked and checked non-empty.
  - `[low]` `[reject]` blind-hunter: synthesized variants have no independent OpenSSH check — accept-side compatibility is already proven by real `ssh-keygen` ed25519/ecdsa/rsa keys; adding an OpenSSH oracle for every variant is new test machinery for a rare case. Noted as the follow-up risk below.
  - `[medium]` `[patch]` edge-case-hunter: interior NUL in application — same root cause and fix as the first row.
  - `[medium]` `[patch]` edge-case-hunter: overlong RSA integer — same root cause and fix as the second row.
  - `[medium]` `[patch]` edge-case-hunter: on-curve EC point with a coordinate at or below OpenSSH's bit-length floor accepted — `sshkey_ec_validate_public` refuses `BN_num_bits(x|y) <= order_bits/2`; added order bits to `CURVES` and the check in `ec_point`, fixture `ecdsa-small-coord` (on-curve x = 0).
  - `[medium]` `[patch]` edge-case-hunter: failed negative fixture build passes — same root cause and fix as the third row.
  - `[low]` `[reject]` edge-case-hunter: empty application refused though OpenSSH's C-string reader accepts it — stricter than OpenSSH by the spec's matrix; no authenticator produces an empty application, and the fix would edit this spec.
  - `[low]` `[patch]` edge-case-hunter: overlong-integer claim — same as the second row.
  - `[low]` `[reject]` edge-case-hunter: nistp192 fixture uses the off-curve point (0, 0) — the type is refused by the allowlist before the point is read (`CURVES` has no nistp192 either), so the fixture cannot mask a regression of the type check in practice.
  - `[low]` `[patch]` verification-gap: sandboxed full bootstrap never sees a full-header incomplete-body key — added `sbx_refuses 'incomplete admin key body'` with the `ed25519-1` fixture (stops before the first host change).
  - `[medium]` `[patch]` verification-gap: negative fixture generation can fail while the suite passes — same as the third row.
  - `[low]` `[patch]` verification-gap: RSA acceptance at 1024 and 16384 bits untested — added `rsa-1024` and `rsa-16384` accept fixtures.
  - `[low]` `[patch]` verification-gap (other): interior NUL / empty application — interior NUL patched as the first row; the empty-application half rejected as above.
  - `[low]` `[patch]` verification-gap (other): overlong zero-padded RSA integer — same as the second row.
  - `[low]` `[patch]` verification-gap (other): P-256 point with x = 0 accepted — same as the EC row.
  - `[low]` `[patch]` intent-alignment: no newly refused body goes through the full bootstrap entry point — covered by the sandbox fixture added for the verification-gap row. cross-story-contract: no contract shape changed (no finding).

## Design Notes

OpenSSH (`sshkey.c` `sshkey_from_blob_internal`) refuses trailing data after the key fields, requires ed25519 pk length 32, checks the ecdsa curve name against the type and validates the point (`sshkey_ec_validate_public`), and limits RSA moduli to 1024..16384 bits (`SSH_RSA_MINIMUM_MODULUS_SIZE`, `SSHBUF_MAX_BIGNUM`). The NIST curves used have cofactor 1, so an on-curve affine point with coordinates in range has full order and no order check is needed. Mpint leading zeros are skipped by `sshbuf_get_bignum2_bytes_direct`, so they are tolerated here too.

## Verification

**Commands:**
- `bash deploy/tests/test_host_baseline.sh` -- expected: exits 0, prints `bootstrap guest input checks passed` and `host baseline offline checks passed` (run in Git Bash; CI runs it on Linux).
- `bash -n deploy/bootstrap-host.sh deploy/tests/test_host_baseline.sh` -- expected: no output, exit 0.
- `shellcheck deploy/bootstrap-host.sh deploy/tests/test_host_baseline.sh` if shellcheck is installed locally -- expected: no findings (CI runs it otherwise).

## Auto Run Result

Status: done

- **Change:** `validate_admin` in `deploy/bootstrap-host.sh` now reads `ADMIN_PUBLIC_KEY`'s blob as SSH wire strings and checks each supported type's fields the way OpenSSH 9.6 does, with no trailing bytes allowed. It checks ed25519 (32-byte pk), sk-ed25519 (pk plus a C-string application), ecdsa nistp256/384/521 (curve name, uncompressed point on the curve, OpenSSH's coordinate bit-length floor), sk-ecdsa nistp256 (the same plus the application), and ssh-rsa (non-negative mpints of at most 2049 encoded bytes, e > 0, n of 1024 to 16384 bits). Every other type is refused, including certificates and `ssh-dss`. The refusal message and check order are unchanged.
- **Files:**
  - `deploy/bootstrap-host.sh`: the per-type wire parser in the guest-inputs python heredoc.
  - `deploy/tests/test_host_baseline.sh`: a structure-aware key builder (`mkkey`) whose failures are checked. Real `ssh-keygen` ecdsa 256/384/521 and rsa 3072 keys are accepted, and so are synthesized sk keys and RSA keys at the 1024 and 16384-bit limits. 30 malformed variants are refused. A sandboxed full-bootstrap run refuses the one-byte ed25519 key before the first host change.
- **Review:** one pass, all five layers in one combined codex call, 18 findings. 6 distinct patches were applied: the application's interior NUL, the RSA encoded length, the EC coordinate floor, checked fixture builds, the sandbox case and the RSA limit accepts. 3 were rejected: the empty-application strictness (it is the spec's choice), an independent OpenSSH oracle for synthesized variants, and the nistp192 fixture point. Nothing was deferred, and no agent fallback was needed.
- **Follow-up review recommended:** true. 4 distinct medium entries were patched. The unverified risk is that the three parity rules added in review (the C-string application, the 2049-byte mpint limit and the EC coordinate floor) come from reading OpenSSH 9.6 source. No OpenSSH binary was run against the refused fixtures (for example `ssh-keygen -l -f`), so a parity mismatch in the other direction, refusing a key OpenSSH loads, is not ruled out beyond the real `ssh-keygen` keys.
- **Verification:**
  - `bash -n` on both files: clean.
  - `bash deploy/tests/test_host_baseline.sh` (Git Bash): `host baseline offline checks passed`, `bootstrap guest input checks passed` and `bootstrap sandboxed run checks passed`. It then stops at `FAIL: a writable persisted mode file was accepted`, which also fails on the baseline commit (run in a temporary worktree) and is a Windows file-permission artifact. CI on Linux must confirm the full suite.
  - shellcheck is not installed locally, so it runs in CI only.
- **Residual risks:**
  - The Linux-only and shellcheck results above are unconfirmed until CI runs.
  - An untracked `Python/` directory (a Windows Python install-manager layout created at 00:17 during the implementer's test runs) sits in the repo root. It is not part of this change and was left uncommitted and undeleted for the owner to decide.
