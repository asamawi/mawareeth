---
title: 'Pass SITE_ID and social-login credentials through the runtime contract'
type: 'feature'
created: '2026-10-26'
status: 'done'
review_loop_iteration: 1
baseline_commit: 'ece98c701e6d1bd705775193b80a925781f5e84a'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `deploy/runtime.sh` accepts exactly eight `runtime.env` keys and renders a fixed app snapshot. Heroku sets five more keys that the app reads:
- `SITE_ID`, which is `2` on Heroku (`mawareeth/settings.py:285`);
- `FACEBOOK_KEY`, `FACEBOOK_SECRET`, `LINKEDIN_KEY` and `LINKEDIN_SECRET` (`settings.py:335-352`).

On Hetzner the app would fall back to `SITE_ID=1` and placeholder OAuth credentials, so social login and the sites framework would break at cutover.

**Approach:** Accept the five keys as optional in `runtime.env`, validate them, and append each one present to the app snapshot after the existing lines.

## Boundaries & Constraints

**Always:**
- **Optional and additive.** A `runtime.env` without the new keys renders a byte-identical snapshot, so existing slot snapshots and their hashes keep matching.
- **Fixed order.** Present keys are appended in this order: `SITE_ID`, `FACEBOOK_KEY`, `FACEBOOK_SECRET`, `LINKEDIN_KEY`, `LINKEDIN_SECRET`.
- **Validation:**
  - `SITE_ID` matches `^[1-9][0-9]{0,9}$`.
  - `FACEBOOK_KEY` matches `^[0-9]{1,32}$` (settings cast it to `int`).
  - The secrets and `LINKEDIN_KEY` are 1–256 characters, already free of whitespace and control characters under the existing rules.
  - Each provider's key and secret are both present or both absent.
- **Names.** Snapshot names are exactly the ones `settings.py` reads (`SITE_ID`, `FACEBOOK_KEY`, …).
- **Secrets.** Secret values never appear in output, logs or error messages; errors name only the key.

**Ask First:**
- Making any of the keys required.
- Adding other Heroku keys (for example `INSTAGRAM_*`, which the app does not read).

**Never:**
- Change the eight existing keys' rules or the existing snapshot lines.
- Put real credentials in the repository.
- Add the optional keys to `runtime.env.example`, which must stay directly installable without fake OAuth credentials.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| No new keys | Today's eight keys | Snapshot byte-identical to before | N/A |
| All keys | Eight plus all five | Snapshot ends with the five lines in fixed order | N/A |
| SITE_ID only | Eight plus `SITE_ID=2` | Only `SITE_ID=2` is appended | N/A |
| Bad SITE_ID | `0`, `-1`, `abc`, `01` | Refused before any state change | `die` names `SITE_ID` |
| Bad FACEBOOK_KEY | Non-numeric | Refused | `die` names `FACEBOOK_KEY` |
| Half a pair | `FACEBOOK_KEY` without `FACEBOOK_SECRET` (or the LinkedIn equivalent) | Refused | `die` names both keys |
| Overlong secret | Longer than 256 characters | Refused | `die` names the key |
| Leak | Any refusal or success | No secret value in output | N/A |

</frozen-after-approval>

## Code Map

- `deploy/runtime.sh:44-61` -- `load_raw_env`. Its `expected` allow-list and required-key loop need the optional keys (allowed, not required).
- `deploy/runtime.sh:63-75` -- `validate_values`. Add the new rules here; `die` exits 2 with a `runtime:` prefix.
- `deploy/runtime.sh:195-205` -- `snapshot_content`. Append the optional lines. `snapshot_hash` (:208) and `release.sh:431,720,744` consume it unchanged.
- `deploy/tests/test_compose_runtime.sh`:
  - fixture `runtime.env` :103-113;
  - snapshot assertions :203-215;
  - leak check :420;
  - malformed-value loop :435-447 (replaces an existing key or appends `EXTRA_*`).
- `deploy/README.md:7` -- runtime schema paragraph: document the optional keys there. `:534` -- Application runtime contract.
- `deploy/backup.sh` host-state archives `runtime.env` whole -- no change needed.

## Tasks & Acceptance

**Execution:**
- [x] `deploy/runtime.sh` -- optional keys, validation, pairing, snapshot append, per the matrix.
- [x] `deploy/tests/test_compose_runtime.sh` -- one case per matrix row:
  - assert the snapshot for the eight-key fixture is byte-identical to the expected eight-line content;
  - extend the leak check with the new secret values.
- [x] `deploy/README.md` -- in the runtime schema paragraph, list the five optional keys and their rules and pairing, and where the app reads them. Note that adding them changes the snapshot hash, so running slots need a deliberate configuration rotation rather than a deploy.

**Acceptance Criteria:**
- Given an existing host's `runtime.env` with only the eight keys, when `runtime.sh prepare` runs, then it reuses the same snapshot file (same hash) as before this change.
- Given the deploy shell suites, when they run, then all of them pass, and ShellCheck is clean.

## Spec Change Log

- **Review round 1 (patch only, no intent change).** Three review layers (blind, edge-case, verification-gap) found no `intent_gap` or `bad_spec`. Applied:
  - `SITE_ID` capped at 2147483647, because Django's `Site.id` is a PostgreSQL `integer`.
  - The allow-list is now built once from `required_runtime_keys` plus `optional_app_keys`.
  - No-whitespace rule for `FACEBOOK_SECRET`, `LINKEDIN_KEY` and `LINKEDIN_SECRET`. The spec had assumed the raw format already rejected inner whitespace; it only rejects leading and trailing whitespace.
  - Tests:
    - boundary cases on both sides of every limit;
    - each snapshot's hash equals the sha256 of its content and differs from the eight-key hash;
    - refusals never echo the bad value;
    - per-case cleanup.
  - A Django test pinning the env names `settings.py` reads to the names the snapshot emits.
  - README:
    - copy-paste `KEY=` lines and console-field names;
    - `SITE_ID` after a Heroku restore (2, with a matching `django_site` row);
    - no rotation command exists yet, so set the keys before the first deploy.
  - **Rejected:** refusing leading zeros in `FACEBOOK_KEY` (it contradicts the approved `^[0-9]{1,32}$`) and warning when social keys are absent (they are optional by design).
- **Shipped** in PR #70 (`1524ca9`). On the rehearsal host (2026-10-27), `runtime.env` carries all five keys with `SITE_ID=2`, and the prepared snapshot hash differs from the eight-key one, as expected.

## Verification

**Commands:**
- `bash -n deploy/runtime.sh deploy/tests/test_compose_runtime.sh` -- expected: parses.
- `bash deploy/tests/test_compose_runtime.sh && bash deploy/tests/test_release.sh && bash deploy/tests/test_backup.sh && bash deploy/tests/test_rehearse.sh` -- expected: pass.
