---
title: 'Tighten bootstrap guest input checks: parse the admin key, refuse a trailing comma or newline in the SSH CIDRs'
type: 'bugfix'
created: '2026-11-20'
status: 'done'
baseline_revision: '8a33901c221df8bd384339677f738263cc12e758'
review_loop_iteration: 1
followup_review_recommended: false
context: []
warnings: []
deferred:
  - summary: >-
      validate_admin checks only the type header plus at least one key byte, so a key with an incomplete algorithm-specific body (e.g. a one-byte ed25519 key) passes and OpenSSH cannot load it.
    evidence: |-
      Review pass 2 (blind-hunter, edge-case-hunter, verification-gap, intent-alignment). The spec's Never rule excludes key-type-specific payload lengths; provision-host.sh sends an ssh-keygen -y key, so only a direct guest run with a hand-made key is exposed. A fix would parse each type's fields as OpenSSH does (sshkey.c) or run ssh-keygen -l on the guest once openssh-client is guaranteed.
    location: >-
      deploy/bootstrap-host.sh validate_admin
    severity: low
  - summary: >-
      The offline provision run with SSH_ALLOWED_CIDRS=not-a-cidr discards output and accepts any nonzero exit, so an unrelated failure satisfies it.
    evidence: |-
      Pre-existing (deploy/tests/test_host_baseline.sh, the `malformed CIDR was accepted` check). The new CIDR rows use provision_refuses, which asserts the message and that no provider call ran; not-a-cidr could move there too.
    location: >-
      deploy/tests/test_host_baseline.sh:116
    severity: low
  - summary: >-
      The suite's syntax check `bash -n "$provision" "$bootstrap" "$0"` parses only provision-host.sh; bash treats the other paths as positional arguments.
    evidence: |-
      Pre-existing (deploy/tests/test_host_baseline.sh:11). Found by review pass 2 on this spec's own Verification command, which had the same form; the run verified each script with its own bash -n.
    location: >-
      deploy/tests/test_host_baseline.sh:11
    severity: low
---

<intent-contract>

## Intent

**Problem:** `deploy/bootstrap-host.sh` accepts an `ADMIN_PUBLIC_KEY` that is only a known key type plus whitespace (empty or garbage payload, or a value with an embedded newline that writes extra lines into `authorized_keys`), and `validate_cidrs` silently accepts `SSH_ALLOWED_CIDRS` with a trailing comma (bash `read -a` drops it) or an embedded newline (the here-string read stops at the first line, so later CIDRs vanish). `provision-host.sh` has the same CIDR check, so a trailing comma passes provisioning and reaches bootstrap.

**Approach:** In bootstrap's guest-inputs block, parse the admin key as one OpenSSH public-key line (allowed type, strict base64 payload whose first length-prefixed string equals the declared type, optional comment, no CR/LF), and make `validate_cidrs` refuse a leading/trailing comma and any whitespace or newline before splitting. Apply the same CIDR tightening to `provision-host.sh`'s `validate_cidrs` so provisioning refuses before contacting Hetzner. Extend `deploy/tests/test_host_baseline.sh` to pin each case.

## Boundaries & Constraints

**Always:** Keep the existing refusal messages (`ADMIN_PUBLIC_KEY is required and must be a valid OpenSSH public key`, `SSH_ALLOWED_CIDRS contains an empty CIDR`, `... invalid or excessively broad CIDR`) so current tests and runbooks still match; a new message is allowed only for the whitespace/newline case. Keep both validators inside the `# >>> guest inputs` / `# <<< guest inputs` block, using only bash and `python3` (already required before validation; `ssh-keygen` is not guaranteed on the guest). The accepted key value must reach the rest of bootstrap byte for byte unchanged. Every key the suite accepts today (`$good_key` and the three ecdsa/sk sample lines) must still be accepted.

**Never:** Do not change the allowed key types, the CIDR prefix limits, `ADMIN_USER` rules, the sudoers line, the public-web block, or any host-mutating step. Do not require key-type-specific payload lengths. Do not add a sandboxed entry-point run (separate deferred item).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Real key with comment | `ssh-ed25519 <valid b64> user@host` | accepted, value unchanged | none |
| Key without comment | `ssh-ed25519 <valid b64>` | accepted | none |
| Type only + space | `ssh-ed25519 ` | refused | existing ADMIN_PUBLIC_KEY message |
| Bad base64 payload | `ssh-ed25519 not*base64 c` | refused | existing ADMIN_PUBLIC_KEY message |
| Payload names other type | `ssh-rsa <ed25519 payload> c` | refused | existing ADMIN_PUBLIC_KEY message |
| Embedded newline in key | `<good key>\nssh-ed25519 <b64> evil` | refused | existing ADMIN_PUBLIC_KEY message |
| Trailing / leading comma | `203.0.113.0/24,` / `,203.0.113.0/24` | refused (bootstrap and provision) | `contains an empty CIDR` |
| Embedded newline or space in CIDRs | `203.0.113.0/24\n198.51.100.0/24`, `203.0.113.0/24, 198.51.100.0/24` | refused (bootstrap and provision) | new message naming whitespace in SSH_ALLOWED_CIDRS |

</intent-contract>

## Code Map

- `deploy/bootstrap-host.sh:10-35` -- guest-inputs block: `validate_cidrs` (lines 11-27, `IFS=',' read -r -a cidrs <<<"$SSH_ALLOWED_CIDRS"`) and `validate_admin` (29-34, type-prefix regex only). Called at 279-281 before any host change; key written to `authorized_keys` at 349; CIDRs split again at 377 for `ufw allow`.
- `deploy/provision-host.sh:27-43` -- duplicate `validate_cidrs`; called at ~114 before any Hetzner call. Key comes from `ssh-keygen -y` (line 128), so no key change needed there.
- `deploy/tests/test_host_baseline.sh:139-205` -- guest input tests: extracts the guest block into `$guest_lib`, helpers `guest_accepts`/`guest_refuses fn message env...`. Line 181-182 currently pins trailing-comma acceptance (must flip to refusal). `$good_key` comes from `$tmp/id.pub` (line 104: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest baseline@test`). **That payload is 29 base64 characters and is not valid base64, and the three ecdsa/sk literal sample keys at line 190 (31, 39 and 51 characters) are not valid either** — see Spec Change Log. Line 106-115 runs provision with a bad CIDR config and checks only a nonzero exit (too weak for new cases).
- `deploy/tests/test_host_baseline.sh:509-520` -- the suite already runs `ssh-keygen -q -t ed25519 -N '' -f "$tmp/pair"` and builds `$tmp/valid-config` (SSH_ALLOWED_CIDRS=198.51.100.0/24) for the stubbed provisioner; `provision_with config [script]` runs it with stubs.
- `deploy/tests/test_host_baseline.sh:575-582` -- `provision_refuses expected-text config [script]`: asserts nonzero exit, the expected text in output, no token printed and no `hcloud|curl|ssh|scp` call logged. Reuse it for provisioner CIDR refusals by writing a copy of `valid-config` with a bad `SSH_ALLOWED_CIDRS` (quote the value in the config file, e.g. `SSH_ALLOWED_CIDRS='203.0.113.0/24, 198.51.100.0/24'` or `$'...\n...'`, since the config is sourced).
- `deploy/README.md` -- mentions SSH_ALLOWED_CIDRS input; update only if it describes accepted formats.

## Tasks & Acceptance

**Execution:**
- `deploy/bootstrap-host.sh` -- in `validate_cidrs`, before splitting: refuse any whitespace/CR/LF in the value with a new message (e.g. `SSH_ALLOWED_CIDRS must be a comma-separated list without spaces or newlines`), and refuse a leading or trailing comma with `contains an empty CIDR`. In `validate_admin`, keep the regex as a first gate and add a `python3` parse: no CR/LF; split on whitespace into 2 or more fields (type, payload, optional comment); payload strictly base64 as given — matches `[A-Za-z0-9+/]+={0,2}`, length a multiple of 4, `base64.b64decode(payload, validate=True)` with no stripping, re-padding or truncation; decoded blob starts with the complete `uint32 len(type) || type` header and has at least one byte after it (no prefix-only comparison). Any failure dies with the existing message. -- closes the deferred gaps.
- `deploy/provision-host.sh` -- mirror the two `validate_cidrs` additions with identical messages. -- provisioning must refuse before contacting Hetzner rather than pass a trailing comma on.
- `deploy/tests/test_host_baseline.sh` -- replace the trailing-comma acceptance (181-182) with refusals for trailing and leading comma; add refusals for newline and space in CIDRs; replace the malformed sample keys with well-formed ones of the same types and comments: write `$tmp/id.pub` from a real `ssh-keygen -t ed25519` key (keep the ` baseline@test` comment; the offline provision run at 106-115 only needs it to be one line), and build the ecdsa-sha2-nistp256, sk-ssh-ed25519 and sk-ecdsa-sha2-nistp256 samples as valid base64 of `uint32 len || type` plus some key bytes (e.g. with a small `python3 -c` helper); add key refusals for type-plus-space, non-base64 payload, wrong padding (`AAAACw=`), header-only blobs (`AAAACw==`, the bare `ssh-ed25519` header `AAAAC3NzaC1lZDI1NTE5`), payload/type mismatch, embedded newline, trailing CR; add an accepted key without comment and assert a real ssh-keygen key passes `validate_admin` byte for byte; remove the nonzero-only provision runs and instead call `provision_refuses` (after line 582) for trailing comma, leading comma, embedded newline and embedded space, each expecting its I/O-matrix message. -- pins the matrix.

**Acceptance Criteria:**
- Given each refused row of the I/O matrix, when `bash deploy/tests/test_host_baseline.sh` runs, then the matching `guest_refuses` checks pass with the stated message and `provision_refuses` passes for each CIDR row (expected message, no provider or transport call).
- Given well-formed keys of every type the suite samples today, and the CIDRs it accepts today (except the trailing comma), when the suite runs, then they are accepted and `validate_admin` leaves `ADMIN_PUBLIC_KEY` unchanged.

## Spec Change Log

### 2026-11-20 — loop 1 (bad_spec)
- **Trigger:** review (blind-hunter, edge-case-hunter, verification-gap, intent-alignment) found the attempt-1 key parser repairs malformed base64 (strips padding, drops a dangling character) and compares only a prefix of the type header, so `ssh-ed25519 AAAACw==`, `ssh-ed25519 AAAACw=` and the header-only `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5` were accepted. The implementer did this because the intent contract's Always rule says the suite's existing sample keys must stay accepted, and those samples are not valid base64 (29/31/39/51 characters). The planner wrongly believed they were well-formed. The deferred item's purpose (refuse a malformed payload) and the Approach (strict base64, first string equals the type) leave one reading: the parser must be strict, and the samples are test data to be made well-formed with the same types. The Always rule is read as protecting well-formed keys of those types. Second trigger: the spec told the provision tests to assert only a nonzero exit, which passes for unrelated failures.
- **Amended:** Code Map (malformed samples, `provision_refuses` harness, real ssh-keygen pair), Tasks (strict decode with no repair and a full header plus key bytes; well-formed replacement samples; extra refusals; `provision_refuses` for all four CIDR rows), Acceptance Criteria (well-formed samples; `provision_refuses`).
- **Known-bad state avoided:** a parser that accepts a header-only or repaired payload; provisioner tests that pass when the new guard is removed.
- **KEEP:** the raw-value CIDR checks in both scripts exactly as attempt 1 wrote them (`[[ "$SSH_ALLOWED_CIDRS" != *[[:space:]]* ]]` with message `SSH_ALLOWED_CIDRS must be a comma-separated list without spaces or newlines`, then the leading/trailing comma check with `contains an empty CIDR`, both before `read -a`, with the two-line comment); the `python3 - "$ADMIN_PUBLIC_KEY" <<'PY' || die ...` structure after the regex, CR/LF refusal and `split()` into at least two fields; the guest CIDR refusal tests for trailing comma, leading comma, embedded newline, trailing newline and space after a comma. Attempt 1 is saved at `spec-deferred-bootstrap-guest-input-tightening-attempt-1.patch`.

## Review Triage Log

### 2026-11-20 — Review pass
- verdicts: 17 findings — high 11, medium 4, low 1, false 0, maybe-false 0 (verification-gap's deferred startup gap counted medium)
- findings:
  - `[high]` `[bad_spec]` blind-hunter: payload repair accepts `ssh-ed25519 AAAACw=` — verified in the attempt-1 code (`rstrip('=')`, drop on len%4==1); amended Tasks to strict decode with no repair.
  - `[high]` `[bad_spec]` blind-hunter: length-only header `AAAACw==` passes — `blob[:len(want)] != want[:len(blob)]` compares a 4-byte prefix; amended Tasks to require the full header.
  - `[medium]` `[bad_spec]` blind-hunter: header-only blob with no key material passes — amended Tasks to require at least one byte after the header.
  - `[medium]` `[bad_spec]` blind-hunter: provision cases discard output and accept any nonzero exit — spec Task told them to; amended to `provision_refuses`.
  - `[low]` `[bad_spec]` blind-hunter: provisioner cases omit leading comma and space — same root as above; amended to all four rows.
  - `[high]` `[bad_spec]` edge-case-hunter: incorrect padding / len%4==1 accepted — same as first row.
  - `[high]` `[bad_spec]` edge-case-hunter: blob ending inside the type passes — same as second row.
  - `[high]` `[bad_spec]` edge-case-hunter: blob ending right after the type passes — same as third row.
  - `[medium]` `[bad_spec]` edge-case-hunter: provision nonzero-only tests — same as fourth row.
  - `[high]` `[bad_spec]` edge-case-hunter claim: strict base64 not met — same root (repair).
  - `[high]` `[bad_spec]` edge-case-hunter claim: first string equals type not met — same root (prefix compare).
  - `[medium]` `[bad_spec]` edge-case-hunter claim: provisioner leading comma/space untested — same as fifth row.
  - `[medium]` `[bad_spec]` verification-gap: provisioner refusal tests pass after unrelated failures — same as fourth row.
  - `[high]` `[bad_spec]` verification-gap: guest key tests use incomplete blobs, no real key is fed to `validate_admin` — root cause of the lenient parser; amended Tasks to well-formed samples and a real ssh-keygen key asserted byte for byte.
  - `[medium]` `[defer]` verification-gap: no entry-point run proves a bad input is refused before host changes — pre-existing and already tracked in deferred-work.md ("Add a sandboxed run of `bootstrap-host.sh` itself"); spec Never excludes it; not re-added.
  - `[high]` `[bad_spec]` verification-gap other: parser repairs base64 and accepts incomplete headers — same as first two rows.
  - `[high]` `[bad_spec]` intent-alignment: key check still accepts malformed or incomplete payloads, short of the deferred entry and the spec — same root.
  - cross-story-contract: no contract shape changed (no finding).

### 2026-11-20 — Review pass (loop 1)
- verdicts: 15 findings — high 0, medium 1, low 14, false 0, maybe-false 0
- findings:
  - `[low]` `[defer]` blind-hunter: header plus one byte accepted, no complete ed25519 key — real; excluded by the intent contract's Never (no key-type-specific lengths); deferred.
  - `[low]` `[patch]` blind-hunter: Unicode whitespace (vertical tab) accepted as a field separator; OpenSSH uses space/tab only — verified (`str.split()`); patched: refuse whitespace other than space/tab, split on `[ 	]+`.
  - `[low]` `[patch]` blind-hunter: non-canonical padding bits pass Python but not OpenSSH — verified; patched: canonical round-trip check.
  - `[low]` `[reject]` blind-hunter: synthetic ecdsa/sk fixtures lack algorithm structure — true but by design (header recognition only, per the Never rule); no user harm.
  - `[low]` `[defer]` blind-hunter: retained not-a-cidr nonzero-only provision smoke test — pre-existing; deferred.
  - `[low]` `[defer]` blind-hunter: `bash -n a b` parses only the first file — the spec Verification line is not edited (rule), each script was checked separately; the same pre-existing form at test_host_baseline.sh:11 is deferred.
  - `[low]` `[defer]` edge-case-hunter: incomplete ed25519 body — same as first row.
  - `[low]` `[patch]` edge-case-hunter: vertical tab / NBSP separators — same as second row; NBSP refusal test added.
  - `[low]` `[patch]` edge-case-hunter: nonzero unused padding bits — same as third row; AA==/AB== tests added.
  - `[low]` `[reject]` edge-case-hunter claim: fixtures are not "well formed" for their algorithms — same as fourth row.
  - `[low]` `[defer]` edge-case-hunter claim: not-a-cidr smoke test still nonzero-only — same as fifth row.
  - `[medium]` `[defer]` verification-gap: entry-point run of bootstrap not tested — carried: same claim as the pass-1 row, still tracked in deferred-work.md; not re-added.
  - `[low]` `[patch]` verification-gap: tab-delimited key untested — patched: tab-delimited ssh-keygen key accepted and preserved byte for byte.
  - `[low]` `[defer]` verification-gap other: incomplete body, vertical tab, non-canonical padding accepted — padding and separators patched, body deferred (rows above).
  - `[low]` `[defer]` intent-alignment: usable-key reading (OpenSSH can load the key) not established — same root as first row; deferred.
  - cross-story-contract: no contract shape changed (no finding).

## Design Notes

Newline in a CIDR list: `<<<"$SSH_ALLOWED_CIDRS"` with `read` stops at the first newline, so checking the raw value for `[[:space:]]` before `read` is required; checking each split field is too late. A key-blob type check is the standard OpenSSH wire format (`uint32 len || type`), so a `ssh-rsa` label over an ed25519 blob is caught without type-specific lengths.

## Verification

**Commands:**
- `bash deploy/tests/test_host_baseline.sh` -- expected: exits 0, prints `bootstrap guest input checks passed` and `host baseline offline checks passed` (run in Git Bash; CI runs it on Linux).
- `bash -n deploy/bootstrap-host.sh deploy/provision-host.sh` -- expected: no output, exit 0.

## Auto Run Result

Status: done

- **Change:** bootstrap's guest-input checks now refuse a malformed `ADMIN_PUBLIC_KEY`, meaning a type with no or garbage payload, non-strict or non-canonical base64, a blob whose first string is not the declared type or that carries no key bytes, any whitespace other than space/tab, or CR/LF. `SSH_ALLOWED_CIDRS` is refused with a leading or trailing comma or any whitespace/newline. `provision-host.sh` applies the same CIDR rules before contacting Hetzner.
- **Files:**
  - `deploy/bootstrap-host.sh`: the raw-value CIDR checks and the python3 key parser in the guest-inputs block.
  - `deploy/provision-host.sh`: the same raw-value CIDR checks.
  - `deploy/tests/test_host_baseline.sh`: the sample keys are now well-formed (a real ssh-keygen ed25519 key and built ecdsa/sk samples), with tab-delimited and byte-preservation checks, the matrix refusals, and `provision_refuses` for the four CIDR rows.
- **Review:**
  - Pass 1 was 17 findings and looped once as bad_spec: the spec had assumed the suite's sample keys were valid base64, and its provision tests checked only a nonzero exit. See the Spec Change Log; attempt 1 is saved as `spec-deferred-bootstrap-guest-input-tightening-attempt-1.patch`.
  - Pass 2 was 15 findings. Patched: the space/tab-only separators, the canonical base64 round trip, and the tab/NBSP/padding tests (all low). Deferred: three low items, in the frontmatter and in deferred-work.md. Rejected: two fixture-structure rows, which are by design under the Never rule.
- **Follow-up review recommended:** false. Pass 2 patched 0 high and 0 medium entries.
- **Verification:**
  - `bash -n` passes on each of the three scripts, run separately.
  - `bash deploy/tests/test_host_baseline.sh` on Windows Git Bash prints `host baseline offline checks passed` and `bootstrap guest input checks passed`. It then stops at the public-web check `a writable persisted mode file was accepted`, which fails identically on the baseline (Git Bash cannot honour file modes).
  - The new `provision_refuses` CIDR cases sit after that point, so they ran only as a direct call of the extracted provision `validate_cidrs`, not through the harness. Docker and WSL were unavailable.
- **Residual risk:** the provisioner refusal cases and the rest of the suite still need the Linux CI run (`.github/workflows/django.yml`, host baseline job). On Linux, Python sees U+00A0 as whitespace; under a C locale it is a surrogate and the key fails the payload regex instead. It is refused either way.
