---
title: 'Story 0.1: Capture and Verify the Heroku Inventory'
type: 'chore'
created: '2026-10-11'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'c00324b694c984090689af0be6a3f94056040e0d'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-0-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The migration has no reproducible, verified baseline of the live Heroku application, PostgreSQL service, add-ons, configuration keys, domains, and DNS. Cutover planning can therefore miss a dependency, leak a secret during discovery, or proceed with unknown production state.

**Approach:** Add a read-only capture utility and operator runbook that query the live Heroku app, retain only migration-relevant redacted fields, resolve public DNS, and produce a deterministic report whose verification status fails closed until every required section is complete and explicitly confirmed.

## Boundaries & Constraints

**Always:** Require an explicit app identifier; use read-only Heroku and DNS operations; record capture time and tool versions; include database identity/version/plan without credentials, add-on names/plans, config key names without values, domains and current DNS answers; distinguish observed facts from operator confirmations; make missing, malformed, or unavailable evidence block verification; keep output deterministic and reviewable.

**Ask First:** Installing or authenticating the Heroku CLI; querying the live Heroku account from a new operator environment; committing a generated inventory containing non-secret production metadata; changing DNS, Heroku configuration, add-ons, domains, database state, or application releases.

**Never:** Print, persist, diff, or log config values, database URLs, tokens, credentials, certificate material, or cookies. Never infer unknown live values from repository defaults, perform writes against Heroku/DNS/PostgreSQL, or mark the baseline verified while required evidence is absent.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Complete capture | Authenticated CLI, valid app, all required APIs and DNS available | Redacted deterministic report with every section populated; verification can pass after operator confirmations | N/A |
| Secret-bearing config | Heroku returns config key/value pairs | Report contains sorted key names only; values never reach output or diagnostic text | Abort if safe parsing cannot be guaranteed |
| Partial discovery | Any required command fails, returns malformed JSON, or DNS is unresolved | Report identifies the affected section as unknown and remains unverified | Non-zero exit with a concise secret-free error |
| Wrong or inaccessible app | Missing app argument, authentication failure, or app not found | No verified report is produced | Non-zero exit with remediation guidance |

</frozen-after-approval>

## Code Map

- `deploy/heroku_inventory.py` -- new orchestration boundary for read-only Heroku JSON queries, strict field allow-listing, DNS resolution, deterministic serialization, and verification gating.
- `deploy/tests/test_heroku_inventory.py` -- new isolated tests using mocked command/DNS responses; no live account access in automated tests.
- `deploy/README.md` -- existing operations documentation; add prerequisites, safe execution, operator confirmations, report review, and prohibition on committing secrets.
- `.gitignore` -- existing runtime-secret exclusions; ignore raw/transient capture material while allowing an intentionally reviewed redacted baseline.
- `Procfile` -- evidence for the current Heroku process model; read-only during this story.
- `mawareeth/settings.py` -- evidence for required production config keys and Heroku-specific database TLS compatibility; read-only during this story.
- `_bmad-output/specs/spec-heroku-to-hetzner/stories.yaml` -- source story contract: database, add-ons, configuration, domains, DNS, redaction, and read-only discovery.

## Tasks & Acceptance

**Execution:**
- [x] `deploy/heroku_inventory.py` -- capture allow-listed app, process, database, add-on, config-key, domain, and DNS facts; emit a schema-versioned redacted report and fail closed on unknown required evidence.
- [x] `deploy/tests/test_heroku_inventory.py` -- cover complete capture, value redaction, deterministic output, command/auth failures, malformed JSON, unresolved DNS, and incomplete verification.
- [x] `deploy/README.md` -- document Heroku CLI/auth prerequisites, read-only scope, exact capture/verify commands, required operator confirmations, and safe handling of generated artifacts.
- [x] `.gitignore` -- exclude transient/raw discovery files and default generated output so review is required before any production metadata is committed.
- [x] `docs/operations/heroku-inventory.redacted.json` -- generate and manually inspect the live redacted baseline only after the operator authorizes CLI installation/authentication and confirms the target app.

**Acceptance Criteria:**
- Given an authorized operator can read the target Heroku app, when capture runs, then the report records all required migration dependencies, observation timestamps, and tool versions without any secret values.
- Given the same normalized live evidence, when capture runs repeatedly, then the serialized report is stable apart from documented observation metadata.
- Given any required inventory section is unknown or any operator confirmation is incomplete, when verification runs, then it exits non-zero and identifies the blocking section without exposing sensitive data.
- Given a generated report is proposed for source control, when it is reviewed, then automated tests and manual inspection confirm it contains no config values, credentials, database URLs, tokens, or other secret material.

## Spec Change Log

## Design Notes

The utility must parse command output in memory and immediately project it through explicit field allow-lists. It must never save raw Heroku responses. Verification is a separate mode over the redacted report so the baseline can be reviewed and operator confirmations can be recorded without repeating discovery.

## Verification

**Commands:**
- `python -m unittest deploy.tests.test_heroku_inventory` -- expected: all mocked capture, redaction, determinism, and failure-path tests pass.
- `python deploy/heroku_inventory.py capture --app <HEROKU_APP> --output <PATH>` -- expected: read-only capture writes a redacted report or exits non-zero without secret-bearing diagnostics.
- `python deploy/heroku_inventory.py verify --input <PATH>` -- expected: exits zero only when every required section and confirmation is complete.

**Manual checks (if no CLI):**
- Confirm Heroku CLI installation/authentication and the exact production app identifier before live discovery; this environment currently has neither.
- Inspect the generated baseline before commit and confirm every configuration entry is a key name only and no database URL, credential, token, or secret value appears.

## Suggested Review Order

**Capture Boundary**

- Start with the read-only orchestration and deterministic report contract.
  [`heroku_inventory.py:338`](../../deploy/heroku_inventory.py#L338)

- Follow the CLI modes that separate capture, confirmation, and verification.
  [`heroku_inventory.py:492`](../../deploy/heroku_inventory.py#L492)

**Fail-Closed Validation**

- Review strict nested schemas and process-command secret rejection.
  [`heroku_inventory.py:161`](../../deploy/heroku_inventory.py#L161)

- Confirm verification rejects malformed evidence before operator approval.
  [`heroku_inventory.py:398`](../../deploy/heroku_inventory.py#L398)

**Operator Workflow**

- Check exact safe commands and production-metadata handling guidance.
  [`README.md:44`](../../deploy/README.md#L44)

- Inspect the reviewed, redacted live baseline consumed by migration planning.
  [`heroku-inventory.redacted.json:1`](../../docs/operations/heroku-inventory.redacted.json#L1)

**Verification Evidence**

- Validate complete capture shape, determinism, and redaction assertions.
  [`test_heroku_inventory.py:115`](../../deploy/tests/test_heroku_inventory.py#L115)

- Review malformed-report and confirmation-gating regression coverage.
  [`test_heroku_inventory.py:349`](../../deploy/tests/test_heroku_inventory.py#L349)

- Confirm generated and raw discovery artifacts remain ignored by default.
  [`.gitignore:106`](../../.gitignore#L106)
