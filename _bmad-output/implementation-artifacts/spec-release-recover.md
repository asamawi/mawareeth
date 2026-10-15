---
title: 'Automate deploy crash recovery with release.sh recover'
type: 'feature'
created: '2026-10-15'
status: 'done'
review_loop_iteration: 0
baseline_commit: '2accce195a7b9a21a58afc1bad02aef2487ba4fc'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-0-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-0-6-implement-safe-blue-green-deployment.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After a crashed or partly failed deploy (exit 4, 7 or 8), the journal stays non-idle and every deploy and runtime mutation is refused until an operator works through seven manual steps in `deploy/README.md`. A slip in those steps can leave Caddy routed to an unverified slot or leave slot records out of step with what is running.

**Approach:** Add `deploy/release.sh recover [--dry-run]`. It reads the journal, chooses the slot that must serve (the candidate if it was verified, otherwise the prior slot; for an unverified bootstrap, nothing), puts records and the route back, confirms the result at the edge over verified TLS, stops the other slot, and resets the journal to idle. A new journal field `records=` makes record restoration unambiguous. Recover needs no release manifest.

## Boundaries & Constraints

**Always:** Hold the deploy lock for the whole run (exit 3 if it is held). With an idle or absent journal, report "nothing to recover" and exit 0. Refuse with exit 2, before any mutation, when the journal is malformed or unsafe, when it uses the legacy 10-line format, or when records contradict the journal. Take images, commits and snapshots only from slot records and the journal. Publish every state write with `atomic_write`. Never start or change a slot except to start the target slot on its recorded image. Stop the other slot only after the edge confirms the target slot's `X-Mawareeth-Slot` header and commit. Bound every wait. Leave the journal untouched on any failure, so recover can simply be run again. `--dry-run` prints the plan and mutates nothing. `runtime.sh` must keep accepting existing 10-line journals.

**Ask First:** Falling back to the prior slot when a verified candidate is not ready; changing deploy exit codes 2–8, record or route formats, or anything beyond adding `records=`.

**Never:** Run, reverse or fake migrations; require or read a manifest; build or pull images; redeploy; recover a legacy journal automatically; modify the journal on failure; contact a real host or registry.

## I/O & Edge-Case Matrix

| Scenario | Journal / State | Expected Output / Behavior | Error Handling |
|----------|-----------------|----------------------------|----------------|
| Verified forward | `result=verified` or `phase=draining` | Route → candidate, edge confirms, prior stopped, journal `idle success` | N/A |
| Abandoned candidate | not verified, `prior_slot` set, `records=replaced` | Candidate record ← `.prev` (removed if there is no `.prev`), route → prior, edge confirms, candidate stopped, journal `idle failed:<phase>` | N/A |
| Records untouched | not verified, `records=untouched` | Records left as they are; otherwise same as above | N/A |
| Unverified bootstrap | `prior_slot` empty, not verified | Caddy and candidate stopped (Caddy confirmed stopped), candidate record removed or restored, journal `idle failed:<phase>` | Exit 7 if Caddy cannot be stopped |
| Nothing to do | journal absent or idle | No mutation | Exit 0 |
| Lock held | another operation | No mutation | Exit 3 |
| Malformed, unsafe or legacy journal; record ≠ journal commit | — | No mutation; names the manual steps | Exit 2 |
| Target unready, reload fails, or edge unconfirmed | after mutation began | Journal unchanged (non-idle) | Exit 7, CRITICAL message |
| Dry run | any non-idle journal | Prints target slot and the record, route and stop actions | Exit 0, no mutation |

</frozen-after-approval>

## Code Map

- `deploy/release.sh:69-79` -- `journal_content`/`journal`: add the 11th line `records=$records_state`.
- `deploy/release.sh:456-466` -- the switching sequence: `.prev` write, then the record write; set `records=replaced` once `.prev` is published.
- `deploy/release.sh:120-235` -- reuse `probe`, `slot_ready`, `running_image_matches`, `edge_serves`, `caddy_running`, `apply_route`, `stop_service`, `wait_until`, `open_logs`.
- `deploy/release.sh:488-491` -- dispatch: add `recover [--dry-run]`.
- `deploy/runtime.sh:283-302` -- `preflight`: split into `preflight_runtime` (no manifest) plus the manifest checks.
- `deploy/runtime.sh:436-459` -- `journal_status`: accept an optional final `records=(untouched|replaced)` line; `journal_refusal` points to `release.sh recover`.
- `deploy/runtime.sh:327,408-422` -- `route_content` and `read_slot_record SLOT [.prev]` for record parsing.
- `deploy/tests/test_release.sh:615-656` -- the `# operator manual recovery` blocks become `release.sh recover` runs with assertions; `write_journal` (line 321) builds legacy 10-line journals.
- `deploy/README.md:3,72-76,85-101` -- scope line, exit table, manual recovery section.

## Tasks & Acceptance

**Execution:**
- [x] `deploy/runtime.sh` -- `preflight_runtime` split, `journal_status` accepting both formats, `journal_refusal` text -- lets recover run without a manifest while existing journals stay valid.
- [x] `deploy/release.sh` -- `records_state` in the journal, `recover` with `--dry-run`, and recover exit codes in the header -- the feature itself.
- [x] `deploy/tests/test_release.sh` -- replace each manual-recovery block with `recover` and assert route, Caddy, records, running slots and an idle journal; add cases for every matrix row, including crashes injected after the `.prev` write and after the record write, and recover run twice -- covers each recovery path offline.
- [x] `deploy/README.md` -- document recover usage and exit codes, the `records=` field, and keep the manual steps as a fallback for legacy journals -- operator runbook.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- add `resolved_by` to the 0.6 `recover` entry.

**Acceptance Criteria:**
- Given any non-idle journal produced by a deploy exit 4, 7 or 8 or a crash in any phase, when `recover` exits 0, then the route, the Caddy-loaded route and the edge agree on one slot, that slot runs its recorded image, the other slot is stopped, and a following `release.sh deploy` is accepted.
- Given a failed recover, when it is rerun after the fault clears, then it completes without manual edits.
- Given the updated suites, when they run, then they pass offline and ShellCheck is clean.

## Design Notes

`records_state` ordering in `switching`: journal `records=untouched` → publish `.prev` (the pre-deploy record, or remove `.prev` if there was none) → journal `records=replaced` → write the candidate record → write the route. Once `records=replaced` is journaled, `.prev` is guaranteed to hold the pre-deploy record, so restoring it is correct whether or not the record write happened. The cost: the older `.prev` is lost when recover rolls back, which the README must state. `abort_switch` restores the candidate record first, then journals `records=untouched`, and only then puts back the older `.prev`; if that journal write fails, `.prev` keeps the pre-deploy record and a WARNING is printed. Recover starts PostgreSQL (bounded) if it is not running and refuses (exit 2) when the runtime configuration differs from the target record's snapshot.

Compose environment during recover: each slot's image comes from its record. If neither slot has a record (a bootstrap crash before the record write), use the locked Caddy image reference purely to satisfy interpolation, because only `stop` runs. The snapshot is the target record's `SNAPSHOT`, checked with `file_metadata` and its hash. With no target, use `use_existing_snapshot`.

## Verification

**Commands:**
- `bash -n deploy/*.sh deploy/tests/*.sh` -- expected: everything parses.
- `bash deploy/tests/test_release.sh && bash deploy/tests/test_compose_runtime.sh` -- expected: pass offline.
- `shellcheck deploy/*.sh deploy/tests/*.sh` -- expected: clean, if ShellCheck is installed.

## Suggested Review Order

**Recovery decision and plan**

- Entry point: reads the journal, picks the serving slot, validates records before any mutation.
  [`release.sh:616`](../../deploy/release.sh#L616)

- Refuses impossible journals (`result=success` while non-idle) instead of guessing.
  [`release.sh:652`](../../deploy/release.sh#L652)

- Config drift against the recorded snapshot is refused before anything changes.
  [`release.sh:694`](../../deploy/release.sh#L694)

**Recovery actions and failure handling**

- PostgreSQL started first so a post-reboot recover cannot loop on exit 7.
  [`release.sh:777`](../../deploy/release.sh#L777)

- Edge must confirm slot header and commit before the other slot stops.
  [`release.sh:794`](../../deploy/release.sh#L794)

- Failures after mutation leave the journal untouched so recover is simply rerun.
  [`release.sh:536`](../../deploy/release.sh#L536)

- Record restoration is idempotent and runs last on rollback.
  [`release.sh:596`](../../deploy/release.sh#L596)

**Journal `records=` contract**

- `.prev` is published before `records=replaced`, making `.prev` restoration always correct.
  [`release.sh:495`](../../deploy/release.sh#L495)

- Rollback re-journals `untouched` before restoring the older `.prev`; warns if it cannot.
  [`release.sh:250`](../../deploy/release.sh#L250)

- Journal parser accepts both eleven-line and legacy ten-line formats.
  [`runtime.sh:450`](../../deploy/runtime.sh#L450)

- Manifest-free preflight lets recover run without the interrupted release's manifest.
  [`runtime.sh:286`](../../deploy/runtime.sh#L286)

**Peripherals**

- Bootstrap snapshot fallback avoids the prepare-vs-non-idle-journal deadlock.
  [`release.sh:567`](../../deploy/release.sh#L567)

- Operator runbook: usage, behaviour, exit codes, `.prev` caveat, manual fallback.
  [`README.md:85`](../../deploy/README.md#L85)

- SIGKILL crash injection during the switch, then recover.
  [`test_release.sh:840`](../../deploy/tests/test_release.sh#L840)

- Crashed bootstrap recover, dry run, Caddy-stop failure.
  [`test_release.sh:440`](../../deploy/tests/test_release.sh#L440)
