---
title: 'Pin the Docker and Tailscale apt signing-key fingerprints and refuse a downloaded key that does not match'
type: 'chore'
created: '2026-11-21'
baseline_revision: '5e3bb39f28509103777f6e03ffeab01c01a1d92c'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** `deploy/bootstrap-host.sh` pipes whatever `https://download.docker.com/linux/ubuntu/gpg` serves straight into `/etc/apt/keyrings/docker.gpg`, and `deploy/monitor.sh install` installs whatever `pkgs.tailscale.com` serves as the Tailscale keyring. A compromised or substituted key server would get its key trusted by apt as root.

**Approach:** Pin each vendor's primary-key fingerprint in the script that installs it. Download the key to a temporary file, check with `gpg --show-keys --with-colons` (in a throwaway `--homedir`) that it holds exactly one primary key with the pinned fingerprint, and only then install it; otherwise refuse with a clear message and leave no keyring or apt source behind.

## Boundaries & Constraints

**Always:**
- Pinned values (verified 2026-11-21 against the live keys): Docker `9DC858229FC7DD38854AE2D88D81803C0EBFCD88` ("Docker Release (CE deb)"), Tailscale `2596A99EAAB33821893C0A79458CA832957F5868` ("Tailscale Inc. (Package repository signing key)").
- The check passes only when the file has exactly one `pub` record and the `fpr` record that follows it equals the pin (40 uppercase hex). Empty, non-key, wrong-key and multi-key files are refused.
- gpg runs with `--batch` and a `--homedir` made by `mktemp -d` that is removed afterwards; it never reads or creates root's `~/.gnupg`.
- `bootstrap-host.sh` keeps its order: the key is downloaded and checked after `apt-get install ... gnupg` and before `docker.list` is written. The check and its pin live in a new `# >>> apt key pin` / `# <<< apt key pin` marker block so the test can extract and run them. A refused key `die`s before `/etc/apt/keyrings/docker.gpg` or `docker.list` is written.
- `monitor.sh install` adds `gpg` to its `require_command` list, checks the downloaded temp file before `chmod`/`mv`, and on a mismatch removes the temp file and calls `install_fail` naming the pin; no keyring, no `tailscale.list`, no `apt-get` call.
- Each script stays self-contained (each is copied/run alone), so the small helper is duplicated in both, not shared.
- All deploy suites pass unprivileged and as root, and ShellCheck 0.11.0 reports no new findings for `deploy/*.sh deploy/tests/*.sh`.

**Never:**
- No network access in tests: they use committed copies of the real public keys as fixtures.
- Do not change the key URLs, keyring paths, repository lines, or the bootstrap sandbox section's behaviour.
- Do not pin subkeys or expiry; the primary fingerprint is the trust anchor.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Genuine key | served file is the vendor's key | keyring installed exactly as before | No error expected |
| Wrong key | served file is another valid key | refused, nothing installed | bootstrap `die`; monitor `install_fail`, exit 1 |
| Extra key | vendor key plus a second key in one file | refused | as above |
| Not a key | empty or text file | refused | as above |

</intent-contract>

## Code Map

- `deploy/bootstrap-host.sh:322-325` -- `install -d /etc/apt/keyrings`; `curl ... | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg`; `chmod a+r`. Replace the pipeline with download-to-temp, check, `gpg --dearmor --yes -o ... <tmp>`, remove temp. Script runs with `set -Eeuo pipefail`, `IFS=$'\n\t'`, `umask 077`; `die` prints `bootstrap: ...`. Existing marker blocks `# >>> guest inputs` (line 10) and `# >>> public web sources` (line 64) show the extract pattern; put the new block alongside them (before the main flow).
- `deploy/monitor.sh:72` -- `tailscale_key_url`; add the pin constant next to it. `:622` -- `require_command` loop. `:660-667` -- download to `key_tmp` via `mktemp`, then `chmod 0644` + `mv`; insert the check between the download and the `chmod`.
- `deploy/tests/test_host_baseline.sh:56` -- existing `need "$bootstrap" 'https://download.docker.com/linux/ubuntu'`; `:141-145` -- marker-count and `sed -n` extraction pattern to copy for the new block; `fail`, `need`, `$tmp`, `trap` helpers already exist.
- `deploy/tests/test_monitor.sh:85-98` -- curl stub; its last line writes `stub-keyring` to the `-o` target. `:902-905` -- `curl-fails` refusal case to mirror. `:930-935` -- install success checks on the keyring.
- Fixtures already downloaded and checked: `C:\Users\samaw\AppData\Local\Temp\claude\ba9dccb10bfb27ab\fb671ac0-80bb-4c59-9e91-8b8fd751ed95\scratchpad\keys\docker.asc` (armored, as served) and `...\scratchpad\keys\ts.gpg` (binary, as served).
- `deploy/README.md:611` -- monitor install steps mention the Tailscale keyring; the bootstrap section describes Docker install.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- "Pin the expected OpenPGP fingerprints of third-party apt signing keys" entry under `## Deploy & host`.

## Tasks & Acceptance

**Execution:**
- `deploy/tests/fixtures/docker-archive-keyring.asc`, `deploy/tests/fixtures/tailscale-archive-keyring.gpg` -- copy the two scratch files byte-for-byte; add `deploy/tests/fixtures/** -text` to a root `.gitattributes` (create it) so line endings never change -- offline, real-key fixtures.
- `deploy/bootstrap-host.sh` -- add the marker block with `docker_key_fingerprint=...` and `key_fingerprint_matches <file> <fingerprint>`; replace the curl|gpg pipeline as above with a refusal message naming the pin.
- `deploy/monitor.sh` -- pin constant, same helper, `gpg` in `require_command`, check before install.
- `deploy/tests/test_host_baseline.sh` -- marker-pair count/order check; extract and source the block; assert the pin literal; helper accepts docker fixture+pin, refuses tailscale fixture, concatenation of both, empty file, text file; check the call sits after `curl` and before `gpg --dearmor` and that no `curl ... | gpg` pipeline remains. One `... checks passed` line.
- `deploy/tests/test_monitor.sh` -- curl stub copies the Tailscale fixture to `-o` (the docker fixture while `$S/curl-wrong-key` exists); new refusal case like `curl-fails`: exit 1, message, no `apt-get`, no `tailscale.list`, no keyring, no leftover `.tmp.*`; success case checks the keyring is byte-identical to the fixture (`cmp`).
- `deploy/README.md` -- state both pins and how to rotate (check a new key's fingerprint against the vendor's published one, update the constant and the fixture).
- `_bmad-output/implementation-artifacts/deferred-work.md` -- remove the entry.

**Acceptance Criteria:**
- Given a key server that serves a different valid key, when `monitor.sh install` runs, then it exits 1 naming the pinned fingerprint and leaves no Tailscale keyring, apt source or temp file.
- Given the genuine Tailscale key, when `monitor.sh install` runs, then the installed keyring is byte-identical to the served key and every existing install assertion still holds.
- Given `bootstrap-host.sh`, when its pin block is run against the fixtures, then only the genuine single Docker key passes.

## Spec Change Log

## Review Triage Log

### 2026-11-21 — Review pass
- verdicts: 18 findings — high 0, medium 4, low 11, false 3, maybe-false 0
- findings:
  - `[low]` `[reject]` blind-hunter: an ASCII-armored copy of the pinned Tailscale key passes the check and is installed under a `.gpg` name — real but pre-existing (the old code installed whatever was served, unchecked); the vendor serves binary, and a format change fails loudly at `apt-get update` (install_fail), not silently; fixing adds a new format guard.
  - `[low]` `[reject]` blind-hunter: Docker key is dearmored straight into the live keyring, not via temp+rename — same as the pre-change `curl | gpg --dearmor -o` pipeline; bootstrap runs once on a fresh host; fixing adds staging logic.
  - `[low]` `[patch]` blind-hunter: README rotation steps omit the fingerprint literals in both test suites — README now names them.
  - `[low]` `[patch]` blind-hunter: README "leaves no keyring, apt source, or temporary file" reads wrong on a rerun — README now says nothing new is installed and an existing keyring and source stay unchanged.
  - `[medium]` `[patch]` blind-hunter: Docker tests check only line order, so a caller with `|| true` would pass — `test_host_baseline.sh:780` now requires exactly one `key_fingerprint_matches ... || die` caller line.
  - `[medium]` `[patch]` blind-hunter: no Tailscale test serves a bundle whose first key matches the pin — `test_monitor.sh` now serves Tailscale key + binary Docker key and asserts refusal and cleanup.
  - `[low]` `[reject]` edge-case-hunter: armored Tailscale key accepted (duplicate of the first row) — same reason.
  - `[low]` `[reject]` edge-case-hunter: dearmor into live keyring (duplicate of the second row) — same reason.
  - `[low]` `[reject]` edge-case-hunter: SIGTERM during the gpg check can leave the staged key and gpg home — the staged `key_tmp` cleanup pattern is pre-existing; a signal-trap layer is added complexity for a rare interrupt with no security effect (files are root-only temp files).
  - `[false]` `[reject]` edge-case-hunter: a failed `rm -rf` of the gpg home lets install proceed — this has no effect on what is installed; the leftover is an empty throwaway gpg home, not a trust change, so no bad outcome at the cited lines.
  - `[low]` `[patch]` edge-case-hunter: refusal "leaves no keyring or source" claim wrong on rerun (same root cause as the fourth row) — fixed in the README.
  - `[low]` `[patch]` edge-case-hunter: rotation following the README fails CI (same root cause as the third row) — fixed in the README.
  - `[medium]` `[patch]` verification-gap: real bootstrap refusal branch is never executed; `|| true` would pass — patched with the exact caller-line assertion (`test_host_baseline.sh:780`). Running bootstrap through to the key phase is the separately tracked backlog item to run its later steps through the entry point.
  - `[medium]` `[patch]` verification-gap: Tailscale single-primary-key check could be dropped without failing CI — grouped with the sixth row (same defect); bundle refusal case added.
  - `[low]` `[patch]` verification-gap: wrong-key case mixes fingerprint and encoding — the wrong-key case now serves the Docker key dearmored to binary, the same format as the genuine one.
  - `[low]` `[patch]` verification-gap: no test that a refusal preserves an existing install — `test_monitor.sh` now reruns install with the wrong key after the success case and `cmp`s keyring and `tailscale.list`.
  - `[false]` `[reject]` verification-gap (other): armored copy published under `.gpg` — duplicate of the first row; rejected there.
  - `[false]` `[reject]` intent-alignment: descriptive report only; the diff implements one deferred-work item (reading 1), which is how every earlier `deferred` build run read this intent. No defect claimed. cross-story-contract: "No contract shape changed" (not counted as a finding).

## Verification

**Commands:**
- `bash deploy/tests/test_host_baseline.sh` -- expected: exit 0
- `bash deploy/tests/test_monitor.sh` -- expected: exit 0
- `shellcheck deploy/*.sh deploy/tests/*.sh` (if installed locally; CI pins 0.11.0) -- expected: no findings

## Auto Run Result

Status: done

**Summary:** `bootstrap-host.sh` and `monitor.sh install` now download the Docker and Tailscale apt signing keys to a temporary file and install them only if the file holds exactly one primary key with the pinned fingerprint (Docker `9DC858229FC7DD38854AE2D88D81803C0EBFCD88`, Tailscale `2596A99EAAB33821893C0A79458CA832957F5868`, both checked against the live keys on 2026-11-21). Otherwise they refuse with a message naming the pin and install nothing new.

**Files changed:**
- `deploy/bootstrap-host.sh` -- `# >>> apt key pin` block (pin + `key_fingerprint_matches`); the `curl | gpg --dearmor` pipeline is replaced by download, check, then dearmor.
- `deploy/monitor.sh` -- Tailscale pin, the same helper, `gpg` required, check before the keyring is moved into place.
- `deploy/tests/fixtures/docker-archive-keyring.asc`, `deploy/tests/fixtures/tailscale-archive-keyring.gpg` -- real public keys as served, for offline tests.
- `.gitattributes` -- fixtures are never line-ending converted.
- `deploy/tests/test_host_baseline.sh` -- pin block extracted and run against genuine, wrong, two-key, empty, text and missing files; call order; exactly one `|| die` caller line; no `curl | gpg` pipeline.
- `deploy/tests/test_monitor.sh` -- curl stub serves real fixtures; refusal of a wrong binary key and of a two-key bundle; byte-identical install; refused rerun leaves an existing keyring and source unchanged.
- `deploy/README.md` -- the pins, refusal behaviour and rotation steps (constant, fixture, test literals).
- `_bmad-output/implementation-artifacts/deferred-work.md` -- backlog entry removed.

**Review:** 18 findings. 9 patched (4 medium, 5 low, grouped into 5 fixes: caller-line assertion, Tailscale bundle refusal, wrong key in binary format, rerun preservation, README rotation and refusal wording). 0 deferred. 9 rejected: armored-key format and in-place dearmor (pre-existing behaviour that fails loudly, x2 each across layers); SIGTERM temp cleanup (pre-existing pattern, rare, no trust effect); failed gpg-home cleanup (no effect on what is installed); intent-alignment report (descriptive, no defect). Cross-story contract: none changed.

**Follow-up review recommended: true** (two medium entries patched). Named risk: the real bootstrap Docker-key branch is still never executed end-to-end. It is proven by the extracted helper, the exact `|| die` caller line and line order, because the sandboxed bootstrap run stops at the first `apt-get update` (see the open backlog item on running bootstrap's later steps through the entry point).

**Verification:**
- ShellCheck 0.11.0 (`koalaman/shellcheck-alpine:v0.11.0`, CI command `shellcheck deploy/*.sh deploy/tests/*.sh`): rc=0, same as baseline.
- Ubuntu 24.04 container, as root and as an unprivileged user: `test_monitor.sh` rc=0 and `test_host_baseline.sh` rc=0 (both runs print `apt key pin checks passed`).
- Windows Git Bash: `test_monitor.sh` passes. `test_host_baseline.sh` fails at the earlier, unrelated check "a writable persisted mode file was accepted" (a Windows file-mode limitation that also fails at baseline).

**Residual risks:** An apt key rotation by Docker or Tailscale will now stop provisioning or the monitor install until the pin is updated (intended). The pins were verified against keys fetched over HTTPS from the vendors' own hosts on 2026-11-21, not against an independent channel.
